// epoch 毫秒 ↔ contracts ISO-8601（带偏移）。往返保持同一整数毫秒。

export function epochMsToIso(ms: number): string {
  return new Date(ms).toISOString().replace(/Z$/, '+00:00');
}

export function epochMsToIsoOrNull(ms: number | null | undefined): string | null {
  return ms == null ? null : epochMsToIso(ms);
}

export function isoToEpochMs(iso: string): number {
  return Date.parse(iso);
}

export function isoToEpochMsOrNull(iso: string | null | undefined): number | null {
  return iso == null || iso === '' ? null : isoToEpochMs(iso);
}

export function parseOffsetCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const offset = Number.parseInt(cursor, 10);
  return Number.isFinite(offset) && offset >= 0 ? offset : 0;
}

export function resolvePageLimit(
  limit: unknown,
  fallback = 20,
  max = 100,
): number {
  const value = typeof limit === 'number' ? limit : Number(limit);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), 1), max);
}

export function nextOffsetCursor(
  offset: number,
  limit: number,
  pageCount: number,
  total?: number,
): string | null {
  const next = offset + pageCount;
  if (total != null) return next < total ? String(next) : null;
  return pageCount < limit ? null : String(next);
}
