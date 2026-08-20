import { describe, expect, it } from 'vitest';
import { promptDocumentSchema } from '@musefold/contracts';
import type { Prompt, Tag } from '@musefold/desktop-contracts/models';
import { UNFILED_FOLDER_ID } from '@musefold/domain/constants';
import {
  applyPromptDocumentToRow,
  cloudSourceToDesktop,
  combinePromptListRows,
  desktopSourceToCloud,
  newPromptDocumentToRow,
  newPromptRowToDocument,
  paginatePromptRows,
  pickReversiblePromptRow,
  promptDocumentToRow,
  promptListQueryToRowQuery,
  promptRowToDocument,
  updatePatchToDocument,
  updatePromptDocumentToPatch,
} from '../mappers/prompt';

const TAG: Tag = {
  id: 'tag-ink',
  name: '水墨',
  tagGroup: '风格',
  color: '#aabbcc',
  createdAt: 1_720_000_000_000,
};

function makeRow(patch: Partial<Prompt> = {}): Prompt {
  return {
    id: 'prompt-1',
    title: '雨巷海报',
    description: '湿润空气',
    content: 'cinematic rain alley poster',
    contentNegative: 'blur, watermark',
    folderId: 'folder-1',
    modelId: 'gpt-image-2',
    params: { schemaVersion: 1, size: '1024x1024', quality: 'high', n: 1 },
    previewImagePath: '/tmp/preview.png',
    coverImagePath: '/tmp/cover.png',
    rating: 4,
    isPinned: true,
    pinOrder: 2,
    usageCount: 7,
    lastUsedAt: 1_721_000_000_000,
    source: 'shared',
    sourceUrl: 'https://example.com/share',
    tags: [TAG],
    createdAt: 1_719_000_000_000,
    updatedAt: 1_722_000_000_000,
    deletedAt: null,
    ...patch,
  };
}

describe('prompt row ↔ document mapping', () => {
  it('round-trips declared reversible fields including shared↔share', () => {
    const row = makeRow();
    const doc = promptRowToDocument(row);
    expect(promptDocumentSchema.parse(doc).source).toBe('share');
    expect(doc).not.toHaveProperty('previewImagePath');
    expect(doc).not.toHaveProperty('coverImagePath');
    expect(doc.version).toBe(1);

    const roundTripped = promptDocumentToRow(doc);
    expect(pickReversiblePromptRow(roundTripped)).toEqual(pickReversiblePromptRow(row));
    expect(roundTripped.previewImagePath).toBeNull();
    expect(roundTripped.coverImagePath).toBeNull();
  });

  it('maps generation source to import and drops invalid tag color', () => {
    const doc = promptRowToDocument(makeRow({ source: 'manual' }));
    const generationRow = promptDocumentToRow({ ...doc, source: 'generation' });
    expect(generationRow.source).toBe('import');
    expect(cloudSourceToDesktop('generation')).toBe('import');
    expect(desktopSourceToCloud('slip')).toBe('slip');

    const colored = promptRowToDocument(
      makeRow({ tags: [{ ...TAG, color: 'red' }] }),
    );
    expect(colored.tags[0].color).toBeNull();
  });

  it('fills schemaVersion when cloud params omit it', () => {
    const created = newPromptDocumentToRow({
      title: '草稿',
      description: null,
      content: 'a quiet still',
      negative: null,
      folderId: null,
      tagIds: ['tag-ink'],
      modelId: null,
      params: { size: 'auto' },
      rating: 0,
      isPinned: false,
      source: 'manual',
      sourceUrl: null,
    });
    expect(created.contentNegative).toBeUndefined();
    expect(created.folderId).toBeUndefined();
    expect(created.params).toEqual({ size: 'auto', schemaVersion: 1 });
    expect(created).not.toHaveProperty('pinOrder');
  });

  it('drops expectedVersion and pinOrder on update patches', () => {
    const patch = updatePromptDocumentToPatch({
      expectedVersion: 9,
      title: '改名',
      negative: 'lowres',
      pinOrder: 4,
      isPinned: true,
    });
    expect(patch).toEqual({
      title: '改名',
      contentNegative: 'lowres',
      isPinned: true,
    });
    expect(patch).not.toHaveProperty('expectedVersion');
    expect(patch).not.toHaveProperty('pinOrder');
  });

  it('maps unfiled folderId null to the desktop sentinel and paginates with offset cursor', () => {
    const rowQuery = promptListQueryToRowQuery({
      folderId: null,
      pinnedOnly: true,
      sort: 'title-asc',
      q: 'rain',
    });
    expect(rowQuery).toMatchObject({
      folderId: UNFILED_FOLDER_ID,
      search: 'rain',
      sort: 'title',
      sortDir: 'desc',
      filters: { isPinned: true },
    });

    const rows = [makeRow({ id: 'a' }), makeRow({ id: 'b' }), makeRow({ id: 'c' })];
    const page = paginatePromptRows(combinePromptListRows(rows), { limit: 2 });
    expect(page.items.map((item) => item.id)).toEqual(['a', 'b']);
    expect(page.nextCursor).toBe('2');
    const rest = paginatePromptRows(rows, { limit: 2, cursor: page.nextCursor ?? undefined });
    expect(rest.items.map((item) => item.id)).toEqual(['c']);
    expect(rest.nextCursor).toBeNull();
    expect(paginatePromptRows(rows, { cursor: 'nope' }).items[0].id).toBe('a');
  });

  it('applyPromptDocumentToRow overlays reversible fields and keeps cover paths', () => {
    const prev = makeRow();
    const doc = promptRowToDocument(
      makeRow({
        title: '改名',
        content: 'rewritten body',
        previewImagePath: '/tmp/other-preview.png',
        coverImagePath: '/tmp/other-cover.png',
      }),
    );
    const applied = applyPromptDocumentToRow(prev, doc);
    expect(applied.title).toBe('改名');
    expect(applied.content).toBe('rewritten body');
    expect(pickReversiblePromptRow(applied)).toEqual(
      pickReversiblePromptRow(
        makeRow({ title: '改名', content: 'rewritten body' }),
      ),
    );
    expect(applied.previewImagePath).toBe('/tmp/preview.png');
    expect(applied.coverImagePath).toBe('/tmp/cover.png');

    const roundTripped = applyPromptDocumentToRow(prev, promptRowToDocument(prev));
    expect(pickReversiblePromptRow(roundTripped)).toEqual(pickReversiblePromptRow(prev));
    expect(roundTripped.previewImagePath).toBe(prev.previewImagePath);
    expect(roundTripped.coverImagePath).toBe(prev.coverImagePath);
  });

  it('maps NewPrompt to NewPromptDocument and drops previewImagePath', () => {
    const doc = newPromptRowToDocument({
      title: '草稿',
      description: '湿润空气',
      content: 'a quiet still',
      contentNegative: 'blur',
      isPinned: true,
      folderId: 'folder-1',
      modelId: 'gpt-image-2',
      params: { schemaVersion: 1, size: '1024x1024' },
      previewImagePath: '/tmp/preview.png',
      rating: 3,
      source: 'shared',
      sourceUrl: 'https://example.com/share',
      tagIds: ['tag-ink'],
    });
    expect(doc).toEqual({
      title: '草稿',
      description: '湿润空气',
      content: 'a quiet still',
      negative: 'blur',
      folderId: 'folder-1',
      tagIds: ['tag-ink'],
      modelId: 'gpt-image-2',
      params: { schemaVersion: 1, size: '1024x1024' },
      rating: 3,
      isPinned: true,
      source: 'share',
      sourceUrl: 'https://example.com/share',
    });
    expect(doc).not.toHaveProperty('previewImagePath');
    expect(doc).not.toHaveProperty('pinOrder');

    const back = newPromptDocumentToRow(doc);
    expect(back.previewImagePath).toBeUndefined();
    expect(back.contentNegative).toBe('blur');
    expect(back.source).toBe('shared');
  });

  it('maps update patches with synthetic expectedVersion and drops previewImagePath', () => {
    const doc = updatePatchToDocument({
      title: '改名',
      contentNegative: 'lowres',
      previewImagePath: '/tmp/x.png',
      source: 'shared',
      isPinned: true,
    });
    expect(doc).toEqual({
      expectedVersion: 1,
      title: '改名',
      negative: 'lowres',
      source: 'share',
      isPinned: true,
    });
    expect(doc).not.toHaveProperty('previewImagePath');
  });
});
