// 策略闸门单测（V04-API-03/04）：四分支 a/b/c/d + 上传/白名单全拒用例。

import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEventHub } from '@musefold/core';
import type { GenerateImageResult } from '@musefold/desktop-contracts/providers';
import { createAutomationServer, type AutomationServer, type AutomationServerInfo } from '../server';
import { createGenerationGate, type GenerationHost } from '../generation-routes';

const resources: Array<{ dir: string; stop: () => Promise<void> }> = [];
afterEach(async () => {
  for (const resource of resources.splice(0)) {
    await resource.stop();
    rmSync(resource.dir, { recursive: true, force: true });
  }
  vi.useRealTimers();
});

interface Fixture {
  info: AutomationServerInfo;
  server: AutomationServer;
  host: GenerationHost & {
    run: ReturnType<typeof vi.fn>;
    requestConfirmation: ReturnType<typeof vi.fn>;
    settled: number[];
  };
  hub: ReturnType<typeof createEventHub>;
  events: Array<{ type: string; payload: unknown }>;
}

async function fixture(overrides: {
  remaining?: number;
  estimatePoints?: number | null;
  confirm?: 'approved' | 'denied' | 'hang';
  runResult?: Partial<GenerateImageResult>;
} = {}): Promise<Fixture> {
  const dir = mkdtempSync(join(tmpdir(), 'musefold-gate-'));
  const hub = createEventHub();
  const events: Array<{ type: string; payload: unknown }> = [];
  hub.subscribe((event) => events.push(event));
  const settled: number[] = [];

  const host = {
    run: vi.fn(async (): Promise<GenerateImageResult> => ({
      historyId: 'his-gate',
      status: 'success',
      imagePath: '/tmp/out.png',
      cost: 18,
      durationMs: 1200,
      ...overrides.runResult,
    } as GenerateImageResult)),
    cancel: vi.fn(() => true),
    estimate: vi.fn(() => ({
      points: overrides.estimatePoints === undefined ? 18 : overrides.estimatePoints,
      providerId: 'prov-gate',
      providerName: '闸门测试站',
      model: 'gpt-image-2',
      n: 1,
    })),
    budget: {
      remainingPoints: () => overrides.remaining ?? 0,
      settle: (points: number) => settled.push(points),
    },
    requestConfirmation: vi.fn(async () => {
      if (overrides.confirm === 'hang') return new Promise<never>(() => {});
      return overrides.confirm ?? 'approved';
    }),
    authorizeReferencePath: (path: string) => path.startsWith('/managed/'),
    stageUpload: vi.fn(async (bytes: Buffer, name: string) => ({
      path: `/managed/uploads/${name}`,
      name,
      source: 'upload' as const,
      mimeType: 'image/png' as const,
      sizeBytes: bytes.length,
    })),
    resolveHistoryImage: (historyId: string) => (historyId === 'his-known' ? { path: '/managed/pictures/known.png' } : null),
    settled,
  };

  const gate = createGenerationGate(host, hub);
  const server = createAutomationServer({
    core: { version: '0.1.0', status: { snapshot: () => ({ prompts: 0, formalSchemes: 0, providers: 0, activeProviderId: null }) } },
    events: hub,
    dataDir: dir,
    owner: 'desktop-app',
    appVersion: '0.4.0-dev',
    routes: gate.routes,
  });
  const info = await server.start();
  resources.push({ dir, stop: () => server.stop() });
  return { info, server, host, hub, events };
}

async function post(info: AutomationServerInfo, path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`http://127.0.0.1:${info.port}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('策略闸门四分支', () => {
  it('b. 预算覆盖估算 → 自动放行执行，完成后按实际成本冲销', async () => {
    const f = await fixture({ remaining: 100 });
    const response = await post(f.info, '/v1/generations', { prompt: '预算内生成' });
    expect(response.status).toBe(202);
    const payload = (await response.json()) as any;
    expect(payload.status).toBe('running');
    expect(f.host.requestConfirmation).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(f.host.settled).toEqual([18]));
    const detail = await fetch(`http://127.0.0.1:${f.info.port}/v1/generations/${payload.jobId}`, {
      headers: { authorization: `Bearer ${f.info.token}` },
    });
    expect(((await detail.json()) as any).status).toBe('success');
    expect(f.events.map((event) => event.type)).toContain('generation.completed');
  });

  it('多图 Provider 的全部产物同时进入任务详情和完成事件', async () => {
    const paths = ['/tmp/out.png', '/tmp/out-2.png', '/tmp/out-3.png', '/tmp/out-4.png'];
    const f = await fixture({
      remaining: 100,
      runResult: {
        imagePath: paths[0],
        images: paths.map((imagePath) => ({ imagePath, actualSize: { width: 1024, height: 1024 } })),
      },
    });
    const response = await post(f.info, '/v1/generations', { prompt: '豆包四图' });
    const submitted = (await response.json()) as { jobId: string };
    await vi.waitFor(() => expect(f.host.settled).toEqual([18]));

    const detail = await fetch(`http://127.0.0.1:${f.info.port}/v1/generations/${submitted.jobId}`, {
      headers: { authorization: `Bearer ${f.info.token}` },
    });
    expect((await detail.json()) as { assets: Array<{ path: string }> }).toMatchObject({
      status: 'success',
      assets: paths.map((path) => ({ path })),
    });
    const completed = f.events.find((event) => event.type === 'generation.completed');
    expect(completed?.payload).toMatchObject({ assets: paths.map((path) => ({ path })) });
  });

  it('按 aspectRatio 映射 OpenAI 像素尺寸，同时保留比例字符串', async () => {
    const f = await fixture({ remaining: 100 });
    const response = await post(f.info, '/v1/generations', { prompt: '宽图', aspectRatio: '16:9' });
    expect(response.status).toBe(202);
    await vi.waitFor(() => expect(f.host.run).toHaveBeenCalledOnce());
    expect(f.host.run.mock.calls[0][0]).toMatchObject({
      size: '1536x1024',
      aspectRatio: '16:9',
    });
  });

  it('账号结果以用户可见积分输出', async () => {
    const f = await fixture({
      remaining: 100,
      runResult: {
        cost: 1.2,
        costUnit: 'point',
        costPoints: 1.2,
        actualSize: { width: 1536, height: 1024 },
        sizeMismatch: { expected: '1024x1024', actual: '1536x1024' },
      },
    });
    const response = await post(f.info, '/v1/generations', { prompt: '账号计费' });
    expect(response.status).toBe(202);
    const payload = (await response.json()) as any;
    await vi.waitFor(() => expect(f.host.settled).toEqual([1.2]));
    const detail = await fetch(`http://127.0.0.1:${f.info.port}/v1/generations/${payload.jobId}`, {
      headers: { authorization: `Bearer ${f.info.token}` },
    });
    expect(await detail.json()).toMatchObject({
      status: 'success',
      costPoints: 1.2,
      cost: 1.2,
      costUnit: 'point',
      actualSize: { width: 1536, height: 1024 },
      sizeMismatch: { expected: '1024x1024', actual: '1536x1024' },
    });
  });

  it('c. 预算不足 → 挂起确认；批准后执行（宿主确认通道）', async () => {
    const f = await fixture({ remaining: 0, confirm: 'approved' });
    const response = await post(f.info, '/v1/generations', { prompt: '需要确认' });
    expect(response.status).toBe(202);
    expect(f.host.requestConfirmation).toHaveBeenCalledOnce();
    expect(f.events.map((event) => event.type)).toContain('confirmation.required');
    await vi.waitFor(() => expect(f.host.run).toHaveBeenCalledOnce());
  });

  it('c-2. 拒绝 → 403 CONFIRMATION_DENIED，不执行、不扣预算', async () => {
    const f = await fixture({ remaining: 0, confirm: 'denied' });
    const response = await post(f.info, '/v1/generations', { prompt: '会被拒绝' });
    expect(response.status).toBe(403);
    expect(((await response.json()) as any).error.code).toBe('CONFIRMATION_DENIED');
    expect(f.host.run).not.toHaveBeenCalled();
    expect(f.host.settled).toEqual([]);
  });

  it('c-3. HTTP 确认回执（/v1/confirmations/:id）可放行挂起请求', async () => {
    const f = await fixture({ remaining: 0, confirm: 'hang' });
    const pendingResponse = post(f.info, '/v1/generations', { prompt: '经 HTTP 回执确认' });
    await vi.waitFor(() => {
      const required = f.events.find((event) => event.type === 'confirmation.required');
      expect(required).toBeTruthy();
    });
    const summary = (f.events.find((event) => event.type === 'confirmation.required')!.payload) as { confirmationId: string };
    const receipt = await post(f.info, `/v1/confirmations/${summary.confirmationId}`, { approved: true });
    expect(receipt.status).toBe(200);
    const response = await pendingResponse;
    expect(response.status).toBe(202);
    await vi.waitFor(() => expect(f.host.run).toHaveBeenCalledOnce());
  });

  it('a. Idempotency-Key 重放 → 返回原任务且不再确认/执行', async () => {
    const f = await fixture({ remaining: 100 });
    const first = await post(f.info, '/v1/generations', { prompt: '幂等重放' }, { 'idempotency-key': 'idem-1' });
    const firstPayload = (await first.json()) as any;
    const replay = await post(f.info, '/v1/generations', { prompt: '幂等重放' }, { 'idempotency-key': 'idem-1' });
    expect(replay.status).toBe(200);
    const replayPayload = (await replay.json()) as any;
    expect(replayPayload.jobId).toBe(firstPayload.jobId);
    expect(replayPayload.idempotentReplay).toBe(true);
    expect(f.host.run).toHaveBeenCalledOnce();
  });

  it('估算未知成本（无单价）时不可走预算，必须确认', async () => {
    const f = await fixture({ remaining: 10_000, estimatePoints: null, confirm: 'approved' });
    await post(f.info, '/v1/generations', { prompt: '未知成本' });
    expect(f.host.requestConfirmation).toHaveBeenCalledOnce();
  });

  it('参数校验：缺 prompt 400；n 越界 400', async () => {
    const f = await fixture({ remaining: 100 });
    expect((await post(f.info, '/v1/generations', {})).status).toBe(400);
    expect((await post(f.info, '/v1/generations', { prompt: 'x', n: 9 })).status).toBe(400);
  });

  it('DELETE /v1/generations/:jobId 触发取消', async () => {
    const f = await fixture({ remaining: 100, runResult: { status: 'cancelled' } });
    const started = (await (await post(f.info, '/v1/generations', { prompt: '取消我' })).json()) as any;
    const cancel = await fetch(`http://127.0.0.1:${f.info.port}/v1/generations/${started.jobId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${f.info.token}` },
    });
    expect(cancel.status).toBe(200);
    expect(f.host.cancel).toHaveBeenCalledWith(started.jobId);
  });
});

describe('熔断与花钱审计（V04-SEC-01）', () => {
  it('连续 3 次失败 → 熔断 429 BREAKER_OPEN；冷却后恢复', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'musefold-breaker-'));
    const hub = createEventHub();
    let now = 1_000_000;
    const audits: unknown[] = [];
    const failingHost = {
      run: vi.fn(async (): Promise<GenerateImageResult> => ({
        historyId: 'his-fail', status: 'failed', error: { code: 'PROVIDER_ERROR', message: 'boom' },
      } as GenerateImageResult)),
      cancel: () => true,
      estimate: () => ({ points: 10, providerId: 'p', providerName: 'P', model: 'm', n: 1 }),
      budget: { remainingPoints: () => 10_000, settle: () => {} },
      requestConfirmation: async () => 'approved' as const,
      authorizeReferencePath: () => true,
      stageUpload: async (bytes: Buffer, name: string) => ({ path: name, name, source: 'upload' as const, mimeType: 'image/png' as const, sizeBytes: bytes.length }),
      resolveHistoryImage: () => null,
    };
    const gate = createGenerationGate(failingHost, hub, {
      clock: () => now,
      breakerThreshold: 3,
      breakerCooldownMs: 60_000,
      onSpendAudit: (entry) => audits.push(entry),
    });
    const server = createAutomationServer({
      core: { version: '0.1.0', status: { snapshot: () => ({ prompts: 0, formalSchemes: 0, providers: 0, activeProviderId: null }) } },
      events: hub, dataDir: dir, owner: 'desktop-app', appVersion: 'x', routes: gate.routes,
    });
    const info = await server.start();
    resources.push({ dir, stop: () => server.stop() });

    for (let round = 0; round < 3; round += 1) {
      const response = await post(info, '/v1/generations', { prompt: `失败 ${round}` });
      expect(response.status).toBe(202);
      await vi.waitFor(() => expect(failingHost.run).toHaveBeenCalledTimes(round + 1));
      // 等失败结果被登记（审计条目落地）
      await vi.waitFor(() => expect(audits.length).toBe(round + 1));
    }

    // 第 4 次提交：熔断打开
    const blocked = await post(info, '/v1/generations', { prompt: '熔断中' });
    expect(blocked.status).toBe(429);
    expect(((await blocked.json()) as any).error.code).toBe('BREAKER_OPEN');

    // 冷却窗口过后恢复受理
    now += 61_000;
    const recovered = await post(info, '/v1/generations', { prompt: '恢复' });
    expect(recovered.status).toBe(202);
  });

  it('审计条目：完整提示词 + 放行路径 + 实际成本（Q5 完整存储）', async () => {
    const audits: Array<Record<string, unknown>> = [];
    const f = await fixture({ remaining: 100 });
    // 用带审计的新闸门重建太重——直接对既有 fixture 增加断言不可行，
    // 这里用独立 fixture：预算放行 + 成功结果
    const dir = mkdtempSync(join(tmpdir(), 'musefold-audit-'));
    const hub = createEventHub();
    const host = {
      run: vi.fn(async (req: { jobId?: string }): Promise<GenerateImageResult> => ({
        historyId: req.jobId ?? 'h', status: 'success', imagePath: '/tmp/a.png', cost: 18, durationMs: 5,
      } as GenerateImageResult)),
      cancel: () => true,
      estimate: () => ({ points: 18, providerId: 'p', providerName: 'P', model: 'm', n: 1 }),
      budget: { remainingPoints: () => 100, settle: () => {} },
      requestConfirmation: async () => 'approved' as const,
      authorizeReferencePath: () => true,
      stageUpload: async (bytes: Buffer, name: string) => ({ path: name, name, source: 'upload' as const, mimeType: 'image/png' as const, sizeBytes: bytes.length }),
      resolveHistoryImage: () => null,
    };
    const gate = createGenerationGate(host, hub, { onSpendAudit: (entry) => audits.push(entry as never) });
    const server = createAutomationServer({
      core: { version: '0.1.0', status: { snapshot: () => ({ prompts: 0, formalSchemes: 0, providers: 0, activeProviderId: null }) } },
      events: hub, dataDir: dir, owner: 'desktop-app', appVersion: 'x', routes: gate.routes,
    });
    const info2 = await server.start();
    resources.push({ dir, stop: () => server.stop() });

    await post(info2, '/v1/generations', { prompt: '完整提示词全文应被记录，一字不落' });
    await vi.waitFor(() => expect(audits).toHaveLength(1));
    expect(audits[0]).toMatchObject({
      action: 'generate_image',
      promptText: '完整提示词全文应被记录，一字不落',
      approvedVia: 'budget',
      status: 'success',
      estimatedPoints: 18,
      actualPoints: 18,
    });
    void f; // 前面 fixture 仅为保持隔离节奏
  });
});

describe('路径白名单与上传（V04-API-04）', () => {
  it('白名单外路径 403 PATH_NOT_ALLOWED；未知历史引用 404', async () => {
    const f = await fixture({ remaining: 100 });
    const outside = await post(f.info, '/v1/generations', { prompt: 'x', referenceImagePaths: ['/etc/passwd'] });
    expect(outside.status).toBe(403);
    expect(((await outside.json()) as any).error.code).toBe('PATH_NOT_ALLOWED');

    const missing = await post(f.info, '/v1/generations', { prompt: 'x', referenceHistoryIds: ['his-nope'] });
    expect(missing.status).toBe(404);

    const known = await post(f.info, '/v1/generations', { prompt: 'x', referenceHistoryIds: ['his-known'], referenceImagePaths: ['/managed/uploads/a.png'] });
    expect(known.status).toBe(202);
  });

  it('POST /v1/uploads：图片字节转存受管路径；非法类型 400', async () => {
    const f = await fixture({ remaining: 100 });
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ok = await fetch(`http://127.0.0.1:${f.info.port}/v1/uploads`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${f.info.token}`,
        'content-type': 'image/png',
        'x-musefold-filename': 'pasted.png',
      },
      body: png,
    });
    expect(ok.status).toBe(201);
    expect((((await ok.json()) as any).image.path)).toBe('/managed/uploads/pasted.png');

    const bad = await fetch(`http://127.0.0.1:${f.info.port}/v1/uploads`, {
      method: 'POST',
      headers: { authorization: `Bearer ${f.info.token}`, 'content-type': 'application/pdf' },
      body: Buffer.from('nope'),
    });
    expect(bad.status).toBe(400);
  });
});
