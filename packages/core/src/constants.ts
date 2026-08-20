// 路径 / 文件系统 / SQLite 相关常量。
// 数据域版本号本身是产品身份，定义在 domain；此处只派生落盘文件名。

import { APP_DATA_NAMESPACE } from '@musefold/domain/constants';

export const DB_NAME = `musefold-data-${APP_DATA_NAMESPACE}.db`;
export const STORE_NAME = `musefold-providers-${APP_DATA_NAMESPACE}`; // electron-store 文件名
/** 文本 AI 连接与图片 Provider 分开存储，避免模型、激活态和密钥串线。 */
export const AI_CONNECTION_STORE_NAME = `musefold-ai-connections-${APP_DATA_NAMESPACE}`;
export const PICTURES_DIR_NAME = `Musefold/${APP_DATA_NAMESPACE}`;
export const BACKUPS_DIR_NAME = `musefold-backups-${APP_DATA_NAMESPACE}`;
export const PREVIEWS_DIR_NAME = `musefold-previews-${APP_DATA_NAMESPACE}`;
export const LOGS_DIR_NAME = `musefold-logs-${APP_DATA_NAMESPACE}`;

/** FTS5 配置 */
export const FTS_TOKENIZE = 'unicode61';
