// stdio 产物验收（V04-MCP-SERVER-SPEC §7）：对真实单文件二进制说 JSON-RPC。
// 覆盖：握手、tools/list headless 目录形状（20 工具）、musefold_status 调用、
// stdout 零日志污染（逐帧必须是合法 JSON-RPC）、--readonly 裁剪、降级目录。

import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEventHub } from '@musefold/core';
import { createAutomationServer, type AutomationServer, type AutomationServerInfo } from '@musefold/automation-server';

const repoRoot = resolve(__dirname, '../../../..');
const binaryPath = resolve(repoRoot, 'packages/mcp/dist/musefold-mcp.mjs');

let dir: string;
let server: AutomationServer;
let info: AutomationServerInfo;

interface RpcSession {
  child: ChildProcessWithoutNullStreams;
  send(message: Record<string, unknown>): void;
  next(): Promise<Record<string, unknown>>;
  stdoutRaw: string[];
  stderr: string[];
  close(): void;
}

function openSession(env: Record<string, string>, args: string[] = []): RpcSession {
  const child = spawn(process.execPath, [binaryPath, ...args], {
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stdoutRaw: string[] = [];
  const stderr: string[] = [];
  const queue: Array<Record<string, unknown>> = [];
  const waiters: Array<(message: Record<string, unknown>) => void> = [];
  let buffer = '';
  child.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      stdoutRaw.push(line);
      const parsed = JSON.parse(line) as Record<string, unknown>; // 非 JSON 即抛错 → 污染专项失败
      const waiter = waiters.shift();
      if (waiter) waiter(parsed);
      else queue.push(parsed);
    }
  });
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk.toString('utf8')));
  return {
    child,
    stdoutRaw,
    stderr,
    send(message) {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    },
    next() {
      const queued = queue.shift();
      if (queued) return Promise.resolve(queued);
      return new Promise((resolveNext, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`等待 JSON-RPC 响应超时；stderr=${stderr.join('')}`)),
          15_000,
        );
        waiters.push((message) => {
          clearTimeout(timer);
          resolveNext(message);
        });
      });
    },
    close() {
      child.kill();
    },
  };
}

async function handshake(session: RpcSession): Promise<void> {
  session.send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'stdio-acceptance', version: '1.0.0' },
    },
  });
  const initialized = await session.next();
  expect(initialized).toMatchObject({ id: 1 });
  expect((initialized.result as { serverInfo: { name: string } }).serverInfo.name).toBe('musefold');
  session.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
}

async function listToolNames(session: RpcSession): Promise<string[]> {
  session.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const listed = await session.next();
  return (listed.result as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name);
}

beforeAll(async () => {
  // 保证产物是最新源码
  execFileSync(process.execPath, [resolve(repoRoot, 'scripts/build-cli.mjs')], { stdio: 'ignore' });
  expect(existsSync(binaryPath)).toBe(true);

  dir = mkdtempSync(join(tmpdir(), 'musefold-stdio-'));
  server = createAutomationServer({
    core: {
      version: '0.1.0',
      status: { snapshot: () => ({ prompts: 7, formalSchemes: 0, providers: 1, activeProviderId: 'tvt' }) },
    },
    events: createEventHub(),
    dataDir: dir,
    owner: 'desktop-app',
    appVersion: '0.4.0-dev',
  });
  info = await server.start();
}, 30_000);

afterAll(async () => {
  await server.stop();
  rmSync(dir, { recursive: true, force: true });
});

const connectedEnv = () => ({
  MUSEFOLD_ENDPOINT: `http://127.0.0.1:${info.port}`,
  MUSEFOLD_TOKEN: info.token,
});

describe('musefold-mcp stdio 产物', () => {
  it('握手 + tools/list：headless 16 个工具，stdout 全程零污染', async () => {
    const session = openSession(connectedEnv());
    try {
      await handshake(session);
      const names = await listToolNames(session);
      expect(names).toHaveLength(16);

      session.send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'musefold_status', arguments: {} } });
      const status = await session.next();
      const text = (status.result as { content: Array<{ type: string; text?: string }> }).content[0].text!;
      expect(JSON.parse(text)).toMatchObject({ connected: true, owner: 'desktop-app' });

      // 污染专项：所有 stdout 帧都已被 JSON.parse 校验；日志只出现在 stderr
      expect(session.stdoutRaw.length).toBeGreaterThanOrEqual(3);
      expect(session.stderr.join('')).toContain('stdio server ready');
    } finally {
      session.close();
    }
  }, 30_000);

  it('--readonly：目录中不存在写/花钱工具', async () => {
    const session = openSession(connectedEnv(), ['--readonly']);
    try {
      await handshake(session);
      const names = await listToolNames(session);
      for (const forbidden of ['generate_image', 'save_prompt', 'run_scheme', 'run_github_skill', 'cancel_generation']) {
        expect(names).not.toContain(forbidden);
      }
      expect(names).toContain('search_prompts');
    } finally {
      session.close();
    }
  }, 30_000);

  it('降级目录：控制面不可达时只注册 musefold_status', async () => {
    const session = openSession({ MUSEFOLD_ENDPOINT: 'http://127.0.0.1:9', MUSEFOLD_TOKEN: 'mf_at_nope' });
    try {
      await handshake(session);
      expect(await listToolNames(session)).toEqual(['musefold_status']);
    } finally {
      session.close();
    }
  }, 30_000);
});
