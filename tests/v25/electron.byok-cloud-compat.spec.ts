import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { aiProviderSchema, generationJobSchema } from '@musefold/contracts';
import { type ElectronApplication, expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { connectCloud } from './cloud-crash-helpers';
import { seedFormalTextScheme } from './design-scheme-test-helpers';
import { desktopDbPath, launchV25App, v25ShellPage } from './electron-helpers';
import { localExecutionFixture, localInvoke as invoke } from './local-execution-fixture';

test('云启用前后 BYOK 默认切换、取消和两种重试保留原参数；正式 R/S 独立运行', async () => {
  test.setTimeout(90000);
  const fixture = await localExecutionFixture();
  let app: ElectronApplication | undefined;
  let userData = '';
  try {
    const first = await launchV25App('musefold-byok-compat-', { env: fixture.env });
    app = first.app;
    userData = first.userDataDir;
    let page = await v25ShellPage(app);
    const a = aiProviderSchema.parse(
      await invoke(page, 'aiProviders.create', {
        name: '自备 A',
        baseUrl: `${fixture.baseUrl}/v1`,
        model: 'fixture-a',
        apiKey: 'synthetic-a',
        activate: true,
      }),
    );
    const b = aiProviderSchema.parse(
      await invoke(page, 'aiProviders.create', {
        name: '自备 B',
        baseUrl: `${fixture.baseUrl}/v1`,
        model: 'fixture-b',
        apiKey: 'synthetic-b',
      }),
    );
    await invoke(page, 'agentConnections.create', {
      name: '自备文本',
      baseUrl: `${fixture.baseUrl}/v1`,
      model: 'fixture-text',
      apiKey: 'synthetic-text',
      activate: true,
    });
    await app.close();
    app = undefined;
    seedFormalTextScheme(userData);
    ({ app } = await launchV25App('musefold-byok-compat-', {
      reuseUserDataDir: userData,
      env: fixture.env,
    }));
    page = await v25ShellPage(app);
    const create = async (input: unknown) =>
      generationJobSchema.parse(await invoke(page, 'generation.create', input));
    const get = async (id: string) =>
      generationJobSchema.parse(await invoke(page, 'generation.get', id));
    const success = async (id: string) => {
      await expect.poll(async () => (await get(id)).status, { timeout: 15000 }).toBe('succeeded');
      return get(id);
    };
    const initial = await create({
      prompt: '自备默认 A',
      count: 2,
      negative: 'no text',
      size: '1024x1024',
      quality: 'high',
    });
    expect((await success(initial.id)).assets).toHaveLength(2);
    expect(fixture.imageCalls.at(-1)).toMatchObject({
      model: 'fixture-a',
      n: 2,
      size: '1024x1024',
      quality: 'high',
    });

    const cancelAndRetry = async (phase: string) => {
      fixture.holdImages(true);
      const beforeCancel = fixture.imageCalls.length;
      const cancelled = await create({
        providerId: a.id,
        prompt: '原任务参数应冻结',
        count: 2,
        negative: 'no lettering',
        size: '1024x1024',
        quality: 'high',
      });
      await expect.poll(() => fixture.imageCalls.length).toBe(beforeCancel + 1);
      const originalBody = fixture.imageCalls.at(-1);
      await invoke(page, 'aiProviders.setActive', { id: b.id });
      await invoke(page, 'generation.cancel', cancelled.id);
      await expect.poll(async () => (await get(cancelled.id)).status).toBe('cancelled');
      fixture.holdImages(false);
      for (const payload of [
        cancelled.id,
        { id: cancelled.id, idempotencyKey: `byok-structured-retry-${phase}` },
      ]) {
        const before = fixture.imageCalls.length;
        const retried = generationJobSchema.parse(await invoke(page, 'generation.retry', payload));
        const done = await success(retried.id);
        expect(done.parentRunId).toBe(cancelled.id);
        expect(done.assets).toHaveLength(2);
        expect(fixture.imageCalls).toHaveLength(before + 1);
        expect(fixture.imageCalls.at(-1)).toEqual(originalBody);
      }
    };
    await cancelAndRetry('before');

    const discovery = JSON.parse(readFileSync(join(userData, 'automation.json'), 'utf8')) as {
      port: number;
      token: string;
    };
    const query = async (path: string, body?: unknown, key?: string) => {
      const response = await fetch(`http://127.0.0.1:${discovery.port}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          authorization: `Bearer ${discovery.token}`,
          'content-type': 'application/json',
          ...(key ? { 'idempotency-key': key } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      expect(response.ok).toBe(true);
      return response.json() as Promise<{ jobId: string; status: string }>;
    };
    const db = new Database(desktopDbPath(userData), { readonly: true });
    const budget = () => ({
      policies: db.prepare('SELECT * FROM automation_spend_policies ORDER BY scope_id').all(),
      periods: db.prepare('SELECT * FROM automation_budget_periods ORDER BY scope_id,month').all(),
      posted: db
        .prepare('SELECT COALESCE(SUM(policy_points),0) AS points FROM automation_spend_calls')
        .get(),
      held: db
        .prepare(
          "SELECT COALESCE(SUM(reservation_points),0) AS points FROM automation_spend_requests WHERE reservation_state IN ('held','unknown')",
        )
        .get(),
    });
    try {
      for (const phase of ['before', 'after'] as const) {
        if (phase === 'after') {
          await connectCloud(page);
          const connections = (await invoke(page, 'aiProviders.list')) as Array<{
            id: string;
            type: string;
            isActive: boolean;
          }>;
          const cloud = connections.find((item) => item.type === 'musefold-cloud');
          expect(cloud?.isActive).toBe(true);
          const explicit = await create({
            providerId: a.id,
            prompt: '云默认下显式自备 A',
            count: 1,
          });
          await success(explicit.id);
          expect(fixture.imageCalls.at(-1)).toMatchObject({ model: 'fixture-a' });
          await invoke(page, 'aiProviders.setActive', { id: b.id });
          await success((await create({ prompt: '改默认后自备 B', count: 1 })).id);
          expect(fixture.imageCalls.at(-1)).toMatchObject({ model: 'fixture-b' });
          if (!cloud) throw new Error('Cloud connection missing');
          await cancelAndRetry('after');
          await invoke(page, 'aiProviders.setActive', { id: cloud.id });
        }
        const beforeBudget = budget();
        for (const [kind, path, body] of [
          [
            'scheme',
            '/v1/schemes/scheme_e2e_formal/runs',
            { inputs: { topic: '云默认下本地方案' }, brief: '固定输入' },
          ],
          [
            'skill',
            '/v1/skills/github/run',
            { url: 'https://github.com/fixture/visual', prompt: '云默认下本地 Skill' },
          ],
        ] as const) {
          const before = fixture.imageCalls.length;
          const accepted = await query(
            path,
            { ...body, providerId: a.id, n: 2 },
            `byok-${phase}-${kind}`,
          );
          await expect
            .poll(async () => (await query(`/v1/${kind}-runs/${accepted.jobId}`)).status, {
              timeout: 20000,
            })
            .toBe('success');
          expect(fixture.imageCalls).toHaveLength(before + 2);
          expect(
            fixture.imageCalls
              .slice(before)
              .every((call) => call.model === 'fixture-a' && call.n === 1),
          ).toBe(true);
        }
        expect(fixture.textCalls).toHaveLength(phase === 'before' ? 1 : 2);
        expect(fixture.githubReads.length).toBeGreaterThan(0);
        expect(fixture.cloudCreates).toEqual([]);
        expect(fixture.imageCredentials).toEqual(
          fixture.imageCalls.map((call) => (call.model === 'fixture-b' ? 'b' : 'a')),
        );
        expect(budget()).toEqual(beforeBudget);
        const calls = db.prepare('SELECT binding_json FROM automation_spend_calls').all() as Array<{
          binding_json: string;
        }>;
        expect(calls.length).toBe(phase === 'before' ? 5 : 10);
        expect(calls.every((call) => JSON.parse(call.binding_json).payerKind === 'external')).toBe(
          true,
        );
      }
    } finally {
      db.close();
    }
  } finally {
    await app?.close();
    if (userData) rmSync(userData, { recursive: true, force: true });
    await fixture.close();
  }
});
