import { createHash } from 'node:crypto';
import type { Pool } from 'pg';

/** Disposable DB audit of actual outbox operations; never creates a business reference or trial. */
export async function generationCleanupObserver(pool: Pool) {
  await pool.query(`
    CREATE TABLE fixture_cleanup_observations (
      seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      operation text NOT NULL, object_key text NOT NULL, attempt_count integer NOT NULL
    );
    CREATE FUNCTION fixture_observe_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP='DELETE' THEN
        INSERT INTO fixture_cleanup_observations(operation,object_key,attempt_count)
          VALUES(TG_OP,OLD.object_key,OLD.attempt_count);
        RETURN OLD;
      END IF;
      INSERT INTO fixture_cleanup_observations(operation,object_key,attempt_count)
        VALUES(TG_OP,NEW.object_key,NEW.attempt_count);
      RETURN NEW;
    END $$;
    CREATE TRIGGER fixture_observe_cleanup AFTER INSERT OR UPDATE OR DELETE ON object_cleanup_queue
      FOR EACH ROW EXECUTE FUNCTION fixture_observe_cleanup();
  `);
  const withHash = ({ object_key, ...row }: Record<string, unknown>) => ({
    ...row,
    keyHash: createHash('sha256').update(String(object_key)).digest('hex'),
  });
  return {
    /** Deliberately accelerated expiry, distinct from natural-clock acceptance. */
    async expireReference(id: string) {
      const result = await pool.query(
        `
        WITH prior AS (SELECT id,expires_at FROM generation_reference_uploads WHERE id=$1 FOR UPDATE)
        UPDATE generation_reference_uploads current SET expires_at=clock_timestamp()-interval '1 second'
        FROM prior WHERE current.id=prior.id
        RETURNING current.id,prior.expires_at AS original_expires_at,current.expires_at AS forced_expires_at
      `,
        [id],
      );
      if (result.rowCount !== 1) throw new Error('Missing owned reference for accelerated cleanup');
      return result.rows[0];
    },
    async snapshot() {
      return {
        audit: (
          await pool.query(
            'SELECT operation,object_key,attempt_count FROM fixture_cleanup_observations ORDER BY seq',
          )
        ).rows.map(withHash),
        uploads: (
          await pool.query(
            'SELECT id,status,expires_at,cleanup_queued_at,object_key FROM generation_reference_uploads ORDER BY id',
          )
        ).rows.map(withHash),
        references: (
          await pool.query(
            'SELECT generation_run_id,asset_id,position,object_key,content_hash FROM design_scheme_generation_references ORDER BY generation_run_id,position',
          )
        ).rows.map(withHash),
      };
    },
    async close() {
      await pool.query(`
        DROP TRIGGER IF EXISTS fixture_observe_cleanup ON object_cleanup_queue;
        DROP FUNCTION IF EXISTS fixture_observe_cleanup();
        DROP TABLE IF EXISTS fixture_cleanup_observations;
      `);
    },
  };
}
