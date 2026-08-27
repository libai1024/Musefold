"""
tests/e2e/test_06_history.py — History P1 UX（TASK-HIS-05 / TASK-HIS-09）。

断言落在真实 SQLite 历史行 + Electron 渲染 UI 两侧：
  - 成功记录可复制图片、可调用 system.openInFolder 定位图片
  - 无 image_path 的记录禁用文件动作，缺失路径会给可读错误
  - 失败行展示中文错误文案，不裸露成唯一的 error_code
  - AUTH 类不可重试，显示更新密钥动作
  - RATE_LIMIT 类可重试，点击后列表与详情共享「重试中」态
"""
from __future__ import annotations

import base64
import json
import os
import sqlite3
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest

PNG_1PX = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082"
)


@pytest.fixture()
def image_server():
    requests: list[dict] = []
    png_b64 = base64.b64encode(PNG_1PX).decode("ascii")

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802 - stdlib callback name
            length = int(self.headers.get("content-length", "0"))
            raw = self.rfile.read(length)
            requests.append(json.loads(raw.decode("utf-8")))
            payload = json.dumps({"data": [{"b64_json": png_b64}]}).encode("utf-8")
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(payload)))
            self.send_header("connection", "close")
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *_args):
            return

    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/v1", requests
    finally:
        server.shutdown()
        thread.join(timeout=2)
        server.server_close()


def insert_history(
    app,
    *,
    hid: str,
    provider_id: str,
    created_at: int,
    status: str = "failed",
    code: str | None = None,
    message: str | None = None,
    image_path: str | None = None,
    prompt_text: str | None = None,
    negative_text: str | None = None,
    params: dict | None = None,
    prompt_id: str | None = None,
):
    con = sqlite3.connect(app.db_path())
    try:
        con.execute(
            """
            INSERT INTO history (
              id, prompt_id, provider_id, model, prompt_text, negative_text, params,
              status, error_code, error_message, image_path, cost, cost_unit, duration_ms, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                hid,
                prompt_id,
                provider_id,
                "gpt-image-2",
                prompt_text or f"history prompt {hid}",
                negative_text,
                json.dumps(params or {"size": "1024x1024", "quality": "auto", "n": 1}),
                status,
                code,
                message,
                image_path,
                3.2 if status == "success" else None,
                "point",
                1200,
                created_at,
            ),
        )
        con.commit()
    finally:
        con.close()


def goto_history(app):
    app.set_view("history")
    app.page.wait_for_selector('[data-testid="history-list"]', timeout=15_000)
    app.page.wait_for_selector('[data-testid="history-row"]', timeout=15_000)


def open_history_detail(app, row, history_id: str):
    """点击真实的行命令按钮，并等待目标记录的 Inspector 完全切换。"""
    row.scroll_into_view_if_needed()
    row.locator(".mf-history-main").wait_for(state="visible")
    row.locator(".mf-history-main").click()
    app.page.wait_for_function(
        """historyId => {
          const detail = document.querySelector('[data-testid="history-detail"]');
          if (!(detail instanceof HTMLElement) || detail.dataset.historyId !== historyId) return false;
          const rect = detail.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }""",
        arg=history_id,
    )


def open_detail_actions(app):
    app.page.get_by_test_id("history-detail-menu").click()
    menu = app.page.get_by_role("menu", name="生成记录操作")
    menu.wait_for()
    return menu


def test_history_v2_shell_search_and_inspector_geometry(app):
    """2.0 桌面历史页保持唯一标题，并以独立 Dock 展示当前记录。"""
    visual_output = os.environ.get("MUSEFOLD_VISUAL_OUTPUT_DIR")
    output = Path(visual_output) if visual_output else None
    if output:
        output.mkdir(parents=True, exist_ok=True)
    app.page.set_viewport_size({"width": 1440, "height": 900})
    app.page.evaluate(
        """() => {
          const store = window.__musefold_test.stores.app.getState();
          store.setThemeSource('dark');
          store.setDensity('comfortable');
        }"""
    )
    app.page.wait_for_function("document.documentElement.dataset.theme === 'dark'")
    prompt = "V2 history inspector geometry"
    insert_history(
        app,
        hid="history-v2-layout",
        provider_id="provider-v2-layout",
        created_at=int(time.time() * 1000),
        status="success",
        prompt_text=prompt,
    )
    goto_history(app)

    assert app.page.get_by_test_id("titlebar-title").inner_text() == "生成历史"
    assert app.page.get_by_test_id("history-page").locator("h1").count() == 0
    assert app.page.get_by_test_id("history-inspector-toggle").is_disabled()
    filter_toggle = app.page.get_by_test_id("history-filter-toggle")
    assert filter_toggle.get_attribute("aria-expanded") == "false"
    assert app.page.get_by_test_id("history-filter-bar").count() == 0
    collapsed_geometry = app.page.evaluate(
        """() => {
          const toolbar = document.querySelector('.mf-history-shell-toolbar');
          const count = document.querySelector('.mf-history-shell-count');
          const actions = document.querySelector('.mf-history-shell-actions');
          const toggle = document.querySelector('[data-testid="history-filter-toggle"]');
          if (!toolbar || !count || !actions || !toggle) return null;
          const rect = element => element.getBoundingClientRect();
          const style = element => getComputedStyle(element);
          return {
            toolbar: rect(toolbar),
            count: rect(count),
            actions: rect(actions),
            toggle: rect(toggle),
            toggleRadius: style(toggle).borderRadius,
            documentWidth: document.documentElement.scrollWidth,
            viewportWidth: innerWidth,
          };
        }"""
    )
    assert collapsed_geometry is not None
    assert collapsed_geometry["toolbar"]["height"] == 40
    assert collapsed_geometry["count"]["x"] < collapsed_geometry["actions"]["x"]
    assert abs(
        collapsed_geometry["count"]["y"]
        + collapsed_geometry["count"]["height"] / 2
        - collapsed_geometry["actions"]["y"]
        - collapsed_geometry["actions"]["height"] / 2
    ) <= 1
    assert collapsed_geometry["toggle"]["height"] == 28
    assert collapsed_geometry["toggleRadius"] == "8px"
    assert collapsed_geometry["documentWidth"] <= collapsed_geometry["viewportWidth"] + 1
    if output:
        app.page.screenshot(path=str(output / "history-filter-collapsed-dark.png"))

    filter_toggle.click()
    assert filter_toggle.get_attribute("aria-expanded") == "true"
    assert app.page.get_by_test_id("history-filter-bar").is_visible()
    expanded_geometry = app.page.evaluate(
        """() => {
          const toolbar = document.querySelector('.mf-history-shell-toolbar');
          const filters = document.querySelector('[data-testid="history-filter-bar"]');
          const workspace = document.querySelector('[data-testid="history-workspace"]');
          if (!toolbar || !filters || !workspace) return null;
          const rect = element => element.getBoundingClientRect();
          return {
            toolbar: rect(toolbar),
            filters: rect(filters),
            workspace: rect(workspace),
            filterRadius: getComputedStyle(filters).borderRadius,
          };
        }"""
    )
    assert expanded_geometry is not None
    assert expanded_geometry["filters"]["y"] >= expanded_geometry["toolbar"]["bottom"] + 7
    assert expanded_geometry["filters"]["bottom"] < expanded_geometry["workspace"]["y"]
    assert expanded_geometry["filterRadius"] == "8px"
    if output:
        app.page.screenshot(path=str(output / "history-filter-expanded-dark.png"))
        app.page.evaluate(
            "window.__musefold_test.stores.app.getState().setThemeSource('light')"
        )
        app.page.wait_for_function(
            "document.documentElement.dataset.theme === 'light'"
        )
        app.page.screenshot(path=str(output / "history-filter-expanded-light.png"))
    app.page.get_by_test_id("history-filter-status").click()
    status_option = app.page.get_by_test_id("history-filter-status-succeeded")
    assert status_option.is_visible()
    status_option.click()

    search = app.page.get_by_test_id("history-filter-search")
    search.fill(prompt)
    app.page.wait_for_function(
        """prompt => {
          const rows = [...document.querySelectorAll('[data-testid="history-row"]')];
          return rows.length === 1 && rows[0].textContent.includes(prompt);
        }""",
        arg=prompt,
    )
    assert app.page.get_by_test_id("history-filter-count").inner_text() == "2"

    filter_toggle.click()
    assert filter_toggle.get_attribute("aria-expanded") == "false"
    assert app.page.get_by_test_id("history-filter-bar").count() == 0
    assert app.page.get_by_test_id("history-row").count() == 1
    if output:
        app.page.screenshot(path=str(output / "history-filter-active-collapsed-light.png"))

    row = app.page.get_by_test_id("history-row")
    row.click()
    app.page.wait_for_selector('[data-testid="history-detail-content"]')
    app.page.wait_for_function(
        """() => {
          const inspector = document.querySelector('[data-testid="history-inspector"]');
          return inspector && Math.abs(inspector.getBoundingClientRect().width - 324) <= 1;
        }"""
    )
    assert row.get_attribute("data-selected") == "true"

    geometry = app.page.get_by_test_id("history-workspace").evaluate(
        """workspace => {
          const list = workspace.querySelector('.mf-history-workspace-list');
          const inspector = workspace.querySelector('[data-testid="history-inspector"]');
          const surface = workspace.querySelector('.mf-history-inspector-surface');
          if (!list || !inspector || !surface) return null;
          const listBox = list.getBoundingClientRect();
          const inspectorBox = inspector.getBoundingClientRect();
          const surfaceStyle = getComputedStyle(surface);
          return {
            listRight: listBox.right,
            inspectorLeft: inspectorBox.left,
            inspectorWidth: inspectorBox.width,
            surfaceWidth: surface.getBoundingClientRect().width,
            surfaceRadius: parseFloat(surfaceStyle.borderTopLeftRadius),
          };
        }"""
    )
    assert geometry is not None
    assert geometry["listRight"] <= geometry["inspectorLeft"] + 1
    assert abs(geometry["inspectorWidth"] - 324) <= 1
    assert abs(geometry["surfaceWidth"] - 320) <= 1
    assert geometry["surfaceRadius"] >= 11

    app.page.set_viewport_size({"width": 960, "height": 760})
    app.page.wait_for_function(
        "() => getComputedStyle(document.querySelector('.mf-history-workspace-list')).display === 'none'"
    )
    app.page.wait_for_function(
        """() => {
          const workspace = document.querySelector('[data-testid="history-workspace"]');
          const inspector = document.querySelector('[data-testid="history-inspector"]');
          return workspace && inspector
            && Math.abs(workspace.getBoundingClientRect().width - inspector.getBoundingClientRect().width) <= 1;
        }"""
    )
    narrow_geometry = app.page.get_by_test_id("history-workspace").evaluate(
        """workspace => {
          const inspector = workspace.querySelector('[data-testid="history-inspector"]');
          if (!inspector) return null;
          return {
            workspaceWidth: workspace.getBoundingClientRect().width,
            inspectorWidth: inspector.getBoundingClientRect().width,
          };
        }"""
    )
    assert narrow_geometry is not None
    assert abs(narrow_geometry["workspaceWidth"] - narrow_geometry["inspectorWidth"]) <= 1

    app.page.get_by_test_id("history-detail-close").click()
    app.page.wait_for_function(
        """() => document.querySelector('[data-testid="history-workspace"]')
          ?.getAttribute('data-detail-open') === 'false'"""
    )
    assert app.page.get_by_test_id("history-row").get_attribute("data-selected") == "false"


def prompt_rows_by_source(app, source_url: str):
    con = sqlite3.connect(app.db_path())
    con.row_factory = sqlite3.Row
    try:
        rows = con.execute(
            """
            SELECT id, title, content, content_negative, params, source, source_url
            FROM prompts
            WHERE source_url = ? AND deleted_at IS NULL
            ORDER BY created_at ASC
            """,
            (source_url,),
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        con.close()


def set_prompt_create_failure(app, enabled: bool):
    con = sqlite3.connect(app.db_path())
    try:
        con.execute("DROP TRIGGER IF EXISTS musefold_e2e_fail_prompt_create")
        if enabled:
            con.execute(
                """
                CREATE TRIGGER musefold_e2e_fail_prompt_create
                BEFORE INSERT ON prompts
                BEGIN
                  SELECT RAISE(ABORT, 'simulated create failure');
                END
                """
            )
        con.commit()
    finally:
        con.close()


def set_history_delete_failure(app, enabled: bool):
    con = sqlite3.connect(app.db_path())
    try:
        con.execute("DROP TRIGGER IF EXISTS musefold_e2e_fail_history_delete")
        if enabled:
            con.execute(
                """
                CREATE TRIGGER musefold_e2e_fail_history_delete
                BEFORE DELETE ON history
                BEGIN
                  SELECT RAISE(ABORT, 'simulated history clear failure');
                END
                """
            )
        con.commit()
    finally:
        con.close()


def set_history_cost(app, hid: str, cost: int | None):
    con = sqlite3.connect(app.db_path())
    try:
        con.execute("UPDATE history SET cost = ? WHERE id = ?", (cost, hid))
        con.commit()
    finally:
        con.close()


def current_month_ms(app, day: int, hour: int = 12):
    return app.page.evaluate(
        """([day, hour]) => {
            const now = new Date();
            return new Date(now.getFullYear(), now.getMonth(), day, hour, 0, 0).getTime();
        }""",
        [day, hour],
    )


def history_rows(app):
    return app.db_query(
        """
        SELECT id, status, created_at
        FROM history
        ORDER BY created_at DESC, rowid DESC
        """
    )


def open_clear_confirm(app, item_test_id: str, expected_kind: str):
    app.page.click('[data-testid="history-clean-trigger"]')
    app.page.click(f'[data-testid="{item_test_id}"]')
    app.page.wait_for_selector('[data-testid="history-clear-confirm-dialog"]', timeout=5_000)
    assert (
        app.page.locator('[data-testid="history-clear-confirm-dialog"]').get_attribute("data-clear-kind")
        == expected_kind
    )
    app.page.click('[data-testid="history-clear-confirm"]')


def lightbox_image_dims(app):
    return app.page.evaluate(
        """async () => {
            const root = document.querySelector('[data-testid="image-lightbox"]');
            if (!root) return null;
            let el = root.querySelector('img');
            for (let i = 0; i < 50 && !el; i += 1) {
                await new Promise((resolve) => setTimeout(resolve, 100));
                el = root.querySelector('img');
            }
            if (!el) return null;
            if (!el.complete) await new Promise((resolve) => {
                el.addEventListener('load', resolve, { once: true });
                el.addEventListener('error', resolve, { once: true });
                setTimeout(resolve, 5000);
            });
            return { src: el.currentSrc || el.src, w: el.naturalWidth, h: el.naturalHeight };
        }"""
    )


def media_picture_dir(app) -> Path:
    path = Path(app.api_ok("system.getPaths")["pictures"])
    path.mkdir(parents=True, exist_ok=True)
    return path


def test_history_detail_file_actions_copy_and_open_path(app):
    provider = app.api_ok("provider.create", {
        "name": "History Files Provider",
        "type": "openai-compatible",
        "baseUrl": "http://127.0.0.1:9/v1",
        "model": "gpt-image-2",
        "isActive": True,
    })
    now = int(time.time() * 1000)
    image_path = str(app.user_data_dir / "history-output.png")
    (app.user_data_dir / "history-output.png").write_bytes(PNG_1PX)
    missing_path = str(app.user_data_dir / "missing-output.png")

    insert_history(
        app,
        hid="hist-success-file",
        provider_id=provider["id"],
        status="success",
        image_path=image_path,
        created_at=now,
    )
    insert_history(
        app,
        hid="hist-success-missing",
        provider_id=provider["id"],
        status="success",
        image_path=missing_path,
        created_at=now - 1,
    )
    insert_history(
        app,
        hid="hist-failed-no-file",
        provider_id=provider["id"],
        code="AUTH",
        message="no image path",
        created_at=now - 2,
    )

    goto_history(app)
    success_row = app.page.locator('[data-testid="history-row"][data-status="succeeded"]').filter(
        has_text="history prompt hist-success-file"
    )
    open_history_detail(app, success_row, "hist-success-file")
    open_detail_actions(app)

    assert not app.page.is_disabled('[data-testid="history-detail-folder"]')
    assert not app.page.is_disabled('[data-testid="history-detail-copy-image"]')

    app.page.click('[data-testid="history-detail-copy-image"]')
    assert "已复制图片" in app.page.inner_text("body")

    open_detail_actions(app)
    app.page.click('[data-testid="history-detail-folder"]')
    app.page.wait_for_function(
        "() => document.body.innerText.includes('已在文件夹中定位图片')",
        timeout=5_000,
    )

    failed_row = app.page.locator('[data-testid="history-row"][data-status="failed"]').filter(
        has_text="history prompt hist-failed-no-file"
    )
    open_history_detail(app, failed_row, "hist-failed-no-file")
    open_detail_actions(app)
    assert app.page.is_disabled('[data-testid="history-detail-folder"]')
    assert app.page.is_disabled('[data-testid="history-detail-copy-image"]')
    app.page.keyboard.press("Escape")

    missing = app.api("system.openInFolder", missing_path)
    assert not missing["ok"], missing
    assert "不存在" in missing["error"] or "移动" in missing["error"], missing


def test_history_delete_with_source_file_and_disk_usage(app):
    provider = app.api_ok("provider.create", {
        "name": "History Delete File Provider",
        "type": "openai-compatible",
        "baseUrl": "http://127.0.0.1:9/v1",
        "model": "gpt-image-2",
        "isActive": True,
    })
    now = int(time.time() * 1000)
    image_dir = media_picture_dir(app)
    baseline = app.api_ok("system.diskUsage")
    keep_file = image_dir / f"history-delete-keep-{now}.png"
    delete_file = image_dir / f"history-delete-source-{now}.png"
    ignored_file = image_dir / f"history-delete-not-image-{now}.txt"
    keep_file.write_bytes(PNG_1PX)
    delete_file.write_bytes(PNG_1PX)
    ignored_file.write_text("not an image", encoding="utf-8")

    missing_file = image_dir / f"history-delete-missing-{now}.png"
    outside_file = app.user_data_dir / f"history-delete-outside-{now}.png"
    outside_file.write_bytes(PNG_1PX)

    insert_history(
        app,
        hid="hist-delete-keep-file",
        provider_id=provider["id"],
        status="success",
        prompt_text="history delete keep source file",
        image_path=str(keep_file),
        created_at=now,
    )
    insert_history(
        app,
        hid="hist-delete-source-file",
        provider_id=provider["id"],
        status="success",
        prompt_text="history delete source file",
        image_path=str(delete_file),
        created_at=now - 1,
    )
    insert_history(
        app,
        hid="hist-delete-missing-file",
        provider_id=provider["id"],
        status="success",
        prompt_text="history delete missing source file",
        image_path=str(missing_file),
        created_at=now - 2,
    )
    insert_history(
        app,
        hid="hist-delete-outside-file",
        provider_id=provider["id"],
        status="success",
        prompt_text="history delete outside source file",
        image_path=str(outside_file),
        created_at=now - 3,
    )

    usage = app.api_ok("system.diskUsage")
    assert usage["dir"] == str(image_dir)
    assert usage["imagesCount"] == baseline["imagesCount"] + 2
    assert usage["imagesBytes"] == baseline["imagesBytes"] + len(PNG_1PX) * 2

    goto_history(app)
    app.page.wait_for_function(
        f"""() => document.querySelector('[data-testid="history-disk-usage"]')?.dataset.imagesCount === '{baseline["imagesCount"] + 2}'
             && document.querySelector('[data-testid="history-disk-usage"]')?.dataset.imagesBytes === '{baseline["imagesBytes"] + len(PNG_1PX) * 2}'""",
        timeout=5_000,
    )

    app.page.locator('[data-testid="history-row"][data-status="succeeded"]').filter(
        has_text="history delete keep source file"
    ).click()
    open_detail_actions(app)
    app.page.click('[data-testid="history-detail-delete"]')
    app.page.click('[data-testid="history-detail-delete-confirm"]')
    app.page.wait_for_function(
        "() => !document.body.innerText.includes('history delete keep source file')",
        timeout=5_000,
    )
    assert keep_file.exists(), "默认删除记录应保留磁盘源文件"
    assert app.db_query("SELECT id FROM history WHERE id = ?", ("hist-delete-keep-file",)) == []

    app.page.locator('[data-testid="history-row"][data-status="succeeded"]').filter(
        has_text="history delete source file"
    ).click()
    open_detail_actions(app)
    app.page.click('[data-testid="history-detail-delete-file"]')
    app.page.wait_for_selector('[data-testid="history-delete-file-dialog"]', timeout=5_000)
    app.page.click('[data-testid="history-delete-file-confirm"]')
    app.page.wait_for_function(
        "() => document.body.innerText.includes('已删除记录和源文件')",
        timeout=5_000,
    )
    assert not delete_file.exists()
    assert app.db_query("SELECT id FROM history WHERE id = ?", ("hist-delete-source-file",)) == []

    usage = app.api_ok("system.diskUsage")
    assert usage["imagesCount"] == baseline["imagesCount"] + 1
    assert usage["imagesBytes"] == baseline["imagesBytes"] + len(PNG_1PX)

    app.page.locator('[data-testid="history-row"][data-status="succeeded"]').filter(
        has_text="history delete missing source file"
    ).click()
    open_detail_actions(app)
    app.page.click('[data-testid="history-detail-delete-file"]')
    app.page.wait_for_selector('[data-testid="history-delete-file-dialog"]', timeout=5_000)
    app.page.click('[data-testid="history-delete-file-confirm"]')
    app.page.wait_for_function(
        "() => document.body.innerText.includes('图片文件已不存在')",
        timeout=5_000,
    )
    assert app.db_query("SELECT id FROM history WHERE id = ?", ("hist-delete-missing-file",)) == []

    app.page.locator('[data-testid="history-row"][data-status="succeeded"]').filter(
        has_text="history delete outside source file"
    ).click()
    open_detail_actions(app)
    app.page.click('[data-testid="history-detail-delete-file"]')
    app.page.wait_for_selector('[data-testid="history-delete-file-dialog"]', timeout=5_000)
    app.page.click('[data-testid="history-delete-file-confirm"]')
    app.page.wait_for_function(
        "() => document.body.innerText.includes('源文件保留')",
        timeout=5_000,
    )
    assert outside_file.exists(), "非 Musefold 管理输出目录内的文件应被保留"
    assert app.db_query("SELECT id FROM history WHERE id = ?", ("hist-delete-outside-file",)) == []


def test_history_stats_aggregates_success_cost_by_time_and_provider(app):
    provider_a = app.api_ok("provider.create", {
        "name": "Stats Provider A",
        "type": "openai-compatible",
        "baseUrl": "http://127.0.0.1:9/v1",
        "model": "gpt-image-2",
        "isActive": True,
    })
    provider_b = app.api_ok("provider.create", {
        "name": "Stats Provider B",
        "type": "openai-compatible",
        "baseUrl": "http://127.0.0.1:9/v1",
        "model": "gpt-image-2",
        "isActive": False,
    })
    jan_15 = app.page.evaluate("() => new Date(2026, 0, 15, 12, 0, 0).getTime()")
    jan_20 = app.page.evaluate("() => new Date(2026, 0, 20, 12, 0, 0).getTime()")
    feb_02 = app.page.evaluate("() => new Date(2026, 1, 2, 12, 0, 0).getTime()")

    insert_history(
        app,
        hid="hist-stats-jan-cost",
        provider_id=provider_a["id"],
        status="success",
        prompt_text="history stats january cost",
        created_at=jan_15,
        params={"usageChannel": "account", "providerNameSnapshot": "Musefold 账号"},
    )
    set_history_cost(app, "hist-stats-jan-cost", 1)
    insert_history(
        app,
        hid="hist-stats-jan-null",
        provider_id=provider_a["id"],
        status="success",
        prompt_text="history stats january null cost",
        created_at=jan_20,
        params={"usageChannel": "account", "providerNameSnapshot": "Musefold 账号"},
    )
    set_history_cost(app, "hist-stats-jan-null", None)
    insert_history(
        app,
        hid="hist-stats-feb-cost",
        provider_id=provider_b["id"],
        status="success",
        prompt_text="history stats february cost",
        created_at=feb_02,
        params={"usageChannel": "provider", "providerNameSnapshot": "Stats Provider B"},
    )
    set_history_cost(app, "hist-stats-feb-cost", 3)
    insert_history(
        app,
        hid="hist-stats-failed-noise",
        provider_id=provider_b["id"],
        status="failed",
        code="SERVER",
        message="not billed",
        prompt_text="history stats failed noise",
        created_at=feb_02 + 1,
        params={"usageChannel": "provider", "providerNameSnapshot": "Stats Provider B"},
    )
    set_history_cost(app, "hist-stats-failed-noise", 999)
    insert_history(
        app,
        hid="hist-stats-cancelled-noise",
        provider_id=provider_a["id"],
        status="cancelled",
        code="CANCELLED",
        message="not billed",
        prompt_text="history stats cancelled noise",
        created_at=feb_02 + 2,
        params={"usageChannel": "account", "providerNameSnapshot": "Musefold 账号"},
    )
    set_history_cost(app, "hist-stats-cancelled-noise", 888)

    stats = app.api_ok("history.stats", {"groupBy": "month"})
    assert stats["totalCost"] == 1
    assert stats["accountPoints"] == 1
    assert stats["totalCount"] == 3
    assert stats["attemptCount"] == 5
    assert stats["failedCount"] == 1
    assert stats["cancelledCount"] == 1
    assert stats["activeDays"] == 3
    assert stats["avgCost"] == 0.5
    assert stats["buckets"] == [
        {
            "key": "2026-01", "cost": 1, "count": 2, "attemptCount": 2,
            "failedCount": 0, "cancelledCount": 0, "unit": "point",
            "channels": [{"channelId": "account", "kind": "account", "name": "Musefold 账号", "count": 2}],
        },
        {
            "key": "2026-02", "cost": 0, "count": 1, "attemptCount": 3,
            "failedCount": 1, "cancelledCount": 1, "unit": "point",
            "channels": [{
                "channelId": f"provider:{provider_b['id']}", "kind": "provider",
                "name": "Stats Provider B", "count": 1,
            }],
        },
    ]
    assert stats["byProvider"] == [
        {"providerId": provider_a["id"], "name": "Musefold 账号", "cost": 1, "count": 2, "unit": "point"},
        {"providerId": provider_b["id"], "name": "Stats Provider B", "cost": 0, "count": 1, "unit": "point"},
    ]
    assert stats["byChannel"] == [
        {
            "channelId": "account", "kind": "account", "name": "Musefold 账号", "providerId": None,
            "attemptCount": 3, "successCount": 2, "failedCount": 0, "cancelledCount": 1,
            "accountPoints": 1,
        },
        {
            "channelId": f"provider:{provider_b['id']}", "kind": "provider", "name": "Stats Provider B",
            "providerId": provider_b["id"], "attemptCount": 2, "successCount": 1,
            "failedCount": 1, "cancelledCount": 0, "accountPoints": None,
        },
    ]
    assert stats["byModel"] == [{"model": "gpt-image-2", "count": 3}]

    filtered = app.api_ok("history.stats", {
        "groupBy": "day",
        "providerId": provider_a["id"],
        "from": jan_20,
        "to": jan_20,
    })
    assert filtered["totalCost"] == 0
    assert filtered["totalCount"] == 1
    assert filtered["avgCost"] == 0
    assert filtered["buckets"] == [{
        "key": "2026-01-20", "cost": 0, "count": 1, "attemptCount": 1,
        "failedCount": 0, "cancelledCount": 0, "unit": "point",
        "channels": [{"channelId": "account", "kind": "account", "name": "Musefold 账号", "count": 1}],
    }]
    assert filtered["byProvider"] == [
        {"providerId": provider_a["id"], "name": "Musefold 账号", "cost": 0, "count": 1, "unit": "point"},
    ]

    empty = app.api_ok("history.stats", {"groupBy": "week", "providerId": "missing-provider"})
    assert empty["totalCost"] == 0
    assert empty["totalCount"] == 0
    assert empty["avgCost"] == 0
    assert empty["attemptCount"] == 0
    assert empty["accountPoints"] == 0
    assert empty["buckets"] == []
    assert empty["byProvider"] == []
    assert empty["byChannel"] == []
    assert empty["byModel"] == []


def test_usage_statistics_summarizes_channels_and_keeps_points_account_only(app):
    provider_a = app.api_ok("provider.create", {
        "name": "Dashboard Provider A",
        "type": "openai-compatible",
        "baseUrl": "http://127.0.0.1:9/v1",
        "model": "gpt-image-2",
        "isActive": True,
    })
    provider_b = app.api_ok("provider.create", {
        "name": "Dashboard Provider B",
        "type": "openai-compatible",
        "baseUrl": "http://127.0.0.1:9/v1",
        "model": "gpt-image-2",
        "isActive": False,
    })
    day_two = current_month_ms(app, 2)
    day_three = current_month_ms(app, 3)

    insert_history(
        app,
        hid="hist-dashboard-a-cost",
        provider_id=provider_a["id"],
        status="success",
        prompt_text="dashboard provider a cost",
        created_at=day_two,
        params={"usageChannel": "account", "providerNameSnapshot": "Musefold 账号"},
    )
    set_history_cost(app, "hist-dashboard-a-cost", 1)
    insert_history(
        app,
        hid="hist-dashboard-a-null",
        provider_id=provider_a["id"],
        status="success",
        prompt_text="dashboard provider a null",
        created_at=day_two + 1,
        params={"usageChannel": "account", "providerNameSnapshot": "Musefold 账号"},
    )
    set_history_cost(app, "hist-dashboard-a-null", None)
    insert_history(
        app,
        hid="hist-dashboard-b-cost",
        provider_id=provider_b["id"],
        status="success",
        prompt_text="dashboard provider b cost",
        created_at=day_three,
        params={"usageChannel": "provider", "providerNameSnapshot": "Dashboard Provider B"},
    )
    set_history_cost(app, "hist-dashboard-b-cost", 3)
    insert_history(
        app,
        hid="hist-dashboard-failed-noise",
        provider_id=provider_b["id"],
        status="failed",
        code="SERVER",
        message="not billed",
        prompt_text="dashboard failed noise",
        created_at=day_three + 1,
        params={"usageChannel": "provider", "providerNameSnapshot": "Dashboard Provider B"},
    )
    set_history_cost(app, "hist-dashboard-failed-noise", 999)

    goto_history(app)
    assert app.page.locator('[data-testid="history-cost-open"]').count() == 0

    app.set_view("settings")
    app.page.evaluate("() => window.__musefold_test.stores.settings.getState().setSection('usage')")
    app.page.wait_for_selector('[data-testid="settings-usage-summary"]')
    app.page.wait_for_function(
        "() => document.querySelector('[data-testid=\"settings-usage-account-points\"]')?.innerText.includes('1 积分')",
        timeout=5_000,
    )

    assert "3 次" in app.page.inner_text('[data-testid="settings-usage-summary"]')
    channels = app.page.locator('[data-testid="settings-usage-channel"]')
    assert channels.count() == 2
    assert channels.nth(0).get_attribute("data-channel-id") == "account"
    assert "Musefold 账号" in channels.nth(0).inner_text()
    assert "1 积分" in channels.nth(0).inner_text()
    assert channels.nth(1).get_attribute("data-channel-id") == f"provider:{provider_b['id']}"
    assert "Dashboard Provider B" in channels.nth(1).inner_text()
    assert "不计积分" in channels.nth(1).inner_text()
    assert app.page.locator('[data-testid="settings-usage-activity"]').is_visible()
    assert app.page.locator('[data-testid="settings-usage-trend"]').is_visible()
    assert app.page.locator('[data-testid="settings-usage-models"]').is_visible()

    app.page.click('[data-testid="settings-usage-range-all"]')
    assert app.page.get_by_test_id("settings-usage-range-all").get_attribute("aria-checked") == "true"
    assert "只展示用量和成功率" in app.page.inner_text('[data-testid="settings-usage-accounting-note"]')


def test_usage_statistics_empty_and_unpriced_provider_states(app):
    app.set_view("settings")
    app.page.evaluate("() => window.__musefold_test.stores.settings.getState().setSection('usage')")
    app.page.wait_for_selector('[data-testid="settings-usage-summary"]', timeout=15_000)
    assert "0 次" in app.page.inner_text('[data-testid="settings-usage-summary"]')
    assert "暂无模型用量数据" in app.page.inner_text('[data-testid="settings-usage-models"]')

    provider = app.api_ok("provider.create", {
        "name": "Dashboard Unpriced Provider",
        "type": "openai-compatible",
        "baseUrl": "http://127.0.0.1:9/v1",
        "model": "gpt-image-2",
        "isActive": True,
    })
    insert_history(
        app,
        hid="hist-dashboard-unpriced",
        provider_id=provider["id"],
        status="success",
        prompt_text="dashboard unpriced cost",
        created_at=current_month_ms(app, 2),
        params={"usageChannel": "provider", "providerNameSnapshot": "Dashboard Unpriced Provider"},
    )
    set_history_cost(app, "hist-dashboard-unpriced", None)
    app.page.click('[data-testid="settings-usage-refresh"]')
    app.page.wait_for_function(
        "() => document.querySelector('[data-testid=\"settings-usage-summary\"]')?.innerText.includes('1 次')",
        timeout=5_000,
    )
    assert "0 积分" in app.page.inner_text('[data-testid="settings-usage-account-points"]')
    assert "不计积分" in app.page.inner_text('[data-testid="settings-usage-channel"]')


def test_history_cleanup_menu_clears_old_noise_and_all_records(app):
    provider = app.api_ok("provider.create", {
        "name": "History Cleanup Provider",
        "type": "openai-compatible",
        "baseUrl": "http://127.0.0.1:9/v1",
        "model": "gpt-image-2",
        "isActive": True,
    })
    now = int(time.time() * 1000)
    old = now - 31 * 24 * 60 * 60 * 1000
    insert_history(
        app,
        hid="hist-clean-old-success",
        provider_id=provider["id"],
        status="success",
        prompt_text="history cleanup old success",
        created_at=old,
    )
    insert_history(
        app,
        hid="hist-clean-new-success",
        provider_id=provider["id"],
        status="success",
        prompt_text="history cleanup new success",
        created_at=now,
    )
    insert_history(
        app,
        hid="hist-clean-failed",
        provider_id=provider["id"],
        status="failed",
        code="RATE_LIMIT",
        message="retry later",
        prompt_text="history cleanup failed",
        created_at=now - 1,
    )
    insert_history(
        app,
        hid="hist-clean-cancelled",
        provider_id=provider["id"],
        status="cancelled",
        code="CANCELLED",
        message="cancelled",
        prompt_text="history cleanup cancelled",
        created_at=now - 2,
    )

    goto_history(app)
    open_clear_confirm(app, "history-clear-older", "older")
    app.page.wait_for_function(
        "() => document.body.innerText.includes('已清理历史')",
        timeout=5_000,
    )
    assert {row["id"] for row in history_rows(app)} == {
        "hist-clean-new-success",
        "hist-clean-failed",
        "hist-clean-cancelled",
    }

    open_clear_confirm(app, "history-clear-failed-cancelled", "failed-cancelled")
    app.page.wait_for_function(
        "() => [...document.querySelectorAll('[data-testid=\"history-row\"]')].length === 1",
        timeout=5_000,
    )
    rows = history_rows(app)
    assert rows == [{"id": "hist-clean-new-success", "status": "success", "created_at": now}]
    assert "history cleanup new success" in app.page.inner_text('[data-testid="history-list"]')
    assert "history cleanup failed" not in app.page.inner_text('[data-testid="history-list"]')

    open_clear_confirm(app, "history-clear-all", "all")
    app.page.wait_for_function(
        "() => document.querySelectorAll('[data-testid=\"history-row\"]').length === 0",
        timeout=5_000,
    )
    assert history_rows(app) == []
    assert app.page.locator('[data-testid="history-empty"]').count() == 1


def test_history_cleanup_no_match_and_failure_keep_list_stable(app):
    provider = app.api_ok("provider.create", {
        "name": "History Cleanup Failure Provider",
        "type": "openai-compatible",
        "baseUrl": "http://127.0.0.1:9/v1",
        "model": "gpt-image-2",
        "isActive": True,
    })
    now = int(time.time() * 1000)
    insert_history(
        app,
        hid="hist-clean-only-success",
        provider_id=provider["id"],
        status="success",
        prompt_text="history cleanup only success",
        created_at=now,
    )

    goto_history(app)
    open_clear_confirm(app, "history-clear-failed-cancelled", "failed-cancelled")
    app.page.wait_for_function(
        "() => document.body.innerText.includes('无可清理')",
        timeout=5_000,
    )
    assert history_rows(app) == [{"id": "hist-clean-only-success", "status": "success", "created_at": now}]
    assert app.page.locator('[data-testid="history-row"]').count() == 1

    set_history_delete_failure(app, True)
    try:
        open_clear_confirm(app, "history-clear-all", "all")
        app.page.wait_for_function(
            "() => document.body.innerText.includes('清理失败') && "
            "document.body.innerText.includes('simulated history clear failure')",
            timeout=5_000,
        )
        assert history_rows(app) == [{"id": "hist-clean-only-success", "status": "success", "created_at": now}]
        assert app.page.locator('[data-testid="history-row"]').count() == 1
    finally:
        set_history_delete_failure(app, False)


def test_history_lightbox_opens_from_detail_and_navigates_image_records(app):
    provider = app.api_ok("provider.create", {
        "name": "History Lightbox Provider",
        "type": "openai-compatible",
        "baseUrl": "http://127.0.0.1:9/v1",
        "model": "gpt-image-2",
        "isActive": True,
    })
    now = int(time.time() * 1000)
    image_dir = media_picture_dir(app)
    image_a = image_dir / "history-lightbox-a.png"
    image_b = image_dir / "history-lightbox-b.png"
    image_a.write_bytes(PNG_1PX)
    image_b.write_bytes(PNG_1PX)
    missing = image_dir / "history-lightbox-missing.png"

    insert_history(
        app,
        hid="hist-lightbox-a",
        provider_id=provider["id"],
        status="success",
        prompt_text="history lightbox first",
        image_path=str(image_a),
        created_at=now,
    )
    insert_history(
        app,
        hid="hist-lightbox-missing",
        provider_id=provider["id"],
        status="success",
        prompt_text="history lightbox missing",
        image_path=str(missing),
        created_at=now - 1,
    )
    insert_history(
        app,
        hid="hist-lightbox-b",
        provider_id=provider["id"],
        status="success",
        prompt_text="history lightbox second",
        image_path=str(image_b),
        created_at=now - 2,
    )
    insert_history(
        app,
        hid="hist-lightbox-failed",
        provider_id=provider["id"],
        status="failed",
        prompt_text="history lightbox failed",
        code="AUTH",
        message="no image",
        created_at=now - 3,
    )

    goto_history(app)
    lightbox_row = app.page.locator('[data-testid="history-row"]').filter(
        has_text="history lightbox first"
    )
    open_history_detail(app, lightbox_row, "hist-lightbox-a")
    app.page.click('[data-testid="history-detail-image"]')
    app.page.wait_for_selector('[data-testid="image-lightbox"]', timeout=5_000)
    dims = lightbox_image_dims(app)
    assert dims and dims["src"].startswith("media://") and dims["w"] == 1 and dims["h"] == 1
    assert app.page.locator('[data-testid="image-lightbox-image"]').get_attribute("data-scale") == "1"
    app.page.click('[data-testid="image-lightbox-zoom-in"]')
    app.page.wait_for_function(
        "() => document.querySelector('[data-testid=\"image-lightbox-image\"]')?.dataset.scale === '1.25'",
        timeout=5_000,
    )
    app.page.keyboard.press("0")
    app.page.wait_for_function(
        "() => document.querySelector('[data-testid=\"image-lightbox-image\"]')?.dataset.scale === '1'",
        timeout=5_000,
    )

    app.page.keyboard.press("ArrowRight")
    app.page.wait_for_selector('[data-testid="image-lightbox"] >> text=图片无法加载', timeout=5_000)
    assert app.page.locator('[data-testid="history-detail"]').get_attribute("data-history-id") == "hist-lightbox-missing"

    app.page.keyboard.press("ArrowRight")
    app.page.wait_for_function(
        "() => document.querySelector('[data-testid=\"history-detail\"]')?.dataset.historyId === 'hist-lightbox-b'",
        timeout=5_000,
    )
    dims = lightbox_image_dims(app)
    assert dims and dims["w"] == 1 and dims["h"] == 1

    app.page.keyboard.press("Escape")
    app.page.wait_for_function("() => !document.querySelector('[data-testid=\"image-lightbox\"]')", timeout=5_000)

    app.page.locator('[data-testid="history-row"]').filter(has_text="history lightbox first").locator(
        '[data-testid="history-thumb-open"]'
    ).click()
    app.page.wait_for_selector('[data-testid="image-lightbox"]', timeout=5_000)
    assert lightbox_image_dims(app)["w"] == 1


def test_history_lightbox_single_image_arrows_are_noop(app):
    provider = app.api_ok("provider.create", {
        "name": "History Lightbox Single Provider",
        "type": "openai-compatible",
        "baseUrl": "http://127.0.0.1:9/v1",
        "model": "gpt-image-2",
        "isActive": True,
    })
    now = int(time.time() * 1000)
    image_path = media_picture_dir(app) / "history-lightbox-single.png"
    image_path.write_bytes(PNG_1PX)
    insert_history(
        app,
        hid="hist-lightbox-single",
        provider_id=provider["id"],
        status="success",
        prompt_text="history lightbox single",
        image_path=str(image_path),
        created_at=now,
    )

    goto_history(app)
    app.page.locator('[data-testid="history-row"]').filter(has_text="history lightbox single").click()
    app.page.click('[data-testid="history-detail-image"]')
    app.page.wait_for_selector('[data-testid="image-lightbox"]', timeout=5_000)

    assert app.page.locator('[data-testid="image-lightbox-prev"]').get_attribute("aria-disabled") == "true"
    assert app.page.locator('[data-testid="image-lightbox-next"]').get_attribute("aria-disabled") == "true"
    app.page.click('[data-testid="image-lightbox-next"]', force=True)
    app.page.keyboard.press("ArrowRight")
    assert app.page.locator('[data-testid="history-detail"]').get_attribute("data-history-id") == "hist-lightbox-single"
    assert app.page.locator('[data-testid="image-lightbox"]').count() == 1


def test_history_save_as_prompt_persists_fields_and_jumps_to_library(app):
    provider = app.api_ok("provider.create", {
        "name": "History Save Provider",
        "type": "openai-compatible",
        "baseUrl": "http://127.0.0.1:9/v1",
        "model": "gpt-image-2",
        "isActive": True,
    })
    now = int(time.time() * 1000)
    source_id = "hist-save-prompt"
    source_url = f"history://{source_id}"
    params = {"schemaVersion": 1, "size": "1024x1024", "quality": "high", "n": 1, "seed": 77}
    prompt_text = "history prompt ABCDEFGHIJKLMNO with params"
    insert_history(
        app,
        hid=source_id,
        provider_id=provider["id"],
        status="success",
        prompt_text=prompt_text,
        negative_text="avoid blur",
        params=params,
        created_at=now,
    )

    goto_history(app)
    row = app.page.locator('[data-testid="history-row"][data-status="succeeded"]').filter(
        has_text=prompt_text
    )
    open_history_detail(app, row, source_id)
    app.page.click('[data-testid="history-detail-save"]')
    app.page.wait_for_selector('[data-testid="history-save-prompt-dialog"]')
    app.page.fill('[data-testid="history-save-title"]', "Saved From History")
    app.page.click('[data-testid="history-save-confirm"]')
    app.page.wait_for_selector('[data-testid="toast-action"]', timeout=5_000)

    rows = prompt_rows_by_source(app, source_url)
    assert len(rows) == 1
    created_id = rows[0]["id"]
    assert rows[0]["title"] == "Saved From History"
    assert rows[0]["content"] == prompt_text
    assert rows[0]["content_negative"] == "avoid blur"
    assert rows[0]["source"] == "import"
    assert rows[0]["source_url"] == source_url
    assert json.loads(rows[0]["params"]) == params
    linked = app.db_query("SELECT prompt_id FROM history WHERE id = ?", (source_id,))
    assert linked == [{"prompt_id": created_id}]

    app.page.click('[data-testid="toast-action"]')
    app.page.wait_for_function("() => window.__musefold_test?.getView?.() === 'library'", timeout=5_000)
    # 新库页：跳转后在列表中选中并闪烁该行，不再自动打开详情
    app.page.wait_for_selector(f'[data-testid="prompt-row"][data-prompt-id="{created_id}"]')

    app.set_view("history")
    row = app.page.locator('[data-testid="history-row"][data-status="succeeded"]').filter(
        has_text=prompt_text
    )
    open_history_detail(app, row, source_id)
    app.page.click('[data-testid="history-detail-save"]')
    app.page.wait_for_selector('[data-testid="history-save-prompt-dialog"]')
    app.page.fill('[data-testid="history-save-title"]', "")
    app.page.click('[data-testid="history-save-confirm"]')
    app.page.wait_for_function(
        "() => document.body.innerText.includes('已存为提示词')",
        timeout=5_000,
    )

    rows = prompt_rows_by_source(app, source_url)
    assert len(rows) == 2
    assert rows[1]["title"] == "history prompt ABCDE"
    assert rows[1]["content"] == prompt_text


def test_history_again_make_prefills_produce_without_submitting(app, image_server):
    base_url, requests = image_server
    provider = app.api_ok("provider.create", {
        "name": "History Regenerate Provider",
        "type": "openai-compatible",
        "baseUrl": base_url,
        "model": "gpt-image-2",
        "isActive": True,
    })
    app.api_ok("provider.saveKey", provider["id"], "sk-history-regenerate-1234")
    now = int(time.time() * 1000)
    hid = "hist-regenerate-source"
    prompt_text = "history regenerate exact snapshot prompt"
    params = {
        "schemaVersion": 1,
        "size": "1536x1024",
        "aspectRatio": "16:9",
        "quality": "high",
        "n": 1,
        "background": "transparent",
        "moderation": "low",
    }
    insert_history(
        app,
        hid=hid,
        provider_id=provider["id"],
        status="success",
        prompt_text=prompt_text,
        negative_text="avoid blur",
        params=params,
        created_at=now,
    )

    goto_history(app)
    app.page.locator('[data-testid="history-row"][data-status="succeeded"]').filter(
        has_text=prompt_text
    ).click()
    app.page.click('[data-testid="history-detail-regen"]')
    app.page.wait_for_function("() => window.__musefold_test?.getView?.() === 'generate'", timeout=5_000)
    app.page.wait_for_selector('[data-testid="refine-prompt"]', timeout=15_000)
    assert app.page.input_value('[data-testid="refine-prompt"]') == prompt_text
    assert "已载入制作工作台" in app.page.inner_text("body")
    assert requests == []
    rows = app.db_query("SELECT id FROM history WHERE prompt_text = ?", (prompt_text,))
    assert rows == [{"id": hid}]


def test_history_reedit_prefills_generate_refine_params(app):
    lineage_prompt = app.api_ok("prompt.create", {
        "title": "History lineage prompt",
        "content": "history failed prompt to reedit in refine",
    })
    provider = app.api_ok("provider.create", {
        "name": "History Reedit Provider",
        "type": "openai-compatible",
        "baseUrl": "http://127.0.0.1:9/v1",
        "model": "gpt-image-2",
        "isActive": True,
    })
    app.api_ok("provider.saveKey", provider["id"], "sk-history-reedit-1234")
    now = int(time.time() * 1000)
    hid = "hist-reedit-prefill"
    prompt_text = "history failed prompt to reedit in refine"
    negative_text = "history reedit negative text"
    params = {
        "schemaVersion": 1,
        "size": "1536x1024",
        "aspectRatio": "16:9",
        "quality": "high",
        "n": 6,
        "background": "opaque",
        "moderation": "low",
    }
    insert_history(
        app,
        hid=hid,
        provider_id=provider["id"],
        status="failed",
        code="CONTENT_POLICY",
        message="policy text can be adjusted",
        prompt_text=prompt_text,
        negative_text=negative_text,
        params=params,
        created_at=now,
        prompt_id=lineage_prompt["id"],
    )

    goto_history(app)
    app.page.locator('[data-testid="history-row"][data-status="failed"]').filter(
        has_text=prompt_text
    ).click()
    app.page.click('[data-testid="history-detail-regen"]')
    app.page.wait_for_function("() => window.__musefold_test?.getView?.() === 'generate'", timeout=5_000)
    app.page.wait_for_selector('[data-testid="refine-prompt"]', timeout=15_000)

    state = app.page.evaluate(
        """() => {
          const s = window.__musefold_test.stores.workbench.getState();
          const g = window.__musefold_test.stores.generation.getState();
          return {
            activeProviderId: g.activeProviderId,
            prompt: s.draftPrompt,
            negative: s.draftNegativePrompt,
            source: s.draftSource,
            params: s.params,
          };
        }"""
    )
    assert state["activeProviderId"] == provider["id"]
    assert state["prompt"] == prompt_text
    assert state["negative"] == negative_text
    assert state["source"]["kind"] == "history"
    assert state["source"]["id"] == hid
    assert state["source"]["promptId"] == lineage_prompt["id"]
    assert state["params"]["ratioId"] == "16:9"
    assert state["params"]["quality"] == "high"
    assert state["params"]["n"] == 6
    assert state["params"]["background"] == "opaque"
    assert state["params"]["moderation"] == "low"
    assert app.page.input_value('[data-testid="refine-prompt"]') == prompt_text
    assert app.page.locator('[data-testid="refine-ratio-trigger"]').get_attribute("data-value") == "16:9"
    app.page.click('[data-testid="workbench-more-settings"]')
    app.page.wait_for_selector('[data-testid="workbench-generation-options"]')
    assert app.page.locator('[data-testid="refine-quality-high"]').get_attribute("data-active") == "true"
    assert app.page.locator('[data-testid="refine-count-6"]').get_attribute("data-active") == "true"
    assert "已载入制作工作台" in app.page.inner_text("body")

    row = app.db_query(
        "SELECT prompt_text, negative_text, params FROM history WHERE id = ?",
        (hid,),
    )
    assert row == [{"prompt_text": prompt_text, "negative_text": negative_text, "params": json.dumps(params)}]

def test_history_reedit_with_deleted_provider_guides_to_reselect(app):
    now = int(time.time() * 1000)
    hid = "hist-reedit-missing-provider"
    prompt_text = "history reedit missing provider prompt"
    params = {"schemaVersion": 1, "size": "1024x1024", "quality": "medium", "n": 1}
    insert_history(
        app,
        hid=hid,
        provider_id="deleted-provider-id",
        status="failed",
        code="NO_PROVIDER",
        message="provider was deleted",
        prompt_text=prompt_text,
        params=params,
        created_at=now,
    )

    goto_history(app)
    app.page.locator('[data-testid="history-row"][data-status="failed"]').filter(
        has_text=prompt_text
    ).click()
    app.page.click('[data-testid="history-detail-regen"]')
    app.page.wait_for_function("() => window.__musefold_test?.getView?.() === 'generate'", timeout=5_000)
    # 工作台（Codex 化后）不再整屏空态挡路：composer 始终可用，缺服务商靠 toast 引导
    app.page.wait_for_selector('[data-testid="refine-prompt"]', timeout=15_000)

    state = app.page.evaluate(
        """() => {
          const s = window.__musefold_test.stores.workbench.getState();
          const g = window.__musefold_test.stores.generation.getState();
          return { prompt: s.draftPrompt, params: s.params, providers: g.providers.length };
        }"""
    )
    assert state["providers"] == 0
    assert state["prompt"] == prompt_text
    assert state["params"]["ratioId"] == "1:1"
    assert "原服务商不可用" in app.page.inner_text("body")


def test_history_save_as_prompt_ipc_failure_shows_error(app):
    provider = app.api_ok("provider.create", {
        "name": "History Save Failure Provider",
        "type": "openai-compatible",
        "baseUrl": "http://127.0.0.1:9/v1",
        "model": "gpt-image-2",
        "isActive": True,
    })
    now = int(time.time() * 1000)
    prompt_text = "history prompt save failure"
    insert_history(
        app,
        hid="hist-save-failure",
        provider_id=provider["id"],
        status="success",
        prompt_text=prompt_text,
        created_at=now,
    )
    set_prompt_create_failure(app, True)

    try:
        goto_history(app)
        app.page.locator('[data-testid="history-row"][data-status="succeeded"]').filter(
            has_text=prompt_text
        ).click()
        app.page.click('[data-testid="history-detail-save"]')
        app.page.wait_for_selector('[data-testid="history-save-prompt-dialog"]')
        app.page.click('[data-testid="history-save-confirm"]')
        app.page.wait_for_function(
            "() => document.body.innerText.includes('存为提示词失败') && "
            "document.body.innerText.includes('simulated create failure')",
            timeout=5_000,
        )
        assert "已存为提示词" not in app.page.inner_text("body")
        assert prompt_rows_by_source(app, "history://hist-save-failure") == []
    finally:
        set_prompt_create_failure(app, False)


def test_history_failed_rows_show_guidance_and_retry_state(app):
    provider = app.api_ok("provider.create", {
        "name": "History UX Provider",
        "type": "openai-compatible",
        "baseUrl": "http://127.0.0.1:9/v1",
        "model": "gpt-image-2",
        "isActive": True,
    })
    app.api_ok("provider.saveKey", provider["id"], "sk-history-e2e-1234")
    now = int(time.time() * 1000)
    insert_history(
        app,
        hid="hist-rate-limit",
        provider_id=provider["id"],
        code="RATE_LIMIT",
        message="raw 429 upstream detail",
        created_at=now,
    )
    insert_history(
        app,
        hid="hist-auth",
        provider_id=provider["id"],
        code="AUTH",
        message="raw 401 upstream detail",
        created_at=now - 1,
    )

    # 真实走不可达的本机地址：统一网络重试至少等待 1 秒，足够观察列表和详情的共享进度态。
    goto_history(app)

    rate_row = app.page.locator('[data-testid="history-row"][data-status="failed"]').filter(
        has_text="history prompt hist-rate-limit"
    )
    auth_row = app.page.locator('[data-testid="history-row"][data-status="failed"]').filter(
        has_text="history prompt hist-auth"
    )

    assert "请求过于频繁" in rate_row.inner_text(), rate_row.inner_text()
    assert rate_row.locator('[data-testid="history-retry"]').count() == 1
    assert "API Key 无效" in auth_row.inner_text(), auth_row.inner_text()
    assert auth_row.locator('[data-testid="history-retry"]').count() == 0

    open_history_detail(app, auth_row, "hist-auth")
    app.page.wait_for_selector('[data-testid="history-detail-error-action"]')
    detail_text = app.page.inner_text('[data-testid="history-detail"]')
    assert "更新密钥" in detail_text
    assert app.page.locator('[data-testid="history-detail-retry"]').count() == 0

    open_history_detail(app, rate_row, "hist-rate-limit")
    app.page.wait_for_selector('[data-testid="history-detail-retry"]')
    app.page.locator('[data-testid="history-detail-retry"]').click()
    app.page.wait_for_selector('[data-testid="history-retrying"]', timeout=5_000)
    assert "重试中" in rate_row.inner_text()
    assert "重试中" in app.page.inner_text('[data-testid="history-detail"]')
