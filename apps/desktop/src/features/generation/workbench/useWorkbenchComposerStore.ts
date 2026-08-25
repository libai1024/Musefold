import { useAppStore } from "../../../stores/app";
import { useGenerationStore } from "../store";
import {
  composeRefinementPrompt,
  useGenerationWorkbenchStore,
  WORKBENCH_PROMPT_LIMIT,
} from "./store";
import { composePromptWithReferences } from "../../../lib/prompt-references";
import { composePromptWithRatioConstraint } from "./promptConstraints";
import {
  composePromptWithImageIndexHint,
  composePromptWithRefinementImageHint,
} from "./imageReferences";
import { useSkillRuntimeStore } from "./skill-runtime-store";
import {
  filterCommandHints,
  parseDesignPlanBody,
  parseDesignPlanIntent,
} from "./composerIntent";
import { useSchemeRunStore, useSchemeCreationStore } from "@renderer/runtime/scheme-access";

export function useWorkbenchComposerStore() {
  const prompt = useGenerationWorkbenchStore((s) => s.draftPrompt);
  const negative = useGenerationWorkbenchStore((s) => s.draftNegativePrompt);
  const source = useGenerationWorkbenchStore((s) => s.draftSource);
  const draftCommand = useGenerationWorkbenchStore((s) => s.draftCommand);
  const setDraftCommand = useGenerationWorkbenchStore((s) => s.setDraftCommand);
  const draftHistorySource = useGenerationWorkbenchStore(
    (s) => s.draftHistorySource,
  );
  const setDraftHistorySource = useGenerationWorkbenchStore(
    (s) => s.setDraftHistorySource,
  );
  const references = useGenerationWorkbenchStore((s) => s.draftReferences);
  const draftImages = useGenerationWorkbenchStore((s) => s.draftImages);
  const params = useGenerationWorkbenchStore((s) => s.params);
  const hasTurns = useGenerationWorkbenchStore((s) => s.turns.length > 0);
  // 并行生成：单飞锁按对话粒度——只有当前对话有运行中的轮次时，
  // Composer 才进入「运行态」（停止按钮、锁添加图片、禁提交）；
  // 其他对话不受影响，可以照常提交生成。
  const generatingHere = useGenerationWorkbenchStore((s) =>
    Object.values(s.runningTurns).some(
      (entry) => entry.sessionId === s.sessionId,
    ),
  );
  /** 当前对话运行中轮次的类型（停止按钮按类型走对应管线的取消）。 */
  const runningKindHere = useGenerationWorkbenchStore(
    (s) =>
      Object.values(s.runningTurns).find(
        (entry) => entry.sessionId === s.sessionId,
      )?.kind ?? null,
  );
  const cancelRequested = useGenerationWorkbenchStore((s) =>
    Object.values(s.runningTurns).some(
      (entry) => entry.sessionId === s.sessionId && entry.cancelRequested,
    ),
  );
  const refinementContext = useGenerationWorkbenchStore(
    (s) => s.refinementContext,
  );
  const refinementTurn = useGenerationWorkbenchStore((s) =>
    s.refinementContext
      ? s.turns.find((turn) => turn.id === s.refinementContext?.turnId)
      : undefined,
  );
  const setPrompt = useGenerationWorkbenchStore((s) => s.setDraftPrompt);
  const setNegative = useGenerationWorkbenchStore(
    (s) => s.setDraftNegativePrompt,
  );
  const setParams = useGenerationWorkbenchStore((s) => s.setParams);
  const setSource = useGenerationWorkbenchStore((s) => s.setDraftSource);
  const clearSource = useGenerationWorkbenchStore((s) => s.clearDraftSource);
  const addReference = useGenerationWorkbenchStore((s) => s.addDraftReference);
  const removeReference = useGenerationWorkbenchStore(
    (s) => s.removeDraftReference,
  );
  const addDraftImages = useGenerationWorkbenchStore((s) => s.addDraftImages);
  const removeDraftImage = useGenerationWorkbenchStore(
    (s) => s.removeDraftImage,
  );
  const submit = useGenerationWorkbenchStore((s) => s.submitDraft);
  const submitRefinement = useGenerationWorkbenchStore(
    (s) => s.submitRefinement,
  );
  const clearRefinement = useGenerationWorkbenchStore((s) => s.clearRefinement);
  const cancel = useGenerationWorkbenchStore((s) => s.cancel);
  const skillRuntimeStatus = useSkillRuntimeStore((state) => state.status);
  const skillRuntimeAttachment = useSkillRuntimeStore(
    (state) => state.attachment,
  );
  const skillRuntimeSourceUrl = useSkillRuntimeStore(
    (state) => state.sourceUrl,
  );
  const attachGithubSkill = useSkillRuntimeStore((state) => state.attachGithub);
  const executeGithubSkill = useSkillRuntimeStore((state) => state.execute);
  const removeGithubSkill = useSkillRuntimeStore((state) => state.remove);
  const cancelSkillExecution = useSkillRuntimeStore(
    (state) => state.cancelExecution,
  );
  const providers = useGenerationStore((s) => s.providers);
  const activeProviderId = useGenerationStore((s) => s.activeProviderId);
  const defaultProviderId = useAppStore((s) => s.defaultProviderId);
  const activeProvider =
    providers.find((provider) => provider.id === activeProviderId) ??
    providers.find((provider) => provider.id === defaultProviderId) ??
    providers[0] ??
    null;
  const submissionProvider = refinementTurn
    ? (providers.find(
        (provider) => provider.id === refinementTurn.providerId,
      ) ?? null)
    : activeProvider;
  const doubaoImageMode = submissionProvider?.type === "doubao-web";
  const schemeCreating = useSchemeCreationStore((state) => state.creating);
  const startSchemeCreation = useSchemeCreationStore((state) => state.start);
  const startSchemeModify = useSchemeCreationStore(
    (state) => state.startModify,
  );
  const cancelSchemeCreation = useSchemeCreationStore((state) => state.cancel);
  const schemeInputValues = useGenerationWorkbenchStore(
    (s) => s.schemeInputValues,
  );
  const executeSchemeRun = useSchemeRunStore((state) => state.execute);
  const cancelSchemeRun = useSchemeRunStore((state) => state.cancel);
  // 方案运行管线是单例：另一对话的方案运行未结束时，本对话的方案提交暂不可用。
  const schemeRunBusy = useSchemeRunStore((state) => state.running);
  const handleCancel = () => {
    // 只取消当前对话的运行；其他对话的并行运行不受影响。
    if (runningKindHere === "skill") void cancelSkillExecution();
    else if (runningKindHere === "scheme-creation") void cancelSchemeCreation();
    else if (runningKindHere === "scheme-run") void cancelSchemeRun();
    void cancel();
  };
  const schemeSource = source.kind === "scheme" ? source : null;
  const doubaoRefinement = Boolean(refinementTurn && doubaoImageMode);
  const unconstrainedPrompt = refinementTurn
    ? doubaoRefinement
      ? prompt.trim()
      : composeRefinementPrompt(refinementTurn.prompt, prompt)
    : composePromptWithReferences(prompt, references);
  const referenceImageCount =
    (refinementContext?.images.length ?? 0) + draftImages.length;
  const composedPrompt = doubaoRefinement
    ? unconstrainedPrompt
    : composePromptWithRatioConstraint(
        refinementContext
          ? composePromptWithRefinementImageHint(
              unconstrainedPrompt,
              referenceImageCount,
            )
          : composePromptWithImageIndexHint(
              unconstrainedPrompt,
              referenceImageCount,
            ),
        refinementTurn?.params.ratioId ?? params.ratioId,
      );
  const overLimit = composedPrompt.length > WORKBENCH_PROMPT_LIMIT;
  // 指令芯片挂载后整段输入都是正文；未挂载时兼容直接输入完整指令的旧路径。
  const designPlanIntent =
    draftCommand === "design-plan"
      ? parseDesignPlanBody(prompt)
      : parseDesignPlanIntent(prompt);
  const historyAttached = Boolean(draftHistorySource?.items.length);
  const designPlanReady = Boolean(
    !doubaoImageMode &&
    designPlanIntent &&
    (designPlanIntent.prompt ||
      designPlanIntent.githubUrl ||
      skillRuntimeStatus === "ready" ||
      historyAttached),
  );
  // / 指令建议：随输入实时筛选；Esc 临时收起，输入变化后恢复。
  const commandHints =
    draftCommand || doubaoImageMode ? [] : filterCommandHints(prompt);
  const skillCanSubmit = Boolean(
    skillRuntimeStatus === "ready" &&
    prompt.trim() &&
    submissionProvider?.hasKey &&
    !generatingHere &&
    !overLimit,
  );
  const skillIsAttached = !["idle", "complete"].includes(skillRuntimeStatus);
  const skillComposerAttachmentVisible = [
    "detecting",
    "ready",
    "error",
  ].includes(skillRuntimeStatus);
  const ordinaryCanSubmit =
    !skillIsAttached &&
    !schemeSource &&
    Boolean(
      (prompt.trim() || (!refinementContext && references.length > 0)) &&
      submissionProvider?.hasKey &&
      !generatingHere &&
      !overLimit,
    );
  const schemeModifyMode = schemeSource?.mode === "modify";
  // 方案运行：必填文本槽位要有值，必填图片槽位按数量核对；自由补充可以为空。
  const schemeRequiredImages = schemeSource
    ? schemeSource.inputs
        .filter(
          (slot) =>
            slot.required &&
            (slot.kind === "image" || slot.kind === "image-set"),
        )
        .reduce((total, slot) => total + Math.max(1, slot.minItems ?? 1), 0)
    : 0;
  const schemeRequiredReady = Boolean(
    schemeSource &&
    draftImages.length >= schemeRequiredImages &&
    schemeSource.inputs.every((slot) => {
      if (!slot.required || slot.kind === "image" || slot.kind === "image-set")
        return true;
      return Boolean(schemeInputValues[slot.id]?.trim());
    }),
  );
  const schemeCanSubmit = Boolean(
    schemeSource &&
    !schemeModifyMode &&
    schemeRequiredReady &&
    submissionProvider?.hasKey &&
    !generatingHere &&
    !schemeRunBusy &&
    !overLimit,
  );
  // 修改方案：输入是发给 Agent 的修改要求，不需要生图 Provider。
  const schemeModifyCanSubmit = Boolean(
    !doubaoImageMode &&
    schemeModifyMode &&
    prompt.trim() &&
    !generatingHere &&
    !schemeCreating,
  );
  const canSubmit =
    ordinaryCanSubmit ||
    skillCanSubmit ||
    schemeCanSubmit ||
    schemeModifyCanSubmit ||
    Boolean(
      designPlanReady &&
      !generatingHere &&
      skillRuntimeStatus !== "detecting" &&
      skillRuntimeStatus !== "executing",
    );
  return {
    prompt,
    negative,
    source,
    draftCommand,
    setDraftCommand,
    draftHistorySource,
    setDraftHistorySource,
    references,
    draftImages,
    params,
    hasTurns,
    generatingHere,
    runningKindHere,
    cancelRequested,
    refinementContext,
    refinementTurn,
    setPrompt,
    setNegative,
    setParams,
    setSource,
    clearSource,
    addReference,
    removeReference,
    addDraftImages,
    removeDraftImage,
    submit,
    submitRefinement,
    clearRefinement,
    cancel,
    skillRuntimeStatus,
    skillRuntimeAttachment,
    skillRuntimeSourceUrl,
    attachGithubSkill,
    executeGithubSkill,
    removeGithubSkill,
    cancelSkillExecution,
    providers,
    activeProviderId,
    defaultProviderId,
    activeProvider,
    submissionProvider,
    doubaoImageMode,
    schemeCreating,
    startSchemeCreation,
    startSchemeModify,
    cancelSchemeCreation,
    schemeInputValues,
    executeSchemeRun,
    cancelSchemeRun,
    schemeRunBusy,
    handleCancel,
    schemeSource,
    doubaoRefinement,
    unconstrainedPrompt,
    referenceImageCount,
    composedPrompt,
    overLimit,
    designPlanIntent,
    historyAttached,
    designPlanReady,
    commandHints,
    skillCanSubmit,
    skillIsAttached,
    skillComposerAttachmentVisible,
    ordinaryCanSubmit,
    schemeModifyMode,
    schemeRequiredImages,
    schemeRequiredReady,
    schemeCanSubmit,
    schemeModifyCanSubmit,
    canSubmit,
  };
}
