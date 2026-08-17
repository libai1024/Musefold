// 0013: account_managed —— v0.5 账号与云通道（V05-ACC-04）。
// providers.managed_by：账号托管标记（'account' | NULL）；托管行 baseUrl/Key 只读、登出回收、导出排除。
// history.cost_unit：记账单位快照（FR-COST-03）——托管消费以「点」记账（500000 点 = $1），
// BYOK 维持人民币分；单位随记录冻结，登出删除托管 Provider 后历史仍可正确解释。

import type Database from 'better-sqlite3';

export function up(db: Database.Database): void {
  db.exec(`
    ALTER TABLE providers ADD COLUMN managed_by TEXT DEFAULT NULL;
    ALTER TABLE history ADD COLUMN cost_unit TEXT NOT NULL DEFAULT 'cny_cent';
  `);
}
