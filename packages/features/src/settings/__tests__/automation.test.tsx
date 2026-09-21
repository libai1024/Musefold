import type {
  AutomationIntegrationGuide,
  AutomationRequestLogEntry,
  AutomationSpendAudit,
  AutomationStatus,
} from '@musefold/contracts';
import {
  AUTOMATION_MAX_MONTHLY_BUDGET_POINTS,
  automationStatusSchema,
  maskAutomationToken,
} from '@musefold/contracts';
import {
  DESKTOP_CAPABILITIES,
  type MusefoldGateway,
  PlatformProvider,
  WEB_CAPABILITIES,
} from '@musefold/platform';
import { toast } from '@musefold/ui/components/sonner';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseAutomationBudgetDraft } from '../automation-ui';
import { OpenCapabilitiesCard } from '../OpenCapabilitiesCard';
import { availableSettingsSections, filterSettingsSections } from '../sections';

vi.mock('@musefold/ui/components/sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
});

/** 明文令牌只出现在测试里(模拟主进程持有的值),断言它绝不进 DOM。 */
const FULL_TOKEN = 'mf_at_ZmFrZS10b2tlbi1mb3ItdGVzdHMtb25seS0wMDAwMDAwMDA';

const READY_STATUS: AutomationStatus = {
  enabled: true,
  running: true,
  host: '127.0.0.1',
  port: 47_615,
  apiVersion: 'v1',
  tokenMasked: maskAutomationToken(FULL_TOKEN),
  monthlyBudgetPoints: 500,
  spentThisMonthPoints: 120,
  budgetMonth: '2026-09',
};

const REQUEST_LOG: AutomationRequestLogEntry[] = [
  {
    at: '2026-09-06T10:00:00.000Z',
    method: 'POST',
    path: '/v1/generate',
    status: 202,
    durationMs: 142,
  },
  {
    at: '2026-09-06T09:59:00.000Z',
    method: 'GET',
    path: '/v1/jobs',
    status: 401,
    durationMs: 3,
    errorCode: 'UNAUTHORIZED',
  },
];

const SPEND_AUDIT: AutomationSpendAudit[] = [
  {
    id: 12,
    at: '2026-09-06T10:00:00.000Z',
    action: 'generate_image',
    promptPreview: '一只戴墨镜的柴犬',
    approvedVia: 'confirmation',
    status: 'success',
    estimatedPoints: 30,
    actualPoints: 28,
  },
  {
    id: 11,
    at: '2026-09-06T09:00:00.000Z',
    action: 'run_scheme',
    promptPreview: null,
    approvedVia: 'timeout',
    status: 'timeout',
    estimatedPoints: null,
    actualPoints: null,
  },
];

const GUIDE: AutomationIntegrationGuide = {
  bundledReady: true,
  mcpConfigJson:
    '{\n  "mcpServers": {\n    "musefold": { "command": "~/Applications/musefold" }\n  }\n}',
  codexConfigToml: '[mcp_servers.musefold]\ncommand = "~/Applications/musefold"',
  claudeCommand: 'claude mcp add musefold -- ~/Applications/musefold mcp',
  cliInstalled: true,
  cliOnPath: false,
};

type CallMode = 'ready' | 'pending' | 'error';

interface AutomationStubOptions {
  status?: AutomationStatus;
  statusMode?: CallMode;
  toggleMode?: CallMode;
  rotateMode?: CallMode;
  copyMode?: CallMode;
  budgetMode?: CallMode;
  requestLog?: AutomationRequestLogEntry[];
  requestLogMode?: CallMode;
  spendAudit?: AutomationSpendAudit[];
  guide?: AutomationIntegrationGuide;
  guideMode?: CallMode;
}

/**
 * 桌面 automation 域内存桩。
 * 关键点:桩里**没有任何**能返回明文令牌的方法 —— `copyToken` 只回 void,
 * 与真实实现(主进程写系统剪贴板)同形,渲染层不可能拿到 token。
 */
function createAutomationStub(options: AutomationStubOptions) {
  let status: AutomationStatus = options.status ?? READY_STATUS;
  return {
    getStatus: vi.fn(() => {
      if (options.statusMode === 'pending') return new Promise<AutomationStatus>(() => {});
      if (options.statusMode === 'error') return Promise.reject(new Error('控制面状态不可用'));
      return Promise.resolve(status);
    }),
    setEnabled: vi.fn((input: { enabled: boolean }) => {
      if (options.toggleMode === 'pending') return new Promise<AutomationStatus>(() => {});
      if (options.toggleMode === 'error') return Promise.reject(new Error('端口 47615 被占用'));
      status = input.enabled
        ? { ...status, enabled: true, running: true }
        : { ...status, enabled: false, running: false, port: null, tokenMasked: null };
      return Promise.resolve(status);
    }),
    rotateToken: vi.fn(() => {
      if (options.rotateMode === 'pending') return new Promise<AutomationStatus>(() => {});
      if (options.rotateMode === 'error') return Promise.reject(new Error('轮换失败'));
      status = { ...status, tokenMasked: 'abcd…wxyz' };
      return Promise.resolve(status);
    }),
    copyToken: vi.fn(() =>
      options.copyMode === 'error'
        ? Promise.reject(new Error('系统剪贴板不可用'))
        : Promise.resolve(undefined),
    ),
    setMonthlyBudget: vi.fn((input: { points: number }) => {
      if (options.budgetMode === 'error') return Promise.reject(new Error('保存失败'));
      status = { ...status, monthlyBudgetPoints: input.points };
      return Promise.resolve(status);
    }),
    listRequestLog: vi.fn(() => {
      if (options.requestLogMode === 'pending') {
        return new Promise<AutomationRequestLogEntry[]>(() => {});
      }
      if (options.requestLogMode === 'error') return Promise.reject(new Error('日志不可用'));
      return Promise.resolve(options.requestLog ?? REQUEST_LOG);
    }),
    listSpendAudit: vi.fn(() => Promise.resolve(options.spendAudit ?? SPEND_AUDIT)),
    resolveConfirmation: vi.fn(() => Promise.resolve({ handled: true })),
    getIntegrationGuide: vi.fn(() => {
      if (options.guideMode === 'pending') return new Promise<AutomationIntegrationGuide>(() => {});
      if (options.guideMode === 'error') return Promise.reject(new Error('内置产物缺失'));
      return Promise.resolve(options.guide ?? GUIDE);
    }),
    subscribeConfirmations: vi.fn(() => () => undefined),
  };
}

function renderOpenSection(options: AutomationStubOptions = {}) {
  const automation = createAutomationStub(options);
  const gateway = {
    automation,
    account: {
      getStatus: async () => {
        throw Object.assign(new Error('桌面端尚未登录'), { code: 'AUTH_REQUIRED' });
      },
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      redeem: vi.fn(),
    },
  } as unknown as MusefoldGateway;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Providers({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <PlatformProvider runtime={{ gateway, capabilities: DESKTOP_CAPABILITIES }}>
          {children}
        </PlatformProvider>
      </QueryClientProvider>
    );
  }
  const view = render(<OpenCapabilitiesCard />, { wrapper: Providers });
  return { automation, view };
}

describe('设置「开放能力」分区注册', () => {
  it('桌面与 Web 都注册 open 分区;搜索关键词覆盖开放/令牌/预算/MCP', () => {
    const desktop = availableSettingsSections({
      capabilities: DESKTOP_CAPABILITIES,
      onOpenScreen: vi.fn(),
    });
    expect(desktop.map((section) => section.id)).toContain('open');
    const web = availableSettingsSections({ capabilities: WEB_CAPABILITIES });
    expect(web.map((section) => section.id)).toContain('open');

    for (const needle of ['开放', '令牌', '预算', 'mcp', '自动化']) {
      expect(filterSettingsSections(desktop, needle).map((section) => section.id)).toContain(
        'open',
      );
    }
  });
});

describe('本地控制面卡', () => {
  beforeEach(() => {
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
  });

  it('渲染开关 / 地址 / 掩码令牌 / 预算读数,DOM 里不出现完整令牌', async () => {
    renderOpenSection();

    await screen.findByTestId('settings-automation-token');
    expect(screen.getByTestId('settings-automation-toggle').getAttribute('data-state')).toBe(
      'checked',
    );
    expect(screen.getByTestId('settings-automation-address').textContent).toBe(
      'http://127.0.0.1:47615',
    );
    const masked = screen.getByTestId('settings-automation-token').textContent ?? '';
    expect(masked).toBe('mf_a…wMDA');
    expect(masked).not.toContain(FULL_TOKEN);
    expect(document.body.innerHTML).not.toContain(FULL_TOKEN);
    expect(screen.getByTestId('settings-automation-budget-readout').textContent).toContain(
      '本月已用 120 / 500 积分',
    );
  });

  it('读取失败给「重试」;重试后恢复', async () => {
    const { automation } = renderOpenSection({ statusMode: 'error' });
    await screen.findByTestId('settings-automation-error');
    fireEvent.click(screen.getByTestId('settings-automation-retry'));
    await waitFor(() => expect(automation.getStatus).toHaveBeenCalledTimes(2));
  });

  it('关闭开关调 setEnabled(false),状态回写后端口行消失', async () => {
    const { automation } = renderOpenSection();
    await screen.findByTestId('settings-automation-toggle');

    fireEvent.click(screen.getByTestId('settings-automation-toggle'));
    await waitFor(() => expect(automation.setEnabled).toHaveBeenCalledWith({ enabled: false }));
    await waitFor(() => expect(screen.queryByTestId('settings-automation-address-row')).toBeNull());
    expect(screen.getByTestId('settings-automation-token').textContent).toBe('—');
    expect(vi.mocked(toast.success).mock.calls.at(-1)?.[0]).toContain('已停止');
  });

  it('切换失败弹 toast 且保持原状态', async () => {
    renderOpenSection({ toggleMode: 'error' });
    await screen.findByTestId('settings-automation-toggle');
    fireEvent.click(screen.getByTestId('settings-automation-toggle'));
    await waitFor(() =>
      expect(vi.mocked(toast.error).mock.calls.at(-1)?.[0]).toContain('端口 47615 被占用'),
    );
    expect(screen.getByTestId('settings-automation-toggle').getAttribute('data-state')).toBe(
      'checked',
    );
  });

  it('复制令牌走主进程 copyToken,浏览器剪贴板不参与', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { automation } = renderOpenSection();
    await screen.findByTestId('settings-automation-token-copy');

    fireEvent.click(screen.getByTestId('settings-automation-token-copy'));
    await waitFor(() => expect(automation.copyToken).toHaveBeenCalledTimes(1));
    expect(writeText).not.toHaveBeenCalled();
    expect(vi.mocked(toast.success).mock.calls.at(-1)?.[0]).toContain('令牌已复制');

    // 地址行仍走浏览器剪贴板(非密钥文本)。
    fireEvent.click(screen.getByTestId('settings-automation-address-copy'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('http://127.0.0.1:47615'));
  });

  it('轮换令牌必须过 AlertDialog 二次确认,确认后掩码更新并提示旧令牌失效', async () => {
    const { automation } = renderOpenSection();
    await screen.findByTestId('settings-automation-token-rotate');

    fireEvent.click(screen.getByTestId('settings-automation-token-rotate'));
    expect(automation.rotateToken).not.toHaveBeenCalled();
    const confirm = await screen.findByTestId('settings-automation-token-rotate-confirm');
    fireEvent.click(confirm);

    await waitFor(() => expect(automation.rotateToken).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId('settings-automation-token').textContent).toBe('abcd…wxyz'),
    );
    expect(vi.mocked(toast.success).mock.calls.at(-1)?.[0]).toContain('旧令牌立即失效');
  });

  it('控制面未运行时轮换按钮禁用', async () => {
    renderOpenSection({
      status: { ...READY_STATUS, enabled: false, running: false, port: null, tokenMasked: null },
    });
    await screen.findByTestId('settings-automation-token-rotate');
    expect(screen.getByTestId('settings-automation-token-rotate').hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('预算防呆:清空不落盘、值未变时保存禁用、改动后提交整数积分', async () => {
    const { automation } = renderOpenSection();
    const input = await screen.findByTestId('settings-automation-budget-input');
    const save = screen.getByTestId('settings-automation-budget-save');

    // 初始草稿 = 服务端真值 → 未改动,保存禁用。
    expect(save.hasAttribute('disabled')).toBe(true);

    // 清空输入:仍禁用,绝不把预算悄悄改成 0。
    fireEvent.change(input, { target: { value: '' } });
    expect(save.hasAttribute('disabled')).toBe(true);

    fireEvent.change(input, { target: { value: '800.7' } });
    fireEvent.click(save);
    await waitFor(() => expect(automation.setMonthlyBudget).toHaveBeenCalledWith({ points: 800 }));
    expect(vi.mocked(toast.success).mock.calls.at(-1)?.[0]).toContain('800 积分');
  });

  it('预算设为 0 时提示「逐次确认」口径', async () => {
    const { automation } = renderOpenSection();
    const input = await screen.findByTestId('settings-automation-budget-input');
    fireEvent.change(input, { target: { value: '-5' } });
    fireEvent.click(screen.getByTestId('settings-automation-budget-save'));
    await waitFor(() => expect(automation.setMonthlyBudget).toHaveBeenCalledWith({ points: 0 }));
    expect(vi.mocked(toast.success).mock.calls.at(-1)?.[0]).toContain('每次花钱动作都会弹确认');
  });
});

describe('parseAutomationBudgetDraft', () => {
  it('空串 / 非法输入不落盘;负数 clamp 到 0;小数取整;超上限收口', () => {
    expect(parseAutomationBudgetDraft('')).toBeNull();
    expect(parseAutomationBudgetDraft('   ')).toBeNull();
    expect(parseAutomationBudgetDraft('abc')).toBeNull();
    expect(parseAutomationBudgetDraft('-12')).toBe(0);
    expect(parseAutomationBudgetDraft('0')).toBe(0);
    expect(parseAutomationBudgetDraft('12.9')).toBe(12);
    expect(parseAutomationBudgetDraft('999999999')).toBe(AUTOMATION_MAX_MONTHLY_BUDGET_POINTS);
  });
});

describe('最近调用卡', () => {
  it('默认收起且不发请求;展开后渲染日志与花钱记录,刷新再拉一次', async () => {
    const { automation } = renderOpenSection();
    await screen.findByTestId('settings-automation-audit-toggle');
    expect(screen.queryByTestId('settings-automation-audit-body')).toBeNull();
    expect(automation.listRequestLog).not.toHaveBeenCalled();
    expect(automation.listSpendAudit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('settings-automation-audit-toggle'));
    const log = await screen.findByTestId('settings-automation-request-log');
    expect(log.querySelectorAll('li')).toHaveLength(2);
    expect(log.textContent).toContain('/v1/generate');
    expect(log.textContent).toContain('142 ms');

    const audit = await screen.findByTestId('settings-automation-spend-audit');
    expect(audit.textContent).toContain('生成图像');
    expect(audit.textContent).toContain('30 / 28');
    // 未结算的行两列都显示「-」。
    expect(screen.getByTestId('settings-automation-spend-row-11').textContent).toContain('- / -');

    fireEvent.click(screen.getByTestId('settings-automation-audit-refresh'));
    await waitFor(() => expect(automation.listRequestLog).toHaveBeenCalledTimes(2));
    expect(automation.listSpendAudit).toHaveBeenCalledTimes(2);
  });

  it('空态显示「暂无调用」;日志失败只影响日志段', async () => {
    renderOpenSection({ requestLogMode: 'error', spendAudit: [] });
    fireEvent.click(await screen.findByTestId('settings-automation-audit-toggle'));
    await screen.findByTestId('settings-automation-request-log-error');
    expect((await screen.findByTestId('settings-automation-spend-audit-empty')).textContent).toBe(
      '暂无调用',
    );
  });
});

describe('接入向导卡', () => {
  it('渲染三段片段与复制钮;片段不含明文令牌;CLI 未在 PATH 时给提示', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderOpenSection();

    await screen.findByTestId('settings-automation-guide-mcp');
    expect(screen.getByTestId('settings-automation-guide-codex')).toBeTruthy();
    expect(screen.getByTestId('settings-automation-guide-claude')).toBeTruthy();
    expect(screen.getByTestId('settings-automation-cli-path-warning')).toBeTruthy();
    expect(document.body.innerHTML).not.toContain(FULL_TOKEN);

    fireEvent.click(screen.getByTestId('settings-automation-guide-mcp-copy'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(GUIDE.mcpConfigJson));
  });

  it('片段生成失败给「重试」', async () => {
    const { automation } = renderOpenSection({ guideMode: 'error' });
    await screen.findByTestId('settings-automation-guide-error');
    fireEvent.click(screen.getByTestId('settings-automation-guide-retry'));
    await waitFor(() => expect(automation.getIntegrationGuide).toHaveBeenCalledTimes(2));
  });
});

describe('契约回归', () => {
  it('测试用的 READY_STATUS 本身满足契约(掩码 schema 会拦下完整令牌)', () => {
    expect(automationStatusSchema.parse(READY_STATUS)).toEqual(READY_STATUS);
    expect(
      automationStatusSchema.safeParse({ ...READY_STATUS, tokenMasked: FULL_TOKEN }).success,
    ).toBe(false);
  });
});
