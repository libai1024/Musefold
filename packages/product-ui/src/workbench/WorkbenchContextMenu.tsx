import { Fragment, useState } from 'react';
import type { ReactNode } from 'react';
import { FilePlus2, LoaderCircle, Plus } from '@musefold/ui/icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
} from '@musefold/ui';

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
  title = '添加图片或引用提示词',
  testId = 'workbench-image-picker',
}: WorkbenchContextMenuProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const handleOpenChange = (next: boolean) => {
    onOpenChange?.(next);
    if (controlledOpen === undefined) setUncontrolledOpen(next);
  };

  return (
    <DropdownMenu modal={false} open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <IconButton
          disabled={disabled}
          title={title}
          aria-label="添加上下文"
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
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={10}
        className="mf-workbench-context-menu"
        aria-label="添加上下文菜单"
        data-testid="workbench-context-menu"
      >
        {actions.map((action, index) => (
          <Fragment key={action.id}>
            {action.section && index > 0 ? <DropdownMenuSeparator /> : null}
            {action.section ? <DropdownMenuLabel>{action.section}</DropdownMenuLabel> : null}
            <DropdownMenuItem
              className="mf-workbench-context-item"
              data-primary={action.primary || undefined}
              data-testid={action.testId ?? `workbench-context-${action.id}`}
              onSelect={action.onSelect}
            >
              <span className="mf-workbench-context-icon">
                {action.icon ?? <FilePlus2 aria-hidden="true" />}
              </span>
              <span>{action.label}</span>
              {action.hint ? <small>{action.hint}</small> : null}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
