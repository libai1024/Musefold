import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  Blocks,
  Check,
  Copy,
  Download,
  FileText,
  FolderOpen,
  GitBranch,
  History,
  ImagePlus,
  ListChecks,
  Loader2,
  MoreHorizontal,
  Search,
  Square,
  Wand2,
  X,
} from "../../../components/ui/icons";
import type { Prompt } from "@musefold/desktop-contracts/models";
import type { ImageQuality } from "@musefold/desktop-contracts/enums";
import { RATIO_OPTIONS } from "@musefold/domain/constants";
import { titleFromPromptContent } from "@musefold/domain";
import {
  MAX_REFERENCE_IMAGES,
  type LocalImageReference,
} from "@musefold/desktop-contracts/providers";
import type { SkillRuntimeTraceItem } from "@musefold/desktop-contracts/skill-runtime";
import { useAppStore } from "../../../stores/app";
import {
  WorkbenchAssistantFrame,
  WorkbenchAssistantAvatar,
  WorkbenchAssistantHeader,
  WorkbenchBrand,
  WorkbenchComposerFrame,
  WorkbenchComposerPrompt,
  WorkbenchTurnFrame,
  WorkbenchUserMessage,
  WorkbenchMessageActions,
  WorkbenchPromptReferenceCard,
  GenerationSavePromptAction,
  GenerationRetryAction,
  GenerationResultSurface,
  WorkbenchTurnActions,
  WorkbenchTurnActionIcon,
  WorkbenchResultGrid,
  WorkbenchComposerSubmitButton,
  WorkbenchContextMenu,
  WorkbenchEmptyState,
  WorkbenchGenerationSettingsPopover,
  WorkbenchRatioPicker,
  WorkbenchTimelineViewport,
  WorkbenchTimelineContent,
  WorkbenchPageFrame,
  useWorkbenchTimelineController,
  workbenchGenerationResultStatus,
  workbenchGenerationStatusLabel,
  workbenchComposerPlaceholder,
} from "@musefold/product-ui";
import { useGenerationStore } from "../store";
import { useLibraryStore } from "../../library/store";
import { REFINE_COUNTS } from "../params";
import {
  composeRefinementPrompt,
  useGenerationWorkbenchStore,
  WORKBENCH_PROMPT_LIMIT,
} from "./store";
import type {
  GenerationResultItem,
  GenerationSource,
  GenerationTurn,
  RefinementContext,
} from "./types";
import { ImageLightbox } from "../../../components/ui/image-lightbox";
import { cn } from "../../../lib/utils";
import { toImageSrc } from "../../../lib/media";
import api from "../../../lib/ipc";
import { toast } from "../../../stores/toast";
import { useSettingsStore } from "../../settings/store";
import { useAccountStore } from "../../account/store";
import { MusefoldAssistantAvatar } from "../../../components/brand/MusefoldAssistantAvatar";
import musefoldBrandUrl from "../../../../../../docs/v0.3/logo.png";
import musefoldIconUrl from "../../../../../../website/Musefold/assets/musefold-icon.png";
import { ModelBrandIcon } from "../../../components/ui/brand-icons";
import { PromptReferenceSidebar } from "./PromptReferenceSidebar";
import { PromptPickerPopover } from "./PromptPickerPopover";
import { promptParamsToRefineParams } from "../promptParams";
import { composePromptWithReferences } from "./references";
import { linkHistoriesToPrompt } from "../../library/related-history";
import { composePromptWithRatioConstraint } from "./promptConstraints";
import {
  composePromptWithImageIndexHint,
  composePromptWithRefinementImageHint,
} from "./imageReferences";
import { HistorySourcePicker } from "../../design-schemes/HistorySourcePicker";
import {
  SkillRuntimeAttachment,
  SkillRuntimeConversation,
} from "./SkillRuntimeAttachment";
import { useSkillRuntimeStore } from "./skillRuntimeStore";
import {
  DESIGN_PLAN_COMMAND_LABEL,
  exactGithubSkillUrl,
  filterCommandHints,
  matchDesignPlanCommand,
  parseDesignPlanBody,
  parseDesignPlanIntent,
} from "./composerIntent";
import { SchemeCreationConversation } from "../../design-schemes/SchemeCreationConversation";
import { SchemeRunConversation } from "../../design-schemes/SchemeRunConversation";
import {
  SchemeRunAttachment,
  SchemeRunPickerPopover,
  SchemeRunVariableFields,
} from "../../design-schemes/SchemeRunComposer";
import { useSchemeRunStore } from "../../design-schemes/runStore";
import { useSchemeCreationStore } from "../../design-schemes/creationStore";

const QUALITY_OPTIONS: { id: ImageQuality; label: string; hint: string }[] = [
  { id: "auto", label: "自动", hint: "模型默认" },
  { id: "low", label: "标准", hint: "更快" },
  { id: "medium", label: "高清", hint: "平衡" },
  { id: "high", label: "超清", hint: "细节优先" },
];

const WORKBENCH_RATIO_OPTIONS = RATIO_OPTIONS.map((option) => ({
  id: option.id,
  label: option.label,
  ratio: option.ratio,
  detail: option.size === "auto" ? (option.hint ?? "由模型决定") : option.size,
}));

export function GenerationWorkbench() {
  const providers = useGenerationStore((s) => s.providers);
  const loadProviders = useGenerationStore((s) => s.loadProviders);
  const refinementContext = useGenerationWorkbenchStore(
    (s) => s.refinementContext,
  );
  const referencesOpen = useAppStore((s) => s.materialLibraryOpen);
  const setReferencesOpen = useAppStore((s) => s.setMaterialLibraryOpen);

  useEffect(() => {
    if (providers.length === 0) void loadProviders().catch(() => {});
  }, [loadProviders, providers.length]);

  useEffect(() => {
    if (refinementContext) setReferencesOpen(false);
  }, [refinementContext]);

  return (
    <WorkbenchPageFrame
      className="relative flex h-full min-h-0 flex-col"
      stageClassName="relative flex min-h-0 flex-1"
      timeline={<WorkbenchTimeline />}
      auxiliary={
        referencesOpen ? (
          <PromptReferenceSidebar
            open={referencesOpen}
            onClose={() => setReferencesOpen(false)}
          />
        ) : null
      }
      composer={<WorkbenchComposer />}
    />
  );
}

function WorkbenchTimeline() {
  const turns = useGenerationWorkbenchStore((s) => s.turns);
  const setDraftPrompt = useGenerationWorkbenchStore((s) => s.setDraftPrompt);
  const attachmentsActive = useGenerationWorkbenchStore(
    (s) =>
      s.refinementContext !== null ||
      s.draftImages.length > 0 ||
      s.draftSource.kind === "scheme",
  );
  const skillSubmittedPrompt = useSkillRuntimeStore(
    (state) => state.submittedPrompt,
  );
  const skillConversationTurnId = useSkillRuntimeStore(
    (state) => state.conversationTurnId,
  );
  const skillTrace = useSkillRuntimeStore((state) => state.trace);
  const pendingSkillConversation = Boolean(
    skillSubmittedPrompt && !skillConversationTurnId,
  );
  const skillTraceSignal = skillTrace
    .map((item) => `${item.id}:${item.status}`)
    .join("|");
  const [zoom, setZoom] = useState<{ path: string; prompt: string } | null>(
    null,
  );
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const timeline = useWorkbenchTimelineController({
    followKey: [
      attachmentsActive,
      pendingSkillConversation,
      skillTraceSignal,
      turns.length,
    ].join("|"),
    itemCount: turns.length + (pendingSkillConversation ? 1 : 0),
  });

  return (
    <WorkbenchTimelineViewport
      controller={timeline}
      onPointerDown={(event) => {
        if (!(event.target as Element).closest("[data-user-message]"))
          setActiveMessageId(null);
      }}
      className="relative min-h-0 flex-1 overflow-y-auto"
    >
      <WorkbenchTimelineContent
        itemCount={turns.length + (pendingSkillConversation ? 1 : 0)}
        bottomInset={attachmentsActive ? "attachments" : "composer"}
        empty={
          <WorkbenchEmptyState
            brand={
              <WorkbenchBrand src={musefoldBrandUrl} alt="Musefold / 未像" />
            }
            onSelectSuggestion={(suggestion) => {
              setDraftPrompt(suggestion);
              window.requestAnimationFrame(() => {
                const textarea = document.querySelector<HTMLTextAreaElement>(
                  '[data-workbench-testid="workbench-prompt"]',
                );
                textarea?.focus();
                textarea?.setSelectionRange(
                  suggestion.length,
                  suggestion.length,
                );
              });
            }}
          />
        }
      >
        {turns.map((turn) => (
          <GenerationTurnView
            key={turn.id}
            turn={turn}
            messageActionsOpen={activeMessageId === turn.id}
            onMessageActivate={() => setActiveMessageId(turn.id)}
            onMessageClose={() => setActiveMessageId(null)}
            onZoom={(path) => setZoom({ path, prompt: turn.prompt })}
          />
        ))}
        {pendingSkillConversation && skillSubmittedPrompt && (
          <PendingSkillConversation
            prompt={skillSubmittedPrompt}
            trace={skillTrace}
          />
        )}
      </WorkbenchTimelineContent>
      {!timeline.nearLatest && turns.length > 0 && (
        <button
          type="button"
          onClick={() => timeline.scrollToLatest()}
          className="no-drag sticky bottom-4 left-1/2 z-10 mx-auto flex -translate-x-1/2 items-center gap-1 rounded-full border border-border-default bg-elevated px-3 py-1.5 text-[11px] text-secondary shadow-sm hover:bg-hover hover:text-primary"
          data-testid="generation-back-latest"
        >
          <ArrowDown className="h-3.5 w-3.5" /> 回到最新
        </button>
      )}
      <ImageLightbox
        path={zoom?.path ?? null}
        prompt={zoom?.prompt}
        onClose={() => setZoom(null)}
      />
    </WorkbenchTimelineViewport>
  );
}

function PendingSkillConversation({
  prompt,
  trace,
}: {
  prompt: string;
  trace: SkillRuntimeTraceItem[];
}) {
  return (
    <article className="space-y-4" data-testid="skill-runtime-pending-turn">
      <div className="ml-auto max-w-[min(88%,460px)] rounded-2xl rounded-br-md bg-inset px-4 py-3 text-[13px] leading-relaxed text-primary">
        <p className="whitespace-pre-wrap break-words">{prompt}</p>
      </div>
      <div className="flex gap-3">
        <MusefoldAssistantAvatar data-testid="skill-runtime-assistant-avatar" />
        <div className="min-w-0 flex-1">
          <div className="mb-1 text-[11px] font-medium text-secondary">
            Musefold
          </div>
          <SkillRuntimeConversation trace={trace} />
        </div>
      </div>
    </article>
  );
}

function GenerationTurnView({
  turn,
  onZoom,
  messageActionsOpen,
  onMessageActivate,
  onMessageClose,
}: {
  turn: GenerationTurn;
  onZoom: (path: string) => void;
  messageActionsOpen: boolean;
  onMessageActivate: () => void;
  onMessageClose: () => void;
}) {
  const retryResult = useGenerationWorkbenchStore((s) => s.retryResult);
  const startRefinement = useGenerationWorkbenchStore((s) => s.startRefinement);
  const reuseResult = useGenerationWorkbenchStore((s) => s.reuseResult);
  const editTurn = useGenerationWorkbenchStore((s) => s.editTurn);
  // 并行生成：轮内动作（重试/微调/编辑）只受本对话运行状态约束。
  const isGenerating = useGenerationWorkbenchStore((s) =>
    Object.values(s.runningTurns).some(
      (entry) => entry.sessionId === s.sessionId,
    ),
  );
  const setView = useAppStore((s) => s.setView);
  const requestHighlightPrompt = useAppStore((s) => s.requestHighlightPrompt);
  const createPrompt = useLibraryStore((s) => s.createPrompt);
  const provider = useGenerationStore((s) =>
    s.providers.find((item) => item.id === turn.providerId),
  );
  const isDoubaoTurn =
    provider?.type === "doubao-web" ||
    turn.providerResponse?.kind === "doubao-web";
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [savedPromptId, setSavedPromptId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedResultIds, setSelectedResultIds] = useState<string[]>([]);
  const [deselectingResultIds, setDeselectingResultIds] = useState<string[]>(
    [],
  );
  const [selectionTransitioning, setSelectionTransitioning] = useState(false);
  const [batchSaving, setBatchSaving] = useState(false);
  const selectionTimersRef = useRef<Set<number>>(new Set());
  const successful = turn.results.filter(
    (result) => result.status === "success",
  );

  useEffect(() => {
    const available = new Set(
      turn.results
        .filter((result) => result.status === "success" && result.imagePath)
        .map((result) => result.id),
    );
    setSelectedResultIds((ids) => ids.filter((id) => available.has(id)));
    if (available.size < 2) setSelectionMode(false);
  }, [turn.results]);

  useEffect(
    () => () => {
      selectionTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    },
    [],
  );

  const scheduleSelectionUpdate = (callback: () => void, delay = 180) => {
    const timer = window.setTimeout(() => {
      selectionTimersRef.current.delete(timer);
      callback();
    }, delay);
    selectionTimersRef.current.add(timer);
  };

  const animateDeselection = (resultIds: string[]) => {
    if (resultIds.length === 0) return;
    setDeselectingResultIds((ids) =>
      Array.from(new Set([...ids, ...resultIds])),
    );
    scheduleSelectionUpdate(() => {
      setDeselectingResultIds((ids) =>
        ids.filter((id) => !resultIds.includes(id)),
      );
    });
  };

  const enterSelection = (resultId?: string) => {
    if (successful.length < 2) return;
    setSelectionTransitioning(false);
    setSelectionMode(true);
    if (resultId)
      setSelectedResultIds((ids) =>
        ids.includes(resultId) ? ids : [...ids, resultId],
      );
  };

  const toggleSelection = (resultId: string) => {
    if (selectionTransitioning) return;
    if (selectedResultIds.includes(resultId)) {
      animateDeselection([resultId]);
      setSelectedResultIds((ids) => ids.filter((id) => id !== resultId));
      return;
    }
    setSelectedResultIds((ids) => [...ids, resultId]);
  };

  const leaveSelection = () => {
    if (selectionTransitioning) return;
    setSelectionTransitioning(true);
    const releasedIds = [...selectedResultIds];
    animateDeselection(releasedIds);
    setSelectedResultIds([]);
    scheduleSelectionUpdate(() => {
      setSelectionMode(false);
      setSelectionTransitioning(false);
    });
  };

  const chooseRefinementTarget = (resultId: string) => {
    if (isGenerating || selectionTransitioning) return;
    const releasedIds = selectedResultIds.filter((id) => id !== resultId);
    if (releasedIds.length === 0) {
      setSelectionMode(false);
      setSelectedResultIds([]);
      startRefinement(turn.id, resultId);
      return;
    }
    setSelectionTransitioning(true);
    animateDeselection(releasedIds);
    setSelectedResultIds([resultId]);
    scheduleSelectionUpdate(() => {
      setSelectionMode(false);
      setSelectedResultIds([]);
      setSelectionTransitioning(false);
      startRefinement(turn.id, resultId);
    });
  };

  const saveSelectedImages = async () => {
    if (selectedResultIds.length === 0 || batchSaving) return;
    const paths = selectedResultIds
      .map((id) => turn.results.find((result) => result.id === id)?.imagePath)
      .filter((path): path is string => Boolean(path));
    if (paths.length === 0) return;
    setBatchSaving(true);
    try {
      const saved = await api.system.saveImages(paths);
      if ("cancelled" in saved) return;
      toast.success(`已保存 ${saved.paths.length} 张图片`);
      leaveSelection();
    } catch (error) {
      toast.error(
        "批量保存失败",
        error instanceof Error ? error.message : "请检查图片与保存目录。",
      );
    } finally {
      setBatchSaving(false);
    }
  };

  const savePrompt = async () => {
    const content = turn.prompt.trim();
    if (!content || savedPromptId || savingPrompt) return;
    setSavingPrompt(true);
    const historyIds = turn.results
      .map((result) => result.historyId)
      .filter((id): id is string => Boolean(id));
    const firstResult = successful.find((result) => result.historyId);
    const created = await createPrompt({
      title: titleFromPromptContent(content),
      content,
      contentNegative: turn.negativePrompt || undefined,
      source: "manual",
      sourceUrl: firstResult?.historyId
        ? `history://${firstResult.historyId}`
        : undefined,
      previewImagePath: firstResult?.imagePath,
    });
    setSavingPrompt(false);
    if (!created) {
      toast.error(
        "存为提示词失败",
        useLibraryStore.getState().error ?? "请稍后重试。",
      );
      return;
    }
    let linkResult = null;
    try {
      linkResult = await linkHistoriesToPrompt(created.id, historyIds);
    } catch {
      // Prompt creation succeeded. Keep it and report the secondary association
      // problem without turning the completed save into a false failure.
    }
    setSavedPromptId(created.id);
    toast.show({
      title: "已存为提示词",
      description:
        linkResult == null
          ? `${created.title} · 重启应用后可建立作品关联`
          : `${created.title} · 已关联 ${linkResult.linked + linkResult.alreadyLinked} 条作品`,
      variant: linkResult == null ? "warning" : "success",
      action: {
        label: "查看",
        onClick: () => requestHighlightPrompt(created.id),
      },
    });
  };

  const scrollToParent = () => {
    if (!turn.parentHistoryId) return;
    document
      .querySelector<HTMLElement>(
        `[data-history-id="${CSS.escape(turn.parentHistoryId)}"]`,
      )
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const copyUserMessage = async () => {
    const content = turn.userPrompt.trim() || turn.prompt.trim();
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      toast.success("已复制消息");
    } catch {
      toast.error("复制失败", "剪贴板不可用");
    }
  };

  const restoreUserMessage = () => {
    if (isGenerating) return;
    editTurn(turn.id);
    onMessageClose();
    window.setTimeout(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>(
        '[data-workbench-testid="workbench-prompt"]',
      );
      textarea?.focus();
      const length = textarea?.value.length ?? 0;
      textarea?.setSelectionRange(length, length);
    }, 0);
  };

  return (
    <WorkbenchTurnFrame
      testId={`generation-turn-${turn.id}`}
      status={turn.status}
      userTestId="generation-user-message"
      userProps={{
        tabIndex: 0,
        onClick: (event) => {
          if ((event.target as Element).closest("button, summary, a")) return;
          onMessageActivate();
        },
        onKeyDown: (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onMessageActivate();
          }
          if (event.key === "Escape") onMessageClose();
        },
      }}
      userMessage={
        <WorkbenchUserMessage
          /* 引用与附件一律在消息气泡上方（Codex 式）：方案 / Skill / 图片 / 提示词引用。 */
          attachments={
            (turn.source.kind === "skill" ||
              turn.source.kind === "scheme-run" ||
              (turn.source.kind === "scheme-creation" &&
                turn.source.githubUrl) ||
              turn.referenceImages.length > 0 ||
              turn.references.length > 0) && (
              <div
                className="mf-workbench-user-attachments mb-1.5 flex max-w-full flex-col items-end gap-1.5"
                data-testid="generation-message-attachments"
              >
                {turn.source.kind === "scheme-run" && (
                  <button
                    type="button"
                    onClick={() =>
                      useAppStore.getState().requestSchemeCenter({
                        detailId:
                          turn.source.kind === "scheme-run"
                            ? turn.source.schemeId
                            : undefined,
                      })
                    }
                    className="flex max-w-full items-center gap-2 rounded-lg border border-border-subtle bg-elevated px-2.5 py-1.5 text-left transition-colors hover:border-border-default hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
                    title="查看方案详情"
                    data-testid="generation-scheme-run-reference"
                  >
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent"
                      aria-hidden
                    >
                      <Blocks className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[10.5px] font-medium text-primary">
                        {turn.source.label}
                      </span>
                      <span className="block text-[9px] text-tertiary">
                        {turn.source.mode === "trial"
                          ? "设计方案 · 试运行"
                          : "引用设计方案"}
                        {turn.source.isRepairRun ? " · 修复重跑" : ""}
                      </span>
                    </span>
                  </button>
                )}
                {turn.source.kind === "skill" && (
                  <div
                    className="flex max-w-full items-center gap-2 rounded-lg border border-border-subtle bg-elevated px-2.5 py-1.5"
                    title={turn.source.repositoryUrl}
                    data-testid="generation-skill-reference"
                  >
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent"
                      aria-hidden
                    >
                      <GitBranch className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[10.5px] font-medium text-primary">
                        {turn.source.label}
                      </span>
                      <span className="block text-[9px] text-tertiary">
                        {turn.source.executionMode === "direct-forward"
                          ? "GitHub Skill · 直传豆包"
                          : "GitHub Skill"}
                      </span>
                    </span>
                  </div>
                )}
                {turn.source.kind === "scheme-creation" &&
                  turn.source.githubUrl && (
                    <div
                      className="flex max-w-full items-center gap-2 rounded-lg border border-border-subtle bg-elevated px-2.5 py-1.5"
                      title={turn.source.githubUrl}
                      data-testid="generation-scheme-creation-reference"
                    >
                      <span
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent"
                        aria-hidden
                      >
                        <GitBranch className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[10.5px] font-medium text-primary">
                          {turn.source.label}
                        </span>
                        <span className="block text-[9px] text-tertiary">
                          方案来源
                        </span>
                      </span>
                    </div>
                  )}
                {turn.referenceImages.length > 0 && (
                  <div
                    className="flex max-w-full gap-1.5 overflow-x-auto"
                    data-testid="generation-user-reference-images"
                  >
                    {turn.referenceImages.map((image, index) => (
                      <button
                        key={`${image.source}:${image.historyId ?? image.path}:${index}`}
                        type="button"
                        onClick={() => onZoom(image.path)}
                        className="relative shrink-0 cursor-zoom-in overflow-hidden rounded-md border border-border-subtle bg-elevated"
                        title={`查看图 ${index + 1}`}
                        aria-label={`查看参考图 ${index + 1}`}
                        data-testid="generation-user-reference-image"
                      >
                        <img
                          src={toImageSrc(image.path)}
                          alt={`图 ${index + 1}`}
                          className="h-16 w-16 object-contain"
                        />
                        <span className="absolute bottom-1 left-1 rounded bg-black/65 px-1 py-0.5 text-[8px] leading-none text-white">
                          图 {index + 1}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {turn.references.length > 0 && (
                  <div
                    className="flex max-w-full flex-wrap justify-end gap-1.5"
                    data-testid="generation-reference-count"
                  >
                    {turn.references.map((reference, index) => (
                      <span
                        key={`${reference.promptId}:${index}`}
                        className="inline-flex h-[22px] max-w-[200px] items-center gap-1 rounded-md border border-border-subtle bg-elevated px-1.5 text-[10.5px] font-medium leading-none text-primary"
                        title={
                          reference.text.length > 300
                            ? `${reference.text.slice(0, 300)}…`
                            : reference.text
                        }
                        data-testid="generation-reference-chip"
                        data-reference-scope={reference.scope}
                      >
                        <FileText className="h-3 w-3 shrink-0 text-secondary" />
                        <span className="min-w-0 truncate">
                          {reference.title}
                        </span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          }
          meta={
            <>
              {turn.parentHistoryId && (
                <button
                  type="button"
                  onClick={scrollToParent}
                  className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-hover hover:text-primary"
                  data-testid="generation-refinement-parent-link"
                >
                  <GitBranch className="h-3 w-3" /> 微调自上一结果
                </button>
              )}
              {/* 创建方案轮与生图参数无关，不展示比例/张数行 */}
              <span>
                {turn.source.kind === "scheme-creation"
                  ? "创建设计方案"
                  : formatParams(turn.params)}
              </span>
            </>
          }
          prefix={
            turn.source.kind === "scheme-creation" ? (
              <span
                className="mb-1.5 inline-flex h-6 items-center gap-1.5 rounded-md bg-accent-soft px-2 text-[10.5px] font-medium text-accent"
                data-testid="generation-command-tag"
              >
                <Wand2 className="h-3 w-3" /> {DESIGN_PLAN_COMMAND_LABEL}
              </span>
            ) : undefined
          }
          prompt={
            turn.userPrompt ||
            (turn.source.kind === "scheme-creation"
              ? "基于来源仓库创建设计方案"
              : turn.userPrompt)
          }
          negative={turn.negativePrompt}
          actions={
            messageActionsOpen ? (
              <WorkbenchMessageActions
                onCopy={copyUserMessage}
                onEdit={restoreUserMessage}
                editDisabled={isGenerating}
              />
            ) : undefined
          }
        />
      }
    >
      <WorkbenchAssistantFrame
        testId="generation-result-group"
        avatar={
          isDoubaoTurn ? (
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#2f6bff] text-white shadow-sm"
              aria-label="豆包"
              data-testid="doubao-generation-avatar"
            >
              <ModelBrandIcon model="doubao" className="h-[18px] w-[18px]" />
            </span>
          ) : (
            <WorkbenchAssistantAvatar
              imageUrl={musefoldIconUrl}
              data-testid="generation-assistant-avatar"
            />
          )
        }
        header={
          <WorkbenchAssistantHeader
            label={
              isDoubaoTurn
                ? turn.referenceImages.length > 0
                  ? "豆包网页改图"
                  : "豆包网页生图"
                : "Musefold"
            }
            detail={
              isDoubaoTurn
                ? "Seedream 4.5 · 本机浏览器会话"
                : workbenchGenerationStatusLabel(turn.status)
            }
          />
        }
      >
        {turn.source.kind === "skill" && (
          <SkillRuntimeConversation
            trace={turn.source.trace}
            doneLabel={
              turn.source.executionMode === "direct-forward"
                ? "已将 Skill 转发给豆包"
                : "已完成 Skill 调用"
            }
          />
        )}
        {turn.source.kind === "scheme-creation" && (
          <SchemeCreationConversation source={turn.source} />
        )}
        {turn.source.kind === "scheme-run" && (
          <SchemeRunConversation turnId={turn.id} source={turn.source} />
        )}
        {/* Skill 轮在 Agent 阅读/编排阶段没有结果占位；生图真正开始后才补建卡片。 */}
        {turn.results.length > 0 && (
          <>
            <WorkbenchResultGrid
              count={turn.results.length}
              aspectRatio={turn.params.ratioId}
              provider={isDoubaoTurn ? "doubao-web" : undefined}
            >
              {turn.results.map((result) => (
                <GenerationResultCard
                  key={result.id}
                  result={result}
                  aspectRatio={turn.params.ratioId}
                  busy={turn.status === "running"}
                  onZoom={onZoom}
                  onRetry={() => void retryResult(turn.id, result.id)}
                  showRefineAction={turn.results.length > 1}
                  refinementEnabled
                  onRefine={() => startRefinement(turn.id, result.id)}
                  onHistory={() => setView("history")}
                  selectionEnabled={successful.length > 1}
                  selectionMode={selectionMode}
                  selected={selectedResultIds.includes(result.id)}
                  deselecting={deselectingResultIds.includes(result.id)}
                  refinementTargetDisabled={
                    isGenerating || selectionTransitioning
                  }
                  savePromptState={
                    savedPromptId ? "saved" : savingPrompt ? "saving" : "idle"
                  }
                  onSavePrompt={() => void savePrompt()}
                  onEnterSelection={() => enterSelection(result.id)}
                  onToggleSelection={() => toggleSelection(result.id)}
                  onSetAsRefinementTarget={() =>
                    chooseRefinementTarget(result.id)
                  }
                />
              ))}
            </WorkbenchResultGrid>
            <div data-testid="generation-selection-toolbar">
              <WorkbenchTurnActions
                primary={
                  selectionMode ? (
                    <>
                      <span className="mr-0.5 text-[11px] text-secondary">
                        已选择 {selectedResultIds.length} 张
                      </span>
                      <button
                        type="button"
                        onClick={leaveSelection}
                        className="action-button"
                        data-testid="generation-selection-cancel"
                      >
                        <X className="h-3 w-3" /> 取消
                      </button>
                      <button
                        type="button"
                        onClick={() => void saveSelectedImages()}
                        disabled={selectedResultIds.length === 0 || batchSaving}
                        className="action-button disabled:cursor-not-allowed disabled:opacity-45"
                        data-testid="generation-batch-download"
                      >
                        {batchSaving ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Download className="h-3 w-3" />
                        )}
                        保存所选
                      </button>
                    </>
                  ) : (
                    <>
                      {successful.length > 0 && turn.results.length === 1 ? (
                        <button
                          type="button"
                          onClick={() =>
                            startRefinement(turn.id, successful[0].id)
                          }
                          className="action-button bg-accent-soft text-accent hover:bg-accent/20"
                          data-testid="generation-refine-turn"
                        >
                          <GitBranch className="h-3 w-3" /> 继续微调
                        </button>
                      ) : null}
                      {successful.length > 1 ? (
                        <button
                          type="button"
                          onClick={() => enterSelection()}
                          className="action-button"
                          data-testid="generation-select-images"
                        >
                          <ListChecks className="h-3 w-3" /> 选择图片
                        </button>
                      ) : null}
                    </>
                  )
                }
                menuItems={[
                  successful[0]
                    ? {
                        id: "reuse",
                        label: "再次制作",
                        icon: <WorkbenchTurnActionIcon name="reuse" />,
                        onSelect: () => reuseResult(turn.id, successful[0].id),
                      }
                    : null,
                  turn.prompt.trim() && turn.status !== "running"
                    ? {
                        id: "save-prompt",
                        label: "存为提示词",
                        onSelect: () => undefined,
                        render: (close: () => void) => (
                          <GenerationSavePromptAction
                            role="menuitem"
                            onSave={() => {
                              void savePrompt();
                              close();
                            }}
                            state={
                              savedPromptId
                                ? "saved"
                                : savingPrompt
                                  ? "saving"
                                  : "idle"
                            }
                            className="mf-workbench-turn-menu-item"
                          />
                        ),
                      }
                    : null,
                  {
                    id: "history",
                    label: "查看生成历史",
                    icon: <WorkbenchTurnActionIcon name="history" />,
                    onSelect: () => setView("history"),
                  },
                ].filter(
                  (item): item is NonNullable<typeof item> => item !== null,
                )}
              />
            </div>
            {isDoubaoTurn && turn.providerResponse && (
              <div
                className="mt-3 max-w-[430px] border-t border-border-subtle pt-3"
                data-testid="doubao-generation-response"
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px]">
                  <span className="inline-flex items-center gap-1.5 font-medium text-secondary">
                    <FileText className="h-3.5 w-3.5 text-[#2f6bff]" /> 豆包回复
                  </span>
                  <span
                    className={cn(
                      "tabular-nums",
                      turn.providerResponse.receivedImageCount <
                        turn.providerResponse.expectedImageCount
                        ? "text-warning"
                        : "text-tertiary",
                    )}
                    data-testid="doubao-generation-count"
                  >
                    1 次网页请求 · 返回{" "}
                    {turn.providerResponse.receivedImageCount} /{" "}
                    {turn.providerResponse.expectedImageCount} 张
                  </span>
                </div>
                {turn.providerResponse.message && (
                  <p
                    className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-[11.5px] leading-relaxed text-secondary"
                    data-testid="doubao-generation-message"
                  >
                    {turn.providerResponse.message}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </WorkbenchAssistantFrame>
    </WorkbenchTurnFrame>
  );
}

function GenerationResultCard({
  result,
  aspectRatio,
  busy,
  onZoom,
  onRetry,
  showRefineAction,
  refinementEnabled,
  onRefine,
  onHistory,
  selectionEnabled,
  selectionMode,
  selected,
  deselecting,
  refinementTargetDisabled,
  onEnterSelection,
  onToggleSelection,
  onSetAsRefinementTarget,
  savePromptState,
  onSavePrompt,
}: {
  result: GenerationResultItem;
  aspectRatio: string;
  busy: boolean;
  onZoom: (path: string) => void;
  onRetry: () => void;
  showRefineAction: boolean;
  refinementEnabled: boolean;
  onRefine: () => void;
  onHistory: () => void;
  selectionEnabled: boolean;
  selectionMode: boolean;
  selected: boolean;
  deselecting: boolean;
  refinementTargetDisabled: boolean;
  onEnterSelection: () => void;
  onToggleSelection: () => void;
  onSetAsRefinementTarget: () => void;
  savePromptState: "idle" | "saving" | "saved";
  onSavePrompt: () => void;
}) {
  const [broken, setBroken] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const setView = useAppStore((state) => state.setView);
  const setSettingsSection = useSettingsStore((state) => state.setSection);
  const cardRef = useRef<HTMLDivElement>(null);
  const longPressTimer = useRef<number | null>(null);
  const longPressStart = useRef<{ x: number; y: number } | null>(null);
  const longPressTriggered = useRef(false);
  const canAct =
    result.status === "success" && Boolean(result.imagePath) && !broken;

  useEffect(() => {
    setBroken(false);
  }, [result.imagePath, result.status]);

  useEffect(() => {
    return () => {
      if (longPressTimer.current !== null)
        window.clearTimeout(longPressTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!cardRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  const clearLongPress = () => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    longPressStart.current = null;
  };

  const startLongPress = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (
      !selectionEnabled ||
      !canAct ||
      (event.pointerType === "mouse" && event.button !== 0)
    )
      return;
    clearLongPress();
    longPressTriggered.current = false;
    longPressStart.current = { x: event.clientX, y: event.clientY };
    longPressTimer.current = window.setTimeout(() => {
      longPressTriggered.current = true;
      onEnterSelection();
      longPressTimer.current = null;
    }, 520);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = longPressStart.current;
    if (!start) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10)
      clearLongPress();
  };

  const handleImageClick = () => {
    if (!canAct) return;
    if (selectionMode) {
      onToggleSelection();
      return;
    }
    if (longPressTriggered.current) {
      longPressTriggered.current = false;
      return;
    }
    onZoom(result.imagePath!);
  };

  const saveImage = async () => {
    if (!result.imagePath) return;
    try {
      const saved = await api.system.saveImage(result.imagePath);
      if ("cancelled" in saved) return;
      toast.success("图片已另存");
    } catch (error) {
      toast.error(
        "另存失败",
        error instanceof Error ? error.message : "文件可能已被移动或删除。",
      );
    }
  };

  const copyImage = async () => {
    if (!result.imagePath) return;
    try {
      await api.system.copyImage(result.imagePath);
      toast.success("已复制图片");
    } catch (error) {
      toast.error(
        "复制图片失败",
        error instanceof Error ? error.message : "图片可能已被移动或删除。",
      );
    }
  };

  const openFolder = async () => {
    if (!result.imagePath) return;
    try {
      await api.system.openInFolder(result.imagePath);
    } catch {
      toast.error("打开目录失败", "文件可能已被移动或删除。");
    }
  };

  const surfaceStatus = workbenchGenerationResultStatus(result.status);
  const surfaceErrorAction =
    result.errorCode === "ACCOUNT/QUOTA" ? (
      <InlineQuotaRedeem onRetry={onRetry} disabled={busy} />
    ) : result.errorCode?.startsWith("ACCOUNT/") ? (
      <button
        type="button"
        className="no-drag mt-1 rounded-full border border-danger/35 px-3 py-1 text-[10px] font-medium text-danger transition-colors hover:border-danger"
        onClick={() => {
          setSettingsSection(
            result.errorCode === "ACCOUNT/MODEL_NOT_FOUND"
              ? "providers"
              : "account",
          );
          setView("settings");
        }}
      >
        {result.errorCode === "ACCOUNT/AUTH" ? "重新登录" : "选择可用模型"}
      </button>
    ) : null;
  const surfaceMediaOverlay = canAct ? (
    <>
      {selectionMode ? (
        <span
          className={cn(
            "absolute right-2 top-2 z-10 inline-flex h-6 w-6 items-center justify-center rounded-full border text-[11px] shadow-sm",
            selected
              ? "border-accent bg-accent text-white"
              : "border-white/35 bg-black/65 text-white/80",
          )}
          aria-hidden="true"
          data-testid="result-selection-toggle"
        >
          {selected ? <Check className="h-3.5 w-3.5" /> : null}
        </span>
      ) : null}
      {refinementEnabled && selectionMode && selected && !deselecting ? (
        <button
          type="button"
          onClick={onSetAsRefinementTarget}
          disabled={refinementTargetDisabled}
          className="absolute bottom-2 left-2 z-10 inline-flex h-7 items-center gap-1 rounded-md border border-white/15 bg-black/75 px-2 text-[10px] font-medium text-white shadow-sm transition-colors hover:bg-black/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:cursor-wait disabled:opacity-55"
          title="以这张图作为微调目标"
          aria-label="以这张图作为微调目标"
          data-testid="result-set-refinement-target"
        >
          <GitBranch className="h-3 w-3" /> 微调目标
        </button>
      ) : null}
    </>
  ) : null;
  const surfaceMediaActions =
    canAct && !selectionMode ? (
      <div className="flex w-full items-center justify-between opacity-0 transition-opacity group-hover:opacity-100">
        <div className="flex items-center gap-1 rounded-md border border-white/15 bg-black/75 p-1 text-white">
          <button
            type="button"
            onClick={() => void saveImage()}
            title="另存图片"
            aria-label="另存图片"
            data-testid="result-save"
            className="icon-action"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => void copyImage()}
            title="复制图片"
            aria-label="复制图片"
            data-testid="result-copy-image"
            className="icon-action"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          {showRefineAction && (
            <button
              type="button"
              onClick={onRefine}
              title="以这张图继续微调"
              aria-label="以这张图继续微调"
              data-testid="result-refine"
              className="icon-action"
            >
              <GitBranch className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="relative" data-turn-menu>
          <button
            type="button"
            onClick={() => setMenuOpen((value) => !value)}
            title="更多操作"
            aria-label="更多操作"
            data-testid="result-more"
            className="icon-action rounded-md border border-white/15 bg-black/75 text-white"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
          {menuOpen && (
            <div className="absolute bottom-9 right-0 z-20 w-36 overflow-hidden rounded-md border border-border-default bg-popover py-1 text-[11px] shadow-pop">
              <button
                type="button"
                onClick={() => {
                  void openFolder();
                  setMenuOpen(false);
                }}
                className="menu-action"
                data-testid="result-open-folder"
              >
                <FolderOpen className="h-3 w-3" /> 打开所在目录
              </button>
              <button
                type="button"
                onClick={() => {
                  onHistory();
                  setMenuOpen(false);
                }}
                className="menu-action"
                data-testid="result-history"
              >
                <History className="h-3 w-3" /> 查看生成历史
              </button>
            </div>
          )}
        </div>
      </div>
    ) : null;
  const surfaceFooterActions =
    result.status === "failed" || result.status === "cancelled" ? (
      <GenerationRetryAction onRetry={onRetry} disabled={busy} />
    ) : null;

  return (
    <GenerationResultSurface
      rootRef={cardRef}
      id={result.id}
      testId="generate-result-card"
      imageTestId="result-zoom"
      dataHistoryId={result.historyId}
      className={cn(
        "group",
        selected || deselecting
          ? "border-accent ring-1 ring-accent/45"
          : undefined,
      )}
      status={surfaceStatus}
      imageUrl={result.imagePath ? toImageSrc(result.imagePath) : null}
      imageLabel={
        selectionMode ? (selected ? "取消选择图片" : "选择图片") : "查看大图"
      }
      imageTitle={
        selectionMode
          ? selected
            ? "取消选择"
            : "选择图片"
          : selectionEnabled
            ? "查看大图；长按选择图片"
            : "查看大图"
      }
      aspectRatio={aspectRatio}
      pendingLabel={
        result.retrying && result.retryAttempt && result.retryMax
          ? `重试中（第 ${result.retryAttempt}/${result.retryMax} 次）`
          : "正在生成"
      }
      pendingTestId={result.retrying ? "generation-retrying" : undefined}
      errorMessage={result.error}
      errorAction={surfaceErrorAction}
      footerLabel={
        result.retrying
          ? "重试中"
          : workbenchGenerationStatusLabel(result.status)
      }
      selected={selected}
      deselecting={deselecting}
      busy={busy}
      onOpenImage={canAct ? handleImageClick : undefined}
      onImagePointerDown={startLongPress}
      onImagePointerMove={handlePointerMove}
      onImagePointerUp={clearLongPress}
      onImagePointerCancel={clearLongPress}
      onImagePointerLeave={clearLongPress}
      onImageContextMenu={(event) => {
        if (!selectionEnabled) return;
        event.preventDefault();
        onEnterSelection();
      }}
      onImageAvailabilityChange={(available) => setBroken(!available)}
      mediaOverlay={surfaceMediaOverlay}
      mediaActions={surfaceMediaActions}
      footerActions={
        result.status === "success" ? (
          <GenerationSavePromptAction
            state={savePromptState}
            onSave={onSavePrompt}
            className="button button-secondary result-save-prompt"
          />
        ) : (
          surfaceFooterActions
        )
      }
    />
  );
}

/**
 * 额度不足的就地恢复：在失败卡上直接兑换，成功后自动重试本张。
 * 规格依据 v0.5 产品文档 §5「就地兑换、原地重试」。
 */
function InlineQuotaRedeem({
  onRetry,
  disabled,
}: {
  onRetry: () => void;
  disabled?: boolean;
}) {
  const redeem = useAccountStore((s) => s.redeem);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        className="no-drag mt-1 rounded-full border border-danger/35 px-3 py-1 text-[10px] font-medium text-danger transition-colors hover:border-danger"
        onClick={() => setOpen(true)}
        data-testid="result-redeem-open"
      >
        输入兑换码
      </button>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !code.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      await redeem(code.trim());
      setMessage("已到账，正在重试…");
      setOpen(false);
      onRetry();
    } catch (error) {
      const e = error as { message?: string };
      setMessage(e?.message || "兑换失败，请检查兑换码后重试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="mt-1 flex w-full max-w-[190px] flex-col items-stretch gap-1.5"
      onSubmit={submit}
    >
      <input
        value={code}
        onChange={(event) => setCode(event.target.value)}
        placeholder="兑换码"
        autoFocus
        spellCheck={false}
        className="no-drag h-7 rounded-full border border-danger/35 bg-transparent px-3 text-center font-mono text-[10px] text-primary outline-none transition-colors placeholder:text-quaternary focus:border-danger"
        data-testid="result-redeem-code"
      />
      <div className="flex items-center justify-center gap-1.5">
        <button
          type="submit"
          disabled={busy || disabled || !code.trim()}
          className="no-drag rounded-full border border-danger/35 px-3 py-1 text-[10px] font-medium text-danger transition-colors hover:border-danger disabled:opacity-45"
          data-testid="result-redeem-submit"
        >
          {busy ? "兑换中…" : "兑换并重试"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setMessage(null);
          }}
          className="no-drag rounded-full px-2 py-1 text-[10px] text-tertiary transition-colors hover:text-primary"
        >
          取消
        </button>
      </div>
      {message && (
        <span className="text-center text-[9.5px] leading-relaxed">
          {message}
        </span>
      )}
    </form>
  );
}

function WorkbenchComposer() {
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
  // 行内指令胶囊：正文通过 text-indent 从胶囊后开始（Codex 式）。
  const inlineChipsRef = useRef<HTMLSpanElement>(null);
  const [inlineChipsIndent, setInlineChipsIndent] = useState(0);
  const [inlineChipsPadTop, setInlineChipsPadTop] = useState(0);
  const [composerScrollTop, setComposerScrollTop] = useState(0);

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
  const commandChipVisible = Boolean(draftCommand) && !doubaoImageMode;
  const referenceCapsulesVisible = !refinementContext && references.length > 0;
  const inlineChipsVisible = commandChipVisible || referenceCapsulesVisible;
  useLayoutEffect(() => {
    if (!inlineChipsVisible) {
      setInlineChipsIndent(0);
      setInlineChipsPadTop(0);
      setComposerScrollTop(0);
      return;
    }
    const container = inlineChipsRef.current;
    const chips = container
      ? (Array.from(container.children) as HTMLElement[])
      : [];
    const lastChip = chips[chips.length - 1];
    if (!container || !lastChip) return;
    // 胶囊仍在首行：正文用 text-indent 从胶囊后开始，composer 高度不变；
    // 胶囊折行（引用较多）：退化为把正文下移到胶囊区块之下。
    if (lastChip.offsetTop <= 4) {
      setInlineChipsIndent(lastChip.offsetLeft + lastChip.offsetWidth + 7);
      setInlineChipsPadTop(0);
    } else {
      setInlineChipsIndent(0);
      setInlineChipsPadTop(container.offsetHeight + 12);
    }
  }, [inlineChipsVisible, commandChipVisible, references]);
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
  const applyPromptReference = (target: Prompt) => {
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

  return (
    <WorkbenchComposerFrame
      attachments={
        (sourceBlockVisible || attachmentStripVisible) && (
          <div
            className="pointer-events-auto mx-auto mb-2 max-w-[620px] space-y-1.5"
            data-position="above-composer"
          >
            {!refinementContext && schemeSource && (
              <SchemeRunAttachment
                source={schemeSource}
                imageCount={draftImages.length}
                onClear={handleClearSource}
                onPickImage={pickImage}
                onSwap={() => setSchemePickerOpen(true)}
              />
            )}
            {attachmentStripVisible && (
              <div
                className="flex items-center gap-2 overflow-x-auto pb-0.5"
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
                        <span className="block truncate text-[10.5px] font-medium text-primary">
                          历史 · {draftHistorySource.items.length} 张图片
                          {draftHistorySource.items.some(
                            (item) => item.promptText,
                          )
                            ? ` + ${draftHistorySource.items.filter((item) => item.promptText).length} 条提示词`
                            : ""}
                        </span>
                        <span className="mt-0.5 block text-[9.5px] text-tertiary">
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
          </div>
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
      {overLimit && (
        <p
          className="mb-1.5 px-1 text-[10.5px] text-danger"
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
          <p className="px-2.5 py-1 text-[10px] font-medium text-secondary">
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
              <span className="min-w-0 flex-1 truncate text-right text-[10px] text-tertiary">
                {hint.description}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="relative">
        {inlineChipsVisible && (
          <span
            ref={inlineChipsRef}
            className="absolute left-2 right-2 z-10 flex flex-wrap items-center gap-1 sm:left-2.5 sm:right-2.5"
            style={{ top: 8 - composerScrollTop }}
            data-testid="composer-inline-chips"
          >
            {commandChipVisible && (
              <span
                className="inline-flex h-[21px] items-center gap-1 rounded-md bg-accent-soft pl-1.5 pr-0.5 text-[11px] font-medium leading-none text-accent"
                data-testid="composer-command-chip"
                data-command={draftCommand}
                title="Agent 会把你的想法整理成方案草稿"
              >
                <Wand2 className="h-3 w-3 shrink-0" />
                {DESIGN_PLAN_COMMAND_LABEL}
                <button
                  type="button"
                  onClick={() => {
                    setDraftCommand(null);
                    textareaRef.current?.focus();
                  }}
                  className="flex h-4 w-4 items-center justify-center rounded-[4px] transition-colors hover:bg-accent/15"
                  aria-label="移除指令"
                  title="移除指令（Backspace）"
                  data-testid="composer-command-chip-remove"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            )}
            {referenceCapsulesVisible &&
              references.map((reference, index) => (
                <InlineReferenceCapsule
                  key={`${reference.promptId}-${index}`}
                  reference={reference}
                  onRemove={() => {
                    removeReferenceAt(index);
                    textareaRef.current?.focus();
                  }}
                />
              ))}
          </span>
        )}
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
          onScroll={(event) => {
            if (inlineChipsVisible)
              setComposerScrollTop(event.currentTarget.scrollTop);
          }}
          style={
            inlineChipsVisible &&
            (inlineChipsIndent > 0 || inlineChipsPadTop > 0)
              ? {
                  ...(inlineChipsIndent > 0
                    ? { textIndent: inlineChipsIndent }
                    : {}),
                  ...(inlineChipsPadTop > 0
                    ? { paddingTop: inlineChipsPadTop }
                    : {}),
                }
              : undefined
          }
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
              if (referenceCapsulesVisible) {
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

function DraftImagesPreview({
  images,
  startIndex = 1,
  onRemove,
  onPreview,
}: {
  images: LocalImageReference[];
  startIndex?: number;
  onRemove: (index: number) => void;
  onPreview: (path: string) => void;
}) {
  const supportingRefinement = startIndex > 1;
  return (
    <div
      className="flex min-w-max items-end gap-1.5"
      data-testid="workbench-draft-images"
      data-position="above-composer"
    >
      <span className="shrink-0 self-center px-0.5 text-[10px] text-secondary">
        {supportingRefinement ? "其他图片" : "参考图片"}
      </span>
      {images.map((image, index) => {
        const imageNumber = startIndex + index;
        return (
          <div
            key={`${image.source}:${image.historyId ?? image.path}:${index}`}
            className="group relative shrink-0 rounded-md border border-border-subtle bg-inset/55 p-1"
            data-testid="workbench-draft-image"
          >
            <button
              type="button"
              onClick={() => onPreview(image.path)}
              className="block cursor-zoom-in rounded"
              title={image.name ?? `图 ${imageNumber}`}
              aria-label={`查看图 ${imageNumber}`}
              data-testid="workbench-draft-image-preview"
            >
              <img
                src={toImageSrc(image.path)}
                alt={`图 ${imageNumber}`}
                className="h-12 w-12 rounded object-contain"
              />
            </button>
            <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded bg-black/65 px-1 py-0.5 text-[8px] leading-none text-white">
              图 {imageNumber}
            </span>
            <button
              type="button"
              onClick={() => onRemove(index)}
              title={`移除图 ${imageNumber}`}
              aria-label={`移除图片 ${imageNumber}`}
              className="no-drag absolute right-0.5 top-0.5 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-black/65 text-white opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100"
              data-testid="workbench-draft-image-remove"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function RefinementTargetReference({
  context,
  onClear,
  onPreview,
}: {
  context: RefinementContext;
  onClear: () => void;
  onPreview: (path: string) => void;
}) {
  const target = context.images[0] ?? {
    source: "history" as const,
    path: context.imagePath,
    historyId: context.historyId,
    name: "图 1",
  };
  return (
    <div
      className="flex min-w-0 shrink-0 items-center gap-2 rounded-lg border border-border-default bg-popover p-1.5 pl-1.5 shadow-sm"
      data-testid="workbench-refinement-context"
      data-position="above-composer"
    >
      <button
        type="button"
        onClick={() => onPreview(target.path)}
        className="relative shrink-0 cursor-zoom-in rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
        title="查看微调目标"
        aria-label="查看微调目标"
        data-testid="refinement-context-image-preview"
      >
        <img
          src={toImageSrc(target.path)}
          alt="微调目标"
          className="h-11 w-11 rounded-md object-contain"
        />
        <span className="absolute bottom-0.5 left-0.5 rounded bg-black/65 px-1 py-0.5 text-[7.5px] leading-none text-white">
          图 1
        </span>
      </button>
      <span
        className="text-[11px] font-medium text-primary"
        data-testid="refinement-target-label"
      >
        微调目标
      </span>
      <button
        type="button"
        onClick={onClear}
        title="退出微调"
        aria-label="退出微调"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-tertiary transition-colors hover:bg-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
        data-testid="refinement-context-clear"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// 悬停查看完整提示词：fixed 定位向上弹出，不受滚动容器裁剪。
function PromptFullTextCard({
  title,
  text,
  scope,
  anchor,
}: {
  title: string;
  text: string;
  scope?: GenerationTurn["references"][number]["scope"];
  anchor: DOMRect;
}) {
  const width = 320;
  const left = Math.max(
    8,
    Math.min(anchor.left, window.innerWidth - width - 8),
  );
  return (
    <span
      className="pointer-events-none fixed z-[90] block w-[320px] rounded-lg border border-border-default bg-popover p-3 text-left shadow-pop animate-scale-fade-in"
      style={{ left, bottom: window.innerHeight - anchor.top + 8 }}
      role="tooltip"
      data-testid="prompt-reference-preview"
    >
      <span className="block truncate text-[10px] font-medium text-tertiary">
        {title}
        {scope ? ` · ${scope === "full" ? "整条引用" : "选段引用"}` : ""}
      </span>
      <span className="mt-1.5 block max-h-[200px] overflow-hidden whitespace-pre-wrap text-[11px] leading-relaxed text-secondary">
        {text}
      </span>
    </span>
  );
}

// 行内提示词引用胶囊（Codex 式）：图标 + 标题；悬停查看全文，X 或行首 Backspace 移除。
function InlineReferenceCapsule({
  reference,
  onRemove,
}: {
  reference: GenerationTurn["references"][number];
  onRemove: () => void;
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  return (
    <span
      className="inline-flex h-[21px] max-w-[176px] items-center gap-1 rounded-md border border-border-subtle bg-inset pl-1.5 pr-0.5 text-[11px] font-medium leading-none text-primary"
      data-testid="workbench-reference-chip"
      data-reference-scope={reference.scope}
      onMouseEnter={(event) =>
        setAnchor(event.currentTarget.getBoundingClientRect())
      }
      onMouseLeave={() => setAnchor(null)}
      onFocusCapture={(event) =>
        setAnchor(event.currentTarget.getBoundingClientRect())
      }
      onBlurCapture={() => setAnchor(null)}
    >
      <FileText className="h-3 w-3 shrink-0 text-secondary" />
      <span className="min-w-0 truncate">{reference.title}</span>
      <button
        type="button"
        onClick={onRemove}
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] transition-colors hover:bg-hover"
        aria-label={`移除引用：${reference.title}`}
        title="移除引用（Backspace）"
        data-testid="workbench-reference-remove"
      >
        <X className="h-2.5 w-2.5" />
      </button>
      {anchor && (
        <PromptFullTextCard
          title={reference.title}
          text={reference.text}
          scope={reference.scope}
          anchor={anchor}
        />
      )}
    </span>
  );
}

// 来源芯片（提示词/历史引用）：Codex 式附件芯片，表达在 Composer 上方的上下文区；提示词来源悬停可看全文。
function SourceChip({
  source,
  onClear,
  previewText,
}: {
  source: GenerationSource;
  onClear: () => void;
  previewText?: string;
}) {
  const fromPrompt = source.kind === "prompt";
  const Icon = fromPrompt ? FileText : History;
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  if (fromPrompt) {
    return (
      <WorkbenchPromptReferenceCard
        title={source.label ?? "提示词"}
        text={previewText ?? source.content}
        subtitle={
          (previewText ?? source.content)
            ? "引用提示词 · 悬停查看全文"
            : "来自提示词库"
        }
        onClear={onClear}
      />
    );
  }
  return (
    <div
      className="flex h-12 min-w-[200px] max-w-[300px] shrink-0 items-center gap-2.5 rounded-lg border border-border-default bg-popover px-2.5 shadow-sm"
      data-testid="refine-source"
      data-workbench-testid="workbench-source"
      data-source-kind={source.kind}
      onMouseEnter={
        previewText
          ? (event) => setAnchor(event.currentTarget.getBoundingClientRect())
          : undefined
      }
      onMouseLeave={previewText ? () => setAnchor(null) : undefined}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-background">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className="block truncate text-[10.5px] font-medium text-primary"
          title={source.label ?? ""}
        >
          {source.label ?? (fromPrompt ? "提示词" : "历史记录")}
        </span>
        <span className="mt-0.5 block truncate text-[9.5px] text-tertiary">
          {fromPrompt
            ? previewText
              ? "引用提示词 · 悬停查看全文"
              : "来自提示词库"
            : "来自生成历史"}
        </span>
      </span>
      <button
        type="button"
        onClick={onClear}
        title="移除来源"
        aria-label="移除来源"
        className="icon-action h-7 w-7 shrink-0"
        data-testid="refine-source-clear"
        data-workbench-testid="workbench-source-clear"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      {anchor && previewText && (
        <PromptFullTextCard
          title={source.label ?? "提示词"}
          text={previewText}
          anchor={anchor}
        />
      )}
    </div>
  );
}

function formatParams(params: { ratioId: string; quality: string; n: number }) {
  return `${params.ratioId} · ${params.quality} · ${params.n}张`;
}
