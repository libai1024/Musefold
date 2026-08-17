import {
  accountSessionSchema,
  apiErrorResponseSchema,
  cloudGenerationRequestSchema,
  generationJobSchema,
  promptListQuerySchema,
  promptPageSchema,
  type AccountSession,
  type ApiErrorCode,
  type CloudGenerationRequest,
  type GenerationJob,
  type LoginRequest,
  type PromptListQuery,
  type PromptPage,
} from '@musefold/contracts';

export interface WebGateway {
  readonly mode: 'api' | 'fixture';
  getSession(): Promise<AccountSession>;
  login(input: LoginRequest): Promise<AccountSession>;
  logout(): Promise<void>;
  listPrompts(query: PromptListQuery): Promise<PromptPage>;
  createGeneration(input: CloudGenerationRequest, idempotencyKey: string): Promise<GenerationJob>;
  getGeneration(id: string): Promise<GenerationJob>;
  cancelGeneration(id: string): Promise<GenerationJob>;
}

export class WebGatewayError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'WebGatewayError';
  }
}

interface Parser<T> {
  parse(value: unknown): T;
}

class HttpWebGateway implements WebGateway {
  readonly mode = 'api' as const;

  constructor(private readonly baseUrl = import.meta.env.VITE_API_BASE_URL ?? '/api/musefold/v1') {}

  getSession(): Promise<AccountSession> {
    return this.request('/auth/me', {}, accountSessionSchema);
  }

  login(input: LoginRequest): Promise<AccountSession> {
    return this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
    }, accountSessionSchema);
  }

  async logout(): Promise<void> {
    await this.request('/auth/logout', { method: 'POST' }, { parse: () => undefined });
  }

  listPrompts(query: PromptListQuery): Promise<PromptPage> {
    const parsed = promptListQuerySchema.parse(query);
    const search = new URLSearchParams();
    if (parsed.q) search.set('q', parsed.q);
    if (parsed.cursor) search.set('cursor', parsed.cursor);
    search.set('limit', String(parsed.limit));
    search.set('includeDeleted', String(parsed.includeDeleted));
    search.set('sort', parsed.sort);
    if (parsed.folderId) search.set('folderId', parsed.folderId);
    parsed.tags?.forEach((tag) => search.append('tag', tag));
    if (parsed.pinnedOnly) search.set('pinnedOnly', 'true');
    return this.request(`/prompts?${search.toString()}`, {}, promptPageSchema);
  }

  createGeneration(input: CloudGenerationRequest, idempotencyKey: string): Promise<GenerationJob> {
    const request = cloudGenerationRequestSchema.parse(input);
    return this.request('/generations', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(request),
    }, generationJobSchema);
  }

  getGeneration(id: string): Promise<GenerationJob> {
    return this.request(`/generations/${encodeURIComponent(id)}`, {}, generationJobSchema);
  }

  cancelGeneration(id: string): Promise<GenerationJob> {
    return this.request(`/generations/${encodeURIComponent(id)}/cancel`, { method: 'POST' }, generationJobSchema);
  }

  private async request<T>(path: string, init: RequestInit, parser: Parser<T>): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const parsed = apiErrorResponseSchema.safeParse(payload);
      if (parsed.success) {
        throw new WebGatewayError(parsed.data.error.code, parsed.data.error.message);
      }
      throw new WebGatewayError('INTERNAL_ERROR', `请求失败（${response.status}）`);
    }

    if (response.status === 204) return parser.parse(undefined);
    return parser.parse(await response.json());
  }
}

class DeferredFixtureWebGateway implements WebGateway {
  readonly mode = 'fixture' as const;
  private readonly delegate = import('./fixture-runtime').then(({ FixtureWebGateway }) => new FixtureWebGateway());

  async getSession(): Promise<AccountSession> {
    return (await this.delegate).getSession();
  }

  async login(input: LoginRequest): Promise<AccountSession> {
    return (await this.delegate).login(input);
  }

  async logout(): Promise<void> {
    return (await this.delegate).logout();
  }

  async listPrompts(query: PromptListQuery): Promise<PromptPage> {
    return (await this.delegate).listPrompts(query);
  }

  async createGeneration(input: CloudGenerationRequest, idempotencyKey: string): Promise<GenerationJob> {
    return (await this.delegate).createGeneration(input, idempotencyKey);
  }

  async getGeneration(id: string): Promise<GenerationJob> {
    return (await this.delegate).getGeneration(id);
  }

  async cancelGeneration(id: string): Promise<GenerationJob> {
    return (await this.delegate).cancelGeneration(id);
  }
}

export function createWebGateway(): WebGateway {
  if (import.meta.env.DEV && import.meta.env.VITE_USE_FIXTURES !== 'false') {
    return new DeferredFixtureWebGateway();
  }
  return new HttpWebGateway();
}
