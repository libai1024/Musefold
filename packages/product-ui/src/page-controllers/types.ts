import type {
  HistoryGateway,
  PlatformServices,
  PromptGateway,
  WorkbenchGateway,
} from "@musefold/domain";

/**
 * 页面编排 hook 的显式依赖。禁止用 React Context 隐式注入端口或平台能力。
 */
export interface HistoryPageControllerDeps {
  history: HistoryGateway;
  platform: PlatformServices;
}

export interface LibraryPageControllerDeps {
  prompts: PromptGateway;
  platform: PlatformServices;
}

export interface GeneratePageControllerDeps {
  workbench: WorkbenchGateway;
  platform: PlatformServices;
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
