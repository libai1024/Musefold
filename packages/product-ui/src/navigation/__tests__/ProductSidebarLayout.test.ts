import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const layoutSource = readFileSync(new URL('../ProductSidebarLayout.tsx', import.meta.url), 'utf8');
const productStyles = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8');

describe('ProductSidebarLayout compact drawer contract', () => {
  it('uses the shared modal Drawer only for the compact sidebar', () => {
    expect(layoutSource).toContain(
      "import { Drawer, DrawerContent, DrawerTitle } from '@musefold/ui'",
    );
    expect(layoutSource).toContain('{compact ? (');
    expect(layoutSource).toContain('<Drawer open={open} onOpenChange={onOpenChange}>');
    expect(layoutSource).toContain('side="left"');
    expect(layoutSource).toContain('className="mf-product-sidebar-drawer"');
    expect(layoutSource).toContain('<DrawerTitle className="mf-sr-only">主导航</DrawerTitle>');
    expect(layoutSource).toContain('{!compact && open ? (');
    expect(layoutSource).toContain('data-testid="sidebar-resize-handle"');
  });

  it('locks the background and restores focus after every modal dismissal path', () => {
    expect(layoutSource).toContain('mainView.inert = compact && open');
    expect(layoutSource).toContain('onCloseAutoFocus={(event) => {');
    expect(layoutSource).toContain('\'[aria-label="展开侧栏"]\'');
    expect(layoutSource).toContain('returnFocusTarget?.isConnected ? returnFocusTarget : fallback');
    expect(layoutSource).toContain('\'[data-testid="sidebar-new-design"]\'');
    expect(layoutSource).toContain("'.mf-product-sidebar-nav-button'");
    expect(layoutSource).toContain("'.mf-workbench-session-open'");
    expect(layoutSource).toContain('\'[data-testid="sidebar-account"]\'');
  });

  it('keeps compact styling scoped to the drawer surface', () => {
    expect(productStyles).toMatch(/\.mf-ui-drawer-content\.mf-product-sidebar-drawer\s*\{/);
    expect(productStyles).toMatch(
      /\.mf-ui-drawer-content\.mf-product-sidebar-drawer[\s\S]*?max-width: none;/,
    );
    expect(productStyles).toMatch(
      /\.mf-ui-drawer-content\.mf-product-sidebar-drawer[\s\S]*?background: var\(--bg-window\);/,
    );
    expect(productStyles).toMatch(
      /\.mf-ui-drawer-content\.mf-product-sidebar-drawer\[data-open='true'\]/,
    );
    expect(productStyles).not.toContain('.mf-product-sidebar-scrim');
  });
});
