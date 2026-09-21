import { describe, expect, it } from 'vitest';
import { sourceSnapshotSchema, designSchemeHistoryItemSchema } from '../design-scheme';
import { designSchemeUpdateContextSchema } from '../design-scheme-agent';
const item = {
  selection: { runId: 'run', assetId: 'original', includePrompt: true },
  imageAssetId: 'copy',
  imagePath: 'history/copy.png',
  promptPath: 'history/copy.txt',
  prompt: 'Image style 20% contrast',
};
const image = {
  relativePath: item.imagePath,
  kind: 'image',
  mimeType: 'image/png',
  sizeBytes: 4,
  contentHash: 'a'.repeat(64),
  evidencePath: item.imagePath,
  textExcerpt: null,
};
const text = {
  ...image,
  relativePath: item.promptPath,
  kind: 'text',
  mimeType: 'text/plain',
  evidencePath: item.promptPath,
};
const snapshot = {
  id: 'history-snapshot',
  packageId: 'history-package',
  kind: 'history',
  resolvedRef: 'history',
  files: [image, text],
  totalBytes: 8,
  createdAt: '2026-09-09T00:00:00Z',
  historyItems: [item],
};
describe('immutable history source contract', () => {
  it('keeps full selected text as text, rejects false consent and unexpected storage fields', () => {
    expect(designSchemeHistoryItemSchema.parse(item).prompt).toBe(item.prompt);
    expect(
      designSchemeHistoryItemSchema.safeParse({
        ...item,
        selection: { ...item.selection, includePrompt: false },
      }).success,
    ).toBe(false);
    expect(designSchemeHistoryItemSchema.safeParse({ ...item, objectKey: 'secret' }).success).toBe(
      false,
    );
    expect(
      designSchemeHistoryItemSchema.safeParse({ ...item, prompt: 'x'.repeat(8001) }).success,
    ).toBe(false);
  });
  it('requires real snapshot files, history kind, unique identities and explicit prompt limits', () => {
    expect(sourceSnapshotSchema.safeParse(snapshot).success).toBe(true);
    for (const raw of [
      { ...snapshot, kind: 'github' },
      { ...snapshot, files: [image] },
      { ...snapshot, historyItems: [item, item] },
      {
        ...snapshot,
        historyItems: Array.from({ length: 9 }, (_, i) => ({
          ...item,
          imageAssetId: `copy${i}`,
          selection: { ...item.selection, assetId: `original${i}` },
        })),
      },
    ])
      expect(sourceSnapshotSchema.safeParse(raw).success).toBe(false);
    expect(
      sourceSnapshotSchema.safeParse({
        ...snapshot,
        historyItems: [
          {
            ...item,
            prompt: null,
            promptPath: null,
            selection: { ...item.selection, includePrompt: false },
          },
        ],
        files: [image],
      }).success,
    ).toBe(true);
  });
  it('allows update context to retain a history snapshot alongside sixteen GitHub snapshots', () => {
    expect(
      designSchemeUpdateContextSchema.shape.snapshots.safeParse(
        Array.from({ length: 17 }, (_, i) => ({ ...snapshot, id: `snapshot${i}` })),
      ).success,
    ).toBe(true);
    expect(
      designSchemeUpdateContextSchema.shape.snapshots.safeParse(
        Array.from({ length: 33 }, (_, i) => ({ ...snapshot, id: `snapshot${i}` })),
      ).success,
    ).toBe(false);
  });
});
