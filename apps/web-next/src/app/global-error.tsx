'use client';

import { ShellErrorFallback } from '@musefold/features/shell';

/**
 * 根布局级错误边界:layout/Providers 自身抛错时接管整页。
 * 该层替换 <html>,须自带骨架;样式仍走全局 CSS(构建期注入)。
 */
export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">
        <ShellErrorFallback error={error} onRetry={reset} />
      </body>
    </html>
  );
}
