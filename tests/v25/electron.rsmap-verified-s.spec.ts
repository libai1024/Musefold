import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { type ElectronApplication, expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { z } from 'zod';
import { CloudServiceProcess } from '../../apps/desktop/electron/system/__tests__/fixtures/cloud-service-process';
import { managedRunRecordSchema } from '../../packages/desktop-contracts/src/managed-generation';
import { cloudEvidence, cloudLocalState, connectCloud } from './cloud-crash-helpers';
import { desktopDbPath, launchV25App, v25ShellPage } from './electron-helpers';
import { localExecutionFixture, localInvoke } from './local-execution-fixture';

// Narrow observations of the existing control-plane reply and physical SQL rows.
const replySchema = z.object({
  jobId: z.string(),
  kind: z.literal('skill'),
  status: z.string(),
  assets: z.array(z.object({ path: z.string() })),
  costPoints: z.number().nullable(),
});
const snapshotSchema = z.object({
  calls: z.array(z.object({ method: z.string(), path: z.string(), key: z.string().nullish() })),
  providerCalls: z.array(
    z.object({ authorized: z.boolean(), body: z.record(z.string(), z.unknown()) }),
  ),
  receipts: z.array(
    z.object({
      idempotency_key: z.string(),
      status: z.string(),
      cost_provenance: z.string(),
      cost_points: z.number().nullable(),
    }),
  ),
});

function ledger(userData: string) {
  const db = new Database(desktopDbPath(userData), { readonly: true });
  try {
    const rows = z
      .array(z.object({ record_json: z.string() }))
      .parse(db.prepare('SELECT record_json FROM managed_run_requests').all());
    return {
      records: rows.map((row) => managedRunRecordSchema.parse(JSON.parse(row.record_json))),
      requests: db
        .prepare(`SELECT state,outcome,error_code,approval_source,estimated_points,
        idempotency_key FROM automation_spend_requests WHERE action = 'run_github_skill'`)
        .all(),
      calls: db
        .prepare(`SELECT kind,state,cost_source,reported_points,binding_json
        FROM automation_spend_calls ORDER BY ordinal`)
        .all(),
      history: db
        .prepare('SELECT id,model,status,actual_cost,params_json FROM generation_runs ORDER BY id')
        .all(),
    };
  } finally {
    db.close();
  }
}

// biome-ignore lint/correctness/noEmptyPattern: Playwright requires a destructured fixture argument.
test('verified cloud Skill: BYOK text, one confirmation, per-image managed sends and restart replay', async ({}, testInfo) => {
  test.skip(
    process.env.RUN_DATABASE_TESTS !== 'true',
    'Requires isolated PostgreSQL and owned HTTP fixtures',
  );
  test.setTimeout(180000);
  const cloud = new CloudServiceProcess();
  const local = await localExecutionFixture();
  let app: ElectronApplication | undefined;
  let userData = '';
  try {
    const info = await cloud.ready;
    await cloud.request('startWorker');
    const env = { ...local.env, MUSEFOLD_API_URL: info.baseUrl };
    const launched = await launchV25App('musefold-rspos-verified-s-', { env });
    app = launched.app;
    userData = launched.userDataDir;
    let page = await v25ShellPage(app);
    await localInvoke(page, 'agentConnections.create', {
      name: 'Owned Skill text',
      baseUrl: `${local.baseUrl}/v1`,
      model: 'fixture-text',
      apiKey: 'synthetic-text',
      activate: true,
    });
    await connectCloud(page);
    const snapshot = async () => snapshotSchema.parse(await cloud.request('snapshot'));
    const posts = async () =>
      (await snapshot()).calls.filter(
        (call) => call.method === 'POST' && call.path === '/api/v1/generations',
      );
    const call = (path: string, body?: unknown, key?: string) => {
      const discovery = z
        .object({ port: z.number(), token: z.string() })
        .parse(JSON.parse(readFileSync(join(userData, 'automation.json'), 'utf8')));
      return fetch(`http://127.0.0.1:${discovery.port}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        signal: AbortSignal.timeout(90000),
        headers: {
          authorization: `Bearer ${discovery.token}`,
          'content-type': 'application/json',
          ...(key ? { 'idempotency-key': key } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    };
    const input = {
      url: 'https://github.com/fixture/visual',
      prompt: 'A warm geometric landscape',
      n: 2,
    };
    const key = 'rspos-verified-s';
    const submitted = call('/v1/skills/github/run', input, key);
    submitted.catch(() => undefined);
    const card = page.getByTestId('automation-confirm-card');
    await expect(card).toBeVisible();
    await expect(card).toContainText('GitHub Skill');
    await expect(page.getByTestId('automation-confirm-meta')).toContainText('2 张');
    await expect(page.getByTestId('automation-confirm-meta')).toContainText('成本未知');
    expect(await posts()).toHaveLength(0);
    expect(local.textCalls).toHaveLength(0);
    await page.getByTestId('automation-confirm-approve').click();
    const response = await submitted;
    expect(response.status).toBe(202);
    const started = replySchema.parse(await response.json());
    const state = async () =>
      replySchema.parse(await (await call(`/v1/skill-runs/${started.jobId}`)).json());
    await expect.poll(async () => (await state()).status, { timeout: 60000 }).not.toBe('running');
    const terminal = await state();
    await testInfo.attach('skill-first-terminal.json', {
      body: cloudEvidence(
        {
          terminal,
          ledger: ledger(userData),
          remote: await snapshot(),
          textCalls: local.textCalls,
          githubReads: local.githubReads,
        },
        userData,
      ),
      contentType: 'application/json',
    });
    expect(terminal.status).toBe('success');
    await expect.poll(() => cloudLocalState(userData).assets.length).toBe(2);
    expect((await state()).assets).toHaveLength(2);
    expect(terminal.costPoints).toBeNull();
    expect(local.textCalls).toHaveLength(1);
    expect(local.textCalls[0]).toMatchObject({ model: 'fixture-text' });
    expect(local.githubReads.some((path) => path.includes('/git/blobs/'))).toBe(true);
    expect(local.imageCalls).toHaveLength(0); // Images must use the account cloud, never BYOK fallback.
    expect(local.cloudCreates).toHaveLength(0);
    const facts = ledger(userData);
    expect(facts.requests).toEqual([
      expect.objectContaining({
        state: 'terminal',
        outcome: 'success',
        error_code: null,
        approval_source: 'confirmation',
        estimated_points: null,
        idempotency_key: key,
      }),
    ]);
    expect(facts.records).toHaveLength(1);
    const record = facts.records[0];
    expect(record.run).toMatchObject({
      runKind: 'run_github_skill',
      textBinding: { payerKind: 'external', policy: 'external', model: 'fixture-text' },
    });
    expect(record.children).toHaveLength(2);
    const keys = record.children.map((child) => child.remoteKey);
    expect(new Set(keys).size).toBe(2);
    for (const child of record.children) {
      expect(child.remoteKey).toMatch(/^desktop-rs-v1:/);
      expect(child.callId).not.toBeNull();
      expect(child.receipt).toMatchObject({ status: 'succeeded', costProvenance: 'unknown' });
    }
    // Ordinals reserve the image slots first; the independently bound text call follows them.
    expect(facts.calls).toEqual([
      expect.objectContaining({
        kind: 'image',
        state: 'unknown',
        reported_points: null,
        cost_source: 'unknown',
      }),
      expect.objectContaining({
        kind: 'image',
        state: 'unknown',
        reported_points: null,
        cost_source: 'unknown',
      }),
      expect.objectContaining({
        kind: 'text',
        state: 'unknown',
        reported_points: null,
        cost_source: 'unknown',
      }),
    ]);
    const remote = await snapshot();
    expect(facts.history).toHaveLength(2);
    for (const raw of facts.history) {
      const row = z
        .object({ params_json: z.string(), status: z.literal('success'), actual_cost: z.null() })
        .parse(raw);
      expect(JSON.parse(row.params_json)).toMatchObject({
        skillRuntime: {
          label: expect.any(String),
          repositoryUrl: input.url,
          executionMode: 'agent',
          trace: expect.any(Array),
        },
      });
    }
    expect((await posts()).map((p) => p.key).sort()).toEqual([...keys].sort());
    expect(remote.providerCalls).toHaveLength(2);
    for (const sent of remote.providerCalls) {
      expect(sent).toMatchObject({ authorized: true, body: { n: 1 } });
      expect(sent.body).not.toHaveProperty('skillRuntime');
    }
    expect(remote.receipts).toHaveLength(2);
    for (const receipt of remote.receipts)
      expect(receipt).toMatchObject({
        status: 'succeeded',
        cost_provenance: 'unknown',
        cost_points: null,
      });
    const assets = cloudLocalState(userData).assets.map((asset) => ({
      id: asset.id,
      sha256: createHash('sha256').update(readFileSync(asset.media_path)).digest('hex'),
    }));
    const githubReads = [...local.githubReads];
    const sameProcessReplay = await call('/v1/skills/github/run', input, key);
    expect(sameProcessReplay.status).toBe(200);
    expect(replySchema.parse(await sameProcessReplay.json())).toEqual(await state());
    const firstPid = app.process().pid;
    await app.close();
    app = undefined;
    app = (await launchV25App('musefold-rspos-verified-s-', { reuseUserDataDir: userData, env }))
      .app;
    page = await v25ShellPage(app);
    expect(app.process().pid).not.toBe(firstPid);
    await expect.poll(() => existsSync(join(userData, 'automation.json'))).toBe(true);
    const replay = await call('/v1/skills/github/run', input, key);
    // Existing control-plane semantics: the new process accepts the lookup as 202;
    // only its in-memory duplicate Promise returns 200. Durable payload/side effects stay frozen.
    expect(replay.status).toBe(202);
    expect(replySchema.parse(await replay.json())).toEqual(await state());
    expect((await state()).status).toBe('success');
    await expect(page.getByTestId('automation-confirm-card')).toHaveCount(0);
    expect(ledger(userData)).toEqual(facts);
    expect(await snapshot()).toMatchObject({
      providerCalls: remote.providerCalls,
      receipts: remote.receipts,
    });
    expect(await posts()).toHaveLength(2);
    expect(local.textCalls).toHaveLength(1);
    expect(local.githubReads).toEqual(githubReads);
    expect(
      cloudLocalState(userData).assets.map((asset) => ({
        id: asset.id,
        sha256: createHash('sha256').update(readFileSync(asset.media_path)).digest('hex'),
      })),
    ).toEqual(assets);
    // A cached same-process replay must not bypass the current account query guard.
    expect(
      await localInvoke(page, 'account.login', {
        username: 'joint-b',
        password: 'synthetic-password',
      }),
    ).toMatchObject({ id: info.owners[1], identity: { principalId: info.owners[1] } });
    const switchedReplay = await call('/v1/skills/github/run', input, key);
    expect(switchedReplay.status).toBe(409);
    expect(
      await localInvoke(page, 'account.login', {
        username: 'joint-a',
        password: 'synthetic-password',
      }),
    ).toMatchObject({ id: info.owners[0], identity: { principalId: info.owners[0] } });
    const ownerReplay = await call('/v1/skills/github/run', input, key);
    expect(ownerReplay.status).toBe(200);
    expect(replySchema.parse(await ownerReplay.json())).toEqual(await state());
    expect(ledger(userData)).toEqual(facts);
    expect(await posts()).toHaveLength(2);
    expect(local.textCalls).toHaveLength(1);
    expect(local.githubReads).toEqual(githubReads);
    await testInfo.attach('verified-s-evidence.json', {
      body: cloudEvidence(
        {
          boundary:
            'Real Electron confirmation/SQLite/new PID; real Hono/PG/Worker. Synthetic identity, GitHub, BYOK text, image Provider and S3; no paid upstream.',
          record,
          requests: facts.requests,
          calls: facts.calls,
          remote,
          assets,
          firstPid,
          replayPid: app.process().pid,
          textCalls: local.textCalls.length,
        },
        userData,
      ),
      contentType: 'application/json',
    });
  } finally {
    await app?.close();
    await cloud.stop();
    await local.close();
    if (userData) rmSync(userData, { recursive: true, force: true });
  }
});
