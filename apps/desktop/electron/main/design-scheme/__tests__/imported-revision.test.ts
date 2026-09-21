import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix, win32 } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DESIGN_SCHEME_WIRE_METHODS, designSchemeDetailSchema } from '@musefold/contracts';
import { takeoverDesktopDatabase } from '@musefold/desktop-db';
import { writeDesignSchemePackageBytes } from '@musefold/scheme-package';
import { DesignSchemeRepository } from '@musefold/core/db/design-scheme/repositories';
import { runDesignSchemeDbMigrations } from '@musefold/core/db/design-scheme/migrations';
import {
  mixedPackage,
  refreshDocument,
  PNG,
} from '../../../../../../packages/scheme-package/src/__tests__/fixtures';
import { DesignSchemeModifySession } from '../modify-session';
import { checkSchemeUpdate } from '../update-check';
import { updatedSourceAssetStoreKey } from '../update-materials';
import { exportDesignScheme, importDesignScheme } from '../share';
import { readValidatedDesignSchemePackage, sha256 } from '../package-archive';
import { buildDesignSchemesDomainMethods } from '../../ipc-v25/design-scheme-domain';
import type { OpenAiCompatibleTextAdapter } from '../text-adapter';

const resolveSource = vi.hoisted(() => vi.fn());
it('更新素材路径兼容Windows分隔符，拒绝跨盘和受管目录外文件', () => {
  expect(
    updatedSourceAssetStoreKey('C:\\Musefold', 'C:\\Musefold\\sources\\style.png', win32),
  ).toBe('sources/style.png');
  expect(updatedSourceAssetStoreKey('/musefold', '/musefold/sources/style.png', posix)).toBe(
    'sources/style.png',
  );
  for (const candidate of [
    'D:\\Musefold\\style.png',
    'C:\\Musefold-other\\style.png',
    'C:\\Musefold\\..\\style.png',
    'C:\\Musefold',
  ])
    expect(() => updatedSourceAssetStoreKey('C:\\Musefold', candidate, win32)).toThrow();
  for (const candidate of ['/musefold-other/style.png', '/musefold/../style.png', '/musefold'])
    expect(() => updatedSourceAssetStoreKey('/musefold', candidate, posix)).toThrow();
});
vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }));
vi.mock('../source-ingestion', async (original) => ({
  ...(await original<typeof import('../source-ingestion')>()),
  resolveGithubSource: resolveSource,
}));

const revised = {
  name: '修订后的混合来源',
  summary: '保留固定历史与参考图片',
  fidelity: 'adapted',
  inputs: [{ label: '参考图', kind: 'image', required: false, imageRole: 'style-reference' }],
  constraints: [],
  promptProgram: [
    { kind: 'input-template', template: 'Draw with the retained sources', variables: [] },
    { kind: 'style-rule', template: 'Keep palette', variables: [] },
  ],
  adopted: [],
  omitted: [],
  warnings: [],
  creationSummary: '调整文字，保留来源素材。',
};
const analyst = {
  repoKind: 'agent-skill',
  capabilitySummary: '最新配色',
  rules: [],
  variables: [],
  referenceImages: [{ path: 'style.png', role: 'style-reference' }],
  unsupported: [],
};
let adoptImages = true;
function adapter(): OpenAiCompatibleTextAdapter {
  return {
    modelId: 'test-model',
    connectionName: 'test-connection',
    complete: async (request) => {
      modelRequests.push(request.user);
      return {
        text: JSON.stringify(
          request.system.includes('仓库分析师')
            ? { ...analyst, referenceImages: adoptImages ? analyst.referenceImages : [] }
            : revised,
        ),
        model: 'test-model',
      };
    },
  } as OpenAiCompatibleTextAdapter;
}
let db: Database.Database;
let root: string;
let repository: DesignSchemeRepository;
let coreDb: Database.Database;
const modelRequests: string[] = [];
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'musefold-imported-revision-'));
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runDesignSchemeDbMigrations(db);
  repository = new DesignSchemeRepository(db);
  resolveSource.mockReset();
  adoptImages = true;
  modelRequests.length = 0;
  coreDb = new Database(':memory:');
  takeoverDesktopDatabase(coreDb);
  coreDb
    .prepare(`INSERT INTO providers (id, name, type, base_url, model, created_at, updated_at)
    VALUES ('provider-import', 'Fixture', 'openai-compatible', 'https://fixture.invalid/v1', 'image-model', 1, 1)`)
    .run();
});
afterEach(() => {
  db.close();
  coreDb.close();
  rmSync(root, { recursive: true, force: true });
});

async function importMixed(configure?: (fixture: ReturnType<typeof mixedPackage>) => void) {
  const fixture = mixedPackage();
  configure?.(fixture);
  const { manifest, content } = fixture;
  const input = join(root, 'source.musefold.design');
  writeFileSync(input, await writeDesignSchemePackageBytes(manifest, content));
  const result = await importDesignScheme(input, { db, userDataDir: root });
  if (!result.ok) throw new Error(result.error.message);
  const document = repository.getRevisionDocument(result.data.revisionId);
  if (!document) throw new Error('Missing imported document');
  return { ...result.data, document };
}
async function detail(id: string) {
  const method = buildDesignSchemesDomainMethods({ db, userDataDir: root, picturesDir: root })[
    DESIGN_SCHEME_WIRE_METHODS.get
  ];
  return designSchemeDetailSchema.parse(await method.handle(method.input.parse({ id })));
}
async function prepareImage(id: string, revisionId: string, assetId: string) {
  const method = buildDesignSchemesDomainMethods({
    db,
    coreDb,
    userDataDir: root,
    picturesDir: root,
    resolveUploadedReference: () => null,
  })[DESIGN_SCHEME_WIRE_METHODS.prepareRun];
  return method.handle(
    method.input.parse({
      executionId: 'prepare-imported',
      schemeId: id,
      revisionId,
      mode: 'trial',
      brief: '',
      inputValues: {},
      executionSettings: {
        providerId: 'provider-import',
        size: '1024x1024',
        quality: 'high',
        outputCount: 1,
        referenceAssetIds: [assetId],
        promptReferenceSelections: [],
      },
    }),
  );
}
async function exportCurrent(id: string) {
  // Fixture eligibility only; real trial/formalization is tested separately, never inherited from import.
  db.prepare("UPDATE design_schemes SET status = 'formal' WHERE id = ?").run(id);
  const path = join(root, 'revised.musefold.design');
  const result = await exportDesignScheme(id, path, { db, userDataDir: root, picturesDir: root });
  if (!result.ok) throw new Error(result.error.message);
  const parsed = await readValidatedDesignSchemePackage(path, [2]);
  if (parsed.formatVersion !== 2) throw new Error('Expected canonical package');
  const imported = await importDesignScheme(path, { db, userDataDir: root, picturesDir: root });
  if (!imported.ok) throw new Error(imported.error.message);
  expect(imported.data.scheme.status).toBe('draft');
  expect(imported.data.scheme.hasSuccessfulTrial).toBe(false);
  return parsed;
}

it('import → modify → IPC/export → import retains declared images, exact history and source identities', async () => {
  const base = await importMixed();
  expect(base.document).toMatchObject({ createdBy: 'import', parentRevisionId: null });
  const result = await new DesignSchemeModifySession(
    {
      executionId: 'modify-import',
      schemeId: base.scheme.id,
      baseRevisionId: base.revisionId,
      instruction: '调整文字，保留原素材',
    },
    { db, resolveAdapter: adapter, emit: () => {} },
  ).run();
  if (!result.ok) throw new Error(result.error.message);
  const next = await detail(base.scheme.id);
  expect(next.document).toMatchObject({ createdBy: 'agent', parentRevisionId: base.revisionId });
  expect(next.document.assetIds).toEqual(base.document.assetIds);
  expect(next.document.repositoryImages).toEqual(base.document.repositoryImages);
  expect(next.document.sourceSnapshotIds).toEqual(base.document.sourceSnapshotIds);
  expect(repository.getRevisionDocument(base.revisionId)).toEqual(base.document);
  await expect(
    prepareImage(base.scheme.id, next.document.revisionId, next.document.assetIds[0]),
  ).resolves.toMatchObject({ revisionId: next.document.revisionId });
  const parsed = await exportCurrent(base.scheme.id);
  expect(parsed.manifest.document).toMatchObject({
    createdBy: 'agent',
    parentRevisionId: base.revisionId,
  });
  expect(parsed.manifest.document.assetIds).toEqual(
    expect.arrayContaining(base.document.assetIds ?? []),
  );
  expect(parsed.manifest.document.repositoryImages).toEqual(base.document.repositoryImages);
  const history = parsed.manifest.sourceSnapshots.find((source) => source.kind === 'history');
  expect(history?.historyItems?.[0].prompt).toBe('原始提示词\nKeep all selected text.');
  for (const asset of parsed.manifest.assets) {
    const entry = parsed.manifest.content.entries.find((item) => item.assetId === asset.id);
    expect(entry && parsed.entries.get(entry.relativePath)).toEqual(PNG);
  }
});

function setUpstream() {
  const text = '# Updated palette';
  resolveSource.mockResolvedValue({
    ok: true,
    data: {
      repositoryUrl: 'https://github.com/example/design',
      repositoryLabel: 'example/design',
      name: 'Updated design',
      description: 'Fixture',
      resolvedRef: 'main',
      commitHash: 'e'.repeat(40),
      license: null,
      otherCount: 0,
      textFiles: [
        {
          path: 'SKILL.md',
          text,
          sizeBytes: Buffer.byteLength(text),
          contentHash: sha256(Buffer.from(text)),
        },
      ],
      imageFiles: [{ relativePath: 'style.png', bytes: PNG, contentHash: sha256(PNG) }],
    },
  });
}

it('import → upstream update replaces only changed repository source and images, preserving history and old version', async () => {
  const base = await importMixed();
  setUpstream();
  const result = await checkSchemeUpdate(base.scheme.id, {
    db,
    resolveAdapter: adapter,
    userDataDir: root,
  });
  if (!result.ok) throw new Error(result.error.message);
  expect(result.data.status).toBe('draft-created');
  expect(modelRequests.some((text) => text.includes('原始提示词\nKeep all selected text.'))).toBe(
    true,
  );
  const next = await detail(base.scheme.id);
  expect(next.document.repositoryImages).toHaveLength(1);
  expect(next.document.repositoryImages?.[0].snapshotId).not.toBe(
    base.document.repositoryImages?.[0].snapshotId,
  );
  const historyId = base.document.assetIds?.find(
    (id) => id !== base.document.repositoryImages?.[0].assetId,
  );
  expect(next.document.assetIds).toContain(historyId);
  expect(next.document.assetIds).not.toContain(base.document.repositoryImages?.[0].assetId);
  expect(repository.getRevisionDocument(base.revisionId)).toEqual(base.document);
  await expect(
    prepareImage(base.scheme.id, next.document.revisionId, next.document.assetIds[0]),
  ).resolves.toMatchObject({ revisionId: next.document.revisionId });
  const parsed = await exportCurrent(base.scheme.id);
  expect(parsed.manifest.sourceSnapshots.filter((source) => source.kind === 'github')).toHaveLength(
    1,
  );
  expect(
    parsed.manifest.sourceSnapshots.find((source) => source.kind === 'history')?.historyItems?.[0]
      .prompt,
  ).toBe('原始提示词\nKeep all selected text.');
  expect(parsed.manifest.document.repositoryImages).toEqual(next.document.repositoryImages);
});

it('formal import modification keeps current/exported version while requiring a new local trial for its working draft', async () => {
  const base = await importMixed();
  db.prepare("UPDATE design_schemes SET status = 'formal' WHERE id = ?").run(base.scheme.id);
  const result = await new DesignSchemeModifySession(
    {
      executionId: 'formal-modify',
      schemeId: base.scheme.id,
      baseRevisionId: base.revisionId,
      instruction: '修改文字',
    },
    { db, resolveAdapter: adapter, emit: () => {} },
  ).run();
  if (!result.ok) throw new Error(result.error.message);
  expect(result.data.scheme.currentRevisionId).toBe(base.revisionId);
  expect(result.data.scheme.workingDraftRevisionId).toBe(result.data.revisionId);
  expect(() => repository.promoteWorkingDraft(base.scheme.id)).toThrow();
  const parsed = await exportCurrent(base.scheme.id);
  expect(parsed.manifest.revisionId).toBe(base.revisionId);
  expect(parsed.manifest.document.repositoryImages).toEqual(base.document.repositoryImages);
});

it('upstream selecting no images removes only replaced repository adoption and still exports the history image and full prompt', async () => {
  const base = await importMixed();
  setUpstream();
  adoptImages = false;
  const result = await checkSchemeUpdate(base.scheme.id, {
    db,
    resolveAdapter: adapter,
    userDataDir: root,
  });
  if (!result.ok) throw new Error(result.error.message);
  const next = await detail(base.scheme.id);
  expect(next.document.repositoryImages).toEqual([]);
  expect(next.document.assetIds).toHaveLength(1);
  expect(next.document.assetIds).not.toContain(base.document.repositoryImages?.[0].assetId);
  const parsed = await exportCurrent(base.scheme.id);
  expect(parsed.manifest.assets).toHaveLength(1);
  expect(parsed.manifest.assets[0].origin).toBe('cloud-run');
  expect(
    parsed.manifest.sourceSnapshots.find((source) => source.kind === 'history')?.historyItems?.[0]
      .prompt,
  ).toBe('原始提示词\nKeep all selected text.');
});

it('update asset publication fault rolls back new DB state and removes only the new source directory', async () => {
  const base = await importMixed();
  setUpstream();
  const count = () =>
    ['design_scheme_revisions', 'source_snapshots', 'design_scheme_assets'].map((table) =>
      db.prepare(`SELECT count(*) AS n FROM ${table}`).get(),
    );
  const before = count();
  const summary = repository.requireSummary(base.scheme.id);
  db.exec(
    "CREATE TRIGGER fail_asset BEFORE INSERT ON design_scheme_assets WHEN NEW.origin = 'repository' BEGIN SELECT RAISE(ABORT, 'publication fault'); END",
  );
  const result = await checkSchemeUpdate(base.scheme.id, {
    db,
    resolveAdapter: adapter,
    userDataDir: root,
  });
  expect(result.ok).toBe(false);
  expect(count()).toEqual(before);
  expect(repository.requireSummary(base.scheme.id)).toEqual(summary);
  const sources = join(root, 'design-scheme-sources');
  expect(existsSync(sources) ? readdirSync(sources) : []).toEqual([]);
  // The fault injection is confined to update publication; allow the independent re-import.
  db.exec('DROP TRIGGER fail_asset');
  // Original imported files are still readable by the complete package exporter.
  const parsed = await exportCurrent(base.scheme.id);
  expect(parsed.manifest.document.repositoryImages).toEqual(base.document.repositoryImages);
});

it('imported share-import snapshot kind survives SQLite metadata, actual IPC and export', async () => {
  const imported = await importMixed(({ manifest, content }) => {
    const snapshot = manifest.sourceSnapshots[1];
    snapshot.kind = 'share-import';
    delete snapshot.historyItems;
    manifest.document.sources[1].kind = 'user-brief';
    refreshDocument(manifest, content);
  });
  const saved = repository.listSourceSnapshotMetadata(imported.scheme.id);
  expect(saved.some((source) => source.packageKind === 'share-import')).toBe(true);
  const loaded = await detail(imported.scheme.id);
  expect(loaded.sourceSnapshots.some((source) => source.kind === 'share-import')).toBe(true);
  const exported = await exportCurrent(imported.scheme.id);
  expect(exported.manifest.sourceSnapshots.some((source) => source.kind === 'share-import')).toBe(
    true,
  );
});
