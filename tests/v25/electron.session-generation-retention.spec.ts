import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { aiProviderSchema, generationJobSchema, workbenchSessionSchema } from '@musefold/contracts';
import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { desktopDbPath, launchV25App, v25ShellPage } from './electron-helpers';
import { localExecutionFixture, localInvoke as invoke } from './local-execution-fixture';

function facts(userData: string) {
  const db = new Database(desktopDbPath(userData), { readonly: true });
  try {
    const rows = (table: string) =>
      db.prepare(`SELECT * FROM ${table} ORDER BY id`).all() as Array<Record<string, unknown>>;
    const assets = rows('generated_assets');
    return {
      runs: rows('generation_runs'),
      assets,
      requests: rows('automation_spend_requests'),
      calls: rows('automation_spend_calls'),
      imageHashes: assets.map((asset) => ({
        id: asset.id,
        sha256: createHash('sha256')
          .update(readFileSync(String(asset.media_path)))
          .digest('hex'),
      })),
    };
  } finally {
    db.close();
  }
}

test('Session purge retains actual Electron output and ledger, rejects late generation after fresh PID', async () => {
  test.setTimeout(120000);
  const fixture = await localExecutionFixture();
  const launched = await launchV25App('musefold-v25-session-generation-', { env: fixture.env });
  let app = launched.app;
  try {
    let page = await v25ShellPage(app);
    const provider = aiProviderSchema.parse(
      await invoke(page, 'aiProviders.create', {
        name: 'Session retention fixture',
        baseUrl: `${fixture.baseUrl}/v1`,
        model: 'fixture-a',
        apiKey: 'synthetic-a',
        activate: true,
      }),
    );
    const session = workbenchSessionSchema.parse(
      await invoke(page, 'workbench.createSession', {
        title: '保留实际作品',
        draft: { prompt: '原输入' },
      }),
    );
    const input = {
      sessionId: session.id,
      providerId: provider.id,
      prompt: '实际作品保留',
      count: 1,
    };
    const job = generationJobSchema.parse(await invoke(page, 'generation.create', input));
    await expect
      .poll(
        async () => generationJobSchema.parse(await invoke(page, 'generation.get', job.id)).status,
      )
      .toBe('succeeded');
    expect(fixture.imageCalls).toHaveLength(1);
    expect(fixture.imageCredentials).toEqual(['a']);
    const before = facts(launched.userDataDir);
    expect(before.runs).toHaveLength(1);
    expect(before.assets).toHaveLength(1);
    expect(before.runs[0].workbench_session_id).toBe(session.id);
    await invoke(page, 'workbench.removeSession', session.id);
    expect(await invoke(page, 'workbench.purgeSession', session.id)).toEqual({ purged: 1 });
    const detached = {
      ...before,
      runs: before.runs.map((run) => ({ ...run, workbench_session_id: null })),
    };
    expect(facts(launched.userDataDir)).toEqual(detached);
    await expect(invoke(page, 'generation.create', input)).rejects.toThrow('NOT_FOUND');
    expect(facts(launched.userDataDir)).toEqual(detached);
    expect(fixture.imageCalls).toHaveLength(1);
    const oldPid = app.process().pid;
    await app.close();
    app = (
      await launchV25App('musefold-v25-session-generation-', {
        reuseUserDataDir: launched.userDataDir,
        env: fixture.env,
      })
    ).app;
    expect(app.process().pid).not.toBe(oldPid);
    page = await v25ShellPage(app);
    await expect(invoke(page, 'generation.create', input)).rejects.toThrow('NOT_FOUND');
    await expect(invoke(page, 'workbench.restoreSession', session.id)).rejects.toThrow(
      'WORKBENCH_SESSION_NOT_FOUND',
    );
    expect(await invoke(page, 'workbench.purgeSession', session.id)).toEqual({ purged: 0 });
    expect(facts(launched.userDataDir)).toEqual(detached);
    expect(fixture.imageCalls).toHaveLength(1);
    expect(
      generationJobSchema.parse(await invoke(page, 'generation.get', job.id)).sessionId,
    ).toBeNull();
    await test.info().attach('session-generation-retention', {
      contentType: 'application/json',
      body: JSON.stringify({
        oldPid,
        newPid: app.process().pid,
        imageCalls: fixture.imageCalls.length,
        imageHashes: before.imageHashes,
        retainedRuns: before.runs.length,
        retainedAssets: before.assets.length,
        retainedRequests: before.requests.length,
        retainedCalls: before.calls.length,
        scope: 'Actual Electron/SQLite and loopback image provider; no paid upstream or real bill.',
      }),
    });
  } finally {
    await app.close();
    await fixture.close();
  }
});
