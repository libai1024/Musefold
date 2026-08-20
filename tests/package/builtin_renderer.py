"""Packaged fresh-install check: boot from the builtin renderer (V121-HOT-12).

Protocol §7.6: a brand-new install must start from the bundled `out/renderer`
even when there is no network.

Offline is guaranteed by the product, not by this smoke inventing a partition:

1. Renderer resolver: no complete candidate → always `builtin`
   (`electron/main/renderer-bundle.ts`).
2. Content check waits 30s after app ready (`CONTENT_UPDATE_CHECK_INITIAL_DELAY_MS`
   in `electron/update/content-updater.ts`). Packaged builds ignore the test
   feed / key / delay env vars, but still honor `MUSEFOLD_CONTENT_UPDATE_DISABLED`.
3. Fetch/install failures never throw and never rewrite the frozen source.

This smoke asserts (1). `_launch` already waits for `#root > *`; we then call
`updater.getContentState` over CDP and quit, which is well before the 30s first
check. We do not inject an invalid proxy: this suite has no Chromium-proven
offline hook, and an unreliable fake-offline would be worse than the comment
above. Packaged builds cannot be pointed at a fixture feed. Content updates
apply on the *next* launch, so this process stays on builtin even if the
delayed check later succeeds.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

from tests.e2e.conftest import _launch


def _stop_app_process(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=10)
    except Exception:
        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                check=False,
                capture_output=True,
            )
        else:
            process.kill()


def assert_fresh_install_uses_builtin_renderer(executable: Path) -> None:
    """Launch `executable` against a never-used userData dir and assert builtin.

    Isolation matches the rest of package smoke: Chromium `--user-data-dir` plus
    `MUSEFOLD_E2E_USER_DATA_DIR` (see `tests.e2e.conftest._launch` /
    `electron/main/index.ts`). `app_args=[]` is the packaged convention — do
    not pass unpackaged `out/main/index.js`.
    """
    user_data = Path(tempfile.mkdtemp(prefix="musefold-fresh-install-"))
    browser = handle = None
    try:
        with sync_playwright() as pw:
            browser, handle = _launch(user_data, pw, executable=executable, app_args=[])
            assert handle.proc.poll() is None, (
                "app process exited before builtin-renderer assertion"
            )
            url = handle.page.url or ""
            assert url.startswith("app://musefold/"), url
            # CDP evaluate of the preload bridge — same path as e2e
            # `app.api_ok("updater.getContentState")`.
            state = handle.api_ok("updater.getContentState")
            assert state["activeSource"] == "builtin", state
            assert state["activeBundleVersion"] is None, state
            assert state["pendingVersion"] is None, state
            assert state["knownGoodVersion"] is None, state
            bundles = user_data / "content-bundles" / "bundles"
            if bundles.exists():
                leftover = sorted(path.name for path in bundles.iterdir())
                assert leftover == [], leftover
    finally:
        if browser:
            try:
                browser.close()
            except Exception:
                pass
        if handle:
            _stop_app_process(handle.proc)
        shutil.rmtree(user_data, ignore_errors=True)
