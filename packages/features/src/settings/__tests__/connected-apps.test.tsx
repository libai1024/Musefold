import type { CloudMcpAuthorizationList } from '@musefold/contracts';
import { CLOUD_MCP_CUSTOM_SERVER_CODE, defaultAppPreferences } from '@musefold/contracts';
import {
  DESKTOP_CAPABILITIES,
  type MusefoldGateway,
  PlatformProvider,
  WEB_CAPABILITIES,
} from '@musefold/platform';
import { toast } from '@musefold/ui/components/sonner';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatConnectedAppAuthorizedAt, ConnectedAppsCard } from '../ConnectedAppsCard';
import { availableSettingsSections } from '../sections';
import { useSettingsNav } from '../settings-nav-store';
import { SettingsScreen } from '../SettingsScreen';

vi.mock('@musefold/ui/components/sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
});

afterEach(() => {
  cleanup();
  useSettingsNav.setState({ activeSectionId: null });
});

const LIST: CloudMcpAuthorizationList = {
  items: [
    {
      clientId: 'cursor-mcp-client',
      name: 'Cursor',
      uri: null,
      scopes: ['account:read', 'prompts:read'],
      authorizedAt: '2026-08-01T12:00:00.000+00:00',
      lastUsedAt: '2026-09-06T08:30:00.000+00:00',
    },
  ],
};

const ACCOUNT = {
  id: 'u1',
  username: 'tester',
  displayName: '测试者',
  quota: 150_000,
  quotaUnit: '点',
  canGenerate: true,
};

function authRequired(): never {
  const error = Object.assign(new Error('桌面端尚未登录'), { code: 'AUTH_REQUIRED' });
  throw error;
}

function createGateway(options?: {
  signedIn?: boolean;
  list?: () => Promise<CloudMcpAuthorizationList>;
  revoke?: (input: { clientId: string }) => Promise<{ revoked: true; clientId: string }>;
}): MusefoldGateway {
  const signedIn = options?.signedIn ?? true;
  return {
    settings: {
      getPreferences: async () => defaultAppPreferences,
      updatePreferences: vi.fn(),
    },
    account: {
      getStatus: signedIn ? async () => ACCOUNT : async () => authRequired(),
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      redeem: vi.fn(),
    },
    cloudMcp: {
      listAuthorizations: options?.list ?? (async () => LIST),
      revokeAuthorization:
        options?.revoke ??
        (async (input) => ({ revoked: true as const, clientId: input.clientId })),
    },
    usage: { summary: vi.fn() },
    prompts: {} as MusefoldGateway['prompts'],
    workbench: {} as MusefoldGateway['workbench'],
    generation: {} as MusefoldGateway['generation'],
  } as MusefoldGateway;
}

function renderCard(gateway: MusefoldGateway, capabilities = WEB_CAPABILITIES) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Providers({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <PlatformProvider runtime={{ gateway, capabilities }}>{children}</PlatformProvider>
      </QueryClientProvider>
    );
  }
  return render(<ConnectedAppsCard />, { wrapper: Providers });
}

function renderOpenSettings(gateway: MusefoldGateway, capabilities = WEB_CAPABILITIES) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  useSettingsNav.setState({ activeSectionId: 'open' });
  function Providers({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <PlatformProvider runtime={{ gateway, capabilities }}>{children}</PlatformProvider>
      </QueryClientProvider>
    );
  }
  return render(<SettingsScreen />, { wrapper: Providers });
}

describe('connected apps formatters', () => {
  it('formats authorizedAt in zh-CN and falls back for invalid ISO', () => {
    expect(formatConnectedAppAuthorizedAt('not-a-date')).toBe('—');
    expect(formatConnectedAppAuthorizedAt('2026-08-01T12:00:00.000+00:00')).toMatch(/2026/);
  });
});

describe('open section registry(Web 也能进已连接应用)', () => {
  it('registers open when either local automation or cloud MCP controls are on', () => {
    const web = availableSettingsSections({ capabilities: WEB_CAPABILITIES });
    expect(web.map((section) => section.id)).toContain('open');
    expect(
      availableSettingsSections({
        capabilities: DESKTOP_CAPABILITIES,
        onOpenScreen: vi.fn(),
      }).map((section) => section.id),
    ).toContain('open');
    expect(
      availableSettingsSections({
        capabilities: { ...WEB_CAPABILITIES, hasCloudMcpControls: false },
      }).map((section) => section.id),
    ).not.toContain('open');
  });
});

describe('ConnectedAppsCard 门控与四态', () => {
  beforeEach(() => {
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
  });

  it('shows the signed-out gate and does not fetch the list', async () => {
    const list = vi.fn(async () => LIST);
    renderCard(createGateway({ signedIn: false, list }));
    expect((await screen.findByTestId('settings-connected-apps-signed-out')).textContent).toContain(
      '登录 Musefold 账号后可管理',
    );
    expect(screen.getByTestId('settings-connected-apps-signin')).toBeTruthy();
    expect(list).not.toHaveBeenCalled();
    expect(screen.queryByTestId('settings-connected-apps-list')).toBeNull();
  });

  it('shows the empty copy when the owner has no grants', async () => {
    renderCard(createGateway({ list: async () => ({ items: [] }) }));
    expect((await screen.findByTestId('settings-connected-apps-empty')).textContent).toBe(
      '还没有已连接的应用',
    );
  });

  it('lists apps and revokes only after AlertDialog confirm', async () => {
    const revoke = vi.fn(async (input: { clientId: string }) => ({
      revoked: true as const,
      clientId: input.clientId,
    }));
    renderCard(createGateway({ revoke }));

    expect((await screen.findByTestId('settings-connected-apps-list')).textContent).toContain(
      'Cursor',
    );
    fireEvent.click(screen.getByTestId('settings-connected-apps-revoke'));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('撤销授权?');
    expect(revoke).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('settings-connected-apps-revoke-confirm'));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith({ clientId: 'cursor-mcp-client' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it('shows 暂不支持 when the host reports a custom server', async () => {
    const error = Object.assign(new Error('自定义账号服务器暂不支持 Cloud MCP 连接管理'), {
      code: CLOUD_MCP_CUSTOM_SERVER_CODE,
    });
    renderCard(createGateway({ list: async () => Promise.reject(error) }));
    expect((await screen.findByTestId('settings-connected-apps-unsupported')).textContent).toBe(
      '自定义账号服务器暂不支持 Cloud MCP 连接管理',
    );
    expect(screen.queryByTestId('settings-connected-apps-retry')).toBeNull();
  });

  it('shows an error + retry when the list fails for another reason', async () => {
    const list = vi.fn().mockRejectedValue(new Error('CLOUD_MCP_FAILED'));
    renderCard(createGateway({ list }));
    expect((await screen.findByTestId('settings-connected-apps-error')).textContent).toContain(
      'CLOUD_MCP_FAILED',
    );
    fireEvent.click(screen.getByTestId('settings-connected-apps-retry'));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });
});

describe('SettingsScreen Web open 分区', () => {
  it('shows the connected apps card on Web without the local automation cards', async () => {
    renderOpenSettings(createGateway({ signedIn: false }));
    expect(await screen.findByTestId('settings-section-open')).toBeTruthy();
    expect(await screen.findByTestId('settings-connected-apps-card')).toBeTruthy();
    expect(screen.queryByTestId('settings-automation-card')).toBeNull();
    expect(screen.queryByTestId('settings-automation-audit-card')).toBeNull();
    expect(screen.queryByTestId('settings-automation-guide-card')).toBeNull();
  });
});
