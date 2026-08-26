// src/components/layout/AppShell.tsx
// 全局骨架：TitleBar + Sidebar + 主区 + 命令面板 + Radix Provider
// 详见 docs/06-ui-design-system.md §6.1

import { useCallback, useEffect, type ReactNode } from 'react';
import { TitleBar } from './TitleBar';
import { Sidebar } from './Sidebar';
import { CommandPalette } from '../command/CommandPalette';
import { TooltipProvider } from '../ui/tooltip';
import { ToastProvider } from '../ui/toast';
import { ToastHost } from '../ui/toast-host';
import { EmberMark } from './EmberMark';
import { AutomationConfirmCard } from './AutomationConfirmCard';
import { bridgeExternalTaskActivity } from '../../stores/externalTasks';
import { useAppStore } from '../../stores/app';
import { ProductSidebarLayout } from '@musefold/product-ui';
import { usePlatform } from '../../lib/usePlatform';
import { WindowControls } from './WindowControls';

interface AppShellProps {
  children: ReactNode;
  /** 隐藏产品侧栏，由子视图自己的导航占满窗口。 */
  hideSidebar?: boolean;
  /** 设置等独立工作区不渲染产品标题栏与全局顶部入口。 */
  hideTitleBar?: boolean;
}

export function AppShell({ children, hideSidebar = false, hideTitleBar = false }: AppShellProps) {
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useAppStore((s) => s.setSidebarCollapsed);
  const currentView = useAppStore((s) => s.currentView);
  const { isWin, isLinux } = usePlatform();
  const handleSidebarOpenChange = useCallback(
    (open: boolean) => setSidebarCollapsed(!open),
    [setSidebarCollapsed],
  );
  // 全屏模式下侧栏强制关闭，并忽略布局内部的重开请求。
  const sidebarOpen = hideSidebar ? false : !collapsed;
  const sidebarOpenChange = useCallback(
    (open: boolean) => {
      if (hideSidebar) return;
      handleSidebarOpenChange(open);
    },
    [handleSidebarOpenChange, hideSidebar],
  );

  // 外部任务活动桥（朱点忙碌态，SET-02）——一次性订阅
  useEffect(() => {
    bridgeExternalTaskActivity();
  }, []);

  return (
    <ToastProvider swipeDirection="right" duration={3500}>
      <TooltipProvider delayDuration={300} skipDelayDuration={150}>
        <ProductSidebarLayout
          open={sidebarOpen}
          onOpenChange={sidebarOpenChange}
          compactDismissKey={currentView}
          sidebar={<Sidebar />}
          className={hideSidebar ? 'settings-product-shell' : undefined}
        >
          <div
            className="relative z-0 flex min-h-0 min-w-0 flex-1 flex-col"
            data-ui-register="operate"
            data-titlebar-hidden={hideTitleBar || undefined}
          >
            {hideTitleBar ? (
              <>
                <div className="settings-window-drag-region drag" aria-hidden="true" />
                {isWin || isLinux ? (
                  <div className="settings-window-controls no-drag">
                    <WindowControls />
                  </div>
                ) : null}
              </>
            ) : (
              <TitleBar />
            )}
            {/* 背景由 MainView surface(bg-work)提供,页面内容直接落在工作面上(v2.0 Phase B) */}
            <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
              {children}
              {/* 朱点：全应用单实例，坐在内容视口右上角的引首印位置（v0.3.3 §1.1） */}
              {hideTitleBar ? null : <EmberMark />}
            </main>
          </div>
          <CommandPalette />
          <ToastHost />
          {/* 外部 Agent 花钱动作确认卡（控制面策略闸门，v0.4） */}
          <AutomationConfirmCard />
        </ProductSidebarLayout>
      </TooltipProvider>
    </ToastProvider>
  );
}
