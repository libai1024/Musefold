import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = dirname(fileURLToPath(import.meta.url));
const componentsDir = join(dir, '../components');

const ACCOUNT_UI_FILES = [
  'AccountSection.tsx',
  'AccountSignedInPanel.tsx',
  'AccountSignedOutForm.tsx',
  'AccountCloudSyncPanel.tsx',
  'account-section-helpers.ts',
  'account-section-ui.tsx',
];

describe('account section feature isolation', () => {
  it('imports the account store only through accountCrossFeature', () => {
    for (const file of ACCOUNT_UI_FILES) {
      const source = readFileSync(join(componentsDir, file), 'utf8');
      expect(source, `${file} must not import account/store directly`).not.toContain('account/store');
    }
  });
});
