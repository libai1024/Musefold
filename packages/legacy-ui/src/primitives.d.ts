import { type ButtonHTMLAttributes, type ReactNode } from 'react';
export type UiButtonVariant =
  | 'default'
  | 'primary'
  | 'secondary'
  | 'subtle'
  | 'outline'
  | 'danger'
  | 'ghost';
export type UiButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'icon' | 'iconSm' | 'iconXs';
export type UiIconButtonSize = 'xs' | 'sm' | 'md';
export type UiStatusTone = 'neutral' | 'progress' | 'success' | 'warning' | 'danger' | 'info';
export interface UiButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  children?: ReactNode;
  icon?: ReactNode;
  variant?: UiButtonVariant;
  size?: UiButtonSize;
  busy?: boolean;
  busyLabel?: ReactNode;
  asChild?: boolean;
  /** Keeps the shared button semantics while letting a product surface own geometry. */
  unstyled?: boolean;
}
/** Shared action button used by platform-neutral product views. */
export declare const Button: import('react').ForwardRefExoticComponent<
  UiButtonProps & import('react').RefAttributes<HTMLButtonElement>
>;
export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  label: string;
  children: ReactNode;
  size?: UiIconButtonSize;
}
/** Icon-only control with a required accessible name and native tooltip. */
export declare const IconButton: import('react').ForwardRefExoticComponent<
  IconButtonProps & import('react').RefAttributes<HTMLButtonElement>
>;
export interface UiSwitchProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'onChange'> {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
}
/** Shared binary switch with stable geometry and native button semantics. */
export declare const Switch: import('react').ForwardRefExoticComponent<
  UiSwitchProps & import('react').RefAttributes<HTMLButtonElement>
>;
export interface StatusBadgeProps {
  children: ReactNode;
  tone?: UiStatusTone;
  icon?: ReactNode;
  className?: string;
  'data-testid'?: string;
}
/** Shared status label; tone carries meaning without platform-specific markup. */
export declare function StatusBadge({
  children,
  tone,
  icon,
  className,
  'data-testid': testId,
}: StatusBadgeProps): import('react').JSX.Element;
//# sourceMappingURL=primitives.d.ts.map
