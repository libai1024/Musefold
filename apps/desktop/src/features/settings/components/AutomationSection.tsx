// 设置 · 自动化（V04-SET-01）：本地控制面开关、端口/token 展示与轮换、审计一览。
// 安全边界：token 只用于本机 Agent/CLI 接入；关闭后端口不再监听、发现文件删除。
import { useCallback, useEffect, useState } from 'react';
import { Copy, Download, ExternalLink, RefreshCw } from '../../../components/ui/icons';
import type {
  AutomationBudget,
  AutomationSpendAudit,
  AutomationStatus,
  IntegrationAction,
  IntegrationInfo,
} from '@musefold/desktop-contracts/ipc';
import { desktopHost as api } from '@renderer/runtime/desktop-host-services';
import { SectionShell, SettingRow } from '../components/SectionShell';
import { cn } from '../../../lib/utils';

function maskToken(token: string): string {
  if (token.length <= 14) return token;
  return `${token.slice(0, 10)}…${token.slice(-4)}`;
}

const AUDIT_ACTION_LABEL: Record<string, string> = {
  generate_image: '生图',
  run_scheme: '方案',
  run_github_skill: 'Skill',
};
const AUDIT_STATUS_LABEL: Record<string, string> = {
  success: '成功',
  failed: '失败',
  cancelled: '取消',
  denied: '已拒绝',
  timeout: '超时',
};
const AUDIT_VIA_LABEL: Record<string, string> = {
  budget: '预算',
  confirmation: '确认卡',
  consent: '终端确认',
  'idempotent-replay': '幂等重放',
  denied: '—',
  timeout: '—',
};

export function AutomationSection() {
  const [status, setStatus] = useState<AutomationStatus | null>(null);
  const [audit, setAudit] = useState<AutomationSpendAudit[]>([]);
  const [expandedAuditId, setExpandedAuditId] = useState<number | null>(null);
  const [budget, setBudget] = useState<AutomationBudget | null>(null);
  const [budgetDraft, setBudgetDraft] = useState('');
  const [integration, setIntegration] = useState<IntegrationInfo | null>(null);
  const [integrationNotice, setIntegrationNotice] = useState<string | null>(null);
  const [copiedSnippet, setCopiedSnippet] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const installedSkillCount = integration
    ? Object.values(integration.skills.installed).filter(Boolean).length
    : 0;
  const skillVersionSummary = integration
    ? installedSkillCount === 0
      ? `未安装 · App 内置 ${integration.skills.bundledVersion}`
      : integration.skills.updateAvailable
        ? `发现更新 ${integration.skills.availableVersion}`
        : `已安装 ${integration.skills.availableVersion}`
    : '检测中…';

  const refresh = useCallback(async () => {
    const [nextStatus, nextAudit, nextBudget, nextIntegration] = await Promise.all([
      api.automation.status(),
      api.automation.auditList(20),
      api.automation.budget.get(),
      api.automation.integrationInfo(),
    ]);
    setStatus(nextStatus);
    setAudit(nextAudit);
    setBudget(nextBudget);
    setBudgetDraft(String(nextBudget.monthlyLimitPoints));
    setIntegration(nextIntegration);
  }, []);

  const copySnippet = async (key: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedSnippet(key);
    window.setTimeout(() => setCopiedSnippet((current) => (current === key ? null : current)), 1500);
  };

  const runIntegration = async (action: IntegrationAction) => {
    if (busy) return;
    setBusy(true);
    setIntegrationNotice(null);
    try {
      const result = await api.automation.integrationAction(action);
      setIntegrationNotice(result.message);
      setIntegration(await api.automation.integrationInfo());
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggle = async () => {
    if (!status || busy) return;
    setBusy(true);
    try {
      setStatus(await api.automation.setEnabled(!status.enabled));
    } finally {
      setBusy(false);
    }
  };

  const rotate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      setStatus(await api.automation.rotateToken());
      setRevealed(true);
    } finally {
      setBusy(false);
    }
  };

  const copyToken = async () => {
    if (!status?.token) return;
    await navigator.clipboard.writeText(status.token);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <SectionShell
      title="自动化"
      description="把 Musefold 的能力开放给本机的 Agent（Claude Code / Codex / Cursor）与脚本。控制面只监听 127.0.0.1；花钱动作始终需要确认或预算授权。"
    >
      <div className="settings-list flex flex-col">
        <SettingRow
          label="本地控制面"
          hint={status?.running ? `运行中 · 127.0.0.1:${status.port} · API v1` : '已停止（发现文件已删除）'}
          data-testid="automation-toggle-row"
        >
          <button
            type="button"
            role="switch"
            aria-checked={status?.enabled ?? false}
            aria-label="启用本地控制面"
            title={status?.enabled ? '关闭本地控制面' : '启用本地控制面'}
            disabled={!status || busy}
            data-testid="automation-toggle"
            onClick={() => void toggle()}
            className={cn(
              'no-drag relative h-5 w-9 shrink-0 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] disabled:opacity-50',
              status?.enabled ? 'border-accent bg-accent' : 'border-border-strong bg-inset',
            )}
          >
            <span
              className={cn(
                'absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform',
                status?.enabled ? 'translate-x-4' : 'translate-x-0',
              )}
            />
          </button>
        </SettingRow>

        <SettingRow
          label="访问 token"
          hint="等同「操作 Musefold 的钥匙」（但拿到它也读不出任何 API Key）。泄露疑虑时立即轮换。"
          data-testid="automation-token-row"
        >
          <div className="flex items-center gap-2">
            <code
              className="max-w-[220px] truncate rounded bg-inset px-2 py-1 font-mono text-[11px] text-secondary"
              data-testid="automation-token-value"
              title={revealed ? status?.token ?? '' : undefined}
            >
              {status?.token ? (revealed ? status.token : maskToken(status.token)) : '—'}
            </code>
            <button
              type="button"
              className="no-drag rounded-md border border-border-default px-2 py-1 text-[11px] text-secondary transition-colors hover:bg-hover hover:text-primary disabled:opacity-50"
              disabled={!status?.token}
              onClick={() => setRevealed((value) => !value)}
            >
              {revealed ? '隐藏' : '显示'}
            </button>
            <button
              type="button"
              className="no-drag rounded-md border border-border-default px-2 py-1 text-[11px] text-secondary transition-colors hover:bg-hover hover:text-primary disabled:opacity-50"
              disabled={!status?.token}
              data-testid="automation-token-copy"
              onClick={() => void copyToken()}
            >
              {copied ? '已复制' : '复制'}
            </button>
            <button
              type="button"
              className="no-drag rounded-md border border-border-default px-2 py-1 text-[11px] text-secondary transition-colors hover:bg-hover hover:text-primary disabled:opacity-50"
              disabled={!status?.running || busy}
              data-testid="automation-token-rotate"
              onClick={() => void rotate()}
            >
              轮换
            </button>
          </div>
        </SettingRow>

        <SettingRow
          label="自动化预算"
          hint={
            budget
              ? `本月已用 ${budget.usedPoints} 积分；预算内的生成自动放行，超出或未知成本逐次确认（默认 0 积分）`
              : '预算内的生成自动放行'
          }
          data-testid="automation-budget-row"
        >
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-quaternary">积分</span>
            <input
              type="number"
              min="0"
              step="0.5"
              value={budgetDraft}
              onChange={(event) => setBudgetDraft(event.target.value)}
              data-testid="automation-budget-input"
              className="no-drag h-7 w-20 rounded-md border border-border-default bg-transparent px-2 text-right text-[12px] text-primary focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            />
            <span className="text-[11px] text-quaternary">/月</span>
            <button
              type="button"
              className="no-drag rounded-md border border-border-default px-2 py-1 text-[11px] text-secondary transition-colors hover:bg-hover hover:text-primary disabled:opacity-50"
              disabled={busy || budget == null || Number.isNaN(Number(budgetDraft))}
              data-testid="automation-budget-save"
              onClick={() =>
                void (async () => {
                  setBusy(true);
                  try {
                    setBudget(await api.automation.budget.set(Number(budgetDraft)));
                  } finally {
                    setBusy(false);
                  }
                })()
              }
            >
              保存
            </button>
          </div>
        </SettingRow>

      </div>

      {/* —— 接入向导（私下分发零依赖：App 内置 MCP 服务器与 CLI，配置不含密钥） —— */}
      <div className="mt-8" data-testid="integration-guide">
        <p className="text-[12.5px] font-medium text-primary">在 Agent 里使用 Musefold</p>
        <p className="mt-1 text-[11px] leading-relaxed text-tertiary">
          MCP 服务器与命令行工具已内置在应用里，无需安装 Node 或其他依赖；配置中不含任何密钥。
          Agent 可检查接入状态、唤起原生账号或中转站表单，并等待生图完成通知；凭据始终只在 Musefold 内输入，花钱动作仍经过本应用确认或预算。
        </p>
        {!integration?.bundledReady && (
          <p className="mt-2 rounded bg-inset px-2 py-1.5 text-[11px] text-[var(--danger-text,#e5484d)]">
            内置产物缺失（开发模式请先运行 node scripts/build-cli.mjs）。
          </p>
        )}
        {integrationNotice && (
          <p className="mt-2 rounded bg-inset px-2 py-1.5 text-[11px] text-secondary" data-testid="integration-notice">
            {integrationNotice}
          </p>
        )}

        <div className="mt-3 flex flex-col gap-2">
          {/* Cursor */}
          <div className="rounded-lg border border-border-subtle p-3" data-testid="integration-cursor">
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 text-[12px] font-medium text-primary">
                Cursor
                {integration?.clients.cursor.registered && (
                  <span className="ml-2 text-[10.5px] font-normal text-tertiary">已配置</span>
                )}
              </p>
              <button
                type="button"
                className="no-drag rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                disabled={busy || !integration?.bundledReady}
                data-testid="integration-cursor-install"
                onClick={() => void runIntegration('open-cursor-deeplink')}
              >
                一键添加到 Cursor
              </button>
              <button
                type="button"
                className="no-drag rounded-md border border-border-default px-2 py-1 text-[11px] text-secondary transition-colors hover:bg-hover hover:text-primary"
                disabled={!integration}
                onClick={() => void copySnippet('cursor', integration!.snippets.cursorJson)}
              >
                {copiedSnippet === 'cursor' ? '已复制' : '复制 JSON'}
              </button>
            </div>
            <p className="mt-1 text-[10.5px] text-quaternary">或手动粘贴到 ~/.cursor/mcp.json</p>
          </div>

          {/* Codex 与支持本地 stdio MCP 的 OpenAI 客户端 */}
          <div className="rounded-lg border border-border-subtle p-3" data-testid="integration-codex">
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 text-[12px] font-medium text-primary">
                Codex / ChatGPT 桌面版
                {integration?.clients.codex.registered && (
                  <span className="ml-2 text-[10.5px] font-normal text-tertiary">已配置</span>
                )}
              </p>
              <button
                type="button"
                className="no-drag rounded-md border border-border-default px-2 py-1 text-[11px] text-secondary transition-colors hover:bg-hover hover:text-primary"
                disabled={!integration}
                data-testid="integration-codex-copy"
                onClick={() => void copySnippet('codex', integration!.snippets.codexToml)}
              >
                {copiedSnippet === 'codex' ? '已复制' : '复制 TOML 片段'}
              </button>
            </div>
            <p className="mt-1 text-[10.5px] text-quaternary">
              Codex 可粘贴到 ~/.codex/config.toml；ChatGPT 桌面版只有在当前版本提供本地 MCP servers
              配置时才能按相同 command / args / env 字段添加
            </p>
          </div>

          {/* Claude Code */}
          <div className="rounded-lg border border-border-subtle p-3" data-testid="integration-claude">
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 text-[12px] font-medium text-primary">
                Claude Code
                {integration?.clients.claudeCode.registered && (
                  <span className="ml-2 text-[10.5px] font-normal text-tertiary">已配置</span>
                )}
              </p>
              {integration?.clients.claudeCode.cliDetected ? (
                <button
                  type="button"
                  className="no-drag rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  disabled={busy || !integration.bundledReady}
                  data-testid="integration-claude-register"
                  onClick={() => void runIntegration('register-claude-code')}
                >
                  一键注册
                </button>
              ) : (
                <span className="text-[10.5px] text-quaternary">未检测到 claude 命令</span>
              )}
              <button
                type="button"
                className="no-drag rounded-md border border-border-default px-2 py-1 text-[11px] text-secondary transition-colors hover:bg-hover hover:text-primary"
                disabled={!integration}
                onClick={() => void copySnippet('claude', integration!.snippets.claudeCommand)}
              >
                {copiedSnippet === 'claude' ? '已复制' : '复制命令'}
              </button>
            </div>
          </div>

          {/* 公开 Agent Skill */}
          <div className="rounded-lg border border-border-subtle p-3" data-testid="integration-skill">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium text-primary">Musefold 自动化 Skill</p>
                <p className="mt-1 text-[10.5px] text-tertiary" data-testid="integration-skill-status">
                  {skillVersionSummary}
                  {integration?.skills.checkedAt
                    ? ` · 已检查 ${new Date(integration.skills.checkedAt).toLocaleString('zh-CN', { hour12: false })}`
                    : ' · 尚未联网检查'}
                </p>
              </div>
              <button
                type="button"
                className="no-drag inline-flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                disabled={busy || !integration?.bundledReady}
                data-testid="integration-skill-install"
                onClick={() => void runIntegration('install-skill-all')}
              >
                <Download aria-hidden="true" size={13} />
                {installedSkillCount === 0
                  ? '安装'
                  : integration?.skills.updateAvailable
                    ? '更新'
                    : '重新安装'}
              </button>
              <button
                type="button"
                className="no-drag inline-flex items-center gap-1 rounded-md border border-border-default px-2 py-1 text-[11px] text-secondary transition-colors hover:bg-hover hover:text-primary disabled:opacity-50"
                disabled={busy || !integration}
                data-testid="integration-skill-check"
                onClick={() => void runIntegration('check-skill-update')}
              >
                <RefreshCw aria-hidden="true" size={13} />
                检查
              </button>
              <button
                type="button"
                className="no-drag inline-flex h-7 w-7 items-center justify-center rounded-md border border-border-default text-secondary transition-colors hover:bg-hover hover:text-primary disabled:opacity-50"
                disabled={busy || !integration}
                data-testid="integration-skill-open"
                title="打开 Skill 发布页"
                onClick={() => void runIntegration('open-skill-url')}
              >
                <ExternalLink aria-hidden="true" size={13} />
              </button>
              <button
                type="button"
                className="no-drag inline-flex h-7 w-7 items-center justify-center rounded-md border border-border-default text-secondary transition-colors hover:bg-hover hover:text-primary disabled:opacity-50"
                disabled={!integration}
                data-testid="integration-skill-copy"
                title={copiedSnippet === 'skill-url' ? '已复制 Skill 地址' : '复制 Skill 地址'}
                onClick={() => void copySnippet('skill-url', integration!.snippets.skillUrl)}
              >
                <Copy aria-hidden="true" size={13} />
              </button>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 border-t border-border-subtle pt-2">
              <div className="min-w-0">
                <p className="text-[10.5px] text-secondary">自动更新</p>
                <p className="mt-0.5 text-[10px] text-quaternary">
                  启动时检查并更新已安装项；下载内容通过 SHA-256 校验，旧目录保留备份
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={integration?.skills.autoUpdate ?? false}
                aria-label="自动更新 Musefold Skill"
                disabled={busy || !integration}
                data-testid="integration-skill-auto-update"
                onClick={() => void runIntegration(
                  integration?.skills.autoUpdate
                    ? 'disable-skill-auto-update'
                    : 'enable-skill-auto-update',
                )}
                className={cn(
                  'no-drag relative h-5 w-9 shrink-0 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] disabled:opacity-50',
                  integration?.skills.autoUpdate ? 'border-accent bg-accent' : 'border-border-strong bg-inset',
                )}
              >
                <span
                  className={cn(
                    'absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform',
                    integration?.skills.autoUpdate ? 'translate-x-4' : 'translate-x-0',
                  )}
                />
              </button>
            </div>
            {integration?.skills.checkError && (
              <p className="mt-2 text-[10.5px] text-[var(--danger-text,#e5484d)]" data-testid="integration-skill-error">
                {integration.skills.checkError}；仍可安装 App 内置版本 {integration.skills.bundledVersion}
              </p>
            )}
            <code
              className="mt-2 block truncate font-mono text-[10px] text-quaternary"
              data-testid="integration-skill-url"
              title={integration?.snippets.skillUrl}
            >
              {integration?.snippets.skillUrl ?? '正在获取网址…'}
            </code>
            {integration && (
              <p className="mt-1 text-[10px] text-quaternary">
                Codex {integration.skills.installed.codex ? integration.skills.installedVersions.codex ?? '旧版' : '未安装'}
                {' · '}Claude {integration.skills.installed.claude ? integration.skills.installedVersions.claude ?? '旧版' : '未安装'}
                {' · '}Cursor {integration.skills.installed.cursor ? integration.skills.installedVersions.cursor ?? '旧版' : '未安装'}
              </p>
            )}
            <p className="mt-1 text-[10.5px] text-quaternary">
              新版 Skill 会先探测 App 能力；旧版 App 缺少新接口时会降级或明确提示升级，不会猜测调用
            </p>
          </div>

          {/* CLI */}
          <div className="rounded-lg border border-border-subtle p-3" data-testid="integration-cli">
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 text-[12px] font-medium text-primary">
                命令行工具（musefold）
                <span className="ml-2 text-[10.5px] font-normal text-tertiary" data-testid="integration-cli-status">
                  {!integration
                    ? '检测中…'
                    : !integration.cli.installed
                      ? '未安装'
                      : !integration.cli.upToDate
                        ? '已安装（指向旧版本）'
                        : !integration.cli.onPath
                          ? '已安装（PATH 未生效）'
                          : `已自动安装 · ${integration.cli.path}`}
                </span>
              </p>
              <button
                type="button"
                className="no-drag rounded-md border border-border-default px-2.5 py-1 text-[11px] text-secondary transition-colors hover:bg-hover hover:text-primary disabled:opacity-50"
                disabled={busy || !integration?.bundledReady}
                data-testid="integration-cli-install"
                onClick={() =>
                  void runIntegration(
                    integration?.cli.installed && integration.cli.upToDate && integration.cli.onPath
                      ? 'uninstall-cli'
                      : 'install-cli',
                  )
                }
              >
                {integration?.cli.installed && integration.cli.upToDate && integration.cli.onPath
                  ? '移除'
                  : integration?.cli.installed
                    ? '修复安装'
                    : '安装到 PATH'}
              </button>
            </div>
            <p className="mt-1 text-[10.5px] text-quaternary">
              正式版会为当前用户自动安装，无需管理员权限。macOS 在首次从 Applications
              启动时写入 ~/.local/bin；Windows 安装器写入 %USERPROFILE%\.musefold\bin。
              已打开的终端或 Agent 需重新启动；此按钮用于修复或移除。
            </p>
          </div>
        </div>
      </div>

      <div className="mt-8">
        <div className="flex items-center justify-between">
          <p className="text-[12.5px] font-medium text-primary">最近调用</p>
          <button
            type="button"
            className="no-drag text-[11px] text-tertiary transition-colors hover:text-primary"
            onClick={() => void refresh()}
          >
            刷新
          </button>
        </div>
        {audit.length === 0 ? (
          <p className="mt-3 text-[11.5px] text-quaternary" data-testid="automation-audit-empty">
            还没有外部调用记录。
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-px" data-testid="automation-audit-list">
            {audit.map((entry) => (
              <button
                type="button"
                key={entry.id}
                onClick={() => setExpandedAuditId((current) => (current === entry.id ? null : entry.id))}
                className="no-drag rounded-md px-2 py-1.5 text-left text-[11px] transition-colors hover:bg-hover"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      'w-12 shrink-0 font-medium',
                      entry.status === 'success'
                        ? 'text-tertiary'
                        : 'text-[var(--danger-text,#e5484d)]',
                    )}
                  >
                    {AUDIT_STATUS_LABEL[entry.status] ?? entry.status}
                  </span>
                  <span className="w-20 shrink-0 font-mono text-quaternary">{AUDIT_ACTION_LABEL[entry.action] ?? entry.action}</span>
                  <span className="min-w-0 flex-1 truncate text-secondary">
                    {entry.promptText ? entry.promptText.slice(0, 60) : '—'}
                  </span>
                  <span className="shrink-0 text-quaternary">
                    {entry.actualPoints != null ? `${entry.actualPoints} 积分` : '-'}
                  </span>
                  <span className="shrink-0 text-quaternary">{AUDIT_VIA_LABEL[entry.approvedVia] ?? entry.approvedVia}</span>
                  <span className="shrink-0 text-quaternary">
                    {new Date(entry.at).toLocaleTimeString('zh-CN', { hour12: false })}
                  </span>
                </div>
                {expandedAuditId === entry.id && entry.promptText && (
                  <p className="mt-1.5 whitespace-pre-wrap break-words rounded bg-inset px-2 py-1.5 font-mono text-[10.5px] text-secondary">
                    {entry.promptText}
                  </p>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </SectionShell>
  );
}
