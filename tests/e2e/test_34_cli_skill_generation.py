"""CLI and imported-Skill generation regression across the real Electron host.

The local OpenAI-compatible fixture keeps this deterministic while preserving
the production CLI -> Automation -> Core -> Provider -> history/file path.
"""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest

from test_07_onboarding import _make_server
REPO_ROOT = Path(__file__).resolve().parents[2]
CLI_BINARY = REPO_ROOT / "packages" / "cli" / "dist" / "musefold.mjs"


@pytest.fixture()
def fake_provider():
    server, thread, requests = _make_server(models_status=200)
    try:
        yield {
            "base": f"http://127.0.0.1:{server.server_address[1]}/v1",
            "requests": requests,
        }
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def configure_provider(app, fake_provider):
    provider = app.api_ok("provider.create", {
        "name": "CLI Skill generation fixture",
        "type": "openai-compatible",
        "baseUrl": fake_provider["base"],
        "model": "gpt-image-2",
        "isActive": True,
    })
    app.api_ok("provider.saveKey", provider["id"], "sk-cli-skill-e2e")
    app.api_ok("provider.setActive", provider["id"])
    return provider


def run_cli(app, *args: str, timeout: int = 120) -> subprocess.CompletedProcess[str]:
    assert CLI_BINARY.is_file(), "run `node scripts/build-cli.mjs` first"
    discovery = json.loads((app.user_data_dir / "automation.json").read_text("utf8"))
    env = {
        **os.environ,
        "MUSEFOLD_ENDPOINT": f"http://127.0.0.1:{discovery['port']}",
        "MUSEFOLD_TOKEN": discovery["token"],
    }
    return subprocess.run(
        ["node", str(CLI_BINARY), *args],
        cwd=REPO_ROOT,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
        check=False,
    )


def json_lines(result: subprocess.CompletedProcess[str]) -> list[dict]:
    return [json.loads(line) for line in result.stdout.splitlines() if line.strip()]


def assert_clean_exit(result: subprocess.CompletedProcess[str]) -> None:
    assert result.returncode == 0, {
        "returncode": result.returncode,
        "stdout": result.stdout,
        "stderr": result.stderr,
    }
    assert "UV_HANDLE_CLOSING" not in result.stderr
    assert "Assertion failed" not in result.stderr


def test_cli_status_and_generate_exit_cleanly(app, fake_provider, tmp_path):
    provider = configure_provider(app, fake_provider)

    status = run_cli(app, "status", "--json")
    assert_clean_exit(status)
    status_payload = json_lines(status)[-1]
    assert status_payload["connected"] is True
    assert status_payload["owner"] == "desktop-app"

    output_dir = tmp_path / "cli-output"
    generated = run_cli(
        app,
        "generate",
        "--prompt",
        "Windows CLI automation generation",
        "--yes",
        "--json",
        "--out",
        str(output_dir),
    )
    assert_clean_exit(generated)
    payload = json_lines(generated)[-1]
    assert payload["status"] == "success", payload
    assert payload["assets"]
    assert Path(payload["assets"][0]["path"]).is_file()

    posts = [request for request in fake_provider["requests"] if request["method"] == "POST"]
    assert len(posts) == 1
    assert posts[0]["body"]["prompt"] == "Windows CLI automation generation"

    history = app.db_query(
        "SELECT status, provider_id, prompt_text, image_path FROM history ORDER BY created_at DESC LIMIT 1"
    )[0]
    assert history["status"] == "success"
    assert history["provider_id"] == provider["id"]
    assert Path(history["image_path"]).is_file()

    audit = app.page.evaluate("() => window.api.automation.auditList(20)")
    matching = [
        entry for entry in audit
        if entry["action"] == "generate_image"
        and entry["promptText"] == "Windows CLI automation generation"
    ]
    assert matching and matching[0]["status"] == "success"
    assert matching[0]["approvedVia"] == "consent"
