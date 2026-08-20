export const DOUBAO_GENERATED_IMAGE_MIN_NATURAL_SIZE = 256;
export const DOUBAO_GENERATED_IMAGE_MIN_DISPLAY_SIZE = 160;
export const DOUBAO_USER_MESSAGE_ALIGNMENT_CLASS = 'justify-end';

export interface DoubaoDomImageCandidate {
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  displayWidth: number;
  displayHeight: number;
}

export interface DoubaoDomCanvasCandidate {
  width: number;
  height: number;
  displayWidth: number;
  displayHeight: number;
}

export function isDoubaoGeneratedDomImageCandidate(candidate: DoubaoDomImageCandidate): boolean {
  const src = candidate.src.trim().toLowerCase();
  if (!src || src.startsWith('data:image/svg+xml')) return false;
  return (
    candidate.naturalWidth >= DOUBAO_GENERATED_IMAGE_MIN_NATURAL_SIZE
    && candidate.naturalHeight >= DOUBAO_GENERATED_IMAGE_MIN_NATURAL_SIZE
    && candidate.displayWidth >= DOUBAO_GENERATED_IMAGE_MIN_DISPLAY_SIZE
    && candidate.displayHeight >= DOUBAO_GENERATED_IMAGE_MIN_DISPLAY_SIZE
  );
}

/** 带参考图生成完成后，豆包会自动用大画布打开单张结果。 */
export function isDoubaoGeneratedCanvasCandidate(candidate: DoubaoDomCanvasCandidate): boolean {
  return (
    candidate.width >= DOUBAO_GENERATED_IMAGE_MIN_NATURAL_SIZE
    && candidate.height >= DOUBAO_GENERATED_IMAGE_MIN_NATURAL_SIZE
    && candidate.displayWidth >= DOUBAO_GENERATED_IMAGE_MIN_DISPLAY_SIZE
    && candidate.displayHeight >= DOUBAO_GENERATED_IMAGE_MIN_DISPLAY_SIZE
  );
}

export function isDoubaoUserMessageClassChain(classNames: string[]): boolean {
  return classNames.some((className) =>
    className.split(/\s+/).includes(DOUBAO_USER_MESSAGE_ALIGNMENT_CLASS),
  );
}
