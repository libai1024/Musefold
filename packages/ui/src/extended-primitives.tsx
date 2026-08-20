import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import * as SelectPrimitive from "@radix-ui/react-select";
import * as SliderPrimitive from "@radix-ui/react-slider";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as ToastPrimitive from "@radix-ui/react-toast";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  ClipboardCopy,
  Copy,
  Download,
  FolderOpen,
  ImageOff,
  LoaderCircle,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
} from "./icons";
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

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;
export const DropdownMenuPortal = DropdownMenuPrimitive.Portal;
export const DropdownMenuSub = DropdownMenuPrimitive.Sub;
export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

export const DropdownMenuSubTrigger = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> & {
    inset?: boolean;
  }
>(function DropdownMenuSubTrigger(
  { className, inset, children, ...props },
  ref,
) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      ref={ref}
      data-inset={inset || undefined}
      className={mergeClassNames(
        "mf-ui-dropdown-item mf-ui-dropdown-sub-trigger",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRight aria-hidden="true" />
    </DropdownMenuPrimitive.SubTrigger>
  );
});

export const DropdownMenuSubContent = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(function DropdownMenuSubContent({ className, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.SubContent
      ref={ref}
      className={mergeClassNames(
        "mf-ui-dropdown-content mf-ui-dropdown-sub-content",
        className,
      )}
      {...props}
    />
  );
});

export const DropdownMenuContent = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(function DropdownMenuContent({ className, sideOffset = 4, ...props }, ref) {
  const content = (
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={mergeClassNames("mf-ui-dropdown-content", className)}
      {...props}
    />
  );
  // Node 静态渲染没有 document，Portal 会丢掉内容；浏览器仍走 Portal。
  if (typeof document === "undefined") return content;
  return <DropdownMenuPrimitive.Portal>{content}</DropdownMenuPrimitive.Portal>;
});

export const DropdownMenuItem = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
    inset?: boolean;
  }
>(function DropdownMenuItem({ className, inset, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Item
      ref={ref}
      data-inset={inset || undefined}
      className={mergeClassNames("mf-ui-dropdown-item", className)}
      {...props}
    />
  );
});

export const DropdownMenuCheckboxItem = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(function DropdownMenuCheckboxItem(
  { className, children, checked, ...props },
  ref,
) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      ref={ref}
      className={mergeClassNames(
        "mf-ui-dropdown-item mf-ui-dropdown-indicator-item",
        className,
      )}
      checked={checked}
      {...props}
    >
      <span className="mf-ui-dropdown-indicator">
        <DropdownMenuPrimitive.ItemIndicator>
          <Check aria-hidden="true" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
});

export const DropdownMenuRadioItem = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(function DropdownMenuRadioItem({ className, children, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.RadioItem
      ref={ref}
      className={mergeClassNames(
        "mf-ui-dropdown-item mf-ui-dropdown-indicator-item",
        className,
      )}
      {...props}
    >
      <span className="mf-ui-dropdown-indicator">
        <DropdownMenuPrimitive.ItemIndicator>
          <Circle className="mf-ui-dropdown-radio-glyph" aria-hidden="true" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  );
});

export const DropdownMenuLabel = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & {
    inset?: boolean;
  }
>(function DropdownMenuLabel({ className, inset, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Label
      ref={ref}
      data-inset={inset || undefined}
      className={mergeClassNames("mf-ui-dropdown-label", className)}
      {...props}
    />
  );
});

export const DropdownMenuSeparator = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(function DropdownMenuSeparator({ className, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Separator
      ref={ref}
      className={mergeClassNames("mf-ui-dropdown-separator", className)}
      {...props}
    />
  );
});

export function DropdownMenuShortcut({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={mergeClassNames("mf-ui-dropdown-shortcut", className)} {...props} />
  );
}

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export const SelectTrigger = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(function SelectTrigger({ className, children, ...props }, ref) {
  return (
    <SelectPrimitive.Trigger
      ref={ref}
      className={mergeClassNames("mf-ui-select-trigger", className)}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown aria-hidden="true" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
});

export const SelectContent = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(function SelectContent(
  { className, children, position = "popper", ...props },
  ref,
) {
  const content = (
    <SelectPrimitive.Content
      ref={ref}
      className={mergeClassNames("mf-ui-select-content", className)}
      position={position}
      {...props}
    >
      <SelectPrimitive.Viewport className="mf-ui-select-viewport">
        {children}
      </SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  );
  if (typeof document === "undefined") return content;
  return <SelectPrimitive.Portal>{content}</SelectPrimitive.Portal>;
});

export const SelectItem = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(function SelectItem({ className, children, ...props }, ref) {
  return (
    <SelectPrimitive.Item
      ref={ref}
      className={mergeClassNames("mf-ui-select-item", className)}
      {...props}
    >
      <span className="mf-ui-dropdown-indicator">
        <SelectPrimitive.ItemIndicator>
          <Check aria-hidden="true" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
});

export const Slider = React.forwardRef<
  React.ComponentRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(function Slider({ className, ...props }, ref) {
  return (
    <SliderPrimitive.Root
      ref={ref}
      className={mergeClassNames("mf-ui-slider", className)}
      {...props}
    >
      <SliderPrimitive.Track className="mf-ui-slider-track">
        <SliderPrimitive.Range className="mf-ui-slider-range" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="mf-ui-slider-thumb" />
    </SliderPrimitive.Root>
  );
});

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
}

export interface UiSegmentedControlProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  size?: "sm" | "md";
  className?: string;
  "aria-label"?: string;
}

/** 分段控件：选项间切换，不含桌面拖拽区语义。 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size = "md",
  className,
  ...aria
}: UiSegmentedControlProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={aria["aria-label"]}
      data-size={size}
      className={mergeClassNames("mf-ui-segmented", className)}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className="mf-ui-segmented-option"
          >
            {Icon ? <Icon className="mf-ui-segmented-icon" /> : null}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export type UiBadgeVariant =
  | "neutral"
  | "accent"
  | "success"
  | "warning"
  | "danger"
  | "outline";

export interface UiBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: UiBadgeVariant;
}

/** 紧凑状态/标签 chip，与 StatusBadge（纯色状态字）分工。 */
export const Badge = React.forwardRef<HTMLSpanElement, UiBadgeProps>(
  function Badge({ className, variant = "neutral", ...props }, ref) {
    return (
      <span
        ref={ref}
        data-variant={variant}
        className={mergeClassNames("mf-ui-badge", className)}
        {...props}
      />
    );
  },
);

export const ScrollArea = React.forwardRef<
  React.ComponentRef<typeof ScrollAreaPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> & {
    viewportClassName?: string;
  }
>(function ScrollArea({ className, children, viewportClassName, ...props }, ref) {
  return (
    <ScrollAreaPrimitive.Root
      ref={ref}
      className={mergeClassNames("mf-ui-scroll-area", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        className={mergeClassNames("mf-ui-scroll-viewport", viewportClassName)}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
});

const ScrollBar = React.forwardRef<
  React.ComponentRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>
>(function ScrollBar({ className, ...props }, ref) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      ref={ref}
      orientation="vertical"
      className={mergeClassNames("mf-ui-scroll-bar", className)}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb className="mf-ui-scroll-thumb" />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
});

export function Kbd({
  className,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  return <kbd className={mergeClassNames("mf-ui-kbd", className)} {...props} />;
}

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={mergeClassNames("mf-ui-skeleton", className)}
      {...props}
    />
  );
}

export interface UiSpinnerProps {
  className?: string;
  /** 直径 px，默认 16 */
  size?: number;
}

export function Spinner({ className, size = 16 }: UiSpinnerProps) {
  return (
    <span
      className={mergeClassNames("mf-ui-spinner", className)}
      style={{
        width: size,
        height: size,
        borderWidth: Math.max(1.5, size / 10),
      }}
      role="status"
      aria-label="加载中"
    />
  );
}

const LIGHTBOX_MIN_SCALE = 0.5;
const LIGHTBOX_MAX_SCALE = 3;
const LIGHTBOX_SCALE_STEP = 0.25;

export interface UiImageLightboxProps {
  /** 已解析的可渲染 URL；为 null 时关闭。宿主负责本地路径 → src。 */
  src: string | null;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  hasPrevious?: boolean;
  hasNext?: boolean;
  prompt?: string | null;
  onSave?: () => void | Promise<void>;
  onReveal?: () => void | Promise<void>;
  onCopyImage?: () => void | Promise<void>;
  onCopyPrompt?: () => void | Promise<void>;
}

/** 全屏图像预览。文件 IO / toast 由宿主回调注入，本组件不碰平台 API。 */
export function ImageLightbox({
  src,
  onClose,
  onPrevious,
  onNext,
  hasPrevious = false,
  hasNext = false,
  prompt,
  onSave,
  onReveal,
  onCopyImage,
  onCopyPrompt,
}: UiImageLightboxProps) {
  const [broken, setBroken] = React.useState(false);
  const [scale, setScale] = React.useState(1);
  React.useEffect(() => {
    setBroken(false);
    setScale(1);
  }, [src]);

  const zoomBy = (delta: number) => {
    setScale((v) =>
      Math.min(
        LIGHTBOX_MAX_SCALE,
        Math.max(LIGHTBOX_MIN_SCALE, Number((v + delta).toFixed(2))),
      ),
    );
  };

  React.useEffect(() => {
    if (!src) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && hasPrevious) {
        e.preventDefault();
        onPrevious?.();
      }
      if (e.key === "ArrowRight" && hasNext) {
        e.preventDefault();
        onNext?.();
      }
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        zoomBy(LIGHTBOX_SCALE_STEP);
      }
      if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoomBy(-LIGHTBOX_SCALE_STEP);
      }
      if (e.key === "0") {
        e.preventDefault();
        setScale(1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hasNext, hasPrevious, onNext, onPrevious, src]);

  const hasActions = Boolean(
    onSave || onReveal || onCopyImage || (prompt && onCopyPrompt),
  );

  const surface = (
    <>
      <DialogPrimitive.Overlay className="mf-ui-lightbox-overlay" />
      <DialogPrimitive.Content
          className="mf-ui-lightbox-content"
          onClick={onClose}
          aria-label="图像预览"
          data-testid="image-lightbox"
        >
          <DialogPrimitive.Title className="mf-ui-sr-only">图像预览</DialogPrimitive.Title>
          <DialogPrimitive.Description className="mf-ui-sr-only">
            点击任意处或按 ESC 关闭
          </DialogPrimitive.Description>
          {src && !broken ? (
            <img
              src={src}
              alt="预览"
              onClick={(e) => e.stopPropagation()}
              onError={() => setBroken(true)}
              data-testid="image-lightbox-image"
              data-scale={scale}
              style={{ transform: `scale(${scale})` }}
              className="mf-ui-lightbox-image"
            />
          ) : null}
          {src && broken ? (
            <div
              onClick={(e) => e.stopPropagation()}
              className="mf-ui-lightbox-broken"
            >
              <ImageOff aria-hidden="true" />
              <p className="mf-ui-lightbox-broken-title">图片无法加载</p>
              <p className="mf-ui-lightbox-broken-hint">文件可能已被移动或删除。</p>
            </div>
          ) : null}
          {src && (onPrevious || onNext) ? (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (hasPrevious) onPrevious?.();
                }}
                aria-disabled={!hasPrevious}
                aria-label="上一张"
                data-testid="image-lightbox-prev"
                className="mf-ui-lightbox-nav mf-ui-lightbox-nav-prev"
              >
                <ChevronLeft aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (hasNext) onNext?.();
                }}
                aria-disabled={!hasNext}
                aria-label="下一张"
                data-testid="image-lightbox-next"
                className="mf-ui-lightbox-nav mf-ui-lightbox-nav-next"
              >
                <ChevronRight aria-hidden="true" />
              </button>
            </>
          ) : null}
          {src && (hasActions || !broken) ? (
            <div
              className="mf-ui-lightbox-toolbar"
              onClick={(e) => e.stopPropagation()}
              data-testid="image-lightbox-toolbar"
            >
              {onSave ? (
                <LightboxAction
                  icon={Download}
                  label="另存图片"
                  testId="image-lightbox-save"
                  onClick={() => void onSave()}
                />
              ) : null}
              {onReveal ? (
                <LightboxAction
                  icon={FolderOpen}
                  label="打开所在文件夹"
                  testId="image-lightbox-folder"
                  onClick={() => void onReveal()}
                />
              ) : null}
              {onCopyImage ? (
                <LightboxAction
                  icon={Copy}
                  label="复制图片"
                  testId="image-lightbox-copy-image"
                  onClick={() => void onCopyImage()}
                />
              ) : null}
              {prompt && onCopyPrompt ? (
                <LightboxAction
                  icon={ClipboardCopy}
                  label="复制提示词"
                  testId="image-lightbox-copy-prompt"
                  onClick={() => void onCopyPrompt()}
                />
              ) : null}
              {!broken && hasActions ? (
                <span className="mf-ui-lightbox-toolbar-rule" aria-hidden="true" />
              ) : null}
              {!broken ? (
                <>
                  <button
                    type="button"
                    onClick={() => zoomBy(-LIGHTBOX_SCALE_STEP)}
                    disabled={scale <= LIGHTBOX_MIN_SCALE}
                    aria-label="缩小"
                    data-testid="image-lightbox-zoom-out"
                    className="mf-ui-lightbox-zoom"
                  >
                    <ZoomOut aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setScale(1)}
                    aria-label="重置缩放"
                    data-testid="image-lightbox-zoom-reset"
                    className="mf-ui-lightbox-zoom-reset"
                  >
                    <RotateCcw aria-hidden="true" />
                    {Math.round(scale * 100)}%
                  </button>
                  <button
                    type="button"
                    onClick={() => zoomBy(LIGHTBOX_SCALE_STEP)}
                    disabled={scale >= LIGHTBOX_MAX_SCALE}
                    aria-label="放大"
                    data-testid="image-lightbox-zoom-in"
                    className="mf-ui-lightbox-zoom"
                  >
                    <ZoomIn aria-hidden="true" />
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            data-testid="image-lightbox-close"
            className="mf-ui-lightbox-close"
          >
            <X aria-hidden="true" />
          </button>
        </DialogPrimitive.Content>
        </>
  );

  return (
    <DialogPrimitive.Root open={Boolean(src)} onOpenChange={(o) => !o && onClose()}>
      {typeof document === "undefined" ? (
        surface
      ) : (
        <DialogPrimitive.Portal>{surface}</DialogPrimitive.Portal>
      )}
    </DialogPrimitive.Root>
  );
}

function LightboxAction({
  icon: Icon,
  label,
  testId,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  testId: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      data-testid={testId}
      className="mf-ui-lightbox-action"
    >
      <Icon aria-hidden="true" />
    </button>
  );
}
