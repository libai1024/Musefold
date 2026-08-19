'use strict';

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE app.prompt_folders (
      owner_id bigint NOT NULL,
      id varchar(64) NOT NULL,
      name varchar(80) NOT NULL,
      normalized_name text GENERATED ALWAYS AS (lower(btrim(name))) STORED,
      parent_id varchar(64),
      sort_order integer NOT NULL DEFAULT 0,
      version integer NOT NULL DEFAULT 1 CHECK (version > 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz,
      PRIMARY KEY (owner_id, id),
      FOREIGN KEY (owner_id, parent_id) REFERENCES app.prompt_folders(owner_id, id)
    );
    CREATE UNIQUE INDEX prompt_folders_active_name_idx
      ON app.prompt_folders(owner_id, normalized_name)
      WHERE deleted_at IS NULL;
    CREATE INDEX prompt_folders_owner_sort_idx
      ON app.prompt_folders(owner_id, sort_order, id)
      WHERE deleted_at IS NULL;

    CREATE TABLE app.prompt_tags (
      owner_id bigint NOT NULL,
      id varchar(64) NOT NULL,
      name varchar(40) NOT NULL,
      normalized_name text GENERATED ALWAYS AS (lower(btrim(name))) STORED,
      tag_group varchar(40),
      color varchar(7),
      version integer NOT NULL DEFAULT 1 CHECK (version > 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz,
      PRIMARY KEY (owner_id, id),
      CHECK (color IS NULL OR color ~ '^#[0-9a-fA-F]{6}$')
    );
    CREATE UNIQUE INDEX prompt_tags_active_name_idx
      ON app.prompt_tags(owner_id, normalized_name)
      WHERE deleted_at IS NULL;
    CREATE INDEX prompt_tags_owner_name_idx
      ON app.prompt_tags(owner_id, normalized_name)
      WHERE deleted_at IS NULL;

    CREATE TABLE app.prompts (
      owner_id bigint NOT NULL,
      id varchar(64) NOT NULL,
      title varchar(80) NOT NULL,
      description varchar(500),
      content text NOT NULL,
      negative varchar(4_000),
      folder_id varchar(64),
      model_id varchar(128),
      params jsonb,
      rating smallint NOT NULL DEFAULT 0 CHECK (rating BETWEEN 0 AND 5),
      is_pinned boolean NOT NULL DEFAULT false,
      pin_order integer,
      usage_count integer NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
      last_used_at timestamptz,
      source varchar(16) NOT NULL DEFAULT 'manual'
        CHECK (source IN ('manual', 'import', 'share', 'slip', 'generation')),
      source_url text,
      version integer NOT NULL DEFAULT 1 CHECK (version > 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz,
      PRIMARY KEY (owner_id, id),
      FOREIGN KEY (owner_id, folder_id) REFERENCES app.prompt_folders(owner_id, id),
      CHECK (params IS NULL OR pg_column_size(params) <= 32768),
      CHECK (source_url IS NULL OR source_url ~* '^https?://')
    );
    CREATE INDEX prompts_owner_updated_idx
      ON app.prompts(owner_id, is_pinned DESC, updated_at DESC, id DESC);
    CREATE INDEX prompts_owner_created_idx
      ON app.prompts(owner_id, created_at DESC, id DESC);
    CREATE INDEX prompts_owner_usage_idx
      ON app.prompts(owner_id, usage_count DESC, updated_at DESC, id DESC);
    CREATE INDEX prompts_content_trgm_idx
      ON app.prompts USING gin ((title || ' ' || content || ' ' || coalesce(description, '')) gin_trgm_ops);

    CREATE TABLE app.prompt_tag_links (
      owner_id bigint NOT NULL,
      prompt_id varchar(64) NOT NULL,
      tag_id varchar(64) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (owner_id, prompt_id, tag_id),
      FOREIGN KEY (owner_id, prompt_id) REFERENCES app.prompts(owner_id, id) ON DELETE CASCADE,
      FOREIGN KEY (owner_id, tag_id) REFERENCES app.prompt_tags(owner_id, id)
    );
    CREATE INDEX prompt_tag_links_tag_idx
      ON app.prompt_tag_links(owner_id, tag_id, prompt_id);

    CREATE TABLE app.prompt_usage_events (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      owner_id bigint NOT NULL,
      prompt_id varchar(64) NOT NULL,
      action varchar(16) NOT NULL CHECK (action IN ('copy', 'apply', 'generate')),
      idempotency_key varchar(128),
      generation_run_id varchar(64),
      created_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (owner_id, prompt_id) REFERENCES app.prompts(owner_id, id)
    );
    CREATE UNIQUE INDEX prompt_usage_idempotency_idx
      ON app.prompt_usage_events(owner_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL;
    CREATE INDEX prompt_usage_prompt_idx
      ON app.prompt_usage_events(owner_id, prompt_id, created_at DESC);

    CREATE TABLE app.sync_changes (
      seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      owner_id bigint NOT NULL,
      entity_type varchar(16) NOT NULL CHECK (entity_type IN ('prompt', 'folder', 'tag')),
      entity_id varchar(64) NOT NULL,
      operation varchar(16) NOT NULL CHECK (operation IN ('upsert', 'delete')),
      entity_version integer NOT NULL CHECK (entity_version > 0),
      snapshot jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX sync_changes_owner_seq_idx
      ON app.sync_changes(owner_id, seq);
    CREATE INDEX sync_changes_owner_entity_idx
      ON app.sync_changes(owner_id, entity_type, entity_id, seq DESC);

    ALTER TABLE app.prompt_folders ENABLE ROW LEVEL SECURITY;
    ALTER TABLE app.prompt_folders FORCE ROW LEVEL SECURITY;
    CREATE POLICY prompt_folders_owner_policy ON app.prompt_folders
      USING (owner_id = app.current_owner_id())
      WITH CHECK (owner_id = app.current_owner_id());

    ALTER TABLE app.prompt_tags ENABLE ROW LEVEL SECURITY;
    ALTER TABLE app.prompt_tags FORCE ROW LEVEL SECURITY;
    CREATE POLICY prompt_tags_owner_policy ON app.prompt_tags
      USING (owner_id = app.current_owner_id())
      WITH CHECK (owner_id = app.current_owner_id());

    ALTER TABLE app.prompts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE app.prompts FORCE ROW LEVEL SECURITY;
    CREATE POLICY prompts_owner_policy ON app.prompts
      USING (owner_id = app.current_owner_id())
      WITH CHECK (owner_id = app.current_owner_id());

    ALTER TABLE app.prompt_tag_links ENABLE ROW LEVEL SECURITY;
    ALTER TABLE app.prompt_tag_links FORCE ROW LEVEL SECURITY;
    CREATE POLICY prompt_tag_links_owner_policy ON app.prompt_tag_links
      USING (owner_id = app.current_owner_id())
      WITH CHECK (owner_id = app.current_owner_id());

    ALTER TABLE app.prompt_usage_events ENABLE ROW LEVEL SECURITY;
    ALTER TABLE app.prompt_usage_events FORCE ROW LEVEL SECURITY;
    CREATE POLICY prompt_usage_events_owner_policy ON app.prompt_usage_events
      USING (owner_id = app.current_owner_id())
      WITH CHECK (owner_id = app.current_owner_id());

    ALTER TABLE app.sync_changes ENABLE ROW LEVEL SECURITY;
    ALTER TABLE app.sync_changes FORCE ROW LEVEL SECURITY;
    CREATE POLICY sync_changes_owner_policy ON app.sync_changes
      USING (owner_id = app.current_owner_id())
      WITH CHECK (owner_id = app.current_owner_id());

    DO $permissions$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'musefold_app') THEN
        GRANT USAGE ON SCHEMA app TO musefold_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON
          app.prompt_folders, app.prompt_tags, app.prompts,
          app.prompt_tag_links, app.prompt_usage_events, app.sync_changes
          TO musefold_app;
        GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO musefold_app;
      END IF;
    END
    $permissions$;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS app.sync_changes;
    DROP TABLE IF EXISTS app.prompt_usage_events;
    DROP TABLE IF EXISTS app.prompt_tag_links;
    DROP TABLE IF EXISTS app.prompts;
    DROP TABLE IF EXISTS app.prompt_tags;
    DROP TABLE IF EXISTS app.prompt_folders;
  `);
};
