import { EventEmitter } from 'node:events';
import type {
  AutomationRouteContext,
  AutomationServerOptions,
  GenerationBudget,
} from '@musefold/automation-server';
import { AutomationError } from '@musefold/automation-server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  options: null as AutomationServerOptions | null,
  window: null as
    | (EventEmitter & {
        isDestroyed: () => boolean;
        webContents: { send: ReturnType<typeof vi.fn> };
      })
    | null,
  remaining: 0,
  estimated: 5 as number | null,
  managed: true,
  enabled: true,
  listeners: new Set<(event: { type: string; payload: unknown }) => void>(),
  events: [] as Array<{ type: string; payload: unknown }>,
  audits: [] as Array<Record<string, unknown>>,
  generate: vi.fn(),
  scheme: vi.fn(),
  prepareSkill: vi.fn(),
  skill: vi.fn(),
  cancelSkill: vi.fn(),
  cancelGeneration: vi.fn(),
  settle: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { getVersion: () => 'test' },
  BrowserWindow: { getAllWindows: () => (state.window ? [state.window] : []) },
  Notification: { isSupported: () => false },
}));
vi.mock('../window', () => ({ getMainWindow: () => state.window }));
vi.mock('../core-instance', () => ({
  getMusefoldCore: () => ({
    version: 'test',
    generation: { generate: state.generate, cancel: state.cancelGeneration },
    schemes: {
      get: (id: string) => ({
        summary: { id, name: 'Test scheme', currentRevisionId: 'revision' },
      }),
    },
  }),
  getCoreEventHub: () => ({
    sink: {
      emit: (event: { type: string; payload: unknown }) => {
        state.events.push(event);
        for (const listener of state.listeners) listener(event);
      },
    },
    subscribe: (listener: (event: { type: string; payload: unknown }) => void) => {
      state.listeners.add(listener);
      return () => {
        state.listeners.delete(listener);
      };
    },
  }),
}));
vi.mock('@musefold/core/db/index', () => ({
  getDb: () => ({
    prepare: (sql: string) => ({
      // This fixture models the pre-enable legacy host. A provider row is not a checkpoint.
      get: () =>
        sql.includes('managed_execution_checkpoint')
          ? undefined
          : {
              id: 'test-provider',
              name: 'Test Provider',
              model: 'test-model',
              managed_by: state.managed ? 'account' : null,
            },
    }),
  }),
}));
vi.mock('@musefold/core/db/design-scheme', () => ({ getDesignSchemeDb: () => ({}) }));
vi.mock('@musefold/core/services/audit', () => ({
  createSpendAuditService: () => ({
    record: (entry: Record<string, unknown>) => state.audits.push(entry),
    list: () => state.audits,
  }),
}));
vi.mock('@musefold/core/providers/local-image', () => ({ stageLocalImageBytes: vi.fn() }));
vi.mock('../pet', () => ({ trackPetGeneration: (operation: () => unknown) => operation() }));
vi.mock('../automation-local', () => ({ createElectronLocalAdminOps: () => ({}) }));
vi.mock('../automation-setup', () => ({ createElectronAutomationSetupRoutes: () => ({}) }));
// B9 compatibility matrix isolates the in-process coordinator. Durable transport has its own real-SQLite tests.
vi.mock('../automation-spend', () => ({ createDesktopGenerationPersistence: () => undefined }));
vi.mock('../automation-durable-runs', () => ({
  wrapDurableExternalRunRoutes: (routes: unknown) => routes,
}));
vi.mock('../../system/logger', () => ({ createLogger: () => ({ info: vi.fn(), error: vi.fn() }) }));
vi.mock('../../system/paths', () => ({
  getPaths: () => ({
    userData: '/tmp/automation-spend-fixture',
    logs: '/tmp/automation-spend-fixture',
  }),
}));
vi.mock('../../settings/pricing', () => ({ estimateProviderCost: () => state.estimated }));
vi.mock('../../settings/automation', () => ({
  getAutomationEnabled: () => state.enabled,
  setAutomationEnabled: (enabled: boolean) => {
    state.enabled = enabled;
  },
  remainingAutomationBudgetPoints: () => state.remaining,
  settleAutomationBudget: async (points: number) => {
    await state.settle(points);
    state.remaining -= points;
  },
}));
vi.mock('../design-scheme/run-session', () => ({
  runDesignScheme: (...args: unknown[]) => state.scheme(...args),
}));
vi.mock('../ipc/skill-runtime', () => ({
  prepareGithubSkillRuntime: (...args: unknown[]) => state.prepareSkill(...args),
  executeSkillRuntime: (...args: unknown[]) => state.skill(...args),
  cancelSkillRuntimeExecution: (...args: unknown[]) => state.cancelSkill(...args),
}));
vi.mock('@musefold/automation-server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@musefold/automation-server')>()),
  createV1ReadRoutes: () => ({}),
  createLocalRoutes: () => ({ routes: {} }),
  createAutomationServer: (options: AutomationServerOptions) => {
    state.options = options;
    let listening = false;
    return {
      get listening() {
        return listening;
      },
      start: async () => {
        listening = true;
        return { port: 1, token: 'test' };
      },
      stop: async () => {
        listening = false;
      },
    };
  },
}));

import {
  createAutomationSpendBudget,
  resolveAutomationConfirmation,
  startAutomationServer,
  stopAutomationServer,
} from '../automation';
import { externalSpendCovered } from '../automation-runs';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function success(costPoints: number | null = 5) {
  return {
    ok: true,
    data: {
      runId: 'test-run',
      generations: [{ result: { status: 'success', historyId: 'history', costPoints } }],
    },
  };
}

const actions = [
  {
    name: 'scheme',
    route: 'POST /v1/schemes/:id/runs',
    body: { brief: '方案请求' },
    id: 'test-scheme',
    audit: 'run_scheme',
  },
  {
    name: 'skill',
    route: 'POST /v1/skills/github/run',
    body: { url: 'https://github.com/example/fixture', prompt: 'Skill 请求' },
    id: '',
    audit: 'run_github_skill',
  },
] as const;

function invoke(
  route: string,
  body: unknown = {},
  { id = '', key }: { id?: string; key?: string } = {},
) {
  const json = vi.fn();
  const context: AutomationRouteContext = {
    body,
    params: { id },
    json,
    request: {
      headers: key ? { 'idempotency-key': key } : {},
    } as AutomationRouteContext['request'],
    response: {} as AutomationRouteContext['response'],
    url: new URL('http://127.0.0.1/test'),
  };
  const promise = Promise.resolve().then(async () => {
    const returned = await state.options?.routes?.[route](context);
    return json.mock.calls.length
      ? { value: json.mock.calls[0][0], status: json.mock.calls[0][1] }
      : { value: returned, status: 200 };
  });
  void promise.catch(() => {});
  return promise;
}

function pendingId() {
  const required = state.events.filter((event) => event.type === 'confirmation.required').at(-1);
  if (!required) throw new Error('Expected a pending confirmation');
  return (required.payload as { confirmationId: string }).confirmationId;
}

beforeEach(async () => {
  vi.clearAllMocks();
  state.remaining = 0;
  state.estimated = 5;
  state.managed = true;
  state.options = null;
  state.events.length = 0;
  state.audits.length = 0;
  state.listeners.clear();
  state.window = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    webContents: { send: vi.fn() },
  });
  state.generate.mockResolvedValue({ status: 'success', historyId: 'history', costPoints: 5 });
  state.scheme.mockResolvedValue(success());
  state.prepareSkill.mockResolvedValue({ ok: true, data: { runtimeId: 'fixture-runtime' } });
  state.skill.mockResolvedValue(success());
  await startAutomationServer();
});

afterEach(async () => {
  await stopAutomationServer();
  vi.useRealTimers();
});

describe('本地宿主确认生命周期', () => {
  it.each(actions)(
    '$name waits for async shared settlement before terminal audit',
    async (action) => {
      state.remaining = 20;
      const settlement = deferred<void>();
      state.settle.mockImplementationOnce(() => settlement.promise);
      await invoke(action.route, action.body, { id: action.id });
      await vi.waitFor(() => expect(state.settle).toHaveBeenCalledOnce());
      expect(state.audits).toHaveLength(0);
      settlement.resolve();
      await vi.waitFor(() => expect(state.audits).toHaveLength(1));
      expect(state.audits[0]).toMatchObject({ action: action.audit, status: 'success' });
      expect(state.settle).toHaveBeenCalledOnce();
    },
  );

  it.each(actions)('$name 批准后清理卡片/timeout，同步重复回执无效', async (action) => {
    vi.useFakeTimers();
    const request = invoke(action.route, action.body, { id: action.id });
    await vi.advanceTimersByTimeAsync(0);
    const id = pendingId();
    expect(state.window?.listenerCount('closed')).toBe(1);
    expect(resolveAutomationConfirmation(id, true)).toBe(true);
    expect(resolveAutomationConfirmation(id, true)).toBe(false);
    await request;
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(state.window?.listenerCount('closed')).toBe(0);
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]).toMatchObject({
      action: action.audit,
      approvedVia: 'confirmation',
      status: 'success',
    });
  });

  it.each(actions)('$name 超时后renderer记录失效，迟到批准不运行且只记一次审计', async (action) => {
    vi.useFakeTimers();
    const request = invoke(action.route, action.body, { id: action.id, key: 'expire' });
    await vi.advanceTimersByTimeAsync(0);
    const id = pendingId();
    await vi.advanceTimersByTimeAsync(120_000);
    await expect(request).rejects.toMatchObject({ code: 'CONFIRMATION_TIMEOUT' });
    expect(resolveAutomationConfirmation(id, true)).toBe(false);
    expect(state.window?.listenerCount('closed')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(state.scheme).not.toHaveBeenCalled();
    expect(state.skill).not.toHaveBeenCalled();
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]).toMatchObject({
      action: action.audit,
      status: 'timeout',
      actualPoints: null,
    });
    await expect(
      invoke(action.route, action.body, { id: action.id, key: 'expire' }),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_TIMEOUT' });
    expect(state.audits).toHaveLength(1);
  });

  it('普通生图HTTP批准清理renderer，随后旧IPC回执无效', async () => {
    const request = invoke('POST /v1/generations', { prompt: '生图确认' });
    await vi.waitFor(() => expect(state.window?.listenerCount('closed')).toBe(1));
    const id = pendingId();
    await invoke('POST /v1/confirmations/:id', { approved: true }, { id });
    await request;
    expect(resolveAutomationConfirmation(id, true)).toBe(false);
    expect(state.window?.listenerCount('closed')).toBe(0);
    expect(state.generate).toHaveBeenCalledOnce();
  });

  it.each(actions)('$name 主窗口关闭即拒绝，保留失败审计且不调用上游', async (action) => {
    const request = invoke(action.route, action.body, { id: action.id });
    await vi.waitFor(() => expect(state.window?.listenerCount('closed')).toBe(1));
    state.window?.emit('closed');
    await expect(request).rejects.toMatchObject({ code: 'CONFIRMATION_DENIED' });
    expect(state.scheme).not.toHaveBeenCalled();
    expect(state.skill).not.toHaveBeenCalled();
    expect(state.audits[0]).toMatchObject({ status: 'denied', action: action.audit });
  });

  it('停止控制面拒绝所有挂起请求并移除事件订阅；再启不重复广播', async () => {
    const generation = invoke('POST /v1/generations', { prompt: '停机生图' });
    const scheme = invoke(actions[0].route, actions[0].body, { id: actions[0].id });
    await vi.waitFor(() => expect(state.window?.listenerCount('closed')).toBe(2));
    await stopAutomationServer();
    await expect(generation).rejects.toMatchObject({ code: 'CONFIRMATION_DENIED' });
    await expect(scheme).rejects.toMatchObject({ code: 'CONFIRMATION_DENIED' });
    expect(state.listeners.size).toBe(0);
    expect(state.window?.listenerCount('closed')).toBe(0);
    expect(state.generate).not.toHaveBeenCalled();
    expect(state.scheme).not.toHaveBeenCalled();
    await startAutomationServer();
    expect(state.listeners.size).toBe(1);
  });
});

describe('方案和Skill费用、审计与同进程幂等', () => {
  it('托管余额0且估算0仍逐次确认；非托管不消耗账号预算', () => {
    expect(externalSpendCovered(0, true, 0)).toBe(false);
    expect(externalSpendCovered(null, true, 100)).toBe(false);
    expect(externalSpendCovered(5, true, 5)).toBe(true);
    expect(externalSpendCovered(6, true, 5)).toBe(false);
    expect(externalSpendCovered(null, false, 0)).toBe(true);
  });

  it.each(actions)('$name 余额与估算均0仍逐次确认，真实零成本保持0', async (action) => {
    state.estimated = 0;
    state.scheme.mockResolvedValue(success(0));
    state.skill.mockResolvedValue(success(0));
    for (let index = 0; index < 2; index += 1) {
      const request = invoke(action.route, action.body, { id: action.id, key: `zero-${index}` });
      await vi.waitFor(() => expect(state.window?.listenerCount('closed')).toBe(1));
      resolveAutomationConfirmation(pendingId(), true);
      await request;
      await vi.waitFor(() => expect(state.audits).toHaveLength(index + 1));
    }
    expect(
      state.audits.every(
        (entry) => entry.actualPoints === 0 && entry.approvedVia === 'confirmation',
      ),
    ).toBe(true);
    expect(state.settle.mock.calls).toEqual([[0], [0]]);
  });

  it.each(actions)('$name 并发相同键共享确认和运行；冻结输入并拒绝不同输入', async (action) => {
    const requests = Array.from({ length: 5 }, () =>
      invoke(action.route, action.body, { id: action.id, key: 'shared' }),
    );
    await vi.waitFor(() =>
      expect(state.events.filter((event) => event.type === 'confirmation.required')).toHaveLength(
        1,
      ),
    );
    await expect(
      invoke(action.route, { ...action.body, n: 2 }, { id: action.id, key: 'shared' }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    resolveAutomationConfirmation(pendingId(), true);
    const responses = await Promise.all(requests);
    expect(new Set(responses.map(({ value }) => value.jobId)).size).toBe(1);
    await vi.waitFor(() => expect(state.audits).toHaveLength(1));
    expect(action.name === 'scheme' ? state.scheme : state.skill).toHaveBeenCalledOnce();
    expect(state.settle).toHaveBeenCalledExactlyOnceWith(5);
  });

  it.each(actions)('$name 拒绝不执行且已拒绝同键不再确认', async (action) => {
    const first = invoke(action.route, action.body, { id: action.id, key: 'denied' });
    await vi.waitFor(() => expect(state.window?.listenerCount('closed')).toBe(1));
    resolveAutomationConfirmation(pendingId(), false);
    await expect(first).rejects.toBeInstanceOf(AutomationError);
    await expect(
      invoke(action.route, action.body, { id: action.id, key: 'denied' }),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_DENIED' });
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]).toMatchObject({ status: 'denied', actualPoints: null, jobId: null });
    expect(state.scheme).not.toHaveBeenCalled();
    expect(state.skill).not.toHaveBeenCalled();
  });

  it.each(actions)('$name 非托管上游有费用也不冲销Musefold账号预算', async (action) => {
    state.managed = false;
    await invoke(action.route, action.body, { id: action.id });
    await vi.waitFor(() => expect(state.audits).toHaveLength(1));
    expect(state.audits[0]).toMatchObject({ actualPoints: 5, status: 'success' });
    expect(state.settle).not.toHaveBeenCalled();
    expect(state.events.some((event) => event.type === 'confirmation.required')).toBe(false);
  });

  it.each(actions)('$name 部分未知成本仍记录null，不能减为已知部分或0', async (action) => {
    // 非托管也验证未知成本聚合，避免本测试给共享托管预算留下待核对状态。
    state.managed = false;
    const partial = {
      ok: true,
      data: {
        runId: 'mixed',
        generations: [
          { result: { status: 'success', costPoints: 5 } },
          { result: { status: 'failed' } },
        ],
      },
    };
    state.scheme.mockResolvedValue(partial);
    state.skill.mockResolvedValue(partial);
    await invoke(action.route, action.body, { id: action.id });
    await vi.waitFor(() => expect(state.audits).toHaveLength(1));
    expect(state.audits[0]).toMatchObject({ actualPoints: null, status: 'success' });
    expect(state.settle).not.toHaveBeenCalled();
  });

  it.each(actions)('$name 同步异常有一次失败审计', async (action) => {
    state.managed = false;
    if (action.name === 'scheme')
      state.scheme.mockImplementation(() => {
        throw new Error('fake runtime');
      });
    else state.prepareSkill.mockRejectedValue(new Error('fake prepare'));
    await invoke(action.route, action.body, { id: action.id, key: 'throw' });
    await vi.waitFor(() => expect(state.audits).toHaveLength(1));
    await invoke(action.route, action.body, { id: action.id, key: 'throw' });
    expect(state.audits[0]).toMatchObject({ actualPoints: null, status: 'failed' });
  });

  it('Skill准备失败记录审计；准备中取消不进入执行器', async () => {
    state.managed = false;
    const prepare = deferred<unknown>();
    state.prepareSkill.mockReturnValue(prepare.promise);
    const started = await invoke(actions[1].route, actions[1].body, { key: 'cancel' });
    await invoke('DELETE /v1/skill-runs/:id', {}, { id: started.value.jobId });
    prepare.resolve({ ok: true, data: { runtimeId: 'prepared' } });
    await vi.waitFor(() => expect(state.audits).toHaveLength(1));
    expect(state.skill).not.toHaveBeenCalled();
    expect(state.cancelSkill).toHaveBeenCalledWith(started.value.jobId);
    expect(state.cancelGeneration).toHaveBeenCalledOnce();
    expect(state.audits[0]).toMatchObject({ status: 'cancelled', actualPoints: null });
  });

  it('Skill准备返回失败也记录一次审计', async () => {
    state.managed = false;
    state.prepareSkill.mockResolvedValue({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'fixture missing' },
    });
    await invoke(actions[1].route, actions[1].body, { key: 'prepare-failure' });
    await vi.waitFor(() => expect(state.audits).toHaveLength(1));
    expect(state.audits[0]).toMatchObject({ status: 'failed', actualPoints: null });
    expect(state.skill).not.toHaveBeenCalled();
  });
});

describe('三个本地入口共享预算', () => {
  it('生图飞行中保留费用，方案和Skill并发请求不能重用同一份预算', async () => {
    state.remaining = 5;
    const run = deferred<unknown>();
    state.generate.mockReturnValue(run.promise);
    await invoke('POST /v1/generations', { prompt: '先保留全部预算' });
    const scheme = invoke(actions[0].route, actions[0].body, { id: actions[0].id });
    const skill = invoke(actions[1].route, actions[1].body);
    await vi.waitFor(() => expect(state.window?.listenerCount('closed')).toBe(2));
    expect(state.scheme).not.toHaveBeenCalled();
    expect(state.skill).not.toHaveBeenCalled();
    const ids = state.events
      .filter((event) => event.type === 'confirmation.required')
      .map((event) => (event.payload as { confirmationId: string }).confirmationId);
    for (const id of ids) resolveAutomationConfirmation(id, false);
    await expect(scheme).rejects.toMatchObject({ code: 'CONFIRMATION_DENIED' });
    await expect(skill).rejects.toMatchObject({ code: 'CONFIRMATION_DENIED' });
    run.resolve({ status: 'success', historyId: 'history', costPoints: 3 });
    await vi.waitFor(() => expect(state.settle).toHaveBeenCalledExactlyOnceWith(3));
  });

  it('方案同步保留预算后，普通生图不能插队自动放行', async () => {
    state.remaining = 5;
    const run = deferred<unknown>();
    state.scheme.mockReturnValue(run.promise);
    const scheme = invoke(actions[0].route, actions[0].body, { id: actions[0].id });
    const generation = invoke('POST /v1/generations', { prompt: '竞争预算' });
    await scheme;
    await vi.waitFor(() => expect(state.window?.listenerCount('closed')).toBe(1));
    expect(state.generate).not.toHaveBeenCalled();
    resolveAutomationConfirmation(pendingId(), false);
    await expect(generation).rejects.toMatchObject({ code: 'CONFIRMATION_DENIED' });
    run.resolve(success(3));
    await vi.waitFor(() => expect(state.settle).toHaveBeenCalledExactlyOnceWith(3));
  });

  it('协调器finish幂等，已知成本释放预留，未知成本禁止后续自动预算', async () => {
    state.remaining = 20;
    const budget: GenerationBudget = createAutomationSpendBudget();
    const finish = budget.reserve?.(8);
    expect(budget.remainingPoints()).toBe(12);
    await finish?.(3);
    await finish?.(3);
    expect(state.settle).toHaveBeenCalledExactlyOnceWith(3);
    expect(budget.remainingPoints()).toBe(17);
    await budget.reserve?.(null)?.(null);
    expect(budget.remainingPoints()).toBe(0);
    expect(state.settle).toHaveBeenCalledOnce();
  });

  it('结算落稳前保留预留，重复 finish 等待同一结算而不提前完成', async () => {
    state.remaining = 20;
    let release = () => {};
    state.settle.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const budget = createAutomationSpendBudget();
    const finish = budget.reserve?.(8);
    const first = finish?.(3);
    const second = finish?.(3);
    expect(first).toBe(second);
    expect(state.settle).toHaveBeenCalledExactlyOnceWith(3);
    expect(budget.remainingPoints()).toBe(12);
    let done = false;
    void Promise.resolve(first).then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    release();
    await first;
    expect(budget.remainingPoints()).toBe(17);
  });

  it('预算持久化失败保留预留并阻止自动花费，finish不重复记账', async () => {
    state.remaining = 20;
    state.settle.mockImplementationOnce(() => {
      throw new Error('fake store failure');
    });
    const budget = createAutomationSpendBudget();
    const finish = budget.reserve?.(5);
    await expect(finish?.(3)).resolves.toBeUndefined();
    await finish?.(3);
    expect(budget.remainingPoints()).toBe(0);
    expect(state.settle).toHaveBeenCalledOnce();
  });
});
