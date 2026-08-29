import type { AppPreferences } from '@musefold/contracts';
import { type MusefoldGateway, PlatformProvider, WEB_CAPABILITIES } from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { useScreenIntent } from '../../shell/screen-intent-store';
import { resolveThemeClass } from '../hooks';
import { MotionSync } from '../MotionSync';
import { SettingsScreen, type SettingsScreenProps } from '../SettingsScreen';

// Radix Select 在 jsdom 缺 pointer capture / scrollIntoView 实现,补桩后才能开浮层。
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
});

function createTestGateway(overrides?: {
  accountRejects?: boolean;
  preferences?: Partial<AppPreferences>;
}): {
  gateway: MusefoldGateway;
  updateSpy: ReturnType<typeof vi.fn>;
} {
  let preferences: AppPreferences = {
    theme: 'system',
    language: 'zh-CN',
    reducedMotion: 'system',
    pinnedSessionIds: [],
    ...overrides?.preferences,
  };
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

function renderSettings(gateway: MusefoldGateway, props?: SettingsScreenProps) {
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
  return render(<SettingsScreen {...props} />, { wrapper: Providers });
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

  it('updates motion level through the three-option select', async () => {
    const { gateway, updateSpy } = createTestGateway();
    renderSettings(gateway);

    const trigger = await screen.findByTestId('settings-motion-trigger');
    expect(trigger.textContent).toContain('跟随系统');

    // Radix Select:键盘展开;jsdom 无 pointer 事件流,click 走触摸分支提交选择。
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const option = await screen.findByTestId('settings-motion-on');
    fireEvent.click(option);

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith({ reducedMotion: 'on' });
    });
    await waitFor(() => {
      expect(screen.getByTestId('settings-motion-trigger').textContent).toContain('减少动效');
    });
  });

  it('shows signed-out hint when account status is unavailable', async () => {
    const { gateway } = createTestGateway({ accountRejects: true });
    renderSettings(gateway);

    await waitFor(() => {
      expect(screen.getByTestId('settings-account-signed-out')).toBeTruthy();
    });
  });

  it('consumes sidebar deep-link intents and scrolls to the target card', async () => {
    const scrollSpy = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollSpy;
    try {
      useScreenIntent.setState({ intent: { kind: 'settings-account' } });
      const { gateway } = createTestGateway();
      const { unmount } = renderSettings(gateway);

      await screen.findByTestId('settings-account-anchor');
      await waitFor(() => {
        expect(scrollSpy).toHaveBeenCalled();
      });
      expect(useScreenIntent.getState().intent).toBeNull();
      unmount();

      // Web 无中转站卡:connections 意图兜底滚到账户卡,不悬空。
      scrollSpy.mockClear();
      useScreenIntent.setState({ intent: { kind: 'settings-connections' } });
      renderSettings(gateway);
      await screen.findByTestId('settings-account-anchor');
      await waitFor(() => {
        expect(scrollSpy).toHaveBeenCalled();
      });
      expect(screen.queryByTestId('settings-connections-anchor')).toBeNull();
      expect(useScreenIntent.getState().intent).toBeNull();
    } finally {
      Element.prototype.scrollIntoView = original;
      useScreenIntent.setState({ intent: null });
    }
  });

  it('data card opens prompt trash via screen intent; hidden without onOpenScreen', async () => {
    useScreenIntent.setState({ intent: null });
    const { gateway } = createTestGateway();
    const onOpenScreen = vi.fn();
    const { unmount } = renderSettings(gateway, { onOpenScreen });

    fireEvent.click(await screen.findByTestId('settings-open-prompt-trash'));
    expect(onOpenScreen).toHaveBeenCalledWith('prompts');
    expect(useScreenIntent.getState().intent).toEqual({ kind: 'prompts-trash' });

    fireEvent.click(screen.getByTestId('settings-open-history-trash'));
    expect(onOpenScreen).toHaveBeenLastCalledWith('history');
    expect(useScreenIntent.getState().intent).toEqual({ kind: 'history-trash' });

    unmount();
    useScreenIntent.setState({ intent: null });
    renderSettings(gateway);
    await screen.findByTestId('settings-appearance-card');
    expect(screen.queryByTestId('settings-data-card')).toBeNull();
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

describe('MotionSync(动效分级投影到 <html>)', () => {
  function renderMotionSync(level: AppPreferences['reducedMotion']) {
    const { gateway } = createTestGateway({ preferences: { reducedMotion: level } });
    return renderSettingsTree(gateway, <MotionSync />);
  }

  function renderSettingsTree(gateway: MusefoldGateway, node: ReactNode) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={queryClient}>
        <PlatformProvider runtime={{ gateway, capabilities: WEB_CAPABILITIES }}>
          {node}
        </PlatformProvider>
      </QueryClientProvider>,
    );
  }

  it('on → 挂 reduce-motion class 与 data-motion 标记', async () => {
    const view = renderMotionSync('on');
    await waitFor(() => {
      expect(document.documentElement.classList.contains('reduce-motion')).toBe(true);
    });
    expect(document.documentElement.dataset.motion).toBe('on');
    view.unmount();
  });

  it('off / system → 摘 class,data-motion 表达档位', async () => {
    const offView = renderMotionSync('off');
    await waitFor(() => {
      expect(document.documentElement.dataset.motion).toBe('off');
    });
    expect(document.documentElement.classList.contains('reduce-motion')).toBe(false);
    offView.unmount();

    const systemView = renderMotionSync('system');
    await waitFor(() => {
      expect(document.documentElement.dataset.motion).toBe('system');
    });
    expect(document.documentElement.classList.contains('reduce-motion')).toBe(false);
    systemView.unmount();
  });
});
