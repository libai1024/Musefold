'use client';

import type { PromptDocument, PromptListQuery } from '@musefold/contracts';
import { useCapabilities } from '@musefold/platform';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@musefold/ui/components/alert-dialog';
import { Badge } from '@musefold/ui/components/badge';
import { Button } from '@musefold/ui/components/button';
import { Input } from '@musefold/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@musefold/ui/components/select';
import { Skeleton } from '@musefold/ui/components/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@musefold/ui/components/tabs';
import { Library, Plus, Search } from '@musefold/ui/icons';
import { cn } from '@musefold/ui/lib/utils';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  buildSchemeCreateSeedFromPrompt,
  useSchemeIntegration,
} from '../design-schemes/integration-store';
import { useScreenIntent } from '../shell/screen-intent-store';
import { PromptEditorDialog, editorValueToNewDocument } from './PromptEditorDialog';
import { PromptListRow } from './PromptListRow';
import { TaxonomyManager } from './TaxonomyManager';
import { toast } from '@musefold/ui/components/sonner';
import { useActiveSession } from '../workbench/session-store';
import {
  copyPromptContent,
  promptToWorkbenchDraft,
  useCreatePrompt,
  usePromptFolders,
  usePromptList,
  usePromptTags,
  usePurgePrompt,
  useRemovePrompt,
  useRestorePrompt,
  useUpdatePrompt,
  useUsePrompt,
} from './hooks';

type LibraryTab = 'library' | 'trash';
type LibrarySort = NonNullable<PromptListQuery['sort']>;

const ALL_FOLDERS = '__all__';
const UNFILED = '__unfiled__';

const SORT_LABELS: Record<LibrarySort, string> = {
  'updated-desc': '最近更新',
  'created-desc': '最近创建',
  'usage-desc': '最常使用',
  'title-asc': '标题 A→Z',
};

interface RowSection {
  key: string;
  title: string | null;
  items: PromptDocument[];
}

export interface PromptLibraryScreenProps {
  /** 「使用」送稿后的切屏回调(宿主注入:切工作台视图/路由)。 */
  onOpenWorkbench?(): void;
}

/**
 * 提示词库屏幕 —— v2.5 第一个数据域,双宿主同一份。
 * 信息架构承自 v2.0:页头计数、搜索工具条、「置顶/全部」分节列表、
 * 回收站独立视图;数据经 MusefoldGateway,组件全部走语义 token。
 */
export function PromptLibraryScreen({ onOpenWorkbench }: PromptLibraryScreenProps = {}) {
  const [tab, setTab] = useState<LibraryTab>('library');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<LibrarySort>('updated-desc');
  const [folderFilter, setFolderFilter] = useState<string>(ALL_FOLDERS);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<PromptDocument | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<PromptDocument | null>(null);

  // 「存为提示词 → 查看」落点(03/05 §7):高亮新条目 2s 渐隐,一次性。
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const consumeIntent = useScreenIntent((s) => s.consume);
  useEffect(() => {
    if (consumeIntent('prompts-trash')) setTab('trash');
    const highlight = consumeIntent('prompt-highlight');
    if (highlight) setHighlightId(highlight.promptId);
  }, [consumeIntent]);

  const deferredSearch = useDeferredValue(search);

  const query = useMemo<Omit<PromptListQuery, 'cursor'>>(
    () => ({
      q: deferredSearch.trim() || undefined,
      sort,
      limit: 30,
      folderId:
        folderFilter === ALL_FOLDERS ? undefined : folderFilter === UNFILED ? null : folderFilter,
      tagIds: tagFilter.length > 0 ? tagFilter : undefined,
      includeDeleted: tab === 'trash' ? true : undefined,
    }),
    [deferredSearch, sort, folderFilter, tagFilter, tab],
  );

  const list = usePromptList(query);
  const folders = usePromptFolders();
  const tags = usePromptTags();
  const createPrompt = useCreatePrompt();
  const updatePrompt = useUpdatePrompt();
  const removePrompt = useRemovePrompt();
  const restorePrompt = useRestorePrompt();
  const purgePrompt = usePurgePrompt();
  const usePromptAction = useUsePrompt();

  const sections = useMemo<RowSection[]>(() => {
    const rows = list.data?.pages.flatMap((page) => page.items) ?? [];
    if (tab === 'trash') {
      // includeDeleted 语义是「包含」;回收站视图只看已删。
      return [{ key: 'trash', title: null, items: rows.filter((row) => row.deletedAt != null) }];
    }
    const pinned = rows.filter((row) => row.isPinned);
    const rest = rows.filter((row) => !row.isPinned);
    if (pinned.length === 0) return [{ key: 'all', title: null, items: rest }];
    return [
      { key: 'pinned', title: '置顶', items: pinned },
      { key: 'all', title: '全部', items: rest },
    ];
  }, [list.data, tab]);

  const totalCount = sections.reduce((sum, section) => sum + section.items.length, 0);

  function openCreate() {
    setEditing(null);
    setEditorOpen(true);
  }

  function openEdit(prompt: PromptDocument) {
    setEditing(prompt);
    setEditorOpen(true);
  }

  async function handleCopy(prompt: PromptDocument) {
    await copyPromptContent(prompt);
    usePromptAction.mutate({ id: prompt.id, input: { action: 'copy' } });
  }

  const setPendingDraft = useActiveSession((s) => s.setPendingDraft);

  /** 「使用」:送工作台草稿 + 使用计数 + 切屏(承旧「已送入制作」闭环)。 */
  function handleUse(prompt: PromptDocument) {
    setPendingDraft(promptToWorkbenchDraft(prompt));
    usePromptAction.mutate({ id: prompt.id, input: { action: 'apply' } });
    toast.success('已送入制作', { description: prompt.title });
    onOpenWorkbench?.();
  }

  // 「创建方案」(承 v2.1 详情页菜单):方案域能力 + 宿主切屏回调齐备才出现行钮。
  const capabilities = useCapabilities();
  const canCreateScheme = capabilities.hasDesignSchemes && Boolean(onOpenWorkbench);

  /**
   * 提示词 → 方案创建意图:种子文案逐字承旧(整理固定规则/必需变量/本次补充),
   * 来源上下文(promptId/标题)随意图保留;工作台消费后进 design-plan 创建态,
   * 真正的编译由宿主创建管线承接,此处不伪造。
   */
  function handleCreateScheme(prompt: PromptDocument) {
    useSchemeIntegration.getState().setWorkbenchIntent({
      kind: 'create',
      createKind: 'prompt',
      seed: buildSchemeCreateSeedFromPrompt(prompt),
      source: { kind: 'prompt', promptId: prompt.id, title: prompt.title },
    });
    toast.success('已送入工作台', { description: '补充方案想法后提交,由创建管线编译草稿。' });
    onOpenWorkbench?.();
  }

  function handleTogglePin(prompt: PromptDocument) {
    updatePrompt.mutate({
      id: prompt.id,
      patch: { isPinned: !prompt.isPinned, expectedVersion: prompt.version },
    });
  }

  return (
    <div
      className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 md:p-6"
      data-testid="prompt-library"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h1 className="font-semibold text-foreground text-xl">提示词库</h1>
          {list.isSuccess && (
            <span className="text-muted-foreground text-sm" data-testid="prompt-count">
              {totalCount} 条
            </span>
          )}
        </div>
        <Button onClick={openCreate} data-testid="prompt-create">
          <Plus className="size-4" /> 新建提示词
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={tab} onValueChange={(next) => setTab(next as LibraryTab)}>
          <TabsList>
            <TabsTrigger value="library" data-testid="prompt-tab-all">
              库
            </TabsTrigger>
            <TabsTrigger value="trash" data-testid="prompt-tab-trash">
              回收站
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="relative min-w-40 flex-1">
          <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" aria-hidden />
          <Input
            value={search}
            data-testid="prompt-search"
            placeholder="搜索标题、正文或标签"
            className="pl-8"
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <Select value={sort} onValueChange={(next) => setSort(next as LibrarySort)}>
          <SelectTrigger className="w-32" data-testid="prompt-sort">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(SORT_LABELS) as LibrarySort[]).map((key) => (
              <SelectItem key={key} value={key}>
                {SORT_LABELS[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={folderFilter} onValueChange={setFolderFilter}>
          <SelectTrigger className="w-36" data-testid="prompt-folder-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_FOLDERS}>全部文件夹</SelectItem>
            <SelectItem value={UNFILED}>未整理</SelectItem>
            {(folders.data ?? []).map((folder) => (
              <SelectItem key={folder.id} value={folder.id}>
                {folder.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <TaxonomyManager folders={folders.data ?? []} tags={tags.data ?? []} />
      </div>

      {(tags.data?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-1.5" data-testid="prompt-tag-filter">
          {(tags.data ?? []).map((tag) => {
            const selected = tagFilter.includes(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() =>
                  setTagFilter((prev) =>
                    selected ? prev.filter((id) => id !== tag.id) : [...prev, tag.id],
                  )
                }
              >
                <Badge
                  variant={selected ? 'default' : 'outline'}
                  className={cn('cursor-pointer', !selected && 'text-muted-foreground')}
                >
                  {tag.name}
                </Badge>
              </button>
            );
          })}
        </div>
      )}

      {list.isPending ? (
        <div className="flex flex-col gap-2" data-testid="prompt-loading">
          {[0, 1, 2, 3, 4].map((index) => (
            <Skeleton key={index} className="h-16 rounded-lg" />
          ))}
        </div>
      ) : list.isError ? (
        <p className="py-12 text-center text-destructive text-sm" data-testid="prompt-error">
          提示词加载失败,请重试
        </p>
      ) : totalCount === 0 ? (
        <div
          className="flex flex-col items-center gap-2 py-16 text-muted-foreground"
          data-testid="prompt-empty"
        >
          <Library className="size-8" aria-hidden />
          <p className="text-sm">
            {tab === 'trash'
              ? '回收站是空的'
              : search
                ? '没有匹配的提示词'
                : '还没有提示词,点击「新建提示词」开始'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4" data-testid="prompt-grid" role="list">
          {sections.map((section) =>
            section.items.length > 0 ? (
              <section key={section.key} className="flex flex-col gap-1">
                {section.title && (
                  <h2 className="px-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">
                    {section.title}
                    <span className="ml-1.5 opacity-70">{section.items.length}</span>
                  </h2>
                )}
                {section.items.map((prompt) => (
                  <PromptListRow
                    key={prompt.id}
                    prompt={prompt}
                    highlighted={prompt.id === highlightId}
                    onUse={handleUse}
                    onEdit={openEdit}
                    onCopy={handleCopy}
                    onTogglePin={handleTogglePin}
                    onRemove={(target) => removePrompt.mutate(target.id)}
                    onRestore={(target) => restorePrompt.mutate(target.id)}
                    onPurge={setPurgeTarget}
                    onCreateScheme={canCreateScheme ? handleCreateScheme : undefined}
                  />
                ))}
              </section>
            ) : null,
          )}
          {list.hasNextPage && (
            <Button
              variant="outline"
              className="mx-auto"
              disabled={list.isFetchingNextPage}
              onClick={() => list.fetchNextPage()}
              data-testid="prompt-load-more"
            >
              {list.isFetchingNextPage ? '加载中…' : '加载更多'}
            </Button>
          )}
        </div>
      )}

      <AlertDialog
        open={purgeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setPurgeTarget(null);
        }}
      >
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>永久删除提示词?</AlertDialogTitle>
            <AlertDialogDescription>
              「{purgeTarget?.title}」将被彻底删除,无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              data-testid="prompt-purge-confirm"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (purgeTarget) purgePrompt.mutate(purgeTarget.id);
                setPurgeTarget(null);
              }}
            >
              永久删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PromptEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        prompt={editing}
        folders={folders.data ?? []}
        tags={tags.data ?? []}
        submitting={createPrompt.isPending || updatePrompt.isPending}
        onSubmit={(value) => {
          if (editing) {
            updatePrompt.mutate(
              {
                id: editing.id,
                patch: {
                  title: value.title.trim(),
                  description: value.description.trim() ? value.description.trim() : null,
                  content: value.content.trim(),
                  negative: value.negative.trim() ? value.negative.trim() : null,
                  folderId: value.folderId,
                  tagIds: value.tagIds,
                  rating: value.rating,
                  isPinned: value.isPinned,
                  expectedVersion: editing.version,
                },
              },
              { onSuccess: () => setEditorOpen(false) },
            );
          } else {
            createPrompt.mutate(editorValueToNewDocument(value), {
              onSuccess: () => setEditorOpen(false),
            });
          }
        }}
      />
    </div>
  );
}
