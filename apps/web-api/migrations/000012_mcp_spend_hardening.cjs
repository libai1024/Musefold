"use strict";

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE auth.oauth_grants
      ADD CONSTRAINT oauth_grants_owner_id_id_unique UNIQUE (owner_id, id);

    ALTER TABLE app.generation_runs
      ADD CONSTRAINT generation_runs_mcp_grant_owner_fk
      FOREIGN KEY (owner_id, mcp_grant_id)
      REFERENCES auth.oauth_grants(owner_id, id);

    ALTER TABLE app.mcp_spend_reservations
      ADD CONSTRAINT mcp_spend_owner_grant_fk
        FOREIGN KEY (owner_id, grant_id)
        REFERENCES auth.oauth_grants(owner_id, id) ON DELETE CASCADE,
      ADD CONSTRAINT mcp_spend_owner_run_fk
        FOREIGN KEY (owner_id, generation_run_id)
        REFERENCES app.generation_runs(owner_id, id) ON DELETE CASCADE;

    CREATE INDEX mcp_spend_grant_daily_idx
      ON app.mcp_spend_reservations(grant_id, reserved_at)
      WHERE status IN ('reserved', 'settled');

    ALTER TABLE app.mcp_spend_reservations ENABLE ROW LEVEL SECURITY;
    ALTER TABLE app.mcp_spend_reservations FORCE ROW LEVEL SECURITY;
    CREATE POLICY mcp_spend_reservations_owner_policy
      ON app.mcp_spend_reservations
      USING (owner_id = app.current_owner_id())
      WITH CHECK (owner_id = app.current_owner_id());
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP POLICY IF EXISTS mcp_spend_reservations_owner_policy
      ON app.mcp_spend_reservations;
    ALTER TABLE app.mcp_spend_reservations DISABLE ROW LEVEL SECURITY;
    DROP INDEX IF EXISTS app.mcp_spend_grant_daily_idx;
    ALTER TABLE app.mcp_spend_reservations
      DROP CONSTRAINT IF EXISTS mcp_spend_owner_run_fk,
      DROP CONSTRAINT IF EXISTS mcp_spend_owner_grant_fk;
    ALTER TABLE app.generation_runs
      DROP CONSTRAINT IF EXISTS generation_runs_mcp_grant_owner_fk;
    ALTER TABLE auth.oauth_grants
      DROP CONSTRAINT IF EXISTS oauth_grants_owner_id_id_unique;
  `);
};
