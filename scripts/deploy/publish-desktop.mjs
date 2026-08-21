#!/usr/bin/env node
/**
 * Publish macOS + Windows installers onto the production site.
 * Called from the tag-triggered package-smoke workflow on musefold-prod.
 * Does not overwrite docker-compose.yml (host stack).
 */
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = resolve(here, '../..');
const PUBLIC_ORIGIN = 'https://zhaozhaoyue.top';

export function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
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

export function assertTagMatchesVersion(tag, version) {
  const normalized = String(tag || '').replace(/^refs\/tags\//, '');
  const expected = `v${version}`;
  if (normalized !== expected) {
    throw new Error(`tag ${JSON.stringify(normalized)} does not match apps/desktop version ${JSON.stringify(expected)}`);
  }
  return version;
}

export function findNamed(dir, matcher, label) {
  if (!existsSync(dir)) {
    throw new Error(`${label}: directory missing ${dir}`);
  }
  const names = readdirSync(dir);
  const hit = names.find((name) => matcher(name));
  if (!hit) {
    throw new Error(`${label} not found in ${dir}: ${names.join(', ') || '(empty)'}`);
  }
  return join(dir, hit);
}

export function sha256File(path) {
  const hash = createHash('sha256');
  hash.update(readFileSync(path));
  return hash.digest('hex');
}

export function encodeDownloadPath(version, fileName) {
  return `/Musefold/downloads/${version}/${encodeURIComponent(fileName)}`;
}

export function publicDownloadUrl(version, fileName) {
  return `${PUBLIC_ORIGIN}${encodeDownloadPath(version, fileName)}`;
}

export function mergeCatalog(existing, version, files) {
  const previous = existing && typeof existing === 'object' ? existing : {};
  const downloads = Array.isArray(previous.downloads) ? previous.downloads.filter(Boolean) : [];
  const nextEntries = [
    { platform: 'macos', version: 'latest', path: encodeDownloadPath(version, files.dmgName) },
    { platform: 'windows', version: 'latest', path: encodeDownloadPath(version, files.exeName) },
    { platform: 'macos', version, path: encodeDownloadPath(version, files.dmgName) },
    { platform: 'windows', version, path: encodeDownloadPath(version, files.exeName) },
  ];
  const kept = downloads.filter((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    if (entry.version === 'latest') return false;
    if (entry.version === version && (entry.platform === 'macos' || entry.platform === 'windows')) return false;
    return true;
  });
  return {
    currentVersion: version,
    downloads: [...nextEntries, ...kept],
  };
}

export function rewriteGenericLatestYml(text, version, fileName) {
  const url = publicDownloadUrl(version, fileName);
  let body = String(text || '');
  body = body.replace(/^path:.*$/m, `path: ${fileName}`);
  body = body.replace(/url: .+$/gm, `url: ${url}`);
  return body;
}

export function selectArtifacts({ macDir, winDir, version }) {
  const dmg = findNamed(macDir, (name) => name === `Musefold-${version}-arm64.dmg` || name.endsWith('.dmg'), 'macOS DMG');
  const zip = existsSync(macDir)
    ? readdirSync(macDir)
        .map((name) => join(macDir, name))
        .find((path) => /\.zip$/.test(path) && !/\.blockmap$/.test(path))
    : undefined;
  const macYml = existsSync(join(macDir, 'latest-mac.yml'))
    ? join(macDir, 'latest-mac.yml')
    : readdirSync(macDir).find((name) => name.endsWith('latest-mac.yml'))
      ? join(macDir, readdirSync(macDir).find((name) => name.endsWith('latest-mac.yml')))
      : null;
  const exe = findNamed(
    winDir,
    (name) => name === `Musefold Setup ${version}.exe` || (/Setup/i.test(name) && name.endsWith('.exe')),
    'Windows NSIS',
  );
  const winYml = existsSync(join(winDir, 'latest.yml')) ? join(winDir, 'latest.yml') : null;
  return {
    dmg,
    zip,
    macYml,
    exe,
    winYml,
    dmgName: basename(dmg),
    exeName: basename(exe),
  };
}

function createExec(runner = spawnSync) {
  return function exec(command, args, options = {}) {
    const result = runner(command, args, {
      encoding: 'utf8',
      stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
    });
    if (result.status !== 0 && !options.allowFail) {
      throw new Error((result.stderr || result.stdout || `${command} ${args.join(' ')}`).trim());
    }
    return result;
  };
}

export function findDownloadContainer(exec) {
  const ps = exec('docker', ['ps', '--format', '{{.Names}}'], { allowFail: true });
  const names = String(ps.stdout || '')
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return names.find((name) => /download/i.test(name)) || null;
}

export function syncDownloadCatalog(exec, liveCatalogPath, { skipDocker = false } = {}) {
  if (skipDocker) return { container: null };
  const container = findDownloadContainer(exec);
  if (!container) return { container: null };
  exec('docker', ['cp', liveCatalogPath, `${container}:/app/catalog.json`]);
  return { container };
}

export function publishDesktop(options) {
  const {
    version,
    macDir,
    winDir,
    siteRoot,
    repoRoot = defaultRepoRoot,
    skipDocker = false,
    exec = createExec(),
  } = options;
  if (!version) throw new Error('--version is required');
  const artifacts = selectArtifacts({ macDir, winDir, version });
  const dest = join(siteRoot, 'downloads', version);
  mkdirSync(dest, { recursive: true });
  copyFileSync(artifacts.dmg, join(dest, artifacts.dmgName));
  copyFileSync(artifacts.exe, join(dest, artifacts.exeName));
  if (artifacts.zip) copyFileSync(artifacts.zip, join(dest, basename(artifacts.zip)));

  const sums = [
    `${sha256File(join(dest, artifacts.dmgName))}  ${artifacts.dmgName}`,
    `${sha256File(join(dest, artifacts.exeName))}  ${artifacts.exeName}`,
  ];
  if (artifacts.zip) {
    sums.push(`${sha256File(join(dest, basename(artifacts.zip)))}  ${basename(artifacts.zip)}`);
  }
  writeFileSync(join(dest, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`);

  const liveCatalogPath = join(siteRoot, 'downloads', 'catalog.json');
  mkdirSync(join(siteRoot, 'downloads'), { recursive: true });
  let existing = {};
  const gitCatalog = join(repoRoot, 'services/musefold-downloads/catalog.json');
  const catalogSource = existsSync(liveCatalogPath) ? liveCatalogPath : gitCatalog;
  if (existsSync(catalogSource)) {
    existing = JSON.parse(readFileSync(catalogSource, 'utf8'));
  }
  const nextCatalog = mergeCatalog(existing, version, {
    dmgName: artifacts.dmgName,
    exeName: artifacts.exeName,
  });
  writeFileSync(liveCatalogPath, `${JSON.stringify(nextCatalog, null, 2)}\n`);

  const devFeed = join(siteRoot, 'updates', 'dev');
  mkdirSync(devFeed, { recursive: true });
  if (artifacts.winYml) {
    writeFileSync(
      join(devFeed, 'latest.yml'),
      rewriteGenericLatestYml(readFileSync(artifacts.winYml, 'utf8'), version, artifacts.exeName),
    );
  }
  if (artifacts.macYml) {
    writeFileSync(
      join(devFeed, 'latest-mac.yml'),
      rewriteGenericLatestYml(readFileSync(artifacts.macYml, 'utf8'), version, artifacts.zip ? basename(artifacts.zip) : artifacts.dmgName),
    );
  }

  const docker = syncDownloadCatalog(exec, liveCatalogPath, { skipDocker });
  return {
    ok: true,
    version,
    dest,
    currentVersion: version,
    catalogPath: liveCatalogPath,
    container: docker.container,
    files: [artifacts.dmgName, artifacts.exeName],
  };
}

async function main(argv) {
  const args = parseArgs(argv);
  const repoRoot = args['repo-root'] || defaultRepoRoot;
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'apps/desktop/package.json'), 'utf8'));
  const version = String(args.version || pkg.version);
  if (args.tag) assertTagMatchesVersion(args.tag, version);
  const result = publishDesktop({
    version,
    macDir: args['mac-dir'],
    winDir: args['win-dir'],
    siteRoot: args['site-root'] || '/opt/musefold/site/Musefold',
    repoRoot,
    skipDocker: Boolean(args['skip-docker']),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  });
}
