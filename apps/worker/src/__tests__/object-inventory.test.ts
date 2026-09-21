import { describe, expect, it } from 'vitest';
import {
  inventoryScopeId,
  inventoryScanRequestSchema,
  isManagedInventoryKey,
} from '../object-inventory.js';
const id = '08adfc2a-e2bf-490b-8a33-758e61e97812';
describe('inventory scope is limited to keys emitted by managed writers', () => {
  it('accepts the six managed key shapes and rejects traversal, unknown and ambiguous shapes', () => {
    for (const key of [
      `users/owned/generations/${id}/${id}`,
      `users/owned/references/${id}`,
      `users/owned/design-scheme-uploads/${id}`,
      `scheme-sources/${'a'.repeat(64)}/${id}/${id}`,
      `scheme-packages/${'a'.repeat(64)}/${id}`,
      `scheme-imports/${id}/${id}/${'b'.repeat(64)}`,
      `scheme-exports/${id}`,
    ])
      expect(isManagedInventoryKey(key)).toBe(true);
    for (const key of [
      `users/../references/${id}`,
      `users/owned/references/${id}/extra`,
      `users/owned/arbitrary/${id}`,
      `elsewhere/${id}`,
      `scheme-exports/${id}?token=secret`,
      `users/owned%2fextra/references/${id}`,
      'users/owned/references/not-an-id',
    ]) {
      expect(isManagedInventoryKey(key)).toBe(false);
    }
  });
  it('separates storage scopes and rejects unrecognized maintenance requests', () => {
    expect(inventoryScopeId('bucket', 'owned-endpoint')).toMatch(/^[0-9a-f]{64}$/);
    expect(inventoryScopeId('bucket', 'other-endpoint')).not.toBe(
      inventoryScopeId('bucket', 'owned-endpoint'),
    );
    expect(inventoryScopeId('other-bucket', 'owned-endpoint')).not.toBe(
      inventoryScopeId('bucket', 'owned-endpoint'),
    );
    expect(inventoryScanRequestSchema.parse({})).toEqual({ mode: 'record' });
    expect(inventoryScanRequestSchema.safeParse({ mode: 'delete-everything' }).success).toBe(false);
    expect(inventoryScanRequestSchema.safeParse({ mode: 'dry-run', prefix: '' }).success).toBe(
      false,
    );
  });
  it('accepts Graphile cron metadata while rejecting malformed or expanded scheduling payloads', () => {
    for (const backfilled of [false, true]) {
      const _cron = { ts: '2026-09-13T17:50:00.000Z', backfilled };
      expect(inventoryScanRequestSchema.parse({ _cron })).toEqual({ mode: 'record', _cron });
      expect(inventoryScanRequestSchema.parse({ mode: 'dry-run', _cron }).mode).toBe('dry-run');
    }
    for (const _cron of [
      { ts: 'invalid', backfilled: false },
      { ts: '2026-09-13T17:50:00.000Z', backfilled: 'false' },
      { ts: '2026-09-13T17:50:00.000Z', backfilled: false, prefix: '' },
    ])
      expect(inventoryScanRequestSchema.safeParse({ _cron }).success).toBe(false);
  });
});
