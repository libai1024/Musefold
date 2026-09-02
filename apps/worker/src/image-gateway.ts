import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request as requestHttp, type IncomingMessage } from 'node:http';
import { request as requestHttps } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import type { ParsedCloudGenerationRequest } from '@musefold/contracts';

const MAX_IMAGE_BYTES = 30 * 1024 * 1024;

const NON_PUBLIC_IPV4_ADDRESSES = new BlockList();
const NON_PUBLIC_IPV6_ADDRESSES = new BlockList();
const GLOBAL_IPV6_ADDRESSES = new BlockList();
GLOBAL_IPV6_ADDRESSES.addSubnet('2000::', 3, 'ipv6');
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  NON_PUBLIC_IPV4_ADDRESSES.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 96],
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
  ['5f00::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const) {
  NON_PUBLIC_IPV6_ADDRESSES.addSubnet(network, prefix, 'ipv6');
}

interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface GeneratedImage {
  bytes: Buffer;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
}

/** 已从对象存储取回的参考图字节(与 request.referenceImages 同序)。 */
export interface ReferenceImageInput {
  bytes: Buffer;
  mimeType: string;
  name: string;
}

export interface GenerateImageOptions {
  signal?: AbortSignal;
  /** Called immediately before the provider generation request is sent. */
  beforeUpstreamRequest?: () => boolean | Promise<boolean>;
}

export class UpstreamImageError extends Error {
  constructor(
    readonly code: 'quota' | 'rejected' | 'unknown',
    message: string,
  ) {
    super(message);
    this.name = 'UpstreamImageError';
  }
}

export async function generateImage(
  baseUrl: string,
  apiKey: string,
  request: ParsedCloudGenerationRequest,
  references: ReferenceImageInput[] = [],
  options: GenerateImageOptions = {},
): Promise<GeneratedImage[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  const abortExternal = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener('abort', abortExternal, { once: true });
  try {
    const base = baseUrl.replace(/\/+$/, '');
    const providerOrigin = readHttpOrigin(baseUrl);
    const prompt = request.negative
      ? `${request.prompt}\n\nNegative prompt: ${request.negative}`
      : request.prompt;
    // 带参考图走图片编辑通道(multipart image[],与桌面 OpenAICompatibleProvider 同款)。
    const endpoint = references.length
      ? `${base}/v1/images/edits`
      : `${base}/v1/images/generations`;
    const init: RequestInit = references.length
      ? {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
          body: buildEditForm(prompt, request, references),
          signal: controller.signal,
        }
      : {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            model: 'musefold-image-pro',
            prompt,
            size: request.size === 'auto' ? undefined : request.size,
            quality: request.quality === 'auto' ? undefined : request.quality,
            n: request.count,
          }),
          signal: controller.signal,
        };
    if (options.beforeUpstreamRequest && !(await options.beforeUpstreamRequest())) {
      throw new UpstreamImageError('unknown', '生成租约已失效');
    }
    const response = await fetch(endpoint, init);
    const payload = (await response.json().catch(() => ({}))) as {
      data?: Array<{ b64_json?: string; url?: string }>;
      error?: { message?: string; code?: string };
      message?: string;
    };
    if (!response.ok) {
      const message =
        payload.error?.message ?? payload.message ?? `上游生图失败（HTTP ${response.status}）`;
      if (response.status === 402 || /quota|balance|余额|配额/i.test(message))
        throw new UpstreamImageError('quota', message);
      if (response.status >= 400 && response.status < 500)
        throw new UpstreamImageError('rejected', message);
      throw new UpstreamImageError('unknown', message);
    }
    const items = payload.data ?? [];
    if (!items.length) throw new UpstreamImageError('unknown', '上游没有返回图像数据');
    const images: GeneratedImage[] = [];
    for (const item of items) {
      const bytes = item.b64_json
        ? decodeBase64Image(item.b64_json)
        : item.url
          ? await readImageUrl(item.url, providerOrigin, controller.signal)
          : null;
      if (!bytes?.length) throw new UpstreamImageError('unknown', '上游图像数据为空');
      const metadata = detectImage(bytes);
      if (!metadata) throw new UpstreamImageError('rejected', '上游返回了不支持的图像格式');
      images.push({ bytes, ...metadata });
    }
    return images;
  } catch (error) {
    if (error instanceof UpstreamImageError) throw error;
    throw new UpstreamImageError(
      'unknown',
      error instanceof Error ? error.message : '无法确认上游生图结果',
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abortExternal);
  }
}

function buildEditForm(
  prompt: string,
  request: ParsedCloudGenerationRequest,
  references: ReferenceImageInput[],
): FormData {
  const form = new FormData();
  form.append('model', 'musefold-image-pro');
  form.append('prompt', prompt);
  form.append('n', String(request.count));
  if (request.size !== 'auto') form.append('size', request.size);
  if (request.quality !== 'auto') form.append('quality', request.quality);
  for (const reference of references) {
    form.append(
      'image[]',
      new Blob([new Uint8Array(reference.bytes)], { type: reference.mimeType }),
      reference.name || 'reference.png',
    );
  }
  return form;
}

async function readImageUrl(
  url: string,
  providerOrigin: string | null,
  signal: AbortSignal,
): Promise<Buffer> {
  if (/^data:/i.test(url)) return decodeDataImageUrl(url);

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UpstreamImageError('rejected', '上游返回了无效图像 URL');
  }
  if (!['https:', 'http:'].includes(parsed.protocol))
    throw new UpstreamImageError('rejected', '上游图像 URL 协议不安全');
  if (parsed.username || parsed.password)
    throw new UpstreamImageError('rejected', '上游图像 URL 不得包含用户凭据');

  const allowPrivate = providerOrigin !== null && parsed.origin === providerOrigin;
  const addresses = await resolveImageHost(parsed, allowPrivate);
  const response = await requestImage(parsed, addresses, signal);
  if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
    response.destroy();
    throw new UpstreamImageError('rejected', '上游图像 URL 不得重定向');
  }
  if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
    response.destroy();
    throw new UpstreamImageError('unknown', '下载上游图像失败');
  }
  const lengthHeader = response.headers['content-length'];
  const contentLength = Number(Array.isArray(lengthHeader) ? lengthHeader[0] : (lengthHeader ?? 0));
  if (contentLength > MAX_IMAGE_BYTES) {
    response.destroy();
    throw new UpstreamImageError('rejected', '图像文件过大');
  }
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const value of response) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      total += chunk.length;
      if (total > MAX_IMAGE_BYTES) throw new UpstreamImageError('rejected', '图像文件过大');
      chunks.push(chunk);
    }
  } finally {
    if (!response.complete) response.destroy();
  }
  return Buffer.concat(chunks, total);
}

function readHttpOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.origin : null;
  } catch {
    return null;
  }
}

async function resolveImageHost(url: URL, allowPrivate: boolean): Promise<ResolvedAddress[]> {
  const hostname = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
  if (
    !hostname ||
    (!allowPrivate &&
      (hostname.toLowerCase() === 'localhost' || hostname.toLowerCase().endsWith('.localhost')))
  ) {
    throw new UpstreamImageError('rejected', '上游图像 URL 指向非公开网络地址');
  }

  const literalFamily = isIP(hostname);
  const resolved = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await lookup(hostname, { all: true, verbatim: true }).catch(() => {
        throw new UpstreamImageError('unknown', '无法解析上游图像主机');
      });
  const addresses = resolved.filter(
    (entry): entry is ResolvedAddress =>
      (entry.family === 4 || entry.family === 6) && isIP(entry.address) === entry.family,
  );
  if (!addresses.length) throw new UpstreamImageError('unknown', '无法解析上游图像主机');
  if (
    !allowPrivate &&
    addresses.some(
      (entry) =>
        (entry.family === 4 && NON_PUBLIC_IPV4_ADDRESSES.check(entry.address, 'ipv4')) ||
        (entry.family === 6 &&
          (NON_PUBLIC_IPV6_ADDRESSES.check(entry.address, 'ipv6') ||
            !GLOBAL_IPV6_ADDRESSES.check(entry.address, 'ipv6'))),
    )
  ) {
    throw new UpstreamImageError('rejected', '上游图像 URL 指向非公开网络地址');
  }
  return addresses;
}

function requestImage(
  url: URL,
  addresses: ResolvedAddress[],
  signal: AbortSignal,
): Promise<IncomingMessage> {
  const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
    const family = options.family === 4 || options.family === 6 ? options.family : undefined;
    const candidates = family ? addresses.filter((entry) => entry.family === family) : addresses;
    if (!candidates.length) {
      const error = Object.assign(new Error('No approved address for requested family'), {
        code: 'ENOTFOUND',
      });
      callback(error, []);
      return;
    }
    if (options.all) callback(null, candidates);
    else callback(null, candidates[0].address, candidates[0].family);
  };

  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? requestHttps : requestHttp)(
      url,
      {
        method: 'GET',
        headers: { Accept: 'image/png, image/jpeg, image/webp' },
        lookup: pinnedLookup,
        signal,
      },
      resolve,
    );
    request.once('error', reject);
    request.end();
  });
}

function decodeDataImageUrl(value: string): Buffer {
  if (value.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 8192) {
    throw new UpstreamImageError('rejected', '图像文件过大');
  }
  const comma = value.indexOf(',');
  if (comma < 0) throw new UpstreamImageError('rejected', '上游返回了无效图像 data URL');
  const metadata = value.slice(5, comma).split(';');
  const mimeType = metadata[0].toLowerCase();
  if (
    !['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(mimeType) ||
    metadata.at(-1)?.toLowerCase() !== 'base64'
  ) {
    throw new UpstreamImageError('rejected', '上游返回了不支持的图像 data URL');
  }
  const encoded = value.slice(comma + 1);
  if (!/^[a-z0-9+/]*={0,2}$/i.test(encoded) || encoded.length % 4 !== 0) {
    throw new UpstreamImageError('rejected', '上游返回了无效图像 data URL');
  }
  return decodeBase64Image(encoded);
}

function decodeBase64Image(value: string): Buffer {
  if (value.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4096) {
    throw new UpstreamImageError('rejected', '图像文件过大');
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > MAX_IMAGE_BYTES) throw new UpstreamImageError('rejected', '图像文件过大');
  return bytes;
}

function detectImage(bytes: Buffer): Omit<GeneratedImage, 'bytes'> | null {
  if (bytes.length >= 24 && bytes.readUInt32BE(0) === 0x89504e47) {
    return {
      mimeType: 'image/png',
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
    };
  }
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    const width = bytes.length >= 30 ? 1 + bytes.readUIntLE(24, 3) : 1;
    const height = bytes.length >= 30 ? 1 + bytes.readUIntLE(27, 3) : 1;
    return { mimeType: 'image/webp', width, height };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    const jpeg = readJpegSize(bytes);
    return jpeg ? { mimeType: 'image/jpeg', ...jpeg } : null;
  }
  return null;
}

function readJpegSize(bytes: Buffer): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    const length = bytes.readUInt16BE(offset + 2);
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      return {
        height: bytes.readUInt16BE(offset + 5),
        width: bytes.readUInt16BE(offset + 7),
      };
    }
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

export function imageChecksum(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
