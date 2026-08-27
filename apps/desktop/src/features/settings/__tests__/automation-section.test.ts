import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatAuditTime, maskToken, parseBudgetDraft } from '../components/automation-format';

const read = (name: string) =>
  readFileSync(`apps/desktop/src/features/settings/components/${name}`, 'utf8');

const main = read('AutomationSection.tsx');
const localControl = read('LocalControlCard.tsx');
const integration = read('IntegrationGuide.tsx');
const skillBlock = read('SkillManagementBlock.tsx');
const auditList = read('AutomationAuditList.tsx');
const clipboard = read('automation-clipboard.ts');
const allSections = [main, localControl, integration, skillBlock, auditList].join('\n');

describe('automation settings UI contract', () => {
  it('renders an unambiguous, theme-aware local control-plane switch', () => {
    // v1.4.1：开关统一走共享 SettingsSwitch 原语（role=switch + 主题 token 由原语保证）
    expect(localControl).toContain('<SettingsSwitch');
    expect(localControl).toContain(
      "label={status?.enabled ? '关闭本地控制面' : '启用本地控制面'}",
    );
    expect(allSections).not.toContain('--accent-solid');
  });

  it('shows versioned Skill install and update controls behind progressive disclosure', () => {
    expect(skillBlock).toContain('Musefold 自动化 Skill');
    expect(skillBlock).toContain("runIntegration('install-skill-all')");
    expect(skillBlock).toContain("runIntegration('check-skill-update')");
    expect(skillBlock).toContain('integration-skill-auto-update');
    expect(skillBlock).toContain('SHA-256');
    // 三端版本明细与兼容性说明收进「详情」展开区(默认收起),aria-expanded 可达
    expect(skillBlock).toContain('旧版 App 缺少新接口时会降级');
    expect(skillBlock).toContain('integration-skill-details');
    expect(skillBlock).toContain('aria-expanded={detailsExpanded}');
    expect(skillBlock).toContain("copy('skill-url', integration.snippets.skillUrl)");
  });

  it('auto-detects and clearly displays CLI/PATH state', () => {
    expect(main).toContain('api.automation.integrationInfo()');
    expect(integration).toContain("? '未安装'");
    expect(integration).toContain("? '已安装（PATH 未生效）'");
    expect(integration).toContain('已自动安装');
    expect(integration).toContain('正式版会为当前用户自动安装，无需管理员权限');
  });

  it('explains native credential handoff and completion notifications', () => {
    expect(integration).toContain('唤起原生账号或中转站表单');
    expect(integration).toContain('凭据始终只在 Musefold');
    expect(integration).toContain('等待生图完成通知');
  });

  it('collapses registered clients but keeps unregistered ones fully visible', () => {
    // 已配置客户端默认收起详情(降权),展开控件带 aria-expanded / aria-controls
    expect(integration).toContain('aria-expanded={expanded}');
    expect(integration).toContain('aria-controls={`${testId}-detail`}');
    expect(integration).toContain('已配置');
    // 未配置走常规布局(动作常驻 header),两种形态都保留条目容器与既有 testid
    // (客户端条目 testid 经 ClientItemDisclosure 的 testId prop 透传,data-testid={testId})
    expect(integration).toContain('data-testid={testId}');
    expect(integration).toContain('testId="integration-cursor"');
    expect(integration).toContain('testId="integration-codex"');
    expect(integration).toContain('testId="integration-claude"');
    expect(integration).toContain('data-testid="integration-cli"');
  });

  it('keeps loading / ready / recoverable-error states for the four-way refresh', () => {
    // refresh() 四路 IPC 必须有 catch,不再静默失败
    expect(main).toContain('catch (cause)');
    expect(main).toContain('setLoadError');
    expect(main).toContain('role="alert"');
    expect(main).toContain('data-testid="automation-load-error"');
    expect(main).toContain('data-testid="automation-load-retry"');
    expect(main).toContain('role="status"');
    expect(main).toContain('data-testid="automation-loading"');
  });

  it('funnels every clipboard write through one helper with failure feedback', () => {
    // token 与接入片段复制共用 useCopyWithFeedback:失败 toast、成功 1.5s 回落、卸载清定时器
    expect(clipboard).toContain('toast.error');
    expect(clipboard).toContain('navigator.clipboard.writeText');
    expect(clipboard).toContain('clearTimeout');
    expect(main).toContain('useCopyWithFeedback()');
    expect(localControl).toContain("copy('token', status.token)");
  });

  it('uses semantic headings and legal button content models', () => {
    // 区块标题用 h3(卡片标题是 h2、页级是 h1);审计行 button 内只放 span
    expect(integration).toContain('<h3');
    expect(auditList).toContain('<h3');
    expect(auditList).toContain('aria-expanded={expandedAuditId === entry.id}');
    expect(auditList).toContain('aria-controls={`audit-detail-${entry.id}`}');
    expect(auditList).toContain(
      'settings-audit-detail block whitespace-pre-wrap break-words font-mono',
    );
  });

  it('aligns budget and audit numbers with tabular figures', () => {
    expect(localControl).toContain('tabular-nums');
    expect(auditList).toContain('tabular-nums');
  });
});

describe('automation-format helpers', () => {
  it('masks tokens to first 4 + last 4, fully hiding short tokens', () => {
    // 旧实现前 10 + 后 4、≤14 全显已收紧(04-open review P1-6)
    expect(maskToken('mf_at_abcd1234wxyz')).toBe('mf_a…wxyz');
    expect(maskToken('123456789')).toBe('1234…6789');
    expect(maskToken('12345678')).toBe('••••••');
    expect(maskToken('mf_at_x')).toBe('••••••');
    expect(maskToken('')).toBe('••••••');
  });

  it('treats an emptied budget draft as unchanged instead of saving 0', () => {
    expect(parseBudgetDraft('')).toBeNull();
    expect(parseBudgetDraft('   ')).toBeNull();
    expect(parseBudgetDraft('abc')).toBeNull();
    expect(parseBudgetDraft('-5')).toBe(0);
    expect(parseBudgetDraft('0')).toBe(0);
    expect(parseBudgetDraft('12.5')).toBe(12.5);
  });

  it('renders audit timestamps with a date component', () => {
    // 昨天及更早不再显示成「像是今天的时间」(MM/dd HH:mm)
    expect(formatAuditTime(new Date(2026, 7, 27, 14, 5).getTime())).toBe('08/27 14:05');
  });
});
