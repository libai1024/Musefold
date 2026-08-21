"""PL-03：素笺三条真实鼠标路径（双击记笺 / 拾选 / 拾遗）。

朱点是 v0.3.3 的入口级交互，之前只有实现与 IPC 层证据，没有真实指针路径脚本。
本文件用真实 Electron + 真实系统剪贴板走完三条路径，并校验落库为 source='slip'。
"""
from __future__ import annotations

import subprocess
import time

import pytest


def slip_rows(app):
    return app.db_query(
        "SELECT id, title, content, source, preview_image_path FROM prompts "
        "WHERE source = 'slip' AND deleted_at IS NULL ORDER BY created_at DESC"
    )


def set_system_clipboard(text: str) -> None:
    """写真实系统剪贴板（主进程通过 Electron clipboard 读取）。"""
    subprocess.run(["pbcopy"], input=text.encode("utf-8"), check=True)


def dblclick_mark(app, *, alt: bool = False) -> None:
    mark = app.page.locator('[data-testid="ember-mark"]')
    mark.wait_for()
    if alt:
        app.page.keyboard.down("Alt")
        try:
            mark.dblclick()
        finally:
            app.page.keyboard.up("Alt")
    else:
        mark.dblclick()


def test_slip_double_click_writes_note(app):
    """路径一：双击朱点 → 素笺展开 → 输入 → Enter 收笺入匣。"""
    app.set_view("generate")
    assert slip_rows(app) == []

    dblclick_mark(app)
    card = app.page.locator('[data-testid="ember-slip-card"]')
    card.wait_for()

    app.page.locator('[data-testid="ember-slip-input"]').fill("双击记一笔：留白要更狠一点")
    app.page.keyboard.press("Enter")
    card.wait_for(state="detached")

    rows = slip_rows(app)
    assert len(rows) == 1, rows
    assert "留白要更狠一点" in rows[0]["content"]
    assert rows[0]["source"] == "slip"

    # 笺匣过滤器出现并计数（库页入口）。
    app.set_view("library")
    chip = app.page.locator('[data-testid="library-filter-slips"]')
    chip.wait_for()
    assert "1" in chip.inner_text()


def test_slip_empty_note_is_not_saved(app):
    """空笺不落库：双击展开后直接 Enter 只摇头，不产生脏数据。"""
    app.set_view("generate")
    dblclick_mark(app)
    app.page.locator('[data-testid="ember-slip-card"]').wait_for()
    app.page.keyboard.press("Enter")
    app.page.wait_for_timeout(600)
    # 卡片仍在（没被收下），且没有落库。
    assert app.page.locator('[data-testid="ember-slip-card"]').count() == 1
    assert slip_rows(app) == []


def test_slip_pickup_from_selection(app):
    """路径二：选中页面文字 → 单击朱点 → 300ms 后拾选入匣 + 批注可撤销。"""
    app.set_view("generate")
    assert slip_rows(app) == []

    # 在页面里造一段可选中的真实文本并选中它。
    app.page.evaluate(
        """() => {
            const node = document.createElement('p');
            node.id = 'uj-selection-source';
            node.textContent = '拾选验证：冷白光下的极简产品图';
            node.style.cssText = 'position:fixed;left:24px;bottom:180px;z-index:1;';
            document.body.appendChild(node);
            const range = document.createRange();
            range.selectNodeContents(node);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        }"""
    )
    assert app.page.evaluate("() => window.getSelection().toString().length") > 0

    app.page.locator('[data-testid="ember-mark"]').click()
    # 拾选有 300ms 的「让位给双击」窗口。
    annotation = app.page.locator('[data-testid="ember-annotation"]')
    annotation.wait_for(timeout=5_000)
    assert "拾得" in annotation.inner_text()

    rows = slip_rows(app)
    assert len(rows) == 1, rows
    assert "冷白光下的极简产品图" in rows[0]["content"]

    # 批注即撤销：停留期内点一下把这枚笺抽回。
    annotation.click()
    app.page.wait_for_function(
        "() => document.querySelector('[data-testid=\"ember-annotation\"]')?.innerText.includes('已抽回')",
        timeout=5_000,
    )
    app.page.wait_for_timeout(300)
    assert slip_rows(app) == [], "撤销后不应残留素笺"


@pytest.mark.gui
def test_slip_glean_clipboard_text(app):
    """路径三：Alt+双击朱点 → 拾遗剪贴板文字入匣。

    回归点：渲染进程没有 clipboard-read 权限，必须走主进程窄 IPC，
    否则真实应用里永远只报「剪贴板无物」。
    """
    app.set_view("generate")
    assert slip_rows(app) == []

    set_system_clipboard("拾遗验证：焦糖色渐层与柔和阴影")
    dblclick_mark(app, alt=True)

    annotation = app.page.locator('[data-testid="ember-annotation"]')
    annotation.wait_for(timeout=8_000)
    label = annotation.inner_text()
    assert "剪贴板无物" not in label, "拾遗读不到剪贴板（clipboard-read 权限路径回归）"
    assert "拾得" in label, label

    rows = slip_rows(app)
    assert len(rows) == 1, rows
    assert "焦糖色渐层" in rows[0]["content"]


@pytest.mark.gui
def test_slip_glean_empty_clipboard(app):
    """拾遗兜底：剪贴板为空时明确提示且不入库。"""
    app.set_view("generate")
    set_system_clipboard("")
    dblclick_mark(app, alt=True)

    annotation = app.page.locator('[data-testid="ember-annotation"]')
    annotation.wait_for(timeout=8_000)
    assert "剪贴板无物" in annotation.inner_text()
    assert slip_rows(app) == []
