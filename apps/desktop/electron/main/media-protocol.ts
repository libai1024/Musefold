// electron/main/media-protocol.ts
// 自定义 media:// 协议 —— 让渲染进程能安全加载本地生成的图片。
//
// URL 形态:
// - media://local/?p=<encodeURIComponent(绝对路径)>（既有生成资产）
// - media://scheme-asset/<opaqueAssetId>（设计方案资产，不暴露本地路径）

import { getDesignSchemeDb } from '@musefold/core/db/design-scheme';
import { protocol } from 'electron';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { getPaths } from '../system/paths';
import {
  isSchemeAssetId,
  resolveSchemeAssetMediaDescriptor,
  SCHEME_ASSET_MEDIA_HOST,
  type SchemeAssetMediaDescriptor,
} from './design-scheme/asset-store';
import { sniffImageMimeType } from './design-scheme/source-ingestion';
import { resolveResourcePath } from './app-paths';
import { registerPrivilegedSchemes } from './privileged-schemes';

const IMMUTABLE_IMAGE_CACHE = 'private, max-age=31536000, immutable';
export const LOCAL_MEDIA_HOST = 'local' as const;

const NOFOLLOW = constants.O_NOFOLLOW ?? 0;

interface OpenManagedBytesOptions {
  identity?: { dev: bigint; ino: bigint };
}

async function readManagedBytes(
  target: string,
  options: OpenManagedBytesOptions = {},
): Promise<Uint8Array> {
  const handle = await open(target, constants.O_RDONLY | NOFOLLOW);
  try {
    const metadata = await handle.stat({ bigint: true });
    if (!metadata.isFile()) throw new Error('Not a regular file');
    if (
      options.identity &&
      (metadata.dev !== options.identity.dev || metadata.ino !== options.identity.ino)
    ) {
      const error = new Error('Managed file changed before read') as NodeJS.ErrnoException;
      error.code = 'EAGAIN';
      throw error;
    }
    return new Uint8Array(await handle.readFile());
  } finally {
    await handle.close();
  }
}

/** 允许被 media://local 读取的根目录（防目录穿越）。 */
function allowedRoots(): string[] {
  const paths = getPaths();
  const petRoot = resolveResourcePath(['pet']);
  // Generated images use pictures; imports and staged uploads use the dedicated previews tree.
  // Do not expose backups, logs, databases, or the whole userData directory.
  return [paths.pictures, paths.previews, petRoot].map((root) => resolve(root));
}

export interface MediaProtocolDependencies {
  localRoots?: () => string[];
  resolveSchemeAsset?: (assetId: string) => SchemeAssetMediaDescriptor | null;
  readBytes?: (path: string) => Promise<Uint8Array>;
}

function defaultResolveSchemeAsset(assetId: string): SchemeAssetMediaDescriptor | null {
  const paths = getPaths();
  return resolveSchemeAssetMediaDescriptor(
    getDesignSchemeDb(),
    assetId,
    paths.userData,
    paths.pictures,
  );
}

function imageResponse(bytes: Uint8Array, mimeType: string): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': mimeType,
      'Cache-Control': IMMUTABLE_IMAGE_CACHE,
    },
  });
}

async function handleSchemeAssetRequest(
  url: URL,
  dependencies: MediaProtocolDependencies,
): Promise<Response> {
  let assetId: string;
  try {
    assetId = decodeURIComponent(url.pathname.slice(1));
  } catch {
    return new Response('Bad request', { status: 400 });
  }
  if (!isSchemeAssetId(assetId)) return new Response('Bad request', { status: 400 });

  let resolved: SchemeAssetMediaDescriptor | null;
  try {
    resolved = (dependencies.resolveSchemeAsset ?? defaultResolveSchemeAsset)(assetId);
  } catch {
    return new Response('Read error', { status: 500 });
  }
  if (!resolved) return new Response('Not found', { status: 404 });
  const target = resolved.path;
  const identity = resolved.identity;

  try {
    const bytes = await (
      dependencies.readBytes ?? ((path: string) => readManagedBytes(path, { identity }))
    )(target);
    const mimeType = sniffImageMimeType(bytes);
    if (!mimeType) return new Response('Not found', { status: 404 });
    return imageResponse(bytes, mimeType);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    return new Response(code === 'ENOENT' ? 'Not found' : 'Read error', {
      status: code === 'ENOENT' ? 404 : 500,
    });
  }
}

async function handleLocalMediaRequest(
  url: URL,
  dependencies: MediaProtocolDependencies,
): Promise<Response> {
  const raw = url.searchParams.get('p');
  if (!raw) return new Response('Bad request', { status: 400 });

  const target = resolve(raw);
  const roots = (dependencies.localRoots ?? allowedRoots)().map((root) => resolve(root));
  const allowed = roots.some((root) => target === root || target.startsWith(root + sep));
  if (!allowed) return new Response('Forbidden', { status: 403 });

  try {
    const bytes = await (dependencies.readBytes ?? readManagedBytes)(target);
    const mimeType = sniffImageMimeType(bytes);
    if (!mimeType) return new Response('Not found', { status: 404 });
    return imageResponse(bytes, mimeType);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    return new Response(code === 'ENOENT' ? 'Not found' : 'Read error', {
      status: code === 'ENOENT' ? 404 : 500,
    });
  }
}

export async function handleMediaRequest(
  requestUrl: string,
  dependencies: MediaProtocolDependencies = {},
): Promise<Response> {
  try {
    const url = new URL(requestUrl);
    if (url.host === SCHEME_ASSET_MEDIA_HOST) {
      return handleSchemeAssetRequest(url, dependencies);
    }
    if (url.host === LOCAL_MEDIA_HOST) {
      return handleLocalMediaRequest(url, dependencies);
    }
    return new Response('Bad request', { status: 400 });
  } catch {
    return new Response('Bad request', { status: 400 });
  }
}

/** 顶层调用（app.whenReady 之前）：把 media 声明为标准 + 安全协议。 */
export function registerMediaScheme(): void {
  registerPrivilegedSchemes();
}

/** app.whenReady 之后调用：注册实际的读盘处理器。 */
export function registerMediaProtocolHandler(): void {
  protocol.handle('media', (request) => handleMediaRequest(request.url));
}
