'use client';

import { Copy, Minus, Square, X } from '@musefold/ui/icons';

export interface WindowControlsProps {
  /** 最大化态切「还原」图标与 aria-label(承旧 TitleBar / WindowControls)。 */
  isMaximized: boolean;
  onMinimize: () => void;
  onMaximizeToggle: () => void;
  onClose: () => void;
}

/** 单钮命中区宽,与 `w-[46px]` 对齐。 */
export const WINDOW_CONTROL_BUTTON_WIDTH_PX = 46;
/** 三钮带宽 46×3。 */
export const WINDOW_CONTROLS_BAND_WIDTH_PX = WINDOW_CONTROL_BUTTON_WIDTH_PX * 3;
/** 控件带高,与 AppShell `h-8` 对齐。 */
export const WINDOW_CONTROLS_BAND_HEIGHT_PX = 32;

/** 命中区 46×满高、中性 hover(承旧 WindowControls neutralButtonClass)。 */
const neutralButtonClass =
  'flex h-full w-[46px] items-center justify-center text-muted-foreground transition-colors duration-(--dur-fast) ease-out outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50';

/**
 * Win/Linux 自绘窗口控件(纯 UI):最小化 / 最大化⇄还原 / 关闭。
 * 回调由桌面宿主接线;本文件不 import electron / 宿主。
 */
export function WindowControls({
  isMaximized,
  onMinimize,
  onMaximizeToggle,
  onClose,
}: WindowControlsProps) {
  return (
    <div className="flex h-full items-stretch" data-testid="window-controls">
      <button
        type="button"
        className={neutralButtonClass}
        aria-label="最小化"
        title="最小化"
        data-testid="window-control-minimize"
        onClick={onMinimize}
      >
        <Minus className="size-[10px]" strokeWidth={1.5} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={neutralButtonClass}
        aria-label={isMaximized ? '还原' : '最大化'}
        title={isMaximized ? '还原' : '最大化'}
        data-testid="window-control-maximize"
        onClick={onMaximizeToggle}
      >
        {isMaximized ? (
          <Copy className="size-[10px]" strokeWidth={1.5} aria-hidden="true" />
        ) : (
          <Square className="size-[10px]" strokeWidth={1.5} aria-hidden="true" />
        )}
      </button>
      <button
        type="button"
        className="flex h-full w-[46px] items-center justify-center text-muted-foreground transition-colors duration-(--dur-fast) ease-out outline-none hover:bg-destructive hover:text-destructive-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        aria-label="关闭"
        title="关闭"
        data-testid="window-control-close"
        onClick={onClose}
      >
        <X className="size-[10px]" strokeWidth={1.5} aria-hidden="true" />
      </button>
    </div>
  );
}
