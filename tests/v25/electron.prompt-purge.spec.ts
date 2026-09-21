import { rmSync } from 'node:fs';
import { type ElectronApplication, expect, test } from '@playwright/test';
import { newPromptDocumentSchema, type PromptDocument } from '@musefold/contracts';
import type { BridgeEnvelope } from '../../apps/desktop/electron/main/ipc-v25/envelope';
import { launchV25App, v25ShellPage } from './electron-helpers';
import { invoke } from './desktop-sync-helpers';

test('501 trashed prompts clear through real IPC and stay deleted after a new Electron PID', async ({
  browserName: _browserName,
}, info) => {
  test.setTimeout(90_000);
  let app: ElectronApplication | undefined;
  let directory = '';
  try {
    const launched = await launchV25App('musefold-v25-purge-501-');
    app = launched.app;
    directory = launched.userDataDir;
    const firstPid = app.process().pid;
    const page = await v25ShellPage(app);
    const input = newPromptDocumentSchema.parse({
      title: 'Synthetic retained prompt',
      description: null,
      content: 'Synthetic lifecycle fixture',
      negative: null,
      folderId: null,
      tagIds: [],
      modelId: null,
      params: null,
      rating: 0,
      isPinned: false,
      source: 'manual',
      sourceUrl: null,
    });
    const ids = await page.evaluate(async (input) => {
      const bridge = (
        window as unknown as {
          musefoldV25: {
            invoke(method: string, payload?: unknown): Promise<BridgeEnvelope<unknown>>;
          };
        }
      ).musefoldV25;
      const create = async () => {
        const result = await bridge.invoke('prompts.create', input);
        if (!result.ok) throw new Error(`Fixture create: ${result.code}`);
        return (result.data as PromptDocument).id;
      };
      const keep = await create();
      const trashed: string[] = [];
      for (let i = 0; i < 501; i++) {
        const id = await create();
        const removed = await bridge.invoke('prompts.remove', { id });
        if (!removed.ok) throw new Error(`Fixture remove: ${removed.code}`);
        trashed.push(id);
      }
      return { keep, first: trashed[0], last: trashed[500] };
    }, input);
    expect(await invoke(page, 'prompts.emptyTrash')).toEqual({ purged: 501 });
    expect(await invoke(page, 'prompts.emptyTrash')).toEqual({ purged: 0 });
    expect(await invoke<PromptDocument>(page, 'prompts.get', { id: ids.keep })).toMatchObject({
      id: ids.keep,
      deletedAt: null,
      content: input.content,
    });
    await app.close();
    app = undefined;
    app = (await launchV25App('musefold-v25-purge-restart-', directory)).app;
    const secondPid = app.process().pid;
    expect(secondPid).not.toBe(firstPid);
    const restarted = await v25ShellPage(app);
    expect(await invoke(restarted, 'prompts.emptyTrash')).toEqual({ purged: 0 });
    for (const id of [ids.first, ids.last]) {
      await expect(invoke(restarted, 'prompts.get', { id })).rejects.toThrow('NOT_FOUND');
    }
    expect(await invoke<PromptDocument>(restarted, 'prompts.get', { id: ids.keep })).toMatchObject({
      id: ids.keep,
      content: input.content,
      deletedAt: null,
    });
    await info.attach('prompt-purge-lifecycle', {
      body: JSON.stringify({
        firstPid,
        secondPid,
        seededDeleted: 501,
        purged: 501,
        subsequentPurged: 0,
        restartPurged: 0,
        firstAndLastAbsent: true,
        livePromptPreserved: true,
      }),
      contentType: 'application/json',
    });
  } finally {
    await app?.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});
