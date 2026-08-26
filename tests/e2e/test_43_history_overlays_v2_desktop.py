"""Musefold 2.0 History action overlays at the desktop viewport."""

from __future__ import annotations

import json
import os
import sqlite3
import time
from pathlib import Path


DESKTOP_VIEWPORT = {"width": 1440, "height": 900}
PNG_1PX = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082"
)


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


def insert_history(app, image_path: str) -> None:
    connection = sqlite3.connect(app.db_path())
    try:
        connection.execute(
            """
            INSERT INTO history (
              id, provider_id, model, prompt_text, params, status,
              image_path, cost, cost_unit, duration_ms, created_at
            ) VALUES (?, ?, ?, ?, ?, 'success', ?, ?, 'point', ?, ?)
            """,
            (
                "phase-c-history-overlay",
                "phase-c-history-provider",
                "gpt-image-2",
                "Phase C 历史详情菜单与危险确认",
                json.dumps({"size": "1024x1024", "quality": "auto", "n": 1}),
                image_path,
                2,
                1320,
                int(time.time() * 1000),
            ),
        )
        connection.commit()
    finally:
        connection.close()


def wait_for_menu(app):
    menu = app.page.get_by_role("menu", name="生成记录操作")
    menu.wait_for()
    app.page.wait_for_function(
        "() => getComputedStyle(document.querySelector('[role=menu][aria-label=\"生成记录操作\"]')).opacity === '1'"
    )
    return menu


def menu_style(menu) -> dict:
    return menu.evaluate(
        """node => {
          const style = getComputedStyle(node);
          const box = node.getBoundingClientRect();
          return {
            backgroundColor: style.backgroundColor,
            borderRadius: style.borderRadius,
            boxShadow: style.boxShadow,
            width: box.width,
            right: box.right,
          };
        }"""
    )


def assert_menu_keyboard_contract(app, trigger, menu) -> None:
    enabled = menu.locator('[role="menuitem"]:not([data-disabled])')
    first = enabled.first
    last = enabled.last
    app.page.wait_for_function(
        "() => document.activeElement === document.querySelector('[role=menu][aria-label=\"生成记录操作\"] [role=menuitem]:not([data-disabled])')"
    )
    assert first.evaluate("node => node === document.activeElement")
    app.page.keyboard.press("End")
    assert last.evaluate("node => node === document.activeElement")
    assert last.get_attribute("data-testid") == "history-detail-delete"
    app.page.keyboard.press("Home")
    assert first.evaluate("node => node === document.activeElement")
    app.page.keyboard.press("Escape")
    menu.wait_for(state="detached")
    app.page.wait_for_function(
        "() => document.activeElement === document.querySelector('[data-testid=\"history-detail-menu\"]')"
    )
    assert trigger.evaluate("node => node === document.activeElement")


def open_delete_dialog(app, trigger):
    trigger.click()
    menu = wait_for_menu(app)
    delete_item = menu.get_by_test_id("history-detail-delete")
    assert "mf-danger-action" in (delete_item.get_attribute("class") or "")
    delete_item.click()
    dialog = app.page.get_by_test_id("history-detail-delete-dialog")
    dialog.wait_for()
    return dialog


def test_history_detail_actions_use_shared_dropdown_and_dialog(app):
    image_path = app.user_data_dir / "phase-c-history-overlay.png"
    image_path.write_bytes(PNG_1PX)
    insert_history(app, str(image_path))
    set_theme(app, "dark")
    app.set_view("history")
    row = app.page.get_by_test_id("history-row").filter(
        has_text="Phase C 历史详情菜单与危险确认"
    )
    row.wait_for()
    row.click()

    detail = app.page.get_by_test_id("history-detail")
    detail.wait_for()
    trigger = app.page.get_by_test_id("history-detail-menu")
    action_bar = app.page.locator(".mf-history-inspector-action-bar")
    action_labels = action_bar.locator("button").all_inner_texts()
    assert "再次制作" in action_labels
    assert "存为提示词" in action_labels
    assert "创建设计方案" in action_labels
    assert "更多操作" in action_labels
    assert "打开文件夹" not in action_labels

    action_bar_height = action_bar.evaluate("node => node.getBoundingClientRect().height")
    trigger.click()
    dark_menu = wait_for_menu(app)
    dark_style = menu_style(dark_menu)
    trigger_box = trigger.bounding_box()
    assert dark_style["backgroundColor"] == "rgb(43, 45, 49)"
    assert dark_style["borderRadius"] == "8px"
    assert dark_style["boxShadow"] != "none"
    assert abs(dark_style["width"] - 196) <= 1
    assert trigger_box is not None
    assert abs(dark_style["right"] - (trigger_box["x"] + trigger_box["width"])) <= 2
    assert action_bar.evaluate("node => node.getBoundingClientRect().height") == action_bar_height
    capture(app, "phase-c-history-detail-menu-dark-1440x900.png")
    assert_menu_keyboard_contract(app, trigger, dark_menu)

    set_theme(app, "light")
    trigger.click()
    light_menu = wait_for_menu(app)
    assert menu_style(light_menu)["backgroundColor"] == "rgb(253, 252, 249)"
    capture(app, "phase-c-history-detail-menu-light-1440x900.png")
    app.page.keyboard.press("Escape")

    light_dialog = open_delete_dialog(app, trigger)
    light_dialog_style = light_dialog.evaluate(
        """node => {
          const style = getComputedStyle(node);
          return {
            backgroundColor: style.backgroundColor,
            borderRadius: style.borderRadius,
            boxShadow: style.boxShadow,
          };
        }"""
    )
    assert light_dialog_style["backgroundColor"] == "rgb(255, 255, 255)"
    assert light_dialog_style["borderRadius"] == "16px"
    assert light_dialog_style["boxShadow"] != "none"
    assert light_dialog.locator(".mf-ui-dialog-body").count() == 1
    assert "影响本地使用统计" in light_dialog.inner_text()
    capture(app, "phase-c-history-delete-dialog-light-1440x900.png")
    app.page.keyboard.press("Escape")
    light_dialog.wait_for(state="detached")
    app.page.wait_for_function(
        "() => document.activeElement === document.querySelector('[data-testid=\"history-detail-menu\"]')"
    )
    assert trigger.evaluate("node => node === document.activeElement")

    set_theme(app, "dark")
    dark_dialog = open_delete_dialog(app, trigger)
    assert dark_dialog.evaluate("node => getComputedStyle(node).backgroundColor") == "rgb(37, 39, 42)"
    capture(app, "phase-c-history-delete-dialog-dark-1440x900.png")
    app.page.keyboard.press("Escape")
    dark_dialog.wait_for(state="detached")
    app.page.wait_for_function(
        "() => document.activeElement === document.querySelector('[data-testid=\"history-detail-menu\"]')"
    )
    assert trigger.evaluate("node => node === document.activeElement")
