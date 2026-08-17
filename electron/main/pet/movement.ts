export interface PetPoint {
  x: number;
  y: number;
}

export interface PetBounds extends PetPoint {
  width: number;
  height: number;
}

export interface PetSize {
  width: number;
  height: number;
}

/** 现有跑动节奏整体减速一半：同样距离使用原先两倍时间。 */
export function petTravelDuration(distance: number): number {
  return Math.min(2_800, Math.max(960, distance * 2.4));
}

export function clampPetPosition(
  point: PetPoint,
  bounds: PetBounds,
  size: PetSize,
): PetPoint {
  const clamp = (value: number, min: number, max: number): number =>
    Math.min(Math.max(value, min), Math.max(min, max));

  return {
    x: clamp(Math.round(point.x), bounds.x, bounds.x + bounds.width - size.width),
    y: clamp(Math.round(point.y), bounds.y, bounds.y + bounds.height - size.height),
  };
}

export function toRelativePosition(point: PetPoint, bounds: PetBounds): PetPoint {
  return { x: point.x - bounds.x, y: point.y - bounds.y };
}

export function fromRelativePosition(point: PetPoint, bounds: PetBounds): PetPoint {
  return { x: bounds.x + point.x, y: bounds.y + point.y };
}

/** 用系统鼠标绝对坐标计算拖拽位置，避免窗口移动反向扰动渲染层鼠标增量。 */
export function petPositionFromCursor(
  petAtStart: PetPoint,
  cursorAtStart: PetPoint,
  cursorNow: PetPoint,
): PetPoint {
  return {
    x: petAtStart.x + cursorNow.x - cursorAtStart.x,
    y: petAtStart.y + cursorNow.y - cursorAtStart.y,
  };
}
