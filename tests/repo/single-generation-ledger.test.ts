import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../../tooling/aliases.mjs';

const SCAN_ROOTS = ['apps', 'packages'] as const;
const LEGACY_LEDGER_WRITE =
  /\b(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE|DELETE\s+FROM)\s+[`"'[]?(?:history|history_prompt_references)\b/gi;

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'out') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
  }
}

function isRuntimeTypeScript(path: string): boolean {
  if (!path.endsWith('.ts') && !path.endsWith('.tsx')) return false;
  if (path.endsWith('.d.ts')) return false;
  if (path.includes('/__tests__/') || /\.(?:test|spec)\.[jt]sx?$/.test(path)) return false;
  if (path.includes('/testing/fixtures/')) return false;
  if (path.includes('/migrations/') || path.endsWith('/migrations.generated.ts')) return false;
  return true;
}

describe('桌面生成单账本边界', () => {
  it('运行时代码不再写入退役的 history 表', () => {
    const violations: string[] = [];
    for (const root of SCAN_ROOTS) {
      for (const absolutePath of walk(join(REPO_ROOT, root))) {
        const path = relative(REPO_ROOT, absolutePath);
        if (!isRuntimeTypeScript(path)) continue;
        const source = readFileSync(absolutePath, 'utf8');
        for (const match of source.matchAll(LEGACY_LEDGER_WRITE)) {
          const line = source.slice(0, match.index).split('\n').length;
          violations.push(`${path}:${line} ${match[0].replace(/\s+/g, ' ')}`);
        }
      }
    }

    expect(
      violations.join('\n'),
      'history/history_prompt_references 仅允许迁移读取；运行时生成写入必须使用 generation_runs/generated_assets',
    ).toBe('');
  });
});
