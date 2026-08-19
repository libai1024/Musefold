import { useEffect, useMemo, useState } from "react";
import {
  type GenerationHistoryPage,
  type GenerationJob,
  type PromptDocument,
} from "@musefold/contracts";
import { canCancelGeneration } from "@musefold/domain";
import {
  GenerationHistoryDetailActions,
  GenerationHistoryDetailContent,
  GenerationHistoryDetailScreen,
  GenerationHistoryInspectorPanel,
  GenerationHistoryRow,
  GenerationHistoryScreen,
  GenerationHistoryTrashScreen,
  GenerationHistoryWorkspace,
  useHistoryInspectorController,
  type GenerationHistoryDetailViewModel,
  type GenerationHistoryItemViewModel,
} from "@musefold/product-ui";
import { Button } from "@musefold/ui";

export interface HistoryViewProps {
  history: GenerationHistoryPage;
  onReuse: (job: GenerationJob) => void;
  onGet: (id: string) => Promise<GenerationJob>;
  onRetry: (id: string) => Promise<GenerationJob>;
  onCancel: (id: string) => Promise<GenerationJob>;
  onDelete: (id: string) => Promise<GenerationJob>;
  onRestore: (id: string) => Promise<GenerationJob>;
  onListTrash: () => Promise<GenerationJob[]>;
  onSavePrompt: (job: GenerationJob) => Promise<PromptDocument>;
  onRefresh: () => Promise<void>;
}

export function HistoryView({
  history,
  onReuse,
  onGet,
  onRetry,
  onCancel,
  onDelete,
  onRestore,
  onListTrash,
  onSavePrompt,
  onRefresh,
}: HistoryViewProps) {
  const [refreshing, setRefreshing] = useState(false);
  const inspector = useHistoryInspectorController();
  const { mode, origin: detailOrigin } = inspector;
  const [selected, setSelected] = useState<GenerationJob | null>(null);
  const [trash, setTrash] = useState<GenerationJob[]>([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<
    "retry" | "cancel" | "save" | "delete" | "restore" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [savedPromptIds, setSavedPromptIds] = useState<Set<string>>(
    () => new Set(),
  );

  useEffect(() => {
    if (!selected || selected.deletedAt) return;
    const latest = history.items.find((item) => item.id === selected.id);
    if (latest) setSelected(latest);
  }, [history.items, selected?.id, selected?.deletedAt]);

  useEffect(() => setConfirmDelete(false), [selected?.id]);

  const items = useMemo<GenerationHistoryItemViewModel[]>(
    () =>
      history.items.map((item) => ({
        ...toGenerationHistoryItemViewModel(item),
        selected: item.id === selected?.id && mode === "detail",
      })),
    [history.items, mode, selected?.id],
  );

  const refresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      await onRefresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "历史刷新失败");
    } finally {
      setRefreshing(false);
    }
  };

  const openDetail = async (item: GenerationJob, origin: "list" | "trash") => {
    setError(null);
    setNotice(null);
    setSelected(item);
    inspector.openDetail(item.id, origin);
    try {
      setSelected(await onGet(item.id));
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "生成详情载入失败",
      );
    }
  };

  const openTrash = async () => {
    inspector.openTrash();
    setError(null);
    setNotice(null);
    setTrashLoading(true);
    try {
      setTrash(await onListTrash());
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "回收站载入失败",
      );
    } finally {
      setTrashLoading(false);
    }
  };

  const copyPrompt = async () => {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(selected.request.prompt);
      setNotice("提示词已复制");
      setError(null);
    } catch {
      setError("剪贴板不可用，提示词复制失败");
    }
  };

  const closeDetail = () => {
    if (detailOrigin === "trash") inspector.openTrash();
    else inspector.openList();
    setError(null);
    setNotice(null);
    setConfirmDelete(false);
  };

  const retrySelected = () => {
    if (!selected) return;
    setBusyAction("retry");
    setError(null);
    setNotice(null);
    void onRetry(selected.id)
      .then((next) => {
        setSelected(next);
        inspector.openDetail(next.id, "list");
        setNotice("已创建重试任务");
      })
      .catch((nextError) =>
        setError(nextError instanceof Error ? nextError.message : "重试失败"),
      )
      .finally(() => setBusyAction(null));
  };

  const cancelSelected = () => {
    if (!selected) return;
    setBusyAction("cancel");
    setError(null);
    void onCancel(selected.id)
      .then((next) => {
        setSelected(next);
        setNotice("任务已取消");
      })
      .catch((nextError) =>
        setError(nextError instanceof Error ? nextError.message : "取消失败"),
      )
      .finally(() => setBusyAction(null));
  };

  const saveSelectedPrompt = () => {
    if (!selected || savedPromptIds.has(selected.id)) return;
    setBusyAction("save");
    setError(null);
    void onSavePrompt(selected)
      .then(() => {
        setSavedPromptIds((current) => new Set(current).add(selected.id));
        setNotice("已存入个人提示词库");
      })
      .catch((nextError) =>
        setError(
          nextError instanceof Error ? nextError.message : "存为提示词失败",
        ),
      )
      .finally(() => setBusyAction(null));
  };

  const deleteSelected = () => {
    if (!selected) return;
    setConfirmDelete(false);
    setBusyAction("delete");
    setError(null);
    void onDelete(selected.id)
      .then((deleted) => {
        setTrash((current) => [
          deleted,
          ...current.filter((job) => job.id !== deleted.id),
        ]);
        setSelected(null);
        inspector.select(null);
        inspector.openList();
      })
      .catch((nextError) =>
        setError(nextError instanceof Error ? nextError.message : "删除失败"),
      )
      .finally(() => setBusyAction(null));
  };

  const restoreSelected = () => {
    if (!selected) return;
    setBusyAction("restore");
    setError(null);
    void onRestore(selected.id)
      .then((restored) => {
        setTrash((current) =>
          current.filter((job) => job.id !== restored.id),
        );
        setSelected(restored);
        inspector.openDetail(restored.id, "list");
        setNotice("生成记录已恢复");
      })
      .catch((nextError) =>
        setError(nextError instanceof Error ? nextError.message : "恢复失败"),
      )
      .finally(() => setBusyAction(null));
  };

  if (mode === "trash") {
    return (
      <div className="page">
        <GenerationHistoryTrashScreen
          items={trash.map(toGenerationHistoryDetailViewModel)}
          loading={trashLoading}
          busyId={busyAction === "restore" ? (selected?.id ?? null) : null}
          error={error}
          onBack={() => {
            inspector.openList();
            setError(null);
          }}
          onOpen={(item) => {
            const job = trash.find((candidate) => candidate.id === item.id);
            if (job) void openDetail(job, "trash");
          }}
          onRestore={(item) => {
            setSelected(trash.find((job) => job.id === item.id) ?? null);
            setBusyAction("restore");
            setError(null);
            void onRestore(item.id)
              .then(() => {
                setTrash((current) =>
                  current.filter((job) => job.id !== item.id),
                );
              })
              .catch((nextError) =>
                setError(
                  nextError instanceof Error
                    ? nextError.message
                    : "生成记录恢复失败",
                ),
              )
              .finally(() => setBusyAction(null));
          }}
        />
      </div>
    );
  }

  if (mode === "detail" && selected && detailOrigin === "trash") {
    const detail = toGenerationHistoryDetailViewModel(selected);
    const retryable = ["failed", "cancelled"].includes(selected.status);
    return (
      <div className="page">
        <GenerationHistoryDetailScreen
          detail={detail}
          backLabel="回收站"
          busyAction={busyAction}
          notice={notice}
          actionError={error}
          savePromptLabel={
            savedPromptIds.has(selected.id) ? "已存为提示词" : "存为提示词"
          }
          onBack={closeDetail}
          onOpenImage={
            detail.imageUrl
              ? () => window.open(detail.imageUrl ?? "", "_blank", "noopener")
              : undefined
          }
          onCopyPrompt={() => void copyPrompt()}
          onRetry={!selected.deletedAt && retryable ? retrySelected : undefined}
          onCancel={
            !selected.deletedAt && canCancelGeneration(selected)
              ? cancelSelected
              : undefined
          }
          onSavePrompt={
            !selected.deletedAt && selected.status === "succeeded"
              ? saveSelectedPrompt
              : undefined
          }
          onRestore={selected.deletedAt ? restoreSelected : undefined}
        />
      </div>
    );
  }

  const detail =
    mode === "detail" && selected
      ? toGenerationHistoryDetailViewModel(selected)
      : null;
  const retryable = Boolean(
    selected && ["failed", "cancelled"].includes(selected.status),
  );
  const openHistoryItem = (item: GenerationHistoryItemViewModel) => {
    const job = history.items.find((candidate) => candidate.id === item.id);
    if (job) void openDetail(job, "list");
  };

  const inspectorDetail =
    detail && selected ? (
      <GenerationHistoryInspectorPanel
        historyId={selected.id}
        status={selected.status}
        notice={notice}
        error={error ? <span role="alert">{error}</span> : undefined}
        content={
          <GenerationHistoryDetailContent
            detail={detail}
            density="compact"
            onOpenImage={
              detail.imageUrl
                ? () =>
                    window.open(detail.imageUrl ?? "", "_blank", "noopener")
                : undefined
            }
            onCopyPrompt={() => void copyPrompt()}
          />
        }
        actions={
          <GenerationHistoryDetailActions
            layout="stacked"
            deleted={Boolean(selected.deletedAt)}
            busyAction={busyAction}
            onRestore={selected.deletedAt ? restoreSelected : undefined}
            onReuse={selected.deletedAt ? undefined : () => onReuse(selected)}
            onRetry={
              !selected.deletedAt && retryable ? retrySelected : undefined
            }
            onCancel={
              !selected.deletedAt && canCancelGeneration(selected)
                ? cancelSelected
                : undefined
            }
            downloadUrl={detail.imageUrl}
            onSavePrompt={
              !selected.deletedAt && selected.status === "succeeded"
                ? saveSelectedPrompt
                : undefined
            }
            savePromptLabel={
              savedPromptIds.has(selected.id) ? "已存为提示词" : "存为提示词"
            }
            onCopyPrompt={() => void copyPrompt()}
            onDelete={
              !selected.deletedAt ? () => setConfirmDelete(true) : undefined
            }
            extraActions={
              confirmDelete ? (
                <span className="mf-history-delete-confirm" role="group">
                  <Button
                    variant="secondary"
                    className="mf-secondary-button"
                    onClick={() => setConfirmDelete(false)}
                  >
                    取消
                  </Button>
                  <Button
                    variant="danger"
                    className="mf-danger-button"
                    disabled={Boolean(busyAction)}
                    onClick={deleteSelected}
                    data-testid="history-detail-delete-confirm"
                  >
                    {busyAction === "delete" ? "处理中..." : "移到回收站"}
                  </Button>
                </span>
              ) : null
            }
          />
        }
      />
    ) : null;

  return (
    <div className="page page-history">
      <GenerationHistoryScreen
        items={[]}
        count={items.length}
        refreshing={refreshing}
        onRefresh={() => void refresh()}
        onOpenTrash={() => void openTrash()}
        className="mf-history-screen-workspace"
        body={
          <GenerationHistoryWorkspace
            detailOpen={Boolean(detail && selected)}
            onBack={closeDetail}
            list={
              <>
                {error && mode === "list" ? (
                  <p className="library-error" role="alert">
                    {error}
                  </p>
                ) : null}
                <div
                  className="mf-history-list mf-history-workspace-rows"
                  role="list"
                >
                  {items.map((item) => (
                    <GenerationHistoryRow
                      key={item.id}
                      item={item}
                      onOpen={() => openHistoryItem(item)}
                      actions={
                        <Button
                          variant="ghost"
                          className="mf-text-action"
                          onClick={() => openHistoryItem(item)}
                        >
                          打开
                        </Button>
                      }
                    />
                  ))}
                  {items.length === 0 ? (
                    <div className="mf-empty-row">还没有生成记录</div>
                  ) : null}
                </div>
              </>
            }
            detail={inspectorDetail}
          />
        }
      />
    </div>
  );
}

function toGenerationHistoryItemViewModel(
  job: GenerationJob,
): GenerationHistoryItemViewModel {
  const status = generationStatusPresentation(job.status);
  return {
    id: job.id,
    prompt: job.request.prompt,
    imageUrl: job.assets[0]?.url ?? null,
    statusKey: job.status,
    statusLabel: status.label,
    statusTone: status.tone,
    metadata: [
      generationActorLabel(job),
      new Date(job.createdAt).toLocaleString(),
    ],
  };
}

function toGenerationHistoryDetailViewModel(
  job: GenerationJob,
): GenerationHistoryDetailViewModel {
  const status = generationStatusPresentation(job.status);
  const duration = generationDurationLabel(job);
  const metadata = [
    generationActorLabel(job),
    new Date(job.createdAt).toLocaleString(),
    ...(job.costPoints === null ? [] : [`${job.costPoints} 点`]),
    ...(duration ? [duration] : []),
  ];
  const quality =
    job.request.quality === "low"
      ? "快速"
      : job.request.quality === "medium"
        ? "标准"
        : job.request.quality === "high"
          ? "高质量"
          : "自动质量";
  return {
    id: job.id,
    prompt: job.request.prompt,
    negative: job.request.negative ?? null,
    imageUrl: job.assets[0]?.url ?? null,
    imageUnavailableLabel:
      job.status === "succeeded" ? "图片不可用" : "无生成图片",
    statusKey: job.status,
    statusLabel: status.label,
    statusTone: status.tone,
    modelLabel: job.providerModel ?? "模型待分配",
    metadata,
    paramsLabel: [
      job.request.size,
      job.request.aspectRatio,
      quality,
      `${job.request.count} 张`,
    ]
      .filter(Boolean)
      .join(" · "),
    sourceLabel: job.promptId
      ? `个人提示词库 · ${generationActorLabel(job)}`
      : generationActorLabel(job),
    deletedAtLabel: job.deletedAt
      ? new Date(job.deletedAt).toLocaleString()
      : null,
    error: job.error
      ? {
          code: job.error.code,
          title: "生成失败",
          hint: "可以检查提示词、额度和服务状态后重试。",
          details: job.error.message,
        }
      : null,
  };
}

function generationStatusPresentation(status: GenerationJob["status"]): {
  label: string;
  tone: GenerationHistoryDetailViewModel["statusTone"];
} {
  switch (status) {
    case "succeeded":
      return { label: "已完成", tone: "success" };
    case "failed":
      return { label: "失败", tone: "danger" };
    case "cancelled":
      return { label: "已取消", tone: "neutral" };
    case "pending_approval":
      return { label: "等待审批", tone: "warning" };
    case "queued":
      return { label: "排队中", tone: "progress" };
    case "running":
    case "cancelling":
      return {
        label: status === "cancelling" ? "取消中" : "生成中",
        tone: "progress",
      };
    case "rejected":
      return { label: "已拒绝", tone: "danger" };
    case "expired":
      return { label: "已过期", tone: "danger" };
  }
}

function generationActorLabel(job: GenerationJob): string {
  return job.actorType === "cloud_mcp" ? "Cloud MCP" : "Web 工作台";
}

function generationDurationLabel(job: GenerationJob): string | null {
  if (!job.startedAt || !job.finishedAt) return null;
  const milliseconds = Math.max(
    0,
    new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime(),
  );
  return milliseconds < 10_000
    ? `${(milliseconds / 1_000).toFixed(1)} 秒`
    : `${Math.round(milliseconds / 1_000)} 秒`;
}
