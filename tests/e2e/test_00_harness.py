"""
M0 · 测试基座自检 —— 证明 Playwright(Python) 能驱动真实 Electron 应用。

覆盖：应用启动 / React 挂载 / preload window.api 可用 / 真实 SQLite 落库 /
迁移与基础 seed 生效 / 测试钩子可切视图 / 无控制台错误。
"""
from __future__ import annotations


def test_app_boots_and_renders(app):
    assert app.page.evaluate("() => !!document.querySelector('#root')?.children.length")
    # 侧栏导航存在（新设计/提示词库/设计方案/生成历史）
    text = app.page.inner_text("body")
    for label in ("新设计", "提示词库", "设计方案", "生成历史"):
        assert label in text, f"missing nav: {label}"


def test_preload_api_bridge_available(app):
    shape = app.page.evaluate(
        "() => Object.keys(window.api ?? {}).sort()"
    )
    for ns in ("prompt", "skillRuntime", "designScheme",
               "provider", "settings", "image", "history", "system"):
        assert ns in shape, f"window.api.{ns} missing (got {shape})"
    for retired in ("folder", "tag", "smartSet"):
        assert retired not in shape, f"退役命名空间 window.api.{retired} 仍在暴露"


def test_migrations_and_seed_applied(app):
    ver = app.api_ok("system.getVersion")
    assert ver["db"] >= 11, ver
    assert app.db_query(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'history_prompt_references'"
    )
    # 预设标签 seed
    tags = app.db_query("SELECT name FROM tags")
    assert len(tags) > 0, "seed tags missing"


def test_real_sqlite_roundtrip(app):
    created = app.api_ok("prompt.create", {
        "title": "harness 自检",
        "content": "a cat, cinematic lighting",
        "modelId": "gpt-image-2",
    })
    pid = created["id"]
    # 经 IPC 读回
    got = app.api_ok("prompt.get", pid)
    assert got and got["title"] == "harness 自检"
    # 直查磁盘 DB —— 证明真的落库（不是内存桩）
    rows = app.db_query("SELECT title, content FROM prompts WHERE id = ?", (pid,))
    assert rows and rows[0]["title"] == "harness 自检", rows


def test_test_hook_can_switch_view(app):
    for view in ("library", "design-schemes", "history", "settings", "generate"):
        app.set_view(view)
        assert app.page.evaluate("() => window.__musefold_test.getView()") == view


def test_no_console_errors_on_boot(app):
    app.set_view("library")
    app.set_view("design-schemes")
    errs = [e for e in app.console_errors() if "DevTools" not in e]
    assert not errs, f"console errors: {errs[:5]}"
