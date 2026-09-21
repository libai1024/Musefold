import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  D03A_DESIGN_SCHEME_MANIFEST,
  D03A_DESIGN_SCHEME_USER_VERSION,
  D03A_LEGACY_MANIFEST,
  D03A_LEGACY_USER_VERSION,
  D03A_LONG_RELATIVE_PATH,
  buildD03AFixtureCorpus,
  buildD03ADesignSchemeFixture,
  buildD03ALegacyFixture,
  createD03ATestRoot,
  removeD03ATestRoot,
  scanD03AFixture,
  scanD03AFixtureFile,
  assertAllowedFixtureSource,
} from '..';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) removeD03ATestRoot(root);
});

function testRoot(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `musefold-${label}-`));
  roots.push(root);
  return root;
}

function staticManifest(): {
  fixtures: Array<{ fixtureId: string; canonicalHash: string; fileHash: string }>;
} {
  const manifestPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'provenance.json');
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    fixtures: Array<{ fixtureId: string; canonicalHash: string; fileHash: string }>;
  };
}

describe('D03-A synthetic fixture corpus', () => {
  it('isolates repeated runs with the same label from an earlier unfinished backup', () => {
    const first = createD03ATestRoot('musefold-d03-isolation-');
    roots.push(first);
    writeFileSync(join(first, 'unfinished-backup.db'), 'owned previous-run marker');
    const second = createD03ATestRoot('musefold-d03-isolation-');
    roots.push(second);
    expect(second).not.toBe(first);
    expect(existsSync(join(second, 'unfinished-backup.db'))).toBe(false);
    const firstCorpus = buildD03ALegacyFixture(first);
    const secondCorpus = buildD03ALegacyFixture(second);
    expect(secondCorpus.canonicalHash).toBe(firstCorpus.canonicalHash);
    removeD03ATestRoot(second);
    expect(readFileSync(join(first, 'unfinished-backup.db'), 'utf8')).toBe(
      'owned previous-run marker',
    );
  });

  it('builds two independent disposable databases with provenance metadata', () => {
    const corpus = buildD03AFixtureCorpus(testRoot('d03-a-corpus'));

    expect(corpus).toHaveLength(2);
    expect(corpus.map((artifact) => artifact.kind)).toEqual(['legacy-v2.1', 'design-scheme-v4']);
    for (const artifact of corpus) {
      expect(readFileSync(artifact.path).subarray(0, 16).toString()).toBe('SQLite format 3\u0000');
      expect(artifact.manifest.source.provenance).toBe('synthetic');
      expect(artifact.manifest.source.sourceKind).toBe('deterministic-builder');
      expect(artifact.manifest.redaction.credentials).toBe('excluded');
      expect(artifact.manifest.redaction.absolutePaths).toBe('excluded');
      expect(artifact.manifest.redaction.realGeneration).toBe(false);
      expect(artifact.manifest.redaction.realSpend).toBe(false);
      expect(artifact.manifest.canonicalHash).toBe(artifact.canonicalHash);
      expect(artifact.manifest.fileHash).toBe(artifact.fileHash);
      expect(artifact.fileHash).toMatch(/^[a-f0-9]{64}$/);
      expect(artifact.manifest.canonicalHash).not.toBe('TO_BE_FILLED');
    }
    const staticFixtures = staticManifest().fixtures;
    expect(staticFixtures.map((fixture) => fixture.fixtureId)).toEqual(
      corpus.map((artifact) => artifact.manifest.fixtureId),
    );
    expect(staticFixtures.map((fixture) => fixture.canonicalHash)).toEqual(
      corpus.map((artifact) => artifact.canonicalHash),
    );
    expect(staticFixtures.map((fixture) => fixture.fileHash)).toEqual(
      corpus.map((artifact) => artifact.fileHash),
    );
  });

  it('covers legacy v2.1 schema, consent states, history assets, tombstones, and FTS drift', () => {
    const artifact = buildD03ALegacyFixture(testRoot('d03-a-legacy'));
    const db = new Database(artifact.path, { readonly: true });
    const result = scanD03AFixture(db, 'legacy-v2.1', artifact.path);

    expect(result.passed).toBe(true);
    expect(result.userVersion).toBe(D03A_LEGACY_USER_VERSION);
    expect(result.integrity).toBe('ok');
    expect(result.foreignKeyViolations).toEqual([]);
    expect(result.missingTables).toEqual([]);
    expect(result.sensitiveMatches).toEqual([]);
    expect(result.absolutePathMatches).toEqual([]);
    expect(result.redactionViolations).toEqual([]);
    expect(result.ftsDrift).toEqual(['stale:prompt-alpha', 'missing:prompt-deleted']);
    expect(D03A_LONG_RELATIVE_PATH).toContain('長'.repeat(96));
    expect(D03A_LONG_RELATIVE_PATH.length).toBe(127);
    expect(
      db.prepare("SELECT preview_image_path FROM prompts WHERE id = 'prompt-alpha'").get(),
    ).toEqual({ preview_image_path: D03A_LONG_RELATIVE_PATH });
    expect(result.tables).toEqual(
      expect.arrayContaining([
        'folders',
        'prompts',
        'history',
        'history_prompt_references',
        'generated_assets',
        'cloud_sync_accounts',
        'cloud_sync_outbox',
        'cloud_sync_conflicts',
        'cloud_sync_usage_outbox',
        'prompts_fts',
      ]),
    );
    expect(db.prepare('SELECT COUNT(*) AS count FROM prompts').get()).toEqual({ count: 2 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM history').get()).toEqual({ count: 2 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM generated_assets').get()).toEqual({
      count: 1,
    });
    expect(
      db.prepare("SELECT media_path FROM generated_assets WHERE id = 'asset-historical'").get(),
    ).toEqual({ media_path: 'fixture-assets/history/historical.png' });
    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM workbench_sessions WHERE archived_at IS NOT NULL')
        .get(),
    ).toEqual({ count: 1 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM cloud_sync_outbox').get()).toEqual({
      count: 2,
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM cloud_sync_conflicts').get()).toEqual({
      count: 2,
    });
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM cloud_sync_accounts WHERE enabled = 1').get(),
    ).toEqual({ count: 1 });
    expect(
      db
        .prepare(
          'SELECT COUNT(*) AS count FROM cloud_sync_accounts WHERE enabled = 0 AND bootstrap_completed_at IS NOT NULL',
        )
        .get(),
    ).toEqual({ count: 1 });
    expect(
      db
        .prepare(
          'SELECT COUNT(*) AS count FROM cloud_sync_accounts WHERE enabled = 0 AND bootstrap_completed_at IS NULL AND last_sync_at IS NULL',
        )
        .get(),
    ).toEqual({ count: 1 });
    db.close();
  });

  it('keeps design-scheme v4 separate and records its intentionally incomplete scaffold', () => {
    const artifact = buildD03ADesignSchemeFixture(testRoot('d03-a-design'));
    const db = new Database(artifact.path, { readonly: true });
    const result = scanD03AFixture(db, 'design-scheme-v4', artifact.path);

    expect(result.passed).toBe(true);
    expect(result.userVersion).toBe(D03A_DESIGN_SCHEME_USER_VERSION);
    expect(result.foreignKeyViolations).toEqual([]);
    expect(result.missingTables).toEqual([]);
    expect(result.sensitiveMatches).toEqual([]);
    expect(result.absolutePathMatches).toEqual([]);
    expect(result.redactionViolations).toEqual([]);
    expect(artifact.manifest.unimplementedFields.length).toBeGreaterThan(0);
    expect(artifact.manifest.unimplementedFields).toContain('v5 optimistic-lock version column');
    expect(
      db.prepare("SELECT value FROM design_scheme_meta WHERE key = 'schema_version'").get(),
    ).toEqual({ value: '4' });
    expect(db.prepare('SELECT COUNT(*) AS count FROM design_scheme_migrations').get()).toEqual({
      count: 4,
    });
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM design_scheme_runs WHERE status = 'blocked'").get(),
    ).toEqual({ count: 1 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM design_scheme_assets').get()).toEqual({
      count: 1,
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM design_scheme_evaluations').get()).toEqual({
      count: 0,
    });
    db.close();
  });

  it('produces stable canonical and file hashes across independent roots', () => {
    const first = buildD03AFixtureCorpus(testRoot('d03-a-hash-one'));
    const second = buildD03AFixtureCorpus(testRoot('d03-a-hash-two'));

    expect(first.map((artifact) => artifact.canonicalHash)).toEqual(
      second.map((artifact) => artifact.canonicalHash),
    );
    expect(first.map((artifact) => artifact.fileHash)).toEqual(
      second.map((artifact) => artifact.fileHash),
    );
  });

  it('rejects release and .drizzle-pull sources before they can become fixtures', () => {
    expect(() => assertAllowedFixtureSource('/workspace/release/user.db')).toThrow(/forbidden/);
    expect(() =>
      assertAllowedFixtureSource('/workspace/packages/desktop-db/.drizzle-pull'),
    ).toThrow(/forbidden/);
    expect(() => assertAllowedFixtureSource('/tmp/d03-a-synthetic.db')).not.toThrow();
  });

  it('scans materialized fixture files through the same file boundary', () => {
    const artifact = buildD03ALegacyFixture(testRoot('d03-a-file-scan'));
    expect(scanD03AFixtureFile(artifact)).toMatchObject({
      kind: 'legacy-v2.1',
      userVersion: D03A_LEGACY_USER_VERSION,
      integrity: 'ok',
      passed: true,
    });
    expect(D03A_LEGACY_MANIFEST.fixtureId).toContain('d03-a');
    expect(D03A_DESIGN_SCHEME_MANIFEST.fixtureId).toContain('d03-a');
  });
});
