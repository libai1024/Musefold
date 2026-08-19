import type { ReactNode } from "react";

export interface ProductPageHeaderProps {
  title: string;
  count?: number;
  afterTitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
  testId?: string;
}

/** Shared page-level heading used by the desktop and web product surfaces. */
export function ProductPageHeader({
  title,
  count,
  afterTitle,
  actions,
  className,
  testId,
}: ProductPageHeaderProps) {
  return (
    <header
      className={`mf-page-heading${className ? ` ${className}` : ""}`}
      data-testid={testId}
    >
      <div className="mf-page-heading-title">
        <h1>{title}</h1>
        {typeof count === "number" ? <span>{count}</span> : null}
      </div>
      {afterTitle}
      {actions ? <div className="mf-page-actions">{actions}</div> : null}
    </header>
  );
}
