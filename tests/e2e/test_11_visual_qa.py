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


def insert_history(app, *, history_id: str, prompt_id: str | None, status: str, image_path: str | None):
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
                f"视觉回归提示词 {history_id}",
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
          return { header, composer, sidebar, height: innerHeight, width: innerWidth };
        }"""
    )
    assert geometry["header"]["bottom"] <= geometry["composer"]["top"], geometry
    assert geometry["sidebar"]["right"] <= geometry["width"] + 1, geometry

    # 素材库抽屉的模态形态（带遮罩）只在 ≤760px 出现
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
