import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../../tooling/aliases.mjs';

/**
 * V13-REUSE-03 边界回潮守卫。
 *
 * depcruise 只在 `check:boundaries` 里跑，且 `--ignore-known` 能把任何违规重新
 * 冻结进 baseline。这里锁住的是「规则本身还在、baseline 还是空的」这一层：
 * 1. feature 互导（renderer-features-isolated-*）；
 * 2. 行模型上浮（renderer-row-models-banned）；
 * 3. 超大文件由 file-size-ratchet.test.ts 负责（第三类）。
 */

const KNOWN_VIOLATIONS_PATH = 'tooling/dependency-cruiser-known-violations.json';
const CONFIG_PATH = 'tooling/dependency-cruiser.cjs';
const FEATURES_ROOT = 'apps/desktop/src/features';

function readFeatureDirs(): string[] {
  return readdirSync(join(REPO_ROOT, FEATURES_ROOT), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function isProductionSource(relPath: string): boolean {
  if (!relPath.endsWith('.ts') && !relPath.endsWith('.tsx')) return false;
  if (relPath.endsWith('.d.ts')) return false;
  if (relPath.includes('__tests__/') || relPath.includes('__mocks__/')) return false;
  return !/\.(test|spec)\.[jt]sx?$/.test(relPath);
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

describe('V13-REUSE-03 边界 baseline 归零', () => {
  const known = JSON.parse(
    readFileSync(join(REPO_ROOT, KNOWN_VIOLATIONS_PATH), 'utf8'),
  ) as { rule?: { name?: string }; from?: string; to?: string }[];
  const config = readFileSync(join(REPO_ROOT, CONFIG_PATH), 'utf8');

  it('known-violations 不得再登记 feature 互导或行模型违规', () => {
    const frozen = known
      .filter((entry) => {
        const rule = entry.rule?.name ?? '';
        return (
          rule.startsWith('renderer-features-isolated') ||
          rule === 'renderer-row-models-banned'
        );
      })
      .map((entry) => `${entry.rule?.name}: ${entry.from} → ${entry.to}`);
    expect(
      frozen.join('\n'),
      '这两类违规在 REUSE-03 已归零，不得重新冻结进 baseline——请改经 runtime/*-access、runtime/*-side-effects 或把共享物下沉 lib/product-ui。',
    ).toBe('');
  });

  it('两条规则都在配置里且为 error', () => {
    expect(config).toContain("name: 'renderer-row-models-banned'");
    expect(config).toContain('name: `renderer-features-isolated-${feature}`');
    const severities = [...config.matchAll(/severity: '(\w+)'/g)].map((match) => match[1]);
    expect(new Set(severities)).toEqual(new Set(['error']));
  });

  it('互导规则按目录动态生成，新增 feature 自动纳管', () => {
    // 规则清单来自 readdirSync；这条断言防止有人把它换成硬编码数组后漏掉新 feature。
    expect(config).toContain("readdirSync(resolve(__dirname, '../apps/desktop/src/features')");
    expect(readFeatureDirs().length).toBeGreaterThan(0);
  });

  it('渲染层业务代码不 import desktop-contracts 行模型', () => {
    const offenders: string[] = [];
    for (const root of ['features', 'components', 'pages', 'stores', 'lib']) {
      for (const abs of walk(join(REPO_ROOT, 'apps/desktop/src', root))) {
        const rel = relative(REPO_ROOT, abs);
        if (!isProductionSource(rel)) continue;
        const source = readFileSync(abs, 'utf8');
        if (/from\s+['"]@musefold\/desktop-contracts\/models['"]/.test(source)) {
          offenders.push(rel);
        }
      }
    }
    expect(offenders.join('\n'), '行模型只属 core/主进程/IPC 签名/runtime mappers').toBe('');
  });

  it('feature 之间没有直接相对导入（互导零容忍）', () => {
    const features = readFeatureDirs();
    const offenders: string[] = [];
    for (const feature of features) {
      for (const abs of walk(join(REPO_ROOT, FEATURES_ROOT, feature))) {
        const rel = relative(REPO_ROOT, abs);
        if (!isProductionSource(rel)) continue;
        const source = readFileSync(abs, 'utf8');
        for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
          const specifier = match[1];
          const target = specifier.startsWith('.')
            ? relative(REPO_ROOT, resolve(dirname(abs), specifier))
            : specifier.replace(/^@renderer\//, 'apps/desktop/src/');
          const sibling = new RegExp(`^${FEATURES_ROOT}/([^/]+)`).exec(target)?.[1];
          if (sibling && sibling !== feature) offenders.push(`${rel} → ${specifier}`);
        }
      }
    }
    expect(offenders.join('\n'), 'feature 同层互导').toBe('');
  });
});
