import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generationJobSchema, type GenerationExecutionReceipt } from '@musefold/contracts';
import { configureTestCoreRuntime } from '@musefold/core/testing';
import { closeDb, getDb, initDb } from '@musefold/core/db';
import { AutomationSpendRepository } from '@musefold/core/db/repositories/automation-spend';
import { ManagedExecutionRepository } from '@musefold/core/db/repositories/managed-execution';
import { ManagedExecutionGuard } from '@musefold/core/services/managed-execution-guard';
import { ManagedGenerationLedger } from '@musefold/core/services/managed-generation-ledger';
import { EncryptedManagedAnchorFile } from '@musefold/core/services/managed-execution-anchor-file';
import { fixtureCipher } from '@musefold/core/services/__tests__/fixtures/managed-anchor-cipher';
import {
  managedCommand,
  managedReceipt,
} from '@musefold/core/services/__tests__/fixtures/managed-generation';

const state = vi.hoisted(() => ({ root: '', access: vi.fn(), anchor: vi.fn() }));
vi.mock('../../main/ipc-v25/account-domain', () => ({
  captureManagedAccountSession: state.access,
}));
vi.mock('../../security/managed-execution-anchor', () => ({
  createManagedExecutionAnchor: state.anchor,
}));
vi.mock('../paths', () => ({ getPaths: () => ({ userData: state.root }) }));
import {
  ManagedGenerationClient,
  withManagedGenerationSession,
} from '../managed-generation-client';
import { managedExecutionWorkScope } from '../managed-execution';

const cleanup: Array<() => Promise<void>> = [];
let guard: ManagedExecutionGuard;
let spend: AutomationSpendRepository;
beforeEach(async () => {
  state.root = mkdtempSync(join(tmpdir(), 'musefold-managed-client-'));
  configureTestCoreRuntime(state.root);
  initDb();
  const anchor = new EncryptedManagedAnchorFile(join(state.root, 'anchor'), fixtureCipher);
  state.anchor.mockReset().mockReturnValue(anchor);
  guard = new ManagedExecutionGuard(new ManagedExecutionRepository(getDb()), anchor);
  spend = new AutomationSpendRepository(getDb());
  spend.initializeBudget({ monthlyLimitPoints: 10, usedPoints: 0, month: '2026-09' }, 1);
  await guard.enable();
});
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  closeDb();
  rmSync(state.root, { recursive: true, force: true });
});
function json(res: ServerResponse, value: unknown, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value));
}
async function fixture(timeout = 2000) {
  const command = managedCommand();
  let active = true;
  const access = {
    session: {
      version: 2 as const,
      token: `synthetic-bearer-${randomUUID()}`,
      ownerId: 'local-owner',
      apiIssuer: '',
      principalId: command.binding.principalId,
      authEpoch: command.authEpoch,
      restricted: false,
      pendingRecovery: null,
    },
    assertCurrent: () => {
      if (!active) throw new Error('STALE_ACCOUNT');
    },
    async assertFresh() {
      access.assertCurrent();
    },
    invalidate: vi.fn(async () => {}),
  };
  state.access.mockReset().mockResolvedValue(access);
  let posts = 0;
  let gets = 0;
  let posted: unknown;
  let key: string | undefined;
  let responseReceipt: GenerationExecutionReceipt | null = null;
  let intercept: ((req: IncomingMessage, res: ServerResponse) => boolean) | null = null;
  const server = createServer((req, res) => {
    if (req.method === 'POST') posts++;
    else gets++;
    if (intercept?.(req, res)) return;
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
    if (req.method === 'POST') {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        posted = JSON.parse(Buffer.concat(chunks).toString());
        key = String(req.headers['idempotency-key']);
        json(
          res,
          generationJobSchema.parse({
            id: 'fixture-remote-run',
            sessionId: null,
            parentRunId: null,
            promptId: null,
            actorType: 'desktop_local',
            approvalStatus: 'not_required',
            status: 'queued',
            progress: 0,
            request: command.request,
            providerModel: command.binding.model,
            costPoints: null,
            assets: [],
            error: null,
            createdAt: '2026-09-08T01:00:00.000Z',
            startedAt: null,
            finishedAt: null,
          }),
          201,
        );
      });
      return;
    }
    if (req.url?.startsWith('/api/v1/generations/receipts/by-key')) {
      if (!responseReceipt) {
        res.writeHead(404).end();
        return;
      }
      json(res, responseReceipt);
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
  if (!address || typeof address === 'string') throw new Error('Missing server');
  command.binding.apiIssuer = `http://127.0.0.1:${address.port}`;
  access.session.apiIssuer = command.binding.apiIssuer;
  const signal = new AbortController();
  const ledger = new ManagedGenerationLedger(getDb(), guard, access.assertCurrent);
  const client = new ManagedGenerationClient(
    access,
    ledger,
    { signal: signal.signal, assertCurrent: access.assertCurrent },
    timeout,
  );
  const { record } = await ledger.register(command);
  responseReceipt = managedReceipt(record);
  return {
    command,
    record,
    client,
    ledger,
    access,
    signal,
    posts: () => posts,
    gets: () => gets,
    posted: () => ({ body: posted, key }),
    invalidate: () => {
      active = false;
    },
    intercept: (fn: typeof intercept) => {
      intercept = fn;
    },
    receipt: (value: GenerationExecutionReceipt | null) => {
      responseReceipt = value;
    },
  };
}

describe('managed main-process HTTP transport', () => {
  it.each(['available', 'wrong-account', 'no-price', 'not-image'] as const)(
    'pins selected model expectations to the current account catalog: %s',
    async (mode) => {
      const f = await fixture();
      f.intercept((req, res) => {
        if (req.url !== '/api/v1/account/models') return false;
        const { apiIssuer, principalId, payer, credential } = f.command.binding;
        json(res, {
          identity: {
            apiIssuer,
            principalId: mode === 'wrong-account' ? 'other' : principalId,
            payer,
            credential,
          },
          group: 'vip',
          checkedAt: new Date().toISOString(),
          models: [
            {
              model: 'gpt-image-2',
              supportedEndpointTypes: ['openai'],
              imageGeneration: mode !== 'not-image',
              pricing:
                mode === 'no-price'
                  ? { kind: 'unavailable', reason: 'missing_price' }
                  : { kind: 'per_call', baseUsd: 0.04, groupRatio: 1, quotaPerCall: 20000 },
            },
          ],
        });
        return true;
      });
      if (mode === 'available')
        expect(await f.client.binding('gpt-image-2')).toEqual({
          ...f.command.binding,
          model: 'gpt-image-2',
        });
      else
        await expect(f.client.binding('gpt-image-2')).rejects.toThrow(
          mode === 'wrong-account' ? 'MANAGED_IDENTITY_CHANGED' : 'MANAGED_MODEL_UNAVAILABLE',
        );
      expect(f.posts()).toBe(0);
    },
  );
  it.each(['valid', 'redirect', 'wrong-type', 'wrong-size', 'wrong-dimensions', 'oversize'])(
    'owned asset download handles %s without following the result URL',
    async (mode) => {
      const f = await fixture();
      await f.client.submitInitial(f.record.requestId, 'local-result', f.command.now);
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6p9sAAAAASUVORK5CYII=',
        'base64',
      );
      f.intercept((req, res) => {
        if (req.url === '/api/v1/generations/fixture-remote-run') {
          json(
            res,
            generationJobSchema.parse({
              id: 'fixture-remote-run',
              sessionId: null,
              parentRunId: null,
              promptId: null,
              actorType: 'desktop_local',
              approvalStatus: 'not_required',
              status: 'succeeded',
              progress: 100,
              request: f.command.request,
              providerModel: f.command.binding.model,
              costPoints: 1,
              assets: [
                {
                  id: 'owned-asset',
                  url: 'https://untrusted.invalid/do-not-fetch',
                  mimeType: 'image/png',
                  width: mode === 'wrong-dimensions' ? 2 : 1,
                  height: 1,
                  byteSize: mode === 'wrong-size' ? png.length + 1 : png.length,
                  expiresAt: '2030-01-01T00:00:00Z',
                },
              ],
              error: null,
              createdAt: '2026-09-08T01:00:00Z',
              startedAt: null,
              finishedAt: '2026-09-08T02:00:00Z',
            }),
          );
          return true;
        }
        if (req.url !== '/api/v1/assets/owned-asset/content') return false;
        expect(req.headers.authorization).toBe(`Bearer ${f.access.session.token}`);
        if (mode === 'redirect') res.writeHead(302, { location: '/unexpected-target' }).end();
        else if (mode === 'oversize')
          res
            .writeHead(200, { 'content-type': 'image/png', 'content-length': 30 * 1024 * 1024 + 1 })
            .end();
        else
          res
            .writeHead(200, { 'content-type': mode === 'wrong-type' ? 'text/html' : 'image/png' })
            .end(png);
        return true;
      });
      const before = f.gets();
      await expect(f.client.asset(f.record.requestId, 'foreign-asset')).rejects.toThrow(
        'MANAGED_ASSET_UNAVAILABLE',
      );
      expect(f.gets() - before).toBe(1);
      if (mode === 'valid')
        expect((await f.client.asset(f.record.requestId, 'owned-asset')).bytes).toEqual(png);
      else
        await expect(f.client.asset(f.record.requestId, 'owned-asset')).rejects.toThrow(
          /^MANAGED_/,
        );
      expect(f.gets() - before).toBe(3);
      expect(f.posts()).toBe(1);
    },
  );

  it('cancels an unclaimed request durably without making any HTTP request', async () => {
    const f = await fixture();
    await f.client.cancel(f.record.requestId);
    expect(f.posts()).toBe(0);
    expect(f.gets()).toBe(0);
    expect(
      f.ledger.forQuery(f.record.requestId, f.client.context).cancelRequestedAt,
    ).not.toBeNull();
    await expect(f.client.submitInitial(f.record.requestId, 'local-result')).rejects.toThrow(
      'MANAGED_CANCEL_REQUESTED',
    );
    expect(f.posts()).toBe(0);
  });

  it('prepares a fixed binding and submits the frozen raw cloud request exactly once', async () => {
    const f = await fixture();
    const receipt = await f.client.submitInitial(f.record.requestId, 'local-result', f.command.now);
    expect(receipt?.originalRunId).toBe('fixture-remote-run');
    expect(f.posted()).toEqual({
      body: { ...f.command.request, expectedBinding: f.command.binding },
      key: f.record.remoteKey,
    });
    expect(f.posts()).toBe(1);
    expect(f.gets()).toBe(2);
    await expect(
      f.client.submitInitial(f.record.requestId, 'local-result', f.command.now),
    ).rejects.toThrow('MANAGED_QUERY_ONLY');
    expect(f.posts()).toBe(1);
    expect(getDb().serialize().includes(Buffer.from(f.access.session.token))).toBe(false);
    expect(JSON.stringify(f.posted())).not.toContain(f.access.session.token);
  });

  it('leaves uncertain submission recoverable by GET when the response body is invalid', async () => {
    const f = await fixture();
    f.intercept((req, res) => {
      if (req.method !== 'POST') return false;
      req.resume();
      res.writeHead(201, { 'content-type': 'application/json' }).end('{');
      return true;
    });
    await expect(
      f.client.submitInitial(f.record.requestId, 'local-result', f.command.now),
    ).rejects.toThrow('MANAGED_SUBMISSION_UNCERTAIN');
    expect(spend.budget(f.command.now).hasUnknown).toBe(true);
    f.intercept(null);
    await f.client.reconcile(f.record.requestId, f.command.now);
    expect(f.posts()).toBe(1);
    expect(spend.budget(f.command.now).hasUnknown).toBe(false);
  });

  it('never treats receipt 404 as free or as permission to submit', async () => {
    const f = await fixture();
    f.receipt(null);
    expect(
      await f.client.submitInitial(f.record.requestId, 'local-result', f.command.now),
    ).toBeNull();
    expect(await f.client.reconcile(f.record.requestId, f.command.now)).toBeNull();
    expect(spend.budget(f.command.now).hasUnknown).toBe(true);
    expect(f.posts()).toBe(1);
  });

  it('does not clear a new account on a delayed 401', async () => {
    const f = await fixture();
    f.intercept((_req, res) => {
      f.invalidate();
      json(res, {}, 401);
      return true;
    });
    await expect(f.client.binding()).rejects.toThrow('STALE_ACCOUNT');
    expect(f.access.invalidate).not.toHaveBeenCalled();
    expect(f.posts()).toBe(0);
  });

  it('invalidates only the captured current session on a current 401', async () => {
    const f = await fixture();
    f.intercept((_req, res) => {
      json(res, {}, 401);
      return true;
    });
    await expect(f.client.binding()).rejects.toThrow('MANAGED_AUTH_REQUIRED');
    expect(f.access.invalidate).toHaveBeenCalledOnce();
    expect(f.posts()).toBe(0);
  });

  it('checks account state again after asynchronous preparation and before its claim', async () => {
    const f = await fixture();
    f.access.assertFresh = async () => {
      f.invalidate();
    };
    await expect(
      f.client.submitInitial(f.record.requestId, 'local', f.command.now),
    ).rejects.toThrow('STALE_ACCOUNT');
    expect(f.posts()).toBe(0);
    expect(spend.calls(f.record.requestId)).toEqual([]);
  });

  it.each([
    'oversize-header',
    'oversize-stream',
    'invalid-json',
    'wrong-type',
    'redirect',
    'timeout',
  ])('bounds and rejects %s responses without sending a generation', async (mode) => {
    const f = await fixture(mode === 'timeout' ? 100 : 2000);
    f.intercept((_req, res) => {
      if (mode === 'oversize-header')
        res.writeHead(200, { 'content-type': 'application/json', 'content-length': 1048577 }).end();
      else if (mode === 'oversize-stream')
        res.writeHead(200, { 'content-type': 'application/json' }).end(' '.repeat(1048577));
      else if (mode === 'invalid-json')
        res.writeHead(200, { 'content-type': 'application/json' }).end('{');
      else if (mode === 'wrong-type')
        res.writeHead(200, { 'content-type': 'text/html' }).end('<html>secret echo</html>');
      else if (mode === 'redirect')
        res.writeHead(302, { location: '/redirected-secret-endpoint' }).end();
      else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.flushHeaders();
      }
      return true;
    });
    await expect(f.client.binding()).rejects.toThrow(/^MANAGED_/);
    expect(f.posts()).toBe(0);
    expect(f.gets()).toBe(1);
  });

  it('scope abort cancels an in-flight body and makes later operations unavailable', async () => {
    const f = await fixture();
    f.intercept((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.flushHeaders();
      f.signal.abort();
      return true;
    });
    await expect(f.client.binding()).rejects.toThrow('MANAGED_OPERATION_ABORTED');
    await expect(f.client.binding()).rejects.toThrow('MANAGED_OPERATION_ABORTED');
    expect(f.gets()).toBe(1);
  });

  it('expires retained session objects after the work scope returns', async () => {
    const f = await fixture();
    let retained: ManagedGenerationClient | undefined;
    await withManagedGenerationSession(async ({ client }) => {
      retained = client;
      await client.binding();
    });
    if (!retained) throw new Error('Missing captured session');
    await expect(retained.binding()).rejects.toThrow('MANAGED_SESSION_CLOSED');
    expect(f.gets()).toBe(1);
  });

  it('registers live transport with the actual restore drain scope', async () => {
    const f = await fixture();
    let reached = () => {};
    const ready = new Promise<void>((resolve) => {
      reached = resolve;
    });
    f.intercept((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.flushHeaders();
      reached();
      return true;
    });
    const running = withManagedGenerationSession(async ({ client }) => client.binding());
    const rejected = expect(running).rejects.toThrow(/^MANAGED_/);
    await ready;
    await managedExecutionWorkScope().drainForRestore(2000);
    await rejected;
    expect(f.posts()).toBe(0);
  });
});
