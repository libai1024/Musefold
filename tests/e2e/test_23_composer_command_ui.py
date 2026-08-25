"""Offline UI checks for the composer command interaction.

- "/" opens a floating hint popover anchored above the composer (like the +
  menu), filtered live by the typed prefix.
- Selecting a hint (click / Enter) switches the composer into design-plan mode.
- Typing a full command switches mode automatically; Backspace at the start
  clears the mode while preserving the body text.
"""
from __future__ import annotations

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
EVIDENCE_DIR = REPO_ROOT / "generated/v032-command-mode"


def _mode(app):
    return app.page.locator('[data-testid="composer-mode"]')


def _assert_design_plan_mode(app):
    mode = _mode(app)
    mode.wait_for(state="visible")
    assert mode.locator('[data-active="true"]').inner_text() == "设计方案"


def test_command_hints_filter_and_mode_lifecycle(app):
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    prompt_box = app.page.locator('[data-workbench-testid="workbench-prompt"]')
    prompt_box.click()

    # "/" 打开浮层，两条指令都在；浮层锚定在 composer 上方而不是撑开内部
    prompt_box.fill("/")
    app.page.wait_for_selector('[data-testid="composer-command-hints"]')
    assert app.page.locator('[data-testid="composer-command-hint"]').count() == 2
    hints_box = app.page.locator('[data-testid="composer-command-hints"]').bounding_box()
    surface_box = app.page.locator('[data-testid="workbench-composer-surface"]').bounding_box()
    assert hints_box["y"] + hints_box["height"] <= surface_box["y"] + 1  # 完全在 composer 上方
    app.page.screenshot(path=str(EVIDENCE_DIR / "01-hints-all.png"), full_page=True)

    # 输入实时筛选：/cre 只剩英文指令；/xyz 无匹配关闭浮层
    prompt_box.fill("/cre")
    assert app.page.locator('[data-testid="composer-command-hint"]').count() == 1
    app.page.screenshot(path=str(EVIDENCE_DIR / "02-hints-filtered.png"), full_page=True)
    prompt_box.fill("/xyz")
    assert app.page.locator('[data-testid="composer-command-hints"]').count() == 0

    # Enter 选中当前指令 → 切换到设计方案模式，正文保持为空
    prompt_box.fill("/创建")
    assert app.page.locator('[data-testid="composer-command-hint"]').count() == 1
    prompt_box.press("Enter")
    _assert_design_plan_mode(app)
    assert prompt_box.input_value() == ""
    assert app.page.locator('[data-testid="composer-command-hints"]').count() == 0
    app.page.screenshot(path=str(EVIDENCE_DIR / "03-design-plan-mode.png"), full_page=True)

    # 光标在正文最前 Backspace 清除模式
    prompt_box.click()
    prompt_box.press("Backspace")
    assert _mode(app).locator('[data-active="true"]').inner_text() == "图像"

    # 输入完整指令自动切换模式，正文保留想法
    prompt_box.fill("/create design plan 做一套贴纸方案")
    _assert_design_plan_mode(app)
    assert prompt_box.input_value() == "做一套贴纸方案"
    app.page.screenshot(path=str(EVIDENCE_DIR / "03b-mode-with-text.png"), full_page=True)

    # 光标在正文最前 Backspace 清除模式，正文不动
    prompt_box.click()
    prompt_box.press("Home")
    prompt_box.press("Backspace")
    assert _mode(app).locator('[data-active="true"]').inner_text() == "图像"
    assert prompt_box.input_value() == "做一套贴纸方案"

    # + 菜单「生成设计方案」切换模式而不是立即执行
    prompt_box.fill("")
    app.page.click('[data-testid="workbench-image-picker"]')
    app.page.wait_for_selector('[data-testid="composer-menu-design-plan"]')
    app.page.click('[data-testid="composer-menu-design-plan"]')
    _assert_design_plan_mode(app)
    assert app.page.locator('[data-testid="scheme-creation-conversation"]').count() == 0
    app.page.screenshot(path=str(EVIDENCE_DIR / "04-mode-from-menu.png"), full_page=True)
