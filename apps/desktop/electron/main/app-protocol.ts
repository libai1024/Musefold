// 固定特权自定义协议 app://musefold（V121-HOT-01）。
//
// origin 恒为 app://musefold，与 bundle 版本无关，避免 loadFile 切目录时
// localStorage / IndexedDB 分区被清空。handler 拒绝任何非 musefold 的 host。

import { protocol } from 'electron';
import { readFile, realpath } from 'fs/promises';
import { extname, isAbsolute, join, resolve, sep } from 'path';
import { APP_SCHEME_PRIVILEGES, registerPrivilegedSchemes } from './privileged-schemes';

export const APP_SCHEME = APP_SCHEME_PRIVILEGES.scheme;
export const APP_HOST = 'musefold';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

/** 主窗口入口。两个窗口必须通过本模块拼 URL，禁止在调用处各写一遍 origin。 */
export const APP_MAIN_ENTRY = 'index.html';
/** 宠物窗口入口。与主窗口共用同一 origin / 同一 bundle。 */
export const APP_PET_ENTRY = 'pet.html';
/** E2E 查询串。渲染层 `apps/desktop/src/lib/test-hook.ts` 用 `location.search.includes` 判定。 */
export const E2E_SEARCH = 'musefold_e2e=1';

export type AppRendererEntry = typeof APP_MAIN_ENTRY | typeof APP_PET_ENTRY;

/**
 * 拼出固定 origin 下的入口 URL。query / hash 只作为页面地址的一部分，
 * 协议 handler 定位文件时会忽略它们。
 */
export function buildAppEntryUrl(
  entry: AppRendererEntry,
  options?: { e2e?: boolean },
): string {
  const url = `${APP_ORIGIN}/${entry}`;
  return options?.e2e ? `${url}?${E2E_SEARCH}` : url;
}

/** 生产环境站内导航：只放行本 origin（含路径、query、hash）。 */
export function isAppOriginUrl(url: string): boolean {
  return url === APP_ORIGIN || url.startsWith(`${APP_ORIGIN}/`);
}

/**
 * 主窗口加载地址。开发分支的字符串拼接必须与历史实现逐字符一致：
 * `ELECTRON_RENDERER_URL` 存在时走 Vite；否则走 `app://musefold/index.html`。
 */
export function resolveMainWindowLoadUrl(
  rendererUrl: string | undefined,
  e2e: boolean,
): string {
  if (rendererUrl) {
    const base = rendererUrl;
    return e2e ? `${base}${base.includes('?') ? '&' : '?'}musefold_e2e=1` : base;
  }
  return buildAppEntryUrl(APP_MAIN_ENTRY, { e2e });
}

/**
 * 宠物窗口加载地址。开发分支同样逐字符保持：
 * `${devUrl.replace(/\/$/, '')}/pet.html`；生产走 `app://musefold/pet.html`。
 */
export function resolvePetWindowLoadUrl(rendererUrl: string | undefined): string {
  if (rendererUrl) {
    return `${rendererUrl.replace(/\/$/, '')}/pet.html`;
  }
  return buildAppEntryUrl(APP_PET_ENTRY);
}

/**
 * 正确性优先于微优化：bundle 切换时任何 HTTP 缓存残留都可能让新旧资产混用；
 * 本地读盘成本极低。后续若确认 Vite 产物文件名含内容哈希，可对哈希资产改 immutable。
 */
const CACHE_CONTROL = 'no-store';

const TEXT_TYPES = new Set([
  'text/html',
  'text/javascript',
  'text/css',
  'application/json',
  'image/svg+xml',
]);

const MIME_BY_EXTENSION: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
};

export function registerAppScheme(): void {
  registerPrivilegedSchemes();
}

export function registerAppProtocolHandler(root: string): void {
  const frozenRoot = resolve(root);
  protocol.handle(APP_SCHEME, (request) => handleAppRequest(request.url, { root: frozenRoot }));
}

export async function handleAppRequest(
  requestUrl: string,
  options: { root: string },
): Promise<Response> {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return errorResponse(400, 'Bad request');
  }

  if (url.protocol !== `${APP_SCHEME}:`) return errorResponse(400, 'Bad request');
  if (url.host !== APP_HOST) return errorResponse(403, 'Forbidden');

  const located = locateTargetFile(requestUrl, url.pathname, options.root);
  if (located.kind === 'error') return errorResponse(located.status, located.message);

  let canonicalRoot: string;
  let canonicalTarget: string;
  try {
    canonicalRoot = await realpath(located.root);
  } catch (err) {
    return errorFromErrno(err);
  }
  try {
    canonicalTarget = await realpath(located.target);
  } catch (err) {
    return errorFromErrno(err);
  }

  if (!isInsideRoot(canonicalTarget, canonicalRoot)) {
    return errorResponse(403, 'Forbidden');
  }

  try {
    const buf = await readFile(canonicalTarget);
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': contentTypeFor(canonicalTarget),
        'Cache-Control': CACHE_CONTROL,
      },
    });
  } catch (err) {
    return errorFromErrno(err);
  }
}

function locateTargetFile(
  requestUrl: string,
  parsedPathname: string,
  root: string,
): { kind: 'ok'; root: string; target: string } | { kind: 'error'; status: number; message: string } {
  const rawPath = extractRawPath(requestUrl);
  const parsed = decodeAndValidatePath(parsedPathname);
  if (parsed.kind === 'error') return parsed;
  if (rawPath !== null) {
    const raw = decodeAndValidatePath(rawPath === '' ? '/' : rawPath);
    if (raw.kind === 'error') return raw;
  }

  const resolvedRoot = resolve(root);
  const target = resolve(resolvedRoot, parsed.relative);
  if (!isInsideRoot(target, resolvedRoot)) {
    return { kind: 'error', status: 403, message: 'Forbidden' };
  }
  return { kind: 'ok', root: resolvedRoot, target };
}

function decodeAndValidatePath(
  pathname: string,
): { kind: 'ok'; relative: string } | { kind: 'error'; status: number; message: string } {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return { kind: 'error', status: 400, message: 'Bad request' };
  }

  if (decoded.includes('\0')) {
    return { kind: 'error', status: 403, message: 'Forbidden' };
  }

  // 绝对路径形态：协议相对 //…、Windows 盘符、或解码后仍是绝对路径。
  if (decoded.startsWith('//') || looksLikeWindowsAbsolute(decoded)) {
    return { kind: 'error', status: 403, message: 'Forbidden' };
  }

  const isDirectoryUrl = decoded === '' || decoded === '/' || decoded.endsWith('/') || decoded.endsWith('\\');
  const stripped = decoded.replace(/^[\\/]+/, '');
  if (isAbsolute(stripped) || looksLikeWindowsAbsolute(stripped)) {
    return { kind: 'error', status: 403, message: 'Forbidden' };
  }

  const segments = stripped.split(/[/\\]/);
  if (segments.includes('..')) {
    return { kind: 'error', status: 403, message: 'Forbidden' };
  }

  const relative = isDirectoryUrl ? join(stripped, 'index.html') : stripped;
  return { kind: 'ok', relative };
}

function extractRawPath(requestUrl: string): string | null {
  const hashIndex = requestUrl.indexOf('#');
  const noHash = hashIndex === -1 ? requestUrl : requestUrl.slice(0, hashIndex);
  const queryIndex = noHash.indexOf('?');
  const noQuery = queryIndex === -1 ? noHash : noHash.slice(0, queryIndex);
  const schemeHost = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/]*/.exec(noQuery);
  if (!schemeHost) return null;
  return noQuery.slice(schemeHost[0].length);
}

function looksLikeWindowsAbsolute(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('\\\\');
}

function isInsideRoot(target: string, root: string): boolean {
  return target === root || target.startsWith(root + sep);
}

function contentTypeFor(filePath: string): string {
  const mime = MIME_BY_EXTENSION[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  return TEXT_TYPES.has(mime) ? `${mime}; charset=utf-8` : mime;
}

function errorFromErrno(err: unknown): Response {
  const code = (err as NodeJS.ErrnoException)?.code;
  const status = code === 'ENOENT' ? 404 : 500;
  return errorResponse(status, status === 404 ? 'Not found' : 'Read error');
}

function errorResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': CACHE_CONTROL,
    },
  });
}
