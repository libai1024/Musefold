import {
  assembleUsageByDay,
  defaultAppPreferences,
  type UsageRange,
  type UsageSummary,
} from '@musefold/contracts';
import {
  DESKTOP_CAPABILITIES,
  type MusefoldGateway,
  PlatformProvider,
  WEB_CAPABILITIES,
} from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSettingsNav } from '../settings-nav-store';
import { SettingsScreen } from '../SettingsScreen';
import { formatUsageCost, formatUsageCount, formatUsageRate } from '../UsageCard';
import { availableSettingsSections, filterSettingsSections, SETTINGS_SECTIONS } from '../sections';

afterEach(() => {
  cleanup();
  useSettingsNav.setState({ activeSectionId: null });
  document.documentElement.classList.remove('reduce-motion');
  delete document.documentElement.dataset.motion;
});

const NOW = Date.parse('2026-09-06T12:00:00.000Z');
const DAY_MS = 86_400_000;

const READY: UsageSummary = {
  range: '30d',
  from: '2026-08-08T12:00:00.000+00:00',
  to: '2026-09-06T12:00:00.000+00:00',
  generationCount: 4,
  succeededCount: 2,
  failedCount: 1,
  cancelledCount: 1,
  imageCount: 3,
  costPoints: 12.5,
  successRate: 0.5,
  byProvider: [
    { providerId: 'p1', label: '官方中转', generationCount: 3, costPoints: 12.5 },
    { providerId: null, label: '体验通道', generationCount: 1, costPoints: null },
  ],
  byDay: assembleUsageByDay(
    '30d',
    NOW,
    [
      { createdAtMs: NOW, status: 'succeeded', costPoints: 6 },
      { createdAtMs: NOW, status: 'succeeded', costPoints: 6.5 },
      { createdAtMs: NOW, status: 'failed', costPoints: null },
      { createdAtMs: NOW - DAY_MS, status: 'cancelled', costPoints: null },
    ],
    'UTC',
  ),
  byModel: [
    { model: 'musefold-image-pro', generationCount: 3, costPoints: 12.5 },
    { model: '体验模型', generationCount: 1, costPoints: null },
  ],
};

const EMPTY: UsageSummary = {
  ...READY,
  generationCount: 0,
  succeededCount: 0,
  failedCount: 0,
  cancelledCount: 0,
  imageCount: 0,
  costPoints: null,
  successRate: null,
  byProvider: [],
  byDay: assembleUsageByDay('30d', NOW, [], 'UTC'),
  byModel: [],
};

function createGateway(
  summary: (query: { range: UsageRange }) => Promise<UsageSummary>,
): MusefoldGateway {
  return {
    settings: {
      getPreferences: async () => defaultAppPreferences,
      updatePreferences: vi.fn(),
    },
    account: {
      getStatus: async () => ({
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
    usage: { summary },
    prompts: {} as MusefoldGateway['prompts'],
    workbench: {} as MusefoldGateway['workbench'],
    generation: {} as MusefoldGateway['generation'],
  } as MusefoldGateway;
}

function renderUsage(
  summary: (query: { range: UsageRange }) => Promise<UsageSummary>,
  capabilities = WEB_CAPABILITIES,
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  useSettingsNav.setState({ activeSectionId: 'usage' });
  function Providers({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <PlatformProvider runtime={{ gateway: createGateway(summary), capabilities }}>
          {children}
        </PlatformProvider>
      </QueryClientProvider>
    );
  }
  return render(<SettingsScreen />, { wrapper: Providers });
}

describe('usage formatters(07-05 「—」口径)', () => {
  it('formats counts, rates and costs without fabricating zero', () => {
    expect(formatUsageCount(0)).toBe('0');
    expect(formatUsageCount(1200)).toBe('1,200');
    expect(formatUsageRate(null)).toBe('—');
    expect(formatUsageRate(0)).toBe('0%');
    expect(formatUsageRate(0.5)).toBe('50%');
    expect(formatUsageRate(0.333)).toBe('33.3%');
    expect(formatUsageCost(null)).toBe('—');
    expect(formatUsageCost(0)).toBe('0');
    expect(formatUsageCost(12.5)).toBe('12.5');
  });
});

describe('UsageCard 四态 / 范围切换', () => {
  it('shows a skeleton while the first summary is loading', () => {
    renderUsage(() => new Promise(() => {}));
    expect(screen.getByTestId('settings-usage-loading')).toBeTruthy();
    expect(screen.queryByTestId('settings-usage-summary')).toBeNull();
  });

  it('shows an error card with retry and does not invent zeros', async () => {
    const summary = vi.fn().mockRejectedValue(new Error('USAGE_FAILED'));
    renderUsage(summary);
    expect(await screen.findByTestId('settings-usage-error')).toBeTruthy();
    expect(screen.getByTestId('settings-usage-error').textContent).toContain('USAGE_FAILED');
    expect(screen.queryByTestId('settings-usage-generation-count')).toBeNull();
    fireEvent.click(screen.getByTestId('settings-usage-retry'));
    await waitFor(() => expect(summary).toHaveBeenCalledTimes(2));
  });

  it('shows the empty copy when every count is 0', async () => {
    renderUsage(async () => EMPTY);
    expect((await screen.findByTestId('settings-usage-empty')).textContent).toBe(
      '这段时间还没有生成记录',
    );
    expect(screen.queryByTestId('settings-usage-summary')).toBeNull();
    expect((await screen.findByTestId('settings-usage-charts')).textContent).toContain(
      '该时段没有生成记录',
    );
    expect(screen.queryByTestId('settings-usage-chart-trend')).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('renders the four metrics with tabular-nums and — for null cost/rate', async () => {
    const summary = vi.fn(
      async (query: { range: UsageRange }): Promise<UsageSummary> =>
        query.range === '7d'
          ? {
              ...READY,
              range: '7d',
              generationCount: 1,
              successRate: null,
              costPoints: null,
              byDay: assembleUsageByDay(
                '7d',
                NOW,
                [{ createdAtMs: NOW, status: 'queued', costPoints: null }],
                'UTC',
              ),
            }
          : READY,
    );
    renderUsage(summary);

    const rate = await screen.findByTestId('settings-usage-success-rate');
    expect(screen.getByTestId('settings-usage-generation-count').textContent).toBe('4');
    expect(rate.textContent).toBe('50%');
    expect(rate.className).toContain('tabular-nums');
    expect(screen.getByTestId('settings-usage-image-count').textContent).toBe('3');
    expect(screen.getByTestId('settings-usage-cost').textContent).toBe('12.5');

    fireEvent.click(screen.getByTestId('settings-usage-range-7d'));
    await waitFor(() =>
      expect(screen.getByTestId('settings-usage-success-rate').textContent).toBe('—'),
    );
    expect(screen.getByTestId('settings-usage-cost').textContent).toBe('—');
    expect(summary.mock.calls.map((call) => call[0].range)).toEqual(['30d', '7d']);

    fireEvent.click(screen.getByTestId('settings-usage-by-provider-toggle'));
    const table = await screen.findByTestId('settings-usage-by-provider');
    expect(table.textContent).toContain('官方中转');
    expect(table.textContent).toContain('体验通道');
    expect(table.textContent).toContain('—');

    expect(screen.getByTestId('settings-usage-charts')).toBeTruthy();
    expect(screen.getByTestId('settings-usage-chart-trend')).toBeTruthy();
    expect(screen.getByTestId('settings-usage-chart-provider')).toBeTruthy();
    expect(screen.getByTestId('settings-usage-chart-model')).toBeTruthy();
    expect(screen.getByTestId('settings-usage-chart-success')).toBeTruthy();
    expect(
      screen.getByTestId('settings-usage-chart-trend').querySelector('table.sr-only'),
    ).toBeTruthy();
    expect(
      screen.getByTestId('settings-usage-chart-provider').querySelector('table.sr-only'),
    ).toBeTruthy();
    expect(
      screen.getByTestId('settings-usage-chart-model').querySelector('table.sr-only'),
    ).toBeTruthy();
    expect(
      screen.getByTestId('settings-usage-chart-success').querySelector('table.sr-only'),
    ).toBeTruthy();
  });

  it('marks charts static when skipMotion hits, enter when motion is allowed', async () => {
    document.documentElement.classList.add('reduce-motion');
    renderUsage(async () => READY);
    expect((await screen.findByTestId('settings-usage-charts')).getAttribute('data-motion')).toBe(
      'static',
    );
    cleanup();
    document.documentElement.classList.remove('reduce-motion');
    document.documentElement.dataset.motion = 'off';
    renderUsage(async () => READY);
    expect((await screen.findByTestId('settings-usage-charts')).getAttribute('data-motion')).toBe(
      'enter',
    );
    delete document.documentElement.dataset.motion;
  });

  it('refetch goes through the refresh button', async () => {
    const summary = vi.fn(async () => READY);
    renderUsage(summary);
    await screen.findByTestId('settings-usage-summary');
    fireEvent.click(screen.getByTestId('settings-usage-refresh'));
    await waitFor(() => expect(summary).toHaveBeenCalledTimes(2));
  });
});

describe('usage section registry', () => {
  it('registers the usage section in the app group for both hosts', () => {
    const section = SETTINGS_SECTIONS.find((item) => item.id === 'usage');
    expect(section?.group).toBe('app');
    expect(section?.title).toBe('使用统计');
    expect(section?.isAvailable({ capabilities: WEB_CAPABILITIES })).toBe(true);
    expect(
      section?.isAvailable({ capabilities: DESKTOP_CAPABILITIES, onOpenScreen: vi.fn() }),
    ).toBe(true);
    expect(
      filterSettingsSections(
        availableSettingsSections({ capabilities: WEB_CAPABILITIES }),
        '用量',
      ).map((item) => item.id),
    ).toEqual(['usage']);
    expect(
      filterSettingsSections(
        availableSettingsSections({ capabilities: WEB_CAPABILITIES }),
        '统计',
      ).map((item) => item.id),
    ).toEqual(['usage']);
  });
});
