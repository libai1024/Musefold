import { isIP } from 'node:net';
import { loginSessionPageSchema, type LoginSessionPage } from '@musefold/contracts';
import type { RelaySessionPage } from '@musefold/contracts/relay-login-sessions';

/** User agents are untrusted labels, never an identity or deduplication key. */
export function projectLoginSessions(
  page: RelaySessionPage,
  encodeRef: (sid: string) => string,
): LoginSessionPage {
  const current = page.items.find((item) => item.current);
  return loginSessionPageSchema.parse({
    total: page.total,
    limit: page.limit,
    required: page.required,
    requiresReauthentication: !!current && Date.now() / 1000 - current.created_at > 300,
    items: page.items
      .map((item) => {
        const ua = item.user_agent;
        const platform = /Windows/i.test(ua)
          ? 'Windows'
          : /iPhone|iPad/i.test(ua)
            ? 'iOS'
            : /Android/i.test(ua)
              ? 'Android'
              : /Macintosh|Mac OS|macOS|darwin/i.test(ua)
                ? 'macOS'
                : /Linux/i.test(ua)
                  ? 'Linux'
                  : '未知系统';
        const client = /Musefold|Electron/i.test(ua)
          ? 'Musefold 桌面版'
          : /Edg\//.test(ua)
            ? 'Edge'
            : /Chrome\//.test(ua)
              ? 'Chrome'
              : /Firefox\//.test(ua)
                ? 'Firefox'
                : /Safari\//.test(ua)
                  ? 'Safari'
                  : '其他客户端';
        return {
          sessionRef: encodeRef(item.sid),
          version: item.version,
          current: item.current,
          platform,
          client,
          createdAt: new Date(item.created_at * 1000).toISOString(),
          lastInteractiveAt:
            item.last_interactive_at === null
              ? null
              : new Date(item.last_interactive_at * 1000).toISOString(),
          lastSeenAt: new Date(item.last_seen_at * 1000).toISOString(),
          expiresAt: new Date(item.expires_at * 1000).toISOString(),
          maskedIp:
            isIP(item.ip) === 4
              ? `${item.ip.split('.').slice(0, 2).join('.')}.*.*`
              : isIP(item.ip) === 6
                ? `${item.ip.split(':').slice(0, 2).join(':')}:…`
                : '未知',
        };
      })
      .sort((a, b) => Number(b.current) - Number(a.current)),
  });
}
