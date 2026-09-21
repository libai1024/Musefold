import { execFile } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { aiProviderSchema } from '@musefold/contracts';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { type ElectronApplication, expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { seedFormalTextScheme } from './design-scheme-test-helpers';
import { desktopDbPath, launchV25App, v25ShellPage } from './electron-helpers';
import { localExecutionFixture, localInvoke } from './local-execution-fixture';

const execute = promisify(execFile);
const root = resolve(import.meta.dirname, '../..');
// Build exactly the distributed CLI/MCP entries before starting the test-owned app.
test.beforeAll(async () => {
  await execute(process.execPath, ['scripts/build-cli.mjs'], { cwd: root, timeout: 30000 });
});

test('实际 CLI 与 MCP stdio 的 G/R/S：自备成功，旧账号付款未绑定均拒绝且无发送', async () => {
  test.setTimeout(90000);
  const fixture = await localExecutionFixture();
  let app: ElectronApplication | undefined;
  let userData = '';
  const mcp = new Client({ name: 'musefold-local-test', version: '1.0' });
  let transport: StdioClientTransport | undefined;
  try {
    const first = await launchV25App('musefold-agent-clients-', { env: fixture.env });
    app = first.app;
    userData = first.userDataDir;
    let page = await v25ShellPage(app);
    const byok = aiProviderSchema.parse(
      await localInvoke(page, 'aiProviders.create', {
        name: '自备',
        baseUrl: `${fixture.baseUrl}/v1`,
        model: 'fixture-a',
        apiKey: 'synthetic-a',
        activate: true,
      }),
    );
    const legacy = aiProviderSchema.parse(
      await localInvoke(page, 'aiProviders.create', {
        name: '旧账号',
        baseUrl: `${fixture.baseUrl}/v1`,
        model: 'fixture-a',
        apiKey: 'synthetic-a',
      }),
    );
    await localInvoke(page, 'agentConnections.create', {
      name: '文本自备',
      baseUrl: `${fixture.baseUrl}/v1`,
      model: 'fixture-text',
      apiKey: 'synthetic-text',
      activate: true,
    });
    await app.close();
    app = undefined;
    const db = new Database(desktopDbPath(userData));
    db.prepare("UPDATE providers SET managed_by = 'account' WHERE id = ?").run(legacy.id);
    db.close();
    seedFormalTextScheme(userData);
    ({ app } = await launchV25App('musefold-agent-clients-', {
      reuseUserDataDir: userData,
      env: fixture.env,
    }));
    page = await v25ShellPage(app);
    const discovery = JSON.parse(readFileSync(join(userData, 'automation.json'), 'utf8')) as {
      port: number;
      token: string;
    };
    const env: Record<string, string> = Object.fromEntries(
      Object.entries(process.env).filter((pair): pair is [string, string] => pair[1] !== undefined),
    );
    Object.assign(env, {
      MUSEFOLD_ENDPOINT: `http://127.0.0.1:${discovery.port}`,
      MUSEFOLD_TOKEN: discovery.token,
      MUSEFOLD_AUTOSTART: '0',
    });
    const cli = async (args: string[]) => {
      try {
        const result = await execute(
          process.execPath,
          [join(root, 'packages/cli/dist/musefold.mjs'), ...args, '--json', '-y'],
          { cwd: root, env, timeout: 20000, maxBuffer: 1024 * 1024 },
        );
        return { code: 0, stdout: result.stdout };
      } catch (error) {
        const failure = error as { code?: unknown; stdout?: string };
        if (typeof failure.code !== 'number') throw error;
        return { code: failure.code, stdout: failure.stdout ?? '' };
      }
    };
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(root, 'packages/mcp/dist/musefold-mcp.mjs')],
      cwd: root,
      env,
      stderr: 'pipe',
    });
    await mcp.connect(transport);
    for (const [provider, allowed] of [
      [byok, true],
      [legacy, false],
    ] as const) {
      await localInvoke(page, 'aiProviders.setActive', { id: provider.id });
      const before = { image: fixture.imageCalls.length, text: fixture.textCalls.length };
      for (const args of [
        ['generate', '-p', 'client G fixture'],
        ['scheme', 'run', 'scheme_e2e_formal', '--input', 'topic=client R fixture'],
        ['skill', 'run', 'https://github.com/fixture/visual', '-p', 'client S fixture'],
      ]) {
        const result = await cli(args);
        if (allowed) {
          expect(result.code).toBe(0);
          const last = JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '{}');
          expect(last).toMatchObject({ type: 'result', status: 'success' });
        } else {
          expect(result.code).not.toBe(0);
          expect(result.stdout).toContain('PAYMENT_IDENTITY_UNBOUND');
        }
      }
      for (const request of [
        { name: 'generate_image', arguments: { prompt: 'MCP G fixture' } },
        {
          name: 'run_scheme',
          arguments: { schemeId: 'scheme_e2e_formal', inputs: { topic: 'MCP R fixture' } },
        },
        {
          name: 'run_github_skill',
          arguments: { url: 'https://github.com/fixture/visual', prompt: 'MCP S fixture' },
        },
      ]) {
        const result = await mcp.callTool(request);
        const blocks = result.content as Array<{ type: string; text?: string }>;
        const value = JSON.parse(blocks.find((block) => block.type === 'text')?.text ?? '{}');
        if (allowed) {
          expect(result.isError).not.toBe(true);
          expect(value.status).toBe('success');
        } else {
          expect(result.isError).toBe(true);
          expect(value.error?.code).toBe('PAYMENT_IDENTITY_UNBOUND');
        }
      }
      expect(fixture.imageCalls).toHaveLength(before.image + (allowed ? 6 : 0));
      expect(fixture.textCalls).toHaveLength(before.text + (allowed ? 2 : 0));
    }
    expect(fixture.imageCredentials).toEqual(Array(6).fill('a'));
    expect(fixture.cloudCreates).toEqual([]);
  } finally {
    await mcp.close();
    await transport?.close();
    await app?.close();
    if (userData) rmSync(userData, { recursive: true, force: true });
    await fixture.close();
  }
});
