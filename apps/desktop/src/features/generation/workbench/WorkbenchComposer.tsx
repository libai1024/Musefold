import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { DesktopLibraryPrompt } from "@musefold/desktop-contracts/library-documents";
import {
  MAX_REFERENCE_IMAGES,
  type LocalImageReference,
} from "@musefold/desktop-contracts/providers";
import { desktopHost as api } from "@renderer/runtime/desktop-host-services";
import { toast } from "../../../stores/toast";
import { promptParamsToRefineParams } from "../../../lib/prompt-params";
import { matchDesignPlanCommand } from "./composerIntent";
import { useWorkbenchComposerStore } from "./useWorkbenchComposerStore";
import { useGenerationWorkbenchStore } from "./store";
import { useSkillRuntimeStore } from "./skill-runtime-store";
import { WorkbenchComposerView } from "./WorkbenchComposerView";
import {
  composerPresentationMode,
  composerPresentationModeLocked,
} from "./composerPresentation";

export function WorkbenchComposer({
  composerVariant,
  composerLayout,
}: {
  /** v2.0 空态内联变体(11 §5):仅新对话首屏传 empty + flow。 */
  composerVariant?: "empty" | "active";
  composerLayout?: "floating" | "flow";
}) {
  const store = useWorkbenchComposerStore();
  const {
    prompt,
    source,
    draftCommand,
    setDraftCommand,
    references,
    draftImages,
    params,
    generatingHere,
    refinementContext,
    setPrompt,
    setNegative,
    setParams,
    setSource,
    clearSource,
    addReference,
    removeReference,
    addDraftImages,
    submit,
    submitRefinement,
    skillRuntimeStatus,
    skillRuntimeAttachment,
    skillRuntimeSourceUrl,
    attachGithubSkill,
    executeGithubSkill,
    removeGithubSkill,
    startSchemeCreation,
    startSchemeModify,
    schemeCreating,
    executeSchemeRun,
    submissionProvider,
    doubaoImageMode,
    designPlanIntent,
    commandHints,
    skillComposerAttachmentVisible,
    schemeSource,
    schemeModifyCanSubmit,
    schemeCanSubmit,
    canSubmit,
    historyAttached,
    handleCancel,
    referenceImageCount,
    cancelRequested,
    clearRefinement,
  } = store;

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerSurfaceRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const [imageStaging, setImageStaging] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [composerMenuOpen, setComposerMenuOpen] = useState(false);
  const [schemePickerOpen, setSchemePickerOpen] = useState(false);
  const [promptPickerOpen, setPromptPickerOpen] = useState(false);
  const [historySourceOpen, setHistorySourceOpen] = useState(false);
  const [commandHintIndex, setCommandHintIndex] = useState(0);
  const [commandHintsDismissed, setCommandHintsDismissed] = useState(false);

  useLayoutEffect(() => {
    const animationFrame = window.requestAnimationFrame(() => {
      const rect = composerSurfaceRef.current?.getBoundingClientRect();
      if (!rect || typeof api.pet.runToComposer !== "function") return;
      void api.pet.runToComposer({
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
      });
    });
    return () => {
      cancelAnimationFrame(animationFrame);
    };
  }, []);
  const commandHintsVisible = commandHints.length > 0 && !commandHintsDismissed;
  const activeCommandHintIndex = Math.min(
    commandHintIndex,
    Math.max(0, commandHints.length - 1),
  );
  const selectCommandHint = () => {
    setDraftCommand("design-plan");
    setPrompt("");
    setCommandHintIndex(0);
    textareaRef.current?.focus();
  };
  const handleClearSource = () => {
    const current = source;
    clearSource();
    if (current.kind === "prompt" && current.id) {
      const index = references.findIndex(
        (item) => item.promptId === current.id,
      );
      if (index >= 0) removeReference(index);
    }
  };
  const composerMode = composerPresentationMode({
    refinementContext,
    schemeSource,
    skillRuntimeStatus,
    designPlanIntent,
    draftCommand,
  });
  const composerModeLocked = composerPresentationModeLocked(composerMode);
  const setComposerMode = (mode: "image" | "design-plan") => {
    if (composerModeLocked || doubaoImageMode) return;
    setDraftCommand(mode === "design-plan" ? "design-plan" : null);
  };
  const effectiveGenerationParams = doubaoImageMode
    ? { ...params, n: 1 }
    : params;
  const effectiveImageCount = effectiveGenerationParams.n;
  const imageBusy = imageStaging;
  const stageImageFiles = async (files: File[]) => {
    if (imageBusy || generatingHere) return;
    const validFiles = files.filter(
      (file) =>
        file.type.startsWith("image/") ||
        /\.(png|jpe?g|webp)$/i.test(file.name),
    );
    if (validFiles.length !== files.length) {
      toast.error("未能加入图片", "请选择 PNG、JPG 或 WebP 图片");
    }
    const remaining = Math.max(0, MAX_REFERENCE_IMAGES - referenceImageCount);
    const accepted = validFiles.slice(0, remaining);
    if (accepted.length === 0) {
      toast.error(
        "图片已达上限",
        `最多同时加入 ${MAX_REFERENCE_IMAGES} 张图片`,
      );
      return;
    }
    setImageStaging(true);
    try {
      const staged: LocalImageReference[] = [];
      for (const file of accepted) {
        const result = await api.image.stageLocal({
          bytes: new Uint8Array(await file.arrayBuffer()),
          name: file.name || "clipboard-image.png",
          mimeType: file.type || undefined,
        });
        if (!result.ok) {
          toast.error("未能加入图片", result.error.message);
          continue;
        }
        staged.push(...result.images);
      }
      if (staged.length > 0) addDraftImages(staged);
      if (validFiles.length > accepted.length) {
        toast.show({
          title: `已加入 ${accepted.length} 张图片`,
          description: `最多支持 ${MAX_REFERENCE_IMAGES} 张，超出的图片未加入。`,
          variant: "warning",
        });
      }
    } catch (error) {
      toast.error(
        "未能加入图片",
        error instanceof Error ? error.message : "图片读取失败，请重新添加",
      );
    } finally {
      setImageStaging(false);
    }
  };
  const pickImage = () => {
    if (imageBusy || generatingHere) return;
    imageInputRef.current?.click();
  };
  const importGithubFromClipboard = async () => {
    setComposerMenuOpen(false);
    try {
      const text = (await api.system.readClipboardText()).trim();
      if (/^https:\/\/github\.com\//i.test(text)) {
        await attachGithubSkill(text);
        return;
      }
    } catch {
      // The narrow main-process clipboard bridge can still fail; direct paste remains available.
    }
    textareaRef.current?.focus();
    toast.show({
      title: "粘贴 GitHub Skill 地址",
      description:
        "把公开仓库、Skill 目录或 SKILL.md 地址直接粘贴到 Composer。",
    });
  };
  const startDesignCreation = async (
    seed: string,
    explicitGithubUrls?: string[],
  ) => {
    setComposerMenuOpen(false);
    if (schemeCreating || generatingHere) return;
    // 已粘贴的 Skill 芯片自动转为方案来源（用户决策：地址随创建吸收）。
    const chipUrl =
      skillRuntimeStatus === "ready"
        ? (skillRuntimeSourceUrl ?? undefined)
        : undefined;
    const inlineUrls = seed.match(/https:\/\/github\.com\/[^\s]+/gi) ?? [];
    // 多个地址合并编译为一个组合方案（P3）；去重保持出现顺序。
    const sourceUrls = [
      ...new Set([
        ...(explicitGithubUrls ?? []),
        ...(chipUrl ? [chipUrl] : []),
        ...inlineUrls,
      ]),
    ];
    const history =
      useGenerationWorkbenchStore.getState().draftHistorySource ?? undefined;
    let brief = seed;
    for (const url of sourceUrls) brief = brief.split(url).join(" ");
    brief = brief.replace(/\s+/g, " ").trim();
    if (!brief && sourceUrls.length === 0 && !history?.items.length) {
      toast.show({
        title: "先描述你的方案想法",
        description:
          "输入一段话，或粘贴一个 GitHub Skill 地址，再创建设计方案。",
      });
      textareaRef.current?.focus();
      return;
    }
    // 提交后指令已被消费，避免等待 Agent/安装确认期间仍显示可重复提交的芯片。
    setDraftCommand(null);
    if (skillRuntimeStatus !== "idle") await removeGithubSkill();
    await startSchemeCreation(brief, sourceUrls, history);
  };
  const handleSubmit = async () => {
    if (!canSubmit) return;
    if (designPlanIntent) {
      await startDesignCreation(
        designPlanIntent.prompt,
        designPlanIntent.githubUrls,
      );
      return;
    }
    if (schemeSource && schemeModifyCanSubmit) {
      // 修改方案（§8.3）：Agent 更新草稿 / 为正式方案产出待验证新版本；附件保持挂载支持多轮。
      await startSchemeModify(schemeSource, prompt.trim());
      return;
    }
    if (schemeSource && schemeCanSubmit && submissionProvider) {
      // 方案运行：主进程确定性编译提示词并逐张生图；对话轮与结果由事件驱动。
      await executeSchemeRun(schemeSource, {
        userPrompt: prompt.trim(),
        userImages: draftImages.map((image) => ({ ...image })),
        provider: { id: submissionProvider.id, name: submissionProvider.name },
        params: { ...effectiveGenerationParams },
      });
      return;
    }
    if (
      skillRuntimeAttachment &&
      skillRuntimeStatus === "ready" &&
      submissionProvider
    ) {
      // 豆包由主进程直传粘贴的 Skill 文件；其他 Provider 保持 Agent 优先。
      // 两条路径都通过事件流实时渲染，这里只发起并等待收尾。
      const userPrompt = prompt.trim();
      const userImages = draftImages.map((image) => ({ ...image }));
      const execution = await executeGithubSkill({
        userPrompt,
        userImages,
        provider: {
          id: submissionProvider.id,
          name: submissionProvider.name,
          type: submissionProvider.type,
        },
        params: { ...effectiveGenerationParams },
      });
      if (!execution) {
        toast.error(
          "Skill 执行失败",
          useSkillRuntimeStore.getState().error ||
            "请重新粘贴 Skill 地址后再试",
        );
        return;
      }
      if (execution.mode === "file-fallback") {
        toast.show({
          title: "已使用 Skill 文件生成",
          description: execution.fallbackReason
            ? `Agent 暂时不可用：${execution.fallbackReason}`
            : "Agent 暂时不可用，已改用仓库附件。",
          variant: "warning",
        });
      } else if (execution.mode === "direct-forward") {
        toast.success(
          "已将粘贴的 Skill 直接转发给豆包",
          "本次没有调用 Agent。",
        );
      }
      return;
    }
    if (refinementContext) {
      void submitRefinement(
        refinementContext.turnId,
        refinementContext.resultId,
        prompt,
        draftImages,
      );
      return;
    }
    void submit();
  };

  // 快捷引用提示词：与提示词库「使用」同一套逻辑 —— 正文/负向/参数预填，来源挂芯片（表达在 Composer 上方）。
  // 引用提示词 = 行内胶囊（Codex 式）：全文收敛进胶囊，正文只留用户补充；同一条重复引用时替换旧胶囊。
  const applyPromptReference = (target: DesktopLibraryPrompt) => {
    const referenceText = target.content.trim();
    const existingIndex = references.findIndex(
      (item) => item.promptId === target.id,
    );
    if (existingIndex >= 0) removeReference(existingIndex);
    addReference({
      promptId: target.id,
      title: target.title,
      text: referenceText,
      scope: "full",
    });
    // 正文若恰好是这条提示词全文（例如「使用」流程填入的），自动收敛进胶囊，避免重复提交。
    if (prompt.trim() === referenceText) setPrompt("");
    setNegative(target.contentNegative ?? "");
    setParams(
      target.params ? promptParamsToRefineParams(target.params) : { n: 1 },
    );
    setSource({ kind: "prompt", id: target.id, label: target.title });
    setPromptPickerOpen(false);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };
  // 胶囊与上方来源芯片描述同一条引用：任一侧移除时保持两者一致。
  const removeReferenceAt = (index: number) => {
    const target = references[index];
    removeReference(index);
    if (target && source.kind === "prompt" && source.id === target.promptId)
      clearSource();
  };

  // 输入/粘贴/预填的完整 / 指令收敛为指令芯片（Codex 式）：正文只留想法文本。
  useEffect(() => {
    if (draftCommand) return;
    const matched = matchDesignPlanCommand(prompt);
    if (!matched) return;
    setDraftCommand("design-plan");
    setPrompt(matched.rest);
  }, [prompt, draftCommand, setDraftCommand, setPrompt]);

  useEffect(() => {
    if (!refinementContext) return;
    textareaRef.current?.focus();
    textareaRef.current?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [refinementContext]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && schemePickerOpen) {
        event.preventDefault();
        setSchemePickerOpen(false);
      } else if (event.key === "Escape" && promptPickerOpen) {
        event.preventDefault();
        setPromptPickerOpen(false);
      } else if (event.key === "Escape" && composerMenuOpen) {
        event.preventDefault();
        setComposerMenuOpen(false);
      } else if (event.key === "Escape" && generatingHere && !cancelRequested) {
        // 只在拥有正在运行轮次的对话里响应 Esc 取消；其他对话不误伤后台运行。
        event.preventDefault();
        void handleCancel();
      } else if (event.key === "Escape" && refinementContext) {
        event.preventDefault();
        clearRefinement();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    cancelRequested,
    clearRefinement,
    composerMenuOpen,
    generatingHere,
    handleCancel,
    promptPickerOpen,
    refinementContext,
    schemePickerOpen,
  ]);

  // 方案来源与普通引用统一表达在 Composer 上方；提示词引用同时以行内胶囊出现在正文里。
  const plainSource =
    !refinementContext && !schemeSource && source.kind !== "manual"
      ? source
      : null;
  const sourceBlockVisible = !refinementContext && Boolean(schemeSource);
  // 来源芯片悬停展示全文：全文存放在同 promptId 的引用胶囊里。
  const plainSourcePreview =
    plainSource?.kind === "prompt" && plainSource.id
      ? references.find((item) => item.promptId === plainSource.id)?.text
      : undefined;
  const attachmentStripVisible = Boolean(
    refinementContext ||
    draftImages.length > 0 ||
    skillComposerAttachmentVisible ||
    plainSource ||
    historyAttached,
  );

  return (
    <WorkbenchComposerView
      {...store}
      textareaRef={textareaRef}
      composerSurfaceRef={composerSurfaceRef}
      imageInputRef={imageInputRef}
      dragDepthRef={dragDepthRef}
      imageBusy={imageBusy}
      dragActive={dragActive}
      setDragActive={setDragActive}
      previewPath={previewPath}
      setPreviewPath={setPreviewPath}
      composerMenuOpen={composerMenuOpen}
      setComposerMenuOpen={setComposerMenuOpen}
      schemePickerOpen={schemePickerOpen}
      setSchemePickerOpen={setSchemePickerOpen}
      promptPickerOpen={promptPickerOpen}
      setPromptPickerOpen={setPromptPickerOpen}
      historySourceOpen={historySourceOpen}
      setHistorySourceOpen={setHistorySourceOpen}
      commandHintIndex={commandHintIndex}
      setCommandHintIndex={setCommandHintIndex}
      setCommandHintsDismissed={setCommandHintsDismissed}
      commandHintsVisible={commandHintsVisible}
      activeCommandHintIndex={activeCommandHintIndex}
      effectiveImageCount={effectiveImageCount}
      sourceBlockVisible={sourceBlockVisible}
      attachmentStripVisible={attachmentStripVisible}
      plainSource={plainSource}
      plainSourcePreview={plainSourcePreview}
      selectCommandHint={selectCommandHint}
      pickImage={pickImage}
      importGithubFromClipboard={importGithubFromClipboard}
      applyPromptReference={applyPromptReference}
      handleClearSource={handleClearSource}
      handleSubmit={handleSubmit}
      stageImageFiles={stageImageFiles}
      removeReferenceAt={removeReferenceAt}
      composerMode={composerMode}
      composerModeLocked={composerModeLocked}
      setComposerMode={setComposerMode}
      composerVariant={composerVariant}
      composerLayout={composerLayout}
    />
  );
}
