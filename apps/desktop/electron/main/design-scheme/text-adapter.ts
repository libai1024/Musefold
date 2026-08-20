/**
 * v0.3.2 Runtime 的 TextModelAdapter：直接调用 OpenAI 兼容 chat/completions，
 * 不经过 AI SDK 的业务抽象（开发规范 §2.1 / §7.1）。
 *
 * 结构化输出策略：优先 response_format=json_object；校验失败把 zod issues
 * 反馈给模型重试一次，仍失败抛出可解释错误（规范 §3.2）。
 * SSE 流式解析留给运行切片（创建角色的返回是结构化 JSON，无逐字展示价值）。
 */
import type { z } from 'zod';
import type { AiConnectionProfile } from '@musefold/desktop-contracts/ai';

const DEFAULT_TIMEOUT_MS = 120_000;

export interface TextCompletionRequest {
  system: string;
  user: string;
  /** 请求 response_format=json_object；网关不支持时自动降级为纯文本。 */
  jsonMode?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface TextCompletionResult {
  text: string;
  model: string;
}

export interface OpenAiCompatibleTextAdapterOptions {
  connection: AiConnectionProfile;
  apiKey: string;
  fetchImpl?: typeof fetch;
}

interface ChatCompletionResponse {
  model?: string;
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1];
  return (fenced ?? trimmed).trim();
}

function extractBalancedJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export function extractJsonCandidate(text: string): string {
  const unfenced = stripCodeFence(text);
  return extractBalancedJsonObject(unfenced) ?? unfenced;
}

export class OpenAiCompatibleTextAdapter {
  private readonly connection: AiConnectionProfile;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAiCompatibleTextAdapterOptions) {
    this.connection = options.connection;
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  get modelId(): string {
    return this.connection.model;
  }

  get connectionName(): string {
    return this.connection.name;
  }

  async complete(request: TextCompletionRequest): Promise<TextCompletionResult> {
    const timeout = AbortSignal.timeout(request.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
    const endpoint = `${this.connection.baseUrl.replace(/\/$/, '')}/chat/completions`;

    const body: Record<string, unknown> = {
      model: this.connection.model,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.user },
      ],
      stream: false,
    };
    if (request.jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    let response = await this.fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    // 部分网关不支持 response_format，用纯文本重试一次。
    if (!response.ok && request.jsonMode && [400, 404, 415, 422].includes(response.status)) {
      delete body.response_format;
      response = await this.fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      });
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      const error = new Error(`AI 请求失败（${response.status}）：${detail.slice(0, 300)}`);
      (error as Error & { statusCode?: number }).statusCode = response.status;
      throw error;
    }

    const payload = (await response.json()) as ChatCompletionResponse;
    const text = payload.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) {
      throw new Error('AI 返回内容为空');
    }
    return { text, model: payload.model ?? this.connection.model };
  }
}

export interface StructuredCallOptions<T> {
  adapter: OpenAiCompatibleTextAdapter;
  schema: z.ZodType<T>;
  system: string;
  user: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** 用于错误信息，例如「仓库分析」「方案编译」。 */
  label: string;
}

export interface StructuredCallResult<T> {
  value: T;
  model: string;
  retried: boolean;
}

type StructuredAttempt<T> =
  | { ok: true; value: T; model: string }
  | { ok: false; issues: string[] };

/** 结构化角色调用：一次校验失败后带 issues 重试一次（规范 §3.2）。 */
export async function completeStructured<T>(options: StructuredCallOptions<T>): Promise<StructuredCallResult<T>> {
  const attempt = async (extraUser?: string): Promise<StructuredAttempt<T>> => {
    const completion = await options.adapter.complete({
      system: options.system,
      user: extraUser ? `${options.user}\n\n${extraUser}` : options.user,
      jsonMode: true,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(extractJsonCandidate(completion.text));
    } catch {
      return { ok: false, issues: ['返回内容不是可解析的 JSON'] };
    }
    const checked = options.schema.safeParse(parsedJson);
    if (!checked.success) {
      return {
        ok: false,
        issues: checked.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
      };
    }
    return { ok: true, value: checked.data, model: completion.model };
  };

  const first = await attempt();
  if (first.ok) {
    return { value: first.value, model: first.model, retried: false };
  }

  const feedback = [
    '你上一次的返回未通过结构校验，问题如下：',
    ...first.issues.map((issue) => `- ${issue}`),
    '请重新输出完整 JSON（不要包含 Markdown 代码块以外的说明文字）。',
  ].join('\n');
  const second = await attempt(feedback);
  if (second.ok) {
    return { value: second.value, model: second.model, retried: true };
  }
  throw new Error(`${options.label}的 AI 返回两次都未通过校验：${second.issues.slice(0, 3).join('；')}`);
}
