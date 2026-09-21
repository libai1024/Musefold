'use client';

import type {
  DesignSchemeDetail,
  DesignSchemeSummary,
  MarketCandidate,
  SourceConfirmation,
} from '@musefold/contracts';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@musefold/ui/components/alert-dialog';
import { Button } from '@musefold/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@musefold/ui/components/dialog';
import { Spinner } from '@musefold/ui/components/spinner';
import {
  Blocks,
  Download,
  ExternalLink,
  File,
  FileCheck2,
  FileImage,
  FileText,
  FolderOpen,
  GitBranch,
  Scale,
  ShieldCheck,
  Sparkles,
} from '@musefold/ui/icons';
import { useState } from 'react';
import { formatBytes, formatSchemeDateTime, PACKAGE_KIND_LABEL } from './scheme-labels';

/**
 * 删除草稿 / 移除方案确认(承旧 SchemeListRemoveDialog + RemoveDialog 合一):
 * AlertDialog 红主钮(I3),文案区分两态,说明已生成图片保留。
 */
export function SchemeRemoveDialog({
  scheme,
  busy,
  onCancel,
  onConfirm,
}: {
  /** 只需 id/name/status;列表与详情两处复用。 */
  scheme: Pick<DesignSchemeSummary, 'id' | 'name' | 'status'> | null;
  busy: boolean;
  onCancel(): void;
  onConfirm(): void;
}) {
  const isDraft = scheme?.status === 'draft';
  return (
    <AlertDialog open={scheme != null} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent className="max-w-sm" data-testid="scheme-list-remove-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isDraft ? `删除草稿「${scheme?.name}」？` : `移除方案「${scheme?.name}」？`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isDraft
              ? '草稿与它的运行记录会从方案库移除；已生成的图片仍保留在历史与图库中。'
              : '方案会从方案库移除，之后无法直接在 Composer 中使用；已生成的图片仍保留在历史与图库中。'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={busy}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
            data-testid="scheme-list-remove-confirm"
          >
            {busy ? <Spinner className="size-3.5" /> : null}
            {isDraft ? '删除草稿' : '移除方案'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** 重命名(承旧 RenameDialog):只改展示名,编译产物不变;Enter 提交 / Esc 关闭。 */
export function SchemeRenameDialog({
  scheme,
  busy,
  onClose,
  onSubmit,
}: {
  scheme: Pick<DesignSchemeSummary, 'id' | 'name'> | null;
  busy: boolean;
  onClose(): void;
  onSubmit(name: string): void;
}) {
  const [value, setValue] = useState('');
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  // 打开新目标时以当前名重置输入(受控于 open 转换,避免残留上次的编辑)。
  if (scheme && openedFor !== scheme.id) {
    setValue(scheme.name);
    setOpenedFor(scheme.id);
  }
  if (!scheme && openedFor != null) setOpenedFor(null);

  const trimmed = value.trim();
  const unchanged = !scheme || !trimmed || trimmed === scheme.name;

  return (
    <Dialog open={scheme != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm" data-testid="scheme-rename-dialog">
        <DialogHeader>
          <DialogTitle>重命名方案</DialogTitle>
        </DialogHeader>
        <input
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !unchanged && !busy) onSubmit(trimmed);
          }}
          maxLength={80}
          aria-label="方案名称"
          className="w-full rounded-md border border-border bg-muted/50 px-3 py-2 text-foreground text-xs outline-none focus:border-primary/50"
          data-testid="scheme-rename-input"
        />
        <p className="text-[11px] text-muted-foreground">
          只影响展示名称；方案规则与版本记录保持不变。
        </p>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button
            size="sm"
            disabled={unchanged || busy}
            onClick={() => onSubmit(trimmed)}
            data-testid="scheme-rename-confirm"
          >
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 「查看来源」层(承旧 SourceSnapshotDialog):展示锁定的来源快照与固化文件清单。
 * 数据直接取 detail.sourceSnapshots(契约 path-free 元数据),不再单独请求。
 */
export function SchemeSourceDialog({
  detail,
  onClose,
}: {
  detail: DesignSchemeDetail | null;
  onClose(): void;
}) {
  const briefExcerpt = detail?.document.compilation.briefExcerpt ?? null;
  const snapshots = detail?.sourceSnapshots ?? [];
  const licenseBySnapshotId = new Map(
    (detail?.document.sources ?? [])
      .filter((source) => source.snapshotId && source.license)
      .map((source) => [source.snapshotId as string, source.license as string]),
  );

  return (
    <Dialog open={detail != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex max-h-[min(600px,88dvh)] max-w-lg flex-col overflow-hidden"
        data-testid="scheme-source-dialog"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="size-4 text-muted-foreground" aria-hidden />
            方案来源
          </DialogTitle>
          <p className="text-[11px] text-muted-foreground">
            来源快照在创建时锁定，之后不会变化，也不会执行其中的脚本。
          </p>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto text-[11px] text-muted-foreground leading-6">
          <div className="space-y-5">
            {briefExcerpt ? (
              <div>
                <p className="flex items-center gap-1.5 font-medium text-foreground">
                  <Sparkles className="size-3.5" aria-hidden />
                  你的想法
                </p>
                <p className="mt-1 whitespace-pre-wrap rounded-md bg-muted/50 px-3 py-2 text-[11px] leading-5">
                  {briefExcerpt}
                </p>
              </div>
            ) : null}
            {snapshots.length === 0 && !briefExcerpt ? (
              <p className="py-8 text-center text-muted-foreground">这个方案没有外部来源快照。</p>
            ) : null}
            {snapshots.map((snapshot) => {
              const repositoryUrl = snapshot.repositoryUrl ?? snapshot.uri ?? null;
              const ref = snapshot.resolvedRef ?? snapshot.ref ?? null;
              const commit = snapshot.commitHash ?? snapshot.commit ?? null;
              return (
                <div key={snapshot.id} data-testid={`scheme-source-snapshot-${snapshot.id}`}>
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-medium text-foreground">
                    {snapshot.kind === 'github' ? (
                      <GitBranch className="size-3.5" aria-hidden />
                    ) : (
                      <FolderOpen className="size-3.5" aria-hidden />
                    )}
                    {PACKAGE_KIND_LABEL[snapshot.kind]}
                    {repositoryUrl ? (
                      <a
                        href={repositoryUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-normal text-[11px] text-primary hover:underline"
                      >
                        <ExternalLink className="size-3" aria-hidden />
                        {repositoryUrl.replace(/^https:\/\/github\.com\//, '')}
                      </a>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {commit ? `commit ${commit.slice(0, 10)}` : ref ? `引用 ${ref}` : ''}
                    {licenseBySnapshotId.get(snapshot.id)
                      ? ` · ${licenseBySnapshotId.get(snapshot.id)}`
                      : ''}
                    {` · 固化于 ${formatSchemeDateTime(snapshot.createdAt)}`}
                  </p>
                  <ul className="mt-2 space-y-0.5 border-border border-l pl-3">
                    {snapshot.files.map((file) => (
                      <li key={file.relativePath} className="text-[11px]">
                        {file.kind === 'text' && file.textExcerpt ? (
                          <details>
                            <summary className="flex cursor-pointer list-none items-center gap-1.5">
                              <FileText
                                className="size-3 shrink-0 text-muted-foreground"
                                aria-hidden
                              />
                              <span className="min-w-0 truncate text-foreground">
                                {file.relativePath}
                              </span>
                              <span className="shrink-0 text-muted-foreground">
                                {formatBytes(file.sizeBytes)}
                              </span>
                            </summary>
                            <pre className="mt-1 max-h-44 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/50 px-2.5 py-2 font-mono text-[11px] text-muted-foreground leading-4">
                              {file.textExcerpt}
                            </pre>
                          </details>
                        ) : (
                          <span className="flex items-center gap-1.5">
                            {file.kind === 'image' ? (
                              <FileImage
                                className="size-3 shrink-0 text-muted-foreground"
                                aria-hidden
                              />
                            ) : (
                              <File className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                            )}
                            <span className="min-w-0 truncate text-foreground">
                              {file.relativePath}
                            </span>
                            <span className="shrink-0 text-muted-foreground">
                              {formatBytes(file.sizeBytes)}
                            </span>
                          </span>
                        )}
                      </li>
                    ))}
                    {snapshot.files.length === 0 ? (
                      <li className="text-[11px] text-muted-foreground">快照内没有文件</li>
                    ) : null}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 市场安装确认(承旧 MarketInstallDialog):
 * 许可证/只读规则提示词与参考图/不执行脚本三行 + 风险提示;确认走「下载快照 → Agent 编译草稿」管线。
 */
export function MarketInstallDialog({
  candidate,
  onCancel,
  onConfirm,
}: {
  candidate: MarketCandidate | null;
  onCancel(): void;
  onConfirm(): void;
}) {
  return (
    <AlertDialog open={candidate != null} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent className="max-w-md" data-testid="market-install-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2.5">
            <span
              className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground"
              aria-hidden
            >
              <Blocks className="size-3.5" />
            </span>
            添加为草稿
          </AlertDialogTitle>
          <AlertDialogDescription className="truncate">
            {candidate?.repositoryUrl}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="text-foreground text-xs leading-6">
          Musefold 会下载仓库快照，由 Agent 整理成方案草稿。添加后需要完成一次试运行，才能正式使用。
        </div>
        <div className="space-y-2 border-border border-y py-3 text-[11px] text-muted-foreground">
          <p className="flex items-center gap-2">
            <Scale className="size-3.5" aria-hidden />
            许可证:{candidate?.license ?? '未声明'}
          </p>
          <p className="flex items-center gap-2">
            <FileCheck2 className="size-3.5 text-success" aria-hidden />
            只读取规则、提示词与参考图片
          </p>
          <p className="flex items-center gap-2">
            <ShieldCheck className="size-3.5 text-success" aria-hidden />
            不会执行仓库脚本
          </p>
        </div>
        {candidate?.riskSummary ? (
          <p className="text-[11px] text-warning leading-5">{candidate.riskSummary}</p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            className="gap-1.5"
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
            data-testid="market-install-confirm"
          >
            <Download className="size-3.5" aria-hidden />
            添加为草稿
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Agent 创建过程中的来源安装确认(UI 规范 §11.2:远程来源不得静默引入):
 * 宿主 Agent 解析完 GitHub 仓库后停在 awaiting_install_confirmation,把只含元数据的
 * SourceConfirmation 发回;这里展示仓库、固定 commit、文件规模与许可证,用户「确认引入」
 * 才继续固化快照 → 分析 → 编译;「取消创建」即整体取消。多来源合并时逐个确认。
 */
export function SourceInstallConfirmDialog({
  source,
  pending = false,
  onDecide,
}: {
  source: SourceConfirmation | null;
  /** 决定已发出、等待宿主受理:两个按钮禁用,避免重复提交。 */
  pending?: boolean;
  onDecide(decision: 'install' | 'cancel'): void;
}) {
  const shownNames = source?.textNames.slice(0, 6) ?? [];
  const hiddenCount = source ? Math.max(0, source.textFileCount - shownNames.length) : 0;
  return (
    <AlertDialog
      open={source != null}
      onOpenChange={(open) => !open && !pending && onDecide('cancel')}
    >
      <AlertDialogContent className="max-w-md" data-testid="source-install-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2.5">
            <span
              className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground"
              aria-hidden
            >
              <GitBranch className="size-3.5" />
            </span>
            确认引入来源
          </AlertDialogTitle>
          <AlertDialogDescription className="truncate" data-testid="source-install-repository">
            {source?.repositoryUrl}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1 text-foreground text-xs leading-6">
          <p className="font-medium" data-testid="source-install-name">
            {source?.name}
          </p>
          {source?.description ? (
            <p className="line-clamp-3 text-muted-foreground">{source.description}</p>
          ) : null}
        </div>
        <div className="space-y-2 border-border border-y py-3 text-[11px] text-muted-foreground">
          <p className="flex items-center gap-2">
            <GitBranch className="size-3.5" aria-hidden />
            固定到 {source?.resolvedRef}
            {source?.commitHash ? ` · ${source.commitHash.slice(0, 10)}` : ''}
          </p>
          <p className="flex items-center gap-2">
            <FileText className="size-3.5" aria-hidden />
            {source?.textFileCount ?? 0} 个文本文件 · {source?.imageFileCount ?? 0} 张图片
          </p>
          {shownNames.length > 0 ? (
            <p className="truncate pl-5.5" data-testid="source-install-files">
              {shownNames.join(' · ')}
              {hiddenCount > 0 ? ` · 等 ${hiddenCount} 个` : ''}
            </p>
          ) : null}
          <p className="flex items-center gap-2">
            <Scale className="size-3.5" aria-hidden />
            许可证:{source?.license ?? '未声明'}
          </p>
          <p className="flex items-center gap-2">
            <ShieldCheck className="size-3.5 text-success" aria-hidden />
            只读取规则、提示词与参考图片,不会执行仓库脚本
          </p>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel
            disabled={pending}
            onClick={(event) => {
              event.preventDefault();
              onDecide('cancel');
            }}
            data-testid="source-install-cancel"
          >
            取消创建
          </AlertDialogCancel>
          <AlertDialogAction
            className="gap-1.5"
            disabled={pending}
            onClick={(event) => {
              event.preventDefault();
              onDecide('install');
            }}
            data-testid="source-install-confirm"
          >
            {pending ? (
              <Spinner className="size-3.5" />
            ) : (
              <Download className="size-3.5" aria-hidden />
            )}
            确认引入
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
