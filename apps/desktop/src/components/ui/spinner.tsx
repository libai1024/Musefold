// src/components/ui/spinner.tsx
// 加载转圈 —— 发丝环 + Ember 弧，用于生图等待
import { cn } from '../../lib/utils';

interface SpinnerProps {
  className?: string;
  /** 直径 px，默认 16 */
  size?: number;
}

export function Spinner({ className, size = 16 }: SpinnerProps) {
  return (
    <span
      className={cn('inline-block animate-spin rounded-full', className)}
      style={{
        width: size,
        height: size,
        border: `${Math.max(1.5, size / 10)}px solid var(--border-strong)`,
        borderTopColor: 'var(--accent)',
      }}
      role="status"
      aria-label="加载中"
    />
  );
}
