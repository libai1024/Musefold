import { Check, Link2, LockKeyhole, Pause, Play, Trash2, X } from "@musefold/ui/icons";
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

export type ConnectedAppStatus = "active" | "suspended" | "revoked";
export type ConnectedAppMode = "ask_each_time" | "auto_with_limits";

export interface ConnectedAppViewModel {
  id: string;
  clientName: string;
  scopes: string[];
  mode: ConnectedAppMode;
  maxPointsPerGeneration: number;
  maxPointsPerDay: number;
  spentPointsToday: number;
  reservedPointsToday: number;
  status: ConnectedAppStatus;
}

export interface ConnectedAppPatch {
  mode?: ConnectedAppMode;
  maxPointsPerGeneration?: number;
  maxPointsPerDay?: number;
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
  title?: string;
  description?: string;
  className?: string;
  testId?: string;
}

function statusLabel(status: ConnectedAppStatus): string {
  if (status === "active") return "已启用";
  if (status === "suspended") return "已暂停";
  return "已撤销";
}

/** Shared Cloud MCP connection policy surface. */
export function ConnectedAppsScreen({
  items,
  onUpdate,
  onRevoke,
  loading = false,
  loadError = null,
  emptyLabel = "还没有连接 AI 客户端",
  title = "已连接应用",
  description = "管理 AI 客户端访问 Musefold Cloud MCP 的授权、范围和预算。",
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
  const displayError = loadError ?? error;

  const update = async (id: string, input: ConnectedAppPatch) => {
    const connection = items.find((item) => item.id === id);
    if (!connection) return;
    const needsReauth =
      (input.mode === "auto_with_limits" && connection.mode !== "auto_with_limits") ||
      (input.maxPointsPerGeneration !== undefined &&
        input.maxPointsPerGeneration > connection.maxPointsPerGeneration) ||
      (input.maxPointsPerDay !== undefined && input.maxPointsPerDay > connection.maxPointsPerDay) ||
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

  return (
    <section
      className={`mf-connected-apps-screen${className ? ` ${className}` : ""}`}
      data-testid={testId}
    >
      <header className="mf-connected-apps-heading">
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      {displayError ? (
        <p className="mf-connected-apps-error" role="alert">
          {displayError}
        </p>
      ) : null}
      <div className="mf-connected-apps-list">
        {!loading && items.map((connection) => {
          const disabled = connection.status === "revoked" || busyId === connection.id;
          return (
            <article className="mf-connected-app-row" key={connection.id} data-testid="connection-row">
              <div className="mf-connected-app-heading">
                <span className="mf-connected-app-icon" aria-hidden="true">
                  <Link2 />
                </span>
                <div>
                  <strong>{connection.clientName}</strong>
                  <span>{statusLabel(connection.status)}</span>
                </div>
                <span
                  className="mf-connected-app-status-dot"
                  data-active={connection.status === "active"}
                  aria-label={statusLabel(connection.status)}
                />
              </div>
              <div className="mf-connected-app-scopes">
                {connection.scopes.map((scope) => <span key={scope}>{scope}</span>)}
              </div>
              <div className="mf-connected-app-controls">
                <label>
                  <span>生图模式</span>
                  <select
                    value={connection.mode}
                    disabled={disabled}
                    onChange={(event) => void update(connection.id, { mode: event.target.value as ConnectedAppMode })}
                  >
                    <option value="ask_each_time">每次审批</option>
                    <option value="auto_with_limits">预算内自动</option>
                  </select>
                </label>
                <BudgetInput
                  label="单次预算"
                  value={connection.maxPointsPerGeneration}
                  disabled={disabled}
                  inputKey={`${connection.id}-generation-${connection.maxPointsPerGeneration}`}
                  onCommit={(value) => void update(connection.id, { maxPointsPerGeneration: value })}
                  onError={setError}
                />
                <BudgetInput
                  label="每日预算"
                  value={connection.maxPointsPerDay}
                  disabled={disabled}
                  inputKey={`${connection.id}-day-${connection.maxPointsPerDay}`}
                  onCommit={(value) => void update(connection.id, { maxPointsPerDay: value })}
                  onError={setError}
                />
              </div>
              <div className="mf-connected-app-footer">
                <span>
                  今日已用 {connection.spentPointsToday.toLocaleString()} · 已预留 {connection.reservedPointsToday.toLocaleString()} 点
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
          <div className="mf-connected-app-empty">{emptyLabel}</div>
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
                <DialogDescription>提高预算或恢复连接前，请再次验证你的账号。</DialogDescription>
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
  disabled,
  inputKey,
  onCommit,
  onError,
}: {
  label: string;
  value: number;
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
        max={label === "单次预算" ? 10_000_000 : 100_000_000}
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
