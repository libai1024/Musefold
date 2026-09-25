const hashIo = vi.hoisted(() => ({
  afterRead: undefined as (() => void) | undefined,
  afterStat: undefined as (() => void) | undefined,
  readBytes: 0,
}));
vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>();
  return {
    ...fs,
    fstatSync: (...args: Parameters<typeof fs.fstatSync>) => {
      const value = fs.fstatSync(...args);
      const hook = hashIo.afterStat;
      hashIo.afterStat = undefined;
      hook?.();
      return value;
    },
    readSync: (...args: Parameters<typeof fs.readSync>) => {
      const count = fs.readSync(...args);
      hashIo.readBytes += count;
      const hook = hashIo.afterRead;
      hashIo.afterRead = undefined;
      hook?.();
      return count;
    },
    readFileSync: (...args: Parameters<typeof fs.readFileSync>) => {
      const value = fs.readFileSync(...args);
      if (typeof args[0] === 'number') {
        hashIo.readBytes += value.length;
        const hook = hashIo.afterRead;
        hashIo.afterRead = undefined;
        hook?.();
      }
      return value;
    },
  };
});
afterEach(() => {
  hashIo.afterRead = undefined;
  hashIo.afterStat = undefined;
  hashIo.readBytes = 0;
});
import type { ManagedExecutionAnchor } from '@musefold/desktop-contracts/managed-execution';
import { ManagedExecutionRepository } from '@musefold/core/db/repositories/managed-execution';
import { ManagedExecutionGuard } from '@musefold/core/services/managed-execution-guard';
import { ManagedGenerationLedger } from '@musefold/core/services/managed-generation-ledger';
import {
  managedCommand,
  managedContext,
} from '@musefold/core/services/__tests__/fixtures/managed-generation';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import Database from 'better-sqlite3';
import { takeoverDesktopDatabase } from '@musefold/desktop-db';
import { configureCoreRuntime } from '@musefold/core/runtime';
import { loadManagedFilesystem } from '@musefold/managed-fs';
import { resolve } from 'node:path';
import { closeDesignSchemeDb } from '@musefold/core/db/design-scheme';
import { cancelGeneration, generate } from '@musefold/core/services/generation';
import { AutomationSpendRepository } from '@musefold/core/db/repositories/automation-spend';
import {
  createGenerationGate,
  type AutomationRouteContext,
  type GenerationGate,
  type GenerationHost,
} from '@musefold/automation-server';
import type { GenerateImageRequest } from '@musefold/desktop-contracts/providers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Missing fixture value');
  return value;
}

const state = vi.hoisted(() => ({
  db: null as Database.Database | null,
  key: 'fixture-canary-key',
  epoch: 'fixture-key-epoch',
  generate: vi.fn(),
  points: null as number | null,
}));
vi.mock('@musefold/core/db/index', () => ({ getDb: () => state.db }));
vi.mock('../../security/keychain', () => ({
  loadApiKeySnapshot: () => (state.key ? { key: state.key, epoch: state.epoch } : null),
}));
vi.mock('../../settings/automation', () => ({
  getAutomationSpendRepository: () => {
    if (!state.db) throw new Error('Fixture DB unavailable');
    const repository = new AutomationSpendRepository(state.db);
    repository.initializeBudget(
      { monthlyLimitPoints: 20, usedPoints: 0, month: new Date().toISOString().slice(0, 7) },
      Date.now(),
    );
    return repository;
  },
}));
vi.mock('../core-instance', () => ({
  getMusefoldCore: () => ({
    generation: { generate: (...args: unknown[]) => state.generate(...args) },
  }),
}));

import { createDesktopGenerationPersistence } from '../automation-spend';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGQAAAABJRU5ErkJggg==',
  'base64',
);
let directory: string;
let databasePath: string;
let server: Server;
let baseUrl: string;
let sends: Array<{ authorization: string | undefined; body: string }>;
let failureStatus: number | null;
let logs: unknown[][];

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'musefold-durable-generation-'));
  databasePath = join(directory, 'local.db');
  state.db = new Database(databasePath);
  state.db.pragma('journal_mode = WAL');
  state.db.pragma('foreign_keys = ON');
  takeoverDesktopDatabase(state.db);
  state.key = 'fixture-canary-key';
  state.epoch = 'fixture-key-epoch';
  state.points = null;
  state.generate.mockReset().mockImplementation(generate);
  sends = [];
  logs = [];
  failureStatus = null;
  server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += String(chunk);
    });
    request.on('end', () => {
      sends.push({ authorization: request.headers.authorization, body });
      response.writeHead(failureStatus ?? 200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify(
          failureStatus
            ? { error: { message: 'fixture upstream failure' } }
            : { data: [{ b64_json: png.toString('base64') }] },
        ),
      );
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture listener missing');
  baseUrl = `http://127.0.0.1:${address.port}/v1`;
  state.db
    .prepare(
      `INSERT INTO providers(id, name, type, base_url, model, has_key, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)`,
    )
    .run(
      'fixture-provider',
      'Fixture Provider',
      'openai-compatible',
      baseUrl,
      'fixture-model',
      Date.now(),
      Date.now(),
    );
  mkdirSync(join(directory, 'previews', 'uploads'), { recursive: true });
  configureCoreRuntime({
    managedFilesystem: () =>
      loadManagedFilesystem(resolve('packages/managed-fs/build/Release/managed_fs.node')),
    getPaths: () => ({
      userData: directory,
      db: databasePath,
      backups: join(directory, 'backups'),
      previews: join(directory, 'previews'),
      pictures: join(directory, 'pictures'),
      logs: join(directory, 'logs'),
    }),
    loadApiKey: () => state.key,
    estimateProviderCost: () => state.points,
    createLogger: () => ({
      debug: (...args) => logs.push(args),
      info: (...args) => logs.push(args),
      warn: (...args) => logs.push(args),
      error: (...args) => logs.push(args),
    }),
  });
});
afterEach(async () => {
  closeDesignSchemeDb();
  await new Promise<void>((done) => server.close(() => done()));
  state.db?.close();
  state.db = null;
  rmSync(directory, { recursive: true, force: true });
});

function hostFixture() {
  const authorize = (path: string) => realpathSync(path).startsWith(realpathSync(directory) + sep);
  const durable = createDesktopGenerationPersistence(authorize);
  const repository = new AutomationSpendRepository(state.db as Database.Database);
  const host: GenerationHost = {
    persistence: durable.persistence,
    run: (request, progress, spend) => {
      if (!spend) throw new Error('Expected durable execution context');
      return durable.run(request, progress, spend);
    },
    cancel: () => false,
    estimate: (body) => ({
      points: null,
      managedByAccount: Boolean(
        state.db?.prepare('SELECT managed_by FROM providers').get() &&
          (
            state.db.prepare('SELECT managed_by FROM providers').get() as {
              managed_by: string | null;
            }
          ).managed_by,
      ),
      providerId: 'fixture-provider',
      providerName: 'Fixture Provider',
      model: body.model ?? 'fixture-model',
      n: body.n ?? 1,
    }),
    budget: {
      remainingPoints: () => repository.budget(Date.now()).remainingPoints,
      settle: () => {
        throw new Error('Durable requests must not use the legacy settlement');
      },
    },
    requestConfirmation: async () => {
      throw new Error('Fixture BYOK must not ask for managed-budget approval');
    },
    authorizeReferencePath: authorize,
    stageUpload: async () => {
      throw new Error('Unused');
    },
    resolveHistoryImage: () => null,
  };
  return {
    gate: createGenerationGate(host, { sink: { emit: () => {} } }),
    host,
    durable,
    repository,
  };
}

async function invoke(
  gate: GenerationGate,
  route: string,
  body: unknown = {},
  key?: string,
  jobId?: string,
) {
  let value: unknown;
  const returned = await gate.routes[route]({
    body,
    request: { headers: key ? { 'idempotency-key': key } : {} },
    params: { jobId },
    json: (payload: unknown) => {
      value = payload;
    },
  } as unknown as AutomationRouteContext);
  return (value ?? returned) as {
    jobId: string;
    status: string;
    error?: { code: string };
    assets?: unknown[];
  };
}

function generationRequest(
  jobId: string,
  referenceImages?: GenerateImageRequest['referenceImages'],
): GenerateImageRequest {
  return {
    providerId: 'fixture-provider',
    model: 'fixture-model',
    jobId,
    prompt: 'fixture prompt',
    size: '1024x1024',
    quality: 'auto',
    n: 1,
    referenceImages,
  };
}

describe('desktop generation durable production adapter', () => {
  it('sends once through real core and HTTP, reopens the DB, and replays without a second executor or charge', async () => {
    const first = hostFixture();
    const body = { prompt: 'fixture prompt', n: 1 };
    const job = await invoke(first.gate, 'POST /v1/generations', body, 'fixture-key');
    await vi.waitFor(async () =>
      expect(
        (await invoke(first.gate, 'GET /v1/generations/:jobId', {}, undefined, job.jobId)).status,
      ).toBe('success'),
    );
    expect(sends).toHaveLength(1);
    expect(sends[0].authorization).toBe('Bearer fixture-canary-key');
    expect(
      first.repository.calls(first.repository.findByKey('fixture-key')?.id ?? '')[0],
    ).toMatchObject({ state: 'unknown', costSource: 'unknown', policyPoints: null });
    state.db?.close();
    state.db = new Database(databasePath);
    const second = hostFixture();
    const replay = await invoke(second.gate, 'POST /v1/generations', body, 'fixture-key');
    expect(replay).toMatchObject({ jobId: job.jobId, status: 'success' });
    expect(replay.assets).toHaveLength(1);
    expect(state.generate).toHaveBeenCalledTimes(1);
    expect(sends).toHaveLength(1);
    expect(state.db.prepare('SELECT COUNT(*) AS n FROM automation_audit').get()).toEqual({ n: 1 });
    expect(
      JSON.stringify(state.db.prepare('SELECT * FROM automation_spend_requests').all()),
    ).not.toContain('fixture-canary-key');
    expect(JSON.stringify(logs)).not.toContain('fixture-canary-key');
  });

  it('rejects managed legacy keys with absent paid owner before any real Provider call', async () => {
    state.db?.prepare("UPDATE providers SET managed_by = 'account'").run();
    const { gate, repository } = hostFixture();
    await expect(
      invoke(
        gate,
        'POST /v1/generations',
        { prompt: 'fixture prompt', consent: 'interactive' },
        'fixture-unbound',
      ),
    ).rejects.toMatchObject({ code: 'PAYMENT_IDENTITY_UNBOUND' });
    expect(repository.findByKey('fixture-unbound')).toMatchObject({
      state: 'terminal',
      errorCode: 'PAYMENT_IDENTITY_UNBOUND',
      approvalSource: null,
    });
    expect(sends).toEqual([]);
    expect(state.generate).not.toHaveBeenCalled();
  });

  it('replays a finished key after input GC and Provider deletion while rejecting changed request input', async () => {
    const referencePath = join(directory, 'previews', 'uploads', 'fixture-replay-reference.png');
    writeFileSync(referencePath, png);
    const first = hostFixture();
    const body = { prompt: 'fixture prompt', referenceImagePaths: [referencePath] };
    const job = await invoke(first.gate, 'POST /v1/generations', body, 'fixture-gc-key');
    await vi.waitFor(async () =>
      expect(
        (await invoke(first.gate, 'GET /v1/generations/:jobId', {}, undefined, job.jobId)).status,
      ).toBe('success'),
    );
    rmSync(referencePath);
    state.db?.prepare('DELETE FROM providers').run();
    state.epoch = 'fixture-deleted-credential';
    const second = hostFixture();
    expect(await invoke(second.gate, 'POST /v1/generations', body, 'fixture-gc-key')).toMatchObject(
      {
        jobId: job.jobId,
        status: 'success',
      },
    );
    await expect(
      invoke(second.gate, 'POST /v1/generations', { prompt: 'changed' }, 'fixture-gc-key'),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(sends).toHaveLength(1);
    expect(state.generate).toHaveBeenCalledTimes(1);
  });

  it('records a real HTTP 503 as unknown and never retries or resends that key', async () => {
    failureStatus = 503;
    const first = hostFixture();
    const body = { prompt: 'fixture failed prompt' };
    const job = await invoke(first.gate, 'POST /v1/generations', body, 'fixture-failure');
    await vi.waitFor(async () =>
      expect(
        (await invoke(first.gate, 'GET /v1/generations/:jobId', {}, undefined, job.jobId)).status,
      ).toBe('failed'),
    );
    const request = first.repository.findByKey('fixture-failure');
    expect(first.repository.calls(request?.id ?? '')[0]).toMatchObject({
      state: 'unknown',
      reportedPoints: null,
    });
    const nextGate = hostFixture().gate;
    await invoke(nextGate, 'POST /v1/generations', body, 'fixture-failure');
    expect(sends).toHaveLength(1);
    expect(state.generate).toHaveBeenCalledTimes(1);
    const restored = first.durable.persistence.result(
      required(first.repository.findByKey('fixture-failure')),
    );
    expect(restored?.error?.code).toBe('SPEND_RECONCILIATION_REQUIRED');
  });

  it('preserves cost evidence for late cancellation in the live gate and after reopening', async () => {
    state.points = 3;
    state.generate.mockImplementation((...args: Parameters<typeof generate>) => {
      const execution = args[2]?.execution;
      if (!execution) throw new Error('Missing durable execution');
      const onCost = execution.onCost;
      execution.onCost = (evidence) => {
        onCost(evidence);
        cancelGeneration(args[0].jobId ?? '', required(state.db));
      };
      return generate(...args);
    });
    const first = hostFixture();
    const body = { prompt: 'late cancellation fixture' };
    const job = await invoke(first.gate, 'POST /v1/generations', body, 'fixture-late-cancel');
    await vi.waitFor(async () =>
      expect(
        await invoke(first.gate, 'GET /v1/generations/:jobId', {}, undefined, job.jobId),
      ).toMatchObject({ status: 'cancelled', costPoints: 3 }),
    );
    state.db?.close();
    state.db = new Database(databasePath);
    const second = hostFixture();
    expect(
      await invoke(second.gate, 'POST /v1/generations', body, 'fixture-late-cancel'),
    ).toMatchObject({ status: 'cancelled', costPoints: 3 });
    expect(sends).toHaveLength(1);
  });

  it('recovers a canonical success committed before the spend gate terminal audit', async () => {
    state.points = 3;
    const first = hostFixture();
    const body = { prompt: 'fixture prompt' };
    const request = required(
      first.durable.persistence.register(
        body,
        first.host.estimate(body),
        [],
        'fixture-commit-window',
        Date.now(),
      ),
    );
    first.durable.persistence.begin(request.id);
    expect(
      (await first.durable.run(generationRequest(request.executionId), () => {}, request)).status,
    ).toBe('success');
    expect(first.repository.get(request.id)?.state).toBe('running');
    state.db?.close();
    state.db = new Database(databasePath);
    const second = hostFixture();
    expect(
      await invoke(second.gate, 'POST /v1/generations', body, 'fixture-commit-window'),
    ).toMatchObject({ status: 'success', costPoints: 3 });
    expect(sends).toHaveLength(1);
    expect(state.db.prepare('SELECT COUNT(*) AS n FROM automation_audit').get()).toEqual({ n: 1 });
  });

  it('refuses a changed key before core execution and refuses altered reference bytes at the HTTP boundary', async () => {
    const { host, durable, repository } = hostFixture();
    const body = { prompt: 'fixture prompt' };
    const registered = durable.persistence.register(
      body,
      host.estimate(body),
      [],
      'fixture-key-change',
      Date.now(),
    );
    if (!registered) throw new Error('Missing durable request');
    state.epoch = 'fixture-key-replaced';
    expect(() =>
      durable.run(generationRequest(registered.executionId), () => {}, registered),
    ).toThrow(/连接或凭据已变化/);
    expect(repository.calls(registered.id)).toEqual([]);
    expect(sends).toHaveLength(0);

    const referencePath = join(directory, 'previews', 'uploads', 'fixture-reference.png');
    writeFileSync(referencePath, png);
    const references = [{ path: referencePath, source: 'upload' as const }];
    const withReference = durable.persistence.register(
      body,
      host.estimate(body),
      references,
      'fixture-image-change',
      Date.now(),
    );
    if (!withReference) throw new Error('Missing reference request');
    durable.persistence.begin(withReference.id);
    writeFileSync(referencePath, Buffer.concat([png, Buffer.from('fixture changed bytes')]));
    const result = await durable.run(
      generationRequest(withReference.executionId, references),
      () => {},
      withReference,
    );
    durable.persistence.finish(withReference.id, result, Date.now());
    expect(result.status).toBe('failed');
    expect(repository.calls(withReference.id)).toEqual([]);
    expect(sends).toHaveLength(0);
  });
});

it('does not finish a managed cloud request from a local failure during startup compensation', async () => {
  const db = required(state.db);
  const repository = new AutomationSpendRepository(db);
  repository.initializeBudget({ monthlyLimitPoints: 20, usedPoints: 0, month: '2026-09' }, 1);
  let anchor: ManagedExecutionAnchor | null = null;
  const guard = new ManagedExecutionGuard(new ManagedExecutionRepository(db), {
    scope: databasePath,
    read: async () => structuredClone(anchor),
    write: async (value) => {
      anchor = structuredClone(value);
    },
  });
  await guard.enable();
  const ledger = new ManagedGenerationLedger(db, guard, () => {});
  const command = managedCommand();
  const { record } = await ledger.register(command);
  await ledger.claimSubmission(
    record.requestId,
    managedContext(command),
    command.binding,
    command.executionId,
    command.now,
  );
  const failed = await generate(
    {
      providerId: 'fixture-provider',
      jobId: command.executionId,
      prompt: 'synthetic cloud interruption',
      n: 1,
      size: 'auto',
      quality: 'auto',
    },
    undefined,
    {
      db,
      transport: {
        providerId: 'fixture-provider',
        assertCurrent() {},
        generate: async () => ({
          historyId: command.executionId,
          status: 'failed',
          error: { code: 'MANAGED_SUBMISSION_UNCERTAIN', message: '请核对原任务' },
        }),
      },
    },
  );
  expect(failed.status).toBe('failed');
  const before = repository.get(record.requestId);
  expect(() => createDesktopGenerationPersistence(() => false)).not.toThrow();
  expect(repository.get(record.requestId)).toEqual(before);
  expect(repository.get(record.requestId)).toMatchObject({
    state: 'running',
    reservationState: 'unknown',
  });
  expect(sends).toHaveLength(0);
});

it('retains a native uploaded image registered by the actual Desktop adapter before the first Provider call', async () => {
  const { createLocalUploadOwner } = await import('@musefold/core/services/local-upload-owner');
  const { stageLocalImageBytes } = await import('@musefold/core/providers/local-image');
  const { existsSync, readFileSync } = await import('node:fs');
  const owner = createLocalUploadOwner({ db: required(state.db) });
  try {
    const image = await stageLocalImageBytes({ bytes: png, name: 'owned-reference.png' }, owner);
    const { durable, host } = hostFixture();
    const body = { prompt: 'Owned persisted reference', referenceImagePaths: [image.path] };
    const request = required(
      durable.persistence.register(
        body,
        host.estimate(body),
        [image],
        'owned-before-run',
        Date.now(),
      ),
    );
    expect(request.state).toBe('authorized');
    expect(request.frozenInput.references).toEqual([image]);
    expect(request.frozenInput.referenceHashes).toEqual([
      (await import('node:crypto')).createHash('sha256').update(png).digest('hex'),
    ]);
    expect(required(state.db).prepare('SELECT COUNT(*) AS n FROM generation_runs').get()).toEqual({
      n: 0,
    });
    owner.close();
    expect(existsSync(image.path)).toBe(true);
    expect(readFileSync(image.path)).toEqual(png);
    const result = await durable.run(
      generationRequest(request.executionId, [image]),
      () => {},
      request,
    );
    expect(result.status).toBe('success');
    expect(sends).toHaveLength(1);
    expect(state.generate).toHaveBeenCalledTimes(1);
    expect(readFileSync(image.path)).toEqual(png);
  } finally {
    owner.close();
  }
});

it.each(['replacement', 'same-inode', 'ancestor'] as const)(
  'rejects an actual %s replacement between reference selection and hash opening',
  async (change) => {
    const { referenceHash } = await import('../automation-spend');
    const { renameSync, mkdirSync, symlinkSync } = await import('node:fs');
    const parent = join(directory, 'previews', 'hash-source');
    mkdirSync(parent);
    const path = join(parent, 'original.png');
    writeFileSync(path, png);
    const other = join(directory, 'other.png');
    writeFileSync(other, Buffer.concat([png, Buffer.from('changed')]));
    expect(() =>
      referenceHash({ path, source: 'upload' }, () => {
        if (change === 'replacement') renameSync(other, path);
        if (change === 'same-inode')
          writeFileSync(path, Buffer.concat([png, Buffer.from('changed')]));
        if (change === 'ancestor') {
          const target = join(directory, 'other-parent');
          mkdirSync(target);
          writeFileSync(join(target, 'original.png'), Buffer.concat([png, Buffer.from('changed')]));
          renameSync(parent, `${parent}-selected`);
          symlinkSync(target, parent, 'dir');
        }
        return true;
      }),
    ).toThrowError(expect.objectContaining({ code: 'IMAGE_READ_FAILED' }));
  },
);

it.skipIf(process.platform === 'win32')(
  'rejects an actual reference FIFO without waiting for a writer',
  async () => {
    const { referenceHash } = await import('../automation-spend');
    const { execFileSync } = await import('node:child_process');
    const path = join(directory, 'previews', 'uploads', 'owned.fifo');
    execFileSync('mkfifo', [path]);
    if (process.env.OWNED_FIFO_RECEIPT)
      writeFileSync(process.env.OWNED_FIFO_RECEIPT, JSON.stringify({ directory, path }));
    expect(() => referenceHash({ path, source: 'upload' }, () => true)).toThrow();
  },
);

it('bounds actual bytes read after the selected file grows beyond 20 MiB', async () => {
  const { referenceHash } = await import('../automation-spend');
  const path = join(directory, 'previews', 'uploads', 'growing.png');
  writeFileSync(path, png);
  hashIo.readBytes = 0;
  hashIo.afterStat = () => {
    const grown = Buffer.alloc(20 * 1024 * 1024 + 1);
    png.copy(grown);
    writeFileSync(path, grown);
  };
  expect(() => referenceHash({ path, source: 'upload' }, () => true)).toThrow();
  expect(hashIo.readBytes).toBeLessThanOrEqual(png.length + 1);
});

it('rejects an actual same-inode write after the descriptor read', async () => {
  const { referenceHash } = await import('../automation-spend');
  const path = join(directory, 'previews', 'uploads', 'changed-after-read.png');
  writeFileSync(path, png);
  hashIo.afterRead = () => writeFileSync(path, Buffer.concat([png, Buffer.from('changed')]));
  expect(() => referenceHash({ path, source: 'upload' }, () => true)).toThrowError(
    expect.objectContaining({ code: 'IMAGE_READ_FAILED' }),
  );
});

it('hashes exactly 20 MiB through a stable directory alias and preserves authorization denial', async () => {
  const { referenceHash } = await import('../automation-spend');
  const { symlinkSync } = await import('node:fs');
  const { createHash } = await import('node:crypto');
  const bytes = Buffer.alloc(20 * 1024 * 1024);
  png.copy(bytes);
  const path = join(directory, 'previews', 'uploads', 'limit.png');
  writeFileSync(path, bytes);
  const alias = join(directory, 'reference-alias');
  symlinkSync(join(directory, 'previews', 'uploads'), alias, 'junction');
  expect(referenceHash({ path: join(alias, 'limit.png'), source: 'upload' }, () => true)).toBe(
    createHash('sha256').update(bytes).digest('hex'),
  );
  hashIo.readBytes = 0;
  expect(() => referenceHash({ path, source: 'upload' }, () => false)).toThrowError(
    expect.objectContaining({ code: 'PATH_NOT_ALLOWED' }),
  );
  expect(hashIo.readBytes).toBe(0);
});
