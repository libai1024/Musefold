import { spawn } from 'node:child_process';
import { discoverEndpoint, type DiscoveredEndpoint } from './discover';

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_POLL_INTERVAL_MS = 250;

export interface DiscoverOrStartOptions {
  env?: NodeJS.ProcessEnv;
  autostart?: boolean;
  executable?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  logger?: (line: string) => void;
  discover?: (env: NodeJS.ProcessEnv) => Promise<DiscoveredEndpoint | null>;
  launch?: (executable: string, env: NodeJS.ProcessEnv) => Promise<boolean>;
  sleep?: (ms: number) => Promise<void>;
}

function desktopExecutable(env: NodeJS.ProcessEnv, explicit?: string): string | null {
  if (explicit?.trim()) return explicit.trim();
  if (env.MUSEFOLD_APP_EXECUTABLE?.trim()) return env.MUSEFOLD_APP_EXECUTABLE.trim();

  // Packaged CLI/MCP scripts run through Musefold.exe in Node mode. In that case
  // process.execPath is the installed desktop executable, not a standalone Node binary.
  if (env.ELECTRON_RUN_AS_NODE === '1') return process.execPath;
  return null;
}

async function launchDesktop(executable: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  const childEnv = { ...env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  delete childEnv.MUSEFOLD_AUTOSTART;
  delete childEnv.MUSEFOLD_APP_EXECUTABLE;
  delete childEnv.MUSEFOLD_ENDPOINT;
  delete childEnv.MUSEFOLD_TOKEN;
  delete childEnv.NODE_PATH;

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(executable, [], {
        detached: true,
        stdio: 'ignore',
        env: childEnv,
        windowsHide: false,
      });
    } catch {
      resolve(false);
      return;
    }
    child.once('error', () => resolve(false));
    child.once('spawn', () => {
      child.unref();
      resolve(true);
    });
  });
}

/** Discover the control plane and, when requested, launch the installed desktop app. */
export async function discoverOrStartEndpoint(
  options: DiscoverOrStartOptions = {},
): Promise<DiscoveredEndpoint | null> {
  const env = options.env ?? process.env;
  const discover = options.discover ?? discoverEndpoint;
  const current = await discover(env);
  if (current || !options.autostart) return current;

  const executable = desktopExecutable(env, options.executable);
  if (!executable) {
    options.logger?.('[autostart] 未找到 Musefold 桌面应用可执行文件');
    return null;
  }

  const launched = await (options.launch ?? launchDesktop)(executable, env);
  if (!launched) {
    options.logger?.(`[autostart] 无法启动 Musefold 桌面应用：${executable}`);
    return null;
  }

  const timeoutMs = Math.max(0, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const pollIntervalMs = Math.max(25, options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
  const attempts = Math.max(1, Math.ceil(timeoutMs / pollIntervalMs));
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await sleep(pollIntervalMs);
    const discovered = await discover(env);
    if (discovered) return discovered;
  }
  return null;
}
