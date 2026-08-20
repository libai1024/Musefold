// electron/main/app-paths.ts
// 未打包时 app.getAppPath() 指向 apps/desktop/out/main，不能当仓库根；打包后 extraResources 又平铺在
// process.resourcesPath 下。集中解析，避免各处自行拼接走错分支。

import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { app } from 'electron';

/** 桌面应用包名。npm 上的 musefold 留给 CLI，不能拿来识别仓库根。 */
const APP_PACKAGE_NAME = 'musefold-app';

export interface AppPathEnvironment {
  packaged: boolean;
  appPath: string;
  cwd: string;
  resourcesPath?: string;
}

export type AppRootProbe = (dir: string) => boolean;

function readDefaultEnvironment(): AppPathEnvironment {
  return {
    packaged: app.isPackaged,
    appPath: app.getAppPath(),
    cwd: process.cwd(),
    resourcesPath: process.resourcesPath,
  };
}

function defaultAppRootProbe(dir: string): boolean {
  if (!existsSync(join(dir, 'resources'))) return false;
  try {
    const pkg = JSON.parse(
      readFileSync(join(dir, 'apps', 'desktop', 'package.json'), 'utf-8'),
    ) as { name?: unknown };
    return pkg.name === APP_PACKAGE_NAME;
  } catch {
    return false;
  }
}

function environmentCacheKey(environment: AppPathEnvironment): string {
  return `${environment.packaged ? '1' : '0'}\0${environment.appPath}\0${environment.cwd}`;
}

let cachedAppRoot: string | undefined;
let cachedAppRootKey: string | undefined;

function walkToAppRoot(start: string, probe: AppRootProbe): string | undefined {
  let dir = resolve(start);
  for (;;) {
    if (probe(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function computeAppRoot(environment: AppPathEnvironment, probe: AppRootProbe): string {
  if (environment.packaged) return environment.appPath;

  const fromAppPath = walkToAppRoot(environment.appPath, probe);
  if (fromAppPath) return fromAppPath;

  const cwd = resolve(environment.cwd);
  if (probe(cwd)) return cwd;

  return environment.appPath;
}

export function resolveAppRoot(
  environment?: AppPathEnvironment,
  probe?: AppRootProbe,
): string {
  const useCache = environment === undefined && probe === undefined;
  const env = environment ?? readDefaultEnvironment();
  const key = environmentCacheKey(env);
  if (useCache && cachedAppRoot !== undefined && cachedAppRootKey === key) {
    return cachedAppRoot;
  }

  const root = computeAppRoot(env, probe ?? defaultAppRootProbe);
  if (useCache) {
    cachedAppRoot = root;
    cachedAppRootKey = key;
  }
  return root;
}

/** 仅供测试：丢掉默认 environment 的进程级缓存，以便下一例重新探测。 */
export function resetAppRootCacheForTests(): void {
  cachedAppRoot = undefined;
  cachedAppRootKey = undefined;
}

export function resolveResourcePath(
  segments: readonly string[],
  environment?: AppPathEnvironment,
  probe?: AppRootProbe,
): string {
  const env = environment ?? readDefaultEnvironment();
  if (env.packaged) {
    return join(env.resourcesPath ?? process.resourcesPath, ...segments);
  }
  return join(resolveAppRoot(environment, probe), 'resources', ...segments);
}
