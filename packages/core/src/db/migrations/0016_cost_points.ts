// 0016: 所有成本统一为用户可见积分。
// 旧托管记录的 point 实际保存服务端原始配额；旧 BYOK 记录保存人民币分。

import type Database from 'better-sqlite3';

export function up(db: Database.Database): void {
  db.exec(`
    UPDATE history
    SET cost = CASE
      WHEN cost IS NULL THEN NULL
      WHEN cost_unit = 'point' THEN cost / 50000.0
      ELSE cost / 10.0
    END,
    cost_unit = 'point';

    ALTER TABLE automation_audit RENAME COLUMN estimated_cents TO estimated_points;
    ALTER TABLE automation_audit RENAME COLUMN actual_cents TO actual_points;
    UPDATE automation_audit
    SET estimated_points = estimated_points / 10.0,
        actual_points = actual_points / 10.0;
  `);
}
