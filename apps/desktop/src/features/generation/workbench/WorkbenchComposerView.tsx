import {
  History,
  Wand2,
  X,
} from "../../../components/ui/icons";
import {
  WorkbenchComposerContextTray,
  WorkbenchComposerFrame,
  WorkbenchComposerPrompt,
  WorkbenchPromptReferenceCard,
  workbenchComposerPlaceholder,
} from "@musefold/product-ui";
import { WORKBENCH_PROMPT_LIMIT } from "./store";
import { ImageLightbox } from "../../../components/image-lightbox";
import { cn } from "../../../lib/utils";
import { exactGithubSkillUrl } from "./composerIntent";
import {
  HistorySourcePicker,
  SchemeRunAttachment,
  SchemeRunVariableFields,
} from "@renderer/runtime/scheme-access";
import { SkillRuntimeAttachment } from "./SkillRuntimeAttachment";
import { DraftImagesPreview } from "./DraftImagesPreview";
import { RefinementTargetReference } from "./RefinementTargetReference";
import { SourceChip } from "./SourceChip";
import { workbenchComposerControls } from "./WorkbenchComposerChrome";
import type { WorkbenchComposerViewProps } from "./workbenchComposerViewProps";

export type { WorkbenchComposerViewProps };

export function WorkbenchComposerView(props: WorkbenchComposerViewProps) {
  const {
    prompt,
    draftCommand,
    setDraftCommand,
    draftHistorySource,
    setDraftHistorySource,
    references,
    draftImages,
    hasTurns,
    generatingHere,
    refinementContext,
    setPrompt,
    removeDraftImage,
    clearRefinement,
    skillRuntimeStatus,
    attachGithubSkill,
    removeGithubSkill,
    submissionProvider,
    schemeSource,
    doubaoRefinement,
    composedPrompt,
    overLimit,
    historyAttached,
    commandHints,
    canSubmit,
    textareaRef,
    composerSurfaceRef,
    imageInputRef,
    dragDepthRef,
    dragActive,
    setDragActive,
    previewPath,
    setPreviewPath,
    setSchemePickerOpen,
    historySourceOpen,
    setHistorySourceOpen,
    setCommandHintIndex,
    setCommandHintsDismissed,
    commandHintsVisible,
    activeCommandHintIndex,
    selectCommandHint,
    pickImage,
    handleClearSource,
    handleSubmit,
    stageImageFiles,
    removeReferenceAt,
    sourceBlockVisible,
    attachmentStripVisible,
    plainSource,
    plainSourcePreview,
    composerMode,
    composerModeLocked,
    setComposerMode,
    composerVariant,
    composerLayout,
  } = props;

  const { leadingControls, trailingControls } = workbenchComposerControls(props);
  const promptSourceId = plainSource?.kind === "prompt" ? plainSource.id : null;
  const promptReferences = references.filter(
    (reference) => !promptSourceId || reference.promptId !== promptSourceId,
  );

  return (
    <WorkbenchComposerFrame
      variant={composerVariant}
      layout={composerLayout}
      running={generatingHere}
      attachments={
        (sourceBlockVisible || attachmentStripVisible || promptReferences.length > 0) && (
          <WorkbenchComposerContextTray>
            {!refinementContext && schemeSource && (
              <SchemeRunAttachment
                source={schemeSource}
                imageCount={draftImages.length}
                onClear={handleClearSource}
                onPickImage={pickImage}
                onSwap={() => setSchemePickerOpen(true)}
              />
            )}
            { (attachmentStripVisible || promptReferences.length > 0) && (
              <div
                className="flex min-w-max items-center gap-2 overflow-x-auto pb-0.5"
                data-testid="workbench-attachments"
              >
                <SkillRuntimeAttachment />
                {historyAttached && draftHistorySource && (
                  <div
                    className="flex min-w-max items-center gap-2"
                    data-testid="history-source-chip"
                  >
                    <div className="flex h-12 min-w-[220px] items-center gap-2.5 rounded-lg border border-border-default bg-popover px-2.5">
                      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-inset text-secondary">
                        <History className="h-3.5 w-3.5" />
                      </span>
                      <button
                        type="button"
                        onClick={() => setHistorySourceOpen(true)}
                        className="min-w-0 flex-1 text-left"
                        title="点击重新选择历史范围"
                        data-testid="history-source-chip-body"
                      >
                        <span className="block truncate text-meta font-medium text-primary">
                          历史 · {draftHistorySource.items.length} 张图片
                          {draftHistorySource.items.some(
                            (item) => item.promptText,
                          )
                            ? ` + ${draftHistorySource.items.filter((item) => item.promptText).length} 条提示词`
                            : ""}
                        </span>
                        <span className="mt-0.5 block text-meta text-tertiary">
                          作为方案来源 · 点击调整范围
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setDraftHistorySource(null)}
                        className="icon-action h-7 w-7"
                        aria-label="移除历史来源"
                        title="移除"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                )}
                {plainSource && (
                  <SourceChip
                    source={plainSource}
                    onClear={handleClearSource}
                    previewText={plainSourcePreview}
                  />
                )}
                {promptReferences.map((reference) => (
                  <WorkbenchPromptReferenceCard
                    key={`${reference.promptId ?? "reference"}-${reference.scope}-${reference.text}`}
                    title={reference.title}
                    text={reference.text}
                    subtitle={
                      reference.scope === "full"
                        ? "引用提示词 · 整条"
                        : "引用提示词 · 选中片段"
                    }
                    onClear={() => {
                      const index = references.indexOf(reference);
                      if (index >= 0) removeReferenceAt(index);
                    }}
                    testId="refine-source"
                    workbenchTestId="workbench-source"
                  />
                ))}
                {refinementContext && (
                  <RefinementTargetReference
                    context={refinementContext}
                    onClear={clearRefinement}
                    onPreview={setPreviewPath}
                  />
                )}
                {draftImages.length > 0 && (
                  <DraftImagesPreview
                    images={draftImages}
                    startIndex={(refinementContext?.images.length ?? 0) + 1}
                    onRemove={removeDraftImage}
                    onPreview={setPreviewPath}
                  />
                )}
              </div>
            )}
          </WorkbenchComposerContextTray>
        )
      }
      surfaceRef={composerSurfaceRef}
      leadingControls={leadingControls}
      trailingControls={trailingControls}
      data-drag-active={dragActive ? "true" : "false"}
      onPaste={(event) => {
        const files = Array.from(event.clipboardData.items)
          .filter(
            (item) => item.kind === "file" && item.type.startsWith("image/"),
          )
          .map((item) => item.getAsFile())
          .filter((file): file is File => file !== null);
        const images =
          files.length > 0
            ? files
            : Array.from(event.clipboardData.files).filter((item) =>
                item.type.startsWith("image/"),
              );
        if (images.length === 0) {
          const pastedText = event.clipboardData.getData("text/plain").trim();
          const githubUrl = exactGithubSkillUrl(pastedText);
          if (githubUrl) {
            event.preventDefault();
            void attachGithubSkill(githubUrl);
          }
          return;
        }
        event.preventDefault();
        void stageImageFiles(images);
      }}
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes("Files") || generatingHere)
          return;
        event.preventDefault();
        dragDepthRef.current += 1;
        setDragActive(true);
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files") || generatingHere)
          return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) setDragActive(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepthRef.current = 0;
        setDragActive(false);
        const files = Array.from(event.dataTransfer.files).filter(
          (item) =>
            item.type.startsWith("image/") ||
            /\.(png|jpe?g|webp)$/i.test(item.name),
        );
        if (files.length > 0) void stageImageFiles(files);
      }}
    >
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="workbench-image-input"
        onChange={(event) => {
          const input = event.currentTarget;
          const files = Array.from(input.files ?? []);
          input.value = "";
          if (files.length > 0) void stageImageFiles(files);
        }}
      />
      {dragActive && (
        <div
          className="pointer-events-none absolute inset-1 z-20 flex items-center justify-center rounded-[20px] border border-dashed border-accent/55 bg-popover/92 text-[12px] font-medium text-accent"
          data-testid="workbench-image-drop-overlay"
        >
          松开以添加图片
        </div>
      )}
      <div
        className="mf-workbench-composer-mode"
        data-testid="composer-mode"
        role="tablist"
        aria-label="工作模式"
      >
        <button
          type="button"
          role="tab"
          aria-selected={composerMode === "image"}
          className="mf-workbench-composer-mode-option"
          data-active={composerMode === "image"}
          disabled={composerModeLocked}
          onClick={() => setComposerMode("image")}
        >
          图像
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={composerMode === "design-plan"}
          className="mf-workbench-composer-mode-option"
          data-active={composerMode === "design-plan"}
          disabled={composerModeLocked}
          onClick={() => setComposerMode("design-plan")}
        >
          <Wand2 aria-hidden="true" />
          设计方案
        </button>
        {composerModeLocked && (
          <span className="mf-workbench-composer-mode-status">
            {composerMode === "refinement"
              ? "微调"
              : composerMode === "scheme"
                ? "方案运行"
                : "Skill"}
          </span>
        )}
      </div>
      {overLimit && (
        <p
          className="mb-1.5 px-1 text-meta text-danger"
          data-testid="workbench-reference-over-limit"
        >
          {refinementContext
            ? doubaoRefinement
              ? `微调要求 ${composedPrompt.length} 字，超过 ${WORKBENCH_PROMPT_LIMIT} 字，请缩短修改说明。`
              : `原提示词与微调要求合计 ${composedPrompt.length} 字，超过 ${WORKBENCH_PROMPT_LIMIT} 字，请缩短修改说明。`
            : `提示词与引用合计 ${composedPrompt.length} 字，超过 ${WORKBENCH_PROMPT_LIMIT} 字，请移除引用或缩短正文。`}
        </p>
      )}
      {submissionProvider && !submissionProvider.hasKey && (
        <div
          className="mb-1.5 flex items-center gap-1.5 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-[11px] text-warning"
          data-testid="refine-no-key"
        >
          <span className="min-w-0 flex-1 truncate">
            「{submissionProvider.name}」还没有配置密钥
          </span>
        </div>
      )}
      {!refinementContext && <SchemeRunVariableFields />}
      {commandHintsVisible && (
        <div
          className="absolute inset-x-0 bottom-[calc(100%+10px)] z-50 rounded-xl border border-border-default bg-popover p-1.5 shadow-pop animate-scale-fade-in"
          role="listbox"
          aria-label="指令建议"
          data-testid="composer-command-hints"
        >
          <p className="px-2.5 py-1 text-meta font-medium text-secondary">
            指令
          </p>
          {commandHints.map((hint, index) => (
            <button
              key={hint.command}
              type="button"
              role="option"
              aria-selected={index === activeCommandHintIndex}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                index === activeCommandHintIndex
                  ? "bg-hover"
                  : "hover:bg-hover",
              )}
              onMouseEnter={() => setCommandHintIndex(index)}
              onClick={selectCommandHint}
              data-testid="composer-command-hint"
            >
              <Wand2 className="h-3.5 w-3.5 shrink-0 text-accent" />
              <span className="font-mono text-[11px] font-medium text-primary">
                {hint.command}
              </span>
              <span className="min-w-0 flex-1 truncate text-right text-meta text-tertiary">
                {hint.description}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="relative">
        <WorkbenchComposerPrompt
          ref={textareaRef}
          value={prompt}
          onChange={(event) => {
            const value = event.target.value;
            if (skillRuntimeStatus === "complete" && value)
              void removeGithubSkill();
            setPrompt(value);
            setCommandHintsDismissed(false);
            setCommandHintIndex(0);
          }}
          onKeyDown={(event) => {
            if (
              event.nativeEvent.isComposing ||
              event.nativeEvent.keyCode === 229
            )
              return;
            // 指令建议浮层可见时优先接管方向键 / Enter / Esc（Codex 式选择）。
            if (commandHintsVisible) {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const delta = event.key === "ArrowDown" ? 1 : -1;
                setCommandHintIndex(
                  (activeCommandHintIndex + delta + commandHints.length) %
                    commandHints.length,
                );
                return;
              }
              if (
                (event.key === "Enter" && !event.shiftKey) ||
                event.key === "Tab"
              ) {
                event.preventDefault();
                selectCommandHint();
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setCommandHintsDismissed(true);
                return;
              }
            }
            // 光标在正文最前时按 Backspace 依次删除行内胶囊（Codex 式）：先删最近的引用胶囊，再删指令芯片。
            if (
              event.key === "Backspace" &&
              event.currentTarget.selectionStart === 0 &&
              event.currentTarget.selectionEnd === 0
            ) {
              if (references.length > 0 && !refinementContext) {
                event.preventDefault();
                removeReferenceAt(references.length - 1);
                return;
              }
              if (draftCommand) {
                event.preventDefault();
                setDraftCommand(null);
                return;
              }
            }
            const shouldSubmit =
              event.key === "Enter" &&
              (!event.shiftKey || event.metaKey || event.ctrlKey);
            if (shouldSubmit) {
              event.preventDefault();
              if (canSubmit) handleSubmit();
            }
          }}
          maxLength={WORKBENCH_PROMPT_LIMIT}
          rows={1}
          aria-label="提示词输入"
          placeholder={
            draftCommand
              ? "描述你的方案想法，可附 GitHub Skill 地址…"
              : refinementContext
                ? "描述如何微调；如有其他图片，也可说明参考、风格或融合方式…"
                : schemeSource
                  ? schemeSource.mode === "modify"
                    ? "描述要修改的内容，例如：把默认比例改成 3:4…"
                    : schemeSource.mode === "trial"
                      ? "补充这次试运行的具体内容（可选）…"
                      : "补充本次要求（可选），方案会保持视觉方向…"
                  : references.length > 0
                    ? "已引用提示词，可补充本次要求（可选）…"
                    : workbenchComposerPlaceholder({
                        hasTurns,
                        hasPromptReference: references.length > 0,
                      })
          }
          data-testid="refine-prompt"
          data-workbench-testid="workbench-prompt"
          className="no-drag max-h-[180px] overflow-y-auto"
        />
      </div>
      <ImageLightbox path={previewPath} onClose={() => setPreviewPath(null)} />
      {historySourceOpen && (
        <HistorySourcePicker
          initialSelectedIds={draftHistorySource?.items.map(
            (item) => item.historyId,
          )}
          onCancel={() => setHistorySourceOpen(false)}
          onConfirm={({ items, note }) => {
            setHistorySourceOpen(false);
            setDraftCommand("design-plan");
            setDraftHistorySource({ items });
            // 提取说明必须始终可见可编辑（UI 规范 §10.2）；仅在正文为空时代填，避免覆盖用户输入。
            if (!prompt.trim()) setPrompt(note);
            window.requestAnimationFrame(() => textareaRef.current?.focus());
          }}
        />
      )}
    </WorkbenchComposerFrame>
  );
}
