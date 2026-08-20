/**
 * 真实设计方案详情页（v0.3.2，UI 规范 §4/§5）。
 *
 * 数据来自 design-scheme 库：版本文档（输入/规则/来源/编译记录）+ 相册资产。
 * 普通信息优先回答「能做什么、需要什么、来自哪里」；Skill 文件、commit、
 * 模型等收入折叠的「技术详情」。
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  Blocks,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  File,
  FileCheck2,
  FileImage,
  FileText,
  FolderOpen,
  GitBranch,
  Images,
  Loader2,
  MoreHorizontal,
  Pencil,
  Play,
  RefreshCw,
  Share2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from '../../components/ui/icons';
import { cn } from '../../lib/utils';
import { toImageSrc } from '../../lib/media';
import api from '../../lib/ipc';
import { toast } from '../../stores/toast';
import type {
  DesignSchemeAssetSummary,
  DesignSchemeSourceSnapshotDetail,
  DesignSchemeSummary,
} from '@shared/types/design-scheme';
import type {
  ConstraintDomain,
  ConstraintMode,
  DesignSchemeRevisionDocument,
  ImageRole,
  InputKind,
  SourceKind,
} from '@musefold/desktop-contracts/design-scheme/schema';
import { useSchemeCreationStore } from './creationStore';
import { useSchemeRunStore } from './runStore';

const FIDELITY_LABEL: Record<string, string> = {
  verified: '已验证',
  faithful: '完整还原',
  adapted: '有取舍',
  unsupported: '暂不支持',
};

const CONSTRAINT_DOMAIN_LABEL: Record<ConstraintDomain, string> = {
  composition: '构图',
  color: '色彩',
  typography: '文字',
  texture: '质感',
  subject: '主体',
  output: '输出',
  safety: '安全',
};

const CONSTRAINT_MODE_LABEL: Record<ConstraintMode, string> = {
  required: '必须',
  preferred: '优先',
  avoid: '避免',
};

const INPUT_KIND_LABEL: Record<InputKind, string> = {
  text: '文本',
  image: '图片',
  'image-set': '图组',
  article: '文章',
  choice: '选择',
};

const IMAGE_ROLE_LABEL: Record<ImageRole, string> = {
  'edit-target': '待编辑主图',
  'subject-reference': '主体参考',
  'style-reference': '风格参考',
  'layout-reference': '版式参考',
  'content-reference': '内容参考',
};

const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  'github-skill': 'GitHub Skill',
  'github-prompt-repo': 'GitHub 提示词仓库',
  'github-readme': 'GitHub README',
  'history-image': '历史图片',
  'conversation-turn': '历史对话',
  'user-brief': '用户想法',
  'reference-image': '参考图',
};

const ASSET_ORIGIN_LABEL: Record<DesignSchemeAssetSummary['origin'], string> = {
  'local-run': '本机生成',
  'repo-example': '仓库示例',
};

function DetailSection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-border-subtle pt-5">
      <div className="flex min-h-7 items-center justify-between gap-3">
        <h2 className="text-[13px] font-semibold text-primary">{title}</h2>
        {action}
      </div>
      <div className="mt-3 text-[11.5px] leading-6 text-secondary">{children}</div>
    </section>
  );
}

/** 折叠相册：封面在前，点击后层切换查看，前层点开全屏（UI 规范 §5.1）。 */
function RuntimeAlbum({
  assets,
  coverAssetId,
  onSetCover,
  coverBusy,
}: {
  assets: DesignSchemeAssetSummary[];
  coverAssetId: string | null;
  onSetCover: (assetId: string) => void;
  coverBusy: boolean;
}) {
  const [activeId, setActiveId] = useState(coverAssetId ?? assets[0]?.id ?? '');
  const [lightbox, setLightbox] = useState<DesignSchemeAssetSummary | null>(null);
  useEffect(() => setActiveId(coverAssetId ?? assets[0]?.id ?? ''), [coverAssetId, assets]);

  if (assets.length === 0) {
    return (
      <div className="flex min-h-[280px] flex-col items-center justify-center rounded-md border border-dashed border-border-default bg-inset/35 px-6 text-center">
        <Images className="h-6 w-6 text-quaternary" />
        <p className="mt-3 text-[12px] font-medium text-primary">还没有本机试运行结果</p>
        <p className="mt-1 text-[10.5px] text-tertiary">完成一次试运行后，这里会展示生成的示例。</p>
      </div>
    );
  }

  const activeIndex = Math.max(0, assets.findIndex((asset) => asset.id === activeId));
  const active = assets[activeIndex] ?? assets[0];
  const behind = Array.from(
    { length: Math.min(3, assets.length - 1) },
    (_, offset) => assets[(activeIndex + offset + 1) % assets.length],
  );
  const previous = () => setActiveId(assets[(activeIndex - 1 + assets.length) % assets.length].id);
  const next = () => setActiveId(assets[(activeIndex + 1) % assets.length].id);

  return (
    <>
      <div className="mx-auto w-full max-w-[660px]" data-testid="runtime-scheme-album">
        <div className="relative mr-6 mb-6 min-h-[300px] max-[720px]:mr-3 max-[720px]:mb-3">
          {[...behind].reverse().map((asset, reverseIndex) => {
            const depth = behind.length - reverseIndex;
            return (
              <button
                key={asset.id}
                type="button"
                onClick={() => setActiveId(asset.id)}
                className="absolute inset-0 overflow-hidden rounded-md border border-border-default bg-elevated transition-transform duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
                style={{ transform: `translate(${depth * 7}px, ${depth * 7}px)`, zIndex: 5 - depth }}
                aria-label="查看这张示例"
              >
                <img src={toImageSrc(asset.path)} alt="" className="h-full w-full object-contain opacity-70" />
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setLightbox(active)}
            className="relative z-10 flex h-[min(48dvh,440px)] min-h-[300px] w-full cursor-zoom-in items-center justify-center overflow-hidden rounded-md border border-border-default bg-inset/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
            aria-label="全屏查看当前示例"
          >
            <img src={toImageSrc(active.path)} alt="方案示例" className="h-full w-full object-contain" />
          </button>
        </div>
        <div className="flex min-h-8 items-center gap-2 text-[10.5px] text-tertiary">
          <span>{ASSET_ORIGIN_LABEL[active.origin]}</span>
          <span>·</span>
          <span className="tabular-nums">{activeIndex + 1} / {assets.length}</span>
          {active.id === coverAssetId && <span className="rounded-full border border-border-subtle px-1.5 py-0.5 text-[9px]">封面</span>}
          <div className="ml-auto flex items-center gap-1">
            {active.id !== coverAssetId && (
              <button
                type="button"
                disabled={coverBusy}
                onClick={() => onSetCover(active.id)}
                className="mr-2 min-h-8 rounded-md px-2 text-[10.5px] font-medium text-primary hover:bg-hover disabled:cursor-wait disabled:opacity-50"
                data-testid="runtime-scheme-set-cover"
              >
                设为封面
              </button>
            )}
            <button type="button" onClick={previous} className="icon-action" title="上一张" aria-label="上一张"><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" onClick={next} className="icon-action" title="下一张" aria-label="下一张"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      </div>
      {lightbox && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-6 animate-overlay-in"
          role="dialog"
          aria-modal="true"
          aria-label="方案示例全屏预览"
          onClick={() => setLightbox(null)}
        >
          <img src={toImageSrc(lightbox.path)} alt="方案示例" className="max-h-full max-w-full object-contain" />
          <button
            type="button"
            onClick={() => setLightbox(null)}
            className="absolute right-5 top-5 flex h-10 w-10 items-center justify-center rounded-full bg-white/12 text-white hover:bg-white/20"
            aria-label="关闭全屏预览"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
    </>
  );
}

const PACKAGE_KIND_LABEL: Record<DesignSchemeSourceSnapshotDetail['packageKind'], string> = {
  github: 'GitHub 快照',
  history: '历史内容',
  'user-brief': '用户想法',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 「查看来源」层：展示锁定的来源快照与固化文件清单（UI 规范 §4.2）。 */
function SourceSnapshotDialog({
  scheme,
  briefExcerpt,
  onClose,
}: {
  scheme: DesignSchemeSummary;
  briefExcerpt: string | null;
  onClose: () => void;
}) {
  const [snapshots, setSnapshots] = useState<DesignSchemeSourceSnapshotDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const result = await api.designScheme.listSourceFiles(scheme.id);
      if (!alive) return;
      if (result.ok) setSnapshots(result.data);
      else setError(result.error.message);
    })();
    return () => { alive = false; };
  }, [scheme.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/35 p-4 animate-overlay-in" data-testid="scheme-source-dialog">
      <div className="flex max-h-[min(600px,88dvh)] w-full max-w-[560px] flex-col rounded-lg border border-border-default bg-popover shadow-pop animate-dialog-in" role="dialog" aria-modal="true" aria-labelledby="scheme-source-title">
        <div className="flex items-start gap-3 border-b border-border-subtle px-5 py-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-inset text-secondary"><FolderOpen className="h-4 w-4" /></span>
          <div className="min-w-0 flex-1">
            <h2 id="scheme-source-title" className="text-[14px] font-semibold text-primary">方案来源</h2>
            <p className="mt-1 text-[10.5px] text-tertiary">来源快照在创建时锁定，之后不会变化，也不会执行其中的脚本。</p>
          </div>
          <button type="button" onClick={onClose} className="icon-action" aria-label="关闭" title="关闭"><X className="h-4 w-4" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-[11px] leading-6 text-secondary">
          {error ? (
            <div className="rounded-md border border-danger/25 bg-danger/5 px-3 py-2 text-[10.5px] text-danger">{error}</div>
          ) : !snapshots ? (
            <div className="flex items-center justify-center gap-2 py-10 text-tertiary"><Loader2 className="h-4 w-4 animate-spin" />正在读取来源快照…</div>
          ) : (
            <div className="space-y-5">
              {briefExcerpt && (
                <div>
                  <p className="flex items-center gap-1.5 font-medium text-primary"><Sparkles className="h-3.5 w-3.5" />你的想法</p>
                  <p className="mt-1 whitespace-pre-wrap rounded-md bg-inset/55 px-3 py-2 text-[10.5px] leading-5">{briefExcerpt}</p>
                </div>
              )}
              {snapshots.length === 0 && !briefExcerpt && (
                <p className="py-8 text-center text-tertiary">这个方案没有外部来源快照。</p>
              )}
              {snapshots.map((snapshot) => (
                <div key={snapshot.snapshotId} data-testid={`scheme-source-snapshot-${snapshot.snapshotId}`}>
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-medium text-primary">
                    {snapshot.packageKind === 'github' ? <GitBranch className="h-3.5 w-3.5" /> : <FolderOpen className="h-3.5 w-3.5" />}
                    {PACKAGE_KIND_LABEL[snapshot.packageKind]}
                    {snapshot.repositoryUrl && (
                      <button type="button" onClick={() => window.open(snapshot.repositoryUrl!, '_blank', 'noopener,noreferrer')} className="inline-flex items-center gap-1 text-[10.5px] font-normal text-primary hover:underline">
                        <ExternalLink className="h-3 w-3" />{snapshot.repositoryUrl.replace(/^https:\/\/github\.com\//, '')}
                      </button>
                    )}
                  </p>
                  <p className="mt-0.5 text-[10px] text-tertiary">
                    {snapshot.commitHash ? `commit ${snapshot.commitHash.slice(0, 10)}` : `引用 ${snapshot.ref}`}
                    {snapshot.license ? ` · ${snapshot.license}` : ''}
                    {` · 固化于 ${new Date(snapshot.createdAt).toLocaleString()}`}
                  </p>
                  <ul className="mt-2 space-y-0.5 border-l border-border-subtle pl-3">
                    {snapshot.files.map((file) => (
                      <li key={file.path} className="text-[10.5px]">
                        {file.kind === 'text' && file.textExcerpt ? (
                          <details>
                            <summary className="flex cursor-pointer list-none items-center gap-1.5">
                              <FileText className="h-3 w-3 shrink-0 text-tertiary" />
                              <span className="min-w-0 truncate text-primary">{file.path}</span>
                              <span className="shrink-0 text-tertiary">{formatBytes(file.sizeBytes)}</span>
                            </summary>
                            <pre className="mt-1 max-h-44 overflow-y-auto whitespace-pre-wrap rounded-md bg-inset/55 px-2.5 py-2 font-mono text-[9.5px] leading-4 text-secondary">{file.textExcerpt}</pre>
                          </details>
                        ) : (
                          <span className="flex items-center gap-1.5">
                            {file.kind === 'image' ? <FileImage className="h-3 w-3 shrink-0 text-tertiary" /> : <File className="h-3 w-3 shrink-0 text-tertiary" />}
                            <span className="min-w-0 truncate text-primary">{file.path}</span>
                            <span className="shrink-0 text-tertiary">{formatBytes(file.sizeBytes)}</span>
                          </span>
                        )}
                      </li>
                    ))}
                    {snapshot.files.length === 0 && <li className="text-[10px] text-tertiary">快照内没有文件</li>}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 重命名层：只改展示名，编译产物不变（UI 规范 §4.2）。 */
function RenameDialog({
  scheme,
  onClose,
  onRenamed,
}: {
  scheme: DesignSchemeSummary;
  onClose: () => void;
  onRenamed: (updated: DesignSchemeSummary) => void;
}) {
  const [value, setValue] = useState(scheme.name);
  const [busy, setBusy] = useState(false);
  const trimmed = value.trim();

  const submit = async () => {
    if (!trimmed || trimmed === scheme.name || busy) return;
    setBusy(true);
    const result = await api.designScheme.rename(scheme.id, trimmed);
    setBusy(false);
    if (!result.ok) {
      toast.error('重命名失败', result.error.message);
      return;
    }
    onRenamed(result.data);
    onClose();
    toast.success('已重命名', `方案现在叫「${result.data.name}」。`);
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/35 p-4 animate-overlay-in" data-testid="scheme-rename-dialog">
      <div className="w-full max-w-[400px] rounded-lg border border-border-default bg-popover shadow-pop animate-dialog-in" role="dialog" aria-modal="true" aria-labelledby="scheme-rename-title">
        <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-5 py-4">
          <h2 id="scheme-rename-title" className="text-[14px] font-semibold text-primary">重命名方案</h2>
          <button type="button" onClick={onClose} className="icon-action" aria-label="关闭" title="关闭"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-5 py-4">
          <input
            autoFocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submit();
              if (event.key === 'Escape') onClose();
            }}
            maxLength={80}
            className="w-full rounded-md border border-border-subtle bg-inset px-3 py-2 text-[12px] text-primary outline-none focus:border-accent/50"
            data-testid="scheme-rename-input"
          />
          <p className="mt-2 text-[10px] text-tertiary">只影响展示名称；方案规则与版本记录保持不变。</p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="action-button">取消</button>
            <button
              type="button"
              disabled={!trimmed || trimmed === scheme.name || busy}
              onClick={() => void submit()}
              className="action-button bg-primary text-background hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-45"
              data-testid="scheme-rename-confirm"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 删除草稿 / 移除方案确认层：危险操作，明确说明保留内容。 */
function RemoveDialog({
  scheme,
  onClose,
  onRemoved,
}: {
  scheme: DesignSchemeSummary;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const isDraft = scheme.status === 'draft';

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    const result = await api.designScheme.remove(scheme.id);
    setBusy(false);
    if (!result.ok) {
      toast.error(isDraft ? '删除草稿失败' : '移除方案失败', result.error.message);
      return;
    }
    onClose();
    onRemoved();
    toast.success(isDraft ? '草稿已删除' : '方案已移除', '已生成的图片仍保留在历史与图库中。');
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/35 p-4 animate-overlay-in" data-testid="scheme-remove-dialog">
      <div className="w-full max-w-[400px] rounded-lg border border-border-default bg-popover shadow-pop animate-dialog-in" role="dialog" aria-modal="true" aria-labelledby="scheme-remove-title">
        <div className="px-5 py-5">
          <h2 id="scheme-remove-title" className="text-[14px] font-semibold text-primary">
            {isDraft ? `删除草稿「${scheme.name}」？` : `移除方案「${scheme.name}」？`}
          </h2>
          <p className="mt-2 text-[11px] leading-5 text-secondary">
            {isDraft
              ? '草稿与它的运行记录会从方案库移除；已生成的图片仍保留在历史与图库中。'
              : '方案会从方案库移除，之后无法直接在 Composer 中使用；已生成的图片仍保留在历史与图库中。'}
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="action-button">取消</button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void submit()}
              className="action-button bg-danger text-on-danger hover:brightness-105 disabled:cursor-wait disabled:opacity-45"
              data-testid="scheme-remove-confirm"
            >
              {isDraft ? '删除草稿' : '移除方案'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 详情操作菜单（UI 规范 §4.2）：主动作之外的操作收进 ...；危险操作垫底分隔。 */
function SchemeActionMenu({
  scheme,
  onModify,
  onRename,
  onViewSource,
  onCheckUpdate,
  checkUpdateBusy,
  onExport,
  exportBusy,
  onRemove,
}: {
  scheme: DesignSchemeSummary;
  /** 正式方案菜单首项「在 Composer 中修改」；草稿的修改入口在标题栏。 */
  onModify: (() => void) | null;
  onRename: () => void;
  onViewSource: () => void;
  /** 只有 GitHub 来源的方案提供「检查更新」。 */
  onCheckUpdate: (() => void) | null;
  checkUpdateBusy: boolean;
  /** 导出 .musefold.design 分享包（设计规范 §7）：仅正式方案。 */
  onExport: (() => void) | null;
  exportBusy: boolean;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const isDraft = scheme.status === 'draft';

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const choose = (action: () => void) => { setOpen(false); action(); };

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="icon-action h-8 w-8"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="更多操作"
        title="更多操作"
        data-testid="runtime-scheme-menu"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-30 w-[200px] rounded-lg border border-border-default bg-popover p-1.5 shadow-pop animate-scale-fade-in" role="menu" aria-label="方案操作" data-testid="runtime-scheme-menu-list">
          {onModify && (
            <button type="button" role="menuitem" onClick={() => choose(onModify)} className="flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[11.5px] text-primary hover:bg-hover" data-testid="runtime-scheme-menu-modify">
              <Pencil className="h-3.5 w-3.5 shrink-0 text-secondary" />在 Composer 中修改
            </button>
          )}
          {isDraft && (
            <button type="button" role="menuitem" onClick={() => choose(onRename)} className="flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[11.5px] text-primary hover:bg-hover" data-testid="runtime-scheme-menu-rename">
              <Pencil className="h-3.5 w-3.5 shrink-0 text-secondary" />重命名
            </button>
          )}
          <button type="button" role="menuitem" onClick={() => choose(onViewSource)} className="flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[11.5px] text-primary hover:bg-hover" data-testid="runtime-scheme-menu-source">
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-secondary" />查看来源
          </button>
          {onCheckUpdate && (
            <button
              type="button"
              role="menuitem"
              disabled={checkUpdateBusy}
              onClick={() => choose(onCheckUpdate)}
              className="flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[11.5px] text-primary hover:bg-hover disabled:cursor-wait disabled:opacity-50"
              data-testid="runtime-scheme-menu-check-update"
            >
              {checkUpdateBusy ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-secondary" /> : <RefreshCw className="h-3.5 w-3.5 shrink-0 text-secondary" />}
              检查更新
            </button>
          )}
          {onExport && (
            <button
              type="button"
              role="menuitem"
              disabled={exportBusy}
              onClick={() => choose(onExport)}
              className="flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[11.5px] text-primary hover:bg-hover disabled:cursor-wait disabled:opacity-50"
              data-testid="runtime-scheme-menu-export"
            >
              {exportBusy ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-secondary" /> : <Share2 className="h-3.5 w-3.5 shrink-0 text-secondary" />}
              导出分享包
            </button>
          )}
          <div className="my-1.5 border-t border-border-subtle" role="separator" />
          <button type="button" role="menuitem" onClick={() => choose(onRemove)} className="flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[11.5px] text-danger hover:bg-danger/10" data-testid="runtime-scheme-menu-remove">
            <Trash2 className="h-3.5 w-3.5 shrink-0" />{isDraft ? '删除草稿' : '移除方案'}
          </button>
        </div>
      )}
    </div>
  );
}

export function SchemeRuntimeDetail({
  scheme,
  onBack,
  onChanged,
  onRemoved,
}: {
  scheme: DesignSchemeSummary;
  onBack: () => void;
  onChanged: (updated: DesignSchemeSummary) => void;
  /** 删除草稿 / 移除方案成功后由父级刷新列表并返回。 */
  onRemoved: () => void;
}) {
  const attachSchemeRun = useSchemeRunStore((state) => state.attach);
  const attachSchemeModify = useSchemeCreationStore((state) => state.attachModify);
  const [document, setDocument] = useState<DesignSchemeRevisionDocument | null>(null);
  const [assets, setAssets] = useState<DesignSchemeAssetSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const [formalizeBusy, setFormalizeBusy] = useState(false);
  const [checkUpdateBusy, setCheckUpdateBusy] = useState(false);
  const [promoteBusy, setPromoteBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  /** 输入槽位编辑态（草稿限定）：staged 修改，保存时一次性生成新 revision。 */
  const [inputEdits, setInputEdits] = useState<Array<{ id: string; required: boolean; removed: boolean }> | null>(null);
  const [inputSaveBusy, setInputSaveBusy] = useState(false);
  /** §4.2 操作菜单打开的层：重命名 / 查看来源 / 删除（移除）确认。 */
  const [renameOpen, setRenameOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    setDocument(null);
    setLoadError(null);
    setInputEdits(null);
    void (async () => {
      const [revision, assetList] = await Promise.all([
        api.designScheme.getRevision(scheme.currentRevisionId),
        api.designScheme.listAssets(scheme.id),
      ]);
      if (!alive) return;
      if (revision.ok) setDocument(revision.data);
      else setLoadError(revision.error.message);
      if (assetList.ok) setAssets(assetList.data);
    })();
    return () => { alive = false; };
  }, [scheme.id, scheme.currentRevisionId]);

  // 封面固定排在最前，其余按时间倒序（UI 规范 §5.2）。
  const orderedAssets = useMemo(() => assets.slice().sort((a, b) => {
    if (a.id === scheme.coverAssetId) return -1;
    if (b.id === scheme.coverAssetId) return 1;
    return b.createdAt - a.createdAt;
  }), [assets, scheme.coverAssetId]);

  const repoSource = document?.sources.find((source) => source.kind.startsWith('github') && source.uri);
  const canFormalize = scheme.status === 'draft' && scheme.hasSuccessfulTrial && Boolean(scheme.coverAssetId);

  // 被 promptProgram 模板引用的文本槽位不可删除（会留下无法填充的 {{变量}}）。
  const templateBoundIds = useMemo(() => {
    if (!document) return new Set<string>();
    const variables = new Set(document.promptProgram.flatMap((module) => module.variables));
    return new Set(
      document.inputs
        .filter((slot) => (slot.kind === 'text' || slot.kind === 'article' || slot.kind === 'choice') && variables.has(slot.id))
        .map((slot) => slot.id),
    );
  }, [document]);

  const inputEditsDirty = useMemo(() => {
    if (!inputEdits || !document) return false;
    return inputEdits.some((edit) => {
      const base = document.inputs.find((slot) => slot.id === edit.id);
      return edit.removed || (base && base.required !== edit.required);
    });
  }, [inputEdits, document]);

  const beginInputEdit = () => {
    if (!document) return;
    setInputEdits(document.inputs.map((slot) => ({ id: slot.id, required: slot.required, removed: false })));
  };

  const saveInputEdits = async () => {
    if (!document || !inputEdits || inputSaveBusy) return;
    setInputSaveBusy(true);
    const kept = inputEdits.filter((edit) => !edit.removed).map((edit) => ({ id: edit.id, required: edit.required }));
    const result = await api.designScheme.updateInputs(scheme.id, document.revisionId, kept);
    setInputSaveBusy(false);
    if (!result.ok) {
      toast.error('保存失败', result.error.message);
      return;
    }
    setDocument(result.data.document);
    setInputEdits(null);
    onChanged(result.data.summary);
    toast.success('输入要求已更新', '已生成新版本；需要重新试运行后才能设为正式。');
  };

  const runScheme = () => {
    void attachSchemeRun(scheme, scheme.status === 'formal' ? 'formal' : 'trial');
  };

  const selectCover = async (assetId: string) => {
    setCoverBusy(true);
    const result = await api.designScheme.selectCover(scheme.id, assetId);
    setCoverBusy(false);
    if (!result.ok) {
      toast.error('设为封面失败', result.error.message);
      return;
    }
    onChanged(result.data);
    toast.success('已更新封面');
  };

  const formalize = async () => {
    if (formalizeBusy) return;
    setFormalizeBusy(true);
    const result = await api.designScheme.formalize(scheme.id);
    setFormalizeBusy(false);
    if (!result.ok) {
      toast.error('还不能设为正式', result.error.message);
      return;
    }
    onChanged(result.data);
    toast.success('方案已设为正式', '现在可以在 Composer 中直接使用。');
  };

  const modifyInComposer = () => {
    void attachSchemeModify(scheme.id);
  };

  // 导出 .musefold.design 分享包（设计规范 §7）：仅正式方案可导出。
  const exportScheme = async () => {
    if (exportBusy) return;
    setExportBusy(true);
    const result = await api.designScheme.exportScheme(scheme.id);
    setExportBusy(false);
    if (!result.ok) {
      toast.error('导出失败', result.error.message);
      return;
    }
    if (result.data.cancelled) return;
    toast.success('分享包已导出', `${result.data.fileName ?? ''} · 可发给其他 Musefold 用户导入`);
  };

  // 「检查更新」（§4.2）：对比上游 commit；有变化时自动编译为待验证草稿。
  const checkUpdate = async () => {
    if (checkUpdateBusy) return;
    setCheckUpdateBusy(true);
    toast.show({ title: '正在检查上游更新…', description: '需要下载仓库快照，可能要几十秒。' });
    const result = await api.designScheme.checkUpdate(scheme.id);
    setCheckUpdateBusy(false);
    if (!result.ok) {
      toast.error('检查更新失败', result.error.message);
      return;
    }
    if (result.data.status === 'draft-created' && result.data.scheme) {
      onChanged(result.data.scheme);
      toast.success('发现上游更新', result.data.detail);
    } else {
      toast.show({ title: result.data.status === 'up-to-date' ? '已是最新' : '无法检查更新', description: result.data.detail });
    }
  };

  // 待验证新版本 → 替换正式版本（规范 §2.2）；主进程校验新版本已有成功试运行。
  const promoteWorkingDraft = async () => {
    if (promoteBusy) return;
    setPromoteBusy(true);
    const result = await api.designScheme.promoteWorkingDraft(scheme.id);
    setPromoteBusy(false);
    if (!result.ok) {
      toast.error('还不能更新正式版本', result.error.message);
      return;
    }
    onChanged(result.data);
    toast.success('正式版本已更新', '新版本现在是这个方案的正式版本。');
  };

  return (
    <div className="h-full overflow-y-auto" data-testid="runtime-scheme-detail" data-scheme-id={scheme.id} data-status={scheme.status}>
      <div className="mx-auto w-full max-w-[880px] px-6 pb-16 pt-5 max-[640px]:px-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-md pr-2 text-[11px] text-tertiary hover:bg-hover hover:text-primary"
          data-testid="runtime-scheme-detail-back"
        >
          <ArrowLeft className="h-3.5 w-3.5" />方案
        </button>

        <div className="mt-5 flex items-start gap-4">
          {scheme.coverImagePath ? (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border-subtle bg-inset/55">
              <img src={toImageSrc(scheme.coverImagePath)} alt="" className="h-full w-full object-cover" />
            </span>
          ) : (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary text-background" aria-hidden>
              <Blocks className="h-5 w-5" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[20px] font-semibold text-primary">{scheme.name}</h1>
              <span className="text-[10.5px] text-tertiary">{scheme.status === 'formal' ? '正式' : '草稿'}</span>
              <span className="rounded-full border border-border-subtle px-1.5 py-0.5 text-[9px] text-secondary">
                {FIDELITY_LABEL[scheme.fidelity] ?? scheme.fidelity}
              </span>
            </div>
            <p className="mt-1.5 max-w-[62ch] text-[12px] leading-5 text-secondary">{scheme.summary}</p>
            <p className="mt-2 flex items-center gap-1.5 truncate text-[10.5px] text-tertiary">
              {scheme.sourcePresentation === 'skill' ? <GitBranch className="h-3 w-3 shrink-0" /> : <Sparkles className="h-3 w-3 shrink-0" />}
              {scheme.sourcePresentation === 'skill' ? 'Skill' : 'Musefold 创建'} · {scheme.sourceLabel}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <SchemeActionMenu
              scheme={scheme}
              onModify={scheme.status === 'formal' ? modifyInComposer : null}
              onRename={() => setRenameOpen(true)}
              onViewSource={() => setSourceOpen(true)}
              onCheckUpdate={repoSource ? () => void checkUpdate() : null}
              checkUpdateBusy={checkUpdateBusy}
              onExport={scheme.status === 'formal' ? () => void exportScheme() : null}
              exportBusy={exportBusy}
              onRemove={() => setRemoveOpen(true)}
            />
            {scheme.status === 'draft' && (
              <button
                type="button"
                onClick={modifyInComposer}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-border-default px-3 text-[11px] font-medium text-primary hover:bg-hover"
                data-testid="runtime-scheme-modify"
              >
                <Pencil className="h-3.5 w-3.5" />继续修改
              </button>
            )}
            {canFormalize && (
              <button
                type="button"
                onClick={() => void formalize()}
                disabled={formalizeBusy}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-border-default px-3 text-[11px] font-medium text-primary hover:bg-hover disabled:cursor-wait disabled:opacity-50"
                data-testid="runtime-scheme-formalize"
              >
                设为正式
              </button>
            )}
            <button
              type="button"
              onClick={runScheme}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[11px] font-semibold text-background hover:opacity-85"
              data-testid="runtime-scheme-primary-action"
            >
              {scheme.status === 'formal' ? <Play className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {scheme.status === 'formal' ? '使用' : '试运行'}
            </button>
          </div>
        </div>

        {scheme.status === 'formal' && scheme.workingDraftRevisionId && (
          <div
            className="mt-6 flex flex-wrap items-center gap-3 rounded-md border border-accent/30 bg-accent-soft/60 px-4 py-3"
            data-testid="runtime-scheme-working-draft"
          >
            <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[11.5px] font-medium text-primary">这个方案有一个待验证的新版本</p>
              <p className="mt-0.5 text-[10.5px] text-tertiary">当前正式版本继续可用；新版本完成一次成功试运行后可以替换它。</p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => void attachSchemeRun(scheme, 'trial')}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-border-default px-3 text-[11px] font-medium text-primary hover:bg-hover"
                data-testid="runtime-scheme-trial-working-draft"
              >
                <RefreshCw className="h-3.5 w-3.5" />试运行新版本
              </button>
              <button
                type="button"
                disabled={promoteBusy}
                onClick={() => void promoteWorkingDraft()}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[11px] font-semibold text-background hover:opacity-85 disabled:cursor-wait disabled:opacity-50"
                data-testid="runtime-scheme-promote-working-draft"
              >
                更新正式版本
              </button>
            </div>
          </div>
        )}

        <div className="mt-8">
          <RuntimeAlbum
            assets={orderedAssets}
            coverAssetId={scheme.coverAssetId}
            onSetCover={(assetId) => void selectCover(assetId)}
            coverBusy={coverBusy}
          />
        </div>

        {loadError && (
          <div className="mt-8 rounded-md border border-danger/25 bg-danger/5 px-3 py-2 text-[10.5px] text-danger">{loadError}</div>
        )}
        {!document && !loadError && (
          <div className="mt-10 py-8 text-center text-[11px] text-tertiary">正在读取方案内容…</div>
        )}

        {document && (
          <div className="mt-10 space-y-7">
            <DetailSection
              title="需要提供"
              action={scheme.status === 'draft' && document.inputs.length > 0 && !inputEdits ? (
                <button
                  type="button"
                  onClick={beginInputEdit}
                  className="inline-flex min-h-7 items-center gap-1.5 rounded-md px-2 text-[10.5px] font-medium text-secondary transition-colors hover:bg-hover hover:text-primary"
                  data-testid="runtime-scheme-edit-inputs"
                >
                  <Pencil className="h-3 w-3" />编辑
                </button>
              ) : undefined}
            >
              {document.inputs.length === 0 ? (
                <p>这个方案不需要额外输入，直接运行即可。</p>
              ) : !inputEdits ? (
                <div className="divide-y divide-border-subtle">
                  {document.inputs.map((input) => (
                    <div key={input.id} className="grid grid-cols-[minmax(120px,0.55fr)_minmax(0,1fr)_auto] items-center gap-3 py-2.5">
                      <span className="font-medium text-primary">{input.kind === 'text' ? `@${input.label}` : input.label}</span>
                      <span className="min-w-0 truncate">
                        {input.description || (input.imageRole ? IMAGE_ROLE_LABEL[input.imageRole] : INPUT_KIND_LABEL[input.kind])}
                      </span>
                      <span className="text-tertiary">{INPUT_KIND_LABEL[input.kind]} · {input.required ? '必需' : '可选'}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div data-testid="runtime-scheme-inputs-editor">
                  <div className="divide-y divide-border-subtle">
                    {document.inputs.map((input) => {
                      const edit = inputEdits.find((item) => item.id === input.id);
                      if (!edit) return null;
                      const deletable = !templateBoundIds.has(input.id);
                      return (
                        <div
                          key={input.id}
                          className={cn(
                            'grid grid-cols-[minmax(120px,0.55fr)_minmax(0,1fr)_auto] items-center gap-3 py-2.5',
                            edit.removed && 'opacity-45',
                          )}
                          data-testid={`runtime-scheme-input-row-${input.id}`}
                          data-removed={edit.removed || undefined}
                        >
                          <span className={cn('font-medium text-primary', edit.removed && 'line-through')}>
                            {input.kind === 'text' ? `@${input.label}` : input.label}
                          </span>
                          <span className="min-w-0 truncate">
                            {input.description || (input.imageRole ? IMAGE_ROLE_LABEL[input.imageRole] : INPUT_KIND_LABEL[input.kind])}
                          </span>
                          <span className="flex items-center gap-1.5">
                            {edit.removed ? (
                              <button
                                type="button"
                                onClick={() => setInputEdits((prev) => prev!.map((item) => item.id === input.id ? { ...item, removed: false } : item))}
                                className="inline-flex min-h-7 items-center gap-1 rounded-md px-2 text-[10.5px] font-medium text-secondary hover:bg-hover hover:text-primary"
                                data-testid={`runtime-scheme-input-restore-${input.id}`}
                              >
                                <Undo2 className="h-3 w-3" />恢复
                              </button>
                            ) : (
                              <>
                                <div className="flex rounded-md bg-inset p-0.5" role="radiogroup" aria-label={`${input.label}是否必需`}>
                                  {([true, false] as const).map((value) => (
                                    <button
                                      key={String(value)}
                                      type="button"
                                      role="radio"
                                      aria-checked={edit.required === value}
                                      onClick={() => setInputEdits((prev) => prev!.map((item) => item.id === input.id ? { ...item, required: value } : item))}
                                      className={cn(
                                        'min-h-6 rounded-[5px] px-2 text-[10px] font-medium transition-colors',
                                        edit.required === value ? 'bg-elevated text-primary shadow-sm' : 'text-tertiary hover:text-primary',
                                      )}
                                      data-testid={`runtime-scheme-input-${value ? 'required' : 'optional'}-${input.id}`}
                                    >
                                      {value ? '必需' : '可选'}
                                    </button>
                                  ))}
                                </div>
                                <button
                                  type="button"
                                  disabled={!deletable}
                                  onClick={() => setInputEdits((prev) => prev!.map((item) => item.id === input.id ? { ...item, removed: true } : item))}
                                  className="icon-action h-7 w-7 disabled:cursor-not-allowed disabled:opacity-35"
                                  title={deletable ? '删除这个输入' : '被方案提示词模板引用，不能删除'}
                                  aria-label={`删除${input.label}`}
                                  data-testid={`runtime-scheme-input-delete-${input.id}`}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3 border-t border-border-subtle pt-3">
                    <span className="text-[10px] text-tertiary">保存后生成新版本，需要重新试运行才能设为正式。</span>
                    <span className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setInputEdits(null)}
                        className="min-h-7 rounded-md px-2.5 text-[10.5px] font-medium text-secondary hover:bg-hover hover:text-primary"
                        data-testid="runtime-scheme-inputs-cancel"
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        disabled={!inputEditsDirty || inputSaveBusy}
                        onClick={() => void saveInputEdits()}
                        className="inline-flex min-h-7 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[10.5px] font-semibold text-background hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-45"
                        data-testid="runtime-scheme-inputs-save"
                      >
                        保存更改
                      </button>
                    </span>
                  </div>
                </div>
              )}
            </DetailSection>

            <DetailSection title="方案规则">
              {document.constraints.length === 0 ? (
                <p>没有额外的视觉约束。</p>
              ) : (
                <ul className="space-y-1.5">
                  {document.constraints.map((constraint) => (
                    <li key={constraint.id} className="flex items-start gap-2.5">
                      <span
                        className={cn(
                          'mt-0.5 shrink-0 rounded-full border px-1.5 py-0.5 text-[9px]',
                          constraint.mode === 'required'
                            ? 'border-accent/35 bg-accent-soft text-accent'
                            : constraint.mode === 'avoid'
                              ? 'border-danger/30 text-danger'
                              : 'border-border-subtle text-secondary',
                        )}
                      >
                        {CONSTRAINT_DOMAIN_LABEL[constraint.domain]} · {CONSTRAINT_MODE_LABEL[constraint.mode]}
                      </span>
                      <span className="min-w-0">{constraint.statement}</span>
                    </li>
                  ))}
                </ul>
              )}
            </DetailSection>

            <DetailSection title="来源与版本">
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <span className="block text-tertiary">来源</span>
                  <span className="mt-0.5 block text-primary">{scheme.sourcePresentation === 'skill' ? 'Skill' : 'Musefold 创建'}</span>
                </div>
                <div>
                  <span className="block text-tertiary">还原度</span>
                  <span className="mt-0.5 block text-primary">{FIDELITY_LABEL[document.fidelity] ?? document.fidelity}</span>
                </div>
                <div>
                  <span className="block text-tertiary">本机状态</span>
                  <span className="mt-0.5 block text-primary">{scheme.hasSuccessfulTrial ? '已验证' : '等待试运行'}</span>
                </div>
              </div>
              {document.sources.length > 0 && (
                <ul className="mt-4 space-y-1 border-t border-border-subtle pt-3">
                  {document.sources.map((source) => (
                    <li key={source.id} className="flex items-center gap-2 text-[11px]">
                      <span className="shrink-0 text-tertiary">{SOURCE_KIND_LABEL[source.kind]}</span>
                      <span className="min-w-0 truncate text-primary">{source.uri ?? source.filePath ?? '—'}</span>
                      {source.ref && <span className="shrink-0 text-tertiary">@{source.ref}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </DetailSection>

            <details className="border-t border-border-subtle pt-5" data-testid="runtime-scheme-tech-details">
              <summary className="cursor-pointer text-[13px] font-semibold text-primary">技术详情</summary>
              <div className="mt-4 space-y-3 text-[11px] leading-6 text-secondary">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <span className="block text-tertiary">编译模型</span>
                    <span className="mt-0.5 block text-primary">
                      {document.compilation.model.model}
                      {document.compilation.model.connectionName ? ` · ${document.compilation.model.connectionName}` : ''}
                    </span>
                  </div>
                  <div>
                    <span className="block text-tertiary">提示词模块</span>
                    <span className="mt-0.5 block text-primary">{document.promptProgram.length} 个（版本 {document.revisionId.slice(0, 12)}）</span>
                  </div>
                </div>
                {document.compilation.adopted.length > 0 && (
                  <div>
                    <p className="flex items-center gap-1.5 font-medium text-primary"><FileCheck2 className="h-3.5 w-3.5 text-success" />采用了</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5">{document.compilation.adopted.map((item, index) => <li key={index}>{item}</li>)}</ul>
                  </div>
                )}
                {document.compilation.omitted.length > 0 && (
                  <div>
                    <p className="font-medium text-primary">舍弃了</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5">{document.compilation.omitted.map((item, index) => <li key={index}>{item}</li>)}</ul>
                  </div>
                )}
                {document.compilation.warnings.length > 0 && (
                  <div>
                    <p className="font-medium text-warning">注意</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5">{document.compilation.warnings.map((item, index) => <li key={index}>{item}</li>)}</ul>
                  </div>
                )}
                <p className="flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5 text-success" />来源快照已锁定，不会执行仓库脚本</p>
                {repoSource?.uri && (
                  <button
                    type="button"
                    onClick={() => window.open(repoSource.uri, '_blank', 'noopener,noreferrer')}
                    className="inline-flex items-center gap-1.5 pt-1 text-primary hover:underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />查看 GitHub 仓库
                  </button>
                )}
              </div>
            </details>
          </div>
        )}
      </div>
      {renameOpen && (
        <RenameDialog scheme={scheme} onClose={() => setRenameOpen(false)} onRenamed={onChanged} />
      )}
      {sourceOpen && (
        <SourceSnapshotDialog
          scheme={scheme}
          briefExcerpt={document?.compilation.briefExcerpt ?? null}
          onClose={() => setSourceOpen(false)}
        />
      )}
      {removeOpen && (
        <RemoveDialog scheme={scheme} onClose={() => setRemoveOpen(false)} onRemoved={onRemoved} />
      )}
    </div>
  );
}
