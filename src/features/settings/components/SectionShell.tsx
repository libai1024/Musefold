// src/features/settings/components/SectionShell.tsx
// 设置分区统一骨架 —— Codex 式窄栏：标题排版承重 + 描述 + 右侧动作。
import type { ReactNode } from 'react';

interface Props {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}

export function SectionShell({ title, description, action, children }: Props) {
  return (
    <div className="settings-section mx-auto w-full max-w-[680px]">
      <div className="settings-section__header flex flex-col items-stretch gap-4 min-[640px]:flex-row min-[640px]:items-start">
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-primary">{title}</h2>
          {description && (
            <p className="mt-1.5 max-w-[62ch] text-[12px] leading-relaxed text-tertiary">{description}</p>
          )}
        </div>
        {action && <div className="shrink-0 min-[640px]:pt-0.5">{action}</div>}
      </div>
      <div className="settings-section__body mt-7">{children}</div>
    </div>
  );
}

/** 设置项行 —— 左侧标签/说明 + 右侧控件 */
export function SettingRow({
  label,
  hint,
  children,
  ...props
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className="settings-row flex flex-col items-stretch gap-2 border-b border-border-subtle px-0 py-[var(--density-setting-row-y)] transition-colors first:border-t sm:flex-row sm:items-center sm:justify-between sm:gap-6"
      {...props}
    >
      <div className="min-w-0">
        <p className="text-[12.5px] font-medium text-primary">{label}</p>
        {hint && <p className="mt-0.5 text-[11px] leading-relaxed text-tertiary">{hint}</p>}
      </div>
      <div className="w-full sm:w-auto sm:shrink-0">{children}</div>
    </div>
  );
}
