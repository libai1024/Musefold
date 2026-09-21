import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configureTestCoreRuntime } from '@musefold/core/testing';
import { closeDb, getDb, initDb } from '@musefold/core/db';
import { AutomationSpendRepository } from '@musefold/core/db/repositories/automation-spend';
import { ManagedExecutionRepository } from '@musefold/core/db/repositories/managed-execution';
import { ManagedGenerationLedger } from '@musefold/core/services/managed-generation-ledger';
import { ManagedExecutionGuard } from '@musefold/core/services/managed-execution-guard';
import { EncryptedManagedAnchorFile } from '@musefold/core/services/managed-execution-anchor-file';
import { fixtureCipher } from '@musefold/core/services/__tests__/fixtures/managed-anchor-cipher';
import {
  managedCommand,
  managedContext,
  managedReceipt,
} from '@musefold/core/services/__tests__/fixtures/managed-generation';
import { registerAutomationSpendSchema } from '@musefold/desktop-contracts/automation-spend';
import {
  describeManagedRecovery,
  listAccountCloudRecovery,
  listLegacyManagedDiagnostics,
} from '../account-cloud-recovery';

let root: string;
let spend: AutomationSpendRepository;
let guard: ManagedExecutionGuard;
const now = Date.UTC(2026, 8, 8);
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'musefold-cloud-recovery-'));
  configureTestCoreRuntime(root);
  initDb();
  spend = new AutomationSpendRepository(getDb());
  spend.initializeBudget({ monthlyLimitPoints: 1000, usedPoints: 0, month: '2026-09' }, now);
  guard = new ManagedExecutionGuard(
    new ManagedExecutionRepository(getDb()),
    new EncryptedManagedAnchorFile(join(root, 'anchor'), fixtureCipher),
  );
});
afterEach(() => {
  closeDb();
  rmSync(root, { recursive: true, force: true });
});
function legacy(external = false) {
  return registerAutomationSpendSchema.parse({
    idempotencyKey: randomUUID(),
    action: 'generate_image',
    caller: 'synthetic-local',
    input: {},
    frozenInput: {},
    bindings: [
      {
        providerId: 'old',
        providerType: 'openai-compatible',
        model: 'old',
        baseUrl: 'https://old.example.invalid',
        credentialEpoch: 'old-epoch',
        payerKind: external ? 'external' : 'account',
        policy: external ? 'external' : 'managed',
        ownerId: external ? null : 'original-owner',
        issuer: external ? null : 'https://old.example.invalid',
      },
    ],
    promptText: 'synthetic-private-prompt-not-a-diagnostic',
    executionId: randomUUID(),
    maxImageCalls: 1,
    maxTextCalls: 0,
    estimatedPoints: 1,
    now,
  });
}
async function enabled() {
  await guard.enable();
  return new ManagedGenerationLedger(getDb(), guard, () => {});
}

describe('cloud recovery keyset pages and local legacy diagnostics', () => {
  it('pages equal timestamps without losing tasks when earlier records settle or new rows arrive', async () => {
    const ledger = await enabled();
    const context = managedContext();
    const ids: string[] = [];
    for (let i = 0; i < 43; i++)
      ids.push(
        (
          await ledger.register({
            ...managedCommand(),
            callerKey: `page-${i}`,
            executionId: randomUUID(),
          })
        ).record.requestId,
      );
    const first = listAccountCloudRecovery(ledger, context);
    expect(first.items).toHaveLength(20);
    expect(first.nextCursor).toBeTruthy();
    await ledger.requestCancellation(first.items[0].requestId, context, now + 1);
    await ledger.register({
      ...managedCommand(),
      callerKey: 'arrived-later',
      executionId: randomUUID(),
      now: now + 100,
    });
    const second = listAccountCloudRecovery(ledger, context, { cursor: first.nextCursor ?? '' });
    const third = listAccountCloudRecovery(ledger, context, { cursor: second.nextCursor ?? '' });
    expect(second.items).toHaveLength(20);
    expect(third.items).toHaveLength(3);
    expect(third.nextCursor).toBeNull();
    expect([...first.items, ...second.items, ...third.items].map((item) => item.requestId)).toEqual(
      [...ids].sort().reverse(),
    );
    expect(
      new Set([...first.items, ...second.items, ...third.items].map((item) => item.requestId)).size,
    ).toBe(43);
  }, 20_000); // 44 durable registrations fsync encrypted anchors under the full build/test load.

  it('isolates cloud owners and binds cursors to issuer/principal and query kind', async () => {
    const ledger = await enabled();
    const context = managedContext();
    for (let i = 0; i < 21; i++)
      await ledger.register({
        ...managedCommand(),
        callerKey: `owner-${i}`,
        executionId: randomUUID(),
      });
    const page = listAccountCloudRecovery(ledger, context);
    expect(listAccountCloudRecovery(ledger, { ...context, principalId: 'foreign' }).items).toEqual(
      [],
    );
    for (const other of [
      { ...context, principalId: 'foreign' },
      { ...context, apiIssuer: 'https://other.example.invalid' },
    ])
      expect(() =>
        listAccountCloudRecovery(ledger, other, { cursor: page.nextCursor ?? '' }),
      ).toThrow('MANAGED_RECOVERY_CURSOR_INVALID');
    expect(() => listLegacyManagedDiagnostics({ cursor: page.nextCursor ?? '' })).toThrow(
      'MANAGED_RECOVERY_CURSOR_INVALID',
    );
    for (const cursor of ['not-json', 'a'.repeat(1024), 'base64=='])
      expect(() => listAccountCloudRecovery(ledger, context, { cursor })).toThrow(
        'MANAGED_RECOVERY_CURSOR_INVALID',
      );
    const relogin = { ...context, authEpoch: randomUUID() };
    expect(
      listAccountCloudRecovery(ledger, relogin, { cursor: page.nextCursor ?? '' }).items,
    ).toHaveLength(1);
  });

  it('lists the actual enablement blockers without assigning local legacy rows to a cloud account', async () => {
    const ids = Array.from({ length: 23 }, () => spend.register(legacy()).request.id);
    const external = spend.register(legacy(true)).request;
    const ended = spend.register(legacy()).request;
    spend.finishRequest(ended.id, 'cancelled', now + 1);
    const before = getDb().serialize();
    const first = listLegacyManagedDiagnostics();
    const second = listLegacyManagedDiagnostics({ cursor: first.nextCursor ?? '' });
    expect(first.items).toHaveLength(20);
    expect(second.items).toHaveLength(3);
    expect(second.nextCursor).toBeNull();
    expect([...first.items, ...second.items].map((item) => item.requestId)).toEqual(
      ids.sort().reverse(),
    );
    expect(
      first.items.every((item) => item.reason === 'in_progress' && item.kind === 'image'),
    ).toBe(true);
    expect(JSON.stringify(first)).not.toContain('original-owner');
    expect(JSON.stringify(first)).not.toContain('synthetic-private-prompt');
    expect(JSON.stringify(first)).not.toContain(external.id);
    expect(getDb().serialize()).toEqual(before);
    await expect(guard.enable()).rejects.toThrow('MANAGED_LEGACY_SPEND_UNRESOLVED');
  });

  it('separates unknown legacy cost from a terminal label and excludes mapped cloud requests', async () => {
    const input = legacy();
    const old = spend.register(input).request;
    const call = spend.prepareCall({
      requestId: old.id,
      ordinal: 0,
      kind: 'image',
      binding: input.bindings[0],
      input: {},
      generationRunId: 'old-local',
    });
    spend.claimCall(call.id, input.bindings[0], 'old-runtime', now);
    spend.finishRequest(old.id, 'failed', now + 1);
    expect(listLegacyManagedDiagnostics().items).toMatchObject([
      { requestId: old.id, reason: 'unknown_cost' },
    ]);
  });

  it('recognizes old terminal not-sent receipts without inventing zero for unknown or active requests', async () => {
    const ledger = await enabled();
    const record = (await ledger.register(managedCommand())).record;
    const base = { ...record, submissionState: 'query_only' as const };
    const terminal = {
      status: 'cancelled' as const,
      dispatch: 'confirmed_not_sent' as const,
      terminalAt: '2026-09-08T01:00:00.000Z',
      costPoints: null,
    };
    expect(
      describeManagedRecovery({ ...base, receipt: managedReceipt(record, terminal) }).costKnown,
    ).toBe(true);
    expect(
      describeManagedRecovery({
        ...base,
        receipt: managedReceipt(record, {
          ...terminal,
          dispatch: 'claimed',
          costProvenance: 'unknown',
        }),
      }).costKnown,
    ).toBe(false);
    expect(
      describeManagedRecovery({ ...base, receipt: managedReceipt(record, { costPoints: null }) })
        .costKnown,
    ).toBe(false);
  });

  it('mapped requests are only in their cloud list, even when their local result row is absent', async () => {
    const ledger = await enabled();
    const record = (await ledger.register(managedCommand())).record;
    expect(listLegacyManagedDiagnostics()).toEqual({ items: [], nextCursor: null });
    expect(listAccountCloudRecovery(ledger, managedContext()).items).toMatchObject([
      {
        requestId: record.requestId,
        localGenerationId: null,
        canCancel: true,
        recovery: { result: 'history_removed', costKnown: true },
      },
    ]);
  });
});
