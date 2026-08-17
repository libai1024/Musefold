"""v0.3.2 design scheme UI against the real Skill import boundary.

The test deliberately stops before AI conversion: live text/image credentials are
covered by the gated full-flow tests and must never be embedded in deterministic E2E.
"""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path


def output_dir() -> Path:
    configured = os.environ.get("MUSEFOLD_VISUAL_OUTPUT_DIR")
    target = Path(configured) if configured else Path("generated/v032-ui-real")
    target.mkdir(parents=True, exist_ok=True)
    return target


def scheme_db_query(app, sql: str, params: tuple = ()):
    path = app.user_data_dir / "musefold-design-scheme-v0.3.2.db"
    assert path.exists(), f"design scheme db missing: {path}"
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        con.row_factory = sqlite3.Row
        return [dict(row) for row in con.execute(sql, params).fetchall()]
    finally:
        con.close()


def assert_no_horizontal_overflow(app):
    metrics = app.page.evaluate(
        """() => ({
          viewport: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          bodyWidth: document.body.scrollWidth,
        })""",
    )
    assert metrics["documentWidth"] <= metrics["viewport"] + 1, metrics
    assert metrics["bodyWidth"] <= metrics["viewport"] + 1, metrics


def test_design_scheme_discovery_requires_explicit_skill_confirmation(app):
    """发现页市场搜索（Explorer）：显式触发、候选带许可证与风险、添加需确认。"""
    target = output_dir()
    app.page.set_viewport_size({"width": 1280, "height": 820})
    app.set_view("design-schemes")
    app.page.wait_for_selector('[data-testid="design-schemes-page"]')
    app.page.click('[data-testid="scheme-surface-explore"]')

    # Explorer 只在显式触发后运行：初始不加载远程列表。
    app.page.wait_for_selector('[data-testid="market-discover"]')
    assert app.page.locator('[data-testid^="market-candidate-"]').count() == 0

    app.page.fill('[data-testid="scheme-search"]', "diagram skill")
    app.page.click('[data-testid="market-search-run"]')
    app.page.wait_for_selector('[data-testid="market-candidate-mc_9001"]')

    licensed = app.page.locator('[data-testid="market-candidate-mc_9001"]').inner_text()
    assert "example/diagram-skill" in licensed
    assert "MIT" in licensed
    # 无许可证候选必须给出风险摘要。
    risk = app.page.locator('[data-testid="market-risk-mc_9002"]').inner_text()
    assert "许可证" in risk
    app.page.screenshot(path=str(target / "01-market-results.png"), full_page=False)

    # 添加需要确认：展示许可证与安全边界，不静默安装。
    app.page.click('[data-testid="market-add-mc_9001"]')
    app.page.wait_for_selector('[data-testid="market-install-dialog"]')
    dialog_text = app.page.locator('[data-testid="market-install-dialog"]').inner_text()
    assert "不会执行仓库脚本" in dialog_text
    assert "MIT" in dialog_text
    app.page.screenshot(path=str(target / "02-market-install-confirm.png"), full_page=False)

    # 关闭后回到候选列表；缓存已写入 market_candidates。
    app.page.click('[data-testid="market-install-dialog"] button[aria-label="关闭"]')
    app.page.wait_for_function("() => !document.querySelector('[data-testid=market-install-dialog]')")
    assert_no_horizontal_overflow(app)

    cached = scheme_db_query(
        app,
        "SELECT query, repository_url FROM market_candidates ORDER BY candidate_id",
    )
    assert len(cached) == 2
    assert cached[0]["query"] == "diagram skill"
    assert cached[0]["repository_url"] == "https://github.com/example/diagram-skill"
