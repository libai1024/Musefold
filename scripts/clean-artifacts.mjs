#!/usr/bin/env node
import { lstat, readdir, rm } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const includeBuild = args.has('--build');
const help = args.has('--help') || args.has('-h');

if (help) {
  console.log(`Usage: npm run clean:artifacts -- [--dry-run] [--build]

Removes generated local test/development artifacts while keeping tracked
source and fixture assets intact.

Options:
  --dry-run  List artifacts without removing them.
  --build    Also remove desktop/Web build and release outputs.`);
  process.exit(0);
}

const staticArtifacts = [
  '.electron-driver',
  '.pytest_cache',
  'test-results',
  'tsconfig.node.tsbuildinfo',
  'tsconfig.web.tsbuildinfo',
  '.tsout',
];

if (includeBuild) {
  staticArtifacts.push('out', 'apps/desktop/out', 'release', 'apps/web/dist');
}

function safeTarget(relPath) {
  const absPath = resolve(repoRoot, relPath);
  const normalized = relative(repoRoot, absPath);
  if (!normalized || normalized.startsWith('..') || isAbsolute(normalized)) {
    throw new Error(`Refusing to remove unsafe path: ${relPath}`);
  }
  return { relPath: normalized, absPath };
}

async function collectNamedDirs(dirName) {
  const found = [];

  async function walk(absDir) {
    let entries;
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch (error) {
      if (error && error.code === 'ENOENT') return;
      throw error;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === 'node_modules' || entry.name === '.venv-test') continue;

      const absChild = resolve(absDir, entry.name);
      const relChild = relative(repoRoot, absChild).replaceAll('\\', '/');
      if (!relChild || relChild.startsWith('..') || isAbsolute(relChild)) continue;
      if (entry.name === dirName) {
        found.push(relChild);
        continue;
      }
      await walk(absChild);
    }
  }

  await walk(repoRoot);
  return found;
}

async function collectPycacheDirs(baseRel) {
  const base = safeTarget(baseRel);
  const found = [];

  async function walk(absDir) {
    let entries;
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch (error) {
      if (error && error.code === 'ENOENT') return;
      throw error;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === 'node_modules' || entry.name === '.venv-test') continue;

      const absChild = resolve(absDir, entry.name);
      const relChild = relative(repoRoot, absChild);
      if (entry.name === '__pycache__') {
        found.push(relChild);
        continue;
      }
      await walk(absChild);
    }
  }

  await walk(base.absPath);
  return found;
}

async function collectExistingStaticArtifacts() {
  const found = [];
  for (const item of staticArtifacts) {
    const target = safeTarget(item);
    try {
      await lstat(target.absPath);
      found.push(target.relPath);
    } catch (error) {
      if (error && error.code === 'ENOENT') continue;
      throw error;
    }
  }
  return found;
}

const candidates = [
  ...(await collectExistingStaticArtifacts()),
  ...(await collectPycacheDirs('tests')),
  ...(await collectNamedDirs('.tsout')),
];

const targets = [...new Map(candidates.map((item) => {
  const target = safeTarget(item);
  return [target.relPath, target];
})).values()].sort((a, b) => a.relPath.localeCompare(b.relPath));

let removed = 0;
for (const target of targets) {
  if (dryRun) {
    console.log(`[dry-run] ${target.relPath}`);
    continue;
  }
  await rm(target.absPath, { force: true, recursive: true });
  console.log(`removed ${target.relPath}`);
  removed += 1;
}

if (dryRun) {
  console.log(`Found ${targets.length} artifact path(s).`);
} else if (removed === 0) {
  console.log('No generated artifacts found.');
} else {
  console.log(`Removed ${removed} artifact path(s).`);
}
