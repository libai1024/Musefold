import { z } from 'zod';

// ── 豆包网页登录(桌面专属可选域)────────────────────────────────
// 桌面主进程冻结面 browser-service 的 typed thin adapter 出参契约。
// 形状刻意 path/credential-free:只有登录状态、账号摘要与二维码 data URL,
// 绝不携带会话 cookie、本地路径或分区名;Web 宿主不实现本域。

/** 登录流程状态机(与冻结面 loginState 一一对应)。 */
export const doubaoLoginStateSchema = z.enum([
  'logged-out',
  'loading',
  'qr-ready',
  'scanned',
  'logged-in',
  'verification-required',
  'error',
]);

/** 豆包网页桥接的本地自然日用量。 */
export const doubaoUsageStatusSchema = z
  .object({
    /** 本地自然日(YYYY-MM-DD)。 */
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    limit: z.number().int().nonnegative(),
    used: z.number().int().nonnegative(),
    remaining: z.number().int().nonnegative(),
  })
  .strict();

/**
 * 豆包专用浏览器分区中的只读账号状态。
 * 冻结面 loginState/qr* 字段是可选位;canonical 出参统一归一为必填 + null。
 */
export const doubaoAccountStatusSchema = z
  .object({
    loggedIn: z.boolean(),
    accountName: z.string().max(160).nullable(),
    /** 头像 data URL(主进程已限 2MB 与图片 MIME);未登录或无头像为 null。 */
    avatarDataUrl: z.string().nullable(),
    verificationRequired: z.boolean(),
    usage: doubaoUsageStatusSchema,
    loginState: doubaoLoginStateSchema.default('logged-out'),
    /** 登录二维码 data URL(svg/png base64),仅 qr-ready 态非 null。 */
    qrCodeDataUrl: z.string().nullable().default(null),
    /** 二维码本地过期时间(epoch ms);网页覆盖层才是权威失效信号。 */
    qrExpiresAt: z.number().int().nonnegative().nullable().default(null),
    /** 人话错误(登录流自带文案);无错误为 null。 */
    errorMessage: z.string().max(500).nullable().default(null),
  })
  .strict();

export type DoubaoLoginState = z.infer<typeof doubaoLoginStateSchema>;
export type DoubaoUsageStatus = z.infer<typeof doubaoUsageStatusSchema>;
export type DoubaoAccountStatus = z.infer<typeof doubaoAccountStatusSchema>;
