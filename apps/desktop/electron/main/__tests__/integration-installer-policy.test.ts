import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const builder = readFileSync(new URL('../../../electron-builder.yml', import.meta.url), 'utf8');
const nsis = readFileSync(new URL('../../../../../build/installer.nsh', import.meta.url), 'utf8');

describe('packaged CLI installation policy', () => {
  it('keeps the Windows user-level CLI in the NSIS install and uninstall lifecycle', () => {
    expect(builder).toContain('include: ../../build/installer.nsh');
    expect(nsis).toContain('!macro customInstall');
    expect(nsis).toContain('$PROFILE\\.musefold\\bin\\musefold.cmd');
    expect(nsis).toContain('WriteRegExpandStr HKCU "Environment" "Path"');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: 断言 NSIS 脚本的字面量语法
    expect(nsis).toContain('${WM_SETTINGCHANGE}');
    expect(nsis).toContain('!macro customUnInstall');
    expect(nsis).toContain('Delete "$PROFILE\\.musefold\\bin\\musefold.cmd"');
    expect(nsis).not.toContain('WriteRegExpandStr HKLM');
  });
});

describe('packaged SQLite dependency', () => {
  it('ships the ESM import path and native prebuild in app.asar', () => {
    const config = parse(builder);
    expect(config.files).toContainEqual({
      from: '../../node_modules/better-sqlite3',
      to: 'node_modules/better-sqlite3',
      filter: ['package.json', 'lib/**/*', 'prebuilds/**/*'],
    });
    expect(config.asarUnpack).toContain('**/better-sqlite3/**');
    expect(config.files).toContain('!node_modules/better-sqlite3/build/**/*');
  });
});
