import { z } from 'zod';
import { isoDateTimeSchema } from './common';

// ── 开放能力 / 本地控制面(桌面专属可选域)──────────────────────────────
// 「设置 · 开放能力」三张卡(本地控制面 / 最近调用 / 接入向导)与壳级
// `AutomationConfirmCard` 的出入参契约。主进程语义在
// `apps/desktop/electron/main/automation.ts`(automation HTTP server + 花钱闸门),
// 本域只裁剪出参、收窄入参,不新增业务语义。
//
// 密钥纪律(本域最重要的一条):控制面 bearer token **永不进渲染层**。
// 状态出参只带 `tokenMasked`,而且它的 schema 是结构化掩码(前 4 + `…` + 后 4,
// 或纯掩码 `••••••`)—— 完整 token(`mf_at_` + 43 字符 base64url)在类型层就无法
// 通过校验。"复制令牌" 由主进程写系统剪贴板完成(gateway.automation.copyToken),
// 渲染层拿不到明文,也不会把它写进 DOM、日志或快照。
//
// 路径纪律:`discoveryPath` 一类本机路径不下发;错误 message 不含绝对路径
// (参照 system 域 `pathFreeMessage`)。请求日志里的 `path` 是 HTTP 路由路径
// (`/v1/generate`),不是文件系统路径。

/** 控制面回环地址;主进程只监听回环,渲染层不接受任意 host 输入。 */
export const AUTOMATION_LOOPBACK_HOST = '127.0.0.1';

/**
 * 花钱动作确认的等待上限,与 `@musefold/automation-server` 的
 * `CONFIRMATION_TIMEOUT_MS` 同值。主进程广播的确认摘要不带截止时刻
 * (它只在闸门内部计时),渲染层用「收到时刻 + 本常量」推导倒计时,
 * 到点即视为拒绝并撤卡 —— 与主进程 409 CONFIRMATION_TIMEOUT 同一口径。
 */
export const AUTOMATION_CONFIRMATION_TIMEOUT_MS = 120_000;

/** 月度预算上限(积分)。上界只为防呆(误输入 10 位数),不是产品限额。 */
export const AUTOMATION_MAX_MONTHLY_BUDGET_POINTS = 1_000_000;

/** 「最近调用」两个列表一次最多取多少条(控制面不是审计终端)。 */
export const AUTOMATION_LOG_LIMIT = 50;

/**
 * 令牌掩码的**结构化**形状:`前4…后4` 或纯掩码。
 * 完整 token 长 49 字符且不含 `…`,因此无法通过本 schema —— 掩码不再靠
 * 调用方自觉,而是契约本身的不变量。
 */
export const automationTokenMaskSchema = z
  .string()
  .regex(/^(?:•{6}|[A-Za-z0-9_-]{4}…[A-Za-z0-9_-]{4})$/, '令牌只能以掩码形式下发');

/** 掩码口径承 v2.1 `maskToken`(GitHub 风格):≤8 字符全遮蔽,否则前 4 + … + 后 4。 */
export function maskAutomationToken(token: string): string {
  if (token.length <= 8) return '••••••';
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

/** 记账月份 `YYYY-MM`;跨月由主进程自动清零(承 v2.1 预算存储语义)。 */
export const automationBudgetMonthSchema = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/);

export const automationStatusSchema = z
  .object({
    /** 用户开关(持久化);关闭 = 端口停听 + 发现文件删除。 */
    enabled: z.boolean(),
    /** 端口是否真的在监听(开关刚切换、启动失败时会与 enabled 不一致)。 */
    running: z.boolean(),
    /** 回环 host;固定 127.0.0.1,只为地址行拼装,不作为入参。 */
    host: z.literal(AUTOMATION_LOOPBACK_HOST),
    /** 未监听时为 null。 */
    port: z.number().int().min(1).max(65_535).nullable(),
    apiVersion: z.literal('v1'),
    /** 掩码令牌;无令牌(未运行)为 null。**绝不含完整 token**。 */
    tokenMasked: automationTokenMaskSchema.nullable(),
    /** 月度积分预算;0 = 一切花钱动作逐次确认(v2.1 默认)。 */
    monthlyBudgetPoints: z.number().min(0),
    /** 本月已用积分(按实际成本冲销)。 */
    spentThisMonthPoints: z.number().min(0),
    /** 已用额度的记账月份,用于「本月」readout 的口径说明。 */
    budgetMonth: automationBudgetMonthSchema,
  })
  .strict();

export const setAutomationEnabledInputSchema = z.object({ enabled: z.boolean() }).strict();

/**
 * 月度预算入参:整数积分、非负、有上界。
 * 「空串不落盘 / 非法不落盘 / 负数 clamp 到 0」是渲染层草稿规则
 * (`parseAutomationBudgetDraft`),它保证永远不会把清空输入误当 0 提交。
 */
export const setAutomationBudgetInputSchema = z
  .object({
    points: z.number().int().min(0).max(AUTOMATION_MAX_MONTHLY_BUDGET_POINTS),
  })
  .strict();

export const automationLogQuerySchema = z
  .object({ limit: z.number().int().min(1).max(AUTOMATION_LOG_LIMIT).optional() })
  .strict();

/**
 * 端点级请求日志(内部诊断):`path` 是 HTTP 路由路径,不是文件系统路径,
 * 且由 schema 收窄字符集与长度,避免任何本机路径经此泄漏。
 */
export const automationRequestLogEntrySchema = z
  .object({
    at: isoDateTimeSchema,
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']),
    path: z
      .string()
      .min(1)
      .max(120)
      .regex(/^\/[A-Za-z0-9\-._~/]*$/, '只接受 HTTP 路由路径'),
    status: z.number().int().min(100).max(599),
    durationMs: z.number().int().nonnegative(),
    errorCode: z.string().min(1).max(64).optional(),
  })
  .strict();

export const automationRequestLogSchema = z.array(automationRequestLogEntrySchema);

/** 花钱动作类别(承主进程审计表 `action` 列)。 */
export const automationSpendActionSchema = z.enum([
  'generate_image',
  'run_scheme',
  'run_github_skill',
]);

/** 放行来源:预算内自动放行 / 确认卡 / 终端确认 / 幂等重放 / 拒绝 / 超时。 */
export const automationSpendApprovalSchema = z.enum([
  'budget',
  'confirmation',
  'consent',
  'idempotent-replay',
  'denied',
  'timeout',
]);

export const automationSpendStatusSchema = z.enum([
  'success',
  'failed',
  'cancelled',
  'denied',
  'timeout',
]);

/** 审计行提示词预览的截断长度(全文只留在本机审计表,列表不做完整回显)。 */
export const AUTOMATION_PROMPT_PREVIEW_MAX = 120;

export const automationSpendAuditSchema = z
  .object({
    id: z.number().int().nonnegative(),
    at: isoDateTimeSchema,
    action: automationSpendActionSchema,
    /** 截断后的提示词预览(≤120 字);无提示词的动作为 null。 */
    promptPreview: z.string().max(AUTOMATION_PROMPT_PREVIEW_MAX).nullable(),
    approvedVia: automationSpendApprovalSchema,
    status: automationSpendStatusSchema,
    /** 预估积分;成本未知为 null。 */
    estimatedPoints: z.number().nullable(),
    /** 实际积分;未执行 / 未结算为 null(列表显示「-」)。 */
    actualPoints: z.number().nullable(),
  })
  .strict();

export const automationSpendAuditListSchema = z.array(automationSpendAuditSchema);

/**
 * 花钱动作确认摘要(壳级确认卡的唯一数据源)。
 * 形状与主进程 `ConfirmationSummary` 逐字对齐 —— 生图闸门与方案/Skill 运行
 * 共用同一广播通道,渲染层不做来源区分,也不伪造主进程没有的字段
 * (没有 kind、没有截止时刻;倒计时由 `AUTOMATION_CONFIRMATION_TIMEOUT_MS` 推导)。
 */
export const automationConfirmationSummarySchema = z
  .object({
    confirmationId: z.string().min(1).max(128),
    providerName: z.string().min(1).max(120),
    model: z.string().min(1).max(120),
    n: z.number().int().min(1).max(16),
    estimatedPoints: z.number().nullable(),
    promptPreview: z.string().max(AUTOMATION_PROMPT_PREVIEW_MAX),
  })
  .strict();

export const automationConfirmationOutcomeSchema = z.enum(['approved', 'denied', 'timeout']);

/** 确认被任一通道解决(卡片 / HTTP 回执 / 超时)时的广播载荷;卡片据此撤卡。 */
export const automationConfirmationResolvedSchema = z
  .object({
    confirmationId: z.string().min(1).max(128),
    outcome: automationConfirmationOutcomeSchema,
  })
  .strict();

/** 主进程 → 渲染层的确认事件流(preload `automation:confirmation*` 两个通道的并集)。 */
export const automationConfirmationEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('required'), summary: automationConfirmationSummarySchema }).strict(),
  z
    .object({ type: z.literal('resolved'), resolved: automationConfirmationResolvedSchema })
    .strict(),
]);

export const resolveAutomationConfirmationInputSchema = z
  .object({
    confirmationId: z.string().min(1).max(128),
    approved: z.boolean(),
  })
  .strict();

export const resolveAutomationConfirmationResultSchema = z
  .object({
    /** false = 该确认已被别的通道(HTTP 回执 / 超时)解决,卡片直接撤即可。 */
    handled: z.boolean(),
  })
  .strict();

/**
 * 接入向导片段(「在 Agent 里使用 Musefold」)。
 *
 * 路径口径同 system 域 `storageLocation.displayPath`:片段里的 `command` / `args`
 * 指向随应用分发的可执行文件与内置脚本,**展示它就是这张卡的功能本身**
 * (用户要把它粘进 Agent 的配置文件)。主进程把用户主目录前缀折叠成 `~`,
 * 因此片段里不出现用户名一类个人信息;它只在桌面宿主渲染,不进云端、
 * 不进同步载荷、不进导出文件。片段中**不含任何密钥**——MCP 服务器经发现链自读令牌。
 */
export const automationIntegrationGuideSchema = z
  .object({
    /** 内置 MCP / CLI 产物是否就绪(开发态缺产物时卡内解释,不假装可用)。 */
    bundledReady: z.boolean(),
    /** Cursor `~/.cursor/mcp.json` 片段(JSON 文本)。 */
    mcpConfigJson: z.string().min(1),
    /** Codex / ChatGPT 桌面 `~/.codex/config.toml` 片段。 */
    codexConfigToml: z.string().min(1),
    /** Claude Code 一条 `claude mcp add` 命令。 */
    claudeCommand: z.string().min(1),
    /** 命令行工具安装状态(承旧 CLI 块的三态提示)。 */
    cliInstalled: z.boolean(),
    /** CLI shim 是否在 PATH 上(不在时卡内提示手动加入)。 */
    cliOnPath: z.boolean(),
  })
  .strict();

export type AutomationStatus = z.infer<typeof automationStatusSchema>;
export type SetAutomationEnabledInput = z.infer<typeof setAutomationEnabledInputSchema>;
export type SetAutomationBudgetInput = z.infer<typeof setAutomationBudgetInputSchema>;
export type AutomationLogQuery = z.infer<typeof automationLogQuerySchema>;
export type AutomationRequestLogEntry = z.infer<typeof automationRequestLogEntrySchema>;
export type AutomationSpendAction = z.infer<typeof automationSpendActionSchema>;
export type AutomationSpendApproval = z.infer<typeof automationSpendApprovalSchema>;
export type AutomationSpendStatus = z.infer<typeof automationSpendStatusSchema>;
export type AutomationSpendAudit = z.infer<typeof automationSpendAuditSchema>;
export type AutomationConfirmationSummary = z.infer<typeof automationConfirmationSummarySchema>;
export type AutomationConfirmationOutcome = z.infer<typeof automationConfirmationOutcomeSchema>;
export type AutomationConfirmationResolved = z.infer<typeof automationConfirmationResolvedSchema>;
export type AutomationConfirmationEvent = z.infer<typeof automationConfirmationEventSchema>;
export type ResolveAutomationConfirmationInput = z.infer<
  typeof resolveAutomationConfirmationInputSchema
>;
export type ResolveAutomationConfirmationResult = z.infer<
  typeof resolveAutomationConfirmationResultSchema
>;
export type AutomationIntegrationGuide = z.infer<typeof automationIntegrationGuideSchema>;
