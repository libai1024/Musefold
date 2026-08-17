"""Offline UI checks for the Codex-style composer command interaction.

- "/" opens a floating hint popover anchored above the composer (like the +
  menu), filtered live by the typed prefix.
- Selecting a hint (click / Enter) mounts an inline command chip at the text
  start position inside the prompt box; body text flows after it (text-indent).
- Typing a full command converts to the chip automatically; Backspace at the
  start of the text (or the chip's X) removes it.
"""
from __future__ import annotations

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
EVIDENCE_DIR = REPO_ROOT / "generated/v032-command-chip"


def _chip(app):
    return app.page.locator('[data-testid="composer-command-chip"]')


def test_command_hints_filter_and_chip_lifecycle(app):
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

    # Enter 选中当前指令 → 行内芯片出现在输入文字起始处，正文清空且缩进避开芯片
    prompt_box.fill("/创建")
    assert app.page.locator('[data-testid="composer-command-hint"]').count() == 1
    prompt_box.press("Enter")
    app.page.wait_for_selector('[data-testid="composer-command-chip"][data-command="design-plan"]')
    chip_box = _chip(app).bounding_box()
    prompt_rect = prompt_box.bounding_box()
    assert chip_box["y"] >= prompt_rect["y"]  # 芯片叠在输入区首行位置（行内）
    assert chip_box["x"] >= prompt_rect["x"]
    indent = prompt_box.evaluate("el => parseFloat(getComputedStyle(el).textIndent) || 0")
    assert indent >= chip_box["width"]  # 正文从芯片后开始
    assert prompt_box.input_value() == ""
    assert app.page.locator('[data-testid="composer-command-hints"]').count() == 0
    app.page.screenshot(path=str(EVIDENCE_DIR / "03-chip-mounted.png"), full_page=True)

    # 光标在正文最前 Backspace 移除芯片
    prompt_box.click()
    prompt_box.press("Backspace")
    assert _chip(app).count() == 0

    # 输入完整指令自动收敛为芯片，正文保留想法
    prompt_box.fill("/create design plan 做一套贴纸方案")
    app.page.wait_for_selector('[data-testid="composer-command-chip"]')
    assert prompt_box.input_value() == "做一套贴纸方案"
    app.page.screenshot(path=str(EVIDENCE_DIR / "03b-chip-with-text.png"), full_page=True)

    # X 按钮移除芯片，正文不动
    app.page.click('[data-testid="composer-command-chip-remove"]')
    assert _chip(app).count() == 0
    assert prompt_box.input_value() == "做一套贴纸方案"

    # + 菜单「生成设计方案」也挂芯片而不是立即执行
    prompt_box.fill("")
    app.page.click('[data-testid="workbench-image-picker"]')
    app.page.wait_for_selector('[data-testid="composer-menu-design-plan"]')
    app.page.click('[data-testid="composer-menu-design-plan"]')
    app.page.wait_for_selector('[data-testid="composer-command-chip"]')
    assert app.page.locator('[data-testid="scheme-creation-conversation"]').count() == 0
    app.page.screenshot(path=str(EVIDENCE_DIR / "04-chip-from-menu.png"), full_page=True)
