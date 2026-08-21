import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../../tooling/aliases.mjs';

/**
 * 设置页的第三方声明必须与桌面端实际随包发布的依赖一致。
 *
 * 这份清单原先手工维护：既漏登记 6 个真实依赖（署名缺口），又留着一个早已不用的
 * `react-hook-form`（正是它让开发规范里的「表单用 RHF」看起来成立）。声明与现实
 * 不符会同时骗到用户和开发者，所以改由这条守卫锁死。
 */

const NOTICES_PATH = 'apps/desktop/src/features/settings/third-party-notices.ts';
const PACKAGE_PATH = 'apps/desktop/package.json';

/** Radix 十余个包在 UI 上合并成一条，避免声明页被同一家库刷屏。 */
function normalize(name: string): string {
  return name.startsWith('@radix-ui/') ? '@radix-ui/react-*' : name;
}

describe('第三方声明与桌面依赖一致', () => {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, PACKAGE_PATH), 'utf8')) as {
    dependencies: Record<string, string>;
  };
  const shipped = [
    ...new Set(
      Object.keys(pkg.dependencies)
        .filter((name) => !name.startsWith('@musefold/'))
        .map(normalize),
    ),
  ].sort();

  const source = readFileSync(join(REPO_ROOT, NOTICES_PATH), 'utf8');
  const listed = [...source.matchAll(/name: '([^']+)'/g)].map((match) => match[1]);

  it('依赖清单里的每个包都有声明', () => {
    expect(
      shipped.filter((name) => !listed.includes(name)),
      `${NOTICES_PATH} 漏登记依赖（署名缺口）`,
    ).toEqual([]);
  });

  it('声明里没有已经不再依赖的包', () => {
    expect(
      listed.filter((name) => !shipped.includes(name)),
      `${NOTICES_PATH} 登记了 package.json 里不存在的包——依赖删了要同步删声明`,
    ).toEqual([]);
  });

  it('声明按名称排序且无重复', () => {
    expect(listed).toEqual([...new Set(listed)]);
    expect(listed).toEqual([...listed].sort());
  });
});
