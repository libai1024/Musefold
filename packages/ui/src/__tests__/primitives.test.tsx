import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  Button,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  LoadingState,
  StatusBadge,
  Tabs,
  TabsList,
  TabsTrigger,
} from "../index";

describe("shared UI primitives", () => {
  it("renders a native action button with a stable variant contract", () => {
    const html = renderToStaticMarkup(
      <Button variant="secondary" size="sm" icon={<span aria-hidden="true">+</span>}>
        新建
      </Button>,
    );

    expect(html).toContain('type="button"');
    expect(html).toContain("mf-ui-button mf-ui-button-secondary mf-ui-button-sm");
    expect(html).toContain("新建");
  });

  it("supports product-owned geometry without losing shared button semantics", () => {
    const html = renderToStaticMarkup(
      <Button unstyled className="mf-prompt-main" disabled>
        查看提示词
      </Button>,
    );

    expect(html).toContain('type="button"');
    expect(html).toContain('disabled=""');
    expect(html).toContain("mf-ui-button mf-ui-button-unstyled mf-prompt-main");
  });

  it("requires an accessible name and provides a tooltip for icon controls", () => {
    const html = renderToStaticMarkup(
      <IconButton label="刷新历史">
        <span aria-hidden="true">R</span>
      </IconButton>,
    );

    expect(html).toContain('aria-label="刷新历史"');
    expect(html).toContain('title="刷新历史"');
    expect(html).toContain("mf-ui-icon-button");
  });

  it("exposes semantic status tones without requiring a product stylesheet", () => {
    const html = renderToStaticMarkup(
      <StatusBadge tone="success" data-testid="history-status">
        已完成
      </StatusBadge>,
    );

    expect(html).toContain("mf-ui-status mf-ui-status-success");
    expect(html).toContain('data-testid="history-status"');
    expect(html).toContain("已完成");
  });

  it("keeps form, tab and state surfaces on the shared contract", () => {
    const html = renderToStaticMarkup(
      <>
        <Input aria-label="账号" mono />
        <Tabs defaultValue="library">
          <TabsList>
            <TabsTrigger value="library">提示词库</TabsTrigger>
          </TabsList>
        </Tabs>
        <EmptyState title="暂无内容" hint="稍后再试" />
        <LoadingState label="正在同步" />
        <ErrorState message="加载失败" />
      </>,
    );

    expect(html).toContain("mf-ui-input mf-ui-input-mono");
    expect(html).toContain("mf-ui-tabs-list");
    expect(html).toContain("mf-ui-empty-state");
    expect(html).toContain('role="status"');
    expect(html).toContain('role="alert"');
  });
});
