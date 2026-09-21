import { expect, it } from 'vitest';
import {
  designSchemeAgentHistoryQuerySchema,
  designSchemeAgentHistoryPageSchema,
} from '../design-scheme-agent-history';

const record = {
  executionId: 'execution-1',
  operation: 'create',
  status: 'completed',
  version: 4,
  createdAt: '2026-09-09T00:00:00.000Z',
  expiresAt: '2026-09-09T01:00:00.000Z',
  schemeId: 'scheme-1',
  schemeName: '方案',
};
it('accepts compact discovery without private input, complete document, or spend authority', () => {
  const page = { items: [record], nextCursor: null };
  expect(designSchemeAgentHistoryPageSchema.parse(page)).toEqual(page);
  expect(designSchemeAgentHistoryQuerySchema.parse({})).toEqual({ limit: 20 });
  expect(designSchemeAgentHistoryQuerySchema.parse({ limit: '50', cursor: 'execution-1' })).toEqual(
    { limit: 50, cursor: 'execution-1' },
  );
});
it.each([
  'request',
  'materials',
  'view',
  'pendingSource',
  'text',
  'result',
  'authSessionId',
  'authorityHash',
])('rejects private or unbounded history field %s', (key) => {
  expect(
    designSchemeAgentHistoryPageSchema.safeParse({
      items: [{ ...record, [key]: {} }],
      nextCursor: null,
    }).success,
  ).toBe(false);
});
it.each([
  { limit: 0 },
  { limit: 51 },
  { cursor: '../foreign' },
  { userId: 'other' },
  { afterSeq: 1 },
])('rejects invalid or non-history query %j', (query) => {
  expect(designSchemeAgentHistoryQuerySchema.safeParse(query).success).toBe(false);
});
it('allows a cancel-before-start tombstone and a removed result without granting resume permission', () => {
  expect(
    designSchemeAgentHistoryPageSchema.parse({
      items: [
        { ...record, operation: 'modify', status: 'cancelled', schemeId: null, schemeName: null },
      ],
      nextCursor: null,
    }).items[0].status,
  ).toBe('cancelled');
  expect(
    designSchemeAgentHistoryPageSchema.safeParse({
      items: [{ ...record, canResume: true }],
      nextCursor: null,
    }).success,
  ).toBe(false);
});
