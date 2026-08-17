// CLI 本地专属命令（provider/backup/export/prompt rm）：
// 真实质询协议全链路（CLI 读质询文件回证 → 服务端校验放行）。

import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createEventHub } from '@musefold/core';
import {
  createAutomationServer,
  createLocalRoutes,
  type AutomationServer,
  type AutomationServerInfo,
  type LocalAdminOps,
} from '@musefold/automation-server';
import { runCli, EXIT } from '../index';

let dir: string;
let server: AutomationServer;
let info: AutomationServerInfo;
let ops: LocalAdminOps & { setProviderKey: ReturnType<typeof vi.fn>; deletePrompt: ReturnType<typeof vi.fn> };
const setupBodies: unknown[] = [];

function capture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, io: { stdout: (l: string) => stdout.push(l), stderr: (l: string) => stderr.push(l) } };
}

function run(argv: string[], io: ReturnType<typeof capture>, env: Record<string, string> = {}) {
  return runCli(
    [...argv, '--endpoint', `http://127.0.0.1:${info.port}`, '--token', info.token],
    io.io,
    { MUSEFOLD_DATA_DIR: dir, ...env },
  );
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'musefold-cli-local-'));
  ops = {
    createProvider: vi.fn((input: unknown) => ({ id: 'prov-cli', ...(input as object) })),
    setProviderKey: vi.fn(() => ({ ok: true, keySuffix: 'zz42' })),
    deleteProvider: vi.fn(() => ({ ok: true })),
    setActiveProvider: vi.fn(() => ({ ok: true })),
    validateProvider: vi.fn(async () => ({ ok: true })),
    backupNow: vi.fn(async () => ({ path: '/tmp/cli-backup.db' })),
    listBackups: vi.fn(async () => ({ backups: [{ file: 'db-1.db', createdAt: 1 }] })),
    restoreBackup: vi.fn(async () => ({ safetyBackupPath: '/tmp/safety.db' })),
    exportLibrary: vi.fn(async () => ({ path: '/tmp/cli-export.json' })),
    importLibrary: vi.fn(async () => ({ imported: 2 })),
    deletePrompt: vi.fn(() => ({ ok: true, trashed: 'prompt-1' })),
  };
  server = createAutomationServer({
    core: { version: '0.1.0', status: { snapshot: () => ({ prompts: 0, formalSchemes: 0, providers: 0, activeProviderId: null }) } },
    events: createEventHub(),
    dataDir: dir,
    owner: 'desktop-app',
    appVersion: 'x',
    capabilities: { setup: true },
    routes: {
      ...createLocalRoutes(dir, ops).routes,
      'GET /v1/setup/status': () => ({
        account: { configured: false, health: 'unknown', serverKind: 'default' },
        providers: [],
        activeProviderId: null,
      }),
      'POST /v1/setup/open': ({ body }) => {
        setupBodies.push(body);
        return { opened: true, requestId: 'cli-setup', kind: (body as { kind: string }).kind, message: '已打开 Musefold 原生配置页' };
      },
    },
  });
  info = await server.start();
});

afterAll(async () => {
  await server.stop();
  rmSync(dir, { recursive: true, force: true });
});

describe('CLI 本地专属命令', () => {
  it('account/provider setup 只打开原生表单，不接受凭据', async () => {
    const status = capture();
    expect(await run(['account', 'status', '--json'], status)).toBe(EXIT.OK);
    expect(JSON.parse(status.stdout[0])).toMatchObject({ account: { configured: false } });

    const account = capture();
    expect(await run(['account', 'register'], account)).toBe(EXIT.OK);
    expect(setupBodies.at(-1)).toEqual({ kind: 'account', mode: 'register' });

    const provider = capture();
    expect(await run([
      'provider', 'setup', '--name', 'CLI 新站', '--base-url', 'https://relay.example/v1', '--model', 'image-v2',
    ], provider)).toBe(EXIT.OK);
    expect(setupBodies.at(-1)).toEqual({
      kind: 'provider',
      draft: { name: 'CLI 新站', baseUrl: 'https://relay.example/v1', model: 'image-v2' },
    });
    expect(JSON.stringify(setupBodies)).not.toMatch(/apiKey|password|token|secret/i);
  });

  it('provider add --use：经质询通道创建', async () => {
    const io = capture();
    const code = await run(['provider', 'add', '--name', 'CLI站', '--base-url', 'https://x.example/v1', '--model', 'm', '--use'], io);
    expect(code).toBe(EXIT.OK);
    expect(io.stdout[0]).toBe('prov-cli');
    expect(ops.createProvider).toHaveBeenCalledWith(expect.objectContaining({ name: 'CLI站', isActive: true }));
  });

  it('provider set-key --from-env：密钥不经 argv', async () => {
    const io = capture();
    const code = await run(['provider', 'set-key', 'prov-cli', '--from-env', 'TEST_MUSEFOLD_KEY'], io, { TEST_MUSEFOLD_KEY: 'sk-from-env' });
    expect(code).toBe(EXIT.OK);
    expect(ops.setProviderKey).toHaveBeenCalledWith('prov-cli', 'sk-from-env');
    expect(io.stdout.join()).toContain('zz42');
  });

  it('provider set-key 无密钥来源（非 TTY）→ exit 2 并给出安全指引', async () => {
    const io = capture();
    const code = await run(['provider', 'set-key', 'prov-cli'], io);
    expect(code).toBe(EXIT.ARGS);
    expect(io.stderr.join()).toContain('拒绝 argv 明文');
    expect(ops.setProviderKey).toHaveBeenCalledTimes(1); // 未新增调用
  });

  it('prompt rm：无 --force 仅预览；--force 移入回收站', async () => {
    const preview = capture();
    expect(await run(['prompt', 'rm', 'prompt-1'], preview)).toBe(EXIT.OK);
    expect(ops.deletePrompt).not.toHaveBeenCalled();
    expect(preview.stderr.join()).toContain('--force');

    const removed = capture();
    expect(await run(['prompt', 'rm', 'prompt-1', '--force'], removed)).toBe(EXIT.OK);
    expect(ops.deletePrompt).toHaveBeenCalledWith('prompt-1');
  });

  it('backup now / list / restore --force + export', async () => {
    const now = capture();
    expect(await run(['backup', 'now'], now)).toBe(EXIT.OK);
    expect(now.stdout[0]).toBe('/tmp/cli-backup.db');

    const list = capture();
    expect(await run(['backup', 'list', '--json'], list)).toBe(EXIT.OK);
    expect(JSON.parse(list.stdout[0]).backups).toHaveLength(1);

    const restore = capture();
    expect(await run(['backup', 'restore', 'db-1.db', '--force'], restore)).toBe(EXIT.OK);
    expect(restore.stdout.join()).toContain('/tmp/safety.db');

    const exported = capture();
    expect(await run(['export', '-o', '/tmp/out.json'], exported)).toBe(EXIT.OK);
    expect(ops.exportLibrary).toHaveBeenCalledWith(expect.objectContaining({ targetPath: '/tmp/out.json' }));
  });

  it('无 dataDir（显式 endpoint 且无 MUSEFOLD_DATA_DIR）→ 本地命令报错', async () => {
    const io = capture();
    const code = await runCli(
      ['backup', 'now', '--endpoint', `http://127.0.0.1:${info.port}`, '--token', info.token],
      io.io,
      {},
    );
    expect(code).not.toBe(EXIT.OK);
  });
});
