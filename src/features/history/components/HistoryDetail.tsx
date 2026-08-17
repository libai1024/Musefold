// src/features/history/components/HistoryDetail.tsx
// 右侧检视详情面板（TASK-HIS-03/04/05/07）
// 详见 docs/product/13-history-deep-dive.md §4.3

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  FolderOpen,
  ImageOff,
  KeyRound,
  LayoutTemplate,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  Wand2,
  XCircle,
} from '../../../components/ui/icons';
import type { HistoryRecord } from '@shared/types/models';
import { Button } from '../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { EmptyState } from '../../../components/ui/empty-state';
import { Input } from '../../../components/ui/input';
import { Spinner } from '../../../components/ui/spinner';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../../../components/ui/tooltip';
import { formatDuration, formatTime } from '../../../lib/format';
import { toImageSrc } from '../../../lib/media';
import api from '../../../lib/ipc';
import { cn } from '../../../lib/utils';
import { useAppStore } from '../../../stores/app';
import { toast } from '../../../stores/toast';
import { useGenerationStore } from '../../generation/store';
import { useGenerationWorkbenchStore } from '../../generation/workbench/store';
import { historyErrorPresentation } from '../error';
import { formatHistoryCost, formatParamsSummary, formatSourceLabel } from '../format';
import { historyParamsToRefineParams } from '../refine';
import { defaultHistoryPromptTitle, historyRecordToPromptInput } from '../save-prompt';
import { linkHistoriesToPrompt } from '../../library/related-history';
import { historyStatusMeta } from '../status';
import { selectSelectedHistory, useHistoryStore } from '../store';
import { extractUserPromptFromComposed } from '../../generation/workbench/references';
import { HistoryLineagePanel } from './HistoryLineagePanel';
import { displayModelName } from '../../../lib/model-catalog';

export function HistoryDetail({ onOpenLightbox }: { onOpenLightbox?: (id: string) => void }) {
  const record = useHistoryStore(selectSelectedHistory);
  const remove = useHistoryStore((s) => s.remove);
  const retry = useHistoryStore((s) => s.retry);
  const retryingIds = useHistoryStore((s) => s.retryingIds);
  const providers = useGenerationStore((s) => s.providers);
  const loadProviders = useGenerationStore((s) => s.loadProviders);
  const openProviderDialog = useGenerationStore((s) => s.openProviderDialog);
  const requestHighlightPrompt = useAppStore((s) => s.requestHighlightPrompt);
  const setView = useAppStore((s) => s.setView);
  const openDraft = useGenerationWorkbenchStore((s) => s.openDraft);
  const setDraftPrompt = useGenerationWorkbenchStore((s) => s.setDraftPrompt);
  const setDraftCommand = useGenerationWorkbenchStore((s) => s.setDraftCommand);
  const setActiveProvider = useGenerationStore((s) => s.setActive);

  const [sourceLabel, setSourceLabel] = useState('未记录');
  const [errorOpen, setErrorOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [imgBroken, setImgBroken] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveTitle, setSaveTitle] = useState('');
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [deleteFileDialogOpen, setDeleteFileDialogOpen] = useState(false);
  const [deletingWithFile, setDeletingWithFile] = useState(false);

  useEffect(() => {
    if (providers.length === 0) void loadProviders().catch(() => {});
  }, [providers.length, loadProviders]);

  useEffect(() => {
    setErrorOpen(false);
    setConfirmDelete(false);
    setImgBroken(false);
    setSaveDialogOpen(false);
    setSaveTitle('');
    setSavingPrompt(false);
    setDeleteFileDialogOpen(false);
    setDeletingWithFile(false);
  }, [record?.id]);

  useEffect(() => {
    let cancelled = false;
    if (!record) {
      setSourceLabel('未记录');
      return;
    }
    void resolveSourceLabel(record).then((label) => {
      if (!cancelled) setSourceLabel(label);
    });
    return () => {
      cancelled = true;
    };
  }, [record?.id, record?.promptId]);

  if (!record) {
    return (
      <EmptyState
        icon={ImageOff}
        title="未选中记录"
        hint="点左侧任意一行查看详情。"
        className="h-full"
        data-testid="history-detail-empty"
      />
    );
  }

  const meta = historyStatusMeta(record.status);
  const providerName =
    providers.find((p) => p.id === record.providerId)?.name ?? record.providerId;
  const paramsLine = formatParamsSummary(record.params);
  const provider = providers.find((p) => p.id === record.providerId);
  const error = historyErrorPresentation(record.errorCode, record.errorMessage);
  const isRetrying = retryingIds.has(record.id);
  const canOpenImage = meta.status === 'success' && Boolean(record.imagePath);
  const showImage = canOpenImage && !imgBroken;

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(record.promptText);
      toast.success('已复制提示词');
    } catch {
      toast.error('复制失败', '剪贴板不可用');
    }
  };

  const copyImage = async () => {
    if (!record.imagePath) {
      toast.info('无图片', '这条记录没有可复制的图片文件。');
      return;
    }
    try {
      await api.system.copyImage(record.imagePath);
      toast.success('已复制图片');
    } catch (error) {
      toast.error('复制图片失败', error instanceof Error ? error.message : '图片可能已被移动或删除。');
    }
  };

  const openImageFolder = async () => {
    if (!record.imagePath) {
      toast.info('无图片路径', '这条记录没有可定位的图片文件。');
      return;
    }
    try {
      await api.system.openInFolder(record.imagePath);
      toast.success('已在文件夹中定位图片');
    } catch (err) {
      toast.error('打开文件夹失败', err instanceof Error ? err.message : '文件可能已被移动或删除。');
    }
  };

  const openSavePromptDialog = () => {
    setSaveTitle(defaultHistoryPromptTitle(record));
    setSaveDialogOpen(true);
  };

  const createDesignScheme = () => {
    setDraftCommand('design-plan');
    setDraftPrompt(
      `把下面这段提示词整理成一个可复用方案，区分固定规则、必需变量和可选补充：\n\n${record.promptText}`,
    );
    setView('generate');
    toast.success('已进入方案创建', '确认需求后发送，Agent 会创建设计方案草稿。');
  };

  const reeditHistory = async () => {
    let currentProviders = providers;
    if (currentProviders.length === 0) {
      try {
        await loadProviders();
        currentProviders = useGenerationStore.getState().providers;
      } catch {
        currentProviders = [];
      }
    }

    const originalProvider = currentProviders.find((p) => p.id === record.providerId) ?? null;
    if (originalProvider && useGenerationStore.getState().activeProviderId !== originalProvider.id) {
      try {
        await setActiveProvider(originalProvider.id);
      } catch {
        toast.info('服务商切换失败', '已回填内容，请在制作工作台手动选择服务商。');
      }
    }

    const detailedRecord = await api.history.get(record.id).catch(() => null);
    const references = detailedRecord?.promptReferences ?? [];
    const mappedParams = historyParamsToRefineParams(record.params) ?? {};
    openDraft({
      prompt: extractUserPromptFromComposed(record.promptText, references),
      negative: record.negativeText ?? '',
      params: mappedParams,
      source: {
        kind: 'history',
        id: record.id,
        label: '生成历史',
        promptId: record.promptId ?? undefined,
      },
      references,
    });

    if (!originalProvider) {
      toast.info('已载入制作工作台', '原服务商不可用，请选择或配置可用服务商。');
    } else if (!originalProvider.hasKey) {
      toast.info('已载入制作工作台', `「${originalProvider.name}」缺少密钥，请先配置。`);
    } else {
      toast.success('已载入制作工作台', '提示词和当时的引用已恢复，确认后手动生成。');
    }
  };

  const saveHistoryAsPrompt = async () => {
    setSavingPrompt(true);
    const input = historyRecordToPromptInput(record, saveTitle);
    try {
      const created = await api.prompt.create(input);
      let linkResult = null;
      try {
        linkResult = await linkHistoriesToPrompt(created.id, [record.id]);
      } catch {
        // The prompt is already durable; association failure is reported below
        // without presenting the save itself as failed.
      }
      setSaveDialogOpen(false);
      toast.show({
        title: '已存为提示词',
        description: linkResult == null
          ? `${input.title} · 重启应用后可建立作品关联`
          : `${input.title} · 已关联作品`,
        variant: linkResult == null ? 'warning' : 'success',
        duration: 6000,
        action: {
          label: '查看',
          onClick: () => requestHighlightPrompt(created.id),
        },
      });
    } catch (err) {
      toast.error('存为提示词失败', err instanceof Error ? err.message : '请稍后重试。');
    } finally {
      setSavingPrompt(false);
    }
  };

  const deleteRecordWithFile = async () => {
    if (!record.imagePath || deletingWithFile) return;
    setDeletingWithFile(true);
    try {
      await remove(record.id, { deleteFile: true });
      setDeleteFileDialogOpen(false);
    } catch (err) {
      toast.error('删除失败', err instanceof Error ? err.message : '请稍后重试。');
    } finally {
      setDeletingWithFile(false);
    }
  };

  return (
    <div
      className="flex h-full flex-col"
      data-testid="history-detail"
      data-history-id={record.id}
      data-status={meta.status}
    >
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {/* 大图 / 占位 */}
        <button
          type="button"
          className={cn(
            'relative block w-full overflow-hidden rounded-lg border border-border-subtle bg-inset text-left',
            canOpenImage && 'cursor-zoom-in hover:border-border-default',
          )}
          data-testid="history-detail-image"
          onClick={() => {
            if (canOpenImage) onOpenLightbox?.(record.id);
          }}
          disabled={!canOpenImage}
          title={canOpenImage ? '放大预览' : undefined}
        >
          {showImage ? (
            <img
              src={toImageSrc(record.imagePath!)}
              alt=""
              onError={() => setImgBroken(true)}
              className="max-h-56 w-full object-contain"
            />
          ) : (
            <div className="flex h-36 flex-col items-center justify-center gap-1.5 text-quaternary">
              <ImageOff className="h-8 w-8" />
              <span className="text-[11px]">
                {meta.status === 'success' ? '图片不可用' : '无生成图片'}
              </span>
            </div>
          )}
        </button>

        {/* 状态行 */}
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <StatusGlyph status={record.status} />
            <span className={cn('text-[12px] font-semibold', meta.colorClass)}>{meta.label}</span>
            <span className="text-[11px] text-border-strong">·</span>
            <span
              className={cn('truncate text-[11px] text-primary', displayModelName(record.model) === record.model && 'font-mono')}
              data-testid="history-detail-model"
              title={record.model}
            >
              {displayModelName(record.model)}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-tertiary">
            <span className="truncate" data-testid="history-detail-provider" title={providerName}>
              {providerName}
            </span>
            <span className="text-border-strong">·</span>
            <span className="font-mono tabular-nums" data-testid="history-detail-time">
              {formatTime(record.createdAt)}
            </span>
            {meta.status === 'success' && (
              <>
                <span className="text-border-strong">·</span>
                <span className="font-mono tabular-nums" data-testid="history-detail-cost">
                  {formatHistoryCost(record.cost, record.costUnit)}
                </span>
                <span className="text-border-strong">·</span>
                <span className="font-mono tabular-nums" data-testid="history-detail-duration">
                  {formatDuration(record.durationMs)}
                </span>
              </>
            )}
          </div>
        </div>

        {/* 提示词 */}
        <Section
          label="提示词"
          action={
            <button
              type="button"
              className="inline-flex items-center gap-0.5 text-[10px] text-tertiary hover:text-primary"
              onClick={() => void copyPrompt()}
              data-testid="history-detail-copy-prompt"
              title="复制提示词"
            >
              <Copy className="h-3 w-3" /> 复制
            </button>
          }
        >
          <pre
            className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-inset px-2 py-1.5 font-mono text-[11px] leading-relaxed text-secondary"
            data-testid="history-detail-prompt"
          >
            {record.promptText || '未记录'}
          </pre>
        </Section>

        {record.negativeText ? (
          <Section label="负面提示词">
            <pre
              className="max-h-28 overflow-auto whitespace-pre-wrap break-words rounded-md bg-inset px-2 py-1.5 font-mono text-[11px] leading-relaxed text-tertiary"
              data-testid="history-detail-negative"
            >
              {record.negativeText}
            </pre>
          </Section>
        ) : null}

        <Section label="参数">
          <p
            className="font-mono text-[11px] leading-relaxed text-secondary"
            data-testid="history-detail-params"
          >
            {paramsLine}
          </p>
        </Section>

        <HistoryLineagePanel record={record} />

        <Section label="来源">
          <p className="text-[11px] text-secondary" data-testid="history-detail-source">
            {sourceLabel}
          </p>
        </Section>

        {/* 失败信息 */}
        {meta.showError && (
          <div
            className="rounded-md border border-danger/25 bg-danger/5 p-2.5"
            data-testid="history-detail-error"
          >
            <div className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium text-danger">
                  {record.errorCode ? (
                    <span className="font-mono text-[10px] opacity-80">{record.errorCode}</span>
                  ) : null}
                  {record.errorCode ? ' · ' : null}
                  {error.displayTitle}
                </p>
                <p className="mt-0.5 text-[10.5px] leading-snug text-danger/80">{error.hint}</p>
                {(record.errorMessage || record.errorCode) && (
                  <button
                    type="button"
                    className="mt-1.5 inline-flex items-center gap-0.5 text-[10px] text-tertiary hover:text-secondary"
                    onClick={() => setErrorOpen((v) => !v)}
                    data-testid="history-detail-error-toggle"
                  >
                    {errorOpen ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                    技术细节
                  </button>
                )}
                {errorOpen && (
                  <pre
                    className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-words rounded bg-inset/80 px-1.5 py-1 font-mono text-[10px] leading-snug text-tertiary"
                    data-testid="history-detail-error-details"
                  >
                    {[record.errorCode, record.errorMessage].filter(Boolean).join('\n') || '未记录'}
                  </pre>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {error.canRetry ? (
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={isRetrying}
                      onClick={() => void retry(record.id)}
                      data-testid="history-detail-retry"
                    >
                      {isRetrying ? <Spinner size={12} /> : <RotateCcw className="h-3 w-3" />}
                      {isRetrying ? '重试中…' : '重试'}
                    </Button>
                  ) : error.primaryAction?.kind === 'update_key' ? (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => {
                        if (provider) openProviderDialog(provider);
                        else toast.info('服务商不存在', '请到设置中选择一个可用服务商。');
                      }}
                      data-testid="history-detail-error-action"
                    >
                      <KeyRound className="h-3 w-3" /> 更新密钥
                    </Button>
                  ) : error.primaryAction ? (
                    <span
                      className="text-[10px] text-tertiary"
                      data-testid="history-detail-error-action"
                    >
                      建议：{error.primaryAction.label}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 动作区：反哺主路径 + 文件系统动作 */}
      <div className="space-y-1.5 border-t border-border-subtle p-2.5">
        <div className="grid grid-cols-1 gap-1.5">
          <HistoryFileAction
            icon={Wand2}
            label="再次制作"
            tip="进入制作界面并填入这条历史的提示词，确认后手动生成"
            testId="history-detail-regen"
            disabled={false}
            onClick={() => void reeditHistory()}
          />
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <HistoryFileAction
            icon={LayoutTemplate}
            label="创建设计方案"
            tip="以这条历史提示词创建可复用的设计方案草稿"
            testId="history-detail-create-scheme"
            disabled={false}
            onClick={createDesignScheme}
          />
          <HistoryFileAction
            icon={Save}
            label="存为提示词"
            tip="将提示词、负面提示词与参数存为提示词库资产"
            testId="history-detail-save"
            disabled={savingPrompt}
            onClick={openSavePromptDialog}
          />
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <HistoryFileAction
            icon={FolderOpen}
            label="打开文件夹"
            tip={record.imagePath ? '在系统文件管理器中定位图片' : '无图片路径'}
            testId="history-detail-folder"
            disabled={!record.imagePath}
            onClick={() => void openImageFolder()}
          />
          <HistoryFileAction
            icon={Copy}
            label="复制图片"
            tip={record.imagePath ? '复制图片到系统剪贴板' : '无图片'}
            testId="history-detail-copy-image"
            disabled={!record.imagePath}
            onClick={() => void copyImage()}
          />
        </div>

        <div className="flex gap-1.5 pt-0.5">
          {confirmDelete ? (
            <span className="flex flex-1 items-center justify-end gap-1">
              <button
                type="button"
                className="rounded px-1.5 py-0.5 text-[10px] text-secondary hover:bg-hover"
                onClick={() => setConfirmDelete(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="rounded bg-danger px-1.5 py-0.5 text-[10px] text-on-danger hover:brightness-105"
                data-testid="history-detail-delete-confirm"
                onClick={() => {
                  setConfirmDelete(false);
                  void remove(record.id);
                }}
              >
                确认删除
              </button>
            </span>
          ) : (
            <Button
              size="xs"
              variant="ghost"
              className="w-full text-danger hover:text-danger"
              onClick={() => setConfirmDelete(true)}
              data-testid="history-detail-delete"
            >
              <Trash2 className="h-3 w-3" /> 删除记录
            </Button>
          )}
        </div>
        <Button
          size="xs"
          variant="ghost"
          className="w-full text-danger hover:text-danger"
          disabled={!record.imagePath}
          onClick={() => setDeleteFileDialogOpen(true)}
          data-testid="history-detail-delete-file"
          title={record.imagePath ? '删除记录并删除磁盘源文件' : '无图片路径'}
        >
          <Trash2 className="h-3 w-3" /> 删除记录+源文件
        </Button>
      </div>

      <Dialog
        open={saveDialogOpen}
        onOpenChange={(open) => {
          if (!savingPrompt) setSaveDialogOpen(open);
        }}
      >
        <DialogContent className="max-w-md" data-testid="history-save-prompt-dialog">
          <DialogHeader>
            <DialogTitle>存为提示词</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              value={saveTitle}
              onChange={(e) => setSaveTitle(e.target.value)}
              placeholder={defaultHistoryPromptTitle(record)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveHistoryAsPrompt();
              }}
              data-testid="history-save-title"
            />
            <p className="text-[10px] text-quaternary">
              留空将使用提示词前 20 字。保存后可从提示词库继续管理和生成。
            </p>
            <pre
              className="max-h-28 overflow-auto whitespace-pre-wrap break-words rounded-md bg-inset px-2 py-1.5 font-mono text-[10.5px] leading-relaxed text-tertiary"
              data-testid="history-save-preview"
            >
              {record.promptText || '未记录'}
            </pre>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSaveDialogOpen(false)} disabled={savingPrompt}>
              取消
            </Button>
            <Button onClick={saveHistoryAsPrompt} disabled={savingPrompt} data-testid="history-save-confirm">
              {savingPrompt ? '保存中…' : '存为提示词'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteFileDialogOpen}
        onOpenChange={(open) => {
          if (!deletingWithFile) setDeleteFileDialogOpen(open);
        }}
      >
        <DialogContent className="max-w-md" data-testid="history-delete-file-dialog">
          <DialogHeader>
            <DialogTitle>删除记录和源文件？</DialogTitle>
            <DialogDescription>
              这会删除生成历史，并尝试删除磁盘上的图片文件；源文件删除后不可恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" disabled={deletingWithFile} onClick={() => setDeleteFileDialogOpen(false)}>
              取消
            </Button>
            <Button
              variant="danger"
              disabled={deletingWithFile}
              onClick={() => void deleteRecordWithFile()}
              data-testid="history-delete-file-confirm"
            >
              {deletingWithFile ? '删除中…' : '确认删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

async function resolveSourceLabel(record: HistoryRecord): Promise<string> {
  let promptTitle: string | null = null;

  if (record.promptId) {
    try {
      const p = await api.prompt.get(record.promptId);
      promptTitle = p?.title ?? null;
    } catch {
      promptTitle = null;
    }
  }

  return formatSourceLabel({
    promptTitle,
    promptId: record.promptId,
  });
}

function StatusGlyph({ status }: { status: string }) {
  const meta = historyStatusMeta(status);
  if (meta.status === 'success') {
    return <CheckCircle2 className={cn('h-3.5 w-3.5 shrink-0', meta.colorClass)} />;
  }
  if (meta.status === 'cancelled') {
    return <Ban className={cn('h-3.5 w-3.5 shrink-0', meta.colorClass)} />;
  }
  return <XCircle className={cn('h-3.5 w-3.5 shrink-0', meta.colorClass)} />;
}

function Section({
  label,
  action,
  children,
}: {
  label: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-quaternary">{label}</div>
        {action}
      </div>
      {children}
    </div>
  );
}

function HistoryFileAction({
  icon: Icon,
  label,
  tip,
  testId,
  disabled,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  tip: string;
  testId: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex w-full">
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            className="w-full"
            data-testid={testId}
            title={tip}
            onClick={onClick}
          >
            <Icon className="h-3 w-3" /> {label}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{tip}</TooltipContent>
    </Tooltip>
  );
}
