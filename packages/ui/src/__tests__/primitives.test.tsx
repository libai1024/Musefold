import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  IconButton,
  ImageLightbox,
  Input,
  Kbd,
  LoadingState,
  ScrollArea,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Slider,
  Spinner,
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

describe("migrated SHARE-02 primitives", () => {
  it("renders compact chips, kbd, skeleton and spinner on the token contract", () => {
    const html = renderToStaticMarkup(
      <>
        <Badge variant="accent">云端</Badge>
        <Kbd>⌘K</Kbd>
        <Skeleton className="h-4" />
        <Spinner size={12} />
      </>,
    );

    expect(html).toContain('data-variant="accent"');
    expect(html).toContain("mf-ui-badge");
    expect(html).toContain("mf-ui-kbd");
    expect(html).toContain("⌘K");
    expect(html).toContain("mf-ui-skeleton");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("mf-ui-spinner");
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="加载中"');
  });

  it("marks the active segmented option and keeps inactive options clickable", () => {
    const html = renderToStaticMarkup(
      <SegmentedControl
        value="list"
        onChange={() => undefined}
        aria-label="视图"
        options={[
          { value: "list", label: "列表" },
          { value: "grid", label: "网格" },
        ]}
      />,
    );

    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="视图"');
    expect(html).toContain("mf-ui-segmented");
    expect(html).toMatch(/aria-selected="true"[^>]*>列表/);
    expect(html).toMatch(/aria-selected="false"[^>]*>网格/);
    expect(html).toContain('type="button"');
  });

  it("renders dropdown, select and slider chrome without leaving the shared class contract", () => {
    const html = renderToStaticMarkup(
      <>
        <DropdownMenu open>
          <DropdownMenuTrigger>清理</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>清理历史</DropdownMenuLabel>
            <DropdownMenuItem>清除 30 天前</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>清空全部</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Select defaultValue="a">
          <SelectTrigger aria-label="模型">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="a">默认</SelectItem>
          </SelectContent>
        </Select>
        <Slider defaultValue={[40]} max={100} aria-label="强度" />
        <ScrollArea>
          <p>内容</p>
        </ScrollArea>
      </>,
    );

    expect(html).toContain("mf-ui-dropdown-content");
    expect(html).toContain("mf-ui-dropdown-item");
    expect(html).toContain("mf-ui-dropdown-label");
    expect(html).toContain("mf-ui-select-trigger");
    expect(html).toContain("mf-ui-slider");
    expect(html).toContain("mf-ui-slider-thumb");
    expect(html).toContain("mf-ui-scroll-area");
    expect(html).toContain("内容");
  });

  it("renders lightbox chrome and only shows host-injected actions", () => {
    const withActions = renderToStaticMarkup(
      <ImageLightbox
        src="https://example.com/preview.png"
        prompt="暖光静物"
        onClose={() => undefined}
        onPrevious={() => undefined}
        onNext={() => undefined}
        hasPrevious
        hasNext
        onSave={() => undefined}
        onReveal={() => undefined}
        onCopyImage={() => undefined}
        onCopyPrompt={() => undefined}
      />,
    );
    const withoutActions = renderToStaticMarkup(
      <ImageLightbox src="https://example.com/preview.png" onClose={() => undefined} />,
    );

    expect(withActions).toContain('data-testid="image-lightbox"');
    expect(withActions).toContain('data-testid="image-lightbox-image"');
    expect(withActions).toContain('data-testid="image-lightbox-toolbar"');
    expect(withActions).toContain('data-testid="image-lightbox-save"');
    expect(withActions).toContain('data-testid="image-lightbox-folder"');
    expect(withActions).toContain('data-testid="image-lightbox-copy-image"');
    expect(withActions).toContain('data-testid="image-lightbox-copy-prompt"');
    expect(withActions).toContain('data-testid="image-lightbox-zoom-in"');
    expect(withActions).toContain('data-testid="image-lightbox-prev"');
    expect(withoutActions).toContain('data-testid="image-lightbox-zoom-in"');
    expect(withoutActions).not.toContain('data-testid="image-lightbox-save"');
    expect(withoutActions).not.toContain('data-testid="image-lightbox-folder"');
  });
});
