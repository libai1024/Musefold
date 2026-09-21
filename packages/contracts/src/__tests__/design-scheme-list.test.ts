import { describe, expect, it } from 'vitest';
import { designSchemeListQuerySchema } from '../design-scheme';

describe('scheme trash list query', () => {
  it.each([true, 'true'])('accepts an explicit trash scope: %s', (deletedOnly) => {
    expect(designSchemeListQuerySchema.parse({ deletedOnly })).toMatchObject({
      deletedOnly: true,
      limit: 20,
    });
  });
  it.each([false, 'false'])('does not coerce false into the trash scope: %s', (deletedOnly) => {
    expect(designSchemeListQuerySchema.parse({ deletedOnly })).toMatchObject({
      deletedOnly: false,
    });
  });
  it.each([1, 0, '1', 'yes', null, []])('rejects ambiguous scope: %s', (deletedOnly) => {
    expect(designSchemeListQuerySchema.safeParse({ deletedOnly }).success).toBe(false);
  });
  it('keeps the active library as the default and rejects unknown fields', () => {
    expect(designSchemeListQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(designSchemeListQuerySchema.safeParse({ includeDeleted: true }).success).toBe(false);
  });
});
