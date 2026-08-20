import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  compareReleaseVersions,
  createSkillInstallMetadata,
  extractMusefoldSkillVersion,
  replaceMusefoldSkillDirectory,
  sha256Text,
  validateSkillReleaseManifest,
  type MusefoldSkillReleaseManifest,
} from '../integration-skill-release';

const validManifest: MusefoldSkillReleaseManifest = {
  schemaVersion: 1,
  name: 'musefold',
  version: 'v0.4.0',
  releasedAt: '2026-08-17T00:00:00.000Z',
  minimumAppVersion: '0.4.0',
  files: [{
    path: 'SKILL.md',
    url: 'https://raw.githubusercontent.com/libai1024/Musefold-Skills/v0.4.0/skills/musefold/SKILL.md',
    sha256: 'a'.repeat(64),
  }],
};

describe('Musefold Skill release contract', () => {
  it('compares stable and prerelease versions', () => {
    expect(compareReleaseVersions('v0.4.0', '0.3.9')).toBe(1);
    expect(compareReleaseVersions('0.5.0-dev', '0.5.0')).toBe(-1);
    expect(compareReleaseVersions('v1.0.0', '1.0.0')).toBe(0);
  });

  it('accepts immutable tagged files and rejects mutable or unsafe paths', () => {
    expect(validateSkillReleaseManifest(validManifest).version).toBe('v0.4.0');
    expect(() => validateSkillReleaseManifest({
      ...validManifest,
      files: [{ ...validManifest.files[0], url: validManifest.files[0].url.replace('/v0.4.0/', '/main/') }],
    })).toThrow(/URL/);
    expect(() => validateSkillReleaseManifest({
      ...validManifest,
      files: [{ ...validManifest.files[0], path: '../SKILL.md' }],
    })).toThrow(/路径/);
  });

  it('extracts versions, hashes content, and writes deterministic metadata', () => {
    expect(extractMusefoldSkillVersion('<!-- musefold-skill-version: v0.4.0 -->')).toBe('v0.4.0');
    expect(sha256Text('Musefold')).toMatch(/^[a-f0-9]{64}$/);
    expect(createSkillInstallMetadata(validManifest, 'github-release', 'manifest', 'now')).toMatchObject({
      version: 'v0.4.0',
      source: 'github-release',
      manifestUrl: 'manifest',
      installedAt: 'now',
    });
  });

  it('atomically replaces a directory and keeps the previous version outside the Skill discovery root', () => {
    const root = mkdtempSync(join(tmpdir(), 'musefold-skill-release-'));
    const skillRoot = join(root, '.codex', 'skills');
    const target = join(skillRoot, 'musefold');
    try {
      replaceMusefoldSkillDirectory(
        target,
        new Map([['SKILL.md', 'old']]),
        { ...validManifest, version: 'v0.3.0', files: [{ ...validManifest.files[0], sha256: sha256Text('old') }] },
        'bundled',
        null,
      );
      const backup = replaceMusefoldSkillDirectory(
        target,
        new Map([['SKILL.md', 'new'], ['references/compatibility.md', 'compat']]),
        validManifest,
        'github-release',
        'manifest',
      );
      expect(readFileSync(join(target, 'SKILL.md'), 'utf8')).toBe('new');
      expect(readFileSync(join(target, 'references', 'compatibility.md'), 'utf8')).toBe('compat');
      expect(JSON.parse(readFileSync(join(target, '.musefold-install.json'), 'utf8'))).toMatchObject({
        version: 'v0.4.0',
        source: 'github-release',
      });
      expect(backup).not.toBeNull();
      expect(dirname(backup!)).toBe(join(root, '.codex', 'musefold-skill-backups'));
      expect(relative(skillRoot, backup!).startsWith('..')).toBe(true);
      expect(readFileSync(join(backup!, 'SKILL.md'), 'utf8')).toBe('old');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
