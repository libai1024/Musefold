'use strict';

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE app.sync_retention_state (
      owner_id bigint PRIMARY KEY,
      min_available_cursor bigint NOT NULL DEFAULT 0 CHECK (min_available_cursor >= 0),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    ALTER TABLE app.sync_retention_state ENABLE ROW LEVEL SECURITY;
    ALTER TABLE app.sync_retention_state FORCE ROW LEVEL SECURITY;
    CREATE POLICY sync_retention_state_owner_policy ON app.sync_retention_state
      USING (owner_id = app.current_owner_id())
      WITH CHECK (owner_id = app.current_owner_id());

    DO $permissions$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'musefold_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON app.sync_retention_state TO musefold_app;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'musefold_worker') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON app.sync_retention_state TO musefold_worker;
      END IF;
    END
    $permissions$;
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS app.sync_retention_state;');
};
