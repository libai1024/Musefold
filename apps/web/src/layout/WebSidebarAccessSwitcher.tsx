import { useRef, useState } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@musefold/legacy-ui';
import {
  ProductSidebarIdentityMenuContent,
  ProductSidebarSettingsMenuContent,
} from '@musefold/product-ui';
import { ChevronDown, LogOut, Settings, Settings2, UserRound } from '@musefold/legacy-ui/icons';
import { cn } from '../lib/utils';

interface WebSidebarAccessSwitcherProps {
  accountName: string;
  quotaLabel: string;
  accountReady: boolean;
  settingsActive: boolean;
  onOpenSettings: () => void;
  onOpenAccountSettings: () => void;
  onLogout: () => void | Promise<void>;
}

/** Web keeps the Desktop footer shape while exposing only its Cloud identity. */
export function WebSidebarAccessSwitcher({
  accountName,
  quotaLabel,
  accountReady,
  settingsActive,
  onOpenSettings,
  onOpenAccountSettings,
  onLogout,
}: WebSidebarAccessSwitcherProps) {
  const [identityOpen, setIdentityOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const identityTriggerRef = useRef<HTMLButtonElement>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const initial = accountName.trim().charAt(0).toUpperCase() || (
    <UserRound className="h-3.5 w-3.5" />
  );

  const handleIdentityOpenChange = (open: boolean) => {
    if (open) setSettingsOpen(false);
    setIdentityOpen(open);
  };

  const handleSettingsOpenChange = (open: boolean) => {
    if (open) setIdentityOpen(false);
    setSettingsOpen(open);
  };

  return (
    <div className="web-sidebar-access-footer">
      <DropdownMenu modal={false} open={identityOpen} onOpenChange={handleIdentityOpenChange}>
        <DropdownMenuTrigger asChild>
          <button
            ref={identityTriggerRef}
            type="button"
            aria-label={`选择生图账号，当前${accountName}`}
            aria-haspopup="menu"
            aria-expanded={identityOpen}
            title={`${accountName} · ${quotaLabel}`}
            className={cn(
              'flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 text-secondary transition-colors hover:bg-hover hover:text-primary',
              identityOpen && 'bg-hover text-primary',
            )}
            data-testid="provider-quick-switch"
            data-identity-switcher
          >
            <span className="relative flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border-subtle bg-inset text-[11px] font-semibold text-secondary">
              {initial}
              <span
                className={cn(
                  'absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full ring-2 ring-sidebar',
                  accountReady ? 'bg-success' : 'bg-tertiary',
                )}
              />
            </span>
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate text-[12px] font-medium leading-[1.3] text-primary">
                {accountName}
              </span>
              <span
                className="block truncate text-meta leading-[1.3] text-tertiary"
                aria-live="polite"
              >
                {quotaLabel}
              </span>
            </span>
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 shrink-0 text-quaternary transition-transform',
                identityOpen && 'rotate-180',
              )}
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="start"
          sideOffset={6}
          aria-label="切换生图身份"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            identityTriggerRef.current?.focus();
          }}
          data-testid="identity-switcher"
          data-identity-switcher
          className="no-drag mf-sidebar-identity-menu w-[292px] p-0 text-[11px]"
        >
          <ProductSidebarIdentityMenuContent
            title={accountName}
            detail={quotaLabel}
            accounts={[
              {
                id: 'cloud',
                name: accountName,
                detail: quotaLabel,
                active: true,
                avatar: initial,
                onSelect: () => undefined,
                testId: 'account-source-option-cloud',
              },
            ]}
            actions={[
              {
                label: '账号设置',
                icon: <Settings2 className="h-4 w-4 shrink-0" aria-hidden="true" />,
                onSelect: onOpenAccountSettings,
                testId: 'identity-account-settings',
              },
              {
                label: '退出登录',
                icon: <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />,
                onSelect: () => void onLogout(),
                testId: 'identity-account-logout',
                tone: 'danger',
              },
            ]}
          />
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu modal={false} open={settingsOpen} onOpenChange={handleSettingsOpenChange}>
        <DropdownMenuTrigger asChild>
          <button
            ref={settingsTriggerRef}
            type="button"
            aria-label="打开应用菜单"
            aria-expanded={settingsOpen}
            title="设置"
            className={cn(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors',
              settingsActive
                ? 'bg-pressed text-accent'
                : 'text-secondary hover:bg-hover hover:text-primary',
            )}
            data-testid="sidebar-settings"
            data-sidebar-settings-menu
          >
            <Settings className="h-4 w-4 shrink-0" strokeWidth={settingsActive ? 2.25 : 1.75} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="end"
          sideOffset={6}
          aria-label="Musefold 应用菜单"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            settingsTriggerRef.current?.focus();
          }}
          data-testid="sidebar-settings-menu"
          data-sidebar-settings-menu
          className="no-drag mf-sidebar-settings-menu w-[220px] p-0 text-[11px]"
        >
          <ProductSidebarSettingsMenuContent
            appName="Musefold"
            items={[
              {
                label: '应用设置',
                icon: <Settings2 className="h-4 w-4 shrink-0" aria-hidden="true" />,
                onSelect: onOpenSettings,
                testId: 'sidebar-settings-open',
              },
            ]}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export type { WebSidebarAccessSwitcherProps };
