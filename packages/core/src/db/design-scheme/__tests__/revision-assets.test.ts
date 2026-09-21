import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { DesignSchemeRevisionDocument } from '@musefold/desktop-contracts/design-scheme/schema';
import { runDesignSchemeDbMigrations } from '../migrations';
import { DesignSchemeRepository } from '../repositories';
import { readRevisionAssetIds } from '../revision-assets';

const document = (schemeId = 'scheme', revisionId = 'base'): DesignSchemeRevisionDocument => ({
  schemaVersion: 1,
  schemeId,
  revisionId,
  name: '素材继承',
  summary: '固定引用',
  fidelity: 'adapted',
  sources: [],
  inputs: [],
  parameters: [],
  constraints: [],
  promptProgram: [
    {
      id: 'prompt',
      order: 0,
      kind: 'input-template',
      template: 'Draw',
      variables: [],
      sourceIds: [],
    },
  ],
  compilation: {
    compiledAt: 0,
    model: { model: 'fixture' },
    adopted: [],
    omitted: [],
    warnings: [],
    trace: [],
  },
});
const metadata = {
  mimeType: 'image/png',
  width: 1,
  height: 1,
  byteSize: 10,
  contentHash: 'a'.repeat(64),
};
let db: Database.Database;
let repo: DesignSchemeRepository;
let asset: string;
beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runDesignSchemeDbMigrations(db);
  repo = new DesignSchemeRepository(db);
  repo.insertSchemeDraft({
    document: document(),
    createdBy: 'user',
    bindings: [],
    sourceLabel: '',
    sourcePresentation: 'musefold-created',
  });
  asset = repo.insertLocalRunAsset('base', 'managed/source.png', metadata);
});
afterEach(() => db.close());

it('retains original asset identity for a new revision without transferring cover or successful trial', () => {
  const before = repo.getRevisionDocument('base');
  repo.insertRun({ runId: 'old-trial', revisionId: 'base', mode: 'trial', policy: {} });
  repo.updateRunStatus('old-trial', 'completed');
  repo.applyAgentRevision('scheme', 'base', { ...document('scheme', 'next'), assetIds: [asset] });
  expect(readRevisionAssetIds(db, 'scheme', 'next')).toEqual([asset]);
  expect(repo.getRevisionDocument('base')).toEqual(before);
  expect(() => repo.selectCover('scheme', asset)).toThrow();
  expect(() => repo.formalize('scheme')).toThrow();
  expect(repo.requireSummary('scheme').hasSuccessfulTrial).toBe(false);
});
it('legacy revisions without declarations expose only their own assets, not unrelated old versions', () => {
  expect(readRevisionAssetIds(db, 'scheme', 'base')).toEqual([asset]);
  repo.applyAgentRevision('scheme', 'base', document('scheme', 'next'));
  expect(readRevisionAssetIds(db, 'scheme', 'next')).toEqual([]);
  expect(() =>
    repo.applyAgentRevision('scheme', 'next', {
      ...document('scheme', 'forged'),
      assetIds: [asset],
    }),
  ).toThrow('基线之外');
  expect(repo.getRevisionDocument('forged')).toBeNull();
});
it('rejects another scheme even when its asset ID is supplied as an explicit declaration', () => {
  repo.insertSchemeDraft({
    document: document('other', 'other-base'),
    createdBy: 'user',
    bindings: [],
    sourceLabel: '',
    sourcePresentation: 'musefold-created',
  });
  const foreign = repo.insertLocalRunAsset('other-base', 'managed/foreign.png', metadata);
  expect(() =>
    repo.applyAgentRevision('scheme', 'base', {
      ...document('scheme', 'forged'),
      assetIds: [foreign],
    }),
  ).toThrow('基线之外');
  db.prepare('UPDATE design_scheme_revisions SET document_json = ? WHERE revision_id = ?').run(
    JSON.stringify({ ...document(), assetIds: [foreign] }),
    'base',
  );
  expect(() => readRevisionAssetIds(db, 'scheme', 'base')).toThrow('其他方案');
});
it('missing or duplicated declared assets fail rather than silently exporting a smaller package', () => {
  for (const assetIds of [[asset, asset], ['missing']]) {
    db.prepare('UPDATE design_scheme_revisions SET document_json = ? WHERE revision_id = ?').run(
      JSON.stringify({ ...document(), assetIds }),
      'base',
    );
    expect(() => readRevisionAssetIds(db, 'scheme', 'base')).toThrow();
  }
});
it('asset insertion failure rolls back revision creation and current pointer', () => {
  db.exec(
    "CREATE TRIGGER fail_new_asset BEFORE INSERT ON design_scheme_assets WHEN NEW.id = 'asset_new' BEGIN SELECT RAISE(ABORT, 'asset fault'); END",
  );
  const before = repo.requireSummary('scheme');
  expect(() =>
    repo.applyAgentRevision(
      'scheme',
      'base',
      { ...document('scheme', 'next'), assetIds: [asset, 'asset_new'] },
      [],
      undefined,
      [
        {
          id: 'asset_new',
          ...metadata,
          origin: 'repository',
          role: 'reference',
          license: null,
          createdAt: 1,
          storeKey: 'managed/new.png',
        },
      ],
    ),
  ).toThrow('asset fault');
  expect(repo.getRevisionDocument('next')).toBeNull();
  expect(repo.requireSummary('scheme')).toEqual(before);
  expect(readRevisionAssetIds(db, 'scheme', 'base')).toEqual([asset]);
});

it('repository assigns actual creator and exact parent instead of retaining imported or caller lineage', () => {
  repo.insertSchemeDraft({
    document: { ...document('lineage', 'first'), createdBy: 'import', parentRevisionId: 'foreign' },
    sourceLabel: '本机',
    sourcePresentation: 'musefold-created',
    createdBy: 'user',
    bindings: [],
  });
  const first = repo.getRevisionDocument('first');
  expect(first).toMatchObject({
    createdBy: 'user',
    parentRevisionId: null,
    createdAt: expect.any(Number),
  });
  const edited = repo.updateRevisionInputs('lineage', 'first', []);
  expect(edited.document).toMatchObject({ createdBy: 'user', parentRevisionId: 'first' });
  const modified = repo.applyAgentRevision('lineage', edited.document.revisionId, {
    ...edited.document,
    revisionId: 'third',
    createdBy: 'import',
    parentRevisionId: 'foreign',
  });
  expect(modified.document).toMatchObject({
    createdBy: 'agent',
    parentRevisionId: edited.document.revisionId,
  });
  expect(repo.getRevisionDocument('first')).toEqual(first);
});
it('old document metadata comes from existing revision columns without guessing a parent or rewriting JSON', () => {
  const original = JSON.stringify(document());
  db.prepare(
    "UPDATE design_scheme_revisions SET document_json = ?, created_by = 'import', created_at = 123 WHERE revision_id = 'base'",
  ).run(original);
  const value = repo.getRevisionDocument('base');
  expect(value).toMatchObject({ createdBy: 'import', createdAt: 123 });
  expect(value?.parentRevisionId).toBeUndefined();
  expect(
    db
      .prepare("SELECT document_json FROM design_scheme_revisions WHERE revision_id = 'base'")
      .get(),
  ).toEqual({ document_json: original });
});
