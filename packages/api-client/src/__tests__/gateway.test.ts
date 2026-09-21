import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCloudDataGateway } from '../gateway';
import { ApiRequestError } from '../http';

function fetchStub(handler: (url: URL, init: RequestInit | undefined) => Response) {
  const calls: Array<{ url: URL; init: RequestInit | undefined }> = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof globalThis.fetch;
  return { impl, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function requestHeaders(call: { init: RequestInit | undefined }): Record<string, string> {
  return (call.init?.headers ?? {}) as Record<string, string>;
}

function jsonBody(call: { init: RequestInit | undefined }): unknown {
  return JSON.parse(String(call.init?.body));
}

const ACCOUNT = {
  id: 'u1',
  username: 'tester',
  displayName: 'Test User',
  quota: 100,
  quotaUnit: 'points',
  canGenerate: true,
};

const TAG = {
  id: 'tag1',
  name: 'Style',
  group: 'Visual',
  color: '#112233',
  version: 1,
  createdAt: '2026-08-29T00:00:00.000Z',
  updatedAt: '2026-08-29T00:00:00.000Z',
  deletedAt: null,
};

const FOLDER = {
  id: 'folder1',
  name: 'Inspiration',
  parentId: null,
  sortOrder: 1,
  version: 1,
  createdAt: '2026-08-29T00:00:00.000Z',
  updatedAt: '2026-08-29T00:00:00.000Z',
  deletedAt: null,
};

const PROMPT = {
  id: 'prompt1',
  title: 'Mountain Cabin',
  description: 'A description',
  content: 'cinematic mountain cabin',
  negative: 'blurry',
  folderId: 'folder1',
  tags: [TAG],
  modelId: 'model-1',
  params: { steps: 20 },
  rating: 4,
  isPinned: true,
  pinOrder: 1,
  usageCount: 2,
  lastUsedAt: '2026-08-29T00:00:00.000Z',
  source: 'manual',
  sourceUrl: null,
  version: 1,
  createdAt: '2026-08-29T00:00:00.000Z',
  updatedAt: '2026-08-29T00:00:00.000Z',
  deletedAt: null,
};

const DRAFT = {
  prompt: 'a mountain cabin',
  negative: 'blurry',
  params: { size: '1024x1024' as const, quality: 'auto' as const },
  promptReferenceSelections: [],
  promptReferenceIds: ['prompt1'],
};

const SESSION = {
  id: 'session1',
  title: 'Workbench',
  draft: DRAFT,
  version: 1,
  createdAt: '2026-08-29T00:00:00.000Z',
  updatedAt: '2026-08-29T00:00:00.000Z',
  archivedAt: null,
  deletedAt: null,
  latestJobStatus: null,
  latestJobFinishedAt: null,
};

const GENERATION_INPUT = {
  prompt: 'a mountain cabin',
  negative: 'blurry',
  size: '1024x1024' as const,
  aspectRatio: '1:1',
  quality: 'high' as const,
  count: 1 as const,
  providerId: 'cloud-default',
  referenceImages: [],
  promptReferenceSelections: [
    { promptId: 'prompt1', scope: 'full' as const, expectedVersion: 1 },
    {
      promptId: 'prompt2',
      scope: 'excerpt' as const,
      expectedVersion: 3,
      range: { start: 2, end: 8 },
    },
  ],
  sessionId: 'session1',
  parentRunId: 'run-parent',
  runKind: 'refinement' as const,
};

const JOB = {
  id: 'job1',
  sessionId: 'session1',
  parentRunId: 'run-parent',
  promptId: null,
  userPrompt: 'a mountain cabin',
  promptReferences: [
    {
      promptId: 'prompt2',
      title: 'Lighting fragment',
      text: 'sunset',
      scope: 'excerpt' as const,
      sourceVersion: 3,
    },
  ],
  actorType: 'web' as const,
  approvalStatus: 'not_required' as const,
  status: 'queued' as const,
  progress: 0,
  request: {
    prompt: 'a mountain cabin',
    negative: 'blurry',
    size: '1024x1024' as const,
    aspectRatio: '1:1',
    quality: 'high' as const,
    count: 1 as const,
    providerId: 'cloud-default',
    referenceImages: [],
  },
  providerModel: 'gpt-image-1',
  costPoints: 10,
  assets: [],
  error: null,
  createdAt: '2026-08-29T00:00:00.000Z',
  startedAt: null,
  finishedAt: null,
  deletedAt: null,
};

const PROVIDER = {
  id: 'cloud-default',
  label: 'Musefold Cloud',
  model: 'gpt-image-1',
  kind: 'cloud' as const,
  available: true,
};

const REFERENCE = {
  id: 'reference1',
  url: '/api/v1/reference-images/reference1/url',
  name: 'ref.png',
  mimeType: 'image/png' as const,
  byteSize: 4,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('account gateway HTTP transport', () => {
  it('reads a bounded independent notice feed without sending account credentials or writes', async () => {
    const feed = {
      apiIssuer: 'https://api.example.test',
      issuer: 'https://relay.example.test',
      items: [{ id: 'n-a', content: 'notice', publishedAt: null }],
    };
    const { impl, calls } = fetchStub(() => jsonResponse(feed));
    const gateway = createCloudDataGateway({ baseUrl: 'https://api.example.test', fetch: impl });
    expect(await gateway.account.getNotices?.()).toEqual(feed);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.pathname).toBe('/api/v1/account/notices');
    expect(calls[0]?.init?.method).toBe('GET');
    expect(calls[0]?.init?.body).toBeUndefined();
  });
  it('getStatus uses the account status path and parses the response', async () => {
    const { impl, calls } = fetchStub(() => jsonResponse(ACCOUNT));
    const gateway = createCloudDataGateway({ baseUrl: 'https://api.test/', fetch: impl });

    await expect(gateway.account.getStatus()).resolves.toEqual(ACCOUNT);

    expect(calls[0]?.url.href).toBe('https://api.test/api/v1/account/status');
    expect(calls[0]?.init?.method).toBe('GET');
    expect(calls[0]?.init?.body).toBeUndefined();
    expect(requestHeaders(calls[0]!)).toEqual({});
    expect(calls[0]?.init?.credentials).toBe('include');
  });

  it.each([
    ['login', 'sign-in/new-api'],
    ['register', 'sign-up/new-api'],
  ] as const)('%s posts credentials, then refreshes account status', async (method, path) => {
    const responses = [jsonResponse({ token: 'session-token' }), jsonResponse(ACCOUNT)];
    const { impl, calls } = fetchStub(() => responses.shift()!);
    const gateway = createCloudDataGateway({ baseUrl: 'https://api.test', fetch: impl });

    const result =
      method === 'login'
        ? await gateway.account.login({ username: 'tester@example.com', password: 'secret' })
        : await gateway.account.register({ username: 'tester@example.com', password: 'secret' });

    expect(result).toEqual(ACCOUNT);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url.href).toBe(`https://api.test/api/auth/${path}`);
    expect(calls[0]?.init?.method).toBe('POST');
    expect(jsonBody(calls[0]!)).toEqual({ email: 'tester@example.com', password: 'secret' });
    expect(requestHeaders(calls[0]!)).toEqual({ 'content-type': 'application/json' });
    expect(calls[1]?.url.href).toBe('https://api.test/api/v1/account/status');
    expect(calls[1]?.init?.method).toBe('GET');
    expect(calls[1]?.init?.body).toBeUndefined();
  });

  it('logout posts an empty JSON payload to Better Auth', async () => {
    const { impl, calls } = fetchStub(() => jsonResponse({}));
    const gateway = createCloudDataGateway({ baseUrl: 'https://api.test', fetch: impl });

    await expect(gateway.account.logout()).resolves.toBeUndefined();

    expect(calls[0]?.url.href).toBe('https://api.test/api/auth/sign-out');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(jsonBody(calls[0]!)).toEqual({});
    expect(requestHeaders(calls[0]!)).toEqual({ 'content-type': 'application/json' });
  });

  it('redeem posts the code and parses the account result', async () => {
    const result = { account: ACCOUNT, creditedQuota: 50 };
    const { impl, calls } = fetchStub(() => jsonResponse(result));
    const gateway = createCloudDataGateway({ baseUrl: 'https://api.test', fetch: impl });

    await expect(gateway.account.redeem('PROMO-2026')).resolves.toEqual(result);

    expect(calls[0]?.url.pathname).toBe('/api/v1/account/redeem');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(jsonBody(calls[0]!)).toEqual({ code: 'PROMO-2026' });
  });
});

describe('prompts, folders, and tags gateway HTTP transport', () => {
  it('list serializes filters and repeated tagIds while preserving the root-folder wire value', async () => {
    const { impl, calls } = fetchStub(() => jsonResponse({ items: [PROMPT], nextCursor: 'next' }));
    const gateway = createCloudDataGateway({ baseUrl: 'https://api.test', fetch: impl });

    await expect(
      gateway.prompts.list({
        q: 'cabin',
        cursor: 'cursor-1',
        limit: 10,
        folderId: null,
        tagIds: ['tag1', 'tag2'],
        pinnedOnly: true,
        includeDeleted: true,
        deletedOnly: true,
        sort: 'title-asc',
      }),
    ).resolves.toEqual({ items: [PROMPT], nextCursor: 'next' });

    const url = calls[0]?.url;
    expect(url?.pathname).toBe('/api/v1/prompts');
    expect(url?.searchParams.get('q')).toBe('cabin');
    expect(url?.searchParams.get('cursor')).toBe('cursor-1');
    expect(url?.searchParams.get('limit')).toBe('10');
    expect(url?.searchParams.get('folderId')).toBe('null');
    expect(url?.searchParams.getAll('tagIds')).toEqual(['tag1', 'tag2']);
    expect(url?.searchParams.get('pinnedOnly')).toBe('true');
    expect(url?.searchParams.get('includeDeleted')).toBe('true');
    expect(url?.searchParams.get('deletedOnly')).toBe('true');
    expect(url?.searchParams.get('sort')).toBe('title-asc');
  });

  it('get/create/update/remove/restore map prompt paths and payloads', async () => {
    const responses = [
      jsonResponse(PROMPT),
      jsonResponse(PROMPT, 201),
      jsonResponse(PROMPT),
      jsonResponse(PROMPT),
      jsonResponse(PROMPT),
    ];
    const { impl, calls } = fetchStub(() => responses.shift()!);
    const gateway = createCloudDataGateway({ baseUrl: 'https://api.test', fetch: impl });
    const createInput = {
      title: 'Mountain Cabin',
      description: 'A description',
      content: 'cinematic mountain cabin',
      negative: 'blurry',
      folderId: 'folder1',
      tagIds: ['tag1'],
      modelId: 'model-1',
      params: { steps: 20 },
      rating: 4,
      isPinned: true,
      pinOrder: 1,
      source: 'manual' as const,
      sourceUrl: null,
    };
    const updateInput = {
      title: 'Updated title',
      expectedVersion: 1,
      isPinned: false,
    };

    await expect(gateway.prompts.get('prompt1')).resolves.toEqual(PROMPT);
    await expect(gateway.prompts.create(createInput)).resolves.toEqual(PROMPT);
    await expect(gateway.prompts.update('prompt1', updateInput)).resolves.toEqual(PROMPT);
    await expect(gateway.prompts.remove('prompt1')).resolves.toEqual(PROMPT);
    await expect(gateway.prompts.restore('prompt1')).resolves.toEqual(PROMPT);

    expect(calls.map((call) => `${call.init?.method} ${call.url.pathname}`)).toEqual([
      'GET /api/v1/prompts/prompt1',
      'POST /api/v1/prompts',
      'PATCH /api/v1/prompts/prompt1',
      'DELETE /api/v1/prompts/prompt1',
      'POST /api/v1/prompts/prompt1/restore',
    ]);
    expect(jsonBody(calls[1]!)).toEqual(createInput);
    expect(jsonBody(calls[2]!)).toEqual(updateInput);
    expect(calls[3]?.init?.body).toBeUndefined();
    expect(calls[4]?.init?.body).toBeUndefined();
    expect(requestHeaders(calls[1]!)).toEqual({ 'content-type': 'application/json' });
  });

  it('purge sends no optional payload and use sends its action payload', async () => {
    const useResult = { prompt: PROMPT, recorded: true };
    const responses = [jsonResponse({ ok: true }), jsonResponse(useResult)];
    const { impl, calls } = fetchStub(() => responses.shift()!);
    const gateway = createCloudDataGateway({ baseUrl: 'https://api.test', fetch: impl });

    await expect(gateway.prompts.purge('prompt1')).resolves.toBeUndefined();
    await expect(
      gateway.prompts.use('prompt1', { action: 'generate', idempotencyKey: 'use-key-1' }),
    ).resolves.toEqual(useResult);

    expect(calls[0]?.url.pathname).toBe('/api/v1/prompts/prompt1/purge');
    expect(calls[0]?.init?.body).toBeUndefined();
    expect(requestHeaders(calls[0]!)).toEqual({});
    expect(calls[1]?.url.pathname).toBe('/api/v1/prompts/prompt1/use');
    expect(jsonBody(calls[1]!)).toEqual({ action: 'generate', idempotencyKey: 'use-key-1' });
  });

  it('emptyTrash posts to the collection endpoint and parses the purged count', async () => {
    const { impl, calls } = fetchStub(() => jsonResponse({ purged: 3 }));
    const gateway = createCloudDataGateway({ baseUrl: 'https://api.test', fetch: impl });

    await expect(gateway.prompts.emptyTrash()).resolves.toEqual({ purged: 3 });

    expect(calls[0]?.url.pathname).toBe('/api/v1/prompts/empty-trash');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.init?.body).toBeUndefined();
  });

  it('list/create/update/remove folders map paths, queryless lists, and bodies', async () => {
    const responses = [
      jsonResponse([FOLDER]),
      jsonResponse(FOLDER, 201),
      jsonResponse(FOLDER),
      jsonResponse(FOLDER),
    ];
    const { impl, calls } = fetchStub(() => responses.shift()!);
    const gateway = createCloudDataGateway({ baseUrl: 'https://api.test', fetch: impl });
    const createInput = { name: 'Inspiration', parentId: null, sortOrder: 1 };
    const updateInput = { name: 'Selected', expectedVersion: 1 };

    await expect(gateway.prompts.listFolders()).resolves.toEqual([FOLDER]);
    await expect(gateway.prompts.createFolder(createInput)).resolves.toEqual(FOLDER);
    await expect(gateway.prompts.updateFolder('folder1', updateInput)).resolves.toEqual(FOLDER);
    await expect(gateway.prompts.removeFolder('folder1')).resolves.toEqual(FOLDER);

    expect(calls.map((call) => `${call.init?.method} ${call.url.pathname}`)).toEqual([
      'GET /api/v1/folders',
      'POST /api/v1/folders',
      'PATCH /api/v1/folders/folder1',
      'DELETE /api/v1/folders/folder1',
    ]);
    expect(calls[0]?.url.search).toBe('');
    expect(jsonBody(calls[1]!)).toEqual(createInput);
    expect(jsonBody(calls[2]!)).toEqual(updateInput);
    expect(calls[3]?.init?.body).toBeUndefined();
  });

  it('list/create/update/remove tags map paths, queryless lists, and bodies', async () => {
    const responses = [
      jsonResponse([TAG]),
      jsonResponse(TAG, 201),
      jsonResponse(TAG),
      jsonResponse(TAG),
    ];
    const { impl, calls } = fetchStub(() => responses.shift()!);
    const gateway = createCloudDataGateway({ baseUrl: 'https://api.test', fetch: impl });
    const createInput = { name: 'Style', group: 'Visual', color: '#112233' };
    const updateInput = { color: '#445566', expectedVersion: 1 };

    await expect(gateway.prompts.listTags()).resolves.toEqual([TAG]);
    await expect(gateway.prompts.createTag(createInput)).resolves.toEqual(TAG);
    await expect(gateway.prompts.updateTag('tag1', updateInput)).resolves.toEqual(TAG);
    await expect(gateway.prompts.removeTag('tag1')).resolves.toEqual(TAG);

    expect(calls.map((call) => `${call.init?.method} ${call.url.pathname}`)).toEqual([
      'GET /api/v1/tags',
      'POST /api/v1/tags',
      'PATCH /api/v1/tags/tag1',
      'DELETE /api/v1/tags/tag1',
    ]);
    expect(calls[0]?.init?.body).toBeUndefined();
    expect(jsonBody(calls[1]!)).toEqual(createInput);
    expect(jsonBody(calls[2]!)).toEqual(updateInput);
    expect(calls[3]?.init?.body).toBeUndefined();
  });
});

describe('workbench gateway HTTP transport', () => {
  it('listSessions serializes every list filter and parses a page', async () => {
    const page = { items: [SESSION], nextCursor: null };
    const { impl, calls } = fetchStub(() => jsonResponse(page));
    const gateway = createCloudDataGateway({ baseUrl: 'https://api.test', fetch: impl });

    await expect(
      gateway.workbench.listSessions({
        cursor: 'cursor-2',
        limit: 25,
        includeArchived: true,
        includeDeleted: true,
        archivedOnly: true,
        deletedOnly: true,
      }),
    ).resolves.toEqual(page);

    const url = calls[0]?.url;
    expect(url?.pathname).toBe('/api/v1/workbench/sessions');
    expect(url?.searchParams.get('cursor')).toBe('cursor-2');
    expect(url?.searchParams.get('limit')).toBe('25');
    expect(url?.searchParams.get('includeArchived')).toBe('true');
    expect(url?.searchParams.get('includeDeleted')).toBe('true');
    expect(url?.searchParams.get('archivedOnly')).toBe('true');
    expect(url?.searchParams.get('deletedOnly')).toBe('true');
  });

  it('create/get/update/remove/restore/purge/empty map session paths, body, and empty optional payloads', async () => {
    const responses = [
      jsonResponse(SESSION, 201),
      jsonResponse(SESSION),
      jsonResponse(SESSION),
      jsonResponse(SESSION),
      jsonResponse(SESSION),
    ];
    const { impl, calls } = fetchStub(() => responses.shift()!);
    const gateway = createCloudDataGateway({ baseUrl: 'https://api.test', fetch: impl });
    const createInput = { title: 'Workbench', draft: DRAFT };
    const updateInput = { expectedVersion: 1, title: 'New title', draft: DRAFT, archived: true };

    await expect(gateway.workbench.createSession(createInput)).resolves.toEqual(SESSION);
    await expect(gateway.workbench.getSession('session1')).resolves.toEqual(SESSION);
    await expect(gateway.workbench.updateSession('session1', updateInput)).resolves.toEqual(
      SESSION,
    );
    await expect(gateway.workbench.removeSession('session1')).resolves.toEqual(SESSION);
    await expect(gateway.workbench.restoreSession('session1')).resolves.toEqual(SESSION);
    responses.push(jsonResponse({ purged: 1 }), jsonResponse({ purged: 501 }));
    await expect(gateway.workbench.purgeSession('session1')).resolves.toEqual({ purged: 1 });
    await expect(gateway.workbench.emptyTrash()).resolves.toEqual({ purged: 501 });

    expect(calls.map((call) => `${call.init?.method} ${call.url.pathname}`)).toEqual([
      'POST /api/v1/workbench/sessions',
      'GET /api/v1/workbench/sessions/session1',
      'PATCH /api/v1/workbench/sessions/session1',
      'DELETE /api/v1/workbench/sessions/session1',
      'POST /api/v1/workbench/sessions/session1/restore',
      'POST /api/v1/workbench/sessions/session1/purge',
      'POST /api/v1/workbench/sessions/empty-trash',
    ]);
    expect(jsonBody(calls[0]!)).toEqual(createInput);
    expect(jsonBody(calls[2]!)).toEqual(updateInput);
    expect(calls[3]?.init?.body).toBeUndefined();
    expect(calls[4]?.init?.body).toBeUndefined();
  });

  it('preserves an empty create payload for schema defaults', async () => {
    const { impl, calls } = fetchStub(() => jsonResponse(SESSION, 201));
    const gateway = createCloudDataGateway({ baseUrl: 'https://api.test', fetch: impl });

    await gateway.workbench.createSession({});

    expect(jsonBody(calls[0]!)).toEqual({});
    expect(requestHeaders(calls[0]!)).toEqual({ 'content-type': 'application/json' });
  });
});

describe('generation gateway HTTP transport', () => {
  it('forwards caller-owned keys across ambiguous re-invocation and distinct intents', async () => {
    const { impl, calls } = fetchStub(() => jsonResponse(JOB, 201));
    const gateway = createCloudDataGateway({ baseUrl: 'https://api.test', fetch: impl });

    await gateway.generation.create(GENERATION_INPUT, 'create-intent-1');
    await gateway.generation.create(GENERATION_INPUT, 'create-intent-1');
    await gateway.generation.create(GENERATION_INPUT, 'create-intent-2');
    await gateway.generation.retry('job1', 'retry-intent-1');
    await gateway.generation.retry('job1', 'retry-intent-1');
    await gateway.generation.retry('job1', 'retry-intent-2');

    expect(calls.map((call) => requestHeaders(call)['idempotency-key'])).toEqual([
      'create-intent-1',
      'create-intent-1',
      'create-intent-2',
      'retry-intent-1',
      'retry-intent-1',
      'retry-intent-2',
    ]);
    expect(calls.slice(0, 3).map(jsonBody)).toEqual([
      GENERATION_INPUT,
      GENERATION_INPUT,
      GENERATION_INPUT,
    ]);
    expect(
      calls.slice(3).every((call) => call.url.pathname === '/api/v1/generations/job1/retry'),
    ).toBe(true);
    expect(calls.slice(3).every((call) => call.init?.body === undefined)).toBe(true);
  });

  it('list serializes the complete generation history query', async () => {
    const page = { items: [JOB], nextCursor: 'next-job' };
    const { impl, calls } = fetchStub(() => jsonResponse(page));
    const gateway = createCloudDataGateway({ baseUrl: 'https://api.test', fetch: impl });

    await expect(
      gateway.generation.list({
        cursor: 'cursor-3',
        limit: 12,
        sessionId: 'session1',
        status: 'queued',
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-08-29T00:00:00.000Z',
        providerModel: 'gpt-image-1',
        search: 'cabin',
        promptId: 'prompt-related-1',
        includeDeleted: true,
        deletedOnly: false,
      }),
    ).resolves.toEqual(page);

    const url = calls[0]?.url;
    expect(url?.pathname).toBe('/api/v1/generations');
    expect(url?.searchParams.get('cursor')).toBe('cursor-3');
    expect(url?.searchParams.get('limit')).toBe('12');
    expect(url?.searchParams.get('sessionId')).toBe('session1');
    expect(url?.searchParams.get('status')).toBe('queued');
    expect(url?.searchParams.get('from')).toBe('2026-08-01T00:00:00.000Z');
    expect(url?.searchParams.get('to')).toBe('2026-08-29T00:00:00.000Z');
    expect(url?.searchParams.get('providerModel')).toBe('gpt-image-1');
    expect(url?.searchParams.get('search')).toBe('cabin');
    expect(url?.searchParams.get('promptId')).toBe('prompt-related-1');
    expect(url?.searchParams.get('includeDeleted')).toBe('true');
    expect(url?.searchParams.get('deletedOnly')).toBe('false');
  });

  it('get/cancel/remove/restore map generation paths and response parsing', async () => {
    const responses = [jsonResponse(JOB), jsonResponse(JOB), jsonResponse(JOB), jsonResponse(JOB)];
    const { impl, calls } = fetchStub(() => responses.shift()!);
    const gateway = createCloudDataGateway({ baseUrl: 'https://api.test', fetch: impl });

    await expect(gateway.generation.get('job1')).resolves.toEqual(JOB);
    await expect(gateway.generation.cancel('job1')).resolves.toEqual(JOB);
    await expect(gateway.generation.remove('job1')).resolves.toEqual(JOB);
    await expect(gateway.generation.restore('job1')).resolves.toEqual(JOB);

    expect(calls.map((call) => `${call.init?.method} ${call.url.pathname}`)).toEqual([
      'GET /api/v1/generations/job1',
      'POST /api/v1/generations/job1/cancel',
      'DELETE /api/v1/generations/job1',
      'POST /api/v1/generations/job1/restore',
    ]);
    expect(calls.every((call) => call.init?.body === undefined)).toBe(true);
  });

  it('purge sends no body and listProviders parses the provider directory', async () => {
    const responses = [jsonResponse({ ok: true }), jsonResponse([PROVIDER])];
    const { impl, calls } = fetchStub(() => responses.shift()!);
    const gateway = createCloudDataGateway({ baseUrl: 'https://api.test', fetch: impl });

    await expect(gateway.generation.purge('job1')).resolves.toBeUndefined();
    await expect(gateway.generation.listProviders()).resolves.toEqual([PROVIDER]);

    expect(calls[0]?.url.pathname).toBe('/api/v1/generations/job1/purge');
    expect(calls[0]?.init?.body).toBeUndefined();
    expect(calls[1]?.url.pathname).toBe('/api/v1/generations/providers');
    expect(calls[1]?.init?.body).toBeUndefined();
  });

  it('cleanup posts the scope and parses the affected count (ui-parity 05 §7)', async () => {
    const responses = [jsonResponse({ affected: 3 }), jsonResponse({ affected: 0 })];
    const { impl, calls } = fetchStub(() => responses.shift()!);
    const gateway = createCloudDataGateway({ baseUrl: 'https://api.test', fetch: impl });

    await expect(gateway.generation.cleanup({ scope: 'older-than-30d' })).resolves.toEqual({
      affected: 3,
    });
    await expect(gateway.generation.cleanup({ scope: 'empty-trash' })).resolves.toEqual({
      affected: 0,
    });

    expect(calls.map((call) => `${call.init?.method} ${call.url.pathname}`)).toEqual([
      'POST /api/v1/generations/cleanup',
      'POST /api/v1/generations/cleanup',
    ]);
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ scope: 'older-than-30d' });
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ scope: 'empty-trash' });
  });

  it('usage.summary queries the range and parses the contract shape', async () => {
    const summary = {
      range: '30d',
      from: '2026-08-08T12:00:00.000+00:00',
      to: '2026-09-06T12:00:00.000+00:00',
      generationCount: 2,
      succeededCount: 1,
      failedCount: 1,
      cancelledCount: 0,
      imageCount: 1,
      costPoints: null,
      successRate: 0.5,
      byProvider: [
        { providerId: null, label: 'Musefold 云生图', generationCount: 2, costPoints: null },
      ],
      byDay: [
        {
          date: '2026-09-06',
          generationCount: 2,
          succeededCount: 1,
          failedCount: 1,
          cancelledCount: 0,
          costPoints: null,
          successRate: 0.5,
        },
      ],
      byModel: [{ model: 'musefold-image-pro', generationCount: 2, costPoints: null }],
    };
    const { impl, calls } = fetchStub(() => jsonResponse(summary));
    const gateway = createCloudDataGateway({ baseUrl: 'https://api.test', fetch: impl });

    await expect(gateway.usage.summary({ range: '30d' })).resolves.toEqual(summary);
    expect(calls[0]?.url.pathname).toBe('/api/v1/usage/summary');
    expect(calls[0]?.url.searchParams.get('range')).toBe('30d');
    expect(calls[0]?.init?.method).toBe('GET');
    expect(calls[0]?.init?.body).toBeUndefined();
  });

  it('cloudMcp.listAuthorizations / revokeAuthorization stay secret-free', async () => {
    const list = {
      items: [
        {
          clientId: 'cursor-mcp-client',
          name: 'Cursor',
          uri: null,
          scopes: ['account:read'],
          authorizedAt: '2026-08-01T12:00:00.000+00:00',
          lastUsedAt: null,
        },
      ],
    };
    const { impl, calls } = fetchStub((url) => {
      if (url.pathname.endsWith('/mcp/authorizations') && !url.pathname.includes('cursor')) {
        return jsonResponse(list);
      }
      return jsonResponse({ revoked: true, clientId: 'cursor-mcp-client' });
    });
    const gateway = createCloudDataGateway({ baseUrl: 'https://api.test', fetch: impl });
    if (!gateway.cloudMcp) throw new Error('cloud gateway cloudMcp domain is missing');

    await expect(gateway.cloudMcp.listAuthorizations()).resolves.toEqual(list);
    await expect(
      gateway.cloudMcp.revokeAuthorization({ clientId: 'cursor-mcp-client' }),
    ).resolves.toEqual({ revoked: true, clientId: 'cursor-mcp-client' });
    expect(calls.map((call) => `${call.init?.method} ${call.url.pathname}`)).toEqual([
      'GET /api/v1/mcp/authorizations',
      'DELETE /api/v1/mcp/authorizations/cursor-mcp-client',
    ]);
    expect(JSON.stringify(list)).not.toMatch(/access_token|refresh_token|client_secret/);
  });

  it('does not expose desktop-only generation methods on the cloud gateway', () => {
    const { impl } = fetchStub(() => jsonResponse({ ok: true }));
    const gateway = createCloudDataGateway({ baseUrl: 'https://api.test', fetch: impl });

    // 磁盘占用与本机文件动作是桌面可选方法;Web 宿主不实现,UI 靠 capabilities 门控。
    expect(gateway.generation.getStorageUsage).toBeUndefined();
    expect(gateway.generation.revealAsset).toBeUndefined();
    expect(gateway.generation.copyAssetToClipboard).toBeUndefined();
  });

  it('uploads a reference image as a FormData file without JSON content-type', async () => {
    const { impl, calls } = fetchStub(() => jsonResponse(REFERENCE, 201));
    const gateway = createCloudDataGateway({ baseUrl: 'https://api.test', fetch: impl });
    const bytes = new Uint8Array([1, 2, 3, 4]);

    await expect(
      gateway.generation.uploadReferenceImage({ name: 'ref.png', bytes }),
    ).resolves.toEqual(REFERENCE);

    expect(calls[0]?.url.pathname).toBe('/api/v1/reference-images');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(requestHeaders(calls[0]!)).toEqual({});
    const body = calls[0]?.init?.body;
    expect(body).toBeInstanceOf(FormData);
    const file = (body as FormData).get('file');
    expect(file).toBeInstanceOf(File);
    expect((file as File).name).toBe('ref.png');
    expect(new Uint8Array(await (file as File).arrayBuffer())).toEqual(bytes);
  });
});

describe('generation.saveAsset browser transport boundary', () => {
  const anchor = { href: '', download: '', rel: '', click: vi.fn(), remove: vi.fn() };
  const bodyAppend = vi.fn();
  const windowOpen = vi.fn();
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    vi.clearAllMocks();
    anchor.href = '';
    anchor.download = '';
    vi.stubGlobal('document', {
      createElement: vi.fn(() => anchor),
      body: { append: bodyAppend },
    });
    vi.stubGlobal('window', { open: windowOpen });
    URL.createObjectURL = vi.fn(() => 'blob:musefold-test') as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn() as typeof URL.revokeObjectURL;
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it('fetches a blob, creates an object URL, and resolves saved', async () => {
    const { impl, calls } = fetchStub(
      () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
    );
    const gateway = createCloudDataGateway({ baseUrl: 'https://api.test', fetch: impl });

    await expect(
      gateway.generation.saveAsset({ url: 'https://cdn.test/a.png', name: 'musefold-a.png' }),
    ).resolves.toBe('saved');

    expect(calls[0]?.url.href).toBe('https://cdn.test/a.png');
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(anchor.href).toBe('blob:musefold-test');
    expect(anchor.download).toBe('musefold-a.png');
    expect(anchor.click).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:musefold-test');
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it('falls back to opening the asset URL when fetch fails or is not ok', async () => {
    const { impl } = fetchStub(() => new Response('forbidden', { status: 403 }));
    const gateway = createCloudDataGateway({ baseUrl: 'https://api.test', fetch: impl });

    await expect(
      gateway.generation.saveAsset({ url: 'https://cdn.test/b.png', name: 'b.png' }),
    ).resolves.toBe('saved');

    expect(anchor.click).not.toHaveBeenCalled();
    expect(windowOpen).toHaveBeenCalledWith('https://cdn.test/b.png', '_blank', 'noopener');
  });
});

describe('ApiHttp error and response boundaries through the gateway', () => {
  it('parses the contract error envelope into ApiRequestError', async () => {
    const { impl } = fetchStub(() =>
      jsonResponse(
        {
          error: {
            code: 'PROMPT_NOT_FOUND',
            message: 'Prompt not found',
            requestId: 'req-1',
            retryable: false,
            details: { promptId: 'missing' },
          },
        },
        404,
      ),
    );
    const gateway = createCloudDataGateway({ baseUrl: 'https://api.test', fetch: impl });

    const error = await gateway.prompts.get('missing').catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({
      name: 'ApiRequestError',
      code: 'PROMPT_NOT_FOUND',
      message: 'Prompt not found',
      status: 404,
      retryable: false,
      requestId: 'req-1',
      details: { promptId: 'missing' },
    });
  });

  it('parses Better Auth top-level errors and falls back unknown codes', async () => {
    const responses = [
      jsonResponse({ code: 'AUTH_CREDENTIALS_INVALID', message: 'Invalid credentials' }, 401),
      jsonResponse({ code: 'AUTH_PROVIDER_UNKNOWN', message: 'Unknown auth error' }, 400),
    ];
    const { impl } = fetchStub(() => responses.shift()!);
    const gateway = createCloudDataGateway({ baseUrl: 'https://api.test', fetch: impl });

    const authError = await gateway.account
      .login({ username: 'u', password: 'p' })
      .catch((cause: unknown) => cause);
    const unknownError = await gateway.account
      .login({ username: 'u', password: 'p' })
      .catch((cause: unknown) => cause);

    expect(authError).toMatchObject({
      code: 'AUTH_CREDENTIALS_INVALID',
      message: 'Invalid credentials',
      status: 401,
      retryable: false,
    });
    expect(unknownError).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'Unknown auth error',
      status: 400,
      retryable: false,
    });
  });

  it('uses the HTTP status fallback for malformed error bodies', async () => {
    const { impl } = fetchStub(() => new Response('gateway timeout', { status: 504 }));
    const gateway = createCloudDataGateway({ baseUrl: 'https://api.test', fetch: impl });

    const error = await gateway.account.getStatus().catch((cause: unknown) => cause);

    expect(error).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: '请求失败(HTTP 504)',
      status: 504,
      retryable: true,
    });
  });

  it('lets network TypeErrors pass through unchanged', async () => {
    const networkError = new TypeError('network down');
    const { impl } = fetchStub(() => {
      throw networkError;
    });
    const gateway = createCloudDataGateway({ baseUrl: 'https://api.test', fetch: impl });

    await expect(gateway.account.getStatus()).rejects.toBe(networkError);
  });

  it('rejects a successful response that does not match its contract schema', async () => {
    const { impl } = fetchStub(() => jsonResponse({ id: 'u1', username: 'tester' }));
    const gateway = createCloudDataGateway({ baseUrl: 'https://api.test', fetch: impl });

    await expect(gateway.account.getStatus()).rejects.toMatchObject({ name: 'ZodError' });
  });
});

describe('reference release transport', () => {
  it('releases by strict id using DELETE without a body or arbitrary path', async () => {
    const { impl, calls } = fetchStub(() => new Response(null, { status: 204 }));
    const gateway = createCloudDataGateway({ baseUrl: 'https://api.test', fetch: impl });
    await expect(
      gateway.generation.releaseReferenceImage({ id: 'reference-123' }),
    ).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.pathname).toBe('/api/v1/reference-images/reference-123');
    expect(calls[0]?.url.search).toBe('');
    expect(calls[0]?.init?.method).toBe('DELETE');
    expect(calls[0]?.init?.body).toBeUndefined();
  });
  it.each([
    { id: '../private' },
    { id: 'reference-123', path: '/private' },
    { id: 'reference-123', userId: 'other' },
  ])('rejects invalid release input before transport: %j', async (input) => {
    const { impl, calls } = fetchStub(() => new Response(null, { status: 204 }));
    const gateway = createCloudDataGateway({ baseUrl: 'https://api.test', fetch: impl });
    await expect(gateway.generation.releaseReferenceImage(input)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
  it('surfaces release failure without performing generation or retrying a failed release', async () => {
    const { impl, calls } = fetchStub(() =>
      jsonResponse({ error: { code: 'INTERNAL_ERROR', message: 'cleanup unavailable' } }, 500),
    );
    const gateway = createCloudDataGateway({ baseUrl: 'https://api.test', fetch: impl });
    await expect(
      gateway.generation.releaseReferenceImage({ id: 'reference-123' }),
    ).rejects.toThrow();
    expect(calls.map((call) => call.init?.method)).toEqual(['DELETE']);
  });
});

it('an empty 204 is not accepted for a method requiring account data', async () => {
  const { impl } = fetchStub(() => new Response(null, { status: 204 }));
  const gateway = createCloudDataGateway({ baseUrl: 'https://api.test', fetch: impl });
  await expect(gateway.account.getStatus()).rejects.toThrow();
});
