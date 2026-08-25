import type { MusefoldMarkProps } from "@musefold/ui";
import { MusefoldMark } from "@musefold/ui";

export type WorkbenchBrandProps = MusefoldMarkProps;

/** Shared empty-workbench mark kept as the host-neutral brand entry point. */
export function WorkbenchBrand({ className, ...props }: WorkbenchBrandProps) {
  return (
    <MusefoldMark
      {...props}
      className={["mf-workbench-brand-image", className]
        .filter(Boolean)
        .join(" ")}
      data-testid="workbench-brand"
    />
  );
}
