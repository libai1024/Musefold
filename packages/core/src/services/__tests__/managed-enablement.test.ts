import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { takeoverDesktopDatabase } from '@musefold/desktop-db';
import { registerAutomationSpendSchema } from '@musefold/desktop-contracts/automation-spend';
import { afterEach, describe, expect, it } from 'vitest';
import { AutomationSpendRepository } from '../../db/repositories/automation-spend';
import { ManagedExecutionRepository } from '../../db/repositories/managed-execution';
import { ManagedExecutionGuard } from '../managed-execution-guard';
import { EncryptedManagedAnchorFile } from '../managed-execution-anchor-file';
import { ManagedGenerationLedger } from '../managed-generation-ledger';
import { fixtureCipher } from './fixtures/managed-anchor-cipher';
import { managedCommand } from './fixtures/managed-generation';

const now = Date.UTC(2026, 8, 8);
const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close();
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'musefold-enable-preflight-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'data.db');
  const db = new Database(path);
  cleanup.push(() => db.close());
  db.pragma('foreign_keys = ON');
  takeoverDesktopDatabase(db);
  const spend = new AutomationSpendRepository(db);
  spend.initializeBudget({ monthlyLimitPoints: 10, usedPoints: 1, month: '2026-09' }, now);
  const repository = new ManagedExecutionRepository(db);
  const anchorPath = join(root, 'anchor');
  const anchor = new EncryptedManagedAnchorFile(anchorPath, fixtureCipher);
  const guard = new ManagedExecutionGuard(repository, anchor);
  return { path, db, spend, repository, anchorPath, anchor, guard };
}

function command(external = false) {
  return registerAutomationSpendSchema.parse({
    idempotencyKey: randomUUID(),
    action: 'generate_image',
    caller: 'fixture',
    input: {},
    frozenInput: {},
    bindings: [
      {
        providerId: 'fixture',
        providerType: 'openai-compatible',
        model: 'fixture',
        baseUrl: 'https://fixture.example.invalid',
        credentialEpoch: 'fixture-epoch',
        payerKind: external ? 'external' : 'account',
        policy: external ? 'external' : 'managed',
        ownerId: external ? null : 'fixture-owner',
        issuer: external ? null : 'https://fixture.example.invalid',
      },
    ],
    promptText: null,
    executionId: randomUUID(),
    maxImageCalls: 1,
    maxTextCalls: 0,
    estimatedPoints: 3,
    now,
  });
}

describe('managed enablement persisted-spend preflight', () => {
  it.each(['authorized', 'pending_confirmation', 'running', 'unknown'] as const)(
    'refuses %s legacy managed work before writing the anchor or changing the budget',
    async (state) => {
      const f = fixture();
      if (state === 'pending_confirmation') f.spend.setBudgetLimit(0, now);
      const input = command();
      const request = f.spend.register(input).request;
      if (state === 'running' || state === 'unknown') {
        const call = f.spend.prepareCall({
          requestId: request.id,
          ordinal: 0,
          kind: 'image',
          binding: input.bindings[0],
          input: {},
          generationRunId: 'old-local',
        });
        f.spend.claimCall(call.id, input.bindings[0], 'old-runtime', now);
        if (state === 'unknown') f.spend.finishRequest(request.id, 'failed', now);
      }
      const original = f.db.serialize();
      await expect(f.guard.enable()).rejects.toMatchObject({
        code: 'MANAGED_LEGACY_SPEND_UNRESOLVED',
      });
      expect(f.db.serialize()).toEqual(original);
      expect(await f.anchor.read()).toBeNull();
      expect(f.repository.checkpoint()).toBeNull();
      // Neither a new calendar month nor an expired confirmation is permission to discard work.
      expect(f.spend.budget(Date.UTC(2026, 9, 1)).hasUnknown).toBe(state === 'unknown');
      await expect(f.guard.enable()).rejects.toMatchObject({
        code: 'MANAGED_LEGACY_SPEND_UNRESOLVED',
      });
    },
  );

  it('allows explicitly denied legacy confirmation and preserves its terminal audit', async () => {
    const f = fixture();
    f.spend.setBudgetLimit(0, now);
    const request = f.spend.register(command()).request;
    expect(f.spend.resolveConfirmation(request.confirmationId ?? '', false, now)).toBe(true);
    const saved = f.spend.get(request.id);
    await f.guard.enable();
    expect(f.spend.get(request.id)).toEqual(saved);
    expect(await f.guard.status()).toMatchObject({ mode: 'active' });
    expect(f.spend.budget(now)).toMatchObject({ monthlyLimitPoints: 0, usedPoints: 1 });
  });

  it('allows settled legacy history and active BYOK without changing their records', async () => {
    const f = fixture();
    const old = f.spend.register(command()).request;
    f.spend.finishRequest(old.id, 'cancelled', now); // No call was ever sent.
    const external = f.spend.register(command(true)).request;
    const saved = f.spend.get(old.id);
    await f.guard.enable();
    expect(f.spend.get(old.id)).toEqual(saved);
    expect(f.spend.get(external.id)).toEqual(external);
    f.spend.finishRequest(external.id, 'success', now);
    expect(f.spend.budget(now)).toMatchObject({ usedPoints: 1, reservedPoints: 0 });
  });

  it('does not treat a terminal label as settlement of an unresolved managed call', async () => {
    const f = fixture();
    const input = command();
    const request = f.spend.register(input).request;
    f.spend.prepareCall({
      requestId: request.id,
      ordinal: 0,
      kind: 'image',
      binding: input.bindings[0],
      input: {},
      generationRunId: 'old-local',
    });
    // Damaged/imported state: a terminal request cannot hide its unfinished call.
    f.db
      .prepare(
        "UPDATE automation_spend_requests SET state = 'terminal', reservation_state = 'released' WHERE id = ?",
      )
      .run(request.id);
    await expect(f.guard.enable()).rejects.toMatchObject({
      code: 'MANAGED_LEGACY_SPEND_UNRESOLVED',
    });
    expect(await f.anchor.read()).toBeNull();
  });

  it('checks all persisted scopes rather than only the current budget month or caller', async () => {
    const f = fixture();
    const other = new AutomationSpendRepository(f.db, 'old-scope');
    other.initializeBudget({ monthlyLimitPoints: 0, usedPoints: 0, month: '2026-08' }, now);
    other.register({ ...command(), now: Date.UTC(2026, 7, 1) });
    expect(f.spend.budget(now)).toMatchObject({ reservedPoints: 0, hasUnknown: false });
    await expect(f.guard.enable()).rejects.toMatchObject({
      code: 'MANAGED_LEGACY_SPEND_UNRESOLVED',
    });
    expect(await f.anchor.read()).toBeNull();
  });

  it('refuses a fresh namespace when remote associations survive a lost checkpoint and anchor', async () => {
    const f = fixture();
    await f.guard.enable();
    const ledger = new ManagedGenerationLedger(f.db, f.guard, () => {});
    await ledger.register(managedCommand());
    f.db.prepare('DELETE FROM managed_execution_checkpoint').run();
    unlinkSync(f.anchorPath);
    await expect(f.guard.enable()).rejects.toMatchObject({
      code: 'MANAGED_RECONCILIATION_REQUIRED',
    });
    expect(f.repository.checkpoint()).toBeNull();
    expect(await f.anchor.read()).toBeNull();
    expect(f.db.prepare('SELECT COUNT(*) AS n FROM managed_generation_requests').get()).toEqual({
      n: 1,
    });
  });

  it('rechecks a late write from another SQLite connection after flushing pending', async () => {
    const f = fixture();
    const otherDb = new Database(f.path);
    cleanup.push(() => otherDb.close());
    const other = new AutomationSpendRepository(otherDb);
    let inserted = false;
    const guard = new ManagedExecutionGuard(f.repository, {
      scope: f.anchor.scope,
      read: () => f.anchor.read(),
      write: async (value) => {
        await f.anchor.write(value);
        if (value.pending?.kind === 'enable') {
          other.register(command());
          inserted = true;
        }
      },
    });
    await expect(guard.enable()).rejects.toMatchObject({ code: 'MANAGED_LEGACY_SPEND_UNRESOLVED' });
    expect(inserted).toBe(true);
    expect(f.repository.checkpoint()).toBeNull();
    expect((await f.anchor.read())?.pending?.kind).toBe('enable');
    expect(await guard.status()).toEqual({ mode: 'query_only' });
    expect(await guard.recoverCommittedOperation()).toBe(false);
    expect(f.spend.budget(now)).toMatchObject({ usedPoints: 1, reservedPoints: 3 });
    await expect(guard.enable()).rejects.toMatchObject({ code: 'MANAGED_ALREADY_INITIALIZED' });
  });
});
