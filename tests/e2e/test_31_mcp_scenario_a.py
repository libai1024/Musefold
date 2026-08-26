"""场景 A 确定性闭环（V04 P2 出口的 CI 版）：
MCP stdio 二进制 → 真实 App 控制面 → 非托管 Provider 自动放行 → 假 Provider 出图
→ ResourceLink 指向真实文件 → 审计表 approvedVia=budget。

与 test_31_mcp_scenario_a_live.py 唯一的差别是 Provider 指向本地假服务器，
使本用例可进 CI（不烧钱、不依赖网关账号状态）。
"""
from __future__ import annotations

import json
import os
import queue
import subprocess
import threading
import time
from pathlib import Path

import pytest

from test_07_onboarding import _make_server

REPO_ROOT = Path(__file__).resolve().parents[2]
MCP_BINARY = REPO_ROOT / "packages" / "mcp" / "dist" / "musefold-mcp.mjs"


@pytest.fixture()
def fake_provider():
    server, thread, requests = _make_server(models_status=200)
    try:
        yield {"base": f"http://127.0.0.1:{server.server_address[1]}/v1", "requests": requests}
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


class McpStdio:
    def __init__(self, endpoint: str, token: str):
        self.proc = subprocess.Popen(
            ["node", str(MCP_BINARY)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env={**os.environ, "MUSEFOLD_ENDPOINT": endpoint, "MUSEFOLD_TOKEN": token},
            text=True,
        )
        self.messages: queue.Queue[dict] = queue.Queue()
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        assert self.proc.stdout is not None
        for line in self.proc.stdout:
            line = line.strip()
            if line:
                self.messages.put(json.loads(line))

    def send(self, message: dict):
        assert self.proc.stdin is not None
        self.proc.stdin.write(json.dumps(message) + "\n")
        self.proc.stdin.flush()

    def wait_for(self, message_id: int, timeout: float) -> dict:
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                message = self.messages.get(timeout=1)
            except queue.Empty:
                continue
            if message.get("id") == message_id:
                return message
        raise AssertionError(f"等待 JSON-RPC id={message_id} 超时")

    def close(self):
        self.proc.kill()


def test_scenario_a_deterministic(app, fake_provider):
    assert MCP_BINARY.exists(), "先运行 node scripts/build-cli.mjs 生成 MCP 产物"

    provider = app.api_ok("provider.create", {
        "name": "场景A假站", "type": "openai-compatible",
        "baseUrl": fake_provider["base"], "model": "gpt-image-2", "isActive": True,
    })
    app.api_ok("provider.saveKey", provider["id"], "sk-scenario-a-deterministic")
    app.api_ok("provider.setActive", provider["id"])

    discovery = json.loads((app.user_data_dir / "automation.json").read_text("utf8"))
    client = McpStdio(f"http://127.0.0.1:{discovery['port']}", discovery["token"])
    try:
        client.send({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
            "protocolVersion": "2025-06-18", "capabilities": {},
            "clientInfo": {"name": "scenario-a-ci", "version": "1.0.0"},
        }})
        assert client.wait_for(1, 15)["result"]["serverInfo"]["name"] == "musefold"
        client.send({"jsonrpc": "2.0", "method": "notifications/initialized"})

        # 只读工具热身：search_prompts 直接可用（无确认）
        client.send({"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {
            "name": "search_prompts", "arguments": {"limit": 5},
        }})
        warmup = json.loads(client.wait_for(2, 15)["result"]["content"][0]["text"])
        assert "prompts" in warmup

        # 非托管 Provider 不计费，预算 0 也会自动放行，不出现确认卡。
        client.send({"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {
            "name": "generate_image",
            "arguments": {"prompt": "scenario-a deterministic poster", "n": 1, "wait": True},
        }})
        result = client.wait_for(3, 90)
        assert app.page.get_by_test_id("automation-confirm-card").count() == 0
        payload = json.loads(result["result"]["content"][0]["text"])
        assert payload["status"] == "success", json.dumps(payload, ensure_ascii=False)

        links = [item for item in result["result"]["content"] if item.get("type") == "resource_link"]
        assert links, "成功结果应携带 file:// ResourceLink"
        image_path = links[0]["uri"].replace("file://", "")
        assert Path(image_path).exists()

        # 假站确实收到一次生成请求
        posts = [r for r in fake_provider["requests"] if r["method"] == "POST"]
        assert len(posts) == 1
        assert "scenario-a deterministic poster" in json.dumps(posts[0]["body"])

        # 审计闭环：完整提示词 + 非托管 Provider 自动放行路径。
        audit = app.page.evaluate("() => window.api.automation.auditList(10)")
        matching = [e for e in audit if e["action"] == "generate_image" and e["status"] == "success"]
        assert matching, audit
        assert matching[0]["approvedVia"] == "budget"
        assert matching[0]["promptText"] == "scenario-a deterministic poster"
    finally:
        client.close()
