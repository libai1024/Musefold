// shared/errors.ts
// 统一错误码 → 友好中文文案 + 处理建议
// 主进程 normalizeError 产出这些 code，渲染进程用本表展示。
// 详见 docs/10 §10（悟空）、docs/11 §8（TvT）

import { DOUBAO_WEB_DAILY_IMAGE_LIMIT } from './constants';

/** 生图/连接过程中的归一化错误码 */
export type ErrorCode =
  | 'AUTH' // 401/403 鉴权失败
  | 'NO_BALANCE' // 余额不足 / 配额用尽
  | 'RATE_LIMIT' // 429 频率限制
  | 'DOUBAO_DAILY_LIMIT' // 豆包网页桥接的本地每日硬上限
  | 'SERVER' // 5xx 上游异常
  | 'TIMEOUT' // 请求/轮询超时
  | 'NETWORK' // 网络不可达
  | 'BAD_REQUEST' // 400 参数错误
  | 'NO_PROVIDER' // 未配置服务商
  | 'NO_KEY' // 未配置 API Key
  | 'WRONG_GROUP' // 悟空 Key 不在生图组
  | 'CANCELLED' // 用户取消
  | 'UNKNOWN';

export interface FriendlyError {
  /** 简短标题 */
  title: string;
  /** 处理建议（一句话） */
  hint: string;
}

export const ERROR_MESSAGES: Record<ErrorCode, FriendlyError> = {
  AUTH: {
    title: 'API Key 无效或已失效',
    hint: '请检查密钥是否正确、是否已启用。可在服务商设置里重新测试连接。',
  },
  NO_BALANCE: {
    title: '账户余额不足',
    hint: '当前额度已用尽，请到服务商控制台充值后重试。',
  },
  RATE_LIMIT: {
    title: '请求过于频繁',
    hint: '触发了服务商的频率限制，请稍等片刻再重试。',
  },
  DOUBAO_DAILY_LIMIT: {
    title: '今日豆包生图次数已用完',
    hint: `为降低账号风险，豆包网页接入每天最多提交 ${DOUBAO_WEB_DAILY_IMAGE_LIMIT} 次。请明天再试，或在高级设置中切换其他服务。`,
  },
  SERVER: {
    title: '服务商上游异常',
    hint: '服务端暂时不可用（5xx），通常是上游波动，可稍后重试或更换服务商。',
  },
  TIMEOUT: {
    title: '生成超时',
    hint: '本次任务超过了等待上限。可重试；悟空云任务可凭 task_id 到控制台核对。',
  },
  NETWORK: {
    title: '网络连接失败',
    hint: '无法连接到服务商，请检查网络或代理设置后重试。',
  },
  BAD_REQUEST: {
    title: '请求参数有误',
    hint: '模型名或尺寸/比例可能不受支持，请检查服务商配置。',
  },
  NO_PROVIDER: {
    title: '尚未配置服务商',
    hint: '请先在设置中连接一个生图服务商（默认推荐 TvT）。',
  },
  NO_KEY: {
    title: '尚未配置 API Key',
    hint: '该服务商还没有保存密钥，请在服务商设置里填写并保存。',
  },
  WRONG_GROUP: {
    title: 'Key 分组不正确',
    hint: '悟空云生图必须使用「生图组」分组的 Key，请在控制台确认分组后重试。',
  },
  CANCELLED: {
    title: '已取消生成',
    hint: '本次任务被取消。',
  },
  UNKNOWN: {
    title: '生成失败',
    hint: '发生了未知错误，可重试；如反复失败请查看日志排查。',
  },
};

/** 把任意 code 归一到已知 ErrorCode */
export function toErrorCode(code?: string | null): ErrorCode {
  const c = (code ?? '').toUpperCase();
  if (c in ERROR_MESSAGES) return c as ErrorCode;
  // 兼容产品文档与旧 Provider 可能返回的更长错误名。
  const aliases: Record<string, ErrorCode> = {
    AUTH_FAILED: 'AUTH',
    INSUFFICIENT_BALANCE: 'NO_BALANCE',
    RATE_LIMITED: 'RATE_LIMIT',
    SERVER_ERROR: 'SERVER',
    NETWORK_ERROR: 'NETWORK',
    CONTENT_POLICY: 'BAD_REQUEST',
  };
  if (aliases[c]) return aliases[c];
  return 'UNKNOWN';
}

/** 取友好文案；rawMessage 作为技术细节附加展示 */
export function friendlyError(code?: string | null): FriendlyError {
  return ERROR_MESSAGES[toErrorCode(code)];
}

// ── 可执行下一步（TASK-GEN-03 测试连接 / 生图失败共用）────────────────

/** UI 引导动作类型 */
export type ErrorActionKind =
  | 'update_key' // 打开/聚焦密钥输入
  | 'open_url' // 打开 keyUrl / 说明页 / 充值页
  | 'retry' // 再测一次 / 再生图
  | 'check_model'; // 检查模型或参数

export interface ErrorAction {
  kind: ErrorActionKind;
  /** 按钮文案 */
  label: string;
}

export interface ErrorGuidance extends FriendlyError {
  /** 推荐的下一步动作（按优先级） */
  actions: ErrorAction[];
}

const ACTION_UPDATE_KEY: ErrorAction = { kind: 'update_key', label: '更新密钥' };
const ACTION_OPEN_DOCS: ErrorAction = { kind: 'open_url', label: '查看说明' };
const ACTION_TOP_UP: ErrorAction = { kind: 'open_url', label: '去充值' };
const ACTION_RETRY: ErrorAction = { kind: 'retry', label: '重试' };
const ACTION_CHECK_MODEL: ErrorAction = { kind: 'check_model', label: '检查模型' };

/** 按错误码给出标题 + 建议 + 可执行动作 */
export function errorGuidance(code?: string | null): ErrorGuidance {
  const c = toErrorCode(code);
  const base = ERROR_MESSAGES[c];
  switch (c) {
    case 'AUTH':
      return { ...base, actions: [ACTION_UPDATE_KEY] };
    case 'WRONG_GROUP':
      return {
        title: 'Key 需属于「生图组」',
        hint: '悟空云生图必须使用「生图组」分组的 Key，请到控制台确认分组或更换 Key。',
        actions: [ACTION_OPEN_DOCS, ACTION_UPDATE_KEY],
      };
    case 'NO_BALANCE':
      return { ...base, actions: [ACTION_TOP_UP] };
    case 'RATE_LIMIT':
      return { ...base, actions: [ACTION_RETRY] };
    case 'DOUBAO_DAILY_LIMIT':
      return { ...base, actions: [] };
    case 'SERVER':
    case 'TIMEOUT':
    case 'NETWORK':
      return { ...base, actions: [ACTION_RETRY] };
    case 'BAD_REQUEST':
      return { ...base, actions: [ACTION_CHECK_MODEL] };
    case 'NO_KEY':
      return { ...base, actions: [ACTION_UPDATE_KEY] };
    case 'NO_PROVIDER':
      return { ...base, actions: [] };
    case 'CANCELLED':
      return { ...base, actions: [] };
    default:
      return { ...base, actions: [ACTION_RETRY] };
  }
}

/** 把 ValidationResult / 生图失败统一成可读标题；优先用 code 映射，message 作细节 */
export function formatValidationMessage(
  result: { ok: boolean; message?: string; code?: string },
): { title: string; detail?: string; code?: string } {
  if (result.ok) {
    return { title: result.message || '连接成功' };
  }
  const g = errorGuidance(result.code);
  const detail = result.message?.trim();
  // 若主进程 message 已是友好中文且与 title 不同，作为细节保留
  const showDetail =
    detail &&
    detail !== g.title &&
    !detail.startsWith(g.title) &&
    detail.length > 0
      ? detail
      : undefined;
  return { title: g.title, detail: showDetail ?? (detail && detail !== g.title ? detail : undefined), code: result.code };
}
