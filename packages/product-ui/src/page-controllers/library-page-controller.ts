import { requirePageControllerDeps, type LibraryPageControllerDeps } from "./types";

export type { LibraryPageControllerDeps };

/** ORCH-01 骨架：签名冻结为显式 deps。取数/过滤/动作业 ORCH-02 填充。 */
export function useLibraryPageController(deps: LibraryPageControllerDeps): LibraryPageControllerDeps {
  return requirePageControllerDeps(deps, "useLibraryPageController");
}
