import { useRef, useState } from "react";
import { MoreHorizontal } from "@musefold/ui/icons";
import { IconButton } from "@musefold/ui";
import { WorkbenchSessionContextMenu } from "./WorkbenchSessionContextMenu";

export interface WorkbenchSessionMenuTriggerProps {
  title: string;
  pinned: boolean;
  onTogglePinned: () => void;
  onRename: () => void;
  onArchive: () => void;
  onMarkUnread: () => void;
  onDelete: () => void;
  className?: string;
  testId?: string;
}

/** Shared current-conversation menu trigger for Desktop and Web topbars. */
export function WorkbenchSessionMenuTrigger({
  title,
  pinned,
  onTogglePinned,
  onRename,
  onArchive,
  onMarkUnread,
  onDelete,
  className,
  testId = "workbench-session-menu-trigger",
}: WorkbenchSessionMenuTriggerProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);

  const openMenu = () => {
    if (anchor) {
      setAnchor(null);
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setAnchor({ x: rect.left, y: rect.bottom + 6 });
  };

  return (
    <>
      <IconButton
        ref={buttonRef}
        className={className}
        label="管理当前对话"
        title="管理当前对话"
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        data-workbench-session-menu-trigger
        data-testid={testId}
        onClick={openMenu}
      >
        <MoreHorizontal aria-hidden="true" />
      </IconButton>
      {anchor ? (
        <WorkbenchSessionContextMenu
          anchor={anchor}
          title={title}
          pinned={pinned}
          onClose={() => setAnchor(null)}
          onTogglePinned={onTogglePinned}
          onRename={onRename}
          onArchive={onArchive}
          onMarkUnread={onMarkUnread}
          onDelete={onDelete}
        />
      ) : null}
    </>
  );
}
