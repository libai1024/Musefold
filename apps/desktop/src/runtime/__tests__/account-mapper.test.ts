import { describe, expect, it } from 'vitest';
import { accountSummarySchema } from '@musefold/contracts';
import type { AccountStatus } from '@musefold/desktop-contracts/account';
import { accountStatusToSummary } from '../mappers/account';

const loggedIn: AccountStatus = {
  loggedIn: true,
  userId: '42',
  username: 'alice',
  serverUrl: 'https://api.example',
  isDefaultServer: false,
  quota: { value: 500_000, at: 1 },
  estImagesRemaining: 12,
  deviceTokenSuffix: 'ab12',
  health: 'ok',
  notices: [],
};

describe('account status -> summary mapping', () => {
  it('maps the stable account id without creating transport credentials', () => {
    const account = accountStatusToSummary(loggedIn);
    expect(accountSummarySchema.parse(account)).toEqual({
      id: '42',
      username: 'alice',
      displayName: null,
      quota: 500_000,
      quotaUnit: '点',
      canGenerate: true,
    });
    expect(account).not.toHaveProperty('csrfToken');
    expect(account).not.toHaveProperty('sessionToken');
  });

  it('returns null when logged out or identity fields are missing', () => {
    expect(
      accountStatusToSummary({
        ...loggedIn,
        loggedIn: false,
        userId: null,
        username: null,
        health: 'unknown',
      }),
    ).toBeNull();
    expect(accountStatusToSummary({ ...loggedIn, userId: null })).toBeNull();
    expect(accountStatusToSummary({ ...loggedIn, username: null })).toBeNull();
  });

  it('disables canGenerate when health is not ok', () => {
    const account = accountStatusToSummary({ ...loggedIn, health: 'token-invalid' });
    expect(account?.canGenerate).toBe(false);
    expect(account?.quota).toBe(500_000);
  });
});
