import { describe, expect, it } from 'vitest';
import { DEFAULT_ACCOUNT_SERVER_URL } from '@musefold/domain/constants';
import {
  AccountStore,
  type AccountStoreBackend,
  type AccountStoreShape,
} from '../account-store';

describe('AccountStore cost migration', () => {
  it('converts legacy managed quota price to user-visible points once', () => {
    const state: AccountStoreShape = {
      serverUrl: DEFAULT_ACCOUNT_SERVER_URL,
      session: {
        username: 'user',
        userId: 1,
        group: 'default',
        deviceTokenId: 1,
        deviceTokenName: 'device',
        deviceTokenSuffix: '1234',
        managedProviderId: 'provider',
        managedConnectionId: 'connection',
        quotaCache: { value: 1_000_000, at: 1 },
        health: 'ok',
        pricingVersion: 'legacy',
        imagePricePoints: 20_000,
        notices: [],
      },
    };
    const backend: AccountStoreBackend = {
      get: (key) => state[key],
      set: (key, value) => { state[key] = value as never; },
    };

    const store = new AccountStore(backend);
    expect(store.session?.imagePricePoints).toBe(0.4);
    expect(store.session?.imagePriceUnit).toBe('point');
    expect(store.session?.imagePricePoints).toBe(0.4);
  });
});
