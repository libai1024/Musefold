"""Installed macOS package smoke test."""
from __future__ import annotations

import base64
import json
import shutil
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright

from tests.e2e.conftest import REPO, _launch
from tests.package.builtin_renderer import assert_fresh_install_uses_builtin_renderer


def _macos_packaged_app() -> Path:
    """Prefer electron-builder's current output; keep the historical layout as fallback."""
    candidates = [
        REPO / "release/mac-arm64/Musefold.app",
        REPO / "release/mac/Musefold.app",
        REPO / "release/v0.3.0/macos/mac-arm64/Musefold.app",
    ]
    for package in candidates:
        if (package / "Contents/MacOS/Musefold").is_file():
            return package
    return candidates[0]


PACKAGE = _macos_packaged_app()
EXECUTABLE = PACKAGE / "Contents/MacOS/Musefold"
PRODUCT_DOCS = PACKAGE / "Contents/Resources/product-docs/README.md"
PRODUCT_ROADMAP = PACKAGE / "Contents/Resources/product-docs/90-roadmap-and-task-index.md"
PACKAGE_VERSION = json.loads(
    (REPO / "apps/desktop/package.json").read_text(encoding="utf-8")
)["version"]
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
            body = json.loads((self.rfile.read(length) if length else b"{}").decode("utf-8") or "{}")
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
        yield {"base": f"http://127.0.0.1:{server.server_address[1]}/v1", "requests": requests}
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_macos_package_end_to_end(fake_openai_server):
    assert EXECUTABLE.is_file(), "missing package; run `npm run package:mac` first"
    assert PRODUCT_DOCS.is_file() and PRODUCT_ROADMAP.is_file()

    user_data = Path(tempfile.mkdtemp(prefix="musefold-macos-package-"))
    browser = handle = None
    try:
        with sync_playwright() as pw:
            browser, handle = _launch(user_data, pw, executable=EXECUTABLE, app_args=[])
            version = handle.api_ok("system.getVersion")
            assert version["app"] == PACKAGE_VERSION
            # 有意钉死的绊线：每加一条迁移必须有意识地更新此值（Windows 冒烟同款语义）。
            assert version["db"] == 19
            assert handle.page.evaluate(
                "() => ({ skillRuntime: typeof window.api.skillRuntime, designScheme: typeof window.api.designScheme })"
            ) == {"skillRuntime": "object", "designScheme": "object"}

            provider = handle.api_ok(
                "provider.create",
                {
                    "name": "Packaged mock provider",
                    "type": "openai-compatible",
                    "baseUrl": fake_openai_server["base"],
                    "model": "gpt-image-2",
                    "isActive": True,
                },
            )
            handle.api_ok("provider.saveKey", provider["id"], "sk-package-smoke-secret-7788")
            prompt = handle.api_ok(
                "prompt.create",
                {"title": "Packaged round trip", "content": "package smoke prompt"},
            )
            result = handle.api_ok(
                "image.generate",
                {
                    "jobId": "package-smoke-image-v021",
                    "providerId": provider["id"],
                    "prompt": "packaged image output",
                    "promptId": prompt["id"],
                    "size": "1024x1024",
                    "quality": "low",
                    "n": 1,
                },
            )
            assert result["status"] == "success", result
            image_path = Path(result["imagePath"])
            assert image_path.is_file() and image_path.read_bytes() == PNG_1PX
            assert image_path.resolve().is_relative_to(user_data.resolve())
            assert fake_openai_server["requests"][-1]["body"]["prompt"] == "packaged image output"
            assert handle.api_ok("history.get", result["historyId"])["status"] == "success"
            assert handle.api_ok("history.related", {"promptId": prompt["id"], "status": "success"})["total"] == 1

            export_path = user_data / "main-export.json"
            exported = handle.api_ok(
                "system.export",
                {"mode": "db-only", "targetPath": str(export_path), "includeHistory": True},
            )
            assert exported["path"] == str(export_path) and export_path.is_file()
            reset = handle.api_ok("system.resetData", {"confirm": "RESET"})
            assert Path(reset["backupPath"]).is_file()
            assert handle.api_ok("prompt.get", prompt["id"]) is None
            imported = handle.api_ok("system.import", {"sourcePath": str(export_path), "strategy": "merge"})
            assert imported["imported"] > 0
            assert handle.api_ok("prompt.get", prompt["id"])["title"] == "Packaged round trip"
            assert not handle.console_errors(), handle.console_errors()
    finally:
        if browser:
            try:
                browser.close()
            except Exception:
                pass
        if handle:
            handle.proc.terminate()
            try:
                handle.proc.wait(timeout=10)
            except Exception:
                handle.proc.kill()
        shutil.rmtree(user_data, ignore_errors=True)


def test_macos_fresh_install_starts_from_builtin_renderer():
    assert EXECUTABLE.is_file(), "missing package; run `npm run package:mac` first"
    assert_fresh_install_uses_builtin_renderer(EXECUTABLE)
