#!/usr/bin/env node
/**
 * Copy the marketing homepage onto the production site root.
 * Never touch `app/` (SPA releases), installer binaries, or live catalog.json
 * once a desktop publish has created it.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MARKETING_FILES = ['index.html', 'script.js', 'styles.css'];
const MARKETING_DIRS = ['assets', 'skills'];

function copyDir(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (entry.name === '.DS_Store' || entry.name.startsWith('._')) continue;
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else if (entry.isFile()) cpSync(from, to);
  }
}

export function publishMarketingSite(repoRoot, siteRoot) {
  const src = join(repoRoot, 'website/Musefold');
  if (!existsSync(src)) {
    throw new Error(`marketing site missing: ${src}`);
  }
  mkdirSync(siteRoot, { recursive: true });
  const copied = [];
  for (const name of MARKETING_FILES) {
    const from = join(src, name);
    if (!existsSync(from)) continue;
    cpSync(from, join(siteRoot, name));
    copied.push(name);
  }
  for (const name of MARKETING_DIRS) {
    const from = join(src, name);
    if (!existsSync(from) || !statSync(from).isDirectory()) continue;
    copyDir(from, join(siteRoot, name));
    copied.push(`${name}/`);
  }
  const liveCatalog = join(siteRoot, 'downloads', 'catalog.json');
  const gitCatalog = join(src, 'downloads', 'catalog.json');
  if (existsSync(gitCatalog)) {
    mkdirSync(join(siteRoot, 'downloads'), { recursive: true });
    if (!existsSync(liveCatalog)) {
      cpSync(gitCatalog, liveCatalog);
      copied.push('downloads/catalog.json');
    } else {
      const live = JSON.parse(readFileSync(liveCatalog, 'utf8'));
      const hasLatest = Array.isArray(live.downloads) && live.downloads.some((entry) => entry?.version === 'latest');
      if (!hasLatest) {
        cpSync(gitCatalog, liveCatalog);
        copied.push('downloads/catalog.json');
      }
    }
  }
  return { copied };
}

export function findDownloadContainer(exec) {
  const ps = exec('docker', ['ps', '--format', '{{.Names}}'], { allowFail: true });
  const names = String(ps.stdout || '')
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return names.find((name) => /download/i.test(name)) || null;
}

export function syncDownloadService({ exec, repoRoot, siteRoot, skipDocker = false }) {
  const serverPath = join(repoRoot, 'services/musefold-downloads/server.py');
  const liveCatalog = join(siteRoot, 'downloads', 'catalog.json');
  if (skipDocker) return { synced: false, reason: 'skip-docker' };
  const container = findDownloadContainer(exec);
  if (!container) return { synced: false, reason: 'no-container' };
  if (existsSync(serverPath)) {
    exec('docker', ['cp', serverPath, `${container}:/app/server.py`]);
  }
  if (existsSync(liveCatalog)) {
    exec('docker', ['cp', liveCatalog, `${container}:/app/catalog.json`]);
  }
  exec('docker', ['restart', container], { allowFail: true });
  return { synced: true, container };
}
