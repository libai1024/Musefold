"""统一生成工作台验收：本机假 Provider，不访问真实 API。"""
from __future__ import annotations

import base64
import json
import socket
import sqlite3
import threading
from email import policy
from email.parser import BytesParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest


PNG_1PX_B64 = base64.b64encode(bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082"
)).decode("ascii")
RATIO_CONSTRAINT_PREFIX = "画面比例约束："


def constrained_prompt(prompt: str, ratio: str = "1:1") -> str:
    if ratio == "auto" or RATIO_CONSTRAINT_PREFIX in prompt:
        return prompt.strip()
    return (
        f"{prompt.strip()}\n\n{RATIO_CONSTRAINT_PREFIX}严格按照 {ratio} 画幅构图；"
        "主体、留白和所有关键元素均需完整适配该比例，不得改用其他画幅。"
    )


def parse_request_body(raw: bytes, content_type: str) -> dict:
    """Keep the fake provider's request shape stable for JSON and multipart calls."""
    if not content_type.lower().startswith("multipart/form-data"):
        return json.loads(raw.decode("utf-8") or "{}")

    message = BytesParser(policy=policy.default).parsebytes(
        f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode("utf-8") + raw,
    )
    fields: dict = {}
    for part in message.iter_parts():
        name = part.get_param("name", header="content-disposition")
        if not name:
            continue
        payload = part.get_payload(decode=True) or b""
        filename = part.get_filename()
        if filename:
            fields[name] = {
                "filename": filename,
                "contentType": part.get_content_type(),
                "size": len(payload),
            }
        else:
            fields[name] = payload.decode(part.get_content_charset() or "utf-8")
    return fields


@pytest.fixture
def fake_workbench_server():
    requests: list[dict] = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            if self.path != "/v1/models":
                self.send_response(404)
                self.end_headers()
                return
            payload = json.dumps({
                "data": [
                    {"id": "gpt-image-2", "object": "model"},
                    {"id": "gpt-image-1", "object": "model"},
                ]
            }).encode("utf-8")
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def do_POST(self):  # noqa: N802
            length = int(self.headers.get("content-length", "0") or 0)
            raw = self.rfile.read(length) if length else b"{}"
            body = parse_request_body(raw, self.headers.get("content-type", ""))
            requests.append({"path": self.path, "body": body})
            if self.path not in {"/v1/images/generations", "/v1/images/edits"}:
                self.send_response(404)
                self.end_headers()
                return
            payload = json.dumps({"data": [{"b64_json": PNG_1PX_B64}]}).encode("utf-8")
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *_args):  # noqa: D401
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield {"base": f"http://127.0.0.1:{server.server_address[1]}/v1", "requests": requests}
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


@pytest.fixture
def hanging_workbench_server():
    server = socket.socket()
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("127.0.0.1", 0))
    server.listen(8)
    server.settimeout(0.3)
    held: list[socket.socket] = []
    stopped = threading.Event()

    def accept_loop():
        while not stopped.is_set():
            try:
                connection, _ = server.accept()
            except socket.timeout:
                continue
            held.append(connection)

    thread = threading.Thread(target=accept_loop, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.getsockname()[1]}/v1"
    finally:
        stopped.set()
        thread.join(timeout=2)
        for connection in held:
            connection.close()
        server.close()


@pytest.fixture
def retry_workbench_server():
    requests: list[dict] = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802
            length = int(self.headers.get("content-length", "0") or 0)
            raw = self.rfile.read(length) if length else b"{}"
            body = parse_request_body(raw, self.headers.get("content-type", ""))
            requests.append({"path": self.path, "body": body})
            if self.path != "/v1/images/generations":
                self.send_response(404)
                self.end_headers()
                return
            if len(requests) == 1:
                payload = b'{"error":{"message":"temporary upstream failure"}}'
                self.send_response(503)
            else:
                payload = json.dumps({"data": [{"b64_json": PNG_1PX_B64}]}).encode("utf-8")
                self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *_args):  # noqa: D401
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield {"base": f"http://127.0.0.1:{server.server_address[1]}/v1", "requests": requests}
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


@pytest.fixture
def failing_workbench_server():
    requests: list[dict] = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802
            length = int(self.headers.get("content-length", "0") or 0)
            raw = self.rfile.read(length) if length else b"{}"
            body = parse_request_body(raw, self.headers.get("content-type", ""))
            requests.append({"path": self.path, "body": body})
            payload = b'{"error":{"message":"generation request rejected by fake provider"}}'
            self.send_response(400)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *_args):  # noqa: D401
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield {"base": f"http://127.0.0.1:{server.server_address[1]}/v1", "requests": requests}
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


@pytest.fixture
def refinement_failing_workbench_server():
    requests: list[dict] = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            if self.path != "/v1/models":
                self.send_response(404)
                self.end_headers()
                return
            payload = b'{"data":[{"id":"gpt-image-2","object":"model"}]}'
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def do_POST(self):  # noqa: N802
            length = int(self.headers.get("content-length", "0") or 0)
            raw = self.rfile.read(length) if length else b"{}"
            body = parse_request_body(raw, self.headers.get("content-type", ""))
            requests.append({"path": self.path, "body": body})
            if len(requests) == 2:
                payload = b'{"error":{"message":"refinement rejected by fake provider"}}'
                self.send_response(400)
            else:
                payload = json.dumps({"data": [{"b64_json": PNG_1PX_B64}]}).encode("utf-8")
                self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *_args):  # noqa: D401
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield {"base": f"http://127.0.0.1:{server.server_address[1]}/v1", "requests": requests}
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


@pytest.fixture
def refinement_hanging_workbench_server():
    requests: list[dict] = []
    second_started = threading.Event()
    release_second = threading.Event()

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            if self.path != "/v1/models":
                self.send_response(404)
                self.end_headers()
                return
            payload = b'{"data":[{"id":"gpt-image-2","object":"model"}]}'
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def do_POST(self):  # noqa: N802
            length = int(self.headers.get("content-length", "0") or 0)
            raw = self.rfile.read(length) if length else b"{}"
            body = parse_request_body(raw, self.headers.get("content-type", ""))
            requests.append({"path": self.path, "body": body})
            if len(requests) == 1:
                payload = json.dumps({"data": [{"b64_json": PNG_1PX_B64}]}).encode("utf-8")
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
                return
            second_started.set()
            release_second.wait(timeout=30)

        def log_message(self, *_args):  # noqa: D401
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield {
            "base": f"http://127.0.0.1:{server.server_address[1]}/v1",
            "requests": requests,
            "second_started": second_started,
            "release_second": release_second,
        }
    finally:
        release_second.set()
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def workbench(app, expr: str):
    return app.page.evaluate(
        "(src) => { const s = window.__musefold_test.stores.workbench.getState(); return eval(src); }",
        expr,
    )


def choose_count(app, count: int):
    menu = app.page.locator('[data-testid="workbench-generation-options"]')
    if menu.count() == 0 or not menu.is_visible():
        app.page.click('[data-testid="workbench-more-settings"]')
        app.page.wait_for_selector('[data-testid="workbench-generation-options"]')
    app.page.click(f'[data-testid="refine-count-{count}"]')


def prompt_rows_by_content(app, content: str):
    con = sqlite3.connect(app.db_path())
    con.row_factory = sqlite3.Row
    try:
        rows = con.execute(
            """
            SELECT id, title, content, content_negative, source, source_url, preview_image_path
            FROM prompts
            WHERE content = ? AND deleted_at IS NULL
            ORDER BY created_at ASC
            """,
            (content,),
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


def setup_provider(app, fake_workbench_server):
    provider = app.api_ok("provider.create", {
        "name": "Workbench 本机假站",
        "type": "openai-compatible",
        "baseUrl": fake_workbench_server["base"],
        "model": "gpt-image-2",
        "isActive": True,
    })
    app.api_ok("provider.saveKey", provider["id"], "sk-workbench-local-test-1234")
    app.api_ok("provider.setActive", provider["id"])
    app.page.evaluate("async () => window.__musefold_test.stores.generation.getState().loadProviders()")
    app.page.wait_for_timeout(250)
    return provider


def test_skill_agent_process_is_rendered_in_conversation_not_composer(app):
    """Skill 工具调用属于 Agent 消息；Composer 只承载引用附件。"""
    app.set_view("generate")
    app.page.evaluate(
        """() => window.__musefold_test.stores.workbench.setState({
          turns: [{
            id: 'turn-skill-conversation',
            prompt: 'compiled image prompt',
            userPrompt: '把风景照做成留白充足的竖版海报',
            references: [],
            negativePrompt: '',
            source: {
              kind: 'skill',
              label: 'minimal-zine-poster',
              repositoryUrl: 'https://github.com/example/minimal-zine-poster',
              compiledPrompt: 'compiled image prompt',
              executionMode: 'agent',
              trace: [
                { id: 'github', kind: 'tool', title: '读取 GitHub 仓库', status: 'success' },
                { id: 'agent', kind: 'tool', title: 'Agent 执行 Skill', detail: '读取视觉规范与参考图', status: 'success' },
                { id: 'assistant-output', kind: 'assistant', title: 'Agent 返回生图提示词', output: '留白充足、竖版纸张、克制排版。', status: 'success' },
                { id: 'image-generation', kind: 'tool', title: '调用生图模型', status: 'running' },
              ],
            },
            providerId: null,
            params: { ratioId: '2:3', quality: 'medium', n: 1, background: 'auto' },
            status: 'running',
            results: [{ id: 'result-skill-conversation', jobId: 'job-skill-conversation', status: 'pending' }],
            referenceImages: [],
            createdAt: Date.now(),
          }],
          isGenerating: true,
          activeTurnId: 'turn-skill-conversation',
        })""",
    )
    conversation = app.page.locator('[data-testid="skill-runtime-conversation"]')
    conversation.wait_for(state="visible")
    assert conversation.get_attribute("data-placement") == "conversation"
    assert app.page.locator(
        '[data-testid="generation-result-group"] [data-testid="skill-runtime-conversation"]',
    ).count() == 1
    assert app.page.locator(
        '[data-testid="workbench-composer"] [data-testid="skill-runtime-conversation"]',
    ).count() == 0
    assert app.page.locator('[data-testid="generation-skill-reference"]').is_visible()
    assert app.page.locator('[data-testid="skill-runtime-agent-output"]').is_visible()

    user_box = app.page.locator('[data-testid="generation-user-message"]').bounding_box()
    trace_box = conversation.bounding_box()
    result_box = app.page.locator('[data-testid="refine-results"]').bounding_box()
    assert user_box and trace_box and result_box
    assert user_box["y"] < trace_box["y"] < result_box["y"]


def settle(app, timeout=30_000):
    app.page.wait_for_function(
        "() => window.__musefold_test.stores.workbench.getState().isGenerating === false",
        timeout=timeout,
    )
    app.page.wait_for_timeout(250)


def test_prompt_reference_sidebar_layout_toggle_and_overlay(app):
    # v2.0：宽屏素材库是参与布局的第三列；紧凑窗口退化为带遮罩的模态面板。
    toggle = app.page.locator('[data-testid="titlebar-materials-toggle"]')
    toggle.click()
    app.page.wait_for_selector('[data-testid="workbench-reference-sidebar"]')
    sidebar = app.page.locator('[data-testid="workbench-reference-sidebar"]')
    box = sidebar.bounding_box()
    viewport = app.page.evaluate("() => ({ width: innerWidth, height: innerHeight })")
    assert sidebar.get_attribute("data-layout") == "dock"
    assert 303 <= box["width"] <= 305, box
    assert box["x"] >= 0 and box["x"] + box["width"] <= viewport["width"] + 1, box
    assert app.page.locator('[data-testid="workbench-reference-backdrop"]').is_hidden(), \
        "宽屏 Dock 不应有可见遮罩"

    geometry = app.page.evaluate(
        """() => {
          const primary = document.querySelector('.mf-workbench-primary').getBoundingClientRect();
          const dock = document.querySelector('[data-testid="workbench-reference-sidebar"]').getBoundingClientRect();
          const composer = document.querySelector('[data-testid="workbench-composer"]').getBoundingClientRect();
          return { primary, dock, composer };
        }"""
    )
    assert geometry["primary"]["right"] <= geometry["dock"]["left"] + 1, geometry
    assert geometry["composer"]["right"] <= geometry["primary"]["right"] + 1, geometry

    resize = app.page.get_by_test_id("workbench-context-dock-resize")
    resize.focus()
    resize.press("ArrowLeft")
    app.page.wait_for_function(
        "() => Number(document.querySelector('[data-testid=\"workbench-context-dock-resize\"]')"
        ".getAttribute('aria-valuenow')) === 320"
    )
    resized_box = sidebar.bounding_box()
    assert 319 <= resized_box["width"] <= 321, resized_box

    toggle.click()
    app.page.wait_for_function(
        "() => document.querySelector('[data-testid=\"workbench-reference-sidebar\"]') === null",
    )
    toggle.click()
    app.page.wait_for_selector('[data-testid="workbench-reference-sidebar"]')

    app.page.set_viewport_size({"width": 640, "height": 760})
    backdrop = app.page.locator('[data-testid="workbench-reference-backdrop"]')
    backdrop.wait_for(state="visible")
    # 遮罩是纯 CSS 媒体查询（随视口同步翻转），role 要等 matchMedia 回调 + React 重渲染，
    # 两者天然差一帧：满负载跑全量时立即读会读到旧值，所以这里轮询而不是瞬时断言。
    app.page.wait_for_selector('[data-testid="workbench-reference-sidebar"][role="dialog"]')
    assert sidebar.get_attribute("data-layout") == "overlay"
    backdrop.click(position={"x": 5, "y": 20})
    app.page.wait_for_function(
        "() => document.querySelector('[data-testid=\"workbench-reference-sidebar\"]') === null",
    )


def test_prompt_references_full_excerpt_persist_query_and_reuse(app, fake_workbench_server):
    setup_provider(app, fake_workbench_server)
    full_prompt = app.api_ok("prompt.create", {
        "title": "参考电影感",
        "content": "soft side light, realistic skin, shallow depth of field",
    })
    excerpt_prompt = app.api_ok("prompt.create", {
        "title": "参考自然光",
        "content": "阴天漫射光，干净背景，柔和阴影",
    })
    app.page.evaluate(
        "() => window.__musefold_test.stores.library.setState({ search: 'library-filter-marker' })"
    )

    # 素材库默认收起，经标题栏开关打开
    app.page.click('[data-testid="titlebar-materials-toggle"]')
    app.page.wait_for_selector('[data-testid="workbench-reference-sidebar"]')
    search = app.page.locator('[data-testid="workbench-reference-search"]')
    search.fill(full_prompt["title"])
    row = app.page.locator('[data-testid="workbench-reference-row"]', has_text=full_prompt["title"])
    row.wait_for(state="visible")
    row.locator('[data-testid="workbench-reference-expand"]').click()
    row.locator('[data-testid="workbench-reference-full"]').click()
    app.page.wait_for_selector('[data-testid="workbench-context-tray"]')
    assert app.page.locator('[data-testid="workbench-attachments"] [data-testid="refine-source"]').count() == 1
    assert fake_workbench_server["requests"] == [], "引用动作不能自动生图"

    # 引用保存快照；源提示词随后编辑，不应改变当前引用。
    app.api_ok("prompt.update", full_prompt["id"], {"content": "edited after reference"})

    search.fill(excerpt_prompt["title"])
    row = app.page.locator('[data-testid="workbench-reference-row"]', has_text=excerpt_prompt["title"])
    row.wait_for(state="visible")
    row.locator('[data-testid="workbench-reference-expand"]').click()
    content = row.locator('[data-testid="workbench-reference-content"]')
    content.evaluate(
        """(element) => {
          const node = element.firstChild;
          const range = document.createRange();
          range.setStart(node, 0);
          range.setEnd(node, 5);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        }"""
    )
    row.locator('[data-testid="workbench-reference-selection"]').click()
    assert app.page.locator('[data-testid="workbench-context-tray"]').count() == 1
    assert app.page.locator('[data-testid="workbench-attachments"] [data-testid="refine-source"]').count() == 2
    assert workbench(app, "s.draftReferences.length") == 2
    assert workbench(app, "s.draftReferences[0].text") == full_prompt["content"]
    assert workbench(app, "s.draftReferences[1].text") == "阴天漫射光，干净背景，柔和阴影"[:5]
    assert app.page.evaluate(
        "() => window.__musefold_test.stores.library.getState().search"
    ) == "library-filter-marker"

    user_prompt = "a quiet editorial portrait"
    choose_count(app, 1)
    app.page.fill('[data-workbench-testid="workbench-prompt"]', user_prompt)
    app.page.click('[data-workbench-testid="workbench-submit"]')
    settle(app)
    assert len(fake_workbench_server["requests"]) == 1
    submitted = fake_workbench_server["requests"][0]["body"]["prompt"]
    assert submitted.startswith(user_prompt + "\n\n参考提示词：")
    assert "【参考电影感｜整条】" in submitted
    assert full_prompt["content"] in submitted
    assert "【参考自然光｜选中片段】" in submitted
    assert "阴天漫射" in submitted
    assert RATIO_CONSTRAINT_PREFIX in submitted
    session_id = workbench(app, "s.activeSessionId")
    session_row = app.page.locator(f'[data-conversation-row="{session_id}"]')
    assert session_row.get_attribute("data-conversation-kind") == "prompt"

    history = app.db_query("SELECT id, prompt_text FROM history ORDER BY created_at DESC LIMIT 1")[0]
    refs = app.db_query(
        """SELECT prompt_id, prompt_title, excerpt, scope, sort_order
           FROM history_prompt_references WHERE history_id = ? ORDER BY sort_order""",
        (history["id"],),
    )
    assert len(refs) == 2
    assert refs[0]["excerpt"] == full_prompt["content"]
    assert refs[0]["scope"] == "full"
    assert refs[1]["scope"] == "excerpt"

    related_full = app.api_ok("history.related", {
        "promptId": full_prompt["id"], "status": "success", "limit": 10,
    })
    related_excerpt = app.api_ok("history.related", {
        "promptId": excerpt_prompt["id"], "status": "success", "limit": 10,
    })
    assert related_full["total"] == 1
    assert related_excerpt["total"] == 1

    retried = app.api_ok("image.retry", history["id"], "history-reference-retry")
    assert retried["status"] == "success"
    retry_refs = app.db_query(
        """SELECT prompt_title, excerpt, scope, sort_order
           FROM history_prompt_references WHERE history_id = ? ORDER BY sort_order""",
        (retried["historyId"],),
    )
    assert retry_refs == [
        {"prompt_title": row["prompt_title"], "excerpt": row["excerpt"], "scope": row["scope"], "sort_order": row["sort_order"]}
        for row in refs
    ]

    workbench(app, "s.clearDraftReferences()")
    app.page.click('[data-testid="generation-turn-more"]')
    app.page.get_by_role("menuitem", name="再次制作", exact=True).click()
    assert workbench(app, "s.draftPrompt") == user_prompt
    assert workbench(app, "s.draftReferences.length") == 2


def test_workbench_starts_as_brand_lockup_with_inline_composer(app):
    """v2.0 空态：品牌锁定区(放大的产品 mark + 换行提示语,英文名称退为水印背景)+ 最多三条建议 + 内联 Composer；无服务商时发送禁用并说明原因。"""
    app.page.wait_for_selector('[data-testid="generation-workbench"]')
    assert app.page.locator('[data-testid^="generate-mode-"]').count() == 0
    empty = app.page.locator('[data-testid="workbench-empty"]')
    empty.wait_for()
    watermark = empty.locator('[data-testid="workbench-empty-watermark"]').inner_text()
    assert "".join(watermark.split()) == "Musefold"
    tagline = empty.locator('[data-testid="workbench-empty-slogan"]').inner_text()
    assert "".join(tagline.split()) == "把想法变成可生成的视觉"
    # 快捷建议最多三条,Composer 内联在空态内容列中(v2.0 11 §3/§6)。
    assert empty.locator('[data-testid="generation-example"]').count() == 3
    assert empty.locator('[data-testid="workbench-composer"]').is_visible()

    app.page.fill('[data-testid="refine-prompt"]', "空态探针")
    send = app.page.locator('[data-testid="refine-generate"]')
    assert send.is_disabled(), "无服务商时发送按钮应禁用而不是制造失败回合"
    assert send.get_attribute("title") == "请先连接服务商"
    assert workbench(app, "s.params.n") == 4


def test_workbench_empty_provider_dialog_cancel_keeps_empty_state(app):
    """CHT-10：无 Provider 时从侧栏直达服务商设置引导，取消配置后不留下半成品状态。
    RELAY-SETTINGS-UI 第二步:空态引导在 settings 场景就地新建(详情面板),取消同样不落库。"""
    app.page.wait_for_selector('[data-testid="workbench-empty"]')
    app.page.click('[data-testid="sidebar-settings"]')
    app.page.get_by_test_id("sidebar-settings-open").click()
    app.page.get_by_role("button", name="中转站", exact=True).click()
    app.page.wait_for_selector('[data-testid="settings-empty-provider"]')
    app.page.click('[data-testid="provider-add-first"]')
    app.page.wait_for_selector('[data-testid="provider-api-key"]')
    app.page.get_by_role("button", name="取消").click()
    app.page.wait_for_function(
        "() => document.querySelector('[data-testid=\"provider-api-key\"]') === null",
    )
    assert app.page.is_visible('[data-testid="settings-empty-provider"]')
    assert app.page.evaluate("() => window.__musefold_test.stores.generation.getState().providers.length") == 0

    app.set_view("generate")
    app.page.wait_for_selector('[data-testid="workbench-empty"]')
    assert workbench(app, "s.turns.length") == 0


def test_workbench_empty_provider_without_key_guides_to_key_entry(app, fake_workbench_server):
    """CHT-10：已有 Provider 但未存密钥时，引导补 Key，而不是让示例卡制造失败回合。"""
    provider = app.api_ok("provider.create", {
        "name": "Workbench 未填密钥",
        "type": "openai-compatible",
        "baseUrl": fake_workbench_server["base"],
        "model": "gpt-image-2",
        "isActive": True,
    })
    app.api_ok("provider.setActive", provider["id"])
    app.page.evaluate("async () => window.__musefold_test.stores.generation.getState().loadProviders()")

    # 有服务商但没有密钥：发送保持禁用，全局模型入口可进入中转站管理补 Key
    app.page.fill('[data-testid="refine-prompt"]', "未存密钥探针")
    send = app.page.locator('[data-testid="refine-generate"]')
    assert send.is_disabled(), "未存密钥时发送应禁用而不是制造失败回合"

    app.page.click('[data-testid="provider-quick-switch"]')
    app.page.click('[data-testid="relay-model-manage"]')
    # RELAY-SETTINGS-UI 第二步:中转站为 master-detail,点左栏行即在右栏就地编辑(无弹窗)
    app.page.locator('[data-testid^="settings-provider-row-"]').first.click()
    app.page.wait_for_selector('[data-testid="provider-api-key"]')
    assert workbench(app, "s.turns.length") == 0
    assert fake_workbench_server["requests"] == []


def test_workbench_empty_examples_fill_prompt_without_submitting(app, fake_workbench_server):
    """CHT-10：空态示例只回填输入框并聚焦，交由用户确认后提交。"""
    setup_provider(app, fake_workbench_server)
    app.page.wait_for_selector('[data-testid="workbench-empty"]')
    first_example = app.page.locator('[data-testid="generation-example"]').first
    # v2 建议行为 sr-only 文本（title 只在省略号溢出时才出现，随字体度量漂移）；
    # 点击回填用的正是这段文本，以 inner_text 为稳定事实源。
    example_text = first_example.inner_text()
    assert example_text
    first_example.click()

    app.page.wait_for_function(
        f"() => window.__musefold_test.stores.workbench.getState().draftPrompt === {json.dumps(example_text)}",
        timeout=10_000,
    )
    assert app.page.input_value('[data-workbench-testid="workbench-prompt"]') == example_text
    app.page.wait_for_function(
        "() => document.activeElement?.matches('[data-workbench-testid=\\\"workbench-prompt\\\"]')",
        timeout=2_000,
    )
    assert workbench(app, "s.turns.length") == 0
    assert fake_workbench_server["requests"] == []


def test_workbench_session_title_uses_first_prompt_and_resets(app, fake_workbench_server):
    """会话标题（标题栏）由第一条输入生成；后续回合不改名，新设计后恢复空态。"""
    setup_provider(app, fake_workbench_server)
    title = app.page.locator('[data-testid="titlebar-title"]')
    assert title.inner_text() == "新设计"

    first_prompt = "雨夜东京街角的电影感灯光"
    app.page.fill('[data-workbench-testid="workbench-prompt"]', first_prompt)
    app.page.click('[data-workbench-testid="workbench-submit"]')
    settle(app)
    app.page.wait_for_function(
        "(expected) => document.querySelector('[data-testid=\"titlebar-title\"]')?.getAttribute('title') === expected",
        arg=first_prompt,
        timeout=10_000,
    )
    assert workbench(app, "s.turns.length") == 1
    first_result_count = workbench(
        app,
        "s.turns.flatMap((turn) => turn.results).filter((result) => result.status === 'success').length",
    )
    assert app.page.get_by_test_id("titlebar-result-summary").inner_text() == f"{first_result_count} 张图"
    assert "自由创作" in app.page.get_by_test_id("titlebar-task-summary").inner_text()

    app.page.fill('[data-workbench-testid="workbench-prompt"]', "第二次制作不应覆盖会话标题")
    app.page.click('[data-workbench-testid="workbench-submit"]')
    settle(app)
    assert title.get_attribute("title") == first_prompt
    assert workbench(app, "s.turns.length") == 2
    total_result_count = workbench(
        app,
        "s.turns.flatMap((turn) => turn.results).filter((result) => result.status === 'success').length",
    )
    assert app.page.get_by_test_id("titlebar-result-summary").inner_text() == f"{total_result_count} 张图"

    app.page.click('[data-testid="sidebar-new-design"]')
    app.page.wait_for_function(
        "() => window.__musefold_test.stores.workbench.getState().turns.length === 0",
    )
    app.page.wait_for_function(
        "() => document.querySelector('[data-testid=\"titlebar-title\"]')?.textContent === '新设计'",
    )


def test_workbench_session_ipc_is_registered_and_sidebar_loads(app):
    """会话 IPC 必须随主进程启动注册，侧栏不能暴露缺少 handler 的技术错误。"""
    result = app.api_ok(
        "workbenchSession.list",
        {"archived": False, "limit": 100, "offset": 0},
    )
    assert result["items"] == []
    assert result["total"] == 0

    app.set_view("generate")
    app.page.wait_for_selector('[data-testid="generation-workbench"]')
    app.page.wait_for_timeout(120)
    assert app.page.get_by_test_id("workbench-session-error").count() == 0
    assert "No handler registered" not in app.page.locator("body").inner_text()


def test_generation_surfaces_use_canonical_terminology(app):
    """CHT-09：顶层、工作台、历史和资产动作使用同一套产品语言。"""
    app.page.wait_for_selector('[data-testid="generation-workbench"]')
    body = app.page.locator("body").inner_text()
    assert "生成" in body
    assert "把想法变成可生成的视觉" in "".join(body.split()), "空态品牌提示语应可见"
    assert "对话生图" not in body
    assert "极速" not in body and "精修" not in body
    # 制作工作台不再有独立导航入口（Codex 逻辑：新设计 / 对话列表即入口）
    assert app.page.locator('[data-testid="nav-generate"]').count() == 0
    assert app.page.locator('[data-testid="sidebar-new-design"]').inner_text().strip().startswith("新设计")
    # TvT 预设保留服务商侧专有名词“创作台生图组”；本应用不再把它用作独立标题。
    assert app.page.get_by_text("创作台", exact=True).count() == 0

    app.set_view("history")
    app.page.locator('[data-testid="titlebar-title"]', has_text="生成历史").wait_for()
    assert "生成历史" in app.page.locator("body").inner_text()

    app.set_view("library")
    app.page.locator('[data-testid="titlebar-title"]', has_text="提示词库").wait_for()
    assert "提示词库" in app.page.locator("body").inner_text()

    app.page.evaluate("() => window.__musefold_test.stores.settings.getState().setSection('generation')")
    app.set_view("settings")
    app.page.wait_for_selector('[data-testid="settings-default-ratio-trigger"]')
    settings_text = app.page.locator("body").inner_text()
    # v2 设置整合：生成默认值并入「偏好」分区，卡内分组为「生成参数」。
    assert "偏好" in settings_text
    assert "生成参数" in settings_text
    assert "创作台偏好" not in settings_text


def test_command_palette_is_centered_and_stays_inside_viewport(app):
    """命令面板不能被入场动画的横向位移推到左侧或窄屏外。"""
    app.page.evaluate("() => window.__musefold_test.stores.app.getState().setCommandOpen(true)")
    app.page.wait_for_selector('[aria-label="命令面板"]')
    app.page.wait_for_timeout(240)

    def assert_palette_bounds(expected_center: bool):
        box = app.page.locator('[aria-label="命令面板"]').bounding_box()
        viewport = app.page.evaluate("() => ({ width: innerWidth, height: innerHeight })")
        assert box, box
        assert box["x"] >= 15, {"box": box, "viewport": viewport}
        assert box["x"] + box["width"] <= viewport["width"] - 15 + 1, {"box": box, "viewport": viewport}
        assert box["y"] >= 15, {"box": box, "viewport": viewport}
        assert box["y"] + box["height"] <= viewport["height"] - 15 + 1, {"box": box, "viewport": viewport}
        if expected_center:
            assert abs((box["x"] + box["width"] / 2) - viewport["width"] / 2) <= 1, {
                "box": box,
                "viewport": viewport,
            }

    assert_palette_bounds(expected_center=True)
    app.page.keyboard.press("Escape")
    app.page.wait_for_function('() => document.querySelector(\'[aria-label="命令面板"]\') === null')

    app.page.set_viewport_size({"width": 360, "height": 740})
    app.page.evaluate("() => window.__musefold_test.stores.app.getState().setCommandOpen(true)")
    app.page.wait_for_selector('[aria-label="命令面板"]')
    app.page.wait_for_timeout(240)
    assert_palette_bounds(expected_center=True)


def test_canonical_terminology_fits_narrow_workbench_layout(app, tmp_path):
    """CHT-09：新增长文案在桌面与 360px 窄屏不产生横向溢出。"""
    def assert_no_horizontal_overflow():
        metrics = app.page.evaluate(
            """() => ({
              viewport: window.innerWidth,
              documentWidth: document.documentElement.scrollWidth,
              bodyWidth: document.body.scrollWidth,
            })""",
        )
        assert metrics["documentWidth"] <= metrics["viewport"] + 1, metrics
        assert metrics["bodyWidth"] <= metrics["viewport"] + 1, metrics

    app.page.wait_for_selector('[data-testid="generation-workbench"]')
    app.page.screenshot(path=str(tmp_path / "generation-desktop.png"))
    assert_no_horizontal_overflow()

    app.page.set_viewport_size({"width": 360, "height": 740})
    app.page.wait_for_timeout(300)
    app.page.screenshot(path=str(tmp_path / "generation-narrow.png"))
    assert "把想法变成可生成的视觉" in "".join(app.page.locator("body").inner_text().split())
    assert_no_horizontal_overflow()

    if app.page.locator('[data-testid="workbench-reference-backdrop"]').count():
        app.page.locator('[data-testid="workbench-reference-backdrop"]').click(position={"x": 5, "y": 20})
    app.page.click('[data-testid="refine-ratio-trigger"]')
    app.page.wait_for_selector('[data-testid="refine-ratio-menu"]')
    app.page.screenshot(path=str(tmp_path / "generation-narrow-ratio-menu.png"))
    narrow_menu = app.page.locator('[data-testid="refine-ratio-menu"]').bounding_box()
    narrow_surface = app.page.locator('.mf-workbench-composer-surface').bounding_box()
    narrow_viewport = app.page.evaluate("() => ({ width: window.innerWidth, height: window.innerHeight })")
    assert narrow_menu and narrow_surface, {"menu": narrow_menu, "surface": narrow_surface}
    assert narrow_menu["x"] >= -1, narrow_menu
    assert narrow_menu["x"] + narrow_menu["width"] <= narrow_viewport["width"] + 1, {
        "menu": narrow_menu,
        "viewport": narrow_viewport,
    }
    assert narrow_menu["y"] + narrow_menu["height"] <= narrow_surface["y"] + 1, {
        "menu": narrow_menu,
        "surface": narrow_surface,
    }
    app.page.keyboard.press("Escape")
    app.page.wait_for_function("() => document.querySelector('[data-testid=\"refine-ratio-menu\"]') === null")

    app.page.evaluate("() => window.__musefold_test.stores.settings.getState().setSection('generation')")
    app.set_view("settings")
    # ≤680px 手机设置先落在导航页（settings-section-*），分区内容要点开分区才显示；
    # 681-959px 的横向 tabs（settings-mobile-section-*）在此宽度不渲染。
    app.page.wait_for_selector('[data-testid="settings-section-preferences"]')
    app.page.screenshot(path=str(tmp_path / "settings-mobile-menu.png"))
    app.page.click('[data-testid="settings-section-preferences"]')
    app.page.wait_for_selector('[data-testid="settings-default-ratio-trigger"]')
    app.page.screenshot(path=str(tmp_path / "settings-narrow.png"))
    assert "生成参数" in app.page.locator("body").inner_text()
    assert_no_horizontal_overflow()
    # v2：生成默认值与外观合并为「偏好」，同分区内即可见密度设置。
    assert "界面密度" in app.page.locator("body").inner_text()
    assert_no_horizontal_overflow()


def test_workbench_composer_uses_compact_options_popover(app, fake_workbench_server, tmp_path):
    """底部 Composer 以输入为主，质量/数量/负面词按需进入共享设置浮层。"""
    setup_provider(app, fake_workbench_server)
    app.page.wait_for_selector('[data-testid="workbench-composer"]')
    assert app.page.locator('[data-testid="workbench-generation-options"]').count() == 0
    assert app.page.locator('[data-testid="refine-quality-high"]').count() == 0
    assert app.page.locator('[data-testid="refine-count-4"]').count() == 0

    ratio_trigger = app.page.locator('[data-testid="refine-ratio-trigger"]').bounding_box()
    submit = app.page.locator('[data-testid="refine-generate"]')
    submit_box = submit.bounding_box()
    assert ratio_trigger and ratio_trigger["height"] <= 34, ratio_trigger
    assert submit.evaluate("node => node.tagName") == "BUTTON"
    assert submit_box and abs(submit_box["width"] - submit_box["height"]) <= 1, submit_box
    assert "生成图像" in (submit.get_attribute("aria-label") or "")

    options_trigger = app.page.locator('[data-testid="workbench-more-settings"]')
    options_label = options_trigger.locator("span")
    assert options_label.evaluate("node => node.scrollWidth <= node.clientWidth + 1")
    fixed_slots = {
        test_id: app.page.locator(f'[data-testid="{test_id}"]').bounding_box()["width"]
        for test_id in (
            "refine-ratio-trigger",
            "workbench-more-settings",
        )
    }
    options_trigger.click()
    app.page.wait_for_selector('[data-testid="workbench-generation-options"]')
    app.page.wait_for_timeout(220)
    app.page.screenshot(path=str(tmp_path / "generation-settings-desktop.png"))
    settings_menu = app.page.locator('[data-testid="workbench-generation-options"]').bounding_box()
    settings_surface = app.page.locator('.mf-workbench-composer-surface').bounding_box()
    assert settings_menu and settings_surface, {
        "menu": settings_menu,
        "surface": settings_surface,
    }
    assert settings_menu["y"] + settings_menu["height"] <= settings_surface["y"] + 1, {
        "menu": settings_menu,
        "surface": settings_surface,
    }
    assert app.page.locator('[data-testid="workbench-generation-options"] [role="radiogroup"]').count() == 2
    app.page.click('[data-testid="refine-quality-low"]')
    app.page.click('[data-testid="refine-count-2"]')
    app.page.fill('[data-testid="refine-negative"]', "no text, no watermark")
    assert workbench(app, "s.params.quality") == "low"
    assert workbench(app, "s.params.n") == 2
    assert workbench(app, "s.draftNegativePrompt") == "no text, no watermark"
    app.page.keyboard.press("Escape")
    app.page.click('[data-testid="refine-ratio-trigger"]')
    app.page.wait_for_selector('[data-testid="refine-ratio-menu"]')
    app.page.click('[data-testid="refine-ratio-2:3"]')
    app.page.wait_for_function(
        "() => window.__musefold_test.stores.workbench.getState().params.ratioId === '2:3'",
    )
    for test_id, width in fixed_slots.items():
        current = app.page.locator(f'[data-testid="{test_id}"]').bounding_box()
        assert current and abs(current["width"] - width) <= 0.5, {"test_id": test_id, "before": width, "after": current}
    app.page.keyboard.press("Escape")
    app.page.wait_for_function(
        "() => document.querySelector('[data-testid=\"refine-ratio-menu\"]') === null",
    )
    options_trigger.click()
    app.page.wait_for_selector('[data-testid="workbench-generation-options"]')
    app.page.keyboard.press("Escape")
    app.page.wait_for_function(
        "() => document.querySelector('[data-testid=\"workbench-generation-options\"]') === null",
    )
    assert options_trigger.evaluate("node => document.activeElement === node")


def test_workbench_composer_options_popover_fits_narrow_viewport(app, fake_workbench_server):
    """窄视口的 Composer 设置浮层保持在视口内并位于 Composer 上方。"""
    setup_provider(app, fake_workbench_server)
    app.page.wait_for_selector('[data-testid="workbench-composer"]')
    app.page.set_viewport_size({"width": 360, "height": 740})
    options_trigger = app.page.locator('[data-testid="workbench-more-settings"]')
    options_trigger.click()
    app.page.wait_for_selector('[data-testid="workbench-generation-options"]')
    menu = app.page.locator('[data-testid="workbench-generation-options"]').bounding_box()
    surface = app.page.locator('.mf-workbench-composer-surface').bounding_box()
    assert menu and menu["x"] >= 15, menu
    assert menu["x"] + menu["width"] <= 345, menu
    assert surface and menu["y"] + menu["height"] <= surface["y"] + 1, {
        "menu": menu,
        "surface": surface,
    }
    metrics = app.page.evaluate(
        "() => ({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth })",
    )
    assert metrics["documentWidth"] <= metrics["viewport"] + 1, metrics
    assert metrics["bodyWidth"] <= metrics["viewport"] + 1, metrics


def test_ratio_picker_uses_custom_preview_cards_in_workbench_and_settings(app):
    """比例选择不用原生 select；工作台与设置页都显示可感知横竖方向的预览卡。"""
    app.page.wait_for_selector('[data-testid="refine-ratio-trigger"]')
    assert app.page.locator("select").count() == 0
    assert app.page.locator('[data-testid="refine-ratio-trigger"]').evaluate("el => el.tagName") == "BUTTON"

    app.page.click('[data-testid="refine-ratio-trigger"]')
    app.page.wait_for_selector('[data-testid="refine-ratio-menu"]')
    assert app.page.locator('[data-testid="refine-ratio-menu"] [role="listbox"]').count() == 1
    workbench_menu = app.page.locator('[data-testid="refine-ratio-menu"]').bounding_box()
    workbench_surface = app.page.locator('.mf-workbench-composer-surface').bounding_box()
    workbench_viewport = app.page.evaluate("() => ({ width: window.innerWidth, height: window.innerHeight })")
    assert workbench_menu and workbench_surface, {
        "menu": workbench_menu,
        "surface": workbench_surface,
    }
    assert workbench_menu["x"] >= -1, workbench_menu
    assert workbench_menu["x"] + workbench_menu["width"] <= workbench_viewport["width"] + 1, {
        "menu": workbench_menu,
        "viewport": workbench_viewport,
    }
    assert workbench_menu["y"] + workbench_menu["height"] <= workbench_surface["y"] + 1, {
        "menu": workbench_menu,
        "surface": workbench_surface,
    }
    assert app.page.locator('[data-testid="refine-ratio-menu-summary-preview"]').count() == 0
    assert app.page.locator('[data-testid="refine-ratio-menu"] [role="option"]').count() == 11
    wide = app.page.locator('[data-testid="refine-ratio-16:9-preview"]').bounding_box()
    tall = app.page.locator('[data-testid="refine-ratio-9:16-preview"]').bounding_box()
    product_tall = app.page.locator('[data-testid="refine-ratio-4:5-preview"]').bounding_box()
    product_wide = app.page.locator('[data-testid="refine-ratio-5:4-preview"]').bounding_box()
    ultra_wide = app.page.locator('[data-testid="refine-ratio-21:9-preview"]').bounding_box()
    assert wide and wide["width"] > wide["height"], wide
    assert tall and tall["height"] > tall["width"], tall
    assert product_tall and product_tall["height"] > product_tall["width"], product_tall
    assert product_wide and product_wide["width"] > product_wide["height"], product_wide
    assert ultra_wide and ultra_wide["width"] > ultra_wide["height"] * 2, ultra_wide
    assert app.page.locator('[data-testid="refine-ratio-16:9"]').get_attribute("role") == "option"
    for ratio in ("1:1", "2:3", "4:5", "9:16", "16:9", "21:9"):
        card = app.page.locator(f'[data-testid="refine-ratio-{ratio}"]').bounding_box()
        preview = app.page.locator(f'[data-testid="refine-ratio-{ratio}-preview"]').bounding_box()
        assert card and preview, {"ratio": ratio, "card": card, "preview": preview}
        assert preview["x"] >= card["x"] - 1, {"ratio": ratio, "card": card, "preview": preview}
        assert preview["y"] >= card["y"] - 1, {"ratio": ratio, "card": card, "preview": preview}
        assert preview["x"] + preview["width"] <= card["x"] + card["width"] + 1, {"ratio": ratio, "card": card, "preview": preview}
        assert preview["y"] + preview["height"] <= card["y"] + card["height"] + 1, {"ratio": ratio, "card": card, "preview": preview}
    # v2.0:空态 Composer 内联后菜单位于页面中部,可用高度变小、菜单内部滚动;
    # 先把「自动」卡滚进菜单视口再断言包含关系。
    auto_option = app.page.locator('[data-testid="refine-ratio-auto"]')
    auto_option.scroll_into_view_if_needed()
    last_card = auto_option.bounding_box()
    workbench_menu = app.page.locator('[data-testid="refine-ratio-menu"]').bounding_box()
    assert last_card and last_card["y"] + last_card["height"] <= workbench_menu["y"] + workbench_menu["height"] + 1
    app.page.click('[data-testid="refine-ratio-9:16"]')
    app.page.wait_for_function(
        """() => {
            const box = document.querySelector('[data-testid="refine-ratio-selected-preview"]')?.getBoundingClientRect();
            return box && box.height > box.width;
        }""",
    )
    selected_preview = app.page.locator('[data-testid="refine-ratio-selected-preview"]').bounding_box()
    assert selected_preview and selected_preview["height"] > selected_preview["width"], selected_preview
    app.page.keyboard.press("Escape")
    app.page.wait_for_function("() => document.querySelector('[data-testid=\"refine-ratio-menu\"]') === null")

    app.page.evaluate("() => window.__musefold_test.stores.settings.getState().setSection('generation')")
    app.set_view("settings")
    # 设置页画幅已收敛为与工作台同款下拉：触发器常驻反映当前值，画幅示意在弹出菜单里
    app.page.wait_for_selector('[data-testid="settings-default-ratio-trigger"][data-value="9:16"]')
    assert app.page.locator("select").count() == 0
    trigger_preview = app.page.locator('[data-testid="settings-default-ratio-selected-preview"]').bounding_box()
    assert trigger_preview and trigger_preview["height"] > trigger_preview["width"], trigger_preview

    app.page.click('[data-testid="settings-default-ratio-trigger"]')
    app.page.wait_for_selector('[data-testid="settings-default-ratio-menu"]')
    app.page.wait_for_function(
        """() => {
            const card = document.querySelector('[data-testid="settings-default-ratio-9:16"]')?.getBoundingClientRect();
            const preview = document.querySelector('[data-testid="settings-default-ratio-9:16-preview"]')?.getBoundingClientRect();
            return card && preview && preview.height > preview.width && preview.bottom <= card.bottom + 1;
        }""",
    )
    settings_summary = app.page.locator('[data-testid="settings-default-ratio-menu-summary"]').bounding_box()
    assert settings_summary, settings_summary
    settings_wide = app.page.locator('[data-testid="settings-default-ratio-16:9-preview"]').bounding_box()
    settings_tall = app.page.locator('[data-testid="settings-default-ratio-9:16-preview"]').bounding_box()
    settings_classic = app.page.locator('[data-testid="settings-default-ratio-4:3-preview"]').bounding_box()
    settings_product_tall = app.page.locator('[data-testid="settings-default-ratio-4:5-preview"]').bounding_box()
    assert settings_wide and settings_wide["width"] > settings_wide["height"], settings_wide
    assert settings_tall and settings_tall["height"] > settings_tall["width"], settings_tall
    assert settings_classic and settings_classic["width"] > settings_classic["height"], settings_classic
    assert settings_product_tall and settings_product_tall["height"] > settings_product_tall["width"], settings_product_tall
    settings_card = app.page.locator('[data-testid="settings-default-ratio-9:16"]').bounding_box()
    assert settings_card and settings_tall
    assert settings_tall["y"] + settings_tall["height"] <= settings_card["y"] + settings_card["height"] + 1, {
        "card": settings_card,
        "preview": settings_tall,
    }

    app.page.click('[data-testid="settings-default-ratio-16:9"]')
    app.page.wait_for_function(
        "() => window.__musefold_test.stores.workbench.getState().params.ratioId === '16:9'",
        timeout=5_000,
    )
    # 选择后菜单自动收起，触发器反映新值
    app.page.wait_for_function("() => document.querySelector('[data-testid=\"settings-default-ratio-menu\"]') === null")
    assert app.page.locator('[data-testid="settings-default-ratio-trigger"]').get_attribute("data-value") == "16:9"


def test_workbench_pastes_and_drops_images_into_clickable_reference_preview(app):
    surface = app.page.locator('[data-testid="workbench-composer-surface"]')
    surface.wait_for(state="visible")
    image_input = app.page.locator('[data-testid="workbench-image-input"]')

    image_input.set_input_files({
        "name": "picker-reference.png",
        "mimeType": "image/png",
        "buffer": base64.b64decode(PNG_1PX_B64),
    })
    app.page.wait_for_function(
        "() => window.__musefold_test.stores.workbench.getState().draftImages[0]?.name === 'picker-reference.png'",
    )
    preview_box = app.page.locator('[data-testid="workbench-draft-images"]').bounding_box()
    composer_box = surface.bounding_box()
    assert preview_box and composer_box
    assert preview_box["y"] + preview_box["height"] <= composer_box["y"] + 1, {
        "preview": preview_box,
        "composer": composer_box,
    }
    picked = workbench(app, "s.draftImages[0]")
    assert Path(picked["path"]).is_file()
    app.page.click('[data-testid="workbench-draft-image-remove"]')

    def dispatch_image(event_name: str, file_name: str):
        app.page.evaluate(
            """({ eventName, fileName, encoded }) => {
              const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
              const file = new File([bytes], fileName, { type: 'image/png' });
              const transfer = new DataTransfer();
              transfer.items.add(file);
              const target = document.querySelector('[data-testid="workbench-composer-surface"]');
              const event = eventName === 'paste'
                ? new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true })
                : new DragEvent(eventName, { dataTransfer: transfer, bubbles: true, cancelable: true });
              target.dispatchEvent(event);
            }""",
            {"eventName": event_name, "fileName": file_name, "encoded": PNG_1PX_B64},
        )

    dispatch_image("paste", "clipboard-reference.png")
    app.page.wait_for_function(
        "() => window.__musefold_test.stores.workbench.getState().draftImages[0]?.name === 'clipboard-reference.png'",
    )
    pasted = workbench(app, "s.draftImages[0]")
    assert Path(pasted["path"]).is_file()
    app.page.click('[data-testid="workbench-draft-image-preview"]')
    app.page.wait_for_selector('[data-testid="image-lightbox"]')
    app.page.keyboard.press("Escape")
    app.page.click('[data-testid="workbench-draft-image-remove"]')

    dispatch_image("dragenter", "dropped-reference.png")
    app.page.wait_for_selector('[data-testid="workbench-image-drop-overlay"]')
    assert surface.get_attribute("data-drag-active") == "true"
    dispatch_image("drop", "dropped-reference.png")
    app.page.wait_for_function(
        "() => window.__musefold_test.stores.workbench.getState().draftImages[0]?.name === 'dropped-reference.png'",
    )
    assert surface.get_attribute("data-drag-active") == "false"
    dropped = workbench(app, "s.draftImages[0]")
    assert Path(dropped["path"]).is_file()


def test_multi_selection_can_collapse_to_one_refinement_target(app, fake_workbench_server):
    setup_provider(app, fake_workbench_server)
    choose_count(app, 4)
    app.page.fill('[data-workbench-testid="workbench-prompt"]', "four refinement candidates")
    app.page.click('[data-workbench-testid="workbench-submit"]')
    settle(app)

    app.page.click('[data-testid="generation-select-images"]')
    cards = app.page.locator('[data-testid="generate-result-card"]')
    assert cards.count() == 4
    cards.nth(0).locator('[data-testid="result-zoom"]').click()
    cards.nth(1).locator('[data-testid="result-zoom"]').click()
    assert cards.nth(0).get_attribute("data-selected") == "true"
    assert cards.nth(1).get_attribute("data-selected") == "true"

    target_history_id = cards.nth(1).get_attribute("data-history-id")
    cards.nth(1).locator('[data-testid="result-set-refinement-target"]').click()
    assert cards.nth(0).get_attribute("data-deselecting") == "true"
    assert cards.nth(1).get_attribute("data-selected") == "true"

    app.page.wait_for_selector('[data-testid="workbench-refinement-context"]')
    assert workbench(app, "s.refinementContext.historyId") == target_history_id
    assert app.page.locator('[data-testid="generate-result-card"][data-selected="true"]').count() == 0


def test_workbench_message_actions_ratio_constraint_and_result_viewport_height(app, fake_workbench_server):
    setup_provider(app, fake_workbench_server)
    app.page.set_viewport_size({"width": 1180, "height": 820})
    choose_count(app, 1)
    app.page.click('[data-testid="refine-ratio-trigger"]')
    app.page.click('[data-testid="refine-ratio-16:9"]')
    first_prompt = "single cinematic product image"
    app.page.fill('[data-workbench-testid="workbench-prompt"]', first_prompt)
    app.page.click('[data-workbench-testid="workbench-submit"]')
    settle(app)

    assert fake_workbench_server["requests"][0]["body"]["prompt"] == constrained_prompt(first_prompt, "16:9")
    first_turn = app.page.locator('article[data-testid^="generation-turn-"]').first
    first_card = first_turn.locator('[data-testid="generate-result-card"]').bounding_box()
    composer = app.page.locator('[data-testid="workbench-composer-surface"]').bounding_box()
    assert first_card and first_card["height"] <= 820 * 0.5, first_card
    assert composer and first_card["y"] + first_card["height"] <= composer["y"] + 1, {
        "card": first_card,
        "composer": composer,
    }
    session_id = workbench(app, "s.activeSessionId")
    session_row = app.page.locator(f'[data-conversation-row="{session_id}"]')
    assert session_row.get_attribute("data-conversation-kind") == "chat"
    # 完成时用户正在工作台查看，会话视为已读，不显示状态光晕
    assert session_row.locator('[data-testid="conversation-status-dot"]').count() == 0

    choose_count(app, 2)
    app.page.click('[data-testid="refine-ratio-trigger"]')
    app.page.click('[data-testid="refine-ratio-9:16"]')
    second_prompt = "two portrait poster directions"
    app.page.fill('[data-workbench-testid="workbench-prompt"]', second_prompt)
    app.page.click('[data-workbench-testid="workbench-submit"]')
    settle(app)

    second_turn = app.page.locator('article[data-testid^="generation-turn-"]').last
    cards = second_turn.locator('[data-testid="generate-result-card"]')
    assert cards.count() == 2
    for index in range(2):
        box = cards.nth(index).bounding_box()
        assert box and box["height"] <= 820 * 0.4, {"index": index, "box": box}
    assert fake_workbench_server["requests"][-1]["body"]["prompt"] == constrained_prompt(second_prompt, "9:16")


    app.page.evaluate(
        """() => {
          window.__musefold_copiedMessage = null;
          navigator.clipboard.writeText = async (text) => { window.__musefold_copiedMessage = text; };
        }"""
    )
    second_turn.locator('[data-testid="generation-prompt"]').click()
    second_turn.locator('[data-testid="generation-user-message-actions"]').wait_for(state="visible")
    second_turn.locator('[data-testid="generation-user-message-copy"]').click()
    app.page.wait_for_function("() => window.__musefold_copiedMessage !== null")
    assert app.page.evaluate("() => window.__musefold_copiedMessage") == second_prompt

    request_count = len(fake_workbench_server["requests"])
    second_turn.locator('[data-testid="generation-user-message-edit"]').click()
    assert app.page.input_value('[data-workbench-testid="workbench-prompt"]') == second_prompt
    assert workbench(app, "s.params.n") == 2
    assert len(fake_workbench_server["requests"]) == request_count
    app.page.wait_for_function(
        "() => document.activeElement === document.querySelector('[data-workbench-testid=\\\"workbench-prompt\\\"]')",
        timeout=2_000,
    )


def test_existing_session_composer_stays_centered_above_mainview_bottom(app, fake_workbench_server):
    setup_provider(app, fake_workbench_server)
    app.page.set_viewport_size({"width": 940, "height": 600})
    app.page.fill('[data-workbench-testid="workbench-prompt"]', "已有会话 Composer 定位探针")
    app.page.click('[data-workbench-testid="workbench-submit"]')
    settle(app)

    def assert_geometry():
        geometry = app.page.evaluate(
            """() => {
              const mainview = document.querySelector('[data-testid="mainview-surface"]')?.getBoundingClientRect();
              const workbench = document.querySelector('[data-testid="generation-workbench"]')?.getBoundingClientRect();
              const composer = document.querySelector('[data-testid="workbench-composer-surface"]')?.getBoundingClientRect();
              return { mainview, workbench, composer };
            }"""
        )
        assert geometry["mainview"] and geometry["workbench"] and geometry["composer"], geometry
        mainview = geometry["mainview"]
        workbench_box = geometry["workbench"]
        composer = geometry["composer"]
        composer_center = composer["left"] + composer["width"] / 2
        workbench_center = workbench_box["left"] + workbench_box["width"] / 2
        assert abs(composer_center - workbench_center) <= 1, geometry
        assert composer["top"] >= workbench_box["top"], geometry
        assert composer["bottom"] <= mainview["bottom"] + 1, geometry
        assert 8 <= mainview["bottom"] - composer["bottom"] <= 24, geometry

    assert_geometry()

    session_id = workbench(app, "s.activeSessionId")
    app.page.locator(f'[data-conversation-row="{session_id}"] .mf-workbench-session-open').click()
    settle(app)
    app.page.wait_for_selector('[data-testid="workbench-composer-surface"]')
    assert_geometry()


def test_single_workbench_groups_runs_into_one_persisted_session(app, fake_workbench_server):
    setup_provider(app, fake_workbench_server)
    app.page.fill('[data-workbench-testid="workbench-prompt"]', "a first visual direction")
    app.page.click('[data-workbench-testid="workbench-submit"]')
    settle(app)

    first = workbench(app, "s.turns[0]")
    assert first["params"]["n"] == 4
    assert len(first["results"]) == 4
    assert all(result["status"] == "success" for result in first["results"])
    assert len(fake_workbench_server["requests"]) == 4

    choose_count(app, 1)
    app.page.fill('[data-workbench-testid="workbench-prompt"]', "a more precise second direction")
    app.page.click('[data-workbench-testid="workbench-submit"]')
    settle(app)
    second = workbench(app, "s.turns[1]")
    assert second["params"]["n"] == 1
    assert len(fake_workbench_server["requests"]) == 5

    rows = app.db_query("SELECT status, params FROM history ORDER BY created_at ASC, rowid ASC")
    assert len(rows) == 5
    assert all("generationMode" not in json.loads(row["params"]) for row in rows)
    session_id = workbench(app, "s.activeSessionId")
    sessions = app.db_query("SELECT id, title FROM workbench_sessions")
    assert sessions == [{"id": session_id, "title": "a first visual direction"}]
    runs = app.db_query(
        "SELECT workbench_session_id, turn_index, result_index "
        "FROM generation_runs ORDER BY turn_index, result_index",
    )
    assert len(runs) == 5
    assert {row["workbench_session_id"] for row in runs} == {session_id}
    assert [row["turn_index"] for row in runs] == [0, 0, 0, 0, 1]
    assert [row["result_index"] for row in runs] == [0, 1, 2, 3, 0]


def test_workbench_refinement_creates_child_run_and_preserves_snapshots(app, fake_workbench_server):
    setup_provider(app, fake_workbench_server)
    choose_count(app, 1)
    app.page.fill('[data-workbench-testid="workbench-prompt"]', "微调主课题")

    app.page.click('[data-workbench-testid="workbench-submit"]')
    settle(app)
    parent = workbench(app, "s.turns[0]")
    parent_result = parent["results"][0]

    app.page.click('[data-testid="generation-refine-turn"]')
    app.page.wait_for_selector('[data-testid="workbench-refinement-context"]')
    app.page.fill('[data-testid="refine-prompt"]', "减少文字，增加留白")
    app.page.click('[data-testid="refine-generate"]')
    settle(app)

    child = workbench(app, "s.turns[1]")
    child_result = child["results"][0]
    assert child["status"] == "success"
    assert child["parentHistoryId"] == parent_result["historyId"]
    assert child["userPrompt"] == "减少文字，增加留白"
    # 微调把目标图作为参考图 1 发送，提示词前会统一加目标图说明段
    assert child["prompt"] == f'图 1 为本次微调目标。\n\n{parent["prompt"]}\n\n微调要求：\n减少文字，增加留白'
    assert child_result["status"] == "success"
    assert Path(child_result["imagePath"]).is_file()
    assert len(fake_workbench_server["requests"]) == 2
    assert fake_workbench_server["requests"][1]["body"]["prompt"].replace("\r\n", "\n") == child["prompt"]

    runs = app.db_query(
        "SELECT id, run_kind, parent_run_id, retry_of_run_id, source_asset_id, "
        "user_prompt, base_prompt, refinement_instruction, final_prompt, "
        "prompt_snapshot_json, status "
        "FROM generation_runs ORDER BY created_at ASC, id ASC",
    )
    assert len(runs) == 2
    assert runs[0]["run_kind"] == "free_generation"
    assert runs[1]["run_kind"] == "refinement"
    assert runs[1]["parent_run_id"] == parent_result["historyId"]
    assert runs[1]["retry_of_run_id"] is None
    assert runs[1]["source_asset_id"] == parent_result["historyId"]
    assert runs[1]["user_prompt"] == "减少文字，增加留白"
    assert runs[1]["base_prompt"] == runs[0]["final_prompt"]
    assert runs[1]["refinement_instruction"] == "减少文字，增加留白"
    assert runs[1]["final_prompt"] == child["prompt"]
    assert json.loads(runs[1]["prompt_snapshot_json"])["refinementInstruction"] == "减少文字，增加留白"
    assert runs[1]["status"] == "success"


def test_workbench_free_generation_can_be_refined_as_asset(app, fake_workbench_server):
    setup_provider(app, fake_workbench_server)
    choose_count(app, 1)
    app.page.fill('[data-workbench-testid="workbench-prompt"]', "plain free image")
    app.page.click('[data-workbench-testid="workbench-submit"]')
    settle(app)
    parent = workbench(app, "s.turns[0]")
    parent_result = parent["results"][0]

    app.page.click('[data-testid="generation-refine-turn"]')
    app.page.wait_for_selector('[data-testid="workbench-refinement-context"]')
    app.page.fill('[data-testid="refine-prompt"]', "增加留白")
    app.page.click('[data-testid="refine-generate"]')
    settle(app)

    child = workbench(app, "s.turns[1]")
    child_result = child["results"][0]
    assert child_result["status"] == "success"
    assert child["parentHistoryId"] == parent_result["historyId"]
    assert child["userPrompt"] == "增加留白"
    assert len(fake_workbench_server["requests"]) == 2

    runs = app.db_query(
        "SELECT id, run_kind, parent_run_id, source_asset_id, "
        "refinement_instruction, final_prompt, status "
        "FROM generation_runs ORDER BY created_at ASC, id ASC",
    )
    assert len(runs) == 2
    assert runs[0]["run_kind"] == "free_generation"
    assert runs[0]["status"] == "success"
    assert runs[1]["run_kind"] == "refinement"
    assert runs[1]["parent_run_id"] == parent_result["historyId"]
    assert runs[1]["source_asset_id"] == parent_result["historyId"]
    assert runs[1]["refinement_instruction"] == "增加留白"
    assert runs[1]["final_prompt"] == child["prompt"]
    assert runs[1]["status"] == "success"


def test_workbench_refinement_failure_keeps_child_relationship_and_can_retry(
    app,
    refinement_failing_workbench_server,
):
    setup_provider(app, refinement_failing_workbench_server)
    choose_count(app, 1)
    app.page.fill('[data-workbench-testid="workbench-prompt"]', "失败微调课题")

    app.page.click('[data-workbench-testid="workbench-submit"]')
    settle(app)
    parent = workbench(app, "s.turns[0]")
    parent_result = parent["results"][0]
    app.page.click('[data-testid="generation-refine-turn"]')
    app.page.wait_for_selector('[data-testid="workbench-refinement-context"]')
    app.page.fill('[data-testid="refine-prompt"]', "只保留核心节点")
    app.page.click('[data-testid="refine-generate"]')
    settle(app)

    child = workbench(app, "s.turns[1]")
    child_result = child["results"][0]
    assert child_result["status"] == "failed"
    assert child["parentHistoryId"] == parent_result["historyId"]
    assert child["userPrompt"] == "只保留核心节点"
    assert child_result["historyId"]
    assert len(refinement_failing_workbench_server["requests"]) == 2
    failed_run = app.db_query(
        "SELECT run_kind, parent_run_id, source_asset_id, refinement_instruction, status, error_code "
        "FROM generation_runs WHERE id = ?",
        (child_result["historyId"],),
    )
    assert failed_run == [{
        "run_kind": "refinement",
        "parent_run_id": parent_result["historyId"],
        "source_asset_id": parent_result["historyId"],
        "refinement_instruction": "只保留核心节点",
        "status": "failed",
        "error_code": "BAD_REQUEST",
    }]

    app.page.click('[data-testid="result-retry"]')
    settle(app)
    retried = workbench(app, "s.turns[1].results[0]")
    assert retried["status"] == "success"
    assert retried["historyId"] != child_result["historyId"]
    retry_run = app.db_query(
        "SELECT run_kind, parent_run_id, retry_of_run_id, source_asset_id, "
        "refinement_instruction, status FROM generation_runs WHERE id = ?",
        (retried["historyId"],),
    )
    assert retry_run == [{
        "run_kind": "retry",
        "parent_run_id": parent_result["historyId"],
        "retry_of_run_id": child_result["historyId"],
        "source_asset_id": parent_result["historyId"],
        "refinement_instruction": "只保留核心节点",
        "status": "success",
    }]
    assert len(refinement_failing_workbench_server["requests"]) == 3


def test_workbench_refinement_cancel_keeps_child_snapshot(app, refinement_hanging_workbench_server):
    setup_provider(app, refinement_hanging_workbench_server)
    choose_count(app, 1)
    app.page.fill('[data-workbench-testid="workbench-prompt"]', "取消微调课题")

    app.page.click('[data-workbench-testid="workbench-submit"]')
    settle(app)
    parent = workbench(app, "s.turns[0]")
    parent_result = parent["results"][0]
    app.page.click('[data-testid="generation-refine-turn"]')
    app.page.wait_for_selector('[data-testid="workbench-refinement-context"]')
    app.page.fill('[data-testid="refine-prompt"]', "增加右侧说明")
    app.page.click('[data-testid="refine-generate"]')
    refinement_hanging_workbench_server["second_started"].wait(timeout=10)
    app.page.click('[data-workbench-testid="workbench-cancel"]')
    settle(app, timeout=30_000)

    child = workbench(app, "s.turns[1]")
    child_result = child["results"][0]
    assert child_result["status"] == "cancelled"
    assert child["parentHistoryId"] == parent_result["historyId"]
    cancelled_run = app.db_query(
        "SELECT run_kind, parent_run_id, source_asset_id, refinement_instruction, status, error_code "
        "FROM generation_runs WHERE id = ?",
        (child_result["historyId"],),
    )
    assert cancelled_run == [{
        "run_kind": "refinement",
        "parent_run_id": parent_result["historyId"],
        "source_asset_id": parent_result["historyId"],
        "refinement_instruction": "增加右侧说明",
        "status": "cancelled",
        "error_code": None,
    }]


def test_workbench_turn_saves_prompt_to_library_with_feedback_and_dedupe(app, fake_workbench_server):
    """CHT-05：探索回合可存为提示词；失败不静默，成功后可查看且不会重复入库。"""
    setup_provider(app, fake_workbench_server)
    prompt = "workbench save prompt ABCDEFGHIJKLMNOPQRSTUVWXYZ 1234567890 full body kept"
    final_prompt = constrained_prompt(prompt)
    app.page.fill('[data-workbench-testid="workbench-prompt"]', prompt)
    app.page.click('[data-workbench-testid="workbench-submit"]')
    settle(app)

    app.page.keyboard.press("Escape")
    app.page.locator('[data-testid="generation-turn-more"]').first.click()
    save = app.page.locator('[data-testid="generation-turn-save-prompt"]').first
    set_prompt_create_failure(app, True)
    try:
        save.click()
        app.page.wait_for_function(
            "() => document.body.innerText.includes('存为提示词失败') && "
            "document.body.innerText.includes('simulated create failure')",
            timeout=5_000,
        )
        assert prompt_rows_by_content(app, final_prompt) == []
    finally:
        set_prompt_create_failure(app, False)

    app.page.keyboard.press("Escape")
    app.page.locator('[data-testid="generation-turn-more"]').first.click()
    save = app.page.locator('[data-testid="generation-turn-save-prompt"]').first
    save.click()
    app.page.wait_for_function(
        "() => document.body.innerText.includes('已存为提示词')",
        timeout=5_000,
    )
    app.page.locator('[data-testid="generation-turn-more"]').first.click()
    save = app.page.locator('[data-testid="generation-turn-save-prompt"]').first
    app.page.wait_for_function(
        "() => document.querySelector('[data-testid=\"generation-turn-save-prompt\"]')?.innerText.includes('已存为提示词')",
        timeout=5_000,
    )
    rows = prompt_rows_by_content(app, final_prompt)
    assert len(rows) == 1
    created_id = rows[0]["id"]
    assert rows[0]["title"] == prompt[:40]
    assert rows[0]["content"] == final_prompt
    assert rows[0]["content_negative"] is None
    assert rows[0]["source"] == "manual"
    linked_history = app.db_query(
        "SELECT id, prompt_id, image_path FROM history WHERE prompt_text = ? ORDER BY created_at ASC, rowid ASC",
        (final_prompt,),
    )
    assert len(linked_history) == 4
    assert all(item["prompt_id"] == created_id for item in linked_history)
    assert rows[0]["source_url"] in {f'history://{item["id"]}' for item in linked_history}
    source_history_id = rows[0]["source_url"].removeprefix("history://")
    source_history = next(item for item in linked_history if item["id"] == source_history_id)
    assert rows[0]["preview_image_path"] == source_history["image_path"]
    assert "已存为提示词" in save.inner_text()
    assert save.is_disabled()

    app.page.click('[data-testid="toast-action"]')
    app.page.wait_for_function("() => window.__musefold_test?.getView?.() === 'library'", timeout=5_000)
    # 高亮意图落在列表：该行被选中并滚进视野；进详情后相关作品内联展示
    app.page.wait_for_selector(f'[data-testid="prompt-row"][data-prompt-id="{created_id}"]')
    app.page.click(f'[data-prompt-id="{created_id}"] [data-testid="prompt-row-open"]')
    app.page.wait_for_selector(f'[data-testid="prompt-detail"][data-prompt-id="{created_id}"]')
    app.page.wait_for_function(
        "() => document.querySelectorAll('[data-testid=\"prompt-work-image\"]').length === 4",
    )
    # 查看流程不得重复入库：合成串仍只有一条，原始输入串不会另立一条
    assert len(prompt_rows_by_content(app, final_prompt)) == 1
    assert prompt_rows_by_content(app, prompt) == []


def test_settings_update_workbench_defaults_without_erasing_prompt(app, fake_workbench_server):
    setup_provider(app, fake_workbench_server)
    app.page.evaluate("() => window.__musefold_test.stores.settings.getState().setSection('generation')")
    app.set_view("settings")
    app.page.wait_for_selector('[data-testid="settings-default-background-transparent"]')
    assert app.page.locator('[data-testid="settings-default-ratio-trigger"]').is_visible()
    app.page.click('[data-testid="settings-default-background-transparent"]')
    # 画幅下拉：打开菜单核对示意方向，选择后自动收起
    app.page.click('[data-testid="settings-default-ratio-trigger"]')
    app.page.wait_for_selector('[data-testid="settings-default-ratio-menu"]')
    portrait = app.page.locator('[data-testid="settings-default-ratio-9:16-preview"]').bounding_box()
    landscape = app.page.locator('[data-testid="settings-default-ratio-16:9-preview"]').bounding_box()
    assert portrait and portrait["height"] > portrait["width"], "画幅菜单应显示竖向示意"
    assert landscape and landscape["width"] > landscape["height"], "画幅菜单应显示横向示意"
    app.page.click('[data-testid="settings-default-ratio-16:9"]')
    app.page.wait_for_function("() => document.querySelector('[data-testid=\"settings-default-ratio-menu\"]') === null")
    app.page.click('[data-testid="settings-default-count-2"]')
    app.page.evaluate("() => window.__musefold_test.stores.workbench.getState().setDraftPrompt('keep me')")
    app.set_view("generate")
    app.page.wait_for_selector('[data-workbench-testid="workbench-prompt"]')

    state = workbench(app, "({ prompt: s.draftPrompt, background: s.params.background, ratio: s.params.ratioId, count: s.params.n })")
    assert state == {"prompt": "keep me", "background": "transparent", "ratio": "16:9", "count": 2}

    app.page.reload()
    app.page.wait_for_selector('[data-testid="generation-workbench"]')
    persisted = workbench(app, "({ background: s.params.background, ratio: s.params.ratioId, count: s.params.n })")
    assert persisted == {"background": "transparent", "ratio": "16:9", "count": 2}


def test_workbench_uses_global_provider_switch_without_leaking_keys(app, fake_workbench_server):
    """服务商由侧栏全局入口切换，Composer 不复制模型管理且不泄露 Key。"""
    first = app.api_ok("provider.create", {
        "name": "Workbench Provider A",
        "type": "openai-compatible",
        "baseUrl": fake_workbench_server["base"],
        "model": "gpt-image-2",
        "isActive": True,
    })
    second = app.api_ok("provider.create", {
        "name": "Workbench Provider B",
        "type": "openai-compatible",
        "baseUrl": fake_workbench_server["base"],
        "model": "gpt-image-2",
        "isActive": False,
    })
    secret_a = "sk-workbench-provider-a-1234"
    secret_b = "sk-workbench-provider-b-5678"
    app.api_ok("provider.saveKey", first["id"], secret_a)
    app.api_ok("provider.saveKey", second["id"], secret_b)
    app.api_ok("provider.setActive", second["id"])
    app.page.evaluate("async () => window.__musefold_test.stores.generation.getState().loadProviders()")
    app.page.wait_for_timeout(250)

    assert app.page.locator('[data-testid="generate-provider-trigger"]').count() == 0
    # v2:常驻身份显示「自定义中转站」,站点名在身份菜单列表里可见。
    app.page.click('[data-testid="provider-quick-switch"]')
    app.page.wait_for_selector('[data-testid="identity-switcher"]')
    assert app.page.locator("body").get_by_text(second["name"], exact=True).count() >= 1
    assert secret_a not in app.page.locator("body").inner_text()
    assert secret_b not in app.page.locator("body").inner_text()

    app.page.click(f'[data-testid="relay-model-option-{first["id"]}"]')
    app.page.wait_for_function(
        f"() => window.__musefold_test.stores.generation.getState().activeProviderId === '{first['id']}'",
    )

    app.page.fill('[data-workbench-testid="workbench-prompt"]', "global provider switch")
    app.page.click('[data-workbench-testid="workbench-submit"]')
    settle(app)
    row = app.db_query(
        "SELECT provider_id, model FROM history WHERE prompt_text = ? ORDER BY created_at DESC LIMIT 1",
        (constrained_prompt("global provider switch"),),
    )
    assert row == [{"provider_id": first["id"], "model": "gpt-image-2"}]
    assert fake_workbench_server["requests"][-1]["body"]["model"] == "gpt-image-2"

def test_workbench_cancel_marks_inflight_result_cancelled(app, hanging_workbench_server):
    provider = app.api_ok("provider.create", {
        "name": "Workbench 挂起假站",
        "type": "openai-compatible",
        "baseUrl": hanging_workbench_server,
        "model": "gpt-image-2",
        "isActive": True,
    })
    app.api_ok("provider.saveKey", provider["id"], "sk-workbench-hang-test-1234")
    app.api_ok("provider.setActive", provider["id"])
    app.page.evaluate("async () => window.__musefold_test.stores.generation.getState().loadProviders()")
    app.page.wait_for_timeout(250)

    choose_count(app, 2)
    app.page.fill('[data-workbench-testid="workbench-prompt"]', "cancel this workbench job")
    app.page.click('[data-workbench-testid="workbench-submit"]')
    app.page.wait_for_function(
        "() => !!window.__musefold_test.stores.workbench.getState().activeJobId",
        timeout=10_000,
    )

    started = workbench(app, "s.turns[0]")
    assert started["prompt"] == constrained_prompt("cancel this workbench job")
    assert started["params"]["n"] == 2
    assert started["status"] == "running"
    assert [result["status"] for result in started["results"]] == ["pending", "pending"]
    assert app.page.input_value('[data-workbench-testid="workbench-prompt"]') == ""
    assert app.page.locator('article[data-testid^="generation-turn-"]').get_attribute("data-status") == "running"
    session_id = workbench(app, "s.activeSessionId")
    session_row = app.page.locator(f'[data-conversation-row="{session_id}"]')
    assert session_row.get_attribute("data-conversation-kind") == "chat"
    running_dot = session_row.locator('[data-testid="conversation-status-dot"]')
    assert running_dot.get_attribute("data-status") == "running"
    assert app.page.locator('[data-workbench-testid="workbench-submit"]').count() == 0

    app.page.click('[data-workbench-testid="workbench-cancel"]')
    settle(app, timeout=30_000)

    turn = workbench(app, "s.turns[0]")
    assert [result["status"] for result in turn["results"]] == ["cancelled", "cancelled"]
    rows = app.db_query("SELECT status FROM history ORDER BY created_at DESC LIMIT 1")
    assert rows and rows[0]["status"] == "cancelled"


def test_workbench_keyboard_composition_and_prompt_limit(app, fake_workbench_server):
    setup_provider(app, fake_workbench_server)
    prompt = app.page.locator('[data-workbench-testid="workbench-prompt"]')

    prompt.fill("x" * 8025)
    assert len(prompt.input_value()) == 8000
    assert app.page.inner_text('[data-testid="workbench-prompt-count"]') == f"{len(constrained_prompt('x' * 8000))}/8000"

    prompt.fill("输入法组词")
    prompt.evaluate(
        """(element) => element.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, isComposing: true
        }))"""
    )
    app.page.wait_for_timeout(100)
    assert workbench(app, "s.turns.length") == 0
    assert prompt.input_value() == "输入法组词"

    prompt.press("Shift+Enter")
    assert "\n" in prompt.input_value()
    assert workbench(app, "s.turns.length") == 0

    prompt.fill("control enter sends")
    prompt.press("Control+Enter")
    settle(app)
    assert workbench(app, "s.turns[0].prompt") == constrained_prompt("control enter sends")
    assert prompt.input_value() == ""

    prompt.fill("plain enter sends")
    prompt.press("Enter")
    settle(app)
    assert workbench(app, "s.turns[1].prompt") == constrained_prompt("plain enter sends")
    assert prompt.input_value() == ""


def test_workbench_surfaces_provider_auto_retry(app, retry_workbench_server):
    setup_provider(app, retry_workbench_server)
    choose_count(app, 1)
    app.page.fill('[data-workbench-testid="workbench-prompt"]', "retry this image")
    app.page.click('[data-workbench-testid="workbench-submit"]')

    app.page.wait_for_selector('[data-testid="generation-retrying"]', timeout=8_000)
    assert "重试中" in app.page.locator('[data-testid="generation-retrying"]').inner_text()
    settle(app)

    assert len(retry_workbench_server["requests"]) == 2
    turn = workbench(app, "s.turns[0]")
    assert turn["results"][0]["status"] == "success"


def test_workbench_image_card_and_lightbox_actions(app, fake_workbench_server):
    setup_provider(app, fake_workbench_server)
    choose_count(app, 1)
    prompt_text = "a quiet product photo with soft window light"
    app.page.fill('[data-workbench-testid="workbench-prompt"]', prompt_text)
    app.page.click('[data-workbench-testid="workbench-submit"]')
    settle(app)

    result = workbench(app, "s.turns[0].results[0]")
    image_path = result["imagePath"]
    assert result["status"] == "success"
    assert Path(image_path).is_file()
    assert Path(image_path).parent == Path(app.api_ok("system.getPaths")["pictures"])
    assert Path(image_path).name == f'{result["historyId"]}.png'
    history_rows = app.db_query(
        "SELECT id, image_path FROM history WHERE id = ?",
        (result["historyId"],),
    )
    assert history_rows == [{"id": result["historyId"], "image_path": image_path}]

    image = app.page.locator('[data-testid="generate-result-card"] img')
    app.page.wait_for_function(
        "() => document.querySelector('[data-testid=\"generate-result-card\"] img')?.complete",
        timeout=5_000,
    )
    assert image.get_attribute("src").startswith("media://")

    card = app.page.locator('[data-testid="generate-result-card"]')
    card.hover()
    for test_id in ("result-zoom", "result-save", "result-copy-image", "result-more"):
        assert app.page.is_visible(f'[data-testid="{test_id}"]')
    app.page.click('[data-testid="result-more"]')
    assert app.page.is_visible('[data-testid="result-open-folder"]')
    app.page.keyboard.press("Escape")

    app.page.evaluate(
        """() => {
          const originalWrite = navigator.clipboard.writeText.bind(navigator.clipboard);
          window.__musefold_restoreWorkbenchClipboard = () => {
            navigator.clipboard.writeText = originalWrite;
          };
          window.__musefold_copiedText = null;
          navigator.clipboard.writeText = async (text) => {
            window.__musefold_copiedText = text;
          };
        }"""
    )

    try:
        app.page.click('[data-testid="result-copy-image"]')
        assert app.page.evaluate("() => window.__musefold_copiedText") is None
        app.page.wait_for_function(
            "() => document.body.innerText.includes('已复制图片')",
            timeout=5_000,
        )
        notification = app.page.locator('[data-testid="toast"]').last
        assert notification.is_visible()
        assert notification.get_attribute("role") == "status"
        assert notification.locator('[data-testid="toast-close"]').is_visible()
        notification_style = notification.evaluate(
            """(element) => {
              const style = getComputedStyle(element);
              return {
                borderLeftColor: style.borderLeftColor,
                borderTopColor: style.borderTopColor,
                backdropFilter: style.backdropFilter,
              };
            }""",
        )
        assert notification_style["borderLeftColor"] == notification_style["borderTopColor"]
        assert "blur" not in notification_style["backdropFilter"]

        app.page.click('[data-testid="result-zoom"]')
        app.page.wait_for_selector('[data-testid="image-lightbox"]', timeout=5_000)
        assert app.page.is_visible('[data-testid="image-lightbox-toolbar"]')
        for test_id in (
            "image-lightbox-save",
            "image-lightbox-folder",
            "image-lightbox-copy-image",
            "image-lightbox-copy-prompt",
        ):
            assert app.page.is_visible(f'[data-testid="{test_id}"]')

        app.page.click('[data-testid="image-lightbox-copy-prompt"]')
        assert app.page.evaluate("() => window.__musefold_copiedText") == constrained_prompt(prompt_text)
        app.page.wait_for_function(
            "() => document.body.innerText.includes('已复制提示词')",
            timeout=5_000,
        )

        app.page.click('[data-testid="image-lightbox-copy-image"]')
        app.page.wait_for_function(
            "() => document.body.innerText.includes('已复制图片')",
            timeout=5_000,
        )

        app.page.click('[data-testid="image-lightbox-folder"]')
        app.page.wait_for_function(
            "() => document.body.innerText.includes('已在文件夹中定位图片')",
            timeout=5_000,
        )
    finally:
        app.page.evaluate("() => window.__musefold_restoreWorkbenchClipboard?.()")

    saved_path = app.user_data_dir / "另存 image with spaces.png"
    saved = app.api_ok("system.saveImage", image_path, str(saved_path))
    assert saved == {"path": str(saved_path)}
    assert saved_path.read_bytes() == Path(image_path).read_bytes()
    assert app.api_ok("system.copyImage", image_path) == {"ok": True}

    missing_path = str(app.user_data_dir / "missing-image.png")
    assert not app.api("system.saveImage", missing_path, str(saved_path))["ok"]
    assert not app.api("system.copyImage", missing_path)["ok"]

    # 打开所在文件夹会把 macOS 焦点交给 Finder，Escape 可能落空；使用显式关闭按钮验证 UI 闭环。
    app.page.click('[data-testid="image-lightbox-close"]')
    app.page.wait_for_function(
        "() => !document.querySelector('[data-testid=\"image-lightbox\"]')",
        timeout=5_000,
    )
    app.page.evaluate(
        """(missingPath) => window.__musefold_test.stores.workbench.setState((state) => ({
          turns: state.turns.map((turn, turnIndex) => turnIndex !== 0 ? turn : ({
            ...turn,
            results: turn.results.map((item, resultIndex) => resultIndex !== 0 ? item : ({
              ...item,
              imagePath: missingPath,
            })),
          })),
        }))""",
        missing_path,
    )
    app.page.wait_for_selector(
        '[data-testid="generate-result-card"] >> text=图片无法加载',
        timeout=5_000,
    )
