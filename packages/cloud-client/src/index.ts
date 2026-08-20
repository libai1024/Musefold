import {
  accountSessionSchema,
  desktopAccountSessionSchema,
  apiErrorResponseSchema,
  createGenerationInputSchema,
  generationHistoryPageSchema,
  generationHistoryQuerySchema,
  generationJobSchema,
  mcpConnectionPageSchema,
  updateMcpConnectionSchema,
  newPromptDocumentSchema,
  promptDocumentSchema,
  promptListQuerySchema,
  promptPageSchema,
  promptUseInputSchema,
  promptUseResultSchema,
  createWorkbenchSessionSchema,
  updateWorkbenchSessionSchema,
  workbenchSessionListQuerySchema,
  workbenchSessionPageSchema,
  workbenchSessionSchema,
  redeemRequestSchema,
  redeemResultSchema,
  registerRequestSchema,
  loginRequestSchema,
  syncBootstrapPageSchema,
  syncBootstrapQuerySchema,
  syncDeviceRegistrationSchema,
  syncDeviceSchema,
  syncPullQuerySchema,
  syncPullResultSchema,
  syncPushRequestSchema,
  syncPushResultSchema,
  syncUsagePushRequestSchema,
  syncUsagePushResultSchema,
  syncStatusSchema,
  updatePromptDocumentSchema,
  type AccountSession,
  type DesktopAccountSession,
  type ApiErrorCode,
  type CreateGenerationInput,
  type CreateWorkbenchSession,
  type GenerationHistoryPage,
  type GenerationJob,
  type GenerationHistoryQuery,
  type LoginRequest,
  type McpConnectionPage,
  type NewPromptDocument,
  type PromptDocument,
  type PromptListQuery,
  type PromptPage,
  type PromptUseInput,
  type PromptUseResult,
  type RedeemResult,
  type RegisterRequest,
  type SyncBootstrapPage,
  type SyncBootstrapQuery,
  type SyncDevice,
  type SyncDeviceRegistration,
  type SyncPullQuery,
  type SyncPullResult,
  type SyncPushRequest,
  type SyncPushResult,
  type SyncUsagePushRequest,
  type SyncUsagePushResult,
  type SyncStatus,
  type UpdateMcpConnection,
  type UpdatePromptDocument,
  type UpdateWorkbenchSession,
  type WorkbenchSession,
  type WorkbenchSessionListQuery,
  type WorkbenchSessionPage,
} from "@musefold/contracts";

export interface GenerationEvent {
  seq: number;
  type: string;
  payload: Record<string, unknown>;
}

interface Parser<T> {
  parse(value: unknown): T;
}

export class MusefoldCloudError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly requestId: string | null;
  readonly details: Record<string, unknown>;

  constructor(
    code: ApiErrorCode,
    message: string,
    status: number,
    retryable: boolean,
    requestId: string | null,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "MusefoldCloudError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.requestId = requestId;
    this.details = details;
  }
}

export interface MusefoldCloudClient {
  openDesktopSession(accessToken: string): Promise<DesktopAccountSession>;
  getSession(): Promise<AccountSession>;
  login(input: LoginRequest): Promise<AccountSession>;
  register(input: RegisterRequest): Promise<AccountSession>;
  logout(): Promise<void>;
  redeem(code: string): Promise<RedeemResult>;
  listPrompts(query: PromptListQuery): Promise<PromptPage>;
  getPrompt(id: string): Promise<PromptDocument>;
  createPrompt(input: NewPromptDocument): Promise<PromptDocument>;
  updatePrompt(
    id: string,
    input: UpdatePromptDocument,
  ): Promise<PromptDocument>;
  deletePrompt(id: string, expectedVersion: number): Promise<PromptDocument>;
  restorePrompt(id: string, expectedVersion: number): Promise<PromptDocument>;
  usePrompt(id: string, input: PromptUseInput): Promise<PromptUseResult>;
  registerDevice(input: SyncDeviceRegistration): Promise<SyncDevice>;
  bootstrap(input: SyncBootstrapQuery): Promise<SyncBootstrapPage>;
  pull(input: SyncPullQuery): Promise<SyncPullResult>;
  push(input: SyncPushRequest): Promise<SyncPushResult>;
  pushUsage(input: SyncUsagePushRequest): Promise<SyncUsagePushResult>;
  syncStatus(deviceId: string): Promise<SyncStatus>;
  createGeneration(
    input: CreateGenerationInput,
    idempotencyKey: string,
  ): Promise<GenerationJob>;
  getGeneration(id: string): Promise<GenerationJob>;
  streamGenerationEvents(
    id: string,
    afterSeq: number,
    onEvent: (event: GenerationEvent) => void | Promise<void>,
    signal?: AbortSignal,
  ): Promise<void>;
  cancelGeneration(id: string): Promise<GenerationJob>;
  retryGeneration(id: string, idempotencyKey: string): Promise<GenerationJob>;
  deleteGeneration(id: string): Promise<GenerationJob>;
  restoreGeneration(id: string): Promise<GenerationJob>;
  approveGeneration(id: string, token: string): Promise<GenerationJob>;
  listGenerationHistory(
    query: GenerationHistoryQuery,
  ): Promise<GenerationHistoryPage>;
  listWorkbenchSessions(
    query: WorkbenchSessionListQuery,
  ): Promise<WorkbenchSessionPage>;
  getWorkbenchSession(id: string): Promise<WorkbenchSession>;
  createWorkbenchSession(
    input: CreateWorkbenchSession,
  ): Promise<WorkbenchSession>;
  updateWorkbenchSession(
    id: string,
    input: UpdateWorkbenchSession,
  ): Promise<WorkbenchSession>;
  deleteWorkbenchSession(
    id: string,
    expectedVersion: number,
  ): Promise<WorkbenchSession>;
  listConnections(): Promise<McpConnectionPage>;
  updateConnection(
    id: string,
    input: UpdateMcpConnection,
  ): Promise<McpConnectionPage>;
  revokeConnection(id: string): Promise<void>;
}

export interface MusefoldCloudClientOptions {
  fetchImpl?: typeof fetch;
  sessionToken?: string;
  csrfToken?: string;
}

export function createMusefoldCloudClient(
  baseUrl: string,
  options: MusefoldCloudClientOptions = {},
): MusefoldCloudClient {
  const base = normalizeBaseUrl(baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  let sessionToken = options.sessionToken ?? null;
  let csrfToken = options.csrfToken ?? null;

  async function request<T>(
    path: string,
    init: RequestInit,
    parser: Parser<T>,
    csrf = false,
  ): Promise<T> {
    if (csrf && !csrfToken)
      throw new MusefoldCloudError(
        "AUTH_SESSION_EXPIRED",
        "会话验证信息缺失，请重新载入账号",
        401,
        false,
        null,
      );
    const response = await fetchImpl(`${base}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        ...(csrf ? { "X-Musefold-CSRF": csrfToken! } : {}),
        ...init.headers,
      },
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const parsed = apiErrorResponseSchema.safeParse(payload);
      if (parsed.success) {
        throw new MusefoldCloudError(
          parsed.data.error.code,
          parsed.data.error.message,
          response.status,
          parsed.data.error.retryable,
          parsed.data.error.requestId,
          parsed.data.error.details,
        );
      }
      throw new MusefoldCloudError(
        "INTERNAL_ERROR",
        `请求失败（${response.status}）`,
        response.status,
        response.status >= 500,
        null,
      );
    }
    if (response.status === 204) return parser.parse(undefined);
    return parser.parse(await response.json());
  }

  async function streamGenerationEvents(
    id: string,
    afterSeq: number,
    onEvent: (event: GenerationEvent) => void | Promise<void>,
    signal?: AbortSignal,
  ): Promise<void> {
    const response = await fetchImpl(
      `${base}/generations/${encodeURIComponent(id)}/events?after=${Math.max(0, Math.trunc(afterSeq))}`,
      {
        credentials: "include",
        signal,
        headers: {
          Accept: "text/event-stream",
          "Last-Event-ID": String(Math.max(0, Math.trunc(afterSeq))),
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
      },
    );
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const parsed = apiErrorResponseSchema.safeParse(payload);
      if (parsed.success) {
        throw new MusefoldCloudError(
          parsed.data.error.code,
          parsed.data.error.message,
          response.status,
          parsed.data.error.retryable,
          parsed.data.error.requestId,
          parsed.data.error.details,
        );
      }
      throw new MusefoldCloudError(
        "INTERNAL_ERROR",
        `请求失败（${response.status}）`,
        response.status,
        response.status >= 500,
        null,
      );
    }
    if (!response.body) return;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let lineBuffer = "";
    let eventId: number | null = null;
    let eventType = "message";
    let dataLines: string[] = [];

    const dispatch = async () => {
      if (eventId === null || dataLines.length === 0) {
        eventId = null;
        eventType = "message";
        dataLines = [];
        return;
      }
      const data = dataLines.join("\n");
      let payload: Record<string, unknown>;
      try {
        const parsed = JSON.parse(data) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
          throw new Error("invalid event payload");
        payload = parsed as Record<string, unknown>;
      } catch {
        throw new MusefoldCloudError(
          "INTERNAL_ERROR",
          "生成事件数据无效",
          502,
          true,
          null,
        );
      }
      await onEvent({ seq: eventId, type: eventType, payload });
      eventId = null;
      eventType = "message";
      dataLines = [];
    };

    const processLine = async (rawLine: string) => {
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      if (line === "") {
        await dispatch();
        return;
      }
      if (line.startsWith(":")) return;
      const separator = line.indexOf(":");
      const field = separator < 0 ? line : line.slice(0, separator);
      const value = separator < 0 ? "" : line.slice(separator + 1).replace(/^ /, "");
      if (field === "id") {
        const parsed = Number(value);
        eventId = Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
      } else if (field === "event") {
        eventType = value || "message";
      } else if (field === "data") {
        dataLines.push(value);
      }
    };

    try {
      while (true) {
        const next = await reader.read();
        lineBuffer += decoder.decode(next.value ?? new Uint8Array(), {
          stream: !next.done,
        });
        const lines = lineBuffer.split("\n");
        lineBuffer = lines.pop() ?? "";
        for (const line of lines) await processLine(line);
        if (next.done) break;
      }
      if (lineBuffer) await processLine(lineBuffer);
      await dispatch();
    } finally {
      reader.releaseLock();
    }
  }

  async function accountRequest(
    path: string,
    body?: unknown,
  ): Promise<AccountSession> {
    const session = await request(
      path,
      body === undefined ? {} : { method: "POST", body: JSON.stringify(body) },
      accountSessionSchema,
    );
    csrfToken = session.csrfToken;
    return session;
  }

  return {
    async openDesktopSession(accessToken) {
      const result = await request(
        "/auth/device-session",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
        },
        desktopAccountSessionSchema,
      );
      sessionToken = result.sessionToken;
      csrfToken = result.csrfToken;
      return result;
    },
    getSession: () => accountRequest("/auth/me"),
    login: (input) =>
      accountRequest("/auth/login", loginRequestSchema.parse(input)),
    register: (input) =>
      accountRequest("/auth/register", registerRequestSchema.parse(input)),
    async logout() {
      await request(
        "/auth/logout",
        { method: "POST" },
        { parse: () => undefined },
        true,
      );
      csrfToken = null;
    },
    redeem: (code) =>
      request(
        "/auth/redeem",
        {
          method: "POST",
          body: JSON.stringify(redeemRequestSchema.parse({ code })),
        },
        redeemResultSchema,
        true,
      ),
    listPrompts(query) {
      const parsed = promptListQuerySchema.parse(query);
      const search = new URLSearchParams();
      if (parsed.q) search.set("q", parsed.q);
      if (parsed.cursor) search.set("cursor", parsed.cursor);
      search.set("limit", String(parsed.limit));
      search.set("includeDeleted", String(parsed.includeDeleted));
      search.set("sort", parsed.sort);
      if (parsed.folderId !== undefined)
        search.set("folderId", parsed.folderId ?? "");
      if (parsed.tagIds?.length) search.set("tagIds", parsed.tagIds.join(","));
      if (parsed.pinnedOnly !== undefined)
        search.set("pinnedOnly", String(parsed.pinnedOnly));
      return request(`/prompts?${search.toString()}`, {}, promptPageSchema);
    },
    getPrompt: (id) =>
      request(`/prompts/${encodeURIComponent(id)}`, {}, promptDocumentSchema),
    createPrompt: (input) =>
      request(
        "/prompts",
        {
          method: "POST",
          body: JSON.stringify(newPromptDocumentSchema.parse(input)),
        },
        promptDocumentSchema,
        true,
      ),
    updatePrompt: (id, input) =>
      request(
        `/prompts/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          body: JSON.stringify(updatePromptDocumentSchema.parse(input)),
        },
        promptDocumentSchema,
        true,
      ),
    deletePrompt: (id, expectedVersion) =>
      request(
        `/prompts/${encodeURIComponent(id)}`,
        { method: "DELETE", body: JSON.stringify({ expectedVersion }) },
        promptDocumentSchema,
        true,
      ),
    restorePrompt: (id, expectedVersion) =>
      request(
        `/prompts/${encodeURIComponent(id)}/restore`,
        { method: "POST", body: JSON.stringify({ expectedVersion }) },
        promptDocumentSchema,
        true,
      ),
    usePrompt: (id, input) =>
      request(
        `/prompts/${encodeURIComponent(id)}/use`,
        {
          method: "POST",
          body: JSON.stringify(promptUseInputSchema.parse(input)),
        },
        promptUseResultSchema,
        true,
      ),
    registerDevice: (input) =>
      request(
        "/sync/devices",
        {
          method: "POST",
          body: JSON.stringify(syncDeviceRegistrationSchema.parse(input)),
        },
        syncDeviceSchema,
        true,
      ),
    bootstrap(input) {
      const parsed = syncBootstrapQuerySchema.parse(input);
      const search = new URLSearchParams({
        entity: parsed.entity,
        limit: String(parsed.limit),
      });
      if (parsed.after) search.set("after", parsed.after);
      return request(
        `/sync/bootstrap?${search.toString()}`,
        {},
        syncBootstrapPageSchema,
      );
    },
    pull(input) {
      const parsed = syncPullQuerySchema.parse(input);
      const search = new URLSearchParams({
        cursor: parsed.cursor,
        limit: String(parsed.limit),
      });
      if (parsed.deviceId) search.set("deviceId", parsed.deviceId);
      return request(
        `/sync/pull?${search.toString()}`,
        {},
        syncPullResultSchema,
      );
    },
    push: (input) =>
      request(
        "/sync/push",
        {
          method: "POST",
          body: JSON.stringify(syncPushRequestSchema.parse(input)),
        },
        syncPushResultSchema,
        true,
      ),
    pushUsage: (input) =>
      request(
        "/sync/usage",
        {
          method: "POST",
          body: JSON.stringify(syncUsagePushRequestSchema.parse(input)),
        },
        syncUsagePushResultSchema,
        true,
      ),
    syncStatus: (deviceId) =>
      request(
        `/sync/status?deviceId=${encodeURIComponent(deviceId)}`,
        {},
        syncStatusSchema,
      ),
    createGeneration: (input, idempotencyKey) =>
      request(
        "/generations",
        {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body: JSON.stringify(createGenerationInputSchema.parse(input)),
        },
        generationJobSchema,
        true,
      ),
    getGeneration: (id) =>
      request(
        `/generations/${encodeURIComponent(id)}`,
        {},
        generationJobSchema,
      ),
    streamGenerationEvents,
    cancelGeneration: (id) =>
      request(
        `/generations/${encodeURIComponent(id)}/cancel`,
        { method: "POST" },
        generationJobSchema,
        true,
      ),
    retryGeneration: (id, idempotencyKey) =>
      request(
        `/generations/${encodeURIComponent(id)}/retry`,
        {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
        },
        generationJobSchema,
        true,
      ),
    deleteGeneration: (id) =>
      request(
        `/generations/${encodeURIComponent(id)}`,
        { method: "DELETE" },
        generationJobSchema,
        true,
      ),
    restoreGeneration: (id) =>
      request(
        `/generations/${encodeURIComponent(id)}/restore`,
        { method: "POST" },
        generationJobSchema,
        true,
      ),
    approveGeneration: (id, token) =>
      request(
        `/approvals/${encodeURIComponent(id)}`,
        { method: "POST", body: JSON.stringify({ token }) },
        generationJobSchema,
        true,
      ),
    listGenerationHistory(query) {
      const parsed = generationHistoryQuerySchema.parse(query);
      const search = new URLSearchParams({
        limit: String(parsed.limit),
        includeDeleted: String(parsed.includeDeleted),
      });
      if (parsed.cursor) search.set("cursor", parsed.cursor);
      if (parsed.sessionId) search.set("sessionId", parsed.sessionId);
      return request(
        `/generations?${search.toString()}`,
        {},
        generationHistoryPageSchema,
      );
    },
    listWorkbenchSessions(query) {
      const parsed = workbenchSessionListQuerySchema.parse(query);
      const search = new URLSearchParams({
        limit: String(parsed.limit),
        includeArchived: String(parsed.includeArchived),
        includeDeleted: String(parsed.includeDeleted),
      });
      if (parsed.cursor) search.set("cursor", parsed.cursor);
      return request(
        `/workbench/sessions?${search.toString()}`,
        {},
        workbenchSessionPageSchema,
      );
    },
    getWorkbenchSession: (id) =>
      request(
        `/workbench/sessions/${encodeURIComponent(id)}`,
        {},
        workbenchSessionSchema,
      ),
    createWorkbenchSession: (input) =>
      request(
        "/workbench/sessions",
        {
          method: "POST",
          body: JSON.stringify(createWorkbenchSessionSchema.parse(input)),
        },
        workbenchSessionSchema,
        true,
      ),
    updateWorkbenchSession: (id, input) =>
      request(
        `/workbench/sessions/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          body: JSON.stringify(updateWorkbenchSessionSchema.parse(input)),
        },
        workbenchSessionSchema,
        true,
      ),
    deleteWorkbenchSession: (id, expectedVersion) =>
      request(
        `/workbench/sessions/${encodeURIComponent(id)}`,
        { method: "DELETE", body: JSON.stringify({ expectedVersion }) },
        workbenchSessionSchema,
        true,
      ),
    listConnections: () => request("/connections", {}, mcpConnectionPageSchema),
    updateConnection: (id, input) =>
      request(
        `/connections/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          body: JSON.stringify(updateMcpConnectionSchema.parse(input)),
        },
        mcpConnectionPageSchema,
        true,
      ),
    revokeConnection: async (id) => {
      await request(
        `/connections/${encodeURIComponent(id)}`,
        { method: "DELETE" },
        { parse: () => undefined },
        true,
      );
    },
  };
}

function normalizeBaseUrl(input: string): string {
  const value = input.trim().replace(/\/+$/, "");
  if (value.startsWith("/")) return value;
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("Musefold Cloud URL must use HTTP or HTTPS");
  return url.toString().replace(/\/+$/, "");
}
