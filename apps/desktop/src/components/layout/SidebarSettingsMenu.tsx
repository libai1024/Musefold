// 侧栏应用菜单(自 SidebarAccessSwitcher 拆出):桌宠开关与应用设置入口。
// testid 契约见 model-hub-ui.test.ts 与 tests/e2e。
import { useRef, useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@musefold/ui';
import { APP_NAME } from '@musefold/domain/constants';
import { Loader2, Power, Settings, Settings2 } from '../ui/icons';
import { cn } from '../../lib/utils';
import { desktopHost as api } from '@renderer/runtime/desktop-host-services';
import { toast } from '../../stores/toast';
import type { ViewKey } from '../../stores/app';

interface SidebarSettingsMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentView: ViewKey;
  onOpenSettings: () => void;
}

export function SidebarSettingsMenu({
  open,
  onOpenChange,
  currentView,
  onOpenSettings,
}: SidebarSettingsMenuProps) {
  const [petEnabled, setPetEnabled] = useState<boolean | null>(null);
  const [petPending, setPetPending] = useState(false);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);

  const changeOpen = (next: boolean) => {
    if (next) {
      void api.pet
        .isEnabled()
        .then((result) => setPetEnabled(result.enabled))
        .catch(() => setPetEnabled(false));
    }
    onOpenChange(next);
  };

  const togglePet = async () => {
    if (petPending) return;
    setPetPending(true);
    try {
      const result = await api.pet.setEnabled(!petEnabled);
      setPetEnabled(result.enabled);
    } catch (error) {
      toast.error('桌宠状态切换失败', error instanceof Error ? error.message : '请稍后重试。');
    } finally {
      setPetPending(false);
    }
  };

  return (
    <DropdownMenu modal={false} open={open} onOpenChange={changeOpen}>
      <DropdownMenuTrigger asChild>
        <button
          ref={settingsTriggerRef}
          type="button"
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors',
            currentView === 'settings'
              ? 'bg-pressed text-accent'
              : 'text-secondary hover:bg-hover hover:text-primary',
          )}
          aria-label="打开应用菜单"
          title="设置"
          data-testid="sidebar-settings"
          data-sidebar-settings-menu
        >
          <Settings
            className="h-4 w-4 shrink-0"
            strokeWidth={currentView === 'settings' ? 2.25 : 1.75}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="end"
        sideOffset={6}
        aria-label={`${APP_NAME} 应用菜单`}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          settingsTriggerRef.current?.focus();
        }}
        data-sidebar-settings-menu
        data-testid="sidebar-settings-menu"
        className="no-drag mf-sidebar-settings-menu w-[220px] p-0 text-[11px]"
      >
        <div className="border-b border-border-subtle px-3 py-2.5">
          <p className="text-[12px] font-semibold text-primary">{APP_NAME}</p>
        </div>
        <div className="p-1.5">
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              void togglePet();
            }}
            disabled={petPending || petEnabled === null}
            className="mf-sidebar-access-item"
            data-testid="sidebar-settings-pet-toggle"
          >
            {petPending ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            ) : (
              <Power className="h-4 w-4 shrink-0" />
            )}
            <span>{petEnabled ? '隐藏桌宠' : '显示桌宠'}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={onOpenSettings}
            className="mf-sidebar-access-item"
            data-testid="sidebar-settings-open"
          >
            <Settings2 className="h-4 w-4 shrink-0" />
            <span>应用设置</span>
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
