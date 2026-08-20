"""Windows installed-package runtime smoke test.

Run on a Windows runner after building the host package:
  npm run package:win -- --x64
  python -m pytest tests/package/windows_runtime_smoke.py -q

The ARM64 artifact still has a separate structure smoke test. This file uses
the x64 host package because GitHub-hosted Windows runners do not prove that an
ARM64 device can execute the application.
"""
from __future__ import annotations

import base64
import json
import os
import shutil
import subprocess
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright

from tests.e2e.conftest import REPO, _launch
from tests.package.builtin_renderer import assert_fresh_install_uses_builtin_renderer


pytestmark = pytest.mark.skipif(
    os.name != "nt",
    reason="Windows installed-package runtime smoke runs on Windows only",
)

PACKAGE_VERSION = json.loads(
    (REPO / "apps/desktop/package.json").read_text(encoding="utf-8")
)["version"]
INSTALLER = REPO / f"release/Musefold Setup {PACKAGE_VERSION}.exe"
PNG_1PX = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082"
)
PNG_1PX_B64 = base64.b64encode(PNG_1PX).decode("ascii")
@pytest.fixture
def fake_openai_server():
    requests: list[dict] = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802
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

        def log_message(self, *_args):
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


def _install_package(install_root: Path) -> Path:
    assert INSTALLER.is_file(), "missing installer; run `npm run package:win -- --x64` first"
    install_root.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        [str(INSTALLER), "/S", f"/D={install_root}"],
        check=False,
        capture_output=True,
        text=True,
        timeout=180,
    )
    assert result.returncode == 0, (
        f"NSIS install failed with {result.returncode}\n"
        f"stdout={result.stdout[-2000:]}\n"
        f"stderr={result.stderr[-2000:]}"
    )
    candidates = sorted(install_root.rglob("Musefold.exe"))
    assert candidates, f"installed executable not found below {install_root}"
    return candidates[0]


def _stop_process(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            check=False,
            capture_output=True,
        )


def _run_packaged_cli(
    executable: Path,
    user_data: Path,
    *args: str,
) -> subprocess.CompletedProcess[str]:
    cli = executable.parent / "resources/integration/musefold-cli.mjs"
    assert cli.is_file(), f"packaged CLI not found: {cli}"
    discovery = json.loads((user_data / "automation.json").read_text(encoding="utf-8"))
    env = {
        **os.environ,
        "MUSEFOLD_ENDPOINT": f"http://127.0.0.1:{discovery['port']}",
        "MUSEFOLD_TOKEN": discovery["token"],
    }
    return subprocess.run(
        ["node", str(cli), *args],
        cwd=str(executable.parent),
        env=env,
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=120,
    )


def test_windows_installed_package_runtime(fake_openai_server):
    install_root = Path(tempfile.mkdtemp(prefix="musefold-win-installed-"))
    user_data = Path(tempfile.mkdtemp(prefix="musefold-win-runtime-"))
    browser = handle = second_instance = None
    try:
        executable = _install_package(install_root)
        with sync_playwright() as pw:
            browser, handle = _launch(
                user_data,
                pw,
                executable=executable,
                app_args=[],
            )

            # 有意钉死的绊线：每加一条迁移必须有意识地更新此值（macOS 冒烟同款语义）。
            assert handle.api_ok("system.getVersion") == {"app": PACKAGE_VERSION, "db": 19}
            assert handle.page.evaluate(
                "() => ({ skillRuntime: typeof window.api.skillRuntime, designScheme: typeof window.api.designScheme })"
            ) == {"skillRuntime": "object", "designScheme": "object"}

            provider = handle.api_ok(
                "provider.create",
                {
                    "name": "Windows runtime mock provider",
                    "type": "openai-compatible",
                    "baseUrl": fake_openai_server["base"],
                    "model": "gpt-image-2",
                    "isActive": True,
                },
            )
            handle.api_ok("provider.saveKey", provider["id"], "sk-windows-runtime-7788")
            handle.api_ok("provider.setActive", provider["id"])

            result = handle.api_ok(
                "image.generate",
                {
                    "jobId": "windows-runtime-image",
                    "providerId": provider["id"],
                    "prompt": "windows packaged runtime smoke",
                    "size": "1024x1024",
                    "quality": "medium",
                    "n": 1,
                },
            )
            assert result["status"] == "success", result
            image_path = Path(result["imagePath"])
            assert image_path.is_file()
            assert image_path.read_bytes() == PNG_1PX
            assert image_path.resolve().is_relative_to(user_data.resolve())
            assert fake_openai_server["requests"][-1]["body"]["prompt"] == (
                "windows packaged runtime smoke"
            )

            dimensions = handle.page.evaluate(
                """(path) => new Promise((resolve) => {
                  const image = new Image();
                  image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
                  image.onerror = () => resolve({ width: 0, height: 0 });
                  image.src = `media://local/?p=${encodeURIComponent(path)}`;
                })""",
                str(image_path),
            )
            assert dimensions == {"width": 1, "height": 1}
            assert handle.api_ok("history.get", "windows-runtime-image")["status"] == "success"

            cli_status = _run_packaged_cli(executable, user_data, "status", "--json")
            assert cli_status.returncode == 0, cli_status.stderr
            assert json.loads(cli_status.stdout.splitlines()[-1])["owner"] == "desktop-app"

            cli_output = user_data / "packaged-cli-output"
            cli_generation = _run_packaged_cli(
                executable,
                user_data,
                "generate",
                "--prompt",
                "windows packaged CLI automation smoke",
                "--yes",
                "--json",
                "--out",
                str(cli_output),
            )
            cli_payload = json.loads(cli_generation.stdout.splitlines()[-1])
            assert cli_payload["status"] == "success", cli_payload
            assert Path(cli_payload["assets"][0]["path"]).is_file()
            assert fake_openai_server["requests"][-1]["body"]["prompt"] == (
                "windows packaged CLI automation smoke"
            )
            if cli_generation.returncode != 0:
                # The clean-exit regression is asserted separately by the CLI E2E.
                assert cli_generation.returncode == 3221226505
                assert "UV_HANDLE_CLOSING" in cli_generation.stderr

            prompt = handle.api_ok(
                "prompt.create",
                {
                    "title": "Windows runtime round trip",
                    "content": "windows packaged import export",
                },
            )
            export_path = user_data / "windows-runtime-export.json"
            exported = handle.api_ok(
                "system.export",
                {"mode": "db-only", "targetPath": str(export_path)},
            )
            assert exported["path"] == str(export_path)
            assert export_path.is_file()

            reset = handle.api_ok("system.resetData", {"confirm": "RESET"})
            assert Path(reset["backupPath"]).is_file()
            assert handle.api_ok("prompt.get", prompt["id"]) is None
            imported = handle.api_ok(
                "system.import",
                {"sourcePath": str(export_path), "strategy": "merge"},
            )
            assert imported["imported"] > 0
            assert handle.api_ok("prompt.get", prompt["id"])["title"] == (
                "Windows runtime round trip"
            )

            deeplink = handle.api_ok(
                "share.buildDeeplink",
                {
                    "payload": {
                        "title": "Windows protocol import",
                        "content": "opened through musefold protocol",
                        "target": "openai",
                    }
                },
            )["deeplink"]
            before = handle.db_query(
                "SELECT COUNT(*) AS n FROM prompts WHERE source = 'shared'"
            )[0]["n"]
            # The app under test runs with an isolated profile. Reuse that
            # profile for the second instance so Electron routes the deeplink
            # back to the window Playwright is observing.
            second_instance = subprocess.Popen(
                [
                    str(executable),
                    f"--user-data-dir={user_data}",
                    deeplink,
                ],
                cwd=str(REPO),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            handle.page.wait_for_selector(
                '[data-testid="share-import-dialog"]',
                timeout=20_000,
            )
            mid = handle.db_query(
                "SELECT COUNT(*) AS n FROM prompts WHERE source = 'shared'"
            )[0]["n"]
            assert mid == before
            handle.page.click('[data-testid="share-import-confirm"]')
            handle.page.wait_for_timeout(900)
            shared = handle.db_query(
                "SELECT title, content, source FROM prompts "
                "WHERE source = 'shared' ORDER BY created_at DESC LIMIT 1"
            )
            assert shared == [{
                "title": "Windows protocol import",
                "content": "opened through musefold protocol",
                "source": "shared",
            }]
            assert not handle.console_errors(), handle.console_errors()
    finally:
        if browser:
            try:
                browser.close()
            except Exception:
                pass
        if second_instance:
            _stop_process(second_instance)
        if handle:
            _stop_process(handle.proc)
        shutil.rmtree(user_data, ignore_errors=True)
        shutil.rmtree(install_root, ignore_errors=True)


def test_windows_fresh_install_starts_from_builtin_renderer():
    install_root = Path(tempfile.mkdtemp(prefix="musefold-win-fresh-install-"))
    try:
        executable = _install_package(install_root)
        assert_fresh_install_uses_builtin_renderer(executable)
    finally:
        shutil.rmtree(install_root, ignore_errors=True)
