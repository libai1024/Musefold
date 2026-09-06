// Web 壳导航 wiring 证据(P01-7):
// - 导航目录由 runtime capability 驱动:hasDesignSchemes=true 时侧栏出现
//   「设计方案」项,点击路由到 /design-schemes;
// - 当前路由 /design-schemes 时该导航项为活动态(aria-current)。

import type { AppPreferences } from '@musefold/contracts';
import { defaultAppPreferences } from '@musefold/contracts';
import type { MusefoldGateway } from '@musefold/platform';
import { PlatformProvider, WEB_CAPABILITIES } from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '../app-shell';

const user = userEvent.setup({ pointerEventsCheck: 0 });

const routerPush = vi.fn();
let pathname = '/workbench';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush }),
  usePathname: () => pathname,
}));

/** 首启引导哨兵:既有壳用例默认「已完成引导」,引导层因此不该出现。 */
const SEEDED_SENTINEL = '2026-08-01T00:00:00.000Z';

function makeGateway(onboardingCompletedAt: string | null = SEEDED_SENTINEL): MusefoldGateway {
  return {
    account: {
      getStatus: vi.fn(async () => {
        throw new Error('UNAUTHENTICATED');
      }),
    },
    settings: {
      getPreferences: vi.fn(async () => ({ ...defaultAppPreferences, onboardingCompletedAt })),
      updatePreferences: vi.fn(async (next: AppPreferences) => next),
    },
    workbench: {
      listSessions: vi.fn(async () => ({ items: [], nextCursor: null })),
    },
  } as unknown as MusefoldGateway;
}

function renderShell(onboardingCompletedAt: string | null = SEEDED_SENTINEL) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const capabilities = { ...WEB_CAPABILITIES, hasDesignSchemes: true };
  function Providers({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <PlatformProvider runtime={{ gateway: makeGateway(onboardingCompletedAt), capabilities }}>
          {children}
        </PlatformProvider>
      </QueryClientProvider>
    );
  }
  return render(
    <AppShell>
      <div data-testid="page-slot" />
    </AppShell>,
    { wrapper: Providers },
  );
}

beforeEach(() => {
  routerPush.mockClear();
  pathname = '/workbench';
});

afterEach(() => cleanup());

describe('Web 壳导航 capability wiring', () => {
  it('hasDesignSchemes 开启时侧栏注册「设计方案」导航项并路由', async () => {
    renderShell();

    const navItem = await screen.findByTestId('nav-design-schemes');
    expect(navItem.textContent).toContain('设计方案');
    await user.click(navItem);
    expect(routerPush).toHaveBeenCalledWith('/design-schemes');
  });

  it('/design-schemes 路由下「设计方案」为活动导航(aria-current)', async () => {
    pathname = '/design-schemes';
    renderShell();

    const navItem = await screen.findByTestId('nav-design-schemes');
    await waitFor(() => expect(navItem.getAttribute('aria-current')).toBe('page'));
  });
});

describe('Web 壳首启引导挂载(U01-onboarding)', () => {
  it('哨兵已写:引导层挂载但不显示', async () => {
    renderShell();

    await screen.findByTestId('nav-design-schemes');
    await waitFor(() => expect(screen.queryByTestId('onboarding-flow')).toBeNull());
  });

  it('未完成哨兵 + 未登录(Web 唯一通道):引导层从 welcome 步弹出', async () => {
    renderShell(null);

    expect(await screen.findByTestId('onboarding-step-welcome')).toBeTruthy();
    const flow = await screen.findByTestId('onboarding-flow');
    expect(flow.getAttribute('role')).toBe('dialog');
  });
});
