'use client';

import { useRetryAction } from './use-retry-action';
import { useSessionDraftWriter } from './use-session-draft-writer';
import { SessionDraftConflictDialog } from './SessionDraftConflictDialog';
import { AccountModelSelector } from './AccountModelSelector';
import { useAccountModelChoice } from './use-account-model-choice';

import {
  type CreationState,
  type DesignSchemeSummary,
  type GenerationCount,
  type GenerationJob,
  MAX_REFERENCE_IMAGE_BYTES,
  MAX_REFERENCE_IMAGES,
  type PromptReferenceSelection,
  type SourceConfirmation,
  type WorkbenchSession,
} from '@musefold/contracts';
import {
  type PlatformCapabilities,
  queryKeys,
  useCapabilities,
  useGateway,
} from '@musefold/platform';
import { createReferenceUploadLifetime } from './reference-upload-lifetime';
import { Button } from '@musefold/ui/components/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@musefold/ui/components/select';
import { Skeleton } from '@musefold/ui/components/skeleton';
import { Spinner } from '@musefold/ui/components/spinner';
import { toast } from '@musefold/ui/components/sonner';
import { Plus } from '@musefold/ui/icons';
import { useQueryClient } from '@tanstack/react-query';
import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import { HistorySourcePicker } from '../design-schemes/HistorySourcePicker';
import { useDesignSchemesGateway } from '../design-schemes/hooks';
import {
  buildSchemeHistorySeed,
  resolveSchemeAttachment,
  type SchemeComposerAttachment,
  type SchemeComposerHandlers,
  type SchemeCreationContext,
  schemeSubmitDisabledReason,
  useSchemeIntegration,
} from '../design-schemes/integration-store';
import { SourceInstallConfirmDialog } from '../design-schemes/SchemeDialogs';
import { SchemeRunPicker } from '../design-schemes/SchemeRunPicker';
import { useCloudSchemeCreate } from '../design-schemes/use-cloud-scheme-create';
import type { SchemeHistorySourceSelection } from '../design-schemes/types';
import {
  Composer,
  type ComposerReference,
  type ComposerValue,
  composerValueToDraft,
  draftToComposerValue,
  toComposerRatio,
} from './Composer';
import { useAccountStatus } from '../account/hooks';
import { useScreenIntent } from '../shell/screen-intent-store';
import {
  accountEpoch,
  isAccountRestricted,
  subscribeAccountEpoch,
  assertAccountEpoch,
} from '../account/account-session';
import { KeyGuidanceAction } from '../history/KeyGuidanceAction';
import {
  HISTORY_ERROR_GUIDANCE,
  normalizeHistoryErrorCode,
  thrownErrorPresentation,
} from '../history/error';
import { rememberQuotaRecovery } from '../history/spend-recovery-store';
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
  hasActiveJob,
  useCancelGeneration,
  useCreateGeneration,
  useCreateSession,
  useMissingSession,
  usePromptReferenceResolutions,
  useProviders,
  useRemoveGeneration,
  useSessionJobs,
  useSessionList,
  useUploadReferenceImage,
} from './hooks';
import { usePreferences } from '../settings/hooks';
import {
  type DraftParamOverrides,
  type GenerationParamDefaults,
  resolveInheritedGenerationParams,
  useActiveSession,
} from './session-store';
import { useVisualViewportInset } from './use-visual-viewport-inset';

const EMPTY_COMPOSER: ComposerValue = {
  prompt: '',
  negative: '',
  aspectRatio: 'auto',
  quality: 'auto',
  count: 1,
  promptReferenceSelections: [],
};

const FALLBACK_GENERATION_DEFAULTS: GenerationParamDefaults = {
  defaultAspectRatio: 'auto',
  defaultQuality: 'auto',
  defaultCount: 1,
};

function composerWithInheritedParams(
  composer: ComposerValue,
  defaults: GenerationParamDefaults | undefined,
  overrides: DraftParamOverrides,
  maxCount: PlatformCapabilities['maxGenerationCount'] = 1,
): ComposerValue {
  const resolved = resolveInheritedGenerationParams(
    defaults ?? FALLBACK_GENERATION_DEFAULTS,
    overrides,
  );
  return {
    ...composer,
    aspectRatio: toComposerRatio(resolved.aspectRatio),
    quality: resolved.quality,
    count: clampGenerationCount(resolved.count, maxCount),
  };
}

/** 宿主上限收窄(或偏好残留了更大的档)时把张数夹回可用档,避免提交超出能力的请求。 */
function clampGenerationCount(
  count: GenerationCount,
  maxCount: PlatformCapabilities['maxGenerationCount'],
): GenerationCount {
  return count <= maxCount ? count : maxCount;
}

/**
 * 首发消息派生会话标题(「新设计」草稿态首次发送建会话,承参照应用语义):
 * 压缩空白后截前 24 字,超长加省略号;空白兜底回默认名。
 */
export function deriveSessionTitle(prompt: string): string {
  const collapsed = prompt.replace(/\s+/g, ' ').trim();
  if (!collapsed) return '未命名创作';
  return collapsed.length > 24 ? `${collapsed.slice(0, 24)}…` : collapsed;
}

/** 时间线头顶标题展示上限(承旧 TitleBar 16 字截断;按 Unicode code point,不是 UTF-16)。 */
const SESSION_TITLE_DISPLAY_CHARS = 16;

/**
 * 工作台头顶会话标题:超 16 个 Unicode 字符截断并加省略号;完整名走 title 属性。
 */
export function formatSessionTitle(title: string): string {
  const chars = [...title];
  return chars.length > SESSION_TITLE_DISPLAY_CHARS
    ? `${chars.slice(0, SESSION_TITLE_DISPLAY_CHARS).join('')}…`
    : title;
}

/**
 * 活动任务摘要(承旧 titlebar-task-summary 活动标签)。
 * 优先级:待审批 > 排队中 > 生成中 > 方案运行中 > 取消中;无活动则不展示。
 */
export function workbenchTaskSummary(
  jobs: ReadonlyArray<Pick<GenerationJob, 'status'>>,
  schemeRunning = false,
): string | null {
  if (jobs.some((job) => job.status === 'pending_approval')) return '待审批';
  if (jobs.some((job) => job.status === 'queued')) return '排队中';
  if (jobs.some((job) => job.status === 'running')) return '生成中';
  if (schemeRunning) return '方案运行中';
  if (jobs.some((job) => job.status === 'cancelling')) return '取消中';
  return null;
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

/** Agent 创建/修改状态 → Composer 进度文案(承旧创建状态机文案);终态不显示。 */
const AGENT_STATE_LABELS: Partial<Record<CreationState, string>> = {
  created: '正在准备 Agent…',
  source_resolving: '正在读取 GitHub 仓库…',
  awaiting_install_confirmation: '等待确认引入来源',
  source_snapshotting: '正在固化来源快照…',
  analyzing: 'Repository Analyst 正在分析仓库…',
  compiling_scheme: 'Scheme Compiler 正在编译方案…',
};

/** 宿主以结构化 CANCELLED 收尾的 Agent 执行(如用户在安装确认层取消)。 */
function isCancelledError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'CANCELLED'
  );
}

export interface WorkbenchScreenProps {
  /** Composer 无连接引导「前往设置」的切屏回调(宿主注入)。 */
  onOpenSettings?(): void;
  /** 「存为提示词」成功 toast「查看」跳库的切屏回调(宿主注入)。 */
  onOpenPrompts?(): void;
  /**
   * 设计方案域集成(宿主注入;域恢复卡):
   * - onOpenDesignSchemes:切屏方案中心(「寻找设计方案」/附件「查看详情」,可携详情深链);
   * - onRun/onCancelRun:已挂载方案的运行与取消提交缝,由宿主负责 prepare/run/cancel,
   *   本屏 await 终态结果后才复位 Composer;运行中提交钮转停止钮;
   * - onCreate/onModify:独立生命周期接缝,缺省时对应入口禁用并解释(I4);
   * - runInputSupport:宿主运行输入边界,text-only 时含图片的提交在本屏禁用并解释。
   * 任何缺省接缝都不回落普通生成伪造方案运行;整个 prop 缺省 = 宿主未接入该域,
   * Composer 方案菜单项不出现(D2)。
   */
  designSchemes?: SchemeComposerHandlers & {
    onOpenDesignSchemes(detailId?: string): void;
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
  designSchemes: hostDesignSchemes,
}: WorkbenchScreenProps = {}) {
  const cloudCreate = useCloudSchemeCreate(hostDesignSchemes?.onOpenDesignSchemes);
  const designSchemes = hostDesignSchemes
    ? {
        ...hostDesignSchemes,
        ...(cloudCreate.onCreate
          ? { onCreate: cloudCreate.onCreate, onModify: cloudCreate.onModify }
          : {}),
      }
    : undefined;
  const activeId = useActiveSession((s) => s.activeSessionId);
  const setActiveId = useActiveSession((s) => s.setActiveSessionId);
  const draftSession = useActiveSession((s) => s.draftSession);
  const startDraftSession = useActiveSession((s) => s.startDraftSession);
  const draftParamOverrides = useActiveSession((s) => s.draftParamOverrides);
  const setDraftParamOverride = useActiveSession((s) => s.setDraftParamOverride);
  const preferences = usePreferences();
  // 张数上限是宿主能力(§9-D3):为 1 时 Composer 不渲染张数控件,提交恒为 1。
  const capabilities = useCapabilities();
  const gateway = useGateway();
  const maxGenerationCount = capabilities.maxGenerationCount;
  const account = useAccountStatus();
  const accountRestricted = isAccountRestricted(account.data);
  const [composer, setComposer] = useState<ComposerValue>(EMPTY_COMPOSER);
  const [quotaBlocked, setQuotaBlocked] = useState(false);
  // 草稿参考图(ui-parity 03 §7 P0):内存态,不进会话草稿;previewUrl 为本地 objectURL。
  const [references, setReferenceState] = useState<ComposerReference[]>([]);
  const currentReferences = useRef<ComposerReference[]>([]);
  // Resource ownership changes synchronously; React state only renders its projection.
  const setReferences = useCallback(
    (update: (previous: ComposerReference[]) => ComposerReference[]) => {
      const next = update(currentReferences.current);
      currentReferences.current = next;
      setReferenceState(next);
    },
    [],
  );
  // Only uploads still attached to this page may start IO or report completion.
  const pendingReferenceUploads = useRef(new Set<string>());
  const ownedReferences = useRef(
    new Map<string, ReturnType<typeof createReferenceUploadLifetime>>(),
  );

  function captureReferenceInputs() {
    const selected = currentReferences.current.filter((reference) => reference.image !== undefined);
    const lifetimes = selected.flatMap((reference) => {
      const lifetime = ownedReferences.current.get(reference.key);
      return lifetime ? [lifetime] : [];
    });
    const retain = () => {
      const holds = lifetimes.map((lifetime) => lifetime.retain());
      return () => {
        for (const release of holds) release();
      };
    };
    return {
      images: selected.flatMap((reference) => (reference.image ? [{ ...reference.image }] : [])),
      keys: new Set(selected.map((reference) => reference.key)),
      retain,
      release: retain(),
    };
  }
  // 参考素材面板(提示词引用):面板态在屏幕层,Composer 经「添加上下文」菜单请求打开。
  const [referencePanelOpen, setReferencePanelOpen] = useState(false);
  // 方案域 Composer 态(内存态,随会话切换清空;承旧 draftSource/schemeInputValues):
  // attachment = 挂载的方案(试运行/使用/修改);creation = design-plan 创建上下文。
  const [schemeAttachment, setSchemeAttachment] = useState<SchemeComposerAttachment | null>(null);
  const [schemeInputValues, setSchemeInputValues] = useState<Record<string, string>>({});
  const [schemeCreation, setSchemeCreation] = useState<SchemeCreationContext | null>(null);
  const [schemePickerOpen, setSchemePickerOpen] = useState(false);
  const [schemeHistoryOpen, setSchemeHistoryOpen] = useState(false);
  // 方案提交执行态:一次只允许一个进行中的方案生命周期(运行/创建/修改),
  // 运行可经 onCancelRun 取消;终态(成功/失败/取消)后清空。
  const schemeCancelRequested = useRef(new Set<string>());
  const [schemeExecution, setSchemeExecution] = useState<{
    id: string;
    kind: 'run' | 'create' | 'modify';
  } | null>(null);
  const [schemeCancelling, setSchemeCancelling] = useState(false);
  const [schemeSubmitError, setSchemeSubmitError] = useState<string | null>(null);
  // Agent 创建的来源安装确认层(confirmation-required → 用户决定 → confirmInstall)。
  const [installConfirmation, setInstallConfirmation] = useState<{
    executionId: string;
    source: SourceConfirmation;
  } | null>(null);
  const [installDecisionPending, setInstallDecisionPending] = useState(false);
  // Agent 创建/修改进行中的一行进度(state / 运行中 trace 标题)。
  const [agentProgress, setAgentProgress] = useState<string | null>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  // 「添加上下文」触发钮:面板关闭后焦点归还(§8-I9)。
  const attachTriggerRef = useRef<HTMLButtonElement>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftReviewTriggerRef = useRef<HTMLButtonElement>(null);
  const draftWriter = useSessionDraftWriter(activeId);
  const { observe: observeDraft, accept: acceptDraft, write: queueDraftWrite } = draftWriter;

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
  // Image runs share the account choice; scheme create/modify keep independent text authorization.
  const accountModels = useAccountModelChoice(
    providers.data?.[0]?.kind === 'cloud' &&
      Boolean(gateway.account.getModelCatalog) &&
      schemeAttachment?.mode !== 'modify' &&
      !schemeCreation,
  );
  const submittingIntent = useRef(false);
  const [submissionPreparing, setSubmissionPreparing] = useState(false);
  useEffect(() => {
    if (
      !accountRestricted &&
      !capabilities.hasLocalAiProviders &&
      account.data?.canGenerate === false
    ) {
      setQuotaBlocked(true);
      return;
    }
    if (accountRestricted || account.data?.canGenerate) setQuotaBlocked(false);
  }, [capabilities.hasLocalAiProviders, account.data?.canGenerate, accountRestricted]);
  const createSession = useCreateSession();
  const schemeRunning = schemeExecution?.kind === 'run';
  const jobs = useSessionJobs(activeId, { pollWhileExternalRun: schemeRunning });
  const queryClient = useQueryClient();
  const createGeneration = useCreateGeneration();
  const cancelGeneration = useCancelGeneration();
  const retryGeneration = useRetryAction(onOpenSettings);
  const removeGeneration = useRemoveGeneration();
  const uploadReference = useUploadReferenceImage();
  // 草稿引用意图 → 托盘展示解析(owner-safe prompts.get;不可用/已更新可见可移除)。
  const promptReferences = usePromptReferenceResolutions(composer.promptReferenceSelections);
  // 方案域适配器(能力关闭或宿主未注入时为 null,方案菜单整体不出现)。
  const schemeGateway = useDesignSchemesGateway();
  // 移动 Web 软键盘 inset:仅 <md 启用;md+ / 无 visualViewport 为 0,桌面几何不变。
  const keyboardInset = useVisualViewportInset();
  const composerDockLiftStyle: CSSProperties | undefined =
    keyboardInset > 0 ? { bottom: keyboardInset } : undefined;
  const composerEmptyLiftStyle: CSSProperties | undefined =
    keyboardInset > 0 ? { paddingBottom: keyboardInset } : undefined;

  const sessionItems = sessions.data?.items ?? [];
  const firstSessionId = sessionItems[0]?.id;
  const listedSession = sessionItems.find((session) => session.id === activeId) ?? null;
  const missingSession = useMissingSession(activeId, sessions.isSuccess && !listedSession);
  const resolvedSession = listedSession ?? missingSession.data;
  const activeSession =
    resolvedSession && !resolvedSession.deletedAt && !resolvedSession.archivedAt
      ? resolvedSession
      : null;
  const missingCode =
    missingSession.error && 'code' in missingSession.error ? missingSession.error.code : null;
  const selectedSessionGone =
    activeId !== null &&
    !listedSession &&
    ((missingSession.isSuccess &&
      Boolean(missingSession.data.deletedAt || missingSession.data.archivedAt)) ||
      missingCode === 'NOT_FOUND' ||
      missingCode === 'WORKBENCH_SESSION_NOT_FOUND');

  useEffect(() => {
    if (activeSession) observeDraft(activeSession);
  }, [activeSession, observeDraft]);

  const reportDraftWriteError = useCallback((error: unknown): void => {
    toast.error(error instanceof Error ? error.message : '草稿保存失败,请重试');
  }, []);

  const clearReferences = useCallback(
    (keys?: ReadonlySet<string>) => {
      if (keys) for (const key of keys) pendingReferenceUploads.current.delete(key);
      else pendingReferenceUploads.current.clear();
      setReferences((prev) =>
        prev.filter((reference) => {
          if (keys && !keys.has(reference.key)) return true;
          revokePreviewUrl(reference.previewUrl);
          ownedReferences.current.get(reference.key)?.release();
          ownedReferences.current.delete(reference.key);
          return false;
        }),
      );
    },
    [setReferences],
  );

  /** 方案态清空(附件 + 槽位值 + 创建上下文):随会话切换/草稿态/「送入制作」复位。 */
  const clearSchemeState = useCallback(() => {
    setSchemeAttachment(null);
    setSchemeInputValues({});
    setSchemeCreation(null);
    setSchemeSubmitError(null);
  }, []);

  // 卸载时回收 objectURL。
  useEffect(() => clearReferences, [clearReferences]);
  useEffect(
    () => subscribeAccountEpoch(queryClient, clearReferences),
    [queryClient, clearReferences],
  );

  // 首次加载定位最近会话。分页遗漏先按id核对;确认离场后隔离旧草稿。
  useEffect(() => {
    if (draftSession) return;
    if (selectedSessionGone) {
      if (firstSessionId) setActiveId(firstSessionId);
      else startDraftSession();
    } else if (sessions.isSuccess && activeId === null) {
      setActiveId(firstSessionId ?? null);
    }
  }, [
    draftSession,
    sessions.isSuccess,
    activeId,
    selectedSessionGone,
    firstSessionId,
    setActiveId,
    startDraftSession,
  ]);

  // 切会话时装载该会话草稿(仅切换瞬间,不跟随后台 refetch 覆盖输入)。
  const loadedDraftFor = useRef<string | null>(null);
  // 「送入制作」刚落进 Composer 时,紧随其后的会话草稿装载让位一次,不覆盖送来的稿。
  const pendingApplied = useRef(false);
  // 方案意图刚落进 Composer 时同理:会话草稿装载让位一次,不清刚到位的方案态。
  const schemeIntentApplied = useRef(false);
  useEffect(() => {
    if (activeSession && loadedDraftFor.current !== activeSession.id) {
      loadedDraftFor.current = activeSession.id;
      acceptDraft(activeSession);
      if (schemeIntentApplied.current) {
        schemeIntentApplied.current = false;
        pendingApplied.current = false;
        // A newly attached scheme owns the current input, including images uploaded
        // while the initial session query was pending. Late hydration cannot replace it.
        return;
      }
      clearReferences();
      clearSchemeState();
      if (pendingApplied.current) {
        pendingApplied.current = false;
        return;
      }
      // 张数不进持久草稿契约(draft.params 只有 size/比例/质量):
      // 装载已有会话时按「显式覆盖 → 偏好默认」复原,不被会话正文重置。
      setComposer({
        ...draftToComposerValue(activeSession.draft),
        count: clampGenerationCount(
          draftParamOverrides.count ??
            preferences.data?.defaultCount ??
            FALLBACK_GENERATION_DEFAULTS.defaultCount,
          maxGenerationCount,
        ),
      });
    }
  }, [
    activeSession,
    acceptDraft,
    clearReferences,
    clearSchemeState,
    draftParamOverrides.count,
    preferences.data,
    maxGenerationCount,
  ]);

  // 空草稿 / 新设计:未显式改过的参数跟随设置默认值;刚进入草稿态时同时清空正文。
  const inheritDefaults = draftSession || !activeId;
  const wasDraftSession = useRef(false);
  useEffect(() => {
    const enteredDraft = draftSession && !wasDraftSession.current;
    wasDraftSession.current = draftSession;
    if (enteredDraft) {
      if (draftTimer.current) clearTimeout(draftTimer.current);
      loadedDraftFor.current = null;
      clearReferences();
      clearSchemeState();
      setComposer(
        composerWithInheritedParams(
          EMPTY_COMPOSER,
          preferences.data,
          draftParamOverrides,
          maxGenerationCount,
        ),
      );
      return;
    }
    if (!inheritDefaults) return;
    setComposer((current) =>
      composerWithInheritedParams(
        current,
        preferences.data,
        draftParamOverrides,
        maxGenerationCount,
      ),
    );
  }, [
    draftSession,
    inheritDefaults,
    draftParamOverrides,
    preferences.data,
    maxGenerationCount,
    clearReferences,
    clearSchemeState,
  ]);

  async function uploadReferenceFile(file: File, entry: ComposerReference) {
    const epoch = accountEpoch(queryClient);
    const isCurrent = () =>
      pendingReferenceUploads.current.has(entry.key) && accountEpoch(queryClient) === epoch;
    try {
      const bytes = await readFileBytes(file);
      if (!isCurrent()) return;
      const image = await uploadReference.mutateAsync({
        input: { name: entry.name, bytes },
        isCurrent,
      });
      const lifetime = createReferenceUploadLifetime(image.id, (input) =>
        gateway.generation.releaseReferenceImage(input),
      );
      if (!isCurrent()) {
        lifetime.release();
        return;
      }
      ownedReferences.current.set(entry.key, lifetime);
      setReferences((prev) =>
        prev.map((item) => (item.key === entry.key ? { ...item, status: 'ready', image } : item)),
      );
    } catch (error) {
      if (!isCurrent()) return;
      revokePreviewUrl(entry.previewUrl);
      setReferences((prev) => prev.filter((item) => item.key !== entry.key));
      toast.error(error instanceof Error ? error.message : '参考图上传失败');
    } finally {
      if (accountEpoch(queryClient) !== epoch && pendingReferenceUploads.current.has(entry.key)) {
        revokePreviewUrl(entry.previewUrl);
        setReferences((prev) => prev.filter((item) => item.key !== entry.key));
      }
      pendingReferenceUploads.current.delete(entry.key);
    }
  }

  function handleAddImages(files: File[]) {
    const room = MAX_REFERENCE_IMAGES - currentReferences.current.length;
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
    for (const { file, entry } of accepted) {
      pendingReferenceUploads.current.add(entry.key);
      void uploadReferenceFile(file, entry);
    }
  }

  function handleRemoveReference(key: string) {
    clearReferences(new Set([key]));
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
    if (pendingDraft.params.aspectRatio || pendingDraft.params.quality) {
      setDraftParamOverride({
        ...(pendingDraft.params.aspectRatio
          ? { aspectRatio: pendingDraft.params.aspectRatio }
          : {}),
        ...(pendingDraft.params.quality ? { quality: pendingDraft.params.quality } : {}),
      });
    }
    setComposer(draftToComposerValue(pendingDraft));
    consumePendingDraft();
  }, [
    pendingDraft,
    activeSession,
    consumePendingDraft,
    queueDraftWrite,
    reportDraftWriteError,
    clearSchemeState,
    setDraftParamOverride,
  ]);

  // 方案域一次性意图(承旧 run-store.attach / draftCommand design-plan):
  // 方案中心「使用/试运行/修改/新建」、提示词库「创建方案」、历史来源确认写入集成 store,
  // 宿主回调完成切屏后在这里消费一次落 Composer——attach 挂附件,create 进创建态并播种子。
  const schemeIntent = useSchemeIntegration((s) => s.workbenchIntent);
  const consumeSchemeIntent = useSchemeIntegration((s) => s.consumeWorkbenchIntent);
  useEffect(() => {
    if (!schemeIntent) return;
    consumeSchemeIntent();
    schemeIntentApplied.current =
      activeSession == null || loadedDraftFor.current !== activeSession.id;
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

  // 「新设计」(钮/⌘N)一次性意图:切到/已在工作台即聚焦 Composer,直接进入输入状态
  // (承 ChatGPT ⌘N 语义,2026-09 走查 P2)。依赖 intent 本身:同屏重复触发也要每次消费。
  const shellIntent = useScreenIntent((s) => s.intent);
  const consumeShellIntent = useScreenIntent((s) => s.consume);
  useEffect(() => {
    if (!shellIntent) return;
    if (consumeShellIntent('workbench-focus-composer')) focusPromptEnd();
  }, [shellIntent, consumeShellIntent, focusPromptEnd]);

  // 草稿防抖回写(800ms);同屏写入按服务端返回版本串行,避免 autosave 与提交后清空互相冲突。
  function handleComposerChange(next: ComposerValue) {
    if (inheritDefaults) {
      if (next.aspectRatio !== composer.aspectRatio) {
        setDraftParamOverride({ aspectRatio: next.aspectRatio });
      }
      if (next.quality !== composer.quality) {
        setDraftParamOverride({ quality: next.quality });
      }
      if (next.count !== composer.count) {
        setDraftParamOverride({ count: next.count });
      }
    }
    setComposer(next);
    if (!activeSession) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    // Bind before the debounce: switching away and back may load another writer's draft.
    const saveDraft = draftWriter.prepareWrite(
      activeSession.id,
      activeSession.version,
      composerValueToDraft(next),
    );
    draftTimer.current = setTimeout(() => {
      void saveDraft().catch(reportDraftWriteError);
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

  /** 方案终态成功后的 Composer 复位:附件保留支持多轮,正文/槽位/引用清空。 */
  function clearAfterSchemeSubmit(
    clearInputs: boolean,
    session: WorkbenchSession | null,
    referenceKeys?: ReadonlySet<string>,
  ) {
    if (clearInputs) setSchemeInputValues({});
    clearReferences(referenceKeys);
    const cleared = {
      ...composer,
      prompt: '',
      negative: '',
      promptReferenceSelections: [],
    };
    setComposer(cleared);
    if (session) {
      void queueDraftWrite(session.id, session.version, composerValueToDraft(cleared)).catch(
        reportDraftWriteError,
      );
    }
  }

  /** 方案运行落在活动会话;草稿态/无会话时首次运行才建会话(与普通生成同语义)。 */
  async function ensureSchemeSession(userPrompt: string): Promise<WorkbenchSession> {
    if (activeSession) return activeSession;
    const epoch = accountEpoch(queryClient);
    const created = await createSession.mutateAsync({
      title: deriveSessionTitle(userPrompt || schemeAttachment?.name || '方案运行'),
      draft: composerValueToDraft(composer),
    });
    assertAccountEpoch(queryClient, epoch);
    acceptDraft(created);
    loadedDraftFor.current = created.id;
    setActiveId(created.id);
    return created;
  }

  /** 方案运行的生成回合由宿主写入本会话账本:开始/终态各刷一次时间线与会话列表。 */
  function refreshSchemeRunLedger() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.generation.all() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.workbench.all() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.designSchemes.all() });
  }

  /**
   * 创建/修改走宿主 Agent 管线:成功复位 Composer(创建态清除),失败就地解释并保留输入;
   * 用户在安装确认层取消(宿主以 CANCELLED 收尾)按中性取消处理,不算失败。
   */
  async function runSchemeLifecycle(
    kind: 'create' | 'modify',
    execute: (executionId: string) => Promise<void>,
    onSuccess: () => void,
  ): Promise<void> {
    const executionId = crypto.randomUUID();
    setSchemeSubmitError(null);
    setSchemeExecution({ id: executionId, kind });
    try {
      await execute(executionId);
      onSuccess();
    } catch (error) {
      if (isCancelledError(error)) {
        toast(kind === 'create' ? '已取消创建方案' : '已取消修改方案');
        return;
      }
      const fallback = kind === 'create' ? '方案创建失败' : '方案修改失败';
      const message = error instanceof Error && error.message ? error.message : fallback;
      setSchemeSubmitError(message);
      toast.error(fallback, { description: message });
    } finally {
      setSchemeExecution(null);
    }
  }

  /**
   * Agent 创建/修改期间订阅宿主事件(承旧创建轨迹展示的精简形态):
   * - state / 运行中的 trace → Composer 上方一行进度(「Repository Analyst 分析仓库」等),
   *   让 30–120s 的 Agent 等待有反馈;
   * - confirmation-required → 弹安装确认层(§11.2 不静默引入),决定经 gateway.confirmInstall 送回;
   *   宿主没有确认通道时不处理该事件——此时宿主 onCreate 也不会接受 GitHub 地址。
   */
  function subscribeAgentEvents(executionId: string): () => void {
    const gateway = schemeGateway;
    if (!gateway) return () => undefined;
    const canConfirm = typeof gateway.confirmInstall === 'function';
    try {
      const unsubscribe = gateway.subscribeEvents((event) => {
        if (event.executionId !== executionId) return;
        if (event.kind === 'state') {
          setAgentProgress(AGENT_STATE_LABELS[event.state] ?? null);
        } else if (event.kind === 'trace') {
          if (event.item.status === 'running') setAgentProgress(event.item.title);
        } else if (event.kind === 'confirmation-required' && canConfirm) {
          setInstallDecisionPending(false);
          setInstallConfirmation({ executionId, source: event.source });
        }
      });
      return () => {
        unsubscribe();
        setAgentProgress(null);
        setInstallConfirmation(null);
        setInstallDecisionPending(false);
      };
    } catch {
      // 事件通道不可用(如云端 adapter):没有进度与确认层,请求本身仍由宿主裁决。
      return () => undefined;
    }
  }

  async function handleInstallDecision(decision: 'install' | 'cancel') {
    const current = installConfirmation;
    const confirmInstall = schemeGateway?.confirmInstall;
    if (!current || !confirmInstall || installDecisionPending) return;
    setInstallDecisionPending(true);
    try {
      await confirmInstall({ executionId: current.executionId, decision });
      // 同一执行可能还有下一个来源要确认;新事件会重新打开确认层。
      setInstallConfirmation((pending) =>
        pending?.executionId === current.executionId ? null : pending,
      );
    } catch (error) {
      setInstallDecisionPending(false);
      toast.error('安装确认失败', {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  }

  /**
   * 方案域提交路由(在任何普通生成分支之前):每种生命周期独立接缝,await 到宿主终态再复位。
   * 宿主未实现的 create/modify/run 在 Composer 已禁用并解释,这里的 return true 是双保险:
   * 绝不回落 createGeneration 伪造方案运行/创建。
   */
  async function submitSchemeContext(userPrompt: string): Promise<boolean> {
    if (schemeCreation) {
      const submitCreate = designSchemes?.onCreate;
      if (!submitCreate || !userPrompt) return true;
      const creation = schemeCreation;
      await runSchemeLifecycle(
        'create',
        async (executionId) => {
          // 先订阅再提交:进度/确认事件不可能早于订阅到达。
          const unsubscribe = subscribeAgentEvents(executionId);
          try {
            await submitCreate({
              kind: 'create',
              executionId,
              createKind: creation.createKind,
              brief: userPrompt,
              source: creation.source,
            });
          } finally {
            unsubscribe();
          }
        },
        () => {
          setSchemeCreation(null);
          clearAfterSchemeSubmit(false, activeSession);
          refreshSchemeRunLedger();
          toast.success('方案草稿已创建', { description: '稍后可在方案中心试运行并转正。' });
        },
      );
      return true;
    }
    if (!schemeAttachment) return false;
    const attachment = schemeAttachment;
    if (attachment.mode === 'modify') {
      const submitModify = designSchemes?.onModify;
      if (!submitModify || !userPrompt) return true;
      await runSchemeLifecycle(
        'modify',
        async (executionId) => {
          const unsubscribe = subscribeAgentEvents(executionId);
          try {
            await submitModify({
              kind: 'modify',
              executionId,
              attachment,
              brief: userPrompt,
            });
          } finally {
            unsubscribe();
          }
        },
        () => {
          clearAfterSchemeSubmit(false, activeSession);
          refreshSchemeRunLedger();
          toast.success('修改要求已处理', {
            description: `「${attachment.name}」的新版本待验证,可在方案中心查看。`,
          });
        },
      );
      return true;
    }
    const submitRun = designSchemes?.onRun;
    if (!submitRun) return true;
    const executionId = crypto.randomUUID();
    const inputValues = Object.fromEntries(
      Object.entries(schemeInputValues)
        .map(([slotId, value]) => [slotId, value.trim()] as const)
        .filter(([, value]) => value.length > 0),
    );
    const referenceInputs = captureReferenceInputs();
    const referenceImages = referenceInputs.images;
    const submissionEpoch = accountEpoch(queryClient);
    setSchemeSubmitError(null);
    setSchemeExecution({ id: executionId, kind: 'run' });
    try {
      const modelInput = accountModels.enabled ? await accountModels.prepareSubmission() : {};
      assertAccountEpoch(queryClient, submissionEpoch);
      if (schemeCancelRequested.current.has(executionId)) return true;
      const session = await ensureSchemeSession(userPrompt);
      assertAccountEpoch(queryClient, submissionEpoch);
      if (schemeCancelRequested.current.has(executionId)) return true;
      if (draftTimer.current) clearTimeout(draftTimer.current);
      const result = await submitRun({
        ...modelInput,
        kind: 'run',
        executionId,
        workbenchSessionId: session.id,
        attachment,
        brief: userPrompt,
        inputValues,
        referenceImages,
        promptReferenceSelections: composer.promptReferenceSelections,
        params: {
          ...(composer.aspectRatio !== 'auto' ? { aspectRatio: composer.aspectRatio } : {}),
          quality: composer.quality,
          count: composer.count,
          ...(composer.negative.trim() ? { negative: composer.negative.trim() } : {}),
        },
        // 生图通道跟随活跃连接(与普通生成同口径)。
        providerId: providers.data?.[0]?.id,
      });
      if (accountEpoch(queryClient) !== submissionEpoch) return true;
      refreshSchemeRunLedger();
      if (result.status === 'cancelled') {
        toast('方案运行已取消', { description: attachment.name });
        return true;
      }
      if (result.status !== 'completed') {
        const message = result.error?.message ?? '方案运行未完成';
        setSchemeSubmitError(message);
        toast.error(result.status === 'blocked' ? '方案运行被阻止' : '方案运行失败', {
          description: message,
        });
        return true;
      }
      clearAfterSchemeSubmit(true, session, referenceInputs.keys);
      toast.success(attachment.mode === 'trial' ? '试运行已完成' : '按方案生成已完成', {
        description: attachment.name,
      });
    } catch (error) {
      if (accountEpoch(queryClient) !== submissionEpoch) return true;
      refreshSchemeRunLedger();
      if (schemeCancelRequested.current.has(executionId)) return true;
      const message = error instanceof Error && error.message ? error.message : '方案运行失败';
      setSchemeSubmitError(message);
      toast.error('方案运行失败', { description: message });
    } finally {
      referenceInputs.release();
      schemeCancelRequested.current.delete(executionId);
      setSchemeExecution(null);
      setSchemeCancelling(false);
    }
    return true;
  }

  async function handleSubmit() {
    if (submittingIntent.current) return;
    if (isAccountRestricted(queryClient.getQueryData(queryKeys.account.status()))) return;
    if (draftWriter.issue || draftWriter.busy) {
      toast.error('请先核对并处理草稿保存问题');
      return;
    }
    if (activeId && !activeSession) {
      toast.error('当前对话尚未核对，请刷新后重试');
      return;
    }
    const userPrompt = composer.prompt.trim();
    const promptReferenceSelections = composer.promptReferenceSelections;
    if (schemeAttachment || schemeCreation) {
      if (schemeExecution) return;
      // React state alone cannot exclude two submissions before the next render.
      submittingIntent.current = true;
      try {
        await submitSchemeContext(userPrompt);
      } finally {
        submittingIntent.current = false;
      }
      return;
    }
    if (!userPrompt && promptReferenceSelections.length === 0) return;
    if (!capabilities.hasLocalAiProviders && account.data?.canGenerate === false) {
      setQuotaBlocked(true);
      createGeneration.reset();
      return;
    }
    setQuotaBlocked(false);
    const referenceInputs = captureReferenceInputs();
    const submissionEpoch = accountEpoch(queryClient);
    submittingIntent.current = true;
    setSubmissionPreparing(true);
    try {
      const modelInput = accountModels.enabled ? await accountModels.prepareSubmission() : {};
      assertAccountEpoch(queryClient, submissionEpoch);
      let sessionId = activeId;
      if (!sessionId) {
        // 草稿态首次发送才真正建会话:引用-only 不泄漏源内容,使用稳定中性标题。
        const created = await createSession.mutateAsync({
          title: userPrompt ? deriveSessionTitle(userPrompt) : '引用提示词创作',
          draft: composerValueToDraft(composer),
        });
        if (accountEpoch(queryClient) !== submissionEpoch) return;
        sessionId = created.id;
        acceptDraft(created);
        loadedDraftFor.current = created.id;
        setActiveId(created.id);
      }
      if (draftTimer.current) clearTimeout(draftTimer.current);
      const referenceImages = referenceInputs.images;
      const intent = createGenerationMutationIntent({
        ...modelInput,
        sessionId,
        prompt: userPrompt,
        promptReferenceSelections,
        negative: composer.negative.trim() || undefined,
        size: 'auto',
        aspectRatio: composer.aspectRatio === 'auto' ? undefined : composer.aspectRatio,
        quality: composer.quality,
        // 生图通道跟随活跃连接(目录活跃置首,左下角账号区切换)。
        providerId: providers.data?.[0]?.id,
        count: clampGenerationCount(composer.count, maxGenerationCount),
        ...(referenceImages.length > 0 ? { referenceImages } : {}),
      });
      await createGeneration
        .mutateAsync(intent, {
          onSuccess: () => {
            if (
              accountEpoch(queryClient) !== submissionEpoch ||
              useActiveSession.getState().activeSessionId !== sessionId
            )
              return;
            const cleared = {
              ...composer,
              prompt: '',
              negative: '',
              promptReferenceSelections: [],
            };
            setComposer(cleared);
            clearReferences(referenceInputs.keys);
            if (sessionId) {
              void queueDraftWrite(
                sessionId,
                activeSession?.version ?? 1,
                composerValueToDraft(cleared),
              ).catch(reportDraftWriteError);
            }
          },
          onError: (error) => {
            const code =
              error && typeof error === 'object' && 'code' in error
                ? String((error as { code: unknown }).code)
                : '';
            if (normalizeHistoryErrorCode(code) === 'ACCOUNT_QUOTA_INSUFFICIENT') {
              rememberQuotaRecovery({ kind: 'replay-create', intent }, referenceInputs.retain());
            }
          },
        })
        .catch(() => {
          /* The mutation renders its error; finally still releases the submission hold. */
        });
    } catch (error) {
      if (accountEpoch(queryClient) === submissionEpoch)
        toast.error('生成未提交', {
          description: error instanceof Error ? error.message : '请核对账号、模型与网络后重试',
        });
    } finally {
      submittingIntent.current = false;
      setSubmissionPreparing(false);
      referenceInputs.release();
    }
  }

  const jobItems = jobs.data ?? [];
  const jobsWereActive = useRef(false);
  useEffect(() => {
    const active = hasActiveJob(jobItems);
    if (jobsWereActive.current && !active) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.account.status() });
    }
    jobsWereActive.current = active;
  }, [jobItems, queryClient]);
  const taskSummary = workbenchTaskSummary(jobItems, schemeRunning);
  // 进行中 = 会话账本有活动任务,或方案运行正在宿主管线里(回合可能尚未落账)。
  const running = hasActiveJob(jobItems) || schemeRunning;
  const cancelling =
    cancelGeneration.isPending ||
    schemeCancelling ||
    jobItems.some((job) => job.status === 'cancelling');
  // 空态 = 没有会话,或当前会话还没有任何回合(V25-UI-SPEC §3.1:品牌锁定区 + 内联 Composer 居中)。
  const showEmptyState = activeId === null || (jobs.isSuccess && jobItems.length === 0);

  /** 方案运行取消走宿主 executionId 接缝(主进程 fan-out 到全部生成任务);普通生成取消最近活动任务。 */
  async function handleCancelActive() {
    if (schemeExecution?.kind === 'run') {
      const executionId = schemeExecution.id;
      const cancelRun = designSchemes?.onCancelRun;
      if (!cancelRun || schemeCancelling) return;
      schemeCancelRequested.current.add(executionId);
      setSchemeCancelling(true);
      try {
        await cancelRun(executionId);
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
        if (code === 'DESIGN_SCHEME_EXECUTION_NOT_FOUND') return;
        schemeCancelRequested.current.delete(executionId);
        setSchemeCancelling(false);
        setSchemeSubmitError(error instanceof Error ? error.message : '方案取消失败');
        toast.error('取消方案运行失败', {
          description: error instanceof Error ? error.message : undefined,
        });
      }
      return;
    }
    const target = [...jobItems]
      .reverse()
      .find((job) => job.status === 'queued' || job.status === 'running');
    if (target) cancelGeneration.mutate(target.id);
  }
  // 方案运行中而宿主无取消缝:停止钮不可用(禁用而非假装能停)。
  const cancelHandler =
    schemeRunning && !designSchemes?.onCancelRun ? undefined : handleCancelActive;

  // 方案域 Composer 接缝:域适配器 + 宿主集成 prop 齐备才出现方案菜单项(D2);
  // 各生命周期接缝缺失时挂载/创建照常,提交禁用并解释(I4),不伪造方案运行。
  const schemeCreateSeam = Boolean(designSchemes?.onCreate);
  const baseSchemeSubmitReason = schemeSubmitDisabledReason(designSchemes, {
    attachment: schemeAttachment,
    creation: schemeCreation,
    referenceImageCount: references.length,
  });
  const schemeRunNeedsProvider =
    baseSchemeSubmitReason == null &&
    schemeAttachment != null &&
    schemeAttachment.mode !== 'modify';
  const schemeSubmitReason = schemeRunNeedsProvider
    ? providers.isPending
      ? '正在读取 AI 连接'
      : providers.isError
        ? 'AI 连接列表读取失败，请重试'
        : baseSchemeSubmitReason
    : baseSchemeSubmitReason;
  const schemeProp =
    schemeGateway && designSchemes
      ? {
          attachment: schemeAttachment,
          creation: schemeCreation,
          inputValues: schemeInputValues,
          submitDisabledReason: schemeSubmitReason,
          onChangeInput: (slotId: string, value: string) =>
            setSchemeInputValues((prev) => ({ ...prev, [slotId]: value })),
          onClearAttachment: () => {
            setSchemeSubmitError(null);
            setSchemeAttachment(null);
            setSchemeInputValues({});
          },
          onClearCreation: () => {
            setSchemeSubmitError(null);
            setSchemeCreation(null);
          },
          onOpenPicker: () => setSchemePickerOpen(true),
          onStartCreation: schemeCreateSeam ? handleStartSchemeCreation : undefined,
          onOpenHistorySource: schemeCreateSeam ? () => setSchemeHistoryOpen(true) : undefined,
          onOpenDesignSchemes: designSchemes.onOpenDesignSchemes,
        }
      : undefined;

  const composerNode = (
    <Composer
      value={composer}
      disabled={accountRestricted || submissionPreparing}
      submitDisabledReason={
        draftWriter.issue || draftWriter.busy
          ? '请先核对并处理草稿保存问题'
          : (accountModels.reason ?? undefined)
      }
      // 创建/修改无取消缝:提交钮转 spinner 直到宿主返回;运行走 running(停止钮)。
      submitting={
        submissionPreparing ||
        createGeneration.isPending ||
        (schemeExecution !== null && schemeExecution.kind !== 'run')
      }
      variant={showEmptyState ? 'inline' : 'docked'}
      hasTurns={jobItems.length > 0}
      running={running}
      cancelling={cancelling}
      noProvider={providers.isSuccess && providers.data.length === 0}
      modelSelector={
        <AccountModelSelector choice={accountModels} disabled={submissionPreparing || running} />
      }
      references={references}
      promptReferences={promptReferences}
      promptRef={promptRef}
      contextMenuTriggerRef={attachTriggerRef}
      maxCount={maxGenerationCount}
      onChange={handleComposerChange}
      onSubmit={handleSubmit}
      onCancel={cancelHandler}
      onAddImages={handleAddImages}
      onRemoveReference={handleRemoveReference}
      onRemovePromptReference={handleRemovePromptReference}
      onOpenPromptReferences={() => setReferencePanelOpen(true)}
      onOpenSettings={onOpenSettings}
      scheme={schemeProp}
    />
  );

  const submitGuidance = quotaBlocked
    ? HISTORY_ERROR_GUIDANCE.ACCOUNT_QUOTA_INSUFFICIENT
    : createGeneration.isError
      ? thrownErrorPresentation(createGeneration.error)
      : null;
  const errorNode = accountRestricted ? (
    <div
      className="pointer-events-auto mx-auto my-2 flex w-full max-w-[728px] flex-col gap-1 px-1.5"
      data-testid="generation-account-recovery"
    >
      <p className="text-muted-foreground text-sm">
        账号归属尚未验证，完成恢复后可继续生图。当前输入会保留。
      </p>
      <Button
        variant="link"
        size="sm"
        className="h-auto w-fit p-0"
        disabled={!onOpenSettings}
        onClick={() => {
          useScreenIntent.getState().setIntent({ kind: 'settings-account' });
          onOpenSettings?.();
        }}
      >
        恢复账号
      </Button>
    </div>
  ) : quotaBlocked || createGeneration.isError ? (
    <div
      className="pointer-events-auto mx-auto my-2 flex w-full max-w-[728px] flex-col gap-1 px-1.5"
      data-testid="generation-error"
    >
      <p className="text-destructive text-xs">
        {submitGuidance?.title ??
          (createGeneration.error instanceof Error
            ? createGeneration.error.message
            : '生成提交失败')}
      </p>
      {submitGuidance ? (
        <KeyGuidanceAction
          guidance={submitGuidance}
          onOpenSettings={onOpenSettings}
          testId="generation-error-action"
        />
      ) : null}
    </div>
  ) : schemeSubmitError ? (
    <p
      className="pointer-events-auto mx-auto my-2 w-full max-w-[728px] px-1.5 text-destructive text-xs"
      data-testid="scheme-submit-error"
    >
      {schemeSubmitError}
    </p>
  ) : schemeExecution && schemeExecution.kind !== 'run' && agentProgress ? (
    <p
      className="pointer-events-auto mx-auto my-2 flex w-full max-w-[728px] items-center gap-1.5 px-1.5 text-muted-foreground text-xs"
      data-testid="scheme-agent-progress"
      aria-live="polite"
    >
      <Spinner className="size-3" />
      {agentProgress}
    </p>
  ) : null;

  /**
   * 悬浮 Composer 轨道(承旧 floating 布局):绝对贴底、轨道透明不截获事件,
   * 卡片自身可交互;时间线在下方以底部留白让内容滚过卡片背后。
   */
  const composerDock = (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-3 pb-3 md:px-4 md:pb-3.5"
      data-testid="composer-dock"
      style={composerDockLiftStyle}
    >
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
          {draftWriter.issue && (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-2 px-4 py-2"
              data-testid="session-draft-save-error"
            >
              <div className="min-w-0 flex-1 text-sm">
                <p>草稿尚未保存，本页输入已保留。</p>
                <p className="break-words text-muted-foreground">{draftWriter.issue}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={draftWriter.busy}
                data-testid="session-draft-review"
                ref={draftReviewTriggerRef}
                onClick={() => {
                  if (draftTimer.current) clearTimeout(draftTimer.current);
                  void draftWriter.openReview();
                }}
              >
                {draftWriter.busy ? '核对中…' : '核对草稿'}
              </Button>
            </div>
          )}
          {activeId && !listedSession && missingSession.isError && !selectedSessionGone && (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-2 px-4 py-2"
              data-testid="session-current-error"
            >
              <p className="text-muted-foreground text-sm">当前对话读取失败，输入已保留。</p>
              <Button
                variant="outline"
                size="sm"
                disabled={missingSession.isFetching}
                onClick={() => void missingSession.refetch()}
              >
                重新核对
              </Button>
            </div>
          )}
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
                <div data-testid="composer-empty-inset" style={composerEmptyLiftStyle}>
                  {composerNode}
                  {errorNode}
                </div>
              }
              onSelectSuggestion={(suggestion) => {
                handleComposerChange({ ...composer, prompt: suggestion });
                focusPromptEnd();
              }}
            />
          ) : (
            <div className="relative flex min-h-0 flex-1 flex-col">
              {activeSession ? (
                <div className="hidden shrink-0 px-4 pt-3 md:flex">
                  <div className="mx-auto flex w-full max-w-[728px] items-baseline gap-2 text-sm">
                    <p
                      className="min-w-0 font-medium text-foreground"
                      data-testid="workbench-session-title"
                      title={activeSession.title}
                    >
                      {formatSessionTitle(activeSession.title)}
                    </p>
                    {taskSummary ? (
                      <p
                        className="shrink-0 text-muted-foreground"
                        data-testid="workbench-task-summary"
                      >
                        {taskSummary}
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <GenerationTimeline
                jobs={jobItems}
                isRetryPending={retryGeneration.isPending}
                keyboardInset={keyboardInset}
                editDisabled={running}
                onCancel={(job) => {
                  if (schemeRunning) {
                    void handleCancelActive();
                    return;
                  }
                  cancelGeneration.mutate(job.id);
                }}
                onRetry={(job) => retryGeneration.request(job)}
                onRemove={(job) => removeGeneration.mutate(job.id)}
                onEditMessage={handleEditMessage}
                onOpenPrompts={onOpenPrompts}
                onOpenSettings={onOpenSettings}
              />
              {/* 悬浮卡上缘渐隐(03-C1):内容滚过卡片背后时以渐变收边,替代生硬截断。 */}
              <div
                className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-24 bg-linear-to-t from-background to-transparent"
                aria-hidden
                style={composerDockLiftStyle}
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

      <SessionDraftConflictDialog
        review={draftWriter.review}
        localDraft={composerValueToDraft(composer)}
        busy={draftWriter.busy}
        error={draftWriter.reviewError}
        onClose={draftWriter.closeReview}
        onReturnFocus={() => {
          (draftReviewTriggerRef.current ?? promptRef.current)?.focus();
        }}
        onRefresh={() => {
          void draftWriter.openReview();
        }}
        onLoad={() => {
          if (draftTimer.current) clearTimeout(draftTimer.current);
          const latest = draftWriter.loadReviewed();
          if (!latest) return;
          clearReferences();
          clearSchemeState();
          setComposer({ ...draftToComposerValue(latest.draft), count: composer.count });
          focusPromptEnd();
        }}
        onSave={() => {
          if (draftTimer.current) clearTimeout(draftTimer.current);
          void draftWriter.saveReviewed(composerValueToDraft(composer));
        }}
      />
      {cloudCreate.dialog}
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
          <SourceInstallConfirmDialog
            source={installConfirmation?.source ?? null}
            pending={installDecisionPending}
            onDecide={(decision) => void handleInstallDecision(decision)}
          />
        </>
      ) : null}
    </div>
  );
}
