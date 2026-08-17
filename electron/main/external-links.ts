const ALLOWED_EXTERNAL_HOSTS = new Set([
  'ai.tvt.wiki',
  'wkapi.vip',
  'wkapi.club',
]);

/**
 * Renderer-triggered links may only leave the app when they target a documented
 * provider host. Matching the parsed hostname also rejects lookalike/userinfo URLs.
 */
export function isAllowedExternalUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:'
      && !url.username
      && !url.password
      && ALLOWED_EXTERNAL_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

