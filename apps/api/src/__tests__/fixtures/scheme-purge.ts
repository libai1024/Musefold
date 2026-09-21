import { randomUUID } from 'node:crypto';
import type { createDatabase } from '@musefold/db';
import { runResultSchema } from '@musefold/contracts';
import { z } from 'zod';
import type { DesktopSyncApp } from './desktop-sync-app.js';

/** Synthetic business data on real migrated PostgreSQL; never a user's database. */
export async function seedPurgeScheme(database: ReturnType<typeof createDatabase>, userId: string) {
  const schemeId = randomUUID(),
    revisionId = randomUUID(),
    snapshotId = randomUUID();
  const assetKey = `users/${userId}/design-scheme-uploads/${randomUUID()}`;
  const sourceKey = `scheme-imports/${randomUUID()}/${randomUUID()}/source`;
  const runId = randomUUID();
  const result = runResultSchema.parse({
    runId,
    schemeId,
    revisionId,
    mode: 'trial',
    status: 'completed',
    compiledPrompt: 'Synthetic purge receipt',
    outputs: [],
    steps: [],
    evaluation: null,
    repair: null,
    error: null,
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  });
  await database.pool.query(
    `INSERT INTO design_schemes
    (id,user_id,name,source_presentation,current_revision_id,fidelity,deleted_at,version)
    VALUES($1,$2,'Synthetic purge scheme','musefold-created',$3,'faithful',now(),2)`,
    [schemeId, userId, revisionId],
  );
  await database.pool.query(
    `INSERT INTO design_scheme_revisions
    (revision_id,scheme_id,user_id,schema_version,document,created_by)
    VALUES($1,$2,$3,1,$4,'import')`,
    [revisionId, schemeId, userId, JSON.stringify({ schemeId, revisionId })],
  );
  await database.pool.query(
    `INSERT INTO design_scheme_assets
    (id,user_id,revision_id,object_key,role,origin,mime_type,width,height,content_hash)
    VALUES($1,$2,$3,$4,'reference','uploaded','image/png',1,1,$5)`,
    [randomUUID(), userId, revisionId, assetKey, 'a'.repeat(64)],
  );
  const packageId = randomUUID();
  await database.pool.query(
    `INSERT INTO design_scheme_source_packages(id,user_id,kind) VALUES($1,$2,'share-import')`,
    [packageId, userId],
  );
  await database.pool.query(
    `INSERT INTO design_scheme_source_snapshots(id,user_id,package_id,resolved_ref) VALUES($1,$2,$3,'')`,
    [snapshotId, userId, packageId],
  );
  await database.pool.query(
    `INSERT INTO design_scheme_source_files(snapshot_id,user_id,relative_path,kind,size_bytes,content_hash,object_key)
    VALUES($1,$2,'example.png','image',5,$3,$4)`,
    [snapshotId, userId, 'a'.repeat(64), sourceKey],
  );
  await database.pool.query(
    `INSERT INTO design_scheme_source_bindings(revision_id,source_snapshot_id,user_id,role)
    VALUES($1,$2,$3,'reference')`,
    [revisionId, snapshotId, userId],
  );
  await database.pool.query(
    `INSERT INTO design_scheme_runs(run_id,user_id,scheme_id,revision_id,mode,status,policy,result,completed_at)
    VALUES($1,$2,$3,$4,'trial','completed','{}',$5,now())`,
    [runId, userId, schemeId, revisionId, JSON.stringify(result)],
  );
  return { schemeId, revisionId, snapshotId, packageId, assetKey, sourceKey, runId, result };
}

export async function purgeHttp(app: DesktopSyncApp, token: string | undefined, body: unknown) {
  return fetch(`${app.ready.baseUrl}/api/v1/design-schemes/purge`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
}
export async function purgeLogin(app: DesktopSyncApp, username: 'b67-alice' | 'b67-bob') {
  const response = await fetch(`${app.ready.baseUrl}/api/auth/sign-in/new-api`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: app.ready.baseUrl,
      'x-musefold-login-binding': 'synthetic-purge-main-process-binding-123456',
    },
    body: JSON.stringify({ email: username, password: 'fixture-password' }),
  });
  if (response.status !== 200) throw new Error(`Fixture login failed: ${response.status}`);
  const data = z
    .object({ token: z.string().min(1), user: z.object({ id: z.string().min(1) }) })
    .parse(await response.json());
  const activation = await fetch(`${app.ready.baseUrl}/api/v1/account/login-sessions/touch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${data.token}` },
    body: JSON.stringify({ acknowledge: true }),
  });
  if (activation.status !== 200) throw new Error(`Fixture activation failed: ${activation.status}`);
  return { token: data.token, id: data.user.id };
}

export async function waitForPgBlock(database: ReturnType<typeof createDatabase>, blocker: number) {
  const until = Date.now() + 1500;
  while (Date.now() < until) {
    const result = await database.pool.query<{ pid: number }>(
      'SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))',
      [blocker],
    );
    if (result.rows[0]) return result.rows[0].pid;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Expected real PostgreSQL lock wait');
}
