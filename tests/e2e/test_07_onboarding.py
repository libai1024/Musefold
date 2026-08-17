"""
tests/e2e/test_07_onboarding.py — TASK-SET-04 首启引导流验收。

`app` fixture 每个测试给全新、零 Provider 的应用实例；引导流的普通门控
（onboarded 未置位 且 provider:list 为空）在这种实例下理应自动命中，但
`src/features/onboarding/store.ts` 的 isVisible() 在 E2E harness
（?musefold_e2e=1，见 conftest._launch 的 MUSEFOLD_E2E=1）下默认强制不显示，避免挡住
其余 175+ 条既有测试。这里的用例通过

    window.__musefold_test.stores.onboarding.getState().forceShow()

显式打开引导，覆盖三种场景（正常/边界/异常），并额外验证：
  - 默认门控在 E2E 下确实是关闭的（防止将来改动误让引导拦住其它测试）
  - Key 全程不进 localStorage（TASK-SET-04 验收标准里的"人工核查"项，这里改成
    可自动跑的断言）

假 Provider 服务器复用 test_04_generate.py 的思路：本机 HTTP server，
既答 POST /v1/images/generations（出图）也答 GET /v1/models（validate 探测），
不出网、结果确定。
"""
from __future__ import annotations

import base64
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

PNG_1PX_B64 = base64.b64encode(bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082"
)).decode("ascii")


def _make_server(*, models_status: int = 200):
    """本机假 OpenAI 兼容站：/v1/models 探测 + /v1/images/generations 出图。

    models_status 用于模拟 validate 阶段的鉴权失败（401）。
    """
    requests: list[dict] = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802 - stdlib hook
            requests.append({"path": self.path, "method": "GET"})
            if self.path.startswith("/v1/models"):
                if models_status != 200:
                    body = json.dumps({
                        "error": {"message": "Incorrect API key provided", "code": "invalid_api_key"}
                    }).encode("utf-8")
                    self.send_response(models_status)
                    self.send_header("content-type", "application/json")
                    self.send_header("content-length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return
                body = json.dumps({
                    "data": [{"id": "gpt-image-2", "object": "model"}],
                    "object": "list",
                }).encode("utf-8")
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            self.send_response(404)
            self.end_headers()

        def do_POST(self):  # noqa: N802 - stdlib hook
            length = int(self.headers.get("content-length", "0") or 0)
            raw = self.rfile.read(length) if length else b"{}"
            body = json.loads(raw.decode("utf-8") or "{}")
            requests.append({"path": self.path, "method": "POST", "body": body})
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
    return server, thread, requests


@pytest.fixture()
def fake_provider_server():
    """默认：/v1/models 200 + /v1/images/generations 200 —— 全程走通的正常路径。"""
    server, thread, requests = _make_server(models_status=200)
    try:
        yield {"base": f"http://127.0.0.1:{server.server_address[1]}/v1", "requests": requests}
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


@pytest.fixture()
def fake_provider_server_401():
    """/v1/models 401 —— 校验必定失败，用于步骤 3 异常路径。"""
    server, thread, requests = _make_server(models_status=401)
    try:
        yield {"base": f"http://127.0.0.1:{server.server_address[1]}/v1", "requests": requests}
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


# ---------------------------------------------------------------- helpers

def ob(app, expr: str):
    """在 onboarding store 上求值，s = state。"""
    return app.page.evaluate(
        "(src) => { const s = window.__musefold_test.stores.onboarding.getState();"
        " return eval(src); }",
        expr,
    )


def ob_call(app, method: str, *args):
    return app.page.evaluate(
        """async ([m, args]) => {
            const s = window.__musefold_test.stores.onboarding.getState();
            const r = await s[m](...args);
            return r ?? null;
        }""",
        [method, list(args)],
    )


def force_show(app):
    app.page.evaluate(
        "() => window.__musefold_test.stores.onboarding.getState().forceShow()"
    )
    app.page.wait_for_timeout(150)


HIST_COLS = "id, status, error_code, provider_id, image_path"


def test_hidden_by_default_under_e2e_harness(app):
    """E2E harness 下即便零 Provider + 未 onboarded，默认门控也不应自动弹出。"""
    assert app.page.locator('[data-testid="onboarding-flow"]').count() == 0
    assert ob(app, "s.isVisible()") is False


def test_normal_flow_full_run_reaches_workbench_with_seed(app, fake_provider_server):
    """正常：强制打开 → 4 步跑通 → 首图成功 → 完成后进工作台开卷（v0.3.3 有意变更：
    finish → generate；skip 仍去 library）。seed 示例在库里可查。"""
    force_show(app)
    app.page.wait_for_selector('[data-testid="onboarding-step-1"]')

    app.page.click('[data-testid="onboarding-start"]')
    app.page.wait_for_selector('[data-testid="onboarding-step-2"]')

    # 步骤 2：选中推荐预设，用真实交互填假站 Key —— 先把 provider 直接指向假服务器，
    # 绕开"预设 baseUrl 固定写死在 shared/constants.ts"的限制：
    # 用 provider.create 走真实 IPC 建一个指向假站的 Provider，再喂给 store，
    # 使其后续 saveKey/validate/setActive 全部走真实链路。
    created = app.api_ok("provider.create", {
        "name": "E2E Onboarding 假站",
        "type": "openai-compatible",
        "baseUrl": fake_provider_server["base"],
        "model": "gpt-image-2",
        "isActive": True,
    })
    app.page.evaluate(
        "(id) => window.__musefold_test.stores.onboarding.setState({ providerId: id })",
        created["id"],
    )
    app.page.fill('[data-testid="onboarding-api-key"]', "sk-e2e-onboarding-key-9999")
    app.page.click('[data-testid="onboarding-connect"]')

    app.page.wait_for_selector('[data-testid="onboarding-step-3"]')
    app.page.wait_for_function(
        "() => window.__musefold_test.stores.onboarding.getState().validating === false",
        timeout=15_000,
    )
    validation = ob(app, "s.validation")
    assert validation and validation["ok"] is True, validation
    assert app.api_ok("provider.list")
    active = next(p for p in app.api_ok("provider.list") if p["id"] == created["id"])
    assert active["isActive"] is True, "校验成功应 setActive"

    app.page.click('[data-testid="onboarding-continue"]')
    app.page.wait_for_selector('[data-testid="onboarding-step-4"]')

    app.page.click('[data-testid="onboarding-generate"]')
    app.page.wait_for_selector('[data-testid="onboarding-result"]', timeout=20_000)
    assert app.page.is_visible('[data-testid="onboarding-result-image"]')

    app.page.click('[data-testid="onboarding-finish"]')
    app.page.wait_for_timeout(300)

    assert app.page.locator('[data-testid="onboarding-flow"]').count() == 0, "完成后引导应关闭"
    # 完成引导进入工作台开卷（src/features/onboarding/store.ts finish()；skip 才去 library）
    assert app.page.evaluate("() => window.__musefold_test.getView()") == "generate"

    prompts = app.api_ok("prompt.list", {})
    items = prompts.get("items", prompts) if isinstance(prompts, dict) else prompts
    assert len(items) > 0, "完成引导后 Library 应能看到首启 seed 示例"

    rows = app.db_query(f"SELECT {HIST_COLS} FROM history WHERE provider_id = ?", (created["id"],))
    assert rows and rows[0]["status"] == "success"


def test_boundary_skip_after_step2_goes_directly_to_library(app):
    """边界：步骤 2 点「跳过引导」→ 直达 Library，服务商空态仍给一键预设补救。"""
    force_show(app)
    app.page.click('[data-testid="onboarding-start"]')
    app.page.wait_for_selector('[data-testid="onboarding-step-2"]')

    app.page.click('[data-testid="onboarding-skip"]')
    app.page.wait_for_timeout(300)

    assert app.page.locator('[data-testid="onboarding-flow"]').count() == 0
    assert app.page.evaluate("() => window.__musefold_test.getView()") == "library"
    assert ob(app, "s.onboarded") is True

    # 跳过引导后仍无 Provider —— 发送按钮禁用说明原因，侧栏「服务商设置」直达预设补救
    app.set_view("generate")
    app.page.wait_for_selector('[data-testid="refine-generate"]')
    app.page.fill('[data-testid="refine-prompt"]', "跳过引导后的无服务商探针")
    assert app.page.locator('[data-testid="refine-generate"]').is_disabled()
    app.page.click('[data-testid="provider-quick-switch"]')
    app.page.get_by_test_id("model-hub-manage").click()
    app.page.wait_for_selector('[data-testid="settings-empty-provider"]')


def test_abnormal_wrong_key_shows_401_then_update_and_retry_succeeds(
    app, fake_provider_server_401, fake_provider_server
):
    """异常：Key/服务器鉴权失败 → 步骤 3 展示 401 分类文案 + 更新密钥 → 改对后重试成功。"""
    force_show(app)
    app.page.click('[data-testid="onboarding-start"]')
    app.page.wait_for_selector('[data-testid="onboarding-step-2"]')

    created = app.api_ok("provider.create", {
        "name": "E2E Onboarding 401 假站",
        "type": "openai-compatible",
        "baseUrl": fake_provider_server_401["base"],
        "model": "gpt-image-2",
        "isActive": True,
    })
    app.page.evaluate(
        "(id) => window.__musefold_test.stores.onboarding.setState({ providerId: id })",
        created["id"],
    )
    app.page.fill('[data-testid="onboarding-api-key"]', "sk-wrong-key-0000")
    app.page.click('[data-testid="onboarding-connect"]')

    app.page.wait_for_selector('[data-testid="onboarding-step-3"]')
    app.page.wait_for_function(
        "() => window.__musefold_test.stores.onboarding.getState().validating === false",
        timeout=15_000,
    )
    validation = ob(app, "s.validation")
    assert validation and validation["ok"] is False
    assert validation.get("code") == "AUTH", validation

    app.page.wait_for_selector('[data-testid="validation-result"][data-ok="false"]')
    assert app.page.get_attribute('[data-testid="validation-result"]', "data-error-code") == "AUTH"
    app.page.wait_for_selector('[data-testid="validation-action-update_key"]')

    app.page.click('[data-testid="validation-action-update_key"]')
    app.page.wait_for_selector('[data-testid="onboarding-step-2"]')

    # 改用一个真的能连上的假站地址（换 Provider 而非编辑同一个 baseUrl，
    # 效果等价于"改对了服务商/密钥"）。
    fixed = app.api_ok("provider.create", {
        "name": "E2E Onboarding 修复后假站",
        "type": "openai-compatible",
        "baseUrl": fake_provider_server["base"],
        "model": "gpt-image-2",
        "isActive": True,
    })
    app.page.evaluate(
        "(id) => window.__musefold_test.stores.onboarding.setState({ providerId: id, apiKey: '' })",
        fixed["id"],
    )
    app.page.fill('[data-testid="onboarding-api-key"]', "sk-correct-key-1234")
    app.page.click('[data-testid="onboarding-connect"]')

    app.page.wait_for_selector('[data-testid="onboarding-step-3"]')
    app.page.wait_for_function(
        "() => window.__musefold_test.stores.onboarding.getState().validating === false",
        timeout=15_000,
    )
    validation2 = ob(app, "s.validation")
    assert validation2 and validation2["ok"] is True, validation2


def test_key_never_written_to_localstorage_or_history_row(app, fake_provider_server):
    """人工核查转自动断言：全程 Key 不进 localStorage，也不落库明文。"""
    force_show(app)
    app.page.click('[data-testid="onboarding-start"]')
    app.page.wait_for_selector('[data-testid="onboarding-step-2"]')

    created = app.api_ok("provider.create", {
        "name": "E2E Key 安全假站",
        "type": "openai-compatible",
        "baseUrl": fake_provider_server["base"],
        "model": "gpt-image-2",
        "isActive": True,
    })
    secret = "sk-super-secret-should-not-leak-7777"
    app.page.evaluate(
        "(id) => window.__musefold_test.stores.onboarding.setState({ providerId: id })",
        created["id"],
    )
    app.page.fill('[data-testid="onboarding-api-key"]', secret)
    app.page.click('[data-testid="onboarding-connect"]')
    app.page.wait_for_selector('[data-testid="onboarding-step-3"]')
    app.page.wait_for_function(
        "() => window.__musefold_test.stores.onboarding.getState().validating === false",
        timeout=15_000,
    )

    ls_dump = app.page.evaluate(
        "() => JSON.stringify(Object.entries(localStorage))"
    )
    assert secret not in ls_dump, "API Key 绝不能写入 localStorage"

    raw = app.db_query("SELECT * FROM providers WHERE id = ?", (created["id"],))
    assert raw and not any(secret in str(v) for v in raw[0].values()), "providers 表不得存明文密钥"

    dumped_state = app.page.evaluate(
        "() => JSON.stringify(window.__musefold_test.stores.onboarding.getState())"
    )
    # apiKey 字段应已在 connect() 成功后被清空
    assert secret not in dumped_state, "onboarding store 结算后不应仍持有明文密钥"
