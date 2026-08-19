'use strict';

exports.up = (pgm) => {
  pgm.sql(`
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
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'musefold_worker') THEN
        ALTER FUNCTION app.enqueue_generation(text) OWNER TO musefold_worker;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'musefold_app') THEN
          GRANT EXECUTE ON FUNCTION app.enqueue_generation(text) TO musefold_app;
        END IF;
      END IF;
    END
    $permissions$;
  `);
};

exports.down = (pgm) => {
  pgm.sql('');
};
