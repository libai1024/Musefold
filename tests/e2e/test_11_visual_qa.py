"""Visual QA across the integrated product surfaces.

Screenshots are written only when MUSEFOLD_VISUAL_OUTPUT_DIR is set. Geometry and visual-contract
assertions always run, so the file remains useful in the normal no-API E2E suite.
"""
from __future__ import annotations

import os
import sqlite3
import time
from pathlib import Path


PNG_1PX = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082"
)
REPO_ROOT = Path(__file__).resolve().parents[2]

def output_dir() -> Path | None:
    raw = os.environ.get("MUSEFOLD_VISUAL_OUTPUT_DIR")
    if not raw:
        return None
    target = Path(raw)
    target.mkdir(parents=True, exist_ok=True)
    return target


def set_visual_state(app, *, width: int, height: int, theme: str, density: str):
    app.page.set_viewport_size({"width": width, "height": height})
    app.page.evaluate(
        """([theme, density]) => {
          const store = window.__musefold_test.stores.app.getState();
          store.setThemeSource(theme);
          store.setDensity(density);
        }""",
        [theme, density],
    )
    app.page.wait_for_function(
        """([theme, density]) => document.documentElement.dataset.theme === theme
          && document.documentElement.dataset.density === density""",
        arg=[theme, density],
    )
    app.page.wait_for_timeout(120)


def assert_surface(app, test_id: str):
    app.page.wait_for_selector(f'[data-testid="{test_id}"]')
    metrics = app.page.evaluate(
        """(testId) => {
          const surface = document.querySelector(`[data-testid="${testId}"]`);
          const rect = surface.getBoundingClientRect();
          return {
            viewportWidth: innerWidth,
            documentWidth: document.documentElement.scrollWidth,
            bodyWidth: document.body.scrollWidth,
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
            // 毛玻璃只允许出现在悬浮层（composer、菜单、抽屉）；内容平面禁止
            glassOnContentCount: [...document.querySelectorAll('[class*="backdrop-blur"]')].filter((el) => {
              for (let node = el; node && node !== document.body; node = node.parentElement) {
                const pos = getComputedStyle(node).position;
                if (pos === 'fixed' || pos === 'absolute' || pos === 'sticky') return false;
              }
              return true;
            }).length,
            gradientCount: document.querySelectorAll('[class*="bg-gradient"], [class*="from-"]').length,
          };
        }""",
        test_id,
    )
    assert metrics["documentWidth"] <= metrics["viewportWidth"] + 1, metrics
    assert metrics["bodyWidth"] <= metrics["viewportWidth"] + 1, metrics
    assert metrics["width"] > 0 and metrics["height"] > 0, metrics
    assert metrics["right"] <= metrics["viewportWidth"] + 1, metrics
    assert metrics["glassOnContentCount"] == 0, metrics
    assert metrics["gradientCount"] == 0, metrics


def capture(app, name: str, test_id: str):
    assert_surface(app, test_id)
    target = output_dir()
    if target:
        app.page.screenshot(path=str(target / f"{name}.png"), full_page=False)


def wait_result_theater_idle(app):
    """THEATER-04：结果面截图必须等显形落定（idle 钩）后再拍。"""
    app.page.wait_for_selector(
        '[data-testid="generation-result-group"] '
        '.mf-generation-result-surface[data-theater-idle]'
    )


def capture_shared_workbench(app):
    target = output_dir()
    if not target:
        return
    # v2.0:空态改为无入场动画的品牌锁定区,直接等待可见即可。
    if app.page.locator('[data-testid="workbench-empty"]').count() > 0:
        app.page.wait_for_selector('[data-testid="workbench-empty"]')
    # 水印呼吸、字幕慢滚与 Ember 点脉动会让双端截图落在不同相位,拍摄前冻结。
    animated = app.page.locator(
        '.mf-workbench-empty-watermark-word span, '
        '.mf-workbench-direction-track, '
        '.mf-workbench-empty-brand svg circle'
    )
    if animated.count() > 0:
        animated.evaluate_all(
            "els => els.forEach(el => { el.style.animation = 'none'; })"
        )
    app.page.locator('[data-testid="generation-workbench"]').screenshot(
        path=str(target / "shared-workbench-1440x900.png"),
    )


def capture_shared_surface(app, file_name: str, test_id: str):
    target = output_dir()
    if not target:
        return
    surface = app.page.locator(f'[data-testid="{test_id}"]')
    if test_id == "prompt-reference-preview":
        surface.evaluate(
            """element => {
              element.style.zIndex = '2147483647';
              element.style.animation = 'none';
            }"""
        )
        box = surface.bounding_box()
        assert box, f"Missing bounds for {test_id}"
        app.page.screenshot(path=str(target / file_name), clip=box)
        return
    surface.screenshot(path=str(target / file_name))


def set_shared_generation_result_state(app, *, status: str, error: str | None = None):
    app.page.evaluate(
        """({status, error}) => {
          const now = Date.now();
          window.__musefold_test.stores.workbench.setState({
            turns: [{
              id: `visual-${status}-result-turn`,
              prompt: `视觉回归${status}态结果`,
              userPrompt: `视觉回归${status}态结果`,
              references: [],
              negativePrompt: '',
              source: { kind: 'manual' },
              providerId: null,
              params: { ratioId: '1:1', quality: 'medium', n: 1, background: 'auto' },
              status,
              results: [{
                id: `visual-${status}-result`,
                jobId: `visual-${status}-result-job`,
                historyId: `visual-${status}-result-history`,
                status,
                ...(error ? { error, errorCode: 'INTERNAL_ERROR' } : {}),
              }],
              referenceImages: [],
              createdAt: now,
              completedAt: now,
            }],
            isGenerating: false,
            runningTurns: {},
            activeTurnId: null,
            activeJobId: null,
            cancelRequested: false,
          });
        }""",
        {"status": status, "error": error},
    )


def insert_history(
    app,
    *,
    history_id: str,
    prompt_id: str | None,
    status: str,
    image_path: str | None,
    prompt_text: str | None = None,
):
    con = sqlite3.connect(app.db_path())
    try:
        now = int(time.time() * 1000)
        con.execute(
            """INSERT INTO history (
                 id, prompt_id, provider_id, model, prompt_text, status,
                 error_code, error_message, image_path, created_at
               ) VALUES (?, ?, 'visual-provider', 'gpt-image-2', ?, ?, ?, ?, ?, ?)""",
            (
                history_id,
                prompt_id,
                prompt_text or f"视觉回归提示词 {history_id}",
                status,
                None if status == "success" else "UPSTREAM_ERROR",
                None if status == "success" else "视觉回归模拟失败",
                image_path,
                now,
            ),
        )
        con.commit()
    finally:
        con.close()


def test_visual_integrated_surfaces_toast_and_lightbox(app):
    previews = app.user_data_dir / "musefold-previews-v0.3.0"
    previews.mkdir(parents=True, exist_ok=True)
    image_path = previews / "visual-qa.png"
    image_path.write_bytes(PNG_1PX)
    prompt = app.api_ok(
        "prompt.create",
        {
            "title": "可交互作品照片册",
            "content": "专业系统架构图，四层模块，中文标签清晰",
            "previewImagePath": str(image_path),
        },
    )
    insert_history(
        app,
        history_id="visual-library-work",
        prompt_id=prompt["id"],
        status="success",
        image_path=str(image_path),
    )
    insert_history(
        app,
        history_id="visual-history-failed",
        prompt_id=None,
        status="failed",
        image_path=None,
    )

    set_visual_state(app, width=800, height=760, theme="light", density="compact")
    app.page.evaluate(
        """async () => {
          window.__musefold_test.setView('library');
          await window.__musefold_test.stores.library.getState().loadAll();
        }"""
    )
    app.page.wait_for_selector(f'[data-testid="prompt-row"][data-prompt-id="{prompt["id"]}"]')
    capture(app, "06-library-list-800-light-compact", "library-page")

    # 详情页相关作品 → Lightbox
    app.page.click(f'[data-prompt-id="{prompt["id"]}"] [data-testid="prompt-row-open"]')
    app.page.wait_for_selector('[data-testid="prompt-works-grid"]')
    app.page.locator('[data-testid="prompt-work-image"]').first.click()
    app.page.wait_for_selector('[data-testid="image-lightbox"]')
    lightbox = app.page.get_by_test_id("image-lightbox").bounding_box()
    assert lightbox and lightbox["width"] <= 800 and lightbox["height"] <= 760, lightbox
    capture(app, "07-library-lightbox-800-light-compact", "image-lightbox")
    app.page.get_by_test_id("image-lightbox-close").click()

    set_visual_state(app, width=640, height=760, theme="light", density="comfortable")
    app.page.get_by_test_id("detail-menu").click()
    app.page.get_by_test_id("detail-delete").click()
    app.page.wait_for_selector('[data-testid="toast-action"]')
    toast = app.page.get_by_test_id("toast").bounding_box()
    assert toast and toast["x"] >= 0 and toast["x"] + toast["width"] <= 641, toast
    capture(app, "08-library-toast-640-light-comfortable", "library-page")

    set_visual_state(app, width=1440, height=900, theme="dark", density="comfortable")
    app.page.evaluate(
        """() => {
          window.__musefold_test.setView('generate');
          window.__musefold_test.stores.workbench.getState().setDraftPrompt(
            '为智慧教育课题生成结构清晰的四层系统架构图'
          );
          // 引用侧栏默认收起，视觉走查需要显式打开
          window.__musefold_test.stores.app.getState().setMaterialLibraryOpen(true);
        }"""
    )
    app.page.wait_for_selector('[data-testid="workbench-reference-sidebar"]')
    capture(app, "09-workbench-1440-dark-comfortable", "generation-workbench")
    geometry = app.page.evaluate(
        """() => {
          const header = document.querySelector('[data-testid="titlebar"]')?.getBoundingClientRect();
          const composer = document.querySelector('[data-testid="workbench-composer"]')?.getBoundingClientRect();
          const sidebar = document.querySelector('[data-testid="workbench-reference-sidebar"]')?.getBoundingClientRect();
          const primary = document.querySelector('.mf-workbench-primary')?.getBoundingClientRect();
          return { header, composer, sidebar, primary, height: innerHeight, width: innerWidth };
        }"""
    )
    assert geometry["header"]["bottom"] <= geometry["composer"]["top"], geometry
    assert geometry["sidebar"]["right"] <= geometry["width"] + 1, geometry
    assert geometry["primary"]["right"] <= geometry["sidebar"]["left"] + 1, geometry
    assert geometry["composer"]["right"] <= geometry["primary"]["right"] + 1, geometry

    # 素材库在紧凑窗口转换为模态面板，不挤压 MainView。
    set_visual_state(app, width=640, height=760, theme="dark", density="compact")
    app.page.wait_for_selector('[data-testid="workbench-reference-backdrop"]')
    capture(app, "10-workbench-reference-drawer-640-dark-compact", "generation-workbench")

    set_visual_state(app, width=640, height=760, theme="light", density="comfortable")
    app.page.evaluate(
        """async () => {
          window.__musefold_test.setView('history');
          await window.__musefold_test.stores.history.getState().load();
        }"""
    )
    app.page.wait_for_selector('[data-testid="history-page"]')
    app.page.locator('[data-testid="history-row"]').filter(has_text="visual-history-failed").click()
    capture(app, "11-history-640-light-comfortable", "history-page")


def test_shared_workbench_visual_contract(app):
    """Emit the same content-only surface that the Web visual contract compares."""
    set_visual_state(app, width=1440, height=900, theme="light", density="comfortable")
    app.page.get_by_test_id("sidebar-resize-handle").dblclick()
    app.page.evaluate("window.__musefold_test.setView('generate')")
    app.page.wait_for_selector('[data-testid="generation-workbench"]')
    capture_shared_surface(
        app,
        "shared-product-sidebar-1440x900.png",
        "product-sidebar",
    )
    capture_shared_workbench(app)
    capture_shared_surface(
        app,
        "shared-workbench-composer-1440x900.png",
        "workbench-composer-surface",
    )
    set_visual_state(app, width=390, height=844, theme="light", density="comfortable")
    capture_shared_surface(
        app,
        "shared-workbench-composer-390x844.png",
        "workbench-composer-surface",
    )
    set_visual_state(app, width=1440, height=900, theme="light", density="comfortable")

    shared_image_path = app.user_data_dir / "musefold-previews-v0.3.0" / "shared-workbench-result.jpeg"
    shared_image_path.parent.mkdir(parents=True, exist_ok=True)
    shared_image_path.write_bytes(
        (REPO_ROOT / "generated/v31-skill-research/skill-ref-pause-map.jpeg").read_bytes()
    )
    app.page.evaluate(
        """(imagePath) => {
          window.__musefold_test.stores.workbench.setState({
            turns: [{
              id: 'visual-shared-result-turn',
              prompt: '雨后的夜间建筑摄影，低机位，湿润街面反射窗内暖光。',
              userPrompt: '雨后的夜间建筑摄影，低机位，湿润街面反射窗内暖光。',
              references: [],
              negativePrompt: '过度霓虹，强光晕，水印',
              source: { kind: 'manual' },
              providerId: null,
              params: { ratioId: '1:1', quality: 'medium', n: 1, background: 'auto' },
              status: 'success',
              results: [{
                id: 'visual-shared-result',
                jobId: 'visual-shared-result-job',
                historyId: 'visual-shared-result-history',
                status: 'success',
                imagePath,
                durationMs: 1840,
              }],
              referenceImages: [],
              createdAt: Date.now(),
              completedAt: Date.now(),
            }],
            isGenerating: false,
            runningTurns: {},
            activeTurnId: null,
            activeJobId: null,
            cancelRequested: false,
          });
        }""",
        str(shared_image_path),
    )
    app.page.wait_for_selector('[data-testid="generation-result-group"]')
    app.page.wait_for_selector('[data-testid="generate-result-card"] img')
    wait_result_theater_idle(app)
    capture_shared_surface(
        app,
        "shared-workbench-result-1440x900.png",
        "generation-result-group",
    )


def test_shared_generation_result_state_visual_contracts(app):
    """Keep cancelled/failed result surfaces aligned on desktop and mobile."""
    set_visual_state(app, width=1440, height=900, theme="light", density="comfortable")
    app.page.evaluate("window.__musefold_test.setView('generate')")
    app.page.wait_for_selector('[data-testid="generation-workbench"]')

    set_shared_generation_result_state(
        app,
        status="failed",
        error="视觉回归模拟失败",
    )
    app.page.wait_for_selector(
        '[data-testid="generation-result-group"] [data-status="failed"]'
    )
    wait_result_theater_idle(app)
    capture_shared_surface(
        app,
        "shared-workbench-result-failed-1440x900.png",
        "generation-result-group",
    )

    set_shared_generation_result_state(app, status="cancelled")
    app.page.wait_for_selector(
        '[data-testid="generation-result-group"] [data-status="cancelled"]'
    )
    wait_result_theater_idle(app)
    capture_shared_surface(
        app,
        "shared-workbench-result-cancelled-1440x900.png",
        "generation-result-group",
    )

    set_visual_state(app, width=390, height=844, theme="light", density="comfortable")
    app.page.wait_for_selector(
        '[data-testid="generation-result-group"] [data-status="cancelled"]'
    )
    wait_result_theater_idle(app)
    capture_shared_surface(
        app,
        "shared-workbench-result-cancelled-390x844.png",
        "generation-result-group",
    )


def test_shared_library_and_history_visual_contracts(app):
    """Emit common product surfaces after removing Desktop-only capability slots."""
    fixture_prompts = [
        app.api_ok("prompt.create", {
            "title": "留白纸感海报",
            "description": "暖白纸张、印刷颗粒与克制的单色锚点。",
            "content": "将主题处理为一张竖版编辑海报，大面积暖白留白，主体是一个小型视觉事件，保留纸张纤维、网点与轻微套印偏移，使用一个钴蓝色锚点。",
            "contentNegative": "商业广告，密集拼贴，霓虹，3D 标题，水印",
            "isPinned": True,
        }),
        app.api_ok("prompt.create", {
            "title": "夜色建筑摄影",
            "description": "湿润街面与安静的人造光。",
            "content": "雨后的夜间建筑摄影，低机位，湿润街面反射窗内暖光，克制的深青天空，真实建筑材质，画面安静且具有清晰空间层次。",
            "contentNegative": "过度霓虹，赛博朋克文字，强光晕，人物特写",
        }),
        app.api_ok("prompt.create", {
            "title": "玻璃静物",
            "description": "自然窗光下的透明材质研究。",
            "content": "透明玻璃器皿静物，清晨自然窗光，白色工作台，清晰折射和柔和投影，色彩只来自一片深绿色叶子，写实产品摄影。",
            "contentNegative": "彩色背景，复杂道具，浮夸高光，文字，Logo",
        }),
    ]
    night_prompt = fixture_prompts[1]
    night_prompt_id = night_prompt["id"]
    previews = app.user_data_dir / "musefold-previews-v0.3.0"
    previews.mkdir(parents=True, exist_ok=True)
    image_path = previews / "shared-history.png"
    image_path.write_bytes(PNG_1PX)
    insert_history(
        app,
        history_id="shared-history-success",
        prompt_id=night_prompt["id"],
        status="success",
        image_path=str(image_path),
        prompt_text=night_prompt["content"],
    )

    set_visual_state(app, width=1440, height=900, theme="light", density="comfortable")
    app.page.evaluate("window.__musefold_test.setView('library')")
    app.page.wait_for_selector('[data-testid="library-page"]')
    app.page.wait_for_function(
        "window.__musefold_test.stores.library.getState().initialized === true"
    )
    app.page.evaluate(
        """async () => {
          await window.__musefold_test.stores.library.getState().loadAll();
        }"""
    )
    for item in fixture_prompts:
        app.page.wait_for_selector(f'[data-prompt-id="{item["id"]}"]')
    capture_shared_surface(
        app,
        "shared-library-list-1440x900.png",
        "library-page",
    )

    app.page.click(
        f'[data-prompt-id="{night_prompt_id}"] [data-testid="prompt-row-open"]'
    )
    app.page.wait_for_selector('[data-testid="prompt-detail"]')
    app.page.wait_for_selector('[data-testid="prompt-works-panel"]')
    app.page.locator('[data-testid="prompt-works-panel"]').evaluate(
        "element => { element.style.display = 'none'; }"
    )
    capture_shared_surface(
        app,
        "shared-prompt-detail-1440x900.png",
        "prompt-detail",
    )

    app.page.get_by_test_id("detail-generate").click()
    app.page.wait_for_selector('[data-testid="refine-source"]')
    capture_shared_surface(
        app,
        "shared-prompt-reference-card-1440x900.png",
        "refine-source",
    )
    app.page.get_by_test_id("refine-source-clear").focus()
    app.page.wait_for_selector('[data-testid="prompt-reference-preview"]')
    app.page.wait_for_timeout(180)
    capture_shared_surface(
        app,
        "shared-prompt-reference-preview-1440x900.png",
        "prompt-reference-preview",
    )

    app.page.evaluate(
        """async () => {
          window.__musefold_test.setView('history');
          await window.__musefold_test.stores.history.getState().load({ limit: 200 });
        }"""
    )
    app.page.locator('[data-testid="history-row"]').filter(
        has_text="雨后的夜间建筑摄影"
    ).click()
    app.page.wait_for_selector('[data-testid="history-detail-content"]')
    app.page.wait_for_function(
        """() => {
          const inspector = document.querySelector('[data-testid="history-inspector"]');
          return inspector && Math.abs(inspector.getBoundingClientRect().width - 324) <= 1;
        }"""
    )
    history_geometry = app.page.locator('[data-testid="history-workspace"]').evaluate(
        """workspace => {
          const list = workspace.querySelector('.mf-history-workspace-list');
          const inspector = workspace.querySelector('[data-testid="history-inspector"]');
          if (!list || !inspector) return null;
          return {
            workspace: workspace.getBoundingClientRect().width,
            list: list.getBoundingClientRect().width,
            inspector: inspector.getBoundingClientRect().width,
          };
        }"""
    )
    assert history_geometry is not None
    assert abs(history_geometry["inspector"] - 324) <= 1
    assert history_geometry["list"] > history_geometry["inspector"]
    assert abs(
        history_geometry["list"]
        + history_geometry["inspector"]
        - history_geometry["workspace"]
    ) <= 1
    app.page.locator('[data-testid="history-workspace"] img').evaluate_all(
        "images => images.forEach(image => image.remove())"
    )
    capture_shared_surface(
        app,
        "shared-history-page-1440x900.png",
        "history-page",
    )
    capture_shared_surface(
        app,
        "shared-history-workspace-1440x900.png",
        "history-workspace",
    )
    app.page.locator('[data-testid="history-detail-image"]').evaluate(
        "element => element.replaceChildren()"
    )
    capture_shared_surface(
        app,
        "shared-history-detail-compact.png",
        "history-detail-content",
    )
    set_visual_state(
        app,
        width=1440,
        height=900,
        theme="dark",
        density="comfortable",
    )
    capture_shared_surface(
        app,
        "shared-history-page-dark-1440x900.png",
        "history-page",
    )


def test_settings_workspace_matches_operate_contract(app):
    """Lock the settings shell, aligned control rail, and compact toolbar geometry."""
    set_visual_state(app, width=1440, height=900, theme="dark", density="comfortable")
    app.page.evaluate(
        """() => {
          window.__musefold_test.stores.settings.getState().setSection('appearance');
          window.__musefold_test.setView('settings');
        }"""
    )
    app.page.wait_for_selector('[data-testid="appearance-theme-row"]')

    geometry = app.page.evaluate(
        """() => {
          const workspace = document.querySelector('[data-testid="settings-workspace"]');
          const sidebar = workspace?.querySelector('.mf-settings-sidebar');
          const section = workspace?.querySelector('.mf-settings-section');
          const title = workspace?.querySelector('.mf-settings-section-title');
          const card = workspace?.querySelector('.mf-settings-card');
          const row = workspace?.querySelector('.mf-settings-row');
          const rowControl = workspace?.querySelector('.mf-settings-row-control');
          const segmented = workspace?.querySelector('.mf-settings-segmented');
          const compactHeader = workspace?.querySelector('.mf-settings-compact-header');
          const pane = workspace?.querySelector('.mf-settings-pane');
          const layout = document.querySelector('[data-testid="product-sidebar-layout"]');
          const rail = document.querySelector('[data-testid="product-sidebar-rail"]');
          if (!workspace || !sidebar || !section || !title || !card || !row || !rowControl ||
              !segmented || !compactHeader || !pane) {
            return null;
          }
          const style = (element, pseudo) => getComputedStyle(element, pseudo);
          const workspaceRect = workspace.getBoundingClientRect();
          return {
            viewportWidth: innerWidth,
            documentWidth: document.documentElement.scrollWidth,
            workspaceLeft: workspaceRect.left,
            workspaceWidth: workspaceRect.width,
            layoutLeft: layout?.getBoundingClientRect().left,
            layoutWidth: layout?.getBoundingClientRect().width,
            railWidth: rail?.getBoundingClientRect().width,
            railOpen: rail?.getAttribute('data-open'),
            currentView: window.__musefold_test.getView(),
            hiddenShellCount: document.querySelectorAll('[data-titlebar-hidden="true"]').length,
            titlebarCount: document.querySelectorAll('[data-testid="titlebar"]').length,
            emberMarkCount: document.querySelectorAll('[data-testid="ember-mark"]').length,
            sidebarWidth: sidebar.getBoundingClientRect().width,
            sectionWidth: section.getBoundingClientRect().width,
            titleSize: style(title).fontSize,
            cardRadius: style(card).borderRadius,
            rowPaddingLeft: style(row).paddingLeft,
            rowPaddingRight: style(row).paddingRight,
            rowColumns: style(row).gridTemplateColumns,
            rowControlWidth: rowControl.getBoundingClientRect().width,
            segmentedRadius: style(segmented).borderRadius,
            compactHeaderDisplay: style(compactHeader).display,
            paneScrollbarGutter: style(pane).scrollbarGutter,
          };
        }"""
    )
    assert geometry is not None
    assert geometry["documentWidth"] <= geometry["viewportWidth"] + 1, geometry
    assert geometry["railWidth"] <= 1, (
        geometry["railWidth"],
        geometry["railOpen"],
        geometry["currentView"],
        geometry["hiddenShellCount"],
    )
    assert abs(geometry["workspaceLeft"]) <= 1, geometry
    assert abs(geometry["workspaceWidth"] - geometry["viewportWidth"]) <= 1, geometry
    assert geometry["titlebarCount"] == 0, geometry
    assert geometry["emberMarkCount"] == 0, geometry
    assert abs(geometry["sidebarWidth"] - 240) <= 1, geometry
    assert geometry["sectionWidth"] <= 881, geometry
    assert geometry["titleSize"] == "24px", geometry
    assert geometry["cardRadius"] == "12px", geometry
    assert geometry["rowPaddingLeft"] == "16px", geometry
    assert geometry["rowPaddingRight"] == "16px", geometry
    assert len(geometry["rowColumns"].split()) == 2, geometry
    assert 191 <= geometry["rowControlWidth"] <= 289, geometry
    assert geometry["segmentedRadius"] == "8px", geometry
    assert geometry["compactHeaderDisplay"] == "none", geometry
    assert geometry["paneScrollbarGutter"] == "stable", geometry
    capture(app, "settings-operate-dark-1440x900", "settings-workspace")

    app.page.evaluate(
        "() => window.__musefold_test.stores.settings.getState().setSection('automation')"
    )
    app.page.wait_for_selector('[data-testid="automation-toggle"]')
    switch_geometry = app.page.locator('[data-testid="automation-toggle"]').evaluate(
        """element => {
          const style = (pseudo) => getComputedStyle(element, pseudo);
          const rect = element.getBoundingClientRect();
          return {
            width: rect.width,
            height: rect.height,
            hitWidth: style('::after').width,
            hitHeight: style('::after').height,
          };
        }"""
    )
    # v2.0 09 §14:开关轨道收紧为 30x18,命中区仍由 ::after 撑到 44x44。
    assert abs(switch_geometry["width"] - 30) <= 1, switch_geometry
    assert abs(switch_geometry["height"] - 18) <= 1, switch_geometry
    assert switch_geometry["hitWidth"] == "44px", switch_geometry
    assert switch_geometry["hitHeight"] == "44px", switch_geometry

    app.page.evaluate(
        "() => window.__musefold_test.stores.settings.getState().setSection('appearance')"
    )
    app.page.wait_for_selector('[data-testid="appearance-theme-row"]')
    set_visual_state(app, width=800, height=760, theme="dark", density="comfortable")
    compact = app.page.evaluate(
        """() => {
          const sidebar = document.querySelector('.mf-settings-sidebar');
          const compactHeader = document.querySelector('[data-testid="settings-compact-header"]');
          const compactSearch = document.querySelector('[data-testid="settings-compact-search"]');
          const compactBack = compactHeader?.querySelector('.mf-settings-header-action-button');
          const tabs = document.querySelector('.mf-settings-tabs');
          return {
            viewportWidth: innerWidth,
            documentWidth: document.documentElement.scrollWidth,
            sidebarDisplay: sidebar ? getComputedStyle(sidebar).display : null,
            compactHeaderDisplay: compactHeader ? getComputedStyle(compactHeader).display : null,
            compactHeaderPaddingTop: compactHeader ? getComputedStyle(compactHeader).paddingTop : null,
            compactSearchDisplay: compactSearch ? getComputedStyle(compactSearch).display : null,
            compactBackDisplay: compactBack ? getComputedStyle(compactBack).display : null,
            compactBackHeight: compactBack?.getBoundingClientRect().height ?? null,
            tabsDisplay: tabs ? getComputedStyle(tabs).display : null,
            tabHeights: tabs
              ? [...tabs.querySelectorAll('.mf-settings-tab-item')].map(
                  (item) => item.getBoundingClientRect().height
                )
              : [],
          };
        }"""
    )
    assert compact["documentWidth"] <= compact["viewportWidth"] + 1, compact
    assert compact["sidebarDisplay"] == "none", compact
    assert compact["compactHeaderDisplay"] == "flex", compact
    assert compact["compactHeaderPaddingTop"] == "44px", compact
    assert compact["compactSearchDisplay"] == "block", compact
    assert compact["compactBackDisplay"] == "flex", compact
    assert compact["compactBackHeight"] >= 44, compact
    assert compact["tabsDisplay"] == "block", compact
    assert compact["tabHeights"] and min(compact["tabHeights"]) >= 44, compact
    capture(app, "settings-operate-dark-800x760", "settings-workspace")

    # v2.0(07 §3):<=680px 设置是「导航页 → 全页分区」两个子状态,不再渲染 compact 工具栏。
    for width in (639, 390):
        set_visual_state(app, width=width, height=760, theme="dark", density="comfortable")
        nav_state = app.page.evaluate(
            """() => {
              const workspace = document.querySelector('[data-testid="settings-workspace"]');
              const sidebar = workspace?.querySelector('.mf-settings-sidebar');
              const compactHeader = workspace?.querySelector('[data-testid="settings-compact-header"]');
              const tabs = workspace?.querySelector('.mf-settings-tabs');
              const pane = workspace?.querySelector('.mf-settings-pane');
              const navItems = [...(workspace?.querySelectorAll('.mf-settings-nav-item') ?? [])];
              if (!workspace || !sidebar || !compactHeader || !tabs || !pane
                  || navItems.length === 0) return null;
              const style = (element) => getComputedStyle(element);
              return {
                viewportWidth: innerWidth,
                documentWidth: document.documentElement.scrollWidth,
                sidebarDisplay: style(sidebar).display,
                compactHeaderDisplay: style(compactHeader).display,
                tabsDisplay: style(tabs).display,
                paneDisplay: style(pane).display,
                navHeights: navItems.map((item) => item.getBoundingClientRect().height),
              };
            }"""
        )
        assert nav_state is not None
        assert nav_state["documentWidth"] <= nav_state["viewportWidth"] + 1, nav_state
        assert nav_state["sidebarDisplay"] == "flex", nav_state
        assert nav_state["compactHeaderDisplay"] == "none", nav_state
        assert nav_state["tabsDisplay"] == "none", nav_state
        assert nav_state["paneDisplay"] == "none", nav_state
        assert min(nav_state["navHeights"]) >= 44, nav_state

        app.page.get_by_test_id("settings-section-preferences").click()
        app.page.wait_for_selector('[data-testid="appearance-theme-row"]')
        narrow = app.page.evaluate(
            """() => {
              const workspace = document.querySelector('[data-testid="settings-workspace"]');
              const phoneBack = workspace?.querySelector('.mf-settings-phone-back');
              const card = workspace?.querySelector('.mf-settings-card');
              const row = workspace?.querySelector('.mf-settings-row');
              const rowControl = workspace?.querySelector('.mf-settings-row-control');
              const segmented = workspace?.querySelector('.mf-settings-segmented');
              if (!workspace || !phoneBack || !card || !row || !rowControl || !segmented) {
                return null;
              }
              const workspaceRect = workspace.getBoundingClientRect();
              const cardRect = card.getBoundingClientRect();
              const controlRect = rowControl.getBoundingClientRect();
              return {
                viewportWidth: innerWidth,
                documentWidth: document.documentElement.scrollWidth,
                workspaceLeft: workspaceRect.left,
                workspaceRight: workspaceRect.right,
                cardLeft: cardRect.left,
                cardRight: cardRect.right,
                rowTrackCount: getComputedStyle(row).gridTemplateColumns
                  .split(/\\s+(?![^()]*\\))/)
                  .filter(Boolean).length,
                controlLeft: controlRect.left,
                controlRight: controlRect.right,
                segmentedWidth: segmented.getBoundingClientRect().width,
                phoneBackHeight: phoneBack.getBoundingClientRect().height,
              };
            }"""
        )
        assert narrow is not None
        assert narrow["documentWidth"] <= narrow["viewportWidth"] + 1, narrow
        assert narrow["workspaceLeft"] >= -1, narrow
        assert narrow["workspaceRight"] <= narrow["viewportWidth"] + 1, narrow
        assert narrow["cardLeft"] >= -1, narrow
        assert narrow["cardRight"] <= narrow["viewportWidth"] + 1, narrow
        assert narrow["rowTrackCount"] == 1, narrow
        assert narrow["controlLeft"] >= narrow["cardLeft"], narrow
        assert narrow["controlRight"] <= narrow["cardRight"], narrow
        assert narrow["segmentedWidth"] <= narrow["cardRight"] - narrow["cardLeft"], narrow
        assert narrow["phoneBackHeight"] >= 44, narrow
        capture(app, f"settings-operate-dark-{width}x760", "settings-workspace")
        app.page.locator('.mf-settings-phone-back').click()
        app.page.wait_for_selector('[data-testid="settings-section-preferences"]')
    set_visual_state(app, width=1440, height=900, theme="dark", density="comfortable")
    app.page.evaluate(
        "() => window.__musefold_test.stores.settings.getState().setSection('automation')"
    )
    app.page.wait_for_selector('[data-testid="integration-guide"]')
    integration_metrics = app.page.locator('[data-testid="integration-guide"]').evaluate(
        """element => ({
          nestedCards: element.querySelectorAll('.settings-integration-item > .rounded-md.border').length,
          listCount: element.querySelectorAll('.settings-integration-list').length,
          itemCount: element.querySelectorAll('.settings-integration-item').length,
          right: element.getBoundingClientRect().right,
          viewportWidth: innerWidth,
        })"""
    )
    assert integration_metrics["nestedCards"] == 0, integration_metrics
    assert integration_metrics["listCount"] == 1, integration_metrics
    assert integration_metrics["itemCount"] == 5, integration_metrics
    assert integration_metrics["right"] <= integration_metrics["viewportWidth"] + 1, integration_metrics

    token_metrics = app.page.locator('[data-testid="automation-token-row"]').evaluate(
        """element => {
          const control = element.querySelector('.mf-settings-row-control');
          const controls = element.querySelector('.settings-token-controls');
          const token = controls?.querySelector('code');
          const buttons = controls ? [...controls.querySelectorAll('button')] : [];
          if (!control || !controls || !token || buttons.length !== 3) return null;
          return {
            columns: getComputedStyle(element).gridTemplateColumns,
            controlWidth: control.getBoundingClientRect().width,
            controlsWidth: controls.getBoundingClientRect().width,
            tokenWidth: token.getBoundingClientRect().width,
            buttonHeights: buttons.map(button => button.getBoundingClientRect().height),
            buttonWhiteSpace: buttons.map(button => getComputedStyle(button).whiteSpace),
          };
        }"""
    )
    assert token_metrics is not None
    assert len(token_metrics["columns"].split()) == 2, token_metrics
    assert 359 <= token_metrics["controlWidth"] <= 441, token_metrics
    assert token_metrics["controlsWidth"] <= token_metrics["controlWidth"] + 1, token_metrics
    assert token_metrics["tokenWidth"] > 0, token_metrics
    assert max(token_metrics["buttonHeights"]) <= 32, token_metrics
    assert all(value == "nowrap" for value in token_metrics["buttonWhiteSpace"]), token_metrics
    capture(app, "settings-open-capabilities-dark-1440x900", "settings-workspace")

    provider = app.api_ok(
        "provider.create",
        {
            "name": "视觉检查中转站",
            "type": "openai-compatible",
            "baseUrl": "http://127.0.0.1:9/v1",
            "model": "gpt-image-1",
        },
    )
    app.page.evaluate(
        """async (providerId) => {
          await window.__musefold_test.stores.generation.getState().loadProviders();
          window.__musefold_test.stores.settings.getState().setSection('providers');
          window.__musefold_test.stores.generation.setState({ activeProviderId: providerId });
        }""",
        provider["id"],
    )
    app.page.wait_for_selector('[data-testid="settings-provider-master-detail"]')
    master_detail = app.page.locator('[data-testid="settings-provider-master-detail"]').evaluate(
        """element => {
          const rail = element.querySelector('.settings-md-rail');
          const detail = element.querySelector('.settings-md-detail');
          const selected = element.querySelector('.settings-md-item[data-active="true"]');
          if (!rail || !detail || !selected) return null;
          return {
            columns: getComputedStyle(element).gridTemplateColumns,
            railWidth: rail.getBoundingClientRect().width,
            detailWidth: detail.getBoundingClientRect().width,
            hasPricingFields: Boolean(element.querySelector('[data-testid="provider-pricing-fields"]')),
            documentWidth: document.documentElement.scrollWidth,
            viewportWidth: innerWidth,
          };
        }"""
    )
    assert master_detail is not None
    assert len(master_detail["columns"].split()) == 2, master_detail
    assert 239 <= master_detail["railWidth"] <= 241, master_detail
    assert master_detail["detailWidth"] > master_detail["railWidth"], master_detail
    assert master_detail["hasPricingFields"] is False, master_detail
    assert master_detail["documentWidth"] <= master_detail["viewportWidth"] + 1, master_detail
    capture(app, "settings-relay-master-detail-dark-1440x900", "settings-workspace")

    set_visual_state(app, width=390, height=760, theme="dark", density="comfortable")
    # 手机子状态首屏是导航页,先进入 relay 分区才能触达删除确认。
    app.page.get_by_test_id("settings-section-relay").click()
    app.page.wait_for_selector('[data-testid="settings-provider-master-detail"]')
    delete_button = app.page.get_by_test_id("provider-delete")
    delete_button.scroll_into_view_if_needed()
    delete_button.click()
    app.page.wait_for_selector(".settings-inline-confirm")
    narrow_actions = app.page.locator(
        '[data-testid="settings-provider-master-detail"]'
    ).evaluate(
        """element => {
          const card = element.closest('.mf-settings-card');
          const actions = element.querySelector('.settings-md-actions');
          const dangerSlot = element.querySelector('.settings-md-danger-slot');
          const confirmation = element.querySelector('.settings-inline-confirm');
          const actionGroup = element.querySelector('.settings-md-action-group');
          if (!card || !actions || !dangerSlot || !confirmation || !actionGroup) return null;
          const rect = (node) => {
            const value = node.getBoundingClientRect();
            return { left: value.left, right: value.right, top: value.top, bottom: value.bottom };
          };
          return {
            viewportWidth: innerWidth,
            documentWidth: document.documentElement.scrollWidth,
            card: rect(card),
            actions: rect(actions),
            dangerSlot: rect(dangerSlot),
            confirmation: rect(confirmation),
            actionGroup: rect(actionGroup),
          };
        }"""
    )
    assert narrow_actions is not None
    assert narrow_actions["documentWidth"] <= narrow_actions["viewportWidth"] + 1, narrow_actions
    for key in ("actions", "dangerSlot", "confirmation", "actionGroup"):
        bounds = narrow_actions[key]
        assert bounds["left"] >= narrow_actions["card"]["left"] - 1, narrow_actions
        assert bounds["right"] <= narrow_actions["card"]["right"] + 1, narrow_actions
        assert bounds["left"] >= -1, narrow_actions
        assert bounds["right"] <= narrow_actions["viewportWidth"] + 1, narrow_actions
        assert bounds["top"] >= narrow_actions["actions"]["top"] - 1, narrow_actions
        assert bounds["bottom"] <= narrow_actions["actions"]["bottom"] + 1, narrow_actions
    assert narrow_actions["actionGroup"]["top"] >= narrow_actions["dangerSlot"]["bottom"] - 1, (
        narrow_actions
    )
    capture(app, "settings-relay-master-detail-dark-390x760", "settings-workspace")


def test_shared_account_and_connections_visual_contracts(app):
    """Compare shared account content and the complete Cloud MCP connection screen."""
    account_status = {
        "loggedIn": True,
        "username": "musefold",
        "serverUrl": "https://api.musefold.example",
        "isDefaultServer": True,
        "quota": {"value": 9_300_000, "at": 1_787_000_000_000},
        "estImagesRemaining": None,
        "deviceTokenSuffix": "1a2b",
        "health": "ok",
        "notices": [],
    }
    connections = {
        "items": [{
            "id": "fixture-connection-1",
            "clientName": "Musefold Preview Client",
            "scopes": [
                "account:read",
                "prompts:read",
                "skills:read",
                "generations:read",
                "generations:write",
            ],
            "mode": "ask_each_time",
            "maxPointsPerGeneration": 1000,
            "maxPointsPerDay": 5000,
            "spentPointsToday": 1000,
            "reservedPointsToday": 0,
            "status": "active",
            "createdAt": "2026-08-12T07:30:00.000Z",
            "lastUsedAt": "2026-08-17T08:00:00.000Z",
        }],
    }

    set_visual_state(app, width=1440, height=900, theme="light", density="comfortable")
    app.page.evaluate(
        """(status) => {
          const account = window.__musefold_test.stores.account;
          account.setState({
            status,
            loaded: true,
            loading: false,
            action: null,
            error: null,
            lastUsername: status.username,
            refreshQuota: async () => account.getState().status,
          });
          window.__musefold_test.stores.settings.getState().setSection('account');
          window.__musefold_test.setView('settings');
        }""",
        account_status,
    )
    app.page.wait_for_selector('[data-testid="account-summary-panel"]')
    account_summary = app.page.get_by_test_id("account-summary-panel")
    account_summary.locator(".mf-account-summary-header-action").evaluate(
        "element => { element.style.display = 'none'; }"
    )
    account_summary.locator("small").evaluate_all(
        "elements => elements.forEach(element => { element.style.display = 'none'; })"
    )
    capture_shared_surface(
        app,
        "shared-account-summary-1440x900.png",
        "account-summary-panel",
    )

    app.page.evaluate(
        """(connections) => {
          const store = window.__musefold_test.stores.cloudConnections;
          store.setState({
            connections,
            loaded: true,
            loading: false,
            error: null,
            load: async () => connections,
            update: async () => connections,
            revoke: async () => undefined,
          });
          window.__musefold_test.stores.settings.getState().setSection('connections');
        }""",
        connections,
    )
    app.page.wait_for_selector('[data-testid="connected-apps-screen"]')
    app.page.wait_for_selector('[data-testid="connection-row"]')
    capture_shared_surface(
        app,
        "shared-connected-apps-1440x900.png",
        "connected-apps-screen",
    )
