"""一次性截图脚本:中转站 master-detail 设置页视觉复核(RELAY-SETTINGS-UI)。

用法: env -u ELECTRON_RUN_AS_NODE .venv-test/bin/python preview/shot-relay-settings.py
产物: artifacts/relay-settings-providers.png / relay-settings-ai.png
"""

import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "tests" / "e2e"))

from playwright.sync_api import sync_playwright  # noqa: E402
from conftest import _launch  # noqa: E402

OUT = REPO / "artifacts"


def main() -> None:
    tmp = Path(tempfile.mkdtemp(prefix="musefold-shot-"))
    with sync_playwright() as pw:
        browser, app = _launch(tmp, pw)
        page = app.page
        try:
            # 造两个供应商(一个正常一个缺密钥),让状态点/徽标/详情面板都有内容
            p1 = app.api_ok("provider.create", {
                "name": "TvT 中转站",
                "type": "openai-compatible",
                "baseUrl": "https://ai.tvt.wiki",
                "model": "musefold-image-pro",
                "isActive": True,
            })
            app.api_ok("provider.saveKey", p1["id"], "sk-shot-demo-key-0001")
            app.api_ok("provider.setActive", p1["id"])
            app.api_ok("provider.create", {
                "name": "TvT 备用",
                "type": "openai-compatible",
                "baseUrl": "https://ai.tvt.wiki",
                "model": "gpt-image-2",
            })
            conn = app.api_ok("aiConnection.create", {
                "name": "tvt",
                "routeKind": "gateway",
                "presetId": "tvt",
                "baseUrl": "https://ai.tvt.wiki",
                "model": "glm-5.3",
                "isActive": True,
            })
            app.api_ok("aiConnection.saveKey", conn["id"], "sk-shot-agent-0001")
            # 落库后整页重载,确保各 store 重新拉取
            page.reload()
            page.wait_for_selector("#root > *", timeout=30_000)
            page.wait_for_timeout(800)
            app.set_view("settings")
            page.evaluate(
                "() => window.__musefold_test?.stores?.settings?.getState?.().setSection?.('providers')"
            )
            page.wait_for_timeout(800)
            page.screenshot(path=str(OUT / "relay-settings-providers.png"), full_page=False)

            page.evaluate(
                "() => window.__musefold_test?.stores?.settings?.getState?.().setSection?.('ai')"
            )
            page.wait_for_timeout(800)
            page.screenshot(path=str(OUT / "relay-settings-ai.png"), full_page=False)
            print("screenshots written to", OUT)
        finally:
            browser.close()
            app.proc.terminate()


if __name__ == "__main__":
    main()
