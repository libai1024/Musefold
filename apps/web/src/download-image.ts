/** Скачивание изображения без ухода со страницы (fallback — открытие в новой
 * вкладке, если браузер игнорирует download для cross-origin URL). */
export function downloadImage(url: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = '';
  link.rel = 'noopener';
  link.target = '_blank';
  document.body.appendChild(link);
  link.click();
  link.remove();
}
