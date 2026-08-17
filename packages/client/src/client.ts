// 控制面 typed 客户端：错误统一抛 MusefoldClientError（保留错误信封 code）。

export interface ClientErrorEnvelope {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export class MusefoldClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'MusefoldClientError';
  }
}

export interface SseEvent {
  type: string;
  payload: unknown;
}

export interface GenerationDetail {
  jobId: string;
  status: string;
  historyId?: string;
  costCents?: number | null;
  cost?: number | null;
  costUnit?: 'cny_cent' | 'point';
  durationMs?: number | null;
  assets?: Array<{ path: string }>;
  error?: { code: string; message: string } | null;
  actualSize?: { width: number; height: number } | null;
  sizeMismatch?: { expected: string; actual: string } | null;
}

export interface WaitForGenerationOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** SSE 事件回调，可用于 CLI/MCP 转发进度。 */
  onEvent?: (event: SseEvent) => void;
  /** SSE 断线或漏事件时的低频状态核对间隔。 */
  fallbackPollMs?: number;
}

export interface SetupStatus {
  account: { configured: boolean; health: string; serverKind: 'default' | 'custom' };
  providers: Array<{
    id: string;
    name: string;
    type: string;
    model: string;
    isActive: boolean;
    managedBy: 'account' | null;
    available: boolean;
  }>;
  activeProviderId: string | null;
}

export interface ProviderSetupDraft {
  name?: string;
  type?: 'openai' | 'openai-compatible' | 'wukong-studio';
  baseUrl?: string;
  model?: string;
}

export interface MusefoldClientOptions {
  endpoint: string;
  token: string;
  timeoutMs?: number;
}

export class MusefoldClient {
  private readonly endpoint: string;
  private readonly token: string;
  private readonly timeoutMs: number;

  constructor(options: MusefoldClientOptions) {
    this.endpoint = options.endpoint.replace(/\/$/, '');
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${this.token}`);
    if (init.body != null && !headers.has('content-type')) headers.set('content-type', 'application/json');
    let response: Response;
    try {
      response = await fetch(`${this.endpoint}${path}`, {
        ...init,
        headers,
        signal: init.signal ?? AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new MusefoldClientError('NOT_CONNECTED', `无法连接 Musefold 控制面：${error instanceof Error ? error.message : String(error)}`, 0);
    }
    const text = await response.text();
    const parsed = text ? (JSON.parse(text) as unknown) : undefined;
    if (!response.ok) {
      const envelope = (parsed as { error?: ClientErrorEnvelope } | undefined)?.error;
      throw new MusefoldClientError(
        envelope?.code ?? 'HTTP_ERROR',
        envelope?.message ?? `控制面返回 ${response.status}`,
        response.status,
        envelope?.details ?? {},
      );
    }
    return parsed as T;
  }

  // —— v1 typed 便捷方法（形状与契约测试对齐） ——
  health() { return this.request<Record<string, unknown>>('/v1/health'); }
  prompts(params: { query?: string; folderId?: string; source?: string; limit?: number } = {}) {
    return this.request<{ prompts: Array<Record<string, unknown>>; total: number }>(`/v1/prompts${toQuery(params)}`);
  }
  prompt(id: string) { return this.request<{ prompt: Record<string, unknown> }>(`/v1/prompts/${encodeURIComponent(id)}`); }
  savePrompt(input: { title: string; body: string; folderId?: string; note?: string; source?: 'manual' | 'slip' }) {
    return this.request<{ id: string; created: true }>('/v1/prompts', { method: 'POST', body: JSON.stringify(input) });
  }
  providers() { return this.request<{ providers: Array<Record<string, unknown>> }>('/v1/providers'); }
  providerModels(id: string) {
    return this.request<{ models: Array<{ id: string; name?: string }> }>(`/v1/providers/${encodeURIComponent(id)}/models`);
  }
  history(params: { limit?: number; status?: string; providerId?: string } = {}) {
    return this.request<{ history: Array<Record<string, unknown>> }>(`/v1/history${toQuery(params)}`);
  }
  historyDetail(id: string) { return this.request<{ history: Record<string, unknown> }>(`/v1/history/${encodeURIComponent(id)}`); }
  schemes() { return this.request<{ schemes: Array<Record<string, unknown>> }>('/v1/schemes'); }
  scheme(id: string) { return this.request<{ summary: Record<string, unknown>; document: Record<string, unknown> }>(`/v1/schemes/${encodeURIComponent(id)}`); }
  compileScheme(id: string, input: Record<string, unknown> = {}) {
    return this.request<{ prompt: string; warnings: string[]; policySummary: string }>(
      `/v1/schemes/${encodeURIComponent(id)}/compile`,
      { method: 'POST', body: JSON.stringify(input) },
    );
  }
  setupStatus() { return this.request<SetupStatus>('/v1/setup/status'); }
  openAccountSetup(mode: 'login' | 'register' = 'login') {
    return this.request<{ opened: true; requestId: string; kind: 'account'; message: string }>('/v1/setup/open', {
      method: 'POST', body: JSON.stringify({ kind: 'account', mode }),
    });
  }
  openProviderSetup(draft?: ProviderSetupDraft) {
    return this.request<{ opened: true; requestId: string; kind: 'provider'; message: string }>('/v1/setup/open', {
      method: 'POST', body: JSON.stringify({ kind: 'provider', ...(draft ? { draft } : {}) }),
    });
  }
  selectProvider(providerId: string) {
    return this.request<{ selected: SetupStatus['providers'][number] }>(
      `/v1/setup/providers/${encodeURIComponent(providerId)}/activate`,
      { method: 'POST', body: '{}' },
    );
  }

  // —— 生图闭环（V04-API-03/04） ——
  estimateGeneration(body: Record<string, unknown>) {
    return this.request<{
      cents: number | null; providerId: string; providerName: string; model: string; n: number;
      remainingBudgetCents: number;
    }>('/v1/generations/estimate', { method: 'POST', body: JSON.stringify(body) });
  }
  startGeneration(body: Record<string, unknown>, idempotencyKey?: string) {
    return this.request<{
      jobId: string; status: string; historyId?: string; costCents?: number | null; cost?: number | null; costUnit?: 'cny_cent' | 'point';
      assets?: Array<{ path: string }>; error?: { code: string; message: string } | null;
      actualSize?: { width: number; height: number } | null; sizeMismatch?: { expected: string; actual: string } | null;
      idempotentReplay?: boolean;
    }>('/v1/generations', {
      method: 'POST',
      body: JSON.stringify(body),
      ...(idempotencyKey ? { headers: { 'idempotency-key': idempotencyKey } } : {}),
      // 确认挂起最长 120s，给足闸门等待预算
      signal: AbortSignal.timeout(150_000),
    });
  }
  getGeneration(jobId: string) {
    return this.request<GenerationDetail>(`/v1/generations/${encodeURIComponent(jobId)}`);
  }
  cancelGeneration(jobId: string) {
    return this.request<{ jobId: string; cancelling: boolean }>(`/v1/generations/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
  }
  async uploadImage(bytes: Uint8Array, name: string, mimeType: string) {
    return this.request<{ image: { path: string; name: string } }>('/v1/uploads', {
      method: 'POST',
      headers: { 'content-type': mimeType, 'x-musefold-filename': name },
      body: bytes as unknown as RequestInit['body'],
    });
  }

  /**
   * 订阅 SSE 事件流；返回停止函数。
   * 最小 SSE 解析（event/data 行 + 空行分隔），够控制面信封使用。
   */
  async events(
    onEvent: (event: SseEvent) => void,
    options: { jobId?: string; signal?: AbortSignal } = {},
  ): Promise<() => void> {
    const controller = new AbortController();
    if (options.signal) options.signal.addEventListener('abort', () => controller.abort(), { once: true });
    const query = options.jobId ? `?jobId=${encodeURIComponent(options.jobId)}` : '';
    const response = await fetch(`${this.endpoint}/v1/events${query}`, {
      headers: { authorization: `Bearer ${this.token}`, accept: 'text/event-stream' },
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      throw new MusefoldClientError('NOT_CONNECTED', `SSE 连接失败（${response.status}）`, response.status);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    void (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary: number;
          while ((boundary = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            let type = 'message';
            let data = '';
            for (const line of block.split('\n')) {
              if (line.startsWith('event: ')) type = line.slice(7).trim();
              else if (line.startsWith('data: ')) data += line.slice(6);
            }
            if (!data) continue;
            try {
              onEvent({ type, payload: JSON.parse(data) });
            } catch {
              onEvent({ type, payload: data });
            }
          }
        }
      } catch {
        // 连接中断（取消/服务停止）按静默结束处理
      }
    })();
    return () => controller.abort();
  }

  /**
   * 等待生图终态。SSE 是主通道，低频查询只负责覆盖断线和漏事件。
   * 订阅前后各检查一次状态，避免极快任务落在连接竞态窗口里。
   */
  async waitForGeneration(jobId: string, options: WaitForGenerationOptions = {}): Promise<GenerationDetail> {
    const timeoutMs = options.timeoutMs ?? 300_000;
    const fallbackPollMs = Math.max(1_000, options.fallbackPollMs ?? 15_000);
    const signal = options.signal;

    if (signal?.aborted) {
      throw new MusefoldClientError('CANCELLED', '等待生成任务已取消', 0);
    }

    return new Promise<GenerationDetail>((resolve, reject) => {
      let settled = false;
      let checking = false;
      let stopEvents: (() => void) | null = null;
      const eventsController = new AbortController();
      let pollTimer: ReturnType<typeof setInterval> | null = null;
      let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        eventsController.abort();
        stopEvents?.();
        stopEvents = null;
        if (pollTimer) clearInterval(pollTimer);
        if (timeoutTimer) clearTimeout(timeoutTimer);
        signal?.removeEventListener('abort', onAbort);
      };
      const finish = (detail: GenerationDetail) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(detail);
      };
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const onAbort = () => fail(new MusefoldClientError('CANCELLED', '等待生成任务已取消', 0));
      const checkStatus = async (strict: boolean) => {
        if (settled || checking) return;
        checking = true;
        try {
          const detail = await this.getGeneration(jobId);
          if (detail.status !== 'running') finish(detail);
        } catch (error) {
          if (strict) fail(error);
        } finally {
          checking = false;
        }
      };

      signal?.addEventListener('abort', onAbort, { once: true });
      timeoutTimer = setTimeout(() => {
        fail(new MusefoldClientError('TIMEOUT', `等待生成任务超时（${Math.round(timeoutMs / 1000)} 秒）`, 0));
      }, timeoutMs);
      pollTimer = setInterval(() => void checkStatus(false), fallbackPollMs);

      void (async () => {
        await checkStatus(true);
        if (settled) return;
        try {
          stopEvents = await this.events((event) => {
            if (settled) return;
            options.onEvent?.(event);
            if (event.type === 'generation.completed' || event.type === 'generation.failed') {
              void checkStatus(false);
            }
          }, { jobId, signal: eventsController.signal });
        } catch {
          // SSE 不可用时由低频状态核对继续等待。
        }
        if (!settled) await checkStatus(false);
      })().catch(fail);
    });
  }
}

function toQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}
