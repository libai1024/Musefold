import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GenerationHistoryRow } from "../history/GenerationHistoryRow";
import { PromptLibraryScreen } from "../library/PromptLibraryScreen";
import { WorkbenchComposerToolbar } from "../workbench/WorkbenchComposerToolbar";
import { WorkbenchComposerSaveStatus } from "../workbench/WorkbenchComposerSaveStatus";
import { WorkbenchComposerSubmitButton } from "../workbench/WorkbenchComposerSubmitButton";
import { GenerationSavePromptAction } from "../workbench/GenerationSavePromptAction";
import { GenerationRetryAction } from "../workbench/GenerationRetryAction";
import { PromptDetailScreen } from "../library/PromptDetailScreen";
import { PromptEditorForm } from "../library/PromptEditorForm";
import { PromptTrashScreen } from "../library/PromptTrashScreen";
import { GenerationHistoryDetailScreen } from "../history/GenerationHistoryDetailScreen";
import { GenerationHistoryDetailActions } from "../history/GenerationHistoryDetailActions";
import { GenerationHistoryTrashScreen } from "../history/GenerationHistoryTrashScreen";
import {
  GenerationHistoryInspectorPanel,
  GenerationHistoryWorkspace,
} from "../history/GenerationHistoryWorkspace";
import { GenerationResultSurface } from "../workbench/GenerationResultSurface";
import { WorkbenchResultGrid } from "../workbench/WorkbenchResultGrid";
import { WorkbenchAssistantFrame } from "../workbench/WorkbenchAssistantFrame";
import { WorkbenchAssistantHeader } from "../workbench/WorkbenchAssistantHeader";
import { WorkbenchAssistantAvatar } from "../workbench/WorkbenchAssistantAvatar";
import { WorkbenchComposerSurface } from "../workbench/WorkbenchComposerSurface";
import { WorkbenchComposerFrame } from "../workbench/WorkbenchComposerFrame";
import { WorkbenchDraftConflictNotice } from "../workbench/WorkbenchDraftConflictNotice";
import { workbenchRatioOptions } from "../workbench/workbenchDisplay";
import { WorkbenchTurnFrame } from "../workbench/WorkbenchTurnFrame";
import { WorkbenchUserMessage } from "../workbench/WorkbenchUserMessage";
import { WorkbenchMessageActions } from "../workbench/WorkbenchMessageActions";
import { WorkbenchPromptReferenceCard } from "../workbench/WorkbenchPromptReferenceCard";
import { WorkbenchSessionMenuTrigger } from "../workbench/WorkbenchSessionMenuTrigger";
import {
  WorkbenchSessionList,
  groupWorkbenchSessions,
} from "../workbench/WorkbenchSessionList";
import { WorkbenchEmptyState } from "../workbench/WorkbenchEmptyState";
import { WorkbenchRatioPicker } from "../workbench/WorkbenchRatioPicker";
import { WorkbenchGenerationSettingsPopover } from "../workbench/WorkbenchGenerationSettingsPopover";
import { WorkbenchContextMenu } from "../workbench/WorkbenchContextMenu";
import { WorkbenchPageFrame } from "../workbench/WorkbenchPageFrame";
import { WorkbenchTimelineContent } from "../workbench/WorkbenchTimelineContent";
import { isWorkbenchTimelineNearLatest } from "../workbench/useWorkbenchTimelineController";
import { ProductNavButton, ProductSidebar } from "../navigation/ProductSidebar";
import {
  PRODUCT_SIDEBAR_DEFAULT_WIDTH,
  PRODUCT_SIDEBAR_MAX_WIDTH,
  PRODUCT_SIDEBAR_MIN_WIDTH,
  ProductSidebarLayout,
} from "../navigation/ProductSidebarLayout";
import {
  ProductTopbar,
  productTopbarDisplayTitle,
} from "../navigation/ProductTopbar";
import { ProductPageHeader } from "../navigation/ProductPageHeader";
import { AccountSummaryPanel } from "../account/AccountSummaryPanel";
import { AccountScreen } from "../account/AccountScreen";
import { ConnectedAppsScreen } from "../account/ConnectedAppsScreen";
import {
  createHistoryInspectorState,
  historyInspectorReducer,
} from "../history/useHistoryInspectorController";
import { workbenchSessionControllerReducer } from "../workbench/useWorkbenchSessionController";

const promptDetail = {
  id: "prompt-detail-1",
  title: "纸感海报",
  description: "留白与印刷颗粒",
  content: "暖白纸张和钴蓝色锚点",
  negative: "霓虹",
  usageCount: 3,
  tags: ["海报"],
  isPinned: true,
  sourceLabel: "手动创建",
  createdAtLabel: "2026/8/17",
  updatedAtLabel: "2026/8/18",
  deletedAtLabel: null,
};

describe("shared product views", () => {
  it("shares the prompt reference card contract across composers", () => {
    const html = renderToStaticMarkup(
      <WorkbenchPromptReferenceCard
        title="夜色建筑摄影"
        text="雨后的城市建筑，克制的清晨光"
        onClear={() => undefined}
      />,
    );

    expect(html).toContain('data-testid="refine-source"');
    expect(html).toContain('data-workbench-testid="workbench-source"');
    expect(html).toContain('aria-label="移除来源：夜色建筑摄影"');
    expect(html).toContain("引用提示词");
  });

  it("keeps the compact title rule identical across desktop and web shells", () => {
    expect(productTopbarDisplayTitle("新设计")).toBe("新设计");
    expect(productTopbarDisplayTitle("中文长标题一二三四五六")).toBe(
      "中文长标题一二三四五",
    );
    expect(productTopbarDisplayTitle("abcdefghijklmnop")).toBe("abcdefghij");
  });

  it("keeps history inspector navigation deterministic across hosts", () => {
    const initial = createHistoryInspectorState({ initialCollapsed: true });
    const detail = historyInspectorReducer(initial, {
      type: "open-detail",
      id: "history-1",
      origin: "trash",
    });
    expect(detail).toMatchObject({
      mode: "detail",
      origin: "trash",
      selectedId: "history-1",
      collapsed: false,
    });
    expect(
      historyInspectorReducer(detail, { type: "open-trash" }),
    ).toMatchObject({ mode: "trash", selectedId: null });
    expect(
      historyInspectorReducer(detail, { type: "open-list" }),
    ).toMatchObject({ mode: "list", selectedId: "history-1" });
  });

  it("keeps recent workbench session list mutations deterministic", () => {
    const initial = {
      items: [],
      selectedId: null,
      openingId: null,
      loading: false,
      error: null,
    };
    const loaded = workbenchSessionControllerReducer(initial, {
      type: "replace",
      items: [
        { id: "session-a", title: "A" },
        { id: "session-b", title: "B" },
      ],
    });
    const updated = workbenchSessionControllerReducer(loaded, {
      type: "upsert",
      item: { id: "session-b", title: "B updated" },
    });
    const removed = workbenchSessionControllerReducer(updated, {
      type: "remove",
      id: "session-a",
    });

    expect(updated.items).toEqual([
      { id: "session-b", title: "B updated" },
      { id: "session-a", title: "A" },
    ]);
    expect(removed.items).toEqual([{ id: "session-b", title: "B updated" }]);
  });

  it("renders prompt sections and actions without a platform runtime", () => {
    const html = renderToStaticMarkup(
      <PromptLibraryScreen
        prompts={[
          {
            id: "prompt-pinned",
            title: "置顶提示词",
            content: "一张平静的海报",
            usageCount: 4,
            tags: ["海报"],
            isPinned: true,
          },
          {
            id: "prompt-normal",
            title: "普通提示词",
            content: "玻璃静物摄影",
            usageCount: 0,
            isPinned: false,
          },
        ]}
        onCopy={() => undefined}
        onUse={() => undefined}
      />,
    );

    expect(html).toContain("置顶提示词");
    expect(html).toContain("普通提示词");
    expect(html).toContain("复制 置顶提示词");
    expect(html).toContain("使用 4 次");
    expect(html).not.toContain("window.api");
  });

  it("keeps generation status and lineage metadata in the shared row", () => {
    const html = renderToStaticMarkup(
      <GenerationHistoryRow
        item={{
          id: "generation-1",
          prompt: "产品海报",
          statusKey: "failed",
          statusLabel: "失败",
          statusTone: "danger",
          metadata: ["gpt-image-1", "Cloud MCP"],
          selected: true,
          depth: 2,
          threadRootId: "generation-root",
          isRetrying: true,
          refinementLabel: "微调 2",
          refinementTitle: "基于上一张图微调",
          refinementCount: 3,
        }}
        actions={<button type="button">重试</button>}
        onOpen={() => undefined}
      />,
    );

    expect(html).toContain('data-status="failed"');
    expect(html).toContain('data-depth="2"');
    expect(html).toContain('data-thread-root="generation-root"');
    expect(html).toContain('data-testid="history-thread-connector"');
    expect(html).toContain('data-testid="history-thumb-open"');
    expect(html).toContain('data-testid="history-retrying"');
    expect(html).toContain('data-testid="history-refinement-tag"');
    expect(html).toContain('data-testid="history-thread-count"');
    expect(html).toContain("Cloud MCP");
    expect(html).toContain("重试");
  });

  it("provides one toolbar layout boundary for both hosts", () => {
    const html = renderToStaticMarkup(
      <WorkbenchComposerToolbar className="desktop-or-web-host">
        <button type="button">生成</button>
      </WorkbenchComposerToolbar>,
    );

    expect(html).toContain('class="mf-workbench-toolbar desktop-or-web-host"');
    expect(html).toContain("生成");
  });

  it("shares composer submission and draft status semantics", () => {
    const submit = renderToStaticMarkup(
      <WorkbenchComposerSubmitButton
        active
        activeLabel="取消生成"
        activeIcon={<span data-testid="stop-icon">停止</span>}
        onClick={() => undefined}
      />,
    );
    const saving = renderToStaticMarkup(
      <WorkbenchComposerSaveStatus status="saving" />,
    );
    const saved = renderToStaticMarkup(
      <WorkbenchComposerSaveStatus status="saved" />,
    );

    expect(submit).toContain('data-active="true"');
    expect(submit).toContain('aria-label="取消生成"');
    expect(submit).toContain('data-testid="stop-icon"');
    expect(saving).toContain('data-status="saving"');
    expect(saving).toContain("保存中");
    expect(saved).toContain('data-status="saved"');
    expect(saved).toContain("已同步");
  });

  it("shares save-prompt action states between hosts", () => {
    const idle = renderToStaticMarkup(
      <GenerationSavePromptAction state="idle" onSave={() => undefined} />,
    );
    const saved = renderToStaticMarkup(
      <GenerationSavePromptAction state="saved" onSave={() => undefined} />,
    );

    expect(idle).toContain("存为提示词");
    expect(idle).not.toContain("disabled");
    expect(saved).toContain("已存为提示词");
    expect(saved).toContain("disabled");
  });

  it("shares generation retry semantics between hosts", () => {
    const idle = renderToStaticMarkup(
      <GenerationRetryAction onRetry={() => undefined} />,
    );
    const busy = renderToStaticMarkup(
      <GenerationRetryAction onRetry={() => undefined} busy />,
    );

    expect(idle).toContain('data-testid="result-retry"');
    expect(idle).toContain('aria-label="重试"');
    expect(idle).not.toContain("disabled");
    expect(busy).toContain('aria-label="重试中"');
    expect(busy).toContain('aria-busy="true"');
    expect(busy).toContain("disabled");
    expect(busy).toContain("mf-spin");
  });

  it("renders shared prompt detail actions and content", () => {
    const html = renderToStaticMarkup(
      <PromptDetailScreen
        prompt={promptDetail}
        onBack={() => undefined}
        onUse={() => undefined}
        onEdit={() => undefined}
        onDelete={() => undefined}
      />,
    );

    expect(html).toContain('data-testid="prompt-detail"');
    expect(html).toContain('data-testid="detail-title"');
    expect(html).toContain('data-testid="detail-content"');
    expect(html).toContain("暖白纸张和钴蓝色锚点");
  });

  it("keeps editor and trash lifecycle controls platform neutral", () => {
    const editor = renderToStaticMarkup(
      <PromptEditorForm
        heading="编辑提示词"
        initial={{
          title: promptDetail.title,
          description: promptDetail.description,
          content: promptDetail.content,
          negative: promptDetail.negative,
          isPinned: true,
        }}
        onCancel={() => undefined}
        onSubmit={() => undefined}
      />,
    );
    const trash = renderToStaticMarkup(
      <PromptTrashScreen
        prompts={[{ ...promptDetail, deletedAtLabel: "2026/8/18" }]}
        onBack={() => undefined}
        onRestore={() => undefined}
      />,
    );

    expect(editor).toContain('data-testid="prompt-editor"');
    expect(editor).toContain("纸感海报");
    expect(trash).toContain('data-testid="trash-restore"');
    expect(trash).toContain("恢复");
  });

  it("shares generation detail content and lifecycle actions", () => {
    const detail = {
      id: "generation-detail-1",
      prompt: "雨后的安静建筑",
      negative: "霓虹文字",
      imageUrl: "https://assets.example/generation.png",
      statusKey: "succeeded",
      statusLabel: "已完成",
      statusTone: "success" as const,
      modelLabel: "Musefold Image Pro",
      metadata: ["Web 工作台", "1000 点", "2 秒"],
      paramsLabel: "1024x1024 · 中等质量",
      sourceLabel: "个人工作台",
      deletedAtLabel: null,
      error: null,
    };
    const html = renderToStaticMarkup(
      <GenerationHistoryDetailScreen
        detail={detail}
        onBack={() => undefined}
        onReuse={() => undefined}
        onSavePrompt={() => undefined}
        onDelete={() => undefined}
      />,
    );
    const trash = renderToStaticMarkup(
      <GenerationHistoryTrashScreen
        items={[{ ...detail, deletedAtLabel: "2026/8/18" }]}
        onBack={() => undefined}
        onRestore={() => undefined}
      />,
    );

    expect(html).toContain('data-testid="history-detail"');
    expect(html).toContain('data-testid="history-detail-prompt"');
    expect(html).toContain("雨后的安静建筑");
    expect(html).toContain("再次制作");
    expect(trash).toContain('data-testid="history-trash-restore"');
  });

  it("shares generation result media and status states", () => {
    const success = renderToStaticMarkup(
      <GenerationResultSurface
        id="result-1"
        status="success"
        imageUrl="https://assets.example/result.png"
        aspectRatio="16:9"
        footerLabel="1.8 秒"
        onOpenImage={() => undefined}
        mediaActions={<button type="button">下载</button>}
        footerActions={<button type="button">微调</button>}
      />,
    );
    const pending = renderToStaticMarkup(
      <GenerationResultSurface
        status="pending"
        progressLabel="42%"
        footerLabel="生成中"
      />,
    );

    expect(success).toContain('data-status="success"');
    expect(success).toContain('style="aspect-ratio:16 / 9"');
    expect(success).toContain("result.png");
    expect(success).toContain("下载");
    expect(pending).toContain('data-status="pending"');
    expect(pending).toContain("42%");

    const busy = renderToStaticMarkup(
      <GenerationResultSurface status="pending" busy footerLabel="生成中" />,
    );
    expect(busy).toContain('aria-busy="true"');
    expect(busy).toContain('data-busy="true"');

    // THEATER-04：静态挂载的成功终态不携带 theater 属性；显形只属于挂载后的转场。
    expect(success).not.toContain("data-theater-reveal");
    expect(success).not.toContain('data-ui-register="theater"');
  });

  it("shares result grid batch geometry", () => {
    const html = renderToStaticMarkup(
      <WorkbenchResultGrid count={4} aspectRatio="16:9">
        <div>结果 1</div>
        <div>结果 2</div>
      </WorkbenchResultGrid>,
    );

    expect(html).toContain('class="mf-workbench-result-grid"');
    expect(html).toContain('data-count="4"');
    expect(html).toContain('data-workbench-results="true"');
  });

  it("shares the assistant result column while keeping host slots explicit", () => {
    const html = renderToStaticMarkup(
      <WorkbenchAssistantFrame
        testId="assistant-frame"
        avatar={<span data-testid="host-avatar">A</span>}
        header={<strong>Musefold</strong>}
        className="host-result-column"
      >
        <div data-testid="host-result">结果</div>
      </WorkbenchAssistantFrame>,
    );

    expect(html).toContain('data-testid="assistant-frame"');
    expect(html).toContain('data-testid="host-avatar"');
    expect(html).toContain('data-testid="host-result"');
    expect(html).toContain("host-result-column");
    expect(html).toContain("Musefold");
  });

  it("shares assistant identity row semantics", () => {
    const html = renderToStaticMarkup(
      <WorkbenchAssistantHeader label="Musefold" detail="生成完成" />,
    );

    expect(html).toContain('class="mf-workbench-assistant-header"');
    expect(html).toContain("Musefold");
    expect(html).toContain("· 生成完成");
  });

  it("shares the assistant avatar asset boundary and accessibility semantics", () => {
    const html = renderToStaticMarkup(
      <WorkbenchAssistantAvatar
        imageUrl="/assets/musefold-assistant.png"
        data-testid="shared-assistant-avatar"
      />,
    );

    expect(html).toContain('data-testid="shared-assistant-avatar"');
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Musefold AI"');
    expect(html).toContain('draggable="false"');
    expect(html).toContain('src="/assets/musefold-assistant.png"');
  });

  it("keeps composer shell structure shared while exposing host controls", () => {
    const html = renderToStaticMarkup(
      <WorkbenchComposerSurface
        attachments={<div data-testid="host-attachments">附件</div>}
        className="host-composer"
        surfaceClassName="host-composer-surface"
      >
        <textarea aria-label="提示词" />
        <button type="button">生成</button>
      </WorkbenchComposerSurface>,
    );

    expect(html).toContain('data-testid="workbench-composer"');
    expect(html).toContain('data-testid="workbench-composer-surface"');
    expect(html).toContain('data-testid="host-attachments"');
    expect(html).toContain("host-composer-surface");
    expect(html).toContain("生成");
  });

  it("owns the complete composer control geometry while exposing capability slots", () => {
    const html = renderToStaticMarkup(
      <WorkbenchComposerFrame
        attachments={<div>附件</div>}
        leadingControls={<button type="button">添加</button>}
        trailingControls={<button type="button">生成</button>}
        footer={<p>连接失败</p>}
      >
        <textarea aria-label="提示词" />
      </WorkbenchComposerFrame>,
    );

    expect(html).toContain('class="mf-workbench-composer-content"');
    expect(html).toContain(
      'class="mf-workbench-toolbar mf-workbench-composer-toolbar"',
    );
    expect(html).toContain('class="mf-workbench-composer-leading"');
    expect(html).toContain('class="mf-workbench-composer-trailing"');
    expect(html).toContain('class="mf-workbench-composer-footer"');
  });

  it("shares the draft conflict prompt so both hosts resolve drafts identically", () => {
    const html = renderToStaticMarkup(
      <WorkbenchDraftConflictNotice
        onUseRemote={() => undefined}
        onKeepLocal={() => undefined}
      />,
    );

    expect(html).toContain('data-testid="workbench-draft-conflict"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("云端草稿已更新");
    expect(html).toContain("使用云端");
    expect(html).toContain("保留本机");
  });

  it("derives the ratio catalog from domain options and honours host subsets", () => {
    const all = workbenchRatioOptions();
    const web = workbenchRatioOptions(["1:1", "16:9", "9:16"]);

    expect(all.length).toBeGreaterThan(web.length);
    expect(all.at(-1)).toMatchObject({ id: "auto", detail: "由模型决定" });
    expect(web).toEqual([
      { id: "1:1", label: "方图", ratio: "1:1", detail: "1024x1024" },
      { id: "16:9", label: "宽屏", ratio: "16:9", detail: "1536x1024" },
      { id: "9:16", label: "手机竖屏", ratio: "9:16", detail: "1024x1536" },
    ]);
    expect(workbenchRatioOptions(["nope"])).toEqual([]);
  });

  it("shares conversation turn structure without owning host content", () => {
    const html = renderToStaticMarkup(
      <WorkbenchTurnFrame
        testId="generation-turn"
        userTestId="generation-user-message"
        status="succeeded"
        userClassName="host-user-message"
        userMessage={<p>制作一张明信片</p>}
      >
        <div data-testid="host-assistant-output">生成结果</div>
      </WorkbenchTurnFrame>,
    );

    expect(html).toContain('data-testid="generation-turn"');
    expect(html).toContain('data-testid="generation-user-message"');
    expect(html).toContain('data-status="succeeded"');
    expect(html).toContain("host-user-message");
    expect(html).toContain("制作一张明信片");
    expect(html).toContain("生成结果");
  });

  it("shares user message layout while exposing attachment and action slots", () => {
    const html = renderToStaticMarkup(
      <WorkbenchUserMessage
        prompt="制作一张明信片"
        meta={<span>1:1 · 高清</span>}
        attachments={<div data-testid="user-attachments">参考图</div>}
        negative="水印"
        actions={<button type="button">复制</button>}
      />,
    );

    expect(html).toContain('class="mf-workbench-user-message"');
    expect(html).toContain('data-testid="user-attachments"');
    expect(html).toContain("1:1 · 高清");
    expect(html).toContain("排除：水印");
    expect(html).toContain("复制");
  });

  it("shares user message action geometry and accessible semantics", () => {
    const html = renderToStaticMarkup(
      <WorkbenchMessageActions
        onCopy={() => undefined}
        onEdit={() => undefined}
        editDisabled
      />,
    );

    expect(html).toContain("mf-workbench-message-action");
    expect(html).toContain('data-testid="generation-user-message-copy"');
    expect(html).toContain('data-testid="generation-user-message-edit"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("disabled");
  });

  it("shares the current-conversation menu trigger across topbars", () => {
    const html = renderToStaticMarkup(
      <WorkbenchSessionMenuTrigger
        title="明信片工作台"
        pinned={false}
        onTogglePinned={() => undefined}
        onRename={() => undefined}
        onArchive={() => undefined}
        onMarkUnread={() => undefined}
        onDelete={() => undefined}
      />,
    );

    expect(html).toContain('aria-label="管理当前对话"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('data-testid="workbench-session-menu-trigger"');
  });

  it("shares recent-session grouping, state, icons, and actions", () => {
    const now = new Date("2026-08-19T12:00:00.000Z");
    const groups = groupWorkbenchSessions(
      [
        {
          id: "session-yesterday",
          title: "昨天的设计",
          updatedAt: "2026-08-18T08:00:00.000Z",
        },
        {
          id: "session-pinned",
          title: "置顶设计",
          updatedAt: "2026-08-17T08:00:00.000Z",
          pinned: true,
        },
      ],
      now,
    );
    const html = renderToStaticMarkup(
      <WorkbenchSessionList
        items={[
          {
            id: "session-running",
            title: "正在生成的设计",
            updatedAt: now.toISOString(),
            selected: true,
            pinned: true,
            status: "running",
          },
        ]}
        onOpen={() => undefined}
        onTogglePinned={() => undefined}
        onArchive={() => undefined}
      />,
    );

    expect(groups.map((group) => group.label)).toEqual(["置顶", "昨天"]);
    expect(html).toContain('data-testid="workbench-session-list"');
    expect(html).toContain('data-status="running"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('data-testid="conversation-hover-pin"');
    expect(html).toContain('data-testid="conversation-hover-archive"');
    expect(html).toContain("正在生成的设计，正在生成");
  });

  it("shares the workbench empty state and composer controls", () => {
    const empty = renderToStaticMarkup(
      <WorkbenchEmptyState
        composer={<div data-testid="empty-composer-slot">Composer</div>}
        onSelectSuggestion={() => undefined}
      />,
    );

    // v2.0(11 §4):品牌锁定区 = Logo + 名称 + 换行提示语;不再有营销 Hero/CTA。
    expect(empty).toContain('data-testid="workbench-empty-brand"');
    expect(empty).toContain('data-testid="workbench-empty-name"');
    expect(empty).toContain("Musefold");
    expect(empty).toContain('data-testid="workbench-empty-slogan"');
    expect(empty).toContain("把想法变成可生成的视觉");
    expect(empty).toContain('data-testid="generation-directions"');
    expect(empty.match(/data-testid="generation-example"/g)).toHaveLength(3);
    // Composer 空态内联,与品牌锁定区共用内容列中心轴(11 §3)。
    expect(empty).toContain('data-testid="empty-composer-slot"');
    expect(empty).not.toContain("workbench-empty-cta");
    expect(empty).not.toContain("generation-directions-ticker");
    const ratio = renderToStaticMarkup(
      <WorkbenchRatioPicker
        value="16:9"
        options={[
          { id: "1:1", label: "方图", ratio: "1:1" },
          { id: "16:9", label: "宽屏", ratio: "16:9" },
        ]}
        onChange={() => undefined}
        testIdPrefix="refine-ratio"
      />,
    );
    const settings = renderToStaticMarkup(
      <WorkbenchGenerationSettingsPopover
        quality="medium"
        qualityOptions={[
          { id: "low", label: "标准" },
          { id: "medium", label: "高清" },
        ]}
        count={1}
        onQualityChange={() => undefined}
      />,
    );
    const context = renderToStaticMarkup(
      <WorkbenchContextMenu
        open
        actions={[
          {
            id: "ref-prompt",
            section: "引用",
            label: "提示词",
            hint: "从库中引用",
            onSelect: () => undefined,
          },
        ]}
      />,
    );

    expect(ratio).toContain('data-testid="refine-ratio-trigger"');
    expect(ratio).toContain("图片比例：16:9 宽屏");
    expect(settings).toContain('data-testid="workbench-more-settings"');
    expect(settings).toContain("高清 · 1张");
    expect(context).toContain('data-testid="workbench-image-picker"');
    expect(context).toContain('aria-label="添加上下文菜单"');
    expect(context).toContain("提示词");
  });

  it("keeps timeline content geometry and empty-state placement shared", () => {
    const empty = renderToStaticMarkup(
      <WorkbenchTimelineContent
        itemCount={0}
        bottomInset="attachments"
        empty={<div data-testid="timeline-empty">空态</div>}
      >
        <div>不会渲染</div>
      </WorkbenchTimelineContent>,
    );
    const turns = renderToStaticMarkup(
      <WorkbenchTimelineContent itemCount={1}>
        <article data-testid="timeline-turn">回合</article>
      </WorkbenchTimelineContent>,
    );

    expect(empty).toContain('class="mf-workbench-timeline-content"');
    expect(empty).toContain('data-bottom-inset="attachments"');
    expect(empty).toContain('data-testid="timeline-empty"');
    expect(empty).not.toContain("不会渲染");
    expect(turns).toContain('data-testid="timeline-turn"');
  });

  it("keeps the page shell shared while exposing host capability slots", () => {
    const html = renderToStaticMarkup(
      <WorkbenchPageFrame
        className="host-workbench"
        stageClassName="host-stage"
        timeline={<div data-testid="host-timeline">时间线</div>}
        auxiliary={<aside data-testid="host-auxiliary">素材库</aside>}
        composer={<div data-testid="host-composer">Composer</div>}
      />,
    );

    expect(html).toContain('data-testid="generation-workbench"');
    expect(html).toContain('class="mf-workbench-page host-workbench"');
    expect(html).toContain('class="mf-workbench-stage host-stage"');
    expect(html).toContain('data-testid="host-timeline"');
    expect(html).toContain('data-testid="host-auxiliary"');
    expect(html).toContain('data-testid="host-composer"');
  });

  it("keeps the shared timeline follow threshold deterministic", () => {
    expect(
      isWorkbenchTimelineNearLatest({
        scrollHeight: 1200,
        scrollTop: 805,
        clientHeight: 300,
      }),
    ).toBeTruthy();
    expect(
      isWorkbenchTimelineNearLatest({
        scrollHeight: 1200,
        scrollTop: 804,
        clientHeight: 300,
      }),
    ).toBeFalsy();
    expect(
      isWorkbenchTimelineNearLatest({
        scrollHeight: 1200,
        scrollTop: 804,
        clientHeight: 300,
        threshold: 100,
      }),
    ).toBeTruthy();
  });

  it("shares the navigation shell and button DOM between hosts", () => {
    const sidebar = renderToStaticMarkup(
      <ProductSidebar
        navItems={[
          {
            id: "prompts",
            label: "提示词库",
            icon: <span>icon</span>,
            active: true,
            count: 3,
            onSelect: () => undefined,
          },
        ]}
        onNewDesign={() => undefined}
        onCollapse={() => undefined}
        sessionList={<p>最近对话</p>}
        account={{
          name: "未像用户",
          detail: "个人账户",
          onSelect: () => undefined,
        }}
      />,
    );
    const mobileButton = renderToStaticMarkup(
      <ProductNavButton
        className="nav-button"
        item={{
          id: "history",
          label: "历史",
          icon: <span>icon</span>,
          onSelect: () => undefined,
        }}
      />,
    );
    const topbar = renderToStaticMarkup(
      <ProductTopbar
        title="新设计"
        displayTitle="新设计"
        icon={<span>icon</span>}
        statusLabel="开发预览"
        leading={<button type="button">展开侧栏</button>}
        titleSuffix={<button type="button">更多</button>}
        actions={<button type="button">搜索</button>}
      />,
    );

    expect(sidebar).toContain('data-testid="product-sidebar"');
    expect(sidebar).toContain('data-testid="nav-prompts"');
    expect(sidebar).toContain('data-active="true"');
    expect(sidebar).toContain("功能");
    expect(sidebar).toContain("最近对话");
    expect(sidebar).toContain("个人账户");
    expect(mobileButton).toMatch(
      /class="[^"]*mf-product-sidebar-nav-button[^"]*nav-button[^"]*"/,
    );
    expect(topbar).toContain('data-testid="titlebar"');
    expect(topbar).toContain('data-testid="titlebar-title"');
    expect(topbar).toContain("开发预览");
  });

  it("shares one resizable and responsive sidebar rail between hosts", () => {
    const html = renderToStaticMarkup(
      <ProductSidebarLayout
        open
        onOpenChange={() => undefined}
        sidebar={<aside>导航</aside>}
      >
        <main>工作区</main>
      </ProductSidebarLayout>,
    );

    expect(html).toContain('data-testid="product-sidebar-layout"');
    expect(html).toContain('data-testid="product-sidebar-rail"');
    expect(html).toContain('data-testid="sidebar-resize-handle"');
    expect(html).toContain(`width:${PRODUCT_SIDEBAR_DEFAULT_WIDTH}px`);
    expect(html).toContain('aria-label="调整侧栏宽度"');
    expect(html).toContain("导航");
    expect(html).toContain("工作区");
    // v2.0 Phase B:MainView frame + surface 是双端共享壳层的一部分(10 §4.1)。
    expect(html).toContain('data-testid="mainview-frame"');
    expect(html).toContain('data-testid="mainview-surface"');
  });

  it("locks the v2.0 sidebar geometry baseline (10 §4.2)", () => {
    // 默认 248 / 最小 220 / 最大 360;历史 200-219px 值由 readInitialWidth clamp 到 220。
    expect(PRODUCT_SIDEBAR_DEFAULT_WIDTH).toBe(248);
    expect(PRODUCT_SIDEBAR_MIN_WIDTH).toBe(220);
    expect(PRODUCT_SIDEBAR_MAX_WIDTH).toBe(360);
  });

  it("shares page heading structure and action slots between hosts", () => {
    const html = renderToStaticMarkup(
      <ProductPageHeader
        title="提示词库"
        count={12}
        afterTitle={<button type="button">笺匣</button>}
        actions={<button type="button">新建</button>}
        testId="page-heading"
      />,
    );

    expect(html).toContain('data-testid="page-heading"');
    expect(html).toContain("提示词库");
    expect(html).toContain(">12</span>");
    expect(html).toContain("笺匣");
    expect(html).toContain("新建");
  });

  it("shares the account identity, quota and availability structure between hosts", () => {
    const html = renderToStaticMarkup(
      <AccountSummaryPanel
        account={{
          name: "未像用户",
          username: "musefold",
          avatarLabel: "未",
          quotaLabel: "120 积分",
          quotaHint: "约可生成 3 张",
          generationStatusLabel: "可用",
          generationAvailable: true,
          dataSourceLabel: "Musefold Cloud",
        }}
        footer={<button type="button">退出登录</button>}
        testId="account-summary"
      />,
    );

    expect(html).toContain('data-testid="account-summary"');
    expect(html).toContain("未像用户");
    expect(html).toContain("120 积分");
    expect(html).toContain("生图状态");
    expect(html).toContain("Musefold Cloud");
    expect(html).toContain("退出登录");
  });

  it("keeps account and connected-app page actions in product-ui", () => {
    const account = renderToStaticMarkup(
      <AccountScreen
        account={{
          name: "未像用户",
          username: "musefold",
          avatarLabel: "未",
          quotaLabel: "120 积分",
          generationStatusLabel: "可用",
          generationAvailable: true,
          dataSourceLabel: "Musefold Cloud",
        }}
        onLogout={async () => undefined}
        testId="account-screen"
      />,
    );
    const connections = renderToStaticMarkup(
      <ConnectedAppsScreen
        items={[
          {
            id: "connection-1",
            clientName: "Codex",
            scopes: ["account:read", "generations:write"],
            mode: "ask_each_time",
            maxPointsPerGeneration: 80,
            maxPointsPerDay: 500,
            spentPointsToday: 20,
            reservedPointsToday: 0,
            status: "active",
            lastUsedAt: "2026-08-24T00:00:00.000Z",
          },
        ]}
        onUpdate={async () => undefined}
        onRevoke={async () => undefined}
        testId="connected-apps-screen"
      />,
    );
    const fullScopeConnections = renderToStaticMarkup(
      <ConnectedAppsScreen
        items={[
          {
            id: "connection-full",
            clientName: "Claude",
            scopes: [
              "account:read",
              "prompts:read",
              "prompts:write",
              "skills:read",
              "generations:read",
              "generations:write",
            ],
            mode: "auto_with_limits",
            maxPointsPerGeneration: 1000,
            maxPointsPerDay: 3000,
            spentPointsToday: 0,
            reservedPointsToday: 0,
            status: "active",
          },
        ]}
        onUpdate={async () => undefined}
        onRevoke={async () => undefined}
      />,
    );
    const emptyWithGuide = renderToStaticMarkup(
      <ConnectedAppsScreen
        items={[]}
        mcpServerUrl="https://cloud.example.com/api/musefold/mcp"
        onUpdate={async () => undefined}
        onRevoke={async () => undefined}
      />,
    );

    expect(account).toContain('data-testid="account-screen"');
    expect(account).toContain('data-testid="account-summary-panel"');
    expect(connections).toContain('data-testid="connected-apps-screen"');
    expect(connections).toContain('data-testid="connection-row"');
    expect(connections).toContain("每次审批");
    expect(connections).toContain("撤销授权");
    // v2：能力 chip 可切换（aria-pressed），中文标签；模式为分段控件。
    expect(connections).toContain('data-testid="connection-scope-account:read"');
    expect(connections).toContain('aria-pressed="true"');
    expect(connections).toContain("提示词·写");
    expect(connections).toContain('data-testid="connection-mode-connection-1-ask_each_time"');
    expect(connections).toContain("单次预算（积分）");
    // lastUsedAt 渲染为相对时间；部分能力时不出「全部能力」徽标。
    expect(connections).toContain("最近使用");
    expect(connections).not.toContain("全部能力");
    // 全部 6 项能力时展示徽标。
    expect(fullScopeConnections).toContain('data-testid="connection-all-capabilities"');
    expect(fullScopeConnections).toContain("全部能力");
    expect(fullScopeConnections).toContain("预算内自动");
    // 空态带连接引导与服务器地址复制入口。
    expect(emptyWithGuide).toContain("MCP 服务器");
    expect(emptyWithGuide).toContain('data-testid="connection-copy-server-url"');
    expect(emptyWithGuide).toContain("复制服务器地址");

    const loadingConnections = renderToStaticMarkup(
      <ConnectedAppsScreen
        items={[]}
        loading
        onUpdate={async () => undefined}
        onRevoke={async () => undefined}
      />,
    );
    expect(loadingConnections).toContain('role="status"');
    expect(loadingConnections).toContain("正在读取连接...");

    const unavailableConnections = renderToStaticMarkup(
      <ConnectedAppsScreen
        items={[]}
        emptyLabel="登录后可管理连接"
        loadError="连接服务暂不可用"
        onUpdate={async () => undefined}
        onRevoke={async () => undefined}
      />,
    );
    expect(unavailableConnections).toContain("登录后可管理连接");
    expect(unavailableConnections).toContain("连接服务暂不可用");
  });

  it("shares history action labels, icons and busy states between hosts", () => {
    const html = renderToStaticMarkup(
      <GenerationHistoryDetailActions
        onReuse={() => undefined}
        onRetry={() => undefined}
        onCancel={() => undefined}
        downloadUrl="/asset.png"
        onSavePrompt={() => undefined}
        onCopyPrompt={() => undefined}
        onDelete={() => undefined}
      />,
    );

    expect(html).toContain("再次制作");
    expect(html).toContain("重试");
    expect(html).toContain("取消任务");
    expect(html).toContain("下载");
    expect(html).toContain('aria-label="更多操作"');
    expect(html).not.toContain("window.api");
  });

  it("shares the history list and inspector geometry between hosts", () => {
    const html = renderToStaticMarkup(
      <GenerationHistoryWorkspace
        detailOpen
        onBack={() => undefined}
        list={<div data-testid="history-list-slot">列表</div>}
        detail={
          <GenerationHistoryInspectorPanel
            historyId="history-1"
            status="succeeded"
            content={<div data-testid="history-detail-content-slot">详情</div>}
            actions={<button type="button">再次制作</button>}
          />
        }
      />,
    );

    expect(html).toContain('data-testid="history-workspace"');
    expect(html).toContain('data-detail-open="true"');
    expect(html).toContain('data-testid="history-inspector"');
    expect(html).toContain('data-testid="history-detail-back"');
    expect(html).toContain('data-history-id="history-1"');
    expect(html).toContain("再次制作");
  });
});
