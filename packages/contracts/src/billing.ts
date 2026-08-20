/** 服务器计费换算：500000 quota = $1（new-api QuotaPerUnit） */
export const ACCOUNT_QUOTA_PER_USD = 500000;
/**
 * 用户侧显示单位「积分」：$1 按 ¥1 计费，¥1 = 10 积分。
 * 即 1 积分 = ¥0.1 = 50000 quota。展示层统一 quota ÷ 该常量。
 */
export const ACCOUNT_QUOTA_PER_POINT = ACCOUNT_QUOTA_PER_USD / 10;
