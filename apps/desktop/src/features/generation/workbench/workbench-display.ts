import type { ImageQuality } from "@musefold/desktop-contracts/enums";
import { RATIO_OPTIONS } from "@musefold/domain/constants";

export const QUALITY_OPTIONS: { id: ImageQuality; label: string; hint: string }[] = [
  { id: "auto", label: "自动", hint: "模型默认" },
  { id: "low", label: "标准", hint: "更快" },
  { id: "medium", label: "高清", hint: "平衡" },
  { id: "high", label: "超清", hint: "细节优先" },
];

export const WORKBENCH_RATIO_OPTIONS = RATIO_OPTIONS.map((option) => ({
  id: option.id,
  label: option.label,
  ratio: option.ratio,
  detail: option.size === "auto" ? (option.hint ?? "由模型决定") : option.size,
}));

export function formatParams(params: { ratioId: string; quality: string; n: number }) {
  return `${params.ratioId} · ${params.quality} · ${params.n}张`;
}
