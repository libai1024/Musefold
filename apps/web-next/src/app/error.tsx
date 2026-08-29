'use client';

import { ShellErrorFallback } from '@musefold/features/shell';

/** App Router 路由段错误边界:屏组件抛错时以共享错误卡替代白屏(ui-parity 01 §7 P0)。 */
export default function RouteError({ error, reset }: { error: Error; reset: () => void }) {
  return <ShellErrorFallback error={error} onRetry={reset} />;
}
