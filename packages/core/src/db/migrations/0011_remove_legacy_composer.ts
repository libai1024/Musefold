import type Database from 'better-sqlite3';

type Row = Record<string, any>;

function tableExists(db: Database.Database, name: string): boolean {
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?",
  ).get(name));
}

function tableSql(db: Database.Database, name: string): string {
  const row = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(name) as { sql?: string | null } | undefined;
  return row?.sql ?? '';
}

function rebuildCrossDatabaseRecipeLinks(db: Database.Database): void {
  const promptsNeedRebuild = /recipe_id\s+TEXT\s+REFERENCES\s+recipes/i.test(tableSql(db, 'prompts'));
  const historyNeedsRebuild = /recipe_id\s+TEXT\s+REFERENCES\s+recipes/i.test(tableSql(db, 'history'));
  if (!promptsNeedRebuild && !historyNeedsRebuild) return;

  const prompts = db.prepare('SELECT rowid AS _rowid, * FROM prompts').all() as Row[];
  const promptTags = tableExists(db, 'prompt_tags')
    ? db.prepare('SELECT prompt_id, tag_id FROM prompt_tags').all() as Row[]
    : [];
  const history = tableExists(db, 'history')
    ? db.prepare('SELECT rowid AS _rowid, * FROM history').all() as Row[]
    : [];
  const historyReferences = tableExists(db, 'history_prompt_references')
    ? db.prepare('SELECT * FROM history_prompt_references ORDER BY history_id, sort_order').all() as Row[]
    : [];

  db.exec(`
    DROP TABLE IF EXISTS history_prompt_references;
    DROP TABLE IF EXISTS history;
    DROP TABLE IF EXISTS prompt_tags;
    DROP TABLE IF EXISTS prompts;

    CREATE TABLE prompts (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      content TEXT NOT NULL,
      content_negative TEXT,
      folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
      model_id TEXT,
      params TEXT,
      preview_image_path TEXT,
      rating INTEGER DEFAULT 0,
      is_pinned INTEGER DEFAULT 0,
      pin_order INTEGER,
      usage_count INTEGER DEFAULT 0,
      last_used_at INTEGER,
      source TEXT,
      source_url TEXT,
      recipe_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    );
    CREATE INDEX idx_prompts_folder ON prompts(folder_id) WHERE deleted_at IS NULL;
    CREATE INDEX idx_prompts_model ON prompts(model_id) WHERE deleted_at IS NULL;
    CREATE INDEX idx_prompts_pinned ON prompts(is_pinned, pin_order) WHERE deleted_at IS NULL AND is_pinned = 1;
    CREATE INDEX idx_prompts_updated ON prompts(updated_at DESC) WHERE deleted_at IS NULL;
    CREATE INDEX idx_prompts_recipe ON prompts(recipe_id) WHERE recipe_id IS NOT NULL;

    CREATE TABLE prompt_tags (
      prompt_id TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
      tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (prompt_id, tag_id)
    );
    CREATE INDEX idx_prompt_tags_tag ON prompt_tags(tag_id);

    CREATE TABLE history (
      id TEXT PRIMARY KEY,
      prompt_id TEXT REFERENCES prompts(id) ON DELETE SET NULL,
      recipe_id TEXT,
      recipe_name_snapshot TEXT,
      recipe_fields_snapshot TEXT,
      recipe_values_snapshot TEXT,
      recipe_variant_index INTEGER,
      provider_id TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_text TEXT NOT NULL,
      negative_text TEXT,
      params TEXT,
      status TEXT NOT NULL,
      error_code TEXT,
      error_message TEXT,
      image_path TEXT,
      cost INTEGER,
      duration_ms INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX idx_history_created ON history(created_at DESC);
    CREATE INDEX idx_history_prompt ON history(prompt_id);
    CREATE INDEX idx_history_recipe ON history(recipe_id);
    CREATE INDEX idx_history_status ON history(status);

    CREATE TABLE history_prompt_references (
      history_id TEXT NOT NULL REFERENCES history(id) ON DELETE CASCADE,
      prompt_id TEXT REFERENCES prompts(id) ON DELETE SET NULL,
      prompt_title TEXT NOT NULL,
      excerpt TEXT NOT NULL,
      scope TEXT NOT NULL CHECK(scope IN ('full', 'excerpt')),
      sort_order INTEGER NOT NULL,
      PRIMARY KEY (history_id, sort_order)
    );
    CREATE INDEX idx_history_prompt_refs_prompt ON history_prompt_references(prompt_id);
    CREATE INDEX idx_history_prompt_refs_history ON history_prompt_references(history_id, sort_order);
  `);

  const folderIds = new Set(
    (db.prepare('SELECT id FROM folders').all() as Array<{ id: string }>).map((row) => row.id),
  );
  const insertPrompt = db.prepare(
    `INSERT INTO prompts
       (rowid, id, title, description, content, content_negative, folder_id, model_id,
        params, preview_image_path, rating, is_pinned, pin_order, usage_count, last_used_at,
        source, source_url, recipe_id, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const row of prompts) {
    const folderId = row.folder_id && folderIds.has(row.folder_id) ? row.folder_id : null;
    insertPrompt.run(
      row._rowid,
      row.id,
      row.title,
      row.description ?? null,
      row.content,
      row.content_negative ?? null,
      folderId,
      row.model_id ?? null,
      row.params ?? null,
      row.preview_image_path ?? null,
      row.rating ?? 0,
      row.is_pinned ?? 0,
      row.pin_order ?? null,
      row.usage_count ?? 0,
      row.last_used_at ?? null,
      row.source ?? null,
      row.source_url ?? null,
      row.recipe_id ?? null,
      row.created_at,
      row.updated_at,
      row.deleted_at ?? null,
    );
  }

  const promptIds = new Set(prompts.map((row) => String(row.id)));
  const tagIds = new Set(
    (db.prepare('SELECT id FROM tags').all() as Array<{ id: string }>).map((row) => row.id),
  );
  const insertPromptTag = db.prepare(
    'INSERT OR IGNORE INTO prompt_tags (prompt_id, tag_id) VALUES (?, ?)',
  );
  for (const row of promptTags) {
    if (promptIds.has(row.prompt_id) && tagIds.has(row.tag_id)) {
      insertPromptTag.run(row.prompt_id, row.tag_id);
    }
  }

  const insertHistory = db.prepare(
    `INSERT INTO history
       (rowid, id, prompt_id, recipe_id, recipe_name_snapshot, recipe_fields_snapshot,
        recipe_values_snapshot, recipe_variant_index, provider_id, model, prompt_text,
        negative_text, params, status, error_code, error_message, image_path, cost,
        duration_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const row of history) {
    insertHistory.run(
      row._rowid,
      row.id,
      row.prompt_id && promptIds.has(row.prompt_id) ? row.prompt_id : null,
      row.recipe_id ?? null,
      row.recipe_name_snapshot ?? null,
      row.recipe_fields_snapshot ?? null,
      row.recipe_values_snapshot ?? null,
      row.recipe_variant_index ?? null,
      row.provider_id,
      row.model,
      row.prompt_text,
      row.negative_text ?? null,
      row.params ?? null,
      row.status,
      row.error_code ?? null,
      row.error_message ?? null,
      row.image_path ?? null,
      row.cost ?? null,
      row.duration_ms ?? null,
      row.created_at,
    );
  }

  const historyIds = new Set(history.map((row) => String(row.id)));
  const insertReference = db.prepare(
    `INSERT OR IGNORE INTO history_prompt_references
       (history_id, prompt_id, prompt_title, excerpt, scope, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const row of historyReferences) {
    if (!historyIds.has(row.history_id)) continue;
    insertReference.run(
      row.history_id,
      row.prompt_id && promptIds.has(row.prompt_id) ? row.prompt_id : null,
      row.prompt_title,
      row.excerpt,
      row.scope,
      row.sort_order,
    );
  }
}

function dropLegacyTables(db: Database.Database): void {
  db.exec(`
    DROP TRIGGER IF EXISTS fragments_ai;
    DROP TRIGGER IF EXISTS fragments_ad;
    DROP TRIGGER IF EXISTS fragments_au;
    DROP TABLE IF EXISTS composition_snapshots;
    DROP TABLE IF EXISTS composition_events;
    DROP TABLE IF EXISTS compositions;
    DROP TABLE IF EXISTS templates;
    DROP TABLE IF EXISTS fragments_fts;
    DROP TABLE IF EXISTS fragments;
    DROP TABLE IF EXISTS recipe_drafts;
    DROP TABLE IF EXISTS materials_fts;
    DROP TABLE IF EXISTS materials;
    DROP TABLE IF EXISTS recipes;
  `);
}

export function up(db: Database.Database): void {
  rebuildCrossDatabaseRecipeLinks(db);
  dropLegacyTables(db);
}
