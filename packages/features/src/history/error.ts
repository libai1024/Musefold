import type { GenerationJob } from '@musefold/contracts';
import { isActiveStatus } from './format';

/**
 * 生成失败的展示与重试策略(承旧 features/history/error.ts + domain/errors.ts)。
 *
 * 旧版把「错误码 → 标题 + 建议 + 可执行动作」收在一张表里,并只在表里明确给出
 * retry 动作时才放开手动重试。v2.5 的错误码事实源是契约 apiErrorCodeSchema;
 * 旧宿主可能回的自由错误码(AUTH / NO_KEY / PROVIDER_REJECTED…)经别名表归一,
 * 归一不到的走 UNKNOWN 兜底 —— 此时用原始 message 当标题,不吞诊断线索。
 */

/** 建议动作的语义类别:调用方据此决定是否给可点入口(当前只做文案)。 */
export type HistoryErrorActionKind =
  | 'retry'
  | 'check_key'
  | 'check_params'
  | 'top_up'
  | 'sign_in'
  | 'setup_provider'
  | 'none';

export interface HistoryErrorGuidance {
  title: string;
  hint: string;
  /** 建议动作文案(如「检查密钥」);无可执行建议时为 null。 */
  action: string | null;
  actionKind: HistoryErrorActionKind;
  /** 只有明确可重试的错误码才放开手动重试(承旧 canRetry)。 */
  canRetry: boolean;
}

const RETRY_LATER = { action: '稍后重试', actionKind: 'retry', canRetry: true } as const;
const CHECK_KEY = { action: '检查密钥', actionKind: 'check_key', canRetry: false } as const;
const CHECK_PARAMS = { action: '检查参数', actionKind: 'check_params', canRetry: false } as const;
const NO_ACTION = { action: null, actionKind: 'none', canRetry: false } as const;

/** 归一后的错误码目录;UNKNOWN 是兜底键,始终存在。 */
export const HISTORY_ERROR_GUIDANCE: Record<string, HistoryErrorGuidance> = {
  AUTH_REQUIRED: {
    title: '登录状态已失效',
    hint: '云端生图需要有效会话,请重新登录后再试。',
    action: '重新登录',
    actionKind: 'sign_in',
    canRetry: false,
  },
  AUTH_SESSION_EXPIRED: {
    title: '会话已过期',
    hint: '登录状态超时,请重新登录后再试。',
    action: '重新登录',
    actionKind: 'sign_in',
    canRetry: false,
  },
  AUTH_CREDENTIALS_INVALID: {
    title: 'API Key 无效或已失效',
    hint: '请确认密钥正确且已启用,可在连接设置里重新测试。',
    ...CHECK_KEY,
  },
  ACCOUNT_QUOTA_INSUFFICIENT: {
    title: '账户额度不足',
    hint: '当前额度已用尽,充值或兑换后可继续生成。',
    action: '去兑换',
    actionKind: 'top_up',
    canRetry: false,
  },
  MCP_BUDGET_EXCEEDED: {
    title: '本次预算已用尽',
    hint: '调用方声明的预算不足以支付这次生成,提高预算后重新发起。',
    ...NO_ACTION,
  },
  RATE_LIMITED: {
    title: '请求过于频繁',
    hint: '触发了上游频率限制,稍等片刻再重试。',
    ...RETRY_LATER,
  },
  GENERATION_UPSTREAM_REJECTED: {
    title: '上游拒绝了这次生成',
    hint: '提示词或参数可能不被支持,调整后可重试。',
    action: '检查参数',
    actionKind: 'check_params',
    canRetry: true,
  },
  GENERATION_UPSTREAM_UNKNOWN: {
    title: '上游结果未知',
    hint: '请求可能已发出并计费,不会自动重试;请先核对账单再决定。',
    ...NO_ACTION,
  },
  GENERATION_STORAGE_FAILED: {
    title: '图片保存失败',
    hint: '结果已产出但落盘/上传失败,可稍后重试。',
    ...RETRY_LATER,
  },
  GENERATION_APPROVAL_REQUIRED: {
    title: '需要先批准',
    hint: '这次生成等待批准后才会进入队列。',
    ...NO_ACTION,
  },
  GENERATION_APPROVAL_EXPIRED: {
    title: '批准已过期',
    hint: '审批窗口已关闭,请重新发起生成。',
    ...NO_ACTION,
  },
  GENERATION_ALREADY_TERMINAL: {
    title: '任务已经结束',
    hint: '这条记录已是终态,无需再取消。',
    ...NO_ACTION,
  },
  GENERATION_NOT_FOUND: {
    title: '生成记录不存在',
    hint: '记录可能已被永久删除,刷新列表后再试。',
    ...NO_ACTION,
  },
  GENERATION_IDEMPOTENCY_CONFLICT: {
    title: '重复提交被拦下',
    hint: '同一请求已在处理中,等待它结束即可。',
    ...NO_ACTION,
  },
  VALIDATION_FAILED: {
    title: '请求参数有误',
    hint: '模型名或尺寸/比例可能不受支持,检查连接配置后重新发起。',
    ...CHECK_PARAMS,
  },
  NO_PROVIDER: {
    title: '尚未配置生图连接',
    hint: '请先在设置里连接一个生图服务再发起生成。',
    action: '去设置连接',
    actionKind: 'setup_provider',
    canRetry: false,
  },
  NO_KEY: {
    title: '尚未配置 API Key',
    hint: '该连接还没有保存密钥,请在连接设置里填写并保存。',
    ...CHECK_KEY,
  },
  TIMEOUT: {
    title: '生成超时',
    hint: '本次任务超过等待上限,可稍后重试。',
    ...RETRY_LATER,
  },
  NETWORK: {
    title: '网络连接失败',
    hint: '无法连接到服务,请检查网络或代理设置后重试。',
    ...RETRY_LATER,
  },
  CANCELLED: {
    title: '已取消生成',
    hint: '本次任务被取消,可以重新发起。',
    ...RETRY_LATER,
  },
  INTERNAL_ERROR: {
    title: '服务暂时不可用',
    hint: '通常是上游波动,可稍后重试。',
    ...RETRY_LATER,
  },
  UNKNOWN: {
    title: '生成失败',
    hint: '发生了未知错误,可以重试;反复失败请查看日志排查。',
    ...RETRY_LATER,
  },
};

/** 旧宿主/Provider 自由错误码 → 目录键(承旧 toErrorCode 的别名表)。 */
const CODE_ALIASES: Record<string, string> = {
  AUTH: 'AUTH_CREDENTIALS_INVALID',
  AUTH_FAILED: 'AUTH_CREDENTIALS_INVALID',
  UNAUTHORIZED: 'AUTH_CREDENTIALS_INVALID',
  NO_BALANCE: 'ACCOUNT_QUOTA_INSUFFICIENT',
  INSUFFICIENT_BALANCE: 'ACCOUNT_QUOTA_INSUFFICIENT',
  QUOTA_EXCEEDED: 'ACCOUNT_QUOTA_INSUFFICIENT',
  RATE_LIMIT: 'RATE_LIMITED',
  SERVER: 'INTERNAL_ERROR',
  SERVER_ERROR: 'INTERNAL_ERROR',
  NETWORK_ERROR: 'NETWORK',
  BAD_REQUEST: 'VALIDATION_FAILED',
  CONTENT_POLICY: 'VALIDATION_FAILED',
  PROVIDER_REJECTED: 'GENERATION_UPSTREAM_REJECTED',
  DOUBAO_DAILY_LIMIT: 'RATE_LIMITED',
};

/** 把任意错误码归一到目录键;归一不到返回 'UNKNOWN'。 */
export function normalizeHistoryErrorCode(code?: string | null): string {
  const upper = (code ?? '').trim().toUpperCase();
  if (Object.hasOwn(HISTORY_ERROR_GUIDANCE, upper)) return upper;
  const alias = CODE_ALIASES[upper];
  return alias && Object.hasOwn(HISTORY_ERROR_GUIDANCE, alias) ? alias : 'UNKNOWN';
}

/**
 * 失败记录的展示口径:归一码取目录项;UNKNOWN 且有原始 message 时用 message 当标题
 * (承旧 displayTitle —— 未知错误的诊断线索比通用标题更有用)。
 */
export function historyErrorPresentation(
  error: GenerationJob['error'],
): HistoryErrorGuidance | null {
  if (!error) return null;
  const key = normalizeHistoryErrorCode(error.code);
  const entry = HISTORY_ERROR_GUIDANCE[key] as HistoryErrorGuidance;
  const raw = error.message?.trim();
  return key === 'UNKNOWN' && raw ? { ...entry, title: raw } : entry;
}

/**
 * 手动重试是否可用:进行中不可,成功/拒绝/过期不可(宿主 retry 只收 failed | cancelled),
 * 取消一律可重试;失败按错误码目录的 canRetry 判定(承旧 showRetry)。
 */
export function canRetryGeneration(job: GenerationJob): boolean {
  if (isActiveStatus(job.status)) return false;
  if (job.status === 'cancelled') return true;
  if (job.status !== 'failed') return false;
  return historyErrorPresentation(job.error)?.canRetry ?? true;
}
