export function PromptSectionHeading({
  title,
  count,
}: {
  title: string;
  count: number;
}) {
  return (
    <div className="mf-section-heading">
      <h2>{title}</h2>
      <span>{count}</span>
    </div>
  );
}
