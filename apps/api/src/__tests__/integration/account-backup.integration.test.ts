import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { OpenAPIHono } from '@hono/zod-openapi';
import { accountSummarySchema, promptPageSchema } from '@musefold/contracts';
import { createDatabase, migrateDatabase } from '@musefold/db';
import { createNewApiClient, type RelayAuthSession } from '@musefold/new-api-client';
import { openJsonFromString, sealJsonToString } from '@musefold/server-crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { PoolClient } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAuth } from '../../auth/index.js';
import { requireSession, type AuthedEnv } from '../../auth/middleware.js';
import { loadEnv } from '../../env.js';
import { AppError, toErrorBody } from '../../lib/errors.js';
import type { BackupInspectPlan } from '../../modules/account/backup-evidence.js';
import {
  type BackupSourceProfile,
  type BackupSourceRows,
  backupSourceProfileSchema,
  sourceDigest,
  sha256,
} from '../../modules/account/backup-source.js';
import { accountRoutes } from '../../modules/account/routes.js';
import { AccountService } from '../../modules/account/service.js';
import { RateLimiter } from '../../modules/rate-limit/service.js';
import { runRecoveryEvidenceOperator } from '../../ops/account-recovery-evidence.js';
import {
  IDENTITY_PROCESS_KEY,
  IDENTITY_PROCESS_AUTH_SECRET,
  IdentityApiProcess,
  startIdentityProxy,
} from '../fixtures/account-identity-process.js';
import { startNewApiIdentityFixture } from '../fixtures/new-api-identity-fixture.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const ROOT = resolve('../..');
const API = 'http://127.0.0.1:8787';
const CURRENT_KEY = 'synthetic-current-backup-key';
const OLD_KEY = 'synthetic-archived-backup-key';
const PRINCIPAL = 'backup-legacy-principal';

async function child(args: string[], env: NodeJS.ProcessEnv, executable = process.execPath) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolveResult, reject) => {
      const processChild = spawn(executable, args, {
        cwd: ROOT,
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        processChild.kill();
        reject(new Error('Synthetic subprocess timed out'));
      }, 30_000);
      processChild.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      processChild.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      processChild.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      processChild.on('exit', (code) => {
        clearTimeout(timer);
        resolveResult({ code, stdout, stderr });
      });
    },
  );
}

describeDb(
  'operator backup evidence: isolated PG0008 source, real CLI, HTTP verification and CAS',
  () => {
    let container: StartedPostgreSqlContainer;
    let target: ReturnType<typeof createDatabase>;
    let source: ReturnType<typeof createDatabase>;
    let sourceUrl: string;
    let folder: string;
    let fixture: Awaited<ReturnType<typeof startNewApiIdentityFixture>>;
    let profile: BackupSourceProfile;
    let rows: BackupSourceRows;
    let env: NodeJS.ProcessEnv;
    let profilePath: string;
    let requestId: string;
    let sessionId: string;
    let bearer: string;
    let oldRelay: RelayAuthSession;
    const connectionEnds: Promise<void>[] = [];
    function trackConnectionEnds(database: ReturnType<typeof createDatabase>) {
      database.pool.on('connect', (client) => {
        connectionEnds.push(new Promise<void>((done) => client.once('end', done)));
      });
    }

    async function migrateThrough(database: ReturnType<typeof createDatabase>, through: number) {
      const path = join(folder, `migrations-${through}`);
      await mkdir(join(path, 'meta'), { recursive: true });
      const original = JSON.parse(
        await readFile(join(ROOT, 'packages/db/migrations/meta/_journal.json'), 'utf8'),
      );
      original.entries = original.entries.slice(0, through + 1);
      await writeFile(join(path, 'meta/_journal.json'), JSON.stringify(original));
      for (const entry of original.entries)
        await copyFile(
          join(ROOT, `packages/db/migrations/${entry.tag}.sql`),
          join(path, `${entry.tag}.sql`),
        );
      await migrate(database.db, { migrationsFolder: path });
    }

    beforeAll(async () => {
      folder = await mkdtemp(join(tmpdir(), 'musefold-backup-evidence-'));
      container = await new PostgreSqlContainer('postgres:17-alpine').start();
      target = createDatabase(container.getConnectionUri(), { max: 12 });
      trackConnectionEnds(target);
      await target.pool.query('CREATE DATABASE isolated_backup');
      const url = new URL(container.getConnectionUri());
      url.pathname = '/isolated_backup';
      sourceUrl = url.toString();
      source = createDatabase(sourceUrl);
      trackConnectionEnds(source);
      await migrateThrough(source, 8);
      await migrateThrough(target, 9);
      await target.pool.query('INSERT INTO "user" (id,name,email) VALUES ($1,$1,$1)', [
        'preserved-before-0010',
      ]);
      // Real repository migration CLI, then replay. It connects only to this disposable target.
      for (let index = 0; index < 2; index += 1) {
        const migration = await child(
          ['--filter', '@musefold/db', 'db:migrate'],
          { DATABASE_URL: container.getConnectionUri() },
          'pnpm',
        );
        expect(migration.code).toBe(0);
      }
      expect(
        (
          await target.pool.query('SELECT count(*)::int AS n FROM "user" WHERE id=$1', [
            'preserved-before-0010',
          ])
        ).rows[0].n,
      ).toBe(1);
      expect(
        (
          await target.pool.query(
            "SELECT column_name FROM information_schema.columns WHERE table_name='account_recovery_backup_evidence'",
          )
        ).rowCount,
      ).toBe(15);
      await migrateDatabase(target.db);
    }, 120_000);

    beforeEach(async () => {
      await target.pool.query('TRUNCATE "user" CASCADE');
      await target.pool.query('DELETE FROM rate_limit_buckets');
      await source.pool.query('TRUNCATE "user" CASCADE');
      fixture = await startNewApiIdentityFixture();
      fixture.addOwner({ id: 42, username: 'alice' });
      fixture.addOwner({ id: 84, username: 'bob' });
      oldRelay = fixture.issueSession(42);
      const candidate = fixture.issueSession(42);
      const token = fixture.seedToken(42);
      const createdAt = new Date(Date.now() - 4 * 3600_000).toISOString();
      requestId = randomUUID();
      sessionId = randomUUID();
      bearer = randomUUID();
      await source.pool.query('INSERT INTO "user" (id,name,email) VALUES ($1,$1,$1)', [PRINCIPAL]);
      await source.pool.query(
        "INSERT INTO session (id,user_id,token,expires_at) VALUES ($1,$2,$3,now()-interval '1 day')",
        ['old-session-never-restored', PRINCIPAL, 'archived-bearer-never-read'],
      );
      rows = {
        format: 'musefold-pg0008-account-evidence-v1',
        principalId: PRINCIPAL,
        relays: [
          {
            sessionId: 'old-session-never-restored',
            userId: PRINCIPAL,
            ciphertext: sealJsonToString(
              { jwt: oldRelay.jwt, refreshToken: oldRelay.refreshToken },
              OLD_KEY,
            ),
            keyVersion: 'v1',
            accessExpiresAt: new Date(oldRelay.jwtExpiresAt * 1000).toISOString(),
            createdAt,
            updatedAt: createdAt,
          },
        ],
        credentials: [
          {
            userId: PRINCIPAL,
            provider: 'new-api',
            externalTokenId: String(token.id),
            ciphertext: sealJsonToString({ apiKey: token.key }, OLD_KEY),
            keyVersion: 'v1',
            createdAt,
            updatedAt: createdAt,
          },
        ],
      };
      await saveSource();
      await target.pool.query(
        'INSERT INTO "user" (id,name,email,new_api_user_id) VALUES ($1,$2,$2,84)',
        [PRINCIPAL, 'alice'],
      );
      await target.pool.query(
        "INSERT INTO account_identities(user_id,status,evidence) VALUES ($1,'recovery_required',$2)",
        [PRINCIPAL, { kind: 'legacy_unverified' }],
      );
      await target.pool.query(
        "INSERT INTO session(id,user_id,token,expires_at) VALUES ($1,$2,$3,now()+interval '1 day')",
        [sessionId, PRINCIPAL, bearer],
      );
      await target.pool.query(
        "INSERT INTO account_session_authorizations(session_id,user_id,mode) VALUES ($1,$2,'recovery_only')",
        [sessionId, PRINCIPAL],
      );
      await target.pool.query(
        `INSERT INTO account_recovery_requests(id,session_id,target_user_id,upstream_issuer,upstream_owner_id,candidate_ciphertext,candidate_summary,reason,identity_version,expires_at)
      VALUES ($1,$2,$3,$4,'42',$5,$6,'legacy_evidence_missing',0,now()+interval '30 minutes')`,
        [
          requestId,
          sessionId,
          PRINCIPAL,
          fixture.baseUrl,
          sealJsonToString(candidate, CURRENT_KEY),
          candidate.user,
        ],
      );
      const systemIdentifier = (
        await target.pool.query('SELECT system_identifier::text AS id FROM pg_control_system()')
      ).rows[0].id;
      const record =
        'Synthetic independently retained deployment record: same lineage; all historical candidate/repair artifacts excluded by review before cutoff.';
      const recordPath = join(folder, 'deployment-record.txt');
      await writeFile(recordPath, record, { mode: 0o600 });
      profile = backupSourceProfileSchema.parse({
        version: 1,
        id: 'synthetic-reviewed-backup',
        apiIssuer: API,
        upstreamIssuer: fixture.baseUrl,
        sourceDatabase: { name: 'isolated_backup', systemIdentifier },
        targetDatabase: {
          name: new URL(container.getConnectionUri()).pathname.slice(1),
          systemIdentifier,
        },
        sourceDatabaseUrlEnv: 'MUSEFOLD_RECOVERY_SYNTHETIC_SOURCE_URL',
        archiveKeyEnv: 'MUSEFOLD_RECOVERY_SYNTHETIC_OLD_KEY',
        sourcePrincipalId: PRINCIPAL,
        targetPrincipalId: PRINCIPAL,
        sourceLineage: 'synthetic-installation',
        targetLineage: 'synthetic-installation',
        expectedEvidenceSha256: sourceDigest(rows),
        capturedAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
        independentBefore: new Date(Date.now() - 2 * 3600_000).toISOString(),
        attestation: {
          recordPath,
          sha256: sha256(record),
          reference: 'synthetic-deployment-record',
          reviewedBy: 'synthetic-operator',
          decision: 'complete-independent-legacy-evidence',
        },
      });
      profilePath = join(folder, 'profile.json');
      await saveProfile();
      env = {
        MUSEFOLD_RECOVERY_TARGET_DATABASE_URL: container.getConnectionUri(),
        MUSEFOLD_RECOVERY_SYNTHETIC_SOURCE_URL: sourceUrl,
        MUSEFOLD_RECOVERY_SYNTHETIC_OLD_KEY: OLD_KEY,
        MUSEFOLD_RECOVERY_CURRENT_KEY: CURRENT_KEY,
      };
    });

    afterEach(async () => {
      await fixture?.close();
    });
    afterAll(async () => {
      await Promise.all([target?.pool.end(), source?.pool.end()]);
      // pg-pool can resolve end() after removing idle clients but before their
      // sockets emit end. Do not stop PostgreSQL until those closes finish.
      await Promise.all(connectionEnds);
      await container?.stop();
      await rm(folder, { recursive: true, force: true });
    });

    async function saveSource() {
      await source.pool.query('DELETE FROM relay_sessions');
      await source.pool.query('DELETE FROM account_credentials');
      for (const row of rows.relays) {
        await source.pool.query(
          'INSERT INTO session(id,user_id,token,expires_at) VALUES ($1,$2,$1,now()) ON CONFLICT DO NOTHING',
          [row.sessionId, PRINCIPAL],
        );
        await source.pool.query(
          'INSERT INTO relay_sessions(session_id,user_id,ciphertext,key_version,access_expires_at,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [
            row.sessionId,
            row.userId,
            row.ciphertext,
            row.keyVersion,
            row.accessExpiresAt,
            row.createdAt,
            row.updatedAt,
          ],
        );
      }
      for (const row of rows.credentials)
        await source.pool.query(
          'INSERT INTO account_credentials(user_id,provider,external_token_id,ciphertext,key_version,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [
            row.userId,
            row.provider,
            row.externalTokenId,
            row.ciphertext,
            row.keyVersion,
            row.createdAt,
            row.updatedAt,
          ],
        );
    }
    async function saveProfile() {
      await writeFile(profilePath, JSON.stringify(profile), { mode: 0o600 });
    }
    async function inspect() {
      return (await runRecoveryEvidenceOperator(
        ['inspect', '--profile', profilePath, '--request-id', requestId],
        env,
      )) as BackupInspectPlan;
    }
    async function stage(input?: BackupInspectPlan) {
      const plan = input ?? (await inspect());
      const planPath = join(folder, 'plan.json');
      const bytes = JSON.stringify(plan);
      await writeFile(planPath, bytes, { mode: 0o600 });
      return runRecoveryEvidenceOperator(
        ['stage', '--profile', profilePath, '--plan', planPath, '--plan-sha256', sha256(bytes)],
        env,
      );
    }
    function system(database = target, legacyTrusted = false) {
      const account = new AccountService({
        db: database.db,
        newApi: createNewApiClient(fixture.baseUrl),
        encryptionKey: CURRENT_KEY,
        apiIssuer: API,
        upstreamIssuer: fixture.baseUrl,
        ...(legacyTrusted ? { legacyTrustedIssuer: fixture.baseUrl } : {}),
      });
      const auth = createAuth({
        env: loadEnv({
          NODE_ENV: 'test',
          PUBLIC_BASE_URL: API,
          DATABASE_URL: container.getConnectionUri(),
          // This suite and the real bin share one deployment and its persisted
          // JWKS; a process restart must retain the same signing-key secret.
          BETTER_AUTH_SECRET: IDENTITY_PROCESS_AUTH_SECRET,
          NEW_API_BASE_URL: fixture.baseUrl,
          CREDENTIAL_ENCRYPTION_KEY: CURRENT_KEY,
        }),
        db: database.db,
        newApi: createNewApiClient(fixture.baseUrl),
        hooks: {
          prepareLogin: (input) => account.prepareLogin(input),
          commitLogin: (input) => account.commitLogin(input),
          assertSessionAuthorization: (...input) => account.assertSessionAuthorization(...input),
        },
      });
      const app = new OpenAPIHono<AuthedEnv>();
      app.onError((error, c) => {
        const safe =
          error instanceof AppError
            ? error
            : new AppError('INTERNAL_ERROR', 'Synthetic failure', 500);
        return c.json(toErrorBody(safe, 'synthetic-backup'), safe.status as 400);
      });
      app.use('/api/v1/*', requireSession(auth, [API], account));
      app.route(
        '/api/v1',
        accountRoutes(account, new RateLimiter(database.db, 'synthetic-rate-key')),
      );
      return { account, app };
    }
    async function retry(sys = system()) {
      const response = await sys.app.request(`${API}/api/v1/account/recovery/retry`, {
        method: 'POST',
        headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
        body: JSON.stringify({ requestId }),
      });
      return { status: response.status, body: (await response.json()) as Record<string, unknown> };
    }
    async function expectRestricted() {
      expect(
        (
          await target.pool.query('SELECT status FROM account_identities WHERE user_id=$1', [
            PRINCIPAL,
          ])
        ).rows[0].status,
      ).not.toBe('active');
      expect(
        (await target.pool.query('SELECT count(*)::int AS n FROM account_credentials')).rows[0].n,
      ).toBe(0);
      expect(
        (
          await target.pool.query('SELECT count(*)::int AS n FROM session WHERE id=$1', [
            'old-session-never-restored',
          ])
        ).rows[0].n,
      ).toBe(0);
    }

    it('real inspect-source/inspect/stage CLI stays offline; original authenticated retry activates and consumes only the same request', async () => {
      const args = ['--import', 'tsx', 'apps/api/src/ops/account-recovery-evidence.ts'];
      delete profile.expectedEvidenceSha256;
      await saveProfile();
      const fingerprint = await child([...args, 'inspect-source', '--profile', profilePath], env);
      expect(fingerprint.code).toBe(0);
      expect(JSON.parse(fingerprint.stdout)).toMatchObject({
        sourceDigest: sourceDigest(rows),
        relayCount: 1,
        credentialCount: 1,
      });
      profile.expectedEvidenceSha256 = sourceDigest(rows);
      await saveProfile();
      const inspection = await child(
        [...args, 'inspect', '--profile', profilePath, '--request-id', requestId],
        env,
      );
      expect(inspection.code).toBe(0);
      const path = join(folder, 'real-plan.json');
      await writeFile(path, inspection.stdout, { mode: 0o600 });
      const staged = await child(
        [
          ...args,
          'stage',
          '--profile',
          profilePath,
          '--plan',
          path,
          '--plan-sha256',
          sha256(inspection.stdout),
        ],
        env,
      );
      expect(staged.code).toBe(0);
      expect(JSON.parse(staged.stdout)).toMatchObject({ staged: true, alreadyStaged: false });
      expect(fixture.requests).toHaveLength(0);
      await expectRestricted();
      const before = (await target.pool.query('SELECT * FROM account_recovery_backup_evidence'))
        .rows[0];
      const safeOutput = `${fingerprint.stdout}${inspection.stdout}${staged.stdout}${JSON.stringify(before.provenance)}`;
      for (const forbidden of [
        oldRelay.jwt,
        oldRelay.refreshToken,
        'archived-bearer-never-read',
        OLD_KEY,
        CURRENT_KEY,
        sourceUrl,
      ])
        expect(safeOutput).not.toContain(forbidden);
      const result = await retry();
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({
        id: '42',
        recovery: null,
        identity: { status: 'active', principalId: PRINCIPAL },
      });
      const after = (await target.pool.query('SELECT * FROM account_recovery_backup_evidence'))
        .rows[0];
      expect(after.state).toBe('consumed');
      expect(after.ciphertext).toBe('');
      expect(after.lease_id).toBeNull();
      expect(
        (await target.pool.query('SELECT new_api_user_id FROM "user" WHERE id=$1', [PRINCIPAL]))
          .rows[0].new_api_user_id,
      ).toBe(84);
      expect((await target.pool.query('SELECT count(*)::int AS n FROM session')).rows[0].n).toBe(1);
      expect(
        (await target.pool.query('SELECT count(*)::int AS n FROM oauth_consent')).rows[0].n,
      ).toBe(0);
      expect((await retry()).status).toBe(200);
    }, 30_000);

    it('repeated stage is idempotent; lost archive key is safely rejected without any upstream call', async () => {
      const plan = await inspect();
      env.MUSEFOLD_RECOVERY_SYNTHETIC_OLD_KEY = 'wrong-key';
      await expect(stage(plan)).rejects.toMatchObject({
        details: { reason: 'legacy_evidence_missing' },
      });
      env.MUSEFOLD_RECOVERY_SYNTHETIC_OLD_KEY = OLD_KEY;
      expect(await stage(plan)).toMatchObject({ alreadyStaged: false });
      expect(await stage(plan)).toMatchObject({ alreadyStaged: true });
      expect(fixture.requests).toHaveLength(0);
      await expectRestricted();
    });

    it('wrong current key writes nothing; correcting it permits the same reviewed plan', async () => {
      const plan = await inspect();
      env.MUSEFOLD_RECOVERY_CURRENT_KEY = 'synthetic-wrong-destination-key';
      await expect(stage(plan)).rejects.toMatchObject({
        details: { reason: 'legacy_evidence_missing' },
      });
      expect(
        (await target.pool.query('SELECT count(*)::int AS n FROM account_recovery_backup_evidence'))
          .rows[0].n,
      ).toBe(0);
      expect(
        (
          await target.pool.query('SELECT revision FROM account_recovery_requests WHERE id=$1', [
            requestId,
          ])
        ).rows[0].revision,
      ).toBe(plan.requestRevision);
      env.MUSEFOLD_RECOVERY_CURRENT_KEY = CURRENT_KEY;
      expect(await stage(plan)).toMatchObject({ alreadyStaged: false });
      expect(fixture.requests).toHaveLength(0);
      expect((await retry()).body).toMatchObject({ recovery: null });
    });

    it.each(['profile', 'plan', 'attestation'] as const)(
      'real CLI promptly rejects a %s FIFO without a writer',
      async (kind) => {
        const fifo = join(folder, `fifo-${kind}`);
        expect((await child([fifo], {}, 'mkfifo')).code).toBe(0);
        let args: string[];
        if (kind === 'plan')
          args = [
            'stage',
            '--profile',
            profilePath,
            '--plan',
            fifo,
            '--plan-sha256',
            '0'.repeat(64),
          ];
        else {
          if (kind === 'attestation') {
            profile.attestation.recordPath = fifo;
            await saveProfile();
          }
          args = [
            'inspect',
            '--profile',
            kind === 'profile' ? fifo : profilePath,
            '--request-id',
            requestId,
          ];
        }
        const result = await child(
          ['--import', 'tsx', 'apps/api/src/ops/account-recovery-evidence.ts', ...args],
          env,
        );
        expect(result.code).toBe(1);
        expect(result.stdout).toBe('');
        expect(result.stderr).toMatch(/^RECOVERY_EVIDENCE_REJECTED:/);
        for (const secret of [OLD_KEY, CURRENT_KEY, sourceUrl, oldRelay.jwt])
          expect(result.stderr).not.toContain(secret);
        expect(fixture.requests).toHaveLength(0);
        await expectRestricted();
      },
      10_000,
    );

    it.each([
      'source_digest',
      'lineage',
      'principal',
      'target_database',
      'issuer',
      'attestation',
      'independence',
      'unknown_independence',
    ] as const)('rejects %s before secret HTTP or identity writes', async (kind) => {
      if (kind === 'source_digest') profile.expectedEvidenceSha256 = '0'.repeat(64);
      if (kind === 'lineage') profile.targetLineage = 'other';
      if (kind === 'principal') profile.targetPrincipalId = 'other';
      if (kind === 'target_database') profile.targetDatabase.name = 'other';
      if (kind === 'issuer') profile.upstreamIssuer = 'https://wrong.invalid';
      if (kind === 'attestation') profile.attestation.sha256 = '0'.repeat(64);
      if (kind === 'independence') profile.independentBefore = profile.capturedAt;
      if (kind === 'unknown_independence')
        (profile.attestation as { decision: string }).decision = 'unknown';
      await saveProfile();
      await expect(inspect()).rejects.toBeDefined();
      expect(fixture.requests).toHaveLength(0);
      await expectRestricted();
    });

    it('rejects a changed full source set, more than 16 relays and unsupported newer source schema', async () => {
      const plan = await inspect();
      rows.relays = Array.from({ length: 17 }, (_, index) => ({
        ...rows.relays[0],
        sessionId: `archived-${index}`,
      }));
      await saveSource();
      await expect(stage(plan)).rejects.toBeDefined();
      rows.relays = rows.relays.slice(0, 1);
      await saveSource();
      await expect(stage(plan)).rejects.toBeDefined();
      await source.pool.query('CREATE TABLE account_recovery_requests (id text)');
      try {
        await expect(inspect()).rejects.toThrow('UNSUPPORTED_SOURCE_SCHEMA');
      } finally {
        await source.pool.query('DROP TABLE account_recovery_requests');
      }
      expect(fixture.requests).toHaveLength(0);
    });

    it('corrupt source key cannot be staged even with a reviewed digest', async () => {
      rows.credentials[0].ciphertext = 'v1.corrupt';
      await saveSource();
      profile.expectedEvidenceSha256 = sourceDigest(rows);
      await saveProfile();
      await expect(stage()).rejects.toMatchObject({
        details: { reason: 'legacy_evidence_missing' },
      });
      await expectRestricted();
    });

    it('mixed backup owners cannot activate or replace the live credential', async () => {
      const other = fixture.issueSession(84);
      rows.relays.push({
        ...rows.relays[0],
        sessionId: 'second-old-session',
        ciphertext: sealJsonToString({ jwt: other.jwt, refreshToken: other.refreshToken }, OLD_KEY),
      });
      await saveSource();
      profile.expectedEvidenceSha256 = sourceDigest(rows);
      await saveProfile();
      await stage();
      const result = await retry();
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ recovery: { reason: 'legacy_identity_conflict' } });
      await expectRestricted();
    });

    it('failed candidate token/key equality is not enough when an independent live relay contradicts it', async () => {
      await stage();
      const other = fixture.issueSession(84);
      await target.pool.query(
        "INSERT INTO session(id,user_id,token,expires_at) VALUES ('contradiction',$1,'never-caller',now()+interval '1 day')",
        [PRINCIPAL],
      );
      await target.pool.query(
        "INSERT INTO relay_sessions(session_id,user_id,ciphertext,upstream_issuer,upstream_owner_id,access_expires_at) VALUES ('contradiction',$1,$2,$3,'84',now()+interval '1 hour')",
        [
          PRINCIPAL,
          sealJsonToString({ jwt: other.jwt, refreshToken: other.refreshToken }, CURRENT_KEY),
          fixture.baseUrl,
        ],
      );
      expect((await retry()).body).toMatchObject({
        recovery: { reason: 'legacy_identity_conflict' },
      });
      await expectRestricted();
    });

    it('foreign candidate bearer cannot inspect or retry another request', async () => {
      await stage();
      const wrong = system();
      const response = await wrong.app.request(`${API}/api/v1/account/recovery/retry`, {
        method: 'POST',
        headers: { authorization: 'Bearer unknown', 'content-type': 'application/json' },
        body: JSON.stringify({ requestId }),
      });
      expect(response.status).toBe(401);
      await expectRestricted();
    });

    it('expired request cannot be staged or revived by retry', async () => {
      const plan = await inspect();
      await target.pool.query(
        "UPDATE account_recovery_requests SET expires_at=now()-interval '1 second' WHERE id=$1",
        [requestId],
      );
      await expect(stage(plan)).rejects.toBeDefined();
      expect((await retry()).status).toBe(410);
      await expectRestricted();
    });

    it('an expired old JWT refreshes under a durable lease, then verifies fresh owner without restoring the old BA session', async () => {
      oldRelay = fixture.issueSession(42, { expiresInSeconds: -1 });
      rows.relays[0].ciphertext = sealJsonToString(
        { jwt: oldRelay.jwt, refreshToken: oldRelay.refreshToken },
        OLD_KEY,
      );
      await saveSource();
      profile.expectedEvidenceSha256 = sourceDigest(rows);
      await saveProfile();
      await stage();
      const barrier = fixture.pauseNext({ operation: 'refresh' });
      const first = retry();
      await barrier.reached;
      try {
        // A separate Node process shares only PG and the synthetic loopback server.
        const code = `
          import {createDatabase} from './packages/db/src/index.ts';
          import {createNewApiClient} from './packages/new-api-client/src/index.ts';
          import {AccountService} from './apps/api/src/modules/account/service.ts';
          const db = createDatabase(process.env.MUSEFOLD_RECOVERY_TARGET_DATABASE_URL);
          try {
            const account = new AccountService({db:db.db,newApi:createNewApiClient(process.env.SYNTHETIC_UPSTREAM),encryptionKey:process.env.MUSEFOLD_RECOVERY_CURRENT_KEY,apiIssuer:process.env.SYNTHETIC_API,upstreamIssuer:process.env.SYNTHETIC_UPSTREAM});
            try { await account.recovery.retry(process.env.SYNTHETIC_SESSION,process.env.SYNTHETIC_REQUEST); process.stdout.write('unexpected-success'); }
            catch(error) { process.stdout.write(JSON.stringify({code:error.code,status:error.status})); }
          } finally { await db.pool.end(); }
        `;
        const second = await child(['--import', 'tsx', '--input-type=module', '--eval', code], {
          ...env,
          SYNTHETIC_UPSTREAM: fixture.baseUrl,
          SYNTHETIC_API: API,
          SYNTHETIC_SESSION: sessionId,
          SYNTHETIC_REQUEST: requestId,
        });
        expect(second.code).toBe(0);
        expect(JSON.parse(second.stdout)).toMatchObject({ status: 503 });
        expect(fixture.count({ operation: 'refresh' })).toBe(1);
      } finally {
        barrier.release();
      }
      expect((await first).status).toBe(200);
      expect(fixture.count({ operation: 'refresh' })).toBe(1);
      expect((await target.pool.query('SELECT count(*)::int AS n FROM session')).rows[0].n).toBe(1);
    });

    it.each(['changed_owner', 'invalid_refresh'] as const)(
      'backup refresh %s leaves the principal restricted',
      async (kind) => {
        oldRelay = fixture.issueSession(42, { expiresInSeconds: -1 });
        rows.relays[0].ciphertext = sealJsonToString(
          { jwt: oldRelay.jwt, refreshToken: oldRelay.refreshToken },
          OLD_KEY,
        );
        if (kind === 'changed_owner') fixture.setRefreshOwner(oldRelay.refreshToken, 84);
        else fixture.invalidateRefresh(oldRelay.refreshToken);
        await saveSource();
        profile.expectedEvidenceSha256 = sourceDigest(rows);
        await saveProfile();
        await stage();
        const result = await retry();
        expect(result.status).toBe(200);
        expect(result.body).toMatchObject({
          recovery: {
            reason:
              kind === 'changed_owner' ? 'legacy_identity_conflict' : 'legacy_evidence_missing',
          },
        });
        expect(fixture.count({ operation: 'refresh' })).toBe(1);
        await expectRestricted();
      },
    );

    it('a present corrupt live key cannot be excused by a matching older backup', async () => {
      await stage();
      await target.pool.query(
        "INSERT INTO account_credentials(user_id,provider,ciphertext,external_token_id) VALUES ($1,'new-api','v1.corrupt','1')",
        [PRINCIPAL],
      );
      expect((await retry()).body).toMatchObject({
        recovery: { reason: 'legacy_evidence_missing' },
      });
      expect(
        (
          await target.pool.query('SELECT ciphertext FROM account_credentials WHERE user_id=$1', [
            PRINCIPAL,
          ])
        ).rows[0].ciphertext,
      ).toBe('v1.corrupt');
    });

    it('stage changes the request CAS, invalidating a retry that started before evidence was attached', async () => {
      const plan = await inspect();
      const barrier = fixture.pauseNext({ operation: 'getSelf' });
      const result = retry();
      await barrier.reached;
      await stage(plan);
      barrier.release();
      expect((await result).status).toBe(409);
      await expectRestricted();
      expect((await retry()).body).toMatchObject({ recovery: null });
    });

    it('a different valid BA session cannot claim the pending request', async () => {
      await stage();
      await target.pool.query(
        "INSERT INTO \"user\"(id,name,email) VALUES ('other-principal','bob','bob')",
      );
      await target.pool.query(
        "INSERT INTO session(id,user_id,token,expires_at) VALUES ('other-session','other-principal','other-bearer',now()+interval '1 day')",
      );
      const response = await system().app.request(`${API}/api/v1/account/recovery/retry`, {
        method: 'POST',
        headers: { authorization: 'Bearer other-bearer', 'content-type': 'application/json' },
        body: JSON.stringify({ requestId }),
      });
      expect(response.status).toBe(404);
      expect(fixture.requests).toHaveLength(0);
      await expectRestricted();
    });

    it('corrupt staged backup does not block the existing original-device proof path', async () => {
      await stage();
      await target.pool.query(
        "UPDATE account_recovery_backup_evidence SET ciphertext='v1.corrupt'",
      );
      await target.pool.query(
        "INSERT INTO session(id,user_id,token,expires_at) VALUES ('live-original',$1,'original-bearer',now()+interval '1 day')",
        [PRINCIPAL],
      );
      await target.pool.query(
        "INSERT INTO relay_sessions(session_id,user_id,ciphertext,upstream_issuer,upstream_owner_id,access_expires_at) VALUES ('live-original',$1,$2,$3,'42',now()+interval '1 hour')",
        [
          PRINCIPAL,
          sealJsonToString({ jwt: oldRelay.jwt, refreshToken: oldRelay.refreshToken }, CURRENT_KEY),
          fixture.baseUrl,
        ],
      );
      const response = await system().app.request(
        `${API}/api/v1/account/recovery/verify-original-session`,
        {
          method: 'POST',
          headers: { authorization: 'Bearer original-bearer', 'content-type': 'application/json' },
          body: JSON.stringify({ requestId }),
        },
      );
      expect(response.status).toBe(200);
      const row = (await target.pool.query('SELECT * FROM account_recovery_backup_evidence'))
        .rows[0];
      expect(row.state).toBe('revoked');
      expect(row.ciphertext).toBe('');
      expect(
        (
          await target.pool.query('SELECT status FROM account_identities WHERE user_id=$1', [
            PRINCIPAL,
          ])
        ).rows[0].status,
      ).toBe('active');
    });

    it('transient verification stays retryable and preserves encrypted evidence', async () => {
      await stage();
      fixture.failNext({ operation: 'fetchTokenKey' }, { status: 429 });
      const result = await retry();
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ recovery: { reason: 'verification_pending' } });
      const row = (await target.pool.query('SELECT * FROM account_recovery_backup_evidence'))
        .rows[0];
      expect(row.state).toBe('staged');
      expect(row.ciphertext).toMatch(/^v1\./);
      expect(row.lease_id).toBeNull();
      expect((await retry()).body).toMatchObject({ recovery: null });
    });

    it('logout wins while backup refresh is in flight; no late key, session, or refreshed evidence returns', async () => {
      oldRelay = fixture.issueSession(42, { expiresInSeconds: -1 });
      rows.relays[0].ciphertext = sealJsonToString(
        { jwt: oldRelay.jwt, refreshToken: oldRelay.refreshToken },
        OLD_KEY,
      );
      await saveSource();
      profile.expectedEvidenceSha256 = sourceDigest(rows);
      await saveProfile();
      await stage();
      const barrier = fixture.pauseNext({ operation: 'refresh' });
      const result = retry();
      await barrier.reached;
      await target.pool.query('DELETE FROM session WHERE id=$1', [sessionId]);
      barrier.release();
      expect((await result).status).toBe(409);
      await expectRestricted();
      expect(
        (await target.pool.query('SELECT count(*)::int AS n FROM account_recovery_backup_evidence'))
          .rows[0].n,
      ).toBe(0);
    });

    it('new live counterevidence arriving after verification invalidates the original commit snapshot', async () => {
      await stage();
      const barrier = fixture.pauseNext({ operation: 'fetchTokenKey' });
      const result = retry();
      await barrier.reached;
      await target.pool.query(
        "INSERT INTO session(id,user_id,token,expires_at) VALUES ('late-proof',$1,'late-proof-token',now()+interval '1 day')",
        [PRINCIPAL],
      );
      await target.pool.query(
        "INSERT INTO relay_sessions(session_id,user_id,ciphertext,access_expires_at) VALUES ('late-proof',$1,$2,now())",
        [
          PRINCIPAL,
          sealJsonToString({ jwt: 'unverifiable', refreshToken: 'unverifiable' }, CURRENT_KEY),
        ],
      );
      barrier.release();
      expect((await result).status).toBe(409);
      await expectRestricted();
    });

    it('stale inspect plan cannot attach after request revision changes', async () => {
      const plan = await inspect();
      await target.pool.query(
        'UPDATE account_recovery_requests SET revision=revision+1 WHERE id=$1',
        [requestId],
      );
      await expect(stage(plan)).rejects.toMatchObject({ code: 'ACCOUNT_RECOVERY_CONFLICT' });
      await expectRestricted();
    });

    it('swapped encrypted batch context is rejected before any backup credential probe', async () => {
      await stage();
      const row = (await target.pool.query('SELECT * FROM account_recovery_backup_evidence'))
        .rows[0];
      const payload = openJsonFromString<Record<string, unknown>>(row.ciphertext, CURRENT_KEY);
      payload.targetUserId = 'other-principal';
      await target.pool.query('UPDATE account_recovery_backup_evidence SET ciphertext=$1', [
        sealJsonToString(payload, CURRENT_KEY),
      ]);
      expect((await retry()).status).toBe(409);
      expect(fixture.count({ operation: 'refresh' })).toBe(0);
      await expectRestricted();
    });

    it('backup SIGKILL after successful refresh before PG save preserves the lease and requires explicit independent recovery on a new production PID', async () => {
      const proxy = await startIdentityProxy();
      const processes: IdentityApiProcess[] = [];
      let blocker: PoolClient | undefined;
      let refreshed: ReturnType<typeof fixture.pauseNext> | undefined;
      let verified: ReturnType<typeof fixture.pauseNext> | undefined;
      const beganAt = Date.now();
      function mark(stage: string) {
        process.stdout.write(`[backup-sigkill] ${stage} elapsedMs=${Date.now() - beganAt}\n`);
      }
      async function reachBarrier<T>(reached: Promise<T>, pending: Promise<number>, stage: string) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          return await Promise.race([
            reached,
            pending.then((status) => {
              throw new Error(`Backup ${stage} was not reached before HTTP status ${status}`);
            }),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error(`Backup ${stage} did not arrive within 10 seconds`)),
                10_000,
              );
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      }
      const secrets = [
        OLD_KEY,
        CURRENT_KEY,
        IDENTITY_PROCESS_KEY,
        IDENTITY_PROCESS_AUTH_SECRET,
        bearer,
        'fixture-jwt-',
        'fixture-refresh-',
        'sk-fixture-',
      ];
      async function start(name: string) {
        const api = await IdentityApiProcess.start({
          databaseUrl: container.getConnectionUri(),
          apiIssuer: proxy.url,
          upstreamIssuer: fixture.baseUrl,
          name,
        });
        processes.push(api);
        return api;
      }
      function request(api: IdentityApiProcess, path: string, body?: unknown) {
        proxy.select(api);
        return fetch(`${proxy.url}${path}`, {
          method: body === undefined ? 'GET' : 'POST',
          headers: {
            authorization: `Bearer ${bearer}`,
            origin: proxy.url,
            'content-type': 'application/json',
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(15_000),
          redirect: 'error',
        });
      }
      async function readBatch() {
        const result = await target.pool.query(
          'SELECT * FROM account_recovery_backup_evidence WHERE request_id=$1',
          [requestId],
        );
        expect(result.rows).toHaveLength(1);
        return result.rows[0];
      }
      async function cleanupResources() {
        const tasks = [proxy.close(), ...processes.map((api) => api.stop())];
        if (blocker) {
          const held = blocker;
          tasks.push(
            (async () => {
              try {
                await held.query('ROLLBACK');
              } finally {
                held.release();
              }
            })(),
          );
        }
        const results = await Promise.allSettled(tasks);
        for (const result of results) if (result.status === 'rejected') throw result.reason;
        for (const api of processes) {
          expect(api.outputWasTruncated).toBe(false);
          for (const secret of secrets) expect(api.containsOutput(secret)).toBe(false);
        }
      }
      try {
        mark('setup');
        // Seed/read the deployment-level encrypted JWKS through real BA session
        // handling even when this case runs alone. User truncation intentionally
        // leaves this key in place across the suite and the replacement PID.
        const warmup = await system().app.request(`${API}/api/v1/prompts`, {
          headers: { authorization: `Bearer ${bearer}` },
        });
        expect(warmup.status).toBe(403);
        const existingJwks = (await target.pool.query('SELECT id FROM jwks ORDER BY id')).rows;
        expect(existingJwks.length).toBeGreaterThan(0);
        mark('existing-deployment-jwks-verified');
        blocker = await target.pool.connect();
        // Re-encrypt only this synthetic candidate with the production-process
        // fixture key; the source remains encrypted under the archived key.
        const priorRequest = (
          await target.pool.query('SELECT * FROM account_recovery_requests WHERE id=$1', [
            requestId,
          ])
        ).rows[0];
        const candidate = openJsonFromString<RelayAuthSession>(
          priorRequest.candidate_ciphertext,
          CURRENT_KEY,
        );
        secrets.push(candidate.jwt, candidate.refreshToken);
        const candidateCiphertext = sealJsonToString(candidate, IDENTITY_PROCESS_KEY);
        await target.pool.query(
          'UPDATE account_recovery_requests SET candidate_ciphertext=$1 WHERE id=$2',
          [candidateCiphertext, requestId],
        );
        env.MUSEFOLD_RECOVERY_CURRENT_KEY = IDENTITY_PROCESS_KEY;
        profile.apiIssuer = proxy.url;
        oldRelay = fixture.issueSession(42, { expiresInSeconds: -1 });
        rows.relays[0].ciphertext = sealJsonToString(
          { jwt: oldRelay.jwt, refreshToken: oldRelay.refreshToken },
          OLD_KEY,
        );
        await saveSource();
        profile.expectedEvidenceSha256 = sourceDigest(rows);
        await saveProfile();
        await stage();
        mark('staged');
        expect(fixture.requests).toHaveLength(0);
        await target.pool.query(
          'INSERT INTO prompts(id,user_id,title,content) VALUES ($1,$2,$3,$4)',
          [
            'unclaimed-old-prompt',
            PRINCIPAL,
            'Unclaimed historical content',
            'Unclaimed historical content',
          ],
        );
        const identityBefore = (
          await target.pool.query('SELECT * FROM account_identities WHERE user_id=$1', [PRINCIPAL])
        ).rows[0];
        const staged = await readBatch();
        const one = await start('backup-process-before-crash');
        mark('first-process-ready');
        expect(one.pid).not.toBe(process.pid);

        // First pause the successful refresh reply so the next getSelf barrier
        // can only be the newly issued JWT, not the candidate or expired JWT.
        refreshed = fixture.pauseNext({ operation: 'refresh' }, { phase: 'after' });
        const pending = request(one, '/api/v1/account/recovery/retry', { requestId }).then(
          async (response) => {
            if (response.status !== 200) {
              process.stdout.write(
                `${JSON.stringify({ stage: 'early-http-result', status: response.status, jwksDecryptionFailed: one.containsOutput('Failed to decrypt private key'), requests: fixture.requests })}\n`,
              );
            }
            return response.status;
          },
          () => 0,
        );
        expect(await reachBarrier(refreshed.reached, pending, 'refresh-success')).toMatchObject({
          status: 200,
        });
        mark('refresh-succeeded');
        verified = fixture.pauseNext({ operation: 'getSelf', ownerId: 42 }, { phase: 'after' });
        refreshed.release();
        const freshSelf = await reachBarrier(verified.reached, pending, 'fresh-owner-verification');
        mark('fresh-owner-verified');
        expect(freshSelf.status).toBe(200);
        expect(freshSelf.sessionNumber).toBeTypeOf('number');
        const previousSelf = fixture.requests.filter(
          (entry) => entry.operation === 'getSelf' && entry.sequence < freshSelf.sequence,
        );
        expect(previousSelf.length).toBeGreaterThanOrEqual(2);
        expect(previousSelf.some((entry) => entry.sessionNumber === freshSelf.sessionNumber)).toBe(
          false,
        );
        expect(fixture.requests.filter((entry) => entry.operation === 'refresh')).toMatchObject([
          { status: 200, completed: true },
        ]);

        // The lease claim is already committed. Freeze the upcoming persistence
        // transaction, then prove via PG that this exact API PID is waiting on
        // our user lock before killing it. No production hooks or guessed delay.
        await blocker.query('BEGIN');
        const blockerPid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        await blocker.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE', [PRINCIPAL]);
        const claimed = await readBatch();
        expect(claimed.revision).toBe(staged.revision + 1);
        expect(claimed.ciphertext === staged.ciphertext).toBe(true);
        expect(claimed.lease_id).not.toBeNull();
        expect(claimed.lease_until.getTime()).toBeGreaterThan(Date.now());
        verified.release();
        await expect
          .poll(
            async () =>
              (
                await target.pool.query(
                  `SELECT count(*)::int AS n FROM pg_stat_activity
           WHERE datname=current_database() AND application_name='backup-process-before-crash'
             AND state='active' AND wait_event_type='Lock'
             AND query LIKE '%"user"%for update%'
             AND $1::int = ANY(pg_blocking_pids(pid))`,
                  [blockerPid],
                )
              ).rows[0].n,
            { timeout: 10_000, interval: 25 },
          )
          .toBe(1);
        mark('save-waiter-proven');
        expect(await one.crash()).toEqual({ code: null, signal: 'SIGKILL' });
        mark('first-process-killed');
        expect(await pending).toBe(502);
        expect(await readBatch()).toEqual(claimed);
        expect(
          (
            await target.pool.query('SELECT * FROM account_identities WHERE user_id=$1', [
              PRINCIPAL,
            ])
          ).rows[0],
        ).toEqual(identityBefore);
        expect(
          (
            await target.pool.query(
              'SELECT candidate_ciphertext FROM account_recovery_requests WHERE id=$1',
              [requestId],
            )
          ).rows[0].candidate_ciphertext === candidateCiphertext,
        ).toBe(true);
        await blocker.query('ROLLBACK');

        const replacement = await start('backup-process-after-crash');
        mark('replacement-ready');
        expect(replacement.pid).not.toBe(one.pid);
        expect(replacement.pid).not.toBe(process.pid);
        const busy = await request(replacement, '/api/v1/account/recovery/retry', { requestId });
        expect(busy.status).toBe(503);
        expect(await busy.json()).toMatchObject({
          error: { code: 'ACCOUNT_IDENTITY_UNVERIFIED', retryable: true },
        });
        expect(fixture.count({ operation: 'refresh' })).toBe(1);
        expect(await readBatch()).toEqual(claimed);
        expect((await request(replacement, '/api/v1/prompts')).status).toBe(403);
        expect((await request(replacement, '/api/v1/generations', {})).status).toBe(403);
        expect(
          (await target.pool.query('SELECT user_id FROM session WHERE id=$1', [sessionId])).rows,
        ).toEqual([{ user_id: PRINCIPAL }]);
        expect(
          (
            await target.pool.query(
              'SELECT mode FROM account_session_authorizations WHERE session_id=$1',
              [sessionId],
            )
          ).rows,
        ).toEqual([{ mode: 'recovery_only' }]);

        // Wait for the actual persisted 120-second lease, without changing the
        // database deadline or clocks and without repeated upstream retries.
        mark('waiting-for-natural-lease-expiry');
        await expect
          .poll(
            async () =>
              (
                await target.pool.query(
                  'SELECT lease_until <= clock_timestamp() AS expired FROM account_recovery_backup_evidence WHERE request_id=$1',
                  [requestId],
                )
              ).rows[0].expired,
            { timeout: 125_000, interval: 250 },
          )
          .toBe(true);
        mark('lease-expired');
        const expired = await request(replacement, '/api/v1/account/recovery/retry', { requestId });
        expect(expired.status).toBe(200);
        const restricted = accountSummarySchema.parse(await expired.json());
        expect(restricted).toMatchObject({
          canGenerate: false,
          identity: { principalId: PRINCIPAL, status: 'recovery_required' },
          recovery: { requestId, reason: 'legacy_evidence_missing' },
        });
        expect(fixture.requests.filter((entry) => entry.operation === 'refresh')).toMatchObject([
          { status: 200, completed: true },
          { status: 401, completed: true },
        ]);
        const rejected = await readBatch();
        expect(rejected.state).toBe('staged');
        expect(rejected.ciphertext === staged.ciphertext).toBe(true);
        expect(rejected.revision).toBe(claimed.revision + 1);
        expect(rejected.lease_id).toBeNull();
        expect(rejected.lease_until).toBeNull();
        expect(
          (await target.pool.query('SELECT count(*)::int AS n FROM account_credentials')).rows[0].n,
        ).toBe(0);
        expect(
          (await target.pool.query('SELECT count(*)::int AS n FROM relay_sessions')).rows[0].n,
        ).toBe(0);
        expect(
          (
            await target.pool.query('SELECT count(*)::int AS n FROM session WHERE id=$1', [
              sessionId,
            ])
          ).rows[0].n,
        ).toBe(1);
        expect(
          (
            await target.pool.query(
              'SELECT upstream_issuer,upstream_owner_id FROM account_identities WHERE user_id=$1',
              [PRINCIPAL],
            )
          ).rows,
        ).toEqual([{ upstream_issuer: null, upstream_owner_id: null }]);

        const independent = await request(
          replacement,
          '/api/v1/account/recovery/independent-workspace',
          { requestId },
        );
        expect(independent.status).toBe(200);
        const recovered = accountSummarySchema.parse(await independent.json());
        const newPrincipal = recovered.identity?.principalId;
        expect(newPrincipal).toBeTypeOf('string');
        expect(newPrincipal).not.toBe(PRINCIPAL);
        expect(recovered).toMatchObject({
          canGenerate: true,
          identity: { status: 'active', apiIssuer: proxy.url },
          recovery: null,
        });
        expect(
          (await target.pool.query('SELECT user_id FROM session WHERE id=$1', [sessionId])).rows,
        ).toEqual([{ user_id: newPrincipal }]);
        expect(
          (
            await target.pool.query(
              'SELECT user_id,mode FROM account_session_authorizations WHERE session_id=$1',
              [sessionId],
            )
          ).rows,
        ).toEqual([{ user_id: newPrincipal, mode: 'normal' }]);
        expect(
          (
            await target.pool.query('SELECT user_id FROM prompts WHERE id=$1', [
              'unclaimed-old-prompt',
            ])
          ).rows,
        ).toEqual([{ user_id: PRINCIPAL }]);
        const pageResponse = await request(replacement, '/api/v1/prompts');
        expect(pageResponse.status).toBe(200);
        expect(promptPageSchema.parse(await pageResponse.json()).items).toEqual([]);
        expect((await target.pool.query('SELECT id FROM jwks ORDER BY id')).rows).toEqual(
          existingJwks,
        );
        expect(
          (
            await target.pool.query(
              'SELECT status,upstream_issuer,upstream_owner_id FROM account_identities WHERE user_id=$1',
              [PRINCIPAL],
            )
          ).rows,
        ).toEqual([
          { status: 'recovery_required', upstream_issuer: null, upstream_owner_id: null },
        ]);
        const cleaned = await readBatch();
        expect(cleaned.state).toBe('revoked');
        expect(cleaned.ciphertext).toBe('');
        expect(cleaned.lease_id).toBeNull();
        expect(cleaned.lease_until).toBeNull();
        expect(
          (
            await target.pool.query(
              'SELECT status,completed_user_id,candidate_ciphertext FROM account_recovery_requests WHERE id=$1',
              [requestId],
            )
          ).rows,
        ).toEqual([
          { status: 'completed', completed_user_id: newPrincipal, candidate_ciphertext: '' },
        ]);
        expect(
          (
            await target.pool.query('SELECT count(*)::int AS n FROM session WHERE id=$1', [
              'old-session-never-restored',
            ])
          ).rows[0].n,
        ).toBe(0);
        expect(
          (await target.pool.query('SELECT count(*)::int AS n FROM oauth_consent')).rows[0].n,
        ).toBe(0);
        expect(
          (await target.pool.query('SELECT count(*)::int AS n FROM generation_runs')).rows[0].n,
        ).toBe(0);
        expect(fixture.count({ operation: 'refresh' })).toBe(2);
        expect(fixture.count({ operation: 'unknown' })).toBe(0);
        mark('independent-recovery-verified');
      } finally {
        mark('cleanup-start');
        refreshed?.release();
        verified?.release();
        await cleanupResources();
        mark('cleanup-complete');
      }
    }, 180_000);
  },
);
