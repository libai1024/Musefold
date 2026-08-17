"""v0.4 控制面（Automation API v1）应用级验收。

覆盖：App 启动即写发现文件（0600）、健康检查鉴权、只读端点对真实数据可用、
设置开关联动（关闭 → 端口不监听 + 发现文件删除；重开 → 恢复）、token 轮换。
单元/契约级已在 packages/automation-server 覆盖，这里验证 Electron 宿主接线。
"""
from __future__ import annotations

import json
import stat
import urllib.error
import urllib.parse
import urllib.request


def read_discovery(app):
    path = app.user_data_dir / "automation.json"
    assert path.exists(), "App 启动后应写入发现文件"
    mode = stat.S_IMODE(path.stat().st_mode)
    assert mode == 0o600, f"发现文件权限应为 0600，实际 {oct(mode)}"
    return json.loads(path.read_text("utf8"))


def http_get(port: int, path: str, token: str | None = None):
    request = urllib.request.Request(f"http://127.0.0.1:{port}{path}")
    if token:
        request.add_header("authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            return response.status, json.loads(response.read().decode("utf8"))
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read().decode("utf8"))


def test_automation_control_plane_end_to_end(app):
    # 1. 发现文件：owner/pid/port/token 齐全，权限 0600
    doc = read_discovery(app)
    assert doc["owner"] == "desktop-app"
    assert doc["apiVersion"] == "v1"
    port, token = doc["port"], doc["token"]
    assert token.startswith("mf_at_")

    # 2. 鉴权：无 token 401；带 token 200 + 能力快照
    status, _ = http_get(port, "/v1/health")
    assert status == 401
    status, health = http_get(port, "/v1/health", token)
    assert status == 200
    assert health["connected"] is True
    assert health["owner"] == "desktop-app"

    # 3. 只读端点对真实数据可用：写一条提示词 → HTTP 检索得到
    created = app.api_ok("prompt.create", {"title": "控制面验收提示词", "content": "via automation e2e"})
    status, found = http_get(port, "/v1/prompts?query=" + urllib.parse.quote("控制面验收提示词"), token)
    assert status == 200
    assert any(p["id"] == created["id"] for p in found["prompts"])

    # 4. 写入端点（🟡）：POST /v1/prompts 回流资产库
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/v1/prompts",
        data=json.dumps({"title": "Agent 回流", "body": "saved via http"}).encode("utf8"),
        headers={"authorization": f"Bearer {token}", "content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=5) as response:
        assert response.status == 201
        saved = json.loads(response.read().decode("utf8"))
    got = app.api_ok("prompt.get", saved["id"])
    assert got["content"] == "saved via http"

    # 5. token 轮换：旧 token 立即失效
    rotated = app.page.evaluate("() => window.api.automation.rotateToken()")
    assert rotated["token"] != token
    status, _ = http_get(port, "/v1/health", token)
    assert status == 401
    status, _ = http_get(port, "/v1/health", rotated["token"])
    assert status == 200

    # 6. 设置开关：关闭 → 发现文件删除、端口不再监听；重开 → 恢复
    disabled = app.page.evaluate("() => window.api.automation.setEnabled(false)")
    assert disabled["running"] is False
    assert not (app.user_data_dir / "automation.json").exists(), "关闭后发现文件应删除"
    try:
        http_get(port, "/v1/health", rotated["token"])
        listening = True
    except Exception:
        listening = False
    assert not listening, "关闭后端口不应再监听"

    enabled = app.page.evaluate("() => window.api.automation.setEnabled(true)")
    assert enabled["running"] is True
    doc2 = read_discovery(app)
    status, _ = http_get(doc2["port"], "/v1/health", doc2["token"])
    assert status == 200

    # 7. 花钱审计表（SEC-01 完整落库）：本测试未发生花钱动作 → 表可查且为空；
    #    条目形状（action/approvedVia/promptText）由 automation-server 单测覆盖。
    audit = app.page.evaluate("() => window.api.automation.auditList(50)")
    assert isinstance(audit, list)
    assert all("action" in entry and "approvedVia" in entry for entry in audit)


def test_agent_skill_install_and_update_controls(app):
    app.set_view("settings")
    app.page.evaluate(
        "() => window.__musefold_test?.stores?.settings?.getState?.().setSection?.('automation')"
    )
    panel = app.page.get_by_test_id("integration-skill")
    panel.wait_for(state="visible", timeout=5000)
    assert "v0.4.0" in app.page.get_by_test_id("integration-skill-status").inner_text()

    app.page.get_by_test_id("integration-skill-install").click()
    app.page.get_by_test_id("integration-notice").wait_for(state="visible", timeout=5000)
    assert "v0.4.0" in app.page.get_by_test_id("integration-notice").inner_text()

    for client in ("codex", "claude", "cursor"):
        skill_dir = app.user_data_dir / "skills" / client / "musefold"
        skill = skill_dir / "SKILL.md"
        compatibility = skill_dir / "references" / "compatibility.md"
        metadata = json.loads((skill_dir / ".musefold-install.json").read_text("utf8"))
        assert "musefold-skill-version: v0.4.0" in skill.read_text("utf8")
        assert compatibility.is_file()
        assert metadata["version"] == "v0.4.0"
        assert metadata["source"] == "bundled"

    auto_update = app.page.get_by_test_id("integration-skill-auto-update")
    assert auto_update.get_attribute("aria-checked") == "false"
    auto_update.click()
    app.page.wait_for_function(
        "() => document.querySelector('[data-testid=integration-skill-auto-update]')?.getAttribute('aria-checked') === 'true'"
    )
    auto_update.click()
    app.page.wait_for_function(
        "() => document.querySelector('[data-testid=integration-skill-auto-update]')?.getAttribute('aria-checked') === 'false'"
    )


def test_automation_origin_and_owner_lock(app):
    doc = read_discovery(app)

    # Origin 头一律 403（防浏览器探测）
    request = urllib.request.Request(f"http://127.0.0.1:{doc['port']}/v1/health")
    request.add_header("authorization", f"Bearer {doc['token']}")
    request.add_header("origin", "https://evil.example")
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            code = response.status
    except urllib.error.HTTPError as error:
        code = error.code
    assert code == 403

    # 单写者：App 运行期间 owner.lock 存在且指向本进程树
    lock = app.user_data_dir / "owner.lock"
    assert lock.exists()
    holder = json.loads(lock.read_text("utf8"))
    assert holder["owner"] == "desktop-app"
