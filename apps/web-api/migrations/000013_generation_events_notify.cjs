'use strict';

exports.up = (pgm) => {
  pgm.sql(`
    CREATE OR REPLACE FUNCTION app.notify_generation_event()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, app, pg_temp
    AS $$
    BEGIN
      PERFORM pg_notify(
        'musefold_generation_events',
        json_build_object(
          'ownerId', NEW.owner_id,
          'runId', NEW.run_id,
          'seq', NEW.seq
        )::text
      );
      RETURN NEW;
    END
    $$;

    DROP TRIGGER IF EXISTS generation_events_notify_trigger ON app.generation_events;
    CREATE TRIGGER generation_events_notify_trigger
      AFTER INSERT ON app.generation_events
      FOR EACH ROW EXECUTE FUNCTION app.notify_generation_event();
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS generation_events_notify_trigger ON app.generation_events;
    DROP FUNCTION IF EXISTS app.notify_generation_event();
  `);
};
