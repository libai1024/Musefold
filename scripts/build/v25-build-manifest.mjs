#!/usr/bin/env node
// v2.5 构建身份 manifest(G-RELEASE-01 R01.2/R01.6):CI 与本地共用同一 JSON 事实源,
// 记录当次 commit/ref/version/runner 身份与指定产物的 sha256/bytes;只包含白名单字段,
// 绝不写入任何 secret/token(不复制环境变量,不读凭据文件)。
// 用法:node scripts/build/v25-build-manifest.mjs --out <path> [--artifact id=path ...]
// 产物缺失 = 硬错误,不产出部分 manifest;退出码:0 成功,1 环境错误,2 参数错误。
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRootDefault = () => fileURLToPath(new URL('../..', import.meta.url));

export function parseManifestArguments(argv) {
  const options = { out: '', artifacts: [] };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new Error('INVALID_ARGUMENTS');
    if (flag === '--out') {
      if (options.out) throw new Error('INVALID_ARGUMENTS');
      options.out = value;
    } else if (flag === '--artifact') {
      const separator = value.indexOf('=');
      const id = separator > 0 ? value.slice(0, separator) : '';
      const path = separator >= 0 ? value.slice(separator + 1) : '';
      if (!id || !path || options.artifacts.some((entry) => entry.id === id))
        throw new Error('INVALID_ARGUMENTS');
      options.artifacts.push({ id, path });
    } else {
      throw new Error('INVALID_ARGUMENTS');
    }
    i++;
  }
  if (!options.out) throw new Error('INVALID_ARGUMENTS');
  return options;
}

function gitOutput(repoRoot, args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

// 身份优先取 CI 注入的 GITHUB_* 环境变量,缺省回退本仓库 git;version 只读
// apps/desktop/package.json(发布流程管理的唯一事实源,本脚本绝不修改它)。
function resolveIdentity(repoRoot, env) {
  const commit = env.GITHUB_SHA || gitOutput(repoRoot, ['rev-parse', 'HEAD']);
  const refName = env.GITHUB_REF_NAME || gitOutput(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const ref = env.GITHUB_REF || (refName === 'HEAD' ? commit : `refs/heads/${refName}`);
  const version = JSON.parse(
    readFileSync(resolve(repoRoot, 'apps/desktop/package.json'), 'utf8'),
  ).version;
  return { commit, ref, refName, version };
}

function describeArtifact(cwd, { id, path }) {
  const file = resolve(cwd, path);
  if (!existsSync(file)) throw new Error(`ARTIFACT_MISSING:${id}:${path}`);
  const body = readFileSync(file);
  return { id, path, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') };
}

export function createBuildManifest({
  repoRoot = repoRootDefault(),
  cwd = process.cwd(),
  env = process.env,
  artifacts = [],
  builtAt = new Date().toISOString(),
} = {}) {
  const identity = resolveIdentity(repoRoot, env);
  const buildIdPath = resolve(repoRoot, 'apps/web-next/.next/BUILD_ID');
  return {
    schema: 'v25-build-manifest/1',
    commit: identity.commit,
    ref: identity.ref,
    refName: identity.refName,
    version: identity.version,
    builtAt,
    runnerOs: env.RUNNER_OS || process.platform,
    runnerArch: env.RUNNER_ARCH || process.arch,
    webBuildId: existsSync(buildIdPath) ? readFileSync(buildIdPath, 'utf8').trim() : null,
    artifacts: artifacts.map((entry) => describeArtifact(cwd, entry)),
  };
}

function writeManifest(out, manifest) {
  const target = resolve(out);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  return target;
}

function main(argv) {
  const { out, artifacts } = parseManifestArguments(argv);
  // 任何产物缺失都会在写入前抛错:绝不留下部分 manifest。
  const manifest = createBuildManifest({ artifacts });
  const target = writeManifest(out, manifest);
  return { manifest, target };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { manifest, target } = main(process.argv.slice(2));
    process.stdout.write(
      `${JSON.stringify({
        out: target,
        commit: manifest.commit,
        ref: manifest.refName,
        version: manifest.version,
        artifacts: manifest.artifacts.length,
      })}\n`,
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = error instanceof Error && error.message === 'INVALID_ARGUMENTS' ? 2 : 1;
  }
}
