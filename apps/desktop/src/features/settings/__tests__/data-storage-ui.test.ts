import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dataSection = readFileSync(
  'apps/desktop/src/features/settings/components/DataSection.tsx',
  'utf8',
);
const dangerZone = readFileSync(
  'apps/desktop/src/features/settings/components/DangerZonePanel.tsx',
  'utf8',
);
const backupPanel = readFileSync(
  'apps/desktop/src/features/settings/components/BackupPanel.tsx',
  'utf8',
);
const importDialog = readFileSync(
  'apps/desktop/src/features/settings/components/ImportDialog.tsx',
  'utf8',
);
const exportDialog = readFileSync(
  'apps/desktop/src/features/settings/components/ExportDialog.tsx',
  'utf8',
);

describe('data storage page UI contract (settings review)', () => {
  it('isolates the danger zone into its own card after the local data card', () => {
    expect(dataSection).toContain('className="settings-danger-card"');
    // 独立卡在「本地数据」卡之后渲染,危险操作不再与日常行同卡
    expect(dataSection.indexOf('settings-danger-card')).toBeGreaterThan(
      dataSection.indexOf('title="本地数据"'),
    );
    // 卡内行不再自带 border-b 分隔(卡是唯一行容器)
    expect(dangerZone).toContain('<div data-testid="danger-zone">');
  });

  it('aligns the confirm phrase with the entry button verb', () => {
    expect(dangerZone).toContain("CONFIRM_PHRASE = '清空全部数据'");
    expect(dangerZone).not.toContain("CONFIRM_PHRASE = '清空数据'");
  });

  it('keeps paths readable and copyable', () => {
    expect(dataSection).toContain('title={r.path}');
    expect(dataSection).toContain('navigator.clipboard.writeText');
    expect(dataSection).toContain('data-testid={`copy-path-${r.id}`}');
  });

  it('surfaces getPaths failure with an in-row retry', () => {
    expect(dataSection).toContain('pathsError');
    expect(dataSection).toContain('路径读取失败');
    expect(dataSection).toContain('loadPaths');
  });

  it('progressively discloses the backup list behind a single summary row', () => {
    expect(backupPanel).toContain('data-testid="backup-toggle"');
    expect(backupPanel).toContain('aria-expanded={listOpen}');
    expect(backupPanel).toContain('data-testid="backup-summary"');
    expect(backupPanel).toContain('{listOpen && (');
    // 手动备份成功后自动展开,新快照即时可见
    expect(backupPanel).toContain('setListOpen(true)');
  });

  it('blocks closing import/export dialogs while busy (unified Esc protocol)', () => {
    for (const source of [importDialog, exportDialog]) {
      expect(source).toContain('hideClose={busy}');
      expect(source).toContain('if (busy) return;');
      expect(source).toMatch(/const changeOpen = \(next: boolean\) => \{/);
    }
  });
});
