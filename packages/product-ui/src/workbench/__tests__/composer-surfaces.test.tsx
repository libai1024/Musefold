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

  it("shows three starter directions and keeps additional inspiration collapsed", () => {
    const html = renderToStaticMarkup(
      <WorkbenchEmptyState
        brand={<span aria-hidden="true">mark</span>}
        suggestions={suggestions}
        onSelectSuggestion={() => undefined}
      />,
    );

    expect(html.match(/data-testid="generation-example"/g)).toHaveLength(3);
    expect(html).toContain('data-testid="generation-directions-toggle"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("方向一");
    expect(html).toContain("方向三");
    expect(html).not.toContain(">方向四</button>");
    expect(html).not.toContain(">方向六</button>");
  });

  it("falls back to defaults when an empty suggestion list is supplied", () => {
    const html = renderToStaticMarkup(
      <WorkbenchEmptyState
        brand={<span aria-hidden="true">mark</span>}
        suggestions={[]}
      />,
    );

    expect(html.match(/data-testid="generation-example"/g)).toHaveLength(3);
    expect(html).toContain("漂浮在云层上的小型图书馆");
  });
});
