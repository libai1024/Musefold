/**
 * Системный share изображений через Web Share API (V11-UX-05).
 * На хостах без navigator.share (desktop/Electron) кнопки share скрываются —
 * проверяйте canShareImage() перед рендером.
 */

export function canShareImage(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

/**
 * Делится изображением как файлом; если файл получить или расшарить нельзя
 * (CORS, ограничения платформы) — делится ссылкой. Возвращает true, если
 * системный диалог был показан (отмена пользователем — тоже true).
 */
export async function shareImageAsset(url: string, title = 'Musefold'): Promise<boolean> {
  if (!canShareImage()) return false;

  let files: File[] | undefined;
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const type = blob.type || 'image/png';
    const extension = type.split('/')[1]?.split('+')[0] || 'png';
    const file = new File([blob], `musefold-image.${extension}`, { type });
    if (navigator.canShare?.({ files: [file] })) files = [file];
  } catch {
    files = undefined;
  }

  try {
    await navigator.share(files ? { files, title } : { title, url });
    return true;
  } catch (error) {
    return error instanceof DOMException && error.name === 'AbortError';
  }
}
