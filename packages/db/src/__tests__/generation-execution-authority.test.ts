import type { ExecutionBinding } from '@musefold/contracts';
import { type SQL, getTableName } from 'drizzle-orm';
import { PgDialect, type PgTable } from 'drizzle-orm/pg-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MusefoldTransaction } from '../client.js';
import {
  ExecutionAuthorityError,
  executionBindingsEqual,
  lockGenerationExecutionAuthority,
} from '../generation-execution-authority.js';

const NOW = new Date('2026-09-08T00:00:00Z');
const input = {
  principalId: 'principal-a',
  apiIssuer: 'https://api.example.invalid',
  upstreamIssuer: 'https://images.example.invalid',
  authSessionId: 'auth-session-a',
  now: NOW,
};
const binding: ExecutionBinding = {
  apiIssuer: input.apiIssuer,
  principalId: input.principalId,
  payer: { issuer: input.upstreamIssuer, ownerId: 'owner-a' },
  credential: { ref: 'credential-a', version: 3 },
  providerId: 'cloud-default',
  model: 'musefold-image-pro',
  capabilities: { image: true, text: false },
};

function fixture() {
  const rows: Record<string, Record<string, unknown>[]> = {
    user: [{ id: input.principalId }],
    account_identities: [
      {
        userId: input.principalId,
        status: 'active',
        apiIssuer: input.apiIssuer,
        upstreamIssuer: input.upstreamIssuer,
        upstreamOwnerId: 'owner-a',
        verifiedAt: NOW,
      },
    ],
    account_credentials: [
      {
        userId: input.principalId,
        provider: 'new-api',
        status: 'active',
        upstreamIssuer: input.upstreamIssuer,
        upstreamOwnerId: 'owner-a',
        credentialRef: 'credential-a',
        credentialVersion: 3,
        verifiedAt: NOW,
        ciphertext: 'synthetic-encrypted-envelope',
        keyVersion: 'v1',
      },
    ],
    session: [{ userId: input.principalId, expiresAt: new Date(NOW.getTime() + 60_000) }],
    account_session_authorizations: [{ userId: input.principalId, mode: 'normal', revision: 2 }],
  };
  const calls: Array<{ table: string; lock: string; params: unknown[]; selected: string[] }> = [];
  const dialect = new PgDialect();
  const tx = {
    select(selected?: Record<string, unknown>) {
      return {
        from(table: PgTable) {
          return {
            where(predicate: SQL) {
              return {
                async for(lock: string) {
                  const name = getTableName(table);
                  calls.push({
                    table: name,
                    lock,
                    params: dialect.sqlToQuery(predicate).params,
                    selected: Object.keys(selected ?? {}),
                  });
                  return rows[name] ?? [];
                },
              };
            },
          };
        },
      };
    },
  } as unknown as MusefoldTransaction;
  return { tx, rows, calls };
}

afterEach(() => vi.useRealTimers());

describe('shared generation execution authority', () => {
  it('requires a server-authorized model, never promotes a client expectation into authority', async () => {
    const selected = { ...binding, model: 'gpt-image-2' };
    await expect(
      lockGenerationExecutionAuthority(fixture().tx, { ...input, expectedBinding: selected }),
    ).rejects.toMatchObject({ reason: 'binding_changed' });
    const authority = await lockGenerationExecutionAuthority(fixture().tx, {
      ...input,
      expectedBinding: selected,
      authorizedModel: selected.model,
    });
    expect(authority.binding).toEqual(selected);
  });
  it('locks in account activation order and returns only binding/auth revision plus a fixed encrypted snapshot', async () => {
    const f = fixture();
    const authority = await lockGenerationExecutionAuthority(f.tx, {
      ...input,
      expectedBinding: binding,
      expectedAuthRevision: 2,
    });
    expect(authority.binding).toEqual(binding);
    expect(authority.authRevision).toBe(2);
    expect(authority.encryptedCredential).toEqual({
      ciphertext: 'synthetic-encrypted-envelope',
      keyVersion: 'v1',
    });
    expect(f.calls.map((call) => [call.table, call.lock])).toEqual([
      ['user', 'share'],
      ['account_identities', 'share'],
      ['account_credentials', 'share'],
      ['session', 'share'],
      ['account_session_authorizations', 'share'],
    ]);
    expect(f.calls.map((call) => call.params)).toEqual([
      [input.principalId],
      [input.principalId],
      [input.principalId, 'new-api'],
      [input.authSessionId],
      [input.authSessionId],
    ]);
    expect(f.calls.find((call) => call.table === 'session')?.selected).toEqual([
      'userId',
      'expiresAt',
    ]);
    expect(Object.isFrozen(authority.encryptedCredential)).toBe(true);
    f.rows.account_credentials[0].ciphertext = 'later-envelope';
    expect(authority.encryptedCredential.ciphertext).toBe('synthetic-encrypted-envelope');
  });

  it.each(['user', 'session'])(
    'rejects a missing %s instead of accepting a user or workbench ID as a BA session',
    async (table) => {
      const f = fixture();
      f.rows[table] = [];
      await expect(lockGenerationExecutionAuthority(f.tx, input)).rejects.toMatchObject({
        reason: 'session_invalid',
      });
    },
  );

  it.each([
    ['status', 'recovery_required'],
    ['apiIssuer', 'https://other-api.example.invalid'],
    ['upstreamIssuer', 'https://other-images.example.invalid'],
    ['upstreamOwnerId', null],
    ['verifiedAt', null],
  ])('rejects an untrusted identity %s', async (key, value) => {
    const f = fixture();
    f.rows.account_identities[0][key] = value;
    await expect(lockGenerationExecutionAuthority(f.tx, input)).rejects.toMatchObject({
      reason: 'identity_unverified',
    });
  });

  it.each([
    ['status', 'revoked'],
    ['upstreamIssuer', 'https://other-images.example.invalid'],
    ['upstreamOwnerId', 'owner-b'],
    ['credentialRef', null],
    ['credentialVersion', 0],
    ['verifiedAt', null],
    ['ciphertext', ''],
    ['keyVersion', ''],
  ])('rejects an unavailable or mismatched credential %s', async (key, value) => {
    const f = fixture();
    f.rows.account_credentials[0][key] = value;
    await expect(lockGenerationExecutionAuthority(f.tx, input)).rejects.toMatchObject({
      reason: 'credential_unavailable',
    });
  });

  it('rejects legacy rows without identity, credential or authorization evidence', async () => {
    for (const [table, reason] of [
      ['account_identities', 'identity_unverified'],
      ['account_credentials', 'credential_unavailable'],
      ['account_session_authorizations', 'authorization_changed'],
    ]) {
      const f = fixture();
      f.rows[table] = [];
      await expect(lockGenerationExecutionAuthority(f.tx, input)).rejects.toMatchObject({ reason });
    }
  });

  it('rejects wrong-owner, expired, recovery-only and changed-authorization sessions', async () => {
    const cases: Array<[string, string, unknown, string]> = [
      ['session', 'userId', 'principal-b', 'session_invalid'],
      ['session', 'expiresAt', NOW, 'session_invalid'],
      ['account_session_authorizations', 'userId', 'principal-b', 'authorization_changed'],
      ['account_session_authorizations', 'mode', 'recovery_only', 'authorization_changed'],
      ['account_session_authorizations', 'revision', 0, 'authorization_changed'],
      ['account_session_authorizations', 'revision', 3, 'authorization_changed'],
    ];
    for (const [table, key, value, reason] of cases) {
      const f = fixture();
      f.rows[table][0][key] = value;
      await expect(
        lockGenerationExecutionAuthority(f.tx, { ...input, expectedAuthRevision: 2 }),
      ).rejects.toMatchObject({ reason });
    }
  });

  it('rechecks expiry after a blocking authorization lock', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const f = fixture();
    Object.defineProperty(f.rows, 'account_session_authorizations', {
      get() {
        vi.setSystemTime(new Date(NOW.getTime() + 120_000));
        return [{ userId: input.principalId, mode: 'normal', revision: 2 }];
      },
    });
    await expect(
      lockGenerationExecutionAuthority(f.tx, { ...input, now: undefined }),
    ).rejects.toMatchObject({ reason: 'session_invalid' });
  });

  it('compares all stable expected identity fields and refuses a changed credential version', async () => {
    const changed: ExecutionBinding[] = [
      { ...binding, principalId: 'principal-b' },
      { ...binding, apiIssuer: 'https://other-api.example.invalid' },
      { ...binding, payer: { ...binding.payer, issuer: 'https://other-images.example.invalid' } },
      { ...binding, payer: { ...binding.payer, ownerId: 'owner-b' } },
      { ...binding, credential: { ...binding.credential, ref: 'credential-b' } },
      { ...binding, credential: { ...binding.credential, version: 4 } },
    ];
    for (const expectedBinding of changed) {
      expect(executionBindingsEqual(binding, expectedBinding)).toBe(false);
      await expect(
        lockGenerationExecutionAuthority(fixture().tx, { ...input, expectedBinding }),
      ).rejects.toMatchObject({ reason: 'binding_changed' });
    }
    const f = fixture();
    f.rows.account_credentials[0].credentialVersion = 4;
    await expect(
      lockGenerationExecutionAuthority(f.tx, { ...input, expectedBinding: binding }),
    ).rejects.toMatchObject({ reason: 'binding_changed' });
  });

  it('does not invalidate a stable credential when verification time changes, and errors carry no credential/context', async () => {
    const f = fixture();
    f.rows.account_credentials[0].verifiedAt = new Date(NOW.getTime() + 1);
    expect(
      (await lockGenerationExecutionAuthority(f.tx, { ...input, expectedBinding: binding }))
        .binding,
    ).toEqual(binding);
    const error = new ExecutionAuthorityError('credential_unavailable');
    expect(error.message).toBe('Generation execution authority rejected: credential_unavailable');
    expect(JSON.stringify(error)).not.toContain('synthetic-encrypted-envelope');
    expect(Object.keys(error).sort()).toEqual(['name', 'reason']);
  });
});
