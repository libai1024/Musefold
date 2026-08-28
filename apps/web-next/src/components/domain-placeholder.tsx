export function DomainPlaceholder({ domain }: { domain: string }) {
  return (
    <div className="flex h-full min-h-[50dvh] flex-col items-center justify-center gap-2 p-6 text-center">
      <p className="font-medium text-foreground text-sm">{domain}</p>
      <p className="text-muted-foreground text-sm">v2.5 迁移中,此域将在后续批次接入</p>
    </div>
  );
}
