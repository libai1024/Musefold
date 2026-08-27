// 设置 · 开放能力 — 「在 Agent 里使用 Musefold」接入向导(自 AutomationSection 拆出)。
// 按使用时机分层:已配置客户端降权折叠(默认收起详情,展开看安装细节),未配置的正常展示;
// Skill 条目与 CLI 条目见 SkillManagementBlock / 下方 CLI 块。
import { useState, type ReactNode } from 'react';
import type { IntegrationAction, IntegrationInfo } from '@musefold/desktop-contracts/ipc';
import { desktopHost as api } from '@renderer/runtime/desktop-host-services';
import { ChevronDown } from '../../../components/ui/icons';
import { Button } from '../../../components/ui/button';
import { SkillManagementBlock } from './SkillManagementBlock';
import type { CopyWithFeedback } from './automation-clipboard';

interface IntegrationGuideProps {
  integration: IntegrationInfo | null;
  busy: boolean;
  copiedKey: string | null;
  copy: CopyWithFeedback['copy'];
  runExclusive: (task: () => Promise<void>) => Promise<void>;
  onIntegrationChange: (integration: IntegrationInfo) => void;
}

/** 客户端条目渐进披露壳:未配置 = 常规布局;已配置 = 折叠为一行(名称 + 已配置 + 详情)。 */
function ClientItemDisclosure({
  name,
  testId,
  registered,
  expanded,
  onToggleDetails,
  actions,
  description,
}: {
  name: string;
  testId: string;
  registered: boolean;
  expanded: boolean;
  onToggleDetails: () => void;
  actions: ReactNode;
  description: ReactNode;
}) {
  if (!registered) {
    return (
      <div className="settings-integration-item" data-testid={testId}>
        <div className="settings-integration-item-header">
          <p className="min-w-0 flex-1 text-[12px] font-medium text-primary">{name}</p>
          {actions}
        </div>
        {description}
      </div>
    );
  }
  return (
    <div className="settings-integration-item" data-testid={testId}>
      <div className="settings-integration-item-header">
        <p className="min-w-0 flex-1 text-[12px] font-medium text-primary">
          {name}
          <span className="ml-2 text-meta font-normal text-tertiary">已配置</span>
        </p>
        <Button
          size="sm"
          variant="ghost"
          className="px-2"
          aria-expanded={expanded}
          aria-controls={`${testId}-detail`}
          data-testid={`${testId}-details`}
          onClick={onToggleDetails}
        >
          详情
          <ChevronDown
            aria-hidden="true"
            className={`h-3 w-3 ${expanded ? 'rotate-180' : ''}`}
          />
        </Button>
      </div>
      {expanded && (
        <div id={`${testId}-detail`}>
          <div className="mt-2 flex flex-wrap items-center justify-end gap-2">{actions}</div>
          {description}
        </div>
      )}
    </div>
  );
}

export function IntegrationGuide({
  integration,
  busy,
  copiedKey,
  copy,
  runExclusive,
  onIntegrationChange,
}: IntegrationGuideProps) {
  const [integrationNotice, setIntegrationNotice] = useState<string | null>(null);
  // 已配置客户端默认收起详情;key = 'cursor' | 'codex' | 'claude'。
  const [expandedClients, setExpandedClients] = useState<Record<string, boolean>>({});

  const toggleClientDetails = (key: string) =>
    setExpandedClients((current) => ({ ...current, [key]: !current[key] }));

  const runIntegration = (action: IntegrationAction) =>
    void runExclusive(async () => {
      setIntegrationNotice(null);
      const result = await api.automation.integrationAction(action);
      setIntegrationNotice(result.message);
      onIntegrationChange(await api.automation.integrationInfo());
    });

  return (
    <div className="mt-8" data-testid="integration-guide">
      <h3 className="m-0 text-[12.5px] font-medium text-primary">在 Agent 里使用 Musefold</h3>
      <p className="mt-1 text-[11px] leading-relaxed text-tertiary">
        MCP 服务器与命令行工具已内置在应用里，无需安装 Node 或其他依赖；配置中不含任何密钥。 Agent
        可检查接入状态、唤起原生账号或中转站表单，并等待生图完成通知；凭据始终只在 Musefold
        内输入，花钱动作仍经过本应用确认或预算。
      </p>
      {!integration?.bundledReady && (
        <p className="settings-integration-item-error mt-2 rounded bg-inset px-2 py-1.5 text-[11px]">
          内置产物缺失（开发模式请先运行 node scripts/build-cli.mjs）。
        </p>
      )}
      {integrationNotice && (
        <p
          className="mt-2 rounded bg-inset px-2 py-1.5 text-[11px] text-secondary"
          data-testid="integration-notice"
        >
          {integrationNotice}
        </p>
      )}

      <div className="settings-integration-list mt-3">
        {/* Cursor */}
        <ClientItemDisclosure
          name="Cursor"
          testId="integration-cursor"
          registered={integration?.clients.cursor.registered ?? false}
          expanded={expandedClients.cursor ?? false}
          onToggleDetails={() => toggleClientDetails('cursor')}
          actions={
            <>
              <Button
                size="sm"
                variant="primary"
                disabled={busy || !integration?.bundledReady}
                data-testid="integration-cursor-install"
                onClick={() => runIntegration('open-cursor-deeplink')}
              >
                一键添加到 Cursor
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!integration}
                onClick={() =>
                  integration && void copy('cursor', integration.snippets.cursorJson)
                }
              >
                {copiedKey === 'cursor' ? '已复制' : '复制 JSON'}
              </Button>
            </>
          }
          description={
            <p className="mt-1 text-meta text-quaternary">或手动粘贴到 ~/.cursor/mcp.json</p>
          }
        />

        {/* Codex 与支持本地 stdio MCP 的 OpenAI 客户端 */}
        <ClientItemDisclosure
          name="Codex / ChatGPT 桌面版"
          testId="integration-codex"
          registered={integration?.clients.codex.registered ?? false}
          expanded={expandedClients.codex ?? false}
          onToggleDetails={() => toggleClientDetails('codex')}
          actions={
            <Button
              size="sm"
              variant="outline"
              disabled={!integration}
              data-testid="integration-codex-copy"
              onClick={() => integration && void copy('codex', integration.snippets.codexToml)}
            >
              {copiedKey === 'codex' ? '已复制' : '复制 TOML 片段'}
            </Button>
          }
          description={
            <p className="mt-1 text-meta text-quaternary">
              Codex 可粘贴到 ~/.codex/config.toml；ChatGPT 桌面版只有在当前版本提供本地 MCP servers
              配置时才能按相同 command / args / env 字段添加
            </p>
          }
        />

        {/* Claude Code */}
        <ClientItemDisclosure
          name="Claude Code"
          testId="integration-claude"
          registered={integration?.clients.claudeCode.registered ?? false}
          expanded={expandedClients.claude ?? false}
          onToggleDetails={() => toggleClientDetails('claude')}
          actions={
            <>
              {integration?.clients.claudeCode.cliDetected ? (
                <Button
                  size="sm"
                  variant="primary"
                  disabled={busy || !integration.bundledReady}
                  data-testid="integration-claude-register"
                  onClick={() => runIntegration('register-claude-code')}
                >
                  一键注册
                </Button>
              ) : (
                <span className="text-meta text-quaternary">未检测到 claude 命令</span>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={!integration}
                onClick={() =>
                  integration && void copy('claude', integration.snippets.claudeCommand)
                }
              >
                {copiedKey === 'claude' ? '已复制' : '复制命令'}
              </Button>
            </>
          }
          description={null}
        />

        {/* 公开 Agent Skill(状态摘要常驻,版本明细与兼容性说明按需展开) */}
        <SkillManagementBlock
          integration={integration}
          busy={busy}
          copiedKey={copiedKey}
          copy={copy}
          runIntegration={runIntegration}
        />

        {/* CLI */}
        <div className="settings-integration-item" data-testid="integration-cli">
          <div className="settings-integration-item-header">
            <p className="min-w-0 flex-1 text-[12px] font-medium text-primary">
              命令行工具（musefold）
              <span
                className="ml-2 text-meta font-normal text-tertiary"
                data-testid="integration-cli-status"
              >
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
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !integration?.bundledReady}
              data-testid="integration-cli-install"
              onClick={() =>
                runIntegration(
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
            </Button>
          </div>
          <p className="mt-1 text-meta text-quaternary">
            正式版会为当前用户自动安装，无需管理员权限。macOS 在首次从 Applications 启动时写入
            ~/.local/bin；Windows 安装器写入 %USERPROFILE%\.musefold\bin。 已打开的终端或 Agent
            需重新启动；此按钮用于修复或移除。
          </p>
        </div>
      </div>
    </div>
  );
}
