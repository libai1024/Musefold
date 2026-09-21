import { createDatabase, migrateDatabase } from '@musefold/db';
import { createNewApiClient } from '@musefold/new-api-client';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { randomUUID } from 'node:crypto';
import { AccountService } from '../../modules/account/service.js';
import { IDENTITY_PROCESS_KEY, IdentityApiProcess } from './account-identity-process.js';

/** Production API PID and real New API image. No fabricated response or auth bypass. */
export async function startLoginSessionImageApp(upstreamIssuer: string, apiIssuer: string) {
  if (new URL(upstreamIssuer).hostname !== '127.0.0.1')
    throw new Error('Disposable local image required');
  const pg = await new PostgreSqlContainer('postgres:17-alpine').start();
  const database = createDatabase(pg.getConnectionUri());
  const newApi = createNewApiClient(upstreamIssuer);
  const account = new AccountService({
    db: database.db,
    newApi,
    upstreamIssuer,
    apiIssuer,
    encryptionKey: IDENTITY_PROCESS_KEY,
  });
  const proofs: { sid: string; token: string }[] = [];
  let api: IdentityApiProcess | undefined;
  const credentials = { username: 'sessionroot', password: 'synthetic-session-password' };
  const close = async () => {
    await api?.stop();
    try {
      await database.pool.query('DELETE FROM session');
      await account.loginSessions.sweep();
      for (const proof of proofs) await newApi.managedSessions?.release(proof);
    } finally {
      await database.pool.end();
      await pg.stop();
    }
  };
  try {
    await migrateDatabase(database.db);
    for (const userAgent of ['Musefold macOS', 'Firefox/128 Linux']) {
      const grant = await newApi.managedSessions?.begin(credentials);
      if (!grant) throw new Error('Managed protocol missing');
      const relay = await newApi.managedSessions?.complete(
        grant.flow_token,
        randomUUID(),
        [],
        userAgent,
      );
      if (!relay?.cleanup) throw new Error('Cleanup proof missing');
      proofs.push(relay.cleanup);
      await newApi.managedSessions?.touch(relay.jwt, true);
    }
    api = await IdentityApiProcess.start({
      databaseUrl: pg.getConnectionUri(),
      apiIssuer,
      upstreamIssuer,
      name: 'login-session-image-e2e',
    });
    return {
      url: api.url,
      async activeCount() {
        const grant = await newApi.managedSessions?.begin(credentials);
        if (!grant) throw new Error('Missing review');
        await newApi.managedSessions?.cancel(grant.flow_token);
        return grant.sessions.total;
      },
      async sweep() {
        await account.loginSessions.sweep();
      },
      async close() {
        await close();
        if (api?.outputWasTruncated || api?.containsOutput(credentials.password))
          throw new Error('Unsafe API output');
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
