import {
  parseCustomRatioId,
  RATIO_OPTIONS,
} from '@musefold/domain/constants';
import type {
  ImageBackground,
  ImageQuality,
  ModerationLevel,
  PromptTarget,
} from '@musefold/desktop-contracts/enums';
import type { PromptParams } from '@musefold/desktop-contracts/generation-snapshots';
import { DEFAULT_REFINE_PARAMS, REFINE_COUNTS, type RefineParams } from './generation-params';

const QUALITIES = new Set<ImageQuality>(['low', 'medium', 'high', 'auto']);
const BACKGROUNDS = new Set<ImageBackground>(['auto', 'transparent', 'opaque']);
const MODERATIONS = new Set<ModerationLevel>(['auto', 'low']);
const RATIO_IDS = new Set(RATIO_OPTIONS.map((option) => option.id));
const PROMPT_TARGETS = new Set<PromptTarget>([
  'a1111',
  'comfyui',
  'midjourney',
  'flux',
  'sd3',
  'openai',
  'generic',
]);

function stringValue(params: PromptParams, key: string): string | undefined {
  const value = params[key];
  return typeof value === 'string' ? value : undefined;
}

function ratioIdFromPromptParams(params: PromptParams): string {
  const ratioId = stringValue(params, 'ratioId');
  if (ratioId && (RATIO_IDS.has(ratioId) || parseCustomRatioId(ratioId))) return ratioId;
  const aspectRatio = stringValue(params, 'aspectRatio');
  if (aspectRatio && RATIO_IDS.has(aspectRatio)) return aspectRatio;
  if (params.size === '2048x2048') return '1:1';
  return RATIO_OPTIONS.find((option) => option.size === params.size)?.id ?? '1:1';
}

export function promptTargetFromParams(
  params: PromptParams | null | undefined,
  fallback: PromptTarget = 'generic',
): PromptTarget {
  if (!params) return fallback;
  const explicit = stringValue(params, 'promptTarget');
  if (explicit && PROMPT_TARGETS.has(explicit as PromptTarget)) return explicit as PromptTarget;
  if (
    params.size !== undefined
    || params.quality !== undefined
    || params.background !== undefined
    || params.moderation !== undefined
  ) {
    return 'openai';
  }
  return fallback;
}

export function promptParamsToRefineParams(params: PromptParams): RefineParams {
  const quality = params.quality && QUALITIES.has(params.quality)
    ? params.quality
    : DEFAULT_REFINE_PARAMS.quality;
  const count = REFINE_COUNTS.includes(params.n as (typeof REFINE_COUNTS)[number])
    ? (params.n as number)
    : DEFAULT_REFINE_PARAMS.n;
  return {
    ratioId: ratioIdFromPromptParams(params),
    quality,
    n: count,
    background:
      params.background && BACKGROUNDS.has(params.background)
        ? params.background
        : DEFAULT_REFINE_PARAMS.background,
    moderation:
      params.moderation && MODERATIONS.has(params.moderation)
        ? params.moderation
        : undefined,
  };
}
