// src/components/layout/WindowControls.tsx
// 窗口控件 —— Windows/Linux 使用完整控件，mac 额外提供右侧最小化入口
// 关闭键 hover 变红（Windows 语义），最小化/最大化 hover 中性高亮
// 交互贴近系统：命中区 46×36（win 标准），图标发丝级 stroke

import { Copy as RestoreIcon, Minus as MinimizeIcon, Square as MaximizeIcon, X as CloseIcon } from '../ui/icons';
import { useWindowMaximized } from '../../lib/usePlatform';
import { desktopHost as api } from '@renderer/runtime/desktop-host-services';

const neutralButtonClass =
  'no-drag flex h-full w-[46px] items-center justify-center text-secondary transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-hover hover:text-primary focus-visible:outline-none';

export function MinimizeWindowButton() {
  return (
    <button
      className={neutralButtonClass}
      onClick={() => api.window.minimize()}
      aria-label="最小化"
      title="最小化"
    >
      <MinimizeIcon className="h-[10px] w-[10px]" strokeWidth={1.5} aria-hidden="true" />
    </button>
  );
}

export function WindowControls() {
  const isMax = useWindowMaximized();
  const w = api.window;

  return (
    <div className="no-drag flex h-full items-stretch">
      <MinimizeWindowButton />
      <button
        className={neutralButtonClass}
        onClick={() => w?.maximizeToggle()}
        aria-label={isMax ? '还原' : '最大化'}
        title={isMax ? '还原' : '最大化'}
      >
        {isMax ? (
          <RestoreIcon className="h-[10px] w-[10px]" strokeWidth={1.5} aria-hidden="true" />
        ) : (
          <MaximizeIcon className="h-[10px] w-[10px]" strokeWidth={1.5} aria-hidden="true" />
        )}
      </button>
      <button
        className="no-drag flex h-full w-[46px] items-center justify-center text-secondary transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-danger hover:text-on-danger focus-visible:outline-none"
        onClick={() => w?.close()}
        aria-label="关闭"
        title="关闭"
      >
        <CloseIcon className="h-[10px] w-[10px]" strokeWidth={1.5} aria-hidden="true" />
      </button>
    </div>
  );
}
