// src/components/ui/toast-host.tsx
// 把 toast store 渲染成 Radix Toast —— 挂在 AppShell 内（ToastProvider 之下）

import {
  Toast,
  ToastAction,
  ToastBody,
  ToastClose,
  ToastDescription,
  ToastIcon,
  ToastTitle,
  ToastViewport,
} from './toast';
import { useToastStore } from '../../stores/toast';
import { AlertCircle, CheckCircle2, Info, AlertTriangle } from './icons';

function ToastStatusIcon({
  variant,
}: {
  variant: 'default' | 'success' | 'danger' | 'warning' | 'accent';
}) {
  const Icon = variant === 'success'
    ? CheckCircle2
    : variant === 'danger'
      ? AlertCircle
      : variant === 'warning'
        ? AlertTriangle
        : Info;
  return (
    <ToastIcon>
      <Icon aria-hidden="true" />
    </ToastIcon>
  );
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
          <ToastBody>
            <ToastTitle>{t.title}</ToastTitle>
            {t.description && <ToastDescription>{t.description}</ToastDescription>}
          </ToastBody>
          {t.action && (
            <ToastAction
              onClick={() => {
                t.action?.onClick();
                dismiss(t.id);
              }}
              data-testid="toast-action"
            >
              {t.action.label}
            </ToastAction>
          )}
          <ToastClose data-testid="toast-close" aria-label="关闭通知" />
        </Toast>
      ))}
      <ToastViewport />
    </>
  );
}
