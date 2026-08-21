/** 引用面板的浮窗几何：尺寸下限、边距、缩放把手与越界收敛（V13-REUSE-03 从面板组件析出）。 */

export type ResizeDirection = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

export interface PanelFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ResizeState {
  pointerId: number;
  direction: ResizeDirection;
  startX: number;
  startY: number;
  frame: PanelFrame;
  boundsWidth: number;
  boundsHeight: number;
}

export interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export const DEFAULT_PANEL_WIDTH = 304;
export const DEFAULT_PANEL_HEIGHT = 414;
export const MIN_PANEL_WIDTH = 280;
export const MIN_PANEL_HEIGHT = 220;
export const PANEL_MARGIN = 12;

export const RESIZE_HANDLES: Array<{ direction: ResizeDirection; className: string }> = [
  { direction: 'n', className: 'left-4 right-4 top-0 h-2 cursor-ns-resize' },
  { direction: 'ne', className: 'right-0 top-0 h-4 w-4 cursor-nesw-resize' },
  { direction: 'e', className: 'bottom-4 right-0 top-4 w-2 cursor-ew-resize' },
  { direction: 'se', className: 'bottom-0 right-0 h-4 w-4 cursor-nwse-resize' },
  { direction: 's', className: 'bottom-0 left-4 right-4 h-2 cursor-ns-resize' },
  { direction: 'sw', className: 'bottom-0 left-0 h-4 w-4 cursor-nesw-resize' },
  { direction: 'w', className: 'bottom-4 left-0 top-4 w-2 cursor-ew-resize' },
  { direction: 'nw', className: 'left-0 top-0 h-4 w-4 cursor-nwse-resize' },
];

export function clampFrame(
  frame: PanelFrame,
  boundsWidth: number,
  boundsHeight: number,
): PanelFrame {
  const maxWidth = Math.max(MIN_PANEL_WIDTH, boundsWidth - PANEL_MARGIN * 2);
  const maxHeight = Math.max(MIN_PANEL_HEIGHT, boundsHeight - PANEL_MARGIN * 2);
  const width = Math.min(maxWidth, Math.max(MIN_PANEL_WIDTH, frame.width));
  const height = Math.min(maxHeight, Math.max(MIN_PANEL_HEIGHT, frame.height));
  return {
    x: Math.min(Math.max(PANEL_MARGIN, frame.x), Math.max(PANEL_MARGIN, boundsWidth - width - PANEL_MARGIN)),
    y: Math.min(Math.max(PANEL_MARGIN, frame.y), Math.max(PANEL_MARGIN, boundsHeight - height - PANEL_MARGIN)),
    width,
    height,
  };
}
