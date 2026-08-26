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
  it('reuses the shared account surface while keeping desktop-only details in the host', () => {
    const panel = readFileSync(join(componentsDir, 'AccountSignedInPanel.tsx'), 'utf8');
    const section = readFileSync(join(componentsDir, 'AccountSection.tsx'), 'utf8');

    expect(panel).toContain('AccountScreen');
    expect(panel).toContain('onRedeem={async (code)');
    expect(panel).toContain('onRefresh={async ()');
    expect(panel).toContain('status.deviceTokenSuffix');
    expect(panel).toContain('<AccountCloudSyncPanel');
    expect(panel).not.toContain('<AccountSummaryPanel');
    expect(panel).not.toContain('<Input');
    expect(panel).not.toContain('error.message');
    expect(section).toContain('redeem={redeem}');
    expect(section).not.toContain('setRedeemCode');
  });

  it('imports the account store only through runtime/account-access', () => {
    for (const file of ACCOUNT_UI_FILES) {
      const source = readFileSync(join(componentsDir, file), 'utf8');
      expect(source, `${file} must not import account/store directly`).not.toContain('account/store');
    }
  });
});
