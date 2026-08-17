"""v0.4.x 客户端接入向导：内置产物、配置片段、CLI shim 安装的应用级验收。

目标（私下分发）：装完 App 即可在 Cursor / ChatGPT 桌面 / Claude Code 里直接用，
零外部依赖、配置不含密钥。E2E 下 shim 安装重定向到隔离 userData/bin。
"""
from __future__ import annotations

import json
import os
import stat
import subprocess
from pathlib import Path


def info(app) -> dict:
    return app.page.evaluate("() => window.api.automation.integrationInfo()")


def test_integration_info_and_snippets(app):
    data = info(app)

    # 内置产物就位（开发态由 scripts/build-cli.mjs 产出；打包态在 resources/integration）
    assert data["bundledReady"] is True
    assert Path(data["launch"]["args"][0]).exists(), "MCP 脚本路径必须真实存在"
    assert Path(data["launch"]["command"]).exists(), "可执行文件路径必须真实存在"
    assert data["launch"]["env"]["ELECTRON_RUN_AS_NODE"] == "1"

    # 片段完整且不含密钥形态内容
    snippets = data["snippets"]
    parsed = json.loads(snippets["cursorJson"])
    assert parsed["mcpServers"]["musefold"]["command"] == data["launch"]["command"]
    assert snippets["cursorDeeplink"].startswith("cursor://anysphere.cursor-deeplink/mcp/install?name=musefold")
    assert "claude mcp add musefold" in snippets["claudeCommand"]
    assert "[mcp_servers.musefold]" in snippets["codexToml"]
    assert snippets["skillUrl"] == (
        "https://raw.githubusercontent.com/libai1024/Musefold-Skills/"
        "v0.2.0/skills/musefold/SKILL.md"
    )
    for text in snippets.values():
        assert "mf_at_" not in text, "配置片段不得包含控制面 token"

    # 设置页出现接入向导卡片
    app.set_view("settings")
    app.page.evaluate("() => window.__musefold_test.stores.settings.getState().setSection('automation')")
    app.page.wait_for_selector('[data-testid="integration-guide"]')
    for testid in ("integration-cursor", "integration-codex", "integration-claude", "integration-skill", "integration-cli"):
        assert app.page.locator(f'[data-testid="{testid}"]').count() == 1


def test_cli_shim_install_and_execute(app):
    # 1. 经 IPC 安装（E2E 重定向到 userData/bin）
    result = app.page.evaluate("() => window.api.automation.integrationAction('install-cli')")
    assert result["ok"], result

    data = info(app)
    assert data["cli"]["installed"] is True
    assert data["cli"]["upToDate"] is True
    shim = Path(data["cli"]["path"])
    assert shim.exists()
    if os.name != "nt":
        assert stat.S_IMODE(shim.stat().st_mode) & 0o111, "shim 必须可执行"

    # 2. shim 真实可用：终端跑 musefold status → 经发现链连上正在运行的 App
    completed = subprocess.run(
        [str(shim), "status", "--json"],
        capture_output=True, text=True, timeout=30,
        env={**os.environ, "MUSEFOLD_DATA_DIR": str(app.user_data_dir)},
    )
    assert completed.returncode == 0, completed.stderr
    payload = json.loads(completed.stdout.strip().splitlines()[-1])
    assert payload["connected"] is True
    assert payload["owner"] == "desktop-app"

    # 3. 卸载动作
    removed = app.page.evaluate("() => window.api.automation.integrationAction('uninstall-cli')")
    assert removed["ok"], removed
    assert info(app)["cli"]["installed"] is False


def test_skill_install_and_skill_commands_actually_work(app):
    """兼容旧版地安装动作，并验证公网 Skill 的 CLI 命令真实可用。"""
    data = info(app)
    assert data["snippets"]["skillUrl"].endswith("/skills/musefold/SKILL.md")
    skill_md = data["snippets"]["skillMarkdown"]
    assert skill_md.startswith("---\nname: musefold")
    assert "mf_at_" not in skill_md, "skill 不得包含 token"

    # 一键安装到全部（E2E 重定向到 userData/skills/<app>/musefold/SKILL.md）
    result = app.page.evaluate("() => window.api.automation.integrationAction('install-skill-all')")
    assert result["ok"], result
    refreshed = info(app)
    for key, installed in refreshed["skills"]["installed"].items():
        assert installed, f"{key} 未安装"
        target = Path(refreshed["skills"]["targets"][key]) / "SKILL.md"
        assert target.exists()
        assert "generate -p" in target.read_text("utf8")

    # 关键验收：按 skill 文中的前置检查命令逐字执行（提取 status 那行）
    import re
    match = re.search(r"```bash\n(.+ status --json)\n```", skill_md)
    assert match, "skill 必须包含前置检查命令"
    command = match.group(1)
    installed = app.page.evaluate("() => window.api.automation.integrationAction('install-cli')")
    assert installed["ok"], installed
    shim = Path(info(app)["cli"]["path"])
    completed = subprocess.run(
        command,
        shell=True,
        capture_output=True, text=True, timeout=30,
        env={
            **os.environ,
            "PATH": f"{shim.parent}{os.pathsep}{os.environ.get('PATH', '')}",
            "MUSEFOLD_DATA_DIR": str(app.user_data_dir),
        },
    )
    assert completed.returncode == 0, completed.stderr
    payload = json.loads(completed.stdout.strip().splitlines()[-1])
    assert payload["connected"] is True


def test_mcp_bundle_runs_under_app_runtime(app):
    """内置 MCP 脚本用 App 的启动规格（ELECTRON_RUN_AS_NODE）真实握手一次。"""
    data = info(app)
    launch = data["launch"]
    discovery = json.loads((app.user_data_dir / "automation.json").read_text("utf8"))

    proc = subprocess.Popen(
        [launch["command"], *launch["args"]],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        env={
            **os.environ,
            **launch["env"],
            "MUSEFOLD_ENDPOINT": f"http://127.0.0.1:{discovery['port']}",
            "MUSEFOLD_TOKEN": discovery["token"],
        },
    )
    try:
        request = {
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {"protocolVersion": "2025-06-18", "capabilities": {},
                       "clientInfo": {"name": "guide-accept", "version": "1"}},
        }
        assert proc.stdin and proc.stdout
        proc.stdin.write(json.dumps(request) + "\n")
        proc.stdin.flush()
        line = proc.stdout.readline().strip()
        response = json.loads(line)
        assert response["result"]["serverInfo"]["name"] == "musefold"

        proc.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n")
        proc.stdin.write(json.dumps({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}) + "\n")
        proc.stdin.flush()
        tools = json.loads(proc.stdout.readline().strip())["result"]["tools"]
        names = {tool["name"] for tool in tools}
        assert len(tools) == 24, "连上运行中的 App 应看到 v0.5 全量工具目录"
        assert {"generate_image", "run_github_skill", "open_account_setup", "wait_for_generation"} <= names
    finally:
        proc.kill()
