// shared/types/account.ts
// v0.5 账号与云通道 —— 渲染进程可见的账号状态与错误码契约。
// 凭据红线（V05-ARCHITECTURE §4）：本文件的任何类型都不携带密码 / JWT / refresh / sk- 明文；
// 渲染层能看到的最敏感信息是令牌末 4 位后缀。

export type AccountHealth = 'ok' | 'token-invalid' | 'unreachable' | 'unknown';

/** 服务器公告（FR-SET-05）；已读记忆在渲染层 localStorage，主进程只透传。 */
export interface AccountNotice {
  /** 内容哈希派生的稳定 id，用于已读判定 */
  id: string;
  content: string;
  publishedAt: number | null;
}

/** `window.api.account.*` 与 `account:changed` 广播的统一载荷。 */
export interface AccountStatus {
  loggedIn: boolean;
  username: string | null;
  serverUrl: string;
  isDefaultServer: boolean;
  /** 余额缓存（单位：点；500000 点 = $1）+ 采样时间戳 */
  quota: { value: number; at: number } | null;
  /** 约可生成张数 = quota ÷ 当前生图单价点数（无定价数据时为 null，FR-COST-01） */
  estImagesRemaining: number | null;
  /** 本设备令牌末 4 位（未供给时 null） */
  deviceTokenSuffix: string | null;
  health: AccountHealth;
  notices: AccountNotice[];
}

export interface AccountCredentialsInput {
  username: string;
  password: string;
}

export interface AccountRedeemResult {
  /** 到账点数 */
  quotaAdded: number;
  status: AccountStatus;
}

/**
 * 账号错误码域（V05-ARCHITECTURE §8）。
 * 主进程统一抛 `AccountError`，渲染层按 code 走产品文档 §5 的错误闭环文案。
 */
export const ACCOUNT_ERROR_CODES = [
  /** 登录/注册凭据错误（含 2FA 账号引导网页的变体文案） */
  'ACCOUNT/CREDENTIALS',
  /** 注册用户名已被占用 */
  'ACCOUNT/CONFLICT',
  /** 兑换失败（服务器防枚举，不区分无效/已用/空码） */
  'ACCOUNT/REDEEM_INVALID',
  /** 管理凭据失效（refresh 过期/被吊销）或调用面令牌失效 → 重新登录 */
  'ACCOUNT/AUTH',
  /** 账号余额不足（/v1 403 insufficient_user_quota） */
  'ACCOUNT/QUOTA',
  /** 服务器不可达 / 超时 */
  'ACCOUNT/NETWORK',
  /** 服务器 5xx 或响应不可解析 */
  'ACCOUNT/SERVER',
  /** 对账号托管记录执行被禁写操作 */
  'ACCOUNT/MANAGED_READONLY',
  /** 模型不可用（服务器改名/下线，/v1 503 model_not_found，FR-ERR-05） */
  'ACCOUNT/MODEL_NOT_FOUND',
] as const;

export type AccountErrorCode = (typeof ACCOUNT_ERROR_CODES)[number];

/** 登录编排失败时的阶段标签（NFR-REL-02：整体回滚后供 UI 展示失败位置） */
export type AccountLoginStage = 'auth' | 'token' | 'provision';

export interface AccountErrorPayload {
  code: AccountErrorCode;
  message: string;
  stage?: AccountLoginStage;
}
