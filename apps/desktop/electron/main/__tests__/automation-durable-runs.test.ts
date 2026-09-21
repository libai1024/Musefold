import { createServer, type Server } from 'node:http';
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { takeoverDesktopDatabase } from '@musefold/desktop-db';
import { configureCoreRuntime } from '@musefold/core/runtime';
import { loadManagedFilesystem } from '@musefold/managed-fs';
import { resolve } from 'node:path';
import { generate, cancelGeneration } from '@musefold/core/services/generation';
import { createSchemeService } from '@musefold/core/services/schemes';
import { AutomationSpendRepository } from '@musefold/core/db/repositories/automation-spend';
import { runDesignSchemeDbMigrations } from '@musefold/core/db/design-scheme/migrations';
import { DesignSchemeRepository } from '@musefold/core/db/design-scheme/repositories';
import {
  DESIGN_SCHEME_DOCUMENT_VERSION,
  type DesignSchemeRevisionDocument,
} from '@musefold/desktop-contracts/design-scheme/schema';
import type { AiConnectionProfile } from '@musefold/desktop-contracts/ai';
import type { AutomationRouteContext, AutomationRouteHandler } from '@musefold/automation-server';

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Missing fixture value');
  return value;
}

const state = vi.hoisted(() => ({
  db: null as Database.Database | null,
  schemes: null as Database.Database | null,
  profile: null as AiConnectionProfile | null,
  epoch: 'fixture-image-epoch',
  textEpoch: 'fixture-text-epoch',
  directory: '',
  logs: [] as unknown[][],
}));
vi.mock('@musefold/core/db/index', () => ({ getDb: () => state.db }));
vi.mock('@musefold/core/db/design-scheme', () => ({ getDesignSchemeDb: () => state.schemes }));
vi.mock('../../security/keychain', () => ({
  loadApiKeySnapshot: () => ({ key: 'fixture-image-canary', epoch: state.epoch }),
}));
vi.mock('../../ai/connection-store', () => ({
  getAiConnectionStore: () => ({
    list: () => (state.profile ? [state.profile] : []),
    get: (id: string) => (state.profile?.id === id ? state.profile : null),
    loadKey: () => {
      throw new Error('Durable text execution must use its frozen snapshot');
    },
    loadKeySnapshot: () => ({ key: 'fixture-text-canary', epoch: state.textEpoch }),
  }),
}));
vi.mock('../../settings/pricing', () => ({ estimateProviderCost: () => 0.5 }));
vi.mock('../../settings/automation', () => ({
  getAutomationSpendRepository: () => {
    const repository = new AutomationSpendRepository(required(state.db));
    repository.initializeBudget(
      { monthlyLimitPoints: 20, usedPoints: 0, month: new Date().toISOString().slice(0, 7) },
      Date.now(),
    );
    return repository;
  },
}));
vi.mock('../core-instance', () => ({
  getMusefoldCore: () => ({
    generation: { generate, cancel: (id: string) => cancelGeneration(id, required(state.db)) },
    schemes: createSchemeService(() => required(state.schemes)),
  }),
}));
vi.mock('../pet', () => ({ trackPetGeneration: (run: () => unknown) => run() }));
vi.mock('../../system/paths', () => ({
  getPaths: () => ({ userData: state.directory, pictures: join(state.directory, 'pictures') }),
}));
vi.mock('../../system/logger', () => ({
  createLogger: () => ({
    info: (...args: unknown[]) => state.logs.push(args),
    warn: (...args: unknown[]) => state.logs.push(args),
    error: (...args: unknown[]) => state.logs.push(args),
    debug: () => {},
  }),
}));
vi.mock('../skill-import/github-reader', () => ({
  readPublicGithubAgentSkillRuntimeSource: async () => ({
    ok: true,
    data: {
      scan: { name: 'Fixture skill', description: 'Fixture visual rules', files: [] },
      resolvedRef: 'fixture-ref',
      commitHash: 'f'.repeat(40),
      runtimeFiles: [
        {
          relativePath: 'SKILL.md',
          contentHash: 'fixture-declared-hash',
          bytes: Buffer.from('Use warm colors and clear shapes.'),
        },
      ],
    },
  }),
}));

import { wrapDurableExternalRunRoutes } from '../automation-durable-runs';
import {
  createDesktopExternalSpend,
  captureAutomationTextConnection,
} from '../automation-run-spend';
import { createDesktopGenerationPersistence } from '../automation-spend';
import {
  prepareGithubSkillRuntime,
  executeSkillRuntime,
  cancelSkillRuntimeExecution,
  skillRuntimeSourceDigest,
} from '../ipc/skill-runtime';

let server: Server;
let baseUrl: string;
let databasePath: string;
let sends: Array<{ path: string; body: string; auth?: string }>;
let textStatus: number;
let imageStatus: number;
let redirectHits: number;
let onSend: ((path: string) => void) | undefined;
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGQAAAABJRU5ErkJggg==',
  'base64',
);
const document: DesignSchemeRevisionDocument = {
  schemaVersion: DESIGN_SCHEME_DOCUMENT_VERSION,
  revisionId: 'dsrv_fixture',
  schemeId: 'dsch_fixture',
  name: 'Fixture scheme',
  summary: 'Local fixture',
  fidelity: 'adapted',
  sources: [{ id: 'src_fixture', kind: 'user-brief', role: 'context' }],
  inputs: [{ id: 'topic', label: 'Topic', kind: 'text', required: true }],
  parameters: [],
  constraints: [],
  promptProgram: [
    {
      id: 'pm_fixture',
      order: 0,
      kind: 'input-template',
      template: 'Draw {{topic}} with warm colors',
      variables: ['topic'],
      sourceIds: ['src_fixture'],
    },
  ],
  compilation: {
    compiledAt: 1,
    model: { model: 'fixture', connectionName: 'Fixture' },
    adopted: [],
    omitted: [],
    warnings: [],
    trace: [],
  },
};

beforeEach(async () => {
  state.directory = mkdtempSync(join(tmpdir(), 'musefold-durable-runs-'));
  databasePath = join(state.directory, 'local.db');
  state.db = new Database(databasePath);
  state.db.pragma('foreign_keys = ON');
  takeoverDesktopDatabase(state.db);
  state.schemes = new Database(':memory:');
  runDesignSchemeDbMigrations(state.schemes);
  new DesignSchemeRepository(state.schemes).insertSchemeDraft({
    document,
    sourceLabel: 'Fixture',
    sourcePresentation: 'musefold-created',
    createdBy: 'agent',
    bindings: [],
  });
  state.schemes.prepare("UPDATE design_schemes SET status = 'formal'").run();
  state.epoch = 'fixture-image-epoch';
  state.textEpoch = 'fixture-text-epoch';
  state.logs = [];
  sends = [];
  textStatus = 200;
  imageStatus = 200;
  redirectHits = 0;
  onSend = undefined;
  server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += String(chunk);
    });
    request.on('end', () => {
      const path = request.url ?? '';
      sends.push({ path, body, auth: request.headers.authorization });
      onSend?.(path);
      if (path === '/redirect-target') {
        redirectHits++;
        response.end('{}');
        return;
      }
      if (path.endsWith('/chat/completions')) {
        if (textStatus !== 200) {
          response.writeHead(textStatus, {
            'content-type': 'application/json',
            location: '/redirect-target',
          });
          response.end(JSON.stringify({ error: { message: 'Fixture text failure' } }));
          return;
        }
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        const chunk = {
          id: 'fixture-completion',
          created: 1,
          model: 'fixture-text',
          object: 'chat.completion.chunk',
        };
        response.end(
          `data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: { role: 'assistant', content: 'Draw a warm geometric landscape.' }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
        );
        return;
      }
      response.writeHead(imageStatus, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify(
          imageStatus === 200
            ? { data: [{ b64_json: png.toString('base64') }] }
            : { error: { message: 'Fixture image failure' } },
        ),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture port');
  baseUrl = `http://127.0.0.1:${address.port}/v1`;
  state.db
    .prepare(
      `INSERT INTO providers(id,name,type,base_url,model,has_key,is_active,created_at,updated_at) VALUES ('fixture-provider','Fixture','openai-compatible',?,'fixture-image',1,1,1,1)`,
    )
    .run(baseUrl);
  state.profile = {
    id: 'fixture-text',
    name: 'Fixture text',
    routeKind: 'gateway',
    protocol: 'openai-compatible',
    presetId: 'custom',
    baseUrl,
    model: 'fixture-text',
    hasKey: true,
    keySuffix: 'nary',
    isActive: true,
    managedBy: null,
    createdAt: 1,
    updatedAt: 1,
    capabilities: {
      modelDiscovery: 'manual',
      supportedStructuredOutputModes: [],
      preferredStructuredOutputMode: 'json-text',
      cancellation: true,
      streaming: false,
      lastValidatedAt: null,
    },
  };
  mkdirSync(join(state.directory, 'previews', 'uploads'), { recursive: true });
  configureCoreRuntime({
    managedFilesystem: () =>
      loadManagedFilesystem(resolve('packages/managed-fs/build/Release/managed_fs.node')),
    getPaths: () => ({
      userData: state.directory,
      db: databasePath,
      backups: join(state.directory, 'backups'),
      previews: join(state.directory, 'previews'),
      pictures: join(state.directory, 'pictures'),
      logs: join(state.directory, 'logs'),
    }),
    loadApiKey: () => 'fixture-image-canary',
    estimateProviderCost: () => 0.5,
    createLogger: () => ({
      debug: () => {},
      info: (...args) => state.logs.push(args),
      warn: (...args) => state.logs.push(args),
      error: (...args) => state.logs.push(args),
    }),
  });
});
afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  state.db?.close();
  state.schemes?.close();
  state.db = null;
  state.schemes = null;
  rmSync(state.directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});
const allowed = (path: string) =>
  realpathSync(path).startsWith(realpathSync(state.directory) + sep);
function routes() {
  createDesktopGenerationPersistence(allowed); // Production startup recovery order.
  return wrapDurableExternalRunRoutes(
    {},
    { sink: { emit: () => {} } },
    async () => {
      throw new Error('BYOK must not use managed confirmation');
    },
    allowed,
  );
}
async function invoke(
  handlers: Record<string, AutomationRouteHandler>,
  method: string,
  body: unknown = {},
  key?: string,
  id = 'dsch_fixture',
) {
  let result: unknown;
  const returned = await handlers[method]({
    body,
    params: { id },
    request: { headers: key ? { 'idempotency-key': key } : {} },
    json: (value: unknown) => {
      result = value;
    },
  } as unknown as AutomationRouteContext);
  return (result ?? returned) as {
    jobId: string;
    status: string;
    costPoints: number | null;
    assets: unknown[];
    error?: { code: string };
  };
}
async function completed(
  handlers: Record<string, AutomationRouteHandler>,
  kind: 'scheme' | 'skill',
  id: string,
) {
  let result: Awaited<ReturnType<typeof invoke>> | undefined;
  await vi.waitFor(async () => {
    result = await invoke(handlers, `GET /v1/${kind}-runs/:id`, {}, undefined, id);
    expect(result.status).not.toBe('running');
  });
  return required(result);
}

describe('durable local scheme/Skill production paths with real SQLite and loopback Providers', () => {
  it('compiles the frozen formal scheme, sends each image once and restores its results', async () => {
    const handler = routes();
    const body = { n: 2, inputs: { topic: 'fixture flowers' } };
    const jobs = await Promise.all([
      invoke(handler, 'POST /v1/schemes/:id/runs', body, 'fixture-scheme'),
      invoke(handler, 'POST /v1/schemes/:id/runs', body, 'fixture-scheme'),
    ]);
    expect(jobs[0].jobId).toBe(jobs[1].jobId);
    expect(await completed(handler, 'scheme', jobs[0].jobId)).toMatchObject({
      status: 'success',
      costPoints: 1,
    });
    expect(sends).toHaveLength(2);
    expect(
      sends.every((send) =>
        JSON.parse(send.body).prompt.includes('Draw fixture flowers with warm colors'),
      ),
    ).toBe(true);
    state.db?.close();
    state.db = new Database(databasePath);
    const restored = await invoke(routes(), 'POST /v1/schemes/:id/runs', body, 'fixture-scheme');
    expect(restored).toMatchObject({ status: 'success', costPoints: 1 });
    expect(restored.assets).toHaveLength(2);
    expect(sends).toHaveLength(2);
  });

  it('runs the real Skill text stream then image loop with separate frozen calls and unknown text cost', async () => {
    const handler = routes();
    const job = await invoke(
      handler,
      'POST /v1/skills/github/run',
      { url: 'https://github.com/fixture/visual', prompt: 'Fixture landscape', n: 2 },
      'fixture-skill',
    );
    expect(await completed(handler, 'skill', job.jobId)).toMatchObject({
      status: 'success',
      costPoints: null,
    });
    expect(sends.map((send) => send.path)).toEqual([
      '/v1/chat/completions',
      '/v1/images/generations',
      '/v1/images/generations',
    ]);
    const repository = new AutomationSpendRepository(required(state.db));
    expect(
      repository
        .calls(required(repository.findByKey('fixture-skill')).id)
        .map((call) => [call.kind, call.costSource]),
    ).toEqual([
      ['image', 'local_price_estimate'],
      ['image', 'local_price_estimate'],
      ['text', 'unknown'],
    ]);
    expect(repository.budget(Date.now()).usedPoints).toBe(0);
    for (const table of [
      'automation_spend_requests',
      'automation_spend_calls',
      'automation_audit',
    ]) {
      const text = JSON.stringify(required(state.db).prepare(`SELECT * FROM ${table}`).all());
      expect(text).not.toContain('fixture-text-canary');
      expect(text).not.toContain('fixture-image-canary');
    }
    expect(JSON.stringify(state.logs)).not.toContain('fixture-text-canary');
  });

  it('rejects a scheme revision changed between registration and compilation before an image send', async () => {
    const original = DesignSchemeRepository.prototype.getRevisionDocument;
    vi.spyOn(DesignSchemeRepository.prototype, 'getRevisionDocument').mockImplementation(function (
      this: DesignSchemeRepository,
      ...args
    ) {
      const current = original.call(this, ...args);
      const registered = required(state.db)
        .prepare(
          "SELECT id FROM automation_spend_requests WHERE idempotency_key='fixture-revision-change'",
        )
        .get();
      return current && registered
        ? { ...current, name: 'Fixture altered after registration' }
        : current;
    });
    const handler = routes();
    const job = await invoke(
      handler,
      'POST /v1/schemes/:id/runs',
      { inputs: { topic: 'fixture' } },
      'fixture-revision-change',
    );
    expect(await completed(handler, 'scheme', job.jobId)).toMatchObject({ status: 'failed' });
    expect(sends).toEqual([]);
    expect(
      required(state.db).prepare('SELECT COUNT(*) AS n FROM automation_spend_calls').get(),
    ).toEqual({ n: 0 });
  });

  it('blocks the frozen image identity if credentials change while the Skill text call is running', async () => {
    onSend = (path) => {
      if (path.endsWith('/chat/completions')) state.epoch = 'fixture-image-replaced';
    };
    const handler = routes();
    const job = await invoke(
      handler,
      'POST /v1/skills/github/run',
      { url: 'https://github.com/fixture/visual', prompt: 'Fixture landscape', n: 2 },
      'fixture-image-epoch',
    );
    expect(await completed(handler, 'skill', job.jobId)).toMatchObject({
      status: 'failed',
      costPoints: null,
    });
    expect(sends.map((send) => send.path)).toEqual(['/v1/chat/completions']);
    const repository = new AutomationSpendRepository(required(state.db));
    expect(repository.calls(required(repository.findByKey('fixture-image-epoch')).id)).toHaveLength(
      1,
    );
  });

  it('cancels the real scheme loop after its first send and retains that call evidence without dispatching the second image', async () => {
    const handler = routes();
    onSend = (path) => {
      if (!path.endsWith('/images/generations')) return;
      const request = new AutomationSpendRepository(required(state.db)).findByKey(
        'fixture-cancel-scheme',
      );
      if (!request) throw new Error('Missing registered cancellation fixture');
      void invoke(handler, 'DELETE /v1/scheme-runs/:id', {}, undefined, request.executionId);
    };
    const job = await invoke(
      handler,
      'POST /v1/schemes/:id/runs',
      { n: 2, inputs: { topic: 'fixture' } },
      'fixture-cancel-scheme',
    );
    expect(await completed(handler, 'scheme', job.jobId)).toMatchObject({ status: 'cancelled' });
    expect(sends).toHaveLength(1);
    const repository = new AutomationSpendRepository(required(state.db));
    expect(
      repository.calls(required(repository.findByKey('fixture-cancel-scheme')).id),
    ).toHaveLength(1);
  });

  it.each(['image', 'text'] as const)(
    'blocks an unbound managed %s owner before any Provider sends',
    async (kind) => {
      if (kind === 'image')
        required(state.db).prepare("UPDATE providers SET managed_by='account'").run();
      else required(state.profile).managedBy = 'account';
      await expect(
        invoke(
          routes(),
          'POST /v1/skills/github/run',
          {
            url: 'https://github.com/fixture/visual',
            prompt: 'Fixture landscape',
            consent: 'interactive',
          },
          `fixture-unbound-${kind}`,
        ),
      ).rejects.toMatchObject({ code: 'PAYMENT_IDENTITY_UNBOUND' });
      expect(sends).toEqual([]);
      expect(
        required(state.db).prepare('SELECT COUNT(*) AS n FROM automation_audit').get(),
      ).toEqual({
        n: 1,
      });
    },
  );

  it.each([503, 307])(
    'does not retry or follow redirects after a text HTTP %s; bounded image fallback remains in the same request',
    async (status) => {
      textStatus = status;
      const handler = routes();
      const body = { url: 'https://github.com/fixture/visual', prompt: 'Fixture landscape' };
      const job = await invoke(handler, 'POST /v1/skills/github/run', body, 'fixture-text-failure');
      expect(await completed(handler, 'skill', job.jobId)).toMatchObject({
        status: 'success',
        costPoints: null,
      });
      expect(sends.filter((send) => send.path.endsWith('/chat/completions'))).toHaveLength(1);
      expect(sends.filter((send) => send.path.endsWith('/images/generations'))).toHaveLength(1);
      expect(redirectHits).toBe(0);
      await invoke(routes(), 'POST /v1/skills/github/run', body, 'fixture-text-failure');
      expect(sends).toHaveLength(2);
    },
  );

  it('rejects a changed text epoch and caps actual text dispatches before the next HTTP request', async () => {
    routes();
    const spend = createDesktopExternalSpend(allowed);
    const binding = required(captureAutomationTextConnection()).binding;
    const request = spend.register({
      idempotencyKey: 'fixture-text-bound',
      action: 'run_github_skill',
      caller: 'fixture',
      input: {},
      frozenInput: {},
      bindings: [binding],
      promptText: 'fixture',
      executionId: 'fixture-text-bound',
      maxImageCalls: 0,
      maxTextCalls: 1,
      estimatedPoints: null,
      now: Date.now(),
    });
    spend.repository.beginExecution(request.id);
    const executor = spend.textExecutor(request, binding);
    const options = {
      method: 'POST',
      headers: { authorization: 'Bearer fixture-text-canary', 'content-type': 'application/json' },
      body: JSON.stringify({ model: binding.model, max_tokens: 4000, messages: [] }),
    };
    await executor.fetch(`${baseUrl}/chat/completions`, options);
    await expect(executor.fetch(`${baseUrl}/chat/completions`, options)).rejects.toThrow(
      /limit|cap|exceed/i,
    );
    expect(sends).toHaveLength(1);
    state.textEpoch = 'fixture-text-replaced';
    await expect(executor.fetch(`${baseUrl}/chat/completions`, options)).rejects.toMatchObject({
      code: 'SPEND_IDENTITY_CHANGED',
    });
    expect(sends).toHaveLength(1);
  });

  it('passes cancellation from a synchronous Skill generation-start callback to core before any claim or HTTP send', async () => {
    routes();
    const prepared = await prepareGithubSkillRuntime({
      repositoryUrl: 'https://github.com/fixture/visual',
    });
    if (!prepared.ok) throw new Error('Fixture Skill preparation failed');
    const spend = createDesktopExternalSpend(allowed);
    const jobIds = ['fixture-sync-cancel-image'];
    const request = spend.register({
      idempotencyKey: 'fixture-sync-cancel',
      action: 'run_github_skill',
      caller: 'fixture',
      input: {},
      frozenInput: {},
      bindings: [spend.binding('fixture-provider').binding],
      promptText: 'fixture',
      executionId: 'fixture-sync-cancel',
      maxImageCalls: 1,
      maxTextCalls: 0,
      estimatedPoints: 0.5,
      now: Date.now(),
    });
    spend.repository.beginExecution(request.id);
    const images = spend.imageExecutor(request, jobIds);
    const result = await executeSkillRuntime(
      {
        runtimeId: prepared.data.runtimeId,
        executionId: request.executionId,
        userPrompt: 'Fixture prompt',
        userImages: [],
        availableImageSlots: 0,
        generation: {
          requestTemplate: {
            jobId: jobIds[0],
            providerId: 'fixture-provider',
            model: 'fixture-image',
            prompt: '',
            n: 1,
            size: '1024x1024',
            quality: 'auto',
          },
          jobIds,
          providerName: 'Fixture',
          ratioId: 'auto',
        },
      },
      {
        execution: {
          sourceDigest: skillRuntimeSourceDigest(prepared.data.runtimeId),
          text: null,
          generate: images.generate,
          onReferences: images.onReferences,
        },
        sendProgress: () => {},
        emit(event) {
          if (event.kind === 'generation-start') cancelSkillRuntimeExecution(request.executionId);
        },
      },
    );
    expect(result.ok && result.data.generations[0].result.status).toBe('cancelled');
    expect(spend.repository.calls(request.id)).toEqual([]);
    expect(sends).toEqual([]);
    spend.repository.finishRequest(request.id, 'cancelled', Date.now());
  });

  it.each(['before-fetch', 'during-body-read'] as const)(
    'does not claim a text request aborted %s',
    async (when) => {
      routes();
      const spend = createDesktopExternalSpend(allowed);
      const binding = required(captureAutomationTextConnection()).binding;
      const request = spend.register({
        idempotencyKey: 'fixture-text-abort',
        action: 'run_github_skill',
        caller: 'fixture',
        input: {},
        frozenInput: {},
        bindings: [binding],
        promptText: 'fixture',
        executionId: 'fixture-text-abort',
        maxImageCalls: 0,
        maxTextCalls: 1,
        estimatedPoints: null,
        now: Date.now(),
      });
      spend.repository.beginExecution(request.id);
      const executor = spend.textExecutor(request, binding);
      const controller = new AbortController();
      const body = JSON.stringify({ model: binding.model, max_tokens: 4000, messages: [] });
      const options = {
        method: 'POST',
        headers: {
          authorization: 'Bearer fixture-text-canary',
          'content-type': 'application/json',
        },
        signal: controller.signal,
      };
      if (when === 'before-fetch') {
        controller.abort();
        await expect(
          executor.fetch(`${baseUrl}/chat/completions`, { ...options, body }),
        ).rejects.toMatchObject({ name: 'AbortError' });
      } else {
        let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined;
        let readStarted: (() => void) | undefined;
        const started = new Promise<void>((resolve) => {
          readStarted = resolve;
        });
        const stream = new ReadableStream<Uint8Array>({
          start(value) {
            bodyController = value;
          },
          pull() {
            readStarted?.();
          },
        });
        const outgoing = new Request(`${baseUrl}/chat/completions`, {
          ...options,
          body: stream,
          duplex: 'half',
        } as RequestInit);
        const rejected = expect(executor.fetch(outgoing)).rejects.toMatchObject({
          name: 'AbortError',
        });
        await started;
        controller.abort();
        required(bodyController).enqueue(new TextEncoder().encode(body));
        required(bodyController).close();
        await rejected;
      }
      expect(spend.repository.calls(request.id)).toEqual([]);
      expect(sends).toEqual([]);
      spend.repository.finishRequest(request.id, 'cancelled', Date.now());
    },
  );
});
