import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';
import { configureTestCoreRuntime } from '../../testing';
import { getDb, closeDb } from '../../db';
import { WorkbenchSessionStore } from '../../db/repositories/workbench-sessions';
import { generate } from '../generation';

const directory = mkdtempSync(join(tmpdir(), 'session-late-generation-'));
configureTestCoreRuntime(directory);
afterAll(() => {
  closeDb();
  rmSync(directory, { recursive: true, force: true });
});

it('stops a late real generation entry before admission or provider IO for a permanently deleted Session', async () => {
  const db = getDb();
  const store = new WorkbenchSessionStore(db);
  const session = store.create({ title: 'Deleted' });
  store.changeDeleted(session.row.id, true);
  store.purge(session.row.id);
  const facts = () => ({
    runs: db.prepare('SELECT * FROM generation_runs').all(),
    requests: db.prepare('SELECT * FROM automation_spend_requests').all(),
    calls: db.prepare('SELECT * FROM automation_spend_calls').all(),
    deletions: db.prepare('SELECT * FROM workbench_session_deletions').all(),
  });
  const before = facts();
  const fetch = vi.fn(() => {
    throw new Error('No provider request is authorized by this fixture');
  });
  vi.stubGlobal('fetch', fetch);
  try {
    const result = await generate({
      jobId: 'late-generation',
      providerId: 'unconfigured',
      prompt: 'Late request',
      size: '1024x1024',
      quality: 'medium',
      n: 1,
      workbench: {
        sessionId: session.row.id,
        sessionTitle: 'Old title',
        turnId: 'old-turn',
        turnIndex: 0,
        resultIndex: 0,
        userPrompt: 'Late request',
      },
    });
    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'GENERATION_RUN_CREATE_FAILED' },
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(facts()).toEqual(before);
    expect(db.prepare('SELECT * FROM workbench_sessions').all()).toEqual([]);
  } finally {
    vi.unstubAllGlobals();
  }
});
