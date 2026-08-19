export function getSafeOAuthReturnTo(
  value: string | null,
  currentOrigin: string,
): string | null {
  if (!value) return null;
  try {
    const target = new URL(value, currentOrigin);
    if (target.origin !== currentOrigin) return null;
    if (!target.pathname.startsWith("/api/musefold/v1/oauth/interaction/")) {
      return null;
    }
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return null;
  }
}
