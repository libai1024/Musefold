import {
  accountSessionSchema,
  cloudGenerationRequestSchema,
  createGenerationInputSchema,
  mcpConnectionPageSchema,
  type CreateGenerationInput,
  generationJobSchema,
  type GenerationHistoryPage,
  promptListQuerySchema,
  promptPageSchema,
  promptDocumentSchema,
  type PromptDocument,
  type NewPromptDocument,
  type PromptUseInput,
  type PromptUseResult,
  type McpConnectionPage,
  type WorkbenchSession,
  type WorkbenchSessionPage,
  type CreateWorkbenchSession,
  type UpdateWorkbenchSession,
  type WorkbenchSessionListQuery,
  type GenerationHistoryQuery,
  type AccountSession,
  type GenerationJob,
  type LoginRequest,
  type PromptListQuery,
  type PromptPage,
  type UpdatePromptDocument,
  updatePromptDocumentSchema,
  workbenchSessionListQuerySchema,
  workbenchSessionSchema,
} from "@musefold/contracts";
import { WebGatewayError, type WebGateway } from "./runtime";
import type { GenerationEvent } from "@musefold/cloud-client";

const generatedFixtureUrl = "/__musefold-fixture/skill-ref-pause-map.jpeg";
const fixtureFailurePrompt = "视觉回归模拟失败";
const fixtureCreatedAt = "2026-08-12T07:30:00.000Z";
const fixtureUpdatedAt = "2026-08-17T08:00:00.000Z";

function fixtureTag(id: string, name: string) {
  return {
    id,
    name,
    group: null,
    color: null,
    version: 1,
    createdAt: fixtureCreatedAt,
    updatedAt: fixtureUpdatedAt,
    deletedAt: null,
  };
}

const fixtureSession = accountSessionSchema.parse({
  account: {
    id: "fixture-account",
    username: "musefold",
    displayName: "未像用户",
    quota: 9_300_000,
    quotaUnit: "点",
    canGenerate: true,
  },
  csrfToken: "fixture-csrf-token-0000000000000000",
});

const fixturePrompts = promptPageSchema.parse({
  items: [
    {
      id: "prompt-paper-poster",
      title: "留白纸感海报",
      description: "暖白纸张、印刷颗粒与克制的单色锚点。",
      content:
        "将主题处理为一张竖版编辑海报，大面积暖白留白，主体是一个小型视觉事件，保留纸张纤维、网点与轻微套印偏移，使用一个钴蓝色锚点。",
      negative: "商业广告，密集拼贴，霓虹，3D 标题，水印",
      folderId: null,
      tags: [fixtureTag("tag-poster", "海报"), fixtureTag("tag-paper", "纸感")],
      modelId: null,
      params: null,
      rating: 5,
      isPinned: true,
      pinOrder: 1,
      usageCount: 24,
      lastUsedAt: "2026-08-17T08:00:00.000Z",
      source: "manual",
      sourceUrl: null,
      version: 3,
      createdAt: "2026-08-14T08:00:00.000Z",
      updatedAt: "2026-08-17T08:00:00.000Z",
      deletedAt: null,
    },
    {
      id: "prompt-night-architecture",
      title: "夜色建筑摄影",
      description: "湿润街面与安静的人造光。",
      content:
        "雨后的夜间建筑摄影，低机位，湿润街面反射窗内暖光，克制的深青天空，真实建筑材质，画面安静且具有清晰空间层次。",
      negative: "过度霓虹，赛博朋克文字，强光晕，人物特写",
      folderId: null,
      tags: [
        fixtureTag("tag-photo", "摄影"),
        fixtureTag("tag-architecture", "建筑"),
      ],
      modelId: null,
      params: null,
      rating: 4,
      isPinned: false,
      pinOrder: null,
      usageCount: 11,
      lastUsedAt: "2026-08-16T14:00:00.000Z",
      source: "manual",
      sourceUrl: null,
      version: 1,
      createdAt: "2026-08-15T10:00:00.000Z",
      updatedAt: "2026-08-16T14:00:00.000Z",
      deletedAt: null,
    },
    {
      id: "prompt-glass-still-life",
      title: "玻璃静物",
      description: "自然窗光下的透明材质研究。",
      content:
        "透明玻璃器皿静物，清晨自然窗光，白色工作台，清晰折射和柔和投影，色彩只来自一片深绿色叶子，写实产品摄影。",
      negative: "彩色背景，复杂道具，浮夸高光，文字，Logo",
      folderId: null,
      tags: [
        fixtureTag("tag-still-life", "静物"),
        fixtureTag("tag-photo", "摄影"),
      ],
      modelId: null,
      params: null,
      rating: 4,
      isPinned: false,
      pinOrder: null,
      usageCount: 7,
      lastUsedAt: "2026-08-15T09:20:00.000Z",
      source: "generation",
      sourceUrl: null,
      version: 2,
      createdAt: "2026-08-12T07:30:00.000Z",
      updatedAt: "2026-08-15T09:20:00.000Z",
      deletedAt: null,
    },
  ],
  nextCursor: null,
});

const fixtureConnections = mcpConnectionPageSchema.parse({
  items: [
    {
      id: "fixture-connection-1",
      clientName: "Musefold Preview Client",
      scopes: [
        "account:read",
        "prompts:read",
        "skills:read",
        "generations:read",
        "generations:write",
      ],
      mode: "ask_each_time",
      maxPointsPerGeneration: 1000,
      maxPointsPerDay: 5000,
      spentPointsToday: 1000,
      reservedPointsToday: 0,
      status: "active",
      createdAt: fixtureCreatedAt,
      lastUsedAt: fixtureUpdatedAt,
    },
  ],
});

export class FixtureWebGateway implements WebGateway {
  readonly mode = "fixture" as const;
  private signedIn = true;
  private readonly jobs = new Map<string, GenerationJob>();
  private readonly createdAt = new Map<string, number>();
  private readonly workbenchSessions = new Map<string, WorkbenchSession>();
  private connections: McpConnectionPage =
    mcpConnectionPageSchema.parse(fixtureConnections);

  async getSession(): Promise<AccountSession> {
    await pause(180);
    if (!this.signedIn)
      throw new WebGatewayError("AUTH_REQUIRED", "请登录 Musefold");
    return fixtureSession;
  }

  async login(_input: LoginRequest): Promise<AccountSession> {
    await pause(280);
    this.signedIn = true;
    return fixtureSession;
  }

  async logout(): Promise<void> {
    await pause(160);
    this.signedIn = false;
  }

  async listPrompts(query: PromptListQuery): Promise<PromptPage> {
    await pause(180);
    const parsed = promptListQuerySchema.parse(query);
    const needle = parsed.q?.toLocaleLowerCase();
    const visible = fixturePrompts.items.filter(
      (prompt) => parsed.includeDeleted || prompt.deletedAt === null,
    );
    const items = needle
      ? visible.filter((prompt) =>
          [
            prompt.title,
            prompt.description ?? "",
            prompt.content,
            ...prompt.tags.map((tag) => tag.name),
          ].some((value) => value.toLocaleLowerCase().includes(needle)),
        )
      : visible;
    return { items: items.slice(0, parsed.limit), nextCursor: null };
  }

  async getPrompt(id: string): Promise<PromptDocument> {
    await pause(70);
    return findFixturePrompt(id);
  }

  async createPrompt(input: NewPromptDocument): Promise<PromptDocument> {
    await pause(180);
    const now = new Date().toISOString();
    const prompt = promptPageSchema.shape.items.element.parse({
      ...input,
      id: crypto.randomUUID(),
      description: input.description ?? null,
      negative: input.negative ?? null,
      folderId: input.folderId ?? null,
      tags: [],
      version: 1,
      pinOrder: input.isPinned ? 1 : null,
      usageCount: 0,
      lastUsedAt: null,
      source: input.source ?? "manual",
      sourceUrl: input.sourceUrl ?? null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    fixturePrompts.items.unshift(prompt);
    return prompt;
  }

  async updatePrompt(
    id: string,
    rawInput: UpdatePromptDocument,
  ): Promise<PromptDocument> {
    await pause(120);
    const input = updatePromptDocumentSchema.parse(rawInput);
    const current = findFixturePrompt(id);
    assertFixtureVersion(current, input.expectedVersion);
    const now = new Date().toISOString();
    const next = promptDocumentSchema.parse({
      ...current,
      ...input,
      tags:
        input.tagIds === undefined
          ? current.tags
          : current.tags.filter((tag) => input.tagIds?.includes(tag.id)),
      version: current.version + 1,
      updatedAt: now,
    });
    replaceFixturePrompt(next);
    return next;
  }

  async deletePrompt(
    id: string,
    expectedVersion: number,
  ): Promise<PromptDocument> {
    await pause(100);
    return changeFixturePromptDeletedState(id, expectedVersion, true);
  }

  async restorePrompt(
    id: string,
    expectedVersion: number,
  ): Promise<PromptDocument> {
    await pause(100);
    return changeFixturePromptDeletedState(id, expectedVersion, false);
  }

  async usePrompt(
    id: string,
    _input: PromptUseInput,
  ): Promise<PromptUseResult> {
    await pause(90);
    const index = fixturePrompts.items.findIndex((prompt) => prompt.id === id);
    if (index < 0)
      throw new WebGatewayError("PROMPT_NOT_FOUND", "提示词不存在");
    const prompt = {
      ...fixturePrompts.items[index],
      usageCount: fixturePrompts.items[index].usageCount + 1,
      lastUsedAt: new Date().toISOString(),
    };
    fixturePrompts.items[index] = prompt;
    return { prompt, recorded: true };
  }

  async createGeneration(
    input: CreateGenerationInput,
    _idempotencyKey: string,
  ): Promise<GenerationJob> {
    await pause(220);
    const parsedInput = createGenerationInputSchema.parse(input);
    const request = cloudGenerationRequestSchema.parse(parsedInput);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const job = generationJobSchema.parse({
      id,
      sessionId: parsedInput.sessionId ?? null,
      parentRunId: parsedInput.parentRunId ?? null,
      promptId: request.promptId ?? null,
      actorType: "web",
      approvalStatus: "not_required",
      status: "queued",
      progress: 4,
      request,
      providerModel: null,
      costPoints: null,
      assets: [],
      error: null,
      createdAt: now,
      startedAt: null,
      finishedAt: null,
      deletedAt: null,
    });
    this.jobs.set(id, job);
    this.createdAt.set(id, Date.now());
    return job;
  }

  async getGeneration(id: string): Promise<GenerationJob> {
    await pause(120);
    const job = this.jobs.get(id);
    if (!job)
      throw new WebGatewayError("GENERATION_NOT_FOUND", "生成任务不存在");
    if (["cancelled", "succeeded", "failed"].includes(job.status)) return job;

    const elapsed = Date.now() - (this.createdAt.get(id) ?? Date.now());
    const now = new Date().toISOString();
    const next =
      job.request.prompt === fixtureFailurePrompt && elapsed > 1_200
        ? generationJobSchema.parse({
            ...job,
            status: "failed",
            progress: 100,
            error: {
              code: "INTERNAL_ERROR",
              message: "视觉回归模拟失败",
            },
            startedAt: job.startedAt ?? now,
            finishedAt: now,
          })
        : elapsed > 2_600
        ? generationJobSchema.parse({
            ...job,
            status: "succeeded",
            progress: 100,
            assets: [
              {
                id: `${id}-asset`,
                url: generatedFixtureUrl,
                mimeType: "image/jpeg",
                width: 686,
                height: 1144,
                byteSize: 205_824,
                expiresAt: "2026-09-16T08:00:00.000Z",
              },
            ],
            startedAt: job.startedAt ?? now,
            finishedAt: now,
          })
        : generationJobSchema.parse({
            ...job,
            status: "running",
            progress: Math.min(88, Math.max(12, Math.round(elapsed / 30))),
            startedAt: job.startedAt ?? now,
          });
    this.jobs.set(id, next);
    return next;
  }

  async streamGenerationEvents(
    id: string,
    afterSeq: number,
    onEvent: (event: GenerationEvent) => void | Promise<void>,
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) return;
    const job = await this.getGeneration(id);
    if (signal?.aborted) return;
    await onEvent({
      seq: Math.max(1, Math.trunc(afterSeq) + 1),
      type: `generation.${job.status}`,
      payload: { status: job.status, progress: job.progress },
    });
  }

  async cancelGeneration(id: string): Promise<GenerationJob> {
    await pause(180);
    const job = this.jobs.get(id);
    if (!job)
      throw new WebGatewayError("GENERATION_NOT_FOUND", "生成任务不存在");
    const next = generationJobSchema.parse({
      ...job,
      status: "cancelled",
      finishedAt: new Date().toISOString(),
    });
    this.jobs.set(id, next);
    return next;
  }

  async retryGeneration(
    id: string,
    _idempotencyKey: string,
  ): Promise<GenerationJob> {
    await pause(180);
    const current = this.jobs.get(id);
    if (!current)
      throw new WebGatewayError("GENERATION_NOT_FOUND", "生成任务不存在");
    const retryId = crypto.randomUUID();
    const now = new Date().toISOString();
    const retry = generationJobSchema.parse({
      ...current,
      id: retryId,
      parentRunId: current.id,
      approvalStatus: "not_required",
      status: "queued",
      progress: 4,
      costPoints: null,
      assets: [],
      error: null,
      createdAt: now,
      startedAt: null,
      finishedAt: null,
      deletedAt: null,
    });
    this.jobs.set(retryId, retry);
    this.createdAt.set(retryId, Date.now());
    return retry;
  }

  async deleteGeneration(id: string): Promise<GenerationJob> {
    await pause(100);
    return this.changeGenerationDeletedState(id, true);
  }

  async restoreGeneration(id: string): Promise<GenerationJob> {
    await pause(100);
    return this.changeGenerationDeletedState(id, false);
  }

  async approveGeneration(id: string, _token: string): Promise<GenerationJob> {
    await pause(160);
    const job = this.jobs.get(id);
    if (!job)
      throw new WebGatewayError("GENERATION_NOT_FOUND", "生成任务不存在");
    const next = generationJobSchema.parse({
      ...job,
      status: "queued",
      approvalStatus: "approved",
    });
    this.jobs.set(id, next);
    this.createdAt.set(id, Date.now());
    return next;
  }

  async listGenerationHistory(
    query: GenerationHistoryQuery,
  ): Promise<GenerationHistoryPage> {
    await pause(100);
    const includeDeleted = query.includeDeleted ?? false;
    return {
      items: [...this.jobs.values()]
        .filter(
          (job) =>
            (includeDeleted || !job.deletedAt) &&
            (!query.sessionId || job.sessionId === query.sessionId),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      nextCursor: null,
    };
  }

  async listWorkbenchSessions(
    query: WorkbenchSessionListQuery,
  ): Promise<WorkbenchSessionPage> {
    await pause(80);
    const parsed = workbenchSessionListQuerySchema.parse(query);
    return {
      items: [...this.workbenchSessions.values()]
        .filter(
          (session) =>
            (parsed.includeArchived || !session.archivedAt) &&
            (parsed.includeDeleted || !session.deletedAt),
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, parsed.limit),
      nextCursor: null,
    };
  }

  async getWorkbenchSession(id: string): Promise<WorkbenchSession> {
    await pause(60);
    const session = this.workbenchSessions.get(id);
    if (!session)
      throw new WebGatewayError(
        "WORKBENCH_SESSION_NOT_FOUND",
        "工作台会话不存在",
      );
    return session;
  }

  async createWorkbenchSession(
    input: CreateWorkbenchSession,
  ): Promise<WorkbenchSession> {
    await pause(100);
    const now = new Date().toISOString();
    const session: WorkbenchSession = {
      id: crypto.randomUUID(),
      title: input.title ?? "未命名创作",
      draft: {
        prompt: input.draft?.prompt ?? "",
        negative: input.draft?.negative ?? "",
        params: input.draft?.params ?? {},
        promptReferenceIds: input.draft?.promptReferenceIds ?? [],
      },
      version: 1,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      deletedAt: null,
    };
    this.workbenchSessions.set(session.id, session);
    return session;
  }

  async updateWorkbenchSession(
    id: string,
    input: UpdateWorkbenchSession,
  ): Promise<WorkbenchSession> {
    await pause(80);
    const current = this.workbenchSessions.get(id);
    if (!current)
      throw new WebGatewayError(
        "WORKBENCH_SESSION_NOT_FOUND",
        "工作台会话不存在",
      );
    if (current.version !== input.expectedVersion)
      throw new WebGatewayError(
        "WORKBENCH_VERSION_CONFLICT",
        "工作台草稿已更新",
        { current },
      );
    const next: WorkbenchSession = {
      ...current,
      title: input.title ?? current.title,
      draft: input.draft ?? current.draft,
      archivedAt:
        input.archived === undefined
          ? current.archivedAt
          : input.archived
            ? new Date().toISOString()
            : null,
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    };
    this.workbenchSessions.set(id, next);
    return next;
  }

  async deleteWorkbenchSession(
    id: string,
    expectedVersion: number,
  ): Promise<WorkbenchSession> {
    await pause(80);
    const current = this.workbenchSessions.get(id);
    if (!current)
      throw new WebGatewayError(
        "WORKBENCH_SESSION_NOT_FOUND",
        "工作台会话不存在",
      );
    if (current.version !== expectedVersion)
      throw new WebGatewayError(
        "WORKBENCH_VERSION_CONFLICT",
        "工作台草稿已更新",
        { current },
      );
    const now = new Date().toISOString();
    const next = workbenchSessionSchema.parse({
      ...current,
      deletedAt: now,
      version: current.version + 1,
      updatedAt: now,
    });
    this.workbenchSessions.set(id, next);
    return next;
  }

  async listConnections(): Promise<McpConnectionPage> {
    await pause(80);
    return mcpConnectionPageSchema.parse(this.connections);
  }

  async updateConnection(
    id: string,
    input: Parameters<WebGateway["updateConnection"]>[1],
  ): Promise<McpConnectionPage> {
    await pause(80);
    this.connections = mcpConnectionPageSchema.parse({
      items: this.connections.items.map((connection) =>
        connection.id !== id
          ? connection
          : {
              ...connection,
              mode: input.mode ?? connection.mode,
              maxPointsPerGeneration:
                input.maxPointsPerGeneration ??
                connection.maxPointsPerGeneration,
              maxPointsPerDay:
                input.maxPointsPerDay ?? connection.maxPointsPerDay,
              status:
                input.suspended === undefined
                  ? connection.status
                  : input.suspended
                    ? "suspended"
                    : "active",
            },
      ),
    });
    return this.connections;
  }

  async revokeConnection(id: string): Promise<void> {
    await pause(80);
    this.connections = mcpConnectionPageSchema.parse({
      items: this.connections.items.map((connection) =>
        connection.id === id
          ? { ...connection, status: "revoked" }
          : connection,
      ),
    });
  }

  private changeGenerationDeletedState(
    id: string,
    deleted: boolean,
  ): GenerationJob {
    const current = this.jobs.get(id);
    if (!current)
      throw new WebGatewayError("GENERATION_NOT_FOUND", "生成任务不存在");
    const next = generationJobSchema.parse({
      ...current,
      deletedAt: deleted ? new Date().toISOString() : null,
    });
    this.jobs.set(id, next);
    return next;
  }
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

function findFixturePrompt(id: string): PromptDocument {
  const prompt = fixturePrompts.items.find((candidate) => candidate.id === id);
  if (!prompt) throw new WebGatewayError("PROMPT_NOT_FOUND", "提示词不存在");
  return prompt;
}

function assertFixtureVersion(
  prompt: PromptDocument,
  expectedVersion: number,
): void {
  if (prompt.version !== expectedVersion) {
    throw new WebGatewayError(
      "PROMPT_VERSION_CONFLICT",
      "提示词已被其他设备更新，请先合并变更",
      { current: prompt },
    );
  }
}

function replaceFixturePrompt(prompt: PromptDocument): void {
  const index = fixturePrompts.items.findIndex(
    (candidate) => candidate.id === prompt.id,
  );
  if (index < 0) throw new WebGatewayError("PROMPT_NOT_FOUND", "提示词不存在");
  fixturePrompts.items[index] = prompt;
}

function changeFixturePromptDeletedState(
  id: string,
  expectedVersion: number,
  deleted: boolean,
): PromptDocument {
  const current = findFixturePrompt(id);
  assertFixtureVersion(current, expectedVersion);
  const now = new Date().toISOString();
  const next = promptDocumentSchema.parse({
    ...current,
    version: current.version + 1,
    updatedAt: now,
    deletedAt: deleted ? now : null,
  });
  replaceFixturePrompt(next);
  return next;
}
