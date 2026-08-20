import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '../ui/button';
import { Loader2, Power } from '../ui/icons';
import { desktopHost as api } from '@renderer/runtime/desktop-host-services';
import { reportError } from '../../stores/errors';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  restarting: boolean;
  restartError: string | null;
}

export class GlobalErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    restarting: false,
    restartError: null,
  };

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo): void {
    reportError(error, {
      source: 'react',
      context: { componentStack: errorInfo.componentStack },
    });
  }

  private restartApp = async (): Promise<void> => {
    if (this.state.restarting) return;
    this.setState({ restarting: true, restartError: null });
    try {
      await api.system.relaunch();
    } catch {
      this.setState({
        restarting: false,
        restartError: '无法自动重启，请完全退出 Musefold 后重新打开。',
      });
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <main className="flex h-[100dvh] items-center justify-center bg-background px-6 text-primary">
          <section className="max-w-md text-center" role="alert">
            <h1 className="text-base font-semibold">界面暂时无法显示</h1>
            <p className="mt-2 text-sm leading-relaxed text-secondary">
              错误信息已记录在弹窗中。请复制后发送给维护者。
            </p>
            <Button
              type="button"
              size="sm"
              className="mt-4"
              onClick={() => void this.restartApp()}
              disabled={this.state.restarting}
              aria-busy={this.state.restarting}
              data-testid="fatal-error-restart"
            >
              {this.state.restarting
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                : <Power className="h-3.5 w-3.5" aria-hidden="true" />}
              {this.state.restarting ? '正在重启' : '重启应用'}
            </Button>
            {this.state.restartError && (
              <p className="mt-3 text-xs leading-relaxed text-danger" role="status">
                {this.state.restartError}
              </p>
            )}
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}
