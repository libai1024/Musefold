import { describe, expect, it } from 'vitest';
import {
  consumeQuotaRecovery,
  peekQuotaRecovery,
  rememberQuotaRecovery,
  resetQuotaRecovery,
} from '../spend-recovery-store';

describe('spend-recovery-store', () => {
  it('remembers, peeks, then consumes once', () => {
    resetQuotaRecovery();
    const pending = { kind: 'retry-job' as const, jobId: 'job-1' };
    rememberQuotaRecovery(pending);
    expect(peekQuotaRecovery()).toEqual(pending);
    const owned = consumeQuotaRecovery();
    expect(owned?.intent).toEqual(pending);
    owned?.release();
    expect(peekQuotaRecovery()).toBeNull();
    expect(consumeQuotaRecovery()).toBeNull();
  });
});

it('transfers each resource hold independently even when the same intent object is selected again', () => {
  resetQuotaRecovery();
  const pending = { kind: 'retry-job' as const, jobId: 'original' };
  let oldReleased = 0;
  let newReleased = 0;
  rememberQuotaRecovery(pending, () => {
    oldReleased += 1;
  });
  const old = consumeQuotaRecovery(pending);
  rememberQuotaRecovery(pending, () => {
    newReleased += 1;
  });
  expect(oldReleased).toBe(0);
  resetQuotaRecovery();
  expect(newReleased).toBe(1);
  expect(oldReleased).toBe(0);
  old?.release();
  old?.release();
  expect(oldReleased).toBe(1);
  expect(newReleased).toBe(1);
});
