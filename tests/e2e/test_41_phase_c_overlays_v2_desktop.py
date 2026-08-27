"""Musefold 2.0 Phase C desktop popover, dialog and toast contracts."""

from __future__ import annotations

import os
from pathlib import Path


DESKTOP_VIEWPORT = {"width": 1440, "height": 900}


def output_dir() -> Path | None:
    configured = os.environ.get("MUSEFOLD_VISUAL_OUTPUT_DIR")
    if not configured:
        return None
    target = Path(configured)
    target.mkdir(parents=True, exist_ok=True)
    return target


def set_desktop_theme(app, theme: str) -> None:
    app.page.set_viewport_size(DESKTOP_VIEWPORT)
    app.page.evaluate(
        "(value) => window.__musefold_test.stores.app.getState().setThemeSource(value)",
        theme,
    )
    app.page.wait_for_function(
        "(value) => document.documentElement.dataset.theme === value",
        arg=theme,
    )


def style(app, selector: str) -> dict:
    return app.page.locator(selector).evaluate(
        """node => {
          const value = getComputedStyle(node);
          return {
            backgroundColor: value.backgroundColor,
            borderRadius: value.borderRadius,
            boxShadow: value.boxShadow,
            display: value.display,
            opacity: value.opacity,
          };
        }"""
    )


def capture(app, name: str) -> None:
    target = output_dir()
    if target:
        app.page.screenshot(path=str(target / name), full_page=False)


def test_composer_context_menu_keeps_geometry_and_keyboard_contract(app):
    app.set_view("generate")
    set_desktop_theme(app, "dark")
    trigger = app.page.get_by_test_id("workbench-image-picker")
    trigger.click()
    menu = app.page.get_by_test_id("workbench-context-menu")
    menu.wait_for()
    app.page.wait_for_function(
        "selector => getComputedStyle(document.querySelector(selector)).opacity === '1'",
        arg='[data-testid="workbench-context-menu"]',
    )

    dark = style(app, '[data-testid="workbench-context-menu"]')
    assert dark["backgroundColor"] == "rgb(43, 45, 49)"
    assert dark["borderRadius"] == "8px"
    assert dark["boxShadow"] != "none"
    assert dark["opacity"] == "1"
    first = menu.get_by_role("menuitem").first
    last = menu.get_by_role("menuitem").last
    assert first.evaluate("node => node === document.activeElement")
    app.page.keyboard.press("End")
    assert last.evaluate("node => node === document.activeElement")
    app.page.keyboard.press("Home")
    assert first.evaluate("node => node === document.activeElement")
    capture(app, "phase-c-composer-menu-dark-1440x900.png")

    app.page.keyboard.press("Escape")
    menu.wait_for(state="detached")
    app.page.wait_for_function(
        "selector => document.activeElement === document.querySelector(selector)",
        arg='[data-testid="workbench-image-picker"]',
    )
    assert trigger.evaluate("node => node === document.activeElement")

    set_desktop_theme(app, "light")
    trigger.click()
    app.page.wait_for_function(
        "selector => getComputedStyle(document.querySelector(selector)).opacity === '1'",
        arg='[data-testid="workbench-context-menu"]',
    )
    light = style(app, '[data-testid="workbench-context-menu"]')
    assert light["backgroundColor"] == "rgb(253, 252, 249)"
    capture(app, "phase-c-composer-menu-light-1440x900.png")


def test_sidebar_access_menus_match_phase_c_layers(app):
    app.set_view("generate")
    set_desktop_theme(app, "dark")

    identity_trigger = app.page.get_by_test_id("provider-quick-switch")
    identity_trigger.click()
    identity_menu = app.page.get_by_test_id("identity-switcher")
    identity_menu.wait_for()
    dark_identity = style(app, '[data-testid="identity-switcher"]')
    assert dark_identity["backgroundColor"] == "rgb(43, 45, 49)"
    assert dark_identity["borderRadius"] == "12px"
    assert dark_identity["boxShadow"] != "none"
    identity_items = identity_menu.get_by_role("menuitem")
    first_identity = identity_items.first
    last_identity = identity_items.last
    assert first_identity.evaluate("node => node === document.activeElement")
    app.page.keyboard.press("End")
    assert last_identity.evaluate("node => node === document.activeElement")
    app.page.keyboard.press("Home")
    assert first_identity.evaluate("node => node === document.activeElement")
    app.page.keyboard.press("Escape")
    identity_menu.wait_for(state="detached")
    app.page.wait_for_function(
        "selector => document.activeElement === document.querySelector(selector)",
        arg='[data-testid="provider-quick-switch"]',
    )
    assert identity_trigger.evaluate("node => node === document.activeElement")

    settings_trigger = app.page.get_by_test_id("sidebar-settings")
    settings_trigger.click()
    settings_menu = app.page.get_by_test_id("sidebar-settings-menu")
    settings_menu.wait_for()
    dark_settings = style(app, '[data-testid="sidebar-settings-menu"]')
    assert dark_settings["backgroundColor"] == "rgb(43, 45, 49)"
    assert dark_settings["borderRadius"] == "12px"
    assert dark_settings["boxShadow"] != "none"
    # 桌宠开关状态在菜单打开时经 IPC 异步加载，未落地前是禁用项，Radix 打开会跳过
    # 禁用项聚焦；等状态落地后重开菜单，首项（此时可用）才承担「打开即聚焦首项」契约。
    app.page.wait_for_function(
        "selector => document.querySelector(selector)?.getAttribute('data-disabled') === null",
        arg='[data-testid="sidebar-settings-pet-toggle"]',
        timeout=5_000,
    )
    app.page.keyboard.press("Escape")
    settings_menu.wait_for(state="detached")
    app.page.wait_for_function(
        "selector => document.activeElement === document.querySelector(selector)",
        arg='[data-testid="sidebar-settings"]',
    )
    settings_trigger.click()
    settings_menu.wait_for()
    first_settings = settings_menu.locator('[role="menuitem"]:not([data-disabled])').first
    # xvfb 下窗口焦点送达有延迟：轮询等待首个可用菜单项成为焦点元素，保持「菜单打开即聚焦首项」语义。
    app.page.wait_for_function(
        "selector => document.activeElement === document.querySelector(selector)",
        arg='[data-testid="sidebar-settings-menu"] [role="menuitem"]:not([data-disabled])',
        timeout=2_000,
    )
    assert first_settings.evaluate("node => node === document.activeElement")
    app.page.keyboard.press("Escape")
    settings_menu.wait_for(state="detached")
    app.page.wait_for_function(
        "selector => document.activeElement === document.querySelector(selector)",
        arg='[data-testid="sidebar-settings"]',
    )
    assert settings_trigger.evaluate("node => node === document.activeElement")

    set_desktop_theme(app, "light")
    identity_trigger.click()
    identity_menu.wait_for()
    light_identity = style(app, '[data-testid="identity-switcher"]')
    assert light_identity["backgroundColor"] == "rgb(253, 252, 249)"
    app.page.keyboard.press("Escape")


def test_session_menu_and_dialog_follow_phase_c_layers(app):
    app.api_ok(
        "workbenchSession.ensure",
        {"id": "phase-c-session", "title": "Phase C 浮层验收"},
    )
    app.page.reload()
    app.page.wait_for_selector("#root > *")
    app.set_view("generate")
    set_desktop_theme(app, "dark")

    row = app.page.locator('[data-conversation-row="phase-c-session"]')
    row.wait_for()
    trigger = row.locator(".mf-workbench-session-open")
    trigger.focus()
    row.click(button="right")
    menu = app.page.locator(".mf-workbench-session-context-menu")
    menu.wait_for()

    menu_style = style(app, ".mf-workbench-session-context-menu")
    assert menu_style["backgroundColor"] == "rgb(43, 45, 49)"
    assert menu_style["borderRadius"] == "8px"
    assert menu_style["boxShadow"] != "none"
    first = menu.get_by_role("menuitem").first
    assert first.evaluate("node => node === document.activeElement")
    capture(app, "phase-c-session-menu-dark-1440x900.png")

    app.page.keyboard.press("Escape")
    menu.wait_for(state="detached")
    app.page.wait_for_function(
        "selector => document.activeElement === document.querySelector(selector)",
        arg='[data-conversation-row="phase-c-session"] .mf-workbench-session-open',
    )
    assert trigger.evaluate("node => node === document.activeElement")

    row.click(button="right")
    app.page.get_by_test_id("conversation-context-delete").click()
    dialog = app.page.get_by_role("dialog", name="删除对话？")
    dialog.wait_for()
    dark_dialog = style(app, '[role="dialog"]')
    assert dark_dialog["backgroundColor"] == "rgb(37, 39, 42)"
    assert dark_dialog["borderRadius"] == "16px"
    assert dark_dialog["boxShadow"] != "none"
    overlay = app.page.locator(".mf-ui-dialog-overlay")
    assert overlay.evaluate("node => getComputedStyle(node).backgroundColor") == "rgba(0, 0, 0, 0.64)"
    capture(app, "phase-c-dialog-dark-1440x900.png")

    set_desktop_theme(app, "light")
    light_dialog = style(app, '[role="dialog"]')
    assert light_dialog["backgroundColor"] == "rgb(255, 255, 255)"
    assert overlay.evaluate("node => getComputedStyle(node).backgroundColor") == "rgba(20, 20, 24, 0.38)"
    capture(app, "phase-c-dialog-light-1440x900.png")
    dialog.get_by_role("button", name="取消").click()


def test_session_pin_reuses_the_compact_leading_status_slot(app):
    app.api_ok(
        "workbenchSession.ensure",
        {
            "id": "compact-pin-session",
            "title": "当代陶器与自然织物，窗边晨光，安静的静物摄影",
        },
    )
    app.page.reload()
    app.page.wait_for_selector("#root > *")
    app.set_view("generate")
    set_desktop_theme(app, "dark")

    row = app.page.locator('[data-conversation-row="compact-pin-session"]')
    row.wait_for()
    pin = row.get_by_test_id("conversation-hover-pin")
    archive = row.get_by_test_id("conversation-hover-archive")
    status = row.locator(".mf-workbench-session-status")
    title = row.locator(".mf-workbench-session-open > span:last-child")

    title_before = title.bounding_box()
    row.hover()
    app.page.wait_for_function(
        """selector => {
          const node = document.querySelector(selector);
          return node && getComputedStyle(node).opacity === '1';
        }""",
        arg=(
            '[data-conversation-row="compact-pin-session"] '
            '[data-testid="conversation-hover-pin"]'
        ),
    )
    pin_box = pin.bounding_box()
    title_after = title.bounding_box()

    assert title_before is not None
    assert pin_box is not None
    assert title_after is not None
    assert abs(title_before["x"] - title_after["x"]) <= 1
    assert abs(title_after["x"] - (pin_box["x"] + pin_box["width"] + 4)) <= 1
    assert status.evaluate("node => getComputedStyle(node).opacity") == "0"
    title_style = title.evaluate(
        """node => ({
          textOverflow: getComputedStyle(node).textOverflow,
          maskImage: getComputedStyle(node).maskImage,
        })"""
    )
    assert title_style["textOverflow"] == "clip"
    assert "linear-gradient" in title_style["maskImage"]
    for action in (pin, archive):
        action_style = action.evaluate(
            """node => ({
              backgroundColor: getComputedStyle(node).backgroundColor,
              boxShadow: getComputedStyle(node).boxShadow,
            })"""
        )
        assert action_style["backgroundColor"] == "rgb(43, 45, 49)"
        assert action_style["boxShadow"] != "none"
    assert pin.evaluate("node => getComputedStyle(node).zIndex") == "2"
    assert (
        row.locator(".mf-workbench-session-actions").evaluate(
            "node => getComputedStyle(node).zIndex"
        )
        == "2"
    )
    capture(app, "session-pin-compact-leading-slot-dark-1440x900.png")


def test_toast_uses_semantic_grid_in_both_themes(app):
    prompt = app.api_ok(
        "prompt.create",
        {"title": "Phase C Toast", "content": "柔和漫射光产品摄影"},
    )
    app.set_view("library")
    set_desktop_theme(app, "light")
    app.page.evaluate(
        "() => window.__musefold_test.stores.library.getState().reloadPrompts()"
    )
    row = app.page.locator(
        f'[data-testid="prompt-row"][data-prompt-id="{prompt["id"]}"]'
    )
    row.wait_for()
    row.get_by_test_id("prompt-row-open").click()
    app.page.get_by_test_id("detail-menu").click()
    app.page.get_by_test_id("detail-delete").click()

    toast = app.page.get_by_test_id("toast")
    toast.wait_for()
    toast_style = style(app, '[data-testid="toast"]')
    assert toast_style["display"] == "grid"
    assert toast_style["backgroundColor"] == "rgb(253, 252, 249)"
    assert toast_style["borderRadius"] == "8px"
    assert toast.get_by_test_id("toast-action").is_visible()
    assert toast.locator(".mf-ui-toast-icon").is_visible()
    assert toast.locator(".mf-ui-toast-body").is_visible()
    capture(app, "phase-c-toast-light-1440x900.png")

    set_desktop_theme(app, "dark")
    assert style(app, '[data-testid="toast"]')["backgroundColor"] == "rgb(43, 45, 49)"
    capture(app, "phase-c-toast-dark-1440x900.png")
