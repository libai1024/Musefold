import {
  accountSessionSchema,
  cloudGenerationRequestSchema,
  generationJobSchema,
  promptListQuerySchema,
  promptPageSchema,
  type AccountSession,
  type CloudGenerationRequest,
  type GenerationJob,
  type LoginRequest,
  type PromptListQuery,
  type PromptPage,
} from '@musefold/contracts';
import { WebGatewayError, type WebGateway } from './runtime';

const generatedFixtureUrl = '/__musefold-fixture/skill-ref-pause-map.jpeg';

const fixtureSession = accountSessionSchema.parse({
  account: {
    id: 'fixture-account',
    username: 'musefold',
    displayName: '未像用户',
    quota: 186,
    quotaUnit: '点',
    canGenerate: true,
  },
});

const fixturePrompts = promptPageSchema.parse({
  items: [
    {
      id: 'prompt-paper-poster',
      title: '留白纸感海报',
      description: '暖白纸张、印刷颗粒与克制的单色锚点。',
      content: '将主题处理为一张竖版编辑海报，大面积暖白留白，主体是一个小型视觉事件，保留纸张纤维、网点与轻微套印偏移，使用一个钴蓝色锚点。',
      negative: '商业广告，密集拼贴，霓虹，3D 标题，水印',
      folderId: null,
      tags: ['海报', '纸感'],
      modelId: null,
      params: null,
      isPinned: true,
      usageCount: 24,
      version: 3,
      createdAt: '2026-08-14T08:00:00.000Z',
      updatedAt: '2026-08-17T08:00:00.000Z',
      deletedAt: null,
    },
    {
      id: 'prompt-night-architecture',
      title: '夜色建筑摄影',
      description: '湿润街面与安静的人造光。',
      content: '雨后的夜间建筑摄影，低机位，湿润街面反射窗内暖光，克制的深青天空，真实建筑材质，画面安静且具有清晰空间层次。',
      negative: '过度霓虹，赛博朋克文字，强光晕，人物特写',
      folderId: null,
      tags: ['摄影', '建筑'],
      modelId: null,
      params: null,
      isPinned: false,
      usageCount: 11,
      version: 1,
      createdAt: '2026-08-15T10:00:00.000Z',
      updatedAt: '2026-08-16T14:00:00.000Z',
      deletedAt: null,
    },
    {
      id: 'prompt-glass-still-life',
      title: '玻璃静物',
      description: '自然窗光下的透明材质研究。',
      content: '透明玻璃器皿静物，清晨自然窗光，白色工作台，清晰折射和柔和投影，色彩只来自一片深绿色叶子，写实产品摄影。',
      negative: '彩色背景，复杂道具，浮夸高光，文字，Logo',
      folderId: null,
      tags: ['静物', '摄影'],
      modelId: null,
      params: null,
      isPinned: false,
      usageCount: 7,
      version: 2,
      createdAt: '2026-08-12T07:30:00.000Z',
      updatedAt: '2026-08-15T09:20:00.000Z',
      deletedAt: null,
    },
  ],
  nextCursor: null,
});

export class FixtureWebGateway implements WebGateway {
  readonly mode = 'fixture' as const;
  private signedIn = true;
  private readonly jobs = new Map<string, GenerationJob>();
  private readonly createdAt = new Map<string, number>();

  async getSession(): Promise<AccountSession> {
    await pause(180);
    if (!this.signedIn) throw new WebGatewayError('AUTH_REQUIRED', '请登录 Musefold');
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
    const items = needle
      ? fixturePrompts.items.filter((prompt) => [
          prompt.title,
          prompt.description ?? '',
          prompt.content,
          ...prompt.tags,
        ].some((value) => value.toLocaleLowerCase().includes(needle)))
      : fixturePrompts.items;
    return { items: items.slice(0, parsed.limit), nextCursor: null };
  }

  async createGeneration(input: CloudGenerationRequest, _idempotencyKey: string): Promise<GenerationJob> {
    await pause(220);
    const request = cloudGenerationRequestSchema.parse(input);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const job = generationJobSchema.parse({
      id,
      status: 'queued',
      progress: 4,
      request,
      assets: [],
      error: null,
      createdAt: now,
      startedAt: null,
      finishedAt: null,
    });
    this.jobs.set(id, job);
    this.createdAt.set(id, Date.now());
    return job;
  }

  async getGeneration(id: string): Promise<GenerationJob> {
    await pause(120);
    const job = this.jobs.get(id);
    if (!job) throw new WebGatewayError('GENERATION_NOT_FOUND', '生成任务不存在');
    if (job.status === 'cancelled' || job.status === 'succeeded') return job;

    const elapsed = Date.now() - (this.createdAt.get(id) ?? Date.now());
    const now = new Date().toISOString();
    const next = elapsed > 2_600
      ? generationJobSchema.parse({
          ...job,
          status: 'succeeded',
          progress: 100,
          assets: [{
            id: `${id}-asset`,
            url: generatedFixtureUrl,
            mimeType: 'image/jpeg',
            width: 686,
            height: 1144,
            byteSize: 205_824,
            expiresAt: '2026-09-16T08:00:00.000Z',
          }],
          startedAt: job.startedAt ?? now,
          finishedAt: now,
        })
      : generationJobSchema.parse({
          ...job,
          status: 'running',
          progress: Math.min(88, Math.max(12, Math.round(elapsed / 30))),
          startedAt: job.startedAt ?? now,
        });
    this.jobs.set(id, next);
    return next;
  }

  async cancelGeneration(id: string): Promise<GenerationJob> {
    await pause(180);
    const job = this.jobs.get(id);
    if (!job) throw new WebGatewayError('GENERATION_NOT_FOUND', '生成任务不存在');
    const next = generationJobSchema.parse({
      ...job,
      status: 'cancelled',
      finishedAt: new Date().toISOString(),
    });
    this.jobs.set(id, next);
    return next;
  }
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
