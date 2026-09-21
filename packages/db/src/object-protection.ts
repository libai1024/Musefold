import type { MusefoldDatabase } from './client.js';
import { sql } from 'drizzle-orm';

/** Shared canonical-reference and active-lease policy for outbox and inventory. */
export async function findProtectedObjects(
  db: Pick<MusefoldDatabase, 'execute'>,
  objectKeys: string[],
  now = new Date(),
): Promise<{ permanent: string[]; leased: string[] }> {
  if (objectKeys.length === 0) return { permanent: [], leased: [] };
  const result = await db.execute<{
    object_key: string;
    protection: 'permanent' | 'leased';
  }>(sql`
      WITH candidates(object_key) AS (
        VALUES ${sql.join(
          objectKeys.map((key) => sql`(${key})`),
          sql`, `,
        )}
      )
      SELECT DISTINCT object_key, protection
      FROM (
        SELECT ga.object_key, 'permanent'::text AS protection
        FROM generation_assets ga
        WHERE ga.object_key IN (${sql.join(
          objectKeys.map((key) => sql`${key}`),
          sql`, `,
        )})
        UNION ALL
        -- Promoted scheme uploads no longer have a staging row. Their canonical
        -- assets protect the objects, including soft-deleted schemes, until purge.
        SELECT asset.object_key, 'permanent'::text AS protection
        FROM design_scheme_assets asset
        JOIN candidates candidate ON candidate.object_key = asset.object_key
        UNION ALL
        SELECT source.object_key, 'permanent'::text AS protection
        FROM design_scheme_source_files source
        JOIN candidates candidate ON candidate.object_key = source.object_key
        UNION ALL
        SELECT reference.object_key, 'permanent'::text AS protection
        FROM design_scheme_generation_references reference
        JOIN candidates candidate ON candidate.object_key = reference.object_key
        UNION ALL
        SELECT gru.object_key, 'permanent'::text AS protection
        FROM generation_reference_uploads gru
        WHERE gru.object_key IN (${sql.join(
          objectKeys.map((key) => sql`${key}`),
          sql`, `,
        )})
          AND EXISTS (
            SELECT 1
            FROM generation_reference_links grl
            WHERE grl.reference_id = gru.id AND grl.user_id = gru.user_id
          )
        UNION ALL
        -- Standalone Composer/scheme uploads are usable before any canonical
        -- link exists. A stale cleanup intent must not shorten their upload TTL.
        SELECT upload.object_key, 'leased'::text AS protection
        FROM generation_reference_uploads upload
        JOIN candidates candidate ON candidate.object_key = upload.object_key
        WHERE upload.status IN ('uploading', 'available') AND upload.expires_at > ${now}
          -- Package uploads share the registry but have their own cancellation/
          -- upload fence below. Their registry TTL must not extend that lease.
          AND NOT EXISTS (SELECT 1 FROM design_scheme_package_stages package
            WHERE package.object_key = upload.object_key)
        UNION ALL
        SELECT stage.object_key, 'leased'::text AS protection
        FROM design_scheme_package_stages stage
        JOIN candidates candidate ON candidate.object_key = stage.object_key
        WHERE stage.upload_lease_until > ${now}
          OR (stage.status IN ('awaiting_upload','ready','confirmed') AND stage.expires_at > ${now})
        UNION ALL
        SELECT candidate.object_key, 'leased'::text AS protection
        FROM candidates candidate
        JOIN design_scheme_package_imports imp
          ON starts_with(candidate.object_key, 'scheme-imports/' || imp.stage_id || '/' || imp.attempt_id || '/')
        WHERE imp.status = 'running' AND imp.lease_until > ${now}
        UNION ALL
        SELECT export_record.object_key, 'leased'::text AS protection
        FROM design_scheme_package_exports export_record
        JOIN candidates candidate ON candidate.object_key = export_record.object_key
        WHERE export_record.lease_until > ${now} OR (export_record.status = 'ready' AND export_record.expires_at > ${now})
        UNION ALL
        SELECT candidate.object_key, 'leased'::text AS protection
        FROM candidates candidate
        JOIN generation_runs run
          ON left(
            candidate.object_key,
            length('users/' || run.user_id || '/generations/' || run.id || '/')
          ) = 'users/' || run.user_id || '/generations/' || run.id || '/'
        WHERE run.status IN ('queued', 'running', 'cancelling')
          AND (run.status = 'queued' OR run.lease_expires_at > ${now})
      ) protected
    `);
  const permanent = new Set<string>();
  const leased = new Set<string>();
  for (const row of result.rows) {
    if (row.protection === 'permanent') permanent.add(row.object_key);
    else leased.add(row.object_key);
  }
  for (const objectKey of permanent) leased.delete(objectKey);
  return { permanent: [...permanent], leased: [...leased] };
}
