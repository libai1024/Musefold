import type { CSSProperties, ReactNode } from "react";

export interface WorkbenchResultGridProps {
  count: number;
  aspectRatio: string;
  children: ReactNode;
  className?: string;
  testId?: string;
  provider?: string;
}

/** Shared result grid geometry: 1, 2, 2x2, then 3-column batches. */
export function WorkbenchResultGrid({
  count,
  aspectRatio,
  children,
  className,
  testId = "refine-results",
  provider,
}: WorkbenchResultGridProps) {
  const safeCount = Math.max(1, count);
  const style: CSSProperties = { maxWidth: resultGridMaxWidth(safeCount, aspectRatio) };
  return (
    <div
      className={["mf-workbench-result-grid", className]
        .filter(Boolean)
        .join(" ")}
      style={style}
      data-testid={testId}
      data-count={safeCount}
      data-workbench-results="true"
      data-provider={provider}
    >
      {children}
    </div>
  );
}

function resultGridMaxWidth(count: number, ratioId: string): string {
  const ratio = ratioValue(ratioId);
  if (count <= 1)
    return `min(100%, 480px, ${Math.round(46 * ratio * 10) / 10}dvh)`;
  if (count === 2)
    return `min(100%, 458px, calc(${Math.round(33 * ratio * 2 * 10) / 10}dvh + 10px))`;
  if (count <= 4) return `${Math.round(Math.min(210, 205 * ratio) * 2 + 10)}px`;
  return `${Math.round(Math.min(180, 180 * ratio) * 3 + 20)}px`;
}

function ratioValue(ratioId: string): number {
  const [width, height] = ratioId.split(":").map(Number);
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return 1;
  }
  return width / height;
}

