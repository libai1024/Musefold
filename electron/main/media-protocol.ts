// electron/main/media-protocol.ts
// 自定义 media:// 协议 —— 让渲染进程能安全加载本地生成的图片。
//
// 背景：dev 下渲染进程由 http://localhost:5173 提供，Chromium 会拒绝从 http
// 源加载 file:// 资源（安全策略，与 CSP 无关），所以「生成成功但图不显示」。
// prod 下页面走 file://，直接用 file:// 亦不稳妥。统一改走 media:// 自定义协议：
// 主进程读盘 → 校验路径 → 回 Response(bytes)，两种环境一致可用。
//
// URL 形态：media://local/?p=<encodeURIComponent(绝对路径)>

import { protocol } from 'electron';
import { readFile } from 'fs/promises';
import { resolve, sep, extname } from 'path';
import { getPaths } from '../system/paths';
import { resolveResourcePath } from './app-paths';
import { registerPrivilegedSchemes } from './privileged-schemes';

/** 允许被 media:// 读取的根目录（防目录穿越） */
function allowedRoots(): string[] {
  const p = getPaths();
  // 桌宠 sprite 是随包分发的只读资源，和用户图片走同一条读盘通道
  const petRoot = resolveResourcePath(['pet']);
  return [p.pictures, p.previews, p.backups, p.userData, petRoot].map((r) => resolve(r));
}

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.apng': 'image/apng',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
};

/**
 * 顶层调用（app.whenReady 之前）：把 media 声明为标准 + 安全协议。
 * standard → 解析 host/path；secure → 可在安全上下文加载；supportFetchAPI → 兼容 fetch。
 */
export function registerMediaScheme(): void {
  // Electron 只允许一次 registerSchemesAsPrivileged；与 app:// 一并声明。
  registerPrivilegedSchemes();
}

/** app.whenReady 之后调用：注册实际的读盘处理器。 */
export function registerMediaProtocolHandler(): void {
  protocol.handle('media', async (request) => {
    try {
      const url = new URL(request.url);
      const raw = url.searchParams.get('p');
      if (!raw) return new Response('Bad request', { status: 400 });

      const target = resolve(raw);

      // 目录穿越校验：必须落在允许的根目录之内
      const ok = allowedRoots().some(
        (root) => target === root || target.startsWith(root + sep)
      );
      if (!ok) return new Response('Forbidden', { status: 403 });

      const buf = await readFile(target);
      const type = MIME[extname(target).toLowerCase()] ?? 'application/octet-stream';
      return new Response(new Uint8Array(buf), {
        status: 200,
        headers: {
          'Content-Type': type,
          // 生成的图片按 historyId 命名，内容不变，可长缓存
          'Cache-Control': 'private, max-age=31536000, immutable',
        },
      });
    } catch (err) {
      // 文件不存在 / 读失败 → 404，触发渲染端 <img onError> 的美观兜底
      const code = (err as NodeJS.ErrnoException)?.code;
      const status = code === 'ENOENT' ? 404 : 500;
      return new Response(status === 404 ? 'Not found' : 'Read error', { status });
    }
  });
}
