import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { configureTestCoreRuntime } from '@musefold/core/testing';
import { getDb, initDb, closeDb } from '@musefold/core/db';
import { ManagedExecutionRepository } from '@musefold/core/db/repositories/managed-execution';
import { ManagedExecutionGuard } from '@musefold/core/services/managed-execution-guard';
import { EncryptedManagedAnchorFile } from '@musefold/core/services/managed-execution-anchor-file';
import { fixtureCipher } from '@musefold/core/services/__tests__/fixtures/managed-anchor-cipher';

const state = vi.hoisted(() => ({ root: '', anchor: vi.fn(), budget: {} as unknown }));
vi.mock('electron-store', () => ({
  default: class {
    get(key: string, fallback?: unknown) {
      return key === 'automation.budget' ? state.budget : fallback;
    }
    set(key: string, value: unknown) {
      if (key === 'automation.budget') state.budget = value;
    }
  },
}));
vi.mock('../../system/paths', () => ({ getPaths: () => ({ userData: state.root }) }));
vi.mock('../../security/managed-execution-anchor', () => ({
  createManagedExecutionAnchor: state.anchor,
}));
import { managedExecutionWorkScope } from '../../system/managed-execution';
import {
  getAutomationBudget,
  getAutomationSpendRepository,
  setAutomationBudgetLimit,
  settleAutomationBudget,
} from '../automation';

let anchor: EncryptedManagedAnchorFile;
let guard: ManagedExecutionGuard;
let repository: ManagedExecutionRepository;
beforeEach(() => {
  state.root = mkdtempSync(join(tmpdir(), 'musefold-host-budget-'));
  configureTestCoreRuntime(state.root);
  initDb();
  state.budget = {
    monthlyLimitPoints: 10,
    usedPoints: 1,
    month: new Date().toISOString().slice(0, 7),
  };
  anchor = new EncryptedManagedAnchorFile(join(state.root, 'anchor'), fixtureCipher);
  state.anchor.mockReset().mockReturnValue(anchor);
  repository = new ManagedExecutionRepository(getDb());
  guard = new ManagedExecutionGuard(repository, anchor);
  getAutomationBudget();
});
afterEach(() => {
  closeDb();
  rmSync(state.root, { recursive: true, force: true });
});

describe('main-process shared budget with actual work scope and SQLite', () => {
  it('writes pre-enable settings without a lineage and coordinates later limit/usage changes', async () => {
    await setAutomationBudgetLimit(12);
    expect(repository.checkpoint()).toBeNull();
    expect(await anchor.read()).toBeNull();
    await guard.enable();
    await Promise.all([setAutomationBudgetLimit(20), settleAutomationBudget(2.5)]);
    expect(getAutomationBudget()).toMatchObject({ monthlyLimitPoints: 20, usedPoints: 3.5 });
    expect(repository.checkpoint()?.revision).toBe(2);
    expect((await anchor.read())?.committed).toEqual(repository.checkpoint());
    await setAutomationBudgetLimit(20);
    await settleAutomationBudget(0);
    expect(repository.checkpoint()?.revision).toBe(2);
    expect(state.budget).toMatchObject({ monthlyLimitPoints: 20, usedPoints: 3.5 });
  });

  it('rejects invalid amounts before touching the anchor or existing usage', async () => {
    await guard.enable();
    const before = repository.checkpoint();
    for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(setAutomationBudgetLimit(value)).rejects.toThrow();
      await expect(settleAutomationBudget(value)).rejects.toThrow();
    }
    expect(repository.checkpoint()).toEqual(before);
    expect(getAutomationBudget()).toMatchObject({ monthlyLimitPoints: 10, usedPoints: 1 });
  });

  it('rejects ordinary settings and usage when restore has suspended the anchor', async () => {
    await guard.enable();
    await guard.suspendForRestore();
    await expect(setAutomationBudgetLimit(999)).rejects.toMatchObject({
      code: 'MANAGED_RECONCILIATION_REQUIRED',
    });
    await expect(settleAutomationBudget(2)).rejects.toMatchObject({
      code: 'MANAGED_RECONCILIATION_REQUIRED',
    });
    expect(getAutomationBudget()).toMatchObject({ monthlyLimitPoints: 10, usedPoints: 1 });
    expect(await guard.status()).toEqual({ mode: 'query_only' });
  });

  it('does not write a late budget after restore drain aborts a pending anchor flush', async () => {
    await guard.enable();
    let release = () => {};
    let entered = () => {};
    const barrier = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const write = anchor.write.bind(anchor);
    vi.spyOn(anchor, 'write').mockImplementationOnce(async (value) => {
      await write(value);
      entered();
      await hold;
    });
    const update = setAutomationBudgetLimit(99);
    const rejection = expect(update).rejects.toMatchObject({ code: 'MANAGED_OPERATION_ABORTED' });
    await barrier;
    let drained = false;
    const drain = managedExecutionWorkScope()
      .drainForRestore(2000)
      .then(() => {
        drained = true;
      });
    await Promise.resolve();
    expect(drained).toBe(false);
    release();
    await rejection;
    await drain;
    expect(getAutomationBudget()).toMatchObject({ monthlyLimitPoints: 10, usedPoints: 1 });
    expect(repository.checkpoint()?.revision).toBe(0);
    expect(await guard.status()).toEqual({ mode: 'query_only' });
    await expect(setAutomationBudgetLimit(5)).rejects.toMatchObject({
      code: 'MANAGED_RESTART_REQUIRED',
    });
  });

  it('keeps a committed usage unknown to automatic writes when the final anchor flush fails', async () => {
    await guard.enable();
    const write = anchor.write.bind(anchor);
    let writes = 0;
    vi.spyOn(anchor, 'write').mockImplementation(async (value) => {
      if (++writes === 2) throw new Error('fixture final anchor unavailable');
      await write(value);
    });
    await expect(settleAutomationBudget(2)).rejects.toThrow('fixture final anchor unavailable');
    expect(getAutomationBudget().usedPoints).toBe(3);
    expect(await guard.status()).toEqual({ mode: 'query_only' });
    await expect(settleAutomationBudget(2)).rejects.toMatchObject({
      code: 'MANAGED_RECONCILIATION_REQUIRED',
    });
    expect(getAutomationBudget().usedPoints).toBe(3);
    expect(await guard.recoverCommittedOperation()).toBe(true);
    expect(getAutomationSpendRepository().budget(Date.now()).usedPoints).toBe(3);
  });
});
