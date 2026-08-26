import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const commandDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const desktopSrc = join(commandDir, '../..');

describe('command palette 2.0 contract', () => {
  it('uses a distinct command layer with stable desktop geometry', () => {
    const source = readFileSync(join(commandDir, 'CommandPalette.tsx'), 'utf8');
    const styles = readFileSync(join(desktopSrc, 'styles/overlays-v2.css'), 'utf8');

    expect(source).toContain('mf-command-overlay');
    expect(source).toContain('mf-command-panel');
    expect(source).toContain('aria-label="搜索 Musefold"');
    expect(source).toContain('role="combobox"');
    expect(source).toContain('role="listbox"');
    expect(source).toContain('role="option"');
    expect(source).toContain('aria-activedescendant');
    expect(source).toContain("scrollIntoView({ block: 'nearest' })");
    expect(source).toContain('data-testid="command-palette"');
    expect(styles).toContain('width: min(560px, calc(100vw - 32px))');
    expect(styles).toContain('border-radius: var(--radius-dialog)');
    expect(styles).toContain('height: 40px');
    expect(styles).toContain('min-height: 40px');
    expect(styles).toContain('background: var(--scrim-command)');
    expect(source).not.toContain('mf-command-footer');
  });
});
