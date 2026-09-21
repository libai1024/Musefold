import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createEventHub } from '@musefold/core';
import { up as createLegacyAudit } from '@musefold/core/db/migrations/0012_automation_audit';
import { createSpendAuditService } from '@musefold/core/services/audit';
import type { GenerateImageResult } from '@musefold/desktop-contracts/providers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CONFIRMATION_TIMEOUT_MS,
  createGenerationGate,
  type GenerationHost,
  type GenerationRequestBody,
  type SpendAuditDraft,
} from '../generation-routes';
import type { AutomationRouteContext } from '../server';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture(
  options: {
    remaining?: number;
    points?: number | null;
    managed?: boolean;
    confirmation?: GenerationHost['requestConfirmation'];
    run?: GenerationHost['run'];
    onAudit?: (entry: SpendAuditDraft) => void;
    clock?: () => number;
    settle?: GenerationHost['budget']['settle'];
  } = {},
) {
  let balance = options.remaining ?? 0;
  const events: Array<{ type: string; payload: unknown }> = [];
  const audits: SpendAuditDraft[] = [];
  const hub = createEventHub();
  hub.subscribe((event) => events.push(event));
  const host = {
    run: vi.fn<GenerationHost['run']>(
      options.run ??
        (async (request) => ({
          historyId: request.jobId ?? 'test-history',
          status: 'success',
          costPoints: 5,
        })),
    ),
    cancel: vi.fn(() => true),
    estimate: vi.fn(() => ({
      points: options.points === undefined ? 5 : options.points,
      managedByAccount: options.managed ?? true,
      providerId: 'test-provider',
      providerName: 'Test Provider',
      model: 'test-model',
      n: 1,
    })),
    budget: {
      remainingPoints: () => balance,
      settle: vi.fn<GenerationHost['budget']['settle']>(
        options.settle ??
          ((points: number) => {
            balance -= points;
          }),
      ),
    },
    requestConfirmation: vi.fn<GenerationHost['requestConfirmation']>(
      options.confirmation ?? (() => new Promise(() => {})),
    ),
    authorizeReferencePath: () => true,
    stageUpload: async (bytes: Buffer, name: string) => ({
      path: name,
      name,
      source: 'upload' as const,
      mimeType: 'image/png' as const,
      sizeBytes: bytes.length,
    }),
    resolveHistoryImage: () => null,
  } satisfies GenerationHost;
  const gate = createGenerationGate(host, hub, {
    clock: options.clock,
    onSpendAudit: (entry) => {
      audits.push(entry);
      options.onAudit?.(entry);
    },
  });
  function invoke(
    route: string,
    body: unknown = {},
    { key, id }: { key?: string; id?: string } = {},
  ) {
    let value: unknown;
    let status = 200;
    const context = {
      body,
      params: { id: id ?? '', jobId: id ?? '' },
      request: { headers: key ? { 'idempotency-key': key } : {} },
      json: (payload: unknown, code = 200) => {
        value = payload;
        status = code;
      },
    } as unknown as AutomationRouteContext;
    const result = Promise.resolve().then(async () => {
      const returned = await gate.routes[route](context);
      return { value: value ?? returned, status };
    });
    void result.catch(() => {});
    return result;
  }
  const submit = (body: GenerationRequestBody, key?: string) =>
    invoke('POST /v1/generations', body, { key });
  return { gate, host, events, audits, invoke, submit };
}

afterEach(() => vi.useRealTimers());

describe('本地 Agent 费用授权与同进程重放', () => {
  it('handles a rejected shared finisher without an unhandled cleanup rejection or a second run', async () => {
    const f = fixture({ remaining: 100, confirmation: async () => 'denied' });
    const finish = vi.fn(async () => {
      throw new Error('fixture finisher rejected');
    });
    Object.assign(f.host.budget, { reserve: () => finish });
    await f.submit({ prompt: 'first' }, 'finisher-failure');
    await vi.waitFor(() =>
      expect(f.events.some((event) => event.type === 'generation.failed')).toBe(true),
    );
    await expect(f.submit({ prompt: 'next' }, 'finisher-next')).rejects.toMatchObject({
      code: 'CONFIRMATION_DENIED',
    });
    expect(f.host.run).toHaveBeenCalledOnce();
    expect(finish).toHaveBeenCalledTimes(2);
    expect(finish).toHaveBeenLastCalledWith(null);
  });

  it('keeps the result and completion event pending until asynchronous settlement finishes', async () => {
    const settlement = deferred<void>();
    const f = fixture({ remaining: 10, settle: () => settlement.promise });
    const submitted = await f.submit({ prompt: 'wait for settlement' }, 'settlement');
    const id = (submitted.value as { jobId: string }).jobId;
    await vi.waitFor(() => expect(f.host.budget.settle).toHaveBeenCalledOnce());
    expect((await f.invoke('GET /v1/generations/:jobId', {}, { id })).value).toMatchObject({
      status: 'running',
    });
    expect(f.events.some((event) => event.type === 'generation.completed')).toBe(false);
    settlement.resolve();
    await vi.waitFor(async () =>
      expect((await f.invoke('GET /v1/generations/:jobId', {}, { id })).value).toMatchObject({
        status: 'success',
      }),
    );
    expect(f.host.budget.settle).toHaveBeenCalledOnce();
  });

  it('does not automatically spend the remaining budget after a rejected settlement', async () => {
    const f = fixture({
      remaining: 100,
      settle: async () => {
        throw new Error('fixture settlement failure');
      },
      confirmation: async () => 'denied',
    });
    await f.submit({ prompt: 'first' }, 'first-settlement');
    await vi.waitFor(() =>
      expect(f.events.some((event) => event.type === 'generation.failed')).toBe(true),
    );
    await expect(f.submit({ prompt: 'next' }, 'second-settlement')).rejects.toMatchObject({
      code: 'CONFIRMATION_DENIED',
    });
    expect(f.host.run).toHaveBeenCalledOnce();
  });

  it.each([0, 5, null])('预算 0、估算 %s 均逐次确认，旧确认不能放行下一次', async (points) => {
    const f = fixture({ points });
    for (let index = 0; index < 2; index += 1) {
      const response = f.submit({ prompt: `明确确认 ${index}` }, `zero-${index}`);
      await vi.waitFor(() => expect(f.gate.pendingConfirmations()).toHaveLength(1));
      const id = f.gate.pendingConfirmations()[0].confirmationId;
      expect(f.host.run).toHaveBeenCalledTimes(index);
      expect(f.gate.resolveConfirmation(id, true)).toBe(true);
      expect(f.gate.resolveConfirmation(id, true)).toBe(false);
      expect(f.gate.pendingConfirmations()).toEqual([]);
      await response;
      await vi.waitFor(() => expect(f.audits).toHaveLength(index + 1));
    }
    expect(f.host.requestConfirmation).toHaveBeenCalledTimes(2);
    expect(f.audits.every((audit) => audit.approvedVia === 'confirmation')).toBe(true);
  });

  it.each([
    { remaining: 5, declared: 5, confirms: false },
    { remaining: 10, declared: 5, confirms: false },
    { remaining: 4, declared: 4, confirms: true },
    { remaining: 10, declared: 4, confirms: true },
    { remaining: 10, declared: 11, confirms: true },
  ])('估算 5 的预算/声明边界 $remaining/$declared', async ({ remaining, declared, confirms }) => {
    const f = fixture({ remaining, confirmation: async () => 'denied' });
    const response = f.submit({ prompt: '预算边界', declaredBudgetPoints: declared });
    if (confirms) {
      await expect(response).rejects.toMatchObject({ code: 'CONFIRMATION_DENIED' });
      expect(f.host.run).not.toHaveBeenCalled();
      expect(f.audits[0]).toMatchObject({ status: 'denied', actualPoints: null, jobId: null });
    } else {
      await expect(response).resolves.toMatchObject({ status: 202 });
      expect(f.host.requestConfirmation).not.toHaveBeenCalled();
    }
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, '5'])(
    '非法声明预算 %s 不发确认、不发送',
    async (value) => {
      const f = fixture({ remaining: 10 });
      await expect(
        f.invoke('POST /v1/generations', { prompt: '非法预算', declaredBudgetPoints: value }),
      ).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
      expect(f.host.requestConfirmation).not.toHaveBeenCalled();
      expect(f.host.run).not.toHaveBeenCalled();
    },
  );

  it('并发相同键共用同一确认、任务、费用和审计', async () => {
    const f = fixture();
    const requests = Array.from({ length: 8 }, () =>
      f.submit({ prompt: '同一动作' }, 'shared-key'),
    );
    await vi.waitFor(() => expect(f.host.requestConfirmation).toHaveBeenCalledOnce());
    const id = f.gate.pendingConfirmations()[0].confirmationId;
    expect(f.gate.resolveConfirmation(id, true)).toBe(true);
    const responses = await Promise.all(requests);
    const jobs = responses.map(({ value }) => (value as { jobId: string }).jobId);
    expect(new Set(jobs).size).toBe(1);
    expect(responses.map(({ status }) => status)).toEqual([202, 200, 200, 200, 200, 200, 200, 200]);
    await vi.waitFor(() => expect(f.audits).toHaveLength(1));
    expect(f.host.run).toHaveBeenCalledOnce();
    expect(f.host.budget.settle).toHaveBeenCalledExactlyOnceWith(5);
  });

  it('待确认和完成后的同键不同输入均冲突，确认使用冻结输入', async () => {
    const f = fixture();
    const body = { prompt: '最初输入', n: 1 };
    const first = f.submit(body, 'immutable');
    await vi.waitFor(() => expect(f.gate.pendingConfirmations()).toHaveLength(1));
    body.prompt = '随后改写';
    await expect(f.submit(body, 'immutable')).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
    expect(f.gate.resolveConfirmation(f.gate.pendingConfirmations()[0].confirmationId, true)).toBe(
      true,
    );
    await first;
    expect(f.host.run.mock.calls[0][0].prompt).toBe('最初输入');
    await expect(f.submit({ prompt: '最初输入', n: 2 }, 'immutable')).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
    await expect(f.submit({ n: 1, prompt: '最初输入' }, 'immutable')).resolves.toMatchObject({
      status: 200,
    });
    expect(f.host.run).toHaveBeenCalledOnce();
  });

  it('并发不同键先预留预算，后一请求需确认；实际费用冲销后释放差額', async () => {
    const run = deferred<GenerateImageResult>();
    const f = fixture({
      remaining: 10,
      points: 8,
      run: () => run.promise,
      confirmation: async () => 'denied',
    });
    const first = f.submit({ prompt: '先占用' }, 'first');
    const second = f.submit({ prompt: '并发竞争' }, 'second');
    await first;
    await expect(second).rejects.toMatchObject({ code: 'CONFIRMATION_DENIED' });
    expect(f.host.run).toHaveBeenCalledOnce();
    const estimate = await f.invoke('POST /v1/generations/estimate', { prompt: '查看剩余' });
    expect(estimate.value).toMatchObject({ remainingBudgetPoints: 2 });
    run.resolve({ historyId: 'test-history', status: 'success', costPoints: 3 });
    await vi.waitFor(() => expect(f.host.budget.settle).toHaveBeenCalledExactlyOnceWith(3));
    expect(
      (await f.invoke('POST /v1/generations/estimate', { prompt: '冲销后' })).value,
    ).toMatchObject({ remainingBudgetPoints: 7 });
  });

  it.each(['success', 'failed', 'cancelled'] as const)(
    '终态 %s 的未知成本保留 null，不按零释放自动花费',
    async (status) => {
      const f = fixture({
        remaining: 100,
        run: async () => ({ historyId: 'unknown', status }),
        confirmation: async () => 'denied',
      });
      await f.submit({ prompt: '成本不明确' }, 'unknown');
      await vi.waitFor(() => expect(f.audits).toHaveLength(1));
      expect(f.audits[0]).toMatchObject({ status, actualPoints: null });
      expect(f.host.budget.settle).not.toHaveBeenCalled();
      await expect(f.submit({ prompt: '需重新确认' }, 'after-unknown')).rejects.toMatchObject({
        code: 'CONFIRMATION_DENIED',
      });
      expect(f.host.run).toHaveBeenCalledOnce();
      await expect(f.submit({ prompt: '成本不明确' }, 'unknown')).resolves.toMatchObject({
        status: 200,
      });
    },
  );

  it('未知估算的任务运行期间不能把其他请求当作预算充足', async () => {
    const run = deferred<GenerateImageResult>();
    const f = fixture({
      remaining: 100,
      points: null,
      run: () => run.promise,
      confirmation: async () => 'approved',
    });
    await f.submit({ prompt: '未知预估' }, 'unknown-inflight');
    f.host.estimate.mockReturnValue({
      points: 5,
      managedByAccount: true,
      providerId: 'test-provider',
      providerName: 'Test Provider',
      model: 'test-model',
      n: 1,
    });
    f.host.requestConfirmation.mockResolvedValue('denied');
    await expect(f.submit({ prompt: '后续请求' }, 'following')).rejects.toMatchObject({
      code: 'CONFIRMATION_DENIED',
    });
    run.resolve({ historyId: 'unknown-inflight', status: 'success', costPoints: 5 });
    await vi.waitFor(() => expect(f.host.budget.settle).toHaveBeenCalledExactlyOnceWith(5));
  });

  it.each(['failed', 'cancelled'] as const)('%s 但上游报告真实成本仍只冲销一次', async (status) => {
    const f = fixture({
      remaining: 100,
      run: async () => ({ historyId: 'charged', status, costPoints: 2 }),
    });
    await f.submit({ prompt: '已报告费用' }, 'charged');
    await f.submit({ prompt: '已报告费用' }, 'charged');
    await vi.waitFor(() => expect(f.audits).toHaveLength(1));
    expect(f.audits[0]).toMatchObject({ status, actualPoints: 2 });
    expect(f.host.budget.settle).toHaveBeenCalledExactlyOnceWith(2);
  });

  it('非托管 Provider 不冲销 Musefold 账号预算；CLI 明确同意单独记来源', async () => {
    const unmanaged = fixture({ managed: false, points: null });
    await unmanaged.submit({ prompt: '第三方 Provider' });
    await vi.waitFor(() => expect(unmanaged.audits).toHaveLength(1));
    expect(unmanaged.host.requestConfirmation).not.toHaveBeenCalled();
    expect(unmanaged.host.budget.settle).not.toHaveBeenCalled();
    const consent = fixture({ points: null });
    await consent.submit({ prompt: '终端明确同意', consent: 'interactive' });
    await vi.waitFor(() => expect(consent.audits).toHaveLength(1));
    expect(consent.host.requestConfirmation).not.toHaveBeenCalled();
    expect(consent.audits[0]).toMatchObject({ approvedVia: 'consent', actualPoints: 5 });
  });
});

describe('确认过期、拒绝及审计恢复', () => {
  it.each([{}, { approved: 'true' }, { approved: 1 }, null])(
    '确认回执 %s 必须显式布尔值',
    async (body) => {
      const f = fixture();
      const request = f.submit({ prompt: '回执严格校验' });
      await vi.waitFor(() => expect(f.gate.pendingConfirmations()).toHaveLength(1));
      const id = f.gate.pendingConfirmations()[0].confirmationId;
      await expect(f.invoke('POST /v1/confirmations/:id', body, { id })).rejects.toMatchObject({
        code: 'INVALID_PARAMS',
      });
      expect(f.host.run).not.toHaveBeenCalled();
      await f.invoke('POST /v1/confirmations/:id', { approved: false }, { id });
      await expect(request).rejects.toMatchObject({ code: 'CONFIRMATION_DENIED' });
    },
  );

  it('并发拒绝同键只记录一次，不再弹卡；其他卡仍保持独立', async () => {
    const f = fixture();
    const denied = f.submit({ prompt: '拒绝目标' }, 'denied');
    const duplicate = f.submit({ prompt: '拒绝目标' }, 'denied');
    const other = f.submit({ prompt: '独立目标' }, 'other');
    await vi.waitFor(() => expect(f.gate.pendingConfirmations()).toHaveLength(2));
    const [first, second] = f.gate.pendingConfirmations();
    expect(f.gate.resolveConfirmation(first.confirmationId, false)).toBe(true);
    expect(f.gate.resolveConfirmation(first.confirmationId, true)).toBe(false);
    await expect(denied).rejects.toMatchObject({ code: 'CONFIRMATION_DENIED' });
    await expect(duplicate).rejects.toMatchObject({ code: 'CONFIRMATION_DENIED' });
    await expect(f.submit({ prompt: '拒绝目标' }, 'denied')).rejects.toMatchObject({
      code: 'CONFIRMATION_DENIED',
    });
    expect(f.audits).toHaveLength(1);
    expect(f.gate.pendingConfirmations()).toEqual([second]);
    f.gate.resolveConfirmation(second.confirmationId, true);
    await other;
    expect(f.host.run).toHaveBeenCalledOnce();
  });

  it('120 秒超时后迟到批准、同键重试和重复回执都不能发送', async () => {
    vi.useFakeTimers();
    const hostApproval = deferred<'approved' | 'denied'>();
    const f = fixture({ confirmation: () => hostApproval.promise });
    const request = f.submit({ prompt: '等待超时' }, 'timeout');
    await vi.advanceTimersByTimeAsync(0);
    const id = f.gate.pendingConfirmations()[0].confirmationId;
    await vi.advanceTimersByTimeAsync(CONFIRMATION_TIMEOUT_MS);
    await expect(request).rejects.toMatchObject({ code: 'CONFIRMATION_TIMEOUT' });
    expect(f.gate.resolveConfirmation(id, true)).toBe(false);
    hostApproval.resolve('approved');
    await vi.advanceTimersByTimeAsync(0);
    await expect(f.submit({ prompt: '等待超时' }, 'timeout')).rejects.toMatchObject({
      code: 'CONFIRMATION_TIMEOUT',
    });
    expect(f.host.run).not.toHaveBeenCalled();
    expect(f.host.budget.settle).not.toHaveBeenCalled();
    expect(f.audits).toHaveLength(1);
    expect(f.audits[0]).toMatchObject({
      status: 'timeout',
      approvedVia: 'timeout',
      actualPoints: null,
    });
    expect(f.events.filter((event) => event.type === 'confirmation.resolved')).toHaveLength(1);
  });

  it('事件循环尚未执行超时回调，已到截止时刻的回执仍拒绝', async () => {
    let now = 1000;
    const f = fixture({ clock: () => now });
    const request = f.submit({ prompt: '临界过期' });
    await vi.waitFor(() => expect(f.gate.pendingConfirmations()).toHaveLength(1));
    const id = f.gate.pendingConfirmations()[0].confirmationId;
    now += CONFIRMATION_TIMEOUT_MS;
    expect(f.gate.resolveConfirmation(id, true)).toBe(false);
    await expect(request).rejects.toMatchObject({ code: 'CONFIRMATION_TIMEOUT' });
    expect(f.host.run).not.toHaveBeenCalled();
  });

  it('同步 Provider 抛错仍落一次失败审计，重放不再次发送', async () => {
    const f = fixture({
      remaining: 10,
      run: () => {
        throw new Error('fake provider failure');
      },
    });
    await f.submit({ prompt: '同步失败' }, 'sync-throw');
    await vi.waitFor(() => expect(f.audits).toHaveLength(1));
    await f.submit({ prompt: '同步失败' }, 'sync-throw');
    expect(f.audits[0]).toMatchObject({ status: 'failed', actualPoints: null });
    expect(f.host.run).toHaveBeenCalledOnce();
  });

  it('审计实际落 SQLite，重开连接仍保留拒绝与未知费用且无重复行', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'musefold-spend-audit-'));
    const filename = join(dir, 'audit.db');
    let db = new Database(filename);
    try {
      createLegacyAudit(db);
      db.exec(
        'ALTER TABLE automation_audit RENAME COLUMN estimated_cents TO estimated_points; ALTER TABLE automation_audit RENAME COLUMN actual_cents TO actual_points;',
      );
      const audit = createSpendAuditService(() => db);
      const record = (entry: SpendAuditDraft) => audit.record({ ...entry, caller: 'test' });
      const denied = fixture({ confirmation: async () => 'denied', onAudit: record });
      await expect(
        denied.submit({ prompt: '本地拒绝审计' }, 'persist-denied'),
      ).rejects.toMatchObject({ code: 'CONFIRMATION_DENIED' });
      await expect(
        denied.submit({ prompt: '本地拒绝审计' }, 'persist-denied'),
      ).rejects.toMatchObject({ code: 'CONFIRMATION_DENIED' });
      const unknown = fixture({
        remaining: 10,
        run: async () => ({ historyId: 'unknown-persisted', status: 'success' }),
        onAudit: record,
      });
      await unknown.submit({ prompt: '未知费用审计' }, 'persist-unknown');
      await vi.waitFor(() => expect(audit.list()).toHaveLength(2));
      db.close();
      db = new Database(filename);
      const restored = createSpendAuditService(() => db).list();
      expect(restored).toHaveLength(2);
      expect(restored.map(({ status }) => status).sort()).toEqual(['denied', 'success']);
      expect(restored.every(({ actualPoints }) => actualPoints === null)).toBe(true);
      expect(restored.map(({ promptText }) => promptText).sort()).toEqual(
        ['未知费用审计', '本地拒绝审计'].sort(),
      );
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
