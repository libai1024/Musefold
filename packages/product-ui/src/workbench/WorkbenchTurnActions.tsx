import { useState, type ReactNode } from 'react';
import { History, MoreHorizontal, RefreshCw } from '@musefold/ui/icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@musefold/ui';

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
  testId = 'generation-turn-actions',
  moreTestId = 'generation-turn-more',
}: WorkbenchTurnActionsProps) {
  const [open, setOpen] = useState(false);

  const close = () => setOpen(false);

  const hasMenu = menuItems.length > 0 || Boolean(menuExtra);
  if (!primary && !hasMenu) return null;

  return (
    <div className="mf-workbench-turn-actions" data-testid={testId}>
      {primary}
      {hasMenu ? (
        <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
          <DropdownMenuTrigger asChild>
            <button type="button" className="mf-workbench-turn-more" data-testid={moreTestId}>
              <MoreHorizontal aria-hidden="true" />
              更多
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="start"
            sideOffset={5}
            className="w-[176px]"
            aria-label="回合操作"
            data-testid={`${testId}-menu`}
          >
            {menuItems.map((item) =>
              item.render ? (
                <DropdownMenuItem key={item.id} asChild>
                  {item.render(close)}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  key={item.id}
                  disabled={item.disabled}
                  data-testid={item.testId}
                  onSelect={() => {
                    close();
                    item.onSelect?.();
                  }}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </DropdownMenuItem>
              ),
            )}
            {menuExtra?.(close)}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

export function WorkbenchTurnActionIcon({ name }: { name: 'history' | 'reuse' }) {
  return name === 'history' ? <History aria-hidden="true" /> : <RefreshCw aria-hidden="true" />;
}
