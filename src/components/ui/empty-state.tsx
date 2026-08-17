// src/components/ui/empty-state.tsx
// Codex 风空状态 —— 图标 + 标题 + 提示 + 可选动作

import * as React from 'react';
import { cn } from '../../lib/utils';

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon,
  title,
  hint,
  action,
  className,
  ...rest
}) => (
  <div
    className={cn(
      'flex flex-col items-center justify-center gap-2.5 px-6 py-12 text-center',
      className
    )}
    {...rest}
  >
    {Icon && (
      <span className="mb-0.5 flex h-11 w-11 items-center justify-center rounded-lg border border-accent/15 bg-accent-soft text-accent">
        <Icon className="h-5 w-5" />
      </span>
    )}
    <p className="text-[13px] font-medium text-secondary">{title}</p>
    {hint && <p className="max-w-[17rem] text-[11px] leading-relaxed text-tertiary">{hint}</p>}
    {action && <div className="mt-1.5">{action}</div>}
  </div>
);
EmptyState.displayName = 'EmptyState';
