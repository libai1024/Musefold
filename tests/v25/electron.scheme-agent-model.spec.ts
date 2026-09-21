import { createServer } from 'node:http';
import { rmSync } from 'node:fs';
import { createDesignSchemeResultSchema, designSchemeDetailSchema } from '@musefold/contracts';
import { type ElectronApplication, expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { designSchemeDbPath, launchV25App, v25ShellPage } from './electron-helpers';
import { localInvoke as invoke } from './local-execution-fixture';

/** Actual main-process role calls over loopback HTTP; no external model or account credentials. */
test('共享编译/修订角色在真实 Electron 中创建草稿、追加版本并在新 PID 重读', async () => {
  test.setTimeout(60_000);
  const calls: Array<{ model: string; messages: Array<{ role: string; content: string }> }> = [];
  const unexpected: string[] = [];
  const draft = (revised: boolean) => ({
    name: '共享角色海报',
    summary: revised ? '红色城市海报' : '黑白城市海报',
    fidelity: 'adapted',
    inputs: [
      { label: '主题', kind: 'text', required: true, variable: 'topic', id: 'untrusted-input' },
    ],
    constraints: [
      {
        domain: 'color',
        statement: revised ? '红色' : '黑白',
        mode: 'required',
        userOverridable: false,
        sourceIds: ['untrusted-source'],
      },
    ],
    promptProgram: [
      {
        kind: 'input-template',
        template: '{{topic}}',
        variables: ['topic'],
        id: 'untrusted-module',
        order: 99,
      },
      { kind: 'style-rule', template: revised ? '红色极简海报' : '黑白极简海报', variables: [] },
    ],
    creationSummary: revised ? '已修改配色，请重新试运行。' : '请提供主题并先试运行。',
    schemeId: 'untrusted-scheme',
    revisionId: 'untrusted-revision',
  });
  const server = createServer(async (request, response) => {
    const parts: Buffer[] = [];
    for await (const part of request) parts.push(Buffer.from(part));
    response.setHeader('content-type', 'application/json');
    if (
      request.url !== '/v1/chat/completions' ||
      request.method !== 'POST' ||
      request.headers.authorization !== 'Bearer synthetic-role-key'
    ) {
      unexpected.push(`${request.method} ${request.url}`);
      response.writeHead(400).end('{}');
      return;
    }
    const body = JSON.parse(Buffer.concat(parts).toString());
    calls.push(body);
    const revised = body.messages[0]?.content.includes('Scheme Reviser');
    response.end(
      JSON.stringify({
        model: 'fixture-role-model',
        choices: [{ message: { content: JSON.stringify(draft(revised)) } }],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing local fixture port');
  let app: ElectronApplication | undefined;
  let userDataDir = '';
  try {
    const started = await launchV25App('musefold-shared-roles-');
    app = started.app;
    userDataDir = started.userDataDir;
    let page = await v25ShellPage(app);
    await invoke(page, 'agentConnections.create', {
      name: '本地文本模型夹具',
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      model: 'fixture-role-model',
      apiKey: 'synthetic-role-key',
      activate: true,
    });
    const created = createDesignSchemeResultSchema.parse(
      await invoke(page, 'designSchemes.create', {
        executionId: 'role-create',
        brief: '制作城市海报',
        sourceUris: [],
        sourceBindings: [],
        sourceAssetIds: [],
      }),
    );
    expect(created.scheme.status).toBe('draft');
    expect(created.document.schemeId).not.toBe('untrusted-scheme');
    expect(created.document.inputs[0]?.id).toBe('topic');
    expect(created.document.promptProgram[0]?.order).toBe(0);
    expect(created.document.constraints[0]?.sourceIds).not.toContain('untrusted-source');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.model).toBe('fixture-role-model');
    expect(calls[0]?.messages[0]?.content).toContain('Scheme Compiler');
    expect(calls[0]?.messages[1]?.content).toContain('制作城市海报');

    const revised = createDesignSchemeResultSchema.parse(
      await invoke(page, 'designSchemes.modify', {
        executionId: 'role-modify',
        schemeId: created.scheme.id,
        baseRevisionId: created.document.revisionId,
        instruction: '改成红色',
      }),
    );
    expect(revised.scheme.id).toBe(created.scheme.id);
    expect(revised.document.revisionId).not.toBe(created.document.revisionId);
    expect(revised.document.constraints[0]?.statement).toBe('红色');
    expect(calls).toHaveLength(2);
    expect(calls[1]?.messages[0]?.content).toContain('Scheme Reviser');
    expect(calls[1]?.messages[1]?.content).toContain('改成红色');
    const firstPid = app.process().pid;
    await app.close();
    app = undefined;
    ({ app } = await launchV25App('musefold-shared-roles-', { reuseUserDataDir: userDataDir }));
    expect(app.process().pid).not.toBe(firstPid);
    page = await v25ShellPage(app);
    const restored = designSchemeDetailSchema.parse(
      await invoke(page, 'designSchemes.get', {
        id: created.scheme.id,
        revision: { kind: 'current' },
      }),
    );
    expect(restored.document).toEqual(revised.document);
    const db = new Database(designSchemeDbPath(userDataDir), { readonly: true });
    try {
      const row = db
        .prepare('SELECT document_json FROM design_scheme_revisions WHERE revision_id = ?')
        .get(created.document.revisionId) as { document_json: string };
      expect(JSON.parse(row.document_json).constraints[0].statement).toBe('黑白');
      expect(
        db
          .prepare('SELECT count(*) AS count FROM design_scheme_revisions WHERE scheme_id = ?')
          .get(created.scheme.id),
      ).toEqual({ count: 2 });
    } finally {
      db.close();
    }
    expect(calls).toHaveLength(2);
    expect(unexpected).toEqual([]);
  } finally {
    await app?.close().catch(() => undefined);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (userDataDir) rmSync(userDataDir, { recursive: true, force: true });
  }
});
