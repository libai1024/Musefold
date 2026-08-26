import { describe, expect, it, vi } from 'vitest';
import type { AccountSession, RedeemResult } from '@musefold/contracts';

const account = {
  id: '42',
  username: 'musefold',
  displayName: null,
  quota: 9_000,
  quotaUnit: '点',
  canGenerate: true,
};
const session: AccountSession = {
  account,
  csrfToken: 'csrf-token-000000000000000000000000',
};
const redeemResult: RedeemResult = { account, creditedQuota: 1_000 };

const client = vi.hoisted(() => ({
  getSession: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
  redeem: vi.fn(),
  logout: vi.fn(),
}));

vi.mock('@musefold/cloud-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@musefold/cloud-client')>();
  return {
    ...original,
    createMusefoldCloudClient: vi.fn(() => client),
  };
});

import { FixtureWebGateway } from '../fixture-runtime';
import { createWebGateway } from '../runtime';

describe('Web account gateway boundary', () => {
  it('unwraps HTTP sessions before returning account data to the UI port', async () => {
    client.getSession.mockResolvedValue(session);
    client.login.mockResolvedValue(session);
    client.register.mockResolvedValue(session);
    client.redeem.mockResolvedValue(redeemResult);
    const gateway = createWebGateway();

    await expect(gateway.getAccount()).resolves.toEqual(account);
    await expect(gateway.login({ username: 'musefold', password: 'secret' })).resolves.toEqual(
      account,
    );
    await expect(
      gateway.register({ username: 'musefold', password: 'secret' }),
    ).resolves.toEqual(account);
    await expect(gateway.redeem('CODE')).resolves.toEqual(redeemResult);

    const serialized = JSON.stringify(await gateway.getAccount());
    expect(serialized).not.toContain('csrf');
    expect(serialized).not.toContain('sessionToken');
  });

  it('keeps the fixture implementation aligned with the shared account port', async () => {
    const gateway = new FixtureWebGateway();

    await expect(gateway.getAccount()).resolves.toMatchObject({ id: 'fixture-account' });
    await expect(
      gateway.register({ username: 'preview', password: 'secret' }),
    ).resolves.toMatchObject({ id: 'fixture-account' });
    await expect(gateway.redeem('CODE')).resolves.toMatchObject({
      account: { id: 'fixture-account' },
      creditedQuota: 0,
    });
  });
});
