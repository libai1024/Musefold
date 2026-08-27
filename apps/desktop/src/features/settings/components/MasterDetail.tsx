// src/features/settings/components/MasterDetail.tsx
// 中转站 master-detail 分栏骨架(RELAY-SETTINGS-UI 第二步):
// 左栏供应商/连接列表(品牌 icon + 名称 + 状态点 + 默认徽标),右栏就地编辑详情面板。
// 左栏选中态与设置导航共用低对比 surface,不使用 accent 指示条。
// 样式在 styles/settings.css,token 只用 tokens.css 既有值。

import type { ReactNode } from 'react';
import { Button } from '../../../components/ui/button';
import { Loader2 } from '../../../components/ui/icons';
import { cn } from '../../../lib/utils';
import type { ConnectionDot, ConnectionDotTone } from './connection-status';

const DOT_TONE_CLASS: Record<ConnectionDotTone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  muted: 'bg-border-default',
  /** 测试进行中:warning 色 + settings.css 呼吸动画(受 data-motion / prefers-reduced-motion 门控) */
  testing: 'bg-warning settings-md-dot-testing',
};

/** 状态点(规格与第一步 ConnectionRow 一致):icon 砖右下角 8px 圆点 + a11y 文本 */
export function ConnectionStatusDot({ dot, testId }: { dot: ConnectionDot; testId?: string }) {
  return (
    <span
      className={cn(
        'absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-elevated',
        DOT_TONE_CLASS[dot.tone],
      )}
      title={dot.label}
      data-testid={testId}
      data-tone={dot.tone}
    >
      <span className="sr-only">{dot.label}</span>
    </span>
  );
}

/** 分栏容器:左栏 240px 列表 + 右栏详情;<960px 时左栏降级为顶部横向可滚动列表 */
export function MasterDetail({
  rail,
  children,
  testId,
}: {
  rail: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div className="settings-md" data-testid={testId}>
      <div className="settings-md-rail">{rail}</div>
      <div className="settings-md-detail">{children}</div>
    </div>
  );
}

/** 左栏行:品牌 icon(+ 状态点)+ 名称 +(可选第二行 meta,如模型/URL)+(默认徽标);整行可点选 */
export function MasterDetailItem({
  icon,
  title,
  meta,
  metaMono,
  statusDot,
  active,
  selected,
  onClick,
  testId,
}: {
  /** 品牌图标(ModelBrandIcon 等任意节点),渲染在 28px 砖块内 */
  icon: ReactNode;
  title: string;
  /** 名称下第二行 11px 灰字(模型 ID / Base URL 等),truncate 单行 */
  meta?: string;
  /** meta 为 URL/模型 ID 等技术串时用等宽字体 */
  metaMono?: boolean;
  /** resolveConnectionDot 产出;缺密钥/测试结果的颜色语义全由它承载 */
  statusDot?: ConnectionDot;
  /** 当前默认项(relay 语义下的 isActive) */
  active: boolean;
  selected: boolean;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      className="settings-md-item"
      data-active={selected ? 'true' : undefined}
      aria-current={selected ? 'true' : undefined}
      onClick={onClick}
      data-testid={testId}
    >
      <span className="relative shrink-0">
        <span
          className="flex h-7 w-7 items-center justify-center rounded-md border border-border-subtle bg-inset text-secondary"
          aria-hidden="true"
        >
          {icon}
        </span>
        {statusDot && (
          <ConnectionStatusDot dot={statusDot} testId={testId ? `${testId}-status` : undefined} />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate leading-tight">{title}</span>
        {meta && (
          <span
            className={cn('settings-md-item-meta block truncate', metaMono && 'font-mono')}
            title={meta}
          >
            {meta}
          </span>
        )}
      </span>
      {active && <span className="settings-md-default-badge">默认</span>}
    </button>
  );
}

/** 详情面板分组标题:11px 次级标签 + 可选右侧计数灰字(如「4 个模型」) */
export function PanelSectionTitle({
  title,
  value,
  testId,
}: {
  title: string;
  value?: string;
  testId?: string;
}) {
  return (
    <div
      className="settings-detail-section-title flex items-baseline justify-between gap-3"
      data-testid={testId}
    >
      <span className="text-[11px] font-medium text-secondary">{title}</span>
      {value ? <span className="text-[11px] text-quaternary">{value}</span> : null}
    </div>
  );
}

/** 详情面板底部操作条(生图 / Agent 共用):
 *  左端可选 danger 槽(删除二次确认),右端 放弃 / 测试 / 保存 + dirty 圆点。
 *  文案与图标由调用方传入,保持两个面板既有字符串不变。 */
export function PanelActions({
  dirty,
  danger,
  guard,
  onDiscard,
  discardLabel,
  discardDisabled = false,
  onTest,
  testLabel,
  testIcon,
  testBusy = false,
  testDisabled = false,
  testTestId,
  onSave,
  saveLabel,
  saveBusy = false,
  saveDisabled = false,
  saveTestId,
}: {
  /** 有未保存修改时右端渲染 accent 圆点 */
  dirty: boolean;
  /** 左端破坏性操作槽(删除按钮 / InlineConfirm) */
  danger?: ReactNode;
  /** 拦截槽(dirty 切换守卫的 InlineConfirm);存在时替换整组操作按钮 */
  guard?: ReactNode;
  onDiscard: () => void;
  discardLabel: string;
  discardDisabled?: boolean;
  onTest: () => void;
  testLabel: string;
  testIcon?: ReactNode;
  testBusy?: boolean;
  testDisabled?: boolean;
  testTestId?: string;
  onSave: () => void;
  saveLabel: string;
  /** 保存进行中:按钮内渲染 spinner 并禁用 */
  saveBusy?: boolean;
  saveDisabled?: boolean;
  saveTestId?: string;
}) {
  return (
    <div className="settings-md-actions settings-detail-action-bar">
      {danger ? <div className="settings-md-danger-slot">{danger}</div> : null}
      {guard ? (
        <div className="settings-md-action-group">{guard}</div>
      ) : (
        <div className="settings-md-action-group">
          {dirty && (
            <span
              className="settings-md-dirty-dot"
              title="有未保存的修改"
              data-testid="settings-panel-dirty"
            >
              <span className="sr-only">有未保存的修改</span>
            </span>
          )}
          <Button variant="ghost" onClick={onDiscard} disabled={discardDisabled}>
            {discardLabel}
          </Button>
          <Button variant="outline" onClick={onTest} disabled={testDisabled} data-testid={testTestId}>
            {testBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : testIcon}
            {testLabel}
          </Button>
          <Button
            variant="primary"
            onClick={onSave}
            disabled={saveBusy || saveDisabled}
            data-testid={saveTestId}
          >
            {saveBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {saveLabel}
          </Button>
        </div>
      )}
    </div>
  );
}

/** 行内二次确认 —— 删除连接等破坏性操作共用(自 ConnectionRow 迁入,行为不变);
 *  cancelLabel 可选,dirty 切换守卫用「继续编辑」替换默认「取消」。 */
export function InlineConfirm({
  label,
  confirmLabel,
  cancelLabel = '取消',
  danger,
  testId,
  onConfirm,
  onCancel,
}: {
  label: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  testId?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="settings-inline-confirm flex items-center gap-1" data-testid={testId}>
      <span className="whitespace-nowrap text-meta text-tertiary">{label}</span>
      <Button size="sm" variant={danger ? 'danger' : 'outline'} onClick={onConfirm}>
        {confirmLabel}
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        {cancelLabel}
      </Button>
    </div>
  );
}
