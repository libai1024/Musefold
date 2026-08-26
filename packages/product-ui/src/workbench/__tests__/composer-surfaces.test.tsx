import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkbenchComposerContextTray } from "../WorkbenchComposerContextTray";
import { WorkbenchEmptyState } from "../WorkbenchEmptyState";

const suggestions = [
  "方向一",
  "方向二",
  "方向三",
  "方向四",
  "方向五",
  "方向六",
];

describe("shared workbench composer surfaces", () => {
  it("keeps context label and horizontally scannable item slot separate", () => {
    const html = renderToStaticMarkup(
      <WorkbenchComposerContextTray label="参考">
        <button type="button">提示词引用</button>
        <button type="button">两张图片</button>
      </WorkbenchComposerContextTray>,
    );

    expect(html).toContain('data-testid="workbench-context-tray"');
    expect(html).toContain('class="mf-workbench-context-tray-label"');
    expect(html).toContain(">参考</span>");
    expect(html).toContain('class="mf-workbench-context-tray-items"');
    expect(html).toContain("提示词引用");
    expect(html).toContain("两张图片");
  });

  it("shows at most three low-weight starter directions without an expander", () => {
    const html = renderToStaticMarkup(
      <WorkbenchEmptyState
        suggestions={suggestions}
        onSelectSuggestion={() => undefined}
      />,
    );

    // v2.0(02 §6 / 11 §6.2):建议最多三条,无「浏览灵感」展开器,只回填草稿。
    // 表现形式:无边框文本行,每条独占一行缓慢横滚;每行轨道渲染两份装饰序列
    // 以实现无缝循环,整行稳定命中层负责点击和键盘操作。
    expect(html.match(/data-testid="generation-example"/g)).toHaveLength(3);
    expect(html.match(/mf-workbench-direction-row/g)?.length).toBe(3);
    expect(html.match(/mf-workbench-direction-hit/g)).toHaveLength(3);
    expect(html).not.toContain('data-testid="generation-directions-toggle"');
    expect(html).toContain("方向一");
    expect(html).toContain("方向三");
    expect(html).not.toContain("方向四");
    expect(html).not.toContain("方向六");
    expect(html.match(/class="mf-workbench-direction-track" aria-hidden="true"/g)).toHaveLength(3);
  });

  it("falls back to defaults when an empty suggestion list is supplied", () => {
    const html = renderToStaticMarkup(<WorkbenchEmptyState suggestions={[]} />);

    expect(html.match(/data-testid="generation-example"/g)).toHaveLength(3);
    expect(html).toContain("漂浮在云层上的小型图书馆");
  });
});
