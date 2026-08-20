import Store from 'electron-store';
import { ulid } from 'ulid';
import { AI_CONNECTION_STORE_NAME } from '@musefold/core/constants';
import type {
  AiConnectionCapabilities,
  AiConnectionPreset,
  AiConnectionProfile,
  CreateAiConnectionInput,
  UpdateAiConnectionInput,
} from '@shared/types/ai';
import { ElectronAiSecretKeychain, type AiSecretKeychain } from '../security/ai-keychain';
import { AccountError } from '../account/errors';

function defaultCapabilities(routeKind: AiConnectionProfile['routeKind']): AiConnectionCapabilities {
  return {
    modelDiscovery: 'unknown',
    supportedStructuredOutputModes: ['json-schema', 'json-object', 'json-text'],
    preferredStructuredOutputMode: routeKind === 'gateway' ? 'json-object' : 'json-schema',
    cancellation: true,
    streaming: false,
    lastValidatedAt: null,
  };
}

export const AI_CONNECTION_PRESETS: readonly AiConnectionPreset[] = [
  {
    id: 'tvt',
    name: 'TvT AI 中转站',
    routeKind: 'gateway',
    baseUrl: 'https://ai.tvt.wiki/v1',
    model: 'gpt-5.4-mini',
    hint: '推荐 · 与图片生成共用同一个 TvT Key；文本联调首选 gpt-5.4-mini，可刷新模型换 gpt-5.5 等',
    recommended: true,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    routeKind: 'direct',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    hint: 'DeepSeek OpenAI-compatible API',
  },
  {
    id: 'kimi',
    name: 'Kimi',
    routeKind: 'direct',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    hint: 'Moonshot AI OpenAI-compatible API',
  },
  {
    id: 'glm',
    name: 'GLM',
    routeKind: 'direct',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
    hint: '智谱 OpenAI-compatible API',
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    routeKind: 'direct',
    baseUrl: 'https://api.minimaxi.com/v1',
    model: 'MiniMax-M2.1',
    hint: 'MiniMax OpenAI-compatible API',
  },
  {
    id: 'litellm',
    name: 'LiteLLM',
    routeKind: 'gateway',
    baseUrl: 'http://localhost:4000/v1',
    model: 'default',
    hint: '连接用户或团队自行部署的 LiteLLM 网关',
  },
  {
    id: 'new-api',
    name: 'New API',
    routeKind: 'gateway',
    baseUrl: 'http://localhost:3000/v1',
    model: 'default',
    hint: '连接用户或团队自行部署的 New API 网关',
  },
  {
    id: 'custom',
    name: '自定义兼容接口',
    routeKind: 'gateway',
    baseUrl: 'https://example.com/v1',
    model: 'model-id',
    hint: '任意 OpenAI-compatible Chat Completions 接口',
  },
] as const;

interface PersistedAiConnection extends Omit<AiConnectionProfile, 'hasKey' | 'keySuffix' | 'managedBy'> {
  /** 旧 electron-store 记录没有该字段，读取时归一为 null。 */
  managedBy?: 'account' | null;
}

interface ConnectionStoreShape {
  connections: Record<string, PersistedAiConnection>;
  activeId: string | null;
}

interface ConnectionStoreBackend {
  get(key: 'connections'): Record<string, PersistedAiConnection>;
  get(key: 'activeId'): string | null;
  set(key: 'connections', value: Record<string, PersistedAiConnection>): void;
  set(key: 'activeId', value: string | null): void;
}

export interface AiConnectionStoreOptions {
  store?: ConnectionStoreBackend;
  secrets?: AiSecretKeychain;
  idFactory?: () => string;
  now?: () => number;
}

export function normalizeAiBaseUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error('Base URL 不是有效地址');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Base URL 只支持 http 或 https');
  }
  if (url.username || url.password) throw new Error('Base URL 不能包含用户名或密码');
  if (url.search || url.hash) throw new Error('Base URL 不能包含查询参数或片段');
  url.pathname = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

function normalizedName(value: string): string {
  const name = value.trim();
  if (!name) throw new Error('连接名称不能为空');
  if (name.length > 80) throw new Error('连接名称不能超过 80 字');
  return name;
}

function normalizedModel(value: string): string {
  const model = value.trim();
  if (!model) throw new Error('模型 ID 不能为空');
  if (model.length > 200) throw new Error('模型 ID 不能超过 200 字');
  return model;
}

export class AiConnectionStore {
  private readonly store: ConnectionStoreBackend;
  private readonly secrets: AiSecretKeychain;
  private readonly idFactory: () => string;
  private readonly now: () => number;

  constructor(options: AiConnectionStoreOptions = {}) {
    this.store = options.store ?? new Store<ConnectionStoreShape>({
      name: AI_CONNECTION_STORE_NAME,
      defaults: { connections: {}, activeId: null },
    });
    this.secrets = options.secrets ?? new ElectronAiSecretKeychain();
    this.idFactory = options.idFactory ?? ulid;
    this.now = options.now ?? Date.now;
  }

  private records(): Record<string, PersistedAiConnection> {
    return this.store.get('connections') ?? {};
  }

  private profile(record: PersistedAiConnection): AiConnectionProfile {
    return {
      ...structuredClone(record),
      managedBy: record.managedBy === 'account' ? 'account' : null,
      isActive: this.store.get('activeId') === record.id,
      hasKey: this.secrets.has(record.id),
      keySuffix: this.secrets.suffix(record.id),
    };
  }

  list(): AiConnectionProfile[] {
    return Object.values(this.records())
      .sort((left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name))
      .map((record) => this.profile(record));
  }

  get(id: string): AiConnectionProfile | null {
    const record = this.records()[id];
    return record ? this.profile(record) : null;
  }

  require(id: string): AiConnectionProfile {
    const profile = this.get(id);
    if (!profile) throw new Error('AI 连接不存在');
    return profile;
  }

  create(input: CreateAiConnectionInput): AiConnectionProfile {
    const id = this.idFactory();
    const now = this.now();
    const records = this.records();
    const record: PersistedAiConnection = {
      id,
      name: normalizedName(input.name),
      routeKind: input.routeKind,
      protocol: 'openai-compatible',
      presetId: input.presetId ?? 'custom',
      baseUrl: normalizeAiBaseUrl(input.baseUrl),
      model: normalizedModel(input.model),
      capabilities: defaultCapabilities(input.routeKind),
      isActive: false,
      managedBy: null,
      createdAt: now,
      updatedAt: now,
    };
    this.store.set('connections', { ...records, [id]: record });
    if (input.isActive || !this.store.get('activeId')) this.store.set('activeId', id);
    return this.require(id);
  }

  update(id: string, patch: UpdateAiConnectionInput): AiConnectionProfile {
    const records = this.records();
    const current = records[id];
    if (!current) throw new Error('AI 连接不存在');
    if (current.managedBy === 'account') {
      throw new AccountError('ACCOUNT/MANAGED_READONLY', '账号 Agent 模型由 Musefold 固定管理');
    }
    const nextRouteKind = patch.routeKind ?? current.routeKind;
    const next: PersistedAiConnection = {
      ...current,
      ...(patch.name !== undefined ? { name: normalizedName(patch.name) } : {}),
      ...(patch.routeKind !== undefined ? { routeKind: patch.routeKind } : {}),
      ...(patch.presetId !== undefined ? { presetId: patch.presetId } : {}),
      ...(patch.baseUrl !== undefined ? { baseUrl: normalizeAiBaseUrl(patch.baseUrl) } : {}),
      ...(patch.model !== undefined ? { model: normalizedModel(patch.model) } : {}),
      ...((patch.baseUrl !== undefined || patch.model !== undefined || patch.routeKind !== undefined)
        ? { capabilities: defaultCapabilities(nextRouteKind) }
        : {}),
      updatedAt: this.now(),
    };
    this.store.set('connections', { ...records, [id]: next });
    if (patch.isActive) this.store.set('activeId', id);
    return this.require(id);
  }

  delete(id: string): void {
    const records = this.records();
    if (!records[id]) throw new Error('AI 连接不存在');
    if (records[id].managedBy === 'account') {
      throw new AccountError('ACCOUNT/MANAGED_READONLY', '此配置由账号管理，退出登录后会自动移除');
    }
    const next = { ...records };
    delete next[id];
    this.store.set('connections', next);
    this.secrets.delete(id);
    if (this.store.get('activeId') === id) {
      const replacement = Object.values(next).sort((left, right) => right.updatedAt - left.updatedAt)[0];
      this.store.set('activeId', replacement?.id ?? null);
    }
  }

  setActive(id: string): AiConnectionProfile {
    this.require(id);
    this.store.set('activeId', id);
    return this.require(id);
  }

  saveKey(id: string, apiKey: string): AiConnectionProfile {
    const profile = this.require(id);
    if (profile.managedBy === 'account') {
      throw new AccountError('ACCOUNT/MANAGED_READONLY', '账号托管令牌不能手动修改');
    }
    this.secrets.save(id, apiKey);
    return this.require(id);
  }

  deleteKey(id: string): AiConnectionProfile {
    const profile = this.require(id);
    if (profile.managedBy === 'account') {
      throw new AccountError('ACCOUNT/MANAGED_READONLY', '账号托管令牌不能手动删除');
    }
    this.secrets.delete(id);
    return this.require(id);
  }

  /**
   * account-service 专用：幂等创建/更新账号托管连接。没有活动连接时才自动激活。
   * 不走公开 create/update/saveKey，避免托管写守卫被内部编排绕成多段不原子操作。
   */
  upsertManagedAccount(
    existingId: string | null,
    input: { name: string; baseUrl: string; model: string; apiKey: string },
  ): AiConnectionProfile {
    const records = this.records();
    const existing = existingId ? records[existingId] : undefined;
    const fallback = Object.values(records).find((record) => record.managedBy === 'account');
    const current = existing?.managedBy === 'account' ? existing : fallback;
    const id = current?.id ?? this.idFactory();
    const activeId = this.store.get('activeId');
    const shouldActivate = !activeId || activeId === id;
    const now = this.now();
    const record: PersistedAiConnection = {
      id,
      name: normalizedName(input.name),
      routeKind: 'gateway',
      protocol: 'openai-compatible',
      presetId: 'account',
      baseUrl: normalizeAiBaseUrl(input.baseUrl),
      model: normalizedModel(input.model),
      capabilities: current?.capabilities ?? defaultCapabilities('gateway'),
      isActive: false,
      managedBy: 'account',
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };
    this.store.set('connections', { ...records, [id]: record });
    this.secrets.save(id, input.apiKey);
    if (shouldActivate) this.store.set('activeId', id);
    return this.require(id);
  }

  /** account-service 专用：回收指定（或全部遗留）账号托管连接。 */
  removeManagedAccount(existingId: string | null): void {
    const records = this.records();
    let ids = Object.values(records)
      .filter((record) => record.managedBy === 'account' && (!existingId || record.id === existingId))
      .map((record) => record.id);
    // 本机 session id 可能因崩溃/手工迁移失效；找不到指定行时回收全部托管遗留。
    if (ids.length === 0 && existingId) {
      ids = Object.values(records)
        .filter((record) => record.managedBy === 'account')
        .map((record) => record.id);
    }
    if (ids.length === 0) return;

    const next = { ...records };
    for (const id of ids) {
      delete next[id];
      this.secrets.delete(id);
    }
    this.store.set('connections', next);
    if (ids.includes(this.store.get('activeId') ?? '')) {
      const replacement = Object.values(next).sort((left, right) => right.updatedAt - left.updatedAt)[0];
      this.store.set('activeId', replacement?.id ?? null);
    }
  }

  loadKey(id: string): string {
    this.require(id);
    const key = this.secrets.load(id);
    if (!key) throw new Error('尚未配置 API Key');
    return key;
  }

  updateCapabilities(id: string, capabilities: Partial<AiConnectionCapabilities>): AiConnectionProfile {
    const records = this.records();
    const current = records[id];
    if (!current) throw new Error('AI 连接不存在');
    const next = {
      ...current,
      capabilities: { ...current.capabilities, ...capabilities },
      updatedAt: this.now(),
    };
    this.store.set('connections', { ...records, [id]: next });
    return this.require(id);
  }
}

let singleton: AiConnectionStore | null = null;

export function getAiConnectionStore(): AiConnectionStore {
  singleton ??= new AiConnectionStore();
  return singleton;
}
