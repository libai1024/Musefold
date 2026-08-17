"""豆包 1.0 首启信息架构验收：只验证本地 UI，不打开外部网页。"""

from __future__ import annotations

import sqlite3


def show_route_choice(app) -> None:
    app.page.evaluate(
        """() => {
            const store = window.__musefold_test.stores.onboarding;
            store.getState().forceShow();
            store.setState({ step: 2, track: null, doubaoWindowOpened: false, validation: null });
        }"""
    )
    app.page.wait_for_selector('[data-testid="onboarding-track-doubao"]')


def assert_inside_viewport(app, selector: str) -> None:
    box = app.page.locator(selector).bounding_box()
    assert box is not None
    viewport = app.page.viewport_size
    assert viewport is not None
    assert box["x"] >= 0 and box["y"] >= 0
    assert box["x"] + box["width"] <= viewport["width"] + 1
    assert box["y"] + box["height"] <= viewport["height"] + 1


def test_first_run_offers_doubao_or_account_and_adapts_to_narrow_window(app, tmp_path):
    app.page.set_viewport_size({"width": 1200, "height": 760})
    show_route_choice(app)

    assert app.page.is_visible('[data-testid="onboarding-track-doubao"]')
    assert app.page.is_visible('[data-testid="onboarding-track-account"]')
    assert app.page.locator('[data-testid="onboarding-api-key"]').count() == 0
    assert "设置 → 高级设置" in app.page.locator('[data-testid="onboarding-step-2"]').inner_text()
    assert_inside_viewport(app, '[data-testid="onboarding-track-doubao"]')
    assert_inside_viewport(app, '[data-testid="onboarding-track-account"]')
    app.page.screenshot(path=str(tmp_path / "doubao-route-choice-desktop.png"))

    app.page.set_viewport_size({"width": 360, "height": 740})
    assert_inside_viewport(app, '[data-testid="onboarding-track-doubao"]')
    assert_inside_viewport(app, '[data-testid="onboarding-track-account"]')
    narrow_metrics = app.page.evaluate(
        "() => ({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth })"
    )
    assert narrow_metrics["documentWidth"] <= narrow_metrics["viewport"] + 1, narrow_metrics
    app.page.screenshot(path=str(tmp_path / "doubao-route-choice-narrow.png"))

    app.page.click('[data-testid="onboarding-track-doubao"]')
    app.page.wait_for_selector('[data-testid="onboarding-doubao-login"]')
    doubao_text = app.page.locator('[data-testid="onboarding-doubao-login"]').inner_text()
    assert "本地自然日" in doubao_text and "10 次" in doubao_text
    assert "不读取、导出或上传 Cookie" in doubao_text
    assert_inside_viewport(app, '[data-testid="onboarding-doubao-login"]')
    app.page.screenshot(path=str(tmp_path / "doubao-login-narrow.png"))

    app.page.get_by_role("button", name="返回").click()
    app.page.click('[data-testid="onboarding-track-account"]')
    app.page.wait_for_selector('[data-testid="onboarding-account-auth"]')
    assert app.page.is_visible('[data-testid="onboarding-account-username"]')
    assert app.page.is_visible('[data-testid="onboarding-account-password"]')
    assert_inside_viewport(app, '[data-testid="onboarding-account-auth"]')

    app.page.evaluate(
        """() => {
            window.__musefold_test.stores.onboarding.setState({ forced: false, onboarded: true });
            window.__musefold_test.stores.settings.getState().setSection('doubao');
            window.__musefold_test.stores.app.getState().setView('settings');
        }"""
    )
    app.page.wait_for_selector('[data-testid="settings-doubao-open"]')
    assert "每日保护限制" in app.page.locator("body").inner_text()
    assert "高级设置" not in app.page.locator("body").inner_text()
    metrics = app.page.evaluate(
        "() => ({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth })"
    )
    assert metrics["documentWidth"] <= metrics["viewport"] + 1, metrics
    app.page.screenshot(path=str(tmp_path / "doubao-settings-narrow.png"))

    app.page.click('[data-testid="settings-mobile-section-trigger"]')
    menu_text = app.page.locator('[data-testid="settings-mobile-section-menu"]').inner_text()
    assert "高级设置" in menu_text
    assert "生图中转站" in menu_text
    assert "Agent 中转站" in menu_text

    app.page.set_viewport_size({"width": 1200, "height": 760})
    app.page.keyboard.press("Escape")
    assert "登录方式" in app.page.locator("body").inner_text()
    assert "高级设置" in app.page.locator("body").inner_text()
    app.page.screenshot(path=str(tmp_path / "doubao-settings-desktop.png"))


def test_doubao_workbench_exposes_four_image_web_settings(app, tmp_path):
    created = app.api_ok("provider.create", {
        "name": "豆包网页版",
        "type": "doubao-web",
        "baseUrl": "https://www.doubao.com/chat/create-image",
        "model": "seedream-4.5",
        "isActive": True,
    })
    con = sqlite3.connect(app.db_path())
    try:
        con.execute(
            "UPDATE providers SET has_key = 1, key_suffix = '网页会话' WHERE id = ?",
            (created["id"],),
        )
        con.commit()
    finally:
        con.close()

    app.page.evaluate(
        """async () => {
            await window.__musefold_test.stores.generation.getState().loadProviders();
            window.__musefold_test.stores.workbench.getState().setParams({ n: 4 });
            window.__musefold_test.stores.app.getState().setView('generate');
        }"""
    )
    app.page.set_viewport_size({"width": 360, "height": 740})
    app.page.wait_for_selector('[data-testid="workbench-more-settings"]')
    trigger = app.page.locator('[data-testid="workbench-more-settings"]')
    assert "每次请求返回 4 张" in (trigger.get_attribute("aria-label") or "")

    trigger.click()
    panel = app.page.locator('[data-testid="workbench-generation-options"]')
    assert "豆包网页 · 每次请求返回 4 张" in panel.inner_text()
    assert "图片与回复文字按同一批次归组" in panel.inner_text()
    assert "本地每日最多提交 10 次" in panel.inner_text()
    assert panel.locator('[data-testid="refine-count-4"]').count() == 0
    assert_inside_viewport(app, '[data-testid="workbench-generation-options"]')
    app.page.screenshot(path=str(tmp_path / "doubao-workbench-settings-narrow.png"))
