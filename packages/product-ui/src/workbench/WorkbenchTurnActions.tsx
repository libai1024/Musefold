import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { History, MoreHorizontal, RefreshCw } from "@musefold/ui/icons";
import { Button } from "@musefold/ui";

export interface WorkbenchTurnMenuItem {
  id: string;
  label?: string;
  icon?: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  testId?: string;
  render?: (close: () => void) => ReactNode;
}

export interface WorkbenchTurnActionsProps {
  primary?: ReactNode;
  menuItems?: readonly WorkbenchTurnMenuItem[];
  menuExtra?: (close: () => void) => ReactNode;
  testId?: string;
  moreTestId?: string;
}

/** Shared result-group actions; hosts provide only platform capability slots. */
export function WorkbenchTurnActions({
  primary,
  menuItems = [],
  menuExtra,
  testId = "generation-turn-actions",
  moreTestId = "generation-turn-more",
}: WorkbenchTurnActionsProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const first = rootRef.current?.querySelector<HTMLButtonElement>(
      '[role="menuitem"]:not(:disabled)',
    );
    first?.focus();
  }, [open]);

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      rootRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)',
      ) ?? [],
    );
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      items[current >= 0 ? (current + 1) % items.length : 0]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      items[
        current >= 0
          ? (current - 1 + items.length) % items.length
          : items.length - 1
      ]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      items.at(-1)?.focus();
    }
  };

  const hasMenu = menuItems.length > 0 || Boolean(menuExtra);
  if (!primary && !hasMenu) return null;

  return (
    <div
      ref={rootRef}
      className="mf-workbench-turn-actions"
      data-testid={testId}
    >
      {primary}
      {hasMenu ? (
        <div className="mf-workbench-turn-menu-wrap">
          <button
            ref={triggerRef}
            type="button"
            className="mf-workbench-turn-more"
            aria-haspopup="menu"
            aria-expanded={open}
            data-testid={moreTestId}
            onClick={() => setOpen((value) => !value)}
          >
            <MoreHorizontal aria-hidden="true" />
            更多
          </button>
          {open ? (
            <div
              role="menu"
              className="mf-workbench-turn-menu"
              onKeyDown={handleMenuKeyDown}
            >
              {menuItems.map((item) =>
                item.render ? (
                  <Fragment key={item.id}>{item.render(close)}</Fragment>
                ) : (
                  <Button
                    key={item.id}
                    unstyled
                    type="button"
                    role="menuitem"
                    disabled={item.disabled}
                    className="mf-workbench-turn-menu-item"
                    data-testid={item.testId}
                    onClick={() => {
                      close();
                      item.onSelect?.();
                    }}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </Button>
                ),
              )}
              {menuExtra?.(close)}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function WorkbenchTurnActionIcon({
  name,
}: {
  name: "history" | "reuse";
}) {
  return name === "history" ? (
    <History aria-hidden="true" />
  ) : (
    <RefreshCw aria-hidden="true" />
  );
}
