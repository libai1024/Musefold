import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SchemeSearchField } from '../SchemeListPrimitives';

const featureDir = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('SchemeSearchField', () => {
  it('keeps market submission inside the compact search control', () => {
    const html = renderToStaticMarkup(
      <SchemeSearchField value="poster" onChange={() => undefined} onSubmit={() => undefined} />,
    );

    expect(html).toContain('class="mf-scheme-search"');
    expect(html).toContain('data-testid="market-search-run"');
    expect(html).toContain('aria-label="搜索市场"');
    expect(html).not.toContain('>搜索市场<');
  });

  it('does not render a submit action for local filtering', () => {
    const html = renderToStaticMarkup(<SchemeSearchField value="" onChange={() => undefined} />);

    expect(html).toContain('data-testid="scheme-search"');
    expect(html).not.toContain('data-testid="market-search-run"');
  });

  it('uses the shared dropdown contract for scheme actions and optional variables', () => {
    const actionMenu = readFileSync(join(featureDir, 'SchemeActionMenu.tsx'), 'utf8');
    const runComposer = readFileSync(join(featureDir, 'SchemeRunComposer.tsx'), 'utf8');
    const variableFields = runComposer.slice(
      runComposer.indexOf('export function SchemeRunVariableFields'),
    );

    expect(actionMenu).toContain('DropdownMenuContent');
    expect(actionMenu).toContain('DropdownMenuSeparator');
    expect(actionMenu).not.toContain('addEventListener');
    expect(variableFields).toContain('DropdownMenuContent');
    expect(variableFields).toContain('data-testid="scheme-run-add-variable-menu"');
    expect(variableFields).not.toContain('setAddMenuOpen');
    expect(variableFields).not.toContain('addEventListener');
  });

  it('uses the shared popover contract for scheme attachment details', () => {
    const runComposer = readFileSync(join(featureDir, 'SchemeRunComposer.tsx'), 'utf8');

    expect(runComposer).toContain('<Popover open={popoverOpen} onOpenChange={setPopoverOpen}>');
    expect(runComposer).toContain('<PopoverTrigger asChild>');
    expect(runComposer).toContain('<PopoverContent');
    expect(runComposer).toContain('portal={false}');
    expect(runComposer).toContain('data-testid="scheme-attachment-popover"');
    expect(runComposer).not.toContain('document.addEventListener');
    expect(runComposer).not.toContain('window.addEventListener');
  });
});
