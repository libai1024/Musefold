import { DesignSchemeRepository } from '@musefold/core/db/design-scheme/repositories';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { type ElectronApplication, expect, test } from '@playwright/test';
import {
  createDesignSchemeResultSchema,
  designSchemeDetailSchema,
  importDesignSchemeResultSchema,
  prepareDesignSchemeImportPackageResultSchema,
} from '@musefold/contracts';
import {
  readValidatedDesignSchemePackage,
  writeDesignSchemePackageBytes,
} from '@musefold/scheme-package';
import { mixedPackage, PNG } from '../../packages/scheme-package/src/__tests__/fixtures';
import { designSchemeDbPath, launchV25App, v25ShellPage } from './electron-helpers';
import { localInvoke as invoke } from './local-execution-fixture';

/** Real archive/staging/main-process role/SQLite/new PID; synthetic loopback text model only. */
test('导入混合包 → 修改 → 新 PID 导出再导入保留素材及历史正文', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'musefold-import-revision-e2e-'));
  const input = join(temp, 'input.musefold.design');
  const output = join(temp, 'output.musefold.design');
  const fixture = mixedPackage();
  writeFileSync(input, await writeDesignSchemePackageBytes(fixture.manifest, fixture.content));
  let calls = 0;
  const server = createServer(async (request, response) => {
    const parts: Buffer[] = [];
    for await (const chunk of request) parts.push(Buffer.from(chunk));
    response.setHeader('content-type', 'application/json');
    if (
      request.method !== 'POST' ||
      request.url !== '/v1/chat/completions' ||
      request.headers.authorization !== 'Bearer synthetic-import-model'
    ) {
      response.writeHead(400).end('{}');
      return;
    }
    calls++;
    const body = JSON.parse(Buffer.concat(parts).toString());
    const isReviser = body.messages[0]?.content.includes('Scheme Reviser');
    response.end(
      JSON.stringify({
        model: 'import-model',
        choices: [
          {
            message: {
              content: JSON.stringify({
                name: '修改后的导入方案',
                summary: '保留固定历史和仓库素材',
                fidelity: 'adapted',
                inputs: [
                  { label: '参考图', kind: 'image', required: false, imageRole: 'style-reference' },
                ],
                constraints: [],
                promptProgram: [
                  { kind: 'input-template', template: 'Draw the revised tree', variables: [] },
                  { kind: 'style-rule', template: 'Keep the palette', variables: [] },
                ],
                adopted: [],
                omitted: [],
                warnings: [],
                creationSummary: isReviser ? '修改已完成，请重新试运行。' : 'unexpected role',
              }),
            },
          },
        ],
      }),
    );
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture port');
  let app: ElectronApplication | undefined;
  let userDataDir = '';
  const env = { MUSEFOLD_E2E_DESIGN_IMPORT_PATH: input, MUSEFOLD_E2E_DESIGN_EXPORT_PATH: output };
  try {
    const launch = await launchV25App('musefold-import-revision-', { env });
    app = launch.app;
    userDataDir = launch.userDataDir;
    let page = await v25ShellPage(app);
    const prepare = async () =>
      prepareDesignSchemeImportPackageResultSchema.parse(
        await page.evaluate(async () => {
          const bridge = (
            window as unknown as {
              musefoldV25: {
                prepareDesignSchemeImportPackage(
                  input: unknown,
                ): Promise<{ ok: boolean; data?: unknown; message?: string }>;
              };
            }
          ).musefoldV25;
          const result = await bridge.prepareDesignSchemeImportPackage({
            acceptedFormatVersions: [2],
          });
          if (!result.ok) throw new Error(result.message ?? 'Package staging failed');
          return result.data;
        }),
      );
    const staged = await prepare();
    if (staged.status !== 'staged') throw new Error('Expected staged package');
    const imported = importDesignSchemeResultSchema.parse(
      await invoke(page, 'designSchemes.importPackage', {
        stagedPackageId: staged.stagedPackageId,
        packageHash: staged.packageHash,
        formatVersion: staged.formatVersion,
      }),
    );
    const before = designSchemeDetailSchema.parse(
      await invoke(page, 'designSchemes.get', { id: imported.scheme.id }),
    );
    expect(before.document).toMatchObject({ createdBy: 'import', parentRevisionId: null });
    await invoke(page, 'agentConnections.create', {
      name: '导入修订模型',
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      model: 'import-model',
      apiKey: 'synthetic-import-model',
      activate: true,
    });
    const modified = createDesignSchemeResultSchema.parse(
      await invoke(page, 'designSchemes.modify', {
        executionId: 'import-modify',
        schemeId: imported.scheme.id,
        baseRevisionId: imported.revisionId,
        instruction: '调整树木描述，保留原素材',
      }),
    );
    expect(modified.document).toMatchObject({
      createdBy: 'agent',
      parentRevisionId: imported.revisionId,
    });
    expect(modified.document.assetIds).toEqual(before.document.assetIds);
    expect(modified.document.repositoryImages).toEqual(before.document.repositoryImages);
    expect(calls).toBe(1);
    const firstPid = app.process().pid;
    await app.close();
    app = undefined;
    // Explicit export-eligibility fixture only: this is not a paid generation or a successful trial.
    const db = new Database(designSchemeDbPath(userDataDir));
    let fixtureCover: string;
    try {
      const repo = new DesignSchemeRepository(db);
      const imagePath = join(userDataDir, 'fixture-cover.png');
      writeFileSync(imagePath, PNG);
      repo.insertRun({
        runId: 'fixture-trial',
        revisionId: modified.document.revisionId,
        mode: 'trial',
        policy: {},
      });
      repo.updateRunStatus('fixture-trial', 'completed');
      fixtureCover = repo.insertLocalRunAsset(modified.document.revisionId, imagePath);
      repo.selectCover(imported.scheme.id, fixtureCover);
      repo.formalize(imported.scheme.id);
    } finally {
      db.close();
    }
    ({ app } = await launchV25App('musefold-import-revision-', {
      reuseUserDataDir: userDataDir,
      env: { ...env, MUSEFOLD_E2E_DESIGN_IMPORT_PATH: output },
    }));
    expect(app.process().pid).not.toBe(firstPid);
    page = await v25ShellPage(app);
    const restored = designSchemeDetailSchema.parse(
      await invoke(page, 'designSchemes.get', { id: imported.scheme.id }),
    );
    expect(restored.document).toEqual(modified.document);
    await invoke(page, 'designSchemes.exportPackage', {
      schemeId: imported.scheme.id,
      revisionId: modified.document.revisionId,
      formatVersion: 2,
    });
    const archive = await readValidatedDesignSchemePackage(output, [2]);
    if (archive.formatVersion !== 2) throw new Error('Expected canonical archive');
    expect(archive.manifest.document).toMatchObject({
      createdBy: 'agent',
      parentRevisionId: imported.revisionId,
    });
    expect(archive.manifest.assets.map((asset) => asset.id).sort()).toEqual(
      [...before.document.assetIds, fixtureCover].sort(),
    );
    expect(
      archive.manifest.sourceSnapshots.find((source) => source.kind === 'history')
        ?.historyItems?.[0].prompt,
    ).toBe('原始提示词\nKeep all selected text.');
    const stagedAgain = await prepare();
    if (stagedAgain.status !== 'staged') throw new Error('Expected staged export');
    const again = importDesignSchemeResultSchema.parse(
      await invoke(page, 'designSchemes.importPackage', {
        stagedPackageId: stagedAgain.stagedPackageId,
        packageHash: stagedAgain.packageHash,
        formatVersion: stagedAgain.formatVersion,
      }),
    );
    expect(again.scheme.status).toBe('draft');
    expect(again.scheme.hasSuccessfulTrial).toBe(false);
    const reimported = designSchemeDetailSchema.parse(
      await invoke(page, 'designSchemes.get', { id: again.scheme.id }),
    );
    expect(reimported.document).toMatchObject({ createdBy: 'import', parentRevisionId: null });
    expect(reimported.document.assetIds).toHaveLength(3);
    expect(reimported.document.assetIds.some((id) => before.document.assetIds.includes(id))).toBe(
      false,
    );
    expect(
      reimported.sourceSnapshots.find((source) => source.kind === 'history')?.historyItems?.[0]
        .prompt,
    ).toBe('原始提示词\nKeep all selected text.');
    expect(calls).toBe(1);
  } finally {
    await app?.close();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    if (userDataDir) rmSync(userDataDir, { recursive: true, force: true });
    rmSync(temp, { recursive: true, force: true });
  }
});
