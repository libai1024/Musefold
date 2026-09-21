import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
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
import { managedCommand, managedReceipt } from './fixtures/managed-generation';

// C3-B 规则层（路线图 §6.21）：结算/身份竞争的纯 SQLite 裁决。
// 与既有文件分工：automation-spend.test.ts 覆盖重复回执与显式零；
// managed-generation-ledger.test.ts 覆盖常规回执协调；本文件只补
// 「旧回调（旧 epoch / 旧账号 / 旧 lineage）不写新主体、新库、新 lineage」与
// 「失败后重试的预留交接」两类交错裁决。

const now = Date.UTC(2026, 8, 14);
const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close();
});

function fixture(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const db = new Database(join(root, 'data.db'));
  cleanup.push(() => db.close());
  db.pragma('foreign_keys = ON');
  takeoverDesktopDatabase(db);
  const spend = new AutomationSpendRepository(db);
  spend.initializeBudget({ monthlyLimitPoints: 10, usedPoints: 0, month: '2026-09' }, now);
  const repository = new ManagedExecutionRepository(db);
  const anchor = new EncryptedManagedAnchorFile(join(root, 'anchor'), fixtureCipher);
  const guard = new ManagedExecutionGuard(repository, anchor);
  return { root, db, spend, repository, anchor, guard };
}

function throwCode(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return String((error as { code?: string }).code ?? (error as Error).message);
  }
  return '';
}

function durableCommand() {
  return registerAutomationSpendSchema.parse({
    idempotencyKey: randomUUID(),
    action: 'generate_image',
    caller: 'fixture',
    input: { prompt: 'fixture' },
    frozenInput: { prompt: 'fixture' },
    bindings: [
      {
        providerId: 'fixture-provider',
        providerType: 'openai-compatible',
        model: 'fixture-model',
        baseUrl: 'http://127.0.0.1:12345/v1',
        credentialEpoch: 'fixture-key-epoch',
        payerKind: 'account',
        ownerId: 'fixture-owner',
        issuer: 'http://127.0.0.1:12346',
        policy: 'managed',
      },
    ],
    promptText: 'fixture',
    executionId: randomUUID(),
    maxImageCalls: 1,
    maxTextCalls: 0,
    estimatedPoints: 6,
    now,
  });
}

describe('C3-B settlement identity races (rules, real SQLite)', () => {
  it('旧 runtime epoch 的迟到完成回调不能重写新 PID 恢复后的账本', () => {
    const f = fixture('musefold-c3b-epoch-');
    const input = durableCommand();
    const request = f.spend.register(input).request;
    const call = f.spend.prepareCall({
      requestId: request.id,
      ordinal: 0,
      kind: 'image',
      binding: input.bindings[0],
      input: { prompt: 'fixture' },
      generationRunId: 'old-local-run',
    });
    const claim = f.spend.claimCall(call.id, input.bindings[0], 'old-runtime-epoch', now);
    expect(claim?.claimId).toBeTruthy();
    expect(f.spend.budget(now)).toMatchObject({ reservedPoints: 6, remainingPoints: 4 });

    // 新 PID（新 runtime epoch）接管：发送标记按 unknown 收敛，不允许隐式和解。
    expect(f.spend.recover('new-runtime-epoch', now + 1)).toBe(1);
    const recoveredCall = f.spend.calls(request.id)[0];
    expect(recoveredCall).toMatchObject({ state: 'unknown', reportedPoints: null });
    expect(f.spend.get(request.id)).toMatchObject({
      state: 'terminal',
      outcome: 'failed',
      reservationState: 'unknown',
    });
    expect(f.spend.budget(now)).toMatchObject({ hasUnknown: true, remainingPoints: 0 });

    // 旧 claim 迟到：已知费用证据与已固化的 unknown 冲突 → 拒绝且零写入。
    expect(
      throwCode(() =>
        f.spend.completeCall(
          call.id,
          claim?.claimId ?? '',
          { reportedPoints: 0, source: 'provider_reported', evidenceRef: null },
          now + 2,
        ),
      ),
    ).toBe('SPEND_RECONCILIATION_REQUIRED');
    // 旧 claim 迟到：与已固化证据一致的 unknown 也不是新的和解事件。
    expect(
      f.spend.completeCall(
        call.id,
        claim?.claimId ?? '',
        { reportedPoints: null, source: 'unknown', evidenceRef: null },
        now + 3,
      ),
    ).toBe(false);
    // 非本 claim 的回执无权写。
    expect(
      throwCode(() =>
        f.spend.completeCall(
          call.id,
          'foreign-claim',
          { reportedPoints: null, source: 'unknown', evidenceRef: null },
          now + 4,
        ),
      ),
    ).toBe('SPEND_CLAIM_MISMATCH');
    expect(f.spend.calls(request.id)[0]).toEqual(recoveredCall);
    expect(f.spend.budget(now)).toMatchObject({ hasUnknown: true, remainingPoints: 0 });
    // 新 epoch 也不能按旧 binding 重新 claim 同一 call。
    expect(f.spend.claimCall(call.id, input.bindings[0], 'new-runtime-epoch', now + 5)).toBeNull();
  });

  it('换号后旧主体回执不写新主体：claim/applyReceipt 均按身份拒绝且账本零变更', async () => {
    const f = fixture('musefold-c3b-subject-');
    await f.guard.enable();
    const ledger = new ManagedGenerationLedger(f.db, f.guard, () => {});
    const input = managedCommand();
    const context = {
      apiIssuer: input.binding.apiIssuer,
      principalId: input.binding.principalId,
      authEpoch: input.authEpoch,
    };
    const { record } = await ledger.register(input);
    const claimed = await ledger.claimSubmission(
      record.requestId,
      context,
      input.binding,
      'local-run',
      input.now,
    );
    expect(f.spend.get(record.requestId)?.reservationState).toBe('unknown');

    const foreignContext = { ...context, principalId: 'another-principal' };
    const foreignEpoch = { ...context, authEpoch: randomUUID() };
    const before = JSON.stringify(claimed);
    const budgetBefore = f.spend.budget(input.now);
    // 换号后查询/和解按主体拒绝；发送资格更不可能转移（claim 已被本进程消费，
    // 任何重放——无论身份——都只得到 MANAGED_QUERY_ONLY）。
    expect(() => ledger.forQuery(record.requestId, foreignContext)).toThrow(
      'MANAGED_IDENTITY_CHANGED',
    );
    await expect(
      ledger.claimSubmission(record.requestId, foreignContext, input.binding, 'x', now),
    ).rejects.toMatchObject({ code: 'MANAGED_QUERY_ONLY' });
    await expect(
      ledger.claimSubmission(record.requestId, foreignEpoch, input.binding, 'x', now),
    ).rejects.toMatchObject({ code: 'MANAGED_QUERY_ONLY' });
    const receipt = managedReceipt(claimed, {
      status: 'succeeded',
      dispatch: 'claimed',
      costProvenance: 'provider_reported',
      costPoints: 3,
      terminalAt: '2026-09-14T01:00:00.000Z',
    });
    await expect(
      ledger.applyReceipt(record.requestId, foreignContext, receipt, now),
    ).rejects.toMatchObject({ code: 'MANAGED_IDENTITY_CHANGED' });
    // 他账号的回执绑定（不同 payer）同样拒绝：schema 与账本各拦一层。
    if (!receipt.binding) throw new Error('managedReceipt fixture must include binding');
    await expect(
      ledger.applyReceipt(
        record.requestId,
        context,
        {
          ...receipt,
          binding: {
            ...receipt.binding,
            payer: { ...receipt.binding.payer, ownerId: 'another-owner' },
          },
        },
        now,
      ),
    ).rejects.toMatchObject({ code: 'MANAGED_RECEIPT_MISMATCH' });
    expect(JSON.stringify(ledger.forQuery(record.requestId, context))).toBe(before);
    expect(f.spend.budget(input.now)).toEqual(budgetBefore);
    expect(f.spend.get(record.requestId)).toMatchObject({
      state: 'running',
      reservationState: 'unknown',
    });
    // 原主体随后和解成功一次；重复送达同一回执是幂等 no-op。
    expect(await ledger.applyReceipt(record.requestId, context, receipt, now)).toBe(true);
    expect(await ledger.applyReceipt(record.requestId, context, receipt, now + 1)).toBe(false);
    expect(f.spend.get(record.requestId)).toMatchObject({
      state: 'terminal',
      reservationState: 'released',
    });
    expect(f.spend.budget(input.now)).toMatchObject({
      usedPoints: 3,
      reservedPoints: 0,
      remainingPoints: 7,
    });
  });

  it('旧 lineage 的迟到回执写不进恢复后的新库：跨库句柄各自隔离', async () => {
    const f = fixture('musefold-c3b-lineage-');
    await f.guard.enable();
    const ledger = new ManagedGenerationLedger(f.db, f.guard, () => {});
    const input = managedCommand();
    const context = {
      apiIssuer: input.binding.apiIssuer,
      principalId: input.binding.principalId,
      authEpoch: input.authEpoch,
    };
    const { record } = await ledger.register(input);
    // 备份时点：checkpoint 停在 register（K）。恢复后的旧句柄从此再无合法协调资格。
    const oldBytes = f.db.serialize();
    const oldDb = new Database(oldBytes);
    cleanup.push(() => oldDb.close());
    const oldLedger = new ManagedGenerationLedger(
      oldDb,
      new ManagedExecutionGuard(new ManagedExecutionRepository(oldDb), f.anchor),
      () => {},
    );
    // 现库继续前进（claim，checkpoint 到 N > K）。
    const claimed = await ledger.claimSubmission(
      record.requestId,
      context,
      input.binding,
      'local-run',
      input.now,
    );
    const receipt = managedReceipt(claimed, {
      status: 'succeeded',
      dispatch: 'claimed',
      costProvenance: 'provider_reported',
      costPoints: 3,
      terminalAt: '2026-09-14T01:00:00.000Z',
    });
    await expect(
      oldLedger.applyReceipt(record.requestId, context, receipt, now),
    ).rejects.toMatchObject({ code: 'MANAGED_RECONCILIATION_REQUIRED' });
    expect(
      oldDb
        .prepare('SELECT COUNT(*) AS n FROM automation_spend_calls WHERE state = ?')
        .get('completed'),
    ).toEqual({ n: 0 });
    // 现库（新 lineage 主体）保持 unknown；共享锚点未被失败操作污染。
    expect(f.spend.get(record.requestId)?.reservationState).toBe('unknown');
    expect(await f.anchor.read()).toMatchObject({ pending: null });
    expect(await f.guard.status()).toMatchObject({ mode: 'active' });
    // 原句柄仍可完成正式和解（原主体、原库）。
    expect(await ledger.applyReceipt(record.requestId, context, receipt, now)).toBe(true);
    expect(f.spend.budget(input.now)).toMatchObject({ usedPoints: 3, hasUnknown: false });
  });

  it('失败后重试的预留交接：已知费用释放旧预留，新请求重新占用且不双重持有', () => {
    const f = fixture('musefold-c3b-retry-');
    const first = durableCommand();
    const request = f.spend.register(first).request;
    const call = f.spend.prepareCall({
      requestId: request.id,
      ordinal: 0,
      kind: 'image',
      binding: first.bindings[0],
      input: { prompt: 'fixture' },
      generationRunId: 'old-local-run',
    });
    const claim = f.spend.claimCall(call.id, first.bindings[0], 'runtime-a', now);
    f.spend.completeCall(
      call.id,
      claim?.claimId ?? '',
      {
        reportedPoints: 2,
        source: 'provider_reported',
        evidenceRef: null,
      },
      now + 1,
    );
    f.spend.finishRequest(request.id, 'failed', now + 2);
    expect(f.spend.budget(now)).toMatchObject({
      usedPoints: 2,
      reservedPoints: 0,
      remainingPoints: 8,
      hasUnknown: false,
    });
    // 重试是新键、新预留；旧请求的 terminal 不能继续占用额度。
    const second = { ...durableCommand(), estimatedPoints: 5 };
    const retry = f.spend.register(second).request;
    expect(retry).toMatchObject({ state: 'authorized', approvalSource: 'budget' });
    expect(f.spend.budget(now)).toMatchObject({
      usedPoints: 2,
      reservedPoints: 5,
      remainingPoints: 3,
    });
    // 旧请求重放同键幂等，不产生第二笔预留。
    expect(f.spend.register(second).replayed).toBe(true);
    expect(f.spend.budget(now)).toMatchObject({ reservedPoints: 5 });
  });

  it('异步结算未落稳期间：同库二次启用被拒，新请求不获自动预算', async () => {
    const f = fixture('musefold-c3b-enable-');
    await f.guard.enable();
    const ledger = new ManagedGenerationLedger(f.db, f.guard, () => {});
    const input = managedCommand();
    const context = {
      apiIssuer: input.binding.apiIssuer,
      principalId: input.binding.principalId,
      authEpoch: input.authEpoch,
    };
    const { record } = await ledger.register(input);
    await ledger.claimSubmission(record.requestId, context, input.binding, 'local-run', input.now);
    // 回执尚未落库（结算暂停）：lineage 只允许一个，二次 enable 不是绕路。
    await expect(f.guard.enable()).rejects.toMatchObject({ code: 'MANAGED_ALREADY_INITIALIZED' });
    // 预算被 unknown 锁死：并发新请求必须逐次确认，不得自动放行。
    const second = { ...managedCommand(), callerKey: randomUUID(), executionId: randomUUID() };
    const pending = await ledger.register(second);
    expect(f.spend.get(pending.record.requestId)?.state).toBe('pending_confirmation');
    // claim 后原预留从 held 转 unknown：held 归零，但额度同样不释放。
    expect(f.spend.get(record.requestId)?.reservationState).toBe('unknown');
    expect(f.spend.budget(input.now)).toMatchObject({
      hasUnknown: true,
      remainingPoints: 0,
      reservedPoints: 0,
    });
  });
});
