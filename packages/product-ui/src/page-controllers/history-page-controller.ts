import { requirePageControllerDeps, type HistoryPageControllerDeps } from "./types";

export type { HistoryPageControllerDeps };

/** ORCH-01 骨架：签名冻结为显式 deps。取数/过滤/动作业 ORCH-02 填充。 */
export function useHistoryPageController(deps: HistoryPageControllerDeps): HistoryPageControllerDeps {
  return requirePageControllerDeps(deps, "useHistoryPageController");
}
