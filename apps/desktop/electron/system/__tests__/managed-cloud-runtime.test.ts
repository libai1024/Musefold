import { createServer, type ServerResponse } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createGenerationInputSchema,
  generationJobSchema,
  type ExecutionBinding,
  prepareDesignSchemeRunInputSchema,
} from '@musefold/contracts';
import Database from 'better-sqlite3';
import { runDesignSchemeDbMigrations } from '@musefold/core/db/design-scheme/migrations';
import { DesignSchemeRepository } from '@musefold/core/db/design-scheme/repositories';
import { PREVIEWS_DIR_NAME } from '@musefold/core/constants';
import { configureTestCoreRuntime } from '@musefold/core/testing';
import { closeDb, getDb, initDb } from '@musefold/core/db';
import { createWorkbenchRepositories } from '@musefold/core/db/repositories/workbench';
import { ManagedExecutionRepository } from '@musefold/core/db/repositories/managed-execution';
import { EncryptedManagedAnchorFile } from '@musefold/core/services/managed-execution-anchor-file';
import { ManagedGenerationLedger } from '@musefold/core/services/managed-generation-ledger';
import { fixtureCipher } from '@musefold/core/services/__tests__/fixtures/managed-anchor-cipher';
import {
  managedCommand,
  managedReceipt,
} from '@musefold/core/services/__tests__/fixtures/managed-generation';
import {
  managedGenerationRecordSchema,
  managedRunRecordSchema,
  type ManagedRunRecord,
} from '@musefold/desktop-contracts/managed-generation';
import type { AutomationSpendRequest } from '@musefold/desktop-contracts/automation-spend';
import type { LocalImageReference } from '@musefold/desktop-contracts/providers';

const state = vi.hoisted(() => ({
  root: '',
  access: vi.fn(),
  anchor: vi.fn(),
  budget: {} as unknown,
}));
vi.mock('../../main/ipc-v25/account-domain', () => ({
  captureManagedAccountSession: state.access,
}));
vi.mock('electron', () => ({ app: { getPath: () => state.root } }));
vi.mock('../../main/generation-facade', async () => import('@musefold/core/services/generation'));
vi.mock('../../security/managed-execution-anchor', () => ({
  createManagedExecutionAnchor: state.anchor,
}));
vi.mock('../paths', () => ({
  getPaths: () => ({
    userData: state.root,
    pictures: join(state.root, 'pictures'),
    previews: join(state.root, 'previews'),
  }),
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
import {
  startManagedDurableRun,
  reconcileManagedDurableRun,
  prepareManagedRunBinding,
  readTerminalManagedRunReplay,
} from '../managed-run-runtime';
import { managedExecutionWorkScope } from '../managed-execution';
import { getAutomationSpendRepository } from '../../settings/automation';
import { describeManagedRecovery } from '../account-cloud-recovery';
import { wrapCloudGenerationGate } from '../../main/automation-cloud-generation';
import { createEventHub } from '@musefold/core';
import type {
  AutomationRouteContext,
  GenerationGate,
  GenerationHost,
} from '@musefold/automation-server';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6p9sAAAAASUVORK5CYII=',
  'base64',
);
const cleanup: Array<() => Promise<void>> = [];
beforeEach(() => {
  state.root = mkdtempSync(join(tmpdir(), 'musefold-cloud-runtime-'));
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
});
afterEach(async () => {
  await managedExecutionWorkScope().drainForRestore(3000);
  for (const close of cleanup.splice(0).reverse()) await close();
  closeDb();
  rmSync(state.root, { recursive: true, force: true });
});
function json(res: ServerResponse, value: unknown, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value));
}
function record() {
  const row = getDb()
    .prepare('SELECT record_json FROM managed_generation_requests ORDER BY rowid DESC LIMIT 1')
    .get() as { record_json: string };
  return managedGenerationRecordSchema.parse(JSON.parse(row.record_json));
}
async function fixture() {
  const command = managedCommand();
  let current = true;
  const access = {
    session: {
      version: 2 as const,
      token: `synthetic-${randomUUID()}`,
      ownerId: 'owner',
      apiIssuer: '',
      principalId: command.binding.principalId,
      authEpoch: command.authEpoch,
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
  };
  state.access.mockReset().mockResolvedValue(access);
  const calls: Array<{ method: string; url: string; body?: unknown; key?: string }> = [];
  let receivedPost: () => void = () => undefined;
  const postReceived = new Promise<void>((resolve) => {
    receivedPost = resolve;
  });
  let phase: 'queued' | 'succeeded' | 'cancelled' | 'failed' = 'succeeded';
  const failedResponses: Array<'post' | 'asset'> = [];
  let brokenPost = false;
  let brokenAsset = false;
  let brokenCancel = false;
  let missingReceipt = false;
  let purged = false;
  const referenceUploads: Array<{ contentType: string; name: string; bytes: Buffer }> = [];
  const referenceReleases: string[] = [];
  let rejectUploads = false;
  let failUploadAt = -1;
  const job = () =>
    generationJobSchema.parse({
      id: 'fixture-remote-run',
      sessionId: null,
      parentRunId: null,
      promptId: null,
      actorType: 'desktop_local',
      approvalStatus: 'not_required',
      status: phase,
      progress: phase === 'queued' ? 0 : 100,
      request: record().frozenRequest,
      providerModel: record().binding.model,
      costPoints: phase === 'queued' ? null : 4,
      assets:
        phase === 'succeeded'
          ? Array.from({ length: record().frozenRequest.count }, (_, index) => ({
              id: `asset-${index}`,
              url: 'https://untrusted.invalid/never-follow',
              mimeType: 'image/png',
              byteSize: png.length,
              width: 1,
              height: 1,
              expiresAt: '2030-01-01T00:00:00.000Z',
            }))
          : [],
      error: null,
      createdAt: '2026-09-08T01:00:00.000Z',
      startedAt: null,
      finishedAt: phase === 'queued' ? null : '2026-09-08T02:00:00.000Z',
    });
  const server = createServer((req, res) => {
    const call = {
      method: req.method ?? '',
      url: req.url ?? '',
      key: req.headers['idempotency-key'] as string | undefined,
      body: undefined as unknown,
    };
    calls.push(call);
    if (req.headers.authorization !== `Bearer ${access.session.token}`) {
      res.writeHead(401).end();
      return;
    }
    if (req.url === '/api/v1/account/execution-binding') {
      json(res, {
        ...command.binding,
        status: 'available',
        verifiedAt: '2026-09-08T01:00:00.000Z',
      });
      return;
    }
    if (req.url === '/api/v1/account/models') {
      const { apiIssuer, principalId, payer, credential } = command.binding;
      json(res, {
        identity: { apiIssuer, principalId, payer, credential },
        group: 'vip',
        checkedAt: new Date().toISOString(),
        models: ['gpt-image-2', 'musefold-image', 'musefold-image-pro'].map((model) => ({
          model,
          supportedEndpointTypes: ['openai'],
          imageGeneration: true,
          pricing: { kind: 'per_call', baseUsd: 0.04, groupRatio: 1, quotaPerCall: 20000 },
        })),
      });
      return;
    }
    if (req.url === '/api/v1/reference-images' && req.method === 'POST') {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        const disposition = /filename="([^"]*)"/.exec(body.subarray(0, 512).toString('utf8'))?.[1];
        const upload = {
          contentType: String(req.headers['content-type'] ?? ''),
          name: disposition ?? '',
          bytes: body,
        };
        referenceUploads.push(upload);
        if (rejectUploads || failUploadAt === referenceUploads.length - 1) {
          json(res, { error: { message: 'fixture reference rejection' } }, 422);
          return;
        }
        const id = `cloudref${String(referenceUploads.length).padStart(8, '0')}`;
        json(
          res,
          {
            id,
            url: `/api/v1/reference-images/${id}/url`,
            name: upload.name || '参考图.png',
            mimeType: 'image/png',
            byteSize: png.length,
          },
          201,
        );
      });
      return;
    }
    if (req.url?.startsWith('/api/v1/reference-images/') && req.method === 'DELETE') {
      req.resume();
      referenceReleases.push(req.url);
      json(res, { ok: true });
      return;
    }
    if (req.url === '/api/v1/generations' && req.method === 'POST') {
      receivedPost();
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        call.body = JSON.parse(Buffer.concat(chunks).toString());
        if (brokenPost) {
          res.once('finish', () => failedResponses.push('post'));
          res.writeHead(201, { 'content-type': 'application/json' }).end('{');
          return;
        }
        json(res, job(), 201);
      });
      return;
    }
    if (req.url?.startsWith('/api/v1/generations/receipts/by-key')) {
      if (missingReceipt) {
        res.writeHead(404).end();
        return;
      }
      json(
        res,
        managedReceipt(
          record(),
          phase === 'queued'
            ? {}
            : {
                status: phase,
                dispatch: 'claimed',
                costProvenance: 'provider_reported',
                costPoints: 4,
                revision: purged ? 3 : 2,
                purgedAt: purged ? '2026-09-08T03:00:00.000Z' : null,
                terminalAt: '2026-09-08T02:00:00.000Z',
                updatedAt: '2026-09-08T02:00:00.000Z',
              },
        ),
      );
      return;
    }
    if (req.url === '/api/v1/generations/fixture-remote-run/cancel') {
      req.resume();
      if (brokenCancel) {
        res.writeHead(503).end();
        return;
      }
      phase = 'cancelled';
      json(res, job());
      return;
    }
    if (req.url === '/api/v1/generations/fixture-remote-run') {
      json(res, job());
      return;
    }
    if (req.url?.startsWith('/api/v1/assets/')) {
      if (brokenAsset) {
        res.once('finish', () => failedResponses.push('asset'));
        res.writeHead(503).end();
        return;
      }
      res.writeHead(200, { 'content-type': 'image/png' }).end(png);
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture server');
  command.binding.apiIssuer = `http://127.0.0.1:${address.port}`;
  access.session.apiIssuer = command.binding.apiIssuer;
  const enable = async () => {
    const preview = await getAccountCloudStatus();
    expect(preview.mode).toBe('not_enabled');
    const connected = await applyAccountCloudReview(preview.reviewRef ?? '', 'connect');
    expect(connected.mode).toBe('active');
    return connected.connectionId ?? '';
  };
  const start = async (providerId: string, count = 1, model?: string) => {
    const input = createGenerationInputSchema.parse({
      providerId,
      prompt: '原始猫咪提示词',
      count,
      model,
    });
    const id = randomUUID();
    await startManagedGeneration(input, {
      providerId,
      jobId: id,
      prompt: input.prompt,
      size: input.size,
      quality: input.quality,
      n: count,
      aspectRatio: input.aspectRatio,
    });
    return id;
  };
  return {
    calls,
    postReceived,
    failedResponses,
    access,
    command,
    enable,
    start,
    referenceUploads,
    referenceReleases,
    rejectUploads: (value: boolean) => {
      rejectUploads = value;
    },
    failUploadAt: (ordinal: number) => {
      failUploadAt = ordinal;
    },
    phase: (value: typeof phase) => {
      phase = value;
    },
    brokenPost: (value: boolean) => {
      brokenPost = value;
    },
    brokenAsset: (value: boolean) => {
      brokenAsset = value;
    },
    brokenCancel: (value: boolean) => {
      brokenCancel = value;
    },
    missingReceipt: (value: boolean) => {
      missingReceipt = value;
    },
    purged: () => {
      purged = true;
    },
    invalidate: () => {
      current = false;
    },
  };
}

describe('ordinary CLI/MCP cloud generation with real HTTP and durable SQLite', () => {
  function routes(authorize = vi.fn(async () => {})) {
    const legacyRoute = vi.fn(() => ({ legacy: true }));
    const legacy = {
      routes: Object.fromEntries(
        [
          'POST /v1/generations',
          'POST /v1/generations/estimate',
          'GET /v1/generations/:jobId',
          'DELETE /v1/generations/:jobId',
        ].map((key) => [key, legacyRoute]),
      ),
      resolveConfirmation: () => false,
      pendingConfirmations: () => [],
    } as GenerationGate;
    const host = {
      budget: { remainingPoints: () => 100, settle: () => {} },
      authorizeReferencePath: (path: string) =>
        path.startsWith(join(state.root, PREVIEWS_DIR_NAME, 'uploads')),
      resolveHistoryImage: () => null,
    } as unknown as GenerationHost;
    const gate = wrapCloudGenerationGate(legacy, host, createEventHub(), authorize, () => true);
    const invoke = async (route: string, body: unknown, key = 'cloud-cli-fixture', jobId = '') => {
      let result: unknown;
      const value = await gate.routes[route]({
        body,
        params: { jobId },
        request: { headers: { 'idempotency-key': key } },
        json: (payload: unknown) => {
          result = payload;
        },
      } as unknown as AutomationRouteContext);
      return (result ?? value) as {
        jobId: string;
        status: string;
        costPoints: number;
        assets: Array<{ path: string }>;
      };
    };
    return { invoke, legacyRoute, authorize };
  }
  it('CLI consent reaches cloud, downloads bytes, and replay after default changes never resends', async () => {
    const f = await fixture();
    await f.enable();
    const r = routes();
    const body = {
      prompt: 'monitor and report UI',
      consent: 'interactive',
      declaredBudgetPoints: 20,
    };
    const estimate = await r.invoke('POST /v1/generations/estimate', body);
    expect(estimate).toMatchObject({ points: 0.4, model: 'musefold-image-pro' });
    const submitted = await r.invoke('POST /v1/generations', body);
    await vi.waitFor(
      async () => {
        const result = await r.invoke('GET /v1/generations/:jobId', {}, '', submitted.jobId);
        expect(result.status).toBe('success');
        expect(result.costPoints).toBe(4);
        expect(readFileSync(result.assets[0].path)).toEqual(png);
      },
      { timeout: 5000 },
    );
    getDb().prepare('UPDATE providers SET is_active = 0').run();
    const replay = await routes().invoke('POST /v1/generations', body);
    expect(replay).toMatchObject({ jobId: submitted.jobId, status: 'success', costPoints: 4 });
    await expect(
      routes().invoke('POST /v1/generations', { ...body, prompt: 'changed' }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(
      f.calls.filter((c) => c.url === '/api/v1/generations' && c.method === 'POST'),
    ).toHaveLength(1);
    expect(r.legacyRoute).not.toHaveBeenCalled();
  });
  it('MCP without CLI consent asks once before sending; denied request sends nothing', async () => {
    state.budget = {
      monthlyLimitPoints: 0,
      usedPoints: 0,
      month: new Date().toISOString().slice(0, 7),
    };
    const f = await fixture();
    await f.enable();
    const r = routes(
      vi.fn(async () => {
        throw new Error('USER_DENIED');
      }),
    );
    await expect(r.invoke('POST /v1/generations', { prompt: 'denied MCP' })).rejects.toThrow(
      'USER_DENIED',
    );
    expect(r.authorize).toHaveBeenCalledOnce();
    expect(f.calls.filter((c) => c.url === '/api/v1/generations')).toEqual([]);
    expect(getAutomationSpendRepository().get(record().requestId)).toMatchObject({
      state: 'terminal',
      outcome: 'denied',
    });
  });
  it('MCP confirmation approval authorizes the same guarded cloud request', async () => {
    state.budget = {
      monthlyLimitPoints: 0,
      usedPoints: 0,
      month: new Date().toISOString().slice(0, 7),
    };
    const f = await fixture();
    await f.enable();
    const r = routes();
    const submitted = await r.invoke('POST /v1/generations', { prompt: 'approved MCP' });
    await vi.waitFor(
      async () =>
        expect(await r.invoke('GET /v1/generations/:jobId', {}, '', submitted.jobId)).toMatchObject(
          { status: 'success' },
        ),
      { timeout: 5000 },
    );
    expect(r.authorize).toHaveBeenCalledOnce();
    expect(
      f.calls.filter((c) => c.url === '/api/v1/generations' && c.method === 'POST'),
    ).toHaveLength(1);
  });
  it('rejects a cost ceiling below cloud price and a different account before sending', async () => {
    const f = await fixture();
    await f.enable();
    const r = routes();
    await expect(
      r.invoke('POST /v1/generations', {
        prompt: 'capped',
        consent: 'interactive',
        declaredBudgetPoints: 0.1,
      }),
    ).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
    f.access.session.principalId = 'another-principal';
    await expect(
      r.invoke('POST /v1/generations', { prompt: 'wrong owner' }, 'another-key'),
    ).rejects.toMatchObject({ code: 'MANAGED_IDENTITY_CHANGED' });
    expect(f.calls.filter((c) => c.url === '/api/v1/generations')).toEqual([]);
  });
  it('reference images freeze real uploaded bytes in the managed request', async () => {
    const f = await fixture();
    await f.enable();
    const directory = join(state.root, PREVIEWS_DIR_NAME, 'uploads');
    mkdirSync(directory, { recursive: true });
    const path = join(directory, 'reference.png');
    writeFileSync(path, png);
    const submitted = await routes().invoke('POST /v1/generations', {
      prompt: 'edit reference',
      consent: 'interactive',
      referenceImagePaths: [path],
    });
    await vi.waitFor(
      async () =>
        expect(
          await routes().invoke('GET /v1/generations/:jobId', {}, '', submitted.jobId),
        ).toMatchObject({ status: 'success' }),
      { timeout: 5000 },
    );
    expect(f.referenceUploads).toHaveLength(1);
    expect(record().frozenRequest.referenceImages[0].digest).toBe(
      createHash('sha256').update(png).digest('hex'),
    );
  });
  it('cancels the original cloud request without creating a second generation', async () => {
    const f = await fixture();
    await f.enable();
    f.phase('queued');
    const r = routes();
    const submitted = await r.invoke('POST /v1/generations', {
      prompt: 'cancel this cloud task',
      consent: 'interactive',
    });
    await f.postReceived;
    await r.invoke('DELETE /v1/generations/:jobId', {}, '', submitted.jobId);
    await vi.waitFor(
      async () =>
        expect(await r.invoke('GET /v1/generations/:jobId', {}, '', submitted.jobId)).toMatchObject(
          { status: 'cancelled' },
        ),
      { timeout: 5000 },
    );
    expect(
      f.calls.filter((c) => c.url === '/api/v1/generations' && c.method === 'POST'),
    ).toHaveLength(1);
  });
  it('does not expose another account’s saved result on replay', async () => {
    const f = await fixture();
    await f.enable();
    const r = routes();
    const body = { prompt: 'owner-bound image', consent: 'interactive' };
    const submitted = await r.invoke('POST /v1/generations', body);
    await vi.waitFor(
      async () =>
        expect(await r.invoke('GET /v1/generations/:jobId', {}, '', submitted.jobId)).toMatchObject(
          { status: 'success' },
        ),
      { timeout: 5000 },
    );
    f.access.session.principalId = 'other-owner';
    await expect(r.invoke('POST /v1/generations', body)).rejects.toMatchObject({
      code: 'MANAGED_IDENTITY_CHANGED',
    });
    await expect(
      r.invoke('GET /v1/generations/:jobId', {}, '', submitted.jobId),
    ).rejects.toMatchObject({ code: 'MANAGED_IDENTITY_CHANGED' });
    expect(
      f.calls.filter((c) => c.url === '/api/v1/generations' && c.method === 'POST'),
    ).toHaveLength(1);
  });
});

describe('account cloud user path with real HTTP, SQLite and controlled assets', () => {
  it.each(['gpt-image-2', 'musefold-image'])(
    'preserves selected %s through the local ledger, HTTP and result',
    async (model) => {
      const f = await fixture();
      const id = await f.start(await f.enable(), 1, model);
      await vi.waitFor(
        () => expect(createWorkbenchRepositories(getDb()).runs.get(id)?.status).toBe('success'),
        { timeout: 4000 },
      );
      expect(record()).toMatchObject({ binding: { model }, frozenRequest: { model } });
      expect(f.calls.filter((call) => call.url === '/api/v1/generations')).toEqual([
        expect.objectContaining({
          body: expect.objectContaining({
            model,
            expectedBinding: expect.objectContaining({ model }),
          }),
        }),
      ]);
      expect(createWorkbenchRepositories(getDb()).runs.get(id)?.model).toBe(model);
      expect(f.calls.filter((call) => call.url === '/api/v1/account/models')).toHaveLength(2);
    },
  );
  it('projects durable unclaimed cancellation as zero cost without any generation POST', async () => {
    const f = await fixture();
    f.missingReceipt(true);
    const providerId = await f.enable();
    const claim = vi
      .spyOn(ManagedGenerationLedger.prototype, 'claimSubmission')
      .mockRejectedValueOnce(new Error('test interruption before durable claim'));
    let id: string;
    try {
      id = await f.start(providerId);
      await vi.waitFor(() => expect(claim).toHaveBeenCalledOnce());
    } finally {
      claim.mockRestore();
    }
    expect(record().submissionState).toBe('unclaimed');
    await cancelManagedGeneration(record().requestId);
    await vi.waitFor(async () => {
      await reconcileManagedGeneration(record().requestId);
      expect(createWorkbenchRepositories(getDb()).runs.get(id)).toMatchObject({
        status: 'cancelled',
        actualCost: 0,
      });
    });
    expect(describeManagedRecovery(record())).toMatchObject({ costKnown: true });
    expect(getAutomationSpendRepository().budget(Date.now()).usedPoints).toBe(0);
    expect(f.calls.filter((call) => call.method === 'POST')).toHaveLength(0);
    expect(getDb().prepare('SELECT count(*) AS n FROM generated_assets').get()).toEqual({ n: 0 });
  });

  it('ends a purged cloud success without pretending to generate forever or downloading another result', async () => {
    const f = await fixture();
    f.purged();
    const id = await f.start(await f.enable());
    await vi.waitFor(() =>
      expect(createWorkbenchRepositories(getDb()).runs.get(id)?.status).toBe('success'),
    );
    expect(describeManagedRecovery(record())).toMatchObject({
      remoteStatus: 'succeeded',
      result: 'purged',
      costKnown: true,
    });
    expect(getDb().prepare('SELECT count(*) AS n FROM generated_assets').get()).toEqual({ n: 0 });
    await reconcileManagedGeneration(record().requestId);
    expect(f.calls.filter((call) => call.url.startsWith('/api/v1/assets/'))).toHaveLength(0);
    expect(f.calls.filter((call) => call.url === '/api/v1/generations')).toHaveLength(1);
    expect(getAutomationSpendRepository().budget(Date.now()).usedPoints).toBe(4);
  });

  it('restores missing local bytes from the original owned asset without changing its identity or cost', async () => {
    const f = await fixture();
    const id = await f.start(await f.enable());
    await vi.waitFor(() => expect(describeManagedRecovery(record()).result).toBe('available'));
    const asset = getDb().prepare('SELECT * FROM generated_assets WHERE run_id = ?').get(id) as {
      media_path: string;
    };
    rmSync(asset.media_path);
    expect(describeManagedRecovery(record()).result).toBe('missing');
    await vi.waitFor(async () => {
      await reconcileManagedGeneration(record().requestId);
      expect(describeManagedRecovery(record()).result).toBe('available');
    });
    expect(readFileSync(asset.media_path)).toEqual(png);
    expect(getDb().prepare('SELECT * FROM generated_assets WHERE run_id = ?').get(id)).toEqual(
      asset,
    );
    expect(getAutomationSpendRepository().budget(Date.now()).usedPoints).toBe(4);
    expect(f.calls.filter((call) => call.url === '/api/v1/generations')).toHaveLength(1);
  });

  it.each(['cancelled', 'failed'] as const)(
    'projects known costs for a remote %s result',
    async (phase) => {
      const f = await fixture();
      f.phase(phase);
      const id = await f.start(await f.enable());
      await vi.waitFor(
        () =>
          expect(createWorkbenchRepositories(getDb()).runs.get(id)).toMatchObject({
            status: phase,
            actualCost: 4,
          }),
        // 全量并行负载下真实 HTTP 投影可能超过 waitFor 默认 1 秒；对齐本文件其余等待的显式窗口。
        { timeout: 4000 },
      );
      expect(getAutomationSpendRepository().budget(Date.now()).usedPoints).toBe(4);
      expect(f.calls.filter((call) => call.url === '/api/v1/generations')).toHaveLength(1);
    },
  );

  it('receipt 404 leaves the existing run and reservation unresolved across repeated queries', async () => {
    const f = await fixture();
    f.brokenPost(true);
    f.missingReceipt(true);
    const id = await f.start(await f.enable());
    await vi.waitFor(() => expect(f.calls.some((call) => call.method === 'POST')).toBe(true));
    await vi.waitFor(async () => {
      await reconcileManagedGeneration(record().requestId);
      expect(f.calls.some((call) => call.url.includes('/receipts/by-key'))).toBe(true);
    });
    await reconcileManagedGeneration(record().requestId);
    expect(createWorkbenchRepositories(getDb()).runs.get(id)?.status).toBe('running');
    expect(getAutomationSpendRepository().budget(Date.now()).hasUnknown).toBe(true);
    expect(f.calls.filter((call) => call.url === '/api/v1/generations')).toHaveLength(1);
  });

  it('account switch prevents old task queries and late projection into the local run', async () => {
    const f = await fixture();
    f.brokenPost(true);
    const id = await f.start(await f.enable());
    // Invalidate only after the actual HTTP send, without a separate 1s polling deadline.
    // The test's own deadline still fails if admission never sends the request.
    await f.postReceived;
    expect(f.calls.some((call) => call.method === 'POST')).toBe(true);
    f.invalidate();
    await managedExecutionWorkScope().drainForRestore(3000);
    const before = f.calls.length;
    await expect(reconcileManagedGeneration(record().requestId)).rejects.toThrow(
      'MANAGED_RESTART_REQUIRED',
    );
    expect(f.calls).toHaveLength(before);
    expect(createWorkbenchRepositories(getDb()).runs.get(id)?.status).toBe('running');
    expect(getDb().prepare('SELECT count(*) AS n FROM generated_assets').get()).toEqual({ n: 0 });
  });

  it('preview does not enable; one explicit review creates a keyless connection once', async () => {
    const f = await fixture();
    const preview = await getAccountCloudStatus();
    expect(new ManagedExecutionRepository(getDb()).checkpoint()).toBeNull();
    expect(getDb().prepare('SELECT count(*) AS n FROM providers').get()).toEqual({ n: 0 });
    const connected = await applyAccountCloudReview(preview.reviewRef ?? '', 'connect');
    expect(connected.mode).toBe('active');
    expect(
      getDb().prepare('SELECT type,has_key,key_suffix,is_active FROM providers').get(),
    ).toEqual({ type: 'musefold-cloud', has_key: 0, key_suffix: null, is_active: 1 });
    await expect(applyAccountCloudReview(preview.reviewRef ?? '', 'connect')).rejects.toThrow(
      'MANAGED_REVIEW_EXPIRED',
    );
    expect(f.calls.every((call) => call.method === 'GET')).toBe(true);
    expect(getDb().serialize().includes(Buffer.from(f.access.session.token))).toBe(false);
  });

  it('rejects a changed account or payer binding between preview and confirmation', async () => {
    const f = await fixture();
    const preview = await getAccountCloudStatus();
    f.command.binding.credential.version++;
    await expect(applyAccountCloudReview(preview.reviewRef ?? '', 'connect')).rejects.toThrow(
      'MANAGED_IDENTITY_CHANGED',
    );
    expect(new ManagedExecutionRepository(getDb()).checkpoint()).toBeNull();
    const again = await getAccountCloudStatus();
    f.access.session.authEpoch = randomUUID();
    await expect(applyAccountCloudReview(again.reviewRef ?? '', 'connect')).rejects.toThrow(
      'MANAGED_IDENTITY_CHANGED',
    );
    expect(getDb().prepare('SELECT count(*) AS n FROM providers').get()).toEqual({ n: 0 });
  });

  it.each([1, 2, 4])(
    'submits %i images once and projects verified files and cost idempotently',
    async (count) => {
      const f = await fixture();
      const id = await f.start(await f.enable(), count);
      const runs = createWorkbenchRepositories(getDb()).runs;
      // This fixture performs real HTTP, fsync and downloads; the default 1s wait is not a
      // product latency contract, especially alongside the PostgreSQL/worker joint fixture.
      await vi.waitFor(() => expect(describeManagedRecovery(record()).result).toBe('available'), {
        timeout: 4000,
      });
      expect(runs.get(id)?.status).toBe('success');
      const r = record();
      const posts = f.calls.filter((call) => call.method === 'POST');
      expect(posts).toHaveLength(1);
      expect(posts[0]).toMatchObject({
        url: '/api/v1/generations',
        key: r.remoteKey,
        body: { ...r.frozenRequest, expectedBinding: r.binding },
      });
      expect(runs.get(id)).toMatchObject({ actualCost: 4 });
      const assets = getDb()
        .prepare(
          'SELECT media_path, mime_type, file_size, checksum FROM generated_assets WHERE run_id = ?',
        )
        .all(id) as Array<{
        media_path: string;
        mime_type: string;
        file_size: number;
        checksum: string;
      }>;
      expect(assets).toHaveLength(count);
      for (const asset of assets) {
        expect(readFileSync(asset.media_path)).toEqual(png);
        expect(asset).toMatchObject({ mime_type: 'image/png', file_size: png.length });
        expect(asset.checksum).toHaveLength(64);
      }
      await reconcileManagedGeneration(r.requestId);
      expect(getAutomationSpendRepository().budget(Date.now()).usedPoints).toBe(4);
      expect(readdirSync(join(state.root, 'pictures'))).toHaveLength(count);
      expect(f.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    },
  );

  it.each(['post', 'asset'] as const)(
    'recovers a lost %s response using only the original receipt and assets',
    async (failure) => {
      const f = await fixture();
      f.brokenPost(failure === 'post');
      f.brokenAsset(failure === 'asset');
      const id = await f.start(await f.enable());
      // Keep the fault enabled until the server has actually emitted the broken response.
      // Observing request arrival alone can race its body handler and silently repair POST.
      await vi.waitFor(() => expect(f.failedResponses).toContain(failure), { timeout: 4000 });
      expect(createWorkbenchRepositories(getDb()).runs.get(id)?.status).toBe(
        failure === 'asset' ? 'success' : 'running',
      );
      f.brokenPost(false);
      f.brokenAsset(false);
      await vi.waitFor(
        async () => {
          await reconcileManagedGeneration(record().requestId);
          expect(createWorkbenchRepositories(getDb()).runs.get(id)?.status).toBe('success');
          expect(describeManagedRecovery(record()).result).toBe('available');
        },
        { timeout: 4000 },
      );
      expect(f.calls.filter((call) => call.url === '/api/v1/generations')).toHaveLength(1);
      expect(getAutomationSpendRepository().budget(Date.now()).usedPoints).toBe(4);
    },
    10_000,
  );

  it('persists cancellation before failed remote cancellation, then accepts late success and cost', async () => {
    const f = await fixture();
    f.phase('queued');
    const id = await f.start(await f.enable());
    await vi.waitFor(() => expect(record().receipt?.status).toBe('queued'));
    f.brokenCancel(true);
    await expect(cancelManagedGeneration(record().requestId)).rejects.toThrow(
      'MANAGED_REMOTE_REJECTED',
    );
    expect(record().cancelRequestedAt).not.toBeNull();
    expect(record().cancelAcknowledgedAt).toBeNull();
    f.phase('succeeded');
    f.brokenCancel(false);
    await vi.waitFor(
      async () => {
        await reconcileManagedGeneration(record().requestId);
        expect(createWorkbenchRepositories(getDb()).runs.get(id)?.status).toBe('success');
      },
      { timeout: 4000 },
    );
    expect(getAutomationSpendRepository().budget(Date.now()).usedPoints).toBe(4);
    expect(f.calls.filter((call) => call.url === '/api/v1/generations')).toHaveLength(1);
  });

  it('rejects unsupported references before registration and any generation POST', async () => {
    const f = await fixture();
    const providerId = await f.enable();
    const input = createGenerationInputSchema.parse({
      providerId,
      prompt: '猫咪',
      promptId: 'library-prompt',
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
    expect(getDb().prepare('SELECT count(*) AS n FROM managed_generation_requests').get()).toEqual({
      n: 0,
    });
    expect(f.calls.every((call) => call.method === 'GET')).toBe(true);
  });

  // ---- 云 G 参考图接线:staged 字节 → multipart 上传 → 冻结云 ID+摘要 → 既有提交通道 ----

  const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

  function stageReference(id: string): string {
    const dir = join(state.root, PREVIEWS_DIR_NAME, 'uploads');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${id}.png`);
    writeFileSync(path, png);
    return path;
  }

  function referenceInput(providerId: string, ids: string[]) {
    return createGenerationInputSchema.parse({
      providerId,
      prompt: '按参考图生成',
      referenceImages: ids.map((id) => ({
        id,
        url: `media://local/?p=${encodeURIComponent(join('/staging', `${id}.png`))}`,
        name: `${id}.png`,
        mimeType: 'image/png',
        byteSize: png.length,
      })),
    });
  }

  function referenceRequest(
    providerId: string,
    staged: Array<{ id: string; path: string }>,
    input: ReturnType<typeof referenceInput>,
  ) {
    return {
      providerId,
      jobId: randomUUID(),
      prompt: input.prompt,
      size: input.size,
      quality: input.quality,
      n: input.count,
      referenceImages: staged.map((item) => ({
        path: item.path,
        source: 'upload' as const,
        name: `${item.id}.png`,
      })),
    };
  }

  it('uploads staged bytes, freezes cloud ids with byte digests, then posts exactly once', async () => {
    const f = await fixture();
    const providerId = await f.enable();
    const input = referenceInput(providerId, ['stagedref01']);
    const request = referenceRequest(
      providerId,
      [{ id: 'stagedref01', path: stageReference('stagedref01') }],
      input,
    );
    await startManagedGeneration(input, request);
    await vi.waitFor(() =>
      expect(createWorkbenchRepositories(getDb()).runs.get(request.jobId)?.status).toBe('success'),
    );
    expect(f.referenceUploads).toHaveLength(1);
    expect(f.referenceUploads[0]?.contentType).toContain('multipart/form-data');
    expect(f.referenceUploads[0]?.name).toBe('stagedref01.png');
    expect(f.referenceUploads[0]?.bytes.includes(png)).toBe(true);
    const expected = {
      id: 'cloudref00000001',
      url: '/api/v1/reference-images/cloudref00000001/url',
      name: 'stagedref01.png',
      mimeType: 'image/png',
      byteSize: png.length,
      digest: digest(png),
    };
    expect(record().frozenRequest.referenceImages).toEqual([expected]);
    const posted = f.calls.find(
      (call) => call.url === '/api/v1/generations' && call.method === 'POST',
    );
    expect(f.calls.filter((call) => call.url === '/api/v1/generations')).toHaveLength(1);
    const body = posted?.body as { referenceImages?: Array<{ id: string; digest: string }> };
    expect(body?.referenceImages).toEqual([expected]);
    expect(f.referenceReleases).toEqual([]);
  });

  it('rejects a server-refused upload with zero registrations and zero generation POSTs', async () => {
    const f = await fixture();
    f.rejectUploads(true);
    const providerId = await f.enable();
    const input = referenceInput(providerId, ['stagedref01']);
    const request = referenceRequest(
      providerId,
      [{ id: 'stagedref01', path: stageReference('stagedref01') }],
      input,
    );
    await expect(startManagedGeneration(input, request)).rejects.toThrow(
      'MANAGED_REFERENCE_UPLOAD_FAILED',
    );
    expect(f.referenceUploads).toHaveLength(1);
    expect(f.calls.filter((call) => call.url === '/api/v1/generations')).toHaveLength(0);
    expect(getDb().prepare('SELECT count(*) AS n FROM managed_generation_requests').get()).toEqual({
      n: 0,
    });
    expect(getAutomationSpendRepository().budget(Date.now()).usedPoints).toBe(0);
  });

  it('releases already-accepted uploads when a later reference fails before registration', async () => {
    const f = await fixture();
    f.failUploadAt(1);
    const providerId = await f.enable();
    const input = referenceInput(providerId, ['stagedref01', 'stagedref02']);
    const request = referenceRequest(
      providerId,
      [
        { id: 'stagedref01', path: stageReference('stagedref01') },
        { id: 'stagedref02', path: stageReference('stagedref02') },
      ],
      input,
    );
    await expect(startManagedGeneration(input, request)).rejects.toThrow(
      'MANAGED_REFERENCE_UPLOAD_FAILED',
    );
    expect(f.referenceUploads).toHaveLength(2);
    expect(f.referenceReleases).toEqual(['/api/v1/reference-images/cloudref00000001']);
    expect(f.calls.filter((call) => call.url === '/api/v1/generations')).toHaveLength(0);
    expect(getDb().prepare('SELECT count(*) AS n FROM managed_generation_requests').get()).toEqual({
      n: 0,
    });
  });

  it('fails on a missing staged file before any upload or registration', async () => {
    const f = await fixture();
    const providerId = await f.enable();
    const input = referenceInput(providerId, ['stagedref01']);
    const request = referenceRequest(
      providerId,
      [
        {
          id: 'stagedref01',
          path: join(state.root, PREVIEWS_DIR_NAME, 'uploads', 'stagedref01.png'),
        },
      ],
      input,
    );
    await expect(startManagedGeneration(input, request)).rejects.toThrow(
      'MANAGED_REFERENCE_READ_FAILED',
    );
    expect(f.referenceUploads).toHaveLength(0);
    expect(f.calls.every((call) => call.method === 'GET')).toBe(true);
    expect(getDb().prepare('SELECT count(*) AS n FROM managed_generation_requests').get()).toEqual({
      n: 0,
    });
  });

  it('refuses reference paths outside the managed uploads directory', async () => {
    const f = await fixture();
    const providerId = await f.enable();
    const input = referenceInput(providerId, ['stagedref01']);
    const outside = join(state.root, 'outside.png');
    writeFileSync(outside, png);
    const request = referenceRequest(providerId, [{ id: 'stagedref01', path: outside }], input);
    await expect(startManagedGeneration(input, request)).rejects.toThrow(
      'MANAGED_REFERENCE_NOT_STAGED',
    );
    expect(f.referenceUploads).toHaveLength(0);
    expect(f.calls.every((call) => call.method === 'GET')).toBe(true);
  });
});

// ---- R/S(run_scheme / run_github_skill)托管云运行:每张原图一个受管子发送 ----
// 一个 run 级预留 + 一次请求级确认;子 remoteKey 稳定;重放/恢复只查回执,绝不重发。

type RunPhase = 'queued' | 'succeeded' | 'cancelled' | 'failed';

function needed<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Missing run fixture value');
  return value;
}

function runRecord(): ManagedRunRecord {
  const row = getDb()
    .prepare('SELECT record_json FROM managed_run_requests ORDER BY rowid DESC LIMIT 1')
    .get() as { record_json: string };
  return managedRunRecordSchema.parse(JSON.parse(row.record_json));
}

async function runFixture(phases: RunPhase[] = ['succeeded', 'succeeded']) {
  const command = managedCommand();
  const current = true;
  const access = {
    session: {
      version: 2 as const,
      token: `synthetic-${randomUUID()}`,
      ownerId: 'owner',
      apiIssuer: '',
      principalId: command.binding.principalId,
      authEpoch: command.authEpoch,
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
  };
  state.access.mockReset().mockResolvedValue(access);
  const calls: Array<{ method: string; url: string; body?: unknown; key?: string }> = [];
  type RemoteRun = { runId: string; phase: RunPhase; model?: string };
  const remote = new Map<string, RemoteRun>();
  let cloudProviderId = '';
  let brokenPostAt = -1;
  let missingReceipt = false;
  let catalogAvailable = true;
  let modelPriced = true;
  const referenceUploads: Array<{ name: string }> = [];
  const jobFor = (entry: RemoteRun) =>
    generationJobSchema.parse({
      id: entry.runId,
      sessionId: null,
      parentRunId: null,
      promptId: null,
      actorType: 'desktop_local',
      approvalStatus: 'not_required',
      status: entry.phase,
      progress: entry.phase === 'queued' ? 0 : 100,
      request: createGenerationInputSchema.parse({
        providerId: cloudProviderId,
        prompt: 'run child prompt',
        count: 1,
        model: entry.model,
      }),
      providerModel: entry.model ?? command.binding.model,
      costPoints: entry.phase === 'queued' ? null : 4,
      assets:
        entry.phase === 'succeeded'
          ? [
              {
                id: `asset-${entry.runId}`,
                url: 'https://untrusted.invalid/never-follow',
                mimeType: 'image/png',
                byteSize: png.length,
                width: 1,
                height: 1,
                expiresAt: '2030-01-01T00:00:00.000Z',
              },
            ]
          : [],
      error: null,
      createdAt: '2026-09-08T01:00:00.000Z',
      startedAt: null,
      finishedAt: entry.phase === 'queued' ? null : '2026-09-08T02:00:00.000Z',
    });
  const server = createServer((req, res) => {
    const call = {
      method: req.method ?? '',
      url: req.url ?? '',
      key: req.headers['idempotency-key'] as string | undefined,
      body: undefined as unknown,
    };
    calls.push(call);
    if (req.headers.authorization !== `Bearer ${access.session.token}`) {
      res.writeHead(401).end();
      return;
    }
    if (req.url === '/api/v1/account/execution-binding') {
      json(res, {
        ...command.binding,
        status: 'available',
        verifiedAt: '2026-09-08T01:00:00.000Z',
      });
      return;
    }
    if (req.url === '/api/v1/account/models') {
      if (!catalogAvailable) {
        res.writeHead(503).end();
        return;
      }
      const { apiIssuer, principalId, payer, credential } = command.binding;
      json(res, {
        identity: { apiIssuer, principalId, payer, credential },
        group: 'vip',
        checkedAt: new Date().toISOString(),
        models: ['gpt-image-2', 'musefold-image'].map((model) => ({
          model,
          supportedEndpointTypes: ['openai'],
          imageGeneration: true,
          pricing: modelPriced
            ? { kind: 'per_call', baseUsd: 0.04, groupRatio: 1, quotaPerCall: 20000 }
            : { kind: 'unavailable', reason: 'missing_price' },
        })),
      });
      return;
    }
    if (req.url === '/api/v1/reference-images' && req.method === 'POST') {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        const disposition = /filename="([^"]*)"/.exec(body.subarray(0, 512).toString('utf8'))?.[1];
        referenceUploads.push({ name: disposition ?? '' });
        const id = `cloudref${String(referenceUploads.length).padStart(8, '0')}`;
        json(
          res,
          {
            id,
            url: `/api/v1/reference-images/${id}/url`,
            name: disposition || '参考图.png',
            mimeType: 'image/png',
            byteSize: png.length,
          },
          201,
        );
      });
      return;
    }
    if (req.url === '/api/v1/generations' && req.method === 'POST') {
      const key = req.headers['idempotency-key'] as string;
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      req.on('end', () => {
        call.body = JSON.parse(Buffer.concat(chunks).toString());
        const runId = `fixture-rs-run-${remote.size}`;
        remote.set(key, {
          runId,
          phase: phases[remote.size] ?? 'succeeded',
          model: (call.body as { model?: string }).model,
        });
        if (remote.size - 1 === brokenPostAt) {
          res.writeHead(201, { 'content-type': 'application/json' }).end('{');
          return;
        }
        json(res, jobFor(needed(remote.get(key))), 201);
      });
      return;
    }
    if (req.url?.startsWith('/api/v1/generations/receipts/by-key')) {
      const key = new URL(req.url, 'http://fixture.local').searchParams.get('key') ?? '';
      if (missingReceipt) {
        res.writeHead(404).end();
        return;
      }
      const entry = remote.get(key);
      if (!entry) {
        res.writeHead(404).end();
        return;
      }
      const record = runRecord();
      const terminalAt = entry.phase === 'queued' ? null : '2026-09-08T02:00:00.000Z';
      json(res, {
        id: `receipt-${entry.runId}`,
        principalId: record.binding.principalId,
        idempotencyKey: key,
        operation: 'ordinary_create',
        originalRunId: entry.runId,
        sourceRunId: null,
        bindingState: 'bound',
        binding: record.binding,
        status: entry.phase,
        dispatch: 'claimed',
        costProvenance: entry.phase === 'queued' ? 'unknown' : 'provider_reported',
        costPoints: entry.phase === 'queued' ? null : 4,
        revision: entry.phase === 'queued' ? 1 : 2,
        createdAt: '2026-09-08T01:00:00.000Z',
        updatedAt: terminalAt ?? '2026-09-08T01:00:00.000Z',
        terminalAt,
        purgedAt: null,
      });
      return;
    }
    const cancel = /^\/api\/v1\/generations\/([^/]+)\/cancel$/.exec(req.url ?? '');
    if (cancel && req.method === 'POST') {
      req.resume();
      const entry = [...remote.values()].find((item) => item.runId === cancel[1]);
      if (!entry) {
        res.writeHead(404).end();
        return;
      }
      entry.phase = 'cancelled';
      json(res, jobFor(entry));
      return;
    }
    const job = /^\/api\/v1\/generations\/([^/]+)$/.exec(req.url ?? '');
    if (job && req.method === 'GET') {
      const entry = [...remote.values()].find((item) => item.runId === job[1]);
      if (!entry) {
        res.writeHead(404).end();
        return;
      }
      json(res, jobFor(entry));
      return;
    }
    if (req.url?.startsWith('/api/v1/assets/') && req.url.endsWith('/content')) {
      res.writeHead(200, { 'content-type': 'image/png' }).end(png);
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture server');
  command.binding.apiIssuer = `http://127.0.0.1:${address.port}`;
  access.session.apiIssuer = command.binding.apiIssuer;
  const enable = async () => {
    const preview = await getAccountCloudStatus();
    const connected = await applyAccountCloudReview(preview.reviewRef ?? '', 'connect');
    cloudProviderId = connected.connectionId ?? '';
    return cloudProviderId;
  };
  const input = { params: { id: 'dsch_fixture' }, body: { n: 2, inputs: { topic: 'fixture' } } };
  const frozenRun = {
    body: input.body,
    params: input.params,
    jobIds: [] as string[],
    runId: 'dsr_fixture',
    source: { sourceDigest: 'fixture-source-digest' },
  };
  type Drive = Parameters<Parameters<typeof startManagedDurableRun>[0]['drive']>[0];
  type ModelChoice = { model?: ExecutionBinding['model']; expectedBinding?: ExecutionBinding };
  const startRun = async (
    providerId: string,
    drive: (tools: Drive, jobIds: string[]) => Promise<'success' | 'failed' | 'cancelled'>,
    authorize: () => Promise<void> = async () => {},
    choice: ModelChoice = {},
  ) => {
    const jobIds = Array.from({ length: 2 }, () => randomUUID());
    frozenRun.jobIds = jobIds;
    const callerKey = `rs-fixture-${randomUUID()}`;
    let terminalRow: AutomationSpendRequest | null = null;
    const spec = () => ({
      runKind: 'run_scheme' as const,
      providerId,
      ...choice,
      callerKey,
      caller: 'local-automation',
      executionId: `ext_${randomUUID()}`,
      originalJobIds: jobIds,
      input,
      frozenRun,
      textBinding: null,
      authorizePath: () => true,
      authorize,
      drive: (tools: Drive) => drive(tools, jobIds),
      onTerminal: (row: AutomationSpendRequest) => {
        terminalRow = row;
      },
    });
    const started = await startManagedDurableRun(spec());
    return {
      started,
      jobIds,
      terminal: () => terminalRow,
      replay: (override: ModelChoice = choice) =>
        startManagedDurableRun({ ...spec(), ...override, drive: async () => 'failed' }),
    };
  };
  /** Run-level reference freeze once, then every original image in plan order. */
  const driveChildren =
    (
      references: LocalImageReference[] = [],
      afterChild?: (index: number) => Promise<void>,
      model?: string,
    ) =>
    async (tools: Drive, jobIds: string[]): Promise<'success' | 'failed' | 'cancelled'> => {
      if (references.length) tools.images.onReferences(references);
      let any = false;
      for (const [index, jobId] of jobIds.entries()) {
        const result = await tools.images.generate(
          {
            jobId,
            providerId: cloudProviderId,
            prompt: `原图提示词 ${index + 1}`,
            size: '1024x1024',
            quality: 'auto',
            n: 1,
            ...(model === undefined ? {} : { model }),
            ...(references.length ? { referenceImages: references } : {}),
          },
          undefined,
          {},
        );
        if (result.status === 'success') any = true;
        await afterChild?.(index);
      }
      return any ? 'success' : 'failed';
    };
  return {
    calls,
    remote,
    referenceUploads,
    enable,
    startRun,
    driveChildren,
    binding: (model: string): ExecutionBinding => ({ ...structuredClone(command.binding), model }),
    catalogAvailable: (value: boolean) => {
      catalogAvailable = value;
    },
    modelPriced: (value: boolean) => {
      modelPriced = value;
    },
    brokenPostAt: (ordinal: number) => {
      brokenPostAt = ordinal;
    },
    missingReceipt: (value: boolean) => {
      missingReceipt = value;
    },
  };
}

describe('managed R/S cloud runs: one reservation, one confirmation, one child send per original', () => {
  it.each(['gpt-image-2', 'musefold-image'])(
    'freezes %s across child requests, local history and receipt-only replay',
    async (model) => {
      const f = await runFixture();
      const providerId = await f.enable();
      const run = await f.startRun(providerId, f.driveChildren(), undefined, {
        model,
        expectedBinding: f.binding(model),
      });
      await vi.waitFor(() => expect(run.terminal()).not.toBeNull(), { timeout: 4000 });
      const frozen = runRecord();
      expect(frozen.binding.model).toBe(model);
      const posts = () =>
        f.calls.filter((c) => c.url === '/api/v1/generations' && c.method === 'POST');
      expect(posts()).toHaveLength(2);
      for (const post of posts())
        expect(post.body).toMatchObject({ model, expectedBinding: frozen.binding });
      const runs = createWorkbenchRepositories(getDb()).runs;
      for (const child of frozen.children) {
        expect(runs.get(child.originalJobId)).toMatchObject({ model, status: 'success' });
        expect(child.receipt?.binding?.model).toBe(model);
      }
      expect(getDb().prepare('SELECT model FROM providers WHERE id = ?').get(providerId)).toEqual({
        model: 'musefold-image-pro',
      });
      const catalogReads = f.calls.filter((c) => c.url === '/api/v1/account/models').length;
      expect(catalogReads).toBe(3); // Registration plus fresh admission for each child.
      f.catalogAvailable(false);
      expect((await run.replay()).replayed).toBe(true);
      await reconcileManagedDurableRun(frozen.requestId);
      expect(f.calls.filter((c) => c.url === '/api/v1/account/models')).toHaveLength(catalogReads);
      expect(posts()).toHaveLength(2);
      await expect(run.replay({ model: 'a-different-model' })).rejects.toThrow(
        'IDEMPOTENCY_CONFLICT',
      );
      expect(posts()).toHaveLength(2);
      const queryCount = f.calls.length;
      expect(
        await readTerminalManagedRunReplay(frozen.requestId, frozen.run.runKind, frozen.run.input),
      ).toMatchObject({
        id: frozen.requestId,
        state: 'terminal',
        outcome: 'success',
      });
      await expect(
        readTerminalManagedRunReplay(frozen.requestId, 'run_github_skill', frozen.run.input),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
      await expect(
        readTerminalManagedRunReplay(frozen.requestId, frozen.run.runKind, {
          ...frozen.run.input,
          body: { n: 3 },
        }),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
      expect(f.calls).toHaveLength(queryCount); // No source/catalog/provider reads on terminal replay.
      const access = await state.access();
      state.access.mockResolvedValueOnce({
        ...access,
        session: { ...access.session, principalId: 'another-account' },
      });
      await expect(
        readTerminalManagedRunReplay(frozen.requestId, frozen.run.runKind, frozen.run.input),
      ).rejects.toThrow('MANAGED_IDENTITY_CHANGED');
      expect(posts()).toHaveLength(2);
    },
  );

  it('rejects missing price and changed display identity before registering or driving', async () => {
    const f = await runFixture();
    const providerId = await f.enable();
    const drive = vi.fn(f.driveChildren());
    f.modelPriced(false);
    await expect(
      f.startRun(providerId, drive, undefined, { model: 'gpt-image-2' }),
    ).rejects.toThrow('MANAGED_MODEL_UNAVAILABLE');
    f.modelPriced(true);
    const expectedBinding = f.binding('gpt-image-2');
    expectedBinding.credential.version += 1;
    await expect(
      f.startRun(providerId, drive, undefined, { model: 'gpt-image-2', expectedBinding }),
    ).rejects.toThrow('MANAGED_IDENTITY_CHANGED');
    expect(drive).not.toHaveBeenCalled();
    expect(getDb().prepare('SELECT count(*) AS n FROM managed_run_requests').get()).toEqual({
      n: 0,
    });
    expect(f.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('rejects a child model that differs from the run before any paid send', async () => {
    const f = await runFixture();
    const providerId = await f.enable();
    let childError: unknown;
    const run = await f.startRun(
      providerId,
      async (tools, jobIds) => {
        try {
          await f.driveChildren([], undefined, 'musefold-image')(tools, jobIds);
        } catch (error) {
          childError = error;
        }
        return 'failed';
      },
      undefined,
      { model: 'gpt-image-2' },
    );
    await vi.waitFor(() => expect(run.terminal()).not.toBeNull(), { timeout: 4000 });
    expect(childError).toMatchObject({ code: 'MANAGED_MODEL_MISMATCH' });
    expect(f.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    expect(runRecord().children.every((c) => c.callId === null)).toBe(true);
    expect(getAutomationSpendRepository().budget(Date.now())).toMatchObject({ usedPoints: 0 });
  });

  it('runs n=2 as two stable remoteKeys under a single reservation and confirmation', async () => {
    const f = await runFixture();
    const providerId = await f.enable();
    const authorize = vi.fn(async () => {});
    const run = await f.startRun(providerId, f.driveChildren(), authorize);
    expect(run.started.replayed).toBe(false);
    await vi.waitFor(() => expect(run.terminal()).not.toBeNull(), { timeout: 4000 });
    const record = runRecord();
    // One spend request for the whole run; the confirmation card was shown exactly once.
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(
      getDb()
        .prepare("SELECT count(*) AS n FROM automation_spend_requests WHERE action = 'run_scheme'")
        .get(),
    ).toEqual({ n: 1 });
    const request = needed(getAutomationSpendRepository().get(record.requestId));
    expect(request).toMatchObject({
      state: 'terminal',
      outcome: 'success',
      maxImageCalls: 2,
      maxTextCalls: 0,
    });
    // Each original job maps to its own child remoteKey, in frozen plan order.
    expect(record.children).toHaveLength(2);
    expect(new Set(record.children.map((child) => child.remoteKey)).size).toBe(2);
    for (const child of record.children) expect(child.remoteKey).toMatch(/^desktop-rs-v1:/);
    const posts = f.calls.filter(
      (call) => call.url === '/api/v1/generations' && call.method === 'POST',
    );
    expect(posts).toHaveLength(2);
    expect(posts.map((post) => post.key)).toEqual(record.children.map((child) => child.remoteKey));
    for (const post of posts)
      expect(post.body).toMatchObject({ count: 1, expectedBinding: record.binding });
    // Both images land locally and the shared reservation releases once, at 4+4 points.
    const runs = createWorkbenchRepositories(getDb()).runs;
    for (const jobId of run.jobIds) {
      await vi.waitFor(() => expect(runs.get(jobId)?.status).toBe('success'), { timeout: 4000 });
      const asset = getDb()
        .prepare('SELECT media_path FROM generated_assets WHERE run_id = ?')
        .get(jobId) as { media_path: string };
      expect(readFileSync(asset.media_path)).toEqual(png);
    }
    expect(getAutomationSpendRepository().budget(Date.now())).toMatchObject({
      usedPoints: 8,
      hasUnknown: false,
    });
  });

  it('keeps a partial failure settled: same-key replay and recovery add zero provider POSTs', async () => {
    const f = await runFixture(['succeeded', 'failed']);
    const providerId = await f.enable();
    const run = await f.startRun(providerId, f.driveChildren());
    await vi.waitFor(() => expect(run.terminal()).not.toBeNull(), { timeout: 4000 });
    const record = runRecord();
    // Any-succeeded rule: the run finishes success while the failed child keeps its evidence.
    expect(run.terminal()).toMatchObject({ state: 'terminal', outcome: 'success' });
    const runs = createWorkbenchRepositories(getDb()).runs;
    expect(runs.get(run.jobIds[0])).toMatchObject({ status: 'success', actualCost: 4 });
    expect(runs.get(run.jobIds[1])).toMatchObject({ status: 'failed', actualCost: 4 });
    const replayAuthorize = vi.fn(async () => {});
    const replayed = await run.replay();
    // Replay returns the frozen plan without re-confirming or driving anything.
    expect(replayed.replayed).toBe(true);
    expect(replayed.request.id).toBe(record.requestId);
    expect(replayAuthorize).not.toHaveBeenCalled();
    await reconcileManagedDurableRun(record.requestId);
    await reconcileManagedDurableRun(record.requestId);
    expect(
      f.calls.filter((call) => call.url === '/api/v1/generations' && call.method === 'POST'),
    ).toHaveLength(2);
    expect(getAutomationSpendRepository().budget(Date.now())).toMatchObject({ usedPoints: 8 });
  });

  it('recovers a lost child POST reply by querying receipts only, accepting the late success', async () => {
    const f = await runFixture();
    f.brokenPostAt(1);
    const providerId = await f.enable();
    const run = await f.startRun(providerId, f.driveChildren());
    await vi.waitFor(() => expect(run.terminal()).not.toBeNull(), { timeout: 4000 });
    const record = runRecord();
    expect(record.children[1]).toMatchObject({ submissionState: 'query_only' });
    // The second child's claim survived the broken reply; its receipt closed the cost.
    const runs = createWorkbenchRepositories(getDb()).runs;
    await vi.waitFor(() => expect(runs.get(run.jobIds[1])).toMatchObject({ status: 'success' }), {
      timeout: 4000,
    });
    const posts = f.calls.filter(
      (call) => call.url === '/api/v1/generations' && call.method === 'POST',
    );
    expect(posts).toHaveLength(2);
    await reconcileManagedDurableRun(record.requestId);
    expect(
      f.calls.filter((call) => call.url === '/api/v1/generations' && call.method === 'POST'),
    ).toHaveLength(2);
    expect(getAutomationSpendRepository().budget(Date.now())).toMatchObject({
      usedPoints: 8,
      hasUnknown: false,
    });
  });

  it('freezes reference digests at submit: bytes changed between children are rejected without a send', async () => {
    const f = await runFixture();
    const providerId = await f.enable();
    const referencePath = join(state.root, PREVIEWS_DIR_NAME, 'uploads', 'rsref.png');
    mkdirSync(join(state.root, PREVIEWS_DIR_NAME, 'uploads'), { recursive: true });
    writeFileSync(referencePath, png);
    const reference: LocalImageReference[] = [
      { path: referencePath, source: 'upload', name: 'rsref.png' },
    ];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let firstChildFinished = false;
    const run = await f.startRun(
      providerId,
      f.driveChildren(reference, async (index) => {
        if (index !== 0) return;
        firstChildFinished = true;
        await gate;
      }),
    );
    // Mutate at the real inter-child boundary, not after a polling race with child 2.
    try {
      await vi.waitFor(() => expect(firstChildFinished).toBe(true), { timeout: 4000 });
      const posts = f.calls.filter(
        (call) => call.url === '/api/v1/generations' && call.method === 'POST',
      );
      expect(posts).toHaveLength(1);
      expect((posts[0].body as { referenceImages?: unknown[] }).referenceImages).toHaveLength(1);
      expect(f.referenceUploads).toHaveLength(1);
      writeFileSync(referencePath, Buffer.concat([png, Buffer.from('rs-mutated-bytes')]));
    } finally {
      release();
    }
    await vi.waitFor(
      () =>
        expect(createWorkbenchRepositories(getDb()).runs.get(run.jobIds[1])).toMatchObject({
          status: 'failed',
          errorCode: 'SPEND_REFERENCE_CHANGED',
        }),
      { timeout: 4000 },
    );
    await vi.waitFor(() => expect(run.terminal()).toMatchObject({ state: 'terminal' }), {
      timeout: 4000,
    });
    expect(
      f.calls.filter((call) => call.url === '/api/v1/generations' && call.method === 'POST'),
    ).toHaveLength(1);
    expect(f.referenceUploads).toHaveLength(1);
    // Child 2 never crossed the send boundary: zero-cost cancellation in the shared ledger.
    expect(getAutomationSpendRepository().budget(Date.now())).toMatchObject({ usedPoints: 4 });
    expect(runRecord().children[1]).toMatchObject({
      callId: null,
      cancelAcknowledgedAt: expect.any(Number),
    });
  });

  it('uses the edits channel per child when the run froze references, plain generations otherwise', async () => {
    const f = await runFixture();
    const providerId = await f.enable();
    const referencePath = join(state.root, PREVIEWS_DIR_NAME, 'uploads', 'rsref.png');
    mkdirSync(join(state.root, PREVIEWS_DIR_NAME, 'uploads'), { recursive: true });
    writeFileSync(referencePath, png);
    const reference: LocalImageReference[] = [
      { path: referencePath, source: 'upload', name: 'rsref.png' },
    ];
    const edited = await f.startRun(providerId, f.driveChildren(reference));
    await vi.waitFor(() => expect(edited.terminal()).not.toBeNull(), { timeout: 4000 });
    const editedPosts = f.calls.filter(
      (call) => call.url === '/api/v1/generations' && call.method === 'POST',
    );
    expect(editedPosts).toHaveLength(2);
    for (const post of editedPosts) {
      const body = post.body as { referenceImages?: Array<{ id: string; digest: string }> };
      expect(body.referenceImages).toHaveLength(1);
      expect(body.referenceImages?.[0]).toMatchObject({
        id: 'cloudref00000001',
        digest: createHash('sha256').update(png).digest('hex'),
      });
    }
    // One upload serves every child: the frozen digest is uploaded once and reused.
    expect(f.referenceUploads).toHaveLength(1);
    // A run that froze no references sends plain generations without reference payloads.
    const plain = await f.startRun(providerId, f.driveChildren());
    await vi.waitFor(() => expect(plain.terminal()).not.toBeNull(), { timeout: 4000 });
    const plainPosts = f.calls
      .filter((call) => call.url === '/api/v1/generations' && call.method === 'POST')
      .slice(2);
    expect(plainPosts).toHaveLength(2);
    // The schema default keeps the field, but a plain child never carries references.
    for (const post of plainPosts)
      expect((post.body as { referenceImages?: unknown[] }).referenceImages).toEqual([]);
    expect(f.referenceUploads).toHaveLength(1);
  });
});

describe('canonical desktop scheme with the real managed runtime, SQLite and controlled HTTP', () => {
  async function schemeFixture(phases?: RunPhase[]) {
    const f = await runFixture(phases);
    const providerId = await f.enable();
    const schemeDb = new Database(':memory:');
    runDesignSchemeDbMigrations(schemeDb);
    cleanup.push(async () => {
      schemeDb.close();
    });
    const repository = new DesignSchemeRepository(schemeDb);
    repository.insertSchemeDraft({
      document: {
        schemaVersion: 1,
        schemeId: 'managed_scheme',
        revisionId: 'managed_revision',
        name: 'Managed scheme',
        summary: 'A controlled run',
        fidelity: 'faithful',
        sources: [{ id: 'brief', kind: 'user-brief', role: 'context' }],
        inputs: [{ id: 'topic', kind: 'text', label: 'Topic', required: true }],
        parameters: [],
        constraints: [],
        promptProgram: [
          {
            id: 'module',
            order: 0,
            kind: 'input-template',
            template: 'Draw {{topic}}',
            variables: ['topic'],
            sourceIds: ['brief'],
          },
        ],
        compilation: {
          compiledAt: 1,
          model: { model: 'fixture' },
          adopted: [],
          omitted: [],
          warnings: [],
          trace: [],
        },
      },
      sourceLabel: 'Controlled fixture',
      sourcePresentation: 'musefold-created',
      createdBy: 'user',
      bindings: [],
    });
    getDb()
      .prepare(
        'INSERT INTO workbench_sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
      )
      .run('managed_session', 'Managed session', 1, 1);
    const { prepareDesktopDesignSchemeRun } = await import(
      '../../main/design-scheme/fixed-run-plan-builder'
    );
    const { runCanonicalDesignScheme } = await import(
      '../../main/ipc-v25/design-scheme-run-adapter'
    );
    const { DesignSchemeExecutionRegistry } = await import(
      '../../main/design-scheme/execution-registry'
    );
    const registry = new DesignSchemeExecutionRegistry();
    const prepare = async (model: string, mode: 'trial' | 'formal' = 'trial') => {
      const cloudBinding = await prepareManagedRunBinding(providerId, model, f.binding(model));
      return prepareDesktopDesignSchemeRun(
        prepareDesignSchemeRunInputSchema.parse({
          executionId: randomUUID(),
          schemeId: 'managed_scheme',
          revisionId: 'managed_revision',
          mode,
          brief: 'A quiet poster',
          inputValues: { topic: 'a tree' },
          executionSettings: {
            providerId,
            model,
            expectedBinding: f.binding(model),
            workbenchSessionId: 'managed_session',
            outputCount: 2,
            size: '1024x1024',
            aspectRatio: '1:1',
            quality: 'auto',
            referenceAssetIds: [],
            promptReferenceSelections: [],
          },
        }),
        { designSchemeDb: schemeDb, coreDb: getDb(), cloudBinding },
      );
    };
    const run = (
      input: Awaited<ReturnType<typeof prepare>>,
      emit: (event: import('@musefold/contracts').DesignSchemeEvent) => void = () => {},
    ) =>
      runCanonicalDesignScheme(input, 42, {
        db: schemeDb,
        coreDb: getDb(),
        userDataDir: state.root,
        picturesDir: join(state.root, 'pictures'),
        executionRegistry: registry,
        emit: (_sender, event) => emit(event),
      });
    return { ...f, prepare, run, registry, schemeDb, repository };
  }

  it('runs trial and formal with different cloud models, retaining local workbench context and original receipts', async () => {
    const f = await schemeFixture();
    const trial = await f.prepare('gpt-image-2');
    const result = await f.run(trial);
    expect(result.status).toBe('completed');
    expect(result.outputs).toHaveLength(2);
    const trialRecord = runRecord();
    expect(trialRecord.binding.model).toBe('gpt-image-2');
    const rows = getDb()
      .prepare(
        'SELECT model, workbench_session_id, result_index, status FROM generation_runs ORDER BY rowid',
      )
      .all();
    expect(rows).toEqual(
      [0, 1].map((result_index) => ({
        model: 'gpt-image-2',
        workbench_session_id: 'managed_session',
        result_index,
        status: 'success',
      })),
    );
    expect(
      JSON.parse(
        (
          f.schemeDb
            .prepare('SELECT provider_json FROM design_scheme_runs WHERE run_id = ?')
            .get(result.runId) as { provider_json: string }
        ).provider_json,
      ).model,
    ).toBe('gpt-image-2');
    const albumCount = () =>
      (f.schemeDb.prepare('SELECT count(*) AS n FROM design_scheme_assets').get() as { n: number })
        .n;
    expect(albumCount()).toBe(2);
    f.repository.selectCover('managed_scheme', result.outputs[0].id);
    f.repository.formalize('managed_scheme');
    const formal = await f.run(await f.prepare('musefold-image', 'formal'));
    expect(formal.status).toBe('completed');
    expect(formal.outputs).toHaveLength(2);
    expect(albumCount()).toBe(2);
    const posts = f.calls.filter((c) => c.method === 'POST' && c.url === '/api/v1/generations');
    expect(posts.map((c) => (c.body as { model: string }).model)).toEqual([
      'gpt-image-2',
      'gpt-image-2',
      'musefold-image',
      'musefold-image',
    ]);
    for (const post of posts) {
      expect(post.body).not.toHaveProperty('workbench');
      expect(post.body).not.toHaveProperty('promptReferences');
    }
    f.catalogAvailable(false);
    await reconcileManagedDurableRun(trialRecord.requestId);
    expect(
      f.calls.filter((c) => c.method === 'POST' && c.url === '/api/v1/generations'),
    ).toHaveLength(4);
    expect(
      trialRecord.children.every((child) => child.receipt?.binding?.model === 'gpt-image-2'),
    ).toBe(true);
  });

  it('rechecks price after preparation and cancels before the first dispatch without sending', async () => {
    const f = await schemeFixture();
    const priced = await f.prepare('gpt-image-2');
    f.modelPriced(false);
    const refused = await f.run(priced);
    expect(refused).toMatchObject({
      status: 'failed',
      error: { code: 'MANAGED_MODEL_UNAVAILABLE' },
    });
    expect(f.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    f.modelPriced(true);
    const input = await f.prepare('gpt-image-2');
    const result = await f.run(input, (event) => {
      if (event.kind === 'step-started' && event.stepId === input.plan.steps[2].id)
        f.registry.cancel(42, input.executionId);
    });
    expect(result.status).toBe('cancelled');
    expect(f.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    expect(runRecord().children.every((c) => c.callId === null)).toBe(true);
  });

  it('durably cancels a claimed cloud child and never submits the remaining image', async () => {
    const f = await schemeFixture(['queued', 'succeeded']);
    const input = await f.prepare('musefold-image');
    const completion = f.run(input);
    await vi.waitFor(() => expect(f.remote.size).toBe(1), { timeout: 4000 });
    expect(f.registry.cancel(42, input.executionId).status).toBe('cancelled');
    await vi.waitFor(() => expect(runRecord().cancelRequestedAt).not.toBeNull(), { timeout: 2000 });
    await vi.waitFor(
      () =>
        expect(
          [...f.remote.values()].map((entry) => entry.phase),
          JSON.stringify(f.calls.map((call) => [call.method, call.url])),
        ).toEqual(['cancelled']),
      { timeout: 3000 },
    );
    expect((await completion).status).toBe('cancelled');
    const frozen = runRecord();
    await vi.waitFor(
      () => expect(getAutomationSpendRepository().get(frozen.requestId)?.state).toBe('terminal'),
      { timeout: 4000 },
    );
    const settled = runRecord();
    expect(settled.cancelRequestedAt).not.toBeNull();
    expect(settled.children[0].receipt).toMatchObject({
      status: 'cancelled',
      binding: { model: 'musefold-image' },
      costPoints: 4,
    });
    expect(settled.children[1]).toMatchObject({
      callId: null,
      cancelAcknowledgedAt: expect.any(Number),
    });
    expect(
      f.calls.filter((c) => c.method === 'POST' && c.url === '/api/v1/generations'),
    ).toHaveLength(1);
    expect(f.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/cancel'))).toHaveLength(1);
    expect(getAutomationSpendRepository().budget(Date.now())).toMatchObject({
      usedPoints: 4,
      hasUnknown: false,
    });
  }, 15000);
});
