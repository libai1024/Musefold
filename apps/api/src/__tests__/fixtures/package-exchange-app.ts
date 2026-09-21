import { randomUUID, createHash } from 'node:crypto';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { createDatabase, migrateDatabase } from '@musefold/db';
import { runMigrations } from 'graphile-worker';
import { createApp } from '../../app.js';
import { createAuth } from '../../auth/index.js';
import { loadEnv } from '../../env.js';
import { AccountService } from '../../modules/account/service.js';
import { GenerationService } from '../../modules/generation/service.js';
import { S3AssetUrlSigner } from '../../modules/generation/s3-signer.js';
import { SkillService } from '../../modules/mcp/skills.js';
import { PromptService } from '../../modules/prompts/service.js';
import { RateLimiter } from '../../modules/rate-limit/service.js';
import { SyncService } from '../../modules/sync/service.js';
import { WorkbenchService } from '../../modules/workbench/service.js';
import { startS3Fixture } from '../../modules/design-scheme-assets/__tests__/s3-fixture.js';
import { DesignSchemeAgentService } from '../../modules/design-scheme-agent/service.js';
import { DesignSchemeSourcePreparationService } from '../../modules/design-schemes/source-preparation.js';
import { DesignSchemeAssetService } from '../../modules/design-scheme-assets/service.js';
import type { GithubDesignSchemeSourceReader } from '../../modules/design-schemes/github-source-reader.js';
import { createFakeNewApi } from './fake-new-api.js';
import type { NewApiClient } from '@musefold/new-api-client';

/** Real auth/account/app/PG/AWS SDK. Only upstream New API and S3 server are controlled. */
export async function startPackageExchangeApp(
  options: {
    agent?: { modelEndpoint: string; sourceReader: GithubDesignSchemeSourceReader };
    publicBaseUrl?: string;
    onStartupPhase?: (phase: string) => void;
    newApi?: NewApiClient;
    upstreamIssuer?: string;
  } = {},
) {
  options.onStartupPhase?.('postgres-start');
  const container = await new PostgreSqlContainer('postgres:17-alpine').start();
  options.onStartupPhase?.('postgres-ready');
  const database = createDatabase(container.getConnectionUri(), { max: 10 });
  const connectionEnds: Promise<void>[] = [];
  let poolErrors = 0;
  database.pool.on('connect', (client) =>
    connectionEnds.push(new Promise<void>((resolve) => client.once('end', resolve))),
  );
  database.pool.on('error', () => {
    poolErrors++;
  });
  const s3 = await startS3Fixture();
  options.onStartupPhase?.('s3-ready');
  async function close() {
    try {
      await s3.close();
    } finally {
      try {
        await database.pool.end();
        // pg-pool can finish removing idle clients before their sockets emit end.
        // Stopping PostgreSQL earlier races a FATAL 57P01 into those closing clients.
        await Promise.all(connectionEnds);
      } finally {
        await container.stop();
      }
    }
    if (poolErrors) throw new Error('Package exchange fixture had PostgreSQL pool errors');
  }
  try {
    options.onStartupPhase?.('schema-migrate');
    await migrateDatabase(database.db);
    options.onStartupPhase?.('queue-migrate');
    await runMigrations({ pgPool: database.pool });
    options.onStartupPhase?.('auth-init');
    const env = loadEnv({
      NODE_ENV: 'test',
      PUBLIC_BASE_URL: options.publicBaseUrl ?? 'http://127.0.0.1:3399',
      DATABASE_URL: container.getConnectionUri(),
      BETTER_AUTH_SECRET: 'package-exchange-auth-fixture-secret',
      NEW_API_BASE_URL:
        options.upstreamIssuer ?? options.agent?.modelEndpoint ?? 'https://new-api.test',
      ...(options.agent ? { SCHEME_AGENT_TEXT_MODEL: 'fixture-text' } : {}),
      CREDENTIAL_ENCRYPTION_KEY: 'package-exchange-encryption-fixture-key',
      S3_ENDPOINT: s3.endpoint,
      S3_REGION: 'us-east-1',
      S3_BUCKET: 'test-scheme-assets',
      S3_ACCESS_KEY_ID: 'fixture-key',
      S3_SECRET_ACCESS_KEY: 'fixture-secret',
    });
    const newApi =
      options.newApi ?? createFakeNewApi({ imageModels: ['musefold-image-pro', 'gpt-image-2'] });
    const account = new AccountService({
      db: database.db,
      newApi,
      encryptionKey: env.CREDENTIAL_ENCRYPTION_KEY,
      apiIssuer: env.PUBLIC_BASE_URL,
      upstreamIssuer: env.NEW_API_BASE_URL,
    });
    const auth = createAuth({
      env,
      db: database.db,
      newApi,
      hooks: {
        prepareLogin: (input) => account.prepareLogin(input),
        commitLogin: (input) => account.commitLogin(input),
        assertSessionAuthorization: (...input) => account.assertSessionAuthorization(...input),
      },
    });
    await auth.$context;
    options.onStartupPhase?.('auth-ready');
    const prompts = new PromptService(database.db);
    const assets = new DesignSchemeAssetService(database.db, s3.storage);
    const agent = options.agent
      ? new DesignSchemeAgentService(
          database.db,
          new DesignSchemeSourcePreparationService(
            database.db,
            s3.storage,
            options.agent.sourceReader,
          ),
          env,
          assets,
        )
      : undefined;
    const app = createApp({
      env,
      db: database.db,
      auth,
      rateLimiter: new RateLimiter(database.db, env.BETTER_AUTH_SECRET),
      services: {
        account,
        prompts,
        designSchemeAssets: assets,
        designSchemeAgent: agent,
        sync: new SyncService(database.db, prompts),
        workbench: new WorkbenchService(database.db),
        generation: new GenerationService(
          database.db,
          new S3AssetUrlSigner(env),
          {
            apiIssuer: env.PUBLIC_BASE_URL,
            upstreamIssuer: env.NEW_API_BASE_URL,
          },
          (sessionId) => account.getModelCatalog(sessionId),
        ),
        skills: new SkillService(database.db),
      },
    });
    return {
      app,
      agent,
      database,
      s3,
      // Test-process-only environment for the actual generation entry. Never sent over browser IPC.
      workerEnvironment: {
        DATABASE_URL: env.DATABASE_URL,
        PUBLIC_BASE_URL: env.PUBLIC_BASE_URL,
        NEW_API_BASE_URL: env.NEW_API_BASE_URL,
        CREDENTIAL_ENCRYPTION_KEY: env.CREDENTIAL_ENCRYPTION_KEY,
        S3_ENDPOINT: env.S3_ENDPOINT,
        S3_REGION: env.S3_REGION,
        S3_BUCKET: env.S3_BUCKET,
        S3_ACCESS_KEY_ID: env.S3_ACCESS_KEY_ID,
        S3_SECRET_ACCESS_KEY: env.S3_SECRET_ACCESS_KEY,
      },
      /** Explicit trial fixture only; select-cover/formalize still go through actual authenticated HTTP. */
      async seedTrial(schemeId: string) {
        const result = await database.pool.query(
          'SELECT user_id,current_revision_id FROM design_schemes WHERE id=$1 AND deleted_at IS NULL',
          [schemeId],
        );
        if (result.rowCount !== 1) throw new Error('Missing imported scheme');
        const row = result.rows[0];
        await database.pool.query(
          "INSERT INTO design_scheme_runs (run_id,user_id,scheme_id,revision_id,mode,status,policy,completed_at) VALUES ($1,$2,$3,$4,'trial','completed','{}',now())",
          [randomUUID(), row.user_id, schemeId, row.current_revision_id],
        );
      },
      /** Read-only product state for shared corpus rejection and content checks. */
      async importSnapshot(includeText = true) {
        const tables = [
          'design_schemes',
          'design_scheme_revisions',
          'design_scheme_source_packages',
          'design_scheme_source_snapshots',
          'design_scheme_source_files',
          'design_scheme_source_bindings',
          'design_scheme_assets',
          'design_scheme_runs',
          'design_scheme_generation_references',
        ];
        const canonical: Record<string, unknown[]> = {};
        for (const table of tables) {
          const rows = (await database.pool.query(`SELECT * FROM ${table}`)).rows;
          canonical[table] = rows.sort((a, b) =>
            JSON.stringify(a).localeCompare(JSON.stringify(b)),
          );
        }
        const sources = (
          await database.pool.query(
            'SELECT snapshot_id,relative_path,kind,content_hash,object_key FROM design_scheme_source_files',
          )
        ).rows;
        const content = sources.map((row) => {
          const bytes = s3.objects.get(row.object_key);
          return {
            snapshotId: String(row.snapshot_id),
            path: String(row.relative_path),
            kind: String(row.kind),
            expectedHash: String(row.content_hash),
            hash: bytes ? createHash('sha256').update(bytes).digest('hex') : null,
            bytes: bytes?.length ?? null,
            text: includeText && bytes && row.kind === 'text' ? bytes.toString('utf8') : null,
          };
        });
        return { canonical, content };
      },
      async snapshot() {
        const read = async (sql: string) => (await database.pool.query(sql)).rows;
        return {
          schemes: await read('SELECT id,user_id,current_revision_id,status FROM design_schemes'),
          exports: await read(
            'SELECT id,user_id,request_id,status,package_hash,size_bytes FROM design_scheme_package_exports',
          ),
          imports: await read(
            'SELECT stage_id,user_id,status,result FROM design_scheme_package_imports',
          ),
          objects: [...s3.objects.values()].map((bytes) => ({
            bytes: bytes.length,
            hash: createHash('sha256').update(bytes).digest('hex'),
          })),
          writes: s3.writes.length,
        };
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
