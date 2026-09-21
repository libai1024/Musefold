import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ values: new Map<string, unknown>(), nonce: 0 }));
vi.mock('electron-store', () => ({
  default: class {
    get(key: string) {
      return state.values.get(key);
    }
    set(key: string, value: unknown) {
      state.values.set(key, value);
    }
    delete(key: string) {
      state.values.delete(key);
    }
  },
}));
vi.mock('../os-crypt-durability', () => ({ ensureOsCryptKeyPersisted: vi.fn() }));
vi.mock('../e2e-safe-storage', () => ({
  resolveSafeStorage: () => ({
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`${++state.nonce}:${value}`),
    decryptString: (value: Buffer) => value.toString().replace(/^\d+:/, ''),
  }),
}));

import { deleteApiKey, loadApiKeySnapshot, saveApiKey } from '../keychain';

beforeEach(() => {
  state.values.clear();
  state.nonce = 0;
});

describe('payment credential epoch', () => {
  it('keeps a stable opaque epoch for the same stored ciphertext and rotates on every save', () => {
    saveApiKey('fixture-provider', 'fixture-canary-key');
    const first = loadApiKeySnapshot('fixture-provider');
    expect(first?.key).toBe('fixture-canary-key');
    expect(first?.epoch).toMatch(/^[a-f0-9]{64}$/);
    expect(first?.epoch).not.toContain('fixture-canary-key');
    expect(loadApiKeySnapshot('fixture-provider')).toEqual(first);
    saveApiKey('fixture-provider', 'fixture-canary-key');
    expect(loadApiKeySnapshot('fixture-provider')?.epoch).not.toBe(first?.epoch);
  });

  it('returns no usable identity after key deletion', () => {
    saveApiKey('fixture-provider', 'fixture-first-key');
    const old = loadApiKeySnapshot('fixture-provider');
    deleteApiKey('fixture-provider');
    expect(loadApiKeySnapshot('fixture-provider')).toBeNull();
    saveApiKey('fixture-provider', 'fixture-second-key');
    expect(loadApiKeySnapshot('fixture-provider')).not.toEqual(old);
  });
});
