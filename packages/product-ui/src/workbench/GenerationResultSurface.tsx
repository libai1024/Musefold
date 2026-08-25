import {
  ImageOff,
  LoaderCircle,
  Square,
  X,
} from "@musefold/ui/icons";
import { Button } from "@musefold/ui";
import {
  useEffect,
  useState,
  type CSSProperties,
  type PointerEventHandler,
  type ReactNode,
  type Ref,
} from "react";
import type { GenerationResultSurfaceStatus } from "../models";
import { useResultTheaterReveal } from "./useResultTheaterReveal";

export interface GenerationResultSurfaceProps {
  id?: string;
  testId?: string;
  imageTestId?: string;
  dataHistoryId?: string | null;
  rootRef?: Ref<HTMLDivElement>;
  status: GenerationResultSurfaceStatus;
  imageUrl?: string | null;
  imageAlt?: string;
  imageLabel?: string;
  imageTitle?: string;
  aspectRatio?: string;
  progressLabel?: string;
  pendingLabel?: string;
  pendingTestId?: string;
  cancelledLabel?: string;
  unavailableLabel?: string;
  errorMessage?: string | null;
  footerLabel?: string;
  selected?: boolean;
  deselecting?: boolean;
  busy?: boolean;
  onOpenImage?: () => void;
  onImagePointerDown?: PointerEventHandler<HTMLButtonElement>;
  onImagePointerMove?: PointerEventHandler<HTMLButtonElement>;
  onImagePointerUp?: PointerEventHandler<HTMLButtonElement>;
  onImagePointerCancel?: PointerEventHandler<HTMLButtonElement>;
  onImagePointerLeave?: PointerEventHandler<HTMLButtonElement>;
  onImageContextMenu?: React.MouseEventHandler<HTMLButtonElement>;
  onImageAvailabilityChange?: (available: boolean) => void;
  mediaOverlay?: ReactNode;
  mediaActions?: ReactNode;
  errorAction?: ReactNode;
  footerActions?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export function GenerationResultSurface({
  id,
  testId = "generation-result-surface",
  imageTestId = "generation-result-image",
  dataHistoryId,
  rootRef,
  status,
  imageUrl,
  imageAlt = "生成结果",
  imageLabel = "查看大图",
  imageTitle = "查看大图",
  aspectRatio = "1:1",
  progressLabel,
  pendingLabel = "正在生成",
  pendingTestId,
  cancelledLabel = "已取消",
  unavailableLabel = "图片无法加载",
  errorMessage,
  footerLabel,
  selected = false,
  deselecting = false,
  busy = false,
  onOpenImage,
  onImagePointerDown,
  onImagePointerMove,
  onImagePointerUp,
  onImagePointerCancel,
  onImagePointerLeave,
  onImageContextMenu,
  onImageAvailabilityChange,
  mediaOverlay,
  mediaActions,
  errorAction,
  footerActions,
  className,
  children,
}: GenerationResultSurfaceProps) {
  const [broken, setBroken] = useState(false);
  const hasImage = status === "success" && Boolean(imageUrl);
  const imageAvailable = hasImage && !broken;
  const { revealing, idle, mediaRef } = useResultTheaterReveal(imageAvailable);

  useEffect(() => {
    setBroken(false);
    onImageAvailabilityChange?.(hasImage);
    // The host callback is a reporting hook; changing its inline identity must
    // not reset an image that has already failed to load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasImage, imageUrl]);

  const markBroken = () => {
    setBroken(true);
    onImageAvailabilityChange?.(false);
  };

  const mediaStyle: CSSProperties = {
    aspectRatio: ratioToCssValue(aspectRatio),
  };

  return (
    <div
      ref={rootRef}
      className={`mf-generation-result-surface${className ? ` ${className}` : ""}`}
      data-testid={testId}
      data-result-id={id}
      data-history-id={dataHistoryId ?? undefined}
      data-status={status}
      data-selected={selected || undefined}
      data-deselecting={deselecting || undefined}
      data-busy={busy || undefined}
      aria-busy={busy || undefined}
      data-image-available={imageAvailable || undefined}
      data-theater-idle={idle || undefined}
    >
      <div
        ref={mediaRef}
        className={`mf-generation-result-media${(!imageAvailable || status !== "success") ? " mf-generation-result-media-muted" : ""}`}
        style={mediaStyle}
        data-ui-register={revealing ? "theater" : undefined}
        data-theater-reveal={revealing || undefined}
      >
        {imageAvailable ? (
          <Button
            unstyled
            type="button"
            className="mf-generation-result-image-button"
            onClick={onOpenImage}
            onPointerDown={onImagePointerDown}
            onPointerMove={onImagePointerMove}
            onPointerUp={onImagePointerUp}
            onPointerCancel={onImagePointerCancel}
            onPointerLeave={onImagePointerLeave}
            onContextMenu={onImageContextMenu}
            disabled={!onOpenImage}
            aria-label={onOpenImage ? imageLabel : undefined}
            title={onOpenImage ? imageTitle : undefined}
            data-testid={imageTestId}
          >
            <img
              src={imageUrl ?? undefined}
              alt={imageAlt}
              draggable={false}
              onError={markBroken}
            />
          </Button>
        ) : status === "pending" ? (
          <div
            className="mf-generation-result-placeholder"
            role="status"
            aria-live="polite"
            data-testid={pendingTestId}
          >
            <LoaderCircle className="mf-spin" aria-hidden="true" />
            <span>{progressLabel ?? pendingLabel}</span>
          </div>
        ) : status === "cancelled" ? (
          <div className="mf-generation-result-placeholder">
            <Square aria-hidden="true" />
            <span>{cancelledLabel}</span>
          </div>
        ) : (
          <div className="mf-generation-result-placeholder mf-generation-result-failed">
            {broken ? <ImageOff aria-hidden="true" /> : <X aria-hidden="true" />}
            <span>{errorMessage ?? unavailableLabel}</span>
            {errorAction ? <div>{errorAction}</div> : null}
          </div>
        )}
        {imageAvailable && mediaOverlay}
        {imageAvailable && mediaActions ? (
          <div className="mf-generation-result-media-actions">{mediaActions}</div>
        ) : null}
        {children}
      </div>
      <div className="mf-generation-result-footer">
        <span>{footerLabel}</span>
        {footerActions ? <div>{footerActions}</div> : null}
      </div>
    </div>
  );
}

function ratioToCssValue(value: string): string {
  const [width, height] = value.split(":");
  if (!width || !height) return "1 / 1";
  return `${width} / ${height}`;
}
