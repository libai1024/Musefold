import type { PromptDocument, PromptReferenceSelection } from '@musefold/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  addPromptReference,
  buildExcerptPromptReference,
  buildFullPromptReference,
  isDuplicatePromptReference,
  notifyPromptReferenceAddError,
  notifyPromptReferenceSelectionError,
  promptReferenceKey,
  promptReferenceScopeLabel,
  resolvePromptReferenceDisplay,
} from '../prompt-references';
import { toast } from '@musefold/ui/components/sonner';

vi.mock('@musefold/ui/components/sonner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@musefold/ui/components/sonner')>();
  return { ...actual, toast: { ...actual.toast, error: vi.fn(), success: vi.fn() } };
});

function makePrompt(overrides: Partial<PromptDocument> = {}): PromptDocument {
  const timestamp = '2026-08-29T08:00:00+00:00';
  return {
    id: 'prompt-1',
    title: '都市夜景',
    description: null,
    content: '霓虹雨夜的城市街景，电影感',
    negative: null,
    folderId: null,
    tags: [],
    modelId: null,
    params: null,
    rating: 0,
    isPinned: false,
    pinOrder: null,
    usageCount: 0,
    lastUsedAt: null,
    source: 'manual',
    sourceUrl: null,
    version: 3,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    ...overrides,
  };
}

const FULL: PromptReferenceSelection = { promptId: 'prompt-1', scope: 'full', expectedVersion: 3 };
const EXCERPT: PromptReferenceSelection = {
  promptId: 'prompt-1',
  scope: 'excerpt',
  expectedVersion: 3,
  range: { start: 0, end: 4 },
};

describe('promptReferenceKey / isDuplicatePromptReference(判重口径)', () => {
  it('key 由 promptId + 形态 + 区间决定;完全相同的意图判重', () => {
    expect(promptReferenceKey(FULL)).toBe('prompt-1|full');
    expect(promptReferenceKey(EXCERPT)).toBe('prompt-1|0-4');
    expect(isDuplicatePromptReference([FULL], { ...FULL })).toBe(true);
    expect(isDuplicatePromptReference([EXCERPT], { ...EXCERPT })).toBe(true);
  });

  it('同 prompt 不同形态/不同区间不算重复;expectedVersion 不参与判重(版本漂移另行提示)', () => {
    expect(isDuplicatePromptReference([FULL], EXCERPT)).toBe(false);
    expect(isDuplicatePromptReference([EXCERPT], { ...EXCERPT, range: { start: 2, end: 6 } })).toBe(
      false,
    );
    expect(isDuplicatePromptReference([FULL], { ...FULL, expectedVersion: 4 })).toBe(true);
  });
});

describe('build*PromptReference(意图构造:只含 id/版本/区间,不含任何客户端文本)', () => {
  it('整条意图', () => {
    expect(buildFullPromptReference(makePrompt())).toEqual({
      promptId: 'prompt-1',
      scope: 'full',
      expectedVersion: 3,
    });
  });

  it('片段意图带 UTF-16 区间', () => {
    expect(buildExcerptPromptReference(makePrompt(), { start: 2, end: 9 })).toEqual({
      promptId: 'prompt-1',
      scope: 'excerpt',
      expectedVersion: 3,
      range: { start: 2, end: 9 },
    });
  });
});

describe('addPromptReference(上限 6 条与重复不静默)', () => {
  it('合法追加', () => {
    const result = addPromptReference([FULL], {
      promptId: 'prompt-2',
      scope: 'full',
      expectedVersion: 1,
    });
    expect(result).toEqual({
      ok: true,
      next: [FULL, { promptId: 'prompt-2', scope: 'full', expectedVersion: 1 }],
    });
  });

  it('第 7 条拒绝(full)', () => {
    const six = Array.from({ length: 6 }, (_, index) => ({
      promptId: `prompt-${index}`,
      scope: 'full' as const,
      expectedVersion: 1,
    }));
    expect(addPromptReference(six, FULL)).toEqual({ ok: false, reason: 'full' });
  });

  it('重复拒绝(duplicate)', () => {
    expect(addPromptReference([EXCERPT], { ...EXCERPT })).toEqual({
      ok: false,
      reason: 'duplicate',
    });
  });
});

describe('引用反馈 toast 口径(明确中文文案)', () => {
  it('上限:标题 + 描述', () => {
    notifyPromptReferenceAddError('full');
    expect(toast.error).toHaveBeenCalledWith('引用数量已满', {
      description: '最多同时引用 6 条提示词。',
    });
  });

  it('重复:单句', () => {
    notifyPromptReferenceAddError('duplicate');
    expect(toast.error).toHaveBeenCalledWith('已经引用过这段内容');
  });

  it('选区:未选中 / 超长', () => {
    notifyPromptReferenceSelectionError('empty');
    expect(toast.error).toHaveBeenCalledWith('没有选中内容', {
      description: '请先在提示词正文里选中要引用的片段。',
    });
    notifyPromptReferenceSelectionError('too-long');
    expect(toast.error).toHaveBeenCalledWith('选中内容过长', {
      description: '请把选区缩短到 4000 字以内。',
    });
  });
});

describe('resolvePromptReferenceDisplay(托盘展示解析,不伪造内容)', () => {
  it('loading / unavailable(已删除或无权)兜底可见文案', () => {
    expect(resolvePromptReferenceDisplay(FULL, undefined, 'loading')).toMatchObject({
      status: 'loading',
      title: '加载中…',
    });
    const unavailable = resolvePromptReferenceDisplay(FULL, undefined, 'error');
    expect(unavailable.status).toBe('unavailable');
    expect(unavailable.title).toBe('提示词不可用');
    expect(unavailable.preview).toContain('已删除或不可访问');
  });

  it('ready:整条预览 = 当前正文;版本一致', () => {
    const resolved = resolvePromptReferenceDisplay(FULL, makePrompt(), 'ready');
    expect(resolved).toMatchObject({
      status: 'ready',
      title: '都市夜景',
      preview: '霓虹雨夜的城市街景，电影感',
      scopeLabel: '引用提示词 · 整条',
    });
  });

  it('片段预览按 UTF-16 区间从当前正文截取(含 astral 字符按 code unit 计)', () => {
    const prompt = makePrompt({ content: 'a😀b测试' });
    // '😀' 占 2 个 UTF-16 code unit:[0,3) = 'a😀'。
    const resolved = resolvePromptReferenceDisplay(
      { promptId: 'prompt-1', scope: 'excerpt', expectedVersion: 3, range: { start: 0, end: 3 } },
      prompt,
      'ready',
    );
    expect(resolved.preview).toBe('a😀');
    expect(resolved.scopeLabel).toBe('引用提示词 · 选中片段');
  });

  it('stale:源版本漂移可见(标题按当前解析,不回落伪造)', () => {
    const resolved = resolvePromptReferenceDisplay(
      FULL,
      makePrompt({ version: 4, title: '都市夜景 v2' }),
      'ready',
    );
    expect(resolved.status).toBe('stale');
    expect(resolved.title).toBe('都市夜景 v2');
  });

  it('过期区间随当前内容自然截断,不越界伪造', () => {
    const resolved = resolvePromptReferenceDisplay(
      { promptId: 'prompt-1', scope: 'excerpt', expectedVersion: 3, range: { start: 2, end: 40 } },
      makePrompt({ content: '短文本' }),
      'ready',
    );
    expect(resolved.preview).toBe('本');
  });
});

describe('promptReferenceScopeLabel', () => {
  it('整条 / 选中片段', () => {
    expect(promptReferenceScopeLabel('full')).toBe('引用提示词 · 整条');
    expect(promptReferenceScopeLabel('excerpt')).toBe('引用提示词 · 选中片段');
  });
});
