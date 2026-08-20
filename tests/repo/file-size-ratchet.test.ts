import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../../tooling/aliases.mjs';

/**
 * V13-GOV-01 文件尺寸棘轮。
 *
 * 三条约束（全部 CI 强制）：
 * 1. 生产代码（apps 各 src、apps/desktop/electron、packages 各 src 的 .ts/.tsx，
 *    排除 __tests__、.test.、.d.ts）单文件不得超过 baseline 登记的上限；
 * 2. 新文件超过 600 行且不在 baseline 中 → 失败（先拆分再提交）；
 * 3. baseline 条目只减不增：文件删除或缩小到阈值内后条目必须移除。
 *
 * ESLint `max-lines`（warn 600）提供编辑器内即时反馈，本测试是唯一门禁。
 */

const BASELINE_PATH = 'tooling/file-size-baseline.json';
const THRESHOLD = 600;

const SCAN_ROOTS = [
  'apps/desktop/src',
  'apps/desktop/electron',
  'apps/web/src',
  'apps/web-api/src',
  'apps/generation-worker/src',
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
  let entries: string[];
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
  const content = readFileSync(absPath, 'utf8');
  const lines = content.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.length;
}

function loadBaseline(): Map<string, number> {
  const raw = JSON.parse(readFileSync(join(REPO_ROOT, BASELINE_PATH), 'utf8')) as Record<
    string,
    number
  >;
  const entries = new Map<string, number>();
  for (const [path, maxLines] of Object.entries(raw)) {
    if (path === 'comment') continue;
    if (typeof maxLines !== 'number' || !Number.isFinite(maxLines)) {
      throw new Error(`${BASELINE_PATH}: 条目 ${path} 的值必须是数字`);
    }
    entries.set(path, maxLines);
  }
  return entries;
}

describe('V13-GOV-01 文件尺寸棘轮', () => {
  const baseline = loadBaseline();
  const roots = [...SCAN_ROOTS, ...collectPackageSrcRoots()];

  const oversized: { path: string; lines: number }[] = [];
  for (const root of roots) {
    for (const abs of walk(join(REPO_ROOT, root))) {
      const rel = relative(REPO_ROOT, abs);
      if (!isProductionSource(rel)) continue;
      const lines = countLines(abs);
      if (lines > THRESHOLD) oversized.push({ path: rel, lines });
    }
  }

  it('超过 600 行的生产文件必须登记在 baseline 且不得超过登记上限', () => {
    const violations: string[] = [];
    for (const { path, lines } of oversized) {
      const max = baseline.get(path);
      if (max === undefined) {
        violations.push(
          `未登记的超标文件：${path}（${lines} 行 > ${THRESHOLD}）。拆分该文件，或确属存量时在 ${BASELINE_PATH} 登记。`,
        );
      } else if (lines > max) {
        violations.push(
          `${path} 从登记上限 ${max} 行增长到 ${lines} 行。棘轮只减不增：拆分文件或调低该条目属违规。`,
        );
      }
    }
    expect(violations.join('\n'), '尺寸棘轮违规').toBe('');
  });

  it('baseline 条目只减不增：失效条目（文件已删/已缩至阈值内）必须移除', () => {
    const stale: string[] = [];
    for (const [path, max] of baseline) {
      const abs = join(REPO_ROOT, path);
      let exists = true;
      try {
        statSync(abs);
      } catch {
        exists = false;
      }
      if (!exists) {
        stale.push(`${path}：文件已删除，请从 ${BASELINE_PATH} 移除该条目。`);
        continue;
      }
      const lines = countLines(abs);
      if (lines <= THRESHOLD) {
        stale.push(
          `${path}：现 ${lines} 行 ≤ ${THRESHOLD}，请从 ${BASELINE_PATH} 移除该条目（棘轮收紧）。`,
        );
      } else if (lines < max) {
        stale.push(
          `${path}：现 ${lines} 行 < 登记上限 ${max} 行，请把条目收紧到 ${lines}（棘轮只减不增）。`,
        );
      }
    }
    expect(stale.join('\n'), '失效 baseline 条目').toBe('');
  });

  it('baseline 与扫描范围一致（登记的路径必须位于扫描根内且是生产源码）', () => {
    const rootsAbs = roots.map((r) => resolve(REPO_ROOT, r));
    const offenders: string[] = [];
    for (const path of baseline.keys()) {
      const abs = resolve(REPO_ROOT, path);
      if (!rootsAbs.some((root) => abs.startsWith(root + '/'))) {
        offenders.push(`${path}：不在扫描范围（${roots.join('、')}）内，登记无意义。`);
        continue;
      }
      if (!isProductionSource(path)) {
        offenders.push(`${path}：不是受约束的生产源码形态（测试/d.ts 不计尺寸）。`);
      }
    }
    expect(offenders.join('\n'), '无效 baseline 路径').toBe('');
  });
});
