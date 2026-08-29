import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShellErrorBoundary } from '../ShellErrorBoundary';

/** 可控炸弹:首渲染抛错,「重试」后由外部状态放行。 */
function Bomb({ defused }: { defused: boolean }) {
  if (!defused) throw new Error('渲染炸了');
  return <p data-testid="shell-content">正常内容</p>;
}

describe('ShellErrorBoundary(渲染层全局兜底,ui-parity 01 §7 P0)', () => {
  beforeEach(() => {
    // React 会把边界捕获的错误重复打到 console.error;静音保持测试输出可读。
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('子树正常时透明渲染', () => {
    render(
      <ShellErrorBoundary>
        <Bomb defused />
      </ShellErrorBoundary>,
    );
    expect(screen.getByTestId('shell-content')).toBeTruthy();
    expect(screen.queryByTestId('shell-error')).toBeNull();
  });

  it('子树抛错时以错误卡替代白屏,重试后可恢复', () => {
    function Harness() {
      const [defused, setDefused] = useState(false);
      return (
        <>
          <button type="button" data-testid="defuse" onClick={() => setDefused(true)}>
            defuse
          </button>
          <ShellErrorBoundary>
            <Bomb defused={defused} />
          </ShellErrorBoundary>
        </>
      );
    }
    render(<Harness />);

    expect(screen.getByTestId('shell-error')).toBeTruthy();
    expect(screen.getByTestId('shell-error-message').textContent).toContain('渲染炸了');

    // 先解除故障源,再点「重试」:边界清空错误态后子树恢复。
    fireEvent.click(screen.getByTestId('defuse'));
    fireEvent.click(screen.getByTestId('shell-error-retry'));
    expect(screen.getByTestId('shell-content')).toBeTruthy();
    expect(screen.queryByTestId('shell-error')).toBeNull();
  });

  it('「重载应用」走宿主注入的重载回调', () => {
    const onReload = vi.fn();
    render(
      <ShellErrorBoundary onReload={onReload}>
        <Bomb defused={false} />
      </ShellErrorBoundary>,
    );
    fireEvent.click(screen.getByTestId('shell-error-reload'));
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});
