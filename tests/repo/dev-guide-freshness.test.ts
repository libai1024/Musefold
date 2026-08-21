import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../../tooling/aliases.mjs';

/**
 * 开发规范是活人读的。把会漂的快照（用例数、规则条数、旧文件名、未落地的
 * ESLint 双阈值）写进去，下一次核对就会发现规范在说谎——RHF 和「图库双端
 * 各写一套」已经各发生过一次。这条守卫只锁规范正文，不扫历史决策文档。
 */

const GUIDE = 'docs/frontend/DEVELOPMENT-GUIDE.md';

const BANNED: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /warn 600 \/ error 1?,?200/,
    reason: 'ESLint 从未落地 warn+error 双档；硬门禁是 file-size-ratchet 的 600 行',
  },
  {
    pattern: /sessionPreferences\.ts/,
    reason: '实际文件是 workbenchSessionPreferences.ts',
  },
  {
    pattern: /适配器 5 个入口/,
    reason: '入口集合会漂，写清允许名单而不是计数',
  },
  {
    pattern: /桌面 222 例/,
    reason: 'E2E 用例数以 pytest 输出为准，不要冻进规范',
  },
  {
    pattern: /只做路由挂载与平台差异/,
    reason: '页面仍含宿主胶水；规范应写「编排单点」而不是「薄到只剩路由」',
  },
];

describe('开发规范不携带已证伪的快照', () => {
  const source = readFileSync(join(REPO_ROOT, GUIDE), 'utf8');

  for (const { pattern, reason } of BANNED) {
    it(`不含 ${pattern.source}`, () => {
      expect(source, `${GUIDE}：${reason}`).not.toMatch(pattern);
    });
  }

  it('尺寸规则指向实际落地的 max-lines + ratchet，而不是未实现的双阈值', () => {
    expect(source).toContain('file-size-ratchet.test.ts');
    expect(source).toContain('max-lines');
  });
});
