#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDotEnv, migrationDatabaseUrl, publishInfraFile, workerDatabaseUrl } from './infra-guard.mjs';
import { recordLayer, readDeployState, writeDeployState } from './state.mjs';
import {
  DEFAULT_KEEP,
  SHA_MARKER,
  copyTree,
  materializeRelease,
  pruneReleases,
  promoteAppDirectory,
  rollbackRelease,
  switchRelease,
} from './web-release.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = resolve(here, '../..');

export const DEFAULTS = {
  siteRoot: '/opt/musefold/site/Musefold',
  composeDir: '/opt/musefold',
  liveCaddy: '/opt/musefold/Caddyfile',
  liveCompose: '/opt/musefold/docker-compose.yml',
  liveRemoteCompose: '/opt/musefold/remote-compose.yaml',
  archiveDir: '/opt/musefold/archive',
  image: 'musefold-v11',
  webUrl: 'https://zhaozhaoyue.top/Musefold/app/',
  readyUrl: 'https://zhaozhaoyue.top/health/ready',
  dockerNetwork: 'musefold_default',
  composeProject: 'musefold',
  keep: DEFAULT_KEEP,
  dockerCpus: '4',
  dockerMemory: '3g',
};

export function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const out = { layers: 'content,service' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      out.dryRun = true;
      continue;
    }
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

export function parseLayers(raw) {
  const set = new Set(
    String(raw || '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean),
  );
  if (set.has('all')) return { content: true, service: true };
  return { content: set.has('content'), service: set.has('service') };
}

export function createExec(runner = spawnSync) {
  return function exec(command, args, options = {}) {
    const result = runner(command, args, {
      encoding: 'utf8',
      stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
      cwd: options.cwd,
      env: options.env,
    });
    if (result.status !== 0 && !options.allowFail) {
      const err = result.stderr || result.stdout || `${command} ${args.join(' ')}`;
      throw new Error(err.trim() || `${command} exited ${result.status}`);
    }
    return result;
  };
}

export async function waitHttp(url, { timeoutMs = 120_000, intervalMs = 2000, expectText, expectRe, fetchImpl = fetch } = {}) {
  const start = Date.now();
  let last = 'not attempted';
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetchImpl(url, { redirect: 'follow' });
      const text = await response.text();
      const matchesText = !expectText || text.includes(expectText) || text.trim() === expectText;
      const matchesRe = !expectRe || expectRe.test(text);
      if (response.ok && matchesText && matchesRe) return { ok: true, status: response.status, text };
      last = `${response.status} ${text.slice(0, 180)}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveTimer) => setTimeout(resolveTimer, intervalMs));
  }
  return { ok: false, last };
}

function dockerRun(exec, args, options) {
  return exec('docker', args, options);
}

export function extractWebDist({ exec, image, dest }) {
  const name = `mf-extract-${process.pid}`;
  mkdirSync(dest, { recursive: true });
  try {
    dockerRun(exec, ['create', '--name', name, image]);
    dockerRun(exec, ['cp', `${name}:/app/apps/web/dist/.`, `${dest}/`]);
  } finally {
    dockerRun(exec, ['rm', '-f', name], { allowFail: true });
  }
}

export function buildImage({ exec, repoRoot, image, sha, cpus, memory }) {
  const args = ['build', '--cpus', String(cpus), '--memory', String(memory), '-t', `${image}:${sha}`, '-f', 'infra/v1.1/Dockerfile', '.'];
  try {
    dockerRun(exec, args, { cwd: repoRoot });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/memory|cpus|cgroup/i.test(message)) throw error;
    dockerRun(exec, ['build', '-t', `${image}:${sha}`, '-f', 'infra/v1.1/Dockerfile', '.'], { cwd: repoRoot });
  }
}

function composeArgs(composeDir, composeFile, remoteComposeFile, envFile) {
  const args = ['compose', '--project-directory', composeDir, '-f', composeFile, '-f', remoteComposeFile];
  if (envFile) args.push('--env-file', envFile);
  return args;
}

export function migrateAndRoll({
  exec,
  composeDir,
  composeFile,
  remoteComposeFile,
  image,
  sha,
  envFile,
  dockerNetwork,
}) {
  const env = { ...process.env, ...loadDotEnv(envFile), MUSEFOLD_IMAGE_TAG: sha };
  const migrationUrl = migrationDatabaseUrl(env);
  if (!migrationUrl) {
    throw new Error('MIGRATION_DATABASE_URL / MIGRATION_DB_PASSWORD / DATABASE_URL missing in compose env file');
  }
  const workerUrl = workerDatabaseUrl(env);
  const fileArgs = envFile ? ['--env-file', envFile] : [];

  dockerRun(
    exec,
    [
      'run',
      '--rm',
      '--network',
      dockerNetwork,
      ...fileArgs,
      '-e',
      `DATABASE_URL=${migrationUrl}`,
      `${image}:${sha}`,
      'npm',
      'run',
      'db:migrate',
      '--workspace',
      '@musefold/web-api',
    ],
    { env },
  );
  dockerRun(
    exec,
    [
      'run',
      '--rm',
      '--network',
      dockerNetwork,
      ...fileArgs,
      '-e',
      `DATABASE_URL=${workerUrl}`,
      `${image}:${sha}`,
      'npm',
      'run',
      'queue:migrate',
      '--workspace',
      '@musefold/generation-worker',
    ],
    { env },
  );

  dockerRun(
    exec,
    [...composeArgs(composeDir, composeFile, remoteComposeFile, envFile), 'up', '-d', '--no-deps', '--force-recreate', 'v11-web-api', 'v11-worker'],
    { cwd: composeDir, env },
  );
}

export function rollbackService({ exec, composeDir, composeFile, remoteComposeFile, image, sha, envFile }) {
  const env = { ...process.env, ...loadDotEnv(envFile), MUSEFOLD_IMAGE_TAG: sha };
  dockerRun(
    exec,
    [...composeArgs(composeDir, composeFile, remoteComposeFile, envFile), 'up', '-d', '--no-deps', '--force-recreate', 'v11-web-api', 'v11-worker'],
    { cwd: composeDir, env },
  );
  dockerRun(exec, ['tag', `${image}:${sha}`, `${image}:latest`], { allowFail: true });
}

export function reloadCaddy(exec) {
  const ps = dockerRun(exec, ['ps', '--format', '{{.Names}}'], { allowFail: true });
  const names = String(ps.stdout || '')
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const caddy = names.find((name) => /caddy/i.test(name));
  if (!caddy) return false;
  dockerRun(exec, ['exec', caddy, 'caddy', 'reload', '--config', '/etc/caddy/Caddyfile'], { allowFail: true });
  return true;
}

export async function deploy(options) {
  const {
    sha,
    layers,
    repoRoot = defaultRepoRoot,
    siteRoot = DEFAULTS.siteRoot,
    composeDir = DEFAULTS.composeDir,
    liveCaddy = DEFAULTS.liveCaddy,
    liveCompose = DEFAULTS.liveCompose,
    liveRemoteCompose = DEFAULTS.liveRemoteCompose,
    archiveDir = DEFAULTS.archiveDir,
    image = DEFAULTS.image,
    webUrl = DEFAULTS.webUrl,
    readyUrl = DEFAULTS.readyUrl,
    dockerNetwork = DEFAULTS.dockerNetwork,
    statePath = join(composeDir, '.deploy-state.json'),
    envFile = join(composeDir, '.env.v11'),
    keep = DEFAULTS.keep,
    dryRun = false,
    exec = createExec(),
    fetchImpl = fetch,
    skipBuild = false,
    readyTimeoutMs = 180_000,
    readyIntervalMs = 2000,
    webTimeoutMs = 60_000,
    webIntervalMs = 2000,
  } = options;

  if (!sha) throw new Error('--sha is required');
  const wanted = typeof layers === 'string' ? parseLayers(layers) : layers;
  if (!wanted.content && !wanted.service) {
    return { skipped: true, reason: 'no deployable layers' };
  }

  const state = readDeployState(statePath);
  const plan = {
    sha,
    content: Boolean(wanted.content),
    service: Boolean(wanted.service),
    siteRoot,
    image: `${image}:${sha}`,
  };
  if (dryRun) return { dryRun: true, plan, state };

  publishInfraFile(join(repoRoot, 'infra/v1.1/Caddyfile'), liveCaddy, archiveDir);
  publishInfraFile(join(repoRoot, 'infra/v1.1/remote-compose.yaml'), liveRemoteCompose, archiveDir);
  reloadCaddy(exec);

  if (!skipBuild && (wanted.content || wanted.service)) {
    buildImage({
      exec,
      repoRoot,
      image,
      sha,
      cpus: DEFAULTS.dockerCpus,
      memory: DEFAULTS.dockerMemory,
    });
  }

  let nextState = state;

  if (wanted.service) {
    migrateAndRoll({
      exec,
      composeDir,
      composeFile: liveCompose,
      remoteComposeFile: liveRemoteCompose,
      image,
      sha,
      envFile,
      dockerNetwork,
    });
    const ready = await waitHttp(readyUrl, {
      expectRe: /"status"\s*:\s*"ready"/,
      fetchImpl,
      timeoutMs: readyTimeoutMs,
      intervalMs: readyIntervalMs,
    });
    if (!ready.ok) {
      if (state.service.previous || state.service.current) {
        const rollbackTo = state.service.current;
        rollbackService({
          exec,
          composeDir,
          composeFile: liveCompose,
          remoteComposeFile: liveRemoteCompose,
          image,
          sha: rollbackTo,
          envFile,
        });
      }
      throw new Error(`/health/ready failed: ${ready.last}`);
    }
    dockerRun(exec, ['tag', `${image}:${sha}`, `${image}:latest`]);
    nextState = recordLayer(nextState, 'service', sha);
    writeDeployState(statePath, nextState);
  }

  if (wanted.content) {
    promoteAppDirectory(siteRoot);
    const staging = join(siteRoot, 'releases', `.staging-${sha}`);
    mkdirSync(staging, { recursive: true });
    if (skipBuild) {
      const source = options.webSource;
      if (!source || !existsSync(source)) throw new Error('--web-source is required when --skip-build');
      copyTree(source, staging);
    } else {
      extractWebDist({ exec, image: `${image}:${sha}`, dest: staging });
    }
    materializeRelease(siteRoot, sha, staging);
    rmSync(staging, { recursive: true, force: true });
    const switched = switchRelease(siteRoot, sha);
    pruneReleases(siteRoot, { keep, retain: [sha, switched.previous] });
    const markerUrl = `${webUrl.replace(/\/?$/, '/')}${SHA_MARKER}`;
    const reachable = await waitHttp(markerUrl, {
      expectText: sha,
      fetchImpl,
      timeoutMs: webTimeoutMs,
      intervalMs: webIntervalMs,
    });
    if (!reachable.ok) {
      if (switched.previous) rollbackRelease(siteRoot, switched.previous);
      throw new Error(`web reachability failed: ${reachable.last}`);
    }
    nextState = recordLayer(nextState, 'web', sha);
    writeDeployState(statePath, nextState);
  }

  return { ok: true, sha, state: nextState };
}

async function main(argv) {
  const args = parseArgs(argv);
  const result = await deploy({
    sha: args.sha,
    layers: args.layers,
    repoRoot: args['repo-root'] || defaultRepoRoot,
    siteRoot: args['site-root'] || DEFAULTS.siteRoot,
    composeDir: args['compose-dir'] || DEFAULTS.composeDir,
    liveCaddy: args['live-caddy'] || DEFAULTS.liveCaddy,
    liveCompose: args['live-compose'] || DEFAULTS.liveCompose,
    liveRemoteCompose: args['live-remote-compose'] || DEFAULTS.liveRemoteCompose,
    archiveDir: args['archive-dir'] || DEFAULTS.archiveDir,
    image: args.image || DEFAULTS.image,
    webUrl: args['web-url'] || DEFAULTS.webUrl,
    readyUrl: args['ready-url'] || DEFAULTS.readyUrl,
    statePath: args['state-path'],
    envFile: args['env-file'],
    dryRun: Boolean(args['dry-run']),
    skipBuild: Boolean(args['skip-build']),
    webSource: args['web-source'],
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  });
}
