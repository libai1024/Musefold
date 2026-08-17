// createMusefoldCore：core 的组装入口。
//
// 服务面（V04-CORE-04）= 控制面与未来 IPC 的共同真源：
// Library / History / Provider / Scheme / Status。
// 服务在构造时不碰数据库（惰性到方法调用），宿主须先完成 db 初始化。

import type { Clock, CoreOptions, Logger, PathsPort } from './ports';
import {
  cancelGeneration,
  generate,
  hasActiveImageJobs,
} from './services/generation';
import type {
  GenerateImageRequest,
  GenerateImageResult,
  ImageGenerationProgress,
} from '@shared/types/providers';
import { createHistoryService, type HistoryService } from './services/history';
import { createLibraryService, type LibraryService } from './services/library';
import { createProviderService, type ProviderService } from './services/providers';
import { createSchemeService, type SchemeService } from './services/schemes';
import { createStatusService, type StatusService } from './services/status';

export const CORE_VERSION = '0.1.0';

/** 生图汇聚点（V04-CORE-05）：IPC 与控制面共用的唯一入口。 */
export interface GenerationService {
  generate(
    req: GenerateImageRequest,
    onProgress?: (progress: ImageGenerationProgress) => void,
    options?: { retryOfRunId?: string },
  ): Promise<GenerateImageResult>;
  cancel(jobId: string): boolean;
  hasActiveJobs(): boolean;
}

export interface MusefoldCore {
  readonly version: string;
  readonly paths: PathsPort;
  readonly library: LibraryService;
  readonly history: HistoryService;
  readonly providers: ProviderService;
  readonly schemes: SchemeService;
  readonly status: StatusService;
  readonly generation: GenerationService;
  /** 已释放后调用任何服务应视为编程错误；dispose 幂等。 */
  dispose(): void;
  readonly disposed: boolean;
}

export function createMusefoldCore(options: CoreOptions): MusefoldCore {
  const logger: Logger = options.logger;
  const clock: Clock = options.clock ?? { now: () => Date.now() };
  let disposed = false;

  const startedAt = clock.now();
  logger.info(`领域核心 v${CORE_VERSION} 就绪`, { dataDir: options.paths.dataDir });

  return {
    version: CORE_VERSION,
    paths: options.paths,
    library: createLibraryService(),
    history: createHistoryService(),
    providers: createProviderService(),
    schemes: createSchemeService(),
    status: createStatusService(),
    generation: {
      generate: (req, onProgress, options) => generate(req, onProgress, options),
      cancel: (jobId) => cancelGeneration(jobId),
      hasActiveJobs: () => hasActiveImageJobs(),
    },
    get disposed() {
      return disposed;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      logger.info('core 释放', { uptimeMs: clock.now() - startedAt });
    },
  };
}
