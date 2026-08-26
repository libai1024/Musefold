import type { ImageQuality } from "@musefold/desktop-contracts/enums";
import {
  WORKBENCH_QUALITY_OPTIONS,
  workbenchFormatParams,
  workbenchRatioOptions,
} from "@musefold/product-ui";
import type { GenerationTurn } from "./types";

export const QUALITY_OPTIONS: { id: ImageQuality; label: string; hint: string }[] =
  WORKBENCH_QUALITY_OPTIONS.map((option) => ({
    id: option.id,
    label: option.label,
    hint: option.hint,
  }));

export const WORKBENCH_RATIO_OPTIONS = workbenchRatioOptions();

export function formatParams(params: { ratioId: string; quality: string; n: number }) {
  return workbenchFormatParams(params);
}

const TASK_SOURCE_LABELS = {
  manual: "自由创作",
  prompt: "提示词来源",
  skill: "Skill",
  "scheme-creation": "方案创建",
  scheme: "设计方案",
  "scheme-run": "设计方案",
  history: "历史复用",
} as const satisfies Record<GenerationTurn["source"]["kind"], string>;

type TaskSummaryTurn = Pick<GenerationTurn, "results" | "source" | "status">;

export function summarizeWorkbenchTask(turns: readonly TaskSummaryTurn[]) {
  const latest = turns.at(-1);
  if (!latest) return null;

  const resultCount = turns.reduce(
    (count, turn) =>
      count + turn.results.filter((result) => result.status === "success").length,
    0,
  );
  const isRunning = turns.some(
    (turn) => turn.status === "pending" || turn.status === "running",
  );
  const hasPartialResult = turns.some((turn) => turn.status === "partial");

  let activityLabel: string;
  if (isRunning) activityLabel = resultCount > 0 ? `${resultCount} 张 · 生成中` : "生成中";
  else if (hasPartialResult) activityLabel = `${resultCount} 张 · 部分完成`;
  else if (resultCount > 0) activityLabel = `${resultCount} 张图`;
  else if (latest.status === "failed") activityLabel = "生成失败";
  else if (latest.status === "cancelled") activityLabel = "已取消";
  else activityLabel = "等待结果";

  return {
    activityLabel,
    sourceLabel: TASK_SOURCE_LABELS[latest.source.kind],
  };
}
