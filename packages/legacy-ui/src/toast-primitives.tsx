import * as React from 'react';
import * as ToastPrimitive from '@radix-ui/react-toast';
import { X } from './icons';
import { IconButton } from './primitives';

function mergeClassNames(...names: Array<string | undefined>) {
  return names.filter(Boolean).join(' ');
}

export const ToastProvider = ToastPrimitive.Provider;

export const ToastViewport = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Viewport>
>(function ToastViewport({ className, ...props }, ref) {
  return (
    <ToastPrimitive.Viewport
      ref={ref}
      className={mergeClassNames('mf-ui-toast-viewport', className)}
      {...props}
    />
  );
});

export type UiToastVariant = 'default' | 'success' | 'danger' | 'warning' | 'accent';

export interface UiToastProps extends React.ComponentPropsWithoutRef<typeof ToastPrimitive.Root> {
  variant?: UiToastVariant;
}

export const Toast = React.forwardRef<React.ComponentRef<typeof ToastPrimitive.Root>, UiToastProps>(
  function Toast({ className, variant = 'default', ...props }, ref) {
    return (
      <ToastPrimitive.Root
        ref={ref}
        data-variant={variant}
        className={mergeClassNames('mf-ui-toast', className)}
        {...props}
      />
    );
  },
);

export const ToastIcon = React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(
  function ToastIcon({ className, ...props }, ref) {
    return <span ref={ref} className={mergeClassNames('mf-ui-toast-icon', className)} {...props} />;
  },
);

export const ToastBody = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function ToastBody({ className, ...props }, ref) {
    return <div ref={ref} className={mergeClassNames('mf-ui-toast-body', className)} {...props} />;
  },
);

export const ToastTitle = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Title>
>(function ToastTitle({ className, ...props }, ref) {
  return (
    <ToastPrimitive.Title
      ref={ref}
      className={mergeClassNames('mf-ui-toast-title', className)}
      {...props}
    />
  );
});

export const ToastDescription = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Description>
>(function ToastDescription({ className, ...props }, ref) {
  return (
    <ToastPrimitive.Description
      ref={ref}
      className={mergeClassNames('mf-ui-toast-description', className)}
      {...props}
    />
  );
});

export const ToastClose = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Close>
>(function ToastClose({ className, ...props }, ref) {
  return (
    <ToastPrimitive.Close asChild ref={ref} {...props}>
      <IconButton
        className={mergeClassNames('mf-ui-toast-close', className)}
        label="关闭通知"
        size="xs"
      >
        <X aria-hidden="true" />
      </IconButton>
    </ToastPrimitive.Close>
  );
});

export const ToastAction = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(function ToastAction({ className, type = 'button', ...props }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={mergeClassNames('mf-ui-toast-action', className)}
      {...props}
    />
  );
});
