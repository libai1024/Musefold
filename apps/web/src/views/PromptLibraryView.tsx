import { useEffect, useMemo, useRef, useState } from "react";
import {
  type NewPromptDocument,
  type PromptDocument,
  type UpdatePromptDocument,
} from "@musefold/contracts";
import {
  PromptDetailScreen,
  PromptEditorForm,
  PromptLibraryHeaderActions,
  PromptLibraryScreen,
  PromptTrashScreen,
  type PromptDetailViewModel,
  type PromptEditorDraft,
  type PromptListItemViewModel,
} from "@musefold/product-ui";
import { Button } from "@musefold/ui";
import { WebGatewayError } from "../runtime";

export interface PromptLibraryViewProps {
  prompts: PromptDocument[];
  query: string;
  onQueryChange: (query: string) => void;
  onUse: (prompt: PromptDocument) => void;
  onCreate: (input: NewPromptDocument) => Promise<PromptDocument>;
  onGet: (id: string) => Promise<PromptDocument>;
  onUpdate: (
    id: string,
    input: UpdatePromptDocument,
  ) => Promise<PromptDocument>;
  onDelete: (id: string, expectedVersion: number) => Promise<PromptDocument>;
  onRestore: (id: string, expectedVersion: number) => Promise<PromptDocument>;
  onListTrash: () => Promise<PromptDocument[]>;
  onSearch?: (query: string) => Promise<void>;
}

export function PromptLibraryView({
  prompts,
  query,
  onQueryChange,
  onUse,
  onCreate,
  onGet,
  onUpdate,
  onDelete,
  onRestore,
  onListTrash,
  onSearch,
}: PromptLibraryViewProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [mode, setMode] = useState<"list" | "detail" | "editor" | "trash">(
    "list",
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<PromptDocument | null>(null);
  const [editorRevision, setEditorRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trash, setTrash] = useState<PromptDocument[]>([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [busyTrashId, setBusyTrashId] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{
    latest: PromptDocument;
    draft: PromptEditorDraft;
  } | null>(null);
  const didMountSearch = useRef(false);
  const searchRevision = useRef(0);

  useEffect(() => {
    if (!onSearch) return;
    if (!didMountSearch.current) {
      didMountSearch.current = true;
      return;
    }
    const revision = ++searchRevision.current;
    const timer = window.setTimeout(() => {
      void onSearch(query).catch((cause) => {
        if (revision !== searchRevision.current) return;
        setError(cause instanceof Error ? cause.message : "提示词搜索失败");
      });
    }, 220);
    return () => window.clearTimeout(timer);
  }, [onSearch, query]);
  const selected = prompts.find((prompt) => prompt.id === selectedId) ?? null;
  const items = useMemo<PromptListItemViewModel[]>(
    () =>
      prompts.map((prompt) => ({
        id: prompt.id,
        title: prompt.title,
        content: prompt.content,
        description: prompt.description,
        usageCount: prompt.usageCount,
        tags: prompt.tags.map((tag) => tag.name),
        isPinned: prompt.isPinned,
        updatedAtLabel: new Date(prompt.updatedAt).toLocaleString(),
      })),
    [prompts],
  );
  const editorInitial = useMemo<PromptEditorDraft>(
    () => promptEditorDraft(editing),
    [editing?.id, editing?.version, editorRevision],
  );

  const copyPrompt = async (prompt: PromptListItemViewModel) => {
    try {
      await navigator.clipboard.writeText(prompt.content);
      setCopiedId(prompt.id);
      window.setTimeout(() => setCopiedId(null), 1_200);
    } catch {
      setError("剪贴板不可用");
    }
  };

  const openEditor = (prompt: PromptDocument | null) => {
    setEditing(prompt);
    setConflict(null);
    setError(null);
    setEditorRevision((revision) => revision + 1);
    setMode("editor");
  };

  const submitEditor = async (draft: PromptEditorDraft) => {
    setBusy(true);
    setError(null);
    try {
      const saved = editing
        ? await onUpdate(
            editing.id,
            promptUpdateFromDraft(editing, draft, editing.version),
          )
        : await onCreate(promptCreateFromDraft(draft));
      setSelectedId(saved.id);
      setEditing(null);
      setConflict(null);
      setMode("detail");
    } catch (cause) {
      if (
        editing &&
        cause instanceof WebGatewayError &&
        cause.code === "PROMPT_VERSION_CONFLICT"
      ) {
        try {
          const latest = await onGet(editing.id);
          setConflict({ latest, draft });
          setError(null);
        } catch (reloadError) {
          setError(
            reloadError instanceof Error
              ? reloadError.message
              : "无法载入云端最新版本",
          );
        }
      } else {
        setError(cause instanceof Error ? cause.message : "提示词保存失败");
      }
    } finally {
      setBusy(false);
    }
  };

  const keepLocalConflictDraft = async () => {
    if (!conflict) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await onUpdate(
        conflict.latest.id,
        promptUpdateFromDraft(
          conflict.latest,
          conflict.draft,
          conflict.latest.version,
        ),
      );
      setSelectedId(saved.id);
      setEditing(null);
      setConflict(null);
      setMode("detail");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "冲突合并失败");
    } finally {
      setBusy(false);
    }
  };

  const loadCloudConflictVersion = () => {
    if (!conflict) return;
    setEditing(conflict.latest);
    setConflict(null);
    setEditorRevision((revision) => revision + 1);
  };

  const deleteSelected = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete(selected.id, selected.version);
      setSelectedId(null);
      setMode("list");
    } catch (cause) {
      if (
        cause instanceof WebGatewayError &&
        cause.code === "PROMPT_VERSION_CONFLICT"
      ) {
        const latest = await onGet(selected.id).catch(() => null);
        if (latest) setSelectedId(latest.id);
        setError("提示词已在其他设备更新，已载入最新版本，请重新确认删除。 ");
      } else {
        setError(cause instanceof Error ? cause.message : "删除失败");
      }
    } finally {
      setBusy(false);
    }
  };

  const openTrash = async () => {
    setMode("trash");
    setTrashLoading(true);
    setError(null);
    try {
      setTrash(await onListTrash());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "回收站载入失败");
    } finally {
      setTrashLoading(false);
    }
  };

  const restoreTrashPrompt = async (prompt: PromptDetailViewModel) => {
    const source = trash.find((item) => item.id === prompt.id);
    if (!source) return;
    setBusyTrashId(source.id);
    setError(null);
    try {
      await onRestore(source.id, source.version);
      setTrash((current) => current.filter((item) => item.id !== source.id));
    } catch (cause) {
      if (
        cause instanceof WebGatewayError &&
        cause.code === "PROMPT_VERSION_CONFLICT"
      ) {
        const latest = await onGet(source.id).catch(() => null);
        if (latest) {
          setTrash((current) =>
            current.map((item) => (item.id === latest.id ? latest : item)),
          );
        }
        setError("云端版本已变化，已刷新该提示词，请再次恢复。");
      } else {
        setError(cause instanceof Error ? cause.message : "恢复失败");
      }
    } finally {
      setBusyTrashId(null);
    }
  };

  if (mode === "editor") {
    return (
      <div className="page">
        <PromptEditorForm
          key={`${editing?.id ?? "new"}:${editing?.version ?? 0}:${editorRevision}`}
          heading={editing ? "编辑提示词" : "新建提示词"}
          initial={editorInitial}
          busy={busy}
          error={error}
          submitLabel={editing ? "保存修改" : "创建提示词"}
          notice={
            conflict ? (
              <div className="prompt-conflict" role="alert">
                <strong>检测到其他设备的更新</strong>
                <p>
                  你的修改仍在。请选择载入云端版本，或基于最新版保留本次修改。
                </p>
                <div>
                  <Button
                    variant="secondary"
                    className="button button-secondary"
                    onClick={loadCloudConflictVersion}
                  >
                    载入云端
                  </Button>
                  <Button
                    variant="primary"
                    className="button button-primary"
                    disabled={busy}
                    onClick={() => void keepLocalConflictDraft()}
                    data-testid="prompt-conflict-keep-local"
                  >
                    保留我的修改
                  </Button>
                </div>
              </div>
            ) : undefined
          }
          onCancel={() => {
            setConflict(null);
            setError(null);
            setMode(editing ? "detail" : "list");
          }}
          onSubmit={submitEditor}
        />
      </div>
    );
  }

  if (mode === "detail" && selected) {
    return (
      <div className="page">
        <PromptDetailScreen
          prompt={toPromptDetailViewModel(selected)}
          busy={busy}
          error={error}
          confirmDelete
          onBack={() => {
            setError(null);
            setMode("list");
          }}
          onUse={() => onUse(selected)}
          onEdit={() => openEditor(selected)}
          onCopy={() => void copyPrompt(toPromptListItemViewModel(selected))}
          onTogglePin={async () => {
            setBusy(true);
            setError(null);
            try {
              await onUpdate(selected.id, {
                expectedVersion: selected.version,
                isPinned: !selected.isPinned,
              });
            } catch (cause) {
              setError(
                cause instanceof Error ? cause.message : "置顶状态更新失败",
              );
            } finally {
              setBusy(false);
            }
          }}
          onDelete={deleteSelected}
        />
      </div>
    );
  }

  if (mode === "trash") {
    return (
      <div className="page">
        <PromptTrashScreen
          prompts={trash.map(toPromptDetailViewModel)}
          loading={trashLoading}
          error={error}
          busyId={busyTrashId}
          onBack={() => {
            setError(null);
            setMode("list");
          }}
          onRestore={(prompt) => void restoreTrashPrompt(prompt)}
        />
      </div>
    );
  }

  return (
    <div className="page">
      <PromptLibraryScreen
        prompts={items}
        query={query}
        onQueryChange={onQueryChange}
        copiedId={copiedId}
        headerAction={
          <PromptLibraryHeaderActions
            onCreate={() => openEditor(null)}
            onOpenTrash={() => void openTrash()}
          />
        }
        onOpen={(prompt) => {
          setSelectedId(prompt.id);
          setError(null);
          setMode("detail");
        }}
        onCopy={(prompt) => void copyPrompt(prompt)}
        onUse={(prompt) => {
          const source = prompts.find((item) => item.id === prompt.id);
          if (source) onUse(source);
        }}
      />
      {error && (
        <p className="form-error library-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function toPromptListItemViewModel(
  prompt: PromptDocument,
): PromptListItemViewModel {
  return {
    id: prompt.id,
    title: prompt.title,
    content: prompt.content,
    description: prompt.description,
    usageCount: prompt.usageCount,
    tags: prompt.tags.map((tag) => tag.name),
    isPinned: prompt.isPinned,
    updatedAtLabel: new Date(prompt.updatedAt).toLocaleString(),
  };
}

function toPromptDetailViewModel(
  prompt: PromptDocument,
): PromptDetailViewModel {
  return {
    ...toPromptListItemViewModel(prompt),
    negative: prompt.negative,
    sourceLabel:
      prompt.source === "generation"
        ? "生成记录"
        : prompt.source === "import"
          ? "导入"
          : prompt.source === "share"
            ? "分享导入"
            : prompt.source === "slip"
              ? "笺"
              : "手动创建",
    createdAtLabel: new Date(prompt.createdAt).toLocaleString(),
    updatedAtLabel: new Date(prompt.updatedAt).toLocaleString(),
    deletedAtLabel: prompt.deletedAt
      ? new Date(prompt.deletedAt).toLocaleString()
      : null,
  };
}

function promptEditorDraft(prompt: PromptDocument | null): PromptEditorDraft {
  return {
    title: prompt?.title ?? "",
    description: prompt?.description ?? "",
    content: prompt?.content ?? "",
    negative: prompt?.negative ?? "",
    isPinned: prompt?.isPinned ?? false,
  };
}

function promptCreateFromDraft(draft: PromptEditorDraft): NewPromptDocument {
  return {
    title: draft.title,
    description: draft.description || null,
    content: draft.content,
    negative: draft.negative || null,
    folderId: null,
    tagIds: [],
    modelId: null,
    params: null,
    rating: 0,
    isPinned: draft.isPinned,
    source: "manual",
    sourceUrl: null,
  };
}

function promptUpdateFromDraft(
  prompt: PromptDocument,
  draft: PromptEditorDraft,
  expectedVersion: number,
): UpdatePromptDocument {
  return {
    expectedVersion,
    title: draft.title,
    description: draft.description || null,
    content: draft.content,
    negative: draft.negative || null,
    isPinned: draft.isPinned,
    tagIds: prompt.tags.map((tag) => tag.id),
  };
}
