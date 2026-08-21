import type { Dispatch, FormEvent, SetStateAction } from "react";
import {
  ACCOUNT_DEFAULT_IMAGE_MODEL,
  ACCOUNT_DEFAULT_TEXT_MODEL,
} from "@musefold/domain/constants";
import type { AccountNotice, AccountStatus } from "@musefold/desktop-contracts/account";
import type {
  CloudSyncConflictResolution,
  CloudSyncConflictSummary,
  CloudSyncSummary,
} from "@musefold/desktop-contracts/cloud-sync";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { displayModelName } from "../../../lib/model-catalog";
import { cn } from "../../../lib/utils";
import { AccountSummaryPanel } from "@musefold/product-ui";
import { SectionShell, SettingRow } from "../components/SectionShell";
import { healthLabel, points } from "./account-section-helpers";
import { Field, InlineMessage } from "./account-section-ui";
import { AccountCloudSyncPanel } from "./AccountCloudSyncPanel";

export function AccountSignedInPanel({
  status,
  action,
  error,
  notices,
  quotaCny,
  redeemCode,
  setRedeemCode,
  redeemSuccess,
  confirmLogout,
  setConfirmLogout,
  cloudSync,
  cloudConflicts,
  cloudError,
  refreshQuota,
  logout,
  submitRedeem,
  markNoticeRead,
  setCloudEnabled,
  syncCloudNow,
  resolveCloudConflict,
}: {
  status: AccountStatus;
  action: "login" | "register" | "logout" | "redeem" | "refresh" | "server" | null;
  error: { message: string } | null;
  notices: AccountNotice[];
  quotaCny: number | null;
  redeemCode: string;
  setRedeemCode: Dispatch<SetStateAction<string>>;
  redeemSuccess: string | null;
  confirmLogout: boolean;
  setConfirmLogout: Dispatch<SetStateAction<boolean>>;
  cloudSync: CloudSyncSummary | null;
  cloudConflicts: CloudSyncConflictSummary[];
  cloudError: string | null;
  refreshQuota: () => Promise<unknown>;
  logout: () => Promise<unknown>;
  submitRedeem: (event: FormEvent) => Promise<void>;
  markNoticeRead: (id: string) => void;
  setCloudEnabled: (enabled: boolean) => Promise<void>;
  syncCloudNow: () => Promise<void>;
  resolveCloudConflict: (
    conflictId: string,
    resolution: CloudSyncConflictResolution,
  ) => Promise<void>;
}) {
  return (
    <SectionShell
      title="账号"
      description="Agent 与生图模型由账号统一管理。手动添加的 API 配置仍可随时切换。"
      action={
        <span
          className={cn(
            "inline-flex h-7 items-center rounded-full border px-3 text-[11px] font-medium",
            status.health === "ok"
              ? "border-border-default text-secondary"
              : status.health === "token-invalid"
                ? "border-danger/40 text-danger"
                : "border-warning/40 text-warning",
          )}
        >
          {healthLabel(status.health)}
        </span>
      }
    >
      <div data-testid="settings-account-signed-in">
        <AccountSummaryPanel
          testId="settings-account-summary-panel"
          account={{
            name: status.username ?? "Musefold 账户",
            username: status.username ?? "—",
            avatarLabel: (status.username ?? "M").slice(0, 1),
            quotaLabel: status.quota ? points(status.quota.value) : "—",
            quotaHint: status.estImagesRemaining != null
              ? `约可生成 ${status.estImagesRemaining.toLocaleString("zh-CN")} 张${quotaCny != null ? ` · 约 ¥${quotaCny.toFixed(2)}` : ""}`
              : quotaCny != null ? `约 ¥${quotaCny.toFixed(2)}` : null,
            generationStatusLabel: status.health === "ok" ? "可用" : healthLabel(status.health),
            generationAvailable: status.health === "ok",
            dataSourceLabel: status.isDefaultServer ? "Musefold Cloud" : "自定义 new-api",
          }}
          headerAction={(
            <Button
              variant="ghost"
              size="xs"
              className="rounded-full px-3 shadow-none"
              onClick={() => void refreshQuota()}
              disabled={action === "refresh"}
            >
              {action === "refresh" ? "刷新中…" : "刷新余额"}
            </Button>
          )}
        />

        {status.health === "token-invalid" && (
          <div>
            <InlineMessage tone="danger">
              登录状态已失效。重新登录后，现有模型配置会自动恢复。
            </InlineMessage>
            <Button
              variant="outline"
              size="xs"
              className="mt-2 rounded-full px-3 shadow-none"
              onClick={() => void logout()}
            >
              重新登录
            </Button>
          </div>
        )}
        {status.health === "unreachable" && (
          <InlineMessage tone="warning">
            暂时无法连接账号服务器。本地内容不受影响。
          </InlineMessage>
        )}

        <div
          className="border-b border-border-subtle py-6"
          data-testid="account-managed-models"
        >
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
            <div>
              <p className="text-[12px] font-medium text-primary">
                账号内置模型
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-tertiary">
                由 Musefold 固定配置，无需选择或维护模型 ID。
              </p>
            </div>
            <div className="grid min-w-[220px] gap-1.5 text-[10.5px]">
              <p className="flex items-center justify-between gap-4">
                <span className="text-tertiary">生图</span>
                <span className="font-medium text-secondary">
                  {displayModelName(ACCOUNT_DEFAULT_IMAGE_MODEL)}
                </span>
              </p>
              <p className="flex items-center justify-between gap-4">
                <span className="text-tertiary">Agent</span>
                <span className="font-medium text-secondary">
                  {displayModelName(ACCOUNT_DEFAULT_TEXT_MODEL)}
                </span>
              </p>
            </div>
          </div>
        </div>

        <AccountCloudSyncPanel
          cloudSync={cloudSync}
          cloudConflicts={cloudConflicts}
          cloudError={cloudError}
          setCloudEnabled={setCloudEnabled}
          syncCloudNow={syncCloudNow}
          resolveCloudConflict={resolveCloudConflict}
        />

        <form
          className="border-b border-border-subtle py-6"
          onSubmit={submitRedeem}
        >
          <div className="flex items-end gap-2">
            <Field
              label="兑换码"
              htmlFor="account-redeem"
              className="min-w-0 flex-1"
            >
              <Input
                id="account-redeem"
                value={redeemCode}
                onChange={(event) => setRedeemCode(event.target.value)}
                className="h-9 rounded-full px-4 font-mono shadow-none"
                placeholder="输入兑换码"
              />
            </Field>
            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="rounded-full px-5 shadow-none"
              disabled={action === "redeem" || !redeemCode.trim()}
            >
              {action === "redeem" ? "兑换中…" : "兑换"}
            </Button>
          </div>
          {redeemSuccess && (
            <InlineMessage tone="success">{redeemSuccess}</InlineMessage>
          )}
          {error && (
            <InlineMessage tone="danger">{error.message}</InlineMessage>
          )}
          <p className="mt-2 text-[10.5px] text-quaternary">
            兑换码请向管理员获取，兑换后即时到账。
          </p>
        </form>

        {notices.length > 0 && (
          <section
            className="border-b border-border-subtle py-6"
            aria-labelledby="account-notices-title"
          >
            <div className="flex items-center justify-between">
              <h3
                id="account-notices-title"
                className="text-[12px] font-medium text-primary"
              >
                服务公告
              </h3>
              <button
                type="button"
                className="no-drag text-[10px] text-tertiary underline-offset-4 hover:text-primary hover:underline"
                onClick={() =>
                  notices.forEach((notice) => markNoticeRead(notice.id))
                }
              >
                全部已读
              </button>
            </div>
            <div className="mt-3 divide-y divide-border-subtle border-y border-border-subtle">
              {notices.map((notice) => (
                <div
                  key={notice.id}
                  className="py-3 text-[11.5px] leading-relaxed text-secondary"
                >
                  {notice.content}
                </div>
              ))}
            </div>
          </section>
        )}

        <div>
          <SettingRow label={status.username ?? "—"} hint="当前账号">
            <span className="font-mono text-[11px] text-tertiary">
              令牌 ····{status.deviceTokenSuffix ?? "—"}
            </span>
          </SettingRow>
          <SettingRow
            label="账号服务器"
            hint={status.isDefaultServer ? "Musefold Cloud" : "自定义 new-api"}
          >
            <span
              className="block max-w-[300px] truncate font-mono text-[10.5px] text-tertiary"
              title={status.serverUrl}
            >
              {status.serverUrl}
            </span>
          </SettingRow>
          <div className="pt-6">
            {!confirmLogout ? (
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full px-3 text-tertiary shadow-none"
                onClick={() => setConfirmLogout(true)}
              >
                退出登录
              </Button>
            ) : (
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-tertiary">
                <span>将移除本机托管配置；手动服务商不受影响。</span>
                <Button
                  variant="danger"
                  size="xs"
                  className="rounded-full px-3 shadow-none"
                  disabled={action === "logout"}
                  onClick={() => void logout()}
                >
                  确认退出
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  className="rounded-full px-3 shadow-none"
                  onClick={() => setConfirmLogout(false)}
                >
                  取消
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </SectionShell>
  );
}
