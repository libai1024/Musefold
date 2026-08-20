import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Blocks,
  ChevronDown,
  Download,
  FileCheck2,
  FileUp,
  GitBranch,
  History,
  Plus,
  RefreshCw,
  Scale,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  Wand2,
  X,
} from '../../components/ui/icons';
import { cn } from '../../lib/utils';
import { toImageSrc } from '../../lib/media';
import { useAppStore } from '../../stores/app';
import { toast } from '../../stores/toast';
import api from '../../lib/ipc';
import type { DesignSchemeSummary, MarketCandidate, MarketSearchResult } from '@shared/types/design-scheme';
import { useGenerationWorkbenchStore } from '../generation/workbench/store';
import { useSchemeCreationStore } from './creationStore';
import { useSchemeRunStore } from './runStore';
import { SchemeRuntimeDetail } from './SchemeRuntimeDetail';
import { HistorySourcePicker } from './HistorySourcePicker';

type Surface = 'mine' | 'discover';

function SchemeMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={cn('flex shrink-0 items-center justify-center rounded-md bg-primary text-background', compact ? 'h-7 w-7' : 'h-10 w-10')} aria-hidden="true">
      <Blocks className={compact ? 'h-3.5 w-3.5' : 'h-5 w-5'} />
    </span>
  );
}

const RUNTIME_FIDELITY_LABEL: Record<string, string> = {
  verified: '已验证',
  faithful: '完整还原',
  adapted: '有取舍',
  unsupported: '暂不支持',
};

/** 行尾悬停出现的删除入口（UI 规范 §3.3：危险操作不常驻，确认后执行）。 */
function RowRemoveButton({ label, onRemove, testId }: { label: string; onRemove: () => void; testId: string }) {
  return (
    <button
      type="button"
      onClick={(event) => { event.stopPropagation(); onRemove(); }}
      className="no-drag flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-tertiary opacity-0 transition-opacity hover:bg-danger/10 hover:text-danger focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/30 group-hover:opacity-100"
      aria-label={label}
      title={label}
      data-testid={testId}
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  );
}

/** 存于新 design-scheme 库的真实方案行：点行进详情，行尾按钮只执行动作（UI 规范 §3.3）。 */
function RuntimeSchemeRow({ scheme, onOpen, onRun, onRemove }: { scheme: DesignSchemeSummary; onOpen: () => void; onRun: () => void; onRemove: () => void }) {
  const actionLabel = scheme.status === 'formal' ? '使用' : scheme.hasSuccessfulTrial ? '继续' : '试运行';
  return (
    <article
      className="group grid min-h-[76px] grid-cols-[56px_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-md px-2 py-2 transition-colors hover:bg-hover"
      data-testid={`runtime-scheme-row-${scheme.id}`}
      data-runtime-scheme="true"
      data-status={scheme.status}
    >
      <button type="button" onClick={onOpen} className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30" aria-label={`查看${scheme.name}`}>
        {scheme.coverImagePath ? (
          <span className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-md border border-border-subtle bg-inset/55">
            <img src={toImageSrc(scheme.coverImagePath)} alt="" className="h-full w-full object-contain" />
          </span>
        ) : (
          <span className="flex h-14 w-14 items-center justify-center rounded-md border border-border-subtle bg-accent-soft text-accent" aria-hidden>
            <Blocks className="h-5 w-5" />
          </span>
        )}
      </button>
      <button type="button" onClick={onOpen} className="min-w-0 text-left focus-visible:outline-none" data-testid={`runtime-scheme-open-${scheme.id}`}>
        <span className="flex min-w-0 items-center gap-2">
          {scheme.status === 'draft' && !scheme.hasSuccessfulTrial && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />}
          <span className="truncate text-[12.5px] font-semibold text-primary">{scheme.name}</span>
          <span className="shrink-0 rounded-full border border-border-subtle px-1.5 py-0.5 text-[9px] text-secondary">
            {RUNTIME_FIDELITY_LABEL[scheme.fidelity] ?? scheme.fidelity}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-[10.5px] text-secondary">{scheme.summary}</span>
        <span className="mt-0.5 flex items-center gap-1.5 truncate text-[9.5px] text-tertiary">
          <GitBranch className="h-3 w-3 shrink-0" />
          {scheme.sourceLabel}
          {scheme.status === 'draft' && <span>· {scheme.hasSuccessfulTrial ? '已有成功试运行' : '等待试运行'}</span>}
          {scheme.inputLabels.length > 0 && <span>· 输入:{scheme.inputLabels.join('、')}</span>}
        </span>
      </button>
      <RowRemoveButton
        label={scheme.status === 'draft' ? '删除草稿' : '移除方案'}
        onRemove={onRemove}
        testId={`runtime-scheme-remove-${scheme.id}`}
      />
      <button
        type="button"
        onClick={(event) => { event.stopPropagation(); onRun(); }}
        className="no-drag min-h-8 shrink-0 rounded-md px-2.5 text-[11px] font-medium text-primary transition-colors hover:bg-pressed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
        data-testid={`runtime-scheme-action-${scheme.id}`}
      >
        {actionLabel}
      </button>
    </article>
  );
}

function SearchField({ value, onChange, placeholder, onSubmit }: { value: string; onChange: (value: string) => void; placeholder?: string; onSubmit?: () => void }) {
  return (
    <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border-default bg-elevated px-3 focus-within:border-border-strong focus-within:ring-2 focus-within:ring-accent/10">
      <Search className="h-3.5 w-3.5 shrink-0 text-tertiary" />
      <span className="sr-only">搜索方案</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter' && onSubmit) { event.preventDefault(); onSubmit(); } }}
        placeholder={placeholder ?? '搜索方案、作者或仓库'}
        aria-label="搜索方案"
        className="min-w-0 flex-1 bg-transparent text-[12px] text-primary outline-none placeholder:text-quaternary"
        data-testid="scheme-search"
      />
      {value && <button type="button" onClick={() => onChange('')} className="flex h-6 w-6 items-center justify-center rounded-md text-tertiary hover:bg-hover hover:text-primary" aria-label="清空搜索"><X className="h-3.5 w-3.5" /></button>}
    </label>
  );
}

/** 列表页删除确认（与详情页 RemoveDialog 同一文案口径）。 */
function ListRemoveDialog({ name, isDraft, busy, onCancel, onConfirm }: {
  name: string;
  isDraft: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/35 p-4 animate-overlay-in" data-testid="scheme-list-remove-dialog">
      <div className="w-full max-w-[400px] rounded-lg border border-border-default bg-popover shadow-pop animate-dialog-in" role="dialog" aria-modal="true" aria-labelledby="scheme-list-remove-title">
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
            <button type="button" onClick={onCancel} className="action-button">取消</button>
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

function EmptyList({ surface }: { surface: Surface }) {
  return <div className="col-span-full py-16 text-center"><Search className="mx-auto h-5 w-5 text-quaternary" /><p className="mt-3 text-[12px] text-secondary">没有找到匹配的{surface === 'mine' ? '方案' : '结果'}</p><p className="mt-1 text-[10.5px] text-tertiary">换一个名称、作者或仓库地址试试</p></div>;
}

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <section className="mt-7 first:mt-0">
      <div className="mb-2 flex items-center gap-2 border-b border-border-subtle pb-2">
        <h2 className="text-[13px] font-semibold text-primary">{title}</h2>
        <span className="text-[10px] tabular-nums text-tertiary">{count}</span>
      </div>
      <div className="grid grid-cols-2 gap-x-7 gap-y-1 max-[980px]:grid-cols-1">{children}</div>
    </section>
  );
}

function CreateMenu({ onClose, onChoose }: { onClose: () => void; onChoose: (kind: 'idea' | 'github' | 'history' | 'prompt' | 'import') => void }) {
  const items = [
    { id: 'idea' as const, label: '从一个想法开始', hint: '描述可重复使用的创作方式', icon: Sparkles },
    { id: 'github' as const, label: '从 GitHub 添加', hint: '识别 Skill 或提示词仓库', icon: GitBranch },
    { id: 'history' as const, label: '从历史内容创建', hint: '选择图片、消息与提示词', icon: History },
    { id: 'prompt' as const, label: '从提示词创建', hint: '整理固定规则和变量', icon: Wand2 },
    { id: 'import' as const, label: '导入分享包', hint: '.musefold.design 文件', icon: FileUp },
  ];
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="absolute right-0 top-[calc(100%+6px)] z-30 w-[286px] rounded-lg border border-border-default bg-popover p-1.5 shadow-pop animate-scale-fade-in" role="menu" aria-label="新建方案" data-testid="scheme-create-menu">
      {items.map((item) => { const Icon = item.icon; return <button key={item.id} type="button" role="menuitem" onClick={() => onChoose(item.id)} className="flex min-h-12 w-full items-center gap-3 rounded-md px-2.5 text-left hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25"><Icon className="h-4 w-4 shrink-0 text-secondary" /><span className="min-w-0"><span className="block text-[11.5px] font-medium text-primary">{item.label}</span><span className="block truncate text-[10px] text-tertiary">{item.hint}</span></span></button>; })}
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

/** 发现页市场候选行（开发规范 §5.1：许可证、仓库、更新时间、匹配理由与风险摘要）。 */
function MarketCandidateRow({ candidate, installed, onAdd, onOpenInstalled }: {
  candidate: MarketCandidate;
  installed: DesignSchemeSummary | null;
  onAdd: () => void;
  onOpenInstalled: () => void;
}) {
  return (
    <article className="group grid grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-hover" data-testid={`market-candidate-${candidate.candidateId}`}>
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-border-subtle bg-inset/55 text-secondary" aria-hidden>
        <GitBranch className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[12.5px] font-semibold text-primary">{candidate.fullName}</span>
          {candidate.license && <span className="shrink-0 rounded-full border border-border-subtle px-1.5 py-0.5 text-[9px] text-secondary">{candidate.license}</span>}
        </span>
        <span className="mt-0.5 block truncate text-[10.5px] text-secondary">{candidate.description ?? '仓库未提供描述'}</span>
        <span className="mt-1 flex min-w-0 items-center gap-2 text-[9.5px] text-tertiary">
          <span className="flex shrink-0 items-center gap-1"><Star className="h-3 w-3" />{candidate.stars}</span>
          <span className="shrink-0">{marketUpdatedLabel(candidate.updatedAt)}</span>
          <span className="truncate">· {candidate.matchReason}</span>
        </span>
        {candidate.riskSummary && (
          <span className="mt-1 block truncate text-[9.5px] text-warning" data-testid={`market-risk-${candidate.candidateId}`}>{candidate.riskSummary}</span>
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

/** 添加确认（P3）：展示许可证与风险，确认后进入真实创建管线（下载快照 → Agent 编译草稿）。 */
function MarketInstallDialog({ candidate, onCancel, onConfirm }: { candidate: MarketCandidate; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/35 p-4 animate-overlay-in">
      <div className="w-full max-w-[440px] rounded-lg border border-border-default bg-popover shadow-pop animate-dialog-in" role="dialog" aria-modal="true" aria-labelledby="market-install-title" data-testid="market-install-dialog">
        <div className="flex items-start gap-3 border-b border-border-subtle px-5 py-4">
          <SchemeMark compact />
          <div className="min-w-0 flex-1">
            <h2 id="market-install-title" className="text-[14px] font-semibold text-primary">添加为草稿</h2>
            <p className="mt-1 truncate text-[10.5px] text-tertiary">{candidate.repositoryUrl}</p>
          </div>
          <button type="button" onClick={onCancel} className="icon-action" aria-label="关闭" title="关闭"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-5 py-5">
          <p className="text-[12px] leading-6 text-primary">Musefold 会下载仓库快照，由 Agent 整理成方案草稿。添加后需要完成一次本机试运行，才能正式使用。</p>
          <div className="mt-4 space-y-2 border-y border-border-subtle py-3 text-[11px] text-secondary">
            <p className="flex items-center gap-2"><Scale className="h-3.5 w-3.5" />许可证：{candidate.license ?? '未声明'}</p>
            <p className="flex items-center gap-2"><FileCheck2 className="h-3.5 w-3.5 text-success" />只读取规则、提示词与参考图片</p>
            <p className="flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5 text-success" />不会执行仓库脚本</p>
          </div>
          {candidate.riskSummary && <p className="mt-3 text-[10.5px] leading-5 text-warning">{candidate.riskSummary}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={onCancel} className="action-button">取消</button>
            <button type="button" onClick={onConfirm} className="action-button bg-primary text-background hover:opacity-85" data-testid="market-install-confirm"><Download className="h-3.5 w-3.5" />添加为草稿</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DesignSchemesPage() {
  const setView = useAppStore((state) => state.setView);
  const [surface, setSurface] = useState<Surface>('mine');
  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [historySourceOpen, setHistorySourceOpen] = useState(false);
  const [runtimeSchemes, setRuntimeSchemes] = useState<DesignSchemeSummary[]>([]);
  const [runtimeDetailId, setRuntimeDetailId] = useState<string | null>(null);
  const [runtimeLoading, setRuntimeLoading] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  // 市场搜索（Explorer）：只在用户显式发起时请求，不自动加载远程列表。
  const [marketResult, setMarketResult] = useState<MarketSearchResult | null>(null);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [installCandidate, setInstallCandidate] = useState<MarketCandidate | null>(null);
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string; isDraft: boolean } | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const attachSchemeRun = useSchemeRunStore((state) => state.attach);
  const createRootRef = useRef<HTMLDivElement>(null);
  const loadRuntimeSchemes = async () => {
    setRuntimeLoading(true);
    setRuntimeError(null);
    try {
      const result = await api.designScheme.list();
      if (result.ok) {
        setRuntimeSchemes(result.data);
      } else {
        setRuntimeError(result.error.message);
      }
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : '读取设计方案失败');
    } finally {
      setRuntimeLoading(false);
    }
  };

  // 导入 .musefold.design 分享包（设计规范 §7）：校验后生成新草稿并直达详情。
  const importSharePackage = async () => {
    const result = await api.designScheme.importScheme();
    if (!result.ok) {
      toast.error('导入失败', result.error.message);
      return;
    }
    if (result.data.cancelled || !result.data.scheme) return;
    const scheme = result.data.scheme;
    setRuntimeSchemes((prev) => [scheme, ...prev.filter((item) => item.id !== scheme.id)]);
    setSurface('mine');
    setRuntimeDetailId(scheme.id);
    toast.success('分享包已导入', '已生成方案草稿；完成一次本机试运行后可设为正式。');
  };
  const normalized = query.trim().toLowerCase();
  const filteredRuntimeSchemes = useMemo(() => runtimeSchemes.filter((scheme) => !normalized
    || [scheme.name, scheme.summary, scheme.sourceLabel].join(' ').toLowerCase().includes(normalized)), [normalized, runtimeSchemes]);
  const runtimeDrafts = filteredRuntimeSchemes.filter((scheme) => scheme.status === 'draft');
  const runtimeFormal = filteredRuntimeSchemes.filter((scheme) => scheme.status === 'formal');
  const mineEmpty = filteredRuntimeSchemes.length === 0;
  const runRuntimeScheme = (scheme: DesignSchemeSummary) => {
    void attachSchemeRun(scheme, scheme.status === 'formal' ? 'formal' : 'trial');
  };

  const confirmRemove = async () => {
    if (!removeTarget || removeBusy) return;
    setRemoveBusy(true);
    try {
      const result = await api.designScheme.remove(removeTarget.id);
      if (!result.ok) {
        toast.error(removeTarget.isDraft ? '删除草稿失败' : '移除方案失败', result.error.message);
        return;
      }
      setRuntimeSchemes((prev) => prev.filter((scheme) => scheme.id !== removeTarget.id));
      setRemoveTarget(null);
      toast.success(removeTarget.isDraft ? '草稿已删除' : '方案已移除', '已生成的图片仍保留在历史与图库中。');
    } finally {
      setRemoveBusy(false);
    }
  };

  const runMarketSearch = async (term?: string) => {
    const keyword = (term ?? query).trim();
    if (!keyword) {
      toast.show({ title: '输入想找的方向', description: '例如「插画 skill」「poster prompt」，再点搜索市场。' });
      return;
    }
    if (term) setQuery(term);
    setMarketLoading(true);
    setMarketError(null);
    try {
      const result = await api.designScheme.marketSearch(keyword);
      if (result.ok) {
        setMarketResult(result.data);
      } else {
        setMarketResult(null);
        setMarketError(result.error.message);
      }
    } catch (error) {
      setMarketResult(null);
      setMarketError(error instanceof Error ? error.message : '搜索市场失败');
    } finally {
      setMarketLoading(false);
    }
  };

  /** 添加候选：进入真实创建管线（下载快照 → Agent 编译草稿），过程在 Composer 呈现。 */
  const addMarketCandidate = async (candidate: MarketCandidate) => {
    setInstallCandidate(null);
    setView('generate');
    const started = await useSchemeCreationStore.getState().start('', [candidate.repositoryUrl]);
    if (!started) {
      toast.show({ title: '有创建任务正在进行', description: '等当前方案创建完成后再添加新的候选。' });
    }
  };

  const findInstalled = (candidate: MarketCandidate): DesignSchemeSummary | null =>
    runtimeSchemes.find((scheme) => scheme.sourceLabel === candidate.fullName) ?? null;

  useEffect(() => {
    void loadRuntimeSchemes();
    // Composer「查看详情 / 浏览全部 / 前往发现」等跨视图跳转在挂载时消费一次。
    const intent = useAppStore.getState().consumeSchemeCenterIntent();
    if (intent?.surface) setSurface(intent.surface);
    if (intent?.detailId) setRuntimeDetailId(intent.detailId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadRuntimeSchemes 是本组件内的稳定函数
  }, []);

  useEffect(() => {
    if (!createOpen) return;
    const onPointerDown = (event: PointerEvent) => { if (!createRootRef.current?.contains(event.target as Node)) setCreateOpen(false); };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [createOpen]);

  const chooseCreate = (kind: 'idea' | 'github' | 'history' | 'prompt' | 'import') => {
    setCreateOpen(false);
    if (kind === 'github') {
      setView('generate');
      toast.show({ title: '粘贴 GitHub Skill 地址', description: '在 Composer 中粘贴公开仓库、Skill 目录或 SKILL.md 地址。', variant: 'accent' });
      return;
    }
    if (kind === 'history') {
      setHistorySourceOpen(true);
      return;
    }
    if (kind === 'import') {
      void importSharePackage();
      return;
    }
    if (kind === 'idea') {
      // 想法创建走真实 Agent 管线：挂上指令芯片，回到 Composer 补想法后提交。
      useGenerationWorkbenchStore.getState().setDraftCommand('design-plan');
      setView('generate');
      toast.show({ title: '描述你的方案想法', description: '输入想法后发送，Agent 会创建方案草稿；也可以附上 GitHub Skill 地址。', variant: 'accent' });
      return;
    }
    // 从提示词创建：同一条真实管线，预置整理提示词的说明，用户粘贴提示词后发送。
    const workbench = useGenerationWorkbenchStore.getState();
    workbench.setDraftCommand('design-plan');
    workbench.setDraftPrompt('把下面这段提示词整理成一个可复用方案，区分固定规则、必需变量和可选补充：\n\n');
    setView('generate');
    toast.show({ title: '粘贴你的提示词', description: '在说明后粘贴提示词并发送，Agent 会整理成方案草稿。', variant: 'accent' });
  };

  const runtimeDetail = runtimeDetailId ? runtimeSchemes.find((scheme) => scheme.id === runtimeDetailId) ?? null : null;
  if (runtimeDetail) {
    return (
      <div className="h-full bg-elevated" data-testid="design-schemes-page">
        <SchemeRuntimeDetail
          scheme={runtimeDetail}
          onBack={() => setRuntimeDetailId(null)}
          onChanged={(updated) => setRuntimeSchemes((prev) => prev.map((scheme) => scheme.id === updated.id ? updated : scheme))}
          onRemoved={() => {
            setRuntimeSchemes((prev) => prev.filter((scheme) => scheme.id !== runtimeDetail.id));
            setRuntimeDetailId(null);
          }}
        />
      </div>
    );
  }

  return (
    <div className="relative h-full overflow-y-auto bg-elevated" data-testid="design-schemes-page">
      <div className="mx-auto w-full max-w-[960px] px-6 pb-16 pt-5 max-[640px]:px-4">
        <div className="flex items-center gap-3">
          <div className="flex rounded-md bg-inset p-0.5" role="tablist" aria-label="方案范围">
            <button type="button" role="tab" aria-selected={surface === 'mine'} onClick={() => setSurface('mine')} className={cn('min-h-8 rounded-md px-3 text-[11px] font-medium transition-colors', surface === 'mine' ? 'bg-elevated text-primary shadow-sm' : 'text-tertiary hover:text-primary')} data-testid="scheme-surface-mine">我的方案</button>
            <button type="button" role="tab" aria-selected={surface === 'discover'} onClick={() => setSurface('discover')} className={cn('min-h-8 rounded-md px-3 text-[11px] font-medium transition-colors', surface === 'discover' ? 'bg-elevated text-primary shadow-sm' : 'text-tertiary hover:text-primary')} data-testid="scheme-surface-explore">发现</button>
          </div>
          <button type="button" onClick={() => { void loadRuntimeSchemes(); }} disabled={runtimeLoading} className="ml-auto icon-action h-8 w-8" aria-label="刷新方案" title="刷新方案"><RefreshCw className={cn('h-3.5 w-3.5', runtimeLoading && 'animate-spin')} /></button>
          <div className="relative" ref={createRootRef}><button type="button" onClick={() => setCreateOpen((value) => !value)} className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[11px] font-semibold text-background hover:opacity-85" aria-haspopup="menu" aria-expanded={createOpen} data-testid="scheme-create"><Plus className="h-3.5 w-3.5" />新建<ChevronDown className="h-3.5 w-3.5" /></button>{createOpen && <CreateMenu onClose={() => setCreateOpen(false)} onChoose={chooseCreate} />}</div>
        </div>
        <div className="mt-5 flex items-center gap-2">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder={surface === 'discover' ? '想找什么方向？例如「插画 skill」' : undefined}
            onSubmit={surface === 'discover' ? () => { void runMarketSearch(); } : undefined}
          />
          {surface === 'discover' && (
            <button
              type="button"
              onClick={() => { void runMarketSearch(); }}
              disabled={marketLoading}
              className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border-default px-3 text-[11px] font-medium text-primary transition-colors hover:bg-hover disabled:opacity-60"
              data-testid="market-search-run"
            >
              {marketLoading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              搜索市场
            </button>
          )}
        </div>
        {runtimeError && surface === 'mine' && <div className="mt-4 rounded-md border border-danger/25 bg-danger/5 px-3 py-2 text-[10.5px] text-danger">{runtimeError}</div>}
        {surface === 'mine' ? <div className="mt-7">{runtimeLoading && mineEmpty ? <div className="py-16 text-center text-[11px] text-tertiary">正在读取方案…</div> : mineEmpty ? <div className="grid"><EmptyList surface={surface} /></div> : <><Section title="草稿" count={runtimeDrafts.length}>{runtimeDrafts.map((scheme) => <RuntimeSchemeRow key={scheme.id} scheme={scheme} onOpen={() => setRuntimeDetailId(scheme.id)} onRun={() => runRuntimeScheme(scheme)} onRemove={() => setRemoveTarget({ id: scheme.id, name: scheme.name, isDraft: true })} />)}</Section><Section title="正式" count={runtimeFormal.length}>{runtimeFormal.map((scheme) => <RuntimeSchemeRow key={scheme.id} scheme={scheme} onOpen={() => setRuntimeDetailId(scheme.id)} onRun={() => runRuntimeScheme(scheme)} onRemove={() => setRemoveTarget({ id: scheme.id, name: scheme.name, isDraft: false })} />)}</Section></>}</div> : (
          <div className="mt-7" data-testid="market-discover">
            {marketLoading ? (
              <div className="py-16 text-center text-[11px] text-tertiary">正在搜索 GitHub 市场…</div>
            ) : marketError ? (
              <div className="mx-auto max-w-[420px] py-14 text-center">
                <p className="text-[12px] font-medium text-primary">搜索市场失败</p>
                <p className="mt-1.5 text-[10.5px] leading-5 text-tertiary">{marketError}</p>
                <button type="button" onClick={() => { void runMarketSearch(); }} className="action-button mx-auto mt-4">重试</button>
              </div>
            ) : marketResult ? (
              <>
                {marketResult.fromCache && (
                  <p className="mb-3 rounded-md border border-border-subtle bg-inset/45 px-3 py-2 text-[10.5px] text-secondary" data-testid="market-cache-notice">网络暂不可用，以下是最近一次搜索的候选缓存。</p>
                )}
                <Section title={`「${marketResult.query}」的候选`} count={marketResult.candidates.length}>
                  {marketResult.candidates.map((candidate) => {
                    const installed = findInstalled(candidate);
                    return (
                      <MarketCandidateRow
                        key={candidate.candidateId}
                        candidate={candidate}
                        installed={installed}
                        onAdd={() => setInstallCandidate(candidate)}
                        onOpenInstalled={() => installed && setRuntimeDetailId(installed.id)}
                      />
                    );
                  })}
                </Section>
                {marketResult.candidates.length === 0 && <div className="grid"><EmptyList surface={surface} /></div>}
              </>
            ) : (
              <div className="mx-auto max-w-[460px] py-14 text-center">
                <Search className="mx-auto h-5 w-5 text-quaternary" />
                <p className="mt-3 text-[12px] font-medium text-primary">从 GitHub 市场寻找设计方案</p>
                <p className="mt-1.5 text-[10.5px] leading-5 text-tertiary">输入创作方向后点「搜索市场」。候选会显示许可证与风险提示，添加后需要本机试运行才能正式使用。</p>
                <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                  {['插画 skill', 'poster prompt', 'illustration style'].map((suggestion) => (
                    <button key={suggestion} type="button" onClick={() => { void runMarketSearch(suggestion); }} className="rounded-full border border-border-subtle px-2.5 py-1 text-[10px] text-secondary transition-colors hover:bg-hover hover:text-primary">
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      {installCandidate && <MarketInstallDialog candidate={installCandidate} onCancel={() => setInstallCandidate(null)} onConfirm={() => { void addMarketCandidate(installCandidate); }} />}
      {removeTarget && (
        <ListRemoveDialog
          name={removeTarget.name}
          isDraft={removeTarget.isDraft}
          busy={removeBusy}
          onCancel={() => setRemoveTarget(null)}
          onConfirm={() => void confirmRemove()}
        />
      )}
      {historySourceOpen && (
        <HistorySourcePicker
          onCancel={() => setHistorySourceOpen(false)}
          onConfirm={({ items, note }) => {
            setHistorySourceOpen(false);
            // 真实创建路径：历史来源挂到 design-plan 指令上，提取说明进入 Composer 正文可继续编辑。
            const workbench = useGenerationWorkbenchStore.getState();
            workbench.setDraftCommand('design-plan');
            workbench.setDraftHistorySource({ items });
            workbench.setDraftPrompt(note);
            setView('generate');
            toast.show({ title: '历史来源已就绪', description: '确认提取说明后发送，Agent 会生成方案草稿。', variant: 'accent' });
          }}
        />
      )}
    </div>
  );
}
