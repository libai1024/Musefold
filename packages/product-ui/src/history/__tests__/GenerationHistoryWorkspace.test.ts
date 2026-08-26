import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workspaceSource = readFileSync(
  new URL('../GenerationHistoryWorkspace.tsx', import.meta.url),
  'utf8',
);
const productStyles = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8');

describe('GenerationHistoryWorkspace responsive detail contract', () => {
  it('keeps the wide inspector and uses the shared Radix Drawer only for phones', () => {
    expect(workspaceSource).toContain('PRODUCT_MOBILE_BREAKPOINT');
    expect(workspaceSource).toContain('<Drawer open={detailOpen}');
    expect(workspaceSource).toContain('side="bottom"');
    expect(workspaceSource).toContain('data-testid="history-sheet"');
    expect(workspaceSource).toContain('<DrawerTitle className="mf-sr-only">');
    expect(workspaceSource).toContain('<aside');
    expect(workspaceSource).toContain('data-testid="history-inspector"');
    expect(workspaceSource.match(/const detailSurface = detailOpen/g)).toHaveLength(1);
    expect(workspaceSource.match(/\{detail\}/g)).toHaveLength(1);
  });

  it('locks the phone background and restores focus after every dismissal path', () => {
    expect(workspaceSource).toContain('list.inert = phone && detailOpen');
    expect(workspaceSource).toContain('onCloseAutoFocus={(event) => {');
    expect(workspaceSource).toContain('target?.isConnected && target.focus()');
    expect(workspaceSource).toContain('onOpenChange={(open) => !open && onBack?.()}');
  });

  it('keeps the sheet below the top bar with its own scroll and safe action inset', () => {
    expect(productStyles).toMatch(/@media \(max-width: 680px\)/);
    expect(productStyles).toMatch(
      /\.mf-ui-drawer-content\.mf-history-sheet\[data-side='bottom'\][\s\S]*?max-height: calc\(100dvh - 52px - env\(safe-area-inset-top, 0px\)\);/,
    );
    expect(productStyles).toMatch(
      /\.mf-ui-drawer-content\.mf-history-sheet\[data-side='bottom'\][\s\S]*?padding: 0 0 env\(safe-area-inset-bottom, 0px\);/,
    );
    expect(productStyles).toMatch(
      /\.mf-history-sheet \.mf-history-inspector-scroll[\s\S]*?overscroll-behavior: contain;/,
    );
    expect(productStyles).toMatch(
      /\.mf-history-sheet \.mf-history-inspector-action-bar[\s\S]*?flex: none;/,
    );
  });
});
