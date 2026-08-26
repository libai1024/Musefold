import type {
  DesignSchemeSummary,
  MarketCandidate,
} from '@musefold/desktop-contracts/design-scheme';
import {
  Blocks,
  Download,
  FileCheck2,
  FileUp,
  GitBranch,
  History,
  Scale,
  ShieldCheck,
  Sparkles,
  Star,
  Wand2,
  X,
} from '../../components/ui/icons';
import { DropdownMenuContent, DropdownMenuItem } from '@musefold/ui';

export type SchemeCreateKind = 'idea' | 'github' | 'history' | 'prompt' | 'import';

export function SchemeCreateMenu({ onChoose }: { onChoose: (kind: SchemeCreateKind) => void }) {
  const items = [
    {
      id: 'idea' as const,
      label: '从一个想法开始',
      hint: '描述可重复使用的创作方式',
      icon: Sparkles,
    },
    {
      id: 'github' as const,
      label: '从 GitHub 添加',
      hint: '识别 Skill 或提示词仓库',
      icon: GitBranch,
    },
    {
      id: 'history' as const,
      label: '从历史内容创建',
      hint: '选择图片、消息与提示词',
      icon: History,
    },
    { id: 'prompt' as const, label: '从提示词创建', hint: '整理固定规则和变量', icon: Wand2 },
    { id: 'import' as const, label: '导入分享包', hint: '.musefold.design 文件', icon: FileUp },
  ];

  return (
    <DropdownMenuContent
      align="end"
      sideOffset={6}
      className="w-[286px]"
      aria-label="新建方案"
      data-testid="scheme-create-menu"
    >
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <DropdownMenuItem
            key={item.id}
            onSelect={() => onChoose(item.id)}
            className="min-h-12 gap-3 px-2.5"
          >
            <Icon className="h-4 w-4 shrink-0 text-secondary" />
            <span className="min-w-0">
              <span className="block text-[11.5px] font-medium text-primary">{item.label}</span>
              <span className="block truncate text-meta text-tertiary">{item.hint}</span>
            </span>
          </DropdownMenuItem>
        );
      })}
    </DropdownMenuContent>
  );
}

export function SchemeListRemoveDialog({
  name,
  isDraft,
  busy,
  onCancel,
  onConfirm,
}: {
  name: string;
  isDraft: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/35 p-4 animate-overlay-in"
      data-testid="scheme-list-remove-dialog"
    >
      <div
        className="w-full max-w-[400px] rounded-lg border border-border-default bg-popover shadow-pop animate-dialog-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby="scheme-list-remove-title"
      >
        <div className="px-5 py-5">
          <h2 id="scheme-list-remove-title" className="text-[14px] font-semibold text-primary">
            {isDraft ? `删除草稿「${name}」？` : `移除方案「${name}」？`}
          </h2>
          <p className="mt-2 text-[11px] leading-5 text-secondary">
            {isDraft
              ? '草稿与它的运行记录会从方案库移除；已生成的图片仍保留在历史与图库中。'
              : '方案会从方案库移除，之后无法直接在 Composer 中使用；已生成的图片仍保留在历史与图库中。'}
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={onCancel} className="action-button">
              取消
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onConfirm}
              className="action-button bg-danger text-on-danger hover:brightness-105 disabled:cursor-wait disabled:opacity-45"
              data-testid="scheme-list-remove-confirm"
            >
              {isDraft ? '删除草稿' : '移除方案'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function marketUpdatedLabel(value: number, now = Date.now()): string {
  if (!value) return '更新时间未知';
  const diff = Math.max(0, now - value);
  const day = 24 * 60 * 60 * 1000;
  if (diff < day) return '今天更新';
  if (diff < day * 30) return `${Math.floor(diff / day)} 天前更新`;
  if (diff < day * 365) return `${Math.floor(diff / (day * 30))} 个月前更新`;
  return `${Math.floor(diff / (day * 365))} 年前更新`;
}

export function MarketCandidateRow({
  candidate,
  installed,
  onAdd,
  onOpenInstalled,
}: {
  candidate: MarketCandidate;
  installed: DesignSchemeSummary | null;
  onAdd: () => void;
  onOpenInstalled: () => void;
}) {
  return (
    <article
      className="group grid grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-hover"
      data-testid={`market-candidate-${candidate.candidateId}`}
    >
      <span
        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-border-subtle bg-inset/55 text-secondary"
        aria-hidden
      >
        <GitBranch className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[12.5px] font-semibold text-primary">
            {candidate.fullName}
          </span>
          {candidate.license && (
            <span className="shrink-0 rounded-full border border-border-subtle px-1.5 py-0.5 text-meta text-secondary">
              {candidate.license}
            </span>
          )}
        </span>
        <span className="mt-0.5 block truncate text-meta text-secondary">
          {candidate.description ?? '仓库未提供描述'}
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-2 text-meta text-tertiary">
          <span className="flex shrink-0 items-center gap-1">
            <Star className="h-3 w-3" />
            {candidate.stars}
          </span>
          <span className="shrink-0">{marketUpdatedLabel(candidate.updatedAt)}</span>
          <span className="truncate">· {candidate.matchReason}</span>
        </span>
        {candidate.riskSummary && (
          <span
            className="mt-1 block truncate text-meta text-warning"
            data-testid={`market-risk-${candidate.candidateId}`}
          >
            {candidate.riskSummary}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={installed ? onOpenInstalled : onAdd}
        className="no-drag min-h-8 shrink-0 rounded-md px-2.5 text-[11px] font-medium text-primary transition-colors hover:bg-pressed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
        data-testid={`market-add-${candidate.candidateId}`}
      >
        {installed ? '已添加' : '添加'}
      </button>
    </article>
  );
}

export function MarketInstallDialog({
  candidate,
  onCancel,
  onConfirm,
}: {
  candidate: MarketCandidate;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/35 p-4 animate-overlay-in">
      <div
        className="w-full max-w-[440px] rounded-lg border border-border-default bg-popover shadow-pop animate-dialog-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby="market-install-title"
        data-testid="market-install-dialog"
      >
        <div className="flex items-start gap-3 border-b border-border-subtle px-5 py-4">
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-background"
            aria-hidden="true"
          >
            <Blocks className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="market-install-title" className="text-[14px] font-semibold text-primary">
              添加为草稿
            </h2>
            <p className="mt-1 truncate text-meta text-tertiary">{candidate.repositoryUrl}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="icon-action"
            aria-label="关闭"
            title="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-5">
          <p className="text-[12px] leading-6 text-primary">
            Musefold 会下载仓库快照，由 Agent
            整理成方案草稿。添加后需要完成一次本机试运行，才能正式使用。
          </p>
          <div className="mt-4 space-y-2 border-y border-border-subtle py-3 text-[11px] text-secondary">
            <p className="flex items-center gap-2">
              <Scale className="h-3.5 w-3.5" />
              许可证：{candidate.license ?? '未声明'}
            </p>
            <p className="flex items-center gap-2">
              <FileCheck2 className="h-3.5 w-3.5 text-success" />
              只读取规则、提示词与参考图片
            </p>
            <p className="flex items-center gap-2">
              <ShieldCheck className="h-3.5 w-3.5 text-success" />
              不会执行仓库脚本
            </p>
          </div>
          {candidate.riskSummary && (
            <p className="mt-3 text-meta leading-5 text-warning">{candidate.riskSummary}</p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={onCancel} className="action-button">
              取消
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="action-button bg-primary text-background hover:opacity-85"
              data-testid="market-install-confirm"
            >
              <Download className="h-3.5 w-3.5" />
              添加为草稿
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
