import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  Check,
  Copy,
  Download,
  FolderOpen,
  GitBranch,
  History,
  MoreHorizontal,
} from "../../../components/ui/icons";
import {
  GenerationRetryAction,
  GenerationSavePromptAction,
  GenerationResultSurface,
  workbenchGenerationResultStatus,
  workbenchGenerationStatusLabel,
} from "@musefold/product-ui";
import { useAppStore } from "../../../stores/app";
import { cn } from "../../../lib/utils";
import { toImageSrc } from "../../../lib/media";
import { desktopHost as api } from "@renderer/runtime/desktop-host-services";
import { toast } from "../../../stores/toast";
import { useSettingsStore } from "./workbenchCrossFeature";
import { InlineQuotaRedeem } from "./InlineQuotaRedeem";
import type { GenerationResultItem } from "./types";

export function GenerationResultCard({
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
  savePromptState,
  onSavePrompt,
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
  savePromptState: "idle" | "saving" | "saved";
  onSavePrompt: () => void;
}) {
  const [broken, setBroken] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const setView = useAppStore((state) => state.setView);
  const setSettingsSection = useSettingsStore((state) => state.setSection);
  const cardRef = useRef<HTMLDivElement>(null);
  const longPressTimer = useRef<number | null>(null);
  const longPressStart = useRef<{ x: number; y: number } | null>(null);
  const longPressTriggered = useRef(false);
  const canAct =
    result.status === "success" && Boolean(result.imagePath) && !broken;

  useEffect(() => {
    setBroken(false);
  }, [result.imagePath, result.status]);

  useEffect(() => {
    return () => {
      if (longPressTimer.current !== null)
        window.clearTimeout(longPressTimer.current);
    };
  }, []);

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
      onEnterSelection();
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
      if ("cancelled" in saved) return;
      toast.success("图片已另存");
    } catch (error) {
      toast.error(
        "另存失败",
        error instanceof Error ? error.message : "文件可能已被移动或删除。",
      );
    }
  };

  const copyImage = async () => {
    if (!result.imagePath) return;
    try {
      await api.system.copyImage(result.imagePath);
      toast.success("已复制图片");
    } catch (error) {
      toast.error(
        "复制图片失败",
        error instanceof Error ? error.message : "图片可能已被移动或删除。",
      );
    }
  };

  const openFolder = async () => {
    if (!result.imagePath) return;
    try {
      await api.system.openInFolder(result.imagePath);
    } catch {
      toast.error("打开目录失败", "文件可能已被移动或删除。");
    }
  };

  const surfaceStatus = workbenchGenerationResultStatus(result.status);
  const surfaceErrorAction =
    result.errorCode === "ACCOUNT/QUOTA" ? (
      <InlineQuotaRedeem onRetry={onRetry} disabled={busy} />
    ) : result.errorCode?.startsWith("ACCOUNT/") ? (
      <button
        type="button"
        className="no-drag mt-1 rounded-full border border-danger/35 px-3 py-1 text-[10px] font-medium text-danger transition-colors hover:border-danger"
        onClick={() => {
          setSettingsSection(
            result.errorCode === "ACCOUNT/MODEL_NOT_FOUND"
              ? "providers"
              : "account",
          );
          setView("settings");
        }}
      >
        {result.errorCode === "ACCOUNT/AUTH" ? "重新登录" : "选择可用模型"}
      </button>
    ) : null;
  const surfaceMediaOverlay = canAct ? (
    <>
      {selectionMode ? (
        <span
          className={cn(
            "absolute right-2 top-2 z-10 inline-flex h-6 w-6 items-center justify-center rounded-full border text-[11px] shadow-sm",
            selected
              ? "border-accent bg-accent text-white"
              : "border-white/35 bg-black/65 text-white/80",
          )}
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
          className="absolute bottom-2 left-2 z-10 inline-flex h-7 items-center gap-1 rounded-md border border-white/15 bg-black/75 px-2 text-[10px] font-medium text-white shadow-sm transition-colors hover:bg-black/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:cursor-wait disabled:opacity-55"
          title="以这张图作为微调目标"
          aria-label="以这张图作为微调目标"
          data-testid="result-set-refinement-target"
        >
          <GitBranch className="h-3 w-3" /> 微调目标
        </button>
      ) : null}
    </>
  ) : null;
  const surfaceMediaActions =
    canAct && !selectionMode ? (
      <div className="flex w-full items-center justify-between opacity-0 transition-opacity group-hover:opacity-100">
        <div className="flex items-center gap-1 rounded-md border border-white/15 bg-black/75 p-1 text-white">
          <button
            type="button"
            onClick={() => void saveImage()}
            title="另存图片"
            aria-label="另存图片"
            data-testid="result-save"
            className="icon-action"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => void copyImage()}
            title="复制图片"
            aria-label="复制图片"
            data-testid="result-copy-image"
            className="icon-action"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          {showRefineAction && (
            <button
              type="button"
              onClick={onRefine}
              title="以这张图继续微调"
              aria-label="以这张图继续微调"
              data-testid="result-refine"
              className="icon-action"
            >
              <GitBranch className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
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
              <button
                type="button"
                onClick={() => {
                  void openFolder();
                  setMenuOpen(false);
                }}
                className="menu-action"
                data-testid="result-open-folder"
              >
                <FolderOpen className="h-3 w-3" /> 打开所在目录
              </button>
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
            </div>
          )}
        </div>
      </div>
    ) : null;
  const surfaceFooterActions =
    result.status === "failed" || result.status === "cancelled" ? (
      <GenerationRetryAction onRetry={onRetry} disabled={busy} />
    ) : null;

  return (
    <GenerationResultSurface
      rootRef={cardRef}
      id={result.id}
      testId="generate-result-card"
      imageTestId="result-zoom"
      dataHistoryId={result.historyId}
      className={cn(
        "group",
        selected || deselecting
          ? "border-accent ring-1 ring-accent/45"
          : undefined,
      )}
      status={surfaceStatus}
      imageUrl={result.imagePath ? toImageSrc(result.imagePath) : null}
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
        result.retrying && result.retryAttempt && result.retryMax
          ? `重试中（第 ${result.retryAttempt}/${result.retryMax} 次）`
          : "正在生成"
      }
      pendingTestId={result.retrying ? "generation-retrying" : undefined}
      errorMessage={result.error}
      errorAction={surfaceErrorAction}
      footerLabel={
        result.retrying
          ? "重试中"
          : workbenchGenerationStatusLabel(result.status)
      }
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
        onEnterSelection();
      }}
      onImageAvailabilityChange={(available) => setBroken(!available)}
      mediaOverlay={surfaceMediaOverlay}
      mediaActions={surfaceMediaActions}
      footerActions={
        result.status === "success" ? (
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
