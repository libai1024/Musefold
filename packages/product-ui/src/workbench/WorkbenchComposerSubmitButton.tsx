import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Button } from "@musefold/ui";

export interface WorkbenchComposerSubmitButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  active?: boolean;
  activeLabel?: string;
  idleLabel?: string;
  activeIcon?: ReactNode;
  idleIcon?: ReactNode;
}

/** Shared generation action for the Desktop and Web composers. */
export function WorkbenchComposerSubmitButton({
  active = false,
  activeLabel = "停止生成",
  idleLabel = "生成图片",
  activeIcon,
  idleIcon,
  className,
  ...buttonProps
}: WorkbenchComposerSubmitButtonProps) {
  const label = active ? activeLabel : idleLabel;
  return (
    <Button
      {...buttonProps}
      variant="primary"
      className={[
        "mf-workbench-submit-button",
        active ? "is-active" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={buttonProps["aria-label"] ?? label}
      title={buttonProps.title ?? label}
      data-active={active ? "true" : "false"}
      icon={active ? activeIcon : idleIcon}
    >
      <span className="mf-workbench-submit-label">{label}</span>
    </Button>
  );
}
