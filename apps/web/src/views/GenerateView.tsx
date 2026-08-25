import { useState } from 'react';
import { ArrowDownToLine, ArrowUp, FileText, Square, Wand2 } from '@musefold/ui/icons';
import {
  GenerationResultSurface,
  GenerationRetryAction,
  WorkbenchAssistantAvatar,
  WorkbenchAssistantHeader,
  WorkbenchComposerFrame,
  WorkbenchComposerPrompt,
  WorkbenchComposerSaveStatus,
  WorkbenchComposerSubmitButton,
  WorkbenchContextMenu,
  WorkbenchDraftConflictNotice,
  WorkbenchEmptyState,
  WorkbenchGenerationSettingsPopover,
  WorkbenchGenerationTurn,
  WorkbenchPageFrame,
  WorkbenchRatioPicker,
  WorkbenchTurnActions,
  WorkbenchTurnActionIcon,
  WorkbenchTimelineStage,
  WorkbenchUserMessage,
  GenerationSavePromptAction,
  WorkbenchMessageActions,
  WorkbenchPromptReferenceCard,
  WORKBENCH_QUALITY_OPTIONS,
  isWorkbenchGenerationActive,
  sortWorkbenchGenerationSnapshots,
  upsertWorkbenchGenerationSnapshot,
  useWorkbenchTimelineController,
  workbenchGenerationResultStatus,
  workbenchGenerationStatusLabel,
  workbenchComposerPlaceholder,
  workbenchRatioOptions,
  canShareImage,
  shareImageAsset,
  type GeneratePageController,
} from '@musefold/product-ui';
import { ImageLightbox } from '@musefold/ui';
import { downloadImage } from '../download-image';
import musefoldIconUrl from '../../../../website/Musefold/assets/musefold-icon.png';

type Ratio = '1:1' | '16:9' | '9:16';

// Web 只暴露三档比例；桌面用完整目录（V13-REUSE-02 裁定：目录共享，清单按宿主取子集）
const WORKBENCH_RATIO_OPTIONS = workbenchRatioOptions(['1:1', '16:9', '9:16']);

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

  // v2.0(11 §1/§5):新对话空态把 Composer 内联到品牌锁定区下方(flow + empty),
  // 已有会话保持 floating 贴底;两种形态共享同一份数据与交互骨架。
  const isEmpty = turnJobs.length === 0;
  const composerFrame = (placement: 'floating' | 'empty') => (
    <WorkbenchComposerFrame
      layout={placement === 'empty' ? 'flow' : 'floating'}
      variant={placement === 'empty' ? 'empty' : 'active'}
      running={Boolean(active)}
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
            options={WORKBENCH_RATIO_OPTIONS}
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
          <p className="form-error m-0 px-[15px] pb-[10px]" role="alert">
            {error}
          </p>
        ) : undefined
      }
    >
      <div
        className="mf-workbench-composer-mode"
        data-testid="composer-mode"
        role="tablist"
        aria-label="工作模式"
      >
        <button
          type="button"
          role="tab"
          aria-selected="true"
          className="mf-workbench-composer-mode-option"
          data-active="true"
        >
          图像
        </button>
        <button
          type="button"
          role="tab"
          aria-selected="false"
          className="mf-workbench-composer-mode-option"
          disabled
          title="设计方案目前仅支持桌面端"
        >
          <Wand2 aria-hidden="true" />
          设计方案
        </button>
      </div>
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
        <WorkbenchDraftConflictNotice
          onUseRemote={useCloudDraft}
          onKeepLocal={overwriteCloudDraft}
        />
      )}
    </WorkbenchComposerFrame>
  );

  return (
    <>
      {/* workbench-page / workbench-scroll 类名保留：680px 媒体块的键盘 inset 规则挂在其上 */}
      <WorkbenchPageFrame
        className="workbench-page relative min-h-0 flex-1 overflow-hidden"
        stageClassName="relative h-full min-h-0"
        timeline={
          <WorkbenchTimelineStage
            controller={timeline}
            className="workbench-scroll h-full overflow-y-auto [scrollbar-gutter:stable]"
            testId="generation-timeline"
            itemCount={turnJobs.length}
            onPointerDown={(event) => {
              const target = event.target as Element;
              if (!target.closest('[data-user-message], [data-workbench-results]')) {
                setMessageActionsOpenId(null);
              }
            }}
            empty={
              <WorkbenchEmptyState
                composer={composerFrame('empty')}
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
                <WorkbenchGenerationTurn
                  key={turnJob.id}
                  turnId={turnJob.id}
                  status={turnJob.status}
                  userTestId={
                    isCurrent ? 'generation-user-message' : `generation-user-message-${turnJob.id}`
                  }
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
                  avatar={<WorkbenchAssistantAvatar imageUrl={musefoldIconUrl} />}
                  header={
                    <WorkbenchAssistantHeader
                      label="Musefold"
                      detail={workbenchGenerationStatusLabel(turnJob.status)}
                    />
                  }
                  resultCount={assets.length}
                  resultAspectRatio={turnJob.request.aspectRatio ?? ratio}
                  results={assets.map((asset, assetIndex) => (
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
                      className="generated-asset relative mt-[8px] w-full max-w-[480px] overflow-hidden rounded-md border border-solid border-subtle bg-inset"
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
                          // result-download 类名保留：pointer:coarse 媒体块的触控尺寸挂在它上
                          <a
                            className="result-download ml-auto grid h-[30px] w-[30px] place-items-center rounded-sm border border-solid border-[rgba(255,255,255,0.8)] bg-[rgba(32,33,36,0.8)] text-white no-underline"
                            href={asset.url}
                            download
                            title="下载图片"
                            aria-label="下载图片"
                          >
                            <ArrowDownToLine aria-hidden="true" className="h-[14px] w-[14px]" />
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
                          <div className="result-actions flex justify-end">
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
                  actions={
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
                  }
                />
              );
            })}
          </WorkbenchTimelineStage>
        }
        composer={isEmpty ? null : composerFrame('floating')}
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
