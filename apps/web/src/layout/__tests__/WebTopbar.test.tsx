import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WebTopbar } from '../WebNavigation';

function renderTopbar(commandPaletteEnabled: boolean, view: 'generate' | 'prompts' = 'generate') {
  return renderToStaticMarkup(
    <WebTopbar
      view={view}
      quota="1,200 积分"
      mode="fixture"
      workbenchTitle={null}
      workbenchSession={null}
      sidebarOpen
      onOpenSidebar={() => undefined}
      commandPaletteEnabled={commandPaletteEnabled}
      onSearch={() => undefined}
      onRenameSession={() => undefined}
      onArchiveSession={() => undefined}
      onDeleteSession={() => undefined}
    />,
  );
}

describe('WebTopbar host boundary (v2.1 parity C)', () => {
  it('keeps the desktop-only generate topbar affordances off the Web host', () => {
    const html = renderTopbar(true);
    // Desktop generate 顶栏专属入口（HX-DESKTOP-FILESYSTEM / HX-DESKTOP-WINDOW）不移植到 Web。
    expect(html).not.toContain('titlebar-task-summary');
    expect(html).not.toContain('titlebar-materials-toggle');
    // Web 显式替代状态：额度读数 + 搜索/命令入口。
    expect(html).toContain('quota-readout');
    expect(html).toContain('data-testid="web-topbar-search"');
  });

  it('labels search as the command palette entry only on large viewports', () => {
    expect(renderTopbar(true)).toContain('搜索与命令（⌘ K）');
    // 小屏维持既有「跳转提示词库」入口语义（shell 约束），不声明 ⌘K。
    expect(renderTopbar(false)).toContain('title="搜索"');
    expect(renderTopbar(false)).not.toContain('⌘ K');
  });
});
