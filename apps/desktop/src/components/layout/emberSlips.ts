// 朱点速记的共享工具（v0.3.3 §4/§6/§8）：
// 选区拾取、图片 src 反解、笺标题派生、落库。素笺卡与拾选/拾遗共用。
import { useLibraryStore } from '../../features/library/store';
import type { DesktopLibraryPrompt } from '@musefold/desktop-contracts/library-documents';

/** 笺标题：内容首行前 12 字；纯图笺叫「图像一笺」 */
export function slipTitle(content: string): string {
  const firstLine = content.split('\n').find((line) => line.trim() !== '')?.trim() ?? '';
  if (!firstLine) return '图像一笺';
  return firstLine.length > 12 ? `${firstLine.slice(0, 12)}…` : firstLine;
}

/** 笺正文上限（规范 §4：笺是念头不是文档） */
export const SLIP_TEXT_LIMIT = 2000;

export function clampSlipText(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > SLIP_TEXT_LIMIT ? `${trimmed.slice(0, SLIP_TEXT_LIMIT)}…` : trimmed;
}

/**
 * <img src> 反解为可入库的图片路径：
 * - data:（预览桥的 stageLocal 产物）原样收；
 * - media://local/?p=<encoded>（应用管理的本地文件）解出绝对路径；
 * - 其余（外链 http 等）不是应用资源，忽略图片只收文字。
 */
export function imageSrcToSlipPath(src: string | null | undefined): string | null {
  if (!src) return null;
  if (/^data:/i.test(src)) return src;
  const media = src.match(/^media:\/\/local\/\?p=(.+)$/i);
  if (media) {
    try {
      return decodeURIComponent(media[1]);
    } catch {
      return null;
    }
  }
  return null;
}

export interface CapturedSelection {
  text: string;
  imagePath: string | null;
}

/**
 * 拾选（§4）：读取页面静态内容的当前选区。
 * - 输入框 / 文本域 / contenteditable 里的选区不算（用户正在编辑的内容不拾）；
 * - 文字截断到 2000 字；图片取选区内第一张 <img> 且必须是应用资源；
 * - 没有可拾内容时返回 null（单击退回纯触感）。
 */
export function capturePageSelection(): CapturedSelection | null {
  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return null;

  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const anchor = selection.anchorNode;
  const anchorElement = anchor instanceof Element ? anchor : anchor?.parentElement;
  if (anchorElement?.closest('input, textarea, [contenteditable="true"]')) return null;

  const text = clampSlipText(selection.toString());

  let imagePath: string | null = null;
  for (let index = 0; index < selection.rangeCount && !imagePath; index += 1) {
    const fragment = selection.getRangeAt(index).cloneContents();
    const images = fragment.querySelectorAll('img');
    for (const image of images) {
      imagePath = imageSrcToSlipPath(image.getAttribute('src'));
      if (imagePath) break;
    }
  }

  if (!text && !imagePath) return null;
  return { text, imagePath };
}

/** 落一枚笺（source='slip'）；失败时 store 已弹 toast，返回 null。 */
export async function createSlip(input: { text?: string; imagePath?: string | null }): Promise<DesktopLibraryPrompt | null> {
  const content = clampSlipText(input.text ?? '');
  if (!content && !input.imagePath) return null;
  return useLibraryStore.getState().createPrompt({
    title: slipTitle(content),
    content,
    previewImagePath: input.imagePath ?? undefined,
    source: 'slip',
  });
}

/** 抽回一枚笺（批注撤销通道，§6） */
export async function recallSlip(id: string): Promise<boolean> {
  return useLibraryStore.getState().deletePrompt(id);
}
