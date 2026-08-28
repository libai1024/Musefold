'use client';

import { Button } from '@musefold/ui/components/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@musefold/ui/components/select';
import { Skeleton } from '@musefold/ui/components/skeleton';
import { Plus } from '@musefold/ui/icons';
import { useEffect, useRef, useState } from 'react';
import {
  Composer,
  type ComposerValue,
  composerValueToDraft,
  draftToComposerValue,
} from './Composer';
import { GenerationTimeline } from './GenerationTimeline';
import {
  useCancelGeneration,
  useCreateGeneration,
  useCreateSession,
  useProviders,
  useRetryGeneration,
  useSessionJobs,
  useSessionList,
  useUpdateSession,
} from './hooks';
import { useActiveSession } from './session-store';

const EMPTY_COMPOSER: ComposerValue = {
  prompt: '',
  negative: '',
  aspectRatio: 'auto',
  quality: 'auto',
  providerId: null,
};

/**
 * 工作台屏幕(V25-UI-SPEC §3)—— 会话式生成,双宿主同一份。
 * 会话列表住壳侧栏(SessionListPanel);本屏 = 时间线 + Composer。
 * 移动端(壳无侧栏)屏顶提供会话选择器。
 * 草稿 800ms 防抖回写会话;有活动任务时时间线短轮询。
 */
export function WorkbenchScreen() {
  const activeId = useActiveSession((s) => s.activeSessionId);
  const setActiveId = useActiveSession((s) => s.setActiveSessionId);
  const [composer, setComposer] = useState<ComposerValue>(EMPTY_COMPOSER);

  const sessions = useSessionList({ limit: 50 });
  const providers = useProviders();
  const createSession = useCreateSession();
  const updateSession = useUpdateSession();
  const jobs = useSessionJobs(activeId);
  const createGeneration = useCreateGeneration();
  const cancelGeneration = useCancelGeneration();
  const retryGeneration = useRetryGeneration();

  const sessionItems = sessions.data?.items ?? [];
  const activeSession = sessionItems.find((session) => session.id === activeId) ?? null;

  // 首次加载定位到最近会话;当前会话被删/归档后回退到列表头。
  useEffect(() => {
    if (sessions.isSuccess && (activeId === null || !activeSession)) {
      setActiveId(sessionItems[0]?.id ?? null);
    }
  }, [sessions.isSuccess, activeId, activeSession, sessionItems[0]?.id, setActiveId]);

  // 切会话时装载该会话草稿(仅切换瞬间,不跟随后台 refetch 覆盖输入)。
  const loadedDraftFor = useRef<string | null>(null);
  useEffect(() => {
    if (activeSession && loadedDraftFor.current !== activeSession.id) {
      loadedDraftFor.current = activeSession.id;
      setComposer((prev) => ({
        ...draftToComposerValue(activeSession.draft),
        providerId: prev.providerId,
      }));
    }
  }, [activeSession]);

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
      },
      {
        onSuccess: () => {
          setComposer((prev) => ({ ...prev, prompt: '', negative: '' }));
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
        <div className="flex flex-1 flex-col gap-4 p-4">
          <Skeleton className="ml-auto h-12 w-2/3 rounded-2xl" />
          <Skeleton className="h-40 w-2/3 rounded-lg" />
        </div>
      ) : (
        <GenerationTimeline
          jobs={jobs.data ?? []}
          onCancel={(job) => cancelGeneration.mutate(job.id)}
          onRetry={(job) => retryGeneration.mutate(job.id)}
        />
      )}

      <Composer
        value={composer}
        providers={providers.data ?? []}
        submitting={createGeneration.isPending}
        onChange={handleComposerChange}
        onSubmit={handleSubmit}
      />
      {createGeneration.isError && (
        <p className="px-4 pb-2 text-destructive text-xs" data-testid="generation-error">
          {createGeneration.error instanceof Error
            ? createGeneration.error.message
            : '生成提交失败'}
        </p>
      )}
    </div>
  );
}
