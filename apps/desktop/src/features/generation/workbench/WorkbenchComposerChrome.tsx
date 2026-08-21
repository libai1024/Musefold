import type { ImageQuality } from "@musefold/desktop-contracts/enums";
import {
  ArrowUp,
  Blocks,
  FileText,
  GitBranch,
  History,
  ImagePlus,
  Loader2,
  Search,
  Square,
  Wand2,
} from "../../../components/ui/icons";
import {
  WorkbenchComposerSubmitButton,
  WorkbenchContextMenu,
  WorkbenchGenerationSettingsPopover,
  WorkbenchRatioPicker,
} from "@musefold/product-ui";
import { useAppStore } from "../../../stores/app";
import { REFINE_COUNTS } from "../params";
import { WORKBENCH_PROMPT_LIMIT } from "./store";
import { SchemeRunPickerPopover } from "./workbenchCrossFeature";
import { PromptPickerPopover } from "./PromptPickerPopover";
import { QUALITY_OPTIONS, WORKBENCH_RATIO_OPTIONS } from "./workbench-display";
import type { WorkbenchComposerViewProps } from "./workbenchComposerViewProps";

export function workbenchComposerControls(props: WorkbenchComposerViewProps) {
  const {
    imageBusy,
    generatingHere,
    composerMenuOpen,
    setComposerMenuOpen,
    pickImage,
    setPromptPickerOpen,
    setSchemePickerOpen,
    doubaoImageMode,
    importGithubFromClipboard,
    setDraftCommand,
    textareaRef,
    setHistorySourceOpen,
    schemePickerOpen,
    promptPickerOpen,
    applyPromptReference,
    refinementContext,
    params,
    setParams,
    effectiveImageCount,
    negative,
    setNegative,
    composedPrompt,
    referenceImageCount,
    cancelRequested,
    handleCancel,
    canSubmit,
    submissionProvider,
    designPlanIntent,
    schemeModifyMode,
    handleSubmit,
    schemeSource,
  } = props;

  const leadingControls = (
    <>
      <WorkbenchContextMenu
        disabled={imageBusy || generatingHere}
        busy={imageBusy}
        open={composerMenuOpen}
        onOpenChange={setComposerMenuOpen}
        title="添加图片，引用提示词、设计方案或 Skill"
        actions={[
          {
            id: "add-image",
            section: "添加",
            primary: true,
            label: "添加图片",
            hint: "上传、粘贴或拖入",
            icon: <ImagePlus aria-hidden="true" />,
            onSelect: () => void pickImage(),
            testId: "workbench-context-add-image",
          },
          {
            id: "ref-prompt",
            section: "引用",
            label: "提示词",
            hint: "从库中引用",
            icon: <FileText aria-hidden="true" />,
            onSelect: () => setPromptPickerOpen(true),
            testId: "workbench-context-ref-prompt",
          },
          {
            id: "ref-scheme",
            label: "设计方案",
            hint: "套用视觉方向",
            icon: <Blocks aria-hidden="true" />,
            onSelect: () => setSchemePickerOpen(true),
          },
          {
            id: "paste-skill",
            label: "GitHub Skill",
            hint: doubaoImageMode ? "粘贴后直传豆包" : "读取设计能力",
            icon: <GitBranch aria-hidden="true" />,
            onSelect: () => void importGithubFromClipboard(),
            testId: "workbench-context-paste-skill",
          },
          ...(!doubaoImageMode
            ? [
                {
                  id: "design-plan",
                  section: "Agent",
                  label: "生成设计方案",
                  hint: "先出草稿",
                  icon: <Wand2 aria-hidden="true" />,
                  onSelect: () => {
                    setDraftCommand("design-plan");
                    window.requestAnimationFrame(() =>
                      textareaRef.current?.focus(),
                    );
                  },
                  testId: "composer-menu-design-plan",
                },
                {
                  id: "history-source",
                  label: "从历史内容创建",
                  hint: "自行选择来源",
                  icon: <History aria-hidden="true" />,
                  onSelect: () => setHistorySourceOpen(true),
                },
                {
                  id: "find-scheme",
                  label: "寻找设计方案",
                  hint: "打开方案库",
                  icon: <Search aria-hidden="true" />,
                  onSelect: () =>
                    useAppStore.getState().setView("design-schemes"),
                },
              ]
            : []),
        ]}
      />
      {schemePickerOpen && (
        <SchemeRunPickerPopover onClose={() => setSchemePickerOpen(false)} />
      )}
      {promptPickerOpen && (
        <PromptPickerPopover
          onClose={() => setPromptPickerOpen(false)}
          onPick={applyPromptReference}
        />
      )}
      {!refinementContext && (
        <>
          <WorkbenchRatioPicker
            value={params.ratioId}
            onChange={(value) => setParams({ ratioId: value })}
            options={WORKBENCH_RATIO_OPTIONS}
            testIdPrefix="refine-ratio"
            allowCustomRatio
          />
          <WorkbenchGenerationSettingsPopover
            quality={params.quality}
            qualityOptions={QUALITY_OPTIONS}
            count={effectiveImageCount}
            countOptions={REFINE_COUNTS}
            negative={negative}
            onQualityChange={(quality) =>
              setParams({ quality: quality as ImageQuality })
            }
            onCountChange={(n) => setParams({ n })}
            onNegativeChange={setNegative}
            managedLabel={doubaoImageMode ? "豆包 · 网页" : undefined}
            managedDescription={
              doubaoImageMode
                ? referenceImageCount > 0
                  ? "编辑结果数量由豆包网页决定，回复文字随图片归组；本地每日最多提交 10 次。"
                  : "文字生图返回 4 张，图片与回复文字按同一批次归组；本地每日最多提交 10 次。"
                : undefined
            }
          />
          {composedPrompt.length >= WORKBENCH_PROMPT_LIMIT * 0.9 && (
            <span
              className="ml-1 shrink-0 font-mono text-[10px] text-quaternary"
              data-testid="workbench-prompt-count"
            >
              {composedPrompt.length}/{WORKBENCH_PROMPT_LIMIT}
            </span>
          )}
        </>
      )}
    </>
  );
  const trailingControls = generatingHere ? (
    <WorkbenchComposerSubmitButton
      active
      disabled={cancelRequested}
      onClick={() => void handleCancel()}
      activeLabel={cancelRequested ? "正在取消生成" : "停止生成"}
      activeIcon={
        cancelRequested ? <Loader2 className="animate-spin" /> : <Square />
      }
      className="no-drag"
      data-testid="refine-cancel"
      data-workbench-testid="workbench-cancel"
    />
  ) : (
    <WorkbenchComposerSubmitButton
      disabled={
        !canSubmit ||
        (!submissionProvider && !designPlanIntent && !schemeModifyMode)
      }
      onClick={handleSubmit}
      idleLabel={
        designPlanIntent
          ? "创建设计方案"
          : schemeSource
            ? schemeSource.mode === "modify"
              ? "发送修改要求"
              : schemeSource.mode === "trial"
                ? "试运行方案"
                : "按方案生成"
            : refinementContext
              ? "提交微调"
              : `生成图像，${effectiveImageCount} 张`
      }
      title={
        designPlanIntent
          ? "创建设计方案（Enter）"
          : schemeSource
            ? schemeSource.mode === "modify"
              ? "发送修改要求（Enter）"
              : schemeSource.mode === "trial"
                ? "试运行方案（Enter）"
                : "按方案生成（Enter）"
            : refinementContext
              ? "提交微调（Enter）"
              : submissionProvider
                ? "生成图像（Enter）"
                : "请先连接服务商"
      }
      idleIcon={<ArrowUp />}
      className="no-drag"
      data-testid="refine-generate"
      data-workbench-testid="workbench-submit"
    />
  );
  return { leadingControls, trailingControls };
}
