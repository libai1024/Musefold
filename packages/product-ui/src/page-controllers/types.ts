import type {
  GenerationGateway,
  HistoryGateway,
  PlatformServices,
  PromptGateway,
  WorkbenchGateway,
} from "@musefold/domain";

/**
 * 页面编排 hook 的显式依赖。禁止用 React Context 隐式注入端口或平台能力。
 *
 * `listKey` / `listFn` 是桌面 extras 的注入点：product-ui 不引用宿主
 * 扩展类型，宿主把 extras 列表收成与 Query key 同形状的回调。
 * 未传时走 HistoryGateway / PromptGateway / WorkbenchGateway。
 */
export interface HistoryPageControllerDeps {
  history: HistoryGateway;
  platform: PlatformServices;
  generation?: Pick<
    GenerationGateway,
    "getGeneration" | "retryGeneration" | "cancelGeneration"
  >;
  /** 稳定筛选快照。禁止写入 `Date.now()` 解析出的 from/to（STATE-02）。 */
  listKey?: unknown;
  listEnabled?: boolean;
}

export interface LibraryPageControllerDeps {
  prompts: PromptGateway;
  platform: PlatformServices;
  listKey?: unknown;
  listEnabled?: boolean;
  query?: string;
  onQueryChange?: (query: string) => void;
  searchDebounceMs?: number;
}

export interface GeneratePageControllerDeps {
  workbench: WorkbenchGateway;
  platform: PlatformServices;
  generation?: GenerationGateway;
  prompts?: PromptGateway;
  history?: HistoryGateway;
  /** 稳定筛选快照。禁止写入 `Date.now()` 解析出的 from/to（STATE-02）。 */
  listKey?: unknown;
  listEnabled?: boolean;
  canGenerate?: boolean;
  isConflictError?: (error: unknown) => boolean;
  createIdempotencyKey?: () => string;
  onShowGenerate?: () => void;
  onSessionUrlChange?: (sessionId: string | null) => void;
  onAuthRequired?: () => void;
  onHistoryJob?: (
    job: Awaited<ReturnType<GenerationGateway["createGeneration"]>>,
  ) => void;
  onLibraryPrompt?: (prompt: Awaited<ReturnType<PromptGateway["getPrompt"]>>) => void;
}

export function requirePageControllerDeps<T extends { platform: PlatformServices }>(
  deps: T | null | undefined,
  name: string,
): T {
  if (!deps?.platform) {
    throw new Error(`${name} requires explicit platform deps; do not read them from React Context`);
  }
  return deps;
}
