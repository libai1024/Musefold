import { createHash } from 'node:crypto';
import {
  designSchemeListCursorPayloadSchema,
  designSchemeListCursorScope,
  type ParsedDesignSchemeListQuery,
} from '@musefold/contracts';
import { AppError } from '../../lib/errors.js';

const scope = (query: ParsedDesignSchemeListQuery) =>
  createHash('sha256').update(designSchemeListCursorScope(query)).digest('hex');

export function encodeSchemeListCursor(
  query: ParsedDesignSchemeListQuery,
  updatedAt: string,
  id: string,
): string {
  return Buffer.from(
    JSON.stringify(
      designSchemeListCursorPayloadSchema.parse({
        version: 1,
        scope: scope(query),
        updatedAt,
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
    if (
      value.scope !== scope(query) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value.updatedAt)
    )
      throw new Error('Cursor scope/precision mismatch');
    return value;
  } catch {
    throw new AppError('VALIDATION_FAILED', '方案列表已变化，请刷新后重试', 400);
  }
}
