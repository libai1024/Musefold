// electron/system/paths.ts
// 用户数据目录路径（macOS/Windows 跨平台）

import { app } from 'electron';
import { join } from 'path';
import {
  APP_NAME,
  DB_NAME,
  PICTURES_DIR_NAME,
  BACKUPS_DIR_NAME,
  PREVIEWS_DIR_NAME,
  LOGS_DIR_NAME,
} from '@shared/constants';

export function getPaths() {
  const userData = app.getPath('userData');
  // E2E launches use an isolated --user-data-dir. Keep generated images inside
  // it as well, otherwise deterministic tests would write into the real Pictures folder.
  const pictures = process.env['MUSEFOLD_E2E'] === '1'
    ? join(userData, 'Pictures')
    : join(app.getPath('pictures'), PICTURES_DIR_NAME);
  return {
    userData,
    db: join(userData, DB_NAME),
    backups: join(userData, BACKUPS_DIR_NAME),
    previews: join(userData, PREVIEWS_DIR_NAME),
    pictures,
    logs: join(userData, LOGS_DIR_NAME),
  };
}
