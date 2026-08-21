// History -> Generate 精修的参数映射（TASK-HIS-08）

import { RATIO_OPTIONS } from '@musefold/domain/constants';
import type { ImageBackground, ImageQuality, ModerationLevel } from '@musefold/desktop-contracts/enums';
import type { PromptParams } from '@musefold/desktop-contracts/generation-snapshots';
import {
  DEFAULT_REFINE_PARAMS,
  REFINE_COUNTS,
  type RefineParams,
} from '../generation/params';

const QUALITY_VALUES = new Set<ImageQuality>(['low', 'medium', 'high', 'auto']);
const BACKGROUND_VALUES = new Set<ImageBackground>(['auto', 'transparent', 'opaque']);
const MODERATION_VALUES = new Set<ModerationLevel>(['auto', 'low']);

function stringValue(params: PromptParams, key: string): string | undefined {
  const value = params[key];
  return typeof value === 'string' ? value : undefined;
}

function resolveHistoryRatioId(params: PromptParams): string {
  const aspectRatio = stringValue(params, 'aspectRatio');
  if (aspectRatio) {
    const byRatio = RATIO_OPTIONS.find((r) => r.id === aspectRatio || r.ratio === aspectRatio);
    if (byRatio) return byRatio.id;
  }

  const size = params.size;
  if (size) {
    const bySize = RATIO_OPTIONS.find((r) => r.size === size);
    if (bySize) return bySize.id;
  }

  return DEFAULT_REFINE_PARAMS.ratioId;
}

function resolveHistoryCount(value: number | undefined): RefineParams['n'] {
  const counts: readonly number[] = REFINE_COUNTS;
  return typeof value === 'number' && counts.includes(value)
    ? (value as RefineParams['n'])
    : DEFAULT_REFINE_PARAMS.n;
}

export function historyParamsToRefineParams(
  params: PromptParams | null | undefined,
): Partial<RefineParams> | undefined {
  if (!params) return undefined;

  const next: Partial<RefineParams> = {
    ratioId: resolveHistoryRatioId(params),
    n: resolveHistoryCount(params.n),
  };

  if (params.quality && QUALITY_VALUES.has(params.quality)) {
    next.quality = params.quality;
  }
  if (params.background && BACKGROUND_VALUES.has(params.background)) {
    next.background = params.background;
  }
  if (params.moderation && MODERATION_VALUES.has(params.moderation)) {
    next.moderation = params.moderation;
  }

  return next;
}
