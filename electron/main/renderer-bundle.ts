// 活跃 renderer bundle 解析器（V121-HOT-02）。
//
// 协议第 1 节：index.html 与 pet.html 必须原子地共用同一份 bundle。
// 协议第 6 节：桌面端生效时机是下次启动。因此解析一次并冻结整个进程生命周期，
// 避免主窗口与宠物窗口落到不同根目录。
//
// HOT-08 之前候选读取器默认返回空列表，一律回落到随包内置 out/renderer。

import { app } from 'electron';
import { statSync } from 'fs';
import { join, resolve } from 'path';

export type RendererBundleSource = 'bundle' | 'builtin';

export interface RendererRootResolution {
  readonly root: string;
  readonly source: RendererBundleSource;
}

/** 按优先级返回候选 bundle 根目录（最高优先在前）。 */
export interface RendererBundleCandidateReader {
  readCandidates(): readonly string[];
}

export const emptyRendererBundleCandidateReader: RendererBundleCandidateReader = {
  readCandidates: () => [],
};

let cachedResolution: RendererRootResolution | undefined;

function getAppRoot(): string {
  return app.isPackaged ? app.getAppPath() : process.cwd();
}

/** 随包内置渲染层根目录。算法与 window.ts / pet/window.ts 的 appRoot 一致。 */
export function getBuiltinRendererRoot(): string {
  return join(getAppRoot(), 'out/renderer');
}

function isCompleteRendererBundle(root: string): boolean {
  try {
    return statSync(join(root, 'index.html')).isFile() && statSync(join(root, 'pet.html')).isFile();
  } catch {
    return false;
  }
}

/**
 * 解析当前进程应使用的 renderer 根目录。第一次调用的结果冻结到进程退出。
 * `reader` 只在未缓存时生效；默认读取器返回空列表。
 */
export function resolveRendererRoot(
  reader: RendererBundleCandidateReader = emptyRendererBundleCandidateReader,
): RendererRootResolution {
  if (cachedResolution) return cachedResolution;

  for (const candidate of reader.readCandidates()) {
    const root = resolve(candidate);
    if (isCompleteRendererBundle(root)) {
      cachedResolution = { root, source: 'bundle' };
      return cachedResolution;
    }
  }

  cachedResolution = { root: resolve(getBuiltinRendererRoot()), source: 'builtin' };
  return cachedResolution;
}

/** 仅供测试：丢掉进程级缓存，以便下一例重新探测。 */
export function resetRendererRootCacheForTests(): void {
  cachedResolution = undefined;
}
