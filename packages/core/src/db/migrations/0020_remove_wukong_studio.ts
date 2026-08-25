import type Database from 'better-sqlite3';

// 0020: 悟空云(wukong-studio)接入下线,不做兼容。
// 删除存量悟空 Provider 行;history/generation_runs 的 provider_id 无外键,
// 历史记录原样保留。若被删的是默认(is_active)行,把最早的剩余 provider 置为默认,
// 避免「无任何 active」的空窗;没有剩余行则保持空态。
export function up(db: Database.Database): void {
  const removedActive = db
    .prepare(`SELECT 1 FROM providers WHERE type = 'wukong-studio' AND is_active = 1`)
    .get();
  db.prepare(`DELETE FROM providers WHERE type = 'wukong-studio'`).run();
  if (removedActive) {
    db.exec(`
      UPDATE providers SET is_active = 1
      WHERE id = (
        SELECT id FROM providers ORDER BY created_at ASC, id ASC LIMIT 1
      )
      AND NOT EXISTS (SELECT 1 FROM providers WHERE is_active = 1)
    `);
  }
}
