// 发现链（V04-ARCHITECTURE §3.2）：
// 1. 环境变量 MUSEFOLD_ENDPOINT + MUSEFOLD_TOKEN 显式指定 → 直连
// 2. 读 userData/automation.json（先打包态 Musefold、后开发态 musefold）→ 健康检查 → 直连
// 3. 都失败 → null（CLI 报错引导 / MCP 降级目录）

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface DiscoveredEndpoint {
  endpoint: string;
  token: string;
  /** 'env' | 发现文件路径 */
  source: string;
  owner?: 'desktop-app' | 'headless-daemon';
}

interface DiscoveryFileShape {
  version: number;
  apiVersion: string;
  pid: number;
  port: number;
  token: string;
  owner: 'desktop-app' | 'headless-daemon';
}

/**
 * 与 Electron 的 userData 路径算法对齐。当前 0.5 安装包由根包名派生为
 * `musefold-app`；旧版曾使用 `Musefold` / `musefold`，保留回退以兼容已有数据。
 */
export function candidateDataDirs(env: NodeJS.ProcessEnv = process.env, platform = process.platform): string[] {
  const explicit = env.MUSEFOLD_DATA_DIR;
  if (explicit) return [explicit];
  const home = homedir();
  if (platform === 'darwin') {
    const base = join(home, 'Library', 'Application Support');
    return [join(base, 'musefold-app'), join(base, 'Musefold'), join(base, 'musefold')];
  }
  if (platform === 'win32') {
    const base = env.APPDATA ?? join(home, 'AppData', 'Roaming');
    return [join(base, 'musefold-app'), join(base, 'Musefold'), join(base, 'musefold')];
  }
  const base = env.XDG_CONFIG_HOME ?? join(home, '.config');
  return [join(base, 'musefold-app'), join(base, 'Musefold'), join(base, 'musefold')];
}

function readDiscovery(dataDir: string): DiscoveryFileShape | null {
  try {
    const parsed = JSON.parse(readFileSync(join(dataDir, 'automation.json'), 'utf8')) as Partial<DiscoveryFileShape>;
    if (
      parsed.version !== 1 || parsed.apiVersion !== 'v1' ||
      typeof parsed.port !== 'number' || parsed.port <= 0 ||
      typeof parsed.token !== 'string' || !parsed.token
    ) return null;
    return parsed as DiscoveryFileShape;
  } catch {
    return null;
  }
}

async function alive(endpoint: string, token: string, timeoutMs = 1500): Promise<boolean> {
  try {
    const response = await fetch(`${endpoint}/v1/health`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function discoverEndpoint(
  env: NodeJS.ProcessEnv = process.env,
): Promise<DiscoveredEndpoint | null> {
  if (env.MUSEFOLD_ENDPOINT && env.MUSEFOLD_TOKEN) {
    return { endpoint: env.MUSEFOLD_ENDPOINT.replace(/\/$/, ''), token: env.MUSEFOLD_TOKEN, source: 'env' };
  }
  for (const dataDir of candidateDataDirs(env)) {
    const document = readDiscovery(dataDir);
    if (!document) continue;
    const endpoint = `http://127.0.0.1:${document.port}`;
    if (await alive(endpoint, document.token)) {
      return { endpoint, token: document.token, source: join(dataDir, 'automation.json'), owner: document.owner };
    }
  }
  return null;
}
