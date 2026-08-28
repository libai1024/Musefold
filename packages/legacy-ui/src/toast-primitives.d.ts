import * as React from 'react';
import * as ToastPrimitive from '@radix-ui/react-toast';
export declare const ToastProvider: React.FC<ToastPrimitive.ToastProviderProps>;
export declare const ToastViewport: React.ForwardRefExoticComponent<
  Omit<ToastPrimitive.ToastViewportProps & React.RefAttributes<HTMLOListElement>, 'ref'> &
    React.RefAttributes<HTMLOListElement>
>;
export type UiToastVariant = 'default' | 'success' | 'danger' | 'warning' | 'accent';
export interface UiToastProps extends React.ComponentPropsWithoutRef<typeof ToastPrimitive.Root> {
  variant?: UiToastVariant;
}
export declare const Toast: React.ForwardRefExoticComponent<
  UiToastProps & React.RefAttributes<HTMLLIElement>
>;
export declare const ToastIcon: React.ForwardRefExoticComponent<
  React.HTMLAttributes<HTMLSpanElement> & React.RefAttributes<HTMLSpanElement>
>;
export declare const ToastBody: React.ForwardRefExoticComponent<
  React.HTMLAttributes<HTMLDivElement> & React.RefAttributes<HTMLDivElement>
>;
export declare const ToastTitle: React.ForwardRefExoticComponent<
  Omit<ToastPrimitive.ToastTitleProps & React.RefAttributes<HTMLDivElement>, 'ref'> &
    React.RefAttributes<HTMLDivElement>
>;
export declare const ToastDescription: React.ForwardRefExoticComponent<
  Omit<ToastPrimitive.ToastDescriptionProps & React.RefAttributes<HTMLDivElement>, 'ref'> &
    React.RefAttributes<HTMLDivElement>
>;
export declare const ToastClose: React.ForwardRefExoticComponent<
  Omit<ToastPrimitive.ToastCloseProps & React.RefAttributes<HTMLButtonElement>, 'ref'> &
    React.RefAttributes<HTMLButtonElement>
>;
export declare const ToastAction: React.ForwardRefExoticComponent<
  React.ButtonHTMLAttributes<HTMLButtonElement> & React.RefAttributes<HTMLButtonElement>
>;
//# sourceMappingURL=toast-primitives.d.ts.map
