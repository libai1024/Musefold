'use strict';

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE app.generation_runs
      DROP CONSTRAINT IF EXISTS generation_runs_approval_status_check;
    ALTER TABLE app.generation_runs
      ADD CONSTRAINT generation_runs_approval_status_check
      CHECK (approval_status IN ('not_required', 'pending_approval', 'approved', 'rejected', 'expired'));
    ALTER TABLE app.generation_runs
      ADD COLUMN IF NOT EXISTS mcp_grant_id uuid,
      ADD COLUMN IF NOT EXISTS approval_token_hash char(64),
      ADD COLUMN IF NOT EXISTS approval_expires_at timestamptz,
      ADD COLUMN IF NOT EXISTS approved_at timestamptz,
      ADD COLUMN IF NOT EXISTS skill_id varchar(120),
      ADD COLUMN IF NOT EXISTS skill_version varchar(32),
      ADD COLUMN IF NOT EXISTS skill_content_hash char(71),
      ADD COLUMN IF NOT EXISTS skill_inputs jsonb;

    CREATE TABLE auth.oauth_clients (
      client_id varchar(128) PRIMARY KEY,
      client_name varchar(160) NOT NULL,
      redirect_uris jsonb NOT NULL,
      token_endpoint_auth_method varchar(32) NOT NULL DEFAULT 'none'
        CHECK (token_endpoint_auth_method IN ('none', 'client_secret_post')),
      client_secret_hash char(64),
      registration_type varchar(24) NOT NULL DEFAULT 'dynamic'
        CHECK (registration_type IN ('pre_registered', 'metadata', 'dynamic')),
      created_at timestamptz NOT NULL DEFAULT now(),
      revoked_at timestamptz,
      CHECK (jsonb_typeof(redirect_uris) = 'array')
    );

    CREATE TABLE auth.oauth_grants (
      id uuid PRIMARY KEY,
      owner_id bigint NOT NULL,
      client_id varchar(128) NOT NULL REFERENCES auth.oauth_clients(client_id),
      scopes text[] NOT NULL,
      mode varchar(32) NOT NULL DEFAULT 'ask_each_time'
        CHECK (mode IN ('ask_each_time', 'auto_with_limits')),
      max_points_per_generation integer NOT NULL DEFAULT 0 CHECK (max_points_per_generation >= 0),
      max_points_per_day integer NOT NULL DEFAULT 0 CHECK (max_points_per_day >= 0),
      allowed_model_aliases text[] NOT NULL DEFAULT ARRAY['musefold-image-pro'],
      created_at timestamptz NOT NULL DEFAULT now(),
      last_used_at timestamptz,
      suspended_at timestamptz,
      revoked_at timestamptz,
      UNIQUE (owner_id, client_id)
    );
    CREATE INDEX oauth_grants_owner_idx ON auth.oauth_grants(owner_id, created_at DESC);

    CREATE TABLE auth.oauth_authorization_codes (
      code_hash char(64) PRIMARY KEY,
      grant_id uuid NOT NULL REFERENCES auth.oauth_grants(id) ON DELETE CASCADE,
      client_id varchar(128) NOT NULL,
      redirect_uri text NOT NULL,
      code_challenge varchar(256) NOT NULL,
      resource text NOT NULL,
      scopes text[] NOT NULL,
      expires_at timestamptz NOT NULL,
      used_at timestamptz
    );
    CREATE INDEX oauth_authorization_codes_expiry_idx ON auth.oauth_authorization_codes(expires_at);

    CREATE TABLE auth.oauth_access_tokens (
      token_hash char(64) PRIMARY KEY,
      grant_id uuid NOT NULL REFERENCES auth.oauth_grants(id) ON DELETE CASCADE,
      owner_id bigint NOT NULL,
      client_id varchar(128) NOT NULL,
      scopes text[] NOT NULL,
      resource text NOT NULL,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      revoked_at timestamptz
    );
    CREATE INDEX oauth_access_tokens_expiry_idx ON auth.oauth_access_tokens(expires_at);

    CREATE TABLE auth.oauth_refresh_tokens (
      token_hash char(64) PRIMARY KEY,
      family_id uuid NOT NULL,
      grant_id uuid NOT NULL REFERENCES auth.oauth_grants(id) ON DELETE CASCADE,
      previous_hash char(64),
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      used_at timestamptz,
      revoked_at timestamptz
    );
    CREATE INDEX oauth_refresh_tokens_family_idx ON auth.oauth_refresh_tokens(family_id);

    CREATE TABLE app.published_skills (
      id varchar(120) NOT NULL,
      version varchar(32) NOT NULL,
      title varchar(160) NOT NULL,
      summary varchar(500) NOT NULL,
      content text NOT NULL,
      input_schema jsonb NOT NULL,
      content_hash char(71) NOT NULL,
      status varchar(16) NOT NULL DEFAULT 'published'
        CHECK (status IN ('draft', 'published', 'retired')),
      created_at timestamptz NOT NULL DEFAULT now(),
      published_at timestamptz,
      PRIMARY KEY (id, version),
      UNIQUE (id, version, content_hash)
    );

    INSERT INTO app.published_skills(id, version, title, summary, content, input_schema, content_hash, published_at)
    VALUES (
      'postcard', '1.0.0', '明信片视觉', '将主题组织成适合明信片印刷的单张视觉构图。',
      E'# Musefold Postcard Skill\\n\\nCreate one finished postcard image with a clear focal subject, generous margins, balanced typography-safe space, and a print-friendly composition. Do not add illegible text unless the user explicitly asks for it.\\n',
      '{"type":"object","properties":{"subject":{"type":"string","minLength":1},"mood":{"type":"string"},"message":{"type":"string"}},"required":["subject"]}'::jsonb,
      'sha256:6984a69ab067e3670881053ff8866d61cfe01aae1b63827a8f462b446b78ed2c', now()
    )
    ON CONFLICT (id, version) DO NOTHING;

    CREATE TABLE app.mcp_spend_reservations (
      id uuid PRIMARY KEY,
      owner_id bigint NOT NULL,
      grant_id uuid NOT NULL REFERENCES auth.oauth_grants(id) ON DELETE CASCADE,
      generation_run_id varchar(64) NOT NULL,
      estimated_points integer NOT NULL CHECK (estimated_points >= 0),
      actual_points integer CHECK (actual_points IS NULL OR actual_points >= 0),
      status varchar(16) NOT NULL DEFAULT 'reserved'
        CHECK (status IN ('reserved', 'settled', 'released')),
      reserved_at timestamptz NOT NULL DEFAULT now(),
      settled_at timestamptz,
      released_at timestamptz,
      UNIQUE (generation_run_id)
    );

    ALTER TABLE app.published_skills ENABLE ROW LEVEL SECURITY;
    ALTER TABLE app.published_skills FORCE ROW LEVEL SECURITY;
    CREATE POLICY published_skills_public_read_policy ON app.published_skills
      FOR SELECT USING (status = 'published');

    DO $permissions$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'musefold_app') THEN
        GRANT USAGE ON SCHEMA auth TO musefold_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON auth.oauth_clients, auth.oauth_grants,
          auth.oauth_authorization_codes, auth.oauth_access_tokens, auth.oauth_refresh_tokens TO musefold_app;
        GRANT SELECT ON app.published_skills TO musefold_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON app.mcp_spend_reservations TO musefold_app;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'musefold_worker') THEN
        GRANT USAGE ON SCHEMA auth TO musefold_worker;
        GRANT SELECT ON auth.oauth_grants TO musefold_worker;
        GRANT SELECT, UPDATE ON app.generation_runs TO musefold_worker;
        GRANT SELECT, INSERT, UPDATE ON app.mcp_spend_reservations TO musefold_worker;
        GRANT SELECT ON app.published_skills TO musefold_worker;
      END IF;
    END
    $permissions$;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS app.mcp_spend_reservations;
    DROP TABLE IF EXISTS app.published_skills;
    DROP TABLE IF EXISTS auth.oauth_refresh_tokens;
    DROP TABLE IF EXISTS auth.oauth_access_tokens;
    DROP TABLE IF EXISTS auth.oauth_authorization_codes;
    DROP TABLE IF EXISTS auth.oauth_grants;
    DROP TABLE IF EXISTS auth.oauth_clients;
    ALTER TABLE app.generation_runs
      DROP COLUMN IF EXISTS mcp_grant_id,
      DROP COLUMN IF EXISTS approval_token_hash,
      DROP COLUMN IF EXISTS approval_expires_at,
      DROP COLUMN IF EXISTS approved_at,
      DROP COLUMN IF EXISTS skill_id,
      DROP COLUMN IF EXISTS skill_version,
      DROP COLUMN IF EXISTS skill_content_hash,
      DROP COLUMN IF EXISTS skill_inputs;
    ALTER TABLE app.generation_runs DROP CONSTRAINT IF EXISTS generation_runs_approval_status_check;
    ALTER TABLE app.generation_runs
      ADD CONSTRAINT generation_runs_approval_status_check
      CHECK (approval_status IN ('not_required', 'pending', 'approved', 'rejected', 'expired'));
  `);
};
