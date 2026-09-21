import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  decodeLegacyDesignSchemePackage,
  readValidatedDesignSchemePackage,
  readValidatedDesignSchemePackageBytes,
  sha256,
} from '@musefold/scheme-package';
import { savePackageImportCorpus } from './fixtures/package-import-corpus.js';
import { FULL_PROMPT } from '../modules/design-scheme-packages/__tests__/import-fixture.js';

const ids = [
  'v1-full-source',
  'v2-mixed-unicode',
  'crc-damage',
  'asset-hash',
  'source-hash',
  'duplicate-entry',
  'case-alias',
  'unicode-alias',
  'traversal',
  'unsupported-version',
  'encrypted',
  'symlink',
];
let directory = '';
let corpus: Awaited<ReturnType<typeof savePackageImportCorpus>>;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'scheme-import-corpus-'));
  corpus = await savePackageImportCorpus(directory);
});
afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});
describe('shared saved import corpus', () => {
  it.each(ids)('%s has identical file and byte reader decisions', async (id) => {
    const item = corpus.find((item) => item.id === id);
    if (!item) throw new Error(`Missing corpus ${id}`);
    const bytes = await readFile(item.path);
    expect(bytes.length).toBe(item.bytes);
    expect(sha256(bytes)).toBe(item.sha256);
    if (!item.accepted) {
      const expected = new RegExp(item.expectedError ?? '^$');
      await expect(readValidatedDesignSchemePackage(item.path)).rejects.toThrow(expected);
      await expect(readValidatedDesignSchemePackageBytes(bytes)).rejects.toThrow(expected);
      return;
    }
    const file = await readValidatedDesignSchemePackage(item.path);
    expect(await readValidatedDesignSchemePackageBytes(bytes)).toEqual(file);
    if (file.formatVersion === 1) {
      const decoded = decodeLegacyDesignSchemePackage(file);
      expect(decoded.snapshots[0].files.find((file) => file.metadata.kind === 'text')?.text).toBe(
        FULL_PROMPT,
      );
    } else {
      expect(file.manifest.document.name).toBe('跨端 Café 山水 ✨');
      expect(new Set(file.manifest.assets.map((asset) => asset.contentHash)).size).toBe(3);
      expect(file.entries.get('sources/history-snap/prompt.txt')?.toString()).toBe(FULL_PROMPT);
    }
  });
});
