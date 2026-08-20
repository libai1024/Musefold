import { useEffect } from 'react';

/**
 * Детекция экранной клавиатуры для мобильной вёрстки (styles.css, ≤680px):
 * ставит на документ атрибут `data-keyboard-open` и CSS-переменную
 * `--keyboard-inset`, чтобы поднять composer над экранной клавиатурой.
 *
 * Два сценария:
 * - iOS Safari: layout viewport не сжимается, клавиатура перекрывает низ
 *   страницы — перекрытие видно как разница window.innerHeight и
 *   visualViewport.height, прокидывается в `--keyboard-inset`.
 * - Android с `interactive-widget=resizes-content`: layout viewport сжимается
 *   сам (перекрытие нулевое) — клавиатуру выдаёт резкое уменьшение
 *   window.innerHeight при сфокусированном поле ввода.
 *
 * Важно: реагируем только на фактическую клавиатуру, а не на голый фокус —
 * иначе вёрстка прыгает под указателем (аппаратная клавиатура, десктопное
 * окно мобильной ширины) и тапы промахиваются.
 */
export function useKeyboardInset(): void {
  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    let baselineHeight = window.innerHeight;

    const isEditableFocused = () => {
      const active = document.activeElement;
      return (
        active instanceof HTMLElement &&
        (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT' || active.isContentEditable)
      );
    };

    const update = () => {
      const overlayInset = viewport
        ? Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop))
        : 0;
      const editing = isEditableFocused();
      // Базовая высота обновляется, пока поля не в фокусе (поворот экрана,
      // сворачивание адресной строки) — сравнение с ней ловит resizes-content.
      if (!editing) baselineHeight = window.innerHeight;
      const resizeInset = editing ? Math.max(0, baselineHeight - window.innerHeight) : 0;
      root.style.setProperty('--keyboard-inset', `${overlayInset}px`);
      // Порог 80px отсекает мелкие сдвиги viewport — клавиатура всегда выше.
      if (overlayInset > 80 || resizeInset > 80) {
        root.setAttribute('data-keyboard-open', 'true');
      } else {
        root.removeAttribute('data-keyboard-open');
      }
    };

    update();
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    return () => {
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
      root.style.removeProperty('--keyboard-inset');
      root.removeAttribute('data-keyboard-open');
    };
  }, []);
}
