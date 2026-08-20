import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import {
  ALIAS_RELATIVE,
  DESKTOP_ALIAS_RELATIVE,
  REPO_ROOT,
  SHARED_ALIAS_RELATIVE,
} from '../../tooling/aliases.mjs';

const TSCONFIG_BASE = 'tooling/tsconfig.base.json';
const RUNTIME_CONSUMERS = [
  'vitest.config.ts',
  'vite.preview.config.ts',
  'scripts/build-cli.mjs',
  'apps/desktop/electron.vite.config.ts',
] as const;

function loadTsconfigPaths(relPath: string): Record<string, string[]> {
  const abs = resolve(REPO_ROOT, relPath);
  const text = readFileSync(abs, 'utf8');
  const parsed = ts.parseConfigFileTextToJson(abs, text);
  if (parsed.error) {
    throw new Error(
      `无法解析 ${relPath}: ${ts.flattenDiagnosticMessageText(parsed.error.messageText, '\n')}`,
    );
  }
  const paths = parsed.config?.compilerOptions?.paths as Record<string, string[]> | undefined;
  if (!paths || typeof paths !== 'object') {
    throw new Error(`${relPath} 缺少 compilerOptions.paths`);
  }
  return paths;
}

/** tsconfig 目标 → 与 aliases.mjs 相同的仓库根相对目录。 */
function normalizeTsTarget(target: string): string {
  return target.replace(/\/\*$/, '').replace(/\/index\.ts$/, '');
}

function runtimeKeyFromTsPath(key: string): string {
  return key.endsWith('/*') ? key.slice(0, -2) : key;
}

describe('路径别名单一来源', () => {
  const paths = loadTsconfigPaths(TSCONFIG_BASE);

  it('tsconfig.base.json paths 与 tooling/aliases.mjs 指向同一目录', () => {
    const runtimeKeys = new Set(Object.keys(ALIAS_RELATIVE));
    const tsKeys = new Set(Object.keys(paths).map(runtimeKeyFromTsPath));

    expect([...tsKeys].sort()).toEqual([...runtimeKeys].sort());

    for (const [key, targets] of Object.entries(paths)) {
      const runtimeKey = runtimeKeyFromTsPath(key);
      const expected = ALIAS_RELATIVE[runtimeKey as keyof typeof ALIAS_RELATIVE];
      expect(expected, `aliases.mjs 缺少 ${runtimeKey}`).toBeDefined();
      const normalized = targets.map(normalizeTsTarget);
      expect(normalized, `${key} → ${targets.join(', ')}`).toEqual(
        expect.arrayContaining([expected]),
      );
      expect(new Set(normalized).size, `${key} 的目标归一化后应唯一`).toBe(1);
    }

    for (const [alias, rel] of Object.entries(ALIAS_RELATIVE)) {
      const wildcard = paths[`${alias}/*`];
      const exact = paths[alias];
      const candidates = [...(wildcard ?? []), ...(exact ?? [])].map(normalizeTsTarget);
      expect(candidates, `tsconfig 缺少 ${alias}`).toContain(rel);
    }
  });

  it('桌面内部别名与共享别名分组互斥且并集等于全表', () => {
    const sharedKeys = Object.keys(SHARED_ALIAS_RELATIVE);
    const desktopKeys = Object.keys(DESKTOP_ALIAS_RELATIVE);
    expect(sharedKeys.some((key) => key in DESKTOP_ALIAS_RELATIVE)).toBe(false);
    expect(desktopKeys.some((key) => key in SHARED_ALIAS_RELATIVE)).toBe(false);
    expect({ ...SHARED_ALIAS_RELATIVE, ...DESKTOP_ALIAS_RELATIVE }).toEqual(ALIAS_RELATIVE);
    expect(DESKTOP_ALIAS_RELATIVE).toMatchObject({
      '@renderer': 'apps/desktop/src',
      '@electron': 'apps/desktop/electron',
    });
    expect(SHARED_ALIAS_RELATIVE['@shared/types']).toBe('packages/desktop-contracts/src');
  });

  it('运行时配置从 aliases.mjs 取表，不再手写指向', () => {
    for (const file of RUNTIME_CONSUMERS) {
      const text = readFileSync(resolve(REPO_ROOT, file), 'utf8');
      expect(text, file).toMatch(/tooling\/aliases\.mjs/);
      expect(text, file).toMatch(/pickAliases\s*\(/);
    }
  });
});
