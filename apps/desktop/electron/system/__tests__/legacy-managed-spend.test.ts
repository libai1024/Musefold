import { describe, expect, it } from 'vitest';
import { LegacyManagedSpendBarrier } from '../legacy-managed-spend';

describe('legacy managed admission during explicit enablement', () => {
  it('requires every reservation to settle and makes release idempotent', async () => {
    const barrier = new LegacyManagedSpendBarrier();
    const first = barrier.reserve();
    const second = barrier.reserve();
    first();
    first();
    let enabled = false;
    const enable = async () => {
      enabled = true;
    };
    await expect(barrier.whileIdle(enable)).rejects.toMatchObject({
      code: 'MANAGED_LEGACY_SPEND_UNRESOLVED',
    });
    expect(enabled).toBe(false);
    second();
    await barrier.whileIdle(enable);
    expect(enabled).toBe(true);
  });

  it('excludes concurrent enablement and new legacy reservations until success', async () => {
    const barrier = new LegacyManagedSpendBarrier();
    let release = () => {};
    const pending = barrier.whileIdle(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    expect(() => barrier.reserve()).toThrow('MANAGED_LEGACY_ADMISSION_CLOSED');
    await expect(barrier.whileIdle(async () => {})).rejects.toThrow('MANAGED_ENABLEMENT_BUSY');
    barrier.retire();
    release();
    await pending;
    expect(() => barrier.reserve()).toThrow('MANAGED_LEGACY_ADMISSION_CLOSED');
  });

  it('allows old work again after a pre-commit enablement failure', async () => {
    const barrier = new LegacyManagedSpendBarrier();
    await expect(
      barrier.whileIdle(async () => {
        throw new Error('preflight');
      }),
    ).rejects.toThrow('preflight');
    expect(() => barrier.reserve()()).not.toThrow();
  });
});
