import { describe, expect, it } from 'vitest';
import {
  AUTOMATION_CONFIRMATION_TIMEOUT_MS,
  AUTOMATION_LOG_LIMIT,
  AUTOMATION_MAX_MONTHLY_BUDGET_POINTS,
  AUTOMATION_PROMPT_PREVIEW_MAX,
  automationConfirmationEventSchema,
  automationConfirmationResolvedSchema,
  automationConfirmationSummarySchema,
  automationIntegrationGuideSchema,
  automationLogQuerySchema,
  automationRequestLogEntrySchema,
  automationSpendAuditSchema,
  automationStatusSchema,
  automationTokenMaskSchema,
  maskAutomationToken,
  resolveAutomationConfirmationInputSchema,
  resolveAutomationConfirmationResultSchema,
  setAutomationBudgetInputSchema,
  setAutomationEnabledInputSchema,
} from '../automation';
import { V25_METHODS_BY_DOMAIN } from '../gateway-methods';

/** 真实形状的控制面令牌:`mf_at_` + 43 字符 base64url。 */
const FULL_TOKEN = `mf_at_${'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0u_v'}`;

const STATUS = {
  enabled: true,
  running: true,
  host: '127.0.0.1' as const,
  port: 43217,
  apiVersion: 'v1' as const,
  tokenMasked: 'mf_a…0u_v',
  monthlyBudgetPoints: 20,
  spentThisMonthPoints: 3.5,
  budgetMonth: '2026-09',
};

describe('automation token mask(渲染层永不见完整令牌)', () => {
  it('masks a real token to prefix/suffix only and keeps the full token unrepresentable', () => {
    expect(FULL_TOKEN).toHaveLength(49);
    const masked = maskAutomationToken(FULL_TOKEN);
    expect(masked).toBe('mf_a…0u_v');
    expect(masked).not.toContain(FULL_TOKEN.slice(4, -4));
    expect(automationTokenMaskSchema.parse(masked)).toBe(masked);

    // 契约层的结构化保证:完整令牌(或任何长于掩码的串)无法通过 schema。
    for (const value of [
      FULL_TOKEN,
      `mf_at_${'x'.repeat(43)}`,
      'mf_a…0u_v ',
      'mf_a...0u_v',
      'mf_a…0u_v0',
      '',
    ]) {
      expect(automationTokenMaskSchema.safeParse(value).success, value).toBe(false);
    }
  });

  it('fully masks short tokens instead of revealing them', () => {
    expect(maskAutomationToken('short')).toBe('••••••');
    expect(maskAutomationToken('12345678')).toBe('••••••');
    expect(automationTokenMaskSchema.parse('••••••')).toBe('••••••');
  });
});

describe('automation status(path-free / secret-free)', () => {
  it('accepts the trimmed status shape and rejects host paths or raw tokens', () => {
    expect(automationStatusSchema.parse(STATUS)).toEqual(STATUS);
    expect(
      automationStatusSchema.parse({ ...STATUS, port: null, tokenMasked: null }),
    ).toMatchObject({ port: null, tokenMasked: null });

    // 发现文件路径是本机路径,不下发;完整令牌也不是合法出参。
    expect(
      automationStatusSchema.safeParse({
        ...STATUS,
        discoveryPath: '/Users/creator/Library/Application Support/Musefold/automation.json',
      }).success,
    ).toBe(false);
    expect(automationStatusSchema.safeParse({ ...STATUS, token: FULL_TOKEN }).success).toBe(false);
    expect(automationStatusSchema.safeParse({ ...STATUS, tokenMasked: FULL_TOKEN }).success).toBe(
      false,
    );
    expect(automationStatusSchema.safeParse({ ...STATUS, host: '0.0.0.0' }).success).toBe(false);
    expect(automationStatusSchema.safeParse({ ...STATUS, port: 0 }).success).toBe(false);
    expect(automationStatusSchema.safeParse({ ...STATUS, budgetMonth: '2026-13' }).success).toBe(
      false,
    );
    expect(automationStatusSchema.safeParse({ ...STATUS, spentThisMonthPoints: -1 }).success).toBe(
      false,
    );
  });
});

describe('automation inputs(防呆)', () => {
  it('takes a boolean switch only', () => {
    expect(setAutomationEnabledInputSchema.parse({ enabled: false })).toEqual({ enabled: false });
    expect(setAutomationEnabledInputSchema.safeParse({ enabled: 'false' }).success).toBe(false);
    expect(setAutomationEnabledInputSchema.safeParse({}).success).toBe(false);
  });

  it('bounds the monthly budget to a non-negative integer under the guard rail', () => {
    expect(setAutomationBudgetInputSchema.parse({ points: 0 })).toEqual({ points: 0 });
    expect(
      setAutomationBudgetInputSchema.parse({ points: AUTOMATION_MAX_MONTHLY_BUDGET_POINTS }),
    ).toEqual({ points: AUTOMATION_MAX_MONTHLY_BUDGET_POINTS });
    for (const points of [
      -1,
      1.5,
      Number.NaN,
      AUTOMATION_MAX_MONTHLY_BUDGET_POINTS + 1,
      '10' as unknown as number,
    ]) {
      expect(setAutomationBudgetInputSchema.safeParse({ points }).success, String(points)).toBe(
        false,
      );
    }
  });

  it('caps the log limit at the control-panel ceiling', () => {
    expect(automationLogQuerySchema.parse({})).toEqual({});
    expect(automationLogQuerySchema.parse({ limit: AUTOMATION_LOG_LIMIT })).toEqual({
      limit: AUTOMATION_LOG_LIMIT,
    });
    expect(automationLogQuerySchema.safeParse({ limit: AUTOMATION_LOG_LIMIT + 1 }).success).toBe(
      false,
    );
    expect(automationLogQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
  });
});

describe('automation logs', () => {
  it('keeps the request log entry to an HTTP route path, never a filesystem path', () => {
    const entry = {
      at: '2026-09-06T10:15:00.000+00:00',
      method: 'POST' as const,
      path: '/v1/generate',
      status: 202,
      durationMs: 41,
    };
    expect(automationRequestLogEntrySchema.parse(entry)).toEqual(entry);
    expect(
      automationRequestLogEntrySchema.parse({ ...entry, errorCode: 'CONFIRMATION_TIMEOUT' }),
    ).toMatchObject({ errorCode: 'CONFIRMATION_TIMEOUT' });

    for (const path of [
      'v1/generate',
      '/Users/creator/Library/Application Support/Musefold',
      'C:\\Users\\creator',
      '/v1/generate?token=abc',
    ]) {
      expect(automationRequestLogEntrySchema.safeParse({ ...entry, path }).success, path).toBe(
        false,
      );
    }
    expect(automationRequestLogEntrySchema.safeParse({ ...entry, method: 'TRACE' }).success).toBe(
      false,
    );
    expect(automationRequestLogEntrySchema.safeParse({ ...entry, status: 99 }).success).toBe(false);
  });

  it('describes a spend audit row with truncated prompt and nullable points', () => {
    const row = {
      id: 12,
      at: '2026-09-06T10:15:00.000+00:00',
      action: 'generate_image' as const,
      promptPreview: '一只在窗台上的橘猫',
      approvedVia: 'confirmation' as const,
      status: 'success' as const,
      estimatedPoints: 4,
      actualPoints: 3.5,
    };
    expect(automationSpendAuditSchema.parse(row)).toEqual(row);
    expect(
      automationSpendAuditSchema.parse({
        ...row,
        promptPreview: null,
        estimatedPoints: null,
        actualPoints: null,
      }),
    ).toMatchObject({ promptPreview: null, actualPoints: null });

    // jobId 是内部标识,不进控制面出参;提示词全文只留在本机审计表。
    expect(automationSpendAuditSchema.safeParse({ ...row, jobId: 'job-1' }).success).toBe(false);
    expect(
      automationSpendAuditSchema.safeParse({
        ...row,
        promptPreview: 'x'.repeat(AUTOMATION_PROMPT_PREVIEW_MAX + 1),
      }).success,
    ).toBe(false);
    expect(automationSpendAuditSchema.safeParse({ ...row, at: 1_757_153_700_000 }).success).toBe(
      false,
    );
  });
});

describe('automation confirmations', () => {
  const summary = {
    confirmationId: '3f6b1a2c-0000-4000-8000-000000000001',
    providerName: '中转站',
    model: 'gemini-2.5-flash-image',
    n: 2,
    estimatedPoints: 8,
    promptPreview: '一只在窗台上的橘猫',
  };

  it('mirrors the main-process ConfirmationSummary shape exactly', () => {
    expect(automationConfirmationSummarySchema.parse(summary)).toEqual(summary);
    expect(
      automationConfirmationSummarySchema.parse({ ...summary, estimatedPoints: null }),
    ).toMatchObject({ estimatedPoints: null });
    // 主进程不发 kind / 截止时刻,契约也不伪造它们。
    expect(
      automationConfirmationSummarySchema.safeParse({ ...summary, kind: 'generate' }).success,
    ).toBe(false);
    expect(automationConfirmationSummarySchema.safeParse({ ...summary, n: 0 }).success).toBe(false);
  });

  it('shares the 120s deadline with the automation server gate', () => {
    expect(AUTOMATION_CONFIRMATION_TIMEOUT_MS).toBe(120_000);
  });

  it('parses both event kinds off the single preload channel', () => {
    expect(automationConfirmationEventSchema.parse({ type: 'required', summary })).toEqual({
      type: 'required',
      summary,
    });
    const resolved = { confirmationId: summary.confirmationId, outcome: 'timeout' as const };
    expect(automationConfirmationResolvedSchema.parse(resolved)).toEqual(resolved);
    expect(automationConfirmationEventSchema.parse({ type: 'resolved', resolved })).toEqual({
      type: 'resolved',
      resolved,
    });
    expect(automationConfirmationEventSchema.safeParse({ type: 'other', summary }).success).toBe(
      false,
    );
    expect(
      automationConfirmationResolvedSchema.safeParse({ ...resolved, outcome: 'expired' }).success,
    ).toBe(false);
  });

  it('takes an explicit verdict and reports whether the card owned the settle', () => {
    expect(
      resolveAutomationConfirmationInputSchema.parse({
        confirmationId: summary.confirmationId,
        approved: false,
      }),
    ).toEqual({ confirmationId: summary.confirmationId, approved: false });
    expect(
      resolveAutomationConfirmationInputSchema.safeParse({
        confirmationId: summary.confirmationId,
      }).success,
    ).toBe(false);
    expect(resolveAutomationConfirmationResultSchema.parse({ handled: true })).toEqual({
      handled: true,
    });
  });
});

describe('integration guide(文本 + 复制,片段不含密钥)', () => {
  it('carries copyable snippets and the bundled/CLI readiness flags', () => {
    const guide = {
      bundledReady: true,
      mcpConfigJson: '{\n  "mcpServers": {}\n}',
      codexConfigToml: '[mcp_servers.musefold]',
      claudeCommand: 'claude mcp add musefold',
      cliInstalled: false,
      cliOnPath: false,
    };
    expect(automationIntegrationGuideSchema.parse(guide)).toEqual(guide);
    // 令牌一类凭据不进向导片段(MCP 经发现链自读)。
    expect(
      automationIntegrationGuideSchema.safeParse({ ...guide, token: FULL_TOKEN }).success,
    ).toBe(false);
    expect(
      automationIntegrationGuideSchema.safeParse({ ...guide, mcpConfigJson: '' }).success,
    ).toBe(false);
  });
});

describe('automation gateway method table', () => {
  it('registers the nine automation methods without any token-reading channel', () => {
    expect(V25_METHODS_BY_DOMAIN.automation).toEqual([
      'automation.getStatus',
      'automation.setEnabled',
      'automation.rotateToken',
      'automation.copyToken',
      'automation.setMonthlyBudget',
      'automation.listRequestLog',
      'automation.listSpendAudit',
      'automation.resolveConfirmation',
      'automation.getIntegrationGuide',
    ]);
    // 渲染层没有任何「取回明文令牌」的方法:复制在主进程完成。
    expect(V25_METHODS_BY_DOMAIN.automation).not.toContain('automation.getToken');
    expect(V25_METHODS_BY_DOMAIN.automation).not.toContain('automation.revealToken');
  });

  it('keeps every automation method inside its own domain prefix', () => {
    for (const method of V25_METHODS_BY_DOMAIN.automation) {
      expect(method.startsWith('automation.')).toBe(true);
    }
  });
});
