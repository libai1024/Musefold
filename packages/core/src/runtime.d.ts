import type {
  GenerateImageRequest,
  GenerateImageResult,
  ValidationResult,
} from '@musefold/desktop-contracts/providers';
import type { Logger } from './ports';
/** 与 electron/system/paths.ts 的 getPaths() 同形态。 */
export interface CorePaths {
  userData: string;
  db: string;
  backups: string;
  previews: string;
  pictures: string;
  logs: string;
}
/** Electron 宿主提供的豆包网页自动化端口；headless/CLI 宿主可以不实现。 */
export interface DoubaoWebRuntime {
  validate(): Promise<ValidationResult>;
  generateImage(req: GenerateImageRequest, signal?: AbortSignal): Promise<GenerateImageResult>;
}
export interface CoreRuntime {
  getPaths(): CorePaths;
  /**
   * 同步密钥读取（Electron safeStorage 本身是同步的）。
   * headless 实现（P4）负责在启动时预热，保持同步语义。
   */
  loadApiKey(providerId: string): string | null;
  createLogger(scope: string): Logger;
  estimateProviderCost(
    providerId: string,
    req: {
      n?: number;
    },
  ): number | null;
  doubaoWeb?: DoubaoWebRuntime;
}
export declare function configureCoreRuntime(next: CoreRuntime): void;
export declare function getCoreRuntime(): CoreRuntime;
export declare function getPaths(): CorePaths;
export declare function loadApiKey(providerId: string): string | null;
/**
 * 惰性 logger：搬移代码有模块作用域的 createLogger 调用（如 openai-compatible），
 * 与原 system/logger 语义一致——创建时安全，写日志时才解析环境；
 * runtime 未配置时退回 console（仅测试/异常场景会走到）。
 */
export declare function createLogger(scope: string): Logger;
export declare function estimateProviderCost(
  providerId: string,
  req: {
    n?: number;
  },
): number | null;
export declare function getDoubaoWebRuntime(): DoubaoWebRuntime;
//# sourceMappingURL=runtime.d.ts.map
