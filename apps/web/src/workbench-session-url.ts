export function replaceWorkbenchSessionUrl(sessionId: string | null): void {
  const url = new URL(window.location.href);
  if (sessionId) url.searchParams.set('session', sessionId);
  else url.searchParams.delete('session');
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}
