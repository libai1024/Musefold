"""Musefold 2.0 Prompt dropdown contracts at the desktop viewport."""

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


def capture(app, name: str) -> None:
    target = output_dir()
    if target:
        app.page.screenshot(path=str(target / name), full_page=False)


def set_theme(app, theme: str) -> None:
    app.page.set_viewport_size(DESKTOP_VIEWPORT)
    app.page.evaluate(
        "value => window.__musefold_test.stores.app.getState().setThemeSource(value)",
        theme,
    )
    app.page.wait_for_function(
        "value => document.documentElement.dataset.theme === value",
        arg=theme,
    )


def menu_style(menu) -> dict:
    return menu.evaluate(
        """node => {
          const value = getComputedStyle(node);
          return {
            backgroundColor: value.backgroundColor,
            borderRadius: value.borderRadius,
            boxShadow: value.boxShadow,
            opacity: value.opacity,
          };
        }"""
    )


def wait_for_menu(app, label: str):
    menu = app.page.get_by_role("menu", name=label)
    menu.wait_for()
    app.page.wait_for_function(
        "label => getComputedStyle(document.querySelector(`[role=menu][aria-label='${label}']`)).opacity === '1'",
        arg=label,
    )
    return menu


def assert_menu_keyboard_contract(app, trigger, menu) -> None:
    items = menu.get_by_role("menuitem")
    first = items.first
    last = items.last
    app.page.wait_for_function(
        "selector => document.activeElement === document.querySelector(selector)",
        arg=f'[role="menu"][aria-label="{menu.get_attribute("aria-label")}"] [role="menuitem"]',
    )
    assert first.evaluate("node => node === document.activeElement")
    app.page.keyboard.press("End")
    assert last.evaluate(
        "node => node === document.activeElement"
    ), app.page.evaluate("document.activeElement?.outerHTML")
    app.page.keyboard.press("Home")
    assert first.evaluate(
        "node => node === document.activeElement"
    ), app.page.evaluate("document.activeElement?.outerHTML")
    app.page.keyboard.press("Escape")
    menu.wait_for(state="detached")
    trigger_test_id = trigger.get_attribute("data-testid")
    app.page.wait_for_function(
        "testId => document.activeElement === document.querySelector(`[data-testid='${testId}']`)",
        arg=trigger_test_id,
    )
    assert trigger.evaluate("node => node === document.activeElement")


def test_prompt_header_and_detail_menus_use_shared_dropdown(app):
    prompt = app.api_ok(
        "prompt.create",
        {
            "title": "Phase C 提示词菜单",
            "content": "克制的产品摄影，柔和侧光，细腻材质",
        },
    )
    app.set_view("library")
    set_theme(app, "dark")
    app.page.evaluate(
        "() => window.__musefold_test.stores.library.getState().reloadPrompts()"
    )
    row = app.page.locator(
        f'[data-testid="prompt-row"][data-prompt-id="{prompt["id"]}"]'
    )
    row.wait_for()

    header_trigger = app.page.get_by_test_id("library-menu")
    header_trigger.click()
    header_menu = wait_for_menu(app, "提示词库操作")
    dark_header = menu_style(header_menu)
    assert dark_header["backgroundColor"] == "rgb(43, 45, 49)"
    assert dark_header["borderRadius"] == "8px"
    assert dark_header["boxShadow"] != "none"
    capture(app, "phase-c-prompt-header-menu-dark-1440x900.png")
    assert_menu_keyboard_contract(app, header_trigger, header_menu)

    set_theme(app, "light")
    header_trigger.click()
    header_menu = wait_for_menu(app, "提示词库操作")
    assert menu_style(header_menu)["backgroundColor"] == "rgb(253, 252, 249)"
    capture(app, "phase-c-prompt-header-menu-light-1440x900.png")
    app.page.keyboard.press("Escape")

    row.get_by_test_id("prompt-row-open").click()
    detail = app.page.locator(
        f'[data-testid="prompt-detail"][data-prompt-id="{prompt["id"]}"]'
    )
    detail.wait_for()
    detail_trigger = app.page.get_by_test_id("detail-menu")
    detail_trigger.click()
    detail_menu = wait_for_menu(app, "提示词操作")
    light_detail = menu_style(detail_menu)
    assert light_detail["backgroundColor"] == "rgb(253, 252, 249)"
    assert light_detail["borderRadius"] == "8px"
    assert detail_menu.get_by_test_id("detail-delete").get_attribute("data-tone") == "danger"
    capture(app, "phase-c-prompt-detail-menu-light-1440x900.png")
    assert_menu_keyboard_contract(app, detail_trigger, detail_menu)

    set_theme(app, "dark")
    detail_trigger.click()
    detail_menu = wait_for_menu(app, "提示词操作")
    assert menu_style(detail_menu)["backgroundColor"] == "rgb(43, 45, 49)"
    capture(app, "phase-c-prompt-detail-menu-dark-1440x900.png")
