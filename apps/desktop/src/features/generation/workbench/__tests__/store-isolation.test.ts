import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = dirname(fileURLToPath(import.meta.url));
const workbenchDir = join(dir, '..');

const STORE_FILES = [
  'store.ts',
  'store-shared.ts',
  'store-types.ts',
  'store-skill-actions.ts',
  'store-scheme-actions.ts',
  'store-generation-actions.ts',
  'store-session-actions.ts',
];

describe('workbench store feature isolation', () => {
  it('does not import account or history feature stores', () => {
    const banned = [
      'account/doubao-store',
      'account/store',
      'history/store',
    ];
    for (const file of STORE_FILES) {
      const source = readFileSync(join(workbenchDir, file), 'utf8');
      for (const needle of banned) {
        expect(source, `${file} must not import ${needle}`).not.toContain(needle);
      }
    }
  });

  it('does not keep server-mirror session lists on WorkbenchState', () => {
    const types = readFileSync(join(workbenchDir, 'store-types.ts'), 'utf8');
    expect(types).not.toMatch(/\bsessions\s*:/);
    expect(types).not.toMatch(/\barchivedSessions\s*:/);
  });
});
