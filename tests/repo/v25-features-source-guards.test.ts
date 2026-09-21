import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../../tooling/aliases.mjs';

function walkProductionFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === '__tests__' || name === 'node_modules') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(...walkProductionFiles(path));
      continue;
    }
    if (path.endsWith('.tsx') || path.endsWith('.ts')) out.push(path);
  }
  return out;
}

describe('v25 features 源码守卫', () => {
  it('WindowControls 不引用 electron / 宿主桥', () => {
    const source = readFileSync(
      join(REPO_ROOT, 'packages/features/src/shell/WindowControls.tsx'),
      'utf8',
    );
    expect(source).not.toMatch(/from ['"]electron['"]|import\(['"]electron['"]\)/);
    expect(source).not.toMatch(/musefold:invoke/);
    expect(source).not.toMatch(/^\s*import .*musefoldV25/m);
  });

  it('AppShell 以 delayDuration=300 包裹整壳', () => {
    const source = readFileSync(
      join(REPO_ROOT, 'packages/features/src/shell/AppShell.tsx'),
      'utf8',
    );
    expect(source).toMatch(/<TooltipProvider delayDuration=\{300\}>/);
    expect(source).toMatch(/<\/TooltipProvider>/);
  });

  it('features 生产源码除 AppShell 外不得出现 TooltipProvider', () => {
    const featuresSrc = join(REPO_ROOT, 'packages/features/src');
    const nested = walkProductionFiles(featuresSrc).filter((file) => {
      if (file.endsWith(join('shell', 'AppShell.tsx'))) return false;
      return readFileSync(file, 'utf8').includes('TooltipProvider');
    });
    expect(nested.map((file) => relative(REPO_ROOT, file))).toEqual([]);
  });
});
