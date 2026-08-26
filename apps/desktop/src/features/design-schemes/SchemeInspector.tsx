import type { DesignSchemeSummary } from '@musefold/desktop-contracts/design-scheme';
import {
  ArrowRight,
  Blocks,
  CheckCircle2,
  Clock3,
  GitBranch,
  PanelRightClose,
  Play,
} from '../../components/ui/icons';
import { toImageSrc } from '../../lib/media';
import { FIDELITY_LABEL } from './scheme-runtime-labels';

interface SchemeInspectorProps {
  scheme: DesignSchemeSummary;
  onClose: () => void;
  onOpenDetail: () => void;
  onRun: () => void;
}

function lifecycleFor(scheme: DesignSchemeSummary) {
  if (scheme.status === 'formal') {
    return { label: '正式方案', detail: '已验证，可直接用于新设计', Icon: CheckCircle2 };
  }
  if (scheme.hasSuccessfulTrial) {
    return { label: '可继续', detail: '已有成功试运行，可继续完善', Icon: CheckCircle2 };
  }
  return { label: '待试运行', detail: '完成一次本机试运行后可转为正式方案', Icon: Clock3 };
}

function updatedLabel(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp);
}

export function SchemeInspector({ scheme, onClose, onOpenDetail, onRun }: SchemeInspectorProps) {
  const lifecycle = lifecycleFor(scheme);
  const actionLabel =
    scheme.status === 'formal'
      ? '使用方案'
      : scheme.hasSuccessfulTrial
        ? '继续试运行'
        : '开始试运行';

  return (
    <aside
      className="h-full w-[404px] min-w-[344px] max-w-[42%] shrink-0 bg-[var(--bg-window)] pl-1"
      aria-label="方案详情"
      data-testid="scheme-inspector-shell"
    >
      <section
        className="flex h-full min-h-0 flex-col overflow-hidden rounded-[var(--radius-work)] border border-border-subtle bg-[var(--bg-dock)] shadow-sm"
        data-testid="scheme-inspector"
        data-scheme-id={scheme.id}
      >
        <header className="flex h-11 shrink-0 items-center justify-between border-b border-border-subtle px-3.5 pr-16">
          <span className="text-[11.5px] font-semibold text-primary">方案详情</span>
          <button
            type="button"
            className="icon-action h-7 w-7"
            aria-label="关闭方案详情"
            title="关闭方案详情"
            data-testid="scheme-inspector-close"
            onClick={onClose}
          >
            <PanelRightClose className="h-3.5 w-3.5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-8 pt-3">
          <div className="aspect-[16/9] w-full overflow-hidden rounded-lg border border-border-subtle bg-inset/55">
            {scheme.coverImagePath ? (
              <img
                src={toImageSrc(scheme.coverImagePath)}
                alt={`${scheme.name}方案示例`}
                className="h-full w-full object-contain"
              />
            ) : (
              <div className="flex h-full items-center justify-center bg-accent-soft text-accent">
                <Blocks className="h-8 w-8" aria-hidden="true" />
              </div>
            )}
          </div>

          <div className="mt-4">
            <div className="flex flex-wrap items-center gap-1.5 text-meta">
              <span className="rounded-md border border-border-subtle px-1.5 py-0.5 text-secondary">
                {FIDELITY_LABEL[scheme.fidelity] ?? scheme.fidelity}
              </span>
              <span className="rounded-md bg-inset px-1.5 py-0.5 text-secondary">
                {lifecycle.label}
              </span>
            </div>
            <h2 className="mt-2 text-[15px] font-semibold leading-6 text-primary">{scheme.name}</h2>
            <p className="mt-1 text-[11px] leading-5 text-secondary">{scheme.summary}</p>
          </div>

          <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-b border-border-subtle pb-5">
            <button
              type="button"
              className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-[11px] font-semibold text-background transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35"
              data-testid="scheme-inspector-run"
              onClick={onRun}
            >
              <Play className="h-3.5 w-3.5" />
              {actionLabel}
            </button>
            <button
              type="button"
              className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-border-default px-3 text-[11px] font-medium text-primary transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
              data-testid="scheme-inspector-open-detail"
              onClick={onOpenDetail}
            >
              完整详情
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <section className="border-b border-border-subtle py-5">
            <h3 className="text-[12px] font-semibold text-primary">当前状态</h3>
            <div className="mt-3 flex items-start gap-2.5">
              <lifecycle.Icon
                className="mt-0.5 h-4 w-4 shrink-0 text-secondary"
                aria-hidden="true"
              />
              <div>
                <p className="text-[11.5px] font-medium text-primary">{lifecycle.label}</p>
                <p className="mt-0.5 text-meta leading-5 text-tertiary">{lifecycle.detail}</p>
              </div>
            </div>
          </section>

          <section className="border-b border-border-subtle py-5">
            <h3 className="text-[12px] font-semibold text-primary">需要提供</h3>
            {scheme.inputLabels.length > 0 ? (
              <ul className="mt-2.5 divide-y divide-border-subtle">
                {scheme.inputLabels.map((label, index) => (
                  <li
                    key={`${label}-${index}`}
                    className="flex min-h-9 items-center justify-between gap-3 py-2 text-[11px]"
                  >
                    <span className="min-w-0 text-primary">{label}</span>
                    <span className="shrink-0 text-meta text-tertiary">输入 {index + 1}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-meta leading-5 text-tertiary">无需额外输入，可直接运行。</p>
            )}
          </section>

          <section className="py-5">
            <h3 className="text-[12px] font-semibold text-primary">来源与版本</h3>
            <dl className="mt-3 grid grid-cols-[64px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[11px]">
              <dt className="text-tertiary">来源</dt>
              <dd className="flex min-w-0 items-center gap-1.5 text-secondary">
                <GitBranch className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{scheme.sourceLabel}</span>
              </dd>
              <dt className="text-tertiary">最近更新</dt>
              <dd className="text-secondary">{updatedLabel(scheme.updatedAt)}</dd>
              <dt className="text-tertiary">运行记录</dt>
              <dd className="text-secondary">
                {scheme.lastRunAt ? `最近运行于 ${updatedLabel(scheme.lastRunAt)}` : '尚未运行'}
              </dd>
            </dl>
          </section>
        </div>
      </section>
    </aside>
  );
}
