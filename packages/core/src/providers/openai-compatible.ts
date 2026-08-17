// electron/providers/openai-compatible.ts
// OpenAICompatibleProvider —— 中转站 / 官方 OpenAI / Azure / OneAPI 通用
// 详见 docs/05-image-generation.md §2.1、§3

import OpenAI from 'openai';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { ulid } from 'ulid';
import type { GenerateImageRequest, GenerateImageResult, ImageProgressHandler, ModelInfo, ValidationResult } from '@shared/types/providers';
import { MAX_REFERENCE_IMAGES } from '@shared/types/providers';
import type { ProviderType } from '@shared/types/enums';
import { getPaths } from '../runtime';
import { createLogger, estimateProviderCost } from '../runtime';
import { BaseProvider } from './base';
import { parseRetryAfter, withRetry } from './retry';
import { LocalImageError, readLocalImage } from './local-image';
import { parseExpectedSize, readImagePixelSize } from './image-dimensions';

const logger = createLogger('provider:openai-compatible');

/** 把错误归一化成带 code + status 的对象，便于上层 IPC 分类 */
function normalizeError(err: unknown): { code: string; message: string; status?: number } {
  const e = err as { status?: number; message?: string; code?: string; error?: { message?: string; code?: string } };
  const status = e.status;
  const message = e.error?.message ?? e.message ?? 'Unknown error';
  const rawCode = (e.error?.code ?? e.code ?? '').toString();
  let code = 'UNKNOWN';
  if (rawCode.startsWith('IMAGE_')) code = rawCode;
  else if (
    rawCode === 'insufficient_user_quota'
    || rawCode === 'insufficient_quota'
    || rawCode === 'billing_hard_limit_reached'
  ) code = 'NO_BALANCE';
  else if (rawCode === 'model_not_found') code = 'MODEL_NOT_FOUND';
  else if (rawCode === 'INVALID_API_KEY' || rawCode === 'API_KEY_REQUIRED') code = 'AUTH';
  else if (status === 400) code = 'BAD_REQUEST';
  else if (status === 401 || status === 403) code = 'AUTH';
  else if (status === 402) code = 'NO_BALANCE';
  else if (status === 429) code = 'RATE_LIMIT';
  else if (status && status >= 500) code = 'SERVER';
  else if (/invalid[_ ]?api[_ ]?key|incorrect api key|auth/i.test(message)) {
    code = 'AUTH';
  } else if (/balance|余额|quota|配额|billing/i.test(message)) {
    code = 'NO_BALANCE';
  } else if (/fetch failed|network|connection error|ECONN|ENOTFOUND|ETIMEDOUT/i.test(message) || rawCode === 'ENOTFOUND') {
    code = 'NETWORK';
  }
  return { code, message, status };
}

export class OpenAICompatibleProvider extends BaseProvider {
  readonly id: string;
  readonly type: ProviderType = 'openai-compatible';
  readonly name: string;

  constructor(id: string, baseUrl: string, model: string, name: string) {
    super(baseUrl, model, name);
    this.id = id;
    this.name = name;
  }

  private getClient(): OpenAI {
    const apiKey = this.getApiKey();
    return new OpenAI({
      apiKey,
      baseURL: this.baseUrl,
      // 由 Musefold 统一负责次数、Retry-After、退避和 UI 进度，避免 SDK 隐式重试绕过工作台状态。
      maxRetries: 0,
      // 不打印 key：OpenAI SDK 内部不暴露请求头，配合主进程不写日志即可
    });
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const { models } = await this.fetchModels();
      return models;
    } catch (err) {
      const ne = normalizeError(err);
      const wrapped = new Error(`模型列表获取失败：${ne.message}`);
      (wrapped as { code?: string }).code = ne.code;
      (wrapped as { status?: number }).status = ne.status;
      throw wrapped;
    }
  }

  async validateConnection(): Promise<ValidationResult> {
    try {
      const client = this.getClient();
      // 优先用 /models 做真实探测（中转站/官方均支持）；失败降级为"已配置即可达"
      try {
        const { models } = await this.fetchModels(client);
        const hasModel = models.some((m) => m.id === this.model);
        return {
          ok: true,
          message: hasModel
            ? `连接成功，模型 ${this.model} 可用（共 ${models.length} 个模型）`
            : `连接成功，共 ${models.length} 个模型（未在列表中找到 ${this.model}，仍可尝试生成）`,
          models,
        };
      } catch (probeErr) {
        const ne = normalizeError(probeErr);
        // 鉴权 / 余额 / 限流直接判定失败并回传 code，供 UI 错误分类引导（TASK-GEN-03）
        if (ne.code === 'AUTH' || ne.code === 'NO_BALANCE' || ne.code === 'RATE_LIMIT') {
          return { ok: false, code: ne.code, message: ne.message };
        }
        // 部分中转站禁用 /models：降级放行，生图时再验
        if (ne.code === 'BAD_REQUEST' || ne.code === 'UNKNOWN' || ne.code === 'SERVER') {
          // 5xx 在探测阶段也可能是 /models 本身不稳，仍降级；真 5xx 生图时会暴露
          if (ne.code === 'SERVER' && (ne.status ?? 0) >= 500) {
            return { ok: false, code: 'SERVER', message: ne.message };
          }
          return { ok: true, message: '已配置（该服务未开放模型列表，将在生图时验证）' };
        }
        return { ok: false, code: ne.code, message: ne.message };
      }
    } catch (err) {
      const ne = normalizeError(err);
      // 无 status 的网络类错误
      const code =
        ne.code !== 'UNKNOWN'
          ? ne.code
          : /fetch|network|ECONN|ENOTFOUND|ETIMEDOUT/i.test(ne.message)
            ? 'NETWORK'
            : 'UNKNOWN';
      return { ok: false, code, message: ne.message };
    }
  }

  private async fetchModels(client = this.getClient()): Promise<{ models: ModelInfo[] }> {
    const list = await client.models.list();
    return {
      models: uniqueModels(
        (list.data ?? []).map((m) => ({
          id: m.id,
          name: m.id,
          description: modelDescription(m),
        })),
      ),
    };
  }

  async generateImage(req: GenerateImageRequest, signal?: AbortSignal, onProgress?: ImageProgressHandler): Promise<GenerateImageResult> {
    // IPC 层把任务、历史和文件统一为同一个 id；保留 fallback 兼容直接调用 Provider 的测试/工具。
    const historyId = req.jobId ?? ulid();
    const startTs = Date.now();

    // 合并外部取消信号与内部重试控制
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    try {
      const result = await withRetry(async (sig) => {
        try {
          if (req.referenceImages?.length) return await this.editImage(req, sig);
          const client = this.getClient();
          return await client.images.generate({
            model: req.model ?? this.model,
            prompt: req.prompt,
            n: req.n,
            size: req.size as unknown as OpenAI.Images.ImageGenerateParams['size'],
            quality: req.quality as 'low' | 'medium' | 'high' | 'auto',
            ...(req.background ? { background: req.background } : {}),
            ...(req.moderation ? { moderation: req.moderation } : {}),
          }, { signal: sig });
        } catch (err) {
          // 必须在 withRetry 内部把 SDK 异常归一化，否则 Retry-After 只能在所有重试结束后才被读取。
          throw enrichRetryError(err);
        }
      }, { onRetry: (progress) => onProgress?.(progress) }, controller.signal);

      // gpt-image 返回 b64_json
      const b64 = result.data?.[0]?.b64_json;
      if (!b64) throw new Error('响应中没有图像数据');

      // 解码写盘
      const paths = getPaths();
      await mkdir(paths.pictures, { recursive: true });
      const imgPath = join(paths.pictures, `${historyId}.png`);
      const imageBuffer = Buffer.from(b64, 'base64');
      const actualSize = readImagePixelSize(imageBuffer) ?? undefined;
      const expectedSize = parseExpectedSize(req.size);
      const sizeMismatch = actualSize && expectedSize && (
        actualSize.width !== expectedSize.width || actualSize.height !== expectedSize.height
      )
        ? { expected: req.size, actual: `${actualSize.width}x${actualSize.height}` }
        : undefined;
      if (sizeMismatch) {
        logger.warn(
          '生成尺寸与请求不一致',
          `model=${req.model ?? this.model}`,
          `expected=${sizeMismatch.expected}`,
          `actual=${sizeMismatch.actual}`,
        );
      }
      await writeFile(imgPath, imageBuffer);

      const cost = estimateProviderCost(this.id, req, extractUsageTokens(result)) ?? undefined;

      return {
        historyId,
        status: 'success',
        imagePath: imgPath,
        durationMs: Date.now() - startTs,
        cost,
        ...(actualSize ? { actualSize } : {}),
        ...(sizeMismatch ? { sizeMismatch } : {}),
      };
    } catch (err) {
      // 用户取消：归一为 CANCELLED，不当作服务端错误
      if (signal?.aborted || (err as Error)?.name === 'AbortError' || (err as Error)?.message === 'Cancelled') {
        const cancelled = new Error('已取消');
        (cancelled as { code?: string }).code = 'CANCELLED';
        throw cancelled;
      }
      const ne = normalizeError(err);
      // 把错误信息附在 Error 上，ipc/images 会读取并入库
      const wrapped = new Error(ne.message);
      (wrapped as { code?: string }).code = ne.code;
      (wrapped as { status?: number }).status = ne.status;
      throw wrapped;
    } finally {
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }

  private async editImage(req: GenerateImageRequest, signal: AbortSignal): Promise<{
    data?: Array<{ b64_json?: string; url?: string }>;
    usage?: { total_tokens?: number; input_tokens?: number; output_tokens?: number };
  }> {
    const references = req.referenceImages ?? [];
    if (references.length === 0) throw new LocalImageError('IMAGE_READ_FAILED', '图片读取失败，请重新选择');
    if (references.length > MAX_REFERENCE_IMAGES) {
      throw new LocalImageError('IMAGE_LIMIT_EXCEEDED', `参考图不能超过 ${MAX_REFERENCE_IMAGES} 张`);
    }
    const images = await Promise.all(references.map((reference) => readLocalImage(reference)));
    const form = new FormData();
    form.append('model', req.model ?? this.model);
    form.append('prompt', req.prompt);
    form.append('n', String(req.n || 1));
    if (req.size !== 'auto') form.append('size', req.size);
    for (const { bytes, image } of images) {
      form.append(
        'image[]',
        new Blob([new Uint8Array(bytes)], { type: image.mimeType }),
        image.name || `reference.${image.mimeType.split('/')[1]}`,
      );
    }

    const response = await fetch(`${this.baseUrl.replace(/\/+$/, '')}/images/edits`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.getApiKey()}` },
      body: form,
      signal,
    });
    const payload = await response.json().catch(() => ({})) as {
      data?: Array<{ b64_json?: string; url?: string }>;
      usage?: { total_tokens?: number; input_tokens?: number; output_tokens?: number };
      error?: { message?: string; code?: string };
      message?: string;
    };
    if (!response.ok) {
      const error = new Error(payload.error?.message ?? payload.message ?? `图片编辑请求失败（HTTP ${response.status}）`);
      (error as { status?: number }).status = response.status;
      (error as { code?: string }).code = payload.error?.code;
      (error as { headers?: Headers }).headers = response.headers;
      throw error;
    }
    return payload;
  }
}

/** 把 SDK 异常变成带 status/retryAfterMs 的 Error，让统一重试器可判断。 */
function enrichRetryError(err: unknown): Error {
  const ne = normalizeError(err);
  const source = err as { headers?: { get?: (name: string) => string | null } };
  const wrapped = new Error(ne.message);
  wrapped.name = (err as { name?: string })?.name ?? 'ProviderError';
  (wrapped as { code?: string }).code = ne.code;
  (wrapped as { status?: number }).status = ne.status;
  if (ne.status === 429) {
    (wrapped as { retryAfterMs?: number }).retryAfterMs = parseRetryAfter(source.headers?.get?.('retry-after'));
  }
  return wrapped;
}

function extractUsageTokens(result: unknown): number | undefined {
  const usage = (result as {
    usage?: {
      total_tokens?: number;
      input_tokens?: number;
      output_tokens?: number;
    };
  })?.usage;
  if (!usage) return undefined;
  if (Number.isFinite(usage.total_tokens)) return usage.total_tokens;
  const input = Number.isFinite(usage.input_tokens) ? usage.input_tokens ?? 0 : 0;
  const output = Number.isFinite(usage.output_tokens) ? usage.output_tokens ?? 0 : 0;
  const total = input + output;
  return total > 0 ? total : undefined;
}

function uniqueModels(models: ModelInfo[]): ModelInfo[] {
  const seen = new Map<string, ModelInfo>();
  for (const model of models) {
    const id = model.id.trim();
    if (!id || seen.has(id)) continue;
    seen.set(id, { ...model, id, name: model.name || id });
  }
  return Array.from(seen.values());
}

function modelDescription(model: unknown): string | undefined {
  const m = model as {
    created?: number;
    created_at?: string | number;
    owned_by?: string;
    type?: string;
    display_name?: string;
  };
  const parts = [m.display_name && m.display_name !== (m as { id?: string }).id ? m.display_name : undefined, m.type, m.owned_by]
    .filter((item): item is string => Boolean(item));
  if (parts.length > 0) return parts.join(' · ');
  const created = m.created_at ?? m.created;
  return created ? `created ${String(created)}` : undefined;
}
