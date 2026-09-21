import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { configureTestCoreRuntime } from '../../testing';
import { closeDb, getDb } from '../../db/index';
import { promptsRepo } from '../../db/repositories/prompts';
import { WorkbenchSessionStore } from '../../db/repositories/workbench-sessions';
import { createWorkbenchRepositories } from '../../db/repositories/workbench';
import { AutomationSpendRepository } from '../../db/repositories/automation-spend';
import { ManagedExecutionRepository } from '../../db/repositories/managed-execution';
import { createSpendAuditService } from '../audit';
import { EncryptedManagedAnchorFile } from '../managed-execution-anchor-file';
import { ManagedExecutionGuard } from '../managed-execution-guard';
import { ManagedGenerationLedger } from '../managed-generation-ledger';
import { fixtureCipher } from './fixtures/managed-anchor-cipher';
import { managedCommand, managedContext, managedReceipt } from './fixtures/managed-generation';

let directory: string | undefined;
afterEach(() => {
  closeDb();
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = undefined;
});
const now = Date.UTC(2026, 8, 8);
const later = Date.UTC(2027, 1, 1);
const tables = [
  'automation_audit',
  'automation_spend_requests',
  'automation_spend_calls',
  'automation_spend_policies',
  'automation_budget_periods',
  'managed_generation_requests',
  'managed_execution_checkpoint',
] as const;
const facts = () =>
  Object.fromEntries(
    tables.map((table) => [table, getDb().prepare(`SELECT * FROM ${table}`).all()]),
  );

async function fixture(outcome: 'success' | 'unknown' | 'not-sent') {
  directory = mkdtempSync(join(tmpdir(), 'musefold-owned-audit-retention-'));
  configureTestCoreRuntime(directory);
  const db = getDb();
  const spend = new AutomationSpendRepository(db);
  spend.initializeBudget({ monthlyLimitPoints: 10, usedPoints: 0, month: '2026-09' }, now);
  const guard = new ManagedExecutionGuard(
    new ManagedExecutionRepository(db),
    new EncryptedManagedAnchorFile(join(directory, 'managed.anchor'), fixtureCipher),
  );
  await guard.enable();
  const ledger = new ManagedGenerationLedger(db, guard, () => {});
  const command = managedCommand();
  const context = managedContext(command);
  const prompt = promptsRepo.create({ title: 'Owned source', content: command.request.prompt });
  const sessions = new WorkbenchSessionStore(db);
  const session = sessions.create({
    title: 'Owned Session',
    draft: { prompt: command.request.prompt },
  });
  const runs = createWorkbenchRepositories(db).runs;
  const run = runs.create({
    id: command.executionId,
    workbenchSessionId: session.row.id,
    promptId: prompt.id,
    providerId: command.binding.providerId,
    model: command.binding.model,
    userPrompt: command.request.prompt,
    basePrompt: command.request.prompt,
    finalPrompt: command.request.prompt,
    params: { schemaVersion: 1, n: 4 },
    createdAt: now,
  });
  runs.start(run.id, 'owned-provider-request', now);
  runs.complete(run.id, { actualCost: 2, finishedAt: now + 1, assets: [] });
  const registered = (await ledger.register(command)).record;
  const record = await ledger.claimSubmission(
    registered.requestId,
    context,
    command.binding,
    run.id,
    now,
  );
  await ledger.applyReceipt(
    record.requestId,
    context,
    managedReceipt(record, {
      status: outcome === 'success' ? 'succeeded' : outcome === 'unknown' ? 'failed' : 'cancelled',
      dispatch: outcome === 'not-sent' ? 'confirmed_not_sent' : 'claimed',
      costProvenance:
        outcome === 'success'
          ? 'provider_reported'
          : outcome === 'unknown'
            ? 'unknown'
            : 'not_sent',
      costPoints: outcome === 'success' ? 2 : outcome === 'unknown' ? null : 0,
      terminalAt: new Date(now + 1).toISOString(),
    }),
    now + 1,
  );
  // Real audit service entry points for G/R/S. This tests storage retention, not approval UI.
  for (const action of ['generate_image', 'run_scheme', 'run_github_skill'] as const) {
    createSpendAuditService().record({
      at: now,
      caller: 'owned-client',
      action,
      promptText: command.request.prompt,
      params: {
        promptId: prompt.id,
        sessionId: session.row.id,
        sourceDigest: 'owned-source-snapshot',
      },
      estimatedPoints: 4,
      actualPoints: outcome === 'unknown' ? null : outcome === 'success' ? 2 : 0,
      approvedVia: 'confirmation',
      status: outcome === 'success' ? 'success' : outcome === 'unknown' ? 'failed' : 'cancelled',
      jobId: run.id,
    });
  }
  return { db, spend, ledger, command, context, record, prompt, sessions, session, runs, run };
}

describe('durable spend and approval retention across real local content cleanup', () => {
  for (const outcome of ['success', 'unknown', 'not-sent'] as const) {
    it.each(['prompt-purge', 'prompt-empty', 'session-purge', 'session-empty', 'history-delete'])(
      `${outcome}: %s preserves nonempty fees, receipt, frozen source and idempotency after reopen`,
      async (operation) => {
        const f = await fixture(outcome);
        const before = facts();
        for (const table of tables) expect(before[table].length, table).toBeGreaterThan(0);
        const budget = f.spend.budget(now);
        const laterBudget = f.spend.budget(later);
        if (outcome === 'unknown')
          expect(laterBudget).toMatchObject({ hasUnknown: true, remainingPoints: 0 });
        if (operation.startsWith('prompt')) {
          promptsRepo.softDelete(f.prompt.id);
          if (operation === 'prompt-purge') promptsRepo.purge(f.prompt.id);
          else expect(promptsRepo.purgeAllDeleted()).toBe(1);
          expect(promptsRepo.get(f.prompt.id)).toBeNull();
        } else if (operation.startsWith('session')) {
          f.sessions.changeDeleted(f.session.row.id, true);
          expect(
            operation === 'session-purge'
              ? f.sessions.purge(f.session.row.id)
              : f.sessions.emptyTrash(),
          ).toEqual({ purged: 1 });
          expect(() => f.sessions.get(f.session.row.id)).toThrow('会话不存在');
          expect(f.runs.get(f.run.id)?.workbenchSessionId).toBeNull();
        } else {
          expect(f.runs.softDelete([f.run.id], later)).toBe(1);
          expect(f.runs.get(f.run.id)?.deletedAt).toBe(later);
        }
        expect(facts()).toEqual(before);
        expect(f.spend.budget(now)).toEqual(budget);
        expect(f.spend.budget(later)).toEqual(laterBudget);
        const replay = await f.ledger.register(f.command);
        expect(replay.replayed).toBe(true);
        expect(replay.record.requestId).toBe(f.record.requestId);
        await expect(
          f.ledger.claimSubmission(
            f.record.requestId,
            f.context,
            f.command.binding,
            'new-local-run',
            later,
          ),
        ).rejects.toThrow('MANAGED_QUERY_ONLY');
        expect(facts()).toEqual(before);
        expect(f.db.pragma('foreign_key_check')).toEqual([]);
        closeDb();
        expect(facts()).toEqual(before);
        expect(new AutomationSpendRepository(getDb()).budget(now)).toEqual(budget);
        expect(new AutomationSpendRepository(getDb()).budget(later)).toEqual(laterBudget);
      },
    );
  }

  it('rejects parent policy/request/call deletion while durable receipt references remain', async () => {
    await fixture('unknown');
    const before = facts();
    for (const table of [
      'automation_spend_policies',
      'automation_spend_requests',
      'automation_spend_calls',
    ]) {
      expect(() => getDb().prepare(`DELETE FROM ${table}`).run()).toThrow(
        'FOREIGN KEY constraint failed',
      );
      expect(facts()).toEqual(before);
    }
  });

  it('limits audit reads to 200 without deleting older G/R/S approvals or unknown costs', async () => {
    const f = await fixture('unknown');
    const service = createSpendAuditService();
    const original = facts().automation_audit;
    for (let index = 0; index < 205; index++) {
      service.record({
        at: later + index,
        caller: 'owned-client',
        action: 'run_github_skill',
        promptText: 'owned source',
        params: {},
        estimatedPoints: null,
        actualPoints: null,
        approvedVia: 'denied',
        status: 'denied',
        jobId: null,
      });
    }
    const all = facts().automation_audit;
    expect(all).toHaveLength(original.length + 205);
    expect(service.list(1000)).toHaveLength(200);
    expect(facts().automation_audit.slice(0, original.length)).toEqual(original);
    expect(f.spend.budget(later)).toMatchObject({ hasUnknown: true, remainingPoints: 0 });
    closeDb();
    expect(facts().automation_audit).toEqual(all);
  });
});
