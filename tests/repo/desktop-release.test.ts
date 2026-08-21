import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertTagMatchesVersion,
  mergeCatalog,
  publishDesktop,
  publicDownloadUrl,
  rewriteGenericLatestYml,
} from '../../scripts/deploy/publish-desktop.mjs';
import { publishMarketingSite } from '../../scripts/deploy/marketing-site.mjs';
import { REPO_ROOT } from '../../tooling/aliases.mjs';

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'mf-deskrel-'));
}

describe('desktop installer publish', () => {
  it('requires the git tag to match apps/desktop semver', () => {
    expect(assertTagMatchesVersion('v0.5.0-dev.70', '0.5.0-dev.70')).toBe('0.5.0-dev.70');
    expect(() => assertTagMatchesVersion('v0.5.0', '0.5.0-dev.70')).toThrow(/does not match/);
  });

  it('rewrites latest.yml to the public downloads URL', () => {
    const yml = rewriteGenericLatestYml(
      'version: 1\npath: old.exe\nfiles:\n  - url: old.exe\n',
      '0.5.0-dev.70',
      'Musefold Setup 0.5.0-dev.70.exe',
    );
    expect(yml).toContain(publicDownloadUrl('0.5.0-dev.70', 'Musefold Setup 0.5.0-dev.70.exe'));
    expect(yml).toContain('path: Musefold Setup 0.5.0-dev.70.exe');
  });

  it('points latest aliases at the new version and keeps older entries', () => {
    const next = mergeCatalog(
      {
        currentVersion: '0.5.0-dev',
        downloads: [
          { platform: 'macos', version: 'latest', path: '/Musefold/downloads/0.5.0-dev/old.dmg' },
          { platform: 'macos', version: '0.5.0-dev', path: '/Musefold/downloads/0.5.0-dev/old.dmg' },
          { platform: 'macos', version: '0.3.2', path: '/Musefold/downloads/0.3.2/Musefold-0.3.2-arm64.dmg' },
        ],
      },
      '0.5.0-dev.70',
      { dmgName: 'Musefold-0.5.0-dev.70-arm64.dmg', exeName: 'Musefold Setup 0.5.0-dev.70.exe' },
    );
    expect(next.currentVersion).toBe('0.5.0-dev.70');
    expect(next.downloads.find((row) => row.platform === 'macos' && row.version === 'latest')?.path).toContain(
      '0.5.0-dev.70',
    );
    expect(next.downloads.some((row) => row.version === '0.3.2')).toBe(true);
    expect(next.downloads.filter((row) => row.version === 'latest')).toHaveLength(2);
  });

  it('copies installers and writes catalog without docker', () => {
    const macDir = tempDir();
    const winDir = tempDir();
    const site = tempDir();
    writeFileSync(join(macDir, 'Musefold-0.5.0-dev.70-arm64.dmg'), 'dmg');
    writeFileSync(join(macDir, 'latest-mac.yml'), 'path: old.dmg\nfiles:\n  - url: old.dmg\n');
    writeFileSync(join(winDir, 'Musefold Setup 0.5.0-dev.70.exe'), 'exe');
    writeFileSync(join(winDir, 'latest.yml'), 'path: old.exe\nfiles:\n  - url: old.exe\n');
    const result = publishDesktop({
      version: '0.5.0-dev.70',
      macDir,
      winDir,
      siteRoot: site,
      repoRoot: REPO_ROOT,
      skipDocker: true,
    });
    expect(result.ok).toBe(true);
    const catalog = JSON.parse(readFileSync(join(site, 'downloads', 'catalog.json'), 'utf8'));
    expect(catalog.currentVersion).toBe('0.5.0-dev.70');
    expect(readFileSync(join(site, 'downloads', '0.5.0-dev.70', 'SHA256SUMS.txt'), 'utf8')).toMatch(/dmg/);
    expect(readFileSync(join(site, 'updates', 'dev', 'latest.yml'), 'utf8')).toContain('zhaozhaoyue.top');
  });
});

describe('marketing site publish', () => {
  it('copies homepage files and does not invent an app/ symlink', () => {
    const site = tempDir();
    mkdirSync(join(site, 'app'), { recursive: true });
    writeFileSync(join(site, 'app', 'index.html'), 'spa');
    const result = publishMarketingSite(REPO_ROOT, site);
    expect(result.copied).toContain('index.html');
    expect(readFileSync(join(site, 'index.html'), 'utf8')).toContain('version=latest');
    expect(readFileSync(join(site, 'app', 'index.html'), 'utf8')).toBe('spa');
  });
});
