import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const turnActions = readFileSync(new URL('../WorkbenchTurnActions.tsx', import.meta.url), 'utf8');
const resultCard = readFileSync(
  new URL('../WorkbenchGenerationResultCard.tsx', import.meta.url),
  'utf8',
);
const contextMenu = readFileSync(new URL('../WorkbenchContextMenu.tsx', import.meta.url), 'utf8');
const generationSettings = readFileSync(
  new URL('../WorkbenchGenerationSettingsPopover.tsx', import.meta.url),
  'utf8',
);
const ratioPicker = readFileSync(new URL('../WorkbenchRatioPicker.tsx', import.meta.url), 'utf8');
const productStyles = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8');

describe('workbench action overlays', () => {
  it('uses the shared dropdown for turn actions without document-level menu listeners', () => {
    expect(turnActions).toContain(
      '<DropdownMenu modal={false} open={open} onOpenChange={setOpen}>',
    );
    expect(turnActions).toContain('<DropdownMenuContent');
    expect(turnActions).toContain('<DropdownMenuItem');
    expect(turnActions).toContain('<IconButton');
    expect(turnActions).toContain('label="更多回合操作"');
    expect(turnActions).toContain('side="top"');
    expect(turnActions).toContain('data-testid={`${testId}-menu`}');
    expect(turnActions).not.toContain('mf-workbench-turn-menu-wrap');
    expect(turnActions).not.toContain('document.addEventListener');
  });

  it('keeps result-card file actions in a shared dropdown', () => {
    expect(resultCard).toContain('<DropdownMenu>');
    expect(resultCard).toContain('<DropdownMenuTrigger asChild>');
    expect(resultCard).toContain('<DropdownMenuContent');
    expect(resultCard).toContain('<DropdownMenuItem');
    expect(resultCard).toContain('className="w-[176px]"');
    expect(resultCard).toContain('data-testid="result-more-menu"');
    expect(resultCard).toContain('data-testid="result-open-folder"');
    expect(resultCard).toContain('data-testid="result-history"');
    expect(resultCard).not.toContain('const [menuOpen');
    expect(resultCard).not.toContain('document.addEventListener');
  });

  it('uses shared dropdown semantics for the grouped composer context menu', () => {
    expect(contextMenu).toContain('<DropdownMenu modal={false}');
    expect(contextMenu).toContain('<DropdownMenuTrigger asChild>');
    expect(contextMenu).toContain('<DropdownMenuContent');
    expect(contextMenu).toContain('<DropdownMenuLabel>');
    expect(contextMenu).toContain('<DropdownMenuSeparator />');
    expect(contextMenu).toContain('side="top"');
    expect(contextMenu).toContain('data-testid="workbench-context-menu"');
    expect(contextMenu).not.toContain('document.addEventListener');
    expect(contextMenu).not.toContain('mf-workbench-context-separator');
    expect(productStyles).toContain('.mf-workbench-context-menu .mf-workbench-context-item');
    expect(productStyles).toContain('width: min(304px, calc(100vw - 16px));');
  });

  it('keeps the floating composer in a stable primary workbench column', () => {
    expect(productStyles).toContain('.mf-workbench-primary {');
    expect(productStyles).toContain('position: relative;');
    expect(productStyles).toContain('flex-direction: column;');
    expect(productStyles).toContain('flex: 1;');
    expect(productStyles).toContain(".mf-workbench-composer[data-layout='floating'] {");
    expect(productStyles).toContain('inset: auto 0 0;');
  });

  it('uses the shared popover for composer settings while retaining composer-safe placement', () => {
    for (const source of [generationSettings, ratioPicker]) {
      expect(source).toContain('<Popover open={open} onOpenChange={setOpen}>');
      expect(source).toContain('<PopoverTrigger asChild>');
      expect(source).toContain('<PopoverContent');
      expect(source).toContain('useWorkbenchPopoverPosition');
      expect(source).not.toContain('createPortal');
      expect(source).not.toContain('document.addEventListener');
    }
    expect(productStyles).toContain('.mf-workbench-ratio-menu,');
    expect(productStyles).toContain('padding: 8px;');
  });
});
