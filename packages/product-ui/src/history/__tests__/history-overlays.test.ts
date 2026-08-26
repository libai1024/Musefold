import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const actionsSource = readFileSync(
  new URL('../GenerationHistoryDetailActions.tsx', import.meta.url),
  'utf8',
);
const detailSource = readFileSync(
  new URL('../GenerationHistoryDetailScreen.tsx', import.meta.url),
  'utf8',
);

describe('history overlay contracts', () => {
  it('uses the shared dropdown focus and dismissal model', () => {
    expect(actionsSource).toContain('<DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>');
    expect(actionsSource).toContain('<DropdownMenuContent');
    expect(actionsSource).toContain('<DropdownMenuItem');
    expect(actionsSource).toContain('<DropdownMenuSeparator />');
    expect(actionsSource).not.toContain('role="menu"');
    expect(actionsSource).not.toContain("document.addEventListener('pointerdown'");
    expect(actionsSource).not.toContain("window.addEventListener('keydown'");
  });

  it('keeps destructive actions separated and confirmation dialogs structured', () => {
    expect(actionsSource).toContain('className="mf-danger-action"');
    expect(actionsSource).toContain('<DialogBody>');
    expect(actionsSource).toContain('data-testid="history-detail-delete-dialog"');
    expect(detailSource).toContain('deleteConfirmation={{');
    expect(detailSource).not.toContain('<Dialog open={confirmDelete}');
  });

  it('dismisses stale overlays when the selected history record changes', () => {
    expect(actionsSource).toContain('contextKey?: string;');
    expect(actionsSource).toContain('}, [contextKey, deleted]);');
  });
});
