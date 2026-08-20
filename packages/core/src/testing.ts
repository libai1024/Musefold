// 测试专用：把 core runtime 配置到一个临时根目录。
// 路径派生逻辑与 electron/system/paths.ts 完全同形（constants 同源），
// 使搬移进 core 的 db/providers 单测无需再 mock electron。

import { join } from 'path';
import {
  BACKUPS_DIR_NAME,
  DB_NAME,
  LOGS_DIR_NAME,
  PICTURES_DIR_NAME,
  PREVIEWS_DIR_NAME,
} from '@musefold/core/constants';
import { configureCoreRuntime, type CorePaths, type CoreRuntime } from './runtime';

export function testCorePaths(root: string): CorePaths {
  return {
    userData: root,
    db: join(root, DB_NAME),
    backups: join(root, BACKUPS_DIR_NAME),
    previews: join(root, PREVIEWS_DIR_NAME),
    pictures: join(root, PICTURES_DIR_NAME),
    logs: join(root, LOGS_DIR_NAME),
  };
}

const silentLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export function configureTestCoreRuntime(root: string, overrides: Partial<CoreRuntime> = {}): void {
  configureCoreRuntime({
    getPaths: () => testCorePaths(root),
    loadApiKey: () => null,
    createLogger: () => silentLogger,
    estimateProviderCost: () => null,
    ...overrides,
  });
}
