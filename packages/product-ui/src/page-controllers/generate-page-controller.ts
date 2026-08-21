import { requirePageControllerDeps, type GeneratePageControllerDeps } from "./types";

export type { GeneratePageControllerDeps };

/** ORCH-01 骨架：签名冻结为显式 deps。工作台编排业 ORCH-03 填充。 */
export function useGeneratePageController(deps: GeneratePageControllerDeps): GeneratePageControllerDeps {
  return requirePageControllerDeps(deps, "useGeneratePageController");
}
