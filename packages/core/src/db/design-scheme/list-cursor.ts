import { createHash } from 'node:crypto';
import {
  designSchemeListCursorPayloadSchema,
  designSchemeListCursorScope,
  type ParsedDesignSchemeListQuery,
} from '@musefold/contracts';

export class DesignSchemeListCursorError extends Error {
  constructor() {
    super('方案列表已变化，请刷新后重试');
    this.name = 'DesignSchemeListCursorError';
  }
}
const scope = (query: ParsedDesignSchemeListQuery) =>
  createHash('sha256').update(designSchemeListCursorScope(query)).digest('hex');

export function encodeSchemeListCursor(
  query: ParsedDesignSchemeListQuery,
  updatedAt: number,
  id: string,
): string {
  return Buffer.from(
    JSON.stringify(
      designSchemeListCursorPayloadSchema.parse({
        version: 1,
        scope: scope(query),
        updatedAt: new Date(updatedAt).toISOString(),
        id,
      }),
    ),
  ).toString('base64url');
}

export function decodeSchemeListCursor(query: ParsedDesignSchemeListQuery) {
  if (!query.cursor) return null;
  try {
    const buffer = Buffer.from(query.cursor, 'base64url');
    if (buffer.toString('base64url') !== query.cursor) throw new Error('Noncanonical cursor');
    const value = designSchemeListCursorPayloadSchema.parse(JSON.parse(buffer.toString('utf8')));
    const updatedAt = Date.parse(value.updatedAt);
    if (value.scope !== scope(query) || new Date(updatedAt).toISOString() !== value.updatedAt)
      throw new Error('Cursor scope/precision mismatch');
    return { updatedAt, id: value.id };
  } catch {
    throw new DesignSchemeListCursorError();
  }
}
