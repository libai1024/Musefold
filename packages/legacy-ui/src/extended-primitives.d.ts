import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import * as SelectPrimitive from '@radix-ui/react-select';
import * as SliderPrimitive from '@radix-ui/react-slider';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
export declare const Dialog: React.FC<DialogPrimitive.DialogProps>;
export declare const DialogTrigger: React.ForwardRefExoticComponent<
  DialogPrimitive.DialogTriggerProps & React.RefAttributes<HTMLButtonElement>
>;
export declare const DialogClose: React.ForwardRefExoticComponent<
  DialogPrimitive.DialogCloseProps & React.RefAttributes<HTMLButtonElement>
>;
export declare const DialogPortal: React.FC<DialogPrimitive.DialogPortalProps>;
export declare const DialogOverlay: React.ForwardRefExoticComponent<
  Omit<DialogPrimitive.DialogOverlayProps & React.RefAttributes<HTMLDivElement>, 'ref'> &
    React.RefAttributes<HTMLDivElement>
>;
export interface UiDialogContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  hideClose?: boolean;
  overlayClassName?: string;
}
export declare const DialogContent: React.ForwardRefExoticComponent<
  UiDialogContentProps & React.RefAttributes<HTMLDivElement>
>;
export declare const DialogHeader: React.ForwardRefExoticComponent<
  React.HTMLAttributes<HTMLDivElement> & React.RefAttributes<HTMLDivElement>
>;
export declare const DialogBody: React.ForwardRefExoticComponent<
  React.HTMLAttributes<HTMLDivElement> & React.RefAttributes<HTMLDivElement>
>;
export declare const DialogFooter: React.ForwardRefExoticComponent<
  React.HTMLAttributes<HTMLDivElement> & React.RefAttributes<HTMLDivElement>
>;
export declare const DialogTitle: React.ForwardRefExoticComponent<
  Omit<DialogPrimitive.DialogTitleProps & React.RefAttributes<HTMLHeadingElement>, 'ref'> &
    React.RefAttributes<HTMLHeadingElement>
>;
export declare const DialogDescription: React.ForwardRefExoticComponent<
  Omit<DialogPrimitive.DialogDescriptionProps & React.RefAttributes<HTMLParagraphElement>, 'ref'> &
    React.RefAttributes<HTMLParagraphElement>
>;
export declare const Drawer: React.FC<DialogPrimitive.DialogProps>;
export declare const DrawerTrigger: React.ForwardRefExoticComponent<
  DialogPrimitive.DialogTriggerProps & React.RefAttributes<HTMLButtonElement>
>;
export declare const DrawerClose: React.ForwardRefExoticComponent<
  DialogPrimitive.DialogCloseProps & React.RefAttributes<HTMLButtonElement>
>;
export interface UiDrawerContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  side?: 'left' | 'right' | 'top' | 'bottom';
  hideClose?: boolean;
}
export declare const DrawerContent: React.ForwardRefExoticComponent<
  UiDrawerContentProps & React.RefAttributes<HTMLDivElement>
>;
export declare const DrawerHeader: React.ForwardRefExoticComponent<
  React.HTMLAttributes<HTMLDivElement> & React.RefAttributes<HTMLDivElement>
>;
export declare const DrawerFooter: React.ForwardRefExoticComponent<
  React.HTMLAttributes<HTMLDivElement> & React.RefAttributes<HTMLDivElement>
>;
export declare const DrawerTitle: React.ForwardRefExoticComponent<
  Omit<DialogPrimitive.DialogTitleProps & React.RefAttributes<HTMLHeadingElement>, 'ref'> &
    React.RefAttributes<HTMLHeadingElement>
>;
export declare const DrawerDescription: React.ForwardRefExoticComponent<
  Omit<DialogPrimitive.DialogDescriptionProps & React.RefAttributes<HTMLParagraphElement>, 'ref'> &
    React.RefAttributes<HTMLParagraphElement>
>;
export declare const Tabs: React.ForwardRefExoticComponent<
  TabsPrimitive.TabsProps & React.RefAttributes<HTMLDivElement>
>;
export declare const TabsList: React.ForwardRefExoticComponent<
  Omit<TabsPrimitive.TabsListProps & React.RefAttributes<HTMLDivElement>, 'ref'> &
    React.RefAttributes<HTMLDivElement>
>;
export declare const TabsTrigger: React.ForwardRefExoticComponent<
  Omit<TabsPrimitive.TabsTriggerProps & React.RefAttributes<HTMLButtonElement>, 'ref'> &
    React.RefAttributes<HTMLButtonElement>
>;
export declare const TabsContent: React.ForwardRefExoticComponent<
  Omit<TabsPrimitive.TabsContentProps & React.RefAttributes<HTMLDivElement>, 'ref'> &
    React.RefAttributes<HTMLDivElement>
>;
export declare const TooltipProvider: React.FC<TooltipPrimitive.TooltipProviderProps>;
export declare const Tooltip: React.FC<TooltipPrimitive.TooltipProps>;
export declare const TooltipTrigger: React.ForwardRefExoticComponent<
  TooltipPrimitive.TooltipTriggerProps & React.RefAttributes<HTMLButtonElement>
>;
export declare const TooltipContent: React.ForwardRefExoticComponent<
  Omit<TooltipPrimitive.TooltipContentProps & React.RefAttributes<HTMLDivElement>, 'ref'> &
    React.RefAttributes<HTMLDivElement>
>;
export interface UiInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  mono?: boolean;
}
export declare const Input: React.ForwardRefExoticComponent<
  UiInputProps & React.RefAttributes<HTMLInputElement>
>;
export interface UiTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  mono?: boolean;
}
export declare const Textarea: React.ForwardRefExoticComponent<
  UiTextareaProps & React.RefAttributes<HTMLTextAreaElement>
>;
export interface UiEmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  icon?:
    | React.ReactNode
    | React.ElementType<{
        className?: string;
      }>;
  title: React.ReactNode;
  hint?: React.ReactNode;
  action?: React.ReactNode;
}
export declare function EmptyState({
  icon,
  title,
  hint,
  action,
  className,
  ...props
}: UiEmptyStateProps): React.JSX.Element;
export interface UiLoadingStateProps extends React.HTMLAttributes<HTMLDivElement> {
  label?: React.ReactNode;
}
export declare function LoadingState({
  label,
  className,
  ...props
}: UiLoadingStateProps): React.JSX.Element;
export interface UiErrorStateProps extends React.HTMLAttributes<HTMLDivElement> {
  message: React.ReactNode;
  action?: React.ReactNode;
}
export declare function ErrorState({
  message,
  action,
  className,
  ...props
}: UiErrorStateProps): React.JSX.Element;
export declare const DropdownMenu: React.FC<DropdownMenuPrimitive.DropdownMenuProps>;
export declare const DropdownMenuTrigger: React.ForwardRefExoticComponent<
  DropdownMenuPrimitive.DropdownMenuTriggerProps & React.RefAttributes<HTMLButtonElement>
>;
export declare const DropdownMenuGroup: React.ForwardRefExoticComponent<
  DropdownMenuPrimitive.DropdownMenuGroupProps & React.RefAttributes<HTMLDivElement>
>;
export declare const DropdownMenuPortal: React.FC<DropdownMenuPrimitive.DropdownMenuPortalProps>;
export declare const DropdownMenuSub: React.FC<DropdownMenuPrimitive.DropdownMenuSubProps>;
export declare const DropdownMenuRadioGroup: React.ForwardRefExoticComponent<
  DropdownMenuPrimitive.DropdownMenuRadioGroupProps & React.RefAttributes<HTMLDivElement>
>;
export { DropdownMenuContent } from './dropdown-menu-content';
export declare const DropdownMenuSubTrigger: React.ForwardRefExoticComponent<
  Omit<
    DropdownMenuPrimitive.DropdownMenuSubTriggerProps & React.RefAttributes<HTMLDivElement>,
    'ref'
  > & {
    inset?: boolean;
  } & React.RefAttributes<HTMLDivElement>
>;
export declare const DropdownMenuSubContent: React.ForwardRefExoticComponent<
  Omit<
    DropdownMenuPrimitive.DropdownMenuSubContentProps & React.RefAttributes<HTMLDivElement>,
    'ref'
  > &
    React.RefAttributes<HTMLDivElement>
>;
export declare const DropdownMenuItem: React.ForwardRefExoticComponent<
  Omit<DropdownMenuPrimitive.DropdownMenuItemProps & React.RefAttributes<HTMLDivElement>, 'ref'> & {
    inset?: boolean;
    tone?: 'danger';
  } & React.RefAttributes<HTMLDivElement>
>;
export declare const DropdownMenuCheckboxItem: React.ForwardRefExoticComponent<
  Omit<
    DropdownMenuPrimitive.DropdownMenuCheckboxItemProps & React.RefAttributes<HTMLDivElement>,
    'ref'
  > &
    React.RefAttributes<HTMLDivElement>
>;
export declare const DropdownMenuRadioItem: React.ForwardRefExoticComponent<
  Omit<
    DropdownMenuPrimitive.DropdownMenuRadioItemProps & React.RefAttributes<HTMLDivElement>,
    'ref'
  > &
    React.RefAttributes<HTMLDivElement>
>;
export declare const DropdownMenuLabel: React.ForwardRefExoticComponent<
  Omit<
    DropdownMenuPrimitive.DropdownMenuLabelProps & React.RefAttributes<HTMLDivElement>,
    'ref'
  > & {
    inset?: boolean;
  } & React.RefAttributes<HTMLDivElement>
>;
export declare const DropdownMenuSeparator: React.ForwardRefExoticComponent<
  Omit<
    DropdownMenuPrimitive.DropdownMenuSeparatorProps & React.RefAttributes<HTMLDivElement>,
    'ref'
  > &
    React.RefAttributes<HTMLDivElement>
>;
export declare function DropdownMenuShortcut({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>): React.JSX.Element;
export declare const Select: React.FC<SelectPrimitive.SelectProps>;
export declare const SelectGroup: React.ForwardRefExoticComponent<
  SelectPrimitive.SelectGroupProps & React.RefAttributes<HTMLDivElement>
>;
export declare const SelectValue: React.ForwardRefExoticComponent<
  SelectPrimitive.SelectValueProps & React.RefAttributes<HTMLSpanElement>
>;
export declare const SelectTrigger: React.ForwardRefExoticComponent<
  Omit<SelectPrimitive.SelectTriggerProps & React.RefAttributes<HTMLButtonElement>, 'ref'> &
    React.RefAttributes<HTMLButtonElement>
>;
export declare const SelectContent: React.ForwardRefExoticComponent<
  Omit<SelectPrimitive.SelectContentProps & React.RefAttributes<HTMLDivElement>, 'ref'> &
    React.RefAttributes<HTMLDivElement>
>;
export declare const SelectItem: React.ForwardRefExoticComponent<
  Omit<SelectPrimitive.SelectItemProps & React.RefAttributes<HTMLDivElement>, 'ref'> &
    React.RefAttributes<HTMLDivElement>
>;
export declare const Slider: React.ForwardRefExoticComponent<
  Omit<SliderPrimitive.SliderProps & React.RefAttributes<HTMLSpanElement>, 'ref'> &
    React.RefAttributes<HTMLSpanElement>
>;
export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  icon?: React.ComponentType<{
    className?: string;
  }>;
}
export interface UiSegmentedControlProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  size?: 'sm' | 'md';
  className?: string;
  'aria-label'?: string;
}
/** 分段控件：选项间切换，不含桌面拖拽区语义。 */
export declare function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size,
  className,
  ...aria
}: UiSegmentedControlProps<T>): React.JSX.Element;
export type UiBadgeVariant = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'outline';
export interface UiBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: UiBadgeVariant;
}
/** 紧凑状态/标签 chip，与 StatusBadge（纯色状态字）分工。 */
export declare const Badge: React.ForwardRefExoticComponent<
  UiBadgeProps & React.RefAttributes<HTMLSpanElement>
>;
export declare const ScrollArea: React.ForwardRefExoticComponent<
  Omit<ScrollAreaPrimitive.ScrollAreaProps & React.RefAttributes<HTMLDivElement>, 'ref'> & {
    viewportClassName?: string;
  } & React.RefAttributes<HTMLDivElement>
>;
export declare function Kbd({
  className,
  ...props
}: React.HTMLAttributes<HTMLElement>): React.JSX.Element;
export declare function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element;
export interface UiSpinnerProps {
  className?: string;
  /** 直径 px，默认 16 */
  size?: number;
}
export declare function Spinner({ className, size }: UiSpinnerProps): React.JSX.Element;
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
  /** Системный share (navigator.share); передавайте только там, где он доступен. */
  onShare?: () => void | Promise<void>;
  onReveal?: () => void | Promise<void>;
  onCopyImage?: () => void | Promise<void>;
  onCopyPrompt?: () => void | Promise<void>;
}
/** 全屏图像预览。文件 IO / toast 由宿主回调注入，本组件不碰平台 API。 */
export declare function ImageLightbox({
  src,
  onClose,
  onPrevious,
  onNext,
  hasPrevious,
  hasNext,
  prompt,
  onSave,
  onShare,
  onReveal,
  onCopyImage,
  onCopyPrompt,
}: UiImageLightboxProps): React.JSX.Element;
//# sourceMappingURL=extended-primitives.d.ts.map
