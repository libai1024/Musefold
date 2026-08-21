#!/usr/bin/env node
/**
 * Web SPA release layout: relative symlink `app -> releases/<sha>`.
 * Absolute links 404 inside the Caddy bind-mount (`/srv/musefold-site`).
 */
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, relative } from 'node:path';

export const DEFAULT_KEEP = 5;
export const PRE_SYMLINK_NAME = 'pre-symlink';
export const SHA_MARKER = 'release-sha.txt';

const SHA_RE = /^[0-9a-f]{7,40}$/i;

export function normalizeSha(sha) {
  const value = String(sha || '')
    .trim()
    .toLowerCase();
  if (!SHA_RE.test(value)) {
    throw new Error(`invalid git sha: ${JSON.stringify(sha)}`);
  }
  return value;
}

export function relativeReleaseTarget(sha) {
  if (sha === PRE_SYMLINK_NAME) return `releases/${PRE_SYMLINK_NAME}`;
  return `releases/${normalizeSha(sha)}`;
}

export function shouldSkipName(name) {
  return name === '.DS_Store' || name === 'Thumbs.db' || name.startsWith('._');
}

export function copyTree(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (shouldSkipName(entry.name)) continue;
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else if (entry.isFile()) cpSync(from, to);
  }
}

export function readAppLink(siteRoot) {
  const appPath = join(siteRoot, 'app');
  if (!existsSync(appPath)) return { kind: 'missing' };
  const st = lstatSync(appPath);
  if (st.isSymbolicLink()) {
    return { kind: 'symlink', target: readlinkSync(appPath) };
  }
  if (st.isDirectory()) return { kind: 'directory' };
  return { kind: 'other' };
}

export function currentReleaseName(siteRoot) {
  const link = readAppLink(siteRoot);
  if (link.kind !== 'symlink') return null;
  const target = link.target.replace(/\/+$/, '');
  if (target.startsWith('/')) {
    const rel = relative(siteRoot, target);
    if (!rel || rel.startsWith('..')) return null;
    return basename(rel);
  }
  if (!target.startsWith('releases/') || target.includes('..')) return null;
  return basename(target);
}

function replaceAppSymlink(siteRoot, relativeTarget) {
  if (relativeTarget.startsWith('/') || relativeTarget.includes('..')) {
    throw new Error(`symlink target must be a relative releases/ path: ${relativeTarget}`);
  }
  const appPath = join(siteRoot, 'app');
  const tmp = join(siteRoot, `.app-new-${process.pid}-${Date.now()}`);
  rmSync(tmp, { force: true });
  symlinkSync(relativeTarget, tmp);
  renameSync(tmp, appPath);
}

/**
 * If `app` is still a real directory (rsync-era layout), move it under
 * `releases/pre-symlink` and point `app` at that directory with a relative link.
 */
export function promoteAppDirectory(siteRoot) {
  mkdirSync(join(siteRoot, 'releases'), { recursive: true });
  const link = readAppLink(siteRoot);
  if (link.kind === 'missing') return { promoted: false };
  if (link.kind === 'directory') {
    const dest = join(siteRoot, 'releases', PRE_SYMLINK_NAME);
    if (existsSync(dest)) {
      throw new Error(`${dest} already exists; resolve by hand before promoting app/`);
    }
    renameSync(join(siteRoot, 'app'), dest);
    replaceAppSymlink(siteRoot, relativeReleaseTarget(PRE_SYMLINK_NAME));
    return { promoted: true, current: PRE_SYMLINK_NAME };
  }
  if (link.kind === 'symlink' && link.target.startsWith('/')) {
    const rel = relative(siteRoot, link.target);
    if (!rel.startsWith('releases/') || rel.includes('..')) {
      throw new Error(`absolute app symlink escapes site root: ${link.target}`);
    }
    replaceAppSymlink(siteRoot, rel);
    return { promoted: false, rewritten: rel };
  }
  return { promoted: false };
}

export function materializeRelease(siteRoot, sha, sourceDir) {
  const id = normalizeSha(sha);
  const dest = join(siteRoot, 'releases', id);
  mkdirSync(join(siteRoot, 'releases'), { recursive: true });
  rmSync(dest, { recursive: true, force: true });
  copyTree(sourceDir, dest);
  if (!existsSync(join(dest, 'index.html'))) {
    throw new Error(`web dist missing index.html in ${dest}`);
  }
  writeFileSync(join(dest, SHA_MARKER), `${id}\n`);
  return dest;
}

export function switchRelease(siteRoot, sha) {
  const id = normalizeSha(sha);
  const dest = join(siteRoot, 'releases', id);
  if (!existsSync(dest)) {
    throw new Error(`release directory missing: ${dest}`);
  }
  const previous = currentReleaseName(siteRoot);
  replaceAppSymlink(siteRoot, relativeReleaseTarget(id));
  return { current: id, previous: previous && previous !== id ? previous : null };
}

export function pruneReleases(siteRoot, { keep = DEFAULT_KEEP, retain = [] } = {}) {
  const releases = join(siteRoot, 'releases');
  if (!existsSync(releases)) return [];
  const retainSet = new Set(
    retain.filter(Boolean).map((name) => (name === PRE_SYMLINK_NAME ? name : normalizeSha(name))),
  );
  const entries = readdirSync(releases, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      mtime: statSync(join(releases, entry.name)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  const kept = [];
  const removed = [];
  for (const entry of entries) {
    if (retainSet.has(entry.name) || kept.length < keep) {
      kept.push(entry.name);
      continue;
    }
    rmSync(join(releases, entry.name), { recursive: true, force: true });
    removed.push(entry.name);
  }
  return { kept, removed };
}

export function rollbackRelease(siteRoot, previousSha) {
  if (!previousSha) {
    throw new Error('no previous web release to roll back to');
  }
  const id = previousSha === PRE_SYMLINK_NAME ? previousSha : normalizeSha(previousSha);
  const dest = join(siteRoot, 'releases', id);
  if (!existsSync(dest)) {
    throw new Error(`previous release missing: ${dest}`);
  }
  const from = currentReleaseName(siteRoot);
  replaceAppSymlink(siteRoot, relativeReleaseTarget(id));
  return { current: id, previous: from };
}
