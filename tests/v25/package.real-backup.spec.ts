import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { DESKTOP_MIGRATIONS } from '../../packages/desktop-db/src/migrations.generated';
import { resolvePackageArtifact } from '../../scripts/v25-package-artifact.mjs';
import { v25ShellPage } from './electron-helpers';
import { seedOnboardingCompletedFile } from './onboarding-helpers';
import { expectCurrentPackage } from './package-build-identity';
import {
  copyLegacyMedia,
  createRealBackupFixture,
  digest,
  verifyHistoryBackfill,
  verifyOriginalRows,
} from './real-backup-fixture';

function pathsFromEnvironment(name: string): string[] {
  const value: unknown = JSON.parse(process.env[name] || 'null');
  assert(
    Array.isArray(value) &&
      value.length > 0 &&
      value.length <= 10 &&
      value.every((item) => typeof item === 'string'),
    `${name} must explicitly list authorized paths`,
  );
  return value as string[];
}

const backups = pathsFromEnvironment('MUSEFOLD_REAL_SQLITE_BACKUPS');
const mediaRoots = pathsFromEnvironment('MUSEFOLD_REAL_MEDIA_ROOTS');
const executablePath = resolvePackageArtifact({
  repoRoot: resolve(import.meta.dirname, '../..'),
  platform: process.platform,
  arch: process.env.MUSEFOLD_PACKAGE_ARCH || process.arch,
  required: true,
  explicitPath: process.env.MUSEFOLD_PACKAGE_PATH,
});

function databaseFacts(path: string, prior: { hash: string; created_at: number }[]) {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    assert.equal(digest(db.pragma('integrity_check')), digest([{ integrity_check: 'ok' }]));
    assert.equal(digest(db.pragma('foreign_key_check')), digest([]));
    const ledger = db
      .prepare('SELECT hash,created_at FROM __drizzle_migrations ORDER BY created_at')
      .all();
    assert.equal(
      digest(ledger),
      digest(
        DESKTOP_MIGRATIONS.map((migration, index) => ({
          // Historical applied hashes remain historical. New entries must match the
          // running bundle; rewriting the old prefix would falsify its provenance.
          hash: prior[index]?.hash ?? migration.hash,
          created_at: migration.folderMillis,
        })),
      ),
    );
    assert.equal(
      digest(prior.map((row) => row.created_at)),
      digest(DESKTOP_MIGRATIONS.slice(0, prior.length).map((row) => row.folderMillis)),
      'Source ledger must be a known ordered migration prefix',
    );
    return {
      integrity: 'ok',
      foreignKeyViolations: 0,
      migrations: ledger.length,
      ledgerSha256: digest(ledger),
      preservedHistoricalHashDifferences: prior.filter(
        (row, index) => row.hash !== DESKTOP_MIGRATIONS[index]?.hash,
      ).length,
    };
  } finally {
    db.close();
  }
}

for (const [index, backup] of backups.entries()) {
  // Deliberately omit source names, private row values and images from test/report titles.
  test(`actual packaged App upgrades authorized real backup ${index + 1} without losing data or media`, async () => {
    test.setTimeout(240_000);
    const fixture = createRealBackupFixture(backup);
    seedOnboardingCompletedFile(fixture.root);
    const launch = () =>
      electron.launch({
        executablePath,
        env: {
          ...process.env,
          MUSEFOLD_E2E: '1',
          MUSEFOLD_E2E_USER_DATA_DIR: fixture.root,
          MUSEFOLD_API_URL: 'http://127.0.0.1:9',
          MUSEFOLD_LIVE_E2E: '0',
          MUSEFOLD_E2E_IMAGE_API_KEY: '',
        },
      });
    let app: ElectronApplication | undefined;
    let media: ReturnType<typeof copyLegacyMedia> | undefined;
    const pids: (number | undefined)[] = [];
    try {
      assert(
        fixture.before.searches.length > 0,
        'Real backup must exercise its existing FTS index',
      );
      app = await launch();
      const build = await expectCurrentPackage(app, fixture.root);
      await v25ShellPage(app);
      pids.push(app.process().pid);
      await app.close();
      app = undefined;
      const first = databaseFacts(fixture.dbPath, fixture.before.priorLedger);
      const db = new Database(fixture.dbPath, { readonly: true, fileMustExist: true });
      let preserved: ReturnType<typeof verifyOriginalRows>;
      let backfilled: ReturnType<typeof verifyHistoryBackfill>;
      try {
        preserved = verifyOriginalRows(db, fixture.before);
        backfilled = verifyHistoryBackfill(db, fixture.before);
      } finally {
        db.close();
      }
      const savedBackups = readdirSync(join(fixture.root, 'musefold-backups-v0.3.0')).filter(
        (file) => file.endsWith('.db'),
      );
      assert(savedBackups.length > 0, 'Actual packaged migration must create a safety backup');
      fixture.assertSourceUnchanged();

      // Second OS process on the still-unaltered paths: migration replay must be a no-op.
      app = await launch();
      await expectCurrentPackage(app, fixture.root);
      await v25ShellPage(app);
      pids.push(app.process().pid);
      await app.close();
      app = undefined;
      assert.equal(
        digest(databaseFacts(fixture.dbPath, fixture.before.priorLedger)),
        digest(first),
      );
      const replay = new Database(fixture.dbPath, { readonly: true, fileMustExist: true });
      try {
        assert.equal(digest(verifyOriginalRows(replay, fixture.before)), digest(preserved));
      } finally {
        replay.close();
      }
      assert.equal(
        readdirSync(join(fixture.root, 'musefold-backups-v0.3.0')).filter((file) =>
          file.endsWith('.db'),
        ).length,
        savedBackups.length,
      );

      // Test-only relocation happens AFTER proving exact original rows/paths. Real image
      // files are copied; production media:// must decode/read those bytes, not fake PNGs.
      media = copyLegacyMedia(fixture.dbPath, fixture.root, mediaRoots);
      for (let restart = 0; restart < 2; restart++) {
        app = await launch();
        await expectCurrentPackage(app, fixture.root);
        const page = await v25ShellPage(app);
        pids.push(app.process().pid);
        for (const image of media.images) {
          const url = `media://local/?p=${encodeURIComponent(image.copied)}`;
          const bytes: { status: number; bytes: number; mime: string | null; sha256: string } =
            await app.evaluate(async ({ net }, resource) => {
              const response = await net.fetch(resource);
              const data = Buffer.from(await response.arrayBuffer());
              return {
                status: response.status,
                bytes: data.length,
                mime: response.headers.get('content-type'),
                sha256: process
                  .getBuiltinModule('crypto')
                  .createHash('sha256')
                  .update(data)
                  .digest('hex'),
              };
            }, url);
          assert.equal(
            bytes.status,
            200,
            'Packaged media protocol did not return the copied real image',
          );
          assert.equal(bytes.bytes, image.bytes);
          assert.equal(bytes.sha256, image.sha256);
          assert.match(bytes.mime || '', /^image\//);
          const decoded = await page.evaluate(async (resource) => {
            const image = new Image();
            image.src = resource;
            await image.decode();
            return image.naturalWidth > 0 && image.naturalHeight > 0;
          }, url);
          assert(decoded, 'Real image must decode in the packaged renderer');
        }
        await app.close();
        app = undefined;
        assert.equal(
          digest(databaseFacts(fixture.dbPath, fixture.before.priorLedger)),
          digest(first),
        );
        const relocated = new Database(fixture.dbPath, { readonly: true, fileMustExist: true });
        try {
          verifyOriginalRows(relocated, media.relocated);
        } finally {
          relocated.close();
        }
      }
      assert.equal(new Set(pids).size, 4, 'All four starts must be different OS processes');
      fixture.assertSourceUnchanged();
      media.assertSourcesUnchanged();
      await test.info().attach('real-backup-upgrade-evidence', {
        contentType: 'application/json',
        body: JSON.stringify({
          sample: index + 1,
          backupSha256: fixture.sourceHash,
          legacyVersion: fixture.before.legacyVersion,
          priorMigrations: fixture.before.priorMigrationCount,
          build,
          pids,
          first,
          preserved,
          ftsQueries: fixture.before.searches.length,
          backfilled,
          media: media.summary,
          originalBackupUnchanged: true,
          originalMediaUnchanged: true,
          scope:
            'Actual packaged macOS/Windows executable and explicit real backup copies; original row/column/path preservation first, then test-only media path relocation and two real media protocol/renderer starts. No installed-profile mutation, installer UI, real credentials, paid upstream or other-platform claim.',
        }),
      });
    } finally {
      try {
        await app?.close();
      } finally {
        try {
          fixture.assertSourceUnchanged();
          media?.assertSourcesUnchanged();
        } finally {
          fixture.remove();
        }
      }
    }
  });
}
