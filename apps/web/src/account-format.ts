import { ACCOUNT_QUOTA_PER_POINT } from "@shared/constants";

/** Match Desktop: new-api quota points are displayed as user-facing points. */
export function formatAccountPoints(quota: number): string {
  return (quota / ACCOUNT_QUOTA_PER_POINT).toLocaleString("zh-CN", {
    maximumFractionDigits: 2,
  });
}
