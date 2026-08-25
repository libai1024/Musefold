export function WorkbenchPromptFullTextCard({
  title,
  text,
  scope,
  anchor,
}: {
  title: string;
  text: string;
  scope?: "full" | "excerpt";
  anchor: DOMRect;
}) {
  const width = 320;
  const left = Math.max(
    8,
    Math.min(anchor.left, window.innerWidth - width - 8),
  );
  return (
    <span
      className="pointer-events-none fixed z-[90] block w-[320px] rounded-lg border border-border-default bg-popover p-3 text-left shadow-pop animate-scale-fade-in"
      style={{ left, bottom: window.innerHeight - anchor.top + 8 }}
      role="tooltip"
      data-testid="prompt-reference-preview"
    >
      <span className="block truncate text-[11px] font-medium text-tertiary">
        {title}
        {scope ? ` · ${scope === "full" ? "整条引用" : "选段引用"}` : ""}
      </span>
      <span className="mt-1.5 block max-h-[200px] overflow-hidden whitespace-pre-wrap text-[11px] leading-relaxed text-secondary">
        {text}
      </span>
    </span>
  );
}
