import type { ImageQuality } from "@musefold/desktop-contracts/enums";
import { RATIO_OPTIONS } from "@musefold/domain/constants";
import {
  WORKBENCH_QUALITY_OPTIONS,
  workbenchFormatParams,
} from "@musefold/product-ui";

export const QUALITY_OPTIONS: { id: ImageQuality; label: string; hint: string }[] =
  WORKBENCH_QUALITY_OPTIONS.map((option) => ({
    id: option.id,
    label: option.label,
    hint: option.hint,
  }));

export const WORKBENCH_RATIO_OPTIONS = RATIO_OPTIONS.map((option) => ({
  id: option.id,
  label: option.label,
  ratio: option.ratio,
  detail: option.size === "auto" ? (option.hint ?? "由模型决定") : option.size,
}));

export function formatParams(params: { ratioId: string; quality: string; n: number }) {
  return workbenchFormatParams(params);
}
