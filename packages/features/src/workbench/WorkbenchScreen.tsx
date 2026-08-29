'use client';

import {
  type GenerationJob,
  MAX_REFERENCE_IMAGE_BYTES,
  MAX_REFERENCE_IMAGES,
} from '@musefold/contracts';
import { Button } from '@musefold/ui/components/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@musefold/ui/components/select';
import { Skeleton } from '@musefold/ui/components/skeleton';
import { toast } from '@musefold/ui/components/sonner';
import { Plus } from '@musefold/ui/icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Composer,
  type ComposerReference,
  type ComposerValue,
  composerValueToDraft,
  draftToComposerValue,
  toComposerRatio,
} from './Composer';
import { GenerationTimeline } from './GenerationTimeline';
import { WorkbenchEmptyState } from './WorkbenchEmptyState';
import {
  hasActiveJob,
  useCancelGeneration,
  useCreateGeneration,
  useCreateSession,
  useProviders,
  useRemoveGeneration,
  useRetryGeneration,
  useSessionJobs,
  useSessionList,
  useUpdateSession,
  useUploadReferenceImage,
} from './hooks';
import { useActiveSession } from './session-store';

const EMPTY_COMPOSER: ComposerValue = {
  prompt: '',
  negative: '',
  aspectRatio: 'auto',
  quality: 'auto',
  providerId: null,
};

/** objectURL 即时预览;测试环境(jsdom)未实现时退化为空串,由上传完成后的契约 url 兜底。 */
function createPreviewUrl(file: File): string {
  return typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : '';
}

/** 读文件字节;jsdom 无 Blob.arrayBuffer,退回 FileReader(浏览器/Electron 两条路都通)。 */
async function readFileBytes(file: File): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof file.arrayBuffer === 'function') return new Uint8Array(await file.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'));
    reader.readAsArrayBuffer(file);
  });
}

function revokePreviewUrl(url: string): void {
  if (url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
}

export interface WorkbenchScreenProps {
  /** Composer 无连接引导「前往设置」的切屏回调(宿主注入)。 */
  onOpenSettings?(): void;
  /** 「存为提示词」成功 toast「查看」跳库的切屏回调(宿主注入)。 */
  onOpenPrompts?(): void;
}

/**
 * 工作台屏幕(V25-UI-SPEC §3)—— 会话式生成,双宿主同一份。
 * 会话列表住壳侧栏(SessionListPanel);本屏 = 时间线 + Composer。
 * 移动端(壳无侧栏)屏顶提供会话选择器。
 * 草稿 800ms 防抖回写会话;有活动任务时时间线短轮询。
 */
export function WorkbenchScreen({ onOpenSettings, onOpenPrompts }: WorkbenchScreenProps = {}) {
  const activeId = useActiveSession((s) => s.activeSessionId);
  const setActiveId = useActiveSession((s) => s.setActiveSessionId);
  const [composer, setComposer] = useState<ComposerValue>(EMPTY_COMPOSER);
  // 草稿参考图(ui-parity 03 §7 P0):内存态,不进会话草稿;previewUrl 为本地 objectURL。
  const [references, setReferences] = useState<ComposerReference[]>([]);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  /** 回填路径统一聚焦置尾(03 §6):rAF 等 commit 落地后聚焦,光标置于文本末尾。 */
  const focusPromptEnd = useCallback(() => {
    requestAnimationFrame(() => {
      const textarea = promptRef.current;
      if (!textarea) return;
      textarea.focus();
      const end = textarea.value.length;
      textarea.setSelectionRange(end, end);
    });
  }, []);

  const sessions = useSessionList({ limit: 50 });
  const providers = useProviders();
  const createSession = useCreateSession();
  const updateSession = useUpdateSession();
  const jobs = useSessionJobs(activeId);
  const createGeneration = useCreateGeneration();
  const cancelGeneration = useCancelGeneration();
  const retryGeneration = useRetryGeneration();
  const removeGeneration = useRemoveGeneration();
  const uploadReference = useUploadReferenceImage();

  const sessionItems = sessions.data?.items ?? [];
  const activeSession = sessionItems.find((session) => session.id === activeId) ?? null;

  const clearReferences = useCallback(() => {
    setReferences((prev) => {
      for (const reference of prev) revokePreviewUrl(reference.previewUrl);
      return [];
    });
  }, []);

  // 卸载时回收 objectURL。
  useEffect(() => clearReferences, [clearReferences]);

  // 首次加载定位到最近会话;当前会话被删/归档后回退到列表头。
  useEffect(() => {
    if (sessions.isSuccess && (activeId === null || !activeSession)) {
      setActiveId(sessionItems[0]?.id ?? null);
    }
  }, [sessions.isSuccess, activeId, activeSession, sessionItems[0]?.id, setActiveId]);

  // 切会话时装载该会话草稿(仅切换瞬间,不跟随后台 refetch 覆盖输入)。
  const loadedDraftFor = useRef<string | null>(null);
  // 「送入制作」刚落进 Composer 时,紧随其后的会话草稿装载让位一次,不覆盖送来的稿。
  const pendingApplied = useRef(false);
  useEffect(() => {
    if (activeSession && loadedDraftFor.current !== activeSession.id) {
      loadedDraftFor.current = activeSession.id;
      clearReferences();
      if (pendingApplied.current) {
        pendingApplied.current = false;
        return;
      }
      setComposer((prev) => ({
        ...draftToComposerValue(activeSession.draft),
        providerId: prev.providerId,
      }));
    }
  }, [activeSession, clearReferences]);

  async function uploadReferenceFile(file: File, entry: ComposerReference) {
    try {
      const bytes = await readFileBytes(file);
      const image = await uploadReference.mutateAsync({ name: entry.name, bytes });
      setReferences((prev) =>
        prev.map((item) => (item.key === entry.key ? { ...item, status: 'ready', image } : item)),
      );
    } catch (error) {
      revokePreviewUrl(entry.previewUrl);
      setReferences((prev) => prev.filter((item) => item.key !== entry.key));
      toast.error(error instanceof Error ? error.message : '参考图上传失败');
    }
  }

  function handleAddImages(files: File[]) {
    const room = MAX_REFERENCE_IMAGES - references.length;
    if (room <= 0) {
      toast.error(`参考图最多 ${MAX_REFERENCE_IMAGES} 张`);
      return;
    }
    if (files.length > room) {
      toast.error(`参考图最多 ${MAX_REFERENCE_IMAGES} 张,超出部分已忽略`);
    }
    const accepted: Array<{ file: File; entry: ComposerReference }> = [];
    for (const file of files.slice(0, room)) {
      if (file.size > MAX_REFERENCE_IMAGE_BYTES) {
        toast.error(`「${file.name}」超过 20 MiB,已跳过`);
        continue;
      }
      accepted.push({
        file,
        entry: {
          key: crypto.randomUUID(),
          status: 'uploading',
          name: file.name || '粘贴图片.png',
          previewUrl: createPreviewUrl(file),
        },
      });
    }
    if (accepted.length === 0) return;
    setReferences((prev) => [...prev, ...accepted.map((item) => item.entry)]);
    for (const { file, entry } of accepted) void uploadReferenceFile(file, entry);
  }

  function handleRemoveReference(key: string) {
    setReferences((prev) => {
      const target = prev.find((item) => item.key === key);
      if (target) revokePreviewUrl(target.previewUrl);
      return prev.filter((item) => item.key !== key);
    });
  }

  // 库「使用」送稿(ui-parity 04 P0):消费一次即清;有活动会话则立即回写其草稿。
  const pendingDraft = useActiveSession((s) => s.pendingDraft);
  const consumePendingDraft = useActiveSession((s) => s.consumePendingDraft);
  useEffect(() => {
    if (!pendingDraft) return;
    const claimed = activeSession != null && loadedDraftFor.current === activeSession.id;
    if (!claimed) pendingApplied.current = true;
    if (activeSession) {
      loadedDraftFor.current = activeSession.id;
      updateSession.mutate({
        id: activeSession.id,
        patch: { expectedVersion: activeSession.version, draft: pendingDraft },
      });
    }
    setComposer((prev) => ({
      ...draftToComposerValue(pendingDraft),
      providerId: prev.providerId,
    }));
    consumePendingDraft();
  }, [pendingDraft, activeSession, consumePendingDraft, updateSession.mutate]);

  // 草稿防抖回写(800ms);卸载/切换前最后一次输入靠下次装载兜底,不阻塞交互。
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function handleComposerChange(next: ComposerValue) {
    setComposer(next);
    if (!activeSession) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    const sessionId = activeSession.id;
    const version = activeSession.version;
    draftTimer.current = setTimeout(() => {
      updateSession.mutate({
        id: sessionId,
        patch: { expectedVersion: version, draft: composerValueToDraft(next) },
      });
    }, 800);
  }

  async function handleCreateSession() {
    const created = await createSession.mutateAsync({});
    loadedDraftFor.current = null;
    setActiveId(created.id);
  }

  /** 用户消息「编辑」(03 §4):整份请求参数回填 Composer(含比例/质量),聚焦置尾。 */
  function handleEditMessage(job: GenerationJob) {
    handleComposerChange({
      ...composer,
      prompt: job.request.prompt,
      negative: job.request.negative ?? '',
      aspectRatio: toComposerRatio(job.request.aspectRatio),
      quality: job.request.quality,
    });
    focusPromptEnd();
  }

  async function handleSubmit() {
    if (!composer.prompt.trim()) return;
    let sessionId = activeId;
    if (!sessionId) {
      const created = await createSession.mutateAsync({});
      sessionId = created.id;
      loadedDraftFor.current = created.id;
      setActiveId(created.id);
    }
    if (draftTimer.current) clearTimeout(draftTimer.current);
    const referenceImages = references
      .map((reference) => reference.image)
      .filter((image): image is NonNullable<typeof image> => image !== undefined);
    createGeneration.mutate(
      {
        sessionId,
        prompt: composer.prompt.trim(),
        negative: composer.negative.trim() || undefined,
        size: 'auto',
        aspectRatio: composer.aspectRatio === 'auto' ? undefined : composer.aspectRatio,
        quality: composer.quality,
        providerId: composer.providerId ?? undefined,
        count: 1,
        ...(referenceImages.length > 0 ? { referenceImages } : {}),
      },
      {
        onSuccess: () => {
          setComposer((prev) => ({ ...prev, prompt: '', negative: '' }));
          clearReferences();
          if (sessionId) {
            updateSession.mutate({
              id: sessionId,
              patch: {
                expectedVersion: activeSession?.version ?? 1,
                draft: composerValueToDraft({ ...composer, prompt: '', negative: '' }),
              },
            });
          }
        },
      },
    );
  }

  const jobItems = jobs.data ?? [];
  const running = hasActiveJob(jobItems);
  const cancelling =
    cancelGeneration.isPending || jobItems.some((job) => job.status === 'cancelling');
  // 空态 = 没有会话,或当前会话还没有任何回合(V25-UI-SPEC §3.1:品牌锁定区 + 内联 Composer 居中)。
  const showEmptyState = activeId === null || (jobs.isSuccess && jobItems.length === 0);

  function handleCancelActive() {
    const target = [...jobItems]
      .reverse()
      .find((job) => job.status === 'queued' || job.status === 'running');
    if (target) cancelGeneration.mutate(target.id);
  }

  const composerNode = (
    <Composer
      value={composer}
      providers={providers.data ?? []}
      submitting={createGeneration.isPending}
      variant={showEmptyState ? 'inline' : 'docked'}
      hasTurns={jobItems.length > 0}
      running={running}
      cancelling={cancelling}
      noProvider={providers.isSuccess && providers.data.length === 0}
      references={references}
      promptRef={promptRef}
      onChange={handleComposerChange}
      onSubmit={handleSubmit}
      onCancel={handleCancelActive}
      onAddImages={handleAddImages}
      onRemoveReference={handleRemoveReference}
      onOpenSettings={onOpenSettings}
    />
  );

  const errorNode = createGeneration.isError ? (
    <p
      className="pointer-events-auto mx-auto my-2 w-full max-w-[728px] px-1.5 text-destructive text-xs"
      data-testid="generation-error"
    >
      {createGeneration.error instanceof Error ? createGeneration.error.message : '生成提交失败'}
    </p>
  ) : null;

  /**
   * 悬浮 Composer 轨道(承旧 floating 布局):绝对贴底、轨道透明不截获事件,
   * 卡片自身可交互;时间线在下方以底部留白让内容滚过卡片背后。
   */
  const composerDock = (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-3 pb-3 md:px-4 md:pb-3.5">
      {errorNode}
      {composerNode}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="workbench">
      {/* 移动端(壳无侧栏)会话选择器,V25-UI-SPEC §3.4 */}
      <div className="flex items-center gap-2 border-border border-b px-3 py-2 md:hidden">
        <Select value={activeId ?? ''} onValueChange={(id) => setActiveId(id)}>
          <SelectTrigger className="h-8 flex-1" data-testid="session-picker">
            <SelectValue placeholder="选择创作会话" />
          </SelectTrigger>
          <SelectContent>
            {sessionItems.map((session) => (
              <SelectItem key={session.id} value={session.id}>
                {session.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="icon"
          className="size-8 shrink-0"
          aria-label="新建创作"
          disabled={createSession.isPending}
          onClick={() => void handleCreateSession()}
          data-testid="session-create-mobile"
        >
          <Plus className="size-4" />
        </Button>
      </div>

      {jobs.isPending && activeId ? (
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div className="mx-auto flex w-full max-w-[728px] flex-1 flex-col gap-4 overflow-hidden p-4">
            <Skeleton className="ml-auto h-12 w-2/3 rounded-2xl" />
            <Skeleton className="h-40 w-2/3 rounded-lg" />
          </div>
          {composerDock}
        </div>
      ) : showEmptyState ? (
        <WorkbenchEmptyState
          composer={
            <>
              {composerNode}
              {errorNode}
            </>
          }
          onSelectSuggestion={(suggestion) => {
            handleComposerChange({ ...composer, prompt: suggestion });
            focusPromptEnd();
          }}
        />
      ) : (
        <div className="relative flex min-h-0 flex-1 flex-col">
          <GenerationTimeline
            jobs={jobItems}
            editDisabled={running}
            onCancel={(job) => cancelGeneration.mutate(job.id)}
            onRetry={(job) => retryGeneration.mutate(job.id)}
            onRemove={(job) => removeGeneration.mutate(job.id)}
            onEditMessage={handleEditMessage}
            onOpenPrompts={onOpenPrompts}
          />
          {/* 悬浮卡上缘渐隐(03-C1):内容滚过卡片背后时以渐变收边,替代生硬截断。 */}
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-24 bg-linear-to-t from-background to-transparent"
            aria-hidden
          />
          {composerDock}
        </div>
      )}
    </div>
  );
}
