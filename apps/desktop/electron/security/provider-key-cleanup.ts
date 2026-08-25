export function orphanedProviderKeyIds(
  storedKeys: Record<string, unknown> | null | undefined,
  validProviderIds: ReadonlySet<string>,
): string[] {
  if (!storedKeys) return [];
  return Object.keys(storedKeys).filter((providerId) => !validProviderIds.has(providerId));
}
