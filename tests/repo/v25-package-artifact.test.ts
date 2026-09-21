import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { resolvePackageArtifact } from '../../scripts/v25-package-artifact.mjs';

const roots: string[] = [];
function fixture() {
  const repoRoot = mkdtempSync(join(tmpdir(), 'package-artifact-'));
  roots.push(repoRoot);
  return { repoRoot, platform: 'darwin', arch: 'arm64', required: true };
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it('fails strict smoke when the requested platform artifact is absent, even if another exists', () => {
  const options = fixture();
  const wrong = join(options.repoRoot, 'release/win-unpacked/Musefold.exe');
  mkdirSync(dirname(wrong), { recursive: true });
  writeFileSync(wrong, 'fixture');
  expect(() => resolvePackageArtifact(options)).toThrow('Required package artifact is missing');
  expect(resolvePackageArtifact({ ...options, required: false })).toBeUndefined();
});

it('resolves only the matching artifact and refuses missing explicit paths', () => {
  const options = fixture();
  const matching = join(options.repoRoot, 'release/mac-arm64/Musefold.app/Contents/MacOS/Musefold');
  mkdirSync(dirname(matching), { recursive: true });
  writeFileSync(matching, 'fixture');
  expect(resolvePackageArtifact(options)).toBe(matching);
  expect(() =>
    resolvePackageArtifact({ ...options, required: false, explicitPath: 'missing' }),
  ).toThrow('Required package artifact is missing');
});

it('does not claim unsupported platforms as successful package verification', () => {
  expect(() => resolvePackageArtifact({ ...fixture(), platform: 'linux' })).toThrow(
    'Unsupported package target',
  );
});
