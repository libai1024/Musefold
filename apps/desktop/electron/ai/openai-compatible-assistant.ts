import { generateText } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { appError } from '@musefold/domain/app-result';
import type { AiConnectionProfile, AiTextModelInfo } from '@musefold/desktop-contracts/ai';

const REQUEST_TIMEOUT_MS = 90_000;
const MODEL_DISCOVERY_TIMEOUT_MS = 15_000;

type GenerateFunction = (options: Record<string, unknown>) => Promise<unknown>;

export interface OpenAiCompatibleAssistantOptions {
  connection: AiConnectionProfile;
  apiKey: string;
  generate?: GenerateFunction;
  fetch?: typeof fetch;
}

function statusCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const status = (error as Record<string, unknown>).statusCode ?? (error as Record<string, unknown>).status;
  return typeof status === 'number' ? status : undefined;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : '未知错误';
}

function errorName(error: unknown): string {
  return error && typeof error === 'object' && typeof (error as { name?: unknown }).name === 'string'
    ? (error as { name: string }).name
    : '';
}

function transportErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const record = error as Record<string, unknown>;
  if (typeof record.code === 'string') return record.code;
  const cause = record.cause;
  return cause && typeof cause === 'object' && typeof (cause as { code?: unknown }).code === 'string'
    ? (cause as { code: string }).code
    : undefined;
}

export function classifyAiError(
  error: unknown,
  signal?: AbortSignal,
  context: { managedByAccount?: boolean } = {},
) {
  const status = statusCode(error);
  const name = errorName(error);
  const message = messageOf(error);
  const code = transportErrorCode(error);
  if (signal?.aborted || name === 'AbortError' || /aborted|cancelled|canceled/i.test(message)) {
    return appError('CANCELLED', 'AI 操作已取消');
  }
  if (context.managedByAccount && (code === 'insufficient_user_quota' || /用户额度不足|余额不足|配额不足/i.test(message))) {
    return appError('ACCOUNT_QUOTA', '账号余额不足，请输入兑换码后重试', {
      retryable: true,
      recoveryAction: 'redeem',
      details: { status },
    });
  }
  if (context.managedByAccount && (code === 'model_not_found' || /No available channel for model|model_not_found/i.test(message))) {
    return appError('ACCOUNT_MODEL_NOT_FOUND', '模型暂不可用，请刷新模型列表后重试', {
      retryable: true,
      recoveryAction: 'refresh-models',
      details: { status },
    });
  }
  if (context.managedByAccount && (status === 401 || status === 403)) {
    return appError('ACCOUNT_AUTH', '账号令牌失效，重新登录即可恢复', {
      recoveryAction: 'relogin',
      details: { status },
    });
  }
  if (status === 401 || status === 403) {
    return appError('AUTH_REQUIRED', 'API Key 无效或没有访问权限', {
      recoveryAction: 'configure-ai',
      details: { status },
    });
  }
  if (status === 404 || /model.*(not found|unsupported|不存在|不支持)/i.test(message)) {
    return appError('MODEL_UNSUPPORTED', '当前连接不支持所选模型，请检查模型 ID', {
      recoveryAction: 'configure-ai',
      details: { status },
    });
  }
  if (status === 408 || /timeout|timed out|超时/i.test(message)) {
    return appError('TIMEOUT', 'AI 请求超时，请稍后重试', { retryable: true, recoveryAction: 'retry' });
  }
  if (status === 429) {
    return appError('NETWORK_ERROR', '请求过于频繁或额度不足，请稍后重试', {
      retryable: true,
      recoveryAction: 'retry',
      details: { status },
    });
  }
  if ((status && status >= 500) || name === 'TypeError' || /fetch failed|network|ECONN|ENOTFOUND/i.test(message)) {
    return appError('NETWORK_ERROR', '无法连接 AI 服务，请检查地址和网络', {
      retryable: true,
      recoveryAction: 'retry',
      details: { status, errorName: name || undefined, transportCode: code },
    });
  }
  if (/NoObjectGenerated|NoOutputGenerated|TypeValidation|JSONParse/i.test(name) || /schema validation|invalid json|could not parse/i.test(message)) {
    return appError('OUTPUT_SCHEMA_INVALID', 'AI 返回的结构无法读取，请重试', {
      retryable: true,
      recoveryAction: 'retry',
    });
  }
  return appError('UNKNOWN', 'AI 服务返回异常，请重试或检查连接配置', {
    retryable: true,
    recoveryAction: 'retry',
    details: { status, errorName: name || undefined },
  });
}

export class OpenAiCompatibleAssistant {
  private readonly generate: GenerateFunction;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OpenAiCompatibleAssistantOptions) {
    this.generate = options.generate ?? (generateText as unknown as GenerateFunction);
    this.fetchImpl = options.fetch ?? fetch;
  }

  private provider() {
    return createOpenAICompatible({
      name: `musefold-${this.options.connection.id}`,
      baseURL: this.options.connection.baseUrl,
      apiKey: this.options.apiKey,
      supportsStructuredOutputs: false,
      fetch: this.fetchImpl,
    });
  }

  languageModel() {
    return this.provider()(this.options.connection.model);
  }

  async listModels(signal?: AbortSignal): Promise<AiTextModelInfo[]> {
    const requestSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(MODEL_DISCOVERY_TIMEOUT_MS)])
      : AbortSignal.timeout(MODEL_DISCOVERY_TIMEOUT_MS);
    const response = await this.fetchImpl(`${this.options.connection.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${this.options.apiKey}`, Accept: 'application/json' },
      signal: requestSignal,
    });
    if (!response.ok) throw Object.assign(new Error(`模型列表请求失败（HTTP ${response.status}）`), { statusCode: response.status });
    const payload = await response.json() as { data?: unknown };
    if (!Array.isArray(payload.data)) throw new Error('模型列表响应格式不受支持');
    return payload.data.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const model = item as Record<string, unknown>;
      if (typeof model.id !== 'string' || !model.id.trim()) return [];
      return [{
        id: model.id,
        name: typeof model.name === 'string' && model.name.trim() ? model.name : model.id,
        ...(typeof model.owned_by === 'string' ? { ownedBy: model.owned_by } : {}),
      }];
    }).sort((left, right) => left.id.localeCompare(right.id));
  }

  async validateConnection(signal?: AbortSignal): Promise<{ models: AiTextModelInfo[]; modelDiscovery: 'available' | 'manual' }> {
    let models: AiTextModelInfo[] = [];
    let modelDiscovery: 'available' | 'manual' = 'manual';
    try {
      models = await this.listModels(signal);
      modelDiscovery = 'available';
    } catch (error) {
      const status = statusCode(error);
      if (status === 401 || status === 403 || signal?.aborted) throw error;
    }
    await this.generate({
      model: this.languageModel(),
      instructions: '这是连接检测。不要调用工具，只回复 OK。',
      prompt: 'OK',
      maxOutputTokens: 8,
      temperature: 0,
      maxRetries: 0,
      timeout: REQUEST_TIMEOUT_MS,
      abortSignal: signal,
    });
    return { models, modelDiscovery };
  }
}
