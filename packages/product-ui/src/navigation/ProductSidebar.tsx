import { Button, IconButton, MusefoldMark } from "@musefold/ui";
import { PanelLeft, SquarePen } from "@musefold/ui/icons";
import type { CSSProperties, ReactNode } from "react";

export interface ProductSidebarNavItem {
  id: string;
  label: string;
  icon: ReactNode;
  active?: boolean;
  count?: number;
  onSelect: () => void;
  testId?: string;
}

export interface ProductSidebarAccount {
  name: string;
  detail?: string;
  avatar?: ReactNode;
  active?: boolean;
  onSelect: () => void;
  testId?: string;
}

export interface ProductSidebarProps {
  children?: ReactNode;
  navItems: readonly ProductSidebarNavItem[];
  onNewDesign: () => void;
  onCollapse: () => void;
  sessionList?: ReactNode;
  account?: ProductSidebarAccount;
  footer?: ReactNode;
  newShortcut?: string;
  headerStartInset?: number;
  ariaLabel?: string;
}

export function ProductNavButton({
  item,
  className = "",
}: {
  item: ProductSidebarNavItem;
  className?: string;
}) {
  return (
    <Button
      unstyled
      type="button"
      onClick={item.onSelect}
      aria-current={item.active ? "page" : undefined}
      data-active={item.active ? "true" : "false"}
      data-testid={item.testId ?? `nav-${item.id}`}
      className={`mf-product-sidebar-nav-button ${className}`}
    >
      <span className="mf-product-sidebar-nav-icon" aria-hidden="true">
        {item.icon}
      </span>
      <span>{item.label}</span>
      {item.count && item.count > 0 ? <small>{item.count}</small> : null}
    </Button>
  );
}

export function ProductSidebar({
  children,
  navItems,
  onNewDesign,
  onCollapse,
  sessionList,
  account,
  footer,
  newShortcut = "⌘N",
  headerStartInset = 12,
  ariaLabel = "Musefold 导航",
}: ProductSidebarProps) {
  return (
    <aside
      className="mf-product-sidebar drag-region"
      aria-label={ariaLabel}
      data-testid="product-sidebar"
    >
      <div
        className="mf-product-sidebar-header"
        style={
          {
            "--mf-sidebar-header-inset": `${headerStartInset}px`,
          } as CSSProperties
        }
      >
        <div className="mf-product-sidebar-brand" aria-label="Musefold / 未像">
          <MusefoldMark aria-hidden="true" focusable="false" />
          <span>Musefold</span>
        </div>
        <IconButton
          onClick={onCollapse}
          className="mf-product-sidebar-icon-button no-drag"
          label="收起侧栏"
          data-testid="sidebar-collapse"
        >
          <PanelLeft aria-hidden="true" />
        </IconButton>
      </div>

      <div className="mf-product-sidebar-new">
        <Button
          unstyled
          type="button"
          onClick={onNewDesign}
          className="mf-product-sidebar-new-button no-drag"
          data-testid="sidebar-new-design"
          title={`新设计（${newShortcut}）`}
        >
          <SquarePen aria-hidden="true" />
          <span>新设计</span>
          <kbd>{newShortcut}</kbd>
        </Button>
      </div>

      <p className="mf-product-sidebar-section-label">功能</p>
      <nav className="mf-product-sidebar-nav" aria-label="主导航">
        {navItems.map((item) => (
          <ProductNavButton key={item.id} item={item} className="no-drag" />
        ))}
      </nav>

      {children}
      {sessionList ? (
        <div className="mf-product-sidebar-sessions no-drag">{sessionList}</div>
      ) : null}

      {account ? (
        <Button
          unstyled
          type="button"
          onClick={account.onSelect}
          aria-current={account.active ? 'page' : undefined}
          className="mf-product-sidebar-account no-drag"
          data-testid={account.testId ?? "sidebar-account"}
        >
          <span className="mf-product-sidebar-avatar" aria-hidden="true">
            {account.avatar ?? account.name.slice(0, 1)}
          </span>
          <span>
            <strong>{account.name}</strong>
            {account.detail ? <small>{account.detail}</small> : null}
          </span>
        </Button>
      ) : null}
      {footer ? (
        <div className="mf-product-sidebar-footer no-drag">{footer}</div>
      ) : null}
    </aside>
  );
}
