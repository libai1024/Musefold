import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { aiProviderSchema, generationJobSchema } from '@musefold/contracts';
import { LOGS_DIR_NAME } from '@musefold/core/constants';
import { type ElectronApplication, expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { connectCloud } from './cloud-crash-helpers';
import { desktopDbPath, launchV25App, v25ShellPage } from './electron-helpers';
import { localExecutionFixture, localInvoke } from './local-execution-fixture';

for (const operation of [
  'create-cloud',
  'cloud-key',
  'signed-out-activate',
  'delete-fallback',
  'local-byok',
] as const) {
  test(`正式本地管理 ${operation} 与账号云连接规则一致`, async () => {
    const fixture = await localExecutionFixture();
    let app: ElectronApplication | undefined;
    let userData = '';
    try {
      const launched = await launchV25App('musefold-local-provider-', { env: fixture.env });
      app = launched.app;
      userData = launched.userDataDir;
      const page = await v25ShellPage(app);
      await connectCloud(page);
      const providers = (await localInvoke(page, 'aiProviders.list')) as Array<{
        id: string;
        type: string;
      }>;
      const cloud = providers.find((provider) => provider.type === 'musefold-cloud');
      if (!cloud) throw new Error('Missing cloud fixture');
      const byok = aiProviderSchema.parse(
        await localInvoke(page, 'aiProviders.create', {
          name: '自备连接',
          baseUrl: `${fixture.baseUrl}/v1`,
          model: 'fixture-a',
          apiKey: 'synthetic-a',
          activate: true,
        }),
      );
      const discovery = JSON.parse(readFileSync(join(userData, 'automation.json'), 'utf8')) as {
        port: number;
        token: string;
      };
      const local = async (path: string, body?: unknown, method = 'POST') => {
        const challengeResponse = await fetch(
          `http://127.0.0.1:${discovery.port}/v1/local/challenge`,
          {
            method: 'POST',
            headers: { authorization: `Bearer ${discovery.token}` },
          },
        );
        expect(challengeResponse.ok).toBe(true);
        const challenge = (await challengeResponse.json()) as {
          challengeId: string;
          fileName: string;
        };
        const proof = readFileSync(join(userData, challenge.fileName), 'utf8');
        return fetch(`http://127.0.0.1:${discovery.port}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${discovery.token}`,
            'content-type': 'application/json',
            'x-musefold-local-proof': `${challenge.challengeId}:${proof}`,
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
      };
      const state = () => {
        const db = new Database(desktopDbPath(userData), { readonly: true });
        try {
          return db.prepare('SELECT * FROM providers ORDER BY id').all();
        } finally {
          db.close();
        }
      };
      if (operation === 'local-byok') {
        const before = state();
        // 实际主进程的授权拒绝必须在任何文件清理或 Provider 写入之前发生。
        const marker = join(userData, 'local-proof-owned-marker.txt');
        writeFileSync(marker, 'owned synthetic marker');
        const forged = await fetch(
          `http://127.0.0.1:${discovery.port}/v1/local/providers/${byok.id}`,
          {
            method: 'DELETE',
            headers: {
              authorization: `Bearer ${discovery.token}`,
              'x-musefold-local-proof': '../local-proof-owned-marker.txt:wrong-proof',
            },
          },
        );
        expect(forged.status).toBe(403);
        expect(await forged.json()).toMatchObject({ error: { code: 'LOCAL_PROOF_INVALID' } });
        expect(existsSync(marker)).toBe(true);
        expect(readFileSync(marker, 'utf8')).toBe('owned synthetic marker');
        expect(state()).toEqual(before);
        const privatePathMarker = 'synthetic-private-request-value';
        const denied = await fetch(
          `http://127.0.0.1:${discovery.port}/v1/local/providers/${privatePathMarker}?private=${privatePathMarker}`,
          { method: 'DELETE', headers: { authorization: `Bearer ${discovery.token}` } },
        );
        expect(denied.status).toBe(403);
        await denied.text();
        const auditFile = join(userData, LOGS_DIR_NAME, 'automation-audit.ndjson');
        await expect
          .poll(() =>
            existsSync(auditFile)
              ? readFileSync(auditFile, 'utf8')
                  .split('\n')
                  .slice(0, -1)
                  .map((line) => JSON.parse(line))
              : [],
          )
          .toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                path: '/v1/local/providers/:id',
                status: 403,
                errorCode: 'LOCAL_PROOF_REQUIRED',
              }),
            ]),
          );
        const auditText = readFileSync(auditFile, 'utf8');
        expect(auditText).not.toContain(privatePathMarker);
        expect(auditText).not.toContain(discovery.token);
        expect(state()).toEqual(before);
        expect(
          (
            await local('/v1/local/providers', {
              name: 'bad flag',
              type: 'openai-compatible',
              baseUrl: fixture.baseUrl,
              model: 'fixture-b',
              isActive: 'false',
            })
          ).status,
        ).toBe(400);
        expect(state()).toEqual(before);
        const response = await local('/v1/local/providers', {
          name: '本地质询自备',
          type: 'openai-compatible',
          baseUrl: `${fixture.baseUrl}/v1`,
          model: 'fixture-b',
          isActive: true,
        });
        expect(response.status).toBe(200);
        const added = (await response.json()) as { id: string };
        expect(
          (await local(`/v1/local/providers/${added.id}/key`, { key: 'synthetic-b' })).status,
        ).toBe(200);
        expect((await local(`/v1/local/providers/${cloud.id}/activate`)).status).toBe(200);
        expect(state()).toEqual(
          expect.arrayContaining([expect.objectContaining({ id: cloud.id, is_active: 1 })]),
        );
        expect(
          await (await local(`/v1/local/providers/${cloud.id}/validate`)).json(),
        ).toMatchObject({ ok: true });
        expect((await local(`/v1/local/providers/${added.id}/activate`)).status).toBe(200);
        const job = generationJobSchema.parse(
          await localInvoke(page, 'generation.create', { prompt: '本地质询自备连接', count: 1 }),
        );
        await expect
          .poll(
            async () =>
              generationJobSchema.parse(await localInvoke(page, 'generation.get', job.id)).status,
          )
          .toBe('succeeded');
        expect(fixture.imageCalls).toEqual([expect.objectContaining({ model: 'fixture-b' })]);
        expect(fixture.imageCredentials).toEqual(['b']);
        expect((await local(`/v1/local/providers/${added.id}`, undefined, 'DELETE')).status).toBe(
          200,
        );
        expect(state()).toEqual(
          expect.arrayContaining([expect.objectContaining({ id: byok.id, is_active: 1 })]),
        );
      } else if (operation === 'delete-fallback') {
        await localInvoke(page, 'account.logout');
        await localInvoke(page, 'aiProviders.remove', { id: byok.id });
        expect(state()).toEqual([expect.objectContaining({ id: cloud.id, is_active: 0 })]);
      } else {
        if (operation === 'signed-out-activate') await localInvoke(page, 'account.logout');
        const before = state();
        const response =
          operation === 'create-cloud'
            ? await local('/v1/local/providers', {
                name: '伪造云连接',
                type: 'musefold-cloud',
                baseUrl: fixture.baseUrl,
                model: 'fixture',
                isActive: true,
              })
            : operation === 'cloud-key'
              ? await local(`/v1/local/providers/${cloud.id}/key`, {
                  key: 'synthetic-forbidden-key',
                })
              : await local(`/v1/local/providers/${cloud.id}/activate`);
        expect(response.status).toBe(operation === 'create-cloud' ? 400 : 409);
        expect(await response.json()).toMatchObject({
          error: {
            code:
              operation === 'create-cloud'
                ? 'INVALID_PARAMS'
                : operation === 'cloud-key'
                  ? 'MANAGED_CONNECTION_IMMUTABLE'
                  : 'MANAGED_CONNECTION_UNAVAILABLE',
          },
        });
        expect(state()).toEqual(before);
      }
      if (operation !== 'local-byok') expect(fixture.imageCalls).toEqual([]);
      expect(fixture.cloudCreates).toEqual([]);
    } finally {
      await app?.close();
      if (userData) rmSync(userData, { recursive: true, force: true });
      await fixture.close();
    }
  });
}
