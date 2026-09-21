import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureCipher } from '@musefold/core/services/__tests__/fixtures/managed-anchor-cipher';
import type { ManagedExecutionAnchor } from '@musefold/desktop-contracts/managed-execution';

const state = vi.hoisted(() => ({
  root: '',
  available: true,
  persisted: false,
  backend: 'gnome_libsecret',
  encrypt: (s: string): Buffer => Buffer.from(s),
  decrypt: (b: Buffer): string => b.toString(),
}));
vi.mock('electron', () => ({
  app: { getPath: () => state.root },
  safeStorage: {
    isEncryptionAvailable: () => state.available,
    getSelectedStorageBackend: () => state.backend,
    encryptString: (s: string) => state.encrypt(s),
    decryptString: (b: Buffer) => state.decrypt(b),
  },
}));
vi.mock('../os-crypt-durability', () => ({ hasPersistedOsCryptKey: () => state.persisted }));
import { createManagedExecutionAnchor, MANAGED_ANCHOR_FILE } from '../managed-execution-anchor';

const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
const id = '00000000-0000-4000-8000-000000000001';
const anchor: ManagedExecutionAnchor = {
  version: 1,
  committed: {
    lineageId: id,
    namespace: id,
    revision: 0,
    headHash: 'a'.repeat(64),
    lastOperationId: id,
  },
  pending: null,
  mode: 'active',
  reason: null,
};
beforeEach(() => {
  state.root = mkdtempSync(join(tmpdir(), 'musefold-anchor-os-'));
  state.available = true;
  state.persisted = true;
  state.backend = 'gnome_libsecret';
  state.encrypt = fixtureCipher.encrypt;
  state.decrypt = fixtureCipher.decrypt;
});
afterEach(() => {
  vi.useRealTimers();
  if (platformDescriptor) Object.defineProperty(process, 'platform', platformDescriptor);
  rmSync(state.root, { recursive: true, force: true });
});

describe('managed execution OS storage adapter', () => {
  it('rejects the Linux basic_text backend rather than storing a plaintext control record', async () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' });
    state.backend = 'basic_text';
    await expect(createManagedExecutionAnchor().write(anchor)).rejects.toMatchObject({
      code: 'MANAGED_ENCRYPTION_UNAVAILABLE',
    });
    expect(existsSync(join(state.root, MANAGED_ANCHOR_FILE))).toBe(false);
  });

  it('waits for the Windows OS key record before writing a control file', async () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' });
    state.persisted = false;
    vi.useFakeTimers();
    const port = createManagedExecutionAnchor();
    const pending = port.write(anchor);
    await vi.advanceTimersByTimeAsync(300);
    expect(existsSync(join(state.root, MANAGED_ANCHOR_FILE))).toBe(false);
    state.persisted = true;
    await vi.advanceTimersByTimeAsync(100);
    vi.useRealTimers();
    await pending;
    expect(await port.read()).toEqual(anchor);
  });

  it('fails closed after the Windows key persistence deadline without writing ciphertext', async () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' });
    state.persisted = false;
    vi.useFakeTimers();
    const rejected = expect(createManagedExecutionAnchor().write(anchor)).rejects.toMatchObject({
      code: 'MANAGED_ENCRYPTION_NOT_DURABLE',
    });
    await vi.advanceTimersByTimeAsync(20_000);
    await rejected;
    expect(existsSync(join(state.root, MANAGED_ANCHOR_FILE))).toBe(false);
  });

  it('returns a fixed unreadable error if the OS keystore disappears after a successful write', async () => {
    const port = createManagedExecutionAnchor();
    await port.write(anchor);
    state.available = false;
    await expect(port.read()).rejects.toMatchObject({ code: 'MANAGED_ANCHOR_UNREADABLE' });
  });
});
