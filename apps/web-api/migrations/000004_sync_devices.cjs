'use strict';

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE app.sync_devices (
      owner_id bigint NOT NULL,
      id uuid NOT NULL,
      name varchar(120) NOT NULL,
      platform varchar(16) NOT NULL CHECK (platform IN ('macos', 'windows', 'linux')),
      client_version varchar(32) NOT NULL,
      last_pull_seq bigint NOT NULL DEFAULT 0 CHECK (last_pull_seq >= 0),
      last_seen_at timestamptz NOT NULL DEFAULT now(),
      revoked_at timestamptz,
      PRIMARY KEY (owner_id, id)
    );
    CREATE INDEX sync_devices_owner_seen_idx
      ON app.sync_devices(owner_id, last_seen_at DESC);

    CREATE TABLE app.sync_mutations (
      owner_id bigint NOT NULL,
      device_id uuid NOT NULL,
      mutation_id varchar(64) NOT NULL,
      entity_type varchar(16) NOT NULL CHECK (entity_type IN ('prompt', 'folder', 'tag')),
      entity_id varchar(64) NOT NULL,
      result_status varchar(16) NOT NULL CHECK (result_status IN ('applied', 'duplicate', 'conflict', 'rejected')),
      result_version integer,
      result_snapshot jsonb,
      error_code varchar(80),
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (owner_id, device_id, mutation_id),
      FOREIGN KEY (owner_id, device_id) REFERENCES app.sync_devices(owner_id, id)
    );
    CREATE INDEX sync_mutations_owner_created_idx
      ON app.sync_mutations(owner_id, created_at DESC);

    ALTER TABLE app.sync_devices ENABLE ROW LEVEL SECURITY;
    ALTER TABLE app.sync_devices FORCE ROW LEVEL SECURITY;
    CREATE POLICY sync_devices_owner_policy ON app.sync_devices
      USING (owner_id = app.current_owner_id())
      WITH CHECK (owner_id = app.current_owner_id());

    ALTER TABLE app.sync_mutations ENABLE ROW LEVEL SECURITY;
    ALTER TABLE app.sync_mutations FORCE ROW LEVEL SECURITY;
    CREATE POLICY sync_mutations_owner_policy ON app.sync_mutations
      USING (owner_id = app.current_owner_id())
      WITH CHECK (owner_id = app.current_owner_id());

    DO $permissions$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'musefold_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON app.sync_devices, app.sync_mutations TO musefold_app;
      END IF;
    END
    $permissions$;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS app.sync_mutations;
    DROP TABLE IF EXISTS app.sync_devices;
  `);
};
