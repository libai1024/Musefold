import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const builder = readFileSync(new URL('../../../electron-builder.yml', import.meta.url), 'utf8');
const nsis = readFileSync(new URL('../../../build/installer.nsh', import.meta.url), 'utf8');

describe('packaged CLI installation policy', () => {
  it('keeps the Windows user-level CLI in the NSIS install and uninstall lifecycle', () => {
    expect(builder).toContain('include: build/installer.nsh');
    expect(nsis).toContain('!macro customInstall');
    expect(nsis).toContain('$PROFILE\\.musefold\\bin\\musefold.cmd');
    expect(nsis).toContain('WriteRegExpandStr HKCU "Environment" "Path"');
    expect(nsis).toContain('${WM_SETTINGCHANGE}');
    expect(nsis).toContain('!macro customUnInstall');
    expect(nsis).toContain('Delete "$PROFILE\\.musefold\\bin\\musefold.cmd"');
    expect(nsis).not.toContain('WriteRegExpandStr HKLM');
  });
});
