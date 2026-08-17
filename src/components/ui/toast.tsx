// src/components/ui/toast.tsx
// 系统通知 —— 实色面板 + 状态图标，避免与内容区抢注意力

import * as React from 'react';
import * as ToastPrimitive from '@radix-ui/react-toast';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from './icons';
import { cn } from '../../lib/utils';

export const ToastProvider = ToastPrimitive.Provider;

const toastVariants = cva(
  'no-drag pointer-events-auto relative flex w-full items-start gap-2.5 overflow-hidden rounded-lg border border-border-default bg-popover p-3 pr-9 shadow-pop data-[state=open]:animate-toast-in data-[state=closed]:animate-toast-out',
  {
    variants: {
      variant: {
        default: '',
        success: '',
        danger: '',
        warning: '',
        accent: '',
      },
    },
    defaultVariants: { variant: 'default' },
  }
);

export const ToastViewport = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Viewport
    ref={ref}
    className={cn(
      'no-drag pointer-events-none fixed bottom-3 right-3 z-50 flex max-h-[calc(100vh-24px)] w-[340px] flex-col gap-2 p-0 outline-none max-[640px]:bottom-3 max-[640px]:left-3 max-[640px]:right-3 max-[640px]:w-auto',
      className
    )}
    {...props}
  />
));
ToastViewport.displayName = 'ToastViewport';

export const Toast = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Root> & VariantProps<typeof toastVariants>
>(({ className, variant, ...props }, ref) => (
  <ToastPrimitive.Root
    ref={ref}
    className={cn(toastVariants({ variant }), className)}
    {...props}
  />
));
Toast.displayName = 'Toast';

export const ToastTitle = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Title
    ref={ref}
    className={cn('text-xs font-semibold text-primary', className)}
    {...props}
  />
));
ToastTitle.displayName = 'ToastTitle';

export const ToastDescription = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Description
    ref={ref}
    className={cn('text-[11px] leading-relaxed text-secondary', className)}
    {...props}
  />
));
ToastDescription.displayName = 'ToastDescription';

export const ToastClose = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Close
    ref={ref}
    className={cn(
      'absolute right-2 top-2 rounded-md p-1 text-tertiary transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-hover hover:text-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--accent-ring)]',
      className
    )}
    toast-description-dismiss-toast=""
    {...props}
  >
    <X className="h-3 w-3" />
    <span className="sr-only">关闭通知</span>
  </ToastPrimitive.Close>
));
ToastClose.displayName = 'ToastClose';
