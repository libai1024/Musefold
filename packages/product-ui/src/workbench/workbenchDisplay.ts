import { RATIO_OPTIONS } from "@musefold/domain/constants";
import type { WorkbenchRatioOption } from "./WorkbenchRatioPicker";

export const WORKBENCH_QUALITY_OPTIONS: {
  id: "auto" | "low" | "medium" | "high";
  label: string;
  hint: string;
}[] = [
  { id: "auto", label: "自动", hint: "模型默认" },
  { id: "low", label: "标准", hint: "更快" },
  { id: "medium", label: "高清", hint: "平衡" },
  { id: "high", label: "超清", hint: "细节优先" },
];

/**
 * Ratio catalog for the composer picker, derived from the domain option list.
 * `ids` selects a host-specific subset in the given order; hosts differ in how
 * many ratios they surface, not in what a given ratio means.
 */
export function workbenchRatioOptions(
  ids?: readonly string[],
): WorkbenchRatioOption[] {
  const catalog: WorkbenchRatioOption[] = RATIO_OPTIONS.map((option) => ({
    id: option.id,
    label: option.label,
    ratio: option.ratio,
    detail: option.size === "auto" ? (option.hint ?? "由模型决定") : option.size,
  }));
  if (!ids) return catalog;
  return ids.flatMap((id) => catalog.filter((option) => option.id === id));
}

export function workbenchFormatParams(params: {
  ratioId: string;
  quality: string;
  n: number;
}): string {
  return `${params.ratioId} · ${params.quality} · ${params.n}张`;
}
