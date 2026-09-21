import { describe, expect, it } from 'vitest';
import { promptListQuerySchema } from '../prompt';

describe('prompt trash query contract', () => {
  it.each([
    [true, true],
    [false, false],
    ['true', true],
    ['false', false],
  ])('parses deletedOnly=%s without boolean coercion', (wire, expected) => {
    expect(promptListQuerySchema.parse({ deletedOnly: wire })).toMatchObject({
      deletedOnly: expected,
    });
  });
  it('keeps includeDeleted and deletedOnly independent so hosts can apply deletedOnly precedence', () => {
    expect(
      promptListQuerySchema.parse({ includeDeleted: 'true', deletedOnly: 'true' }),
    ).toMatchObject({ includeDeleted: true, deletedOnly: true });
    expect(promptListQuerySchema.parse({})).toMatchObject({ includeDeleted: false });
  });
  it.each(['yes', '0', 1, null])('rejects invalid deletedOnly=%s', (deletedOnly) => {
    expect(promptListQuerySchema.safeParse({ deletedOnly }).success).toBe(false);
  });
});
