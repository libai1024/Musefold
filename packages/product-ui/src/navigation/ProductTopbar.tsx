import {
  Blocks,
  CircleUserRound,
  History,
  LibraryBig,
  Link2,
  MessageSquareText,
  Settings,
} from "@musefold/ui/icons";
import type { ReactNode } from "react";

export type ProductViewKey =
  | "generate"
  | "library"
  | "design-schemes"
  | "history"
  | "settings"
  | "connections"
  | "account";

/** Keep the compact desktop/web title treatment identical for long sessions. */
export function productTopbarDisplayTitle(
  title: string,
  maxCharacters = 10,
): string {
  return Array.from(title).slice(0, maxCharacters).join("");
}

export function ProductViewIcon({ view }: { view: ProductViewKey }) {
  switch (view) {
    case "library":
      return <LibraryBig aria-hidden="true" />;
    case "design-schemes":
      return <Blocks aria-hidden="true" />;
    case "history":
      return <History aria-hidden="true" />;
    case "settings":
      return <Settings aria-hidden="true" />;
    case "connections":
      return <Link2 aria-hidden="true" />;
    case "account":
      return <CircleUserRound aria-hidden="true" />;
    case "generate":
    default:
      return <MessageSquareText aria-hidden="true" />;
  }
}

export interface ProductTopbarProps {
  title: string;
  displayTitle?: string;
  icon: ReactNode;
  statusLabel?: string;
  leading?: ReactNode;
  titleSuffix?: ReactNode;
  actions?: ReactNode;
  titleTestId?: string;
  testId?: string;
  className?: string;
}

export function ProductTopbar({
  title,
  displayTitle = title,
  icon,
  statusLabel,
  leading,
  titleSuffix,
  actions,
  titleTestId = "titlebar-title",
  testId = "titlebar",
  className = "",
}: ProductTopbarProps) {
  return (
    <header className={`mf-product-topbar ${className}`} data-testid={testId}>
      <div className="mf-product-topbar-title-group">
        {leading}
        <span className="mf-product-topbar-icon" aria-hidden="true">
          {icon}
        </span>
        <h1 data-testid={titleTestId} title={title}>
          {displayTitle}
        </h1>
        {titleSuffix}
        {statusLabel ? (
          <span className="mf-product-status-chip">{statusLabel}</span>
        ) : null}
      </div>
      {actions ? (
        <div className="mf-product-topbar-actions topbar-actions">
          {actions}
        </div>
      ) : null}
    </header>
  );
}
