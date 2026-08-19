'use strict';

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE app.workbench_sessions (
      owner_id bigint NOT NULL,
      id varchar(64) NOT NULL,
      title varchar(120) NOT NULL,
      draft_prompt text NOT NULL DEFAULT '',
      draft_negative varchar(4000) NOT NULL DEFAULT '',
      draft_params jsonb NOT NULL DEFAULT '{}'::jsonb,
      prompt_reference_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
      version integer NOT NULL DEFAULT 1 CHECK (version > 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      archived_at timestamptz,
      deleted_at timestamptz,
      PRIMARY KEY (owner_id, id),
      CHECK (pg_column_size(draft_params) <= 32768),
      CHECK (jsonb_typeof(prompt_reference_ids) = 'array')
    );
    CREATE INDEX workbench_sessions_owner_updated_idx
      ON app.workbench_sessions(owner_id, updated_at DESC, id DESC);

    CREATE TABLE app.generation_runs (
      owner_id bigint NOT NULL,
      id varchar(64) NOT NULL,
      session_id varchar(64),
      parent_run_id varchar(64),
      prompt_id varchar(64),
      run_kind varchar(24) NOT NULL DEFAULT 'free_generation'
        CHECK (run_kind IN ('free_generation', 'refinement', 'retry')),
      actor_type varchar(16) NOT NULL DEFAULT 'web'
        CHECK (actor_type IN ('web', 'cloud_mcp')),
      approval_status varchar(24) NOT NULL DEFAULT 'not_required'
        CHECK (approval_status IN ('not_required', 'pending', 'approved', 'rejected', 'expired')),
      prompt_snapshot jsonb,
      request jsonb NOT NULL,
      provider_model varchar(128),
      status varchar(24) NOT NULL
        CHECK (status IN ('pending_approval', 'queued', 'running', 'succeeded', 'failed', 'cancelling', 'cancelled', 'rejected', 'expired')),
      progress smallint NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
      idempotency_key varchar(128) NOT NULL,
      error_code varchar(80),
      error_detail_safe varchar(500),
      cost_points integer CHECK (cost_points IS NULL OR cost_points >= 0),
      attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      upstream_request_sent boolean NOT NULL DEFAULT false,
      lease_expires_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      started_at timestamptz,
      finished_at timestamptz,
      cancelled_at timestamptz,
      deleted_at timestamptz,
      PRIMARY KEY (owner_id, id),
      UNIQUE (owner_id, idempotency_key),
      FOREIGN KEY (owner_id, session_id) REFERENCES app.workbench_sessions(owner_id, id),
      FOREIGN KEY (owner_id, parent_run_id) REFERENCES app.generation_runs(owner_id, id),
      FOREIGN KEY (owner_id, prompt_id) REFERENCES app.prompts(owner_id, id),
      CHECK (pg_column_size(request) <= 65536),
      CHECK (prompt_snapshot IS NULL OR pg_column_size(prompt_snapshot) <= 65536)
    );
    CREATE INDEX generation_runs_owner_history_idx
      ON app.generation_runs(owner_id, created_at DESC, id DESC);
    CREATE INDEX generation_runs_session_idx
      ON app.generation_runs(owner_id, session_id, created_at, id)
      WHERE session_id IS NOT NULL;
    CREATE INDEX generation_runs_recovery_idx
      ON app.generation_runs(status, lease_expires_at)
      WHERE status IN ('queued', 'running', 'cancelling');

    CREATE TABLE app.generation_assets (
      owner_id bigint NOT NULL,
      id varchar(64) NOT NULL,
      run_id varchar(64) NOT NULL,
      object_key text NOT NULL,
      mime_type varchar(32) NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
      width integer NOT NULL CHECK (width > 0),
      height integer NOT NULL CHECK (height > 0),
      byte_size bigint NOT NULL CHECK (byte_size >= 0),
      checksum_sha256 char(64) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz,
      PRIMARY KEY (owner_id, id),
      UNIQUE (object_key),
      FOREIGN KEY (owner_id, run_id) REFERENCES app.generation_runs(owner_id, id)
    );
    CREATE INDEX generation_assets_run_idx ON app.generation_assets(owner_id, run_id, id);

    CREATE TABLE app.generation_events (
      seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      owner_id bigint NOT NULL,
      run_id varchar(64) NOT NULL,
      event_type varchar(80) NOT NULL,
      payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (owner_id, run_id) REFERENCES app.generation_runs(owner_id, id)
    );
    CREATE INDEX generation_events_owner_run_seq_idx
      ON app.generation_events(owner_id, run_id, seq);

    ALTER TABLE app.workbench_sessions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE app.workbench_sessions FORCE ROW LEVEL SECURITY;
    CREATE POLICY workbench_sessions_owner_policy ON app.workbench_sessions
      USING (owner_id = app.current_owner_id()) WITH CHECK (owner_id = app.current_owner_id());
    ALTER TABLE app.generation_runs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE app.generation_runs FORCE ROW LEVEL SECURITY;
    CREATE POLICY generation_runs_owner_policy ON app.generation_runs
      USING (owner_id = app.current_owner_id()) WITH CHECK (owner_id = app.current_owner_id());
    ALTER TABLE app.generation_assets ENABLE ROW LEVEL SECURITY;
    ALTER TABLE app.generation_assets FORCE ROW LEVEL SECURITY;
    CREATE POLICY generation_assets_owner_policy ON app.generation_assets
      USING (owner_id = app.current_owner_id()) WITH CHECK (owner_id = app.current_owner_id());
    ALTER TABLE app.generation_events ENABLE ROW LEVEL SECURITY;
    ALTER TABLE app.generation_events FORCE ROW LEVEL SECURITY;
    CREATE POLICY generation_events_owner_policy ON app.generation_events
      USING (owner_id = app.current_owner_id()) WITH CHECK (owner_id = app.current_owner_id());

    CREATE OR REPLACE FUNCTION app.enqueue_generation(p_run_id text)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
    AS $$
    DECLARE
      v_owner_id bigint;
    BEGIN
      v_owner_id := NULLIF(current_setting('app.owner_id', true), '')::bigint;
      IF v_owner_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM app.generation_runs
        WHERE owner_id = v_owner_id AND id = p_run_id AND status = 'queued'
      ) THEN
        RAISE EXCEPTION 'generation run is not queueable';
      END IF;
      EXECUTE 'SELECT graphile_worker.add_job($1, $2::json, NULL, NULL, 3, $3)'
        USING 'generation.generate', jsonb_build_object('runId', p_run_id, 'ownerId', v_owner_id), p_run_id;
    END
    $$;

    DO $permissions$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'musefold_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON
          app.workbench_sessions, app.generation_runs, app.generation_assets, app.generation_events
          TO musefold_app;
        GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO musefold_app;
        GRANT EXECUTE ON FUNCTION app.enqueue_generation(text) TO musefold_app;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'musefold_worker') THEN
        GRANT SELECT ON app.workbench_sessions, app.prompts TO musefold_worker;
        GRANT SELECT, UPDATE ON app.generation_runs TO musefold_worker;
        GRANT SELECT, INSERT, UPDATE, DELETE ON app.generation_assets, app.generation_events TO musefold_worker;
        GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO musefold_worker;
        ALTER FUNCTION app.enqueue_generation(text) OWNER TO musefold_worker;
        GRANT EXECUTE ON FUNCTION app.enqueue_generation(text) TO musefold_app;
      END IF;
    END
    $permissions$;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP FUNCTION IF EXISTS app.enqueue_generation(text);
    DROP TABLE IF EXISTS app.generation_events;
    DROP TABLE IF EXISTS app.generation_assets;
    DROP TABLE IF EXISTS app.generation_runs;
    DROP TABLE IF EXISTS app.workbench_sessions;
  `);
};
