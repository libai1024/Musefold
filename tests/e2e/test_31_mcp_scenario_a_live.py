"""场景 A（README §6）live 等价验收：MCP 客户端 → 控制面 → 确认卡 → 真实出图。

    export MUSEFOLD_TVT_KEY='sk-...'          # 必需，缺省则整个文件 skip
    export MUSEFOLD_TVT_BASE=...              # 可选，默认 https://ai.tvt.wiki/v1
    export MUSEFOLD_TVT_MODEL=...             # 可选，默认 gpt-image-2

真实链路：本测试扮演 Claude Code（对 musefold-mcp 二进制说 JSON-RPC/stdio），
生成请求打到真实 App 的控制面 → 预算 0 触发确认卡 → 测试在真实 UI 上点「允许生成」
→ 真实网关出图 → 工具返回 ResourceLink → 审计表记录 approvedVia=confirmation。
"""
from __future__ import annotations

import json
import os
import queue
import subprocess
import threading
from pathlib import Path

import pytest

LIVE_KEY = os.environ.get("MUSEFOLD_TVT_KEY", "").strip()
LIVE_BASE = os.environ.get("MUSEFOLD_TVT_BASE", "https://ai.tvt.wiki/v1").strip()
LIVE_MODEL = os.environ.get("MUSEFOLD_TVT_MODEL", "gpt-image-2").strip()

pytestmark = pytest.mark.skipif(
    not LIVE_KEY,
    reason="需要 MUSEFOLD_TVT_KEY 才能跑真出图（见文件头说明）",
)

REPO_ROOT = Path(__file__).resolve().parents[2]
MCP_BINARY = REPO_ROOT / "packages" / "mcp" / "dist" / "musefold-mcp.mjs"


class McpStdio:
    """最小 MCP stdio 客户端（newline-delimited JSON-RPC）。"""

    def __init__(self, endpoint: str, token: str):
        self.proc = subprocess.Popen(
            ["node", str(MCP_BINARY)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env={**os.environ, "MUSEFOLD_ENDPOINT": endpoint, "MUSEFOLD_TOKEN": token},
            text=True,
        )
        self.messages: queue.Queue[dict] = queue.Queue()
        self._reader = threading.Thread(target=self._read_stdout, daemon=True)
        self._reader.start()

    def _read_stdout(self):
        assert self.proc.stdout is not None
        for line in self.proc.stdout:
            line = line.strip()
            if line:
                self.messages.put(json.loads(line))  # 非 JSON 帧 = stdout 污染，直接炸

    def send(self, message: dict):
        assert self.proc.stdin is not None
        self.proc.stdin.write(json.dumps(message) + "\n")
        self.proc.stdin.flush()

    def wait_for(self, message_id: int, timeout: float) -> dict:
        import time
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


def test_scenario_a_generate_via_mcp_with_confirmation(app):
    # 1. 真实 Provider（密钥只进临时 userDataDir 的 safeStorage）
    provider = app.api_ok("provider.create", {
        "name": "MCP 场景A", "type": "openai-compatible",
        "baseUrl": LIVE_BASE, "model": LIVE_MODEL, "isActive": True,
    })
    app.api_ok("provider.saveKey", provider["id"], LIVE_KEY)
    app.api_ok("provider.setActive", provider["id"])

    # 2. 控制面发现
    discovery = json.loads((app.user_data_dir / "automation.json").read_text("utf8"))
    client = McpStdio(f"http://127.0.0.1:{discovery['port']}", discovery["token"])
    try:
        # 3. MCP 握手 + 目录
        client.send({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
            "protocolVersion": "2025-06-18", "capabilities": {},
            "clientInfo": {"name": "scenario-a", "version": "1.0.0"},
        }})
        init = client.wait_for(1, 15)
        assert init["result"]["serverInfo"]["name"] == "musefold"
        client.send({"jsonrpc": "2.0", "method": "notifications/initialized"})

        client.send({"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
        tools = client.wait_for(2, 15)["result"]["tools"]
        assert len(tools) == 18

        # 4. 发起 generate_image（预算 0 → 走确认卡）
        client.send({"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {
            "name": "generate_image",
            "arguments": {"prompt": "a minimal poster of an autumn coffee festival, flat illustration", "n": 1, "wait": True},
        }})

        # 5. 在真实 UI 上批准确认卡（等价 Claude Code 用户在 App 里点允许）
        app.page.wait_for_selector('[data-testid="automation-confirm-card"]', timeout=30_000)
        app.page.click('[data-testid="automation-confirm-approve"]')

        # 6. 等真实生成完成（真实网关 1–3 分钟）
        result = client.wait_for(3, 240)
        payload = json.loads(result["result"]["content"][0]["text"])
        assert payload["status"] == "success", json.dumps(payload, ensure_ascii=False)
        assert payload["costCents"] is None or payload["costCents"] >= 0

        links = [item for item in result["result"]["content"] if item.get("type") == "resource_link"]
        assert links, "成功结果应携带 file:// ResourceLink"
        image_path = links[0]["uri"].replace("file://", "")
        assert Path(image_path).exists() and Path(image_path).stat().st_size > 1024

        # 7. 审计闭环：完整落库 + 放行路径 = 确认卡
        audit = app.page.evaluate("() => window.api.automation.auditList(10)")
        matching = [entry for entry in audit if entry["action"] == "generate_image" and entry["status"] == "success"]
        assert matching, audit
        assert matching[0]["approvedVia"] == "confirmation"
        assert "autumn coffee festival" in (matching[0]["promptText"] or "")
    finally:
        client.close()
