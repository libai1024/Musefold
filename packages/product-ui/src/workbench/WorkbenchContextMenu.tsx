import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { FilePlus2, LoaderCircle, Plus } from "@musefold/ui/icons";
import { Button, IconButton } from "@musefold/ui";

export interface WorkbenchContextAction {
  id: string;
  section?: string;
  primary?: boolean;
  testId?: string;
  label: string;
  hint?: string;
  icon?: ReactNode;
  onSelect: () => void;
}

export interface WorkbenchContextMenuProps {
  actions: readonly WorkbenchContextAction[];
  disabled?: boolean;
  busy?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: string;
  testId?: string;
}

/** Shared add/context control. Hosts provide only the actions supported by their capability set. */
export function WorkbenchContextMenu({
  actions,
  disabled = false,
  busy = false,
  open: controlledOpen,
  onOpenChange,
  title = "添加图片或引用提示词",
  testId = "workbench-image-picker",
}: WorkbenchContextMenuProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    onOpenChange?.(next);
    if (controlledOpen === undefined) setUncontrolledOpen(next);
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="mf-workbench-context-root" ref={rootRef}>
      <IconButton
        ref={triggerRef}
        disabled={disabled}
        title={title}
        aria-label="添加上下文"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="mf-workbench-context-trigger"
        data-testid={testId}
        label="添加上下文"
      >
        {busy ? (
          <LoaderCircle className="is-spinning" aria-hidden="true" />
        ) : (
          <Plus aria-hidden="true" />
        )}
      </IconButton>
      {open && (
        <div
          role="menu"
          aria-label="添加上下文菜单"
          className="mf-workbench-context-menu"
          data-testid="workbench-context-menu"
        >
          {actions.map((action, index) => (
            <div key={action.id}>
              {action.section && (
                <p className={index === 0 ? "" : "is-section"}>
                  {action.section}
                </p>
              )}
              <Button
                variant={action.primary ? "secondary" : "ghost"}
                role="menuitem"
                autoFocus={index === 0}
                onClick={() => {
                  setOpen(false);
                  action.onSelect();
                }}
                className={action.primary ? "is-primary" : undefined}
                data-testid={action.testId ?? `workbench-context-${action.id}`}
              >
                <span className="mf-workbench-context-icon">
                  {action.icon ?? <FilePlus2 aria-hidden="true" />}
                </span>
                <span>{action.label}</span>
                {action.hint ? <small>{action.hint}</small> : null}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
