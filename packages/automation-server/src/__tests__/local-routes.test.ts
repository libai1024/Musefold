// 本地专属通道测试（V04-SECURITY §4.3）：一次性文件质询协议 + 管理操作守卫。

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEventHub } from '@musefold/core';
import { createAutomationServer, type AutomationServerInfo } from '../server';
import { createLocalRoutes, type LocalAdminOps } from '../local-routes';

const resources: Array<{ dir: string; stop: () => Promise<void> }> = [];
afterEach(async () => {
  for (const resource of resources.splice(0)) {
    await resource.stop();
    rmSync(resource.dir, { recursive: true, force: true });
  }
});

function fakeOps(): LocalAdminOps & { setProviderKey: ReturnType<typeof vi.fn> } {
  return {
    createProvider: vi.fn((input: unknown) => ({ id: 'prov-new', ...(input as object) })),
    setProviderKey: vi.fn(() => ({ ok: true, keySuffix: 'ab12' })),
    deleteProvider: vi.fn(() => ({ ok: true })),
    setActiveProvider: vi.fn(() => ({ ok: true })),
    validateProvider: vi.fn(async () => ({ ok: true })),
    backupNow: vi.fn(async () => ({ path: '/tmp/backup.db' })),
    listBackups: vi.fn(async () => ({ backups: [] })),
    restoreBackup: vi.fn(async () => ({ safetyBackupPath: '/tmp/safety.db' })),
    exportLibrary: vi.fn(async () => ({ path: '/tmp/export.json' })),
    importLibrary: vi.fn(async () => ({ imported: 1 })),
    deletePrompt: vi.fn(() => ({ ok: true, trashed: 'p1' })),
  };
}

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'musefold-local-'));
  const ops = fakeOps();
  const server = createAutomationServer({
    core: { version: '0.1.0', status: { snapshot: () => ({ prompts: 0, formalSchemes: 0, providers: 0, activeProviderId: null }) } },
    events: createEventHub(),
    dataDir: dir,
    owner: 'desktop-app',
    appVersion: 'x',
    routes: createLocalRoutes(dir, ops).routes,
  });
  const info = await server.start();
  resources.push({ dir, stop: () => server.stop() });
  return { dir, ops, info };
}

async function call(info: AutomationServerInfo, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${info.token}`);
  if (init.body) headers.set('content-type', 'application/json');
  return fetch(`http://127.0.0.1:${info.port}${path}`, { ...init, headers });
}

async function proofHeader(dir: string, info: AutomationServerInfo): Promise<string> {
  const challenge = (await (await call(info, '/v1/local/challenge', { method: 'POST' })).json()) as {
    challengeId: string; fileName: string;
  };
  const content = readFileSync(join(dir, ...challenge.fileName.split('/')), 'utf8');
  return `${challenge.challengeId}:${content}`;
}

describe('本地专属通道', () => {
  it('无质询证明 → 403 LOCAL_PROOF_REQUIRED（token 有效也不行）', async () => {
    const { info, ops } = await fixture();
    const response = await call(info, '/v1/local/providers/p1/key', { method: 'POST', body: JSON.stringify({ key: 'sk-x' }) });
    expect(response.status).toBe(403);
    expect(((await response.json()) as any).error.code).toBe('LOCAL_PROOF_REQUIRED');
    expect(ops.setProviderKey).not.toHaveBeenCalled();
  });

  it('正确质询（读文件回证）→ 放行；质询单次有效', async () => {
    const { dir, info, ops } = await fixture();
    const proof = await proofHeader(dir, info);
    const ok = await call(info, '/v1/local/providers/p1/key', {
      method: 'POST',
      body: JSON.stringify({ key: 'sk-secret' }),
      headers: { 'x-musefold-local-proof': proof },
    });
    expect(ok.status).toBe(200);
    expect(ops.setProviderKey).toHaveBeenCalledWith('p1', 'sk-secret');

    // 同一质询复用 → 拒绝（单次有效）
    const replay = await call(info, '/v1/local/providers/p1/key', {
      method: 'POST',
      body: JSON.stringify({ key: 'sk-again' }),
      headers: { 'x-musefold-local-proof': proof },
    });
    expect(replay.status).toBe(403);
    expect(((await replay.json()) as any).error.code).toBe('LOCAL_PROOF_INVALID');
  });

  it('伪造内容 → 403，且该质询作废', async () => {
    const { info } = await fixture();
    const challenge = (await (await call(info, '/v1/local/challenge', { method: 'POST' })).json()) as { challengeId: string; fileName: string };
    const forged = await call(info, '/v1/local/backups', {
      method: 'POST',
      headers: { 'x-musefold-local-proof': `${challenge.challengeId}:wrong-content` },
    });
    expect(forged.status).toBe(403);
    // 原质询已被消耗——即便再猜也一律 403
    const late = await call(info, '/v1/local/backups', {
      method: 'POST',
      headers: { 'x-musefold-local-proof': `${challenge.challengeId}:${'x'.repeat(43)}` },
    });
    expect(late.status).toBe(403);
  });

  it('备份 / 导出 / 删除提示词经通道可用', async () => {
    const { dir, info, ops } = await fixture();
    const backup = await call(info, '/v1/local/backups', { method: 'POST', headers: { 'x-musefold-local-proof': await proofHeader(dir, info) } });
    expect(((await backup.json()) as any).path).toBe('/tmp/backup.db');

    const exported = await call(info, '/v1/local/export', {
      method: 'POST',
      body: JSON.stringify({ mode: 'db-only' }),
      headers: { 'x-musefold-local-proof': await proofHeader(dir, info) },
    });
    expect(exported.status).toBe(200);
    expect(ops.exportLibrary).toHaveBeenCalledWith({ mode: 'db-only' });

    const removed = await call(info, '/v1/local/prompts/p1', {
      method: 'DELETE',
      headers: { 'x-musefold-local-proof': await proofHeader(dir, info) },
    });
    expect(((await removed.json()) as any).trashed).toBe('p1');
  });
});
