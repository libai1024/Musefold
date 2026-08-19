'use strict';

exports.up = (pgm) => {
  pgm.sql(`
    CREATE EXTENSION IF NOT EXISTS pg_trgm;

    CREATE SCHEMA IF NOT EXISTS app;
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE SCHEMA IF NOT EXISTS ops;

    CREATE OR REPLACE FUNCTION app.current_owner_id()
    RETURNS bigint
    LANGUAGE sql
    STABLE
    PARALLEL SAFE
    AS $$
      SELECT NULLIF(current_setting('app.owner_id', true), '')::bigint
    $$;

    CREATE TABLE app.cloud_accounts (
      owner_id bigint PRIMARY KEY,
      username_snapshot varchar(64) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deletion_requested_at timestamptz
    );

    ALTER TABLE app.cloud_accounts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE app.cloud_accounts FORCE ROW LEVEL SECURITY;
    CREATE POLICY cloud_accounts_owner_policy ON app.cloud_accounts
      USING (owner_id = app.current_owner_id())
      WITH CHECK (owner_id = app.current_owner_id());

    CREATE TABLE auth.web_sessions (
      id_hash char(64) PRIMARY KEY,
      owner_id bigint NOT NULL,
      username_snapshot varchar(64) NOT NULL,
      access_ciphertext bytea NOT NULL,
      refresh_ciphertext bytea NOT NULL,
      nonce bytea NOT NULL,
      auth_tag bytea NOT NULL,
      key_version integer NOT NULL CHECK (key_version > 0),
      access_expires_at timestamptz NOT NULL,
      csrf_nonce varchar(256) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      last_seen_at timestamptz NOT NULL DEFAULT now(),
      absolute_expires_at timestamptz NOT NULL,
      revoked_at timestamptz,
      CONSTRAINT web_sessions_expiry_order CHECK (absolute_expires_at > created_at)
    );
    CREATE INDEX web_sessions_owner_active_idx
      ON auth.web_sessions (owner_id, absolute_expires_at)
      WHERE revoked_at IS NULL;
    CREATE INDEX web_sessions_expiry_idx
      ON auth.web_sessions (absolute_expires_at)
      WHERE revoked_at IS NULL;

    CREATE TABLE ops.worker_heartbeats (
      worker_id uuid PRIMARY KEY,
      worker_kind varchar(64) NOT NULL,
      version varchar(32) NOT NULL,
      started_at timestamptz NOT NULL,
      heartbeat_at timestamptz NOT NULL
    );
    CREATE INDEX worker_heartbeats_kind_idx
      ON ops.worker_heartbeats (worker_kind, heartbeat_at DESC);

    DO $permissions$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'musefold_app') THEN
        GRANT USAGE ON SCHEMA app, ops TO musefold_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON app.cloud_accounts TO musefold_app;
        GRANT SELECT ON ops.worker_heartbeats TO musefold_app;
      END IF;

      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'musefold_worker') THEN
        GRANT USAGE ON SCHEMA app, auth, ops TO musefold_worker;
        GRANT SELECT, INSERT, UPDATE, DELETE ON app.cloud_accounts TO musefold_worker;
        GRANT SELECT, DELETE ON auth.web_sessions TO musefold_worker;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ops.worker_heartbeats TO musefold_worker;
      END IF;
    END
    $permissions$;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP SCHEMA IF EXISTS ops CASCADE;
    DROP SCHEMA IF EXISTS auth CASCADE;
    DROP SCHEMA IF EXISTS app CASCADE;
  `);
};
