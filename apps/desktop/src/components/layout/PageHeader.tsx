// src/components/layout/PageHeader.tsx
// 页面工具条 —— 页面身份由 TitleBar 统一承载，这里只放计数、切换和动作。
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface PageHeaderProps {
  count?: number;
  actions?: ReactNode;
  /** 左侧内联控件（如分段 tab）—— 不进右侧 ml-auto 动作区 */
  afterTitle?: ReactNode;
  className?: string;
}

export function PageHeader({ count, actions, afterTitle, className }: PageHeaderProps) {
  if (typeof count !== 'number' && !afterTitle && !actions) return null;

  return (
    <header
      data-testid="page-toolbar"
      aria-label="页面工具"
      className={cn(
        // pr-16：为右上角朱点让出保留区（v0.3.3 朱点规范 §1.2）
        'flex min-h-[44px] shrink-0 items-center gap-2.5 border-b border-border-subtle bg-elevated py-0 pl-4 pr-16 max-[900px]:h-auto max-[900px]:flex-wrap max-[900px]:py-2.5 max-[900px]:pl-3',
        className
      )}
    >
      {typeof count === 'number' && (
        <span className="shrink-0 font-mono text-meta leading-none tabular-nums text-tertiary">
          {count} 项
        </span>
      )}
      {afterTitle}
      {actions && (
        <div className="ml-auto flex min-w-0 items-center gap-2 max-[900px]:flex-wrap max-[640px]:basis-full max-[640px]:justify-start">
          {actions}
        </div>
      )}
    </header>
  );
}

/** 面板小头（组合画布三栏用） */
export function PanelHeader({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border-subtle px-3 text-meta font-semibold uppercase tracking-[0.08em] text-quaternary">
      {children}
      {actions && <div className="ml-auto flex items-center gap-1">{actions}</div>}
    </div>
  );
}
