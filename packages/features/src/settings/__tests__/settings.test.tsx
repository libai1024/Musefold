import type { AppPreferences } from '@musefold/contracts';
import { type MusefoldGateway, PlatformProvider, WEB_CAPABILITIES } from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { resolveThemeClass } from '../hooks';
import { SettingsScreen } from '../SettingsScreen';

function createTestGateway(overrides?: { accountRejects?: boolean }): {
  gateway: MusefoldGateway;
  updateSpy: ReturnType<typeof vi.fn>;
} {
  let preferences: AppPreferences = { theme: 'system', language: 'zh-CN', reducedMotion: false };
  const updateSpy = vi.fn(async (patch: Partial<AppPreferences>) => {
    preferences = { ...preferences, ...patch };
    return preferences;
  });

  const gateway = {
    settings: {
      getPreferences: async () => preferences,
      updatePreferences: updateSpy,
    },
    account: {
      getStatus: overrides?.accountRejects
        ? async () => {
            throw new Error('AUTH_REQUIRED');
          }
        : async () => ({
            id: 'u1',
            username: 'tester',
            displayName: '测试者',
            quota: 150_000,
            quotaUnit: '点',
            canGenerate: true,
          }),
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      redeem: vi.fn(),
    },
  } as unknown as MusefoldGateway;

  return { gateway, updateSpy };
}

function renderSettings(gateway: MusefoldGateway) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Providers({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <PlatformProvider runtime={{ gateway, capabilities: WEB_CAPABILITIES }}>
          {children}
        </PlatformProvider>
      </QueryClientProvider>
    );
  }
  return render(<SettingsScreen />, { wrapper: Providers });
}

describe('SettingsScreen', () => {
  it('renders preferences and account summary after loading', async () => {
    const { gateway } = createTestGateway();
    renderSettings(gateway);

    await waitFor(() => {
      expect(screen.getByTestId('account-signed-in')).toBeTruthy();
    });
    expect(screen.getByTestId('settings-theme-trigger').textContent).toContain('跟随系统');
    expect(screen.getByText('测试者')).toBeTruthy();
    expect(screen.getByTestId('account-points').textContent).toBe('3 积分');
    expect(screen.getByTestId('settings-host-badge').textContent).toBe('Web 版');
  });

  it('optimistically toggles reduced motion through the gateway', async () => {
    const { gateway, updateSpy } = createTestGateway();
    renderSettings(gateway);

    const toggle = await screen.findByTestId('settings-reduced-motion');
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith({ reducedMotion: true });
    });
    expect(toggle.getAttribute('data-state')).toBe('checked');
  });

  it('shows signed-out hint when account status is unavailable', async () => {
    const { gateway } = createTestGateway({ accountRejects: true });
    renderSettings(gateway);

    await waitFor(() => {
      expect(screen.getByTestId('settings-account-signed-out')).toBeTruthy();
    });
  });
});

describe('resolveThemeClass', () => {
  it('resolves explicit and system themes', () => {
    expect(resolveThemeClass('dark', false)).toBe('dark');
    expect(resolveThemeClass('light', true)).toBeNull();
    expect(resolveThemeClass('system', true)).toBe('dark');
    expect(resolveThemeClass('system', false)).toBeNull();
  });
});
