import { describe, expect, it } from 'vitest';
import {
  newPromptDocumentSchema,
  promptCoverImageUrlSchema,
  promptDocumentSchema,
  promptEmptyTrashResultSchema,
  updatePromptDocumentSchema,
} from '../prompt';

const BASE_DOCUMENT = {
  id: 'prompt-1',
  title: '海报',
  description: null,
  content: 'poster',
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
  source: 'manual' as const,
  sourceUrl: null,
  version: 1,
  createdAt: '2026-09-01T00:00:00+00:00',
  updatedAt: '2026-09-01T00:00:00+00:00',
  deletedAt: null,
};

describe('promptCoverImageUrlSchema(封面 path-free 约束)', () => {
  it.each([
    'https://cdn.example/covers/a.png',
    'media://local/?p=%2FUsers%2Fme%2FPictures%2Fa.png',
    'data:image/png;base64,AAAA',
    'http://127.0.0.1:3399/covers/a.png',
  ])('接受受管展示地址 %s', (value) => {
    expect(promptCoverImageUrlSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    // 绝对路径是本地实现细节,绝不进契约。
    '/Users/me/Pictures/a.png',
    'C:\\Users\\me\\a.png',
    './relative.png',
    'file:///Users/me/Pictures/a.png',
    'http://cdn.example/a.png',
  ])('拒绝裸路径与不受管协议 %s', (value) => {
    expect(promptCoverImageUrlSchema.safeParse(value).success).toBe(false);
  });
});

describe('promptDocumentSchema.coverImageUrl', () => {
  it('缺省与 null 都合法(旧宿主/旧快照不判脏)', () => {
    expect(promptDocumentSchema.parse(BASE_DOCUMENT).coverImageUrl ?? null).toBeNull();
    expect(
      promptDocumentSchema.parse({ ...BASE_DOCUMENT, coverImageUrl: null }).coverImageUrl,
    ).toBeNull();
  });

  it('带封面时原样透传', () => {
    const parsed = promptDocumentSchema.parse({
      ...BASE_DOCUMENT,
      coverImageUrl: 'media://local/?p=%2Ftmp%2Fcover.png',
    });
    expect(parsed.coverImageUrl).toBe('media://local/?p=%2Ftmp%2Fcover.png');
  });

  it('本地绝对路径被拒(红线:路径不进契约)', () => {
    expect(
      promptDocumentSchema.safeParse({ ...BASE_DOCUMENT, coverImageUrl: '/tmp/cover.png' }).success,
    ).toBe(false);
  });
});

describe('新建 / 更新入参的封面字段', () => {
  it('新建可带封面(「存为提示词」写首图),也可整键缺省', () => {
    const withCover = newPromptDocumentSchema.parse({
      title: '来自生成',
      description: null,
      content: 'from generation',
      negative: null,
      folderId: null,
      modelId: null,
      params: null,
      coverImageUrl: 'https://cdn.example/a.png',
    });
    expect(withCover.coverImageUrl).toBe('https://cdn.example/a.png');

    const withoutCover = newPromptDocumentSchema.parse({
      title: '手工新建',
      description: null,
      content: 'manual',
      negative: null,
      folderId: null,
      modelId: null,
      params: null,
    });
    expect(withoutCover.coverImageUrl ?? null).toBeNull();
  });

  it('更新:缺省=不改,显式 null=清除封面', () => {
    const untouched = updatePromptDocumentSchema.parse({ expectedVersion: 1 });
    expect('coverImageUrl' in untouched && untouched.coverImageUrl !== undefined).toBe(false);

    const cleared = updatePromptDocumentSchema.parse({ expectedVersion: 1, coverImageUrl: null });
    expect(cleared.coverImageUrl).toBeNull();
  });
});

describe('promptEmptyTrashResultSchema', () => {
  it('只接受非负整数条数', () => {
    expect(promptEmptyTrashResultSchema.parse({ purged: 0 })).toEqual({ purged: 0 });
    expect(promptEmptyTrashResultSchema.parse({ purged: 12 })).toEqual({ purged: 12 });
    expect(promptEmptyTrashResultSchema.safeParse({ purged: -1 }).success).toBe(false);
    expect(promptEmptyTrashResultSchema.safeParse({ purged: 1.5 }).success).toBe(false);
  });
});
