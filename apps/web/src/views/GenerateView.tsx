import { useState } from 'react';
import { ArrowDownToLine, ArrowUp, FileText, Square } from '@musefold/ui/icons';
import {
  GenerationResultSurface,
  GenerationRetryAction,
  WorkbenchAssistantFrame,
  WorkbenchAssistantAvatar,
  WorkbenchAssistantHeader,
  WorkbenchBrand,
  WorkbenchComposerFrame,
  WorkbenchComposerPrompt,
  WorkbenchComposerSaveStatus,
  WorkbenchComposerSubmitButton,
  WorkbenchContextMenu,
  WorkbenchEmptyState,
  WorkbenchGenerationSettingsPopover,
  WorkbenchPageFrame,
  WorkbenchRatioPicker,
  WorkbenchResultGrid,
  WorkbenchTurnActions,
  WorkbenchTurnActionIcon,
  WorkbenchTimelineContent,
  WorkbenchTimelineViewport,
  WorkbenchTurnFrame,
  WorkbenchUserMessage,
  GenerationSavePromptAction,
  WorkbenchMessageActions,
  WorkbenchPromptReferenceCard,
  isWorkbenchGenerationActive,
  sortWorkbenchGenerationSnapshots,
  upsertWorkbenchGenerationSnapshot,
  useWorkbenchTimelineController,
  workbenchGenerationResultStatus,
  workbenchGenerationStatusLabel,
  workbenchComposerPlaceholder,
  canShareImage,
  shareImageAsset,
  type GeneratePageController,
} from '@musefold/product-ui';
import { Button, ImageLightbox } from '@musefold/ui';
import { downloadImage } from '../download-image';
import musefoldIconUrl from '../../../../website/Musefold/assets/musefold-icon.png';
import musefoldLogoUrl from '../../../../docs/v0.3/logo.png';

type Ratio = '1:1' | '16:9' | '9:16';

const WORKBENCH_RATIO_OPTIONS = [
  { id: '1:1', label: '方图', ratio: '1:1', detail: '1024x1024' },
  { id: '16:9', label: '宽屏', ratio: '16:9', detail: '1536x1024' },
  { id: '9:16', label: '手机竖屏', ratio: '9:16', detail: '1024x1536' },
] as const;
const WORKBENCH_QUALITY_OPTIONS = [
  { id: 'auto', label: '自动', hint: '模型默认' },
  { id: 'low', label: '标准', hint: '更快' },
  { id: 'medium', label: '高清', hint: '平衡' },
  { id: 'high', label: '超清', hint: '细节优先' },
] as const;

export function GenerateView({
  page,
  onOpenPromptLibrary,
  onOpenHistory,
}: {
  page: GeneratePageController;
  onOpenPromptLibrary: () => void;
  onOpenHistory: () => void;
}) {
  const {
    promptText,
    setPromptText,
    ratio,
    setRatio,
    quality,
    setQuality,
    job,
    jobs,
    savePromptState,
    actionError: error,
    draftSaveStatus,
    draftConflict,
    selectedPrompt,
    canGenerate,
    submit,
    cancel,
    savePrompt,
    retrying,
    retry,
    reuse,
    useCloudDraft,
    overwriteCloudDraft,
    clearPromptReference,
  } = page;
  const active = job && isWorkbenchGenerationActive(job.status);
  const [messageActionsOpenId, setMessageActionsOpenId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    url: string;
    prompt: string;
  } | null>(null);
  const turnJobs = job
    ? upsertWorkbenchGenerationSnapshot(jobs, job)
    : sortWorkbenchGenerationSnapshots(jobs);
  const timeline = useWorkbenchTimelineController({
    followKey: job ? `${job.id}:${job.status}:${job.progress}` : 'empty',
    itemCount: turnJobs.length,
  });

  return (
    <>
      <WorkbenchPageFrame
        className="workbench-page"
        stageClassName="workbench-stage"
        timeline={
          <WorkbenchTimelineViewport
            controller={timeline}
            className="workbench-scroll"
            testId="generation-timeline"
            onPointerDown={(event) => {
              const target = event.target as Element;
              if (!target.closest('[data-user-message], [data-workbench-results]')) {
                setMessageActionsOpenId(null);
              }
            }}
          >
            <WorkbenchTimelineContent
              itemCount={turnJobs.length}
              empty={
                <WorkbenchEmptyState
                  brand={<WorkbenchBrand src={musefoldLogoUrl} alt="Musefold / 未像" />}
                  onSelectSuggestion={(suggestion) => {
                    setPromptText(suggestion);
                    window.requestAnimationFrame(() => {
                      const textarea =
                        document.querySelector<HTMLTextAreaElement>('#generation-prompt');
                      textarea?.focus();
                      textarea?.setSelectionRange(suggestion.length, suggestion.length);
                    });
                  }}
                />
              }
            >
              {turnJobs.map((turnJob) => {
                const isCurrent = turnJob.id === job?.id;
                const turnActive = isWorkbenchGenerationActive(turnJob.status);
                const resultSurfaceStatus = workbenchGenerationResultStatus(turnJob.status);
                const retryable = ['failed', 'cancelled'].includes(turnJob.status);
                const assets = turnJob.assets.length > 0 ? turnJob.assets : [null];
                const actionsOpen = messageActionsOpenId === turnJob.id;
                const promptTestId = isCurrent
                  ? 'generation-prompt'
                  : `generation-prompt-${turnJob.id}`;
                return (
                  <WorkbenchTurnFrame
                    key={turnJob.id}
                    testId={`generation-turn-${turnJob.id}`}
                    userTestId={
                      isCurrent
                        ? 'generation-user-message'
                        : `generation-user-message-${turnJob.id}`
                    }
                    status={turnJob.status}
                    userProps={{
                      tabIndex: 0,
                      onClick: (event) => {
                        if ((event.target as Element).closest('button, a')) return;
                        setMessageActionsOpenId(turnJob.id);
                      },
                      onKeyDown: (event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setMessageActionsOpenId(turnJob.id);
                        }
                        if (event.key === 'Escape') setMessageActionsOpenId(null);
                      },
                    }}
                    userMessage={
                      <WorkbenchUserMessage
                        promptTestId={promptTestId}
                        prompt={turnJob.request.prompt || '未命名设计'}
                        meta={
                          <span>
                            {turnJob.request.aspectRatio ?? ratio} ·{' '}
                            {turnJob.request.quality ?? '自动'}
                          </span>
                        }
                        negative={turnJob.request.negative}
                        actions={
                          actionsOpen ? (
                            <WorkbenchMessageActions
                              onCopy={() => {
                                const clipboard = navigator.clipboard;
                                if (clipboard) {
                                  return clipboard
                                    .writeText(turnJob.request.prompt)
                                    .catch(() => undefined);
                                }
                              }}
                              onEdit={() => {
                                setPromptText(turnJob.request.prompt);
                                setMessageActionsOpenId(null);
                                window.requestAnimationFrame(() => {
                                  timeline.scrollToLatest('auto');
                                  document
                                    .querySelector<HTMLTextAreaElement>('#generation-prompt')
                                    ?.focus();
                                });
                              }}
                              copyTestId={
                                isCurrent
                                  ? 'generation-user-message-copy'
                                  : `generation-user-message-copy-${turnJob.id}`
                              }
                              editTestId={
                                isCurrent
                                  ? 'generation-user-message-edit'
                                  : `generation-user-message-edit-${turnJob.id}`
                              }
                            />
                          ) : undefined
                        }
                      />
                    }
                  >
                    <WorkbenchAssistantFrame
                      testId="generation-result-group"
                      avatar={<WorkbenchAssistantAvatar imageUrl={musefoldIconUrl} />}
                      header={
                        <WorkbenchAssistantHeader
                          label="Musefold"
                          detail={workbenchGenerationStatusLabel(turnJob.status)}
                        />
                      }
                    >
                      <WorkbenchResultGrid
                        count={assets.length}
                        aspectRatio={turnJob.request.aspectRatio ?? ratio}
                      >
                        {assets.map((asset, assetIndex) => (
                          <GenerationResultSurface
                            key={asset?.id ?? `${turnJob.id}-pending`}
                            id={`${turnJob.id}-${asset?.id ?? assetIndex}`}
                            testId={
                              isCurrent && assetIndex === 0
                                ? 'generation-result-surface'
                                : `generation-result-${turnJob.id}-${assetIndex}`
                            }
                            imageTestId={
                              isCurrent && assetIndex === 0
                                ? 'generation-result-image'
                                : `generation-result-image-${turnJob.id}-${assetIndex}`
                            }
                            className="generated-asset"
                            status={resultSurfaceStatus}
                            imageUrl={asset?.url ?? null}
                            aspectRatio={turnJob.request.aspectRatio ?? ratio}
                            progressLabel={turnActive ? `${turnJob.progress}%` : undefined}
                            errorMessage={turnJob.error?.message ?? undefined}
                            footerLabel={
                              turnActive
                                ? `${turnJob.progress}%`
                                : workbenchGenerationStatusLabel(turnJob.status)
                            }
                            onOpenImage={
                              asset
                                ? () =>
                                    setPreview({
                                      url: asset.url,
                                      prompt: turnJob.request.prompt,
                                    })
                                : undefined
                            }
                            mediaActions={
                              asset ? (
                                <a
                                  className="result-download"
                                  href={asset.url}
                                  download
                                  title="下载图片"
                                  aria-label="下载图片"
                                >
                                  <ArrowDownToLine aria-hidden="true" />
                                </a>
                              ) : undefined
                            }
                            footerActions={
                              assetIndex === 0 && retryable ? (
                                <GenerationRetryAction
                                  onRetry={() => retry(turnJob)}
                                  busy={retrying(turnJob)}
                                />
                              ) : asset ? (
                                <div className="result-actions">
                                  <GenerationSavePromptAction
                                    state={savePromptState(turnJob)}
                                    onSave={() => savePrompt(turnJob)}
                                    className="button button-secondary result-save-prompt"
                                  />
                                </div>
                              ) : undefined
                            }
                          />
                        ))}
                      </WorkbenchResultGrid>
                      <WorkbenchTurnActions
                        menuItems={[
                          assets.some(Boolean)
                            ? {
                                id: 'reuse',
                                label: '再次制作',
                                icon: <WorkbenchTurnActionIcon name="reuse" />,
                                onSelect: () => reuse(turnJob),
                              }
                            : null,
                          turnJob.request.prompt.trim() && turnJob.status !== 'running'
                            ? {
                                id: 'save-prompt',
                                label: '存为提示词',
                                onSelect: () => undefined,
                                render: (close: () => void) => (
                                  <GenerationSavePromptAction
                                    role="menuitem"
                                    state={savePromptState(turnJob)}
                                    onSave={() => {
                                      savePrompt(turnJob);
                                      close();
                                    }}
                                    className="mf-workbench-turn-menu-item"
                                  />
                                ),
                              }
                            : null,
                          {
                            id: 'history',
                            label: '查看生成历史',
                            icon: <WorkbenchTurnActionIcon name="history" />,
                            onSelect: onOpenHistory,
                          },
                        ].filter((item): item is NonNullable<typeof item> => item !== null)}
                      />
                    </WorkbenchAssistantFrame>
                  </WorkbenchTurnFrame>
                );
              })}
            </WorkbenchTimelineContent>
          </WorkbenchTimelineViewport>
        }
        composer={
          <WorkbenchComposerFrame
            attachments={
              selectedPrompt ? (
                <WorkbenchPromptReferenceCard
                  title={selectedPrompt.title}
                  text={selectedPrompt.content}
                  onClear={clearPromptReference}
                />
              ) : undefined
            }
            leadingControls={
              <>
                <WorkbenchContextMenu
                  actions={[
                    {
                      id: 'ref-prompt',
                      section: '引用',
                      label: '提示词',
                      hint: '从库中引用',
                      icon: <FileText aria-hidden="true" />,
                      onSelect: onOpenPromptLibrary,
                    },
                  ]}
                />
                <WorkbenchRatioPicker
                  value={ratio}
                  options={[...WORKBENCH_RATIO_OPTIONS]}
                  onChange={(value) => setRatio(value as Ratio)}
                  testIdPrefix="refine-ratio"
                />
                <WorkbenchGenerationSettingsPopover
                  quality={quality}
                  qualityOptions={[...WORKBENCH_QUALITY_OPTIONS]}
                  count={1}
                  onQualityChange={(value) => setQuality(value as typeof quality)}
                />
              </>
            }
            trailingControls={
              <>
                <WorkbenchComposerSaveStatus status={draftSaveStatus} />
                {active ? (
                  <WorkbenchComposerSubmitButton
                    active
                    onClick={cancel}
                    activeLabel="取消生成"
                    activeIcon={<Square aria-hidden="true" />}
                  />
                ) : (
                  <WorkbenchComposerSubmitButton
                    disabled={!promptText.trim() || !canGenerate}
                    onClick={submit}
                    idleLabel="生成图片"
                    idleIcon={<ArrowUp aria-hidden="true" />}
                  />
                )}
              </>
            }
            footer={
              error ? (
                <p className="form-error composer-error" role="alert">
                  {error}
                </p>
              ) : undefined
            }
          >
            <WorkbenchComposerPrompt
              id="generation-prompt"
              data-testid="generation-composer-prompt"
              value={promptText}
              onChange={(event) => setPromptText(event.target.value)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                const shouldSubmit =
                  event.key === 'Enter' && (!event.shiftKey || event.metaKey || event.ctrlKey);
                if (shouldSubmit) {
                  event.preventDefault();
                  if (promptText.trim() && canGenerate && !active) submit();
                }
              }}
              placeholder={workbenchComposerPlaceholder({
                hasTurns: turnJobs.length > 0,
                hasPromptReference: Boolean(selectedPrompt),
              })}
              maxLength={12_000}
            />
            {draftConflict && (
              <div
                className="composer-conflict"
                role="alert"
                data-testid="workbench-draft-conflict"
              >
                <div>
                  <strong>云端草稿已更新</strong>
                  <span>请选择保留的版本</span>
                </div>
                <div className="composer-conflict-actions">
                  <Button variant="secondary" onClick={useCloudDraft}>
                    使用云端
                  </Button>
                  <Button variant="primary" onClick={overwriteCloudDraft}>
                    保留本机
                  </Button>
                </div>
              </div>
            )}
          </WorkbenchComposerFrame>
        }
      />
      <ImageLightbox
        src={preview?.url ?? null}
        prompt={preview?.prompt ?? null}
        onClose={() => setPreview(null)}
        onSave={() => {
          if (preview) downloadImage(preview.url);
        }}
        onShare={
          canShareImage()
            ? () => {
                if (preview)
                  return shareImageAsset(preview.url, 'Musefold 生成图片').then(() => undefined);
              }
            : undefined
        }
        onCopyPrompt={() => {
          if (preview && navigator.clipboard) {
            return navigator.clipboard.writeText(preview.prompt).catch(() => undefined);
          }
        }}
      />
    </>
  );
}
