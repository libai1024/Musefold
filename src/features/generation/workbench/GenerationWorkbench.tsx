import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import {
  ArrowDown,
  ArrowUp,
  Blocks,
  BookmarkPlus,
  Check,
  ChevronDown,
  Copy,
  Download,
  FileText,
  FolderOpen,
  GitBranch,
  History,
  ImageOff,
  ImagePlus,
  ListChecks,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Settings2,
  Search,
  SlidersHorizontal,
  Square,
  Wand2,
  X,
} from '../../../components/ui/icons';
import type { Prompt, ProviderConfig } from '@shared/types/models';
import type { ImageQuality } from '@shared/types/enums';
import { MAX_REFERENCE_IMAGES, type LocalImageReference } from '@shared/types/providers';
import type { SkillRuntimeTraceItem } from '@shared/types/skill-runtime';
import { useAppStore } from '../../../stores/app';
import { useGenerationStore } from '../store';
import { useLibraryStore } from '../../library/store';
import { titleFromPromptContent } from '../../library/prompt-title';
import { REFINE_COUNTS } from '../params';
import { composeRefinementPrompt, useGenerationWorkbenchStore, WORKBENCH_PROMPT_LIMIT } from './store';
import type { GenerationResultItem, GenerationSource, GenerationTurn, RefinementContext } from './types';
import { RatioPicker } from '../components/RatioPicker';
import { ImageLightbox } from '../../../components/ui/image-lightbox';
import { cn } from '../../../lib/utils';
import { toImageSrc } from '../../../lib/media';
import api from '../../../lib/ipc';
import { toast } from '../../../stores/toast';
import { useSettingsStore } from '../../settings/store';
import { useAccountStore } from '../../account/store';
import { MusefoldLogo } from '../../../components/brand/MusefoldLogo';
import { MusefoldAssistantAvatar } from '../../../components/brand/MusefoldAssistantAvatar';
import { ModelBrandIcon } from '../../../components/ui/brand-icons';
import { PromptReferenceSidebar } from './PromptReferenceSidebar';
import { PromptPickerPopover } from './PromptPickerPopover';
import { promptParamsToRefineParams } from '../promptParams';
import { composePromptWithReferences } from './references';
import { linkHistoriesToPrompt } from '../../library/related-history';
import { composePromptWithRatioConstraint } from './promptConstraints';
import {
  composePromptWithImageIndexHint,
  composePromptWithRefinementImageHint,
} from './imageReferences';
import { HistorySourcePicker } from '../../design-schemes/HistorySourcePicker';
import { SkillRuntimeAttachment, SkillRuntimeConversation } from './SkillRuntimeAttachment';
import { useSkillRuntimeStore } from './skillRuntimeStore';
import {
  DESIGN_PLAN_COMMAND_LABEL,
  exactGithubSkillUrl,
  filterCommandHints,
  matchDesignPlanCommand,
  parseDesignPlanBody,
  parseDesignPlanIntent,
} from './composerIntent';
import { SchemeCreationConversation } from '../../design-schemes/SchemeCreationConversation';
import { SchemeRunConversation } from '../../design-schemes/SchemeRunConversation';
import { SchemeRunAttachment, SchemeRunPickerPopover, SchemeRunVariableFields } from '../../design-schemes/SchemeRunComposer';
import { useSchemeRunStore } from '../../design-schemes/runStore';
import { useSchemeCreationStore } from '../../design-schemes/creationStore';

const QUALITY_OPTIONS: { id: ImageQuality; label: string; hint: string }[] = [
  { id: 'auto', label: '自动', hint: '模型默认' },
  { id: 'low', label: '标准', hint: '更快' },
  { id: 'medium', label: '高清', hint: '平衡' },
  { id: 'high', label: '超清', hint: '细节优先' },
];

const EMPTY_DIRECTION_SUGGESTIONS = [
  '漂浮在云层上的小型图书馆，克制电影感，阴天漫射光，细腻阴影',
  '雨夜东京街角，柔和日系生活方式，低饱和自然光，对角线构图',
  '透明背景护肤品主视觉，柔和反射，高端广告质感',
  '现代建筑外立面摄影，蓝调时刻，几何线条，画面干净',
  '海边旧灯塔与潮湿礁石，雾气轻覆，留出宽阔天空',
  '当代陶器与自然织物，窗边晨光，安静的静物摄影',
  '复古旅行海报，颗粒纸张质感，标题留白，颜色克制',
  '山间民宿的木质客厅，清晨薄雾，层次分明的前中后景',
  '新鲜水果的商业静物图，明亮背景，色彩自然，细节清晰',
  '轻户外服装品牌主视觉，山谷环境，人物自然，留出文案空间',
  '关于慢生活的生活方式海报，手工印刷感，构图平衡',
  '夜色中的社区咖啡馆，暖色窗光，街道反射，叙事感',
];

// v0.2.2: 结果网格布局由张数决定，不由模式决定（UI 重构文档 §6.1）。
// 1=单张大图；2=并排；3/4=2 列 2×2；≥5=3 列。
function resultGridClass(count: number): string {
  if (count <= 1) return 'grid-cols-1';
  if (count <= 4) return 'grid-cols-2';
  return 'grid-cols-3';
}

function ratioValue(ratioId: string): number {
  const [width, height] = ratioId.split(':').map(Number);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 1;
  }
  return width / height;
}

function ratioCssValue(ratioId: string): string {
  return String(ratioValue(ratioId));
}

function resultGridMaxWidth(count: number, ratioId: string): string {
  const ratio = ratioValue(ratioId);
  if (count <= 1) return `min(100%, 480px, ${Math.round(46 * ratio * 10) / 10}dvh)`;
  if (count === 2) return `min(100%, 458px, calc(${Math.round(33 * ratio * 2 * 10) / 10}dvh + 10px))`;
  if (count <= 4) return `${Math.round((Math.min(210, 205 * ratio) * 2) + 10)}px`;
  return `${Math.round((Math.min(180, 180 * ratio) * 3) + 20)}px`;
}

function createPromptSuggestions(): string[] {
  const suggestions = [...EMPTY_DIRECTION_SUGGESTIONS];
  for (let index = suggestions.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [suggestions[index], suggestions[randomIndex]] = [suggestions[randomIndex], suggestions[index]];
  }
  return suggestions;
}

gsap.registerPlugin(useGSAP);

export function GenerationWorkbench() {
  const defaultProviderId = useAppStore((s) => s.defaultProviderId);
  const providers = useGenerationStore((s) => s.providers);
  const activeProviderId = useGenerationStore((s) => s.activeProviderId);
  const loadProviders = useGenerationStore((s) => s.loadProviders);
  const refinementContext = useGenerationWorkbenchStore((s) => s.refinementContext);
  const referencesOpen = useAppStore((s) => s.materialLibraryOpen);
  const setReferencesOpen = useAppStore((s) => s.setMaterialLibraryOpen);
  const selectedProvider =
    providers.find((provider) => provider.id === activeProviderId) ??
    providers.find((provider) => provider.id === defaultProviderId) ??
    providers[0] ??
    null;

  useEffect(() => {
    if (providers.length === 0) void loadProviders().catch(() => {});
  }, [loadProviders, providers.length]);

  useEffect(() => {
    if (refinementContext) setReferencesOpen(false);
  }, [refinementContext]);

  return (
    <div className="relative flex h-full min-h-0 flex-col" data-testid="generation-workbench">
      <div className="relative flex min-h-0 flex-1">
        <WorkbenchTimeline />
        {referencesOpen && (
          <PromptReferenceSidebar open={referencesOpen} onClose={() => setReferencesOpen(false)} />
        )}
      </div>
      <WorkbenchComposer />
    </div>
  );
}

function WorkbenchTimeline() {
  const turns = useGenerationWorkbenchStore((s) => s.turns);
  const attachmentsActive = useGenerationWorkbenchStore(
    (s) => s.refinementContext !== null || s.draftImages.length > 0 || s.draftSource.kind === 'scheme',
  );
  const skillSubmittedPrompt = useSkillRuntimeStore((state) => state.submittedPrompt);
  const skillConversationTurnId = useSkillRuntimeStore((state) => state.conversationTurnId);
  const skillTrace = useSkillRuntimeStore((state) => state.trace);
  const pendingSkillConversation = Boolean(skillSubmittedPrompt && !skillConversationTurnId);
  const skillTraceSignal = skillTrace.map((item) => `${item.id}:${item.status}`).join('|');
  const [zoom, setZoom] = useState<{ path: string; prompt: string } | null>(null);
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [nearLatest, setNearLatest] = useState(true);
  const viewportRef = useRef<HTMLDivElement>(null);

  const scrollToLatest = () => {
    const element = viewportRef.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
  };

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    if (turns.length === 0) {
      element.scrollTo({ top: 0 });
      return;
    }
    if (!nearLatest) return;
    element.scrollTo({ top: element.scrollHeight });
  }, [attachmentsActive, nearLatest, pendingSkillConversation, skillTraceSignal, turns.length]);

  return (
    <section
      ref={viewportRef}
      onPointerDown={(event) => {
        if (!(event.target as Element).closest('[data-user-message]')) setActiveMessageId(null);
      }}
      onScroll={(event) => {
        const target = event.currentTarget;
        setNearLatest(target.scrollHeight - target.scrollTop - target.clientHeight < 96);
      }}
      className="relative min-h-0 flex-1 overflow-y-auto"
      data-testid="generation-timeline"
    >
      <div className={cn(
        'mx-auto flex min-h-full w-full max-w-[620px] flex-col px-4 pt-8 sm:px-5',
        attachmentsActive ? 'pb-[292px]' : 'pb-[220px]',
      )}>
        <div className="flex min-h-0 flex-1 flex-col gap-8">
          {turns.length === 0 && !pendingSkillConversation ? (
            <WorkbenchEmpty />
          ) : (
            <>
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
                <PendingSkillConversation prompt={skillSubmittedPrompt} trace={skillTrace} />
              )}
            </>
          )}
        </div>
      </div>
      {!nearLatest && turns.length > 0 && (
        <button
          type="button"
          onClick={scrollToLatest}
          className="no-drag sticky bottom-4 left-1/2 z-10 mx-auto flex -translate-x-1/2 items-center gap-1 rounded-full border border-border-default bg-elevated px-3 py-1.5 text-[11px] text-secondary shadow-sm hover:bg-hover hover:text-primary"
          data-testid="generation-back-latest"
        >
          <ArrowDown className="h-3.5 w-3.5" /> 回到最新
        </button>
      )}
      <ImageLightbox path={zoom?.path ?? null} prompt={zoom?.prompt} onClose={() => setZoom(null)} />
    </section>
  );
}

function PendingSkillConversation({ prompt, trace }: { prompt: string; trace: SkillRuntimeTraceItem[] }) {
  return (
    <article className="space-y-4" data-testid="skill-runtime-pending-turn">
      <div className="ml-auto max-w-[min(88%,460px)] rounded-2xl rounded-br-md bg-inset px-4 py-3 text-[13px] leading-relaxed text-primary">
        <p className="whitespace-pre-wrap break-words">{prompt}</p>
      </div>
      <div className="flex gap-3">
        <MusefoldAssistantAvatar data-testid="skill-runtime-assistant-avatar" />
        <div className="min-w-0 flex-1">
          <div className="mb-1 text-[11px] font-medium text-secondary">Musefold</div>
          <SkillRuntimeConversation trace={trace} />
        </div>
      </div>
    </article>
  );
}

function WorkbenchEmpty() {
  const setPrompt = useGenerationWorkbenchStore((s) => s.setDraftPrompt);
  const reducedMotion = useAppStore((s) => s.reducedMotion);
  const [examples] = useState(createPromptSuggestions);
  const emptyRef = useRef<HTMLDivElement>(null);
  const tickerViewportRef = useRef<HTMLDivElement>(null);
  const tickerRefs = useRef<Array<HTMLDivElement | null>>([]);
  const promptRows = Array.from({ length: 3 }, (_, rowIndex) => examples.slice(rowIndex * 4, rowIndex * 4 + 4));

  useGSAP(() => {
    const media = gsap.matchMedia();
    const startMotion = () => {
      const tickers = tickerRefs.current.filter((ticker): ticker is HTMLDivElement => Boolean(ticker));
      const tweens = tickers.map((ticker, rowIndex) => {
        const firstGroup = ticker.querySelector<HTMLElement>('[data-direction-group]');
        const distance = firstGroup?.getBoundingClientRect().width ?? 0;
        if (!distance) return null;
        const reverse = rowIndex % 2 === 1;
        const duration = Math.max(74, Math.round(distance / 14));
        return gsap.fromTo(
          ticker,
          { x: reverse ? -distance : 0 },
          { x: reverse ? 0 : -distance, duration, ease: 'none', repeat: -1 },
        );
      });
      const brandImage = emptyRef.current?.querySelector<HTMLElement>('[data-brand-hero]');
      const slogan = emptyRef.current?.querySelector<HTMLElement>('[data-brand-slogan]');
      const rows = emptyRef.current?.querySelectorAll<HTMLElement>('[data-direction-row]');
      const intro = gsap.timeline({ defaults: { ease: 'power3.out' } });
      if (brandImage) {
        intro.fromTo(
          brandImage,
          { autoAlpha: 0, y: 8 },
          { autoAlpha: 1, y: 0, duration: 0.7, clearProps: 'transform,opacity,visibility' },
        );
      }
      if (slogan) {
        intro.fromTo(slogan, { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.45 }, '-=0.3');
      }
      if (rows?.length) {
        intro.fromTo(rows, { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.45, stagger: 0.08 }, '-=0.15');
      }
      let intersecting = true;
      let hovered = false;
      let focused = false;
      const syncPlayback = () => {
        const paused = document.hidden || !intersecting || hovered || focused;
        tweens.forEach((tween) => tween?.paused(paused));
      };
      const observer = new IntersectionObserver(([entry]) => {
        intersecting = entry?.isIntersecting ?? true;
        syncPlayback();
      });
      const tickerViewport = tickerViewportRef.current;
      const onPointerEnter = () => { hovered = true; syncPlayback(); };
      const onPointerLeave = () => { hovered = false; syncPlayback(); };
      const onFocusIn = () => { focused = true; syncPlayback(); };
      const onFocusOut = (event: FocusEvent) => {
        focused = event.relatedTarget instanceof Node && Boolean(tickerViewport?.contains(event.relatedTarget));
        syncPlayback();
      };
      if (tickerViewport) {
        observer.observe(tickerViewport);
        tickerViewport.addEventListener('pointerenter', onPointerEnter);
        tickerViewport.addEventListener('pointerleave', onPointerLeave);
        tickerViewport.addEventListener('focusin', onFocusIn);
        tickerViewport.addEventListener('focusout', onFocusOut);
      }
      document.addEventListener('visibilitychange', syncPlayback);
      return () => {
        observer.disconnect();
        intro.kill();
        tweens.forEach((tween) => tween?.kill());
        document.removeEventListener('visibilitychange', syncPlayback);
        tickerViewport?.removeEventListener('pointerenter', onPointerEnter);
        tickerViewport?.removeEventListener('pointerleave', onPointerLeave);
        tickerViewport?.removeEventListener('focusin', onFocusIn);
        tickerViewport?.removeEventListener('focusout', onFocusOut);
      };
    };
    if (reducedMotion === 'on') return () => media.revert();
    if (reducedMotion === 'off') {
      const cleanup = startMotion();
      return () => {
        cleanup();
        media.revert();
      };
    }
    media.add('(prefers-reduced-motion: no-preference)', startMotion);
    return () => media.revert();
  }, { scope: emptyRef, dependencies: [reducedMotion] });

  const handleExample = (example: string) => {
    setPrompt(example);
    // 示例是起始方向，不是确认提交。回填后把焦点交给输入框，方便用户立刻改写。
    window.requestAnimationFrame(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>('[data-workbench-testid="workbench-prompt"]');
      textarea?.focus();
      textarea?.setSelectionRange(example.length, example.length);
    });
  };

  return (
    <div ref={emptyRef} className="flex min-h-[390px] flex-1 flex-col items-center justify-center overflow-hidden px-2 text-center" data-testid="workbench-empty">
      <MusefoldLogo data-brand-hero className="mb-3 w-full max-w-[390px]" />
      <div data-brand-slogan className="space-y-1">
        <h2 className="text-[15px] font-semibold text-primary" data-testid="workbench-empty-slogan">让灵感成为图像。</h2>
        <p className="text-[11px] text-tertiary">从一张图、一段文字或一个方向开始</p>
      </div>
      <div
        ref={tickerViewportRef}
        className="generation-directions-viewport mt-6 w-full max-w-[600px] space-y-1"
        aria-label="创作方向"
        data-testid="generation-directions"
      >
        {promptRows.map((row, rowIndex) => (
          <div key={rowIndex} className="h-7 overflow-hidden" data-direction-row>
            <div
              ref={(element) => { tickerRefs.current[rowIndex] = element; }}
              className="flex w-max will-change-transform"
              data-testid={`generation-directions-ticker-${rowIndex + 1}`}
            >
              {[0, 1].map((group) => (
                <div key={group} className="flex shrink-0 items-center" data-direction-group={group === 0 ? rowIndex : undefined} aria-hidden={group === 1 ? true : undefined}>
                  {row.map((example) => (
                    <span key={`${rowIndex}-${group}-${example}`} className="flex shrink-0 items-center">
                      <button
                        type="button"
                        onClick={() => handleExample(example)}
                        tabIndex={group === 1 ? -1 : 0}
                        className="no-drag whitespace-nowrap px-4 py-1 text-[10.5px] text-tertiary transition-colors hover:text-primary focus-visible:text-primary focus-visible:outline-none"
                        title={example}
                        data-testid={rowIndex === 0 && group === 0 ? 'generation-example' : undefined}
                      >
                        {example}
                      </button>
                      <span className="h-1 w-1 rounded-full bg-border-default" aria-hidden="true" />
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
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
  const isGenerating = useGenerationWorkbenchStore(
    (s) => Object.values(s.runningTurns).some((entry) => entry.sessionId === s.sessionId),
  );
  const setView = useAppStore((s) => s.setView);
  const requestHighlightPrompt = useAppStore((s) => s.requestHighlightPrompt);
  const createPrompt = useLibraryStore((s) => s.createPrompt);
  const provider = useGenerationStore((s) => s.providers.find((item) => item.id === turn.providerId));
  const isDoubaoTurn = provider?.type === 'doubao-web' || turn.providerResponse?.kind === 'doubao-web';
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [savedPromptId, setSavedPromptId] = useState<string | null>(null);
  const [turnMenuOpen, setTurnMenuOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedResultIds, setSelectedResultIds] = useState<string[]>([]);
  const [deselectingResultIds, setDeselectingResultIds] = useState<string[]>([]);
  const [selectionTransitioning, setSelectionTransitioning] = useState(false);
  const [batchSaving, setBatchSaving] = useState(false);
  const selectionTimersRef = useRef<Set<number>>(new Set());
  const successful = turn.results.filter((result) => result.status === 'success');

  useEffect(() => {
    const available = new Set(
      turn.results
        .filter((result) => result.status === 'success' && result.imagePath)
        .map((result) => result.id),
    );
    setSelectedResultIds((ids) => ids.filter((id) => available.has(id)));
    if (available.size < 2) setSelectionMode(false);
  }, [turn.results]);

  useEffect(() => () => {
    selectionTimersRef.current.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const scheduleSelectionUpdate = (callback: () => void, delay = 180) => {
    const timer = window.setTimeout(() => {
      selectionTimersRef.current.delete(timer);
      callback();
    }, delay);
    selectionTimersRef.current.add(timer);
  };

  const animateDeselection = (resultIds: string[]) => {
    if (resultIds.length === 0) return;
    setDeselectingResultIds((ids) => Array.from(new Set([...ids, ...resultIds])));
    scheduleSelectionUpdate(() => {
      setDeselectingResultIds((ids) => ids.filter((id) => !resultIds.includes(id)));
    });
  };

  const enterSelection = (resultId?: string) => {
    if (successful.length < 2) return;
    setSelectionTransitioning(false);
    setSelectionMode(true);
    if (resultId) setSelectedResultIds((ids) => ids.includes(resultId) ? ids : [...ids, resultId]);
    setTurnMenuOpen(false);
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
      if ('cancelled' in saved) return;
      toast.success(`已保存 ${saved.paths.length} 张图片`);
      leaveSelection();
    } catch (error) {
      toast.error('批量保存失败', error instanceof Error ? error.message : '请检查图片与保存目录。');
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
      source: 'manual',
      sourceUrl: firstResult?.historyId ? `history://${firstResult.historyId}` : undefined,
      previewImagePath: firstResult?.imagePath,
    });
    setSavingPrompt(false);
    if (!created) {
      toast.error('存为提示词失败', useLibraryStore.getState().error ?? '请稍后重试。');
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
      title: '已存为提示词',
      description: linkResult == null
        ? `${created.title} · 重启应用后可建立作品关联`
        : `${created.title} · 已关联 ${linkResult.linked + linkResult.alreadyLinked} 条作品`,
      variant: linkResult == null ? 'warning' : 'success',
      action: { label: '查看', onClick: () => requestHighlightPrompt(created.id) },
    });
  };

  const scrollToParent = () => {
    if (!turn.parentHistoryId) return;
    document.querySelector<HTMLElement>(`[data-history-id="${CSS.escape(turn.parentHistoryId)}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const copyUserMessage = async () => {
    const content = turn.userPrompt.trim() || turn.prompt.trim();
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      toast.success('已复制消息');
    } catch {
      toast.error('复制失败', '剪贴板不可用');
    }
  };

  const restoreUserMessage = () => {
    if (isGenerating) return;
    editTurn(turn.id);
    onMessageClose();
    window.setTimeout(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>('[data-workbench-testid="workbench-prompt"]');
      textarea?.focus();
      const length = textarea?.value.length ?? 0;
      textarea?.setSelectionRange(length, length);
    }, 0);
  };

  useEffect(() => {
    if (!turnMenuOpen) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!(event.target as Element).closest('[data-turn-menu]')) setTurnMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTurnMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOnPointerDown);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [turnMenuOpen]);

  return (
    <article className="space-y-4" data-testid={`generation-turn-${turn.id}`} data-status={turn.status}>
      <div
        className="ml-auto flex max-w-[min(88%,460px)] flex-col items-end pl-10"
        data-user-message
        data-testid="generation-user-message"
        tabIndex={0}
        onClick={(event) => {
          if ((event.target as Element).closest('button, summary, a')) return;
          onMessageActivate();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onMessageActivate();
          }
          if (event.key === 'Escape') onMessageClose();
        }}
      >
        {/* 引用与附件一律在消息气泡上方（Codex 式）：方案 / Skill / 图片 / 提示词引用。 */}
        {(turn.source.kind === 'skill'
          || turn.source.kind === 'scheme-run'
          || (turn.source.kind === 'scheme-creation' && turn.source.githubUrl)
          || turn.referenceImages.length > 0
          || turn.references.length > 0) && (
          <div className="mb-1.5 flex max-w-full flex-col items-end gap-1.5" data-testid="generation-message-attachments">
            {turn.source.kind === 'scheme-run' && (
              <button
                type="button"
                onClick={() => useAppStore.getState().requestSchemeCenter({ detailId: turn.source.kind === 'scheme-run' ? turn.source.schemeId : undefined })}
                className="flex max-w-full items-center gap-2 rounded-lg border border-border-subtle bg-elevated px-2.5 py-1.5 text-left transition-colors hover:border-border-default hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
                title="查看方案详情"
                data-testid="generation-scheme-run-reference"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent" aria-hidden>
                  <Blocks className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[10.5px] font-medium text-primary">{turn.source.label}</span>
                  <span className="block text-[9px] text-tertiary">
                    {turn.source.mode === 'trial' ? '设计方案 · 试运行' : '引用设计方案'}
                    {turn.source.isRepairRun ? ' · 修复重跑' : ''}
                  </span>
                </span>
              </button>
            )}
            {turn.source.kind === 'skill' && (
              <div
                className="flex max-w-full items-center gap-2 rounded-lg border border-border-subtle bg-elevated px-2.5 py-1.5"
                title={turn.source.repositoryUrl}
                data-testid="generation-skill-reference"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent" aria-hidden>
                  <GitBranch className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[10.5px] font-medium text-primary">{turn.source.label}</span>
                  <span className="block text-[9px] text-tertiary">
                    {turn.source.executionMode === 'direct-forward' ? 'GitHub Skill · 直传豆包' : 'GitHub Skill'}
                  </span>
                </span>
              </div>
            )}
            {turn.source.kind === 'scheme-creation' && turn.source.githubUrl && (
              <div
                className="flex max-w-full items-center gap-2 rounded-lg border border-border-subtle bg-elevated px-2.5 py-1.5"
                title={turn.source.githubUrl}
                data-testid="generation-scheme-creation-reference"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent" aria-hidden>
                  <GitBranch className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[10.5px] font-medium text-primary">{turn.source.label}</span>
                  <span className="block text-[9px] text-tertiary">方案来源</span>
                </span>
              </div>
            )}
            {turn.referenceImages.length > 0 && (
              <div className="flex max-w-full gap-1.5 overflow-x-auto" data-testid="generation-user-reference-images">
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
                    <img src={toImageSrc(image.path)} alt={`图 ${index + 1}`} className="h-16 w-16 object-contain" />
                    <span className="absolute bottom-1 left-1 rounded bg-black/65 px-1 py-0.5 text-[8px] leading-none text-white">图 {index + 1}</span>
                  </button>
                ))}
              </div>
            )}
            {turn.references.length > 0 && (
              <div className="flex max-w-full flex-wrap justify-end gap-1.5" data-testid="generation-reference-count">
                {turn.references.map((reference, index) => (
                  <span
                    key={`${reference.promptId}:${index}`}
                    className="inline-flex h-[22px] max-w-[200px] items-center gap-1 rounded-md border border-border-subtle bg-elevated px-1.5 text-[10.5px] font-medium leading-none text-primary"
                    title={reference.text.length > 300 ? `${reference.text.slice(0, 300)}…` : reference.text}
                    data-testid="generation-reference-chip"
                    data-reference-scope={reference.scope}
                  >
                    <FileText className="h-3 w-3 shrink-0 text-secondary" />
                    <span className="min-w-0 truncate">{reference.title}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
        <div className={cn(
          'max-w-full rounded-2xl rounded-br-md bg-inset px-4 py-3 text-[13px] leading-relaxed text-primary transition-shadow',
          messageActionsOpen && 'ring-1 ring-border-default',
        )}>
          <div className="mb-1.5 flex items-center justify-end gap-2 text-[10px] text-tertiary">
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
            <span>{turn.source.kind === 'scheme-creation' ? '创建设计方案' : formatParams(turn.params)}</span>
          </div>
          {turn.source.kind === 'scheme-creation' && (
            <span
              className="mb-1.5 inline-flex h-6 items-center gap-1.5 rounded-md bg-accent-soft px-2 text-[10.5px] font-medium text-accent"
              data-testid="generation-command-tag"
            >
              <Wand2 className="h-3 w-3" /> {DESIGN_PLAN_COMMAND_LABEL}
            </span>
          )}
          <p className="whitespace-pre-wrap break-words" data-testid="generation-prompt">
            {turn.userPrompt || (turn.source.kind === 'scheme-creation' ? '基于来源仓库创建设计方案' : turn.userPrompt)}
          </p>
          {turn.negativePrompt && <p className="mt-2 border-t border-border-subtle pt-2 text-[11px] text-secondary">排除：{turn.negativePrompt}</p>}
        </div>
        {messageActionsOpen && (
          <div className="mt-1.5 flex items-center gap-1 animate-fade-in" data-testid="generation-user-message-actions">
            <button type="button" onClick={() => void copyUserMessage()} className="action-button" data-testid="generation-user-message-copy">
              <Copy className="h-3 w-3" /> 复制
            </button>
            <button type="button" onClick={restoreUserMessage} disabled={isGenerating} className="action-button disabled:cursor-not-allowed disabled:opacity-45" data-testid="generation-user-message-edit">
              <Pencil className="h-3 w-3" /> 编辑
            </button>
          </div>
        )}
      </div>

      <div className="flex gap-3" data-testid="generation-result-group">
        {isDoubaoTurn ? (
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#2f6bff] text-white shadow-sm"
            aria-label="豆包"
            data-testid="doubao-generation-avatar"
          >
            <ModelBrandIcon model="doubao" className="h-[18px] w-[18px]" />
          </span>
        ) : (
          <MusefoldAssistantAvatar data-testid="generation-assistant-avatar" />
        )}
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center gap-2 text-[11px] text-tertiary">
            <span className="font-medium text-secondary">
              {isDoubaoTurn
                ? turn.referenceImages.length > 0 ? '豆包网页改图' : '豆包网页生图'
                : 'Musefold'}
            </span>
            {isDoubaoTurn ? (
              <span>· Seedream 4.5 · 本机浏览器会话</span>
            ) : provider ? (
              <span>· {provider.name}</span>
            ) : null}
          </div>
          {turn.source.kind === 'skill' && (
            <SkillRuntimeConversation
              trace={turn.source.trace}
              doneLabel={turn.source.executionMode === 'direct-forward' ? '已将 Skill 转发给豆包' : '已完成 Skill 调用'}
            />
          )}
          {turn.source.kind === 'scheme-creation' && <SchemeCreationConversation source={turn.source} />}
          {turn.source.kind === 'scheme-run' && <SchemeRunConversation turnId={turn.id} source={turn.source} />}
          {/* Skill 轮在 Agent 阅读/编排阶段没有结果占位；生图真正开始后才补建卡片。 */}
          {turn.results.length > 0 && (<>
          <div
            className={cn(
              'grid items-start gap-2.5',
              // v0.2.2: 结果布局跟数量走，不跟模式走（UI 重构文档 §6.1）。
              // 1=单张大图；2=并排；3/4=2 列；≥5=3 列。
              resultGridClass(turn.results.length),
            )}
            style={{ maxWidth: resultGridMaxWidth(turn.results.length, turn.params.ratioId) }}
            data-testid="refine-results"
            data-workbench-results="true"
            data-provider={isDoubaoTurn ? 'doubao-web' : undefined}
          >
            {turn.results.map((result) => (
              <GenerationResultCard
                key={result.id}
                result={result}
                aspectRatio={turn.params.ratioId}
                busy={turn.status === 'running'}
                onZoom={onZoom}
                onRetry={() => void retryResult(turn.id, result.id)}
                showRefineAction={turn.results.length > 1}
                refinementEnabled
                onRefine={() => startRefinement(turn.id, result.id)}
                onHistory={() => setView('history')}
                selectionEnabled={successful.length > 1}
                selectionMode={selectionMode}
                selected={selectedResultIds.includes(result.id)}
                deselecting={deselectingResultIds.includes(result.id)}
                refinementTargetDisabled={isGenerating || selectionTransitioning}
                onEnterSelection={() => enterSelection(result.id)}
                onToggleSelection={() => toggleSelection(result.id)}
                onSetAsRefinementTarget={() => chooseRefinementTarget(result.id)}
              />
            ))}
          </div>
          <div data-testid="generation-selection-toolbar">
          <div
            className="mt-2 flex flex-wrap items-center gap-1.5"
            role={selectionMode ? 'toolbar' : undefined}
            aria-label={selectionMode ? '图片批量选择' : undefined}
            data-testid="generation-turn-actions"
          >
            {selectionMode && (
              <>
                <span className="mr-0.5 text-[11px] text-secondary">已选择 {selectedResultIds.length} 张</span>
                <button type="button" onClick={leaveSelection} className="action-button" data-testid="generation-selection-cancel">
                  <X className="h-3 w-3" /> 取消
                </button>
                <button
                  type="button"
                  onClick={() => void saveSelectedImages()}
                  disabled={selectedResultIds.length === 0 || batchSaving}
                  className="action-button disabled:cursor-not-allowed disabled:opacity-45"
                  data-testid="generation-batch-download"
                >
                  {batchSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                  保存所选
                </button>
              </>
            )}
            {!selectionMode && (
              <>
            {successful.length > 0 && (
              <>
                {turn.results.length === 1 && (
                  <button
                    type="button"
                    onClick={() => startRefinement(turn.id, successful[0].id)}
                    className="action-button bg-accent-soft text-accent hover:bg-accent/20"
                    data-testid="generation-refine-turn"
                  >
                    <GitBranch className="h-3 w-3" /> 继续微调
                  </button>
                )}
                {successful.length > 1 && !selectionMode && (
                  <button
                    type="button"
                    onClick={() => enterSelection()}
                    className="action-button"
                    data-testid="generation-select-images"
                  >
                    <ListChecks className="h-3 w-3" /> 选择图片
                  </button>
                )}
              </>
            )}
            <div className="relative" data-turn-menu>
              <button
                type="button"
                onClick={() => setTurnMenuOpen((open) => !open)}
                className="action-button"
                aria-haspopup="menu"
                aria-expanded={turnMenuOpen}
                data-testid="generation-turn-more"
              >
                <MoreHorizontal className="h-3 w-3" /> 更多
              </button>
              {turnMenuOpen && (
                <div role="menu" className="absolute bottom-[calc(100%+5px)] left-0 z-30 w-44 rounded-md border border-border-default bg-popover p-1 shadow-pop">
                  {successful[0] && (
                    <button type="button" role="menuitem" onClick={() => { reuseResult(turn.id, successful[0].id); setTurnMenuOpen(false); }} className="menu-action">
                      <RefreshCw className="h-3 w-3" /> 再次制作
                    </button>
                  )}
                  {turn.prompt.trim() && turn.status !== 'running' && (
                    <button type="button" role="menuitem" onClick={() => { void savePrompt(); setTurnMenuOpen(false); }} disabled={savingPrompt || Boolean(savedPromptId)} className="menu-action disabled:opacity-50" data-testid="generation-save-prompt">
                      {savedPromptId ? <Check className="h-3 w-3" /> : <BookmarkPlus className="h-3 w-3" />}
                      {savedPromptId ? '已存为提示词' : savingPrompt ? '保存中' : '存为提示词'}
                    </button>
                  )}
                  <button type="button" role="menuitem" onClick={() => { setView('history'); setTurnMenuOpen(false); }} className="menu-action">
                    <History className="h-3 w-3" /> 查看生成历史
                  </button>
                </div>
              )}
            </div>
              </>
            )}
          </div>
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
                    'tabular-nums',
                    turn.providerResponse.receivedImageCount < turn.providerResponse.expectedImageCount
                      ? 'text-warning'
                      : 'text-tertiary',
                  )}
                  data-testid="doubao-generation-count"
                >
                  1 次网页请求 · 返回 {turn.providerResponse.receivedImageCount} / {turn.providerResponse.expectedImageCount} 张
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
          </>)}
        </div>
      </div>
    </article>
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
}) {
  const [broken, setBroken] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const setView = useAppStore((state) => state.setView);
  const setSettingsSection = useSettingsStore((state) => state.setSection);
  const cardRef = useRef<HTMLDivElement>(null);
  const longPressTimer = useRef<number | null>(null);
  const longPressStart = useRef<{ x: number; y: number } | null>(null);
  const longPressTriggered = useRef(false);
  const canAct = result.status === 'success' && Boolean(result.imagePath) && !broken;

  useEffect(() => {
    setBroken(false);
  }, [result.imagePath, result.status]);

  useEffect(() => {
    return () => {
      if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!cardRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOnPointerDown);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown);
      document.removeEventListener('keydown', closeOnEscape);
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
    if (!selectionEnabled || !canAct || event.pointerType === 'mouse' && event.button !== 0) return;
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
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) clearLongPress();
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
      if ('cancelled' in saved) return;
      toast.success('图片已另存');
    } catch (error) {
      toast.error('另存失败', error instanceof Error ? error.message : '文件可能已被移动或删除。');
    }
  };

  const copyImage = async () => {
    if (!result.imagePath) return;
    try {
      await api.system.copyImage(result.imagePath);
      toast.success('已复制图片');
    } catch (error) {
      toast.error('复制图片失败', error instanceof Error ? error.message : '图片可能已被移动或删除。');
    }
  };

  const openFolder = async () => {
    if (!result.imagePath) return;
    try {
      await api.system.openInFolder(result.imagePath);
    } catch {
      toast.error('打开目录失败', '文件可能已被移动或删除。');
    }
  };

  return (
    <div
      ref={cardRef}
      className={cn(
        'group relative overflow-hidden rounded-lg border bg-elevated transition-[border-color,box-shadow] hover:border-border-default',
        selected || deselecting ? 'border-accent ring-1 ring-accent/45' : 'border-border-subtle',
      )}
      data-testid="generate-result-card"
      data-status={result.status}
      data-history-id={result.historyId}
      data-selected={selected || undefined}
      data-deselecting={deselecting || undefined}
    >
      <div
        className={cn('relative', (!canAct || broken) && 'bg-inset')}
        style={{ aspectRatio: ratioCssValue(aspectRatio) }}
      >
        {result.status === 'success' && result.imagePath && !broken ? (
          <button
            type="button"
            className={cn('relative block h-full w-full select-none', selectionMode ? 'cursor-pointer' : 'cursor-zoom-in')}
            onClick={handleImageClick}
            onPointerDown={startLongPress}
            onPointerMove={handlePointerMove}
            onPointerUp={clearLongPress}
            onPointerCancel={clearLongPress}
            onPointerLeave={clearLongPress}
            onContextMenu={(event) => {
              if (!selectionEnabled) return;
              event.preventDefault();
              onEnterSelection();
            }}
            title={selectionMode ? (selected ? '取消选择' : '选择图片') : selectionEnabled ? '查看大图；长按选择图片' : '查看大图'}
            aria-label={selectionMode ? (selected ? '取消选择图片' : '选择图片') : '查看大图'}
            data-testid="result-zoom"
          >
            <img src={toImageSrc(result.imagePath)} alt="生成结果" draggable={false} onError={() => setBroken(true)} className="block h-full w-full object-contain" />
            {selectionMode && (
              <span
                className={cn(
                  'absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full border text-white',
                  selected || deselecting ? 'border-accent bg-accent' : 'border-white/80 bg-black/35',
                  deselecting && 'animate-selection-release',
                )}
                aria-hidden="true"
                data-testid="result-selection-toggle"
              >
                {(selected || deselecting) && <Check className="h-3.5 w-3.5" />}
              </span>
            )}
          </button>
        ) : result.status === 'pending' ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-tertiary">
            <Loader2 className="h-5 w-5 animate-spin text-accent" />
            <span className="text-[10.5px]" data-testid={result.retrying ? 'generation-retrying' : 'generation-pending'}>
              {result.retrying && result.retryAttempt && result.retryMax
                ? `重试中（第 ${result.retryAttempt}/${result.retryMax} 次）`
                : '正在生成'}
            </span>
          </div>
        ) : result.status === 'cancelled' ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-tertiary">
            <X className="h-5 w-5" />
            <span className="text-[10.5px]">已取消</span>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-danger">
            {broken ? <ImageOff className="h-5 w-5" /> : <X className="h-5 w-5" />}
            <span className="line-clamp-3 text-[10.5px]">{result.error ?? '图片无法加载'}</span>
            {result.errorCode === 'ACCOUNT/QUOTA' ? (
              // 额度不足：就地兑换并自动重试，不跳出工作台（走查 P1-5）。
              <InlineQuotaRedeem onRetry={onRetry} disabled={busy} />
            ) : result.errorCode?.startsWith('ACCOUNT/') ? (
              <button
                type="button"
                className="no-drag mt-1 rounded-full border border-danger/35 px-3 py-1 text-[10px] font-medium text-danger transition-colors hover:border-danger"
                onClick={() => {
                  setSettingsSection(
                    result.errorCode === 'ACCOUNT/MODEL_NOT_FOUND' ? 'providers' : 'account',
                  );
                  setView('settings');
                }}
              >
                {result.errorCode === 'ACCOUNT/AUTH' ? '重新登录' : '选择可用模型'}
              </button>
            ) : null}
          </div>
        )}
        {canAct && refinementEnabled && selectionMode && selected && !deselecting && (
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
        )}
        {canAct && !selectionMode && (
          <div className="absolute inset-x-2 bottom-2 flex items-center justify-between opacity-0 transition-opacity group-hover:opacity-100">
            <div className="flex items-center gap-1 rounded-md border border-white/15 bg-black/75 p-1 text-white">
              <button type="button" onClick={() => void saveImage()} title="另存图片" aria-label="另存图片" data-testid="result-save" className="icon-action"><Download className="h-3.5 w-3.5" /></button>
              <button type="button" onClick={() => void copyImage()} title="复制图片" aria-label="复制图片" data-testid="result-copy-image" className="icon-action"><Copy className="h-3.5 w-3.5" /></button>
              {showRefineAction && (
                <button type="button" onClick={onRefine} title="以这张图继续微调" aria-label="以这张图继续微调" data-testid="result-refine" className="icon-action"><GitBranch className="h-3.5 w-3.5" /></button>
              )}
            </div>
            <button type="button" onClick={() => setMenuOpen((value) => !value)} title="更多操作" aria-label="更多操作" data-testid="result-more" className="icon-action rounded-md border border-white/15 bg-black/75 text-white"><MoreHorizontal className="h-3.5 w-3.5" /></button>
            {menuOpen && (
              <div className="absolute bottom-9 right-0 z-20 w-36 overflow-hidden rounded-md border border-border-default bg-popover py-1 text-[11px] shadow-pop">
                <button type="button" onClick={() => { void openFolder(); setMenuOpen(false); }} className="menu-action" data-testid="result-open-folder"><FolderOpen className="h-3 w-3" /> 打开所在目录</button>
                <button type="button" onClick={() => { onHistory(); setMenuOpen(false); }} className="menu-action" data-testid="result-history"><History className="h-3 w-3" /> 查看生成历史</button>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-border-subtle px-2 py-1.5 text-[10px] text-tertiary">
        <span className="truncate">{result.status === 'success' ? `${result.durationMs ?? 0}ms` : result.retrying ? '重试中' : result.errorCode ?? result.status}</span>
        <div className="flex items-center gap-1">
          {(result.status === 'failed' || result.status === 'cancelled') && (
            <button type="button" onClick={onRetry} disabled={busy} title="重试" aria-label="重试" data-testid="result-retry" className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-tertiary hover:bg-hover hover:text-primary disabled:opacity-40"><RefreshCw className="h-3 w-3" /></button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 额度不足的就地恢复：在失败卡上直接兑换，成功后自动重试本张。
 * 规格依据 v0.5 产品文档 §5「就地兑换、原地重试」。
 */
function InlineQuotaRedeem({ onRetry, disabled }: { onRetry: () => void; disabled?: boolean }) {
  const redeem = useAccountStore((s) => s.redeem);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
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
      setMessage('已到账，正在重试…');
      setOpen(false);
      onRetry();
    } catch (error) {
      const e = error as { message?: string };
      setMessage(e?.message || '兑换失败，请检查兑换码后重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="mt-1 flex w-full max-w-[190px] flex-col items-stretch gap-1.5" onSubmit={submit}>
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
          {busy ? '兑换中…' : '兑换并重试'}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setMessage(null); }}
          className="no-drag rounded-full px-2 py-1 text-[10px] text-tertiary transition-colors hover:text-primary"
        >
          取消
        </button>
      </div>
      {message && <span className="text-center text-[9.5px] leading-relaxed">{message}</span>}
    </form>
  );
}

function WorkbenchComposer() {
  const prompt = useGenerationWorkbenchStore((s) => s.draftPrompt);
  const negative = useGenerationWorkbenchStore((s) => s.draftNegativePrompt);
  const source = useGenerationWorkbenchStore((s) => s.draftSource);
  const draftCommand = useGenerationWorkbenchStore((s) => s.draftCommand);
  const setDraftCommand = useGenerationWorkbenchStore((s) => s.setDraftCommand);
  const draftHistorySource = useGenerationWorkbenchStore((s) => s.draftHistorySource);
  const setDraftHistorySource = useGenerationWorkbenchStore((s) => s.setDraftHistorySource);
  const references = useGenerationWorkbenchStore((s) => s.draftReferences);
  const draftImages = useGenerationWorkbenchStore((s) => s.draftImages);
  const params = useGenerationWorkbenchStore((s) => s.params);
  const hasTurns = useGenerationWorkbenchStore((s) => s.turns.length > 0);
  // 并行生成：单飞锁按对话粒度——只有当前对话有运行中的轮次时，
  // Composer 才进入「运行态」（停止按钮、锁添加图片、禁提交）；
  // 其他对话不受影响，可以照常提交生成。
  const generatingHere = useGenerationWorkbenchStore(
    (s) => Object.values(s.runningTurns).some((entry) => entry.sessionId === s.sessionId),
  );
  /** 当前对话运行中轮次的类型（停止按钮按类型走对应管线的取消）。 */
  const runningKindHere = useGenerationWorkbenchStore(
    (s) => Object.values(s.runningTurns).find((entry) => entry.sessionId === s.sessionId)?.kind ?? null,
  );
  const cancelRequested = useGenerationWorkbenchStore(
    (s) => Object.values(s.runningTurns).some((entry) => entry.sessionId === s.sessionId && entry.cancelRequested),
  );
  const refinementContext = useGenerationWorkbenchStore((s) => s.refinementContext);
  const refinementTurn = useGenerationWorkbenchStore((s) =>
    s.refinementContext ? s.turns.find((turn) => turn.id === s.refinementContext?.turnId) : undefined,
  );
  const setPrompt = useGenerationWorkbenchStore((s) => s.setDraftPrompt);
  const setNegative = useGenerationWorkbenchStore((s) => s.setDraftNegativePrompt);
  const setParams = useGenerationWorkbenchStore((s) => s.setParams);
  const setSource = useGenerationWorkbenchStore((s) => s.setDraftSource);
  const clearSource = useGenerationWorkbenchStore((s) => s.clearDraftSource);
  const addReference = useGenerationWorkbenchStore((s) => s.addDraftReference);
  const removeReference = useGenerationWorkbenchStore((s) => s.removeDraftReference);
  const addDraftImages = useGenerationWorkbenchStore((s) => s.addDraftImages);
  const removeDraftImage = useGenerationWorkbenchStore((s) => s.removeDraftImage);
  const submit = useGenerationWorkbenchStore((s) => s.submitDraft);
  const submitRefinement = useGenerationWorkbenchStore((s) => s.submitRefinement);
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
  const composerMenuRef = useRef<HTMLDivElement>(null);
  const composerMenuTriggerRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const animationFrame = window.requestAnimationFrame(() => {
      const rect = composerSurfaceRef.current?.getBoundingClientRect();
      if (!rect || typeof api.pet.runToComposer !== 'function') return;
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
  const skillRuntimeAttachment = useSkillRuntimeStore((state) => state.attachment);
  const skillRuntimeSourceUrl = useSkillRuntimeStore((state) => state.sourceUrl);
  const attachGithubSkill = useSkillRuntimeStore((state) => state.attachGithub);
  const executeGithubSkill = useSkillRuntimeStore((state) => state.execute);
  const removeGithubSkill = useSkillRuntimeStore((state) => state.remove);
  const cancelSkillExecution = useSkillRuntimeStore((state) => state.cancelExecution);
  const providers = useGenerationStore((s) => s.providers);
  const activeProviderId = useGenerationStore((s) => s.activeProviderId);
  const defaultProviderId = useAppStore((s) => s.defaultProviderId);
  const activeProvider =
    providers.find((provider) => provider.id === activeProviderId) ??
    providers.find((provider) => provider.id === defaultProviderId) ??
    providers[0] ??
    null;
  const submissionProvider = refinementTurn
    ? providers.find((provider) => provider.id === refinementTurn.providerId) ?? null
    : activeProvider;
  const doubaoImageMode = submissionProvider?.type === 'doubao-web';
  const schemeCreating = useSchemeCreationStore((state) => state.creating);
  const startSchemeCreation = useSchemeCreationStore((state) => state.start);
  const startSchemeModify = useSchemeCreationStore((state) => state.startModify);
  const cancelSchemeCreation = useSchemeCreationStore((state) => state.cancel);
  const schemeInputValues = useGenerationWorkbenchStore((s) => s.schemeInputValues);
  const executeSchemeRun = useSchemeRunStore((state) => state.execute);
  const cancelSchemeRun = useSchemeRunStore((state) => state.cancel);
  // 方案运行管线是单例：另一对话的方案运行未结束时，本对话的方案提交暂不可用。
  const schemeRunBusy = useSchemeRunStore((state) => state.running);
  const handleCancel = () => {
    // 只取消当前对话的运行；其他对话的并行运行不受影响。
    if (runningKindHere === 'skill') void cancelSkillExecution();
    else if (runningKindHere === 'scheme-creation') void cancelSchemeCreation();
    else if (runningKindHere === 'scheme-run') void cancelSchemeRun();
    void cancel();
  };
  const schemeSource = source.kind === 'scheme' ? source : null;
  const doubaoRefinement = Boolean(refinementTurn && doubaoImageMode);
  const unconstrainedPrompt = refinementTurn
    ? doubaoRefinement
      ? prompt.trim()
      : composeRefinementPrompt(refinementTurn.prompt, prompt)
    : composePromptWithReferences(prompt, references);
  const referenceImageCount = (refinementContext?.images.length ?? 0) + draftImages.length;
  const composedPrompt = doubaoRefinement
    ? unconstrainedPrompt
    : composePromptWithRatioConstraint(
        refinementContext
          ? composePromptWithRefinementImageHint(unconstrainedPrompt, referenceImageCount)
          : composePromptWithImageIndexHint(unconstrainedPrompt, referenceImageCount),
        refinementTurn?.params.ratioId ?? params.ratioId,
      );
  const overLimit = composedPrompt.length > WORKBENCH_PROMPT_LIMIT;
  // 指令芯片挂载后整段输入都是正文；未挂载时兼容直接输入完整指令的旧路径。
  const designPlanIntent = draftCommand === 'design-plan'
    ? parseDesignPlanBody(prompt)
    : parseDesignPlanIntent(prompt);
  const historyAttached = Boolean(draftHistorySource?.items.length);
  const designPlanReady = Boolean(
    !doubaoImageMode
    &&
    designPlanIntent
    && (designPlanIntent.prompt || designPlanIntent.githubUrl || skillRuntimeStatus === 'ready' || historyAttached),
  );
  // / 指令建议：随输入实时筛选；Esc 临时收起，输入变化后恢复。
  const commandHints = draftCommand || doubaoImageMode ? [] : filterCommandHints(prompt);
  const commandHintsVisible = commandHints.length > 0 && !commandHintsDismissed;
  const activeCommandHintIndex = Math.min(commandHintIndex, Math.max(0, commandHints.length - 1));
  const selectCommandHint = () => {
    setDraftCommand('design-plan');
    setPrompt('');
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
    const chips = container ? (Array.from(container.children) as HTMLElement[]) : [];
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
    skillRuntimeStatus === 'ready'
    && prompt.trim()
    && submissionProvider?.hasKey
    && !generatingHere
    && !overLimit,
  );
  const skillIsAttached = !['idle', 'complete'].includes(skillRuntimeStatus);
  const skillComposerAttachmentVisible = ['detecting', 'ready', 'error'].includes(skillRuntimeStatus);
  const ordinaryCanSubmit = !skillIsAttached && !schemeSource && Boolean(
    (prompt.trim() || (!refinementContext && references.length > 0))
    && submissionProvider?.hasKey
    && !generatingHere
    && !overLimit,
  );
  const schemeModifyMode = schemeSource?.mode === 'modify';
  // 方案运行：必填文本槽位要有值，必填图片槽位按数量核对；自由补充可以为空。
  const schemeRequiredImages = schemeSource
    ? schemeSource.inputs
        .filter((slot) => slot.required && (slot.kind === 'image' || slot.kind === 'image-set'))
        .reduce((total, slot) => total + Math.max(1, slot.minItems ?? 1), 0)
    : 0;
  const schemeRequiredReady = Boolean(
    schemeSource
    && draftImages.length >= schemeRequiredImages
    && schemeSource.inputs.every((slot) => {
      if (!slot.required || slot.kind === 'image' || slot.kind === 'image-set') return true;
      return Boolean(schemeInputValues[slot.id]?.trim());
    }),
  );
  const schemeCanSubmit = Boolean(
    schemeSource
    && !schemeModifyMode
    && schemeRequiredReady
    && submissionProvider?.hasKey
    && !generatingHere
    && !schemeRunBusy
    && !overLimit,
  );
  // 修改方案：输入是发给 Agent 的修改要求，不需要生图 Provider。
  const schemeModifyCanSubmit = Boolean(
    !doubaoImageMode
    &&
    schemeModifyMode
    && prompt.trim()
    && !generatingHere
    && !schemeCreating,
  );
  const canSubmit = ordinaryCanSubmit || skillCanSubmit || schemeCanSubmit || schemeModifyCanSubmit || Boolean(
    designPlanReady
    && !generatingHere
    && skillRuntimeStatus !== 'detecting'
    && skillRuntimeStatus !== 'executing',
  );
  const handleClearSource = () => {
    const current = source;
    clearSource();
    if (current.kind === 'prompt' && current.id) {
      const index = references.findIndex((item) => item.promptId === current.id);
      if (index >= 0) removeReference(index);
    }
  };
  const effectiveGenerationParams = doubaoImageMode ? { ...params, n: 1 } : params;
  const effectiveImageCount = effectiveGenerationParams.n;
  const imageBusy = imageStaging;
  const stageImageFiles = async (files: File[]) => {
    if (imageBusy || generatingHere) return;
    const validFiles = files.filter((file) => file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(file.name));
    if (validFiles.length !== files.length) {
      toast.error('未能加入图片', '请选择 PNG、JPG 或 WebP 图片');
    }
    const remaining = Math.max(0, MAX_REFERENCE_IMAGES - referenceImageCount);
    const accepted = validFiles.slice(0, remaining);
    if (accepted.length === 0) {
      toast.error('图片已达上限', `最多同时加入 ${MAX_REFERENCE_IMAGES} 张图片`);
      return;
    }
    setImageStaging(true);
    try {
      const staged: LocalImageReference[] = [];
      for (const file of accepted) {
        const result = await api.image.stageLocal({
          bytes: new Uint8Array(await file.arrayBuffer()),
          name: file.name || 'clipboard-image.png',
          mimeType: file.type || undefined,
        });
        if (!result.ok) {
          toast.error('未能加入图片', result.error.message);
          continue;
        }
        staged.push(...result.images);
      }
      if (staged.length > 0) addDraftImages(staged);
      if (validFiles.length > accepted.length) {
        toast.show({ title: `已加入 ${accepted.length} 张图片`, description: `最多支持 ${MAX_REFERENCE_IMAGES} 张，超出的图片未加入。`, variant: 'warning' });
      }
    } catch (error) {
      toast.error('未能加入图片', error instanceof Error ? error.message : '图片读取失败，请重新添加');
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
    toast.show({ title: '粘贴 GitHub Skill 地址', description: '把公开仓库、Skill 目录或 SKILL.md 地址直接粘贴到 Composer。' });
  };
  const startDesignCreation = async (seed: string, explicitGithubUrls?: string[]) => {
    setComposerMenuOpen(false);
    if (schemeCreating || generatingHere) return;
    // 已粘贴的 Skill 芯片自动转为方案来源（用户决策：地址随创建吸收）。
    const chipUrl = skillRuntimeStatus === 'ready' ? skillRuntimeSourceUrl ?? undefined : undefined;
    const inlineUrls = seed.match(/https:\/\/github\.com\/[^\s]+/gi) ?? [];
    // 多个地址合并编译为一个组合方案（P3）；去重保持出现顺序。
    const sourceUrls = [...new Set([...(explicitGithubUrls ?? []), ...(chipUrl ? [chipUrl] : []), ...inlineUrls])];
    const history = useGenerationWorkbenchStore.getState().draftHistorySource ?? undefined;
    let brief = seed;
    for (const url of sourceUrls) brief = brief.split(url).join(' ');
    brief = brief.replace(/\s+/g, ' ').trim();
    if (!brief && sourceUrls.length === 0 && !history?.items.length) {
      toast.show({ title: '先描述你的方案想法', description: '输入一段话，或粘贴一个 GitHub Skill 地址，再创建设计方案。' });
      textareaRef.current?.focus();
      return;
    }
    // 提交后指令已被消费，避免等待 Agent/安装确认期间仍显示可重复提交的芯片。
    setDraftCommand(null);
    if (skillRuntimeStatus !== 'idle') await removeGithubSkill();
    await startSchemeCreation(brief, sourceUrls, history);
  };
  const handleSubmit = async () => {
    if (!canSubmit) return;
    if (designPlanIntent) {
      await startDesignCreation(designPlanIntent.prompt, designPlanIntent.githubUrls);
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
    if (skillRuntimeAttachment && skillRuntimeStatus === 'ready' && submissionProvider) {
      // 豆包由主进程直传粘贴的 Skill 文件；其他 Provider 保持 Agent 优先。
      // 两条路径都通过事件流实时渲染，这里只发起并等待收尾。
      const userPrompt = prompt.trim();
      const userImages = draftImages.map((image) => ({ ...image }));
      const execution = await executeGithubSkill({
        userPrompt,
        userImages,
        provider: { id: submissionProvider.id, name: submissionProvider.name, type: submissionProvider.type },
        params: { ...effectiveGenerationParams },
      });
      if (!execution) {
        toast.error('Skill 执行失败', useSkillRuntimeStore.getState().error || '请重新粘贴 Skill 地址后再试');
        return;
      }
      if (execution.mode === 'file-fallback') {
        toast.show({
          title: '已使用 Skill 文件生成',
          description: execution.fallbackReason ? `Agent 暂时不可用：${execution.fallbackReason}` : 'Agent 暂时不可用，已改用仓库附件。',
          variant: 'warning',
        });
      } else if (execution.mode === 'direct-forward') {
        toast.success('已将粘贴的 Skill 直接转发给豆包', '本次没有调用 Agent。');
      }
      return;
    }
    if (refinementContext) {
      void submitRefinement(refinementContext.turnId, refinementContext.resultId, prompt, draftImages);
      return;
    }
    void submit();
  };

  // 快捷引用提示词：与提示词库「使用」同一套逻辑 —— 正文/负向/参数预填，来源挂芯片（表达在 Composer 上方）。
  // 引用提示词 = 行内胶囊（Codex 式）：全文收敛进胶囊，正文只留用户补充；同一条重复引用时替换旧胶囊。
  const applyPromptReference = (target: Prompt) => {
    const referenceText = target.content.trim();
    const existingIndex = references.findIndex((item) => item.promptId === target.id);
    if (existingIndex >= 0) removeReference(existingIndex);
    addReference({ promptId: target.id, title: target.title, text: referenceText, scope: 'full' });
    // 正文若恰好是这条提示词全文（例如「使用」流程填入的），自动收敛进胶囊，避免重复提交。
    if (prompt.trim() === referenceText) setPrompt('');
    setNegative(target.contentNegative ?? '');
    setParams(target.params ? promptParamsToRefineParams(target.params) : { n: 1 });
    setSource({ kind: 'prompt', id: target.id, label: target.title });
    setPromptPickerOpen(false);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };
  // 胶囊与上方来源芯片描述同一条引用：任一侧移除时保持两者一致。
  const removeReferenceAt = (index: number) => {
    const target = references[index];
    removeReference(index);
    if (target && source.kind === 'prompt' && source.id === target.promptId) clearSource();
  };

  const resize = () => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(Math.max(element.scrollHeight, 78), 180)}px`;
  };

  useEffect(resize, [prompt]);

  // 输入/粘贴/预填的完整 / 指令收敛为指令芯片（Codex 式）：正文只留想法文本。
  useEffect(() => {
    if (draftCommand) return;
    const matched = matchDesignPlanCommand(prompt);
    if (!matched) return;
    setDraftCommand('design-plan');
    setPrompt(matched.rest);
  }, [prompt, draftCommand, setDraftCommand, setPrompt]);

  useEffect(() => {
    if (!refinementContext) return;
    textareaRef.current?.focus();
    textareaRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [refinementContext]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && schemePickerOpen) {
        event.preventDefault();
        setSchemePickerOpen(false);
      } else if (event.key === 'Escape' && promptPickerOpen) {
        event.preventDefault();
        setPromptPickerOpen(false);
      } else if (event.key === 'Escape' && composerMenuOpen) {
        event.preventDefault();
        setComposerMenuOpen(false);
      } else if (event.key === 'Escape' && generatingHere && !cancelRequested) {
        // 只在拥有正在运行轮次的对话里响应 Esc 取消；其他对话不误伤后台运行。
        event.preventDefault();
        void handleCancel();
      } else if (event.key === 'Escape' && refinementContext) {
        event.preventDefault();
        clearRefinement();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cancelRequested, clearRefinement, composerMenuOpen, generatingHere, handleCancel, promptPickerOpen, refinementContext, schemePickerOpen]);

  useEffect(() => {
    if (!composerMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (composerMenuRef.current?.contains(target) || composerMenuTriggerRef.current?.contains(target)) return;
      setComposerMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [composerMenuOpen]);

  // 方案来源与普通引用统一表达在 Composer 上方；提示词引用同时以行内胶囊出现在正文里。
  const plainSource = !refinementContext && !schemeSource && source.kind !== 'manual' ? source : null;
  const sourceBlockVisible = !refinementContext && Boolean(schemeSource);
  // 来源芯片悬停展示全文：全文存放在同 promptId 的引用胶囊里。
  const plainSourcePreview = plainSource?.kind === 'prompt' && plainSource.id
    ? references.find((item) => item.promptId === plainSource.id)?.text
    : undefined;
  const attachmentStripVisible = Boolean(
    refinementContext
    || draftImages.length > 0
    || skillComposerAttachmentVisible
    || plainSource
    || historyAttached,
  );

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-3 pb-3 sm:px-5 sm:pb-4" data-testid="workbench-composer">
      {(sourceBlockVisible || attachmentStripVisible) && (
        <div className="pointer-events-auto mx-auto mb-2 max-w-[620px] space-y-1.5" data-position="above-composer">
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
                <div className="flex min-w-max items-center gap-2" data-testid="history-source-chip">
                  <div className="flex h-12 min-w-[220px] items-center gap-2.5 rounded-lg border border-border-default bg-popover px-2.5">
                    <span className="flex h-7 w-7 items-center justify-center rounded-md bg-inset text-secondary"><History className="h-3.5 w-3.5" /></span>
                    <button
                      type="button"
                      onClick={() => setHistorySourceOpen(true)}
                      className="min-w-0 flex-1 text-left"
                      title="点击重新选择历史范围"
                      data-testid="history-source-chip-body"
                    >
                      <span className="block truncate text-[10.5px] font-medium text-primary">
                        历史 · {draftHistorySource.items.length} 张图片
                        {draftHistorySource.items.some((item) => item.promptText) ? ` + ${draftHistorySource.items.filter((item) => item.promptText).length} 条提示词` : ''}
                      </span>
                      <span className="mt-0.5 block text-[9.5px] text-tertiary">作为方案来源 · 点击调整范围</span>
                    </button>
                    <button type="button" onClick={() => setDraftHistorySource(null)} className="icon-action h-7 w-7" aria-label="移除历史来源" title="移除"><X className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
              )}
              {plainSource && <SourceChip source={plainSource} onClear={handleClearSource} previewText={plainSourcePreview} />}
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
      )}
      <div
        ref={composerSurfaceRef}
        className={cn(
          'pointer-events-auto relative mx-auto max-w-[620px] rounded-[24px] border bg-popover/84 px-3 pb-3 pt-2.5 shadow-[var(--shadow-composer)] backdrop-blur-xl transition-[border-color,background-color,box-shadow] focus-within:border-border-default sm:px-4 sm:pb-3.5 sm:pt-3',
          dragActive ? 'border-accent bg-popover shadow-pop' : 'border-border-subtle',
        )}
        data-testid="workbench-composer-surface"
        data-drag-active={dragActive ? 'true' : 'false'}
        onPaste={(event) => {
          const files = Array.from(event.clipboardData.items)
            .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
            .map((item) => item.getAsFile())
            .filter((file): file is File => file !== null);
          const images = files.length > 0
            ? files
            : Array.from(event.clipboardData.files).filter((item) => item.type.startsWith('image/'));
          if (images.length === 0) {
            const pastedText = event.clipboardData.getData('text/plain').trim();
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
          if (!event.dataTransfer.types.includes('Files') || generatingHere) return;
          event.preventDefault();
          dragDepthRef.current += 1;
          setDragActive(true);
        }}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes('Files') || generatingHere) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDragLeave={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return;
          event.preventDefault();
          dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
          if (dragDepthRef.current === 0) setDragActive(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          dragDepthRef.current = 0;
          setDragActive(false);
          const files = Array.from(event.dataTransfer.files).filter((item) => item.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(item.name));
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
            input.value = '';
            if (files.length > 0) void stageImageFiles(files);
          }}
        />
        {dragActive && (
          <div className="pointer-events-none absolute inset-1 z-20 flex items-center justify-center rounded-[20px] border border-dashed border-accent/55 bg-popover/92 text-[12px] font-medium text-accent" data-testid="workbench-image-drop-overlay">
            松开以添加图片
          </div>
        )}
        {overLimit && (
          <p className="mb-1.5 px-1 text-[10.5px] text-danger" data-testid="workbench-reference-over-limit">
            {refinementContext
              ? doubaoRefinement
                ? `微调要求 ${composedPrompt.length} 字，超过 ${WORKBENCH_PROMPT_LIMIT} 字，请缩短修改说明。`
                : `原提示词与微调要求合计 ${composedPrompt.length} 字，超过 ${WORKBENCH_PROMPT_LIMIT} 字，请缩短修改说明。`
              : `提示词与引用合计 ${composedPrompt.length} 字，超过 ${WORKBENCH_PROMPT_LIMIT} 字，请移除引用或缩短正文。`}
          </p>
        )}
        {submissionProvider && !submissionProvider.hasKey && (
          <div className="mb-1.5 flex items-center gap-1.5 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-[11px] text-warning" data-testid="refine-no-key">
            <span className="min-w-0 flex-1 truncate">「{submissionProvider.name}」还没有配置密钥</span>
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
            <p className="px-2.5 py-1 text-[10px] font-medium text-secondary">指令</p>
            {commandHints.map((hint, index) => (
              <button
                key={hint.command}
                type="button"
                role="option"
                aria-selected={index === activeCommandHintIndex}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                  index === activeCommandHintIndex ? 'bg-hover' : 'hover:bg-hover',
                )}
                onMouseEnter={() => setCommandHintIndex(index)}
                onClick={selectCommandHint}
                data-testid="composer-command-hint"
              >
                <Wand2 className="h-3.5 w-3.5 shrink-0 text-accent" />
                <span className="font-mono text-[11px] font-medium text-primary">{hint.command}</span>
                <span className="min-w-0 flex-1 truncate text-right text-[10px] text-tertiary">{hint.description}</span>
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
                    onClick={() => { setDraftCommand(null); textareaRef.current?.focus(); }}
                    className="flex h-4 w-4 items-center justify-center rounded-[4px] transition-colors hover:bg-accent/15"
                    aria-label="移除指令"
                    title="移除指令（Backspace）"
                    data-testid="composer-command-chip-remove"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              )}
              {referenceCapsulesVisible && references.map((reference, index) => (
                <InlineReferenceCapsule
                  key={`${reference.promptId}-${index}`}
                  reference={reference}
                  onRemove={() => { removeReferenceAt(index); textareaRef.current?.focus(); }}
                />
              ))}
            </span>
          )}
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(event) => {
              const value = event.target.value;
              if (skillRuntimeStatus === 'complete' && value) void removeGithubSkill();
              setPrompt(value);
              setCommandHintsDismissed(false);
              setCommandHintIndex(0);
            }}
            onScroll={(event) => {
              if (inlineChipsVisible) setComposerScrollTop(event.currentTarget.scrollTop);
            }}
            style={inlineChipsVisible && (inlineChipsIndent > 0 || inlineChipsPadTop > 0)
              ? {
                  ...(inlineChipsIndent > 0 ? { textIndent: inlineChipsIndent } : {}),
                  ...(inlineChipsPadTop > 0 ? { paddingTop: inlineChipsPadTop } : {}),
                }
              : undefined}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
              // 指令建议浮层可见时优先接管方向键 / Enter / Esc（Codex 式选择）。
              if (commandHintsVisible) {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  const delta = event.key === 'ArrowDown' ? 1 : -1;
                  setCommandHintIndex((activeCommandHintIndex + delta + commandHints.length) % commandHints.length);
                  return;
                }
                if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
                  event.preventDefault();
                  selectCommandHint();
                  return;
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  setCommandHintsDismissed(true);
                  return;
                }
              }
              // 光标在正文最前时按 Backspace 依次删除行内胶囊（Codex 式）：先删最近的引用胶囊，再删指令芯片。
              if (
                event.key === 'Backspace'
                && event.currentTarget.selectionStart === 0
                && event.currentTarget.selectionEnd === 0
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
                event.key === 'Enter' && (!event.shiftKey || event.metaKey || event.ctrlKey);
              if (shouldSubmit) {
                event.preventDefault();
                if (canSubmit) handleSubmit();
              }
            }}
            maxLength={WORKBENCH_PROMPT_LIMIT}
            rows={1}
            aria-label="提示词输入"
            placeholder={draftCommand
              ? '描述你的方案想法，可附 GitHub Skill 地址…'
              : refinementContext
              ? '描述如何微调；如有其他图片，也可说明参考、风格或融合方式…'
              : schemeSource
              ? (schemeSource.mode === 'modify'
                ? '描述要修改的内容，例如：把默认比例改成 3:4…'
                : schemeSource.mode === 'trial' ? '补充这次试运行的具体内容（可选）…' : '补充本次要求（可选），方案会保持视觉方向…')
              : references.length > 0
              ? '已引用提示词，可补充本次要求（可选）…'
              : hasTurns
                ? '描述下一步调整…'
                : '描述你想生成的图片…'}
            data-testid="refine-prompt"
            data-workbench-testid="workbench-prompt"
            className="no-drag block max-h-[180px] min-h-[78px] w-full resize-none overflow-y-auto bg-transparent px-2 pb-2 pt-2 text-[13px] leading-relaxed text-primary outline-none placeholder:text-tertiary sm:px-2.5"
          />
          <div className="flex min-w-0 items-center gap-1 px-0.5 pt-1">
            <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-visible">
              <button
                type="button"
                ref={composerMenuTriggerRef}
                onClick={() => setComposerMenuOpen((open) => !open)}
                disabled={imageBusy || generatingHere}
                aria-label="添加上下文"
                aria-haspopup="menu"
                aria-expanded={composerMenuOpen}
                aria-controls="workbench-context-menu"
                title="添加图片，引用提示词、设计方案或 Skill"
                className="no-drag flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-secondary transition-colors hover:bg-hover hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-strong disabled:cursor-wait disabled:opacity-45"
                data-testid="workbench-image-picker"
              >
                {imageBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-4 w-4" />}
              </button>
              {composerMenuOpen && (
                <div
                  ref={composerMenuRef}
                  id="workbench-context-menu"
                  className="absolute inset-x-0 bottom-[calc(100%+10px)] z-50 max-h-[min(420px,calc(100dvh-220px))] overflow-y-auto rounded-xl border border-border-default bg-popover p-2 shadow-pop animate-scale-fade-in"
                  role="menu"
                  aria-label="添加上下文菜单"
                  data-testid="workbench-context-menu"
                >
                  <p className="px-2 py-1.5 text-[11px] font-medium text-secondary">添加</p>
                  <button
                    type="button"
                    role="menuitem"
                    autoFocus
                    className="flex min-h-10 w-full items-center gap-2.5 rounded-lg bg-inset px-2.5 py-2 text-left text-[12px] font-medium text-primary transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
                    onClick={() => { setComposerMenuOpen(false); void pickImage(); }}
                    data-testid="workbench-context-add-image"
                  >
                    <ImagePlus className="h-4 w-4 shrink-0 text-accent" />
                    <span className="min-w-0 flex-1">添加图片</span>
                    <span className="text-[10px] font-normal text-secondary">上传、粘贴或拖入</span>
                  </button>
                  <div className="my-2 h-px bg-border-subtle" />
                  <p className="px-2 py-1 text-[10px] font-medium text-secondary">引用</p>
                  <button type="button" role="menuitem" className="menu-action rounded-md" onClick={() => { setPromptPickerOpen(true); setComposerMenuOpen(false); }} data-testid="workbench-context-ref-prompt"><FileText className="h-3.5 w-3.5" /> <span>提示词</span><span className="ml-auto text-[10px] text-secondary">从库中引用</span></button>
                  <button type="button" role="menuitem" className="menu-action rounded-md" onClick={() => { setSchemePickerOpen(true); setComposerMenuOpen(false); }}><Blocks className="h-3.5 w-3.5" /> <span>设计方案</span><span className="ml-auto text-[10px] text-secondary">套用视觉方向</span></button>
                  <button type="button" role="menuitem" className="menu-action rounded-md" onClick={() => void importGithubFromClipboard()} data-testid="workbench-context-paste-skill"><GitBranch className="h-3.5 w-3.5" /> <span>GitHub Skill</span><span className="ml-auto text-[10px] text-secondary">{doubaoImageMode ? '粘贴后直传豆包' : '读取设计能力'}</span></button>
                  {!doubaoImageMode && (
                    <>
                      <div className="my-2 h-px bg-border-subtle" />
                      <p className="px-2 py-1 text-[10px] font-medium text-secondary">Agent</p>
                      <button type="button" role="menuitem" className="menu-action rounded-md" onClick={() => { setDraftCommand('design-plan'); setComposerMenuOpen(false); window.requestAnimationFrame(() => textareaRef.current?.focus()); }} data-testid="composer-menu-design-plan"><Wand2 className="h-3.5 w-3.5" /> <span>生成设计方案</span><span className="ml-auto text-[10px] text-secondary">先出草稿</span></button>
                      <button type="button" role="menuitem" className="menu-action rounded-md" onClick={() => { setHistorySourceOpen(true); setComposerMenuOpen(false); }}><History className="h-3.5 w-3.5" /> <span>从历史内容创建</span><span className="ml-auto text-[10px] text-secondary">自行选择来源</span></button>
                      <button type="button" role="menuitem" className="menu-action rounded-md" onClick={() => { useAppStore.getState().setView('design-schemes'); setComposerMenuOpen(false); }}><Search className="h-3.5 w-3.5" /> <span>寻找设计方案</span><span className="ml-auto text-[10px] text-secondary">打开方案库</span></button>
                    </>
                  )}
                </div>
              )}
              {schemePickerOpen && <SchemeRunPickerPopover onClose={() => setSchemePickerOpen(false)} />}
              {promptPickerOpen && <PromptPickerPopover onClose={() => setPromptPickerOpen(false)} onPick={applyPromptReference} />}
              {!refinementContext && (
                <>
                  <RatioPicker
                    className="w-[90px] shrink-0 max-[520px]:w-[82px]"
                    value={params.ratioId}
                    onChange={(value) => setParams({ ratioId: value })}
                    testIdPrefix="refine-ratio"
                    side="top"
                    variant="compact"
                  />
                  <GenerationOptionsPopover
                    quality={params.quality}
                    count={effectiveImageCount}
                    negative={negative}
                    onQualityChange={(quality) => setParams({ quality })}
                    onCountChange={(n) => setParams({ n })}
                    onNegativeChange={setNegative}
                    webManaged={doubaoImageMode}
                    webEditing={doubaoImageMode && referenceImageCount > 0}
                  />
                  {composedPrompt.length >= WORKBENCH_PROMPT_LIMIT * 0.9 && (
                    <span className="ml-1 shrink-0 font-mono text-[10px] text-quaternary" data-testid="workbench-prompt-count">
                      {composedPrompt.length}/{WORKBENCH_PROMPT_LIMIT}
                    </span>
                  )}
                </>
              )}
            </div>
            <div className="ml-auto flex shrink-0 items-center justify-end gap-1 pl-1">
              {generatingHere ? (
                <button
                  type="button"
                  disabled={cancelRequested}
                  onClick={() => void handleCancel()}
                  aria-label={cancelRequested ? '正在取消生成' : '停止生成'}
                  title={cancelRequested ? '正在取消生成' : '停止生成'}
                  className="no-drag flex h-9 w-9 items-center justify-center rounded-full border border-border-default bg-primary text-background shadow-sm transition-transform hover:scale-[1.03] disabled:cursor-wait disabled:opacity-55"
                  data-testid="refine-cancel"
                  data-workbench-testid="workbench-cancel"
                >
                  {cancelRequested ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3 w-3 fill-current" />}
                  <span className="sr-only">{cancelRequested ? '正在取消' : '取消'}</span>
                </button>
              ) : (
                <button
                  type="button"
                  // 创建/修改设计方案只依赖文本 AI，不要求生图服务商
                  disabled={!canSubmit || (!submissionProvider && !designPlanIntent && !schemeModifyMode)}
                  onClick={handleSubmit}
                  aria-label={designPlanIntent ? '创建设计方案' : schemeSource ? (schemeSource.mode === 'modify' ? '发送修改要求' : schemeSource.mode === 'trial' ? '试运行方案' : '按方案生成') : refinementContext ? '提交微调' : `生成图像，${effectiveImageCount} 张`}
                  title={designPlanIntent ? '创建设计方案（Enter）' : schemeSource ? (schemeSource.mode === 'modify' ? '发送修改要求（Enter）' : schemeSource.mode === 'trial' ? '试运行方案（Enter）' : '按方案生成（Enter）') : refinementContext ? '提交微调（Enter）' : submissionProvider ? '生成图像（Enter）' : '请先连接服务商'}
                  className="no-drag flex h-9 w-9 items-center justify-center rounded-full bg-accent text-[color:var(--on-accent)] shadow-sm transition-[transform,background-color,opacity] hover:scale-[1.03] hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 focus-visible:ring-offset-2 focus-visible:ring-offset-popover disabled:cursor-not-allowed disabled:bg-quaternary disabled:text-background disabled:opacity-55"
                  data-testid="refine-generate"
                  data-workbench-testid="workbench-submit"
                >
                  <ArrowUp className="h-4 w-4 stroke-[2.4]" />
                  <span className="sr-only">{refinementContext ? '提交微调' : `生成图像 ×${effectiveImageCount}`}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      <ImageLightbox path={previewPath} onClose={() => setPreviewPath(null)} />
      {historySourceOpen && (
        <HistorySourcePicker
          initialSelectedIds={draftHistorySource?.items.map((item) => item.historyId)}
          onCancel={() => setHistorySourceOpen(false)}
          onConfirm={({ items, note }) => {
            setHistorySourceOpen(false);
            setDraftCommand('design-plan');
            setDraftHistorySource({ items });
            // 提取说明必须始终可见可编辑（UI 规范 §10.2）；仅在正文为空时代填，避免覆盖用户输入。
            if (!prompt.trim()) setPrompt(note);
            window.requestAnimationFrame(() => textareaRef.current?.focus());
          }}
        />
      )}
    </div>
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
    <div className="flex min-w-max items-end gap-1.5" data-testid="workbench-draft-images" data-position="above-composer">
      <span className="shrink-0 self-center px-0.5 text-[10px] text-secondary">{supportingRefinement ? '其他图片' : '参考图片'}</span>
      {images.map((image, index) => {
        const imageNumber = startIndex + index;
        return (
          <div key={`${image.source}:${image.historyId ?? image.path}:${index}`} className="group relative shrink-0 rounded-md border border-border-subtle bg-inset/55 p-1" data-testid="workbench-draft-image">
            <button type="button" onClick={() => onPreview(image.path)} className="block cursor-zoom-in rounded" title={image.name ?? `图 ${imageNumber}`} aria-label={`查看图 ${imageNumber}`} data-testid="workbench-draft-image-preview">
              <img src={toImageSrc(image.path)} alt={`图 ${imageNumber}`} className="h-12 w-12 rounded object-contain" />
            </button>
            <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded bg-black/65 px-1 py-0.5 text-[8px] leading-none text-white">图 {imageNumber}</span>
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
    source: 'history' as const,
    path: context.imagePath,
    historyId: context.historyId,
    name: '图 1',
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
        <img src={toImageSrc(target.path)} alt="微调目标" className="h-11 w-11 rounded-md object-contain" />
        <span className="absolute bottom-0.5 left-0.5 rounded bg-black/65 px-1 py-0.5 text-[7.5px] leading-none text-white">图 1</span>
      </button>
      <span className="text-[11px] font-medium text-primary" data-testid="refinement-target-label">微调目标</span>
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

function GenerationOptionsPopover({
  quality,
  count,
  negative,
  onQualityChange,
  onCountChange,
  onNegativeChange,
  webManaged = false,
  webEditing = false,
}: {
  quality: ImageQuality;
  count: number;
  negative: string;
  onQualityChange: (quality: ImageQuality) => void;
  onCountChange: (count: number) => void;
  onNegativeChange: (negative: string) => void;
  webManaged?: boolean;
  webEditing?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectedQuality = QUALITY_OPTIONS.find((option) => option.id === quality) ?? QUALITY_OPTIONS[0];

  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close(true);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative w-[84px] shrink-0 max-[520px]:w-8" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={webManaged ? '生成设置：豆包网页托管数量' : `生成设置：${selectedQuality.label}，${count} 张`}
        title="生成设置"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'no-drag flex h-7 w-full items-center justify-center gap-1.5 rounded-md border border-transparent bg-transparent px-1.5 text-[11px] text-secondary transition-colors hover:border-border-subtle hover:bg-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25',
          open && 'border-border-subtle bg-hover text-primary',
        )}
        data-testid="workbench-more-settings"
        data-open={open ? 'true' : 'false'}
      >
        <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
        <span className="whitespace-nowrap max-[520px]:sr-only">{webManaged ? '豆包 · 网页' : `${selectedQuality.label} · ${count}张`}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="生成设置"
          className="absolute bottom-[calc(100%+8px)] right-0 z-40 w-[304px] overflow-hidden rounded-lg border border-border-subtle bg-popover p-2 shadow-pop animate-scale-fade-in max-[640px]:fixed max-[640px]:bottom-[156px] max-[640px]:left-1/2 max-[640px]:right-auto max-[640px]:w-[calc(100vw-24px)] max-[640px]:-translate-x-1/2"
          data-testid="workbench-generation-options"
        >
          <div className="flex h-8 items-center justify-between gap-3 px-1.5">
            <span className="text-[11px] font-semibold text-primary">生成设置</span>
            <button type="button" onClick={() => close(true)} title="关闭" aria-label="关闭生成设置" className="no-drag flex h-6 w-6 items-center justify-center rounded-md text-tertiary hover:bg-hover hover:text-primary">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="space-y-2 p-1">
            {webManaged ? (
              <div className="rounded-md bg-inset/60 px-3 py-2.5">
                <p className="text-[10.5px] font-medium text-primary">
                  {webEditing ? '豆包网页 · 图片编辑' : '豆包网页 · 文字生图返回 4 张'}
                </p>
                <p className="mt-1 text-[10px] leading-relaxed text-tertiary">
                  {webEditing
                    ? '编辑结果数量由豆包网页决定，回复文字随图片归组；本地每日最多提交 10 次。'
                    : '四张图片与回复文字按同一批次归组；本地每日最多提交 10 次。'}
                </p>
              </div>
            ) : <div>
              <div className="mb-1 px-1 text-[10px] font-medium text-tertiary">质量</div>
              <div className="grid grid-cols-4 gap-1 rounded-md bg-inset/60 p-1" role="radiogroup" aria-label="图片质量">
                {QUALITY_OPTIONS.map((option) => {
                  const active = option.id === quality;
                  return (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={active}
                      key={option.id}
                      onClick={() => onQualityChange(option.id)}
                      data-testid={`refine-quality-${option.id}`}
                      data-active={active ? 'true' : 'false'}
                      title={option.hint}
                      className={cn(
                        'no-drag flex h-8 min-w-0 items-center justify-center rounded-md px-1 text-[10.5px] font-medium text-tertiary transition-colors hover:bg-hover hover:text-primary',
                        active && 'bg-elevated text-accent shadow-sm',
                      )}
                    >
                      <span className="truncate">{option.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>}

            {!webManaged && <div>
              <div className="mb-1 px-1 text-[10px] font-medium text-tertiary">数量</div>
              <div className="grid grid-cols-4 gap-1 rounded-md bg-inset/60 p-1" role="radiogroup" aria-label="生成数量">
                {REFINE_COUNTS.map((value) => {
                  const active = value === count;
                  return (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={active}
                      key={value}
                      onClick={() => onCountChange(value)}
                      data-testid={`refine-count-${value}`}
                      data-active={active ? 'true' : 'false'}
                      className={cn(
                        'no-drag h-8 rounded-md text-[10.5px] font-medium text-tertiary transition-colors hover:bg-hover hover:text-primary',
                        active && 'bg-elevated text-accent shadow-sm',
                      )}
                    >
                      {value} 张
                    </button>
                  );
                })}
              </div>
            </div>}

            <div>
              <label htmlFor="workbench-negative-prompt" className="mb-1 block px-1 text-[10px] font-medium text-tertiary">反向提示词</label>
              <textarea
                id="workbench-negative-prompt"
                value={negative}
                onChange={(event) => onNegativeChange(event.target.value)}
                rows={2}
                placeholder="不希望出现的元素…"
                className="no-drag w-full resize-none rounded-md border border-border-subtle bg-elevated px-2.5 py-2 text-[11px] leading-relaxed text-primary outline-none placeholder:text-tertiary focus:border-accent/45 focus:ring-2 focus:ring-accent/10"
                data-testid="refine-negative"
              />
            </div>
          </div>
        </div>
      )}
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
  scope?: GenerationTurn['references'][number]['scope'];
  anchor: DOMRect;
}) {
  const width = 320;
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8));
  return (
    <span
      className="pointer-events-none fixed z-[90] block w-[320px] rounded-lg border border-border-default bg-popover p-3 text-left shadow-pop animate-scale-fade-in"
      style={{ left, bottom: window.innerHeight - anchor.top + 8 }}
      role="tooltip"
      data-testid="prompt-reference-preview"
    >
      <span className="block truncate text-[10px] font-medium text-tertiary">
        {title}
        {scope ? ` · ${scope === 'full' ? '整条引用' : '选段引用'}` : ''}
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
  reference: GenerationTurn['references'][number];
  onRemove: () => void;
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  return (
    <span
      className="inline-flex h-[21px] max-w-[176px] items-center gap-1 rounded-md border border-border-subtle bg-inset pl-1.5 pr-0.5 text-[11px] font-medium leading-none text-primary"
      data-testid="workbench-reference-chip"
      data-reference-scope={reference.scope}
      onMouseEnter={(event) => setAnchor(event.currentTarget.getBoundingClientRect())}
      onMouseLeave={() => setAnchor(null)}
      onFocusCapture={(event) => setAnchor(event.currentTarget.getBoundingClientRect())}
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
      {anchor && <PromptFullTextCard title={reference.title} text={reference.text} scope={reference.scope} anchor={anchor} />}
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
  const fromPrompt = source.kind === 'prompt';
  const Icon = fromPrompt ? FileText : History;
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  return (
    <div
      className="flex h-12 min-w-[200px] max-w-[300px] shrink-0 items-center gap-2.5 rounded-lg border border-border-default bg-popover px-2.5 shadow-sm"
      data-testid="refine-source"
      data-workbench-testid="workbench-source"
      data-source-kind={source.kind}
      onMouseEnter={previewText ? (event) => setAnchor(event.currentTarget.getBoundingClientRect()) : undefined}
      onMouseLeave={previewText ? () => setAnchor(null) : undefined}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-background">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[10.5px] font-medium text-primary" title={source.label ?? ''}>
          {source.label ?? (fromPrompt ? '提示词' : '历史记录')}
        </span>
        <span className="mt-0.5 block truncate text-[9.5px] text-tertiary">
          {fromPrompt ? (previewText ? '引用提示词 · 悬停查看全文' : '来自提示词库') : '来自生成历史'}
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
        <PromptFullTextCard title={source.label ?? '提示词'} text={previewText} anchor={anchor} />
      )}
    </div>
  );
}

function formatParams(params: { ratioId: string; quality: string; n: number }) {
  return `${params.ratioId} · ${params.quality} · ${params.n}张`;
}
