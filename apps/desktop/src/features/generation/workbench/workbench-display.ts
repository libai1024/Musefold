import type { ImageQuality } from "@musefold/desktop-contracts/enums";
import {
  WORKBENCH_QUALITY_OPTIONS,
  workbenchFormatParams,
  workbenchRatioOptions,
} from "@musefold/product-ui";

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
