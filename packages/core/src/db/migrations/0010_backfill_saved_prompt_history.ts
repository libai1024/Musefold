import type Database from 'better-sqlite3';

const LEGACY_SAVE_WINDOW_MS = 10 * 60 * 1000;

interface LegacyPromptRow {
  id: string;
  content: string;
  content_negative: string | null;
  created_at: number;
}

interface LegacyHistoryRow {
  id: string;
  image_path: string;
}

/**
 * Workbench used to save a generated prompt without linking its completed
 * history rows. Backfill only exact prompt/negative matches saved shortly
 * after generation; deliberately avoid fuzzy text matching.
 */
export function up(db: Database.Database): void {
  const prompts = db.prepare(
    `SELECT id, content, content_negative, created_at
     FROM prompts
     WHERE deleted_at IS NULL
       AND source = 'manual'
       AND source_url IS NULL
     ORDER BY created_at ASC`,
  ).all() as LegacyPromptRow[];
  const findHistory = db.prepare(
    `SELECT id, image_path
     FROM history
     WHERE prompt_id IS NULL
       AND status = 'success'
       AND image_path IS NOT NULL
       AND prompt_text = ?
       AND COALESCE(negative_text, '') = COALESCE(?, '')
       AND created_at <= ?
       AND created_at >= ?
     ORDER BY created_at DESC`,
  );
  const linkHistory = db.prepare('UPDATE history SET prompt_id = ? WHERE id = ? AND prompt_id IS NULL');
  const updatePrompt = db.prepare(
    `UPDATE prompts
     SET source_url = COALESCE(source_url, ?),
         preview_image_path = COALESCE(preview_image_path, ?),
         updated_at = MAX(updated_at, ?)
     WHERE id = ?`,
  );

  for (const prompt of prompts) {
    const histories = findHistory.all(
      prompt.content,
      prompt.content_negative,
      prompt.created_at,
      prompt.created_at - LEGACY_SAVE_WINDOW_MS,
    ) as LegacyHistoryRow[];
    if (histories.length === 0) continue;

    for (const history of histories) linkHistory.run(prompt.id, history.id);
    const nearest = histories[0];
    updatePrompt.run(
      `history://${nearest.id}`,
      nearest.image_path,
      prompt.created_at,
      prompt.id,
    );
  }
}
