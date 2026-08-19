import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as ToastPrimitive from "@radix-ui/react-toast";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { AlertCircle, LoaderCircle, X } from "./icons";
import { IconButton } from "./primitives";

function mergeClassNames(...names: Array<string | undefined>) {
  return names.filter(Boolean).join(" ");
}

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogPortal = DialogPrimitive.Portal;

export const DialogOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(function DialogOverlay({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Overlay
      ref={ref}
      className={mergeClassNames("mf-ui-dialog-overlay", className)}
      {...props}
    />
  );
});

export interface UiDialogContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  hideClose?: boolean;
  overlayClassName?: string;
}

export const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  UiDialogContentProps
>(function DialogContent(
  { children, className, hideClose = false, overlayClassName, ...props },
  ref,
) {
  return (
    <DialogPortal>
      <DialogOverlay className={overlayClassName} />
      <DialogPrimitive.Content
        ref={ref}
        className={mergeClassNames("mf-ui-dialog-content", className)}
        {...props}
      >
        {children}
        {!hideClose ? (
          <DialogPrimitive.Close asChild>
            <IconButton
              className="mf-ui-dialog-close"
              label="关闭"
              size="xs"
            >
              <X aria-hidden="true" />
            </IconButton>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});

export const DialogHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(function DialogHeader({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={mergeClassNames("mf-ui-dialog-header", className)}
      {...props}
    />
  );
});

export const DialogFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(function DialogFooter({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={mergeClassNames("mf-ui-dialog-footer", className)}
      {...props}
    />
  );
});

export const DialogTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(function DialogTitle({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Title
      ref={ref}
      className={mergeClassNames("mf-ui-dialog-title", className)}
      {...props}
    />
  );
});

export const DialogDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(function DialogDescription({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Description
      ref={ref}
      className={mergeClassNames("mf-ui-dialog-description", className)}
      {...props}
    />
  );
});

export const Drawer = DialogPrimitive.Root;
export const DrawerTrigger = DialogPrimitive.Trigger;
export const DrawerClose = DialogPrimitive.Close;

export interface UiDrawerContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  side?: "left" | "right" | "top" | "bottom";
  hideClose?: boolean;
}

export const DrawerContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  UiDrawerContentProps
>(function DrawerContent(
  { children, className, side = "right", hideClose = false, ...props },
  ref,
) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        data-side={side}
        className={mergeClassNames("mf-ui-drawer-content", className)}
        {...props}
      >
        {children}
        {!hideClose ? (
          <DialogPrimitive.Close asChild>
            <IconButton
              className="mf-ui-drawer-close"
              label="关闭"
              size="xs"
            >
              <X aria-hidden="true" />
            </IconButton>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});

export const DrawerHeader = DialogHeader;
export const DrawerFooter = DialogFooter;
export const DrawerTitle = DialogTitle;
export const DrawerDescription = DialogDescription;

export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(function TabsList({ className, ...props }, ref) {
  return (
    <TabsPrimitive.List
      ref={ref}
      className={mergeClassNames("mf-ui-tabs-list", className)}
      {...props}
    />
  );
});

export const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(function TabsTrigger({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={mergeClassNames("mf-ui-tabs-trigger", className)}
      {...props}
    />
  );
});

export const TabsContent = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(function TabsContent({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Content
      ref={ref}
      className={mergeClassNames("mf-ui-tabs-content", className)}
      {...props}
    />
  );
});

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = React.forwardRef<
  React.ComponentRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(function TooltipContent({ className, sideOffset = 4, ...props }, ref) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={mergeClassNames("mf-ui-tooltip-content", className)}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
});

export const ToastProvider = ToastPrimitive.Provider;

export const ToastViewport = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Viewport>
>(function ToastViewport({ className, ...props }, ref) {
  return (
    <ToastPrimitive.Viewport
      ref={ref}
      className={mergeClassNames("mf-ui-toast-viewport", className)}
      {...props}
    />
  );
});

export type UiToastVariant = "default" | "success" | "danger" | "warning" | "accent";

export interface UiToastProps
  extends React.ComponentPropsWithoutRef<typeof ToastPrimitive.Root> {
  variant?: UiToastVariant;
}

export const Toast = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Root>,
  UiToastProps
>(function Toast({ className, variant = "default", ...props }, ref) {
  return (
    <ToastPrimitive.Root
      ref={ref}
      data-variant={variant}
      className={mergeClassNames("mf-ui-toast", className)}
      {...props}
    />
  );
});

export const ToastTitle = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Title>
>(function ToastTitle({ className, ...props }, ref) {
  return (
    <ToastPrimitive.Title
      ref={ref}
      className={mergeClassNames("mf-ui-toast-title", className)}
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
      className={mergeClassNames("mf-ui-toast-description", className)}
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
        className={mergeClassNames("mf-ui-toast-close", className)}
        label="关闭通知"
        size="xs"
      >
        <X aria-hidden="true" />
      </IconButton>
    </ToastPrimitive.Close>
  );
});

export interface UiInputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  mono?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, UiInputProps>(
  function Input({ className, mono, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={mergeClassNames("mf-ui-input", mono ? "mf-ui-input-mono" : undefined, className)}
        {...props}
      />
    );
  },
);

export interface UiTextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  mono?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, UiTextareaProps>(
  function Textarea({ className, mono, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={mergeClassNames("mf-ui-textarea", mono ? "mf-ui-input-mono" : undefined, className)}
        {...props}
      />
    );
  },
);

export interface UiEmptyStateProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  icon?: React.ReactNode | React.ElementType<{ className?: string }>;
  title: React.ReactNode;
  hint?: React.ReactNode;
  action?: React.ReactNode;
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
  className,
  ...props
}: UiEmptyStateProps) {
  const iconIsElement = React.isValidElement(icon);
  const iconIsComponent =
    !iconIsElement &&
    (typeof icon === "function" ||
      (typeof icon === "object" &&
        icon !== null &&
        "$$typeof" in icon &&
        "render" in icon));
  return (
    <div className={mergeClassNames("mf-ui-empty-state", className)} {...props}>
      {icon ? (
        <span className="mf-ui-empty-state-icon">
          {iconIsComponent ? (
            React.createElement(icon as React.ElementType, {
              className: "mf-ui-empty-state-icon-glyph",
            })
          ) : (
            (icon as React.ReactNode)
          )}
        </span>
      ) : null}
      <p className="mf-ui-empty-state-title">{title}</p>
      {hint ? <p className="mf-ui-empty-state-hint">{hint}</p> : null}
      {action ? <div className="mf-ui-empty-state-action">{action}</div> : null}
    </div>
  );
}

export interface UiLoadingStateProps extends React.HTMLAttributes<HTMLDivElement> {
  label?: React.ReactNode;
}

export function LoadingState({ label = "正在载入...", className, ...props }: UiLoadingStateProps) {
  return (
    <div className={mergeClassNames("mf-ui-loading-state", className)} role="status" {...props}>
      <LoaderCircle className="mf-ui-spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export interface UiErrorStateProps extends React.HTMLAttributes<HTMLDivElement> {
  message: React.ReactNode;
  action?: React.ReactNode;
}

export function ErrorState({ message, action, className, ...props }: UiErrorStateProps) {
  return (
    <div className={mergeClassNames("mf-ui-error-state", className)} role="alert" {...props}>
      <AlertCircle aria-hidden="true" />
      <span>{message}</span>
      {action ? <div className="mf-ui-error-state-action">{action}</div> : null}
    </div>
  );
}
