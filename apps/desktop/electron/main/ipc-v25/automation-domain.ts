// v2.5 桌面「开放能力 / 本地控制面」域桥:设置「开放能力」三张卡 + 壳级花钱确认卡的主进程侧。
//
// 语义全部复用 v2.1 保留的服务函数(main/automation.ts、settings/automation.ts、main/integration.ts):
// 本域只做四件事:
//   1. 出参裁剪成 secret-free / path-free 契约形状(令牌只出掩码,发现文件路径不下发);
//   2. 入参按契约收窄(开关是 boolean、预算是有界整数、确认回执只收 id + 判定);
//   3. 「复制令牌」在主进程用 electron clipboard 完成 —— 渲染层从头到尾拿不到明文 bearer;
//   4. 服务函数的异常翻译成稳定 BridgeError,message 不含绝对路径。
//
// 预算存储不另起一份:读写都走 `electron/settings/automation.ts` 的
// `getAutomationBudget()` / `setAutomationBudgetLimit()`(与生图闸门 `remainingAutomationBudgetPoints`
// 同一 electron-store 命名空间),否则闸门与 UI 会看到两份预算。
//
// 确认事件不进本方法表:主进程既有的 `broadcastToWindows('automation:confirmation*')` 广播
// 经 preload `onAutomationEvent` 到渲染层(与 designSchemes:event 同构的事件接缝)。

import {
  AUTOMATION_LOG_LIMIT,
  AUTOMATION_LOOPBACK_HOST,
  AUTOMATION_PROMPT_PREVIEW_MAX,
  automationIntegrationGuideSchema,
  automationLogQuerySchema,
  automationRequestLogEntrySchema,
  automationRequestLogSchema,
  automationSpendAuditListSchema,
  automationSpendAuditSchema,
  automationStatusSchema,
  maskAutomationToken,
  resolveAutomationConfirmationInputSchema,
  resolveAutomationConfirmationResultSchema,
  setAutomationBudgetInputSchema,
  setAutomationEnabledInputSchema,
} from '@musefold/contracts';
import { clipboard } from 'electron';
import { homedir } from 'node:os';
import { z } from 'zod';
import {
  getAutomationStatus,
  listAutomationAudit,
  listAutomationRequestLog,
  resolveAutomationConfirmation,
  rotateAutomationToken,
  setAutomationEnabledAndApply,
} from '../automation';
import { getIntegrationInfo } from '../integration';
import { getAutomationBudget, setAutomationBudgetLimit } from '../../settings/automation';
import { BridgeError, type MethodDef } from './envelope';

const noInput = z.undefined().or(z.object({}).strict());
const logQueryInput = z.undefined().or(automationLogQuerySchema);

/** 带路径(或异常冗长)的底层 message 一律换成静态文案(同 system 域口径)。 */
function pathFreeMessage(message: string, fallback: string): string {
  const text = message.trim();
  if (!text || text.length > 160 || /[/\\]/.test(text)) return fallback;
  return text;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : '';
}

/**
 * 审计/日志时间统一成带偏移的 ISO(与 system 域备份时间同口径)。
 * 坏时间戳原样返回:出参 schema 会拒掉那一行,整张卡不受影响。
 */
function toIso(value: number | string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().replace(/Z$/, '+00:00');
}

function truncatePrompt(text: string | null): string | null {
  if (text == null) return null;
  return text.length > AUTOMATION_PROMPT_PREVIEW_MAX
    ? text.slice(0, AUTOMATION_PROMPT_PREVIEW_MAX)
    : text;
}

/**
 * 请求日志的 `path` 是 HTTP 路由路径。清掉查询串(可能带调用方塞的参数)、
 * 把契约字符集外的字符折成 `_`、截断到上限 —— 日志面不承担把任意串原样回显的义务。
 */
function sanitizeRoutePath(path: string): string {
  const withoutQuery = path.split(/[?#]/)[0] ?? '';
  const normalized = (withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`)
    .replace(/[^A-Za-z0-9\-._~/]/g, '_')
    .slice(0, 120);
  return normalized;
}

/**
 * 向导片段里的路径口径 = system 域 `displayPath`:展示它就是这张卡的功能
 * (用户要粘进 Agent 配置)。用户主目录前缀折成 `~`,片段里不出现用户名。
 */
function foldHomePath(text: string): string {
  const home = homedir();
  if (!home || home === '/') return text;
  return text.split(home).join('~');
}

function limitOf(query: unknown): number {
  const parsed = logQueryInput.safeParse(query);
  const limit = parsed.success ? parsed.data?.limit : undefined;
  return limit ?? AUTOMATION_LOG_LIMIT;
}

/** 开关 / 端口 / 掩码令牌 / 预算与本月已用:一次读齐,控制面卡只订阅这一条。 */
function readStatus() {
  const status = getAutomationStatus();
  const budget = getAutomationBudget();
  return automationStatusSchema.parse({
    enabled: status.enabled,
    running: status.running,
    host: AUTOMATION_LOOPBACK_HOST,
    port: status.port,
    apiVersion: status.apiVersion,
    // 明文 token 到此为止:出参只有掩码,契约的 mask 正则再兜一层。
    tokenMasked: status.token ? maskAutomationToken(status.token) : null,
    monthlyBudgetPoints: Math.max(0, budget.monthlyLimitPoints),
    spentThisMonthPoints: Math.max(0, budget.usedPoints),
    budgetMonth: budget.month,
  });
}

export function buildAutomationDomainMethods(): Record<string, MethodDef> {
  return {
    'automation.getStatus': {
      input: noInput,
      handle: async () => readStatus(),
    },
    'automation.setEnabled': {
      input: setAutomationEnabledInputSchema,
      handle: async (payload) => {
        const { enabled } = payload as z.infer<typeof setAutomationEnabledInputSchema>;
        try {
          await setAutomationEnabledAndApply(enabled);
        } catch (error) {
          throw new BridgeError(
            'AUTOMATION_TOGGLE_FAILED',
            pathFreeMessage(
              messageOf(error),
              enabled ? '启动本地控制面失败,请稍后重试' : '停止本地控制面失败,请稍后重试',
            ),
          );
        }
        return readStatus();
      },
    },
    'automation.rotateToken': {
      input: noInput,
      handle: async () => {
        try {
          rotateAutomationToken();
        } catch (error) {
          throw new BridgeError(
            'AUTOMATION_NOT_RUNNING',
            pathFreeMessage(messageOf(error), '本地控制面未在运行,无法轮换令牌'),
          );
        }
        return readStatus();
      },
    },
    'automation.copyToken': {
      input: noInput,
      handle: async () => {
        // 令牌只在主进程内存里流转一次:读出来直接进系统剪贴板,不回渲染层、不写日志。
        const token = getAutomationStatus().token;
        if (!token) {
          throw new BridgeError('TOKEN_UNAVAILABLE', '本地控制面未在运行,暂无可复制的令牌');
        }
        clipboard.writeText(token);
        return null;
      },
    },
    'automation.setMonthlyBudget': {
      input: setAutomationBudgetInputSchema,
      handle: async (payload) => {
        const { points } = payload as z.infer<typeof setAutomationBudgetInputSchema>;
        // 复用既有预算存储(与生图闸门 remainingAutomationBudgetPoints 同一事实源)。
        await setAutomationBudgetLimit(points);
        return readStatus();
      },
    },
    'automation.listRequestLog': {
      input: logQueryInput,
      handle: async (payload) => {
        const rows = listAutomationRequestLog(limitOf(payload)).map((entry) => ({
          at: toIso(entry.at),
          method: entry.method.toUpperCase(),
          path: sanitizeRoutePath(entry.path),
          status: entry.status,
          durationMs: Math.max(0, Math.round(entry.durationMs)),
          ...(entry.errorCode ? { errorCode: entry.errorCode.slice(0, 64) } : {}),
        }));
        // 形状异常的历史条目丢弃而不是让整张卡崩(同 system 域备份列表口径)。
        return automationRequestLogSchema.parse(
          rows.filter((row) => automationRequestLogEntrySchema.safeParse(row).success),
        );
      },
    },
    'automation.listSpendAudit': {
      input: logQueryInput,
      handle: async (payload) => {
        const rows = listAutomationAudit(limitOf(payload)).map((entry) => ({
          id: entry.id,
          at: toIso(entry.at),
          action: entry.action,
          promptPreview: truncatePrompt(entry.promptText),
          approvedVia: entry.approvedVia,
          status: entry.status,
          estimatedPoints: entry.estimatedPoints,
          actualPoints: entry.actualPoints,
        }));
        return automationSpendAuditListSchema.parse(
          rows.filter((row) => automationSpendAuditSchema.safeParse(row).success),
        );
      },
    },
    'automation.resolveConfirmation': {
      input: resolveAutomationConfirmationInputSchema,
      handle: async (payload) => {
        const { confirmationId, approved } = payload as z.infer<
          typeof resolveAutomationConfirmationInputSchema
        >;
        // handled=false = 该确认已被 HTTP 回执或超时解决;卡片直接撤,不报错。
        const handled = resolveAutomationConfirmation(confirmationId, approved);
        return resolveAutomationConfirmationResultSchema.parse({ handled });
      },
    },
    'automation.getIntegrationGuide': {
      input: noInput,
      handle: async () => {
        try {
          const info = getIntegrationInfo();
          return automationIntegrationGuideSchema.parse({
            bundledReady: info.bundledReady,
            mcpConfigJson: foldHomePath(info.snippets.cursorJson),
            codexConfigToml: foldHomePath(info.snippets.codexToml),
            claudeCommand: foldHomePath(info.snippets.claudeCommand),
            cliInstalled: info.cli.installed,
            cliOnPath: info.cli.onPath,
          });
        } catch {
          // 内置产物缺失(开发态未构建 CLI/MCP)时结构化失败,卡内解释 + 重试,不伪造片段。
          throw new BridgeError(
            'INTEGRATION_UNAVAILABLE',
            '接入信息暂不可用,请检查应用安装文件是否完整',
          );
        }
      },
    },
  };
}
