// MCP 幂等键测试（GAPX/GAP-B1）：generate_image / run_scheme / run_github_skill 三个写工具
// 的 inputSchema 暴露 idempotencyKey 字段并透传为 Idempotency-Key header；
// G 走真实闸门钉死重放不重发 / 同键异输入 409 / 无键兼容；R/S 用桩路由钉死 header 契约。
// 沿用 mcp-server.test.ts 的 InMemoryTransport + SDK Client 模式。

import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createEventHub } from '@musefold/core';
import type { GenerateImageResult } from '@musefold/desktop-contracts/providers';
import {
  createAutomationServer,
  createGenerationGate,
  type AutomationRouteContext,
  type AutomationServer,
  type AutomationServerInfo,
} from '@musefold/automation-server';
import { createMusefoldMcpServer, type McpServerOptions } from '../server';

let root: string;
let httpServer: AutomationServer;
let info: AutomationServerInfo;
const runSpy = vi.fn();

const schemeRuns: Array<{ key: string | undefined; body: Record<string, unknown> }> = [];
const skillRuns: Array<{ key: string | undefined; body: Record<string, unknown> }> = [];

function firstHeader(context: AutomationRouteContext, name: string): string | undefined {
  const value = context.request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

async function mcpClient(options: Partial<McpServerOptions> = {}) {
  const { server } = await createMusefoldMcpServer({
    endpoint: `http://127.0.0.1:${info.port}`,
    token: info.token,
    logger: () => {},
    ...options,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function parseText(result: unknown): any {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content;
  const text = content?.find((item) => item.type === 'text')?.text ?? '{}';
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'musefold-mcp-idem-'));
  const hub = createEventHub();
  const gate = createGenerationGate(
    {
      run: runSpy.mockImplementation(
        async (req: { jobId?: string }): Promise<GenerateImageResult> => ({
          historyId: req.jobId ?? 'his-mcp-idem',
          status: 'success',
          imagePath: join(root, 'out.png'),
          cost: 20,
          durationMs: 5,
        }),
      ),
      cancel: () => true,
      estimate: () => ({
        points: 20,
        managedByAccount: true,
        providerId: 'prov-mcp-idem',
        providerName: '幂等测试站',
        model: 'gpt-image-2',
        n: 1,
      }),
      budget: { remainingPoints: () => 10_000, settle: () => {} },
      requestConfirmation: async () => 'approved' as const,
      authorizeReferencePath: () => true,
      stageUpload: async (bytes: Buffer, name: string) => ({
        path: join(root, name),
        name,
        source: 'upload' as const,
        mimeType: 'image/png' as const,
        sizeBytes: bytes.length,
      }),
      resolveHistoryImage: () => null,
    },
    hub,
  );

  httpServer = createAutomationServer({
    core: {
      version: '0.1.0',
      status: {
        snapshot: () => ({ prompts: 0, formalSchemes: 0, providers: 0, activeProviderId: null }),
      },
    },
    events: hub,
    dataDir: root,
    owner: 'desktop-app',
    appVersion: '0.4.0-dev',
    rateLimit: 1000,
    generationRateLimit: 1000,
    routes: {
      ...gate.routes,
      'POST /v1/schemes/:id/runs': (context) => {
        schemeRuns.push({
          key: firstHeader(context, 'idempotency-key'),
          body: context.body as Record<string, unknown>,
        });
        return { jobId: `sch-${schemeRuns.length}`, status: 'running' };
      },
      'GET /v1/scheme-runs/:id': ({ params }) => ({
        jobId: params.id,
        status: 'success',
        assets: [],
      }),
      'POST /v1/skills/github/run': (context) => {
        skillRuns.push({
          key: firstHeader(context, 'idempotency-key'),
          body: context.body as Record<string, unknown>,
        });
        return { jobId: `skl-${skillRuns.length}`, status: 'running' };
      },
      'GET /v1/skill-runs/:id': ({ params }) => ({
        jobId: params.id,
        status: 'success',
        assets: [],
      }),
    },
  });
  info = await httpServer.start();
});

afterAll(async () => {
  await httpServer.stop();
  rmSync(root, { recursive: true, force: true });
});

describe('musefold-mcp 幂等键 schema', () => {
  it('三个写工具 inputSchema 都暴露 idempotencyKey', async () => {
    const client = await mcpClient();
    const { tools } = await client.listTools();
    for (const name of ['generate_image', 'run_scheme', 'run_github_skill']) {
      const tool = tools.find((item) => item.name === name);
      expect(tool, `${name} 应在目录中`).toBeTruthy();
      const schema = tool!.inputSchema as { properties?: Record<string, unknown> };
      expect(schema.properties?.idempotencyKey, `${name} 应有 idempotencyKey`).toBeTruthy();
    }
    await client.close();
  });
});

describe('musefold-mcp generate_image（G：真实闸门）', () => {
  it('同键同输入两次调用：重放原任务，Provider 只执行一次', async () => {
    const client = await mcpClient();
    const args = { prompt: 'MCP 幂等重放', wait: false, idempotencyKey: 'mcp-gen-1' };
    const first = parseText(await client.callTool({ name: 'generate_image', arguments: args }));
    const replay = parseText(await client.callTool({ name: 'generate_image', arguments: args }));
    expect(replay.jobId).toBe(first.jobId);
    expect(runSpy).toHaveBeenCalledOnce();
    await client.close();
  });

  it('同键异输入：isError 且错误码 IDEMPOTENCY_CONFLICT', async () => {
    const client = await mcpClient();
    const base = { wait: false, idempotencyKey: 'mcp-gen-2' };
    await client.callTool({
      name: 'generate_image',
      arguments: { ...base, prompt: '原始意图' },
    });
    const result = await client.callTool({
      name: 'generate_image',
      arguments: { ...base, prompt: '换了意图' },
    });
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(parseText(result).error.code).toBe('IDEMPOTENCY_CONFLICT');
    await client.close();
  });

  it('无键兼容：两次调用各自执行', async () => {
    const client = await mcpClient();
    const before = runSpy.mock.calls.length;
    for (const prompt of ['无键甲', '无键乙']) {
      const submitted = parseText(
        await client.callTool({ name: 'generate_image', arguments: { prompt, wait: false } }),
      );
      expect(submitted.jobId).toBeTruthy();
    }
    expect(runSpy.mock.calls.length).toBe(before + 2);
    await client.close();
  });
});

describe('musefold-mcp run_scheme / run_github_skill（R/S：header 透传）', () => {
  it('run_scheme 带 idempotencyKey：header 送达，键不混入 body', async () => {
    const client = await mcpClient();
    const result = await client.callTool({
      name: 'run_scheme',
      arguments: {
        schemeId: 'scheme-x',
        inputs: { a: 'b' },
        wait: false,
        idempotencyKey: 'mcp-r-1',
      },
    });
    expect((result as { isError?: boolean }).isError).not.toBe(true);
    expect(schemeRuns.at(-1)?.key).toBe('mcp-r-1');
    expect(schemeRuns.at(-1)?.body).toMatchObject({ inputs: { a: 'b' } });
    expect(schemeRuns.at(-1)?.body).not.toHaveProperty('idempotencyKey');
    await client.close();
  });

  it('run_scheme 不带键：header 缺席（既有无键行为）', async () => {
    const client = await mcpClient();
    await client.callTool({
      name: 'run_scheme',
      arguments: { schemeId: 'scheme-x', wait: false },
    });
    expect(schemeRuns.at(-1)?.key).toBeUndefined();
    await client.close();
  });

  it('run_github_skill 带 idempotencyKey：header 送达，键不混入 body', async () => {
    const client = await mcpClient();
    const result = await client.callTool({
      name: 'run_github_skill',
      arguments: {
        url: 'https://github.com/musefold/example',
        prompt: '样张',
        wait: false,
        idempotencyKey: 'mcp-s-1',
      },
    });
    expect((result as { isError?: boolean }).isError).not.toBe(true);
    expect(skillRuns.at(-1)?.key).toBe('mcp-s-1');
    expect(skillRuns.at(-1)?.body).toEqual({
      url: 'https://github.com/musefold/example',
      prompt: '样张',
    });
    await client.close();
  });

  it('run_github_skill 不带键：header 缺席（既有无键行为）', async () => {
    const client = await mcpClient();
    await client.callTool({
      name: 'run_github_skill',
      arguments: {
        url: 'https://github.com/musefold/example',
        prompt: '样张',
        wait: false,
      },
    });
    expect(skillRuns.at(-1)?.key).toBeUndefined();
    await client.close();
  });
});
