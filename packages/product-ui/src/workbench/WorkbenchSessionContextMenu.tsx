import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  Archive,
  MessageSquareText,
  Pin,
  PinOff,
  Pencil,
  Trash2,
} from "@musefold/ui/icons";
import { Button } from "@musefold/ui";

export interface WorkbenchSessionContextMenuProps {
  anchor: { x: number; y: number };
  title: string;
  pinned: boolean;
  onClose: () => void;
  onTogglePinned: () => void;
  onRename: () => void;
  onArchive: () => void;
  onMarkUnread: () => void;
  onDelete: () => void;
}

/** Shared recent-conversation menu. Hosts only provide persistence actions. */
export function WorkbenchSessionContextMenu({
  anchor,
  title,
  pinned,
  onClose,
  onTogglePinned,
  onRename,
  onArchive,
  onMarkUnread,
  onDelete,
}: WorkbenchSessionContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(anchor);

  useLayoutEffect(() => {
    const updatePosition = () => {
      const menu = menuRef.current;
      if (!menu) return;
      const rect = menu.getBoundingClientRect();
      setPosition({
        x: Math.max(8, Math.min(anchor.x, window.innerWidth - rect.width - 8)),
        y: Math.max(8, Math.min(anchor.y, window.innerHeight - rect.height - 8)),
      });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [anchor.x, anchor.y]);

  useEffect(() => {
    menuRef.current?.focus();
  }, []);

  useEffect(() => {
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target as Element;
      if (
        !target.closest("[data-workbench-session-context-menu]") &&
        !target.closest("[data-workbench-session-menu-trigger]")
      ) {
        onClose();
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]',
      ) ?? [],
    );
    if (items.length === 0) return;
    const currentIndex = items.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    if (event.key === "ArrowDown") {
      event.preventDefault();
      items[currentIndex >= 0 ? (currentIndex + 1) % items.length : 0]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      items[
        currentIndex >= 0
          ? (currentIndex - 1 + items.length) % items.length
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

  const action = (
    label: string,
    icon: ReactNode,
    onSelect: () => void,
    testId: string,
    className = "",
  ) => (
    <Button
      unstyled
      type="button"
      role="menuitem"
      className={`mf-workbench-session-context-action ${className}`.trim()}
      onClick={() => {
        onSelect();
        onClose();
      }}
      data-testid={testId}
    >
      {icon}
      <span>{label}</span>
    </Button>
  );

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      tabIndex={-1}
      data-workbench-session-context-menu
      aria-label={`对话操作：${title}`}
      onKeyDown={handleMenuKeyDown}
      className="mf-workbench-session-context-menu"
      style={{ left: position.x, top: position.y }}
    >
      {action(
        pinned ? "取消置顶聊天" : "置顶聊天",
        pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />,
        onTogglePinned,
        "conversation-context-pin",
      )}
      {action(
        "重命名聊天",
        <Pencil aria-hidden="true" />,
        onRename,
        "conversation-context-rename",
      )}
      {action(
        "归档聊天",
        <Archive aria-hidden="true" />,
        onArchive,
        "conversation-context-archive",
      )}
      {action(
        "标记为未读",
        <MessageSquareText aria-hidden="true" />,
        onMarkUnread,
        "conversation-context-unread",
      )}
      <div className="mf-workbench-session-context-separator" />
      {action(
        "删除聊天",
        <Trash2 aria-hidden="true" />,
        onDelete,
        "conversation-context-delete",
        "mf-workbench-session-context-danger",
      )}
    </div>,
    document.body,
  );
}
