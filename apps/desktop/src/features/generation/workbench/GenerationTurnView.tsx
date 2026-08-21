import { useEffect, useRef, useState } from "react";
import {
  Download,
  FileText,
  GitBranch,
  ListChecks,
  Loader2,
  Wand2,
  X,
} from "../../../components/ui/icons";
import { titleFromPromptContent } from "@musefold/domain";
import {
  GenerationSavePromptAction,
  WorkbenchAssistantAvatar,
  WorkbenchAssistantFrame,
  WorkbenchAssistantHeader,
  WorkbenchMessageActions,
  WorkbenchResultGrid,
  WorkbenchTurnActionIcon,
  WorkbenchTurnActions,
  WorkbenchTurnFrame,
  WorkbenchUserMessage,
  workbenchGenerationStatusLabel,
} from "@musefold/product-ui";
import { useAppStore } from "../../../stores/app";
import { useGenerationStore } from "../store";
import {
  useLibraryStore,
  linkHistoriesToPrompt,
  SchemeCreationConversation,
  SchemeRunConversation,
} from "./workbenchCrossFeature";
import { useGenerationWorkbenchStore } from "./store";
import type { GenerationTurn } from "./types";
import { cn } from "../../../lib/utils";
import { toast } from "../../../stores/toast";
import { desktopHost as api } from "@renderer/runtime/desktop-host-services";
import { ModelBrandIcon } from "../../../components/ui/brand-icons";
import musefoldIconUrl from "../../../../../../website/Musefold/assets/musefold-icon.png";
import { DESIGN_PLAN_COMMAND_LABEL } from "./composerIntent";
import { SkillRuntimeConversation } from "./SkillRuntimeAttachment";
import { GenerationResultCard } from "./GenerationResultCard";
import { GenerationTurnUserAttachments } from "./GenerationTurnUserAttachments";
import { formatParams } from "./workbench-display";

export function GenerationTurnView({
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
            <GenerationTurnUserAttachments turn={turn} onZoom={onZoom} />
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
