import type { Dispatch, FormEvent, SetStateAction } from "react";
import type { AccountStatus } from "@musefold/desktop-contracts/account";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { cn } from "../../../lib/utils";
import { SectionShell } from "../components/SectionShell";
import type { AuthMode } from "./account-section-helpers";
import { Field, InlineMessage } from "./account-section-ui";

export function AccountSignedOutForm({
  mode,
  setMode,
  username,
  setUsername,
  password,
  setPassword,
  confirmPassword,
  setConfirmPassword,
  error,
  isAuthBusy,
  action,
  status,
  serverEditing,
  setServerEditing,
  serverUrl,
  setServerUrlInput,
  clearError,
  submitAuth,
  setServerUrl,
}: {
  mode: AuthMode;
  setMode: Dispatch<SetStateAction<AuthMode>>;
  username: string;
  setUsername: Dispatch<SetStateAction<string>>;
  password: string;
  setPassword: Dispatch<SetStateAction<string>>;
  confirmPassword: string;
  setConfirmPassword: Dispatch<SetStateAction<string>>;
  error: { message: string } | null;
  isAuthBusy: boolean;
  action: "login" | "register" | "logout" | "redeem" | "refresh" | "server" | null;
  status: AccountStatus;
  serverEditing: boolean;
  setServerEditing: Dispatch<SetStateAction<boolean>>;
  serverUrl: string;
  setServerUrlInput: Dispatch<SetStateAction<string>>;
  clearError: () => void;
  submitAuth: (event: FormEvent) => Promise<void>;
  setServerUrl: (url: string) => Promise<unknown>;
}) {
  return (
      <SectionShell
        title="账号"
        description="一次登录，Agent 与生图模型自动配置。无需复制或管理 API Key。"
      >
        <div
          className="max-w-[420px]"
          data-testid="settings-account-signed-out"
        >
          <div
            className="flex border-b border-border-subtle"
            role="tablist"
            aria-label="账号操作"
          >
            {(["login", "register"] as const).map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={mode === item}
                onClick={() => {
                  setMode(item);
                  clearError();
                }}
                className={cn(
                  "no-drag relative px-0 pb-2 pr-6 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]",
                  mode === item
                    ? "text-primary after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-primary"
                    : "text-tertiary hover:text-primary",
                )}
              >
                {item === "login" ? "登录" : "注册"}
              </button>
            ))}
          </div>

          <form className="space-y-4 pt-5" onSubmit={submitAuth}>
            <Field label="用户名" htmlFor="account-username">
              <Input
                id="account-username"
                autoComplete="username"
                value={username}
                maxLength={12}
                onChange={(event) => setUsername(event.target.value)}
                className="h-9 rounded-full px-4 shadow-none"
                placeholder="3–12 个字符"
                required
              />
            </Field>
            <Field label="密码" htmlFor="account-password">
              <Input
                id="account-password"
                type="password"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                value={password}
                minLength={8}
                onChange={(event) => setPassword(event.target.value)}
                className="h-9 rounded-full px-4 shadow-none"
                placeholder="至少 8 个字符"
                required
              />
            </Field>
            {mode === "register" && (
              <Field label="确认密码" htmlFor="account-confirm-password">
                <Input
                  id="account-confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  minLength={8}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  aria-invalid={Boolean(
                    confirmPassword && confirmPassword !== password,
                  )}
                  className="h-9 rounded-full px-4 shadow-none"
                  required
                />
                {confirmPassword && confirmPassword !== password && (
                  <p className="mt-1 text-[11px] text-danger">
                    两次输入的密码不一致
                  </p>
                )}
              </Field>
            )}
            {error && (
              <InlineMessage tone="danger">{error.message}</InlineMessage>
            )}
            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full rounded-full shadow-none"
              disabled={
                isAuthBusy ||
                (mode === "register" && confirmPassword !== password)
              }
              data-testid={`account-${mode}-submit`}
            >
              {isAuthBusy
                ? "正在配置模型…"
                : mode === "login"
                  ? "登录"
                  : "注册并登录"}
            </Button>
            {mode === "login" && (
              <p className="text-[10.5px] text-quaternary">
                忘记密码？联系管理员重置。
              </p>
            )}
          </form>

          <div className="mt-8 border-t border-border-subtle pt-5">
            <button
              type="button"
              onClick={() => {
                setServerEditing((value) => {
                  const next = !value;
                  // 展开时同步当前地址：status 是异步加载的，挂载时捕获的初值可能已过期。
                  if (next) setServerUrlInput(status.serverUrl);
                  return next;
                });
              }}
              className="no-drag text-[11px] text-tertiary underline-offset-4 hover:text-primary hover:underline"
            >
              {serverEditing ? "收起服务器设置" : "使用其他账号服务器"}
            </button>
            {serverEditing && (
              <form
                className="mt-3 flex gap-2"
                onSubmit={async (event) => {
                  event.preventDefault();
                  try {
                    await setServerUrl(serverUrl);
                    setServerEditing(false);
                  } catch {
                    // store.error 负责呈现
                  }
                }}
              >
                <Input
                  value={serverUrl}
                  onChange={(event) => setServerUrlInput(event.target.value)}
                  className="h-8 rounded-full px-3 font-mono text-[11px] shadow-none"
                  aria-label="账号服务器地址"
                />
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  className="rounded-full shadow-none"
                  disabled={action === "server"}
                >
                  保存
                </Button>
              </form>
            )}
            <p className="mt-2 break-all font-mono text-[10px] text-quaternary">
              {status.serverUrl}
            </p>
          </div>
        </div>
      </SectionShell>
  );
}
