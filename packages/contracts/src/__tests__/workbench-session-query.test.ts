import { describe, expect, it } from 'vitest';
import {
  getWorkbenchSessionFilter,
  workbenchSessionCursorSchema,
  workbenchSessionListQuerySchema,
} from '../workbench';

describe('Session query and cursor contracts', () => {
  it.each([
    [{}, 'active'],
    [{ includeArchived: true }, 'live'],
    [{ includeDeleted: true }, 'unarchived'],
    [{ includeArchived: true, includeDeleted: true }, 'all'],
    [{ archivedOnly: true, includeDeleted: true }, 'archived'],
    [{ deletedOnly: true, archivedOnly: true }, 'trash'],
    [{ deletedOnly: 'true', includeArchived: 'false' }, 'trash'],
    [{ deletedOnly: 'false', archivedOnly: 'true' }, 'archived'],
  ])('normalizes effective visibility %j', (input, expected) => {
    expect(getWorkbenchSessionFilter(workbenchSessionListQuerySchema.parse(input))).toBe(expected);
  });

  const valid = {
    version: 1,
    store: 'postgres',
    filter: 'active',
    id: '会话',
    updatedAt: '2026-09-13T04:00:00.123456Z',
  };
  it('retains all PG timestamp digits and permits zero-padded SQLite precision', () => {
    expect(workbenchSessionCursorSchema.parse(valid)).toEqual(valid);
    const sqlite = { ...valid, store: 'sqlite', updatedAt: '2026-09-13T04:00:00.123000Z' };
    expect(workbenchSessionCursorSchema.parse(sqlite)).toEqual(sqlite);
  });
  it.each([
    { version: 0 },
    { version: 2 },
    { store: 'other' },
    { filter: 'other' },
    { id: '\0' },
    { id: '' },
    { extra: true },
    { updatedAt: '2026-09-13T04:00:00.123Z' },
    { updatedAt: '2026-02-30T04:00:00.123456Z' },
    { updatedAt: '0000-01-01T00:00:00.000000Z' },
  ])('rejects malformed boundary fields %j', (patch) => {
    expect(workbenchSessionCursorSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
  it.each(['yes', '0', 1, null])(
    'rejects ambiguous deletedOnly query values: %j',
    (deletedOnly) => {
      expect(workbenchSessionListQuerySchema.safeParse({ deletedOnly }).success).toBe(false);
    },
  );
});
