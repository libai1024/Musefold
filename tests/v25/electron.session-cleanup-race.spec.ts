import { expect, test } from '@playwright/test';
import { workbenchSessionPageSchema, workbenchSessionSchema } from '@musefold/contracts';
import type { BridgeEnvelope } from '../../apps/desktop/electron/main/ipc-v25/envelope';
import { launchV25App, v25ShellPage } from './electron-helpers';
import { electronSessionRequest } from './session-trash-ui-helpers';

for (const first of ['restoreSession', 'purgeSession'] as const) {
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires a destructured fixture argument.
  test(`Session cleanup simultaneous IPC, ${first} first, survives fresh process`, async ({}, info) => {
    test.setTimeout(120000);
    const launched = await launchV25App('musefold-v25-session-cleanup-race-');
    let app = launched.app;
    try {
      const page = await v25ShellPage(app);
      const request = electronSessionRequest(page);
      const keep = workbenchSessionSchema.parse(
        await request('create', { title: '独立会话', draft: { prompt: '正常输入保持' } }),
      );
      const created = workbenchSessionSchema.parse(
        await request('create', { title: '并发清理', draft: { prompt: '待恢复的归档草稿' } }),
      );
      await request('update', {
        id: created.id,
        patch: { expectedVersion: created.version, archived: true },
      });
      await request('remove', created.id);
      const before = workbenchSessionSchema.parse(await request('get', created.id));
      // Both messages are sent before awaiting either reply. The actual desktop owns one
      // SQLite writer; do not bypass its single-instance lock with a second process/DB alias.
      const responses = await page.evaluate(
        async ({ id, first }) => {
          const bridge = (
            window as unknown as {
              musefoldV25: {
                invoke(method: string, input: unknown): Promise<BridgeEnvelope<unknown>>;
              };
            }
          ).musefoldV25;
          const second = first === 'restoreSession' ? 'purgeSession' : 'restoreSession';
          const one = bridge.invoke(`workbench.${first}`, id);
          const two = bridge.invoke(`workbench.${second}`, id);
          return Promise.all([one, two]);
        },
        { id: created.id, first },
      );
      if (first === 'restoreSession') {
        expect(responses[0].ok).toBe(true);
        expect(responses[1]).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
        const restored = workbenchSessionSchema.parse(await request('get', created.id));
        expect(restored.draft).toEqual(before.draft);
        expect(restored.archivedAt).toBe(before.archivedAt);
        expect(restored.deletedAt).toBeNull();
        expect(restored.version).toBe(before.version + 1);
      } else {
        expect(responses[0]).toEqual({ ok: true, data: { purged: 1 } });
        expect(responses[1]).toMatchObject({ ok: false, code: 'WORKBENCH_SESSION_NOT_FOUND' });
      }
      const oldPid = app.process().pid;
      await app.close();
      app = (await launchV25App('musefold-v25-session-cleanup-race-', launched.userDataDir)).app;
      expect(app.process().pid).not.toBe(oldPid);
      const restarted = await v25ShellPage(app);
      const read = electronSessionRequest(restarted);
      expect(workbenchSessionSchema.parse(await read('get', keep.id))).toEqual(keep);
      expect(
        workbenchSessionPageSchema.parse(await read('list', { deletedOnly: true })).items,
      ).toHaveLength(0);
      if (first === 'restoreSession') {
        const restored = workbenchSessionSchema.parse(await read('get', created.id));
        expect(restored.draft).toEqual(before.draft);
        expect(restored.archivedAt).toBe(before.archivedAt);
        expect(restored.deletedAt).toBeNull();
        expect(restored.version).toBe(before.version + 1);
      } else {
        const afterRestart = await restarted.evaluate(async (id) => {
          const bridge = (
            window as unknown as {
              musefoldV25: {
                invoke(method: string, input: unknown): Promise<BridgeEnvelope<unknown>>;
              };
            }
          ).musefoldV25;
          return {
            get: await bridge.invoke('workbench.getSession', id),
            restore: await bridge.invoke('workbench.restoreSession', id),
            repeatPurge: await bridge.invoke('workbench.purgeSession', id),
          };
        }, created.id);
        expect(afterRestart).toMatchObject({
          get: { ok: false, code: 'WORKBENCH_SESSION_NOT_FOUND' },
          restore: { ok: false, code: 'WORKBENCH_SESSION_NOT_FOUND' },
          repeatPurge: { ok: true, data: { purged: 0 } },
        });
      }
      await info.attach('session-cleanup-race', {
        contentType: 'application/json',
        body: JSON.stringify({ first, responses, oldPid, newPid: app.process().pid }),
      });
    } finally {
      await app.close();
    }
  });
}
