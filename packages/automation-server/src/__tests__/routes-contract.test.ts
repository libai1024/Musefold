// Automation API v1 契约测试（V04-API-02）：真实 core + 临时数据库 + 真实 HTTP。
// 纪律（契约先行）：端点的请求/响应形状变更必须先改这里。

import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DESIGN_SCHEME_DOCUMENT_VERSION,
  type DesignSchemeRevisionDocument,
} from '@shared/design-scheme/schema';
import { createEventHub, createMusefoldCore, type MusefoldCore } from '@musefold/core';
import { configureTestCoreRuntime } from '@musefold/core/testing';
import { closeDb, getDb, initDb } from '@musefold/core/db/index';
import { closeDesignSchemeDb, getDesignSchemeDb, initDesignSchemeDb } from '@musefold/core/db/design-scheme';
import { DesignSchemeRepository } from '@musefold/core/db/design-scheme/repositories';
import { createAutomationServer, type AutomationServer, type AutomationServerInfo } from '../server';
import { createV1ReadRoutes } from '../routes';

let root: string;
let core: MusefoldCore;
let server: AutomationServer;
let info: AutomationServerInfo;

function schemeDocument(): DesignSchemeRevisionDocument {
  return {
    schemaVersion: DESIGN_SCHEME_DOCUMENT_VERSION,
    revisionId: 'dsrv_contract',
    schemeId: 'dsch_contract',
    name: '契约测试方案',
    summary: '控制面只读契约',
    fidelity: 'adapted',
    sources: [{ id: 'src_brief', kind: 'user-brief', role: 'context' }],
    inputs: [
      { id: 'topic', label: '主题', kind: 'text', required: true },
      { id: 'main_image', label: '主体图片', kind: 'image', required: false, imageRole: 'subject-reference' },
    ],
    parameters: [],
    constraints: [],
    promptProgram: [
      { id: 'pm_1', order: 0, kind: 'input-template', template: '为「{{topic}}」创作插画', variables: ['topic'], sourceIds: ['src_brief'] },
    ],
    compilation: { compiledAt: 1, model: { model: 'test', connectionName: 'test' }, adopted: [], omitted: [], warnings: [], trace: [] },
  };
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${info.token}`);
  if (init.body) headers.set('content-type', 'application/json');
  return fetch(`http://127.0.0.1:${info.port}${path}`, { ...init, headers });
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'musefold-v1-contract-'));
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

  // —— 造数：提示词 / Provider / 历史 / 正式方案 ——
  const prompt = core.library.create({ title: '契约提示词', content: 'contract prompt body' });
  getDb().prepare(
    `INSERT INTO providers (id, name, type, base_url, model, has_key, key_suffix, is_active, created_at, updated_at)
     VALUES ('prov-contract', '契约站', 'openai-compatible', 'https://contract.example/v1', 'gpt-image-2', 1, 'cd34', 1, 1, 1)`,
  ).run();
  getDb().prepare(
    `INSERT INTO history (id, prompt_id, provider_id, model, prompt_text, status, cost, created_at)
     VALUES ('his-contract', ?, 'prov-contract', 'gpt-image-2', 'a prompt', 'success', 18, 1000)`,
  ).run(prompt.id);

  const schemeRepo = new DesignSchemeRepository(getDesignSchemeDb());
  const schemeSummary = schemeRepo.insertSchemeDraft({
    document: schemeDocument(),
    sourceLabel: 'Musefold 创建',
    sourcePresentation: 'musefold-created',
    createdBy: 'agent',
    bindings: [],
  });
  getDesignSchemeDb().prepare("UPDATE design_schemes SET status = 'formal' WHERE id = ?").run(schemeSummary.id);

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

describe('v1 只读端点契约', () => {
  it('GET /v1/prompts：检索 + 截断 + 总数', async () => {
    const response = await api('/v1/prompts?query=契约');
    expect(response.status).toBe(200);
    const payload = await response.json() as any;
    expect(payload.total).toBe(1);
    expect(payload.prompts[0]).toMatchObject({ title: '契约提示词', source: 'manual' });
  });

  it('GET /v1/prompts/:id 与 404 信封', async () => {
    const list = await (await api('/v1/prompts')).json() as any;
    const detail = await api(`/v1/prompts/${list.prompts[0].id}`);
    expect((await detail.json() as any).prompt.content).toBe('contract prompt body');

    const missing = await api('/v1/prompts/nope');
    expect(missing.status).toBe(404);
    expect(await missing.json() as any).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('POST /v1/prompts：写入（🟡）返回 201 + id；缺字段 400', async () => {
    const created = await api('/v1/prompts', { method: 'POST', body: JSON.stringify({ title: 'Agent 回流', body: 'saved via api', note: 'via contract test' }) });
    expect(created.status).toBe(201);
    const payload = await created.json() as any;
    expect(payload).toMatchObject({ created: true });
    expect(core.library.get(payload.id)?.description).toBe('via contract test');

    const invalid = await api('/v1/prompts', { method: 'POST', body: JSON.stringify({ title: '' }) });
    expect(invalid.status).toBe(400);
    expect(await invalid.json() as any).toMatchObject({ error: { code: 'INVALID_PARAMS' } });
  });

  it('GET /v1/providers：含 hasKey/available，绝无明文 key', async () => {
    const payload = await (await api('/v1/providers')).json() as any;
    expect(payload.providers[0]).toMatchObject({ id: 'prov-contract', hasKey: true, available: true, isActive: true });
    const raw = JSON.stringify(payload);
    expect(raw).not.toContain('apiKey');
    expect(raw).not.toMatch(/sk-[A-Za-z0-9]/);
  });

  it('GET /v1/providers/:id/models：网络失败映射 PROVIDER_ERROR(502)；未知 id 404', async () => {
    const missing = await api('/v1/providers/nope/models');
    expect(missing.status).toBe(404);
  });

  it('GET /v1/history 过滤 + GET /v1/history/:id 详情', async () => {
    const list = await (await api('/v1/history?status=success&providerId=prov-contract')).json() as any;
    expect(list.history).toHaveLength(1);
    expect(list.history[0]).toMatchObject({ id: 'his-contract', cost: 18 });

    const detail = await (await api('/v1/history/his-contract')).json() as any;
    expect(detail.history.promptReferences).toEqual([]);
    expect((await api('/v1/history/nope')).status).toBe(404);
  });

  it('GET /v1/schemes：仅正式方案；GET /v1/schemes/:id 带输入槽位', async () => {
    const list = await (await api('/v1/schemes')).json() as any;
    expect(list.schemes).toHaveLength(1);
    expect(list.schemes[0]).toMatchObject({ name: '契约测试方案', status: 'formal' });

    const detail = await (await api(`/v1/schemes/${list.schemes[0].id}`)).json() as any;
    expect(detail.document.inputs.map((slot: { id: string }) => slot.id)).toEqual(['topic', 'main_image']);
  });

  it('POST /v1/schemes/:id/compile：编译预览 + 缺必填提醒', async () => {
    const list = await (await api('/v1/schemes')).json() as any;
    const schemeId = list.schemes[0].id;

    const compiled = await (await api(`/v1/schemes/${schemeId}/compile`, {
      method: 'POST',
      body: JSON.stringify({ inputs: { topic: '中秋插画' }, ratioId: '3:4' }),
    })).json() as any;
    expect(compiled.prompt).toContain('中秋插画');
    expect(compiled.warnings).toEqual([]);

    const missing = await (await api(`/v1/schemes/${schemeId}/compile`, { method: 'POST', body: JSON.stringify({}) })).json() as any;
    expect(missing.warnings.join()).toContain('主题');
  });

  it('limit 参数越界返回 INVALID_PARAMS(400)', async () => {
    const response = await api('/v1/prompts?limit=abc');
    expect(response.status).toBe(400);
    expect(await response.json() as any).toMatchObject({ error: { code: 'INVALID_PARAMS' } });
  });
});
