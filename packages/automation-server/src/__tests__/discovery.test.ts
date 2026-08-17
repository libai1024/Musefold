import { chmodSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  discoveryFileMode,
  discoveryFilePath,
  readDiscoveryFile,
  removeDiscoveryFileIfOwned,
  writeDiscoveryFile,
  type DiscoveryDocument,
} from '../discovery';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function document(overrides: Partial<DiscoveryDocument> = {}): DiscoveryDocument {
  return {
    version: 1, apiVersion: 'v1', pid: 123, port: 4567, token: 'mf_at_secret',
    owner: 'desktop-app', appVersion: '0.4.0-dev', startedAt: new Date(0).toISOString(), ...overrides,
  };
}

describe('automation discovery file', () => {
  it('writes atomically with restrictive permissions and validates reads', () => {
    const dir = mkdtempSync(join(tmpdir(), 'musefold-automation-discovery-')); dirs.push(dir);
    const path = writeDiscoveryFile(dir, document());
    expect(path).toBe(discoveryFilePath(dir));
    expect(discoveryFileMode(dir)).toBe(0o600);
    expect(readDiscoveryFile(dir)).toEqual(document());
    expect(JSON.parse(readFileSync(path, 'utf8')).token).toBe('mf_at_secret');
  });

  it('rejects malformed or insecure ownership replacements', () => {
    const dir = mkdtempSync(join(tmpdir(), 'musefold-automation-discovery-')); dirs.push(dir);
    writeDiscoveryFile(dir, document());
    chmodSync(discoveryFilePath(dir), 0o644);
    expect(discoveryFileMode(dir)).toBe(0o644);
    removeDiscoveryFileIfOwned(dir, { pid: 999, port: 4567, token: 'mf_at_secret' });
    expect(readDiscoveryFile(dir)).not.toBeNull();
    writeDiscoveryFile(dir, document({ port: 0 }));
    expect(readDiscoveryFile(dir)).toBeNull();
  });
});
