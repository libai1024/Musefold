import { AppError } from '../../lib/errors.js';

/** Matches the worker's bounded output download; reference uploads keep their separate 20 MiB limit. */
export const MAX_GENERATION_ASSET_BYTES = 30 * 1024 * 1024;
export const GENERATION_ASSET_READ_TIMEOUT_MS = 30_000;

export function missingAssetContent() {
  return new AppError('GENERATION_NOT_FOUND', '生成资产不存在或已清理', 404);
}

export function unavailableAssetContent() {
  return new AppError('GENERATION_STORAGE_FAILED', '生成资产暂时无法读取，请重试', 503, true);
}
