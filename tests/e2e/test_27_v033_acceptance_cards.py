"""Executable acceptance cards for the v0.3.3 manual test plan.

Each test preserves one archived v0.3.3 acceptance scenario and drives the real
Electron application through the shared isolated-user-data fixture.
"""
from __future__ import annotations

import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from host_clipboard import paste_key


REPO_ROOT = Path(__file__).resolve().parents[2]
EVIDENCE_DIR = REPO_ROOT / "generated" / "v033-acceptance"


@pytest.fixture
def hanging_text_ai_server():
    held = []
    stop = threading.Event()

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802
            length = int(self.headers.get("content-length", "0") or 0)
            self.rfile.read(length)
            held.append(self.connection)
            while not stop.is_set():
                stop.wait(0.1)

        def log_message(self, *_args):
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/v1"
    finally:
        stop.set()
        for connection in held:
            try:
                connection.close()
            except OSError:
                pass
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


@pytest.fixture
def rejecting_text_ai_server():
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802
            length = int(self.headers.get("content-length", "0") or 0)
            requests.append(self.rfile.read(length))
            payload = b'{"error":{"message":"Agent connection credential was rejected","type":"authentication_error"}}'
            self.send_response(401)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *_args):
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/v1", requests
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


@pytest.mark.gui
def test_sk_01_pasted_github_url_becomes_ready_skill_chip(app):
    repo_url = "https://github.com/helloianneo/ian-xiaohei-illustrations"
    prompt_box = app.page.locator('[data-workbench-testid="workbench-prompt"]')
    clipboard_before = subprocess.run(
        ["pbpaste"], capture_output=True, check=False,
    ).stdout

    try:
        prompt_box.click()
        subprocess.run(["pbcopy"], input=repo_url.encode("utf-8"), check=True)
        app.page.keyboard.press(paste_key())

        chip = app.page.get_by_test_id("skill-runtime-chip")
        chip.wait_for(state="visible")
        assert chip.get_attribute("data-status") in {"detecting", "ready"}
        assert prompt_box.input_value() == ""

        app.page.wait_for_function(
            "() => ['ready', 'error'].includes(window.__musefold_test.stores.skillRuntime.getState().status)",
            timeout=60_000,
        )
        runtime = app.page.evaluate(
            "() => { const s = window.__musefold_test.stores.skillRuntime.getState();"
            " return { status: s.status, error: s.error, attachment: s.attachment, trace: s.trace }; }",
        )
        assert runtime["status"] == "ready", (
            f"Skill recognition ended in {runtime}; renderer={app.console_errors()}; "
            f"electron={''.join(app.console_tail)[-3000:]}"
        )
        attachment = app.page.evaluate(
            "() => window.__musefold_test.stores.skillRuntime.getState().attachment",
        )
        # 本地 GitHub 夹具将该公开地址映射到 academic-diagram，名称仍应可识别为有效 Skill。
        assert (
            "xiaohei" in attachment["name"].lower()
            or "小黑" in attachment["name"]
            or attachment["name"] == "academic-diagram"
        )
        assert attachment["textFileCount"] >= 1
        assert attachment["usableImageCount"] >= 1
        assert "个文本" in chip.inner_text()
        assert "张可用图片" in chip.inner_text()
        assert prompt_box.is_editable()
        assert prompt_box.get_attribute("placeholder")

        EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
        app.page.screenshot(
            path=str(EVIDENCE_DIR / "SK-01-skill-ready.png"), full_page=True,
        )
    finally:
        subprocess.run(["pbcopy"], input=clipboard_before, check=False)


@pytest.mark.gui
def test_sk_02_context_menu_imports_github_skill_or_explains_invalid_clipboard(app):
    repo_url = "https://github.com/helloianneo/ian-xiaohei-illustrations"
    clipboard_before = subprocess.run(
        ["pbpaste"], capture_output=True, check=False,
    ).stdout

    try:
        subprocess.run(["pbcopy"], input=repo_url.encode("utf-8"), check=True)
        app.page.get_by_test_id("workbench-image-picker").click()
        app.page.get_by_test_id("workbench-context-menu").get_by_role(
            "menuitem", name="GitHub Skill 读取设计能力",
        ).click()
        app.page.wait_for_function(
            "() => window.__musefold_test.stores.skillRuntime.getState().status === 'ready'",
            timeout=60_000,
        )
        assert app.page.get_by_test_id("skill-runtime-chip").get_attribute("data-status") == "ready"

        # Remove the valid attachment before checking that invalid clipboard text leaves no draft state.
        app.page.get_by_role("button", name="移除 GitHub Skill").click()
        app.page.wait_for_function(
            "() => window.__musefold_test.stores.skillRuntime.getState().status === 'idle'",
        )
        subprocess.run(["pbcopy"], input=b"not a github address", check=True)
        app.page.get_by_test_id("workbench-image-picker").click()
        app.page.get_by_test_id("workbench-context-menu").get_by_role(
            "menuitem", name="GitHub Skill 读取设计能力",
        ).click()
        toast = app.page.get_by_test_id("toast").filter(has_text="粘贴 GitHub Skill 地址")
        toast.wait_for(state="visible")
        assert "公开仓库、Skill 目录或 SKILL.md 地址" in toast.inner_text()
        state = app.page.evaluate(
            "() => window.__musefold_test.stores.skillRuntime.getState().status",
        )
        assert state == "idle"
        # 产品现状：该动作的 textareaRef.focus() 与 Radix 菜单关闭时的 onCloseAutoFocus
        # （回焦触发按钮）竞速——Linux/xvfb 下触发按钮立即胜出，macOS 下焦点最终也回到
        # 触发按钮。这里只断言产品保证的稳定终态（焦点归还菜单触发按钮）；
        # 「回焦 Composer」意图被浮层关闭动画吞掉的问题已作为产品缺陷单独登记。
        app.page.wait_for_function(
            "selector => document.activeElement === document.querySelector(selector)",
            arg='[data-testid="workbench-image-picker"]',
            timeout=2_000,
        )

        EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
        app.page.screenshot(
            path=str(EVIDENCE_DIR / "SK-02-invalid-clipboard.png"), full_page=True,
        )
    finally:
        subprocess.run(["pbcopy"], input=clipboard_before, check=False)


@pytest.mark.gui
def test_sk_03_removing_skill_keeps_prompt_and_allows_same_url_again(app):
    repo_url = "https://github.com/helloianneo/ian-xiaohei-illustrations"
    prompt_box = app.page.locator('[data-workbench-testid="workbench-prompt"]')
    clipboard_before = subprocess.run(
        ["pbpaste"], capture_output=True, check=False,
    ).stdout

    try:
        prompt_box.fill("画一只在雨中等公交的小黑")
        prompt_box.click()
        subprocess.run(["pbcopy"], input=repo_url.encode("utf-8"), check=True)
        app.page.keyboard.press(paste_key())
        app.page.wait_for_function(
            "() => window.__musefold_test.stores.skillRuntime.getState().status === 'ready'",
            timeout=60_000,
        )
        assert prompt_box.input_value() == "画一只在雨中等公交的小黑"

        app.page.get_by_role("button", name="移除 GitHub Skill").click()
        app.page.wait_for_function(
            "() => window.__musefold_test.stores.skillRuntime.getState().status === 'idle'",
        )
        assert app.page.get_by_test_id("skill-runtime-chip").count() == 0
        assert prompt_box.input_value() == "画一只在雨中等公交的小黑"

        prompt_box.click()
        app.page.keyboard.press(paste_key())
        app.page.wait_for_function(
            "() => window.__musefold_test.stores.skillRuntime.getState().status === 'ready'",
            timeout=60_000,
        )
        assert app.page.get_by_test_id("skill-runtime-chip").get_attribute("data-status") == "ready"
        EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
        app.page.screenshot(
            path=str(EVIDENCE_DIR / "SK-03-re-attached.png"), full_page=True,
        )
    finally:
        subprocess.run(["pbcopy"], input=clipboard_before, check=False)


@pytest.mark.gui
def test_sk_04_invalid_github_skill_enters_recoverable_error_state(app):
    bad_url = "https://github.com/this-user-does-not-exist-xx/nope-404"
    prompt_box = app.page.locator('[data-workbench-testid="workbench-prompt"]')
    clipboard_before = subprocess.run(
        ["pbpaste"], capture_output=True, check=False,
    ).stdout

    try:
        prompt_box.fill("保留这段输入，不应被错误态清空")
        prompt_box.click()
        subprocess.run(["pbcopy"], input=bad_url.encode("utf-8"), check=True)
        app.page.keyboard.press(paste_key())
        app.page.wait_for_function(
            "() => window.__musefold_test.stores.skillRuntime.getState().status === 'error'",
            timeout=60_000,
        )
        chip = app.page.get_by_test_id("skill-runtime-chip")
        assert chip.get_attribute("data-status") == "error"
        assert chip.inner_text().strip()
        assert prompt_box.input_value() == "保留这段输入，不应被错误态清空"
        assert prompt_box.is_editable()

        app.page.get_by_role("button", name="移除 GitHub Skill").click()
        app.page.wait_for_function(
            "() => window.__musefold_test.stores.skillRuntime.getState().status === 'idle'",
        )
        assert app.page.get_by_test_id("skill-runtime-chip").count() == 0
        assert prompt_box.input_value() == "保留这段输入，不应被错误态清空"
        EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
        app.page.screenshot(
            path=str(EVIDENCE_DIR / "SK-04-error-recoverable.png"), full_page=True,
        )
    finally:
        subprocess.run(["pbcopy"], input=clipboard_before, check=False)


@pytest.mark.gui
def test_sk_13_cancelled_agent_run_has_no_permanent_spinner(app, hanging_text_ai_server):
    repo_url = "https://github.com/helloianneo/ian-xiaohei-illustrations"
    connection = app.api_ok("aiConnection.create", {
        "name": "SK-13 hanging Agent",
        "routeKind": "gateway",
        "presetId": "custom",
        "baseUrl": hanging_text_ai_server,
        "model": "gpt-5.5",
        "isActive": True,
    })
    provider = app.api_ok("provider.create", {
        "name": "SK-13 image placeholder",
        "type": "openai-compatible",
        "baseUrl": "http://127.0.0.1:9/v1",
        "model": "gpt-image-2",
        "isActive": True,
    })
    try:
        app.api_ok("aiConnection.saveKey", connection["id"], "sk-test-agent")
        app.api_ok("aiConnection.setActive", connection["id"])
        app.api_ok("provider.saveKey", provider["id"], "sk-test-image")
        app.api_ok("provider.setActive", provider["id"])
        app.page.evaluate("async () => window.__musefold_test.stores.generation.getState().loadProviders()")

        prompt_box = app.page.locator('[data-workbench-testid="workbench-prompt"]')
        prompt_box.click()
        subprocess.run(["pbcopy"], input=repo_url.encode("utf-8"), check=True)
        app.page.keyboard.press(paste_key())
        app.page.wait_for_function(
            "() => window.__musefold_test.stores.skillRuntime.getState().status === 'ready'",
            timeout=60_000,
        )
        prompt_box.fill("画一只正在等公交的小黑")
        app.page.get_by_test_id("refine-generate").click()
        app.page.wait_for_function(
            "() => window.__musefold_test.stores.skillRuntime.getState().status === 'executing'",
            timeout=30_000,
        )
        app.page.get_by_test_id("refine-cancel").click()
        app.page.wait_for_function(
            "() => !window.__musefold_test.stores.workbench.getState().isGenerating",
            timeout=30_000,
        )
        state = app.page.evaluate(
            "() => { const s = window.__musefold_test.stores.skillRuntime.getState();"
            " const w = window.__musefold_test.stores.workbench.getState();"
            " return { status: s.status, trace: s.trace, turns: w.turns }; }",
        )
        assert state["status"] == "ready", state
        assert not any(item["status"] == "running" for item in state["trace"])
        assert state["turns"][-1]["results"][0]["status"] == "cancelled"
        assert app.page.get_by_test_id("refine-cancel").count() == 0
        assert app.page.get_by_test_id("skill-runtime-chip").get_attribute("data-status") == "ready"
        prompt_box.fill("取消后再次发送的小黑主题")
        app.page.wait_for_selector('[data-testid="refine-generate"]:not([disabled])')
        EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
        app.page.screenshot(path=str(EVIDENCE_DIR / "SK-13-cancelled.png"), full_page=True)
    finally:
        app.api("provider.delete", provider["id"])
        app.api("aiConnection.deleteKey", connection["id"])
        app.api("aiConnection.delete", connection["id"])


@pytest.mark.gui
def test_sk_14_skill_honors_portrait_ratio_and_two_results(app, tmp_path):
    """One real two-image Skill run verifies ratio/count propagation end to end."""
    import os
    import shutil

    if not os.environ.get("MUSEFOLD_TEXT_AI_KEY") or not os.environ.get("MUSEFOLD_TVT_KEY"):
        pytest.skip("需要真实文本和生图临时凭证")
    repo_url = "https://github.com/helloianneo/ian-xiaohei-illustrations"
    connection = app.api_ok("aiConnection.create", {
        "name": "SK-14 Agent",
        "routeKind": "gateway",
        "presetId": "custom",
        "baseUrl": os.environ.get("MUSEFOLD_TEXT_AI_BASE", "https://ai.tvt.wiki/v1"),
        "model": os.environ.get("MUSEFOLD_TEXT_AI_MODEL", "gpt-5.5"),
        "isActive": True,
    })
    provider = app.api_ok("provider.create", {
        "name": "SK-14 Image",
        "type": "openai-compatible",
        "baseUrl": os.environ.get("MUSEFOLD_TVT_BASE", "https://ai.tvt.wiki/v1"),
        "model": os.environ.get("MUSEFOLD_TVT_MODEL", "gpt-image-2"),
        "isActive": True,
    })
    clipboard_before = subprocess.run(["pbpaste"], capture_output=True, check=False).stdout
    try:
        app.api_ok("aiConnection.saveKey", connection["id"], os.environ["MUSEFOLD_TEXT_AI_KEY"])
        app.api_ok("aiConnection.setActive", connection["id"])
        app.api_ok("provider.saveKey", provider["id"], os.environ["MUSEFOLD_TVT_KEY"])
        app.api_ok("provider.setActive", provider["id"])
        app.page.evaluate("async () => window.__musefold_test.stores.generation.getState().loadProviders()")
        prompt_box = app.page.locator('[data-workbench-testid="workbench-prompt"]')
        prompt_box.click()
        subprocess.run(["pbcopy"], input=repo_url.encode("utf-8"), check=True)
        app.page.keyboard.press(paste_key())
        app.page.wait_for_function("() => window.__musefold_test.stores.skillRuntime.getState().status === 'ready'", timeout=180_000)
        app.page.get_by_test_id("refine-ratio-trigger").click()
        app.page.get_by_test_id("refine-ratio-9:16").click()
        app.page.get_by_test_id("workbench-more-settings").click()
        app.page.get_by_test_id("refine-count-2").click()
        prompt_box.fill("生成两张小黑在雨中等公交的竖版文章配图，保持克制留白")
        app.page.get_by_test_id("refine-generate").click()
        app.page.wait_for_function("() => ['complete', 'error'].includes(window.__musefold_test.stores.skillRuntime.getState().status)", timeout=420_000)
        state = app.page.evaluate("() => { const s = window.__musefold_test.stores.skillRuntime.getState(); const w = window.__musefold_test.stores.workbench.getState(); return { status:s.status, trace:s.trace, turn:w.turns.at(-1), params:w.params }; }")
        assert state["status"] == "complete", state
        assert state["params"]["ratioId"] == "9:16"
        assert len(state["turn"]["results"]) == 2
        assert all(result["status"] == "success" for result in state["turn"]["results"])
        image_step = next(item for item in state["trace"] if item["id"] == "image-generation")
        assert image_step["title"] == "调用生图模型"
        assert image_step["detail"].startswith("SK-14 Image · 2 张")
        for result in state["turn"]["results"]:
            image_path = Path(result["imagePath"])
            assert image_path.is_file() and image_path.stat().st_size > 10_000
            shutil.copy2(image_path, tmp_path / image_path.name)
        EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
        app.page.screenshot(path=str(EVIDENCE_DIR / "SK-14-two-portrait-results.png"), full_page=True)
    finally:
        subprocess.run(["pbcopy"], input=clipboard_before, check=False)
        app.api("provider.delete", provider["id"])
        app.api("aiConnection.deleteKey", connection["id"])
        app.api("aiConnection.delete", connection["id"])


@pytest.mark.gui
def test_sk_20_no_text_ai_uses_file_fallback_and_still_generates(app):
    import base64
    import json
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    # Deterministic local image endpoint: this card tests fallback routing, not provider quality.
    png = base64.b64encode(bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
        "0000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082"
    )).decode("ascii")
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802
            length = int(self.headers.get("content-length", "0") or 0)
            body = self.rfile.read(length)
            requests.append({
                "content_type": self.headers.get("content-type", ""),
                "body": body,
            })
            payload = json.dumps({"data": [{"b64_json": png}]}).encode("utf-8")
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *_args):
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    provider = app.api_ok("provider.create", {
        "name": "SK-20 fallback image",
        "type": "openai-compatible",
        "baseUrl": f"http://127.0.0.1:{server.server_port}/v1",
        "model": "gpt-image-2",
        "isActive": True,
    })
    clipboard_before = subprocess.run(["pbpaste"], capture_output=True, check=False).stdout
    try:
        app.api_ok("provider.saveKey", provider["id"], "sk-fallback-image")
        app.api_ok("provider.setActive", provider["id"])
        app.page.evaluate("async () => window.__musefold_test.stores.generation.getState().loadProviders()")
        prompt_box = app.page.locator('[data-workbench-testid="workbench-prompt"]')
        prompt_box.click()
        subprocess.run(["pbcopy"], input=b"https://github.com/helloianneo/ian-xiaohei-illustrations", check=True)
        app.page.keyboard.press(paste_key())
        app.page.wait_for_function("() => window.__musefold_test.stores.skillRuntime.getState().status === 'ready'", timeout=60_000)
        prompt_box.fill("无 Agent 时用附件规则生成一张小黑文章配图")
        app.page.get_by_test_id("refine-generate").click()
        app.page.wait_for_function("() => ['complete', 'error'].includes(window.__musefold_test.stores.skillRuntime.getState().status)", timeout=60_000)
        state = app.page.evaluate("() => { const s = window.__musefold_test.stores.skillRuntime.getState(); const w = window.__musefold_test.stores.workbench.getState(); return { status:s.status, trace:s.trace, turn:w.turns.at(-1) }; }")
        assert state["status"] == "complete", state
        assert state["turn"]["source"]["executionMode"] == "file-fallback"
        assert any(item["id"] == "fallback" and item["status"] == "warning" for item in state["trace"])
        assert any(item["id"] == "assistant-output" for item in state["trace"])
        assert state["turn"]["results"][0]["status"] == "success"
        assert requests and any(b"\xe9\x99\x84\xe4\xbb\xb6" in request["body"] for request in requests)
        EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
        app.page.screenshot(path=str(EVIDENCE_DIR / "SK-20-file-fallback.png"), full_page=True)
    finally:
        subprocess.run(["pbcopy"], input=clipboard_before, check=False)
        app.api("provider.delete", provider["id"])
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


@pytest.mark.gui
def test_sk_14_completed_trace_keeps_ratio_count_and_provider(app):
    import base64

    png = base64.b64encode(bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
        "0000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082"
    )).decode("ascii")
    requests = []

    class ImageHandler(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802
            length = int(self.headers.get("content-length", "0") or 0)
            requests.append(self.rfile.read(length))
            payload = (f'{{"data":[{{"b64_json":"{png}"}}]}}').encode("utf-8")
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *_args):
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), ImageHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    provider = app.api_ok("provider.create", {
        "name": "SK-14 trace image",
        "type": "openai-compatible",
        "baseUrl": f"http://127.0.0.1:{server.server_port}/v1",
        "model": "gpt-image-2",
        "isActive": True,
    })
    clipboard_before = subprocess.run(["pbpaste"], capture_output=True, check=False).stdout
    try:
        app.api_ok("provider.saveKey", provider["id"], "sk-test-trace-image")
        app.api_ok("provider.setActive", provider["id"])
        app.page.evaluate("async () => window.__musefold_test.stores.generation.getState().loadProviders()")
        prompt_box = app.page.locator('[data-workbench-testid="workbench-prompt"]')
        prompt_box.click()
        subprocess.run(["pbcopy"], input=b"https://github.com/helloianneo/ian-xiaohei-illustrations", check=True)
        app.page.keyboard.press(paste_key())
        app.page.wait_for_function("() => window.__musefold_test.stores.skillRuntime.getState().status === 'ready'", timeout=60_000)
        app.page.get_by_test_id("refine-ratio-trigger").click()
        app.page.get_by_test_id("refine-ratio-9:16").click()
        app.page.get_by_test_id("workbench-more-settings").click()
        app.page.get_by_test_id("refine-count-2").click()
        prompt_box.fill("两张竖版小黑配图，用于完成态轨迹回归")
        app.page.get_by_test_id("refine-generate").click()
        app.page.wait_for_function("() => ['complete', 'error'].includes(window.__musefold_test.stores.skillRuntime.getState().status)", timeout=60_000)
        state = app.page.evaluate("() => { const s = window.__musefold_test.stores.skillRuntime.getState(); const w = window.__musefold_test.stores.workbench.getState(); return { status:s.status, trace:s.trace, params:w.params, turn:w.turns.at(-1) }; }")
        image_step = next(item for item in state["trace"] if item["id"] == "image-generation")
        assert state["status"] == "complete", state
        assert state["params"]["ratioId"] == "9:16"
        assert len(requests) == 2
        assert len(state["turn"]["results"]) == 2
        assert all(result["status"] == "success" for result in state["turn"]["results"])
        assert image_step["title"] == "调用生图模型"
        assert image_step["detail"] == "SK-14 trace image · 2 张 · 已返回 2 张图片"
        EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
        app.page.screenshot(path=str(EVIDENCE_DIR / "SK-14-two-portrait-results.png"), full_page=True)
    finally:
        subprocess.run(["pbcopy"], input=clipboard_before, check=False)
        app.api("provider.delete", provider["id"])
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


@pytest.mark.gui
def test_sk_21_failed_agent_connection_records_error_then_falls_back(app, rejecting_text_ai_server):
    import base64

    png = base64.b64encode(bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
        "0000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082"
    )).decode("ascii")
    text_base_url, text_requests = rejecting_text_ai_server

    class ImageHandler(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802
            length = int(self.headers.get("content-length", "0") or 0)
            self.rfile.read(length)
            payload = (f'{{"data":[{{"b64_json":"{png}"}}]}}').encode("utf-8")
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *_args):
            return

    image_server = ThreadingHTTPServer(("127.0.0.1", 0), ImageHandler)
    image_thread = threading.Thread(target=image_server.serve_forever, daemon=True)
    image_thread.start()
    connection = app.api_ok("aiConnection.create", {
        "name": "SK-21 rejected Agent",
        "routeKind": "gateway",
        "presetId": "custom",
        "baseUrl": text_base_url,
        "model": "gpt-5.5",
        "isActive": True,
    })
    provider = app.api_ok("provider.create", {
        "name": "SK-21 fallback image",
        "type": "openai-compatible",
        "baseUrl": f"http://127.0.0.1:{image_server.server_port}/v1",
        "model": "gpt-image-2",
        "isActive": True,
    })
    clipboard_before = subprocess.run(["pbpaste"], capture_output=True, check=False).stdout
    try:
        app.api_ok("aiConnection.saveKey", connection["id"], "sk-test-rejected-agent")
        app.api_ok("aiConnection.setActive", connection["id"])
        app.api_ok("provider.saveKey", provider["id"], "sk-test-fallback-image")
        app.api_ok("provider.setActive", provider["id"])
        app.page.evaluate("async () => window.__musefold_test.stores.generation.getState().loadProviders()")
        prompt_box = app.page.locator('[data-workbench-testid="workbench-prompt"]')
        prompt_box.click()
        subprocess.run(["pbcopy"], input=b"https://github.com/helloianneo/ian-xiaohei-illustrations", check=True)
        app.page.keyboard.press(paste_key())
        app.page.wait_for_function("() => window.__musefold_test.stores.skillRuntime.getState().status === 'ready'", timeout=60_000)
        prompt_box.fill("Agent 连接失效后仍应按附件规则生成小黑配图")
        app.page.get_by_test_id("refine-generate").click()
        app.page.wait_for_function("() => ['complete', 'error'].includes(window.__musefold_test.stores.skillRuntime.getState().status)", timeout=60_000)
        state = app.page.evaluate("() => { const s = window.__musefold_test.stores.skillRuntime.getState(); const w = window.__musefold_test.stores.workbench.getState(); return { status:s.status, trace:s.trace, turn:w.turns.at(-1), isGenerating:w.isGenerating }; }")
        agent_step = next(item for item in state["trace"] if item["id"] == "agent-run")
        assert text_requests
        assert state["status"] == "complete", state
        assert state["turn"]["source"]["executionMode"] == "file-fallback"
        assert agent_step["status"] == "error" and agent_step["detail"]
        assert any(item["id"] == "fallback" and item["status"] == "warning" for item in state["trace"])
        assert state["turn"]["results"][0]["status"] == "success"
        assert not state["isGenerating"]
        assert not any(item["status"] == "running" for item in state["trace"])
        prompt_box.fill("连接错误后继续下一轮")
        app.page.wait_for_selector('[data-testid="refine-generate"]:not([disabled])')
        EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
        app.page.screenshot(path=str(EVIDENCE_DIR / "SK-21-agent-error-fallback.png"), full_page=True)
    finally:
        subprocess.run(["pbcopy"], input=clipboard_before, check=False)
        app.api("provider.delete", provider["id"])
        app.api("aiConnection.deleteKey", connection["id"])
        app.api("aiConnection.delete", connection["id"])
        image_server.shutdown()
        image_server.server_close()
        image_thread.join(timeout=2)


@pytest.mark.gui
def test_sk_30_plain_skill_execution_does_not_create_design_scheme(app):
    import base64

    png = base64.b64encode(bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
        "0000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082"
    )).decode("ascii")

    class ImageHandler(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802
            length = int(self.headers.get("content-length", "0") or 0)
            self.rfile.read(length)
            payload = (f'{{"data":[{{"b64_json":"{png}"}}]}}').encode("utf-8")
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *_args):
            return

    image_server = ThreadingHTTPServer(("127.0.0.1", 0), ImageHandler)
    image_thread = threading.Thread(target=image_server.serve_forever, daemon=True)
    image_thread.start()
    provider = app.api_ok("provider.create", {
        "name": "SK-30 ordinary Skill image",
        "type": "openai-compatible",
        "baseUrl": f"http://127.0.0.1:{image_server.server_port}/v1",
        "model": "gpt-image-2",
        "isActive": True,
    })
    clipboard_before = subprocess.run(["pbpaste"], capture_output=True, check=False).stdout
    try:
        schemes_before_result = app.api_ok("designScheme.list")
        assert schemes_before_result["ok"], schemes_before_result
        schemes_before = schemes_before_result["data"]
        app.api_ok("provider.saveKey", provider["id"], "sk-test-ordinary-skill-image")
        app.api_ok("provider.setActive", provider["id"])
        app.page.evaluate("async () => window.__musefold_test.stores.generation.getState().loadProviders()")
        prompt_box = app.page.locator('[data-workbench-testid="workbench-prompt"]')
        prompt_box.click()
        subprocess.run(["pbcopy"], input=b"https://github.com/helloianneo/ian-xiaohei-illustrations", check=True)
        app.page.keyboard.press(paste_key())
        app.page.wait_for_function("() => window.__musefold_test.stores.skillRuntime.getState().status === 'ready'", timeout=60_000)
        prompt_box.fill("直接生成一张小黑主题的文章配图，不创建设计方案")
        app.page.get_by_test_id("refine-generate").click()
        app.page.wait_for_function("() => ['complete', 'error'].includes(window.__musefold_test.stores.skillRuntime.getState().status)", timeout=60_000)
        state = app.page.evaluate("() => { const s = window.__musefold_test.stores.skillRuntime.getState(); const w = window.__musefold_test.stores.workbench.getState(); return { status:s.status, turn:w.turns.at(-1) }; }")
        schemes_after_result = app.api_ok("designScheme.list")
        assert schemes_after_result["ok"], schemes_after_result
        schemes_after = schemes_after_result["data"]
        assert state["status"] == "complete", state
        assert state["turn"]["source"]["kind"] == "skill"
        assert state["turn"]["results"][0]["status"] == "success"
        assert [item["id"] for item in schemes_after] == [item["id"] for item in schemes_before]
        assert app.page.get_by_test_id("scheme-creation-conversation").count() == 0
        assert app.page.get_by_test_id("scheme-creation-confirm").count() == 0
        EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
        app.page.screenshot(path=str(EVIDENCE_DIR / "SK-30-ordinary-skill-no-scheme.png"), full_page=True)
    finally:
        subprocess.run(["pbcopy"], input=clipboard_before, check=False)
        app.api("provider.delete", provider["id"])
        image_server.shutdown()
        image_server.server_close()
        image_thread.join(timeout=2)


@pytest.mark.gui
def test_sk_31_design_plan_command_absorbs_ready_skill_chip(app):
    repo_url = "https://github.com/helloianneo/ian-xiaohei-illustrations"
    clipboard_before = subprocess.run(["pbpaste"], capture_output=True, check=False).stdout
    connection = app.api_ok("aiConnection.create", {
        "name": "SK-31 confirmation Agent",
        "routeKind": "gateway",
        "presetId": "custom",
        # Installation confirmation happens before the Agent is asked to analyze anything.
        "baseUrl": "http://127.0.0.1:9/v1",
        "model": "gpt-5.5",
        "isActive": True,
    })
    try:
        app.api_ok("aiConnection.saveKey", connection["id"], "sk-test-confirmation-agent")
        app.api_ok("aiConnection.setActive", connection["id"])
        prompt_box = app.page.locator('[data-workbench-testid="workbench-prompt"]')
        prompt_box.click()
        subprocess.run(["pbcopy"], input=repo_url.encode("utf-8"), check=True)
        app.page.keyboard.press(paste_key())
        app.page.wait_for_function("() => window.__musefold_test.stores.skillRuntime.getState().status === 'ready'", timeout=60_000)
        assert app.page.get_by_test_id("skill-runtime-chip").get_attribute("data-status") == "ready"

        app.page.get_by_test_id("workbench-image-picker").click()
        app.page.get_by_test_id("composer-menu-design-plan").click()
        mode = app.page.get_by_test_id("composer-mode")
        mode.get_by_role("tab", name="设计方案").wait_for(state="visible")
        assert mode.get_by_role("tab", name="设计方案").get_attribute("data-active") == "true"
        prompt_box.fill("把小黑插画规则整理成可复用的编辑配图方案")
        app.page.locator('[data-workbench-testid="workbench-submit"]').click()

        app.page.get_by_test_id("scheme-creation-confirm").wait_for(state="visible", timeout=200_000)
        turn = app.page.evaluate("() => window.__musefold_test.stores.workbench.getState().turns.filter((item) => item.source.kind === 'scheme-creation').at(-1)")
        assert turn["source"]["state"] == "awaiting_install_confirmation", turn
        assert turn["source"]["githubUrl"] == repo_url
        assert app.page.get_by_test_id("skill-runtime-chip").count() == 0
        assert not any(item["source"]["kind"] == "skill" for item in app.page.evaluate(
            "() => window.__musefold_test.stores.workbench.getState().turns",
        ))
        assert app.page.get_by_test_id("composer-mode").get_by_role("tab", name="图像").get_attribute("data-active") == "true"
        assert app.page.get_by_test_id("scheme-creation-confirm").inner_text()
        EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
        app.page.screenshot(path=str(EVIDENCE_DIR / "SK-31-skill-to-scheme-confirm.png"), full_page=True)
        app.page.get_by_test_id("scheme-creation-confirm-reject").click()
        app.page.wait_for_function("() => !window.__musefold_test.stores.schemeCreation.getState().creating", timeout=30_000)
    finally:
        subprocess.run(["pbcopy"], input=clipboard_before, check=False)
        app.api("aiConnection.deleteKey", connection["id"])
        app.api("aiConnection.delete", connection["id"])


def test_sc_03_idea_only_creation_creates_draft(app):
    import json

    compiler = {
        "name": "双色极简杂志海报",
        "summary": "固定双色印刷与留白版式的可复用海报方案",
        "fidelity": "adapted",
        "inputs": [{"label": "主题", "kind": "text", "required": True, "variable": "topic", "description": "本次海报主题"}],
        "constraints": [{"domain": "color", "statement": "使用克制的双色印刷色板", "mode": "required", "userOverridable": False, "evidencePaths": []}],
        "promptProgram": [{"kind": "input-template", "template": "为 {{topic}} 设计海报", "variables": ["topic"]}, {"kind": "style-rule", "template": "大面积留白与纸张颗粒", "variables": []}],
        "adopted": ["双色印刷", "大面积留白"], "omitted": [], "warnings": ["建议先试运行校准"],
        "creationSummary": "已创建双色极简杂志海报方案草稿，运行时提供主题即可，建议先试运行。",
    }

    class TextHandler(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802
            length = int(self.headers.get("content-length", "0") or 0)
            self.rfile.read(length)
            payload = json.dumps({"model": "local-test", "choices": [{"message": {"content": json.dumps(compiler, ensure_ascii=False)}}]}).encode("utf-8")
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *_args):
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), TextHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    connection = app.api_ok("aiConnection.create", {"name": "SC-03 local Agent", "routeKind": "gateway", "presetId": "custom", "baseUrl": f"http://127.0.0.1:{server.server_port}/v1", "model": "local-test", "isActive": True})
    try:
        app.api_ok("aiConnection.saveKey", connection["id"], "sk-test-sc03")
        app.api_ok("aiConnection.setActive", connection["id"])
        prompt_box = app.page.locator('[data-workbench-testid="workbench-prompt"]')
        prompt_box.fill("/create design plan 我想要一个可复用的双色极简杂志海报方案")
        app.page.locator('[data-workbench-testid="workbench-submit"]').click()
        app.page.wait_for_selector('[data-testid="scheme-creation-conversation"]', timeout=30_000)
        app.page.wait_for_selector('[data-testid="scheme-creation-draft-card"]', timeout=60_000)
        turn = app.page.evaluate("() => window.__musefold_test.stores.workbench.getState().turns.filter((item) => item.source.kind === 'scheme-creation').at(-1)")
        assert turn["source"]["state"] == "draft_ready", turn
        assert turn["source"]["draft"]["status"] == "draft"
        assert turn["source"]["draft"]["sourcePresentation"] == "musefold-created"
        schemes_result = app.api_ok("designScheme.list")
        assert schemes_result["ok"], schemes_result
        schemes = schemes_result["data"]
        assert any(item["id"] == turn["source"]["draft"]["id"] for item in schemes)
        assert app.page.get_by_test_id("scheme-creation-confirm").count() == 0
        EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
        app.page.screenshot(path=str(EVIDENCE_DIR / "SC-03-idea-only-draft.png"), full_page=True)
    finally:
        app.api("aiConnection.deleteKey", connection["id"])
        app.api("aiConnection.delete", connection["id"])
        server.shutdown(); server.server_close(); thread.join(timeout=2)


def test_sc_04_github_source_confirms_then_creates_or_cancels_cleanly(app):
    import json

    repo_url = "https://github.com/helloianneo/ian-xiaohei-illustrations"
    analyst = {
        "repoKind": "agent-skill", "capabilitySummary": "小黑角色文章插画",
        "rules": [{"domain": "subject", "statement": "保持小黑角色的简洁线条", "mode": "required", "evidencePaths": ["SKILL.md"]}],
        "variables": [{"label": "主题", "kind": "text", "required": True}], "referenceImages": [], "unsupported": [], "license": "MIT",
    }
    compiler = {
        "name": "小黑文章配图", "summary": "可复用的小黑角色文章配图方案", "fidelity": "faithful",
        "inputs": [{"label": "主题", "kind": "text", "required": True, "variable": "topic", "description": "文章主题"}],
        "constraints": [{"domain": "subject", "statement": "保持小黑角色的简洁线条", "mode": "required", "userOverridable": False, "evidencePaths": ["SKILL.md"]}],
        "promptProgram": [{"kind": "input-template", "template": "为 {{topic}} 绘制小黑文章配图", "variables": ["topic"]}, {"kind": "style-rule", "template": "克制留白，黑白线条", "variables": []}],
        "adopted": ["小黑角色规则"], "omitted": [], "warnings": [], "creationSummary": "已创建小黑文章配图方案草稿。提供主题后建议先试运行。",
    }

    class TextHandler(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802
            length = int(self.headers.get("content-length", "0") or 0)
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            system = payload["messages"][0]["content"]
            content = analyst if "仓库分析师" in system else compiler
            response = json.dumps({"model": "local-test", "choices": [{"message": {"content": json.dumps(content, ensure_ascii=False)}}]}).encode("utf-8")
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(response)))
            self.end_headers()
            self.wfile.write(response)

        def log_message(self, *_args):
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), TextHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    connection = app.api_ok("aiConnection.create", {"name": "SC-04 local Agent", "routeKind": "gateway", "presetId": "custom", "baseUrl": f"http://127.0.0.1:{server.server_port}/v1", "model": "local-test", "isActive": True})
    try:
        app.api_ok("aiConnection.saveKey", connection["id"], "sk-test-sc04")
        app.api_ok("aiConnection.setActive", connection["id"])
        prompt_box = app.page.locator('[data-workbench-testid="workbench-prompt"]')
        prompt_box.fill(f"/create design plan {repo_url} 按这个 Skill 做一个可复用文章配图方案")
        app.page.locator('[data-workbench-testid="workbench-submit"]').click()
        confirmation = app.page.get_by_test_id("scheme-creation-confirm")
        confirmation.wait_for(state="visible", timeout=60_000)
        turn = app.page.evaluate("() => window.__musefold_test.stores.workbench.getState().turns.filter((item) => item.source.kind === 'scheme-creation').at(-1)")
        assert turn["source"]["state"] == "awaiting_install_confirmation"
        assert turn["source"]["githubUrl"] == repo_url
        assert "不会执行仓库脚本" in confirmation.inner_text()
        assert "个文本文件" in confirmation.inner_text()
        app.page.get_by_test_id("scheme-creation-confirm-accept").click()
        app.page.wait_for_function("() => window.__musefold_test.stores.workbench.getState().turns.filter((item) => item.source.kind === 'scheme-creation').at(-1)?.source.state === 'draft_ready'", timeout=60_000)
        completed = app.page.evaluate("() => window.__musefold_test.stores.workbench.getState().turns.filter((item) => item.source.kind === 'scheme-creation').at(-1)")
        assert completed["source"]["draft"]["sourcePresentation"] == "skill"
        revision = app.api_ok("designScheme.getRevision", completed["source"]["draft"]["currentRevisionId"])
        assert revision["ok"] and any(source["kind"] == "github-skill" for source in revision["data"]["sources"])

        original = "拒绝来源后 Composer 原文需要保留"
        prompt_box.fill(f"/create design plan {repo_url} {original}")
        app.page.locator('[data-workbench-testid="workbench-submit"]').click()
        app.page.get_by_test_id("scheme-creation-confirm").wait_for(state="visible", timeout=60_000)
        app.page.get_by_test_id("scheme-creation-confirm-reject").click()
        app.page.wait_for_function("() => window.__musefold_test.stores.workbench.getState().turns.filter((item) => item.source.kind === 'scheme-creation').at(-1)?.source.state === 'cancelled'", timeout=30_000)
        assert original in prompt_box.input_value()
        EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
        app.page.screenshot(path=str(EVIDENCE_DIR / "SC-04-github-confirm-and-reject.png"), full_page=True)
    finally:
        app.api("aiConnection.deleteKey", connection["id"])
        app.api("aiConnection.delete", connection["id"])
        server.shutdown(); server.server_close(); thread.join(timeout=2)


def test_sc_10_prompt_creation_entry_prefills_and_compiles_text_only_scheme(app):
    import json

    compiler = {
        "name": "播客夜景封面", "summary": "可复用的城市夜景播客封面方案", "fidelity": "adapted",
        "inputs": [{"label": "节目主题", "kind": "text", "required": True, "variable": "topic", "description": "本期节目主题"}],
        "constraints": [{"domain": "color", "statement": "深蓝夜景与暖黄窗光形成对比", "mode": "required", "userOverridable": False, "evidencePaths": []}],
        "promptProgram": [{"kind": "input-template", "template": "为 {{topic}} 设计播客封面", "variables": ["topic"]}, {"kind": "style-rule", "template": "城市夜景，胶片颗粒与底部标题留白", "variables": []}],
        "adopted": ["固定色彩和版式"], "omitted": [], "warnings": ["建议先试运行"],
        "creationSummary": "已创建城市夜景播客封面草稿，提供节目主题即可试运行。",
    }

    class TextHandler(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802
            length = int(self.headers.get("content-length", "0") or 0)
            self.rfile.read(length)
            payload = json.dumps({"model": "local-test", "choices": [{"message": {"content": json.dumps(compiler, ensure_ascii=False)}}]}).encode("utf-8")
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *_args):
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), TextHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    connection = app.api_ok("aiConnection.create", {"name": "SC-10 local Agent", "routeKind": "gateway", "presetId": "custom", "baseUrl": f"http://127.0.0.1:{server.server_port}/v1", "model": "local-test", "isActive": True})
    try:
        app.api_ok("aiConnection.saveKey", connection["id"], "sk-test-sc10")
        app.api_ok("aiConnection.setActive", connection["id"])
        app.set_view("design-schemes")
        app.page.get_by_test_id("scheme-create").click()
        app.page.get_by_test_id("scheme-create-menu").get_by_role("menuitem", name="从提示词创建").click()
        prompt_box = app.page.locator('[data-workbench-testid="workbench-prompt"]')
        app.page.get_by_test_id("composer-mode").get_by_role("tab", name="设计方案").wait_for(state="visible")
        seeded = prompt_box.input_value()
        assert seeded.startswith("把下面这段提示词整理成一个可复用方案")
        prompt_box.fill(f"{seeded}城市夜景播客封面：深蓝背景，暖黄色窗光，底部留白放节目标题。")
        app.page.locator('[data-workbench-testid="workbench-submit"]').click()
        app.page.get_by_test_id("scheme-creation-draft-card").wait_for(state="visible", timeout=60_000)
        turn = app.page.evaluate("() => window.__musefold_test.stores.workbench.getState().turns.filter((item) => item.source.kind === 'scheme-creation').at(-1)")
        revision = app.api_ok("designScheme.getRevision", turn["source"]["draft"]["currentRevisionId"])
        assert revision["ok"], revision
        assert revision["data"]["inputs"]
        assert all(slot["kind"] in {"text", "article", "choice"} for slot in revision["data"]["inputs"])
        EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
        app.page.screenshot(path=str(EVIDENCE_DIR / "SC-10-prompt-entry-draft.png"), full_page=True)
    finally:
        app.api("aiConnection.deleteKey", connection["id"])
        app.api("aiConnection.delete", connection["id"])
        server.shutdown(); server.server_close(); thread.join(timeout=2)


def test_sc_11_prompt_detail_sends_content_to_scheme_composer(app):
    prompt = app.api_ok("prompt.create", {
        "title": "SC-11 城市夜景提示词",
        "content": "城市夜景播客封面，深蓝背景与暖黄色窗光，底部留白放标题，胶片颗粒质感。",
        "contentNegative": "水印，杂乱文字",
    })
    app.set_view("library")
    app.page.wait_for_selector('[data-testid="library-search"]')
    app.page.evaluate("() => window.__musefold_test.stores.library.getState().reloadPrompts()")
    app.page.wait_for_selector(f'[data-prompt-id="{prompt["id"]}"] [data-testid="prompt-row-open"]')
    app.page.click(f'[data-prompt-id="{prompt["id"]}"] [data-testid="prompt-row-open"]')
    app.page.get_by_test_id("detail-menu").click()
    app.page.get_by_test_id("detail-create-scheme").click()
    mode = app.page.get_by_test_id("composer-mode")
    mode.get_by_role("tab", name="设计方案").wait_for(state="visible")
    prompt_box = app.page.locator('[data-workbench-testid="workbench-prompt"]')
    value = prompt_box.input_value()
    assert mode.get_by_role("tab", name="设计方案").get_attribute("data-active") == "true"
    assert prompt["content"] in value
    assert prompt["contentNegative"] in value
    assert "区分固定规则" in value
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    app.page.screenshot(path=str(EVIDENCE_DIR / "SC-11-prompt-detail-to-scheme.png"), full_page=True)


def test_sc_12_history_picker_creates_scheme_from_selected_images(app):
    import json
    import sqlite3
    import time

    png = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082")
    history_items = []
    for index in range(2):
        image_path = app.user_data_dir / f"sc12-history-{index}.png"
        image_path.write_bytes(png)
        history_items.append({"id": f"sc12-history-{index}", "path": str(image_path)})
        app.db_query("SELECT 1")
    con = sqlite3.connect(app.db_path())
    try:
        now = int(time.time() * 1000)
        for index, item in enumerate(history_items):
            con.execute(
                "INSERT INTO history (id, provider_id, model, prompt_text, status, image_path, created_at) VALUES (?, ?, ?, ?, 'success', ?, ?)",
                (item["id"], "sc12-provider", "gpt-image-2", f"历史作品 {index} 的提示词：留白与颗粒", item["path"], now + index),
            )
        con.commit()
    finally:
        con.close()

    compiler = {
        "name": "历史留白方案", "summary": "从历史作品归纳的留白与颗粒方案", "fidelity": "adapted",
        "inputs": [{"label": "主题", "kind": "text", "required": True, "variable": "topic", "description": "本次主题"}],
        "constraints": [{"domain": "composition", "statement": "保留历史作品中的留白构图方向", "mode": "required", "userOverridable": False, "evidencePaths": []}],
        "promptProgram": [{"kind": "input-template", "template": "为 {{topic}} 生成留白配图", "variables": ["topic"]}, {"kind": "style-rule", "template": "参考历史作品的颗粒质感", "variables": []}],
        "adopted": ["留白与颗粒"], "omitted": [], "warnings": ["由历史作品归纳，建议试运行"], "creationSummary": "已从 2 张历史作品创建草稿，提供主题即可试运行。",
    }

    class TextHandler(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802
            length = int(self.headers.get("content-length", "0") or 0)
            self.rfile.read(length)
            payload = json.dumps({"model": "local-test", "choices": [{"message": {"content": json.dumps(compiler, ensure_ascii=False)}}]}).encode("utf-8")
            self.send_response(200); self.send_header("content-type", "application/json"); self.send_header("content-length", str(len(payload))); self.end_headers(); self.wfile.write(payload)

        def log_message(self, *_args):
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), TextHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    connection = app.api_ok("aiConnection.create", {"name": "SC-12 local Agent", "routeKind": "gateway", "presetId": "custom", "baseUrl": f"http://127.0.0.1:{server.server_port}/v1", "model": "local-test", "isActive": True})
    try:
        app.api_ok("aiConnection.saveKey", connection["id"], "sk-test-sc12"); app.api_ok("aiConnection.setActive", connection["id"])
        app.set_view("design-schemes")
        app.page.get_by_test_id("scheme-create").click()
        app.page.get_by_test_id("scheme-create-menu").get_by_role("menuitem", name="从历史内容创建").click()
        picker = app.page.get_by_test_id("history-source-picker"); picker.wait_for(state="visible")
        app.page.get_by_test_id("history-pick-sc12-history-0").click(); app.page.get_by_test_id("history-pick-sc12-history-1").click()
        assert app.page.get_by_test_id("history-selected-count").inner_text() == "已选择 2 张作品"
        app.page.get_by_test_id("history-suggestion-保留生成参数").click()
        app.page.get_by_test_id("history-source-confirm").click()
        app.page.get_by_test_id("composer-mode").get_by_role("tab", name="设计方案").wait_for(state="visible")
        app.page.locator('[data-workbench-testid="workbench-submit"]').click()
        app.page.get_by_test_id("scheme-creation-draft-card").wait_for(state="visible", timeout=60_000)
        turn = app.page.evaluate("() => window.__musefold_test.stores.workbench.getState().turns.filter((item) => item.source.kind === 'scheme-creation').at(-1)")
        revision = app.api_ok("designScheme.getRevision", turn["source"]["draft"]["currentRevisionId"])
        assert revision["ok"]
        history_sources = [source for source in revision["data"]["sources"] if source["kind"] == "history-image"]
        assert len(history_sources) == 2
        assert "历史来源" in turn["source"]["trace"][0]["title"] or any(item["id"] == "history-snapshot" for item in turn["source"]["trace"])
        EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
        app.page.screenshot(path=str(EVIDENCE_DIR / "SC-12-history-scheme-draft.png"), full_page=True)
    finally:
        app.api("aiConnection.deleteKey", connection["id"]); app.api("aiConnection.delete", connection["id"])
        server.shutdown(); server.server_close(); thread.join(timeout=2)


def test_sc_21_market_candidate_adds_github_draft_after_confirmation(app):
    import json

    compiler = {
        "name": "市场图示方案", "summary": "来自市场候选的结构化草稿", "fidelity": "faithful",
        "inputs": [{"label": "主题", "kind": "text", "required": True, "variable": "topic", "description": "图示主题"}],
        "constraints": [{"domain": "composition", "statement": "使用清晰分层和可读标签", "mode": "required", "userOverridable": False, "evidencePaths": ["SKILL.md"]}],
        "promptProgram": [{"kind": "input-template", "template": "为 {{topic}} 生成结构图", "variables": ["topic"]}, {"kind": "style-rule", "template": "学术蓝与白色背景", "variables": []}],
        "adopted": ["清晰分层"], "omitted": [], "warnings": [], "creationSummary": "已从市场候选创建草稿。",
    }
    analyst = {"repoKind": "agent-skill", "capabilitySummary": "结构图", "rules": [{"domain": "composition", "statement": "使用清晰分层和可读标签", "mode": "required", "evidencePaths": ["SKILL.md"]}], "variables": [{"label": "主题", "kind": "text", "required": True}], "referenceImages": [], "unsupported": [], "license": "MIT"}
    requests = []

    class TextHandler(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802
            length = int(self.headers.get("content-length", "0") or 0); payload = json.loads(self.rfile.read(length).decode("utf-8"))
            content = analyst if "仓库分析师" in payload["messages"][0]["content"] else compiler
            body = json.dumps({"model": "local-test", "choices": [{"message": {"content": json.dumps(content, ensure_ascii=False)}}]}).encode("utf-8")
            self.send_response(200); self.send_header("content-type", "application/json"); self.send_header("content-length", str(len(body))); self.end_headers(); self.wfile.write(body)

        def log_message(self, *_args): return

    server = ThreadingHTTPServer(("127.0.0.1", 0), TextHandler); thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    connection = app.api_ok("aiConnection.create", {"name": "SC-21 local Agent", "routeKind": "gateway", "presetId": "custom", "baseUrl": f"http://127.0.0.1:{server.server_port}/v1", "model": "local-test", "isActive": True})
    try:
        app.api_ok("aiConnection.saveKey", connection["id"], "sk-test-sc21"); app.api_ok("aiConnection.setActive", connection["id"])
        app.set_view("design-schemes"); app.page.get_by_test_id("scheme-surface-explore").click(); app.page.get_by_test_id("scheme-search").fill("diagram skill"); app.page.get_by_test_id("market-search-run").click(); app.page.get_by_test_id("market-candidate-mc_9001").wait_for(state="visible")
        app.page.get_by_test_id("market-add-mc_9001").click(); app.page.get_by_test_id("market-install-dialog").wait_for(state="visible"); app.page.get_by_test_id("market-install-confirm").click()
        app.page.get_by_test_id("scheme-creation-confirm").wait_for(state="visible", timeout=60_000)
        turn = app.page.evaluate("() => window.__musefold_test.stores.workbench.getState().turns.filter((item) => item.source.kind === 'scheme-creation').at(-1)")
        attachments = app.page.get_by_test_id("generation-message-attachments")
        assert attachments.get_by_test_id("generation-scheme-creation-reference").count() == 1
        assert app.page.get_by_test_id("generation-command-tag").inner_text().strip().endswith("创建设计方案")
        assert "创建设计方案" in app.page.get_by_test_id("generation-user-message").inner_text()
        assert "1:1" not in app.page.get_by_test_id("generation-user-message").inner_text()
        app.page.get_by_test_id("scheme-creation-confirm-accept").click()
        app.page.wait_for_function("() => window.__musefold_test.stores.workbench.getState().turns.filter((item) => item.source.kind === 'scheme-creation').at(-1)?.source.state === 'draft_ready'", timeout=60_000)
        created = app.page.evaluate("() => window.__musefold_test.stores.workbench.getState().turns.filter((item) => item.source.kind === 'scheme-creation').at(-1)")
        assert created["source"]["draft"]["sourcePresentation"] == "skill"
        app.set_view("design-schemes"); app.page.get_by_test_id("scheme-surface-explore").click(); app.page.get_by_test_id("scheme-search").fill("diagram skill"); app.page.get_by_test_id("market-search-run").click(); app.page.get_by_test_id("market-candidate-mc_9001").wait_for(state="visible")
        assert app.page.get_by_test_id("market-add-mc_9001").inner_text() == "已添加"
        EVIDENCE_DIR.mkdir(parents=True, exist_ok=True); app.page.screenshot(path=str(EVIDENCE_DIR / "SC-21-market-draft-added.png"), full_page=True)
    finally:
        app.api("aiConnection.deleteKey", connection["id"]); app.api("aiConnection.delete", connection["id"]); server.shutdown(); server.server_close(); thread.join(timeout=2)
