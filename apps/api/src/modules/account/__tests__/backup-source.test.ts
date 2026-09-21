import { chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  backupSourceProfileSchema,
  loadBackupSourceProfile,
  readControlledFile,
  sha256,
} from '../backup-source.js';

describe('operator trust input is separate, bounded and explicit', () => {
  let folder: string;
  let profilePath: string;
  let profile: ReturnType<typeof backupSourceProfileSchema.parse>;
  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'backup-profile-'));
    profilePath = join(folder, 'profile.json');
    const recordPath = join(folder, 'independently-retained-record.txt');
    const record =
      'Synthetic operator-reviewed deployment lineage and earliest-candidate evidence.';
    await writeFile(recordPath, record, { mode: 0o600 });
    profile = {
      version: 1,
      id: 'reviewed',
      apiIssuer: 'https://api.example.invalid',
      upstreamIssuer: 'https://relay.example.invalid',
      targetDatabase: { systemIdentifier: '200', name: 'production' },
      sourceDatabase: { systemIdentifier: '100', name: 'isolated' },
      sourceDatabaseUrlEnv: 'MUSEFOLD_RECOVERY_SOURCE_DSN',
      archiveKeyEnv: 'MUSEFOLD_RECOVERY_OLD_KEY',
      sourcePrincipalId: 'unchanged-principal',
      targetPrincipalId: 'unchanged-principal',
      sourceLineage: 'installation',
      targetLineage: 'installation',
      capturedAt: '2026-09-01T00:00:00.000Z',
      independentBefore: '2026-09-02T00:00:00.000Z',
      attestation: {
        recordPath,
        sha256: sha256(record),
        reference: 'deployment-audit-record',
        reviewedBy: 'operator',
        decision: 'complete-independent-legacy-evidence',
      },
    };
  });
  afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
  });
  async function load() {
    await writeFile(profilePath, JSON.stringify(profile), { mode: 0o600 });
    return loadBackupSourceProfile(profilePath);
  }

  it('allows an unpinned fingerprint profile but keeps its historical judgment explicitly operator supplied', async () => {
    expect(await load()).toMatchObject({
      id: 'reviewed',
      attestation: { decision: 'complete-independent-legacy-evidence' },
    });
    expect((await load()).expectedEvidenceSha256).toBeUndefined();
  });
  it('rejects missing independent review, even with a self-declared source digest', async () => {
    profile.expectedEvidenceSha256 = '0'.repeat(64);
    const value = { ...profile, attestation: undefined };
    expect(backupSourceProfileSchema.safeParse(value).success).toBe(false);
  });
  it.each(['sourceLineage', 'sourcePrincipalId'] as const)(
    'requires stable %s rather than a coincident numeric identifier',
    (field) => {
      profile[field] = 'different';
      expect(backupSourceProfileSchema.safeParse(profile).success).toBe(false);
    },
  );
  it('rejects a profile pointing at the target database as source', () => {
    profile.sourceDatabase = { ...profile.targetDatabase };
    expect(backupSourceProfileSchema.safeParse(profile).success).toBe(false);
  });
  it.each([
    'https://user:secret@example.invalid',
    'https://relay.example.invalid?secret=value',
    'file:///tmp/material',
    'https://relay.example.invalid#fragment',
  ])('rejects unsafe issuer %s', (value) => {
    profile.upstreamIssuer = value;
    expect(backupSourceProfileSchema.safeParse(profile).success).toBe(false);
  });
  it('rejects a mismatched independently retained record', async () => {
    profile.attestation.sha256 = '0'.repeat(64);
    await expect(load()).rejects.toThrow('ATTESTATION_RECORD_MISMATCH');
  });
  it('refuses record material writable by another principal', async () => {
    await chmod(profile.attestation.recordPath, 0o666);
    await expect(load()).rejects.toThrow('CONTROLLED_FILE_REJECTED');
  });
  it('refuses a symlink instead of a controlled profile', async () => {
    await load();
    const link = join(folder, 'linked-profile.json');
    await symlink(profilePath, link);
    await expect(loadBackupSourceProfile(link)).rejects.toBeDefined();
  });
  it('refuses oversized controlled files before allocating an unbounded buffer', async () => {
    const file = join(folder, 'large');
    await writeFile(file, 'x'.repeat(65_537), { mode: 0o600 });
    await expect(readControlledFile(file)).rejects.toThrow('CONTROLLED_FILE_REJECTED');
  });
  it('refuses malformed UTF-8 and relative paths', async () => {
    await writeFile(profilePath, Buffer.from([0xff]), { mode: 0o600 });
    await expect(loadBackupSourceProfile(profilePath)).rejects.toBeDefined();
    await expect(loadBackupSourceProfile('profile.json')).rejects.toThrow(
      'CONTROLLED_FILE_REQUIRED',
    );
  });
  it('refuses candidate-era material even when its digest is correct', () => {
    profile.capturedAt = profile.independentBefore;
    expect(backupSourceProfileSchema.safeParse(profile).success).toBe(false);
  });
});
