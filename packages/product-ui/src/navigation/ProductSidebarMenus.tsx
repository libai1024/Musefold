import type { ReactNode } from 'react';
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '@musefold/ui';
import { Check, Loader2 } from '@musefold/ui/icons';

export interface ProductSidebarIdentityAccountOption {
  id: string;
  name: string;
  detail: string;
  active: boolean;
  avatar?: ReactNode;
  onSelect: () => void;
  testId?: string;
}

export interface ProductSidebarIdentityRelayOption {
  id: string;
  name: string;
  modelLabel: string;
  icon?: ReactNode;
  active: boolean;
  pending?: boolean;
  disabled?: boolean;
  preventClose?: boolean;
  onSelect: () => void;
  testId?: string;
}

export interface ProductSidebarMenuAction {
  label: string;
  detail?: ReactNode;
  icon?: ReactNode;
  onSelect: () => void;
  testId?: string;
  tone?: 'danger';
  disabled?: boolean;
  preventClose?: boolean;
}

export interface ProductSidebarIdentityMenuContentProps {
  title: string;
  detail: string;
  accounts: readonly ProductSidebarIdentityAccountOption[];
  relayProviders?: readonly ProductSidebarIdentityRelayOption[];
  relayEmptyAction?: ProductSidebarMenuAction;
  actions?: readonly ProductSidebarMenuAction[];
}

function selectAction(
  action: Pick<ProductSidebarMenuAction, 'onSelect' | 'preventClose'>,
  event: Event,
) {
  if (action.preventClose) event.preventDefault();
  action.onSelect();
}

export function ProductSidebarIdentityMenuContent({
  title,
  detail,
  accounts,
  relayProviders,
  relayEmptyAction,
  actions = [],
}: ProductSidebarIdentityMenuContentProps) {
  const hasRelaySection = relayProviders !== undefined || relayEmptyAction !== undefined;

  return (
    <>
      <div className="mf-sidebar-menu-header">
        <p className="text-[11.5px] font-medium text-primary">{title}</p>
        <p className="mt-0.5 text-meta text-tertiary">{detail}</p>
      </div>
      <div className="mf-sidebar-menu-scroll" aria-label="可用生图身份">
        <DropdownMenuLabel>生图账号</DropdownMenuLabel>
        <div role="group" aria-label="生图账号">
          {accounts.map((account) => (
            <DropdownMenuItem
              key={account.id}
              data-active={account.active || undefined}
              role="menuitemradio"
              aria-checked={account.active}
              onSelect={account.onSelect}
              className="mf-sidebar-access-item"
              data-testid={account.testId ?? `account-source-option-${account.id}`}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border-subtle bg-inset text-[11px] font-semibold text-secondary">
                {account.avatar}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11.5px] font-medium text-primary">
                  {account.name}
                </span>
                <span className="mt-0.5 block truncate text-meta text-tertiary">
                  {account.detail}
                </span>
              </span>
              {account.active ? <Check className="h-3.5 w-3.5 shrink-0 text-accent" /> : null}
            </DropdownMenuItem>
          ))}
        </div>
        {hasRelaySection ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>生图中转站</DropdownMenuLabel>
            {relayProviders && relayProviders.length > 0 ? (
              <div role="group" aria-label="生图中转站">
                {relayProviders.map((provider) => (
                  <DropdownMenuItem
                    key={provider.id}
                    data-active={provider.active || undefined}
                    role="menuitemradio"
                    aria-checked={provider.active}
                    disabled={provider.disabled || Boolean(provider.pending)}
                    onSelect={(event) => selectAction(provider, event)}
                    className="mf-sidebar-access-item"
                    data-testid={provider.testId ?? `relay-model-option-${provider.id}`}
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-inset text-secondary">
                      {provider.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11.5px] font-medium text-primary">
                        {provider.name}
                      </span>
                      <span className="mt-0.5 block truncate text-meta text-tertiary">
                        {provider.modelLabel}
                      </span>
                    </span>
                    {provider.pending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-tertiary" />
                    ) : provider.active ? (
                      <Check className="h-3.5 w-3.5 text-accent" />
                    ) : null}
                  </DropdownMenuItem>
                ))}
              </div>
            ) : relayEmptyAction ? (
              <DropdownMenuItem
                onSelect={(event) => selectAction(relayEmptyAction, event)}
                className="mf-sidebar-access-item"
                data-testid={relayEmptyAction.testId}
              >
                {relayEmptyAction.icon}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11.5px] font-medium text-primary">
                    {relayEmptyAction.label}
                  </span>
                  {relayEmptyAction.detail ? (
                    <span className="mt-0.5 block truncate text-meta text-tertiary">
                      {relayEmptyAction.detail}
                    </span>
                  ) : null}
                </span>
              </DropdownMenuItem>
            ) : null}
          </>
        ) : null}
      </div>
      {actions.length > 0 ? (
        <>
          <DropdownMenuSeparator />
          <div className="mf-sidebar-menu-actions">
            {actions.map((action) => (
              <DropdownMenuItem
                key={action.testId ?? action.label}
                onSelect={(event) => selectAction(action, event)}
                className="mf-sidebar-access-item"
                data-testid={action.testId}
                data-tone={action.tone}
                disabled={action.disabled}
              >
                {action.icon}
                <span className="min-w-0 flex-1 truncate">{action.label}</span>
              </DropdownMenuItem>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}

export interface ProductSidebarSettingsMenuContentProps {
  appName: string;
  items: readonly ProductSidebarMenuAction[];
}

export function ProductSidebarSettingsMenuContent({
  appName,
  items,
}: ProductSidebarSettingsMenuContentProps) {
  return (
    <>
      <div className="mf-sidebar-menu-header">
        <p className="text-[12px] font-semibold text-primary">{appName}</p>
      </div>
      <div className="mf-sidebar-menu-actions">
        {items.map((item) => (
          <DropdownMenuItem
            key={item.testId ?? item.label}
            onSelect={(event) => selectAction(item, event)}
            className="mf-sidebar-access-item"
            data-testid={item.testId}
            data-tone={item.tone}
            disabled={item.disabled}
          >
            {item.icon}
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
          </DropdownMenuItem>
        ))}
      </div>
    </>
  );
}
