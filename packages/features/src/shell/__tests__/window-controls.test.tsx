import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  WINDOW_CONTROL_BUTTON_WIDTH_PX,
  WINDOW_CONTROLS_BAND_HEIGHT_PX,
  WINDOW_CONTROLS_BAND_WIDTH_PX,
  WindowControls,
} from '../WindowControls';

describe('WindowControls(纯 UI,B2-T6)', () => {
  it('三钮回调、aria-label,还原态切图标语义', () => {
    const onMinimize = vi.fn();
    const onMaximizeToggle = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(
      <WindowControls
        isMaximized={false}
        onMinimize={onMinimize}
        onMaximizeToggle={onMaximizeToggle}
        onClose={onClose}
      />,
    );

    expect(screen.getByTestId('window-control-minimize').getAttribute('aria-label')).toBe('最小化');
    expect(screen.getByTestId('window-control-maximize').getAttribute('aria-label')).toBe('最大化');
    expect(screen.getByTestId('window-control-close').getAttribute('aria-label')).toBe('关闭');
    expect(WINDOW_CONTROLS_BAND_WIDTH_PX).toBe(WINDOW_CONTROL_BUTTON_WIDTH_PX * 3);
    expect(WINDOW_CONTROLS_BAND_HEIGHT_PX).toBe(32);

    fireEvent.click(screen.getByTestId('window-control-minimize'));
    fireEvent.click(screen.getByTestId('window-control-maximize'));
    fireEvent.click(screen.getByTestId('window-control-close'));
    expect(onMinimize).toHaveBeenCalledTimes(1);
    expect(onMaximizeToggle).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(
      <WindowControls
        isMaximized
        onMinimize={onMinimize}
        onMaximizeToggle={onMaximizeToggle}
        onClose={onClose}
      />,
    );
    expect(screen.getByTestId('window-control-maximize').getAttribute('aria-label')).toBe('还原');
  });
});
