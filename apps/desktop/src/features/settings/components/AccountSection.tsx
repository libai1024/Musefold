// 设置 → 账号（v0.5，CODEX 极简风）
// 纯边线 + 留白 + 排版承重；无阴影/渐变/装饰插图；所有动作 pill 几何。

import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { ACCOUNT_QUOTA_PER_USD } from "@musefold/contracts/billing.js";
import type {
  CloudSyncConflictResolution,
  CloudSyncConflictSummary,
  CloudSyncSummary,
} from "@musefold/desktop-contracts/cloud-sync";
import {
  getAccountDesktopExtras,
  useAccountStore,
} from "@renderer/runtime/account-access";
import { useSettingsStore } from "../store";
import {
  type AuthMode,
  NOTICE_READ_KEY,
  initialReadNotices,
  points,
} from "./account-section-helpers";
import { AccountSignedInPanel } from "./AccountSignedInPanel";
import { AccountSignedOutForm } from "./AccountSignedOutForm";

export function AccountSection() {
  const status = useAccountStore((s) => s.status);
  const action = useAccountStore((s) => s.action);
  const error = useAccountStore((s) => s.error);
  const lastUsername = useAccountStore((s) => s.lastUsername);
  const login = useAccountStore((s) => s.login);
  const register = useAccountStore((s) => s.register);
  const logout = useAccountStore((s) => s.logout);
  const redeem = useAccountStore((s) => s.redeem);
  const refreshQuota = useAccountStore((s) => s.refreshQuota);
  const setServerUrl = useAccountStore((s) => s.setServerUrl);
  const clearError = useAccountStore((s) => s.clearError);
  const accountSetupRequest = useSettingsStore((s) => s.accountSetupRequest);
  const consumeAccountSetup = useSettingsStore((s) => s.consumeAccountSetup);

  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [redeemCode, setRedeemCode] = useState("");
  const [redeemSuccess, setRedeemSuccess] = useState<string | null>(null);
  const [serverEditing, setServerEditing] = useState(false);
  const [serverUrl, setServerUrlInput] = useState(status.serverUrl);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [readNoticeIds, setReadNoticeIds] =
    useState<string[]>(initialReadNotices);
  const [cloudSync, setCloudSync] = useState<CloudSyncSummary | null>(null);
  const [cloudConflicts, setCloudConflicts] = useState<
    CloudSyncConflictSummary[]
  >([]);
  const [cloudError, setCloudError] = useState<string | null>(null);

  const isAuthBusy = action === "login" || action === "register";
  // $1 按 ¥1 计费（积分 = 人民币 × 10），换算系数与美元锚定一致。
  const quotaCny = status.quota
    ? status.quota.value / ACCOUNT_QUOTA_PER_USD
    : null;
  const notices = useMemo(
    () =>
      status.notices
        .filter((notice) => !readNoticeIds.includes(notice.id))
        .slice(0, 5),
    [readNoticeIds, status.notices],
  );

  useEffect(() => {
    if (status.loggedIn) void refreshQuota().catch(() => {});
    // 只在进入已登录态时刷新；余额变化由 account:changed 事件回填，避免循环请求。
  }, [refreshQuota, status.loggedIn]);

  // 登出 / 登录失效后回到表单时预填上次的用户名，重新登录只需输密码。
  useEffect(() => {
    if (!status.loggedIn && lastUsername)
      setUsername((current) => current || lastUsername);
  }, [lastUsername, status.loggedIn]);

  useEffect(() => {
    if (!accountSetupRequest) return;
    if (status.loggedIn) {
      consumeAccountSetup(accountSetupRequest.requestId);
      return;
    }
    setMode(accountSetupRequest.mode);
    clearError();
    const requestId = accountSetupRequest.requestId;
    requestAnimationFrame(() => {
      document.getElementById("account-username")?.focus();
      consumeAccountSetup(requestId);
    });
  }, [accountSetupRequest, clearError, consumeAccountSetup, status.loggedIn]);

  // 云同步走 DesktopExtras（与 account store 共用注入点），不直连 preload 的 cloudSync 面。
  useEffect(() => {
    if (!status.loggedIn) {
      setCloudSync(null);
      setCloudConflicts([]);
      return;
    }
    let active = true;
    const extras = getAccountDesktopExtras();
    const load = async () => {
      try {
        const next = await extras.cloudSyncStatus();
        if (!active) return;
        setCloudSync(next);
        if (next.conflicts > 0)
          setCloudConflicts(await extras.cloudSyncConflicts());
      } catch (cause) {
        if (active)
          setCloudError(
            cause instanceof Error ? cause.message : "无法读取云同步状态",
          );
      }
    };
    void load();
    const unsubscribe = extras.onCloudSyncChanged((next) => {
      if (!active) return;
      setCloudSync(next);
      if (next.conflicts === 0) setCloudConflicts([]);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [status.loggedIn]);

  const setCloudEnabled = async (enabled: boolean) => {
    setCloudError(null);
    try {
      const extras = getAccountDesktopExtras();
      const next = await extras.cloudSyncSetEnabled(enabled);
      setCloudSync(next);
      if (next.conflicts > 0)
        setCloudConflicts(await extras.cloudSyncConflicts());
    } catch (cause) {
      setCloudError(cause instanceof Error ? cause.message : "云同步操作失败");
    }
  };

  const syncCloudNow = async () => {
    setCloudError(null);
    try {
      const extras = getAccountDesktopExtras();
      const next = await extras.cloudSyncNow();
      setCloudSync(next);
      setCloudConflicts(
        next.conflicts > 0 ? await extras.cloudSyncConflicts() : [],
      );
    } catch (cause) {
      setCloudError(cause instanceof Error ? cause.message : "云同步失败");
    }
  };

  const resolveCloudConflict = async (
    conflictId: string,
    resolution: CloudSyncConflictResolution,
  ) => {
    setCloudError(null);
    try {
      const extras = getAccountDesktopExtras();
      const next = await extras.cloudSyncResolve(conflictId, resolution);
      setCloudSync(next);
      setCloudConflicts(
        next.conflicts > 0 ? await extras.cloudSyncConflicts() : [],
      );
    } catch (cause) {
      setCloudError(cause instanceof Error ? cause.message : "冲突处理失败");
    }
  };
  const markNoticeRead = (id: string) => {
    setReadNoticeIds((current) => {
      const next = [...new Set([...current, id])].slice(-100);
      try {
        localStorage.setItem(NOTICE_READ_KEY, JSON.stringify(next));
      } catch {
        /* 已读记忆是增强项，不阻塞界面 */
      }
      return next;
    });
  };

  const submitAuth = async (event: FormEvent) => {
    event.preventDefault();
    clearError();
    if (mode === "register" && password !== confirmPassword) return;
    try {
      if (mode === "register") await register({ username, password });
      else await login({ username, password });
      setPassword("");
      setConfirmPassword("");
    } catch {
      setPassword("");
      setConfirmPassword("");
    }
  };

  const submitRedeem = async (event: FormEvent) => {
    event.preventDefault();
    setRedeemSuccess(null);
    try {
      const result = await redeem(redeemCode);
      setRedeemSuccess(
        `+${points(result.quotaAdded)}已到账，调用额度将在一分钟内生效`,
      );
      setRedeemCode("");
    } catch {
      // store.error 负责行内呈现
    }
  };

  if (!status.loggedIn) {
    return (
      <AccountSignedOutForm
        mode={mode}
        setMode={setMode}
        username={username}
        setUsername={setUsername}
        password={password}
        setPassword={setPassword}
        confirmPassword={confirmPassword}
        setConfirmPassword={setConfirmPassword}
        error={error}
        isAuthBusy={isAuthBusy}
        action={action}
        status={status}
        serverEditing={serverEditing}
        setServerEditing={setServerEditing}
        serverUrl={serverUrl}
        setServerUrlInput={setServerUrlInput}
        clearError={clearError}
        submitAuth={submitAuth}
        setServerUrl={setServerUrl}
      />
    );
  }

  return (
    <AccountSignedInPanel
      status={status}
      action={action}
      error={error}
      notices={notices}
      quotaCny={quotaCny}
      redeemCode={redeemCode}
      setRedeemCode={setRedeemCode}
      redeemSuccess={redeemSuccess}
      confirmLogout={confirmLogout}
      setConfirmLogout={setConfirmLogout}
      cloudSync={cloudSync}
      cloudConflicts={cloudConflicts}
      cloudError={cloudError}
      refreshQuota={refreshQuota}
      logout={logout}
      submitRedeem={submitRedeem}
      markNoticeRead={markNoticeRead}
      setCloudEnabled={setCloudEnabled}
      syncCloudNow={syncCloudNow}
      resolveCloudConflict={resolveCloudConflict}
    />
  );
}
