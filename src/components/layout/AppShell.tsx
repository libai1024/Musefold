// src/components/layout/AppShell.tsx
// 全局骨架：TitleBar + Sidebar + 主区 + 命令面板 + Radix Provider
// 详见 docs/06-ui-design-system.md §6.1

import { useCallback, useEffect, type ReactNode } from "react";
import { TitleBar } from "./TitleBar";
import { Sidebar } from "./Sidebar";
import { CommandPalette } from "../command/CommandPalette";
import { TooltipProvider } from "../ui/tooltip";
import { ToastProvider } from "../ui/toast";
import { ToastHost } from "../ui/toast-host";
import { EmberMark } from "./EmberMark";
import { AutomationConfirmCard } from "./AutomationConfirmCard";
import { bridgeExternalTaskActivity } from "../../stores/externalTasks";
import { useAppStore } from "../../stores/app";
import { ProductSidebarLayout } from "@musefold/product-ui";

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useAppStore((s) => s.setSidebarCollapsed);
  const currentView = useAppStore((s) => s.currentView);
  const handleSidebarOpenChange = useCallback(
    (open: boolean) => setSidebarCollapsed(!open),
    [setSidebarCollapsed],
  );

  // 外部任务活动桥（朱点忙碌态，SET-02）——一次性订阅
  useEffect(() => {
    bridgeExternalTaskActivity();
  }, []);

  return (
    <ToastProvider swipeDirection="right" duration={3500}>
      <TooltipProvider delayDuration={300} skipDelayDuration={150}>
        <ProductSidebarLayout
          open={!collapsed}
          onOpenChange={handleSidebarOpenChange}
          compactDismissKey={currentView}
          sidebar={<Sidebar />}
        >
          <div className="relative z-0 flex min-w-0 flex-1 flex-col bg-elevated">
            <TitleBar />
            <main className="relative min-h-0 flex-1 overflow-hidden bg-elevated">
              {children}
              {/* 朱点：全应用单实例，坐在内容视口右上角的引首印位置（v0.3.3 §1.1） */}
              <EmberMark />
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
