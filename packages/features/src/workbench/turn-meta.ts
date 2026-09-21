import type { GenerationJob } from '@musefold/contracts';
import { QUALITY_OPTIONS } from './Composer';

/**
 * 用户消息 meta 行(ui-parity 03 §4):比例 · 质量 · 张数(>1 时)。
 * 文案与 Composer 目录同源(比例取契约 id,auto 即 `auto`;质量走 QUALITY_OPTIONS)。
 */
export function turnMetaSegments(job: GenerationJob): string[] {
  const quality = job.request.quality;
  const qualityLabel = QUALITY_OPTIONS.find((option) => option.id === quality)?.label ?? quality;
  const segments = [job.request.aspectRatio ?? 'auto', qualityLabel];
  if (job.request.count > 1) segments.push(`${job.request.count} 张`);
  return segments;
}

/**
 * 回合序号(#1 起):时间线按创建时间升序,序号即可视顺序。
 * 用于「来自 #xx 微调」——`parentRunId` 指向同会话的父回合。
 */
export function turnNumbers(jobs: readonly GenerationJob[]): Map<string, number> {
  return new Map(jobs.map((job, index) => [job.id, index + 1]));
}
