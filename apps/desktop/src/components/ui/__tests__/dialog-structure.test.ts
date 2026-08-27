import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const standardDialogs = [
  'apps/desktop/src/components/ui/global-error-dialog.tsx',
  'apps/desktop/src/features/generation/components/ProviderDialog.tsx',
  'apps/desktop/src/features/settings/components/DangerZonePanel.tsx',
  'apps/desktop/src/features/settings/components/ImportDialog.tsx',
  'apps/desktop/src/features/settings/components/ExportDialog.tsx',
  'apps/desktop/src/features/settings/components/DoubaoSection.tsx',
  // 许可 Dialog 随支持卡拆分到 AboutSupportCard(设置评审 P1-3)
  'apps/desktop/src/features/settings/components/AboutSupportCard.tsx',
  'apps/desktop/src/features/settings/components/BackupPanel.tsx',
  'apps/desktop/src/features/library/components/TrashDialog.tsx',
  'apps/desktop/src/features/share/ImportConfirmDialog.tsx',
  'apps/desktop/src/features/share/SharePromptDialog.tsx',
] as const;

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('desktop Dialog structure', () => {
  it('keeps standard business dialogs on the shared Body slot', () => {
    for (const path of standardDialogs) {
      const source = read(path);
      expect(source, path).toContain('<DialogBody');
      expect(source, path).toContain('</DialogBody>');
    }
  });

  it('keeps deliberate custom dialog boundaries explicit', () => {
    const promptEditor = read('apps/desktop/src/features/library/components/PromptEditor.tsx');
    const connectedApps = read('packages/product-ui/src/account/ConnectedAppsScreen.tsx');

    expect(promptEditor).toContain('<PromptEditorForm');
    expect(promptEditor).not.toContain('<DialogBody');
    expect(connectedApps).toContain('mf-connected-app-reauth-form');
    expect(connectedApps).not.toContain('<DialogBody');
  });
});
