import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { designSchemePageSchema, type DesignSchemePage } from '@musefold/contracts';
import {
  designSchemeDbMigrations,
  runDesignSchemeDbMigrations,
} from '../../packages/core/src/db/design-scheme/migrations';
import { designSchemeDbPath, launchV25App, v25ShellPage } from './electron-helpers';
import { invoke } from './desktop-sync-helpers';
import { DESIGN_SCHEME_DB_SCHEMA_VERSION } from '../../packages/core/src/db/design-scheme/schema';

async function allRemoved(page: Page) {
  const ids: string[] = [];
  let cursor: string | undefined;
  for (let attempt = 0; attempt < 20; attempt++) {
    const result = designSchemePageSchema.parse(
      await invoke(page, 'designSchemes.list', {
        deletedOnly: true,
        limit: 31,
        cursor,
      }),
    );
    expect(result.items.every((item) => item.version === 2)).toBe(true);
    ids.push(...result.items.map((item) => item.id));
    if (!result.nextCursor) return ids;
    cursor = result.nextCursor;
  }
  throw new Error('Removed scheme pagination did not terminate');
}

test('v9 scheme database upgrades without losing receipts and IPC reaches every removed scheme after restart', async ({
  browserName: _browserName,
}, info) => {
  test.setTimeout(90_000);
  const directory = mkdtempSync(join(tmpdir(), 'musefold-scheme-v9-upgrade-'));
  let app: ElectronApplication | undefined;
  const filename = designSchemeDbPath(directory);
  const db = new Database(filename);
  runDesignSchemeDbMigrations(db, designSchemeDbMigrations.slice(0, 9));
  const now = Date.now() - 1000;
  const imports = join(directory, 'design-scheme-imports', `dsch_${'a'.repeat(32)}`);
  mkdirSync(imports, { recursive: true });
  const imageBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWPQCKj4DwADhAHwSz0dzwAAAABJRU5ErkJggg==',
    'base64',
  );
  const retainedPath = join(imports, 'retained.png'),
    exclusivePath = join(imports, 'exclusive.png');
  writeFileSync(retainedPath, imageBytes);
  writeFileSync(exclusivePath, imageBytes);
  db.transaction(() => {
    for (let index = 0; index < 222; index++) {
      const id = `scheme_${String(index).padStart(3, '0')}`;
      const revision = `revision_${index}`;
      const doc = {
        schemaVersion: 1,
        schemeId: id,
        revisionId: revision,
        name: `Archived scheme ${index}`,
        summary: 'Old database pagination fixture',
        fidelity: 'adapted',
        sources: [],
        inputs: [{ id: 'subject', label: 'Subject', kind: 'text', required: true }],
        parameters: [],
        constraints: [],
        promptProgram: [
          {
            id: 'prompt',
            order: 0,
            kind: 'input-template',
            template: '{{subject}}',
            variables: ['subject'],
            sourceIds: [],
          },
        ],
        compilation: {
          compiledAt: now,
          model: { model: 'fixture', connectionName: 'fixture' },
          adopted: [],
          omitted: [],
          warnings: [],
          trace: [],
        },
      };
      db.prepare(`INSERT INTO design_schemes
        (id, name, status, source_presentation, current_revision_id, fidelity, created_at, updated_at, deleted_at, version)
        VALUES (?, ?, 'draft', 'musefold-created', ?, 'adapted', ?, ?, ?, ?)`).run(
        id,
        doc.name,
        revision,
        now,
        now + (index % 3),
        index < 221 ? now : null,
        index < 221 ? 2 : 1,
      );
      db.prepare(`INSERT INTO design_scheme_revisions
        (revision_id, scheme_id, schema_version, document_json, created_by, created_at)
        VALUES (?, ?, 1, ?, 'user', ?)`).run(revision, id, JSON.stringify(doc), now);
    }
    db.exec(`INSERT INTO design_scheme_runs
      (run_id, revision_id, mode, status, policy_json, provider_json, created_at, completed_at)
      VALUES ('retained-run', 'revision_0', 'trial', 'completed', '{"cost":42}', '{"model":"original"}', 10, 20);
      INSERT INTO design_scheme_run_steps (run_id, step_id, status, input_json, output_json)
      VALUES ('retained-run', 'image', 'completed', '{"jobId":"original"}', '{"historyId":"original-image","assetId":"retained-result"}');
      INSERT INTO design_scheme_evaluations (evaluation_id, run_id, passed, metrics_json, evidence_json, created_at)
      VALUES ('evaluation', 'retained-run', 1, '{"score":1}', '["original-image"]', 20);`);
    for (const [id, path] of [
      ['retained-result', retainedPath],
      ['exclusive-asset', exclusivePath],
    ]) {
      db.prepare(`INSERT INTO design_scheme_assets(id,revision_id,store_key,role,origin,created_at)
        VALUES (?,'revision_0',?,'example','local-run',10)`).run(id, path);
    }
  })();
  const expected = db
    .prepare(
      'SELECT id FROM design_schemes WHERE deleted_at IS NOT NULL ORDER BY updated_at DESC, id COLLATE BINARY DESC',
    )
    .all() as Array<{ id: string }>;
  const steps = db.prepare('SELECT * FROM design_scheme_run_steps').all();
  const evaluations = db.prepare('SELECT * FROM design_scheme_evaluations').all();
  db.close();
  try {
    app = (await launchV25App('musefold-scheme-v9-upgrade-', directory)).app;
    const firstPid = app.process().pid;
    const page = await v25ShellPage(app);
    expect(await allRemoved(page)).toEqual(expected.map((row) => row.id));
    expect(
      (await invoke<DesignSchemePage>(page, 'designSchemes.list', {})).items.map((item) => item.id),
    ).toEqual(['scheme_221']);
    await app.close();
    app = undefined;
    const upgraded = new Database(filename, { readonly: true });
    try {
      expect(upgraded.pragma('user_version', { simple: true })).toBe(
        DESIGN_SCHEME_DB_SCHEMA_VERSION,
      );
      expect(upgraded.pragma('foreign_key_check')).toEqual([]);
      expect(upgraded.prepare('SELECT * FROM design_scheme_run_steps').all()).toEqual(steps);
      expect(upgraded.prepare('SELECT * FROM design_scheme_evaluations').all()).toEqual(
        evaluations,
      );
      expect(
        upgraded
          .prepare(
            'SELECT origin_scheme_id, origin_revision_id, policy_json FROM design_scheme_runs',
          )
          .get(),
      ).toEqual({
        origin_scheme_id: 'scheme_000',
        origin_revision_id: 'revision_0',
        policy_json: '{"cost":42}',
      });
    } finally {
      upgraded.close();
    }
    app = (await launchV25App('musefold-scheme-v10-restart-', directory)).app;
    const secondPid = app.process().pid;
    expect(secondPid).not.toBe(firstPid);
    const restartedPage = await v25ShellPage(app);
    expect(await allRemoved(restartedPage)).toEqual(expected.map((row) => row.id));
    await restartedPage.getByTestId('nav-design-schemes').click();
    await restartedPage.getByTestId('scheme-trash-open').click();
    await expect(restartedPage.getByTestId('scheme-trash-count')).toHaveText('已加载 20+ 个方案');
    for (let index = 1; index <= 11; index++) {
      await restartedPage.getByTestId('scheme-trash-load-more').click();
      await expect(restartedPage.getByTestId('scheme-trash-count')).toHaveText(
        `已加载 ${Math.min((index + 1) * 20, 221)}${index < 11 ? '+' : ''} 个方案`,
      );
    }
    await expect(restartedPage.getByTestId('scheme-trash-row-scheme_221')).toHaveCount(0);
    const trigger = restartedPage.getByTestId('scheme-trash-purge-scheme_000');
    await trigger.click();
    await expect(restartedPage.getByRole('alertdialog')).toContainText('费用记录仍保留');
    await restartedPage
      .getByRole('alertdialog')
      .screenshot({ path: info.outputPath('desktop-scheme-purge-confirm.png') });
    await restartedPage.getByRole('button', { name: '取消', exact: true }).click();
    await expect(trigger).toBeFocused();
    expect(existsSync(exclusivePath)).toBe(true);
    await trigger.click();
    await restartedPage.getByTestId('scheme-trash-confirm').click();
    await expect(restartedPage.getByTestId('scheme-trash-row-scheme_000')).toHaveCount(0);
    await expect.poll(() => existsSync(exclusivePath)).toBe(false);
    expect(readFileSync(retainedPath)).toEqual(imageBytes);
    const receipt = await invoke(restartedPage, 'designSchemes.purge', {
      schemeId: 'scheme_000',
      expectedVersion: 2,
    });
    expect(receipt).toEqual({
      schemeId: 'scheme_000',
      purged: true,
      retiredKeys: 1,
      deferredKeys: 1,
    });
    await app.close();
    app = undefined;
    const purgedDb = new Database(filename, { readonly: true });
    try {
      expect(purgedDb.prepare('SELECT * FROM design_scheme_run_steps').all()).toEqual(steps);
      expect(purgedDb.prepare('SELECT * FROM design_scheme_evaluations').all()).toEqual(
        evaluations,
      );
      expect(
        purgedDb
          .prepare(
            'SELECT revision_id,origin_scheme_id,origin_revision_id,policy_json FROM design_scheme_runs',
          )
          .get(),
      ).toEqual({
        revision_id: null,
        origin_scheme_id: 'scheme_000',
        origin_revision_id: 'revision_0',
        policy_json: '{"cost":42}',
      });
      expect(purgedDb.pragma('foreign_key_check')).toEqual([]);
    } finally {
      purgedDb.close();
    }
    app = (await launchV25App('musefold-scheme-purge-restart-', directory)).app;
    const thirdPid = app.process().pid;
    expect(thirdPid).not.toBe(secondPid);
    const finalPage = await v25ShellPage(app);
    expect(await allRemoved(finalPage)).toEqual(
      expected.map((row) => row.id).filter((id) => id !== 'scheme_000'),
    );
    expect(
      await invoke(finalPage, 'designSchemes.purge', {
        schemeId: 'scheme_000',
        expectedVersion: 2,
      }),
    ).toEqual(receipt);
    // Renderer CSP intentionally allows media as images, not arbitrary connect-src fetches.
    // Exercise its actual image path, then hash the same registered protocol's bytes in main.
    const media = await app.evaluate(async ({ net }) => {
      const response = await net.fetch('media://scheme-asset/retained-result');
      return {
        status: response.status,
        bytes: Array.from(new Uint8Array(await response.arrayBuffer())),
      };
    });
    expect(media.status).toBe(200);
    const dimensions = await finalPage.evaluate(async () => {
      const image = new Image();
      image.src = 'media://scheme-asset/retained-result';
      await image.decode();
      return { width: image.naturalWidth, height: image.naturalHeight };
    });
    expect(dimensions).toEqual({ width: 1, height: 1 });
    expect(Buffer.from(media.bytes)).toEqual(imageBytes);
    await info.attach('actual-scheme-upgrade-and-pagination', {
      body: JSON.stringify({
        firstPid,
        secondPid,
        thirdPid,
        schemaBefore: 9,
        schemaAfter: DESIGN_SCHEME_DB_SCHEMA_VERSION,
        removed: 221,
        retainedActive: 1,
        stepsPreserved: true,
        evaluationsPreserved: true,
        permanentlyDeleted: 1,
        retainedResultSha256: createHash('sha256').update(imageBytes).digest('hex'),
        repeatedReceipt: receipt,
      }),
      contentType: 'application/json',
    });
  } finally {
    await app?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
