import type {
  AutomationConfirmationEvent,
  AutomationConfirmationSummary,
} from '@musefold/contracts';
import { AUTOMATION_CONFIRMATION_TIMEOUT_MS } from '@musefold/contracts';
import {
  DESKTOP_CAPABILITIES,
  type MusefoldGateway,
  PlatformProvider,
  WEB_CAPABILITIES,
} from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutomationConfirmCard } from '../AutomationConfirmCard';

function makeSummary(
  confirmationId: string,
  overrides?: Partial<AutomationConfirmationSummary>,
): AutomationConfirmationSummary {
  return {
    confirmationId,
    providerName: '中转站',
    model: 'gpt-image-1',
    n: 2,
    estimatedPoints: 40,
    promptPreview: '一只戴墨镜的柴犬',
    ...overrides,
  };
}

/** 桩:把主进程广播换成手动 `emit`,断言队列语义不依赖真实 IPC。 */
function renderCard(options?: { withAutomation?: boolean; resolveRejects?: boolean }) {
  const listeners = new Set<(event: AutomationConfirmationEvent) => void>();
  const resolveConfirmation = vi.fn(() =>
    options?.resolveRejects
      ? Promise.reject(new Error('CONFIRMATION_TIMEOUT'))
      : Promise.resolve({ handled: true }),
  );
  const unsubscribe = vi.fn();
  const automation = {
    resolveConfirmation,
    subscribeConfirmations: vi.fn((listener: (event: AutomationConfirmationEvent) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        unsubscribe();
      };
    }),
  };
  const gateway = {
    ...(options?.withAutomation === false ? {} : { automation }),
  } as unknown as MusefoldGateway;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Providers({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <PlatformProvider
          runtime={{
            gateway,
            capabilities:
              options?.withAutomation === false ? WEB_CAPABILITIES : DESKTOP_CAPABILITIES,
          }}
        >
          {children}
        </PlatformProvider>
      </QueryClientProvider>
    );
  }
  const view = render(<AutomationConfirmCard />, { wrapper: Providers });
  function emit(event: AutomationConfirmationEvent) {
    act(() => {
      for (const listener of listeners) listener(event);
    });
  }
  return { emit, resolveConfirmation, unsubscribe, view };
}

describe('AutomationConfirmCard', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('没有待确认项时渲染 null', () => {
    renderCard();
    expect(screen.queryByTestId('automation-confirm-card')).toBeNull();
  });

  it('Web 宿主(无 automation 域)恒渲染 null', () => {
    renderCard({ withAutomation: false });
    expect(screen.queryByTestId('automation-confirm-card')).toBeNull();
  });

  it('收到确认请求后显示来源/模型/张数/预估花费与倒计时', () => {
    const { emit } = renderCard();
    emit({ type: 'required', summary: makeSummary('c1') });

    const card = screen.getByTestId('automation-confirm-card');
    expect(card.getAttribute('role')).toBe('alertdialog');
    expect(screen.getByTestId('automation-confirm-meta').textContent).toBe(
      '中转站 · gpt-image-1 · 2 张 · 预估 40 积分',
    );
    expect(card.textContent).toContain('一只戴墨镜的柴犬');
    expect(screen.getByTestId('automation-confirm-countdown').textContent).toBe(
      `${AUTOMATION_CONFIRMATION_TIMEOUT_MS / 1_000}s`,
    );
  });

  it('成本未知时文案降级为「成本未知」', () => {
    const { emit } = renderCard();
    emit({ type: 'required', summary: makeSummary('c1', { estimatedPoints: null }) });
    expect(screen.getByTestId('automation-confirm-meta').textContent).toContain('成本未知');
  });

  it('「允许生成」发 approved 回执并立即撤卡', async () => {
    const { emit, resolveConfirmation } = renderCard();
    emit({ type: 'required', summary: makeSummary('c1') });

    act(() => {
      screen.getByTestId('automation-confirm-approve').click();
    });
    expect(resolveConfirmation).toHaveBeenCalledWith({ confirmationId: 'c1', approved: true });
    expect(screen.queryByTestId('automation-confirm-card')).toBeNull();
  });

  it('「拒绝」发 approved=false 回执并撤卡', () => {
    const { emit, resolveConfirmation } = renderCard();
    emit({ type: 'required', summary: makeSummary('c1') });

    act(() => {
      screen.getByTestId('automation-confirm-deny').click();
    });
    expect(resolveConfirmation).toHaveBeenCalledWith({ confirmationId: 'c1', approved: false });
    expect(screen.queryByTestId('automation-confirm-card')).toBeNull();
  });

  it('回执失败也不把卡片放回来(主进程已按超时处理)', async () => {
    const { emit } = renderCard({ resolveRejects: true });
    emit({ type: 'required', summary: makeSummary('c1') });
    act(() => {
      screen.getByTestId('automation-confirm-approve').click();
    });
    await waitFor(() => expect(screen.queryByTestId('automation-confirm-card')).toBeNull());
  });

  it('倒计时到点自动视为拒绝:撤卡且不发回执', () => {
    const { emit, resolveConfirmation } = renderCard();
    emit({ type: 'required', summary: makeSummary('c1') });

    act(() => {
      vi.advanceTimersByTime(AUTOMATION_CONFIRMATION_TIMEOUT_MS + 1_000);
    });
    expect(screen.queryByTestId('automation-confirm-card')).toBeNull();
    expect(resolveConfirmation).not.toHaveBeenCalled();
  });

  it('倒计时末段转危险色', () => {
    const { emit } = renderCard();
    emit({ type: 'required', summary: makeSummary('c1') });
    act(() => {
      vi.advanceTimersByTime(AUTOMATION_CONFIRMATION_TIMEOUT_MS - 5_000);
    });
    const countdown = screen.getByTestId('automation-confirm-countdown');
    expect(countdown.className).toContain('text-destructive');
    expect(Number.parseInt(countdown.textContent ?? '', 10)).toBeLessThanOrEqual(5);
  });

  it('多条排队只显示首条 + 「还有 n 条」;首条解决后自动前推', () => {
    const { emit } = renderCard();
    emit({ type: 'required', summary: makeSummary('c1') });
    emit({ type: 'required', summary: makeSummary('c2', { model: 'seedream-4' }) });
    emit({ type: 'required', summary: makeSummary('c3') });

    expect(screen.getByTestId('automation-confirm-queue').textContent).toBe('还有 2 个等待确认');
    expect(screen.getByTestId('automation-confirm-meta').textContent).toContain('gpt-image-1');

    // 同 id 重复广播不产生第二张卡。
    emit({ type: 'required', summary: makeSummary('c1') });
    expect(screen.getByTestId('automation-confirm-queue').textContent).toBe('还有 2 个等待确认');

    act(() => {
      screen.getByTestId('automation-confirm-deny').click();
    });
    expect(screen.getByTestId('automation-confirm-meta').textContent).toContain('seedream-4');
    expect(screen.getByTestId('automation-confirm-queue').textContent).toBe('还有 1 个等待确认');
  });

  it('确认被别的通道解决(resolved 广播)时跟着撤卡', () => {
    const { emit } = renderCard();
    emit({ type: 'required', summary: makeSummary('c1') });
    emit({ type: 'resolved', resolved: { confirmationId: 'c1', outcome: 'timeout' } });
    expect(screen.queryByTestId('automation-confirm-card')).toBeNull();
  });

  it('宿主没有事件通道(preload 错配)时降级渲染 null,不炸壳', () => {
    const gateway = {
      automation: {
        resolveConfirmation: vi.fn(),
        subscribeConfirmations: () => {
          throw new Error('AUTOMATION_UNAVAILABLE');
        },
      },
    } as unknown as MusefoldGateway;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<AutomationConfirmCard />, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          <PlatformProvider runtime={{ gateway, capabilities: DESKTOP_CAPABILITIES }}>
            {children}
          </PlatformProvider>
        </QueryClientProvider>
      ),
    });
    expect(screen.queryByTestId('automation-confirm-card')).toBeNull();
  });

  it('卸载时退订主进程事件', () => {
    const { view, unsubscribe } = renderCard();
    view.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
