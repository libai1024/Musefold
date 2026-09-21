import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { readValidatedDesignSchemePackageBytes } from '@musefold/scheme-package';
import { preparePackageImportContent } from '../modules/design-scheme-packages/import-content.js';
import { saveCapacityCase, capacitySides } from './fixtures/package-capacity-corpus.js';

describe('actual small package capacity fixtures', () => {
  for (const dimension of ['manifest', 'entries', 'ratio'] as const) {
    for (const side of capacitySides) {
      it(`${dimension}-${side} measures actual ZIP boundaries and preserves decodable legal content`, async () => {
        const directory = await mkdtemp(join(tmpdir(), 'capacity-case-'));
        try {
          const item = await saveCapacityCase(directory, dimension, side);
          const bytes = await readFile(item.path);
          if (!item.accepted) {
            await expect(readValidatedDesignSchemePackageBytes(bytes)).rejects.toThrow(
              item.expectedError,
            );
          } else {
            const content = await preparePackageImportContent(bytes, {
              seed: '713188f7-5410-488f-a849-5b736df58b45',
              createdAt: '2026-09-13T00:00:00.000Z',
            });
            expect(content.files.length).toBeGreaterThan(0);
            expect(content.assets.length).toBeGreaterThan(0);
            expect(
              content.assets.every((asset) =>
                ['reference', 'example'].includes(asset.metadata.role),
              ),
            ).toBe(true);
          }
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      });
    }
  }
});
