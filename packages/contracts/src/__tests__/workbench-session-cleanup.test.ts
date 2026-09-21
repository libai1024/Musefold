import { describe, expect, it } from 'vitest';
import { workbenchSessionCleanupResultSchema } from '../workbench';

describe('Session cleanup count contract', () => {
  it.each([0, 1, 501])(
    'represents %i actual purged rows, including an empty or multi-page trash',
    (purged) => {
      expect(workbenchSessionCleanupResultSchema.parse({ purged })).toEqual({ purged });
    },
  );
  it.each([-1, 0.5, '1', null])('rejects invalid count %s', (purged) => {
    expect(workbenchSessionCleanupResultSchema.safeParse({ purged }).success).toBe(false);
  });
});
