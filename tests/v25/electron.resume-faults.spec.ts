import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type TestInfo } from '@playwright/test';
import { decodeCloudAnchor } from './cloud-crash-helpers';
import { resumeFixture, type ResumeFault } from './resume-fault-helpers';

type Fixture = Awaited<ReturnType<typeof resumeFixture>>;

function unchanged(f: Fixture) {
  const current = f.local();
  expect(current.records).toEqual(f.original.records);
  expect(current.assets).toEqual(f.original.assets);
  expect(current.runs).toEqual(f.original.runs);
}

async function evidence(f: Fixture, info: TestInfo, detail: unknown) {
  unchanged(f);
  await info.attach('resume-fault-evidence.json', {
    body: JSON.stringify(
      {
        detail,
        pids: [...f.pids, f.app.process().pid],
        original: f.original,
        local: f.local(),
        remote: await f.remote(),
        boundary:
          'Real macOS Electron/safeStorage/SQLite/Hono/PG/queue/worker and formal IPC. Synthetic identity/Provider/S3, no paid upstream. Test-owned builtins pause or fail named I/O boundaries; expiry uses main clock offset, not elapsed wall time. Windows crash/directory-fsync matrix remains separate.',
      },
      (_key, value) =>
        typeof value === 'string' ? value.replaceAll(f.root, '<test-userData>') : value,
      2,
    ),
    contentType: 'application/json',
  });
}

async function explicitRetry(f: Fixture) {
  await f.restart();
  expect(await f.status()).toMatchObject({ mode: 'query_only', reviewAction: 'resume' });
  expect(f.local().checkpoint).toEqual(f.original.checkpoint);
  await f.confirmUI();
  expect(await f.anchor()).toMatchObject({
    mode: 'active',
    pending: null,
    committed: {
      namespace: f.originalAnchor.committed.namespace,
      revision: f.originalAnchor.committed.revision + 1,
    },
  });
  unchanged(f);
}

test.beforeEach(() => {
  test.skip(
    process.env.RUN_DATABASE_TESTS !== 'true',
    'Requires isolated Docker PostgreSQL services',
  );
  test.skip(
    process.platform !== 'darwin',
    'Native macOS safeStorage/I/O fault matrix; other platforms require native evidence',
  );
  test.setTimeout(180000);
});

for (const damage of ['missing', 'corrupt'] as const) {
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires a destructured fixture argument.
  test(`实际云任务锚点 ${damage}：新 PID 拒绝新消费和备份恢复，不重建锚点`, async ({}, info) => {
    const f = await resumeFixture(false);
    try {
      const connectionId = (await f.status()).connectionId;
      const path = join(f.root, 'managed-execution.anchor');
      await f.restart(() =>
        damage === 'missing' ? unlinkSync(path) : writeFileSync(path, 'broken ciphertext'),
      );
      const assertDamage = () => {
        if (damage === 'missing') expect(existsSync(path)).toBe(false);
        else expect(readFileSync(path, 'utf8')).toBe('broken ciphertext');
      };
      const statuses: unknown[] = [];
      for (let attempt = 0; attempt < 2; attempt++) {
        const status = await f.status();
        expect(status).toMatchObject({
          mode: damage === 'missing' ? 'query_only' : 'blocked',
          reviewRef: null,
        });
        statuses.push(status);
        expect(
          await f.invoke('generation.create', {
            providerId: connectionId,
            prompt: 'must refuse damaged authority',
          }),
        ).toMatchObject({ ok: false, code: 'MANAGED_GENERATION_NOT_STARTED' });
        unchanged(f);
        expect(f.local().checkpoint).toEqual(f.original.checkpoint);
        assertDamage();
        if (attempt === 0) {
          expect(await f.restore()).toMatchObject({ ok: false });
          assertDamage();
          await f.restart();
        }
      }
      await evidence(f, info, { damage, statuses });
    } finally {
      await f.close();
    }
  });
}

const races = [
  { point: 'binding', transition: 'account' },
  { point: 'binding', transition: 'restore' },
  { point: 'write', transition: 'account' },
  { point: 'write', transition: 'restore' },
  { point: 'write', transition: 'expiry' },
] as const;
for (const { point, transition } of races) {
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires a destructured fixture argument.
  test(`resume 执行中的 ${point} 遇 ${transition}：旧确认不提交，重启须新确认`, async ({}, info) => {
    const f = await resumeFixture();
    try {
      const review = await f.status();
      expect(await f.invoke('workbench.listSessions', {})).toMatchObject({ ok: true });
      const hit = await f.arm({ point, stage: 'prepare', action: 'hold' });
      const pending = f.invoke('accountCloud.resume', { reviewRef: review.reviewRef });
      const marker = await hit();
      let restoring: ReturnType<Fixture['restore']> | undefined;
      if (transition === 'account') {
        expect(
          await f.invoke('account.login', { username: 'joint-b', password: 'synthetic-password' }),
        ).toMatchObject({ ok: true });
      } else if (transition === 'restore') {
        restoring = f.restore();
        await expect
          .poll(async () => (await f.invoke('workbench.listSessions', {})).ok)
          .toBe(false);
      } else {
        await f.app.evaluate(() => {
          const now = Date.now;
          Date.now = () => now() + 120001;
        });
      }
      f.release();
      const result = await pending;
      expect(result).toMatchObject({ ok: false });
      if (restoring)
        expect(await restoring).toMatchObject({ ok: true, data: { needsRestart: true } });
      if (transition === 'account')
        expect(
          await f.invoke('account.login', { username: 'joint-a', password: 'synthetic-password' }),
        ).toMatchObject({ ok: true });
      expect(f.local().checkpoint).toEqual(f.original.checkpoint);
      const anchorBeforeRetry = await f.anchor();
      await explicitRetry(f);
      await evidence(f, info, { point, transition, marker, result, anchorBeforeRetry });
    } finally {
      await f.close();
    }
  });
}

const failures: Array<{ point: ResumeFault['point']; stage: ResumeFault['stage'] }> = [
  ...(['open', 'write', 'sync', 'rename', 'dirsync'] as const).map((point) => ({
    point,
    stage: 'prepare' as const,
  })),
  { point: 'write', stage: 'compact' },
  { point: 'dirsync', stage: 'compact' },
];
for (const { point, stage } of failures) {
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires a destructured fixture argument.
  test(`resume ${stage}/${point} 写入故障：以 SQLite 授权提交为唯一启用点`, async ({}, info) => {
    const f = await resumeFixture();
    try {
      const review = await f.status();
      const hit = await f.arm({ point, stage, action: 'fail' });
      const result = await f.invoke('accountCloud.resume', { reviewRef: review.reviewRef });
      const marker = await hit();
      const beforeRestart = { anchor: await f.anchor(), local: f.local() };
      if (stage === 'prepare') {
        expect(result).toMatchObject({ ok: false });
        expect(await f.status()).toMatchObject({ mode: 'query_only' });
        await explicitRetry(f);
      } else {
        expect(result).toMatchObject({ ok: true, data: { mode: 'active' } });
        await f.restart();
        expect(await f.status()).toMatchObject({ mode: 'active', reviewRef: null });
        expect(f.local().checkpoint).toEqual(beforeRestart.local.checkpoint);
        expect((await f.anchor()).pending?.kind ?? null).toBe(point === 'write' ? 'resume' : null);
        expect(
          await f.invoke('accountCloud.reconcile', { requestId: f.original.records[0].requestId }),
        ).toMatchObject({ ok: true });
        expect((await f.anchor()).pending).toBeNull();
        expect(f.local().checkpoint).toEqual(beforeRestart.local.checkpoint);
      }
      await evidence(f, info, { point, stage, marker, result, beforeRestart });
    } finally {
      await f.close();
    }
  });
}

for (const stage of ['prepare', 'compact'] as const) {
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires a destructured fixture argument.
  test(`resume ${stage} SIGKILL：新 PID 只承认持久授权，原任务不重发`, async ({}, info) => {
    const f = await resumeFixture();
    try {
      const review = await f.status();
      const hit = await f.arm({
        point: stage === 'prepare' ? 'rename' : 'compact',
        stage,
        action: 'kill',
      });
      const pending = f
        .invoke('accountCloud.resume', { reviewRef: review.reviewRef })
        .catch((error: Error) => error.message);
      const marker = await hit();
      const localBefore = f.local();
      const encoded = readFileSync(join(f.root, 'managed-execution.anchor')).toString('base64');
      const killed = await f.kill();
      await pending;
      await f.restart();
      const anchorBefore = await decodeCloudAnchor(f.app, encoded);
      expect(anchorBefore.pending.kind).toBe('resume');
      expect(anchorBefore.pending.from).toEqual(f.originalAnchor.committed);
      expect(localBefore.checkpoint).toEqual([
        expect.objectContaining({
          revision:
            stage === 'prepare'
              ? anchorBefore.pending.from.revision
              : anchorBefore.pending.to.revision,
          head_hash:
            stage === 'prepare'
              ? anchorBefore.pending.from.headHash
              : anchorBefore.pending.to.headHash,
        }),
      ]);
      if (stage === 'prepare') {
        expect(await f.status()).toMatchObject({ mode: 'query_only', reviewAction: 'resume' });
        await f.confirmUI();
      } else {
        expect(await f.status()).toMatchObject({ mode: 'active', reviewRef: null });
        expect(f.local().checkpoint).toEqual(localBefore.checkpoint);
      }
      expect(f.local().checkpoint).toEqual([
        expect.objectContaining({ revision: f.originalAnchor.committed.revision + 1 }),
      ]);
      await evidence(f, info, { stage, marker, killed, localBefore, anchorBefore });
    } finally {
      await f.close();
    }
  });
}
