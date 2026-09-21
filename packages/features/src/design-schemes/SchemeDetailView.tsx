'use client';

import type { DesignSchemeRevisionDocument } from '@musefold/contracts';
import {
  DESIGN_SCHEME_PACKAGE_FORMAT_VERSION,
  cloudCheckDesignSchemeUpdateInputSchema,
} from '@musefold/contracts';
import { useGateway, queryKeys } from '@musefold/platform';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@musefold/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@musefold/ui/components/dropdown-menu';
import { SchemeAssetImage } from './SchemeAssetImage';
import { Skeleton } from '@musefold/ui/components/skeleton';
import { toast } from '@musefold/ui/components/sonner';
import {
  ArrowLeft,
  Blocks,
  FolderOpen,
  GitBranch,
  MoreHorizontal,
  Pencil,
  Play,
  RefreshCw,
  Share2,
  Sparkles,
  Trash2,
} from '@musefold/ui/icons';
import { useMemo, useRef, useState } from 'react';
import { SchemePackageExportDialog } from './SchemePackageExportDialog';
import { SchemeAgentDialog } from './SchemeAgentDialog';
import type { SchemeAgentIntent } from './agent-presentation';
import {
  useCheckSchemeUpdate,
  useExportScheme,
  useFormalizeScheme,
  usePromoteWorkingDraft,
  useRemoveScheme,
  useRenameScheme,
  useSchemeDetail,
  useSelectCover,
  useUpdateSchemeDocument,
} from './hooks';
import { SchemeAlbum } from './SchemeAlbum';
import { SchemeDetailSections, type SchemeInputEdit } from './SchemeDetailSections';
import { SchemeRemoveDialog, SchemeRenameDialog, SchemeSourceDialog } from './SchemeDialogs';
import { FIDELITY_LABEL, mintRevisionId } from './scheme-labels';
import type { DesignSchemesActions, ResolveSchemeAssetUrl } from './types';

/**
 * 方案详情整屏视图(承旧 SchemeRuntimeDetail):
 * 返回 | 名称/状态/保真度 | 动作组(修改/设为正式/导出/检查更新/主动作) |
 * 待验证新版本横幅 | 试运行相册 | 文档分节(staged 槽位编辑)。
 * 数据:get 一次拿全(summary+document+assets+snapshots),文档是当前或待验证 revision。
 */
export function SchemeDetailView({
  schemeId,
  resolveAssetUrl,
  actions,
  onBack,
  onRemoved,
}: {
  schemeId: string;
  resolveAssetUrl?: ResolveSchemeAssetUrl;
  actions: DesignSchemesActions;
  onBack(): void;
  /** 删除/移除成功后由父级清掉 detailId 返回列表。 */
  onRemoved(): void;
}) {
  const detail = useSchemeDetail(schemeId);
  const rename = useRenameScheme();
  const remove = useRemoveScheme();
  const selectCover = useSelectCover();
  const formalize = useFormalizeScheme();
  const promoteWorkingDraft = usePromoteWorkingDraft();
  const updateDocument = useUpdateSchemeDocument();
  const checkUpdate = useCheckSchemeUpdate();
  const exportScheme = useExportScheme();
  const packageExport = useGateway().designSchemes?.packageExport;
  const agent = useGateway().designSchemes?.agent;
  const client = useQueryClient();
  const [updateIntent, setUpdateIntent] = useState<Extract<
    SchemeAgentIntent,
    { operation: 'check-update' }
  > | null>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const [inputEdits, setInputEdits] = useState<SchemeInputEdit[] | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);

  const summary = detail.data?.summary ?? null;
  const document = detail.data?.document ?? null;
  const versionPending = Boolean(
    detail.isFetching ||
      rename.isPending ||
      remove.isPending ||
      selectCover.isPending ||
      formalize.isPending ||
      promoteWorkingDraft.isPending ||
      updateDocument.isPending ||
      checkUpdate.isPending,
  );

  // 封面固定排在最前,其余按时间倒序(承旧 §5.2)。
  const orderedAssets = useMemo(() => {
    const assets = detail.data?.assets ?? [];
    return assets.slice().sort((a, b) => {
      if (a.id === summary?.coverAssetId) return -1;
      if (b.id === summary?.coverAssetId) return 1;
      return (
        (typeof b.createdAt === 'number' ? b.createdAt : Date.parse(b.createdAt)) -
        (typeof a.createdAt === 'number' ? a.createdAt : Date.parse(a.createdAt))
      );
    });
  }, [detail.data?.assets, summary?.coverAssetId]);

  const repoSource = document?.sources.find(
    (source) => source.kind.startsWith('github') && (source.uri ?? source.repositoryUrl),
  );
  const canFormalize = Boolean(
    summary && summary.status === 'draft' && summary.hasSuccessfulTrial && summary.coverAssetId,
  );

  // 被 promptProgram 模板 {{变量}} 引用的文本槽位不可删除(会留下无法填充的占位)。
  const templateBoundIds = useMemo(() => {
    if (!document) return new Set<string>();
    const variables = new Set(document.promptProgram.flatMap((module) => module.variables));
    return new Set(
      document.inputs
        .filter(
          (slot) =>
            (slot.kind === 'text' || slot.kind === 'article' || slot.kind === 'choice') &&
            variables.has(slot.id),
        )
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

  function beginInputEdit() {
    if (!document || versionPending) return;
    setInputEdits(
      document.inputs.map((slot) => ({ id: slot.id, required: slot.required, removed: false })),
    );
  }

  /** 保存 staged 槽位:客户端构造新不可变 revision(新 id + parentRevisionId 指回基线),update 一次性提交。 */
  async function saveInputEdits() {
    if (!document || !inputEdits || !summary || versionPending) return;
    const keptIds = new Set(inputEdits.filter((edit) => !edit.removed).map((edit) => edit.id));
    const nextDocument: DesignSchemeRevisionDocument = {
      ...document,
      revisionId: mintRevisionId(),
      parentRevisionId: document.revisionId,
      inputs: document.inputs
        .filter((slot) => keptIds.has(slot.id))
        .map((slot) => ({
          ...slot,
          required: inputEdits.find((edit) => edit.id === slot.id)?.required ?? slot.required,
        })),
    };
    try {
      await updateDocument.mutateAsync({
        schemeId: summary.id,
        baseRevisionId: document.revisionId,
        document: nextDocument,
        expectedVersion: summary.version,
      });
      setInputEdits(null);
      toast.success('输入要求已更新', {
        description: '已生成新版本；需要重新试运行后才能设为正式。',
      });
    } catch (error) {
      toast.error('保存失败', {
        description: error instanceof Error ? error.message : '更新输入要求失败',
      });
    }
  }

  async function handleRename(name: string) {
    if (!summary || versionPending) return;
    try {
      await rename.mutateAsync({
        schemeId: summary.id,
        name,
        expectedVersion: summary.version,
      });
      setRenameOpen(false);
      toast.success('已重命名', { description: `方案现在叫「${name}」。` });
    } catch (error) {
      toast.error('重命名失败', {
        description: error instanceof Error ? error.message : '重命名方案失败',
      });
    }
  }

  async function handleRemove() {
    if (!summary || versionPending) return;
    const isDraft = summary.status === 'draft';
    try {
      await remove.mutateAsync({ schemeId: summary.id, expectedVersion: summary.version });
      setRemoveOpen(false);
      onRemoved();
      toast.success(isDraft ? '草稿已删除' : '方案已移除', {
        description: '已生成的图片仍保留在历史与图库中。',
      });
    } catch (error) {
      toast.error(isDraft ? '删除草稿失败' : '移除方案失败', {
        description: error instanceof Error ? error.message : '移除方案失败',
      });
    }
  }

  async function handleFormalize() {
    if (!summary?.coverAssetId || summary.status !== 'draft' || versionPending) return;
    try {
      await formalize.mutateAsync({
        schemeId: summary.id,
        revisionId: summary.currentRevisionId,
        coverAssetId: summary.coverAssetId,
        expectedVersion: summary.version,
        confirmed: true,
      });
      toast.success('方案已设为正式', { description: '现在可以在 Composer 中直接使用。' });
    } catch (error) {
      toast.error('还不能设为正式', {
        description: error instanceof Error ? error.message : '设为正式失败',
      });
    }
  }

  async function handlePromoteWorkingDraft() {
    if (!summary?.workingDraftRevisionId || summary.status !== 'formal' || versionPending) return;
    try {
      await promoteWorkingDraft.mutateAsync({
        schemeId: summary.id,
        workingDraftRevisionId: summary.workingDraftRevisionId,
        expectedVersion: summary.version,
        confirmed: true,
      });
      toast.success('正式版本已更新', { description: '新版本现在是这个方案的正式版本。' });
    } catch (error) {
      toast.error('还不能更新正式版本', {
        description: error instanceof Error ? error.message : '更新正式版本失败',
      });
    }
  }

  async function handleCheckUpdate() {
    if (!summary || versionPending) return;
    if (agent) {
      if (!document) return;
      setUpdateIntent({
        operation: 'check-update',
        input: cloudCheckDesignSchemeUpdateInputSchema.parse({
          executionId: crypto.randomUUID(),
          schemeId: summary.id,
          baseRevisionId: document.revisionId,
          expectedVersion: summary.version,
        }),
      });
      return;
    }
    toast('正在检查上游更新…', { description: '需要下载仓库快照，可能要几十秒。' });
    try {
      const result = await checkUpdate.mutateAsync({ schemeId: summary.id });
      if (result.status === 'draft-created') {
        toast.success('发现上游更新', { description: result.detail });
      } else {
        toast(result.status === 'up-to-date' ? '已是最新' : '无法检查更新', {
          description: result.detail,
        });
      }
    } catch (error) {
      toast.error('检查更新失败', {
        description: error instanceof Error ? error.message : '检查上游更新失败',
      });
    }
  }

  async function handleExport() {
    if (!summary || versionPending || exportScheme.isPending) return;
    if (packageExport) {
      setExportOpen(true);
      return;
    }
    try {
      const result = await exportScheme.mutateAsync({
        schemeId: summary.id,
        formatVersion: DESIGN_SCHEME_PACKAGE_FORMAT_VERSION,
      });
      if (result.status === 'cancelled') return;
      toast.success('分享包已导出', {
        description: `${result.package.id} · 可发给其他 Musefold 用户导入`,
      });
    } catch (error) {
      toast.error('导出失败', {
        description: error instanceof Error ? error.message : '导出分享包失败',
      });
    }
  }

  async function handleSetCover(assetId: string) {
    if (!summary || versionPending) return;
    try {
      await selectCover.mutateAsync({
        schemeId: summary.id,
        assetId,
        expectedVersion: summary.version,
      });
      toast.success('已更新封面');
    } catch (error) {
      toast.error('设为封面失败', {
        description: error instanceof Error ? error.message : '设为封面失败',
      });
    }
  }

  // Keep the observer mounted when a completed update starts loading its new revision.
  // The dialog owns the original execution ID; a detail refresh must not reset it.
  const updateDialog = updateIntent ? (
    <SchemeAgentDialog
      key={updateIntent.input.executionId}
      intent={updateIntent}
      onClose={() => setUpdateIntent(null)}
      onRestoreFocus={() => menuRef.current?.focus()}
      onCompleted={() => void client.invalidateQueries({ queryKey: queryKeys.designSchemes.all() })}
      onOpenScheme={() => setUpdateIntent(null)}
    />
  ) : null;

  if (detail.isPending) {
    return (
      <div className="h-full overflow-y-auto" data-testid="runtime-scheme-detail-loading">
        <div className="mx-auto w-full max-w-[880px] px-6 pt-5 pb-16 max-[640px]:px-4">
          <Skeleton className="h-8 w-20 rounded-md" />
          <div className="mt-5 flex items-start gap-4">
            <Skeleton className="size-10 rounded-md" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-6 w-1/3" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/4" />
            </div>
          </div>
          <Skeleton className="mt-8 h-[300px] rounded-md" />
          <Skeleton className="mt-8 h-32 rounded-md" />
        </div>
        {updateDialog}
      </div>
    );
  }

  if (detail.isError || !summary) {
    return (
      <div className="h-full overflow-y-auto" data-testid="runtime-scheme-detail-error">
        <div className="mx-auto w-full max-w-[880px] px-6 pt-5 pb-16">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground"
            onClick={onBack}
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            方案
          </Button>
          <div className="mt-8 flex flex-col items-center gap-3 py-16 text-center" role="alert">
            <p className="text-muted-foreground text-sm">方案读取失败</p>
            <p className="max-w-[46ch] text-[11px] text-muted-foreground">
              {detail.error instanceof Error ? detail.error.message : null}
            </p>
            <Button variant="outline" size="sm" onClick={() => void detail.refetch()}>
              重试
            </Button>
          </div>
        </div>
        {updateDialog}
      </div>
    );
  }

  const isDraft = summary.status === 'draft';
  const coverThumbUrl = summary.coverAssetId
    ? (resolveAssetUrl?.(summary.coverAssetId) ?? null)
    : null;
  const versionPendingReason = versionPending ? '正在确认方案最新版本，请稍候。' : null;
  const runDisabledReason =
    versionPendingReason ?? (actions.onRunScheme ? null : '当前环境暂未接入方案运行');
  const modifyDisabledReason =
    versionPendingReason ?? (actions.onModifyScheme ? null : '当前环境暂未接入方案修改');

  return (
    <div
      className="h-full overflow-y-auto"
      data-testid="runtime-scheme-detail"
      data-scheme-id={summary.id}
      data-status={summary.status}
      aria-busy={versionPending}
    >
      <div className="mx-auto w-full max-w-[880px] px-6 pt-5 pb-16 max-[640px]:px-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-md pr-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          data-testid="runtime-scheme-detail-back"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          方案
        </button>

        <div className="mt-5 grid grid-cols-[2.5rem_minmax(0,1fr)] items-start gap-4 md:flex">
          {coverThumbUrl ? (
            <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted/50">
              <SchemeAssetImage
                compact
                src={coverThumbUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            </span>
          ) : (
            <span
              className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground"
              aria-hidden
            >
              <Blocks className="size-5" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="max-w-full break-words font-semibold text-xl text-foreground">
                {summary.name}
              </h1>
              <span className="text-[11px] text-muted-foreground">{isDraft ? '草稿' : '正式'}</span>
              <span className="rounded-full border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {FIDELITY_LABEL[summary.fidelity] ?? summary.fidelity}
              </span>
            </div>
            <p className="mt-1.5 max-w-[62ch] break-words text-xs text-muted-foreground leading-5">
              {summary.summary}
            </p>
            <p className="mt-2 flex items-center gap-1.5 truncate text-[11px] text-muted-foreground/80">
              {summary.sourcePresentation === 'skill' ? (
                <GitBranch className="size-3 shrink-0" aria-hidden />
              ) : (
                <Sparkles className="size-3 shrink-0" aria-hidden />
              )}
              {summary.sourcePresentation === 'skill' ? 'Skill' : 'Musefold 创建'} ·{' '}
              {summary.sourceLabel}
            </p>
          </div>
          <div className="col-span-2 flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground"
                  aria-label="更多方案操作"
                  title="更多操作"
                  data-testid="runtime-scheme-menu"
                  ref={menuRef}
                  disabled={versionPending}
                >
                  <MoreHorizontal className="size-4" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                sideOffset={6}
                className="w-52"
                aria-label="方案操作"
                data-testid="runtime-scheme-menu-list"
              >
                {!isDraft ? (
                  <DropdownMenuItem
                    disabled={modifyDisabledReason != null}
                    title={modifyDisabledReason ?? undefined}
                    onSelect={() => summary && actions.onModifyScheme?.(summary)}
                    data-testid="runtime-scheme-menu-modify"
                  >
                    <Pencil className="size-3.5" aria-hidden />在 Composer 中修改
                  </DropdownMenuItem>
                ) : null}
                {isDraft ? (
                  <DropdownMenuItem
                    disabled={versionPending}
                    onSelect={() => setRenameOpen(true)}
                    data-testid="runtime-scheme-menu-rename"
                  >
                    <Pencil className="size-3.5" aria-hidden />
                    重命名
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem
                  onSelect={() => setSourceOpen(true)}
                  data-testid="runtime-scheme-menu-source"
                >
                  <FolderOpen className="size-3.5" aria-hidden />
                  查看来源
                </DropdownMenuItem>
                {repoSource || agent ? (
                  <DropdownMenuItem
                    disabled={versionPending}
                    onSelect={() => void handleCheckUpdate()}
                    data-testid="runtime-scheme-menu-check-update"
                  >
                    <RefreshCw
                      className={checkUpdate.isPending ? 'size-3.5 animate-spin' : 'size-3.5'}
                      aria-hidden
                    />
                    检查更新
                  </DropdownMenuItem>
                ) : null}
                {!isDraft ? (
                  <DropdownMenuItem
                    disabled={versionPending || exportScheme.isPending}
                    onSelect={() => void handleExport()}
                    data-testid="runtime-scheme-menu-export"
                  >
                    <Share2 className="size-3.5" aria-hidden />
                    导出分享包
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  disabled={versionPending}
                  onSelect={() => setRemoveOpen(true)}
                  data-testid="runtime-scheme-menu-remove"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                  {isDraft ? '删除草稿' : '移除方案'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {!isDraft ? (
              <Button
                variant="outline"
                size="sm"
                className="min-h-8 gap-1.5"
                disabled={modifyDisabledReason != null}
                title={modifyDisabledReason ?? undefined}
                onClick={() => actions.onModifyScheme?.(summary)}
                data-testid="runtime-scheme-modify"
              >
                <Pencil className="size-3.5" aria-hidden />在 Composer 中修改
              </Button>
            ) : null}
            {isDraft ? (
              <Button
                variant="outline"
                size="sm"
                className="min-h-8 gap-1.5"
                disabled={modifyDisabledReason != null}
                title={modifyDisabledReason ?? undefined}
                onClick={() => actions.onModifyScheme?.(summary)}
                data-testid="runtime-scheme-modify"
              >
                <Pencil className="size-3.5" aria-hidden />
                继续修改
              </Button>
            ) : null}
            {canFormalize ? (
              <Button
                variant="outline"
                size="sm"
                className="min-h-8"
                disabled={versionPending}
                onClick={() => void handleFormalize()}
                data-testid="runtime-scheme-formalize"
              >
                设为正式
              </Button>
            ) : null}
            <Button
              size="sm"
              className="min-h-8 gap-1.5"
              disabled={runDisabledReason != null}
              title={runDisabledReason ?? undefined}
              onClick={() => actions.onRunScheme?.(summary, isDraft ? 'trial' : 'formal')}
              data-testid="runtime-scheme-primary-action"
            >
              {isDraft ? (
                <RefreshCw className="size-3.5" aria-hidden />
              ) : (
                <Play className="size-3.5" aria-hidden />
              )}
              {isDraft ? '试运行' : '使用'}
            </Button>
          </div>
        </div>

        {versionPending ? (
          <p
            className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground"
            role="status"
            data-testid="runtime-scheme-version-pending"
          >
            <RefreshCw className="size-3.5 animate-spin" aria-hidden />
            正在确认方案最新版本，请稍候。
          </p>
        ) : null}

        {!isDraft && summary.workingDraftRevisionId ? (
          <div
            className="mt-6 grid grid-cols-[0.5rem_minmax(0,1fr)] items-center gap-3 rounded-md border border-primary/30 bg-primary/5 px-4 py-3 md:flex md:flex-wrap"
            data-testid="runtime-scheme-working-draft"
          >
            <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-[12px] text-foreground">
                这个方案有一个待验证的新版本
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                当前正式版本继续可用；新版本完成一次成功试运行后可以替换它。
              </p>
            </div>
            <div className="col-span-2 flex shrink-0 flex-wrap items-center justify-end gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="min-h-8 gap-1.5"
                disabled={runDisabledReason != null}
                title={runDisabledReason ?? undefined}
                onClick={() => actions.onRunScheme?.(summary, 'trial')}
                data-testid="runtime-scheme-trial-working-draft"
              >
                <RefreshCw className="size-3.5" aria-hidden />
                试运行新版本
              </Button>
              <Button
                size="sm"
                className="min-h-8"
                disabled={versionPending}
                onClick={() => void handlePromoteWorkingDraft()}
                data-testid="runtime-scheme-promote-working-draft"
              >
                更新正式版本
              </Button>
            </div>
          </div>
        ) : null}

        <div className="mt-8">
          <SchemeAlbum
            assets={orderedAssets}
            coverAssetId={summary.coverAssetId}
            resolveAssetUrl={resolveAssetUrl}
            onSetCover={(assetId) => void handleSetCover(assetId)}
            coverBusy={versionPending}
          />
        </div>

        {document ? (
          <SchemeDetailSections
            scheme={summary}
            document={document}
            inputEdits={inputEdits}
            setInputEdits={setInputEdits}
            inputSaveBusy={versionPending}
            inputEditsDirty={inputEditsDirty}
            templateBoundIds={templateBoundIds}
            beginInputEdit={beginInputEdit}
            saveInputEdits={saveInputEdits}
          />
        ) : null}
      </div>

      {updateDialog}
      {exportOpen && summary.currentRevisionId ? (
        <SchemePackageExportDialog
          selection={{
            schemeId: summary.id,
            revisionId: summary.currentRevisionId,
            expectedVersion: summary.version,
          }}
          onClose={() => setExportOpen(false)}
          onRestoreFocus={() => menuRef.current?.focus()}
        />
      ) : null}
      <SchemeRenameDialog
        scheme={renameOpen ? summary : null}
        busy={versionPending}
        onClose={() => setRenameOpen(false)}
        onSubmit={(name) => void handleRename(name)}
      />
      <SchemeSourceDialog
        detail={sourceOpen ? (detail.data ?? null) : null}
        onClose={() => setSourceOpen(false)}
      />
      <SchemeRemoveDialog
        scheme={removeOpen ? summary : null}
        busy={versionPending}
        onCancel={() => setRemoveOpen(false)}
        onConfirm={() => void handleRemove()}
      />
    </div>
  );
}
