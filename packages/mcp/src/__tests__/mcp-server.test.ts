// MCP 服务器测试（V04-MCP-01/02/03）：InMemoryTransport + SDK Client 对着真实控制面。
// 覆盖：桌面目录形状、--readonly / --toolsets 裁剪、降级目录、
// 只读工具调用、generate_image 全链路（假生图宿主）、密钥红线。

import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createEventHub, createMusefoldCore, type MusefoldCore } from '@musefold/core';
import { configureTestCoreRuntime } from '@musefold/core/testing';
import { closeDb, getDb, initDb } from '@musefold/core/db/index';
import { closeDesignSchemeDb, initDesignSchemeDb } from '@musefold/core/db/design-scheme';
import {
  createAutomationServer,
  createGenerationGate,
  createV1ReadRoutes,
  type AutomationServer,
  type AutomationServerInfo,
} from '@musefold/automation-server';
import type { GenerateImageResult } from '@shared/types/providers';
import { createMusefoldMcpServer, type McpServerOptions } from '../server';

let root: string;
let core: MusefoldCore;
let httpServer: AutomationServer;
let info: AutomationServerInfo;
const setupOpenBodies: unknown[] = [];

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

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'musefold-mcp-test-'));
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

  core.library.create({ title: '青鸾照水样张', content: 'mcp test prompt body' });
  getDb().prepare(
    `INSERT INTO providers (id, name, type, base_url, model, has_key, key_suffix, is_active, created_at, updated_at)
     VALUES ('prov-mcp', 'MCP站', 'openai-compatible', 'https://mcp.example/v1', 'gpt-image-2', 1, 'zz99', 1, 1, 1)`,
  ).run();
  const hub = createEventHub();
  const mcpImagePaths = [1, 2, 3, 4].map((index) => join(root, index === 1 ? 'out.png' : `out-${index}.png`));
  const gate = createGenerationGate(
    {
      run: vi.fn(async (req: { jobId?: string }): Promise<GenerateImageResult> => ({
        historyId: req.jobId ?? 'his-mcp',
        status: 'success',
        imagePath: mcpImagePaths[0],
        images: mcpImagePaths.map((imagePath) => ({ imagePath })),
        cost: 20,
        durationMs: 5,
      })),
      cancel: () => true,
      estimate: () => ({ points: 2, providerId: 'prov-mcp', providerName: 'MCP站', model: 'gpt-image-2', n: 1 }),
      budget: { remainingPoints: () => 10_000, settle: () => {} },
      requestConfirmation: async () => 'approved' as const,
      authorizeReferencePath: () => true,
      stageUpload: async (bytes, name) => ({ path: join(root, name), name, source: 'upload', mimeType: 'image/png', sizeBytes: bytes.length }),
      resolveHistoryImage: () => null,
    },
    hub,
  );

  httpServer = createAutomationServer({
    core,
    events: hub,
    dataDir: root,
    owner: 'desktop-app',
    appVersion: '0.4.0-dev',
    capabilities: { setup: true },
    routes: {
      ...createV1ReadRoutes(core),
      ...gate.routes,
      'GET /v1/setup/status': () => ({
        account: { configured: false, health: 'unknown', serverKind: 'default' },
        providers: [{ id: 'prov-mcp', name: 'MCP站', type: 'openai-compatible', model: 'gpt-image-2', isActive: true, managedBy: null, available: true }],
        activeProviderId: 'prov-mcp',
      }),
      'POST /v1/setup/open': ({ body }) => {
        setupOpenBodies.push(body);
        return { opened: true, requestId: 'setup-mcp', kind: (body as { kind: string }).kind, message: '已打开原生配置页' };
      },
      'POST /v1/setup/providers/:id/activate': ({ params }) => ({
        selected: { id: params.id, name: 'MCP站', available: true, isActive: true },
      }),
    },
  });
  info = await httpServer.start();
});

afterAll(async () => {
  await httpServer.stop();
  closeDb();
  closeDesignSchemeDb();
  rmSync(root, { recursive: true, force: true });
});

function parseText(result: unknown): any {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content;
  const text = content?.find((item) => item.type === 'text')?.text ?? '{}';
  try { return JSON.parse(text); } catch { return text; }
}

describe('musefold-mcp', () => {
  it('桌面全量目录：20 个工具 + resources + prompts', async () => {
    const client = await mcpClient();
    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name).sort();
    expect(names).toEqual([
      'cancel_generation', 'compile_scheme_prompt', 'generate_image',
      'get_generation', 'get_prompt', 'get_scheme',
      'get_setup_status', 'list_history', 'list_provider_models', 'list_providers', 'list_schemes',
      'musefold_status', 'run_github_skill', 'run_scheme',
      'open_account_setup', 'open_provider_setup', 'save_prompt', 'search_prompts',
      'select_provider', 'wait_for_generation',
    ].sort());
    expect(names).toHaveLength(20);

    const prompts = await client.listPrompts();
    expect(prompts.prompts.map((prompt) => prompt.name).sort()).toEqual(['refine-last']);
    await client.close();
  });

  it('--readonly：目录中不存在写/花钱工具（而非运行时拒绝）', async () => {
    const client = await mcpClient({ readonly: true });
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    for (const forbidden of ['generate_image', 'save_prompt', 'run_scheme', 'run_github_skill', 'cancel_generation', 'open_account_setup', 'open_provider_setup', 'select_provider']) {
      expect(names).not.toContain(forbidden);
    }
    expect(names).toContain('search_prompts');
    expect(names).toContain('get_setup_status');
    await client.close();
  });

  it('--toolsets 裁剪：只保留指定组 + musefold_status', async () => {
    const client = await mcpClient({ toolsets: ['library', 'history'] });
    const names = (await client.listTools()).tools.map((tool) => tool.name).sort();
    expect(names).toEqual(['get_prompt', 'list_history', 'musefold_status', 'save_prompt', 'search_prompts']);
    await client.close();
  });

  it('降级目录：控制面不可达时只有 musefold_status，返回引导', async () => {
    const client = await mcpClient({ endpoint: 'http://127.0.0.1:9', token: 'mf_at_nope' });
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toEqual(['musefold_status']);
    const status = parseText(await client.callTool({ name: 'musefold_status', arguments: {} }));
    expect(status.connected === false || status.error).toBeTruthy();
    await client.close();
  });

  it('search_prompts / list_providers（密钥红线）', async () => {
    const client = await mcpClient();
    const found = parseText(await client.callTool({ name: 'search_prompts', arguments: { query: '青鸾照水样张' } }));
    // FTS 中文分词可能命中种子示例，只断言目标提示词在结果中
    expect(found.prompts.some((prompt: { title: string }) => prompt.title === '青鸾照水样张')).toBe(true);

    const providers = parseText(await client.callTool({ name: 'list_providers', arguments: {} }));
    expect(providers.providers[0].hasKey).toBe(true);
    expect(JSON.stringify(providers)).not.toContain('zz99'); // keySuffix 不出 MCP 面
    await client.close();
  });

  it('generate_image：wait=true 阻塞到完成并返回 ResourceLink', async () => {
    const client = await mcpClient();
    const result = await client.callTool({ name: 'generate_image', arguments: { prompt: '一张 MCP 测试图', wait: true } });
    const payload = parseText(result as never);
    expect(payload.status).toBe('success');
    expect(payload.costPoints).toBe(20);
    const links = (result as { content: Array<{ type: string; uri?: string }> }).content.filter((item) => item.type === 'resource_link');
    expect(payload.assets).toHaveLength(4);
    expect(links).toHaveLength(4);
    expect(links[0].uri).toContain('out.png');
    await client.close();
  });

  it('generate_image：wait=false 提交即返回 jobId，wait_for_generation 一次等待终态', async () => {
    const client = await mcpClient();
    const submitted = parseText(await client.callTool({ name: 'generate_image', arguments: { prompt: '轮询路径', wait: false } }));
    expect(submitted.jobId).toBeTruthy();
    const detail = parseText(await client.callTool({ name: 'wait_for_generation', arguments: { jobId: submitted.jobId } }));
    expect(detail.status).toBe('success');
    await client.close();
  });

  it('安全配置工具只传非敏感草稿，并可选择已配置 Provider', async () => {
    const client = await mcpClient();
    const status = parseText(await client.callTool({ name: 'get_setup_status', arguments: {} }));
    expect(status).toMatchObject({ account: { configured: false }, activeProviderId: 'prov-mcp' });
    expect(JSON.stringify(status)).not.toMatch(/username|serverUrl|keySuffix|token|password/i);

    const opened = parseText(await client.callTool({
      name: 'open_provider_setup',
      arguments: { name: '新站', baseUrl: 'https://relay.example/v1', model: 'image-model' },
    }));
    expect(opened.opened).toBe(true);
    expect(setupOpenBodies.at(-1)).toEqual({
      kind: 'provider',
      draft: { name: '新站', baseUrl: 'https://relay.example/v1', model: 'image-model' },
    });
    expect(JSON.stringify(setupOpenBodies.at(-1))).not.toMatch(/apiKey|password|token|secret/i);

    const selected = parseText(await client.callTool({ name: 'select_provider', arguments: { providerId: 'prov-mcp' } }));
    expect(selected.selected).toMatchObject({ id: 'prov-mcp', isActive: true });
    await client.close();
  });

  it('resources：musefold://prompt/{id} 可读取正文', async () => {
    const client = await mcpClient();
    const found = parseText(await client.callTool({ name: 'search_prompts', arguments: { query: '青鸾照水样张' } }));
    const id = found.prompts[0].id as string;
    const resource = await client.readResource({ uri: `musefold://prompt/${id}` });
    expect((resource.contents[0] as { text: string }).text).toContain('mcp test prompt body');
    await client.close();
  });
});
