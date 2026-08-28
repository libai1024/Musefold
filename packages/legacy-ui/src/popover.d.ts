import * as React from 'react';
export interface UiPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}
export declare function Popover({
  open,
  onOpenChange,
  children,
}: UiPopoverProps): React.JSX.Element;
export interface UiPopoverTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
}
export declare const PopoverTrigger: React.ForwardRefExoticComponent<
  UiPopoverTriggerProps & React.RefAttributes<HTMLButtonElement>
>;
export interface UiPopoverContentProps extends React.HTMLAttributes<HTMLDivElement> {
  portal?: boolean;
}
export declare const PopoverContent: React.ForwardRefExoticComponent<
  UiPopoverContentProps & React.RefAttributes<HTMLDivElement>
>;
//# sourceMappingURL=popover.d.ts.map
