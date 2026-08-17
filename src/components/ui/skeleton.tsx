// src/components/ui/skeleton.tsx
// 骨架屏占位 —— 加载态用（docs/product/10 §4.3「列表骨架屏 3-5 条占位」）

import { cn } from '../../lib/utils';

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn('animate-pulse rounded-md bg-inset', className)}
      {...props}
    />
  );
}
