import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// tests/v25/playwright.config.ts 固定的 E2E 端口;禁止复用任何既有服务(R01.3)。
const WEB_E2E_PORT = 3399;

/** Prepare the actual Next standalone artifact, including assets omitted by tracing. */
export function prepareStandaloneWeb(repoRoot) {
  const webRoot = resolve(repoRoot, 'apps/web-next');
  const buildRoot = resolve(webRoot, '.next');
  const runtimeRoot = resolve(buildRoot, 'standalone/apps/web-next');
  const server = resolve(runtimeRoot, 'server.js');
  const buildId = resolve(buildRoot, 'BUILD_ID');
  const runtimeBuildId = resolve(runtimeRoot, '.next/BUILD_ID');
  const staticSource = resolve(buildRoot, 'static');
  for (const file of [server, buildId, runtimeBuildId, staticSource]) {
    if (!existsSync(file)) {
      throw new Error('Missing standalone production build; run pnpm run build:web first.');
    }
  }
  if (readFileSync(buildId, 'utf8') !== readFileSync(runtimeBuildId, 'utf8')) {
    throw new Error('Standalone build is stale; run pnpm run build:web again.');
  }
  // Replace only generated copies so a removed source asset cannot survive another run.
  for (const [source, destination] of [
    [staticSource, resolve(runtimeRoot, '.next/static')],
    [resolve(webRoot, 'public'), resolve(runtimeRoot, 'public')],
  ]) {
    rmSync(destination, { recursive: true, force: true });
    if (existsSync(source)) cpSync(source, destination, { recursive: true });
  }
  return server;
}

/** Describe the processes currently holding `port` (best effort via lsof/ps). */
function describePortOwners(port) {
  try {
    return execFileSync('lsof', ['-ti', `:${port}`], { encoding: 'utf8' })
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((pid) => {
        try {
          const command = execFileSync('ps', ['-o', 'command=', '-p', pid], {
            encoding: 'utf8',
          }).trim();
          return `pid ${pid} (${command})`;
        } catch {
          // The process may exit between lsof and ps; the pid alone still identifies it.
          return `pid ${pid}`;
        }
      });
  } catch {
    // lsof unavailable (e.g. non-POSIX hosts): report an unidentified owner.
    return [];
  }
}

/**
 * Refuse to share the fixed E2E port with any process this runner did not spawn
 * (R01.3): fail before starting the standalone server, naming the owning pid and
 * command. Cleanup semantics stay unchanged — this runner only ever terminates
 * processes it started itself, never the owner reported here.
 */
export async function assertPortAvailable(port, hostname = '127.0.0.1') {
  await new Promise((resolvePromise, rejectPromise) => {
    const probe = createServer();
    probe.once('error', rejectPromise);
    probe.listen(port, hostname, () => probe.close(() => resolvePromise()));
  }).catch((error) => {
    if (error?.code !== 'EADDRINUSE') throw error;
    const owners = describePortOwners(port);
    const ownerText =
      owners.length > 0 ? owners.join('; ') : 'an unidentified process (lsof found no owner)';
    throw new Error(
      `Port ${port} is already in use by ${ownerText}. ` +
        'The v25 web E2E port is fixed and must not reuse an existing dev server; ' +
        'stop that process (pnpm run dev:stop stops known dev processes) and rerun. ' +
        'This runner only terminates processes it spawned itself.',
    );
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = prepareStandaloneWeb(resolve(import.meta.dirname, '..'));
  try {
    await assertPortAvailable(WEB_E2E_PORT);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
  // This runner is for local/CI E2E; production deployment owns its own bind address.
  process.env.HOSTNAME = '127.0.0.1';
  process.env.PORT = String(WEB_E2E_PORT);
  await import(pathToFileURL(server).href);
}
