// 侧栏身份切换器(编排层):身份菜单在 SidebarIdentityMenu(下拉内容为 IdentityMenuBody),
// 应用菜单在 SidebarSettingsMenu,本文件只保双菜单互斥、设置深链与账号切换动画。
import { useState } from 'react';
import { useAppStore } from '../../stores/app';
import { useSettingsStore } from '../../features/settings/store';
import {
  AccountIdentityTransition,
  type AccountIdentityTransitionState,
} from '../../features/settings/components/AccessTransitions';
import { switchAccountSource } from '../../features/settings/account-source-switch';
import { SidebarIdentityMenu } from './SidebarIdentityMenu';
import { SidebarSettingsMenu } from './SidebarSettingsMenu';

export function SidebarAccessSwitcher() {
  const currentView = useAppStore((state) => state.currentView);
  const setView = useAppStore((state) => state.setView);
  const setSettingsSection = useSettingsStore((state) => state.setSection);
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [identityTransition, setIdentityTransition] =
    useState<AccountIdentityTransitionState | null>(null);

  const openSettingsAt = (section: 'account' | 'relay', relayTab?: 'providers' | 'ai') => {
    // 传 relayTab 时借 legacy 深链键一并定位中转站内部 tab(providers=生图,ai=Agent)
    setSettingsSection(relayTab ?? section);
    setView('settings');
    setMenuOpen(false);
    setSettingsOpen(false);
  };

  const handleMenuOpenChange = (open: boolean) => {
    if (open) setSettingsOpen(false);
    setMenuOpen(open);
  };

  const handleSettingsOpenChange = (open: boolean) => {
    if (open) setMenuOpen(false);
    setSettingsOpen(open);
  };

  return (
    <div className="flex items-center gap-1">
      <SidebarIdentityMenu
        open={menuOpen}
        onOpenChange={handleMenuOpenChange}
        openSettingsAt={openSettingsAt}
        identityTransitionActive={Boolean(identityTransition)}
        onAccountTransition={setIdentityTransition}
      />

      <SidebarSettingsMenu
        open={settingsOpen}
        onOpenChange={handleSettingsOpenChange}
        currentView={currentView}
        onOpenSettings={() => setView('settings')}
      />

      {identityTransition && (
        <AccountIdentityTransition
          key={`${identityTransition.from.source}-${identityTransition.to.source}`}
          state={identityTransition}
          onSwap={() => switchAccountSource(identityTransition.to.source)}
          onComplete={() => setIdentityTransition(null)}
        />
      )}
    </div>
  );
}
