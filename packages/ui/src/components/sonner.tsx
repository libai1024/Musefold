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

// toast 单一入口:features 从这里取,不直接依赖 sonner 包(与 icons 同策略)。
export { Toaster, toast };
