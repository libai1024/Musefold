// src/components/ui/toast-host.tsx
// 把 toast store 渲染成 Radix Toast —— 挂在 AppShell 内（ToastProvider 之下）

import { Toast, ToastClose, ToastDescription, ToastTitle, ToastViewport } from './toast';
import { useToastStore } from '../../stores/toast';
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from './icons';
import { cn } from '../../lib/utils';

function ToastStatusIcon({ variant }: { variant: 'default' | 'success' | 'danger' | 'warning' | 'accent' }) {
  const Icon = variant === 'success'
    ? CheckCircle2
    : variant === 'danger'
      ? AlertCircle
      : variant === 'warning'
        ? TriangleAlert
        : Info;
  const color = variant === 'success'
    ? 'text-success'
    : variant === 'danger'
      ? 'text-danger'
      : variant === 'warning'
        ? 'text-warning'
        : variant === 'accent'
          ? 'text-accent'
          : 'text-tertiary';
  return <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', color)} aria-hidden="true" />;
}

export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <>
      {toasts.map((t) => (
        <Toast
          key={t.id}
          variant={t.variant}
          duration={t.duration === 0 ? Infinity : t.duration}
          onOpenChange={(open) => {
            if (!open) dismiss(t.id);
          }}
          onPause={() => undefined}
          onResume={() => undefined}
          data-toast-id={t.id}
          data-testid="toast"
          role={t.variant === 'danger' || t.variant === 'warning' ? 'alert' : 'status'}
        >
          <ToastStatusIcon variant={t.variant} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <ToastTitle>{t.title}</ToastTitle>
            {t.description && <ToastDescription>{t.description}</ToastDescription>}
          </div>
          {t.action && (
            <button
              onClick={() => {
                t.action?.onClick();
                dismiss(t.id);
              }}
              className="no-drag mt-0.5 shrink-0 rounded-md px-1.5 py-1 text-[11px] font-medium text-accent transition-colors duration-[var(--dur-fast)] hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
              data-testid="toast-action"
            >
              {t.action.label}
            </button>
          )}
          <ToastClose data-testid="toast-close" aria-label="关闭通知" />
        </Toast>
      ))}
      <ToastViewport />
    </>
  );
}
