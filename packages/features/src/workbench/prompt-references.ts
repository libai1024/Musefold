'use client';

import {
  MAX_PROMPT_REFERENCE_SELECTIONS,
  type PromptDocument,
  type PromptReferenceSelection,
  type PromptReferenceSelectionRange,
  type PromptReferenceScope,
} from '@musefold/contracts';
import { toast } from '@musefold/ui/components/sonner';

/**
 * 提示词引用(选择意图)纯逻辑:客户端只携带 {promptId, scope, expectedVersion, range?},
 * title/text/content 等展示字段一律由宿主或 owner-safe 读取解析,绝不塞进创建请求。
 * 坐标是 JS UTF-16 code unit 语义(与契约一致):字符串 slice 天然按 UTF-16 计。
 */

/** 宿主解析后单条引用的正文上限(契约 resolvedPromptReferenceSnapshotSchema text max)。 */
export const PROMPT_REFERENCE_TEXT_MAX = 4_000;

/** 选择意图的稳定 key:同一意图重复添加判重的基准。 */
export function promptReferenceKey(selection: PromptReferenceSelection): string {
  return selection.scope === 'full'
    ? `${selection.promptId}|full`
    : `${selection.promptId}|${selection.range.start}-${selection.range.end}`;
}

/** 判重:同一 prompt 同一形态(整条,或完全相同的 UTF-16 区间)视为重复。 */
export function isDuplicatePromptReference(
  current: readonly PromptReferenceSelection[],
  candidate: PromptReferenceSelection,
): boolean {
  return current.some((existing) => promptReferenceKey(existing) === promptReferenceKey(candidate));
}

export function buildFullPromptReference(prompt: PromptDocument): PromptReferenceSelection {
  return { promptId: prompt.id, scope: 'full', expectedVersion: prompt.version };
}

export function buildExcerptPromptReference(
  prompt: PromptDocument,
  range: PromptReferenceSelectionRange,
): PromptReferenceSelection {
  return { promptId: prompt.id, scope: 'excerpt', expectedVersion: prompt.version, range };
}

export type AddPromptReferenceResult =
  | { ok: true; next: PromptReferenceSelection[] }
  | { ok: false; reason: 'full' | 'duplicate' };

/** 追加一条引用意图:超过 6 条或重复时不静默添加,由调用方按 reason 反馈。 */
export function addPromptReference(
  current: readonly PromptReferenceSelection[],
  candidate: PromptReferenceSelection,
): AddPromptReferenceResult {
  if (current.length >= MAX_PROMPT_REFERENCE_SELECTIONS) return { ok: false, reason: 'full' };
  if (isDuplicatePromptReference(current, candidate)) return { ok: false, reason: 'duplicate' };
  return { ok: true, next: [...current, candidate] };
}

/** 添加失败的统一 toast 口径(上限/重复)。 */
export function notifyPromptReferenceAddError(reason: 'full' | 'duplicate'): void {
  if (reason === 'full') {
    toast.error('引用数量已满', { description: '最多同时引用 6 条提示词。' });
  } else {
    toast.error('已经引用过这段内容');
  }
}

/** 选区非法(未选中/超 4000)时的 toast 口径,恢复路径 = 缩短选区后重试。 */
export function notifyPromptReferenceSelectionError(reason: 'empty' | 'too-long'): void {
  if (reason === 'too-long') {
    toast.error('选中内容过长', { description: '请把选区缩短到 4000 字以内。' });
  } else {
    toast.error('没有选中内容', { description: '请先在提示词正文里选中要引用的片段。' });
  }
}

/** 引用形态副标(草稿托盘与时间线共用口径)。 */
export function promptReferenceScopeLabel(scope: PromptReferenceScope): string {
  return scope === 'full' ? '引用提示词 · 整条' : '引用提示词 · 选中片段';
}

/** 解析状态:loading 读取中 / ready 命中且版本一致 / stale 源已更新 / unavailable 已删除或无权访问。 */
export type PromptReferenceStatus = 'loading' | 'ready' | 'stale' | 'unavailable';

/**
 * 草稿托盘的展示解析(视图模型):意图只含 id/版本/区间,
 * 标题与预览正文来自 owner-safe 的 prompts.get 读取;源不可用时不伪造内容,可见且可移除。
 */
export interface PromptReferenceResolution {
  key: string;
  intent: PromptReferenceSelection;
  status: PromptReferenceStatus;
  title: string;
  preview: string;
  scopeLabel: string;
}

export function resolvePromptReferenceDisplay(
  intent: PromptReferenceSelection,
  prompt: PromptDocument | undefined,
  state: 'loading' | 'ready' | 'error',
): PromptReferenceResolution {
  const key = promptReferenceKey(intent);
  const scopeLabel = promptReferenceScopeLabel(intent.scope);
  if (state === 'loading') {
    return { key, intent, status: 'loading', title: '加载中…', preview: '', scopeLabel };
  }
  if (state === 'error' || !prompt) {
    return {
      key,
      intent,
      status: 'unavailable',
      title: '提示词不可用',
      preview: '源提示词已删除或不可访问,可移除这条引用。',
      scopeLabel,
    };
  }
  const stale = prompt.version !== intent.expectedVersion;
  // 预览正文按 UTF-16 区间从当前内容解析;区间随旧版本过期时 slice 自然截断,不越界伪造。
  const preview =
    intent.scope === 'full'
      ? prompt.content
      : prompt.content.slice(intent.range.start, intent.range.end);
  return {
    key,
    intent,
    status: stale ? 'stale' : 'ready',
    title: prompt.title,
    preview,
    scopeLabel,
  };
}
