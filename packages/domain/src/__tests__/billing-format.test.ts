import { describe, expect, it } from 'vitest';
import { formatAccountPoints, formatPoints, quotaToPoints } from '../billing-format';
import { ACCOUNT_QUOTA_PER_POINT } from '@musefold/contracts/billing.js';

describe('formatAccountPoints', () => {
  it('uses the Desktop quota conversion and keeps two decimal places at most', () => {
    expect(formatAccountPoints(41_598_736)).toBe('831.97');
    expect(formatAccountPoints(9_300_000)).toBe('186');
  });

  it('is the same function as formatPoints', () => {
    expect(formatPoints(41_598_736)).toBe(formatAccountPoints(41_598_736));
    expect(formatPoints(9_300_000)).toBe(formatAccountPoints(9_300_000));
  });
});

describe('quotaToPoints', () => {
  it('divides by ACCOUNT_QUOTA_PER_POINT', () => {
    expect(quotaToPoints(ACCOUNT_QUOTA_PER_POINT)).toBe(1);
    expect(quotaToPoints(9_300_000)).toBe(9_300_000 / ACCOUNT_QUOTA_PER_POINT);
  });
});
