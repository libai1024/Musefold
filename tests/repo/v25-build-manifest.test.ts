import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const script = join(repoRoot, 'scripts/build/v25-build-manifest.mjs');
const roots: string[] = [];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'v25-build-manifest-'));
  roots.push(root);
  return root;
}

// GitHub Actions 运行单测时环境里带有真实 GITHUB_*;用空串清空以强制走本地 git 回退。
const localEnv = () => ({
  ...process.env,
  GITHUB_SHA: '',
  GITHUB_REF: '',
  GITHUB_REF_NAME: '',
  RUNNER_OS: '',
  RUNNER_ARCH: '',
});

const attempt = (args: string[], env: NodeJS.ProcessEnv = localEnv()) => {
  try {
    return {
      stdout: execFileSync('node', [script, ...args], { encoding: 'utf8', env }),
      status: 0,
    };
  } catch (error) {
    const failure = error as { status?: number; stderr?: string };
    return { stdout: '', status: failure.status ?? -1, stderr: failure.stderr ?? '' };
  }
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('v2.5 build manifest', () => {
  it('records git identity, the desktop version and artifact digests', () => {
    const root = fixture();
    const artifactBody = 'fixture-build-id\n';
    const artifact = join(root, 'web-build-id.txt');
    writeFileSync(artifact, artifactBody);
    const out = join(root, 'nested', 'build-manifest.json');

    const run = attempt(['--out', out, '--artifact', `web-build-id=${artifact}`]);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('"artifacts":1');

    const manifest = JSON.parse(readFileSync(out, 'utf8'));
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim();
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim();
    expect(manifest.commit).toBe(head);
    expect(manifest.refName).toBe(branch);
    expect(manifest.ref).toBe(branch === 'HEAD' ? head : `refs/heads/${branch}`);
    expect(manifest.version).toBe(
      JSON.parse(readFileSync(join(repoRoot, 'apps/desktop/package.json'), 'utf8')).version,
    );
    expect(new Date(manifest.builtAt).toISOString()).toBe(manifest.builtAt);
    expect(manifest.runnerOs).toBe(process.platform);
    expect(manifest.runnerArch).toBe(process.arch);
    const repoBuildId = join(repoRoot, 'apps/web-next/.next/BUILD_ID');
    expect(manifest.webBuildId).toBe(
      existsSync(repoBuildId) ? readFileSync(repoBuildId, 'utf8').trim() : null,
    );
    expect(manifest.artifacts).toEqual([
      {
        id: 'web-build-id',
        path: artifact,
        bytes: Buffer.byteLength(artifactBody),
        sha256: createHash('sha256').update(artifactBody).digest('hex'),
      },
    ]);
  });

  it('prefers GitHub Actions identity over local git', () => {
    const root = fixture();
    const out = join(root, 'build-manifest.json');
    const run = attempt(['--out', out], {
      ...localEnv(),
      GITHUB_SHA: '0123456789abcdef0123456789abcdef01234567',
      GITHUB_REF: 'refs/tags/v2.5.0',
      GITHUB_REF_NAME: 'v2.5.0',
      RUNNER_OS: 'Linux',
      RUNNER_ARCH: 'X64',
    });
    expect(run.status).toBe(0);
    expect(JSON.parse(readFileSync(out, 'utf8'))).toMatchObject({
      commit: '0123456789abcdef0123456789abcdef01234567',
      ref: 'refs/tags/v2.5.0',
      refName: 'v2.5.0',
      runnerOs: 'Linux',
      runnerArch: 'X64',
    });
  });

  it('never copies environment secrets into the manifest', () => {
    const root = fixture();
    const out = join(root, 'build-manifest.json');
    const run = attempt(['--out', out], {
      ...localEnv(),
      FAKE_RELEASE_TOKEN: 'fake-secret-token-value',
    });
    expect(run.status).toBe(0);
    expect(readFileSync(out, 'utf8')).not.toContain('fake-secret-token-value');
  });

  it('fails without writing a manifest when an artifact is missing', () => {
    const root = fixture();
    const out = join(root, 'build-manifest.json');
    const run = attempt(['--out', out, '--artifact', `ghost=${join(root, 'missing.bin')}`]);
    expect(run.status).toBeGreaterThan(0);
    expect(run.stderr).toContain('ghost');
    expect(existsSync(out)).toBe(false);
  });

  it('rejects malformed command lines with exit code 2', () => {
    const root = fixture();
    const out = join(root, 'build-manifest.json');
    for (const args of [[], ['--out'], ['--bogus', 'value'], ['--artifact', 'no-equals-sign']]) {
      const run = attempt(args);
      expect(run.status).toBe(2);
    }
    expect(existsSync(out)).toBe(false);
  });
});
