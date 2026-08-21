import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../../tooling/aliases.mjs';

/**
 * V13-REUSE-02 双端复用棘轮。
 *
 * 「复用频率」是 v1.3 的过程度量：product-ui 里被 Web 与桌面同时消费的导出符号
 * 数量只增不减。统计只看生产源码（排除 __tests__/.test.），避免用测试文件刷数。
 */

const BOTH_HOSTS_BASELINE = 64;

const HOSTS = {
  web: 'apps/web/src',
  desktop: 'apps/desktop/src',
} as const;

const IMPORT_RE = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]@musefold\/product-ui['"]/g;
const EXPORT_RE = /export\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]@musefold\/product-ui['"]/g;

function isProductionSource(relPath: string): boolean {
  if (!relPath.endsWith('.ts') && !relPath.endsWith('.tsx')) return false;
  if (relPath.endsWith('.d.ts')) return false;
  if (relPath.includes('__tests__/')) return false;
  return !/\.(test|spec)\.[jt]sx?$/.test(relPath);
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'out') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

function collectSymbols(root: string): Set<string> {
  const symbols = new Set<string>();
  for (const abs of walk(join(REPO_ROOT, root))) {
    if (!isProductionSource(relative(REPO_ROOT, abs))) continue;
    const source = readFileSync(abs, 'utf8');
    for (const re of [IMPORT_RE, EXPORT_RE]) {
      re.lastIndex = 0;
      let match = re.exec(source);
      while (match) {
        for (const raw of match[1].split(',')) {
          const name = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
          if (name) symbols.add(name);
        }
        match = re.exec(source);
      }
    }
  }
  return symbols;
}

describe('V13-REUSE-02 product-ui 双端复用', () => {
  const web = collectSymbols(HOSTS.web);
  const desktop = collectSymbols(HOSTS.desktop);
  const shared = [...web].filter((symbol) => desktop.has(symbol)).sort();

  it('双端共同消费的 product-ui 导出只增不减', () => {
    expect(
      shared.length,
      `双端共享符号 ${shared.length} 个，低于基线 ${BOTH_HOSTS_BASELINE}。` +
        '把宿主本地组件下沉 product-ui 可以提高该值；下降说明某侧改回了手写实现。\n' +
        shared.join('\n'),
    ).toBeGreaterThanOrEqual(BOTH_HOSTS_BASELINE);
  });

  it('基线保持收紧（现值高于基线时应把基线提到现值）', () => {
    expect(
      shared.length,
      `双端共享符号已达 ${shared.length} 个，请把 BOTH_HOSTS_BASELINE 提到该值。`,
    ).toBe(BOTH_HOSTS_BASELINE);
  });

  it('工作台装配壳与编排 hook 双端同源', () => {
    const required = [
      'WorkbenchPageFrame',
      'WorkbenchTimelineStage',
      'WorkbenchGenerationTurn',
      'WorkbenchComposerFrame',
      'WorkbenchComposerPrompt',
      'WorkbenchRatioPicker',
      'WorkbenchGenerationSettingsPopover',
      'WorkbenchContextMenu',
      'useWorkbenchTimelineController',
      'useGeneratePageController',
    ];
    expect(required.filter((symbol) => !shared.includes(symbol))).toEqual([]);
  });

  it('Web generate 视图不手写共享 widget 已覆盖的结构', () => {
    const source = readFileSync(join(REPO_ROOT, 'apps/web/src/views/GenerateView.tsx'), 'utf8');
    expect(source, 'composer 冲突面应使用 WorkbenchDraftConflictNotice').not.toContain(
      'data-testid="workbench-draft-conflict"',
    );
    expect(source, '比例清单应取自 workbenchRatioOptions 共享目录').not.toMatch(
      /label:\s*'方图'/,
    );
  });
});
