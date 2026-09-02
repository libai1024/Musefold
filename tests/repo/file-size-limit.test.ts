import { type Dirent, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../../tooling/aliases.mjs';

/**
 * v2.5 文件尺寸门禁:单个生产源码文件不得超过 3000 行。
 * 替代 v1.3 的 600 行棘轮(baseline 机制随 v2.5 废除)。
 */

const LIMIT = 3000;

const SCAN_ROOTS = [
  'apps/desktop/src',
  'apps/desktop/electron',
  'apps/web-next/src',
  'apps/api/src',
  'apps/worker/src',
] as const;

function isProductionSource(relPath: string): boolean {
  if (!relPath.endsWith('.ts') && !relPath.endsWith('.tsx')) return false;
  if (relPath.endsWith('.d.ts')) return false;
  if (relPath.includes('__tests__/')) return false;
  if (/\.(test|spec)\.[jt]sx?$/.test(relPath)) return false;
  return true;
}

function collectPackageSrcRoots(): string[] {
  const packagesDir = join(REPO_ROOT, 'packages');
  return readdirSync(packagesDir)
    .filter((name) => statSync(join(packagesDir, name)).isDirectory())
    .map((name) => `packages/${name}/src`);
}

function* walk(dir: string): Generator<string> {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'out') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

function countLines(absPath: string): number {
  const lines = readFileSync(absPath, 'utf8').split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.length;
}

describe('v2.5 文件尺寸门禁', () => {
  it(`生产源码单文件不超过 ${LIMIT} 行`, () => {
    const roots = [...SCAN_ROOTS, ...collectPackageSrcRoots()];
    const violations: string[] = [];
    for (const root of roots) {
      for (const abs of walk(join(REPO_ROOT, root))) {
        const rel = relative(REPO_ROOT, abs);
        if (!isProductionSource(rel)) continue;
        const lines = countLines(abs);
        if (lines > LIMIT) {
          violations.push(`${rel}:${lines} 行 > ${LIMIT},必须拆分`);
        }
      }
    }
    expect(violations.join('\n'), '超限文件').toBe('');
  });
});
