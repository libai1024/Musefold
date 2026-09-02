import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDesignSchemeDb, initDesignSchemeDb } from '../index';

const tempRoots: string[] = [];

afterEach(() => {
  closeDesignSchemeDb();
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('design-scheme SQLite startup recovery', () => {
  it('marks interrupted runs failed on the next disposable database open', () => {
    const root = mkdtempSync(join('/tmp', 'musefold-design-scheme-recovery-'));
    tempRoots.push(root);
    const dbPath = join(root, 'design-scheme.db');
    const db = initDesignSchemeDb({ dbPath });

    db.prepare(
      `INSERT INTO design_schemes
        (id, name, summary, status, source_presentation, source_label,
         current_revision_id, fidelity, created_at, updated_at)
       VALUES ('scheme_recovery', 'Recovery', '', 'draft', 'musefold-created', 'local',
         'revision_recovery', 'adapted', 1, 1)`,
    ).run();
    db.prepare(
      `INSERT INTO design_scheme_revisions
        (revision_id, scheme_id, schema_version, document_json, created_by, created_at)
       VALUES ('revision_recovery', 'scheme_recovery', 1, '{}', 'agent', 1)`,
    ).run();
    const interruptedStatuses = ['planning', 'executing', 'evaluating'] as const;
    for (const [index, status] of interruptedStatuses.entries()) {
      const runId = `run_recovery_${status}`;
      db.prepare(
        `INSERT INTO design_scheme_runs
          (run_id, revision_id, mode, status, policy_json, created_at)
         VALUES (?, 'revision_recovery', 'trial', ?, '{}', ?)`,
      ).run(runId, status, index + 1);
      db.prepare(
        `INSERT INTO design_scheme_run_steps
          (run_id, step_id, status, started_at)
         VALUES (?, 'step_1', ?, ?)`,
      ).run(runId, status === 'planning' ? 'pending' : 'running', index + 1);
    }
    db.prepare(
      `INSERT INTO design_scheme_runs
        (run_id, revision_id, mode, status, policy_json, created_at)
       VALUES ('run_recovery_done', 'revision_recovery', 'trial', 'completed', '{}', 10)`,
    ).run();
    db.prepare(
      `INSERT INTO design_scheme_run_steps
        (run_id, step_id, status, started_at, completed_at)
       VALUES ('run_recovery_done', 'step_1', 'completed', 10, 11)`,
    ).run();
    closeDesignSchemeDb();

    const reopened = initDesignSchemeDb({ dbPath });
    for (const status of interruptedStatuses) {
      const recovered = reopened
        .prepare('SELECT status, completed_at FROM design_scheme_runs WHERE run_id = ?')
        .get(`run_recovery_${status}`) as { status: string; completed_at: number | null };
      expect(recovered.status).toBe('failed');
      expect(recovered.completed_at).toBeTypeOf('number');
      expect(
        reopened
          .prepare('SELECT status, completed_at FROM design_scheme_run_steps WHERE run_id = ?')
          .get(`run_recovery_${status}`),
      ).toMatchObject({ status: 'failed' });
    }
    expect(
      reopened
        .prepare('SELECT status FROM design_scheme_runs WHERE run_id = ?')
        .get('run_recovery_done'),
    ).toEqual({ status: 'completed' });
  });
});
