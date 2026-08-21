import { useAppStore } from "../../../stores/app";
import { toImageSrc } from "../../../lib/media";
import { desktopHost as api } from "@renderer/runtime/desktop-host-services";
import { toast } from "../../../stores/toast";
import { WorkbenchGenerationResultCard } from "@musefold/product-ui";
import { useSettingsStore } from "@renderer/runtime/settings-access";
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
  const setView = useAppStore((state) => state.setView);
  const setSettingsSection = useSettingsStore((state) => state.setSection);

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

  const errorAction =
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

  return (
    <WorkbenchGenerationResultCard
      id={result.id}
      historyId={result.historyId}
      status={result.status}
      imageUrl={result.imagePath ? toImageSrc(result.imagePath) : null}
      aspectRatio={aspectRatio}
      busy={busy}
      errorMessage={result.error}
      retrying={result.retrying}
      retryAttempt={result.retryAttempt}
      retryMax={result.retryMax}
      onZoom={() => {
        if (result.imagePath) onZoom(result.imagePath);
      }}
      onRetry={onRetry}
      showRefineAction={showRefineAction}
      refinementEnabled={refinementEnabled}
      onRefine={onRefine}
      onHistory={onHistory}
      selectionEnabled={selectionEnabled}
      selectionMode={selectionMode}
      selected={selected}
      deselecting={deselecting}
      refinementTargetDisabled={refinementTargetDisabled}
      onEnterSelection={onEnterSelection}
      onToggleSelection={onToggleSelection}
      onSetAsRefinementTarget={onSetAsRefinementTarget}
      savePromptState={savePromptState}
      onSavePrompt={onSavePrompt}
      onSaveImage={saveImage}
      onCopyImage={copyImage}
      onOpenFolder={openFolder}
      errorAction={errorAction}
    />
  );
}
