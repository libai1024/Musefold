'use client';

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { Toaster as Sonner, type ToasterProps, toast } from 'sonner';

const MOBILE_TOAST_QUERY = '(max-width: 767px)';

// UI-SPEC §2.4:成功提示 2.5s 自动关闭;错误提示需手动关闭(永不自动消失 + 关闭按钮)。
// 调用点显式传参优先于这里的默认值。
const SUCCESS_TOAST_DURATION_MS = 2500;

type ToastDataWithDefaults = { duration?: number; closeButton?: boolean };

function withTypeDefaults<D extends ToastDataWithDefaults>(
  defaults: ToastDataWithDefaults,
  data?: D,
): D {
  const merged = { ...(data ?? {}) } as D;
  if (defaults.duration !== undefined && merged.duration === undefined) {
    merged.duration = defaults.duration;
  }
  if (defaults.closeButton !== undefined && merged.closeButton === undefined) {
    merged.closeButton = defaults.closeButton;
  }
  return merged;
}

export function defaultToastPosition(isMobile: boolean): ToasterProps['position'] {
  return isMobile ? 'top-center' : 'top-right';
}

function useDefaultToastPosition(): ToasterProps['position'] {
  const [position, setPosition] = useState<ToasterProps['position']>(defaultToastPosition(false));

  useEffect(() => {
    const media = window.matchMedia(MOBILE_TOAST_QUERY);
    const sync = () => setPosition(defaultToastPosition(media.matches));
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  return position;
}

const Toaster = ({ position, ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme();
  const defaultPosition = useDefaultToastPosition();

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      position={position ?? defaultPosition}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

const sonnerToast = toast;

// §2.4 类型默认值在 toast 单一出口统一注入,features 的 101 处 toast.error 无需逐个传参;
// 未覆盖的类型(info/warning/loading/promise 等)原样转发 sonner 默认行为。
const toastWithSpecDefaults: typeof toast = Object.assign(
  (message: string, data?: Parameters<typeof sonnerToast>[1]) => sonnerToast(message, data),
  sonnerToast,
) as typeof sonnerToast;

toastWithSpecDefaults.success = (message, data) =>
  sonnerToast.success(message, withTypeDefaults({ duration: SUCCESS_TOAST_DURATION_MS }, data));

toastWithSpecDefaults.error = (message, data) =>
  sonnerToast.error(
    message,
    withTypeDefaults({ duration: Number.POSITIVE_INFINITY, closeButton: true }, data),
  );

// toast 单一入口:features 从这里取,不直接依赖 sonner 包(与 icons 同策略)。
export { Toaster, toastWithSpecDefaults as toast };
