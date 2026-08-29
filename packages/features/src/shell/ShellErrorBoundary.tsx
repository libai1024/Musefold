'use client';

import { Button } from '@musefold/ui/components/button';
import { RotateCcw, TriangleAlert } from '@musefold/ui/icons';
import { Component, type ErrorInfo, type ReactNode } from 'react';

export interface ShellErrorFallbackProps {
  error: Error;
  /** 就地重试(重渲染子树 / Next reset)。 */
  onRetry(): void;
  /** 整页重载;缺省 location.reload。 */
  onReload?(): void;
}

/**
 * 全局错误卡(承旧 global-error-dialog 的信息结构):
 * 零数据依赖(不碰 gateway/query),保证兜底面自身不再抛错。
 */
export function ShellErrorFallback({ error, onRetry, onReload }: ShellErrorFallbackProps) {
  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background p-6 text-center"
      role="alert"
      data-testid="shell-error"
    >
      <TriangleAlert className="size-8 text-destructive" aria-hidden />
      <div className="flex max-w-md flex-col gap-1">
        <h1 className="font-semibold text-foreground text-lg">界面出了点问题</h1>
        <p className="text-muted-foreground text-sm">
          这不影响已保存的数据。可以先重试;若反复出现,请重载应用。
        </p>
        <p
          className="mt-2 max-h-24 overflow-y-auto break-all rounded-md bg-muted px-3 py-2 text-left font-mono text-muted-foreground text-xs"
          data-testid="shell-error-message"
        >
          {error.message || String(error)}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" onClick={onRetry} data-testid="shell-error-retry">
          <RotateCcw className="size-4" /> 重试
        </Button>
        <Button
          onClick={() => (onReload ? onReload() : window.location.reload())}
          data-testid="shell-error-reload"
        >
          重载应用
        </Button>
      </div>
    </div>
  );
}

interface ShellErrorBoundaryProps {
  children: ReactNode;
  /** 宿主注入的整页重载(桌面/Web 都是 location.reload;可注入以便测试)。 */
  onReload?(): void;
}

interface ShellErrorBoundaryState {
  error: Error | null;
}

/**
 * 渲染层全局兜底(承旧 GlobalErrorBoundary,ui-parity 01 §7 P0):
 * 任何屏抛出渲染异常时以错误卡替代白屏,提供「重试渲染」与「重载应用」两条恢复路径。
 * Web 宿主的路由级兜底走 Next error.tsx(复用 ShellErrorFallback);本组件供桌面壳与非路由树使用。
 */
export class ShellErrorBoundary extends Component<
  ShellErrorBoundaryProps,
  ShellErrorBoundaryState
> {
  state: ShellErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ShellErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 渲染异常必须留痕(主进程日志/浏览器控制台),但不外发。
    console.error('[musefold] 渲染层异常:', error, info.componentStack);
  }

  render() {
    if (this.state.error === null) return this.props.children;
    return (
      <ShellErrorFallback
        error={this.state.error}
        onRetry={() => this.setState({ error: null })}
        onReload={this.props.onReload}
      />
    );
  }
}
