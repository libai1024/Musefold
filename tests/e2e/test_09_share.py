"""
tests/e2e/test_09_share.py — TASK-DIF-05 分享卡片 + deeplink 验收。

覆盖真实 Electron 链路：preload → share:* IPC → 主进程离屏渲染 → SQLite。
"""
from __future__ import annotations

import base64
from pathlib import Path


PNG_1X1 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8"
    "/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
)


def goto_library(app):
    app.set_view("library")
    app.page.wait_for_selector('[data-testid="library-search"]', timeout=15_000)
    app.page.wait_for_timeout(300)


def reload_library(app):
    app.page.evaluate(
        "() => window.__musefold_test?.stores?.library?.getState?.()?.loadAll?.()"
    )
    app.page.wait_for_timeout(500)


def tiny_preview(app) -> str:
    path = app.user_data_dir / "share-preview.png"
    path.write_bytes(base64.b64decode(PNG_1X1))
    return str(path)


def test_share_card_deeplink_and_confirmed_import(app):
    preview_path = tiny_preview(app)
    prompt = app.api_ok(
        "prompt.create",
        {
            "title": "分享测试 · 日系人像",
            "content": "cinematic portrait, soft light, 85mm, sakura",
            "contentNegative": "lowres, watermark",
            "previewImagePath": preview_path,
            "params": {
                "schemaVersion": 1,
                "size": "1024x1536",
                "quality": "high",
                "n": 2,
                "ratioId": "2:3",
                "promptTarget": "openai",
            },
        },
    )

    direct = app.api_ok("share.renderCard", {"promptId": prompt["id"]})
    assert direct["deeplink"].startswith("musefold://import?data=")
    png = Path(direct["pngPath"])
    assert png.exists() and png.stat().st_size > 1000, "share:renderCard 应产出非空 PNG"

    parsed = app.api_ok("share.parseDeeplink", {"url": direct["deeplink"]})["payload"]
    assert parsed["title"] == "分享测试 · 日系人像"
    assert parsed["content"] == "cinematic portrait, soft light, 85mm, sakura"
    assert parsed["contentNegative"] == "lowres, watermark"
    assert parsed["target"] == "openai"
    assert parsed["params"]["ratioId"] == "2:3"
    assert "previewDataUrl" not in parsed, "deeplink 不应携带图片二进制"

    goto_library(app)
    reload_library(app)
    app.page.click(f'[data-prompt-id="{prompt["id"]}"] [data-testid="prompt-row-open"]')
    app.page.wait_for_selector('[data-testid="prompt-detail"]')
    app.page.click('[data-testid="detail-menu"]')
    app.page.click('[data-testid="detail-share"]')
    app.page.wait_for_selector('[data-testid="share-dialog"]', timeout=30_000)
    app.page.wait_for_selector('[data-testid="share-png-preview"]', timeout=30_000)
    deeplink_value = app.page.input_value('[data-testid="share-deeplink"]')
    assert deeplink_value.startswith("musefold://import?data=")
    app.page.click('[data-testid="share-close"]')

    before = app.db_query("SELECT COUNT(*) AS n FROM prompts WHERE source = 'shared'")[0]["n"]
    app.page.evaluate(
        "(payload) => window.__musefold_test?.requestShareImport?.(payload)",
        parsed,
    )
    app.page.wait_for_selector('[data-testid="share-import-dialog"]', timeout=15_000)
    mid = app.db_query("SELECT COUNT(*) AS n FROM prompts WHERE source = 'shared'")[0]["n"]
    assert mid == before, "导入确认前不能静默写库"

    app.page.click('[data-testid="share-import-confirm"]')
    app.page.wait_for_timeout(900)
    rows = app.db_query(
        "SELECT title, content, content_negative, source, params FROM prompts "
        "WHERE source = 'shared' ORDER BY created_at DESC LIMIT 1"
    )
    assert len(rows) == 1
    imported = rows[0]
    assert imported["title"] == "分享测试 · 日系人像"
    assert imported["content"] == "cinematic portrait, soft light, 85mm, sakura"
    assert imported["content_negative"] == "lowres, watermark"
    assert '"promptTarget":"openai"' in imported["params"]
    assert app.page.evaluate("() => window.__musefold_test?.getView?.()") == "library"


def test_share_parse_rejects_bad_and_large_deeplinks_without_db_write(app):
    before = app.db_query("SELECT COUNT(*) AS n FROM prompts")[0]["n"]

    bad = app.api("share.parseDeeplink", {"url": "musefold://import?data=@@@"})
    assert not bad["ok"]
    assert "INVALID_DEEPLINK" in bad["error"]

    oversized = app.api(
        "share.parseDeeplink",
        {"url": "musefold://import?data=" + ("A" * 90000)},
    )
    assert not oversized["ok"]
    assert "PAYLOAD_TOO_LARGE" in oversized["error"]

    after = app.db_query("SELECT COUNT(*) AS n FROM prompts")[0]["n"]
    assert after == before
