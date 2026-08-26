import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const detailSource = readFileSync(new URL('../PromptDetailScreen.tsx', import.meta.url), 'utf8');
const headerSource = readFileSync(
  new URL('../PromptLibraryHeaderActions.tsx', import.meta.url),
  'utf8',
);

describe('prompt overlay contracts', () => {
  it('uses the shared dropdown focus and dismissal model', () => {
    for (const source of [detailSource, headerSource]) {
      expect(source).toContain('<DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>');
      expect(source).toContain('<DropdownMenuContent');
      expect(source).toContain('<DropdownMenuItem');
      expect(source).not.toContain("document.addEventListener('pointerdown'");
      expect(source).not.toContain("window.addEventListener('keydown'");
    }
  });

  it('keeps destructive actions separated and dialog content structured', () => {
    expect(detailSource).toContain('<DropdownMenuSeparator />');
    expect(detailSource).toContain('tone="danger"');
    expect(detailSource).toContain('<DialogBody>');
  });
});
