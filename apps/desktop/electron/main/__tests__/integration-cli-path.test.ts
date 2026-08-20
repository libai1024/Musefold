import { describe, expect, it } from 'vitest';
import {
  CLI_PATH_BLOCK_END,
  CLI_PATH_BLOCK_START,
  managedCliPathBlock,
  removeManagedCliPathBlock,
  resolvePosixShellProfile,
  upsertManagedCliPathBlock,
} from '../integration-cli-path';

describe('CLI user PATH management', () => {
  it('selects the profile used by zsh, bash, and fish without architecture assumptions', () => {
    expect(resolvePosixShellProfile('/Users/test', '/bin/zsh', () => false)).toEqual({
      kind: 'zsh',
      path: '/Users/test/.zprofile',
    });
    expect(resolvePosixShellProfile('/Users/test', '/bin/bash', (path) => path.endsWith('.bash_login'))).toEqual({
      kind: 'bash',
      path: '/Users/test/.bash_login',
    });
    expect(resolvePosixShellProfile('/Users/test', '/opt/homebrew/bin/fish', () => false)).toEqual({
      kind: 'fish',
      path: '/Users/test/.config/fish/conf.d/musefold.fish',
    });
    expect(resolvePosixShellProfile('/Users/test', '/bin/tcsh', () => false)).toBeNull();
  });

  it('adds and updates one reversible managed block', () => {
    const original = 'export EDITOR=vim\n';
    const zshBlock = managedCliPathBlock('zsh');
    const installed = upsertManagedCliPathBlock(original, zshBlock);
    expect(installed).toContain(CLI_PATH_BLOCK_START);
    expect(installed).toContain('export PATH="$HOME/.local/bin:$PATH"');
    expect(upsertManagedCliPathBlock(installed, zshBlock)).toBe(installed);

    const fishBlock = managedCliPathBlock('fish');
    const updated = upsertManagedCliPathBlock(installed, fishBlock);
    expect(updated.match(new RegExp(CLI_PATH_BLOCK_START, 'g'))).toHaveLength(1);
    expect(updated).toContain('set -gx PATH');
    expect(updated).toContain(CLI_PATH_BLOCK_END);
    expect(removeManagedCliPathBlock(updated)).toBe(original);
  });

  it('leaves malformed or user-owned profile content untouched on removal', () => {
    const content = `export PATH=/custom/bin:$PATH\n${CLI_PATH_BLOCK_START}\n`;
    expect(removeManagedCliPathBlock(content)).toBe(content);
  });
});
