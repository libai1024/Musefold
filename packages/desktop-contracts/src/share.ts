import type { PromptParams } from './models';
import type {
  ImageBackground,
  ImageQuality,
  ImageSize,
  ModerationLevel,
  PromptTarget,
} from './enums';

export const SHARE_PROTOCOL = 'musefold';
export const SHARE_IMPORT_HOST = 'import';
export const SHARE_DEEPLINK_MAX_BYTES = 64 * 1024;
export const SHARE_PREVIEW_MAX_CHARS = 8 * 1024 * 1024;

export type ShareErrorCode =
  | 'INVALID_SHARE_PAYLOAD'
  | 'INVALID_DEEPLINK'
  | 'PAYLOAD_TOO_LARGE';

export interface SharePayload {
  title: string;
  content: string;
  contentNegative?: string;
  params?: PromptParams;
  target?: PromptTarget;
  /** Card-only data URL. Deeplinks deliberately omit this to keep links small. */
  previewDataUrl?: string;
}

export class SharePayloadError extends Error {
  code: ShareErrorCode;

  constructor(code: ShareErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'SharePayloadError';
    this.code = code;
  }
}

const TARGETS = new Set<PromptTarget>([
  'a1111',
  'comfyui',
  'midjourney',
  'flux',
  'sd3',
  'openai',
  'generic',
]);
const SIZES = new Set<ImageSize>(['1024x1024', '1536x1024', '1024x1536', '2048x2048', 'auto']);
const QUALITIES = new Set<ImageQuality>(['low', 'medium', 'high', 'auto']);
const BACKGROUNDS = new Set<ImageBackground>(['auto', 'transparent', 'opaque']);
const MODERATIONS = new Set<ModerationLevel>(['auto', 'low']);

function fail(code: ShareErrorCode, message: string): never {
  throw new SharePayloadError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(
  source: Record<string, unknown>,
  key: string,
  maxLength: number,
): string {
  const value = source[key];
  if (typeof value !== 'string') fail('INVALID_SHARE_PAYLOAD', `${key} 必须是字符串`);
  const trimmed = value.trim();
  if (!trimmed) fail('INVALID_SHARE_PAYLOAD', `${key} 不能为空`);
  if (trimmed.length > maxLength) fail('INVALID_SHARE_PAYLOAD', `${key} 过长`);
  return trimmed;
}

function optionalString(
  source: Record<string, unknown>,
  key: string,
  maxLength: number,
): string | undefined {
  const value = source[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > maxLength) fail('INVALID_SHARE_PAYLOAD', `${key} 过长`);
  return trimmed;
}

function finiteNumber(
  value: unknown,
  min: number,
  max: number,
  integer = false,
): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const clamped = Math.min(max, Math.max(min, value));
  return integer ? Math.round(clamped) : Math.round(clamped * 10) / 10;
}

function stringInSet<T extends string>(value: unknown, allowed: Set<T>): T | undefined {
  return typeof value === 'string' && allowed.has(value as T) ? (value as T) : undefined;
}

function cleanRatio(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed === 'auto') return 'auto';
  return /^\d{1,2}:\d{1,2}$/.test(trimmed) ? trimmed : undefined;
}

function sanitizeParams(input: unknown): PromptParams | undefined {
  if (!isRecord(input)) return undefined;

  const next: PromptParams = { schemaVersion: 1 };
  const schemaVersion = finiteNumber(input.schemaVersion, 1, 99, true);
  if (schemaVersion !== undefined) next.schemaVersion = schemaVersion;

  const sampler = optionalString(input, 'sampler', 120);
  if (sampler) next.sampler = sampler;

  const steps = finiteNumber(input.steps, 1, 150, true);
  if (steps !== undefined) next.steps = steps;

  const cfg = finiteNumber(input.cfg, 0, 30);
  if (cfg !== undefined) next.cfg = cfg;

  const seed = finiteNumber(input.seed, -1, 2_147_483_647, true);
  if (seed !== undefined) next.seed = seed;

  const size = stringInSet(input.size, SIZES);
  if (size) next.size = size;

  const quality = stringInSet(input.quality, QUALITIES);
  if (quality) next.quality = quality;

  const count = finiteNumber(input.n, 1, 10, true);
  if (count !== undefined) next.n = count;

  const background = stringInSet(input.background, BACKGROUNDS);
  if (background) next.background = background;

  const moderation = stringInSet(input.moderation, MODERATIONS);
  if (moderation) next.moderation = moderation;

  const ratioId = cleanRatio(input.ratioId);
  if (ratioId) next.ratioId = ratioId;

  const aspectRatio = cleanRatio(input.aspectRatio);
  if (aspectRatio) next.aspectRatio = aspectRatio;

  const promptTarget = stringInSet(input.promptTarget, TARGETS);
  if (promptTarget) next.promptTarget = promptTarget;

  return next;
}

function sanitizeTarget(value: unknown): PromptTarget | undefined {
  return stringInSet(value, TARGETS);
}

function sanitizePreviewDataUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const trimmed = value.trim();
  if (trimmed.length > SHARE_PREVIEW_MAX_CHARS) {
    fail('PAYLOAD_TOO_LARGE', '预览图过大');
  }
  if (!/^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

export function sanitizeSharePayload(
  input: unknown,
  options: { includePreview?: boolean } = {},
): SharePayload {
  if (!isRecord(input)) fail('INVALID_SHARE_PAYLOAD', '分享内容必须是对象');

  const params = sanitizeParams(input.params);
  const paramTarget = sanitizeTarget(params?.promptTarget);
  const target = sanitizeTarget(input.target) ?? paramTarget;
  if (target && params && !params.promptTarget) params.promptTarget = target;

  const payload: SharePayload = {
    title: requiredString(input, 'title', 160),
    content: requiredString(input, 'content', 40_000),
  };

  const negative = optionalString(input, 'contentNegative', 16_000);
  if (negative) payload.contentNegative = negative;
  if (params) payload.params = params;
  if (target) payload.target = target;

  if (options.includePreview) {
    const previewDataUrl = sanitizePreviewDataUrl(input.previewDataUrl);
    if (previewDataUrl) payload.previewDataUrl = previewDataUrl;
  }

  return payload;
}

export function payloadForDeeplink(input: SharePayload): SharePayload {
  const payload = sanitizeSharePayload(input, { includePreview: false });
  delete payload.previewDataUrl;
  return payload;
}

export function encodeSharePayload(input: SharePayload): string {
  const payload = payloadForDeeplink(input);
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  if (bytes.byteLength > SHARE_DEEPLINK_MAX_BYTES) {
    fail('PAYLOAD_TOO_LARGE', '分享链接内容超过 64KB');
  }
  return bytesToBase64(bytes);
}

export function decodeSharePayload(encoded: string): SharePayload {
  if (typeof encoded !== 'string' || !encoded.trim()) {
    fail('INVALID_DEEPLINK', '缺少 data 参数');
  }
  const data = encoded.trim();
  const maxBase64Length = Math.ceil(SHARE_DEEPLINK_MAX_BYTES / 3) * 4 + 4;
  if (data.length > maxBase64Length) fail('PAYLOAD_TOO_LARGE', '分享链接内容超过 64KB');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length % 4 === 1) {
    fail('INVALID_DEEPLINK', 'data 不是合法 base64');
  }

  const bytes = base64ToBytes(data);
  if (bytes.byteLength > SHARE_DEEPLINK_MAX_BYTES) {
    fail('PAYLOAD_TOO_LARGE', '分享链接内容超过 64KB');
  }

  try {
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return sanitizeSharePayload(JSON.parse(raw), { includePreview: false });
  } catch (error) {
    if (error instanceof SharePayloadError) throw error;
    fail('INVALID_DEEPLINK', 'data 无法解析为分享内容');
  }
}

export function buildShareDeeplink(input: SharePayload): string {
  return `${SHARE_PROTOCOL}://${SHARE_IMPORT_HOST}?data=${encodeURIComponent(
    encodeSharePayload(input),
  )}`;
}

export function parseShareDeeplink(url: string): SharePayload {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    fail('INVALID_DEEPLINK', '不是合法 URL');
  }

  const targetPath = parsed.pathname.replace(/^\/+/, '').toLowerCase();
  const isImportRoute =
    parsed.protocol.toLowerCase() === `${SHARE_PROTOCOL}:` &&
    (parsed.hostname.toLowerCase() === SHARE_IMPORT_HOST || targetPath === SHARE_IMPORT_HOST);
  if (!isImportRoute) fail('INVALID_DEEPLINK', '不是 Musefold 导入链接');

  return decodeSharePayload(parsed.searchParams.get('data') ?? '');
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  if (typeof btoa !== 'undefined') {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.slice(i, i + chunk));
    }
    return btoa(binary);
  }
  fail('INVALID_SHARE_PAYLOAD', '当前环境不支持 base64 编码');
}

function base64ToBytes(data: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(data, 'base64'));
  if (typeof atob !== 'undefined') {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  fail('INVALID_DEEPLINK', '当前环境不支持 base64 解码');
}
