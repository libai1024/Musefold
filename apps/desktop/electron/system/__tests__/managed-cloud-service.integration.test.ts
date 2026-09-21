import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGenerationInputSchema, type GenerationExecutionReceipt } from '@musefold/contracts';
import { PREVIEWS_DIR_NAME } from '@musefold/core/constants';
import { configureTestCoreRuntime } from '@musefold/core/testing';
import { closeDb, getDb, initDb } from '@musefold/core/db';
import { createWorkbenchRepositories } from '@musefold/core/db/repositories/workbench';
import { EncryptedManagedAnchorFile } from '@musefold/core/services/managed-execution-anchor-file';
import { fixtureCipher } from '@musefold/core/services/__tests__/fixtures/managed-anchor-cipher';
import { managedGenerationRecordSchema } from '@musefold/desktop-contracts/managed-generation';
import type { AutomationSpendRequest } from '@musefold/desktop-contracts/automation-spend';
import { CloudServiceProcess, type JointServerInfo } from './fixtures/cloud-service-process';
const state = vi.hoisted(() => ({
  root: '',
  access: vi.fn(),
  anchor: vi.fn(),
  budget: {} as unknown,
}));
vi.mock('../../main/ipc-v25/account-domain', () => ({
  captureManagedAccountSession: state.access,
}));
vi.mock('../../security/managed-execution-anchor', () => ({
  createManagedExecutionAnchor: state.anchor,
}));
vi.mock('../paths', () => ({
  getPaths: () => ({ userData: state.root, pictures: join(state.root, 'pictures') }),
}));
vi.mock('electron-store', () => ({
  default: class {
    get(key: string, fallback?: unknown) {
      return key === 'automation.budget' ? state.budget : fallback;
    }
    set(key: string, value: unknown) {
      if (key === 'automation.budget') state.budget = value;
    }
  },
}));

import { applyAccountCloudReview, getAccountCloudStatus } from '../account-cloud-connection';
import {
  startManagedGeneration,
  reconcileManagedGeneration,
  cancelManagedGeneration,
} from '../managed-generation-runtime';
import { startManagedDurableRun, reconcileManagedDurableRun } from '../managed-run-runtime';
import { managedExecutionWorkScope } from '../managed-execution';
import { getAutomationSpendRepository } from '../../settings/automation';
import { describeManagedRecovery } from '../account-cloud-recovery';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
type Snapshot = {
  calls: Array<{ method: string; path: string; key?: string; body?: unknown; status: number }>;
  providerCalls: Array<{
    body: {
      prompt?: string;
      n?: number;
      size?: string;
      quality?: string;
      edits?: boolean;
      imageCount?: number;
      byteLength?: number;
    };
    authorized: boolean;
  }>;
  runs: Array<{
    id: string;
    user_id: string;
    status: string;
    request: unknown;
    parent_run_id: string | null;
    run_kind: string;
    cost_points: number | null;
  }>;
  receipts: Array<{
    principal_id: string;
    original_run_id: string;
    operation: string;
    source_run_id: string | null;
    idempotency_key: string;
    status: string;
    dispatch: string;
    cost_provenance: string;
    cost_points: number | null;
    binding: GenerationExecutionReceipt['binding'];
    purged_at: string | null;
  }>;
  assets: Array<{ id: string; run_id: string }>;
};
describeDb('formal desktop runtime → Hono/PG/Graphile/worker → controlled provider/S3', () => {
  let service: CloudServiceProcess;
  let info: JointServerInfo;
  let access: ReturnType<typeof session>;
  function session(owner: string) {
    let current = true;
    return {
      session: {
        version: 2 as const,
        token: `synthetic-joint-bearer-${owner}`,
        ownerId: owner,
        apiIssuer: info.baseUrl,
        principalId: owner,
        authEpoch: randomUUID(),
        restricted: false,
        pendingRecovery: null,
      },
      assertCurrent() {
        if (!current) throw new Error('STALE_ACCOUNT');
      },
      async assertFresh() {
        this.assertCurrent();
      },
      invalidate: vi.fn(async () => {}),
      expire() {
        current = false;
      },
    };
  }
  beforeAll(async () => {
    service = new CloudServiceProcess();
    info = await service.ready;
  }, 120000);
  beforeEach(async () => {
    info = await service.request<JointServerInfo>('reset');
    state.root = mkdtempSync(join(tmpdir(), 'musefold-joint-runtime-'));
    configureTestCoreRuntime(state.root);
    initDb();
    state.budget = {
      monthlyLimitPoints: 100,
      usedPoints: 0,
      month: new Date().toISOString().slice(0, 7),
    };
    state.anchor
      .mockReset()
      .mockReturnValue(new EncryptedManagedAnchorFile(join(state.root, 'anchor'), fixtureCipher));
    access = session(info.owners[0]);
    state.access.mockReset().mockImplementation(async () => access);
  });
  afterEach(async () => {
    await managedExecutionWorkScope().drainForRestore(5000);
    await service.request('stopWorker');
    closeDb();
    if (state.root) rmSync(state.root, { recursive: true, force: true });
  });
  afterAll(async () => {
    await service?.stop();
  });
  const snapshot = () => service.request<Snapshot>('snapshot');
  function records() {
    return (
      getDb()
        .prepare('SELECT record_json FROM managed_generation_requests ORDER BY rowid')
        .all() as Array<{ record_json: string }>
    ).map((row) => managedGenerationRecordSchema.parse(JSON.parse(row.record_json)));
  }
  async function enable() {
    const status = await getAccountCloudStatus();
    const connection = (await applyAccountCloudReview(status.reviewRef ?? '', 'connect'))
      .connectionId;
    if (!connection) throw new Error('Missing reviewed connection');
    return connection;
  }
  async function start(providerId: string, count = 1, negative?: string) {
    const input = createGenerationInputSchema.parse({
      providerId,
      prompt: `synthetic-${randomUUID()}`,
      count,
      ...(negative ? { negative } : {}),
    });
    const id = randomUUID();
    await startManagedGeneration(input, {
      providerId,
      jobId: id,
      prompt: input.prompt,
      size: input.size,
      quality: input.quality,
      n: input.count,
      aspectRatio: input.aspectRatio,
    });
    return id;
  }
  async function retry(providerId: string, sourceId: string, callerKey: string) {
    const source = records().find(
      (r) => r.localGenerationId === sourceId || r.callerKey === sourceId,
    );
    if (!source) throw new Error('Missing retry source');
    const input = createGenerationInputSchema.parse({ ...source.frozenRequest, providerId });
    return startManagedGeneration(
      input,
      {
        providerId,
        jobId: randomUUID(),
        prompt: input.prompt,
        size: input.size,
        quality: input.quality,
        n: input.count,
        aspectRatio: input.aspectRatio,
      },
      { retryOfRequestId: source.requestId, retryOfRunId: sourceId, callerKey },
    );
  }
  async function queuedCancelled(providerId: string) {
    const id = await start(providerId, 2, 'no text');
    await vi.waitFor(async () => expect((await snapshot()).runs).toHaveLength(1));
    await cancelManagedGeneration(records()[0].requestId);
    await vi.waitFor(
      () => expect(createWorkbenchRepositories(getDb()).runs.get(id)?.status).toBe('cancelled'),
      { timeout: 5000 },
    );
    return id;
  }
  async function settled(id: string, result = 'available') {
    await vi.waitFor(
      async () => {
        const record = records().find((r) => r.localGenerationId === id || r.callerKey === id);
        if (!record) throw new Error('Missing durable request');
        await reconcileManagedGeneration(record.requestId);
        const updated = records().find((r) => r.requestId === record.requestId);
        if (!updated) throw new Error('Missing reconciled request');
        expect(describeManagedRecovery(updated).result).toBe(result);
      },
      { timeout: 15000, interval: 150 },
    );
  }
  it.each([1, 2, 4])(
    'sends %i original images through real services and preserves unknown fee',
    async (count) => {
      const providerId = await enable();
      const id = await start(providerId, count, 'no text');
      await service.request('startWorker');
      await settled(id);
      const record = records()[0];
      const remote = await snapshot();
      const posts = remote.calls.filter(
        (call) => call.path === '/api/v1/generations' && call.method === 'POST',
      );
      expect(posts).toHaveLength(1);
      expect(posts[0]).toMatchObject({
        key: record.remoteKey,
        body: { ...record.frozenRequest, expectedBinding: record.binding },
        status: 201,
      });
      expect(remote.providerCalls).toHaveLength(1);
      expect(remote.providerCalls[0]).toMatchObject({
        authorized: true,
        body: { n: count, prompt: `${record.frozenRequest.prompt}\n\nNegative prompt: no text` },
      });
      expect(remote.providerCalls[0].body.size).toBeUndefined();
      expect(remote.receipts[0]).toMatchObject({
        principal_id: info.owners[0],
        idempotency_key: record.remoteKey,
        binding: record.binding,
        status: 'succeeded',
        cost_provenance: 'unknown',
        cost_points: null,
      });
      const assets = getDb()
        .prepare('SELECT * FROM generated_assets ORDER BY position')
        .all() as Array<{
        media_path: string;
        width: number;
        height: number;
        file_size: number;
      }>;
      expect(assets).toHaveLength(count);
      expect(remote.assets).toHaveLength(count);
      for (const [index, asset] of assets.entries()) {
        expect(readFileSync(asset.media_path)).toEqual(Buffer.from(info.pngs[index], 'base64'));
        expect(asset).toMatchObject({
          width: 3 + index,
          height: 2,
          file_size: Buffer.from(info.pngs[index], 'base64').length,
        });
      }
      expect(createWorkbenchRepositories(getDb()).runs.get(id)).toMatchObject({
        status: 'success',
        actualCost: null,
      });
      expect(getAutomationSpendRepository().budget(Date.now()).hasUnknown).toBe(true);
      await reconcileManagedGeneration(record.requestId);
      expect((await snapshot()).providerCalls).toHaveLength(1);
    },
    30000,
  );

  it('lost POST reply then purge ends remote success without replacement generation', async () => {
    await service.request('configure', { breakCreate: true });
    const id = await start(await enable());
    await vi.waitFor(async () => expect((await snapshot()).runs).toHaveLength(1));
    await service.request('startWorker');
    await vi.waitFor(async () => expect((await snapshot()).runs[0].status).toBe('succeeded'), {
      timeout: 15000,
    });
    const remoteId = (await snapshot()).runs[0].id;
    await service.request('purge', { runId: remoteId });
    await settled(id, 'purged');
    expect(createWorkbenchRepositories(getDb()).runs.get(id)?.status).toBe('success');
    expect(getDb().prepare('SELECT count(*) AS n FROM generated_assets').get()).toEqual({ n: 0 });
    const remote = await snapshot();
    expect(remote.providerCalls).toHaveLength(1);
    expect(
      remote.calls.filter((c) => c.path === '/api/v1/generations' && c.method === 'POST'),
    ).toHaveLength(1);
    expect(remote.receipts[0].purged_at).not.toBeNull();
    expect(getAutomationSpendRepository().budget(Date.now()).hasUnknown).toBe(true);
  }, 30000);

  it('restores missing local bytes after credential rotation using the original owned receipt', async () => {
    const id = await start(await enable());
    await service.request('startWorker');
    await settled(id);
    const record = records()[0];
    const asset = getDb().prepare('SELECT * FROM generated_assets').get() as { media_path: string };
    rmSync(asset.media_path);
    await service.request('rotate');
    await settled(id);
    expect(readFileSync(asset.media_path)).toEqual(Buffer.from(info.png, 'base64'));
    expect(getDb().prepare('SELECT * FROM generated_assets').get()).toEqual(asset);
    expect(records()[0].binding).toEqual(record.binding);
    expect((await snapshot()).providerCalls).toHaveLength(1);
  }, 30000);

  it('cancels an actual queued PG task with known zero cost and no provider dispatch', async () => {
    const id = await start(await enable());
    await vi.waitFor(async () => expect((await snapshot()).runs).toHaveLength(1));
    await cancelManagedGeneration(records()[0].requestId);
    await vi.waitFor(
      () => expect(createWorkbenchRepositories(getDb()).runs.get(id)?.status).toBe('cancelled'),
      { timeout: 5000 },
    );
    await service.request('startWorker');
    const remote = await snapshot();
    expect(remote.providerCalls).toHaveLength(0);
    expect(remote.receipts[0]).toMatchObject({
      status: 'cancelled',
      cost_provenance: 'not_sent',
      cost_points: 0,
    });
    expect(getAutomationSpendRepository().budget(Date.now())).toMatchObject({
      hasUnknown: false,
      usedPoints: 0,
    });
  }, 30000);

  it.each([false, true])(
    'retries once with a fresh binding and owned parent, broken retry response=%s',
    async (breakRetry) => {
      const providerId = await enable();
      const sourceId = await queuedCancelled(providerId);
      const parent = records()[0];
      await service.request('rotate');
      await service.request('configure', { breakRetry });
      const callerKey = `desktop-retry:${randomUUID()}`;
      const ids = await Promise.all([
        retry(providerId, sourceId, callerKey),
        retry(providerId, sourceId, callerKey),
      ]);
      expect(ids[0]).toBe(ids[1]);
      await vi.waitFor(async () => expect((await snapshot()).runs).toHaveLength(2));
      await service.request('startWorker');
      await settled(ids[0]);
      const child = records().find((r) => r.callerKey === callerKey);
      if (!child) throw new Error('Missing retry');
      expect(child.retryOf).toEqual({
        requestId: parent.requestId,
        remoteRunId: parent.receipt?.originalRunId,
      });
      expect(child.binding.credential.version).toBe(parent.binding.credential.version + 1);
      expect(child.binding.payer).toEqual(parent.binding.payer);
      expect(child.remoteKey).not.toBe(parent.remoteKey);
      expect(child.receipt).toMatchObject({
        operation: 'explicit_retry',
        sourceRunId: parent.receipt?.originalRunId,
        status: 'succeeded',
        costProvenance: 'unknown',
        costPoints: null,
      });
      expect(records()[0]).toEqual(parent);
      expect(await retry(providerId, sourceId, callerKey)).toBe(ids[0]);
      const remote = await snapshot();
      const posts = remote.calls.filter(
        (c) =>
          c.method === 'POST' && (c.path.endsWith('/generations') || c.path.endsWith('/retry')),
      );
      expect(posts).toHaveLength(2);
      expect(posts[1]).toMatchObject({
        path: `/api/v1/generations/${parent.receipt?.originalRunId}/retry`,
        key: child.remoteKey,
        body: { expectedBinding: child.binding },
        status: 201,
      });
      expect(remote.runs.find((r) => r.id === child.receipt?.originalRunId)).toMatchObject({
        parent_run_id: parent.receipt?.originalRunId,
        run_kind: 'retry',
      });
      expect(remote.receipts.find((r) => r.idempotency_key === child.remoteKey)).toMatchObject({
        operation: 'explicit_retry',
        source_run_id: parent.receipt?.originalRunId,
        cost_points: null,
      });
      expect(remote.providerCalls).toHaveLength(1);
      expect(remote.providerCalls[0].body).toMatchObject({
        n: 2,
        prompt: `${parent.frozenRequest.prompt}\n\nNegative prompt: no text`,
      });
      expect(remote.assets).toHaveLength(2);
      expect(getDb().prepare('SELECT count(*) AS n FROM generation_runs').get()).toEqual({ n: 2 });
      expect(createWorkbenchRepositories(getDb()).runs.get(ids[0])).toMatchObject({
        parentRunId: sourceId,
        runKind: 'retry',
      });
      expect(getAutomationSpendRepository().budget(Date.now())).toMatchObject({
        usedPoints: 0,
        hasUnknown: true,
      });
    },
    30000,
  );

  it('refuses a failed unknown-cost retry before a new authorization or network POST', async () => {
    await service.request('configure', { providerStatus: 500 });
    const providerId = await enable();
    const id = await start(providerId);
    await service.request('startWorker');
    await vi.waitFor(
      async () => {
        await reconcileManagedGeneration(records()[0].requestId);
        expect(createWorkbenchRepositories(getDb()).runs.get(id)?.status).toBe('failed');
      },
      { timeout: 15000 },
    );
    const before = records();
    await expect(retry(providerId, id, `desktop-retry:${randomUUID()}`)).rejects.toThrow(
      'MANAGED_RETRY_UNRESOLVED',
    );
    expect(records()).toEqual(before);
    const remote = await snapshot();
    expect(remote.runs).toHaveLength(1);
    expect(remote.providerCalls).toHaveLength(1);
    expect(remote.calls.filter((c) => c.path.endsWith('/retry'))).toHaveLength(0);
    expect(getAutomationSpendRepository().budget(Date.now()).hasUnknown).toBe(true);
  }, 30000);

  it('isolates two concurrent authorized sends without mixing request keys or assets', async () => {
    const providerId = await enable();
    const ids = await Promise.all([start(providerId, 2), start(providerId, 4)]);
    await vi.waitFor(async () => expect((await snapshot()).runs).toHaveLength(2));
    await service.request('startWorker');
    await Promise.all(ids.map((id) => settled(id)));
    const remote = await snapshot();
    expect(remote.providerCalls).toHaveLength(2);
    expect(remote.providerCalls.map((call) => call.body.n).sort()).toEqual([2, 4]);
    expect(new Set(remote.receipts.map((receipt) => receipt.idempotency_key)).size).toBe(2);
    expect(remote.assets).toHaveLength(6);
    for (const record of records()) {
      expect(
        remote.receipts.find((receipt) => receipt.idempotency_key === record.remoteKey),
      ).toMatchObject({ binding: record.binding, principal_id: info.owners[0] });
      expect(
        getDb()
          .prepare('SELECT count(*) AS n FROM generated_assets WHERE run_id=?')
          .get(record.callerKey),
      ).toEqual({ n: record.frozenRequest.count });
    }
  }, 30000);

  it('refuses a rotated credential before provider claim without losing the original zero-cost receipt', async () => {
    const id = await start(await enable());
    await vi.waitFor(async () => expect((await snapshot()).runs).toHaveLength(1));
    await service.request('rotate');
    await service.request('startWorker');
    await vi.waitFor(
      async () => {
        await reconcileManagedGeneration(records()[0].requestId);
        expect(createWorkbenchRepositories(getDb()).runs.get(id)?.status).toBe('failed');
      },
      { timeout: 15000 },
    );
    const remote = await snapshot();
    expect(remote.providerCalls).toHaveLength(0);
    expect(remote.receipts[0]).toMatchObject({
      status: 'failed',
      cost_provenance: 'not_sent',
      cost_points: 0,
    });
    expect(getAutomationSpendRepository().budget(Date.now()).hasUnknown).toBe(false);
  }, 30000);

  it('rejects foreign-owner recovery and old callbacks, then lets the original owner query after relogin', async () => {
    await service.request('configure', { holdProvider: true });
    const id = await start(await enable());
    await service.request('startWorker');
    await vi.waitFor(async () => expect((await snapshot()).providerCalls).toHaveLength(1));
    const original = records()[0];
    access.expire();
    access = session(info.owners[1]);
    await service.request('release');
    await vi.waitFor(async () => expect((await snapshot()).runs[0].status).toBe('succeeded'));
    await vi.waitFor(
      async () => {
        await expect(reconcileManagedGeneration(original.requestId)).rejects.toThrow(
          'MANAGED_IDENTITY_CHANGED',
        );
      },
      { timeout: 5000 },
    );
    const response = await fetch(
      `${info.baseUrl}/api/v1/generations/receipts/by-key?key=${encodeURIComponent(original.remoteKey)}`,
      { headers: { authorization: `Bearer ${access.session.token}` } },
    );
    expect(response.status).toBe(404);
    expect(getDb().prepare('SELECT count(*) AS n FROM generated_assets').get()).toEqual({ n: 0 });
    access = session(info.owners[0]);
    await settled(id);
    expect((await snapshot()).providerCalls).toHaveLength(1);
    expect(records()[0].binding).toEqual(original.binding);
  }, 30000);

  it('cancels after provider dispatch without calling the already-started request free', async () => {
    await service.request('configure', { holdProvider: true });
    const id = await start(await enable());
    await service.request('startWorker');
    await vi.waitFor(async () => expect((await snapshot()).providerCalls).toHaveLength(1));
    await cancelManagedGeneration(records()[0].requestId);
    await service.request('release');
    await vi.waitFor(
      async () => {
        await reconcileManagedGeneration(records()[0].requestId);
        expect(createWorkbenchRepositories(getDb()).runs.get(id)?.status).toBe('cancelled');
      },
      { timeout: 15000 },
    );
    expect((await snapshot()).receipts[0]).toMatchObject({
      status: 'cancelled',
      dispatch: 'claimed',
      cost_provenance: 'unknown',
      cost_points: null,
    });
    expect(getAutomationSpendRepository().budget(Date.now()).hasUnknown).toBe(true);
    expect((await snapshot()).providerCalls).toHaveLength(1);
  }, 30000);

  it('rejects unsupported references before actual API acceptance or worker dispatch', async () => {
    const providerId = await enable();
    const input = createGenerationInputSchema.parse({
      providerId,
      prompt: 'synthetic unsupported',
      promptId: 'local-library',
    });
    await expect(
      startManagedGeneration(input, {
        providerId,
        jobId: randomUUID(),
        prompt: input.prompt,
        size: input.size,
        quality: input.quality,
        n: input.count,
      }),
    ).rejects.toThrow('MANAGED_INPUT_UNSUPPORTED');
    const remote = await snapshot();
    expect(remote.runs).toHaveLength(0);
    expect(remote.providerCalls).toHaveLength(0);
    expect(remote.calls.filter((call) => call.method === 'POST')).toHaveLength(0);
    expect(records()).toHaveLength(0);
  });

  it('uploads staged references, freezes digests, and dispatches once through the edits channel', async () => {
    const providerId = await enable();
    const referencePng = Buffer.from(info.png, 'base64');
    const uploads = join(state.root, PREVIEWS_DIR_NAME, 'uploads');
    mkdirSync(uploads, { recursive: true });
    writeFileSync(join(uploads, 'stagedref01.png'), referencePng);
    const input = createGenerationInputSchema.parse({
      providerId,
      prompt: 'synthetic reference wiring',
      referenceImages: [
        {
          id: 'stagedref01',
          url: `media://local/?p=${encodeURIComponent(join(uploads, 'stagedref01.png'))}`,
          name: 'stagedref01.png',
          mimeType: 'image/png',
          byteSize: referencePng.length,
        },
      ],
    });
    const id = randomUUID();
    await startManagedGeneration(input, {
      providerId,
      jobId: id,
      prompt: input.prompt,
      size: input.size,
      quality: input.quality,
      n: input.count,
      referenceImages: [
        { path: join(uploads, 'stagedref01.png'), source: 'upload', name: 'stagedref01.png' },
      ],
    });
    await service.request('startWorker');
    await settled(id);
    const record = records()[0];
    expect(record.frozenRequest.referenceImages).toHaveLength(1);
    expect(record.frozenRequest.referenceImages[0]).toMatchObject({
      mimeType: 'image/png',
      byteSize: referencePng.length,
      digest: createHash('sha256').update(referencePng).digest('hex'),
    });
    const remote = await snapshot();
    expect(
      remote.calls.filter(
        (call) => call.path === '/api/v1/reference-images' && call.method === 'POST',
      ),
    ).toHaveLength(1);
    const posts = remote.calls.filter(
      (call) => call.path === '/api/v1/generations' && call.method === 'POST',
    );
    expect(posts).toHaveLength(1);
    const posted = posts[0]?.body as { referenceImages?: Array<{ id: string; digest: string }> };
    expect(posted?.referenceImages).toMatchObject([
      {
        id: record.frozenRequest.referenceImages[0]?.id,
        digest: record.frozenRequest.referenceImages[0]?.digest,
      },
    ]);
    expect(remote.providerCalls).toHaveLength(1);
    expect(remote.providerCalls[0]).toMatchObject({
      body: { edits: true, imageCount: 1 },
      authorized: true,
    });
    expect(createWorkbenchRepositories(getDb()).runs.get(id)?.status).toBe('success');
  }, 30000);

  it('retains unknown cost after actual upstream HTTP failure', async () => {
    await service.request('configure', { providerStatus: 500 });
    const id = await start(await enable());
    await service.request('startWorker');
    await vi.waitFor(
      async () => {
        await reconcileManagedGeneration(records()[0].requestId);
        expect(createWorkbenchRepositories(getDb()).runs.get(id)?.status).toBe('failed');
      },
      { timeout: 15000 },
    );
    const remote = await snapshot();
    expect(remote.providerCalls).toHaveLength(1);
    expect(remote.receipts[0]).toMatchObject({
      status: 'failed',
      dispatch: 'claimed',
      cost_provenance: 'unknown',
      cost_points: null,
    });
    expect(getAutomationSpendRepository().budget(Date.now()).hasUnknown).toBe(true);
  }, 30000);

  // ---- RS-MAP:R/S 运行走真实 api/PG/worker,每张原图一次受管子发送 ----
  it('executes an R/S run through real services: one reservation, one child send per original', async () => {
    const providerId = await enable();
    const jobIds = [randomUUID(), randomUUID()];
    const callerKey = `rs-int-${randomUUID()}`;
    let terminalRow: AutomationSpendRequest | null = null;
    type RunDrive = Parameters<Parameters<typeof startManagedDurableRun>[0]['drive']>[0];
    const spec = (drive?: (tools: RunDrive) => Promise<'success' | 'failed' | 'cancelled'>) => ({
      runKind: 'run_scheme' as const,
      providerId,
      callerKey,
      caller: 'local-automation',
      executionId: `ext_${randomUUID()}`,
      originalJobIds: jobIds,
      input: { params: { id: 'dsch_fixture' }, body: { n: 2 } },
      frozenRun: {
        body: { n: 2 },
        params: { id: 'dsch_fixture' },
        jobIds,
        runId: 'dsr_fixture',
        source: { sourceDigest: 'fixture-source-digest' },
      },
      textBinding: null,
      authorizePath: () => true,
      authorize: async () => {},
      drive:
        drive ??
        (async (tools: RunDrive) => {
          let any = false;
          for (const jobId of jobIds) {
            const result = await tools.images.generate(
              {
                jobId,
                providerId,
                prompt: `rs-original-${jobId}`,
                size: '1024x1024',
                quality: 'auto',
                n: 1,
              },
              undefined,
              {},
            );
            if (result.status === 'success') any = true;
          }
          return any ? 'success' : 'failed';
        }),
      onTerminal: (row: AutomationSpendRequest) => {
        terminalRow = row;
      },
    });
    const started = await startManagedDurableRun(spec());
    expect(started.replayed).toBe(false);
    await service.request('startWorker');
    await vi.waitFor(
      () => expect(terminalRow).toMatchObject({ state: 'terminal', outcome: 'success' }),
      { timeout: 15000, interval: 150 },
    );
    // Both originals complete locally under the single run-level request.
    const runs = createWorkbenchRepositories(getDb()).runs;
    for (const jobId of jobIds)
      expect(runs.get(jobId)).toMatchObject({ status: 'success', actualCost: null });
    const remote = await snapshot();
    const posts = remote.calls.filter(
      (call) => call.path === '/api/v1/generations' && call.method === 'POST',
    );
    expect(posts).toHaveLength(2);
    const keys = posts.map((post) => post.key);
    expect(new Set(keys).size).toBe(2);
    for (const key of keys) expect(key).toMatch(/^desktop-rs-v1:/);
    // The provider saw two independent single-image sends, not one n=2 request.
    expect(remote.providerCalls).toHaveLength(2);
    for (const call of remote.providerCalls)
      expect(call).toMatchObject({ authorized: true, body: { n: 1 } });
    expect(remote.receipts).toHaveLength(2);
    expect(
      getDb()
        .prepare("SELECT count(*) AS n FROM automation_spend_requests WHERE action = 'run_scheme'")
        .get(),
    ).toEqual({ n: 1 });
    expect(getAutomationSpendRepository().budget(Date.now()).hasUnknown).toBe(true);
    // Same-key replay returns the frozen plan without any new provider dispatch.
    const replayed = await startManagedDurableRun(spec(async () => 'failed'));
    expect(replayed.replayed).toBe(true);
    expect((await snapshot()).providerCalls).toHaveLength(2);
    await reconcileManagedDurableRun(replayed.request.id);
    expect((await snapshot()).providerCalls).toHaveLength(2);
  }, 30000);
});
