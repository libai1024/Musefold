import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CARD_STATUSES,
  EVIDENCE_LEVELS,
  EVIDENCE_MANIFEST_PATH,
  EVIDENCE_RESULTS,
  MIGRATION_CARD_IDS,
  REPO_ROOT,
  assertManifestContainsNoSensitiveData,
  assertMigrationEvidenceManifest,
  type MigrationEvidenceManifest,
  readCurrentGitState,
  readMigrationEvidenceManifest,
} from './migration-evidence';

describe('v2.5 migration evidence manifest', () => {
  it('parses the manifest and verifies every seed reference', () => {
    const manifest = readMigrationEvidenceManifest();
    expect(manifest.manifestVersion).toBe(1);
    expect(manifest.sourceOfTruth).toBe('docs/v2.5/V25-MIGRATION-CARDS.md');
    expect(manifest.claims.length).toBeGreaterThanOrEqual(12);
  });

  it('uses only the documented card, evidence-level, and execution-status enums', () => {
    const manifest = readMigrationEvidenceManifest();
    for (const claim of manifest.claims) {
      expect(MIGRATION_CARD_IDS).toContain(claim.card);
      expect(EVIDENCE_LEVELS).toContain(claim.level);
      expect(EVIDENCE_RESULTS).toContain(claim.result);
      expect(CARD_STATUSES).toContain(claim.status);
    }

    const invalid = structuredClone(manifest) as MigrationEvidenceManifest;
    const invalidCard =
      'NO-SUCH-CARD' as unknown as MigrationEvidenceManifest['claims'][number]['card'];
    const invalidLevel =
      'not-an-level' as unknown as MigrationEvidenceManifest['claims'][number]['level'];
    const invalidStatus =
      'not-a-status' as unknown as MigrationEvidenceManifest['claims'][number]['status'];
    invalid.claims[0] = { ...invalid.claims[0], card: invalidCard };
    expect(() => assertMigrationEvidenceManifest(invalid)).toThrow();
    invalid.claims[0] = {
      ...invalid.claims[0],
      card: manifest.claims[0].card,
      level: invalidLevel,
    };
    expect(() => assertMigrationEvidenceManifest(invalid)).toThrow();
    invalid.claims[0] = {
      ...invalid.claims[0],
      level: manifest.claims[0].level,
      status: invalidStatus,
    };
    expect(() => assertMigrationEvidenceManifest(invalid)).toThrow();
  });

  it('has unique claim ids and rejects a duplicate id', () => {
    const manifest = readMigrationEvidenceManifest();
    expect(new Set(manifest.claims.map((claim) => claim.id)).size).toBe(manifest.claims.length);

    const duplicate = structuredClone(manifest);
    duplicate.claims[1] = { ...duplicate.claims[1], id: duplicate.claims[0].id };
    expect(() => assertMigrationEvidenceManifest(duplicate)).toThrow(/claim id 重复/);
  });

  it('requires current verification claims to carry source, test, and workflow paths', () => {
    const manifest = readMigrationEvidenceManifest();
    const currentClaims = manifest.claims.filter((claim) =>
      ['done', 'verify', 'blocked'].includes(claim.status),
    );
    expect(currentClaims.length).toBeGreaterThan(0);
    for (const claim of currentClaims) {
      expect(claim.sourcePaths.length).toBeGreaterThan(0);
      expect(claim.testPaths.length).toBeGreaterThan(0);
      expect(claim.workflowPaths.length).toBeGreaterThan(0);
      expect(claim.command).toBeTruthy();
    }

    const invalid = structuredClone(manifest);
    invalid.claims[0] = { ...invalid.claims[0], sourcePaths: [] };
    expect(() => assertMigrationEvidenceManifest(invalid)).toThrow();
  });

  it('does not allow skip or unregistered evidence to masquerade as pass', () => {
    const manifest = readMigrationEvidenceManifest();
    for (const claim of manifest.claims.filter((claim) => claim.result === 'pass')) {
      expect(claim.commit).toMatch(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
      expect(claim.report || claim.artifact).toBeTruthy();
      expect(claim.testCases.length).toBeGreaterThan(0);
      expect(claim.testCases.every((testCase) => testCase.result === 'pass')).toBe(true);
    }

    const invalidSkip = structuredClone(manifest);
    invalidSkip.claims[2] = {
      ...invalidSkip.claims[2],
      result: 'skip',
      testCases: [
        {
          path: invalidSkip.claims[2].testPaths[0],
          name: 'synthetic skipped case',
          result: 'skip',
        },
      ],
      skipReason: null,
    };
    expect(() => assertMigrationEvidenceManifest(invalidSkip)).toThrow(
      /skip.*(?:testCase|skipReason)/,
    );

    const invalidDone = structuredClone(manifest);
    invalidDone.claims[2] = {
      ...invalidDone.claims[2],
      status: 'done',
      result: 'unregistered',
    };
    expect(() => assertMigrationEvidenceManifest(invalidDone)).toThrow(/done.*pass/);
  });

  it('rejects stale execution metadata and missing report/artifact bindings', () => {
    const manifest = readMigrationEvidenceManifest();
    const stale = structuredClone(manifest);
    stale.claims[2] = {
      ...stale.claims[2],
      result: 'pass',
      commit: '0000000000000000000000000000000000000000',
      date: '2026-08-31',
      report: 'docs/v2.5/V25-MIGRATION-CARDS.md',
      testPaths: [...stale.claims[2].testPaths, 'tests/repo/migration-evidence-manifest.test.ts'],
      testCases: [
        {
          path: 'tests/repo/migration-evidence-manifest.test.ts',
          name: 'synthetic pass case',
          result: 'pass',
        },
      ],
    };
    expect(() => assertMigrationEvidenceManifest(stale)).toThrow(/commit 已过期/);

    const abbreviated = structuredClone(manifest);
    abbreviated.claims[2] = {
      ...abbreviated.claims[2],
      result: 'pass',
      commit: 'f75034a',
      date: '2026-08-31',
      report: 'docs/v2.5/V25-MIGRATION-CARDS.md',
      testCases: [
        {
          path: abbreviated.claims[2].testPaths[0],
          name: 'synthetic pass case',
          result: 'pass',
        },
      ],
    };
    expect(() => assertMigrationEvidenceManifest(abbreviated)).toThrow(/commit 必须/);

    const missingBinding = structuredClone(manifest);
    missingBinding.claims[2] = {
      ...missingBinding.claims[2],
      result: 'fail',
      commit: 'f75034a7d15d1abb8d723c71d67958bea1307b72',
      date: '2026-08-31',
      report: null,
      artifact: null,
      failureReason: '仅用于守卫负例',
    };
    expect(() => assertMigrationEvidenceManifest(missingBinding)).toThrow(/report\/artifact/);
  });

  it('recognizes only explicit migration card records', () => {
    expect(MIGRATION_CARD_IDS).toContain('B01-R');
    expect(MIGRATION_CARD_IDS).toContain('P01-13');
    expect(MIGRATION_CARD_IDS).not.toContain('UI');
    expect(MIGRATION_CARD_IDS).not.toContain('PC');
    expect(MIGRATION_CARD_IDS).not.toContain('PG');
    expect(MIGRATION_CARD_IDS).not.toContain('P0');
  });

  it('fails closed when Git state cannot be read', () => {
    expect(() => readCurrentGitState(`${REPO_ROOT}/does-not-exist`)).toThrow(/无法读取 Git/);
  });

  it('keeps sensitive prose checks narrow enough for ordinary test descriptions', () => {
    expect(() =>
      assertManifestContainsNoSensitiveData({
        command: 'run max_tokens validation and token budget accounting',
        blockedReason: 'external provider is unavailable',
      }),
    ).not.toThrow();
  });

  it('requires blocked evidence to name the blocked test case when applicable', () => {
    const manifest = readMigrationEvidenceManifest();
    const blockedClaims = manifest.claims.filter((claim) => claim.result === 'blocked');
    expect(blockedClaims.length).toBeGreaterThan(0);
    for (const claim of blockedClaims) {
      expect(claim.level).toBe('blocked');
      expect(claim.blockedReason).toBeTruthy();
      expect(claim.rerun).toBeTruthy();
    }
  });

  it('rejects credentials, prompt bodies, and absolute user paths', () => {
    expect(() =>
      assertManifestContainsNoSensitiveData({
        apiKey: 'not-a-real-key',
      }),
    ).toThrow(/敏感信息/);
    expect(() =>
      assertManifestContainsNoSensitiveData({
        promptContent: 'private prompt body',
      }),
    ).toThrow(/敏感信息/);
    expect(() =>
      assertManifestContainsNoSensitiveData({
        path: '/Users/example/private.db',
      }),
    ).toThrow(/敏感信息/);
  });

  it('keeps the checked manifest as JSON rather than a second markdown ledger', () => {
    const raw = readFileSync(EVIDENCE_MANIFEST_PATH, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(raw).not.toMatch(/sk-[A-Za-z0-9_-]{8,}/);
    expect(raw).not.toMatch(/\/Users\//);
  });
});
