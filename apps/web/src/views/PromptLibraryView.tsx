import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type NewPromptDocument,
  type PromptDocument,
  type UpdatePromptDocument,
} from '@musefold/contracts';
import type { PlatformServices, PromptGateway } from '@musefold/domain';
import {
  PromptDetailScreen,
  PromptEditorForm,
  PromptLibraryHeaderActions,
  PromptLibraryScreen,
  PromptLibraryWorkspace,
  PromptTrashScreen,
  useLibraryPageController,
  type PromptDetailViewModel,
  type PromptEditorDraft,
  type PromptListItemViewModel,
} from '@musefold/product-ui';
import { Button } from '@musefold/ui';
import { WebGatewayError } from '../runtime';

export interface PromptLibraryViewProps {
  prompts: PromptGateway;
  platform: PlatformServices;
  query: string;
  onQueryChange: (query: string) => void;
  onUse: (prompt: PromptDocument) => void;
}

export function PromptLibraryView({
  prompts,
  platform,
  query,
  onQueryChange,
  onUse,
}: PromptLibraryViewProps) {
  const page = useLibraryPageController<PromptDocument>({
    prompts,
    platform,
    query,
    onQueryChange,
  });
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [mode, setMode] = useState<'list' | 'detail' | 'editor' | 'trash'>('list');
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
  const selectedId = page.selectedId;
  const selected = page.items.find((prompt) => prompt.id === selectedId) ?? null;
  const items = useMemo<PromptListItemViewModel[]>(
    () => page.items.map((prompt) => toPromptListItemViewModel(prompt)),
    [page.items],
  );
  const editorInitial = useMemo<PromptEditorDraft>(
    () => promptEditorDraft(editing),
    [editing?.id, editing?.version, editorRevision],
  );

  const listTrash = page.listTrash;

  useEffect(() => {
    if (mode !== 'trash') return;
    let cancelled = false;
    setTrashLoading(true);
    setError(null);
    void listTrash()
      .then((next) => {
        if (!cancelled) setTrash(next);
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : '回收站载入失败');
      })
      .finally(() => {
        if (!cancelled) setTrashLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [listTrash, mode]);

  const copyPrompt = async (prompt: PromptListItemViewModel) => {
    try {
      await page.copyText(prompt.content);
      setCopiedId(prompt.id);
      window.setTimeout(() => setCopiedId(null), 1_200);
    } catch {
      setError('剪贴板不可用');
    }
  };

  const openEditor = (prompt: PromptDocument | null) => {
    setEditing(prompt);
    setConflict(null);
    setError(null);
    setEditorRevision((revision) => revision + 1);
    setMode('editor');
  };

  const submitEditor = async (draft: PromptEditorDraft) => {
    setBusy(true);
    setError(null);
    try {
      const saved = editing
        ? await page.update(editing.id, promptUpdateFromDraft(editing, draft, editing.version))
        : await page.create(promptCreateFromDraft(draft));
      page.select(saved.id);
      setEditing(null);
      setConflict(null);
      setMode('detail');
    } catch (cause) {
      if (editing && cause instanceof WebGatewayError && cause.code === 'PROMPT_VERSION_CONFLICT') {
        try {
          const latest = await page.get(editing.id);
          setConflict({ latest, draft });
          setError(null);
        } catch (reloadError) {
          setError(reloadError instanceof Error ? reloadError.message : '无法载入云端最新版本');
        }
      } else {
        setError(cause instanceof Error ? cause.message : '提示词保存失败');
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
      const saved = await page.update(
        conflict.latest.id,
        promptUpdateFromDraft(conflict.latest, conflict.draft, conflict.latest.version),
      );
      page.select(saved.id);
      setEditing(null);
      setConflict(null);
      setMode('detail');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '冲突合并失败');
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
      await page.remove(selected.id, selected.version);
      page.select(null);
      setMode('list');
    } catch (cause) {
      if (cause instanceof WebGatewayError && cause.code === 'PROMPT_VERSION_CONFLICT') {
        const latest = await page.get(selected.id).catch(() => null);
        if (latest) page.select(latest.id);
        setError('提示词已在其他设备更新，已载入最新版本，请重新确认删除。 ');
      } else {
        setError(cause instanceof Error ? cause.message : '删除失败');
      }
    } finally {
      setBusy(false);
    }
  };

  const closeDetail = useCallback(() => {
    setError(null);
    setMode('list');
  }, []);

  const openTrash = useCallback(() => {
    setMode('trash');
  }, []);

  const restoreTrashPrompt = async (prompt: PromptDetailViewModel) => {
    const source = trash.find((item) => item.id === prompt.id);
    if (!source) return;
    setBusyTrashId(source.id);
    setError(null);
    try {
      await page.restore(source.id, source.version);
      setTrash((current) => current.filter((item) => item.id !== source.id));
    } catch (cause) {
      if (cause instanceof WebGatewayError && cause.code === 'PROMPT_VERSION_CONFLICT') {
        const latest = await page.get(source.id).catch(() => null);
        if (latest) {
          setTrash((current) => current.map((item) => (item.id === latest.id ? latest : item)));
        }
        setError('云端版本已变化，已刷新该提示词，请再次恢复。');
      } else {
        setError(cause instanceof Error ? cause.message : '恢复失败');
      }
    } finally {
      setBusyTrashId(null);
    }
  };

  if (mode === 'editor') {
    return (
      <div className="page min-h-0 min-w-0 flex-1 overflow-y-auto px-[24px] pt-[20px] pb-[48px]">
        <PromptEditorForm
          key={`${editing?.id ?? 'new'}:${editing?.version ?? 0}:${editorRevision}`}
          heading={editing ? '编辑提示词' : '新建提示词'}
          initial={editorInitial}
          busy={busy}
          error={error}
          submitLabel={editing ? '保存修改' : '创建提示词'}
          notice={
            conflict ? (
              <div
                className="mt-[18px] rounded-[7px] border border-solid border-[color-mix(in_srgb,var(--accent)_30%,var(--border-default))] bg-accent-soft p-[11px] text-secondary"
                role="alert"
              >
                <strong className="text-[11px] text-primary">检测到其他设备的更新</strong>
                <p className="mx-0 mt-[4px] mb-[10px] text-meta leading-[1.5]">
                  你的修改仍在。请选择载入云端版本，或基于最新版保留本次修改。
                </p>
                <div className="flex justify-end gap-[7px]">
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
            setMode(editing ? 'detail' : 'list');
          }}
          onSubmit={submitEditor}
        />
      </div>
    );
  }

  if (mode === 'trash') {
    return (
      <div className="page min-h-0 min-w-0 flex-1 overflow-y-auto px-[24px] pt-[20px] pb-[48px]">
        <PromptTrashScreen
          prompts={trash.map(toPromptDetailViewModel)}
          loading={trashLoading}
          error={error}
          busyId={busyTrashId}
          onBack={() => {
            setError(null);
            setMode('list');
          }}
          onRestore={(prompt) => void restoreTrashPrompt(prompt)}
        />
      </div>
    );
  }

  const detailOpen = mode === 'detail' && Boolean(selected);

  return (
    <div className="page-prompt-library min-h-0 min-w-0 flex-1 overflow-hidden">
      <PromptLibraryWorkspace
        detailOpen={detailOpen}
        onClose={closeDetail}
        list={
          <>
            <PromptLibraryScreen
              prompts={items}
              query={query}
              onQueryChange={onQueryChange}
              copiedId={copiedId}
              selectedId={selectedId}
              headerAction={
                <PromptLibraryHeaderActions
                  onCreate={() => openEditor(null)}
                  onOpenTrash={openTrash}
                />
              }
              onOpen={(prompt) => {
                page.select(prompt.id);
                setError(null);
                setMode('detail');
              }}
              onCopy={(prompt) => void copyPrompt(prompt)}
              onUse={(prompt) => {
                const source = page.items.find((item) => item.id === prompt.id);
                if (source) onUse(source);
              }}
            />
            {(error || page.error) && (
              <p className="form-error mt-[14px]" role="alert">
                {error ?? page.error}
              </p>
            )}
          </>
        }
        detail={
          detailOpen && selected ? (
            <PromptDetailScreen
              prompt={toPromptDetailViewModel(selected)}
              layout="inspector"
              showNavigation={false}
              busy={busy}
              error={error}
              confirmDelete
              onBack={closeDetail}
              onUse={() => onUse(selected)}
              onEdit={() => openEditor(selected)}
              onCopy={() => void copyPrompt(toPromptListItemViewModel(selected))}
              onTogglePin={async () => {
                setBusy(true);
                setError(null);
                try {
                  await page.update(selected.id, {
                    expectedVersion: selected.version,
                    isPinned: !selected.isPinned,
                  });
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : '置顶状态更新失败');
                } finally {
                  setBusy(false);
                }
              }}
              onDelete={deleteSelected}
            />
          ) : undefined
        }
      />
    </div>
  );
}

function toPromptListItemViewModel(prompt: PromptDocument): PromptListItemViewModel {
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

function toPromptDetailViewModel(prompt: PromptDocument): PromptDetailViewModel {
  return {
    ...toPromptListItemViewModel(prompt),
    negative: prompt.negative,
    sourceLabel:
      prompt.source === 'generation'
        ? '生成记录'
        : prompt.source === 'import'
          ? '导入'
          : prompt.source === 'share'
            ? '分享导入'
            : prompt.source === 'slip'
              ? '笺'
              : '手动创建',
    createdAtLabel: new Date(prompt.createdAt).toLocaleString(),
    updatedAtLabel: new Date(prompt.updatedAt).toLocaleString(),
    deletedAtLabel: prompt.deletedAt ? new Date(prompt.deletedAt).toLocaleString() : null,
  };
}

function promptEditorDraft(prompt: PromptDocument | null): PromptEditorDraft {
  return {
    title: prompt?.title ?? '',
    description: prompt?.description ?? '',
    content: prompt?.content ?? '',
    negative: prompt?.negative ?? '',
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
    source: 'manual',
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
