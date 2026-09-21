import {
  accountNoticeReadIdsSchema,
  type AccountNotices,
  type AccountSummary,
} from '@musefold/contracts';

const LEGACY_KEY = 'musefold:account-notices-read';
export function noticeReadKey(account: AccountSummary, notices: AccountNotices): string {
  return `musefold:account-notices-read:v25:${JSON.stringify([notices.apiIssuer, notices.issuer, account.identity?.principalId ?? account.id])}`;
}

export function readNoticeIds(key: string): string[] {
  const value = localStorage.getItem(key);
  if (!value) return [];
  if (value.length > 64 * 1024) throw new Error('无法读取此设备的公告已读记录');
  const parsed = accountNoticeReadIdsSchema.safeParse(JSON.parse(value));
  if (!parsed.success) throw new Error('无法读取此设备的公告已读记录');
  return parsed.data;
}

/** The legacy UI used device-wide content IDs. Import only these non-secret markers. */
export function readLegacyNoticeIds(): string[] {
  try {
    return readNoticeIds(LEGACY_KEY);
  } catch {
    return [];
  }
}

export function markNoticeIdsRead(key: string, visibleIds: string[]): string[] {
  // Re-read at the action boundary so another window's successful marks are not lost.
  const next = accountNoticeReadIdsSchema.parse(
    [...new Set([...readNoticeIds(key), ...visibleIds])].slice(-2000),
  );
  localStorage.setItem(key, JSON.stringify(next));
  return next;
}
