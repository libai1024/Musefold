import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  aiProviderSchema,
  generationJobSchema,
  promptDocumentSchema,
  workbenchSessionSchema,
} from '@musefold/contracts';
import { type ElectronApplication, expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { z } from 'zod';
import { CloudServiceProcess } from '../../apps/desktop/electron/system/__tests__/fixtures/cloud-service-process';
import { connectCloud } from './cloud-crash-helpers';
import { seedFormalTextScheme } from './design-scheme-test-helpers';
import { desktopDbPath, designSchemeDbPath, launchV25App, v25ShellPage } from './electron-helpers';
import { localExecutionFixture, localInvoke as invoke } from './local-execution-fixture';

const tables = [
  'automation_audit',
  'automation_spend_requests',
  'automation_spend_calls',
  'automation_spend_policies',
  'automation_budget_periods',
  'managed_generation_requests',
  'managed_execution_checkpoint',
] as const;
const jobReply = z.object({ jobId: z.string(), status: z.string() });
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function feeFacts(root: string) {
  const db = new Database(desktopDbPath(root), { readonly: true });
  try {
    return Object.fromEntries(
      tables.map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]),
    );
  } finally {
    db.close();
  }
}
function imageFacts(root: string, runId?: string) {
  const db = new Database(desktopDbPath(root), { readonly: true });
  try {
    const rows = db
      .prepare(
        `SELECT id,run_id,media_path FROM generated_assets ${runId ? 'WHERE run_id=?' : ''} ORDER BY id`,
      )
      .all(...(runId ? [runId] : [])) as Array<{ id: string; run_id: string; media_path: string }>;
    return rows.map((row) => ({
      ...row,
      sha256: createHash('sha256').update(readFileSync(row.media_path)).digest('hex'),
    }));
  } finally {
    db.close();
  }
}
function sourceFacts(root: string) {
  const db = new Database(designSchemeDbPath(root), { readonly: true });
  try {
    return Object.fromEntries(
      [
        'source_packages',
        'source_snapshots',
        'design_scheme_revisions',
        'design_scheme_source_bindings',
      ].map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]),
    );
  } finally {
    db.close();
  }
}
for (const cleanup of ['single', 'empty-trash'] as const) {
  test(`actual Agent G/R/S receipts survive ${cleanup}, authorized content deletion and a new Electron PID`, async () => {
    test.skip(
      process.env.RUN_DATABASE_TESTS !== 'true',
      'Requires isolated PostgreSQL and owned provider services',
    );
    test.setTimeout(180000);
    const cloud = new CloudServiceProcess();
    const local = await localExecutionFixture();
    let app: ElectronApplication | undefined;
    let root = '';
    try {
      const info = await cloud.ready;
      await cloud.request('startWorker');
      const env = { ...local.env, MUSEFOLD_API_URL: info.baseUrl };
      const launched = await launchV25App('musefold-owned-agent-retention-', { env });
      app = launched.app;
      root = launched.userDataDir;
      let page = await v25ShellPage(app);
      const provider = aiProviderSchema.parse(
        await invoke(page, 'aiProviders.create', {
          name: 'Owned Agent provider',
          baseUrl: `${local.baseUrl}/v1`,
          model: 'fixture-a',
          apiKey: 'synthetic-a',
          activate: true,
        }),
      );
      await invoke(page, 'agentConnections.create', {
        name: 'Owned text provider',
        baseUrl: `${local.baseUrl}/v1`,
        model: 'fixture-text',
        apiKey: 'synthetic-text',
        activate: true,
      });
      await app.close();
      app = undefined;
      seedFormalTextScheme(root);
      app = (await launchV25App('musefold-owned-agent-retention-', { reuseUserDataDir: root, env }))
        .app;
      page = await v25ShellPage(app);
      await connectCloud(page);
      const prompt = promptDocumentSchema.parse(
        await invoke(page, 'prompts.create', {
          title: 'Owned source',
          description: 'Owned retention fixture',
          content: 'Original retained source text',
          negative: null,
          folderId: null,
          modelId: null,
          params: null,
        }),
      );
      const session = workbenchSessionSchema.parse(
        await invoke(page, 'workbench.createSession', {
          title: 'Owned retained work',
          draft: { prompt: prompt.content },
        }),
      );
      const managed = generationJobSchema.parse(
        await invoke(page, 'generation.create', {
          prompt: prompt.content,
          sessionId: session.id,
          count: 1,
        }),
      );
      await expect
        .poll(
          async () =>
            generationJobSchema.parse(await invoke(page, 'generation.get', managed.id)).status,
          { timeout: 30000 },
        )
        .toBe('succeeded');
      const discovery = () =>
        z
          .object({ port: z.number(), token: z.string() })
          .parse(JSON.parse(readFileSync(join(root, 'automation.json'), 'utf8')));
      const request = async (
        path: string,
        method = 'GET',
        body?: unknown,
        key?: string,
        proof?: string,
      ) => {
        const d = discovery();
        return fetch(`http://127.0.0.1:${d.port}${path}`, {
          method,
          signal: AbortSignal.timeout(20000),
          headers: {
            authorization: `Bearer ${d.token}`,
            'content-type': 'application/json',
            ...(key ? { 'idempotency-key': key } : {}),
            ...(proof ? { 'x-musefold-local-proof': proof } : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      };
      const entries = [
        {
          path: '/v1/generations',
          poll: '/v1/generations',
          key: 'retained-agent-G',
          body: { prompt: prompt.content, providerId: provider.id, n: 1, consent: 'interactive' },
        },
        {
          path: '/v1/schemes/scheme_e2e_formal/runs',
          poll: '/v1/scheme-runs',
          key: 'retained-agent-R',
          body: {
            inputs: { topic: prompt.content },
            brief: prompt.content,
            providerId: provider.id,
            n: 1,
          },
        },
        {
          path: '/v1/skills/github/run',
          poll: '/v1/skill-runs',
          key: 'retained-agent-S',
          body: {
            url: 'https://github.com/fixture/visual',
            prompt: prompt.content,
            providerId: provider.id,
            n: 1,
          },
        },
      ];
      const accepted: z.infer<typeof jobReply>[] = [];
      for (const entry of entries) {
        const response = await request(entry.path, 'POST', entry.body, entry.key);
        expect(response.ok).toBe(true);
        const job = jobReply.parse(await response.json());
        accepted.push({ ...job, status: 'success' });
        await expect
          .poll(
            async () =>
              jobReply.parse(await (await request(`${entry.poll}/${job.jobId}`)).json()).status,
            { timeout: 30000 },
          )
          .toBe('success');
      }
      expect(local.imageCalls).toHaveLength(3);
      expect(local.textCalls).toHaveLength(1);
      expect(local.githubReads.length).toBeGreaterThan(0);
      const originalGithubReads = [...local.githubReads];
      const before = feeFacts(root);
      for (const table of tables) expect(before[table].length, table).toBeGreaterThan(0);
      const audits = before.automation_audit as Array<{
        action: string;
        approved_via: string;
        status: string;
      }>;
      expect(audits.map((row) => row.action)).toEqual(
        expect.arrayContaining(['generate_image', 'run_scheme', 'run_github_skill']),
      );
      const sources = sourceFacts(root);
      for (const [table, rows] of Object.entries(sources))
        expect(rows.length, table).toBeGreaterThan(0);
      const images = imageFacts(root);
      expect(images).toHaveLength(4);
      const cloudBefore = await cloud.request<{
        providerCalls: unknown[];
        calls: Array<{ method: string; path: string }>;
      }>('snapshot');
      expect(cloudBefore.providerCalls).toHaveLength(1);
      const assertRetained = () => {
        expect(feeFacts(root)).toEqual(before);
        expect(sourceFacts(root)).toEqual(sources);
      };
      // Real local HTTP authority denial must leave the seven nonempty tables and content intact.
      const denied = await request(`/v1/local/prompts/${prompt.id}`, 'DELETE');
      expect(denied.status).toBe(403);
      await denied.text();
      assertRetained();
      expect(
        promptDocumentSchema.parse(await invoke(page, 'prompts.get', { id: prompt.id })).deletedAt,
      ).toBeNull();
      const challengeResponse = await request('/v1/local/challenge', 'POST');
      expect(challengeResponse.ok).toBe(true);
      const challenge = z
        .object({ challengeId: z.string(), fileName: z.string() })
        .parse(await challengeResponse.json());
      const proof = `${challenge.challengeId}:${readFileSync(join(root, challenge.fileName), 'utf8')}`;
      const removed = await request(
        `/v1/local/prompts/${prompt.id}`,
        'DELETE',
        undefined,
        undefined,
        proof,
      );
      expect(removed.status).toBe(200);
      await removed.text();
      assertRetained();
      const reused = await request(
        `/v1/local/prompts/${prompt.id}`,
        'DELETE',
        undefined,
        undefined,
        proof,
      );
      expect(reused.status).toBe(403);
      await reused.text();
      assertRetained();
      expect(
        promptDocumentSchema.parse(await invoke(page, 'prompts.get', { id: prompt.id })).deletedAt,
      ).not.toBeNull();
      if (cleanup === 'single') await invoke(page, 'prompts.purge', { id: prompt.id });
      else expect(await invoke(page, 'prompts.emptyTrash')).toEqual({ purged: 1 });
      await expect(invoke(page, 'prompts.get', { id: prompt.id })).rejects.toThrow('NOT_FOUND');
      assertRetained();
      await invoke(page, 'workbench.removeSession', session.id);
      if (cleanup === 'single')
        expect(await invoke(page, 'workbench.purgeSession', session.id)).toEqual({ purged: 1 });
      else expect(await invoke(page, 'workbench.emptyTrash')).toEqual({ purged: 1 });
      assertRetained();
      // Real product purge, including files; R/S outputs and formal source references stay live.
      const purgedIds = [managed.id, accepted[0].jobId];
      for (const id of purgedIds) await invoke(page, 'generation.remove', id);
      if (cleanup === 'single')
        for (const id of purgedIds) await invoke(page, 'generation.purge', id);
      else
        expect(await invoke(page, 'generation.cleanup', { scope: 'empty-trash' })).toEqual({
          affected: 2,
        });
      assertRetained();
      for (const image of images.filter((item) => purgedIds.includes(item.run_id)))
        expect(existsSync(image.media_path)).toBe(false);
      const survivors = images.filter((item) => !purgedIds.includes(item.run_id));
      expect(imageFacts(root)).toEqual(survivors);
      const pid = app.process().pid;
      await app.close();
      app = undefined;
      app = (await launchV25App('musefold-owned-agent-retention-', { reuseUserDataDir: root, env }))
        .app;
      expect(app.process().pid).not.toBe(pid);
      page = await v25ShellPage(app);
      assertRetained();
      expect(imageFacts(root)).toEqual(survivors);
      for (const [index, entry] of entries.entries()) {
        const repeated = await request(entry.path, 'POST', entry.body, entry.key);
        expect(repeated.ok).toBe(true);
        expect(jobReply.parse(await repeated.json())).toEqual(accepted[index]);
      }
      expect(local.imageCalls).toHaveLength(3);
      expect(local.textCalls).toHaveLength(1);
      expect(local.githubReads).toEqual(originalGithubReads);
      const cloudAfter = await cloud.request<typeof cloudBefore>('snapshot');
      expect(cloudAfter.providerCalls).toEqual(cloudBefore.providerCalls);
      expect(
        cloudAfter.calls.filter(
          (row) => row.method === 'POST' && row.path.includes('/generations'),
        ),
      ).toEqual(
        cloudBefore.calls.filter(
          (row) => row.method === 'POST' && row.path.includes('/generations'),
        ),
      );
      assertRetained();
      expect(imageFacts(root)).toEqual(survivors);
      await test.info().attach('actual-agent-retention', {
        contentType: 'application/json',
        body: JSON.stringify({
          cleanup,
          pid,
          newPid: app.process().pid,
          tables: Object.fromEntries(
            tables.map((table) => [
              table,
              { rows: before[table].length, sha256: digest(before[table]) },
            ]),
          ),
          sources: Object.fromEntries(
            Object.entries(sources).map(([table, rows]) => [
              table,
              { rows: rows.length, sha256: digest(rows) },
            ]),
          ),
          purgedImages: images.length - survivors.length,
          retainedImages: survivors.length,
          localImageCalls: local.imageCalls.length,
          cloudProviderCalls: cloudAfter.providerCalls.length,
          scope:
            'Actual Electron/HTTP/IPC/SQLite and production API/PG/Worker with owned loopback image/text/GitHub/S3; no paid upstream; formal scheme seeded using existing repository fixture.',
        }),
      });
    } finally {
      await app?.close();
      if (root) rmSync(root, { recursive: true, force: true });
      await local.close();
      await cloud.stop();
    }
  });
}
