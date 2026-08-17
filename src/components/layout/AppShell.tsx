// src/components/layout/AppShell.tsx
// 全局骨架：TitleBar + Sidebar + 主区 + 命令面板 + Radix Provider
// 详见 docs/06-ui-design-system.md §6.1

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
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

interface AppShellProps {
  children: ReactNode;
}

const SIDEBAR_WIDTH_KEY = 'musefold:sidebar-width';
const DEFAULT_SIDEBAR_WIDTH = 244;
const MIN_SIDEBAR_WIDTH = 200;

function maxSidebarWidth(): number {
  return Math.max(MIN_SIDEBAR_WIDTH, Math.floor(window.innerWidth * 0.5));
}

function clampSidebarWidth(width: number): number {
  return Math.min(maxSidebarWidth(), Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)));
}

function initialSidebarWidth(): number {
  if (typeof localStorage === 'undefined') return DEFAULT_SIDEBAR_WIDTH;
  const saved = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
  return Number.isFinite(saved) ? Math.min(Math.max(saved, MIN_SIDEBAR_WIDTH), DEFAULT_SIDEBAR_WIDTH * 2) : DEFAULT_SIDEBAR_WIDTH;
}

export function AppShell({ children }: AppShellProps) {
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useAppStore((s) => s.setSidebarCollapsed);
  const currentView = useAppStore((s) => s.currentView);
  const [isCompact, setIsCompact] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(initialSidebarWidth);
  const [resizingSidebar, setResizingSidebar] = useState(false);
  const sidebarWidthRef = useRef(sidebarWidth);

  const applySidebarWidth = (nextWidth: number) => {
    const next = clampSidebarWidth(nextWidth);
    sidebarWidthRef.current = next;
    setSidebarWidth(next);
    if (typeof localStorage !== 'undefined') localStorage.setItem(SIDEBAR_WIDTH_KEY, String(next));
  };

  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);

  // 外部任务活动桥（朱点忙碌态，SET-02）——一次性订阅
  useEffect(() => {
    bridgeExternalTaskActivity();
  }, []);

  useEffect(() => {
    const onResize = () => applySidebarWidth(sidebarWidthRef.current);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const sync = (matches: boolean) => {
      setIsCompact(matches);
      setSidebarCollapsed(matches);
    };
    sync(media.matches);
    const onChange = (event: MediaQueryListEvent) => sync(event.matches);
    media.addEventListener?.('change', onChange);
    return () => media.removeEventListener?.('change', onChange);
  }, [setSidebarCollapsed]);

  useEffect(() => {
    if (isCompact) setSidebarCollapsed(true);
  }, [currentView, isCompact, setSidebarCollapsed]);

  const sidebarOpen = !collapsed;
  const compactSidebarWidth = typeof window === 'undefined' ? DEFAULT_SIDEBAR_WIDTH : Math.min(304, Math.max(MIN_SIDEBAR_WIDTH, window.innerWidth - 48));

  const startSidebarResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (isCompact || collapsed || event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidthRef.current;
    setResizingSidebar(true);
    const handleMove = (moveEvent: PointerEvent) => {
      applySidebarWidth(startWidth + moveEvent.clientX - startX);
    };
    const stop = () => {
      setResizingSidebar(false);
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  };

  const handleSidebarResizeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (isCompact || collapsed) return;
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      applySidebarWidth(sidebarWidthRef.current + 16);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      applySidebarWidth(sidebarWidthRef.current - 16);
    } else if (event.key === 'Home') {
      event.preventDefault();
      applySidebarWidth(MIN_SIDEBAR_WIDTH);
    } else if (event.key === 'End') {
      event.preventDefault();
      applySidebarWidth(maxSidebarWidth());
    }
  };

  return (
    <ToastProvider swipeDirection="right" duration={3500}>
      <TooltipProvider delayDuration={300} skipDelayDuration={150}>
        <div className={`relative flex h-[100dvh] overflow-hidden bg-background text-primary ${resizingSidebar ? 'cursor-col-resize select-none' : ''}`}>
          <div
            className={`relative z-40 shrink-0 overflow-hidden bg-sidebar ${
              resizingSidebar ? '' : 'transition-[width] duration-[var(--dur-base)] ease-smooth'
            } ${
              collapsed ? 'border-r-0' : 'border-r border-border-subtle'
            } ${
              isCompact ? 'absolute inset-y-0 left-0 shadow-pop' : ''
            }`}
            style={{ width: collapsed ? 0 : isCompact ? compactSidebarWidth : sidebarWidth }}
          >
            <Sidebar />
          </div>
          {!isCompact && sidebarOpen && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="调整侧栏宽度"
              aria-valuemin={MIN_SIDEBAR_WIDTH}
              aria-valuemax={maxSidebarWidth()}
              aria-valuenow={sidebarWidth}
              tabIndex={0}
              onPointerDown={startSidebarResize}
              onDoubleClick={() => applySidebarWidth(DEFAULT_SIDEBAR_WIDTH)}
              onKeyDown={handleSidebarResizeKeyDown}
              className="no-drag absolute inset-y-0 z-50 w-2 -translate-x-1/2 cursor-col-resize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              style={{ left: sidebarWidth }}
              data-testid="sidebar-resize-handle"
            >
              <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors hover:bg-border-strong" />
            </div>
          )}
          {isCompact && sidebarOpen && (
            <button
              type="button"
              aria-label="关闭侧栏"
              onClick={() => setSidebarCollapsed(true)}
              className="no-drag absolute inset-0 z-30 bg-black/30"
            />
          )}
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
        </div>
      </TooltipProvider>
    </ToastProvider>
  );
}
