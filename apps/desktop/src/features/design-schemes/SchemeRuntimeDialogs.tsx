import { useEffect, useState } from 'react';
import {
  ExternalLink,
  File,
  FileImage,
  FileText,
  FolderOpen,
  GitBranch,
  Loader2,
  Sparkles,
  X,
} from '../../components/ui/icons';
import { desktopHost as api } from '@renderer/runtime/desktop-host-services';
import { toast } from '../../stores/toast';
import type {
  DesignSchemeSourceSnapshotDetail,
  DesignSchemeSummary,
} from '@musefold/desktop-contracts/design-scheme';
import { formatBytes, PACKAGE_KIND_LABEL } from './scheme-runtime-labels';

/** 「查看来源」层：展示锁定的来源快照与固化文件清单（UI 规范 §4.2）。 */
export function SourceSnapshotDialog({
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
            <p className="mt-1 text-meta text-tertiary">来源快照在创建时锁定，之后不会变化，也不会执行其中的脚本。</p>
          </div>
          <button type="button" onClick={onClose} className="icon-action" aria-label="关闭" title="关闭"><X className="h-4 w-4" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-[11px] leading-6 text-secondary">
          {error ? (
            <div className="rounded-md border border-danger/25 bg-danger/5 px-3 py-2 text-meta text-danger">{error}</div>
          ) : !snapshots ? (
            <div className="flex items-center justify-center gap-2 py-10 text-tertiary"><Loader2 className="h-4 w-4 animate-spin" />正在读取来源快照…</div>
          ) : (
            <div className="space-y-5">
              {briefExcerpt && (
                <div>
                  <p className="flex items-center gap-1.5 font-medium text-primary"><Sparkles className="h-3.5 w-3.5" />你的想法</p>
                  <p className="mt-1 whitespace-pre-wrap rounded-md bg-inset/55 px-3 py-2 text-meta leading-5">{briefExcerpt}</p>
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
                      <button type="button" onClick={() => window.open(snapshot.repositoryUrl!, '_blank', 'noopener,noreferrer')} className="inline-flex items-center gap-1 text-meta font-normal text-primary hover:underline">
                        <ExternalLink className="h-3 w-3" />{snapshot.repositoryUrl.replace(/^https:\/\/github\.com\//, '')}
                      </button>
                    )}
                  </p>
                  <p className="mt-0.5 text-meta text-tertiary">
                    {snapshot.commitHash ? `commit ${snapshot.commitHash.slice(0, 10)}` : `引用 ${snapshot.ref}`}
                    {snapshot.license ? ` · ${snapshot.license}` : ''}
                    {` · 固化于 ${new Date(snapshot.createdAt).toLocaleString()}`}
                  </p>
                  <ul className="mt-2 space-y-0.5 border-l border-border-subtle pl-3">
                    {snapshot.files.map((file) => (
                      <li key={file.path} className="text-meta">
                        {file.kind === 'text' && file.textExcerpt ? (
                          <details>
                            <summary className="flex cursor-pointer list-none items-center gap-1.5">
                              <FileText className="h-3 w-3 shrink-0 text-tertiary" />
                              <span className="min-w-0 truncate text-primary">{file.path}</span>
                              <span className="shrink-0 text-tertiary">{formatBytes(file.sizeBytes)}</span>
                            </summary>
                            <pre className="mt-1 max-h-44 overflow-y-auto whitespace-pre-wrap rounded-md bg-inset/55 px-2.5 py-2 font-mono text-meta leading-4 text-secondary">{file.textExcerpt}</pre>
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
                    {snapshot.files.length === 0 && <li className="text-meta text-tertiary">快照内没有文件</li>}
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
export function RenameDialog({
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
          <p className="mt-2 text-meta text-tertiary">只影响展示名称；方案规则与版本记录保持不变。</p>
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
export function RemoveDialog({
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
