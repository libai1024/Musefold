// 设置 · 开放能力 — 接入向导内的「Musefold 自动化 Skill」条目(自 AutomationSection 拆出)。
// 渐进披露:状态摘要 + 动作常驻;三端版本明细与兼容性说明收进「详情」展开区(默认收起)。
import { useState } from 'react';
import type { IntegrationAction, IntegrationInfo } from '@musefold/desktop-contracts/ipc';
import { SettingsSwitch } from '@musefold/product-ui';
import { IconButton } from '@musefold/ui';
import { Copy, Download, ExternalLink, RefreshCw } from '../../../components/ui/icons';
import { Button } from '../../../components/ui/button';
import type { CopyWithFeedback } from './automation-clipboard';

interface SkillManagementBlockProps {
  integration: IntegrationInfo | null;
  busy: boolean;
  copiedKey: string | null;
  copy: CopyWithFeedback['copy'];
  runIntegration: (action: IntegrationAction) => void;
}

export function SkillManagementBlock({
  integration,
  busy,
  copiedKey,
  copy,
  runIntegration,
}: SkillManagementBlockProps) {
  const [detailsExpanded, setDetailsExpanded] = useState(false);

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

  return (
    <div className="settings-integration-item" data-testid="integration-skill">
      <div className="settings-integration-item-header settings-integration-item-header--wrap">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-medium text-primary">Musefold 自动化 Skill</p>
          <p className="mt-1 text-meta text-tertiary" data-testid="integration-skill-status">
            {skillVersionSummary}
            {integration?.skills.checkedAt
              ? ` · 已检查 ${new Date(integration.skills.checkedAt).toLocaleString('zh-CN', { hour12: false })}`
              : ' · 尚未联网检查'}
          </p>
        </div>
        <Button
          size="sm"
          variant="primary"
          disabled={busy || !integration?.bundledReady}
          data-testid="integration-skill-install"
          onClick={() => runIntegration('install-skill-all')}
        >
          <Download aria-hidden="true" className="h-3 w-3" />
          {installedSkillCount === 0
            ? '安装'
            : integration?.skills.updateAvailable
              ? '更新'
              : '重新安装'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !integration}
          data-testid="integration-skill-check"
          onClick={() => runIntegration('check-skill-update')}
        >
          <RefreshCw aria-hidden="true" className="h-3 w-3" />
          检查
        </Button>
        <IconButton
          label="打开 Skill 发布页"
          size="sm"
          disabled={busy || !integration}
          data-testid="integration-skill-open"
          onClick={() => runIntegration('open-skill-url')}
        >
          <ExternalLink aria-hidden="true" className="h-3 w-3" />
        </IconButton>
        <IconButton
          label={copiedKey === 'skill-url' ? '已复制 Skill 地址' : '复制 Skill 地址'}
          size="sm"
          disabled={!integration}
          data-testid="integration-skill-copy"
          onClick={() => integration && void copy('skill-url', integration.snippets.skillUrl)}
        >
          <Copy aria-hidden="true" className="h-3 w-3" />
        </IconButton>
      </div>
      <div className="settings-integration-item-divider mt-2 flex items-center justify-between gap-3 pt-2">
        <div className="min-w-0">
          <p className="text-meta text-secondary">自动更新</p>
          <p className="mt-0.5 text-meta text-quaternary">
            启动时检查并更新已安装项；下载内容通过 SHA-256 校验，旧目录保留备份
          </p>
        </div>
        <SettingsSwitch
          checked={integration?.skills.autoUpdate ?? false}
          onCheckedChange={() =>
            runIntegration(
              integration?.skills.autoUpdate
                ? 'disable-skill-auto-update'
                : 'enable-skill-auto-update',
            )
          }
          label="自动更新 Musefold Skill"
          disabled={busy || !integration}
          testId="integration-skill-auto-update"
        />
      </div>
      {integration?.skills.checkError && (
        <p className="settings-integration-item-error mt-2 text-meta" data-testid="integration-skill-error">
          {integration.skills.checkError}；仍可安装 App 内置版本{' '}
          {integration.skills.bundledVersion}
        </p>
      )}
      <code
        className="mt-2 block truncate font-mono text-meta text-quaternary"
        data-testid="integration-skill-url"
        title={integration?.snippets.skillUrl}
      >
        {integration?.snippets.skillUrl ?? '正在获取网址…'}
      </code>
      <Button
        size="xs"
        variant="ghost"
        className="mt-1 px-1"
        aria-expanded={detailsExpanded}
        aria-controls="integration-skill-detail"
        data-testid="integration-skill-details"
        onClick={() => setDetailsExpanded((value) => !value)}
      >
        详情
      </Button>
      {detailsExpanded && (
        <div id="integration-skill-detail" className="mt-1">
          {integration && (
            <p className="mt-1 text-meta text-quaternary tabular-nums">
              Codex{' '}
              {integration.skills.installed.codex
                ? (integration.skills.installedVersions.codex ?? '旧版')
                : '未安装'}
              {' · '}Claude{' '}
              {integration.skills.installed.claude
                ? (integration.skills.installedVersions.claude ?? '旧版')
                : '未安装'}
              {' · '}Cursor{' '}
              {integration.skills.installed.cursor
                ? (integration.skills.installedVersions.cursor ?? '旧版')
                : '未安装'}
            </p>
          )}
          <p className="mt-1 text-meta text-quaternary">
            新版 Skill 会先探测 App 能力；旧版 App 缺少新接口时会降级或明确提示升级，不会猜测调用
          </p>
        </div>
      )}
    </div>
  );
}
