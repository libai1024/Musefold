import { describe, expect, it } from 'vitest';
import { accountSessionSchema } from '@musefold/contracts';
import type { AccountStatus } from '@musefold/desktop-contracts/account';
import {
  DESKTOP_PLACEHOLDER_CSRF_TOKEN,
  accountStatusToSession,
} from '../mappers/account';

const loggedIn: AccountStatus = {
  loggedIn: true,
  username: 'alice',
  serverUrl: 'https://api.example',
  isDefaultServer: false,
  quota: { value: 500_000, at: 1 },
  estImagesRemaining: 12,
  deviceTokenSuffix: 'ab12',
  health: 'ok',
  notices: [],
};

describe('account status → session mapping', () => {
  it('maps a logged-in device status into AccountSession with placeholder csrf', () => {
    const session = accountStatusToSession(loggedIn);
    expect(session).not.toBeNull();
    expect(accountSessionSchema.parse(session)).toEqual({
      account: {
        id: 'alice',
        username: 'alice',
        displayName: null,
        quota: 500_000,
        quotaUnit: '点',
        canGenerate: true,
      },
      csrfToken: DESKTOP_PLACEHOLDER_CSRF_TOKEN,
    });
    expect(DESKTOP_PLACEHOLDER_CSRF_TOKEN.length).toBeGreaterThanOrEqual(32);
  });

  it('returns null when logged out or username is missing', () => {
    expect(
      accountStatusToSession({ ...loggedIn, loggedIn: false, username: null, health: 'unknown' }),
    ).toBeNull();
    expect(accountStatusToSession({ ...loggedIn, username: null })).toBeNull();
  });

  it('disables canGenerate when health is not ok', () => {
    const session = accountStatusToSession({ ...loggedIn, health: 'token-invalid' });
    expect(session?.account.canGenerate).toBe(false);
    expect(session?.account.quota).toBe(500_000);
  });
});
