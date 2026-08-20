// src/features/settings/components/ConnectionRow.tsx
// 连接行共用骨架 —— 图片生成服务商与 Agent 模型连接共享同一版式（Codex 式）：
// 品牌图标砖块 + 标题/标记 + mono 元信息；动作悬停浮现在行尾，黑色砖块 = 当前默认。

import type { ReactNode } from 'react';
import { Button } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';

export function ConnectionRow({
  active,
  icon,
  title,
  badges,
  meta,
  status,
  actions,
  trailing,
  testId,
}: {
  active: boolean;
  /** 品牌图标（ModelBrandIcon 等任意节点），渲染在 32px 砖块内 */
  icon: ReactNode;
  title: string;
  badges?: ReactNode;
  meta: ReactNode;
  status?: ReactNode;
  actions: ReactNode;
  trailing: ReactNode;
  testId?: string;
}) {
  return (
    <article
      className="settings-item group border-b border-border-subtle bg-transparent py-3.5 transition-colors first:border-t"
      data-testid={testId}
      data-active={active ? 'true' : 'false'}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors',
            active
              ? 'border-transparent bg-primary text-background'
              : 'border-border-subtle bg-inset text-secondary',
          )}
          aria-hidden="true"
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="truncate text-[12.5px] font-medium text-primary">{title}</h3>
            {active && (
              <span className="rounded-full bg-primary px-1.5 py-px text-[9px] font-medium leading-[14px] text-background">
                默认
              </span>
            )}
            {badges}
          </div>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono text-[10.5px] text-tertiary">
            {meta}
          </div>
          {status}
        </div>
        <div
          className="flex shrink-0 items-center gap-0.5 pt-0.5 opacity-0 transition-opacity duration-[var(--dur-fast)] group-focus-within:opacity-100 group-hover:opacity-100"
        >
          {actions}
          {trailing}
        </div>
      </div>
    </article>
  );
}

/** 行内二次确认 —— 撤销 Key / 删除连接等破坏性操作共用 */
export function InlineConfirm({
  label,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  label: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="whitespace-nowrap text-[10.5px] text-tertiary">{label}</span>
      <Button size="sm" variant={danger ? 'danger' : 'outline'} onClick={onConfirm}>{confirmLabel}</Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>取消</Button>
    </div>
  );
}
