import type { DoubaoAccountStatus } from '@musefold/contracts';
import {
  DESKTOP_CAPABILITIES,
  type MusefoldGateway,
  PlatformProvider,
  type PlatformCapabilities,
} from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DoubaoConnectionPanel } from '../DoubaoConnectionPanel';

const QR_DATA_URL = 'data:image/svg+xml;base64,PHN2Zy8+';

function statusFixture(patch: Partial<DoubaoAccountStatus> = {}): DoubaoAccountStatus {
  return {
    loggedIn: false,
    accountName: null,
    avatarDataUrl: null,
    verificationRequired: false,
    usage: { date: '2026-09-01', limit: 100, used: 3, remaining: 97 },
    loginState: 'logged-out',
    qrCodeDataUrl: null,
    qrExpiresAt: null,
    errorMessage: null,
    ...patch,
  };
}

/** 内存版 DoubaoGateway:start/refresh/logout 推进内部状态,模拟主进程登录流。 */
function createDoubaoGateway(initial: DoubaoAccountStatus) {
  let status = initial;
  const gateway = {
    getStatus: vi.fn(async () => status),
    startLogin: vi.fn(async () => {
      status = statusFixture({
        loginState: 'qr-ready',
        qrCodeDataUrl: QR_DATA_URL,
        qrExpiresAt: Date.now() + 120_000,
      });
      return status;
    }),
    refreshLogin: vi.fn(async () => {
      status = statusFixture({
        loginState: 'qr-ready',
        qrCodeDataUrl: QR_DATA_URL,
        qrExpiresAt: Date.now() + 120_000,
      });
      return status;
    }),
    logout: vi.fn(async () => {
      status = statusFixture();
      return status;
    }),
  };
  return {
    gateway,
    /** 测试侧推进登录流(等价主进程登录 poller 的状态跃迁)。 */
    advance(next: DoubaoAccountStatus) {
      status = next;
    },
  };
}

function renderPanel(
  doubao: ReturnType<typeof createDoubaoGateway>['gateway'],
  capabilities: PlatformCapabilities = DESKTOP_CAPABILITIES,
) {
  const gateway = { doubao } as unknown as MusefoldGateway;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PlatformProvider runtime={{ gateway, capabilities }}>
        <DoubaoConnectionPanel />
      </PlatformProvider>
    </QueryClientProvider>,
  );
}

describe('DoubaoConnectionPanel(桌面豆包免费试用卡)', () => {
  it('未登录:点「扫码登录」启动 QR 登录流并就地展示二维码', async () => {
    const doubao = createDoubaoGateway(statusFixture());
    renderPanel(doubao.gateway);

    const startButton = await screen.findByTestId('doubao-login-start');
    expect(screen.getByTestId('settings-doubao-card')).toBeTruthy();
    expect(screen.queryByTestId('doubao-login-qr')).toBeNull();

    await userEvent.click(startButton);
    await waitFor(() => {
      expect(doubao.gateway.startLogin).toHaveBeenCalledOnce();
    });
    const qr = await screen.findByTestId('doubao-login-qr');
    expect((qr as HTMLImageElement).src).toBe(QR_DATA_URL);
    // QR 态提供刷新入口。
    expect(screen.getByTestId('doubao-login-refresh')).toBeTruthy();
  });

  it('qr-ready:点「刷新二维码」调用 refreshLogin', async () => {
    const doubao = createDoubaoGateway(
      statusFixture({ loginState: 'qr-ready', qrCodeDataUrl: QR_DATA_URL, qrExpiresAt: 1 }),
    );
    renderPanel(doubao.gateway);

    await screen.findByTestId('doubao-login-qr');
    await userEvent.click(screen.getByTestId('doubao-login-refresh'));
    await waitFor(() => {
      expect(doubao.gateway.refreshLogin).toHaveBeenCalledOnce();
    });
  });

  it('登录流进行中跟随轮询:扫码确认后切到已登录视图', async () => {
    const doubao = createDoubaoGateway(
      statusFixture({ loginState: 'qr-ready', qrCodeDataUrl: QR_DATA_URL, qrExpiresAt: 1 }),
    );
    renderPanel(doubao.gateway);
    await screen.findByTestId('doubao-login-qr');

    // 主进程登录 poller 检测扫码完成 → 下一次 getStatus 返回已登录。
    doubao.advance(
      statusFixture({ loggedIn: true, accountName: '豆包创作者', loginState: 'logged-in' }),
    );
    await waitFor(
      () => {
        expect(screen.getByTestId('doubao-logged-in')).toBeTruthy();
      },
      // 轮询间隔 2s,给足余量。
      { timeout: 5_000 },
    );
    expect(screen.getByTestId('doubao-account-name').textContent).toBe('豆包创作者');
    expect(screen.getByTestId('doubao-usage').textContent).toContain('97/100');
  });

  it('已登录:退出需确认,确认后回到未登录态', async () => {
    const doubao = createDoubaoGateway(
      statusFixture({ loggedIn: true, accountName: '豆包创作者', loginState: 'logged-in' }),
    );
    renderPanel(doubao.gateway);

    await screen.findByTestId('doubao-logged-in');
    await userEvent.click(screen.getByTestId('doubao-logout'));
    // AlertDialog 确认后才调用登出。
    expect(doubao.gateway.logout).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByTestId('doubao-logout-confirm'));
    await waitFor(() => {
      expect(doubao.gateway.logout).toHaveBeenCalledOnce();
    });
    await screen.findByTestId('doubao-login-start');
  });

  it('状态读取失败:错误文案 + 重试重新拉取', async () => {
    const doubao = createDoubaoGateway(statusFixture());
    doubao.gateway.getStatus.mockRejectedValueOnce(new Error('桌面桥返回格式无效'));
    renderPanel(doubao.gateway);

    await screen.findByTestId('doubao-status-error');
    await userEvent.click(screen.getByTestId('doubao-status-retry'));
    await waitFor(() => {
      expect(doubao.gateway.getStatus).toHaveBeenCalledTimes(2);
    });
    await screen.findByTestId('doubao-login-start');
  });

  it('scanned 与 error 状态文案可见,errorMessage 以 alert 呈现', async () => {
    const doubao = createDoubaoGateway(statusFixture({ loginState: 'scanned' }));
    const view = renderPanel(doubao.gateway);
    await screen.findByTestId('doubao-login-flow');
    expect(screen.getByTestId('doubao-login-hint').textContent).toContain('已扫码');
    view.unmount();

    const errored = createDoubaoGateway(
      statusFixture({ loginState: 'error', errorMessage: '豆包二维码已失效,请点击刷新重试。' }),
    );
    renderPanel(errored.gateway);
    await screen.findByTestId('doubao-login-flow');
    expect(screen.getByTestId('doubao-login-error').textContent).toContain('已失效');
  });
});
