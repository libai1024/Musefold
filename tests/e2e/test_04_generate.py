"""
tests/e2e/test_04_generate.py — M4「生成工作区」验收（确定性部分，不需要真密钥）。

对应 docs/product/12-generation-deep-dive.md 的任务卡：
  TASK-GEN-01  Generate 顶层：一条顶栏 + [快速|精修] 两 tab，各自保留输入
  TASK-GEN-02  精修面板接线（提示词/比例/质量/张数 → 真实请求）
  TASK-GEN-04  未配置服务商时的引导态（不给一堆点不动的控件）
  TASK-GEN-05  库/画布 → 精修的来源 chip（可解绑，解绑不清文本）
  TASK-GEN-06  逐张生成：一张一个 jobId / 一条历史 / 一份成本
  TASK-GEN-07  取消：中止在途 + 跳过未开始，历史记 cancelled
  TASK-GEN-11  从结果卡重试 → 写**新的**历史行，不覆盖原记录
  TASK-GEN-14  渲染层安全策略：CSP 实际生效 + 权限全拒

两类假 Provider，都指向本机，永不出网：
  DEAD  —— 未监听端口，连接立刻被拒 ⇒ 稳定失败路径
  HANG  —— 本地 socket，accept 后永不响应 ⇒ 稳定"在途"，取消才能被确定性验证

真出图（真密钥、真 PNG、真 media:// 渲染）在 test_04c_generate_live.py。

断言落在**数据库真相**（app.db_query）与**可见 UI**（testid）两侧，不看日志。
"""
from __future__ import annotations

import base64
import json
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest


# 未监听的本机端口 —— 请求立刻 ECONNREFUSED，不依赖外网、不等超时
DEAD_BASE = "http://127.0.0.1:9/v1"

PNG_1PX_B64 = base64.b64encode(bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082"
)).decode("ascii")


# ---------------------------------------------------------------- 挂起服务器

@pytest.fixture(scope="module")
def hang_port():
    """accept 连接但永不回响应的本地 socket。

    取消测试必须有一个**稳定在途**的请求：用 DEAD 端口的话请求毫秒级就失败，
    取消经常打在已结束的任务上，测试会随机漂。这里 accept 之后把连接攥住不放，
    于是"在途"是确定的，abort 是否真的生效也就能被断言。
    """
    srv = socket.socket()
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", 0))
    srv.listen(16)
    port = srv.getsockname()[1]
    held: list[socket.socket] = []
    stop = threading.Event()

    def loop():
        srv.settimeout(0.4)
        while not stop.is_set():
            try:
                conn, _ = srv.accept()
            except (socket.timeout, OSError):
                continue
            held.append(conn)  # 攥着不读不写，客户端就一直等

    t = threading.Thread(target=loop, daemon=True)
    t.start()
    try:
        yield port
    finally:
        stop.set()
        t.join(timeout=2)
        for c in held:
            try:
                c.close()
            except OSError:
                pass
        srv.close()


@pytest.fixture
def fake_openai_server():
    """本地 OpenAI-compatible 假服务：只实现 images.generate，返回确定性 PNG。"""
    requests: list[dict] = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802 - stdlib hook
            length = int(self.headers.get("content-length", "0") or 0)
            raw = self.rfile.read(length) if length else b"{}"
            body = json.loads(raw.decode("utf-8") or "{}")
            requests.append({"path": self.path, "body": body})
            if self.path != "/v1/images/generations":
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
        yield {
            "base": f"http://127.0.0.1:{server.server_address[1]}/v1",
            "requests": requests,
        }
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


# ---------------------------------------------------------------- helpers

def gen(app, expr: str):
    """在 generation store 上求值，s = state。"""
    return app.page.evaluate(
        "(src) => { const s = window.__musefold_test.stores.generation.getState();"
        " return eval(src); }",
        expr,
    )


def choose_ratio(app, ratio: str):
    app.page.click('[data-testid="refine-ratio-trigger"]')
    app.page.click(f'[data-testid="refine-ratio-{ratio}"]')


def open_generation_settings(app):
    menu = app.page.locator('[data-testid="workbench-generation-options"]')
    if menu.count() == 0 or not menu.is_visible():
        app.page.click('[data-testid="workbench-more-settings"]')
        app.page.wait_for_selector('[data-testid="workbench-generation-options"]')


def choose_quality(app, quality: str):
    open_generation_settings(app)
    app.page.click(f'[data-testid="refine-quality-{quality}"]')


def choose_count(app, count: int):
    open_generation_settings(app)
    app.page.click(f'[data-testid="refine-count-{count}"]')


def switch_provider_via_sidebar(app, provider_id: str):
    """服务商切换收敛在侧栏模型切换器（设置页不再有默认服务商行）。"""
    app.page.click('[data-testid="provider-quick-switch"]')
    app.page.wait_for_selector('[data-testid="model-hub"]')
    app.page.click(f'[data-testid="model-hub-station-{provider_id}"]')
    app.page.keyboard.press("Escape")
    app.page.wait_for_function("() => document.querySelector('[data-testid=\"model-hub\"]') === null")


def wb(app, expr: str):
    """在统一 Workbench store 上求值，s = state。"""
    return app.page.evaluate(
        "(src) => { const s = window.__musefold_test.stores.workbench.getState(); return eval(src); }",
        expr,
    )


def settle_workbench(app, timeout=30_000):
    app.page.wait_for_function(
        "() => window.__musefold_test.stores.workbench.getState().isGenerating === false",
        timeout=timeout,
    )
    app.page.wait_for_timeout(250)


def app_state(app, key: str):
    return app.page.evaluate("(k) => window.__musefold_test.stores.app.getState()[k]", key)


def goto_generate(app, _surface: str = "workbench"):
    app.set_view("generate")
    app.page.wait_for_timeout(350)


def mk_provider(app, *, name="E2E 假站", base=DEAD_BASE, key="sk-e2e-fake-key-1234"):
    """建一个指向本机假端点的 Provider 并存密钥 —— 请求必失败/必挂起，但链路是真的。

    密钥经 provider:saveKey 进主进程 safeStorage（写在临时 userDataDir 里，
    随夹具一起删），永不回传渲染层；下面只断言 hasKey/keySuffix 这类非敏感投影。
    """
    p = app.api_ok("provider.create", {
        "name": name,
        "type": "openai-compatible",
        "baseUrl": base,
        "model": "gpt-image-2",
        "isActive": True,
    })
    if key:
        app.api_ok("provider.saveKey", p["id"], key)
    app.api_ok("provider.setActive", p["id"])
    app.page.evaluate(
        "async () => { await window.__musefold_test.stores.generation.getState().loadProviders(); }"
    )
    app.page.wait_for_timeout(250)
    return p


HIST_COLS = (
    "id, status, error_code, prompt_text, provider_id, prompt_id, "
    "params, cost, duration_ms, image_path"
)


def history_rows(app, cols=HIST_COLS):
    return app.db_query(f"SELECT {cols} FROM history ORDER BY created_at ASC, rowid ASC")


def sent_prompt(body: str, ratio: str = "1:1") -> str:
    """提交时非 auto 比例会统一追加画幅约束段（shared/generation-prompt.ts），
    历史 prompt_text 落的是实际发送的完整提示词。"""
    if ratio == "auto":
        return body
    return (
        f"{body}\n\n画面比例约束：严格按照 {ratio} 画幅构图；"
        "主体、留白和所有关键元素均需完整适配该比例，不得改用其他画幅。"
    )


# ---------------------------------------------------------------- GEN-01 顶层

def test_generate_is_default_view_with_single_workbench(app):
    """生成是默认视图，并且只渲染一套工作台与页面头。"""
    assert app_state(app, "currentView") == "generate", "生成应为启动默认视图"

    app.page.wait_for_selector('[data-testid="generation-workbench"]')
    assert app.page.locator('[data-testid="titlebar"]').count() == 1, "生成工作区只应有一条页面标题栏"
    assert app.page.locator('[data-testid="page-toolbar"]').count() == 0, "没有页面操作时不应重复渲染工具条"
    assert app.page.locator('[data-testid^="generate-tab-"]').count() == 0
    assert app.page.locator('[data-testid^="generate-mode-"]').count() == 0


def test_workbench_draft_survives_navigation(app):
    """当前会话草稿在页面往返时保持，不另建隐藏的第二份输入。"""
    mk_provider(app)
    goto_generate(app)
    app.page.fill('[data-testid="refine-prompt"]', "SHARED-DRAFT")

    app.set_view("library")
    goto_generate(app)
    assert app.page.input_value('[data-testid="refine-prompt"]') == "SHARED-DRAFT"
    assert wb(app, "s.draftPrompt") == "SHARED-DRAFT"


# ---------------------------------------------------------------- GEN-04 引导态

def test_no_provider_shows_guidance_not_dead_controls(app):
    """未配置服务商：发送按钮禁用并说明原因，侧栏「服务商设置」直达预设一键接入引导。"""
    goto_generate(app, "refine")
    app.page.wait_for_selector('[data-testid="refine-generate"]')
    app.page.fill('[data-testid="refine-prompt"]', "无服务商探针")
    send = app.page.locator('[data-testid="refine-generate"]')
    assert send.is_disabled(), "无服务商时发送按钮应禁用而不是假可用"
    assert send.get_attribute("title") == "请先连接服务商"

    # 补救路径：侧栏模型切换器 → 管理生图服务 → 空态引导（预设一键接入）
    app.page.click('[data-testid="provider-quick-switch"]')
    app.page.get_by_test_id("model-hub-manage").click()
    app.page.wait_for_selector('[data-testid="settings-empty-provider"]')
    assert app_state(app, "currentView") == "settings"
    assert app.page.is_visible('[data-testid="provider-add-first"]')


def test_key_state_never_exposes_plaintext(app):
    """密钥不进渲染进程：IPC 回包与 DB 里都不得出现明文，只有 hasKey + 末 4 位。"""
    secret = "sk-e2e-fake-key-1234"
    p = mk_provider(app, key=secret)
    goto_generate(app, "refine")

    row = next(x for x in app.api_ok("provider.list") if x["id"] == p["id"])
    assert row["hasKey"] is True
    assert row["keySuffix"] == "1234", "只应回传末 4 位"
    assert not any(secret in str(v) for v in row.values()), "IPC 回包不得含明文密钥"

    raw = app.db_query("SELECT * FROM providers WHERE id = ?", (p["id"],))
    assert raw and not any(secret in str(v) for v in raw[0].values()), "providers 表不得存明文密钥"

    # 渲染进程整体拿不到明文：store 里也只有投影
    dumped = app.page.evaluate(
        "() => JSON.stringify(window.__musefold_test.stores.generation.getState().providers)"
    )
    assert secret not in dumped, "generation store 不得持有明文密钥"

    assert app.page.locator('[data-testid="generate-provider-trigger"]').count() == 0
    assert app.page.get_by_text(p["name"], exact=True).count() >= 1


def test_provider_pricing_ui_and_history_cost(app, fake_openai_server):
    """HIS-13：设置页配置单价 → 生图成功后按单价写 history.cost。"""
    app.set_view("settings")
    app.page.click('[data-testid="settings-provider-new"]')
    app.page.wait_for_selector('[data-testid="provider-name"]')

    app.page.fill('[data-testid="provider-name"]', "E2E 单价服务商")
    app.page.fill('[data-testid="provider-base-url"]', fake_openai_server["base"])
    app.page.fill('[data-testid="provider-model"]', "gpt-image-2")
    app.page.click('[data-testid="provider-pricing-per-image"]')
    app.page.fill('[data-testid="provider-pricing-unit-points"]', "-1")
    app.page.wait_for_selector('[data-testid="provider-pricing-error"]')
    assert app.page.locator('[data-testid="provider-save"]').is_disabled(), "负数单价应被 UI 拦截"

    app.page.fill('[data-testid="provider-pricing-unit-points"]', "3.2")
    assert not app.page.locator('[data-testid="provider-save"]').is_disabled()
    app.page.click('[data-testid="provider-save"]')
    app.page.wait_for_timeout(350)

    provider = next(p for p in app.api_ok("provider.list") if p["name"] == "E2E 单价服务商")
    assert app.api_ok("settings.pricing.get", provider["id"]) == {
        "mode": "per-image",
        "unitPoints": 3.2,
    }

    # IPC 层也要拒绝非法输入，并保留原配置不被污染。
    bad = app.api("settings.pricing.set", {
        "providerId": provider["id"],
        "mode": "per-image",
        "unitPoints": -1,
    })
    assert not bad["ok"] and "负数" in bad["error"]
    bad = app.api("settings.pricing.set", {
        "providerId": provider["id"],
        "mode": "per-image",
        "unitPoints": "abc",
    })
    assert not bad["ok"] and "积分" in bad["error"]
    assert app.api_ok("settings.pricing.get", provider["id"])["unitPoints"] == 3.2

    app.api_ok("provider.saveKey", provider["id"], "sk-pricing-e2e-1234")
    app.api_ok("provider.setActive", provider["id"])
    res = app.api_ok("image.generate", {
        "jobId": "pricing-e2e-per-image",
        "providerId": provider["id"],
        "prompt": "pricing e2e image",
        "size": "1024x1024",
        "quality": "medium",
        "n": 1,
    })
    assert res["status"] == "success", res
    assert res["cost"] == 3.2
    row = app.db_query("SELECT status, cost FROM history WHERE id = ?", ("pricing-e2e-per-image",))[0]
    assert row == {"status": "success", "cost": 3.2}
    assert fake_openai_server["requests"][-1]["body"]["prompt"] == "pricing e2e image"

    app.api_ok("settings.pricing.set", {
        "providerId": provider["id"],
        "mode": "per-1k-token",
        "unitPoints": 2,
    })
    res = app.api_ok("image.generate", {
        "jobId": "pricing-e2e-token-missing",
        "providerId": provider["id"],
        "prompt": "pricing e2e token missing",
        "size": "1024x1024",
        "quality": "medium",
        "n": 1,
    })
    assert res["status"] == "success", res
    assert res.get("cost") is None
    row = app.db_query("SELECT status, cost FROM history WHERE id = ?", ("pricing-e2e-token-missing",))[0]
    assert row == {"status": "success", "cost": None}

    app.api_ok("settings.pricing.delete", provider["id"])
    res = app.api_ok("image.generate", {
        "jobId": "pricing-e2e-unconfigured",
        "providerId": provider["id"],
        "prompt": "pricing e2e no configured price",
        "size": "1024x1024",
        "quality": "medium",
        "n": 1,
    })
    assert res["status"] == "success", res
    assert res.get("cost") is None
    row = app.db_query("SELECT status, cost FROM history WHERE id = ?", ("pricing-e2e-unconfigured",))[0]
    assert row == {"status": "success", "cost": None}
    app.set_view("history")
    app.page.wait_for_selector("text=未配单价", timeout=5000)


def test_generation_defaults_provider_and_background(app, fake_openai_server):
    """SET-06：侧栏切换服务商 + 设置页 background 同步到工作台默认参数。"""
    p1 = mk_provider(app, name="E2E 默认服务商 A", base=fake_openai_server["base"])
    mk_provider(app, name="E2E 默认服务商 B", base=fake_openai_server["base"])

    app.set_view("settings")
    app.page.evaluate("() => window.__musefold_test.stores.settings.getState().setSection('generation')")
    app.page.wait_for_selector('[data-testid="settings-default-background-transparent"]')
    app.page.click('[data-testid="settings-default-background-transparent"]')
    switch_provider_via_sidebar(app, p1["id"])
    app.page.wait_for_function(
        """(pid) => {
          const g = window.__musefold_test.stores.generation.getState();
          const wb = window.__musefold_test.stores.workbench.getState();
          return g.activeProviderId === pid &&
            wb.params.background === 'transparent';
        }""",
        arg=p1["id"],
        timeout=5000,
    )

    app.set_view("generate")
    app.page.fill('[data-workbench-testid="workbench-prompt"]', "settings defaults background")
    app.page.click('[data-workbench-testid="workbench-submit"]')
    settle_workbench(app, timeout=10_000)

    row = app.db_query(
        "SELECT provider_id, params FROM history WHERE prompt_text = ?",
        (sent_prompt("settings defaults background"),),
    )[0]
    assert row["provider_id"] == p1["id"]
    assert json.loads(row["params"])["background"] == "transparent"
    assert fake_openai_server["requests"][-1]["body"]["background"] == "transparent"


def test_workbench_retry_falls_back_to_default_provider(app, fake_openai_server):
    """SET-06 边界：activeProviderId 为空时，工作台提交与单张重试都兜底 defaultProviderId。

    默认服务商已无设置 UI（侧栏切换器直接写激活态），但历史数据里仍可能带
    defaultProviderId，兜底链路必须继续成立 —— 直接写 store 验证。
    """
    p1 = mk_provider(app, name="E2E 重试默认服务商", base=fake_openai_server["base"])

    app.page.evaluate(
        "(pid) => window.__musefold_test.stores.app.getState().setDefaultProviderId(pid)",
        p1["id"],
    )
    app.page.wait_for_function(
        "(pid) => window.__musefold_test.stores.app.getState().defaultProviderId === pid",
        arg=p1["id"],
        timeout=5000,
    )

    # 清空 activeProviderId，模拟"曾设默认、当前未激活任何服务商"；正式 Workbench 应兜底默认服务商。
    app.set_view("generate")
    app.page.evaluate("() => { window.__musefold_test.stores.generation.setState({ activeProviderId: null }); }")
    choose_count(app, 1)
    app.page.fill('[data-workbench-testid="workbench-prompt"]', "retry fallback provider")
    app.page.click('[data-workbench-testid="workbench-submit"]')
    settle_workbench(app, timeout=10_000)

    first_turn = app.page.evaluate("() => window.__musefold_test.stores.workbench.getState().turns[0]")
    assert first_turn["providerId"] == p1["id"]

    app.page.evaluate("() => { window.__musefold_test.stores.generation.setState({ activeProviderId: null }); }")
    app.page.evaluate(
        """async () => {
          const state = window.__musefold_test.stores.workbench.getState();
          const turn = state.turns[0];
          const result = turn.results[0];
          await state.retryResult(turn.id, result.id);
        }""",
    )
    settle_workbench(app, timeout=10_000)

    rows = app.db_query(
        "SELECT provider_id, status FROM history WHERE prompt_text = ? ORDER BY created_at ASC",
        (sent_prompt("retry fallback provider"),),
    )
    assert len(rows) == 2, f"重试应新写一条历史（不覆盖原记录）: {rows}"
    assert all(r["status"] == "success" for r in rows), f"两次都应用默认服务商成功出图: {rows}"
    assert all(r["provider_id"] == p1["id"] for r in rows), f"重试应沿用默认服务商而不是报 NO_PROVIDER: {rows}"


# ---------------------------------------------------------------- GEN-02/06 逐张生成

def test_refine_params_write_through_to_store(app):
    """比例/质量/张数点一下就落 Workbench store，且按钮上的 ×N 跟着变。"""
    mk_provider(app)
    goto_generate(app, "refine")
    app.page.fill('[data-testid="refine-prompt"]', "param write-through")

    trigger = app.page.locator('[data-testid="refine-ratio-trigger"]')
    assert trigger.evaluate("node => node.tagName") == "BUTTON", "比例选择必须使用应用内自绘按钮"
    trigger.click()
    app.page.wait_for_selector('[data-testid="refine-ratio-menu"]')
    portrait = app.page.locator('[data-testid="refine-ratio-9:16-preview"]').bounding_box()
    landscape = app.page.locator('[data-testid="refine-ratio-16:9-preview"]').bounding_box()
    assert portrait and portrait["height"] > portrait["width"], "9:16 应直观显示为竖向画幅"
    assert landscape and landscape["width"] > landscape["height"], "16:9 应直观显示为横向画幅"
    app.page.wait_for_function(
        "() => document.activeElement?.getAttribute('data-testid') === 'refine-ratio-1:1'",
    )
    app.page.keyboard.press("ArrowRight")
    assert app.page.evaluate("() => document.activeElement?.getAttribute('data-testid')") == "refine-ratio-2:3"
    app.page.keyboard.press("Enter")
    app.page.wait_for_selector('[data-testid="refine-ratio-menu"]', state="detached")
    assert wb(app, "s.params.ratioId") == "2:3"

    trigger.click()
    app.page.wait_for_selector('[data-testid="refine-ratio-menu"]')
    app.page.keyboard.press("Escape")
    app.page.wait_for_selector('[data-testid="refine-ratio-menu"]', state="detached")
    assert trigger.evaluate("node => document.activeElement === node"), "Esc 关闭后焦点应回到触发器"

    choose_ratio(app, "16:9")
    choose_quality(app, "high")
    choose_count(app, 2)
    app.page.wait_for_timeout(250)

    assert wb(app, "s.params.ratioId") == "16:9"
    assert wb(app, "s.params.quality") == "high"
    assert wb(app, "s.params.n") == 2
    assert app.page.get_attribute('[data-testid="refine-ratio-trigger"]', "data-value") == "16:9"
    assert app.page.get_attribute('[data-testid="refine-quality-high"]', "data-active") == "true"
    assert "×2" in app.page.inner_text('[data-testid="refine-generate"]')


def test_one_card_and_one_history_row_per_image(app):
    """张数 N → N 张卡 / N 条历史 / 各自 jobId（TASK-GEN-06）。"""
    mk_provider(app)
    goto_generate(app, "refine")
    app.page.fill('[data-testid="refine-prompt"]', "astronaut riding a horse")
    choose_ratio(app, "16:9")
    choose_count(app, 2)
    app.page.wait_for_timeout(200)

    app.page.click('[data-workbench-testid="workbench-submit"]')
    settle_workbench(app)

    cards = app.page.locator('[data-testid="generate-result-card"]')
    assert cards.count() == 2, f"应有 2 张结果卡，实际 {cards.count()}"

    rows = history_rows(app)
    assert len(rows) == 2, f"应写 2 条历史，实际 {len(rows)}: {rows}"
    assert len({r["id"] for r in rows}) == 2, "两张的 jobId/历史 id 必须不同"
    assert all(r["prompt_text"] == sent_prompt("astronaut riding a horse", "16:9") for r in rows)

    # 死端口 ⇒ 全部失败，且错误码已归一（不是裸 Error 字符串）
    assert all(r["status"] == "failed" for r in rows), f"死端口应全部失败: {rows}"
    assert all(r["error_code"] for r in rows), f"失败行必须带错误码: {rows}"

    # 参数快照连 aspectRatio 一起落库（重试要靠它重建请求）
    snap = json.loads(rows[0]["params"])
    assert snap["size"] == "1536x1024", snap
    assert snap["aspectRatio"] == "16:9", f"参数快照必须含 aspectRatio，否则重试丢比例: {snap}"

    assert app.page.locator('[data-testid="generate-result-card"][data-status="failed"]').count() == 2
    assert wb(app, "s.isGenerating") is False, "跑完应复位 isGenerating"
    assert wb(app, "s.activeJobId") is None, "跑完应清掉在途句柄"


def test_failed_card_shows_friendly_error(app):
    """失败卡给人话，并保留重试入口。"""
    mk_provider(app)
    goto_generate(app, "refine")
    choose_count(app, 1)
    app.page.fill('[data-testid="refine-prompt"]', "friendly error")
    app.page.wait_for_timeout(200)
    app.page.click('[data-workbench-testid="workbench-submit"]')
    settle_workbench(app)

    card = app.page.locator('[data-testid="generate-result-card"]').first
    assert card.get_attribute("data-status") == "failed"
    assert card.inner_text().strip(), "失败卡不能是空白"
    assert app.page.locator('[data-testid="result-retry"]').count() >= 1, "失败卡应可重试"


def test_missing_key_blocks_generate_with_hint(app):
    """选中的服务商没有密钥：给提示 + 禁用生成，而不是发一个必败请求。"""
    mk_provider(app, key=None)  # 建了但不存密钥
    goto_generate(app, "refine")
    app.page.fill('[data-testid="refine-prompt"]', "anything")
    app.page.wait_for_timeout(250)

    assert app.page.is_visible('[data-testid="refine-no-key"]'), "应提示缺少密钥"
    assert app.page.get_attribute('[data-testid="refine-generate"]', "disabled") is not None, \
        "缺密钥时生成按钮应禁用"
    assert history_rows(app) == [], "不应产生任何历史行"


def test_empty_prompt_blocks_generate(app):
    """空提示词不给发（空格也算空）。"""
    mk_provider(app)
    goto_generate(app, "refine")
    app.page.fill('[data-testid="refine-prompt"]', "   ")
    app.page.wait_for_timeout(200)
    assert app.page.get_attribute('[data-testid="refine-generate"]', "disabled") is not None

    app.page.fill('[data-testid="refine-prompt"]', "now it has content")
    app.page.wait_for_timeout(200)
    assert app.page.get_attribute('[data-testid="refine-generate"]', "disabled") is None


# ---------------------------------------------------------------- GEN-07 取消

def test_cancel_aborts_inflight_and_skips_pending(app, hang_port):
    """取消：中止在途那张 + 跳过未开始的，历史只记跑过的（TASK-GEN-07）。"""
    mk_provider(app, base=f"http://127.0.0.1:{hang_port}/v1")
    goto_generate(app, "refine")
    app.page.fill('[data-testid="refine-prompt"]', "cancel me")
    choose_count(app, 4)
    app.page.wait_for_timeout(200)

    app.page.click('[data-workbench-testid="workbench-submit"]')
    # 等第一张真的在途（挂起端点保证它不会自己结束）
    app.page.wait_for_function(
        "() => !!window.__musefold_test.stores.workbench.getState().activeJobId",
        timeout=10_000,
    )
    app.page.click('[data-testid="refine-cancel"]')
    settle_workbench(app, timeout=30_000)

    statuses = wb(app, "s.turns[0].results.map(r => r.status)")
    assert len(statuses) == 4, f"仍应有 4 张卡（含被取消的），实际 {statuses}"
    assert "pending" not in statuses, f"收尾后不应残留 pending，实际 {statuses}"
    # 必须是 4 而不是 >=3：未开始的 3 张是循环直接标 cancelled 的，用 >=3 的话
    # **在途那张**即使错记成 failed 也照样通过 —— 那正是 IPC 只序列化 message
    # 时的真实症状。第 0 张是唯一发出过请求的，它的状态才是这个测试的靶心。
    assert statuses.count("cancelled") == 4, \
        f"在途那张 + 未开始的 3 张都应记 cancelled，实际 {statuses}"
    codes = wb(app, "s.turns[0].results.map(r => r.errorCode)")
    assert codes[0] == "CANCELLED", \
        f"在途那张的错误码必须跨 IPC 保真为 CANCELLED，实际 {codes}"
    assert wb(app, "s.cancelRequested") is False, "一轮结束应复位取消标记"
    assert wb(app, "s.activeJobId") is None

    rows = history_rows(app)
    # 挂起端点保证第 0 张不可能自己结束 ⇒ 第 1 张压根没发出去 ⇒ 恰好 1 条史。
    # 写死 1 条（而不是 <=2）才能挡住"0 条时 all() 恒真"的假绿。
    assert len(rows) == 1, f"只有真正发出去的那 1 张写史，实际 {len(rows)} 条: {rows}"
    assert rows[0]["status"] == "cancelled", rows
    assert rows[0]["error_code"] == "CANCELLED", rows


def test_cancel_button_swaps_back_after_cancel(app, hang_port):
    """生成中按钮换成「取消生成」，取消后回到「生成图像」。"""
    mk_provider(app, base=f"http://127.0.0.1:{hang_port}/v1")
    goto_generate(app, "refine")
    app.page.fill('[data-testid="refine-prompt"]', "swap button")
    app.page.wait_for_timeout(200)

    app.page.click('[data-workbench-testid="workbench-submit"]')
    app.page.wait_for_selector('[data-testid="refine-cancel"]', timeout=10_000)
    assert not app.page.is_visible('[data-testid="refine-generate"]'), "生成中不应同时显示生成按钮"

    app.page.click('[data-testid="refine-cancel"]')
    app.page.wait_for_selector('[data-testid="refine-generate"]', timeout=30_000)
    assert wb(app, "s.isGenerating") is False


def test_esc_cancels_running_round(app, hang_port):
    """Esc 取消这一轮（docs/product/12 §4.2：取消要随手可及）。"""
    mk_provider(app, base=f"http://127.0.0.1:{hang_port}/v1")
    goto_generate(app, "refine")
    app.page.fill('[data-testid="refine-prompt"]', "esc cancel")
    app.page.wait_for_timeout(200)

    app.page.click('[data-workbench-testid="workbench-submit"]')
    app.page.wait_for_function(
        "() => !!window.__musefold_test.stores.workbench.getState().activeJobId",
        timeout=10_000,
    )
    app.page.keyboard.press("Escape")
    settle_workbench(app, timeout=30_000)

    assert wb(app, "s.turns[0].results[0].status") == "cancelled"


# ---------------------------------------------------------------- GEN-11 重试

def test_retry_from_card_writes_new_history_row(app):
    """结果卡重试 → 新历史行，不覆盖原记录（TASK-GEN-11）。"""
    mk_provider(app)
    goto_generate(app, "refine")
    choose_count(app, 1)
    app.page.fill('[data-testid="refine-prompt"]', "retry target")
    app.page.wait_for_timeout(200)

    app.page.click('[data-workbench-testid="workbench-submit"]')
    settle_workbench(app)
    before = history_rows(app)
    assert len(before) == 1, f"首轮应写 1 条，实际 {before}"
    first_id = before[0]["id"]

    turn_id = wb(app, "s.turns[0].id")
    card_id = wb(app, "s.turns[0].results[0].id")
    app.page.evaluate(
        "([turnId, resultId]) => window.__musefold_test.stores.workbench.getState().retryResult(turnId, resultId)",
        [turn_id, card_id],
    )
    settle_workbench(app)

    after = history_rows(app)
    assert len(after) == 2, f"重试应另起一行，实际 {after}"
    assert after[0]["id"] == first_id, "原记录不得被覆盖/删除"
    assert after[1]["id"] != first_id, "重试行应有新 id"
    assert after[1]["prompt_text"] == sent_prompt("retry target")

    # 卡还在原位（id 不变），只是刷新了内容
    assert wb(app, "s.turns[0].results.length") == 1, "重试是就地刷新，不新增卡"
    assert wb(app, "s.turns[0].results[0].id") == card_id


def test_retry_uses_snapshot_after_source_prompt_edited(app):
    """源 prompt 改了，重试仍按当时快照重发（历史行自带 prompt_text）。"""
    p = app.api_ok("prompt.create", {
        "title": "会被改的源",
        "content": "ORIGINAL BODY",
        "modelId": "gpt-image-2",
    })
    mk_provider(app)
    goto_generate(app, "refine")
    choose_count(app, 1)

    app.page.evaluate(
        """(pid) => window.__musefold_test.stores.workbench.getState().openDraft({
            prompt: 'ORIGINAL BODY',
            source: { kind: 'prompt', id: pid, label: '会被改的源' },
        })""",
        p["id"],
    )
    app.page.wait_for_timeout(300)
    assert wb(app, "s.draftSource.id") == p["id"]

    app.page.click('[data-workbench-testid="workbench-submit"]')
    settle_workbench(app)
    rows = history_rows(app)
    assert len(rows) == 1 and rows[0]["prompt_text"] == sent_prompt("ORIGINAL BODY")
    assert rows[0]["prompt_id"] == p["id"], "应落上来源关联"

    app.api_ok("prompt.update", p["id"], {"content": "EDITED BODY"})

    turn_id = wb(app, "s.turns[0].id")
    card_id = wb(app, "s.turns[0].results[0].id")
    app.page.evaluate(
        "([turnId, resultId]) => window.__musefold_test.stores.workbench.getState().retryResult(turnId, resultId)",
        [turn_id, card_id],
    )
    settle_workbench(app)

    rows = history_rows(app)
    assert len(rows) == 2, rows
    assert rows[1]["prompt_text"] == sent_prompt("ORIGINAL BODY"), \
        f"重试应用当时快照，不该跟着源条目变成 EDITED BODY: {rows[1]}"
    assert all(r["prompt_id"] == p["id"] for r in rows), "重试仍指向同一来源"


# ---------------------------------------------------------------- GEN-05 来源

def test_csp_is_enforced_and_blocks_remote_assets(app):
    """CSP 真生效：远端脚本/图片被拦（断的是执行结果，不是响应头字符串）。"""
    report = app.page.evaluate(
        """async () => {
            const hits = [];
            const onViolation = (e) => hits.push({
                directive: e.violatedDirective,
                blocked: String(e.blockedURI || '').slice(0, 60),
            });
            document.addEventListener('securitypolicyviolation', onViolation);
            // 远端图片：img-src 只放行 'self' media: data: blob:
            const img = new Image();
            img.src = 'https://example.com/musefold-csp-probe.png';
            // 远端脚本：script-src 不含外域
            const s = document.createElement('script');
            s.src = 'https://example.com/musefold-csp-probe.js';
            document.head.appendChild(s);
            await new Promise((r) => setTimeout(r, 1500));
            document.removeEventListener('securitypolicyviolation', onViolation);
            s.remove();
            return hits;
        }"""
    )
    directives = {h["directive"] for h in report}
    assert report, "远端资源应触发 CSP 违规 —— 没有任何违规说明 CSP 没生效"
    assert any(d.startswith("img-src") for d in directives), f"远端图片应被 img-src 拦下: {report}"
    assert any(d.startswith("script-src") for d in directives), f"远端脚本应被 script-src 拦下: {report}"


def test_csp_allows_media_protocol_for_generated_images(app):
    """media: 必须在 img-src 白名单里 —— 生成图走自定义协议显示，被拦就白图。"""
    hits = app.page.evaluate(
        """async () => {
            const hits = [];
            const onViolation = (e) => {
                if (String(e.blockedURI || '').startsWith('media')) hits.push(e.violatedDirective);
            };
            document.addEventListener('securitypolicyviolation', onViolation);
            const img = new Image();
            img.src = 'media://musefold-csp-probe-not-exist.png';  // 加载会失败，但不该被 CSP 拦
            await new Promise((r) => setTimeout(r, 900));
            document.removeEventListener('securitypolicyviolation', onViolation);
            return hits;
        }"""
    )
    assert hits == [], f"media:// 不该被 CSP 拦（生成图靠它渲染）: {hits}"


def test_permissions_are_denied(app):
    """权限全拒：本应用不需要摄像头/麦克风/定位/通知。"""
    geo = app.page.evaluate(
        """() => new Promise((resolve) => {
            if (!navigator.geolocation) return resolve('no-api');
            let done = false;
            const finish = (v) => { if (!done) { done = true; resolve(v); } };
            navigator.geolocation.getCurrentPosition(
                () => finish('granted'),
                (e) => finish('denied:' + e.code),
            );
            setTimeout(() => finish('timeout'), 4000);
        })"""
    )
    assert not str(geo).startswith("granted"), f"定位权限不应被授予，实际 {geo}"

    notif = app.page.evaluate(
        "() => (typeof Notification !== 'undefined' ? Notification.permission : 'no-api')"
    )
    assert notif != "granted", f"通知权限不应为 granted，实际 {notif}"


def test_clipboard_write_allowed_but_read_denied(app):
    """白名单只有剪贴板**写入**：复制正文是核心动作，读剪贴板则能偷到用户在别处
    复制的密码/密钥，必须继续拒（配套 denyAllPermissions 的唯一例外）。"""
    write = app.page.evaluate(
        """async () => {
            try { await navigator.clipboard.writeText('musefold-clip-probe'); return 'ok'; }
            catch (e) { return String(e && e.name); }
        }"""
    )
    assert write == "ok", f"剪贴板写入应被放行，否则复制正文/计数全废，实际 {write}"

    read = app.page.evaluate(
        """async () => {
            try { await navigator.clipboard.readText(); return 'granted'; }
            catch (e) { return 'denied:' + String(e && e.name); }
        }"""
    )
    assert read != "granted", f"剪贴板读取必须保持拒绝，实际 {read}"


def test_external_navigation_does_not_leave_the_app(app):
    """站外链接交给系统浏览器，应用窗口自己绝不导航出去。"""
    before = app.page.url
    app.page.evaluate("() => { try { window.location.href = 'https://example.com/'; } catch {} }")
    app.page.wait_for_timeout(1500)
    assert app.page.url == before, f"窗口不应导航到站外：{before} → {app.page.url}"

    opened_blocked = app.page.evaluate(
        "() => { try { return window.open('https://example.com/', '_blank') === null; }"
        " catch { return true; } }"
    )
    app.page.wait_for_timeout(600)
    assert opened_blocked, "window.open 应被 setWindowOpenHandler 拒绝（改由系统浏览器打开）"
    assert app.page.url == before


def test_no_console_errors_across_generate_flow(app):
    """整条精修流程不该在控制台留错（含 React #185 之类的渲染崩溃）。"""
    mk_provider(app)
    goto_generate(app, "refine")
    choose_count(app, 1)
    app.page.fill('[data-testid="refine-prompt"]', "console clean check")
    choose_ratio(app, "2:3")
    app.page.wait_for_timeout(150)
    app.page.click('[data-workbench-testid="workbench-submit"]')
    settle_workbench(app)
    app.set_view("history")
    goto_generate(app)

    # 死端口本身会产生网络层噪声，那是测试设计的一部分，不算 UI 错误
    ignorable = (
        "DevTools", "ERR_CONNECTION_REFUSED", "Failed to load resource",
        "net::ERR_", "ECONNREFUSED",
    )
    errs = [e for e in app.console_errors() if not any(k in e for k in ignorable)]
    assert not errs, f"console errors: {errs[:5]}"
