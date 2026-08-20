// electron/providers/wukong-studio.ts
// WukongStudioProvider —— 悟空云「生图组」异步创作台 (wkapi.vip)
// 流程：POST /submit → GET /poll(轮询) → 下载公网 url → 落盘 PNG
// 关键规则（docs/10）：
//   - Base = https://wkapi.vip/api/v1/studio；model 字段承载 product_id（如 image_gptImage2）
//   - size 是「比例」("1:1"/"16:9")，不是像素
//   - 判定成功：status ∈ succeeded/... 且存在 url/result[0]；忽略 message（成功任务也可能带"失败"文案）
//   - poll 必须带 Authorization；间隔 2–3s；超时 120–180s

import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { ulid } from 'ulid';
import type { GenerateImageRequest, GenerateImageResult, ImageProgressHandler, ModelInfo, ValidationResult } from '@musefold/desktop-contracts/providers';
import type { ProviderType } from '@musefold/desktop-contracts/enums';
import { getPaths } from '../runtime';
import { BaseProvider } from './base';
import { createLogger } from '../runtime';
import { parseRetryAfter, withRetry } from './retry';
import { parseExpectedSize, readImagePixelSize } from './image-dimensions';
import { cnyCentsToPoints } from '@musefold/core/pricing';

const logger = createLogger('provider:wukong');

const POLL_INTERVAL_MS = 2500;
const POLL_TIMEOUT_MS = 180_000;
const SUBMIT_TIMEOUT_MS = 30_000;
const POLL_REQ_TIMEOUT_MS = 20_000;

const SUCCESS_STATUS = ['succeeded', 'success', 'completed', 'done'];
const FAILED_STATUS = ['failed', 'error'];

interface StudioError {
  code: string;
  message: string;
  status?: number;
  retryAfterMs?: number;
}

/** HTTP/网络错误 → 归一化 code（对齐 shared/errors.ts） */
function normalizeStudioError(status: number | undefined, message: string, retryAfterMs?: number): StudioError {
  let code = 'UNKNOWN';
  const lower = message.toLowerCase();
  if (status === 400) code = 'BAD_REQUEST';
  else if (status === 401 || status === 403) {
    // 悟空：分组不对通常也是 401/无渠道
    code = /group|分组|channel|渠道/.test(lower) ? 'WRONG_GROUP' : 'AUTH';
  } else if (status === 402) code = 'NO_BALANCE';
  else if (status === 429) code = 'RATE_LIMIT';
  else if (status && status >= 500) code = 'SERVER';
  else if (/balance|余额|quota|配额/.test(lower)) code = 'NO_BALANCE';
  return { code, message, status, retryAfterMs };
}

export class WukongStudioProvider extends BaseProvider {
  readonly id: string;
  readonly type: ProviderType = 'wukong-studio';
  readonly name: string;

  constructor(id: string, baseUrl: string, model: string, name: string) {
    super(baseUrl, model, name);
    this.id = id;
    this.name = name;
  }

  private authHeaders(json = false): Record<string, string> {
    const h: Record<string, string> = { Authorization: `Bearer ${this.getApiKey()}` };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  async listModels(): Promise<ModelInfo[]> {
    // 从 catalog 拉取图片产品；失败则返回当前配置的 product_id
    try {
      const res = await fetch(`${this.baseUrl}/catalog`, { signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`catalog ${res.status}`);
      const data = (await res.json()) as { main?: { image?: Array<{ id: string; name?: string; desc?: string; price?: string }> } };
      const images = data.main?.image ?? [];
      if (images.length) {
        return images.map((p) => ({ id: p.id, name: p.name ?? p.id, description: p.price ?? p.desc }));
      }
    } catch (err) {
      logger.warn('catalog 拉取失败，回退默认产品', (err as Error).message);
    }
    return [{ id: this.model, name: this.model, description: '当前配置产品' }];
  }

  async validateConnection(): Promise<ValidationResult> {
    // 1) catalog 连通性 + 产品存在性（可匿名）
    let productOk: boolean;
    try {
      const res = await fetch(`${this.baseUrl}/catalog`, { signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS) });
      if (!res.ok) {
        const code = res.status >= 500 ? 'SERVER' : res.status === 429 ? 'RATE_LIMIT' : 'NETWORK';
        return { ok: false, code, message: `无法连接创作台（catalog ${res.status}）` };
      }
      const data = (await res.json()) as { main?: { image?: Array<{ id: string }> } };
      const images = data.main?.image ?? [];
      productOk = images.some((p) => p.id === this.model);
    } catch (err) {
      logger.warn('validate catalog 失败', (err as Error).message);
      return {
        ok: false,
        code: 'NETWORK',
        message: `无法连接创作台：${(err as Error).message}`,
      };
    }

    // 2) 鉴权探测：用假 task_id poll，401/403 判定 Key/分组问题；其余视为 Key 可用
    try {
      const res = await fetch(`${this.baseUrl}/poll?task_id=__probe__`, {
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(POLL_REQ_TIMEOUT_MS),
      });
      if (res.status === 401 || res.status === 403) {
        const body = await res.text().catch(() => '');
        const ne = normalizeStudioError(res.status, body);
        return {
          ok: false,
          code: ne.code,
          message:
            ne.code === 'WRONG_GROUP'
              ? 'Key 需属于「生图组」分组'
              : ne.code === 'NO_BALANCE'
                ? '账户余额不足'
                : 'API Key 无效或已失效',
        };
      }
      if (res.status === 402) {
        return { ok: false, code: 'NO_BALANCE', message: '账户余额不足' };
      }
      if (res.status === 429) {
        return { ok: false, code: 'RATE_LIMIT', message: '请求过于频繁' };
      }
      // 400/404/200 等都说明 Key 被接受（只是任务不存在）
      return {
        ok: true,
        message: productOk
          ? `连接成功，产品 ${this.model} 可用`
          : `连接成功（未在目录中找到 ${this.model}，仍可尝试生成）`,
      };
    } catch (err) {
      // 探测请求异常：catalog 已通，降级放行
      logger.warn('validate poll 探测异常，降级放行', (err as Error).message);
      return { ok: true, message: '创作台可达（鉴权将在生图时验证）' };
    }
  }

  private async submit(
    prompt: string,
    size: string,
    controller: AbortController,
    onProgress?: ImageProgressHandler,
  ): Promise<{ taskId: string; costPoints?: number }> {
    return withRetry(async (retrySignal) => {
      const res = await fetch(`${this.baseUrl}/submit`, {
        method: 'POST',
        headers: this.authHeaders(true),
        body: JSON.stringify({
          product_id: this.model,
          wait: false,
          payload: { prompt, size },
        }),
        signal: AbortSignal.any([retrySignal, AbortSignal.timeout(SUBMIT_TIMEOUT_MS)]),
      });
      const raw = (await res.json().catch(() => ({}))) as {
        task_id?: string;
        billing?: { yuan?: number; charged?: boolean; request_id?: string };
        message?: string;
        error?: { message?: string };
      };
      if (!res.ok || !raw.task_id) {
        const msg = raw.error?.message ?? raw.message ?? `submit 失败 (${res.status})`;
        const ne = normalizeStudioError(res.status, msg, parseRetryAfter(res.headers.get('retry-after')));
        throw wrap(ne);
      }
      const costPoints = typeof raw.billing?.yuan === 'number'
        ? cnyCentsToPoints(raw.billing.yuan * 100)
        : undefined;
      logger.info('submit ok', `task=${raw.task_id}`, costPoints != null ? `cost=${costPoints}积分` : '', `req=${raw.billing?.request_id ?? '-'}`);
      return { taskId: raw.task_id, costPoints };
    }, { onRetry: onProgress }, controller.signal);
  }

  private async pollOnce(taskId: string, controller: AbortController, onProgress?: ImageProgressHandler): Promise<{ status: string; url?: string }> {
    return withRetry(async (retrySignal) => {
      const res = await fetch(`${this.baseUrl}/poll?task_id=${encodeURIComponent(taskId)}`, {
        headers: this.authHeaders(),
        signal: AbortSignal.any([retrySignal, AbortSignal.timeout(POLL_REQ_TIMEOUT_MS)]),
      });
      const raw = (await res.json().catch(() => ({}))) as {
        status?: string;
        url?: string;
        result?: string[];
        message?: string;
        error?: { message?: string };
      };
      if (!res.ok) {
        const msg = raw.error?.message ?? raw.message ?? `poll 失败 (${res.status})`;
        throw wrap(normalizeStudioError(res.status, msg, parseRetryAfter(res.headers.get('retry-after'))));
      }
      // 判定成功：以 status + url 为准，忽略 message（docs/10 §7.3）
      const status = (raw.status ?? '').toLowerCase();
      const url = raw.url || raw.result?.[0];
      return { status, url };
    }, { onRetry: onProgress }, controller.signal);
  }

  async generateImage(req: GenerateImageRequest, signal?: AbortSignal, onProgress?: ImageProgressHandler): Promise<GenerateImageResult> {
    if (req.referenceImages?.length) {
      const error = new Error('当前服务商暂不支持参考图编辑，请切换到 image2 服务');
      (error as { code?: string }).code = 'IMAGE_EDIT_UNSUPPORTED';
      throw error;
    }
    // IPC 层把任务、历史和文件统一为同一个 id；保留 fallback 兼容直接调用 Provider 的测试/工具。
    const historyId = req.jobId ?? ulid();
    const startTs = Date.now();
    const controller = new AbortController();
    // 把主进程的取消信号并入内部 controller —— submit/poll/下载都监听它
    const onAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    // 悟空用比例；优先 req.aspectRatio，回退到默认比例
    const size = req.aspectRatio ?? '1:1';

    try {
      logger.info('generate 开始', `product=${this.model}`, `ratio=${size}`, `promptLen=${req.prompt.length}`);
      const { taskId, costPoints } = await this.submit(req.prompt, size, controller, onProgress);

      // 轮询直到成功/失败/超时
      let url: string | undefined;
      while (Date.now() - startTs < POLL_TIMEOUT_MS) {
        if (controller.signal.aborted) throw wrap({ code: 'CANCELLED', message: '已取消' });
        const { status, url: got } = await this.pollOnce(taskId, controller, onProgress);
        if (got && (SUCCESS_STATUS.includes(status) || (status && !FAILED_STATUS.includes(status)))) {
          url = got;
          break;
        }
        if (FAILED_STATUS.includes(status) && !got) {
          throw wrap({ code: 'SERVER', message: `任务失败（task=${taskId}）` });
        }
        await sleep(POLL_INTERVAL_MS);
      }

      if (!url) {
        throw wrap({ code: 'TIMEOUT', message: `生成超时（task=${taskId}，可到控制台核对）` });
      }

      // 下载公网 URL → 落盘 PNG
      const imgRes = await fetch(url, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(SUBMIT_TIMEOUT_MS)]) });
      if (!imgRes.ok) throw wrap({ code: 'SERVER', message: `下载结果失败 (${imgRes.status})` });
      const buf = Buffer.from(await imgRes.arrayBuffer());
      const actualSize = readImagePixelSize(buf) ?? undefined;
      const expectedSize = parseExpectedSize(req.size);
      const sizeMismatch = actualSize && expectedSize && (
        actualSize.width !== expectedSize.width || actualSize.height !== expectedSize.height
      )
        ? { expected: req.size, actual: `${actualSize.width}x${actualSize.height}` }
        : undefined;
      if (sizeMismatch) {
        logger.warn(
          '生成尺寸与请求不一致',
          `product=${this.model}`,
          `expected=${sizeMismatch.expected}`,
          `actual=${sizeMismatch.actual}`,
        );
      }

      const paths = getPaths();
      await mkdir(paths.pictures, { recursive: true });
      const imgPath = join(paths.pictures, `${historyId}.png`);
      await writeFile(imgPath, buf);

      const durationMs = Date.now() - startTs;
      logger.info('generate 成功', `task=${taskId}`, `${(durationMs / 1000).toFixed(1)}s`, `${buf.length}B`);
      return {
        historyId,
        status: 'success',
        imagePath: imgPath,
        durationMs,
        cost: costPoints,
        costUnit: 'point',
        costPoints,
        ...(actualSize ? { actualSize } : {}),
        ...(sizeMismatch ? { sizeMismatch } : {}),
      };
    } catch (err) {
      if (controller.signal.aborted || (err as Error)?.message === 'Cancelled') {
        throw wrap({ code: 'CANCELLED', message: '已取消' });
      }
      const code = (err as { code?: string }).code ?? 'UNKNOWN';
      logger.error('generate 失败', `code=${code}`, (err as Error).message);
      throw err;
    } finally {
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }
}

/** 把归一化错误包成带 code/status 的 Error（ipc/images 会读取入库） */
function wrap(ne: StudioError): Error {
  const e = new Error(ne.message);
  (e as { code?: string }).code = ne.code;
  (e as { status?: number }).status = ne.status;
  (e as { retryAfterMs?: number }).retryAfterMs = ne.retryAfterMs;
  return e;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
