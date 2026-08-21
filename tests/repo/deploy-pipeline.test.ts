import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../../tooling/aliases.mjs';
import { extractUpSource, lintMigrationSource } from '../../scripts/deploy/expand-contract.mjs';
import { filesMatch, migrationDatabaseUrl, parseDotEnv, workerDatabaseUrl } from '../../scripts/deploy/infra-guard.mjs';
import { deploy, parseLayers, waitHttp } from '../../scripts/deploy/run.mjs';
import { emptyState, recordLayer } from '../../scripts/deploy/state.mjs';
import {
  PRE_SYMLINK_NAME,
  SHA_MARKER,
  currentReleaseName,
  materializeRelease,
  pruneReleases,
  promoteAppDirectory,
  relativeReleaseTarget,
  rollbackRelease,
  shouldSkipName,
  switchRelease,
} from '../../scripts/deploy/web-release.mjs';

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'mf-deploy-'));
}

function writeTree(root, files) {
  for (const [rel, body] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
  }
}

describe('web release layout', () => {
  it('uses a relative releases/<sha> target', () => {
    expect(relativeReleaseTarget('ABCDEF1')).toBe('releases/abcdef1');
  });

  it('skips macOS AppleDouble and junk files', () => {
    expect(shouldSkipName('._index.html')).toBe(true);
    expect(shouldSkipName('.DS_Store')).toBe(true);
    expect(shouldSkipName('index.html')).toBe(false);
  });

  it('promotes a real app directory, then atomically switches a relative symlink', () => {
    const site = tempDir();
    writeTree(join(site, 'app'), { 'index.html': 'old', '._index.html': 'junk' });
    const promoted = promoteAppDirectory(site);
    expect(promoted.promoted).toBe(true);
    expect(readlinkSync(join(site, 'app'))).toBe(`releases/${PRE_SYMLINK_NAME}`);
    expect(readFileSync(join(site, 'app', 'index.html'), 'utf8')).toBe('old');

    const src = tempDir();
    writeTree(src, { 'index.html': 'new', '._styles.css': 'nope', '.DS_Store': 'nope' });
    materializeRelease(site, 'abc1234', src);
    expect(readFileSync(join(site, 'releases', 'abc1234', SHA_MARKER), 'utf8')).toBe('abc1234\n');
    expect(() => readFileSync(join(site, 'releases', 'abc1234', '._styles.css'))).toThrow();

    const switched = switchRelease(site, 'abc1234');
    expect(switched.previous).toBe(PRE_SYMLINK_NAME);
    expect(currentReleaseName(site)).toBe('abc1234');
    expect(readlinkSync(join(site, 'app'))).toBe('releases/abc1234');
    expect(readFileSync(join(site, 'app', 'index.html'), 'utf8')).toBe('new');
  });

  it('keeps five newest releases plus the retain list, and rolls back by retargeting', () => {
    const site = tempDir();
    mkdirSync(join(site, 'releases'), { recursive: true });
    const shas = ['1111111', '2222222', '3333333', '4444444', '5555555', '6666666', '7777777'];
    for (const sha of shas) {
      const src = tempDir();
      writeTree(src, { 'index.html': sha });
      materializeRelease(site, sha, src);
      switchRelease(site, sha);
    }
    pruneReleases(site, { keep: 5, retain: ['7777777', '6666666'] });
    expect(currentReleaseName(site)).toBe('7777777');
    const rolled = rollbackRelease(site, '6666666');
    expect(rolled.current).toBe('6666666');
    expect(readFileSync(join(site, 'app', 'index.html'), 'utf8')).toBe('6666666');
  });

  it('rejects an empty dist', () => {
    const site = tempDir();
    const src = tempDir();
    writeTree(src, { 'readme.txt': 'nope' });
    expect(() => materializeRelease(site, 'abc1234', src)).toThrow(/index.html/);
  });
});

describe('expand/contract lint', () => {
  it('inspects only exports.up', () => {
    const source = `
exports.up = (pgm) => { pgm.sql('ALTER TABLE t ADD COLUMN x int'); };
exports.down = (pgm) => { pgm.sql('ALTER TABLE t DROP COLUMN x; UPDATE t SET y = 1'); };
`;
    expect(lintMigrationSource(source).ok).toBe(true);
    expect(extractUpSource(source)).not.toMatch(/DROP COLUMN x/);
  });

  it('rejects an up() that writes rows and drops a column', () => {
    const source = `
exports.up = (pgm) => {
  pgm.sql('UPDATE t SET x = 1; ALTER TABLE t DROP COLUMN y');
};
`;
    expect(lintMigrationSource(source, '000099.cjs').ok).toBe(false);
  });
});

describe('infra helpers', () => {
  it('parses dotenv and prefers the migration URL', () => {
    const env = parseDotEnv('DATABASE_URL=app\nMIGRATION_DATABASE_URL=migrate\n# comment\n');
    expect(migrationDatabaseUrl(env)).toBe('migrate');
  });

  it('builds role URLs from the production password keys', () => {
    const env = parseDotEnv('MIGRATION_DB_PASSWORD=mig\nWORKER_DB_PASSWORD=wrk\n');
    expect(migrationDatabaseUrl(env)).toContain('musefold_migration:mig@db');
    expect(workerDatabaseUrl(env)).toContain('musefold_worker:wrk@db');
  });

  it('compares files ignoring CR LF', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'a'), 'hello\r\nworld\n');
    writeFileSync(join(dir, 'b'), 'hello\nworld\n');
    expect(filesMatch(join(dir, 'a'), join(dir, 'b'))).toBe(true);
  });
});

describe('deploy orchestration', () => {
  it('parses layer flags', () => {
    expect(parseLayers('content')).toEqual({ content: true, service: false });
    expect(parseLayers('service,content')).toEqual({ content: true, service: true });
  });

  it('records previous sha per layer', () => {
    const next = recordLayer(emptyState(), 'web', 'aaa1111');
    const again = recordLayer(next, 'web', 'bbb2222');
    expect(again.web).toEqual({ current: 'bbb2222', previous: 'aaa1111' });
  });

  it('skips when no layers are requested', async () => {
    const result = await deploy({ sha: 'abc1234', layers: { content: false, service: false }, dryRun: true });
    expect(result.skipped).toBe(true);
  });

  it('deploys content from a local dist, verifies the marker, and rolls back on fetch failure', async () => {
    const site = tempDir();
    const composeDir = tempDir();
    const repo = tempDir();
    mkdirSync(join(repo, 'infra/v1.1'), { recursive: true });
    writeFileSync(join(repo, 'infra/v1.1/Caddyfile'), 'caddy\n');
    writeFileSync(join(repo, 'infra/v1.1/remote-compose.yaml'), 'compose\n');
    const src = tempDir();
    writeTree(src, { 'index.html': 'ok' });
    const liveCaddy = join(composeDir, 'Caddyfile');
    const liveCompose = join(composeDir, 'docker-compose.yml');
    const liveRemoteCompose = join(composeDir, 'remote-compose.yaml');
    writeFileSync(liveCompose, 'HOST STACK\n');

    const calls = [];
    const exec = (command, args) => {
      calls.push([command, ...args]);
      return { status: 0, stdout: '', stderr: '' };
    };

    const okFetch = async (url) => ({
      ok: true,
      status: 200,
      text: async () => (String(url).includes(SHA_MARKER) ? 'abc1234def' : ''),
    });

    const result = await deploy({
      sha: 'abc1234def',
      layers: { content: true, service: false },
      repoRoot: repo,
      siteRoot: site,
      composeDir,
      liveCaddy,
      liveCompose,
      liveRemoteCompose,
      archiveDir: join(composeDir, 'archive'),
      statePath: join(composeDir, '.deploy-state.json'),
      skipBuild: true,
      webSource: src,
      exec,
      fetchImpl: okFetch,
      webUrl: 'https://example.test/Musefold/app/',
    });
    expect(result.ok).toBe(true);
    expect(currentReleaseName(site)).toBe('abc1234def');
    expect(readFileSync(liveCaddy, 'utf8')).toBe('caddy\n');
    expect(readFileSync(liveCompose, 'utf8')).toBe('HOST STACK\n');
    expect(readFileSync(liveRemoteCompose, 'utf8')).toBe('compose\n');
    expect(calls.some((row) => row[0] === 'docker' && row[1] === 'build')).toBe(false);

    const src2 = tempDir();
    writeTree(src2, { 'index.html': 'bad' });
    await expect(
      deploy({
        sha: 'bbb2222ccc',
        layers: { content: true, service: false },
        repoRoot: repo,
        siteRoot: site,
        composeDir,
        liveCaddy,
        liveCompose,
        liveRemoteCompose,
        archiveDir: join(composeDir, 'archive'),
        statePath: join(composeDir, '.deploy-state.json'),
        skipBuild: true,
        webSource: src2,
        exec,
        fetchImpl: async () => ({ ok: false, status: 500, text: async () => 'nope' }),
        webUrl: 'https://example.test/Musefold/app/',
        webTimeoutMs: 20,
        webIntervalMs: 5,
      }),
    ).rejects.toThrow(/web reachability/);
    expect(currentReleaseName(site)).toBe('abc1234def');
  });

  it('waits until an HTTP body contains the expected text', async () => {
    let n = 0;
    const result = await waitHttp('https://example.test/health/ready', {
      intervalMs: 1,
      timeoutMs: 200,
      expectText: '"status":"ready"',
      fetchImpl: async () => {
        n += 1;
        if (n < 3) return { ok: false, status: 502, text: async () => 'bad' };
        return { ok: true, status: 200, text: async () => '{"status":"ready"}' };
      },
    });
    expect(result.ok).toBe(true);
    expect(n).toBe(3);
  });

  it('migrates before compose up and restores the previous image tag if ready fails', async () => {
    const composeDir = tempDir();
    const repo = tempDir();
    mkdirSync(join(repo, 'infra/v1.1'), { recursive: true });
    writeFileSync(join(repo, 'infra/v1.1/Caddyfile'), 'caddy\n');
    writeFileSync(join(repo, 'infra/v1.1/remote-compose.yaml'), 'compose\n');
    writeFileSync(join(composeDir, '.env.v11'), 'DATABASE_URL=postgres://musefold_migration:x@db:5432/musefold\n');
    writeFileSync(join(composeDir, 'docker-compose.yml'), 'HOST STACK\n');
    writeFileSync(join(composeDir, '.deploy-state.json'), JSON.stringify({
      web: { current: null, previous: null },
      service: { current: 'deadbee', previous: null },
    }));
    const commands = [];
    const exec = (command, args, options = {}) => {
      commands.push({ command, args, imageTag: options.env?.MUSEFOLD_IMAGE_TAG });
      return { status: 0, stdout: command === 'docker' && args[0] === 'ps' ? 'caddy\n' : '', stderr: '' };
    };
    await expect(
      deploy({
        sha: 'c0ffeee',
        layers: { content: false, service: true },
        repoRoot: repo,
        composeDir,
        liveCaddy: join(composeDir, 'Caddyfile'),
        liveCompose: join(composeDir, 'docker-compose.yml'),
        liveRemoteCompose: join(composeDir, 'remote-compose.yaml'),
        archiveDir: join(composeDir, 'archive'),
        statePath: join(composeDir, '.deploy-state.json'),
        envFile: join(composeDir, '.env.v11'),
        skipBuild: true,
        exec,
        fetchImpl: async () => ({ ok: false, status: 503, text: async () => '{"status":"unavailable"}' }),
        readyUrl: 'https://example.test/health/ready',
        readyTimeoutMs: 20,
        readyIntervalMs: 5,
      }),
    ).rejects.toThrow(/health\/ready/);
    const migrateAt = commands.findIndex((row) => row.args?.includes('db:migrate'));
    const upAt = commands.findIndex((row) => row.args?.includes('--force-recreate') || row.args?.includes('force-recreate'));
    const rollbackAt = commands.findLastIndex(
      (row) => row.args?.includes('--force-recreate') && row.imageTag === 'deadbee',
    );
    expect(migrateAt).toBeGreaterThan(-1);
    expect(upAt).toBeGreaterThan(migrateAt);
    expect(rollbackAt).toBeGreaterThan(upAt);
    expect(readFileSync(join(composeDir, 'docker-compose.yml'), 'utf8')).toBe('HOST STACK\n');
    const up = commands.find((row) => row.args?.includes('--force-recreate'));
    expect(up.args).toContain(join(composeDir, 'docker-compose.yml'));
    expect(up.args).toContain(join(composeDir, 'remote-compose.yaml'));
  });
});

describe('layer detection', () => {
  it('keeps detect-layers self-test green', () => {
    const result = spawnSync(process.execPath, ['.github/scripts/detect-layers.mjs', '--self-test'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || 'detect-layers self-test failed');
    }
    expect(result.stdout).toContain('infra/v1.1 Dockerfile is infra');
  });
});
