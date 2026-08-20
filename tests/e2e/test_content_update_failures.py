"""V121-HOT-11：内容层热更新三条失败路径（协议 §7.6）。

路径一：验签失败拒绝应用。
路径二：minShellVersion 不满足拒绝应用。
路径三：连续两次启动失败后自动回退到内置 renderer。
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import threading
from contextlib import contextmanager
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from conftest import REPO, _launch

BUNDLE_CLI = REPO / "packages" / "update-protocol" / "src" / "cli.ts"
STORE_FILENAME = "musefold-providers-v0.3.0.json"
PENDING_VERSION = "9.9.9-e2e.1"
BAD_BUNDLE_HTML = """<!doctype html>
<html>
  <head><meta charset="utf-8"><title>e2e-bad-bundle</title></head>
  <body>
    <div id="root"><p>e2e-bad-bundle</p></div>
  </body>
</html>
"""


def _run_bundle_cli(args: list[str], *, env: dict[str, str] | None = None, timeout: int = 30):
    merged = dict(os.environ)
    if env:
        merged.update(env)
    result = subprocess.run(
        ["node", str(BUNDLE_CLI), *args],
        cwd=str(REPO),
        env=merged,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
        check=False,
    )
    assert result.returncode == 0, {
        "args": args,
        "returncode": result.returncode,
        "stdout": result.stdout,
        "stderr": result.stderr,
    }
    return result


def parse_keygen_output(text: str) -> dict[str, str]:
    public_key = None
    private_key = None
    section = "public"
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("----- BEGIN"):
            section = "private"
            continue
        if line.startswith("----- END"):
            section = "done"
            continue
        if line.startswith("#"):
            continue
        if section == "public" and public_key is None:
            public_key = line
        elif section == "private" and " " not in line:
            private_key = line
    assert public_key and private_key, f"keygen output missing keys:\n{text}"
    return {"public": public_key, "private": private_key}


def generate_signing_key_pair() -> dict[str, str]:
    return parse_keygen_output(_run_bundle_cli(["keygen"]).stdout)


def unsigned_manifest(**overrides):
    body = {
        "schemaVersion": 1,
        "channel": "stable",
        "bundleVersion": "1.2.1-e2e.1",
        "gitSha": "0ce9aac",
        "createdAt": "2026-08-20T00:00:00Z",
        "minShellVersion": "0.1.0",
        "maxShellVersion": None,
        "surfaces": {
            "electron-renderer": {
                "url": "https://cdn.example.test/Musefold/bundles/e2e/renderer.tar.zst",
                "sha256": "ab" * 32,
                "bytes": 2431044,
            },
        },
        "rollout": {"percentage": 100},
    }
    body.update(overrides)
    return body


def sign_manifest_to(path: Path, body: dict, private_key: str) -> dict:
    path.write_text(json.dumps(body), encoding="utf-8")
    signed = json.loads(
        _run_bundle_cli(
            ["sign", str(path)],
            env={"MUSEFOLD_BUNDLE_SIGNING_KEY": private_key},
        ).stdout,
    )
    path.write_text(json.dumps(signed, indent=2) + "\n", encoding="utf-8")
    return signed


def content_update_env(*, public_key: str, manifest_url: str) -> dict[str, str]:
    return {
        "MUSEFOLD_CONTENT_UPDATE_DISABLED": "1",
        "MUSEFOLD_CONTENT_TEST_PUBLIC_KEY": public_key,
        "MUSEFOLD_CONTENT_TEST_FEED_URL": manifest_url,
    }


def store_path(user_data: Path) -> Path:
    return user_data / STORE_FILENAME


def read_content_update(user_data: Path) -> dict:
    path = store_path(user_data)
    if not path.is_file():
        return {
            "pendingVersion": None,
            "knownGoodVersion": None,
            "previousGoodVersion": None,
            "attemptCount": 0,
            "rejectedVersions": [],
        }
    data = json.loads(path.read_text(encoding="utf-8"))
    update = data.get("contentUpdate") or {}
    assert isinstance(update, dict), data
    return update


def write_content_update(user_data: Path, **fields) -> None:
    path = store_path(user_data)
    existing = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}
    content = {
        "pendingVersion": None,
        "knownGoodVersion": None,
        "previousGoodVersion": None,
        "attemptCount": 0,
        "rejectedVersions": [],
    }
    content.update(fields)
    existing["contentUpdate"] = content
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(existing, indent=2) + "\n", encoding="utf-8")


def listed_bundle_dirs(user_data: Path) -> list[str]:
    root = user_data / "content-bundles" / "bundles"
    if not root.is_dir():
        return []
    return sorted(p.name for p in root.iterdir() if p.is_dir())


def seed_bad_pending_bundle(user_data: Path, version: str = PENDING_VERSION) -> None:
    bundle = user_data / "content-bundles" / "bundles" / version
    bundle.mkdir(parents=True)
    (bundle / "index.html").write_text(BAD_BUNDLE_HTML, encoding="utf-8")
    (bundle / "pet.html").write_text(BAD_BUNDLE_HTML, encoding="utf-8")
    write_content_update(user_data, pendingVersion=version, attemptCount=0)


def _stop_app(handle, browser=None) -> None:
    try:
        if handle and handle.browser:
            handle.browser.close()
        elif browser:
            browser.close()
    except Exception:  # noqa: BLE001
        pass
    if handle:
        handle.proc.terminate()
        try:
            handle.proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            handle.proc.kill()


@contextmanager
def launched_app(pw, user_data: Path, extra_env: dict[str, str]):
    browser = None
    handle = None
    try:
        browser, handle = _launch(user_data, pw, extra_env=extra_env)
        yield handle
    finally:
        _stop_app(handle, browser)


@pytest.fixture
def isolated_user_data():
    tmp = Path(tempfile.mkdtemp(prefix="musefold-e2e-content-"))
    try:
        yield tmp
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


@pytest.fixture
def signing_keys():
    return generate_signing_key_pair(), generate_signing_key_pair()


@pytest.fixture
def manifest_server():
    root = Path(tempfile.mkdtemp(prefix="musefold-e2e-manifest-"))

    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(root), **kwargs)

        def log_message(self, _format, *_args):
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    port = int(server.server_address[1])
    try:
        yield {
            "root": root,
            "origin": f"http://127.0.0.1:{port}",
            "manifest_url": f"http://127.0.0.1:{port}/manifest.json",
            "manifest_path": root / "manifest.json",
        }
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
        shutil.rmtree(root, ignore_errors=True)


def test_rejects_manifest_with_invalid_signature(
    _pw, isolated_user_data, signing_keys, manifest_server,
):
    key_a, key_b = signing_keys
    sign_manifest_to(manifest_server["manifest_path"], unsigned_manifest(), key_a["private"])
    env = content_update_env(public_key=key_b["public"], manifest_url=manifest_server["manifest_url"])

    with launched_app(_pw, isolated_user_data, env) as app:
        snapshot = app.api_ok("updater.checkContentNow")
        assert snapshot["status"] == "manifest_invalid"
        assert snapshot["reason"] == "invalid_signature"

        assert listed_bundle_dirs(app.user_data_dir) == []
        state = read_content_update(app.user_data_dir)
        assert state.get("pendingVersion") in (None, "")


def test_rejects_manifest_when_min_shell_version_unmet(
    _pw, isolated_user_data, signing_keys, manifest_server,
):
    key_a, _key_b = signing_keys
    sign_manifest_to(
        manifest_server["manifest_path"],
        unsigned_manifest(minShellVersion="99.0.0"),
        key_a["private"],
    )
    env = content_update_env(public_key=key_a["public"], manifest_url=manifest_server["manifest_url"])

    with launched_app(_pw, isolated_user_data, env) as app:
        snapshot = app.api_ok("updater.checkContentNow")
        assert snapshot["status"] == "manifest_invalid"
        assert snapshot["reason"] == "incompatible_shell_version"

        assert listed_bundle_dirs(app.user_data_dir) == []
        state = read_content_update(app.user_data_dir)
        assert state.get("pendingVersion") in (None, "")


def test_rolls_back_after_two_failed_startups(
    _pw, isolated_user_data, signing_keys, manifest_server,
):
    key_a, _key_b = signing_keys
    env = content_update_env(public_key=key_a["public"], manifest_url=manifest_server["manifest_url"])
    seed_bad_pending_bundle(isolated_user_data)

    with launched_app(_pw, isolated_user_data, env):
        pass
    after_first = read_content_update(isolated_user_data)
    assert after_first.get("attemptCount") == 1
    assert after_first.get("pendingVersion") == PENDING_VERSION

    with launched_app(_pw, isolated_user_data, env):
        pass
    after_second = read_content_update(isolated_user_data)
    assert after_second.get("attemptCount") == 2
    assert after_second.get("pendingVersion") == PENDING_VERSION

    with launched_app(_pw, isolated_user_data, env) as app:
        state = app.api_ok("updater.getContentState")
        assert state["activeSource"] == "builtin"
    after_third = read_content_update(isolated_user_data)
    assert after_third.get("pendingVersion") in (None, "")
    assert PENDING_VERSION in (after_third.get("rejectedVersions") or [])
