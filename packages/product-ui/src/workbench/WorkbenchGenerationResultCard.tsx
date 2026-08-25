import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  Check,
  Copy,
  Download,
  FolderOpen,
  GitBranch,
  History,
  MoreHorizontal,
} from "@musefold/ui/icons";
import { GenerationRetryAction } from "./GenerationRetryAction";
import {
  GenerationSavePromptAction,
  type GenerationSavePromptState,
} from "./GenerationSavePromptAction";
import { GenerationResultSurface } from "./GenerationResultSurface";
import {
  workbenchGenerationResultStatus,
  workbenchGenerationStatusLabel,
  type WorkbenchGenerationStatus,
} from "./generationSnapshots";

export interface WorkbenchGenerationResultCardProps {
  id: string;
  historyId?: string | null;
  status: WorkbenchGenerationStatus;
  imageUrl?: string | null;
  aspectRatio: string;
  busy: boolean;
  errorMessage?: string | null;
  retrying?: boolean;
  retryAttempt?: number;
  retryMax?: number;
  onZoom: () => void;
  onRetry: () => void;
  showRefineAction?: boolean;
  refinementEnabled?: boolean;
  onRefine?: () => void;
  onHistory?: () => void;
  selectionEnabled?: boolean;
  selectionMode?: boolean;
  selected?: boolean;
  deselecting?: boolean;
  refinementTargetDisabled?: boolean;
  onEnterSelection?: () => void;
  onToggleSelection?: () => void;
  onSetAsRefinementTarget?: () => void;
  savePromptState?: GenerationSavePromptState;
  onSavePrompt?: () => void;
  onSaveImage?: () => void | Promise<void>;
  onCopyImage?: () => void | Promise<void>;
  onOpenFolder?: () => void | Promise<void>;
  errorAction?: ReactNode;
  testId?: string;
  imageTestId?: string;
}

/** Result card chrome. Hosts inject image URLs, file actions, and error recovery slots. */
export function WorkbenchGenerationResultCard({
  id,
  historyId,
  status,
  imageUrl,
  aspectRatio,
  busy,
  errorMessage,
  retrying,
  retryAttempt,
  retryMax,
  onZoom,
  onRetry,
  showRefineAction = false,
  refinementEnabled = false,
  onRefine,
  onHistory,
  selectionEnabled = false,
  selectionMode = false,
  selected = false,
  deselecting = false,
  refinementTargetDisabled = false,
  onEnterSelection,
  onToggleSelection,
  onSetAsRefinementTarget,
  savePromptState = "idle",
  onSavePrompt,
  onSaveImage,
  onCopyImage,
  onOpenFolder,
  errorAction,
  testId = "generate-result-card",
  imageTestId = "result-zoom",
}: WorkbenchGenerationResultCardProps) {
  const [broken, setBroken] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const longPressTimer = useRef<number | null>(null);
  const longPressStart = useRef<{ x: number; y: number } | null>(null);
  const longPressTriggered = useRef(false);
  const canAct = status === "success" && Boolean(imageUrl) && !broken;

  useEffect(() => {
    setBroken(false);
  }, [imageUrl, status]);

  useEffect(
    () => () => {
      if (longPressTimer.current !== null)
        window.clearTimeout(longPressTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!cardRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
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
    if (
      !selectionEnabled ||
      !canAct ||
      (event.pointerType === "mouse" && event.button !== 0)
    )
      return;
    clearLongPress();
    longPressTriggered.current = false;
    longPressStart.current = { x: event.clientX, y: event.clientY };
    longPressTimer.current = window.setTimeout(() => {
      longPressTriggered.current = true;
      onEnterSelection?.();
      longPressTimer.current = null;
    }, 520);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = longPressStart.current;
    if (!start) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10)
      clearLongPress();
  };

  const handleImageClick = () => {
    if (!canAct) return;
    if (selectionMode) {
      onToggleSelection?.();
      return;
    }
    if (longPressTriggered.current) {
      longPressTriggered.current = false;
      return;
    }
    onZoom();
  };

  const surfaceStatus = workbenchGenerationResultStatus(status);
  const surfaceMediaOverlay = canAct ? (
    <>
      {selectionMode ? (
        <span
          className={[
            "absolute right-2 top-2 z-10 inline-flex h-6 w-6 items-center justify-center rounded-full border text-[11px] shadow-sm",
            selected
              ? "border-accent bg-accent text-white"
              : "border-white/35 bg-black/65 text-white/80",
          ].join(" ")}
          aria-hidden="true"
          data-testid="result-selection-toggle"
        >
          {selected ? <Check className="h-3.5 w-3.5" /> : null}
        </span>
      ) : null}
      {refinementEnabled && selectionMode && selected && !deselecting ? (
        <button
          type="button"
          onClick={onSetAsRefinementTarget}
          disabled={refinementTargetDisabled}
          className="absolute bottom-2 left-2 z-10 inline-flex h-7 items-center gap-1 rounded-md border border-white/15 bg-black/75 px-2 text-[11px] font-medium text-white shadow-sm transition-colors hover:bg-black/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:cursor-wait disabled:opacity-55"
          title="以这张图作为微调目标"
          aria-label="以这张图作为微调目标"
          data-testid="result-set-refinement-target"
        >
          <GitBranch className="h-3 w-3" /> 微调目标
        </button>
      ) : null}
    </>
  ) : null;
  const hasMediaActions = Boolean(onSaveImage || onCopyImage || onRefine || onOpenFolder || onHistory);
  const surfaceMediaActions =
    canAct && !selectionMode && hasMediaActions ? (
      <div className="flex w-full items-center justify-between opacity-0 transition-opacity group-hover:opacity-100">
        <div className="flex items-center gap-1 rounded-md border border-white/15 bg-black/75 p-1 text-white">
          {onSaveImage ? (
            <button
              type="button"
              onClick={() => void onSaveImage()}
              title="另存图片"
              aria-label="另存图片"
              data-testid="result-save"
              className="icon-action"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
          ) : null}
          {onCopyImage ? (
            <button
              type="button"
              onClick={() => void onCopyImage()}
              title="复制图片"
              aria-label="复制图片"
              data-testid="result-copy-image"
              className="icon-action"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          ) : null}
          {showRefineAction && onRefine ? (
            <button
              type="button"
              onClick={onRefine}
              title="以这张图继续微调"
              aria-label="以这张图继续微调"
              data-testid="result-refine"
              className="icon-action"
            >
              <GitBranch className="h-3 w-3" />
            </button>
          ) : null}
        </div>
        {onOpenFolder || onHistory ? (
          <div className="relative" data-turn-menu>
            <button
              type="button"
              onClick={() => setMenuOpen((value) => !value)}
              title="更多操作"
              aria-label="更多操作"
              data-testid="result-more"
              className="icon-action rounded-md border border-white/15 bg-black/75 text-white"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
            {menuOpen && (
              <div className="absolute bottom-9 right-0 z-20 w-36 overflow-hidden rounded-md border border-border-default bg-popover py-1 text-[11px] shadow-pop">
                {onOpenFolder ? (
                  <button
                    type="button"
                    onClick={() => {
                      void onOpenFolder();
                      setMenuOpen(false);
                    }}
                    className="menu-action"
                    data-testid="result-open-folder"
                  >
                    <FolderOpen className="h-3 w-3" /> 打开所在目录
                  </button>
                ) : null}
                {onHistory ? (
                  <button
                    type="button"
                    onClick={() => {
                      onHistory();
                      setMenuOpen(false);
                    }}
                    className="menu-action"
                    data-testid="result-history"
                  >
                    <History className="h-3 w-3" /> 查看生成历史
                  </button>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
      </div>
    ) : null;
  const surfaceFooterActions =
    status === "failed" || status === "cancelled" ? (
      <GenerationRetryAction onRetry={onRetry} disabled={busy} />
    ) : null;

  return (
    <GenerationResultSurface
      rootRef={cardRef}
      id={id}
      testId={testId}
      imageTestId={imageTestId}
      dataHistoryId={historyId}
      className={[
        "group",
        selected || deselecting ? "border-accent ring-1 ring-accent/45" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      status={surfaceStatus}
      imageUrl={imageUrl}
      imageLabel={
        selectionMode ? (selected ? "取消选择图片" : "选择图片") : "查看大图"
      }
      imageTitle={
        selectionMode
          ? selected
            ? "取消选择"
            : "选择图片"
          : selectionEnabled
            ? "查看大图；长按选择图片"
            : "查看大图"
      }
      aspectRatio={aspectRatio}
      pendingLabel={
        retrying && retryAttempt && retryMax
          ? `重试中（第 ${retryAttempt}/${retryMax} 次）`
          : "正在生成"
      }
      pendingTestId={retrying ? "generation-retrying" : undefined}
      errorMessage={errorMessage}
      errorAction={errorAction}
      footerLabel={retrying ? "重试中" : workbenchGenerationStatusLabel(status)}
      selected={selected}
      deselecting={deselecting}
      busy={busy}
      onOpenImage={canAct ? handleImageClick : undefined}
      onImagePointerDown={startLongPress}
      onImagePointerMove={handlePointerMove}
      onImagePointerUp={clearLongPress}
      onImagePointerCancel={clearLongPress}
      onImagePointerLeave={clearLongPress}
      onImageContextMenu={(event) => {
        if (!selectionEnabled) return;
        event.preventDefault();
        onEnterSelection?.();
      }}
      onImageAvailabilityChange={(available) => setBroken(!available)}
      mediaOverlay={surfaceMediaOverlay}
      mediaActions={surfaceMediaActions}
      footerActions={
        status === "success" && onSavePrompt ? (
          <GenerationSavePromptAction
            state={savePromptState}
            onSave={onSavePrompt}
            className="button button-secondary result-save-prompt"
          />
        ) : (
          surfaceFooterActions
        )
      }
    />
  );
}
