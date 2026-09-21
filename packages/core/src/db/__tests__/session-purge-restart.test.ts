import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { takeoverDesktopDatabase } from '@musefold/desktop-db';
import { APP_DATA_NAMESPACE } from '@musefold/domain/constants';
import { expect, it } from 'vitest';
import { WorkbenchSessionStore } from '../repositories/workbench-sessions';
import { createWorkbenchRepositories } from '../repositories/workbench';

it('retains permanent identities across a new PID and imports an old recipe ledger without resurrecting its Session', () => {
  const directory = mkdtempSync(join(tmpdir(), 'session-purge-restart-'));
  const path = join(directory, 'main.db');
  const legacyPath = join(directory, `musefold-recipe-data-${APP_DATA_NAMESPACE}.db`);
  const db = new Database(path);
  const legacy = new Database(legacyPath);
  try {
    takeoverDesktopDatabase(db);
    takeoverDesktopDatabase(legacy);
    const store = new WorkbenchSessionStore(db);
    const session = store.create({ title: 'Deleted Session' });
    const repos = createWorkbenchRepositories(legacy);
    repos.sessions.ensure({ id: session.row.id, title: 'Legacy copy' });
    repos.runs.create({
      id: 'imported-run',
      workbenchSessionId: session.row.id,
      providerId: 'provider',
      model: 'model',
      basePrompt: 'base',
      finalPrompt: 'final',
      params: { schemaVersion: 1, n: 1 },
      createdAt: 1,
    });
    repos.runs.start('imported-run', 'owned-provider-request', 1);
    repos.runs.complete('imported-run', {
      actualCost: 0.25,
      finishedAt: 2,
      assets: [{ id: 'imported-asset', mediaPath: '/owned/existing.png' }],
    });
    store.changeDeleted(session.row.id, true);
    store.purge(session.row.id);
    legacy.close();
    db.close();
    const fixture = fileURLToPath(
      new URL('../repositories/__tests__/fixtures/session-purge-restart.ts', import.meta.url),
    );
    const result = JSON.parse(
      execFileSync(
        process.execPath,
        ['--import', 'tsx', fixture, path, directory, session.row.id],
        { encoding: 'utf8', timeout: 15_000 },
      ),
    );
    expect(result.pid).not.toBe(process.pid);
    expect(result).toMatchObject({
      ensureRejected: true,
      sessions: [],
      foreignKeys: [],
      runs: [{ id: 'imported-run', workbench_session_id: null, actual_cost: 0.25 }],
      assets: [{ id: 'imported-asset', run_id: 'imported-run', media_path: '/owned/existing.png' }],
      deletions: [{ id: session.row.id }],
    });
    expect(existsSync(legacyPath)).toBe(false);
  } finally {
    if (legacy.open) legacy.close();
    if (db.open) db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
