// src/lib/media.ts
// 本地图片路径 → 可渲染 src。
//
// 主进程返回的是文件系统绝对路径。直接用 file:// 在 dev（http://localhost 源）
// 会被 Chromium 拒绝加载，故统一走自定义 media:// 协议（主进程读盘返回字节）。
// 已带协议的 URL（http/https/data/blob/media）原样返回；
// file:// 也转成 media://，以规避跨源限制。

/** 把绝对路径编码进 media:// 协议 URL */
function toMediaUrl(absPath: string): string {
  return `media://local/?p=${encodeURIComponent(absPath)}`;
}

export function toImageSrc(path: string): string {
  // 已是可直接渲染的协议：原样返回（含 preview 桥注入的 data: URL）
  if (/^(https?:|data:|blob:|media:)/i.test(path)) return path;
  // file:// 前缀 → 剥离后走 media://
  if (/^file:\/\//i.test(path)) {
    return toMediaUrl(decodeURIComponent(path.replace(/^file:\/\//i, '')));
  }
  // 裸文件系统绝对路径
  return toMediaUrl(path);
}
