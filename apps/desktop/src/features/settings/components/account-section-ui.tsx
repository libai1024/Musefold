import type { ReactNode } from "react";
import { cn } from "../../../lib/utils";

export function Field({
  label,
  htmlFor,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label htmlFor={htmlFor} className={cn("block", className)}>
      <span className="mb-1.5 block text-[11px] font-medium text-secondary">
        {label}
      </span>
      {children}
    </label>
  );
}

export function InlineMessage({
  tone,
  children,
}: {
  tone: "danger" | "warning" | "success";
  children: ReactNode;
}) {
  return (
    <p
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "mt-3 border-l pl-3 text-[11px] leading-relaxed",
        tone === "danger" && "border-danger text-danger",
        tone === "warning" && "border-warning text-warning",
        tone === "success" && "border-success text-success",
      )}
    >
      {children}
    </p>
  );
}
