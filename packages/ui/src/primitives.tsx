import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { Slot } from "@radix-ui/react-slot";

export type UiButtonVariant =
  | "default"
  | "primary"
  | "secondary"
  | "subtle"
  | "outline"
  | "danger"
  | "ghost";
export type UiButtonSize =
  | "xs"
  | "sm"
  | "md"
  | "lg"
  | "icon"
  | "iconSm"
  | "iconXs";
export type UiIconButtonSize = "xs" | "sm" | "md";
export type UiStatusTone =
  | "neutral"
  | "progress"
  | "success"
  | "warning"
  | "danger"
  | "info";

export interface UiButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
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

function mergeClassNames(...names: Array<string | undefined>) {
  return names.filter(Boolean).join(" ");
}

/** Shared action button used by platform-neutral product views. */
export const Button = forwardRef<HTMLButtonElement, UiButtonProps>(
  function Button(
    {
      children,
      icon,
      variant = "primary",
      size = "md",
      busy = false,
      busyLabel,
      asChild = false,
      unstyled = false,
      className,
      disabled,
      type = "button",
      ...props
    },
    ref,
  ) {
    const Component = asChild ? Slot : "button";
    return (
      <Component
        {...props}
        ref={ref}
        {...(asChild ? {} : { type })}
        className={mergeClassNames(
          "mf-ui-button",
          unstyled ? "mf-ui-button-unstyled" : `mf-ui-button-${variant}`,
          unstyled ? undefined : `mf-ui-button-${size}`,
          className,
        )}
        disabled={disabled || busy}
        aria-busy={busy || undefined}
      >
        {busy ? (
          <span className="mf-ui-button-spinner" aria-hidden="true" />
        ) : (
          icon
        )}
        {busy && busyLabel !== undefined ? busyLabel : children}
      </Component>
    );
  },
);

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  label: string;
  children: ReactNode;
  size?: UiIconButtonSize;
}

/** Icon-only control with a required accessible name and native tooltip. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    { label, children, className, title, size = "sm", ...props },
    ref,
  ) {
    return (
      <button
        {...props}
        ref={ref}
        type={props.type ?? "button"}
        className={mergeClassNames(
          "mf-ui-icon-button",
          `mf-ui-icon-button-${size}`,
          className,
        )}
        aria-label={label}
        title={title ?? label}
      >
        {children}
      </button>
    );
  },
);

export interface UiSwitchProps
  extends Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    "children" | "onChange"
  > {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

/** Shared binary switch with stable geometry and native button semantics. */
export const Switch = forwardRef<HTMLButtonElement, UiSwitchProps>(
  function Switch(
    { checked, onCheckedChange, className, disabled, onClick, ...props },
    ref,
  ) {
    return (
      <button
        {...props}
        ref={ref}
        type="button"
        role="switch"
        aria-checked={checked}
        data-state={checked ? "checked" : "unchecked"}
        data-checked={checked || undefined}
        disabled={disabled}
        className={mergeClassNames("mf-ui-switch", className)}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) onCheckedChange?.(!checked);
        }}
      >
        <span className="mf-ui-switch-thumb" aria-hidden="true" />
      </button>
    );
  },
);

export interface StatusBadgeProps {
  children: ReactNode;
  tone?: UiStatusTone;
  icon?: ReactNode;
  className?: string;
  "data-testid"?: string;
}

/** Shared status label; tone carries meaning without platform-specific markup. */
export function StatusBadge({
  children,
  tone = "neutral",
  icon,
  className,
  "data-testid": testId,
}: StatusBadgeProps) {
  return (
    <span
      className={mergeClassNames("mf-ui-status", `mf-ui-status-${tone}`, className)}
      data-testid={testId}
    >
      {icon}
      {children}
    </span>
  );
}
