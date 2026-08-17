"""v0.3.0 keyboard and accessibility smoke tests on the real Electron app."""
from __future__ import annotations


def assert_accessibility_contract(app):
    result = app.page.evaluate(
        """() => {
          const visible = (node) => {
            const style = getComputedStyle(node);
            const rect = node.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
          };
          const name = (node) => (
            node.getAttribute('aria-label') ||
            node.getAttribute('title') ||
            node.getAttribute('alt') ||
            node.innerText ||
            node.value ||
            ''
          ).trim();
          const missingNames = Array.from(document.querySelectorAll(
            'button, input, textarea, select, [role="button"], [role="tab"], [role="menuitem"]'
          )).filter((node) => visible(node) && !node.closest('[aria-hidden="true"]') && !name(node))
            .map((node) => ({ tag: node.tagName, testId: node.getAttribute('data-testid'), role: node.getAttribute('role') }));
          const missingImageAlt = Array.from(document.images)
            .filter((node) => visible(node) && !node.closest('[aria-hidden="true"]') && !node.alt.trim())
            .map((node) => node.getAttribute('data-testid') || node.src);
          const positiveTabIndex = Array.from(document.querySelectorAll('[tabindex]'))
            .filter((node) => visible(node) && Number(node.getAttribute('tabindex')) > 0)
            .map((node) => ({ testId: node.getAttribute('data-testid'), tabIndex: node.getAttribute('tabindex') }));
          const viewport = { width: innerWidth, height: innerHeight };
          return {
            missingNames,
            missingImageAlt,
            positiveTabIndex,
            overflow: { documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth },
            viewport,
          };
        }"""
    )
    assert not result["missingNames"], result
    assert not result["missingImageAlt"], result
    assert not result["positiveTabIndex"], result
    assert result["overflow"]["documentWidth"] <= result["viewport"]["width"] + 1, result
    assert result["overflow"]["bodyWidth"] <= result["viewport"]["width"] + 1, result


def test_accessible_names_and_layout_contract_across_core_surfaces(app):
    for view, marker in (
        ("generate", '[data-testid="generation-workbench"]'),
        ("library", '[data-testid="library-page"]'),
        ("history", '[data-testid="history-page"]'),
        ("design-schemes", '[data-testid="design-schemes-page"]'),
    ):
        app.set_view(view)
        app.page.wait_for_selector(marker)
        assert_accessibility_contract(app)


def test_prompt_reference_drawer_keyboard_focus_and_escape(app):
    # 现行素材库：标题栏开关打开；≤760px 为模态抽屉（dialog 语义 + 焦点陷阱 + Escape 关闭并归还焦点）
    app.page.set_viewport_size({"width": 640, "height": 760})
    toggle = app.page.locator('[data-testid="titlebar-materials-toggle"]')
    toggle.focus()
    toggle.press("Enter")
    app.page.wait_for_selector('[data-testid="workbench-reference-sidebar"]')
    app.page.wait_for_selector('[data-testid="workbench-reference-backdrop"]')

    sidebar = app.page.get_by_test_id("workbench-reference-sidebar")
    assert sidebar.get_attribute("role") == "dialog"
    assert sidebar.get_attribute("aria-modal") == "true"

    # 窄窗打开后搜索框自动聚焦（120ms 定时）
    search = app.page.get_by_test_id("workbench-reference-search")
    app.page.wait_for_timeout(260)
    assert search.evaluate("node => document.activeElement === node")

    # 焦点陷阱：从关闭按钮出发连续 Tab，焦点始终留在面板内
    close = app.page.get_by_test_id("workbench-materials-close")
    close.focus()
    for _ in range(12):
        app.page.keyboard.press("Tab")
        assert app.page.evaluate(
            "() => document.querySelector('[data-testid=\"workbench-reference-sidebar\"]')"
            ".contains(document.activeElement)"
        )
    app.page.keyboard.press("Shift+Tab")
    assert app.page.evaluate(
        "() => document.querySelector('[data-testid=\"workbench-reference-sidebar\"]')"
        ".contains(document.activeElement)"
    )

    app.page.keyboard.press("Escape")
    app.page.wait_for_function(
        "() => document.querySelector('[data-testid=\"workbench-reference-sidebar\"]') === null",
    )
    assert toggle.evaluate("node => document.activeElement === node")
