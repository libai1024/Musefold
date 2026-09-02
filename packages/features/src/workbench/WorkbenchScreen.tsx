'use client';

import {
  type DesignSchemeSummary,
  type GenerationJob,
  MAX_REFERENCE_IMAGE_BYTES,
  MAX_REFERENCE_IMAGES,
  type PromptReferenceSelection,
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
import { HistorySourcePicker } from '../design-schemes/HistorySourcePicker';
import { useDesignSchemesGateway } from '../design-schemes/hooks';
import {
  buildSchemeHistorySeed,
  resolveSchemeAttachment,
  type SchemeComposerAttachment,
  type SchemeComposerSubmission,
  type SchemeCreationContext,
  useSchemeIntegration,
} from '../design-schemes/integration-store';
import { SchemeRunPicker } from '../design-schemes/SchemeRunPicker';
import type { SchemeHistorySourceSelection } from '../design-schemes/types';
import {
  Composer,
  type ComposerReference,
  type ComposerValue,
  composerValueToDraft,
  draftToComposerValue,
  toComposerRatio,
} from './Composer';
import { GenerationTimeline, jobUserPromptText } from './GenerationTimeline';
import {
  addPromptReference,
  notifyPromptReferenceAddError,
  promptReferenceKey,
} from './prompt-references';
import { PromptReferenceDock } from './PromptReferencePanel';
import { WorkbenchEmptyState } from './WorkbenchEmptyState';
import {
  createGenerationMutationIntent,
  createRetryGenerationMutationIntent,
  hasActiveJob,
  useCancelGeneration,
  useCreateGeneration,
  useCreateSession,
  usePromptReferenceResolutions,
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
  promptReferenceSelections: [],
};

/**
 * 首发消息派生会话标题(「新设计」草稿态首次发送建会话,承参照应用语义):
 * 压缩空白后截前 24 字,超长加省略号;空白兜底回默认名。
 */
export function deriveSessionTitle(prompt: string): string {
  const collapsed = prompt.replace(/\s+/g, ' ').trim();
  if (!collapsed) return '未命名创作';
  return collapsed.length > 24 ? `${collapsed.slice(0, 24)}…` : collapsed;
}

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
  /**
   * 设计方案域集成(宿主注入;域恢复卡):
   * - onOpenDesignSchemes:切屏方案中心(「寻找设计方案」/附件「查看详情」,可携详情深链);
   * - onSubmit:方案运行/创建/修改提交缝,接宿主运行管线。缺省时挂载/创建照常,
   *   提交钮禁用并解释(I4),绝不回落普通生成伪造方案运行。
   * 整个 prop 缺省 = 宿主未接入该域,Composer 方案菜单项不出现(D2)。
   */
  designSchemes?: {
    onOpenDesignSchemes(detailId?: string): void;
    onSubmit?(submission: SchemeComposerSubmission): void;
  };
}

/**
 * 工作台屏幕(V25-UI-SPEC §3)—— 会话式生成,双宿主同一份。
 * 会话列表住壳侧栏(SessionListPanel);本屏 = 时间线 + Composer。
 * 移动端(壳无侧栏)屏顶提供会话选择器。
 * 草稿 800ms 防抖回写会话;有活动任务时时间线短轮询。
 */
export function WorkbenchScreen({
  onOpenSettings,
  onOpenPrompts,
  designSchemes,
}: WorkbenchScreenProps = {}) {
  const activeId = useActiveSession((s) => s.activeSessionId);
  const setActiveId = useActiveSession((s) => s.setActiveSessionId);
  const draftSession = useActiveSession((s) => s.draftSession);
  const startDraftSession = useActiveSession((s) => s.startDraftSession);
  const [composer, setComposer] = useState<ComposerValue>(EMPTY_COMPOSER);
  // 草稿参考图(ui-parity 03 §7 P0):内存态,不进会话草稿;previewUrl 为本地 objectURL。
  const [references, setReferences] = useState<ComposerReference[]>([]);
  // 参考素材面板(提示词引用):面板态在屏幕层,Composer 经「添加上下文」菜单请求打开。
  const [referencePanelOpen, setReferencePanelOpen] = useState(false);
  // 方案域 Composer 态(内存态,随会话切换清空;承旧 draftSource/schemeInputValues):
  // attachment = 挂载的方案(试运行/使用/修改);creation = design-plan 创建上下文。
  const [schemeAttachment, setSchemeAttachment] = useState<SchemeComposerAttachment | null>(null);
  const [schemeInputValues, setSchemeInputValues] = useState<Record<string, string>>({});
  const [schemeCreation, setSchemeCreation] = useState<SchemeCreationContext | null>(null);
  const [schemePickerOpen, setSchemePickerOpen] = useState(false);
  const [schemeHistoryOpen, setSchemeHistoryOpen] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  // 「添加上下文」触发钮:面板关闭后焦点归还(§8-I9)。
  const attachTriggerRef = useRef<HTMLButtonElement>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftWriteChain = useRef<Promise<void>>(Promise.resolve());
  const sessionVersions = useRef(new Map<string, number>());

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
  // 草稿引用意图 → 托盘展示解析(owner-safe prompts.get;不可用/已更新可见可移除)。
  const promptReferences = usePromptReferenceResolutions(composer.promptReferenceSelections);
  // 方案域适配器(能力关闭或宿主未注入时为 null,方案菜单整体不出现)。
  const schemeGateway = useDesignSchemesGateway();

  const sessionItems = sessions.data?.items ?? [];
  const activeSession = sessionItems.find((session) => session.id === activeId) ?? null;

  useEffect(() => {
    if (!activeSession) return;
    const knownVersion = sessionVersions.current.get(activeSession.id) ?? 0;
    if (activeSession.version > knownVersion) {
      sessionVersions.current.set(activeSession.id, activeSession.version);
    }
  }, [activeSession]);

  const queueDraftWrite = useCallback(
    (
      sessionId: string,
      fallbackVersion: number,
      draft: ReturnType<typeof composerValueToDraft>,
    ): Promise<void> => {
      const write = async () => {
        const updated = await updateSession.mutateAsync({
          id: sessionId,
          patch: {
            expectedVersion: sessionVersions.current.get(sessionId) ?? fallbackVersion,
            draft,
          },
        });
        sessionVersions.current.set(sessionId, updated.version);
      };
      const queued = draftWriteChain.current.catch(() => undefined).then(write);
      draftWriteChain.current = queued.catch(() => undefined);
      return queued;
    },
    [updateSession.mutateAsync],
  );

  const reportDraftWriteError = useCallback((error: unknown): void => {
    toast.error(error instanceof Error ? error.message : '草稿保存失败,请重试');
  }, []);

  const clearReferences = useCallback(() => {
    setReferences((prev) => {
      for (const reference of prev) revokePreviewUrl(reference.previewUrl);
      return [];
    });
  }, []);

  /** 方案态清空(附件 + 槽位值 + 创建上下文):随会话切换/草稿态/「送入制作」复位。 */
  const clearSchemeState = useCallback(() => {
    setSchemeAttachment(null);
    setSchemeInputValues({});
    setSchemeCreation(null);
  }, []);

  // 卸载时回收 objectURL。
  useEffect(() => clearReferences, [clearReferences]);

  // 首次加载定位到最近会话;当前会话被删/归档后回退到列表头。
  // 「新设计」草稿态例外:保持空白待发,不回落最近会话。
  useEffect(() => {
    if (draftSession) return;
    if (sessions.isSuccess && (activeId === null || !activeSession)) {
      setActiveId(sessionItems[0]?.id ?? null);
    }
  }, [draftSession, sessions.isSuccess, activeId, activeSession, sessionItems[0]?.id, setActiveId]);

  // 切会话时装载该会话草稿(仅切换瞬间,不跟随后台 refetch 覆盖输入)。
  const loadedDraftFor = useRef<string | null>(null);
  // 「送入制作」刚落进 Composer 时,紧随其后的会话草稿装载让位一次,不覆盖送来的稿。
  const pendingApplied = useRef(false);
  // 方案意图刚落进 Composer 时同理:会话草稿装载让位一次,不清刚到位的方案态。
  const schemeIntentApplied = useRef(false);
  useEffect(() => {
    if (activeSession && loadedDraftFor.current !== activeSession.id) {
      loadedDraftFor.current = activeSession.id;
      clearReferences();
      if (schemeIntentApplied.current) {
        schemeIntentApplied.current = false;
      } else {
        clearSchemeState();
      }
      if (pendingApplied.current) {
        pendingApplied.current = false;
        return;
      }
      setComposer(draftToComposerValue(activeSession.draft));
    }
  }, [activeSession, clearReferences, clearSchemeState]);

  // 进入草稿态:清 Composer 与参考图,呈全新空白(再次装载会话草稿由上方切换效果负责)。
  useEffect(() => {
    if (draftSession) {
      loadedDraftFor.current = null;
      clearReferences();
      clearSchemeState();
      setComposer(EMPTY_COMPOSER);
    }
  }, [draftSession, clearReferences, clearSchemeState]);

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
      void queueDraftWrite(activeSession.id, activeSession.version, pendingDraft).catch(
        reportDraftWriteError,
      );
    }
    clearSchemeState();
    setComposer(draftToComposerValue(pendingDraft));
    consumePendingDraft();
  }, [
    pendingDraft,
    activeSession,
    consumePendingDraft,
    queueDraftWrite,
    reportDraftWriteError,
    clearSchemeState,
  ]);

  // 方案域一次性意图(承旧 run-store.attach / draftCommand design-plan):
  // 方案中心「使用/试运行/修改/新建」、提示词库「创建方案」、历史来源确认写入集成 store,
  // 宿主回调完成切屏后在这里消费一次落 Composer——attach 挂附件,create 进创建态并播种子。
  const schemeIntent = useSchemeIntegration((s) => s.workbenchIntent);
  const consumeSchemeIntent = useSchemeIntegration((s) => s.consumeWorkbenchIntent);
  useEffect(() => {
    if (!schemeIntent) return;
    consumeSchemeIntent();
    schemeIntentApplied.current = true;
    if (schemeIntent.kind === 'attach') {
      setSchemeAttachment(schemeIntent.attachment);
      setSchemeInputValues({});
      setSchemeCreation(null);
      focusPromptEnd();
      return;
    }
    setSchemeAttachment(null);
    setSchemeInputValues({});
    setSchemeCreation({ createKind: schemeIntent.createKind, source: schemeIntent.source });
    if (schemeIntent.seed) {
      const next = { ...composer, prompt: schemeIntent.seed };
      setComposer(next);
      if (activeSession) {
        void queueDraftWrite(
          activeSession.id,
          activeSession.version,
          composerValueToDraft(next),
        ).catch(reportDraftWriteError);
      }
    }
    focusPromptEnd();
  }, [
    schemeIntent,
    consumeSchemeIntent,
    composer,
    activeSession,
    queueDraftWrite,
    reportDraftWriteError,
    focusPromptEnd,
  ]);

  // 草稿防抖回写(800ms);同屏写入按服务端返回版本串行,避免 autosave 与提交后清空互相冲突。
  function handleComposerChange(next: ComposerValue) {
    setComposer(next);
    if (!activeSession) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    const sessionId = activeSession.id;
    const version = activeSession.version;
    draftTimer.current = setTimeout(() => {
      void queueDraftWrite(sessionId, version, composerValueToDraft(next)).catch(
        reportDraftWriteError,
      );
    }, 800);
  }

  /** 「新设计」(移动端 +):进入空白草稿态,首次发送才真正建会话。 */
  function handleNewDesign() {
    startDraftSession();
  }

  /**
   * 参考素材面板「引用整条/选中内容」汇聚点:上限 6 条与重复不静默(明确 toast),
   * 合法意图进 Composer 值并随草稿防抖回写(draft 只存意图,展示另行解析)。
   */
  function handleAddPromptReference(intent: PromptReferenceSelection) {
    const result = addPromptReference(composer.promptReferenceSelections, intent);
    if (!result.ok) {
      notifyPromptReferenceAddError(result.reason);
      return;
    }
    handleComposerChange({ ...composer, promptReferenceSelections: result.next });
  }

  function handleRemovePromptReference(key: string) {
    handleComposerChange({
      ...composer,
      promptReferenceSelections: composer.promptReferenceSelections.filter(
        (selection) => promptReferenceKey(selection) !== key,
      ),
    });
  }

  /**
   * 用户消息「编辑」(03 §4):回填原始用户文本与请求参数(比例/质量),聚焦置尾。
   * 引用快照不可重建区间意图(快照无 range)——清空当前选择,重试才是精确快照动作。
   */
  function handleEditMessage(job: GenerationJob) {
    handleComposerChange({
      ...composer,
      prompt: jobUserPromptText(job),
      negative: job.request.negative ?? '',
      aspectRatio: toComposerRatio(job.request.aspectRatio),
      quality: job.request.quality,
      promptReferenceSelections: [],
    });
    focusPromptEnd();
  }

  /** 「生成设计方案」菜单项:进入 design-plan 创建态(承旧 draftCommand),聚焦待输入。 */
  function handleStartSchemeCreation() {
    setSchemeAttachment(null);
    setSchemeInputValues({});
    setSchemeCreation({ createKind: 'idea', source: null });
    focusPromptEnd();
  }

  /** 「从历史内容创建」确认:选择集进创建上下文(来源保留),提取说明播进正文。 */
  function handleSchemeHistoryConfirm(selection: SchemeHistorySourceSelection) {
    setSchemeHistoryOpen(false);
    setSchemeAttachment(null);
    setSchemeInputValues({});
    setSchemeCreation({ createKind: 'history', source: { kind: 'history', selection } });
    const seed = buildSchemeHistorySeed(selection);
    if (seed) handleComposerChange({ ...composer, prompt: seed });
    focusPromptEnd();
  }

  /** 方案选择器「使用」:解析附件(总是取最新 revision 文档)后挂载;失败就地报错不挂载。 */
  async function handlePickScheme(scheme: DesignSchemeSummary) {
    setSchemePickerOpen(false);
    if (!schemeGateway) return;
    try {
      const attachment = await resolveSchemeAttachment(schemeGateway, scheme, 'formal');
      setSchemeAttachment(attachment);
      setSchemeInputValues({});
      setSchemeCreation(null);
      focusPromptEnd();
    } catch (error) {
      toast.error('无法打开方案', {
        description: error instanceof Error ? error.message : '读取方案详情失败',
      });
    }
  }

  /** 方案提交后的 Composer 复位:清正文/引用槽位(运行已接管参考图),附件保留支持多轮(承旧)。 */
  function clearAfterSchemeSubmit(clearInputs: boolean) {
    if (clearInputs) setSchemeInputValues({});
    clearReferences();
    const cleared = {
      ...composer,
      prompt: '',
      negative: '',
      promptReferenceSelections: [],
    };
    setComposer(cleared);
    if (activeSession) {
      void queueDraftWrite(
        activeSession.id,
        activeSession.version,
        composerValueToDraft(cleared),
      ).catch(reportDraftWriteError);
    }
  }

  /**
   * 方案域提交路由(在任何普通生成分支之前):
   * 创建/运行/修改一律交给宿主运行管线接缝(designSchemes.onSubmit)——
   * 接缝缺失时 Composer 已禁用提交并解释,这里的 return 是双保险:
   * 绝不回落 createGeneration 伪造方案运行/创建。
   */
  function submitSchemeContext(userPrompt: string): boolean {
    const submitScheme = designSchemes?.onSubmit;
    if (schemeCreation) {
      if (!submitScheme || !userPrompt) return true;
      submitScheme({
        kind: 'create',
        createKind: schemeCreation.createKind,
        brief: userPrompt,
        source: schemeCreation.source,
      });
      setSchemeCreation(null);
      clearAfterSchemeSubmit(false);
      toast.success('已提交方案创建', { description: '草稿会由创建管线编译,稍后在方案中心查看。' });
      return true;
    }
    if (schemeAttachment) {
      if (!submitScheme) return true;
      if (schemeAttachment.mode === 'modify') {
        if (!userPrompt) return true;
        submitScheme({ kind: 'modify', attachment: schemeAttachment, brief: userPrompt });
        clearAfterSchemeSubmit(false);
        toast.success('已发送修改要求', { description: schemeAttachment.name });
        return true;
      }
      const inputValues = Object.fromEntries(
        Object.entries(schemeInputValues)
          .map(([slotId, value]) => [slotId, value.trim()] as const)
          .filter(([, value]) => value.length > 0),
      );
      const referenceImages = references
        .map((reference) => reference.image)
        .filter((image): image is NonNullable<typeof image> => image !== undefined);
      submitScheme({
        kind: 'run',
        attachment: schemeAttachment,
        brief: userPrompt,
        inputValues,
        referenceImages,
        promptReferenceSelections: composer.promptReferenceSelections,
        params: {
          ...(composer.aspectRatio !== 'auto' ? { aspectRatio: composer.aspectRatio } : {}),
          quality: composer.quality,
          ...(composer.negative.trim() ? { negative: composer.negative.trim() } : {}),
        },
        // 生图通道跟随活跃连接(与普通生成同口径)。
        providerId: providers.data?.[0]?.id,
      });
      clearAfterSchemeSubmit(true);
      toast.success(schemeAttachment.mode === 'trial' ? '已提交试运行' : '已提交按方案生成', {
        description: schemeAttachment.name,
      });
      return true;
    }
    return false;
  }

  async function handleSubmit() {
    const userPrompt = composer.prompt.trim();
    const promptReferenceSelections = composer.promptReferenceSelections;
    if (schemeAttachment || schemeCreation) {
      submitSchemeContext(userPrompt);
      return;
    }
    if (!userPrompt && promptReferenceSelections.length === 0) return;
    let sessionId = activeId;
    if (!sessionId) {
      // 草稿态首次发送才真正建会话:引用-only 不泄漏源内容,使用稳定中性标题。
      const created = await createSession.mutateAsync({
        title: userPrompt ? deriveSessionTitle(userPrompt) : '引用提示词创作',
        draft: composerValueToDraft(composer),
      });
      sessionId = created.id;
      sessionVersions.current.set(created.id, created.version);
      loadedDraftFor.current = created.id;
      setActiveId(created.id);
    }
    if (draftTimer.current) clearTimeout(draftTimer.current);
    const referenceImages = references
      .map((reference) => reference.image)
      .filter((image): image is NonNullable<typeof image> => image !== undefined);
    createGeneration.mutate(
      createGenerationMutationIntent({
        sessionId,
        prompt: userPrompt,
        promptReferenceSelections,
        negative: composer.negative.trim() || undefined,
        size: 'auto',
        aspectRatio: composer.aspectRatio === 'auto' ? undefined : composer.aspectRatio,
        quality: composer.quality,
        // 生图通道跟随活跃连接(目录活跃置首,左下角账号区切换)。
        providerId: providers.data?.[0]?.id,
        count: 1,
        ...(referenceImages.length > 0 ? { referenceImages } : {}),
      }),
      {
        onSuccess: () => {
          const cleared = {
            ...composer,
            prompt: '',
            negative: '',
            promptReferenceSelections: [],
          };
          setComposer(cleared);
          clearReferences();
          if (sessionId) {
            void queueDraftWrite(
              sessionId,
              activeSession?.version ?? 1,
              composerValueToDraft(cleared),
            ).catch(reportDraftWriteError);
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

  // 方案域 Composer 接缝:域适配器 + 宿主集成 prop 齐备才出现方案菜单项(D2);
  // 提交缝(onSubmit)缺失时挂载/创建照常,提交禁用并解释(I4),不伪造方案运行。
  const schemeSubmit = designSchemes?.onSubmit;
  const schemeProp =
    schemeGateway && designSchemes
      ? {
          attachment: schemeAttachment,
          creation: schemeCreation,
          inputValues: schemeInputValues,
          submitDisabledReason: schemeSubmit
            ? null
            : schemeAttachment
              ? '当前环境暂未接入方案运行'
              : schemeCreation
                ? '当前环境暂未接入方案创建'
                : null,
          onChangeInput: (slotId: string, value: string) =>
            setSchemeInputValues((prev) => ({ ...prev, [slotId]: value })),
          onClearAttachment: () => {
            setSchemeAttachment(null);
            setSchemeInputValues({});
          },
          onClearCreation: () => setSchemeCreation(null),
          onOpenPicker: () => setSchemePickerOpen(true),
          onStartCreation: schemeSubmit ? handleStartSchemeCreation : undefined,
          onOpenHistorySource: schemeSubmit ? () => setSchemeHistoryOpen(true) : undefined,
          onOpenDesignSchemes: designSchemes.onOpenDesignSchemes,
        }
      : undefined;

  const composerNode = (
    <Composer
      value={composer}
      submitting={createGeneration.isPending}
      variant={showEmptyState ? 'inline' : 'docked'}
      hasTurns={jobItems.length > 0}
      running={running}
      cancelling={cancelling}
      noProvider={providers.isSuccess && providers.data.length === 0}
      references={references}
      promptReferences={promptReferences}
      promptRef={promptRef}
      contextMenuTriggerRef={attachTriggerRef}
      onChange={handleComposerChange}
      onSubmit={handleSubmit}
      onCancel={handleCancelActive}
      onAddImages={handleAddImages}
      onRemoveReference={handleRemoveReference}
      onRemovePromptReference={handleRemovePromptReference}
      onOpenPromptReferences={() => setReferencePanelOpen(true)}
      onOpenSettings={onOpenSettings}
      scheme={schemeProp}
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
          onClick={handleNewDesign}
          data-testid="session-create-mobile"
        >
          <Plus className="size-4" />
        </Button>
      </div>

      {/* 主区 + 参考素材面板(桌面右栏 304px / 移动底部 Dialog,面板内部按断点分叉)。 */}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
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
                onRetry={(job) =>
                  retryGeneration.mutate(createRetryGenerationMutationIntent(job.id))
                }
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

        <PromptReferenceDock
          open={referencePanelOpen}
          selections={composer.promptReferenceSelections}
          onAdd={handleAddPromptReference}
          onOpenChange={setReferencePanelOpen}
          returnFocusRef={attachTriggerRef}
        />
      </div>

      {schemeGateway && designSchemes ? (
        <>
          <SchemeRunPicker
            open={schemePickerOpen}
            onOpenChange={setSchemePickerOpen}
            onPick={(scheme) => void handlePickScheme(scheme)}
          />
          <HistorySourcePicker
            open={schemeHistoryOpen}
            onCancel={() => setSchemeHistoryOpen(false)}
            onConfirm={handleSchemeHistoryConfirm}
          />
        </>
      ) : null}
    </div>
  );
}
