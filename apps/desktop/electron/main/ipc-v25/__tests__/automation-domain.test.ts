// automation 域桥行为守护:令牌只出掩码、复制在主进程完成、预算复用既有存储、
// 日志/审计出参 path-free,失败一律稳定 BridgeError。
// 主进程 automation / settings / integration 三个模块全 mock —— 本域只做接线,不重写语义。

import { beforeEach, describe, expect, it, vi } from 'vitest';

/** 真实形状的控制面令牌:`mf_at_` + 43 字符 base64url。 */
const FULL_TOKEN = 'mf_at_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0u_v';
const USER_HOME = '/Users/creator';

const mocks = vi.hoisted(() => ({
  clipboard: { writeText: vi.fn() },
  homedir: vi.fn(() => '/Users/creator'),
  getAutomationStatus: vi.fn(),
  setAutomationEnabledAndApply: vi.fn(),
  rotateAutomationToken: vi.fn(),
  listAutomationRequestLog: vi.fn(),
  listAutomationAudit: vi.fn(),
  resolveAutomationConfirmation: vi.fn(),
  getAutomationBudget: vi.fn(),
  setAutomationBudgetLimit: vi.fn(),
  getIntegrationInfo: vi.fn(),
}));

vi.mock('electron', () => ({ clipboard: mocks.clipboard }));
vi.mock('node:os', () => ({ homedir: mocks.homedir }));
vi.mock('../../automation', () => ({
  getAutomationStatus: mocks.getAutomationStatus,
  setAutomationEnabledAndApply: mocks.setAutomationEnabledAndApply,
  rotateAutomationToken: mocks.rotateAutomationToken,
  listAutomationRequestLog: mocks.listAutomationRequestLog,
  listAutomationAudit: mocks.listAutomationAudit,
  resolveAutomationConfirmation: mocks.resolveAutomationConfirmation,
}));
vi.mock('../../integration', () => ({ getIntegrationInfo: mocks.getIntegrationInfo }));
vi.mock('../../../settings/automation', () => ({
  getAutomationBudget: mocks.getAutomationBudget,
  setAutomationBudgetLimit: mocks.setAutomationBudgetLimit,
}));

import { AUTOMATION_LOG_LIMIT, V25_METHODS_BY_DOMAIN } from '@musefold/contracts';
import { BridgeError, type MethodDef } from '../envelope';
import { buildAutomationDomainMethods } from '../automation-domain';

const RUNNING_STATUS = {
  enabled: true,
  running: true,
  port: 43_217,
  token: FULL_TOKEN,
  apiVersion: 'v1' as const,
  discoveryPath: `${USER_HOME}/Library/Application Support/Musefold/automation.json`,
};

const BUDGET = { monthlyLimitPoints: 20, usedPoints: 3.5, month: '2026-09' };

const INTEGRATION_INFO = {
  bundledReady: true,
  snippets: {
    cursorJson: `{"mcpServers":{"musefold":{"command":"${USER_HOME}/Apps/Musefold.app/Contents/MacOS/Musefold"}}}`,
    codexToml: `[mcp_servers.musefold]\ncommand = "${USER_HOME}/Apps/Musefold.app/Contents/MacOS/Musefold"`,
    claudeCommand: `claude mcp add musefold -- "${USER_HOME}/Apps/Musefold.app/Contents/MacOS/Musefold"`,
  },
  cli: { installed: true, onPath: false },
};

let methods: Record<string, MethodDef>;

function call(method: string, payload?: unknown): Promise<unknown> {
  const def = methods[method];
  if (!def) throw new Error(`missing method: ${method}`);
  const parsed = def.input.safeParse(payload);
  if (!parsed.success) throw new Error(`VALIDATION_FAILED: ${method}`);
  return def.handle(parsed.data);
}

function accepts(method: string, payload: unknown): boolean {
  const def = methods[method];
  if (!def) throw new Error(`missing method: ${method}`);
  return def.input.safeParse(payload).success;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.homedir.mockReturnValue(USER_HOME);
  mocks.getAutomationStatus.mockReturnValue({ ...RUNNING_STATUS });
  mocks.getAutomationBudget.mockReturnValue({ ...BUDGET });
  mocks.setAutomationBudgetLimit.mockImplementation((points: number) => {
    mocks.getAutomationBudget.mockReturnValue({ ...BUDGET, monthlyLimitPoints: points });
    return { ...BUDGET, monthlyLimitPoints: points };
  });
  mocks.setAutomationEnabledAndApply.mockResolvedValue({ ...RUNNING_STATUS });
  mocks.rotateAutomationToken.mockReturnValue({ ...RUNNING_STATUS });
  mocks.listAutomationRequestLog.mockReturnValue([]);
  mocks.listAutomationAudit.mockReturnValue([]);
  mocks.resolveAutomationConfirmation.mockReturnValue(true);
  mocks.getIntegrationInfo.mockReturnValue(structuredClone(INTEGRATION_INFO));
  methods = buildAutomationDomainMethods();
});

describe('automation domain method table', () => {
  it('exposes exactly the contract method set', () => {
    expect(Object.keys(methods).sort()).toEqual([...V25_METHODS_BY_DOMAIN.automation].sort());
  });

  it('rejects unexpected keys on the no-input methods', () => {
    for (const method of [
      'automation.getStatus',
      'automation.rotateToken',
      'automation.copyToken',
      'automation.getIntegrationGuide',
    ]) {
      expect(accepts(method, undefined), method).toBe(true);
      expect(accepts(method, {}), method).toBe(true);
      expect(accepts(method, { enabled: true }), method).toBe(false);
    }
  });
});

describe('status(掩码令牌 + 预算,path-free)', () => {
  it('masks the token, drops the discovery path and folds the budget in', async () => {
    const status = await call('automation.getStatus');
    expect(status).toEqual({
      enabled: true,
      running: true,
      host: '127.0.0.1',
      port: 43_217,
      apiVersion: 'v1',
      tokenMasked: 'mf_a…0u_v',
      monthlyBudgetPoints: 20,
      spentThisMonthPoints: 3.5,
      budgetMonth: '2026-09',
    });
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain(FULL_TOKEN);
    expect(serialized).not.toContain(FULL_TOKEN.slice(4, -4));
    expect(serialized).not.toContain('automation.json');
    expect(serialized).not.toContain(USER_HOME);
  });

  it('reports a stopped panel with a null port and no token at all', async () => {
    mocks.getAutomationStatus.mockReturnValue({
      ...RUNNING_STATUS,
      enabled: false,
      running: false,
      port: null,
      token: null,
      discoveryPath: null,
    });
    expect(await call('automation.getStatus')).toMatchObject({
      enabled: false,
      running: false,
      port: null,
      tokenMasked: null,
    });
  });

  it('clamps a legacy negative budget instead of failing the whole card', async () => {
    mocks.getAutomationBudget.mockReturnValue({
      monthlyLimitPoints: -5,
      usedPoints: -1,
      month: '2026-09',
    });
    expect(await call('automation.getStatus')).toMatchObject({
      monthlyBudgetPoints: 0,
      spentThisMonthPoints: 0,
    });
  });
});

describe('toggle / rotate / copy', () => {
  it('applies the switch through the existing main-process lifecycle', async () => {
    await call('automation.setEnabled', { enabled: false });
    expect(mocks.setAutomationEnabledAndApply).toHaveBeenCalledWith(false);
    expect(accepts('automation.setEnabled', { enabled: 'false' })).toBe(false);
    expect(accepts('automation.setEnabled', {})).toBe(false);
  });

  it('maps a failing toggle to a stable code without leaking the path', async () => {
    mocks.setAutomationEnabledAndApply.mockRejectedValue(
      new Error(`EADDRINUSE: listen failed, ${USER_HOME}/socket`),
    );
    const rejection = await call('automation.setEnabled', { enabled: true }).catch(
      (thrown: unknown) => thrown,
    );
    expect(rejection).toBeInstanceOf(BridgeError);
    expect(rejection).toMatchObject({
      code: 'AUTOMATION_TOGGLE_FAILED',
      message: '启动本地控制面失败,请稍后重试',
    });
    expect((rejection as BridgeError).message).not.toContain(USER_HOME);
  });

  it('rotates the token and returns the new mask, never the new token', async () => {
    const rotated = `mf_at_${'Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4J3i2H1g0f_e'}`;
    mocks.rotateAutomationToken.mockImplementation(() => {
      mocks.getAutomationStatus.mockReturnValue({ ...RUNNING_STATUS, token: rotated });
      return { ...RUNNING_STATUS, token: rotated };
    });
    const status = (await call('automation.rotateToken')) as { tokenMasked: string };
    expect(mocks.rotateAutomationToken).toHaveBeenCalledOnce();
    expect(status.tokenMasked).toBe('mf_a…0f_e');
    expect(JSON.stringify(status)).not.toContain(rotated);
  });

  it('refuses to rotate while the panel is stopped', async () => {
    mocks.rotateAutomationToken.mockImplementation(() => {
      throw new Error('控制面未在运行，无法轮换 token');
    });
    await expect(call('automation.rotateToken')).rejects.toMatchObject({
      code: 'AUTOMATION_NOT_RUNNING',
    });
  });

  it('copies the full token straight into the system clipboard and returns nothing', async () => {
    expect(await call('automation.copyToken')).toBeNull();
    expect(mocks.clipboard.writeText).toHaveBeenCalledWith(FULL_TOKEN);
  });

  it('reports TOKEN_UNAVAILABLE instead of copying an empty clipboard', async () => {
    mocks.getAutomationStatus.mockReturnValue({ ...RUNNING_STATUS, running: false, token: null });
    await expect(call('automation.copyToken')).rejects.toMatchObject({
      code: 'TOKEN_UNAVAILABLE',
    });
    expect(mocks.clipboard.writeText).not.toHaveBeenCalled();
  });
});

describe('monthly budget(复用既有存储)', () => {
  it('writes through the existing settings store and echoes the fresh status', async () => {
    expect(await call('automation.setMonthlyBudget', { points: 50 })).toMatchObject({
      monthlyBudgetPoints: 50,
    });
    expect(mocks.setAutomationBudgetLimit).toHaveBeenCalledWith(50);
  });

  it('waits for the durable policy update before returning refreshed status', async () => {
    let release = () => {};
    mocks.setAutomationBudgetLimit.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    let returned = false;
    const result = call('automation.setMonthlyBudget', { points: 50 }).then(() => {
      returned = true;
    });
    await Promise.resolve();
    expect(returned).toBe(false);
    release();
    await result;
    expect(returned).toBe(true);
  });

  it('rejects non-integer, negative and out-of-range budgets at the input seam', () => {
    expect(accepts('automation.setMonthlyBudget', { points: 0 })).toBe(true);
    for (const points of [-1, 1.5, 1_000_001, '10', null, undefined]) {
      expect(accepts('automation.setMonthlyBudget', { points }), String(points)).toBe(false);
    }
    expect(accepts('automation.setMonthlyBudget', {})).toBe(false);
  });
});

describe('request log / spend audit(只读,出参裁剪)', () => {
  it('normalizes timestamps, upper-cases the method and strips query strings', async () => {
    mocks.listAutomationRequestLog.mockReturnValue([
      {
        at: '2026-09-06T10:15:00.000Z',
        method: 'post',
        path: '/v1/generate?token=leak',
        status: 202,
        durationMs: 41.6,
        errorCode: 'CONFIRMATION_TIMEOUT',
      },
    ]);
    const rows = await call('automation.listRequestLog');
    expect(rows).toEqual([
      {
        at: '2026-09-06T10:15:00.000+00:00',
        method: 'POST',
        path: '/v1/generate',
        status: 202,
        durationMs: 42,
        errorCode: 'CONFIRMATION_TIMEOUT',
      },
    ]);
  });

  it('drops rows that cannot be represented path-free instead of failing the card', async () => {
    mocks.listAutomationRequestLog.mockReturnValue([
      {
        at: 'not-a-date',
        method: 'GET',
        path: '/v1/health',
        status: 200,
        durationMs: 1,
      },
      {
        at: '2026-09-06T10:15:00.000Z',
        method: 'GET',
        path: '/v1/health',
        status: 200,
        durationMs: 1,
      },
    ]);
    expect(await call('automation.listRequestLog')).toHaveLength(1);
  });

  it('passes the requested limit through and defaults to the contract ceiling', async () => {
    await call('automation.listRequestLog', { limit: 10 });
    expect(mocks.listAutomationRequestLog).toHaveBeenCalledWith(10);
    await call('automation.listRequestLog');
    expect(mocks.listAutomationRequestLog).toHaveBeenLastCalledWith(AUTOMATION_LOG_LIMIT);
    expect(accepts('automation.listRequestLog', { limit: AUTOMATION_LOG_LIMIT + 1 })).toBe(false);
  });

  it('truncates the audit prompt preview and converts epoch millis to ISO', async () => {
    mocks.listAutomationAudit.mockReturnValue([
      {
        id: 7,
        at: Date.UTC(2026, 8, 6, 10, 15, 0),
        action: 'generate_image',
        promptText: 'x'.repeat(400),
        approvedVia: 'confirmation',
        status: 'success',
        estimatedPoints: 4,
        actualPoints: 3.5,
        jobId: 'job-1',
      },
    ]);
    const rows = (await call('automation.listSpendAudit')) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      id: 7,
      at: '2026-09-06T10:15:00.000+00:00',
      action: 'generate_image',
      promptPreview: 'x'.repeat(120),
      approvedVia: 'confirmation',
      status: 'success',
      estimatedPoints: 4,
      actualPoints: 3.5,
    });
    // jobId 是内部标识,不下发。
    expect(rows[0]).not.toHaveProperty('jobId');
  });

  it('keeps a null prompt and null points as nulls (list renders 「-」)', async () => {
    mocks.listAutomationAudit.mockReturnValue([
      {
        id: 8,
        at: Date.UTC(2026, 8, 6, 10, 16, 0),
        action: 'run_scheme',
        promptText: null,
        approvedVia: 'timeout',
        status: 'timeout',
        estimatedPoints: null,
        actualPoints: null,
        jobId: null,
      },
    ]);
    expect(await call('automation.listSpendAudit')).toMatchObject([
      { promptPreview: null, estimatedPoints: null, actualPoints: null, status: 'timeout' },
    ]);
  });
});

describe('confirmation回执', () => {
  it('forwards the verdict and reports who owned the settle', async () => {
    expect(
      await call('automation.resolveConfirmation', { confirmationId: 'c-1', approved: true }),
    ).toEqual({ handled: true });
    expect(mocks.resolveAutomationConfirmation).toHaveBeenCalledWith('c-1', true);

    mocks.resolveAutomationConfirmation.mockReturnValue(false);
    expect(
      await call('automation.resolveConfirmation', { confirmationId: 'c-2', approved: false }),
    ).toEqual({ handled: false });
  });

  it('demands both the id and an explicit verdict', () => {
    expect(accepts('automation.resolveConfirmation', { confirmationId: 'c-1' })).toBe(false);
    expect(accepts('automation.resolveConfirmation', { approved: true })).toBe(false);
    expect(
      accepts('automation.resolveConfirmation', {
        confirmationId: 'c-1',
        approved: true,
        extra: 1,
      }),
    ).toBe(false);
  });
});

describe('integration guide(displayPath 口径:主目录折成 ~)', () => {
  it('folds the user home out of every snippet and keeps the readiness flags', async () => {
    const guide = (await call('automation.getIntegrationGuide')) as Record<string, unknown>;
    expect(guide).toMatchObject({ bundledReady: true, cliInstalled: true, cliOnPath: false });
    const serialized = JSON.stringify(guide);
    expect(serialized).not.toContain(USER_HOME);
    expect(serialized).toContain('~/Apps/Musefold.app');
    // 片段里不含任何密钥(MCP 经发现链自读令牌)。
    expect(serialized).not.toContain(FULL_TOKEN);
  });

  it('fails structurally when the bundled integration artifacts are missing', async () => {
    mocks.getIntegrationInfo.mockImplementation(() => {
      throw new Error(`Musefold Skill 文档缺失: ${USER_HOME}/website`);
    });
    const rejection = await call('automation.getIntegrationGuide').catch(
      (thrown: unknown) => thrown,
    );
    expect(rejection).toBeInstanceOf(BridgeError);
    expect(rejection).toMatchObject({ code: 'INTEGRATION_UNAVAILABLE' });
    expect((rejection as BridgeError).message).not.toContain(USER_HOME);
  });
});
