// CLI 骨架测试（V04-CLI-01）：对着真实控制面（内存 core 造数）跑命令函数，
// 断言退出码矩阵与 --json 输出契约。

import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEventHub, createMusefoldCore, type MusefoldCore } from '@musefold/core';
import { configureTestCoreRuntime } from '@musefold/core/testing';
import { closeDb, getDb, initDb } from '@musefold/core/db/index';
import { closeDesignSchemeDb, initDesignSchemeDb } from '@musefold/core/db/design-scheme';
import {
  createAutomationServer,
  createV1ReadRoutes,
  type AutomationServer,
  type AutomationServerInfo,
} from '@musefold/automation-server';
import { runCli, EXIT } from '../index';

let root: string;
let core: MusefoldCore;
let server: AutomationServer;
let info: AutomationServerInfo;

interface CapturedIo {
  stdout: string[];
  stderr: string[];
  io: { stdout(line: string): void; stderr(line: string): void };
}

function capture(): CapturedIo {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, io: { stdout: (line) => stdout.push(line), stderr: (line) => stderr.push(line) } };
}

function run(argv: string[], io: CapturedIo): Promise<number> {
  return runCli([...argv, '--endpoint', `http://127.0.0.1:${info.port}`, '--token', info.token], io.io, {});
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'musefold-cli-test-'));
  configureTestCoreRuntime(root);
  initDb();
  initDesignSchemeDb();

  core = createMusefoldCore({
    paths: { dataDir: root, picturesDir: join(root, 'Pictures'), logsDir: join(root, 'logs') },
    secrets: {
      getProviderKey: async () => null,
      setProviderKey: async () => undefined,
      deleteProviderKey: async () => undefined,
      getAiConnectionKey: async () => null,
      setAiConnectionKey: async () => undefined,
      deleteAiConnectionKey: async () => undefined,
    },
    events: { emit: () => undefined },
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  });

  core.library.create({ title: '玄鹤衔烛速记桩', content: 'cli test prompt body' });
  getDb().prepare(
    `INSERT INTO history (id, provider_id, model, prompt_text, status, cost, created_at)
     VALUES ('his-cli', 'prov-cli', 'gpt-image-2', 'cli history prompt', 'success', 12, 1000)`,
  ).run();
  server = createAutomationServer({
    core,
    events: createEventHub(),
    dataDir: root,
    owner: 'desktop-app',
    appVersion: '0.4.0-dev',
    routes: createV1ReadRoutes(core),
  });
  info = await server.start();
});

afterAll(async () => {
  await server.stop();
  closeDb();
  closeDesignSchemeDb();
  rmSync(root, { recursive: true, force: true });
});

describe('musefold CLI（P1 骨架）', () => {
  it('status --json：连接诊断输出稳定 JSON', async () => {
    const captured = capture();
    expect(await run(['status', '--json'], captured)).toBe(EXIT.OK);
    const payload = JSON.parse(captured.stdout[0]);
    expect(payload).toMatchObject({ type: 'result', connected: true, owner: 'desktop-app', apiVersion: 'v1' });
    // 初始迁移自带示例提示词，只断言包含本测试新建的那条
    expect(payload.data.prompts).toBeGreaterThanOrEqual(1);
  });

  it('prompt search --json 可管道；get 输出正文到 stdout', async () => {
    const list = capture();
    expect(await run(['prompt', 'search', '玄鹤衔烛速记桩', '--json'], list)).toBe(EXIT.OK);
    const parsed = JSON.parse(list.stdout[0]);
    expect(parsed.prompts).toHaveLength(1);

    const get = capture();
    expect(await run(['prompt', 'get', parsed.prompts[0].id], get)).toBe(EXIT.OK);
    expect(get.stdout).toEqual(['cli test prompt body']);
  });

  it('prompt add --title --body：写入并回显 id；缺参数 exit 2', async () => {
    const ok = capture();
    expect(await run(['prompt', 'add', '--title', '终端速记', '--body', 'from cli'], ok)).toBe(EXIT.OK);
    expect(ok.stdout[0]).toBeTruthy();

    const bad = capture();
    expect(await run(['prompt', 'add', '--title', '缺正文'], bad)).toBe(EXIT.ARGS);
  });

  it('history list/show 展示成本与状态', async () => {
    const list = capture();
    expect(await run(['history', 'list', '--json'], list)).toBe(EXIT.OK);
    expect(JSON.parse(list.stdout[0]).history[0]).toMatchObject({ id: 'his-cli', cost: 12 });

    const show = capture();
    expect(await run(['history', 'show', 'his-cli'], show)).toBe(EXIT.OK);
    expect(show.stdout.join('\n')).toContain('12 分');
  });

  it('退出码矩阵：未知命令 2 / 未知参数 2 / 连不上 3', async () => {
    const unknown = capture();
    expect(await run(['teleport'], unknown)).toBe(EXIT.ARGS);

    const badFlag = capture();
    expect(await run(['status', '--nope'], badFlag)).toBe(EXIT.ARGS);

    const offline = capture();
    const code = await runCli(
      ['status', '--endpoint', 'http://127.0.0.1:9', '--token', 'mf_at_none'],
      offline.io,
      {},
    );
    expect(code).toBe(EXIT.NOT_CONNECTED);
  });

  it('无发现文件且无显式 endpoint：exit 3 + 引导语', async () => {
    const captured = capture();
    const code = await runCli(['status'], captured.io, { MUSEFOLD_DATA_DIR: join(root, 'no-such-dir') });
    expect(code).toBe(EXIT.NOT_CONNECTED);
    expect(captured.stderr.join('\n')).toContain('设置 > 自动化');
  });
});
