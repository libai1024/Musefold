// doubao 域桥守护:冻结 browser-service 的薄适配语义。
// browser-service 整体 mock(不触 electron/BrowserWindow);
// 验证方法表与 canonical 出参归一、稳定错误码透传、未知异常上抛由桥脱敏。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  startLogin: vi.fn(),
  refreshLogin: vi.fn(),
  logout: vi.fn(),
}));

vi.mock('../../../doubao-web/browser-service', () => ({
  getDoubaoWebAccountStatus: mocks.getStatus,
  startDoubaoWebLogin: mocks.startLogin,
  refreshDoubaoWebLogin: mocks.refreshLogin,
  logoutDoubaoWeb: mocks.logout,
}));

import { doubaoAccountStatusSchema } from '@musefold/contracts';
import { buildDoubaoDomainMethods } from '../doubao-domain';
import { BridgeError, type MethodDef } from '../envelope';

type Methods = Record<string, MethodDef>;

const USAGE = { date: '2026-09-01', limit: 100, used: 0, remaining: 100 };

/** 冻结面最小快照:loginState/qr* 可选位缺省。 */
const FROZEN_LOGGED_OUT = {
  loggedIn: false,
  accountName: null,
  avatarDataUrl: null,
  verificationRequired: false,
  usage: USAGE,
};

function frozenCodedError(code: string, message: string): Error {
  const error = new Error(message);
  (error as { code?: string }).code = code;
  return error;
}

describe('doubao 域桥(冻结面薄适配)', () => {
  let methods: Methods;

  beforeEach(() => {
    vi.clearAllMocks();
    methods = buildDoubaoDomainMethods() as Methods;
  });

  it('方法表恰好是 4 个 canonical 方法,入参只接受空', () => {
    expect(Object.keys(methods).sort()).toEqual([
      'doubao.getStatus',
      'doubao.logout',
      'doubao.refreshLogin',
      'doubao.startLogin',
    ]);
    for (const name of Object.keys(methods)) {
      expect(methods[name]?.input.safeParse(undefined).success, name).toBe(true);
      expect(methods[name]?.input.safeParse({}).success, name).toBe(true);
      expect(methods[name]?.input.safeParse({ unexpected: 1 }).success, name).toBe(false);
    }
  });

  it('每个方法映射到对应冻结函数,出参归一为 canonical 状态', async () => {
    mocks.getStatus.mockResolvedValue(FROZEN_LOGGED_OUT);
    mocks.startLogin.mockResolvedValue({
      ...FROZEN_LOGGED_OUT,
      loginState: 'qr-ready',
      qrCodeDataUrl: 'data:image/svg+xml;base64,PHN2Zy8+',
      qrExpiresAt: 1_800_000_000_000,
    });
    mocks.refreshLogin.mockResolvedValue({ ...FROZEN_LOGGED_OUT, loginState: 'loading' });
    mocks.logout.mockResolvedValue({ ...FROZEN_LOGGED_OUT, loginState: 'logged-out' });

    const status = doubaoAccountStatusSchema.parse(
      await methods['doubao.getStatus']?.handle(undefined),
    );
    expect(status).toMatchObject({
      loggedIn: false,
      loginState: 'logged-out',
      qrCodeDataUrl: null,
    });
    expect(mocks.getStatus).toHaveBeenCalledOnce();

    const started = doubaoAccountStatusSchema.parse(
      await methods['doubao.startLogin']?.handle(undefined),
    );
    expect(started.loginState).toBe('qr-ready');
    expect(started.qrCodeDataUrl).toContain('data:image/');
    expect(mocks.startLogin).toHaveBeenCalledOnce();

    const refreshed = await methods['doubao.refreshLogin']?.handle(undefined);
    expect((refreshed as { loginState: string }).loginState).toBe('loading');
    expect(mocks.refreshLogin).toHaveBeenCalledOnce();

    const loggedOut = await methods['doubao.logout']?.handle(undefined);
    expect((loggedOut as { loginState: string }).loginState).toBe('logged-out');
    expect(mocks.logout).toHaveBeenCalledOnce();
  });

  it('冻结面 codedError 的稳定 code 与人话文案透传为 BridgeError', async () => {
    mocks.startLogin.mockRejectedValue(
      frozenCodedError(
        'WEB_VERIFICATION_REQUIRED',
        '豆包要求人工验证,请在已打开的窗口中完成后重试',
      ),
    );
    const failure = (await methods['doubao.startLogin']
      ?.handle(undefined)
      .catch((error: unknown) => error)) as BridgeError;
    expect(failure).toBeInstanceOf(BridgeError);
    expect(failure.code).toBe('WEB_VERIFICATION_REQUIRED');
    expect(failure.message).toContain('人工验证');
  });

  it('未知异常原样上抛(交 gateway-bridge 统一脱敏),不伪造业务码', async () => {
    mocks.getStatus.mockRejectedValue(
      new Error('/Users/creator/Library/Application Support/musefold/x.db'),
    );
    await expect(methods['doubao.getStatus']?.handle(undefined)).rejects.toThrow(
      '/Users/creator/Library/Application Support/musefold/x.db',
    );
  });

  it('冻结面返回非契约形状时拒绝转发(INTERNAL_ERROR),不放行脏数据', async () => {
    mocks.getStatus.mockResolvedValue({ loggedIn: 'yes', sessionPartition: 'persist:x' });
    const failure = (await methods['doubao.getStatus']
      ?.handle(undefined)
      .catch((error: unknown) => error)) as BridgeError;
    expect(failure).toBeInstanceOf(BridgeError);
    expect(failure.code).toBe('INTERNAL_ERROR');
  });
});
