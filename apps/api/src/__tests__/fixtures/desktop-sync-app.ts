import { createDatabase, migrateDatabase } from '@musefold/db';
import type { PromptDocument } from '@musefold/contracts';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { IdentityApiProcess, startIdentityProxy } from './account-identity-process.js';
import { startNewApiIdentityFixture } from './new-api-identity-fixture.js';
import { runSyncRetentionProcess } from './sync-retention-runner.js';

/** Real production API/auth; only the upstream account provider is controlled. */
export async function startDesktopSyncApp() {
  const container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const database = createDatabase(container.getConnectionUri(), { max: 5 });
  const connectionEnds: Promise<void>[] = [];
  let databaseErrors = 0;
  database.pool.on('error', () => {
    databaseErrors++;
  });
  database.pool.on('connect', (client) => {
    connectionEnds.push(new Promise<void>((resolve) => client.once('end', resolve)));
    client.on('error', () => {
      databaseErrors++;
    });
  });
  let upstream: Awaited<ReturnType<typeof startNewApiIdentityFixture>> | undefined;
  let proxy: Awaited<ReturnType<typeof startIdentityProxy>> | undefined;
  let api: IdentityApiProcess | undefined;
  async function close() {
    const results = await Promise.allSettled([proxy?.close(), api?.stop(), upstream?.close()]);
    await database.pool.end();
    // pg-pool resolves end after removing idle clients, before every socket emits end.
    // Keep PostgreSQL alive until those sockets are closed; unexpected errors still fail.
    await Promise.all(connectionEnds);
    await container.stop();
    for (const result of results) if (result.status === 'rejected') throw result.reason;
    if (databaseErrors) throw new Error('Desktop sync fixture had PostgreSQL connection errors');
    return { apiExitCode: api?.child.exitCode, apiExitSignal: api?.child.signalCode };
  }
  try {
    await migrateDatabase(database.db);
    upstream = await startNewApiIdentityFixture();
    for (const [id, username] of [
      [42, 'b67-alice'],
      [43, 'b67-bob'],
    ] as const) {
      upstream.addOwner({ id, username });
      upstream.mapUsername(username, id);
    }
    proxy = await startIdentityProxy();
    api = await IdentityApiProcess.start({
      databaseUrl: container.getConnectionUri(),
      apiIssuer: proxy.url,
      upstreamIssuer: upstream.baseUrl,
      name: 'desktop-sync-real-api',
    });
    proxy.select(api);
    const activeProxy = proxy;
    const activeUpstream = upstream;
    const activeApi = api;
    return {
      database,
      ready: { baseUrl: proxy.url, apiPid: api.pid, fixturePid: process.pid },
      async trimSyncHistory() {
        // Advance only the explicit maintenance clock. API/auth clocks remain real.
        // Subsequent replay receipts are not aged or trimmed again in this fixture step.
        const maintenanceAt = new Date(Date.now() + 91 * 24 * 60 * 60 * 1000);
        const result = await runSyncRetentionProcess(container.getConnectionUri(), maintenanceAt);
        const counts = (
          await database.pool.query<{ logs: number; receipts: number; markers: number }>(
            `SELECT (SELECT count(*)::int FROM sync_change_log) AS logs,
            (SELECT count(*)::int FROM sync_mutation_results) AS receipts,
            (SELECT count(*)::int FROM sync_taxonomy_tombstones) AS markers`,
          )
        ).rows[0];
        return {
          ...result,
          counts,
          provenance:
            'production worker trim in a new Node process; explicit maintenance clock advanced91days; not natural91days and not a scheduled worker-bin test',
        };
      },
      async snapshot() {
        const [owners, prompts, devices, receipts, counts, classifications, tombstones] =
          await Promise.all([
            database.pool.query<{ id: string; upstreamOwner: string }>(
              'SELECT user_id AS id, upstream_owner_id AS "upstreamOwner" FROM account_identities ORDER BY upstream_owner_id',
            ),
            database.pool.query<
              Pick<PromptDocument, 'id' | 'title' | 'content' | 'version'> & { ownerId: string }
            >(
              'SELECT id,user_id AS "ownerId",title,content,version FROM prompts ORDER BY user_id,id',
            ),
            database.pool.query<{ ownerId: string; deviceId: string; cursor: string }>(
              'SELECT user_id AS "ownerId",device_id AS "deviceId",last_pull_cursor::text AS cursor FROM sync_devices ORDER BY user_id,device_id',
            ),
            database.pool.query<{ ownerId: string; mutationId: string; entityId: string }>(
              'SELECT user_id AS "ownerId",mutation_id AS "mutationId",entity_id AS "entityId" FROM sync_mutation_results ORDER BY user_id,mutation_id',
            ),
            database.pool.query<{ schemes: number; generations: number }>(
              'SELECT (SELECT count(*)::int FROM design_schemes) AS schemes,(SELECT count(*)::int FROM generation_runs) AS generations',
            ),
            database.pool.query<{ ownerId: string; kind: string; id: string }>(
              `SELECT user_id AS "ownerId",'folder' AS kind,id FROM prompt_folders
             UNION ALL SELECT user_id,'tag',id FROM prompt_tags ORDER BY "ownerId",kind,id`,
            ),
            database.pool.query<{ ownerId: string; kind: string; id: string; version: number }>(
              `SELECT user_id AS "ownerId",entity_type AS kind,entity_id AS id,version
             FROM sync_taxonomy_tombstones ORDER BY user_id,entity_type,entity_id`,
            ),
          ]);
        return {
          owners: owners.rows,
          prompts: prompts.rows,
          devices: devices.rows,
          receipts: receipts.rows,
          counts: counts.rows[0],
          classifications: classifications.rows,
          taxonomyTombstones: tombstones.rows,
          requests: activeProxy.observations,
          heldResponses: activeProxy.heldSyncPushResponses,
          unknownUpstreamRequests: activeUpstream.count({ operation: 'unknown' }),
          apiOutputSafe:
            !activeApi.outputWasTruncated &&
            !['fixture-password', 'fixture-jwt-', 'fixture-refresh-', 'sk-fixture-'].some((value) =>
              activeApi.containsOutput(value),
            ),
        };
      },
      async expireSession(upstreamOwner: '42' | '43') {
        const result = await database.pool.query<{ id: string }>(
          `UPDATE session SET expires_at=now()-interval '1 second'
           WHERE user_id=(SELECT user_id FROM account_identities WHERE upstream_owner_id=$1)
           RETURNING id`,
          [upstreamOwner],
        );
        return { expired: result.rowCount };
      },
      holdPush() {
        activeProxy.holdNextSyncPushResponse();
      },
      releasePush() {
        activeProxy.releaseSyncPushResponses();
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

export type DesktopSyncApp = Awaited<ReturnType<typeof startDesktopSyncApp>>;
export type DesktopSyncCloudSnapshot = Awaited<ReturnType<DesktopSyncApp['snapshot']>>;
