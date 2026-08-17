"""v0.5 账号与云通道：真实 Electron + mock new-api 的端到端闭环。

覆盖：App 内注册/登录 → refresh/sk 凭据不出渲染层 → 自动供给生图+Agent 双栈 →
动态定价写入 → 生图按 quota 记账（UI 展示为「积分」，1 积分 = 50000 quota = ¥0.1）→
登出回收托管记录；另覆盖兑换码到账与侧栏余额行。
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


@pytest.fixture()
def fake_newapi():
    state = {"quota": 500_000, "registered": False, "token_name": "musefold-mac-e2e1"}
    requests: list[dict] = []

    class Handler(BaseHTTPRequestHandler):
        def _json(self, payload, status=200, *, refresh_cookie=False):
            body = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("content-type", "application/json")
            if refresh_cookie:
                self.send_header(
                    "set-cookie",
                    "new_api_refresh=session.secret; Path=/api/user/auth; Max-Age=2591999; HttpOnly; SameSite=Strict",
                )
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _body(self):
            length = int(self.headers.get("content-length", "0") or 0)
            return json.loads(self.rfile.read(length) or b"{}")

        def do_GET(self):  # noqa: N802
            requests.append({"method": "GET", "path": self.path})
            if self.path == "/api/user/self":
                self._json({"success": True, "data": {
                    "id": 41, "username": "e2euser", "quota": state["quota"], "group": "default",
                }})
            elif self.path.startswith("/api/token/"):
                self._json({"success": True, "data": {"items": [{
                    "id": 7, "name": state["token_name"], "status": 1, "key": "abcd**********wxyz",
                }]}})
            elif self.path == "/api/pricing":
                self._json({
                    "success": True,
                    "pricing_version": "e2e-v1",
                    "group_ratio": {"default": 1},
                    "data": [
                        {
                            "model_name": "musefold-agent", "quota_type": 0,
                            "model_ratio": 2.5, "completion_ratio": 8, "model_price": 0,
                            "enable_groups": ["default"],
                        },
                        {
                            "model_name": "musefold-image-pro", "quota_type": 1,
                            "model_ratio": 0, "completion_ratio": 0, "model_price": 0.04,
                            "enable_groups": ["default"],
                        },
                    ],
                })
            elif self.path == "/api/status":
                self._json({"success": True, "data": {"announcements": []}})
            elif self.path == "/api/notice":
                self._json({"success": True, "data": ""})
            elif self.path == "/api/user/models":
                self._json({"success": True, "data": ["musefold-agent", "musefold-image-pro"]})
            elif self.path == "/v1/models":
                self._json({"object": "list", "data": [
                    {"id": "musefold-agent", "object": "model"},
                    {"id": "musefold-image-pro", "object": "model"},
                ]})
            else:
                self._json({"success": False, "message": "not found"}, 404)

        def do_POST(self):  # noqa: N802
            body = self._body()
            requests.append({"method": "POST", "path": self.path, "body": body})
            if self.path == "/api/user/register":
                state["registered"] = True
                self._json({"success": True, "message": ""})
            elif self.path == "/api/user/login":
                self._json({"success": True, "data": {
                    "access_token": "jwt-e2e",
                    "access_expires_at": 2_000_000_000,
                    "token_type": "Bearer",
                    "user": {
                        "id": 41, "username": body.get("username", "e2euser"),
                        "quota": state["quota"], "group": "default",
                    },
                }}, refresh_cookie=True)
            elif self.path == "/api/token/":
                state["token_name"] = body.get("name", state["token_name"])
                self._json({"success": True, "message": ""})
            elif self.path == "/api/token/7/key":
                self._json({"success": True, "data": {"key": "sk-e2e-device-key-wxyz"}})
            elif self.path == "/api/user/topup":
                state["quota"] += 500_000
                self._json({"success": True, "message": "", "data": 500_000})
            elif self.path == "/v1/images/generations":
                self._json({"data": [{"b64_json": PNG_1PX_B64}]})
            else:
                self._json({"success": False, "message": "not found"}, 404)

        def log_message(self, *_args):
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield {
            "base": f"http://127.0.0.1:{server.server_port}",
            "requests": requests,
            "state": state,
        }
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_account_register_provisions_both_stacks_and_point_history(app, fake_newapi):
    app.api_ok("account.setServerUrl", fake_newapi["base"])
    app.page.evaluate("() => window.__musefold_test.setView('settings')")
    app.page.evaluate("() => window.__musefold_test.stores.settings.getState().setSection('account')")
    app.page.wait_for_selector('[data-testid="settings-account-signed-out"]')
    app.page.get_by_role("tab", name="注册").click()

    # 通过可访问标签填写（密码只存在于表单/单次 IPC，不进 Zustand）。
    app.page.get_by_label("用户名").fill("e2euser")
    app.page.get_by_label("密码", exact=True).fill("Password123")
    app.page.get_by_label("确认密码").fill("Password123")
    app.page.click('[data-testid="account-register-submit"]')
    app.page.wait_for_selector('[data-testid="settings-account-signed-in"]', timeout=15_000)

    status = app.api_ok("account.status")
    assert status["loggedIn"] is True
    assert status["username"] == "e2euser"
    assert "jwt" not in json.dumps(status).lower()
    assert "refresh" not in json.dumps(status).lower()
    assert "sk-e2e" not in json.dumps(status)
    assert status["estImagesRemaining"] == 25  # 500000 / (0.04 * 500000)

    providers = app.api_ok("provider.list")
    managed_provider = next(item for item in providers if item["managedBy"] == "account")
    connections = app.api_ok("aiConnection.list")
    managed_connection = next(item for item in connections if item["managedBy"] == "account")
    assert managed_provider["model"] == "musefold-image-pro"
    assert managed_connection["model"] == "musefold-agent"
    assert managed_provider["isActive"] is True
    assert managed_connection["isActive"] is True

    # P0-1 回归：设置页登录后，渲染层两份列表同步出现托管条目（无需重启）。
    app.page.wait_for_function(
        "() => window.__musefold_test.stores.generation.getState().providers.some((p) => p.managedBy === 'account')",
        timeout=5_000,
    )

    generated = app.api_ok("image.generate", {
        "providerId": managed_provider["id"],
        "prompt": "minimal dot",
        "size": "1024x1024",
        "aspectRatio": "1:1",
        "quality": "low",
        "n": 1,
    })
    assert generated["status"] == "success", generated
    rows = app.db_query(
        "SELECT cost, cost_unit FROM history WHERE id = ?",
        (generated["historyId"],),
    )
    assert rows == [{"cost": 20000, "cost_unit": "point"}]

    # 侧栏账号行：登录后显示用户名与实时余额（500000 quota = 10 积分）。
    app.page.wait_for_function(
        "() => document.querySelector('[data-testid=\"sidebar-account-balance\"]')?.innerText.includes('10 积分')",
        timeout=5_000,
    )
    assert "e2euser" in app.page.inner_text('[data-testid="sidebar-account"]')

    app.page.evaluate("() => window.__musefold_test.setView('history')")
    app.page.wait_for_selector('[data-testid="history-list"]')
    app.page.click('[data-testid="history-cost-open"]')
    # 20000 quota = 0.4 积分
    app.page.wait_for_function(
        "() => document.querySelector('[data-testid=\"history-cost-total\"]')?.innerText.includes('0.4 积分')",
        timeout=5_000,
    )
    assert "10 积分" in app.page.inner_text('[data-testid="history-cost-balance"]')
    assert "服务器实际计费单价" in app.page.inner_text('[data-testid="history-cost-disclaimer"]')
    assert "账号计费" in app.page.inner_text('[data-testid="history-cost-provider"]')
    app.page.keyboard.press("Escape")

    # UI 登出（设置 → 账号 → 退出登录 → 确认），验证渲染层幽灵条目同步回收。
    app.page.evaluate("() => window.__musefold_test.setView('settings')")
    app.page.evaluate("() => window.__musefold_test.stores.settings.getState().setSection('account')")
    app.page.get_by_role("button", name="退出登录").click()
    app.page.get_by_role("button", name="确认退出").click()
    app.page.wait_for_selector('[data-testid="settings-account-signed-out"]', timeout=10_000)
    assert not any(item["managedBy"] == "account" for item in app.api_ok("provider.list"))
    assert not any(item["managedBy"] == "account" for item in app.api_ok("aiConnection.list"))
    # P0-1 回归：登出后渲染层不再残留可选中的托管条目。
    app.page.wait_for_function(
        "() => !window.__musefold_test.stores.generation.getState().providers.some((p) => p.managedBy === 'account')",
        timeout=5_000,
    )
    # 重新登录预填：登出后登录表单自动带上上次的用户名。
    assert app.page.input_value('[data-testid="settings-account-signed-out"] #account-username') == "e2euser"


def test_account_model_source_switch(app, fake_newapi):
    """「模型来源」一键切换：账号积分 ⇄ 自备中转站，同步两栈 active。"""
    app.api_ok("account.setServerUrl", fake_newapi["base"])
    app.api_ok("account.login", {"username": "e2euser", "password": "Password123"})

    byok = app.api_ok("provider.create", {
        "name": "E2E 自备站",
        "type": "openai-compatible",
        "baseUrl": "https://byok.example.com/v1",
        "model": "gpt-image-2",
        "isActive": False,
    })
    # provider.create 走的是 IPC 直建（测试作弊路径），渲染层列表要手动刷一次；
    # 真实用户从 UI 添加时 store.create 会同步更新，无此步骤。
    app.page.evaluate("() => window.__musefold_test.stores.generation.getState().loadProviders()")
    app.page.wait_for_function(
        "(id) => window.__musefold_test.stores.generation.getState().providers.some((p) => p.id === id)",
        arg=byok["id"],
        timeout=5_000,
    )

    app.page.evaluate("() => window.__musefold_test.setView('settings')")
    app.page.evaluate("() => window.__musefold_test.stores.settings.getState().setSection('account')")
    app.page.wait_for_selector('[data-testid="account-model-source"]')
    # 登录后默认账号来源。
    app.page.wait_for_selector('[data-testid="account-source-account"][data-active="true"]')

    # 切到自备中转站：生图 active 落到 BYOK 条目（Agent 无自备连接，保持原样并提示）。
    app.page.click('[data-testid="account-source-byok"]')
    app.page.wait_for_function(
        "(id) => window.__musefold_test.stores.generation.getState().providers.find((p) => p.id === id)?.isActive === true",
        arg=byok["id"],
        timeout=5_000,
    )
    providers = app.api_ok("provider.list")
    assert next(p for p in providers if p["id"] == byok["id"])["isActive"] is True
    assert next(p for p in providers if p["managedBy"] == "account")["isActive"] is False

    # 切回账号积分：托管条目重新激活。
    app.page.click('[data-testid="account-source-account"]')
    app.page.wait_for_function(
        "() => window.__musefold_test.stores.generation.getState().providers.find((p) => p.managedBy === 'account')?.isActive === true",
        timeout=5_000,
    )
    assert next(p for p in app.api_ok("provider.list") if p["managedBy"] == "account")["isActive"] is True

    app.api_ok("account.logout")


def test_composer_model_picker_hides_agent_alias(app, fake_newapi):
    """生图模型选择器（Composer）：托管站 /v1/models 混排的 Agent 别名不得出现。"""
    app.api_ok("account.setServerUrl", fake_newapi["base"])
    app.api_ok("account.login", {"username": "e2euser", "password": "Password123"})
    # 登录态翻转会触发渲染层列表重载，等托管条目就位。
    app.page.wait_for_function(
        "() => window.__musefold_test.stores.generation.getState().providers.some((p) => p.managedBy === 'account')",
        timeout=5_000,
    )
    app.page.wait_for_selector('[data-testid="generate-model-trigger"]')
    app.page.click('[data-testid="generate-model-trigger"]')
    app.page.wait_for_selector('[data-testid="generate-model-musefold-image-pro"]', timeout=5_000)
    assert app.page.locator('[data-testid="generate-model-musefold-agent"]').count() == 0
    # 别名模型显示友好名，原始 id 以小字标注。
    menu_text = app.page.inner_text('[data-testid="generate-model-menu"]')
    assert "Musefold 生图" in menu_text
    app.page.keyboard.press("Escape")
    app.api_ok("account.logout")


def test_account_redemption_refreshes_balance(app, fake_newapi):
    app.api_ok("account.setServerUrl", fake_newapi["base"])
    app.api_ok("account.login", {"username": "e2euser", "password": "Password123"})
    before = app.api_ok("account.status")["quota"]["value"]
    result = app.api_ok("account.redeem", "VALID-CODE")
    assert result["quotaAdded"] == 500_000
    assert result["status"]["quota"]["value"] == before + 500_000
    assert fake_newapi["state"]["quota"] == before + 500_000
