import {
  Check,
  Copy,
  Link2,
  LockKeyhole,
  Pause,
  Play,
  Sparkles,
  Trash2,
  X,
} from "@musefold/ui/icons";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  IconButton,
  Input,
} from "@musefold/ui";
import { useState, type FormEvent } from "react";
import { SettingsSegmentedControl } from "../settings/SettingsComponents";

export type ConnectedAppStatus = "active" | "suspended" | "revoked";
export type ConnectedAppMode = "ask_each_time" | "auto_with_limits";
export type ConnectedAppScope = (typeof CONNECTED_APP_SCOPES)[number];

export const CONNECTED_APP_SCOPES = [
  "account:read",
  "prompts:read",
  "prompts:write",
  "skills:read",
  "generations:read",
  "generations:write",
] as const;

export const CONNECTED_APP_SCOPE_LABELS: Record<ConnectedAppScope, string> = {
  "account:read": "账户信息",
  "prompts:read": "提示词·读",
  "prompts:write": "提示词·写",
  "skills:read": "技能·读",
  "generations:read": "生图·读",
  "generations:write": "生图·写",
};

export interface ConnectedAppViewModel {
  id: string;
  clientName: string;
  scopes: ConnectedAppScope[];
  mode: ConnectedAppMode;
  maxPointsPerGeneration: number;
  maxPointsPerDay: number;
  spentPointsToday: number;
  reservedPointsToday: number;
  status: ConnectedAppStatus;
  lastUsedAt?: string | null;
}

export interface ConnectedAppPatch {
  mode?: ConnectedAppMode;
  maxPointsPerGeneration?: number;
  maxPointsPerDay?: number;
  scopes?: ConnectedAppScope[];
  suspended?: boolean;
  reauthPassword?: string;
}

export interface ConnectedAppsScreenProps {
  items: ConnectedAppViewModel[];
  onUpdate: (id: string, input: ConnectedAppPatch) => Promise<void>;
  onRevoke: (id: string) => Promise<void>;
  loading?: boolean;
  loadError?: string | null;
  emptyLabel?: string;
  /** 提供后在空态渲染「复制服务器地址」，引导首个 AI 客户端接入。 */
  mcpServerUrl?: string;
  title?: string;
  description?: string;
  showHeading?: boolean;
  className?: string;
  testId?: string;
}

function statusLabel(status: ConnectedAppStatus): string {
  if (status === "active") return "已启用";
  if (status === "suspended") return "已暂停";
  return "已撤销";
}

function relativeTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return null;
  const minutes = Math.round((Date.now() - timestamp) / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(timestamp).toLocaleDateString();
}

function hasAllScopes(scopes: string[]): boolean {
  return CONNECTED_APP_SCOPES.every((scope) => scopes.includes(scope));
}

/** Shared Cloud MCP connection policy surface. */
export function ConnectedAppsScreen({
  items,
  onUpdate,
  onRevoke,
  loading = false,
  loadError = null,
  emptyLabel = "还没有连接 AI 客户端",
  mcpServerUrl,
  title = "已连接应用",
  description = "管理 AI 客户端访问 Musefold Cloud MCP 的授权、范围和预算。",
  showHeading = true,
  className,
  testId,
}: ConnectedAppsScreenProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingReauth, setPendingReauth] = useState<{
    id: string;
    input: ConnectedAppPatch;
  } | null>(null);
  const [pendingRevokeId, setPendingRevokeId] = useState<string | null>(null);
  const [reauthPassword, setReauthPassword] = useState("");
  const [serverUrlCopied, setServerUrlCopied] = useState(false);
  const displayError = loadError ?? error;

  const update = async (id: string, input: ConnectedAppPatch) => {
    const connection = items.find((item) => item.id === id);
    if (!connection) return;
    const needsReauth =
      (input.mode === "auto_with_limits" && connection.mode !== "auto_with_limits") ||
      (input.maxPointsPerGeneration !== undefined &&
        input.maxPointsPerGeneration > connection.maxPointsPerGeneration) ||
      (input.maxPointsPerDay !== undefined && input.maxPointsPerDay > connection.maxPointsPerDay) ||
      (input.scopes !== undefined &&
        input.scopes.some((scope) => !connection.scopes.includes(scope))) ||
      (input.suspended === false && connection.status === "suspended");
    if (needsReauth && !input.reauthPassword) {
      setPendingReauth({ id, input });
      setReauthPassword("");
      return;
    }
    setBusyId(id);
    setError(null);
    try {
      await onUpdate(id, input);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "连接策略更新失败");
    } finally {
      setBusyId(null);
    }
  };

  const toggleScope = (connection: ConnectedAppViewModel, scope: ConnectedAppScope) => {
    const enabled = connection.scopes.includes(scope);
    if (enabled && connection.scopes.length <= 1) {
      setError("至少保留一项能力");
      return;
    }
    const scopes = enabled
      ? connection.scopes.filter((value) => value !== scope)
      : [...connection.scopes, scope];
    void update(connection.id, { scopes });
  };

  const submitReauth = async (event: FormEvent) => {
    event.preventDefault();
    if (!pendingReauth || reauthPassword.length < 8) return;
    const request = pendingReauth;
    setPendingReauth(null);
    await update(request.id, { ...request.input, reauthPassword });
    setReauthPassword("");
  };

  const revoke = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await onRevoke(id);
      setPendingRevokeId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "连接撤销失败");
    } finally {
      setBusyId(null);
    }
  };

  const copyServerUrl = async () => {
    if (!mcpServerUrl) return;
    try {
      await navigator.clipboard.writeText(mcpServerUrl);
      setServerUrlCopied(true);
      window.setTimeout(() => setServerUrlCopied(false), 2_000);
    } catch {
      setError("复制服务器地址失败，请手动复制");
    }
  };

  return (
    <section
      className={`mf-connected-apps-screen${className ? ` ${className}` : ""}`}
      data-testid={testId}
    >
      {showHeading ? (
        <header className="mf-connected-apps-heading">
          <h1>{title}</h1>
          <p>{description}</p>
        </header>
      ) : null}
      {displayError ? (
        <p className="mf-connected-apps-error" role="alert">
          {displayError}
        </p>
      ) : null}
      <div className="mf-connected-apps-list">
        {!loading && items.map((connection) => {
          const disabled = connection.status === "revoked" || busyId === connection.id;
          const usedAt = relativeTime(connection.lastUsedAt);
          return (
            <article className="mf-connected-app-row" key={connection.id} data-testid="connection-row">
              <div className="mf-connected-app-heading">
                <span className="mf-connected-app-icon" aria-hidden="true">
                  <Link2 />
                </span>
                <div>
                  <strong>{connection.clientName}</strong>
                  <span>
                    {statusLabel(connection.status)}
                    {usedAt ? ` · 最近使用 ${usedAt}` : " · 尚未使用"}
                  </span>
                </div>
                {hasAllScopes(connection.scopes) ? (
                  <span className="mf-connected-app-all-badge" data-testid="connection-all-capabilities">
                    <Sparkles aria-hidden="true" />
                    全部能力
                  </span>
                ) : null}
                <span
                  className="mf-connected-app-status-dot"
                  data-active={connection.status === "active"}
                  aria-label={statusLabel(connection.status)}
                />
              </div>
              <div className="mf-connected-app-scopes" aria-label="已授权能力">
                {CONNECTED_APP_SCOPES.map((scope) => {
                  const enabled = connection.scopes.includes(scope);
                  return (
                    <button
                      type="button"
                      key={scope}
                      className="mf-connected-app-scope-chip"
                      data-on={enabled}
                      aria-pressed={enabled}
                      disabled={disabled}
                      data-testid={`connection-scope-${scope}`}
                      title={enabled ? `收窄：移除${CONNECTED_APP_SCOPE_LABELS[scope]}` : `扩大：授予${CONNECTED_APP_SCOPE_LABELS[scope]}（需密码确认）`}
                      onClick={() => toggleScope(connection, scope)}
                    >
                      {CONNECTED_APP_SCOPE_LABELS[scope]}
                    </button>
                  );
                })}
              </div>
              <div className="mf-connected-app-controls">
                <div>
                  <span>生图模式</span>
                  <SettingsSegmentedControl
                    value={connection.mode}
                    options={[
                      { value: "ask_each_time" as const, label: "每次审批" },
                      { value: "auto_with_limits" as const, label: "预算内自动" },
                    ]}
                    disabled={disabled}
                    ariaLabel="生图模式"
                    testIdPrefix={`connection-mode-${connection.id}`}
                    onChange={(mode) => void update(connection.id, { mode })}
                  />
                </div>
                <BudgetInput
                  label="单次预算（积分）"
                  value={connection.maxPointsPerGeneration}
                  max={10_000_000}
                  disabled={disabled}
                  inputKey={`${connection.id}-generation-${connection.maxPointsPerGeneration}`}
                  onCommit={(value) => void update(connection.id, { maxPointsPerGeneration: value })}
                  onError={setError}
                />
                <BudgetInput
                  label="每日预算（积分）"
                  value={connection.maxPointsPerDay}
                  max={100_000_000}
                  disabled={disabled}
                  inputKey={`${connection.id}-day-${connection.maxPointsPerDay}`}
                  onCommit={(value) => void update(connection.id, { maxPointsPerDay: value })}
                  onError={setError}
                />
              </div>
              <div className="mf-connected-app-footer">
                <span>
                  今日已用 {connection.spentPointsToday.toLocaleString()} · 已预留 {connection.reservedPointsToday.toLocaleString()} 积分
                </span>
                <div>
                  {connection.status !== "revoked" ? (
                    <Button
                      variant="ghost"
                      className="mf-connected-app-action"
                      disabled={busyId === connection.id}
                      onClick={() => void update(connection.id, { suspended: connection.status === "active" })}
                      icon={connection.status === "active" ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
                    >
                      {connection.status === "active" ? "暂停连接" : "恢复连接"}
                    </Button>
                  ) : null}
                  {connection.status !== "revoked" ? (
                    pendingRevokeId === connection.id ? (
                      <span className="mf-connected-app-revoke-confirm" role="group" aria-label="确认撤销授权">
                        <span>确认撤销？</span>
                        <Button variant="danger" size="sm" onClick={() => void revoke(connection.id)} disabled={busyId === connection.id}>撤销</Button>
                        <Button variant="ghost" size="sm" onClick={() => setPendingRevokeId(null)}>取消</Button>
                      </span>
                    ) : (
                      <Button variant="ghost" className="mf-connected-app-action mf-connected-app-action-danger" disabled={busyId === connection.id} onClick={() => setPendingRevokeId(connection.id)} icon={<Trash2 aria-hidden="true" />}>
                        撤销授权
                      </Button>
                    )
                  ) : null}
                </div>
              </div>
            </article>
          );
        })}
        {loading ? (
          <div className="mf-connected-app-empty" role="status">正在读取连接...</div>
        ) : items.length === 0 ? (
          <div className="mf-connected-app-empty">
            <p>{emptyLabel}</p>
            <div className="mf-connected-app-empty-guide">
              <span>在 AI 客户端中添加 Musefold MCP 服务器即可连接，新连接默认开放全部能力。</span>
              {mcpServerUrl ? (
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="connection-copy-server-url"
                  icon={<Copy aria-hidden="true" />}
                  onClick={() => void copyServerUrl()}
                >
                  {serverUrlCopied ? "已复制" : "复制服务器地址"}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
      <Dialog
        open={Boolean(pendingReauth)}
        onOpenChange={(open) => {
          if (!open) setPendingReauth(null);
        }}
      >
        <DialogContent
          className="mf-connected-app-reauth-dialog"
          overlayClassName="mf-connected-app-reauth-backdrop"
          hideClose
          aria-labelledby="connected-app-reauth-title"
        >
          <form className="mf-connected-app-reauth-form" onSubmit={(event) => void submitReauth(event)}>
            <div className="mf-connected-app-reauth-heading">
              <span className="mf-connected-app-icon" aria-hidden="true"><LockKeyhole /></span>
              <div>
                <DialogTitle id="connected-app-reauth-title">确认自动化权限</DialogTitle>
                <DialogDescription>扩大能力、提高预算或恢复连接前，请再次验证你的账号。</DialogDescription>
              </div>
              <IconButton className="mf-connected-app-icon-button" label="取消重新认证" title="取消" onClick={() => setPendingReauth(null)}><X aria-hidden="true" /></IconButton>
            </div>
            <label className="mf-connected-app-reauth-field">
              <span>账号密码</span>
              <Input type="password" autoFocus autoComplete="current-password" value={reauthPassword} onChange={(event) => setReauthPassword(event.target.value)} />
            </label>
            <div className="mf-connected-app-reauth-actions">
              <Button variant="secondary" className="mf-connected-app-button mf-connected-app-button-secondary" onClick={() => setPendingReauth(null)}>取消</Button>
              <Button variant="primary" className="mf-connected-app-button mf-connected-app-button-primary" type="submit" disabled={reauthPassword.length < 8} icon={<Check aria-hidden="true" />}>确认修改</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function BudgetInput({
  label,
  value,
  max,
  disabled,
  inputKey,
  onCommit,
  onError,
}: {
  label: string;
  value: number;
  max: number;
  disabled: boolean;
  inputKey: string;
  onCommit: (value: number) => void;
  onError: (message: string) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <Input
        type="number"
        min="0"
        max={max}
        inputMode="numeric"
        key={inputKey}
        defaultValue={value}
        disabled={disabled}
        onBlur={(event) => {
          const next = Number(event.currentTarget.value);
          if (!Number.isInteger(next) || next < 0) onError(`${label}必须是非负整数`);
          else if (next !== value) onCommit(next);
        }}
      />
    </label>
  );
}
