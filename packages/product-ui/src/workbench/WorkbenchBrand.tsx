import type { ImgHTMLAttributes } from "react";

export interface WorkbenchBrandProps extends Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "className"
> {
  className?: string;
}

/** Shared empty-workbench brand rendering used by Desktop and Web. */
export function WorkbenchBrand({ className, ...props }: WorkbenchBrandProps) {
  return (
    <img
      {...props}
      className={["mf-workbench-brand-image", className]
        .filter(Boolean)
        .join(" ")}
      data-testid="workbench-brand"
    />
  );
}
