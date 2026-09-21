// 本地专属通道测试（V04-SECURITY §4.3）：一次性文件质询协议 + 管理操作守卫。

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEventHub } from '@musefold/core';
import { createAutomationServer, type AutomationServerInfo } from '../server';
import { createLocalRoutes, type LocalAdminOps } from '../local-routes';

const resources: Array<{ dir: string; stop: () => Promise<void> }> = [];
afterEach(async () => {
  vi.restoreAllMocks();
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
    core: {
      version: '0.1.0',
      status: {
        snapshot: () => ({ prompts: 0, formalSchemes: 0, providers: 0, activeProviderId: null }),
      },
    },
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
  const challenge = (await (
    await call(info, '/v1/local/challenge', { method: 'POST' })
  ).json()) as {
    challengeId: string;
    fileName: string;
  };
  const content = readFileSync(join(dir, ...challenge.fileName.split('/')), 'utf8');
  return `${challenge.challengeId}:${content}`;
}

describe('本地专属通道', () => {
  it.each([
    [
      'POST',
      '/v1/local/providers',
      'createProvider',
      { name: 'test', type: 'openai', baseUrl: 'http://127.0.0.1', model: 'synthetic' },
    ],
    ['POST', '/v1/local/providers/p1/key', 'setProviderKey', { key: 'synthetic-test-key' }],
    ['DELETE', '/v1/local/providers/p1', 'deleteProvider', undefined],
    ['POST', '/v1/local/providers/p1/activate', 'setActiveProvider', undefined],
    ['POST', '/v1/local/providers/p1/validate', 'validateProvider', undefined],
    ['POST', '/v1/local/backups', 'backupNow', undefined],
    ['GET', '/v1/local/backups', 'listBackups', undefined],
    ['POST', '/v1/local/backups/restore', 'restoreBackup', { file: 'synthetic-backup.db' }],
    ['POST', '/v1/local/export', 'exportLibrary', { mode: 'db-only' }],
    ['POST', '/v1/local/import', 'importLibrary', { mode: 'db-only' }],
    ['DELETE', '/v1/local/prompts/p1', 'deletePrompt', undefined],
  ] as const)(
    '%s %s 每个本地入口均要求token及一次性质询',
    async (method, path, operation, body) => {
      const { dir, info, ops } = await fixture();
      const init = { method, body: body === undefined ? undefined : JSON.stringify(body) };
      const proof = await proofHeader(dir, info);
      const noToken = await fetch(`http://127.0.0.1:${info.port}${path}`, {
        ...init,
        headers: { 'x-musefold-local-proof': proof },
      });
      expect(noToken.status).toBe(401);
      const missing = await call(info, path, init);
      expect(missing.status).toBe(403);
      const unknown = await call(info, path, {
        ...init,
        headers: { 'x-musefold-local-proof': 'unissued:wrong' },
      });
      expect(unknown.status).toBe(403);
      for (const op of Object.values(ops)) expect(op).not.toHaveBeenCalled();
      const accepted = await call(info, path, {
        ...init,
        headers: { 'x-musefold-local-proof': proof },
      });
      expect(accepted.status).toBe(200);
      const replay = await call(info, path, {
        ...init,
        headers: { 'x-musefold-local-proof': proof },
      });
      expect(replay.status).toBe(403);
      for (const [name, op] of Object.entries(ops)) {
        expect(op).toHaveBeenCalledTimes(name === operation ? 1 : 0);
      }
    },
  );

  it('错误内容只消耗对应质询，正确秘密不能重放且其他质询继续有效', async () => {
    const { dir, info, ops } = await fixture();
    const consumed = await proofHeader(dir, info);
    const active = await proofHeader(dir, info);
    const consumedFile = join(dir, '.local-challenges', consumed.split(':')[0]);
    const wrong = await call(info, '/v1/local/prompts/p1', {
      method: 'DELETE',
      headers: { 'x-musefold-local-proof': `${consumed.split(':')[0]}:wrong` },
    });
    expect(wrong.status).toBe(403);
    expect(existsSync(consumedFile)).toBe(false);
    const replay = await call(info, '/v1/local/prompts/p1', {
      method: 'DELETE',
      headers: { 'x-musefold-local-proof': consumed },
    });
    expect(replay.status).toBe(403);
    expect(ops.deletePrompt).not.toHaveBeenCalled();
    const ok = await call(info, '/v1/local/prompts/p1', {
      method: 'DELETE',
      headers: { 'x-musefold-local-proof': active },
    });
    expect(ok.status).toBe(200);
    expect(ops.deletePrompt).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['../owned-marker.txt', 'owned-marker.txt'],
    ['../.local-challenges/../owned-marker.txt', 'owned-marker.txt'],
    ['./orphan', '.local-challenges/orphan'],
    [
      '00000000-0000-4000-8000-000000000000',
      '.local-challenges/00000000-0000-4000-8000-000000000000',
    ],
  ])('未知质询 %s 拒绝且不删除任何文件或其他有效质询', async (id, marker) => {
    const { dir, info, ops } = await fixture();
    const validProof = await proofHeader(dir, info);
    const markerPath = join(dir, marker);
    writeFileSync(markerPath, 'owned synthetic marker');
    const response = await call(info, '/v1/local/prompts/p1', {
      method: 'DELETE',
      headers: { 'x-musefold-local-proof': `${id}:wrong-proof` },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'LOCAL_PROOF_INVALID' } });
    expect(ops.deletePrompt).not.toHaveBeenCalled();
    expect(existsSync(markerPath)).toBe(true);
    expect(readFileSync(markerPath, 'utf8')).toBe('owned synthetic marker');
    const valid = await call(info, '/v1/local/prompts/p1', {
      method: 'DELETE',
      headers: { 'x-musefold-local-proof': validProof },
    });
    expect(valid.status).toBe(200);
    expect(ops.deletePrompt).toHaveBeenCalledTimes(1);
  });

  it.each([59_999, 60_000, 60_001])('质询在签发后 %i 毫秒执行严格期限校验', async (elapsed) => {
    const { dir, info, ops } = await fixture();
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const proof = await proofHeader(dir, info);
    const challengeFile = join(dir, '.local-challenges', proof.split(':')[0]);
    clock.mockReturnValue(now + elapsed);
    const response = await call(info, '/v1/local/prompts/p1', {
      method: 'DELETE',
      headers: { 'x-musefold-local-proof': proof },
    });
    expect(response.status).toBe(elapsed < 60_000 ? 200 : 403);
    expect(ops.deletePrompt).toHaveBeenCalledTimes(elapsed < 60_000 ? 1 : 0);
    expect(existsSync(challengeFile)).toBe(false);
  });

  it('新质询清理刚好到期的文件但保留仍有效的文件及非质询文件', async () => {
    const { dir, info, ops } = await fixture();
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const expired = await proofHeader(dir, info);
    const expiredFile = join(dir, '.local-challenges', expired.split(':')[0]);
    clock.mockReturnValue(now + 1);
    const active = await proofHeader(dir, info);
    const activeFile = join(dir, '.local-challenges', active.split(':')[0]);
    const orphan = join(dir, '.local-challenges', 'unregistered-file');
    writeFileSync(orphan, 'keep');
    clock.mockReturnValue(now + 60_000);
    await proofHeader(dir, info);
    expect(existsSync(expiredFile)).toBe(false);
    expect(existsSync(activeFile)).toBe(true);
    expect(readFileSync(orphan, 'utf8')).toBe('keep');
    const replay = await call(info, '/v1/local/prompts/p1', {
      method: 'DELETE',
      headers: { 'x-musefold-local-proof': expired },
    });
    expect(replay.status).toBe(403);
    const ok = await call(info, '/v1/local/prompts/p1', {
      method: 'DELETE',
      headers: { 'x-musefold-local-proof': active },
    });
    expect(ok.status).toBe(200);
    expect(ops.deletePrompt).toHaveBeenCalledTimes(1);
  });

  it('无质询证明 → 403 LOCAL_PROOF_REQUIRED（token 有效也不行）', async () => {
    const { info, ops } = await fixture();
    const response = await call(info, '/v1/local/providers/p1/key', {
      method: 'POST',
      body: JSON.stringify({ key: 'sk-x' }),
    });
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
    const challenge = (await (
      await call(info, '/v1/local/challenge', { method: 'POST' })
    ).json()) as { challengeId: string; fileName: string };
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
    const backup = await call(info, '/v1/local/backups', {
      method: 'POST',
      headers: { 'x-musefold-local-proof': await proofHeader(dir, info) },
    });
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
