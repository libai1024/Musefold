"""
tests/e2e/test_04c_generate_live.py — 真出图验收（需要真 API Key，默认整体跳过）。

test_04_generate.py 用本机假端点把**失败/取消/重试**路径钉死；这里补上只有真
服务商才能验证的那一半：真 PNG 落盘、media:// 真渲染、cost/duration 真写库、
取消真能打断在途的 HTTP 请求。

启用方式（密钥只从环境变量读，绝不落仓库、绝不进日志）：

    export MUSEFOLD_TVT_KEY='sk-...'          # 必需，缺省则整个文件 skip
    export MUSEFOLD_TVT_BASE=...              # 可选，默认 https://ai.tvt.wiki/v1
    export MUSEFOLD_TVT_MODEL=...             # 可选，默认 gpt-image-2
    export MUSEFOLD_LIVE_FULL=1               # 可选，跑额外的花钱用例（重试）
    .venv-test/bin/python -m pytest tests/e2e/test_04c_generate_live.py -v -s

成本与时间：默认 2 张图（quality=low），实测单张 ~45–60s，全套约 2–4 分钟。
MUSEFOLD_LIVE_FULL=1 再多 1 张。所有用例都用 low 质量、1:1，把花费压到最低。

注意：断言里不出现密钥；只断 hasKey / 末 4 位。失败信息里也不回显 key。
"""
from __future__ import annotations

import os
import hashlib
import time
from pathlib import Path

import pytest


LIVE_KEY = os.environ.get("MUSEFOLD_TVT_KEY", "").strip()
LIVE_BASE = os.environ.get("MUSEFOLD_TVT_BASE", "https://ai.tvt.wiki/v1").strip()
LIVE_MODEL = os.environ.get("MUSEFOLD_TVT_MODEL", "gpt-image-2").strip()
FULL = os.environ.get("MUSEFOLD_LIVE_FULL", "").strip() == "1"

# 单张真出图的上限（实测 ~48s，留足余量给排队/重试）
ONE_IMAGE_MS = 180_000

pytestmark = pytest.mark.skipif(
    not LIVE_KEY,
    reason="需要 MUSEFOLD_TVT_KEY 才能跑真出图（见文件头说明）",
)


# ---------------------------------------------------------------- helpers

def wb(app, expr: str):
    return app.page.evaluate(
        "(src) => { const s = window.__musefold_test.stores.workbench.getState();"
        " return eval(src); }",
        expr,
    )


def wb_call(app, method: str, *args):
    return app.page.evaluate(
        """async ([m, args]) => {
            const s = window.__musefold_test.stores.workbench.getState();
            const r = await s[m](...args);
            return r ?? null;
        }""",
        [method, list(args)],
    )


def wb_fire(app, method: str, *args):
    app.page.evaluate(
        """([m, args]) => {
            const s = window.__musefold_test.stores.workbench.getState();
            void s[m](...args);
        }""",
        [method, list(args)],
    )


def live_provider(app):
    """建真 Provider 并存真密钥。

    密钥经 provider:saveKey → safeStorage，密文写在**临时** userDataDir 里
    （夹具退出即 rmtree），既不进仓库也不留在真实用户目录。
    """
    p = app.api_ok("provider.create", {
        "name": "TvT AI 中转站（live）",
        "type": "openai-compatible",
        "baseUrl": LIVE_BASE,
        "model": LIVE_MODEL,
        "isActive": True,
    })
    app.api_ok("provider.saveKey", p["id"], LIVE_KEY)
    app.api_ok("settings.pricing.set", {
        "providerId": p["id"],
        "mode": "per-image",
        "unitCents": 32,
    })
    app.api_ok("provider.setActive", p["id"])
    app.page.evaluate(
        "async () => { await window.__musefold_test.stores.generation.getState().loadProviders(); }"
    )
    app.page.wait_for_timeout(300)

    listed = next(x for x in app.api_ok("provider.list") if x["id"] == p["id"])
    assert listed["hasKey"] is True, "真密钥应已保存"
    assert listed["keySuffix"] == LIVE_KEY[-4:], "回包只应带末 4 位"
    return p


def goto_refine(app):
    app.set_view("generate")
    app.page.wait_for_timeout(400)


def open_generation_settings(app):
    menu = app.page.locator('[data-testid="workbench-generation-options"]')
    if menu.count() == 0 or not menu.is_visible():
        app.page.click('[data-testid="workbench-more-settings"]')
        app.page.wait_for_selector('[data-testid="workbench-generation-options"]')


def choose_quality(app, quality: str):
    open_generation_settings(app)
    app.page.click(f'[data-testid="refine-quality-{quality}"]')


def choose_count(app, count: int):
    open_generation_settings(app)
    app.page.click(f'[data-testid="refine-count-{count}"]')


def settle(app, timeout=ONE_IMAGE_MS):
    app.page.wait_for_function(
        "() => window.__musefold_test.stores.workbench.getState().isGenerating === false",
        timeout=timeout,
    )
    app.page.wait_for_timeout(300)


def history_rows(app):
    return app.db_query(
        "SELECT id, status, error_code, error_message, prompt_text, image_path, cost,"
        " duration_ms, model, params FROM history ORDER BY created_at ASC, rowid ASC"
    )


def cheap(app):
    """把参数压到最省：1:1 + 标清 + 1 张。"""
    app.page.click('[data-testid="refine-ratio-trigger"]')
    app.page.click('[data-testid="refine-ratio-1:1"]')
    choose_quality(app, "low")
    choose_count(app, 1)
    app.page.wait_for_timeout(200)


# ---------------------------------------------------------------- 连通性

def test_live_validate_connection_reports_model(app):
    """测试连接能真的探到模型列表（不花生图钱）。"""
    p = live_provider(app)
    res = app.api_ok("provider.validate", p["id"])
    assert res["ok"] is True, f"连通性测试应通过: {res.get('message')}"
    models = [m["id"] for m in (res.get("models") or [])]
    assert models, f"应返回模型列表: {res.get('message')}"
    assert LIVE_MODEL in models, f"{LIVE_MODEL} 应在可用模型里，实际 {models[:12]}"


# ---------------------------------------------------------------- 真出图

def test_live_generate_writes_real_png_and_history(app):
    """一次真出图：成功卡 + 真 PNG 落盘 + 历史行带 cost/duration + media:// 能渲染。"""
    live_provider(app)
    goto_refine(app)
    app.page.fill('[data-testid="refine-prompt"]', "a single red maple leaf on white background, minimal")
    cheap(app)

    t0 = time.time()
    wb_call(app, "submitDraft")
    settle(app)
    elapsed = time.time() - t0

    status = wb(app, "s.turns[0].results[0].status")
    if status != "success":
        pytest.fail(
            "真出图失败："
            f"code={wb(app, 's.turns[0].results[0].errorCode')} "
            f"msg={wb(app, 's.turns[0].results[0].error')}"
        )

    # ── 数据库真相 ──────────────────────────────────────────
    rows = history_rows(app)
    assert len(rows) == 1, f"应写 1 条历史，实际 {rows}"
    row = rows[0]
    assert row["status"] == "success", row
    assert row["error_code"] is None and row["error_message"] is None, row
    assert row["model"] == LIVE_MODEL, row
    assert row["image_path"], "成功行必须落图片路径"
    assert isinstance(row["cost"], int) and row["cost"] > 0, f"应记成本（分）: {row['cost']}"
    assert isinstance(row["duration_ms"], int) and row["duration_ms"] > 0, row["duration_ms"]

    # ── 磁盘真相：真 PNG，不是 0 字节占位 ──────────────────
    img = Path(row["image_path"])
    assert img.exists(), f"图片文件不存在: {img}"
    image_bytes = img.read_bytes()
    head = image_bytes[:8]
    image_sha256 = hashlib.sha256(image_bytes).hexdigest()
    assert head == b"\x89PNG\r\n\x1a\n", f"不是合法 PNG: {head!r}"
    assert img.stat().st_size > 10_000, f"图片太小，疑似占位: {img.stat().st_size} 字节"

    # 落在应用自己的图片目录里，而不是随手写到用户目录
    assert str(app.user_data_dir) in str(img) or "Musefold" in str(img), \
        f"图片应落在应用目录内: {img}"

    # ── UI 真相：卡是成功态，且 media:// 真解出了像素 ────────
    card = app.page.locator('[data-testid="generate-result-card"]').first
    assert card.get_attribute("data-status") == "success"

    dims = app.page.evaluate(
        """async () => {
            const el = document.querySelector('[data-testid="generate-result-card"] img');
            if (!el) return null;
            if (!el.complete) await new Promise((r) => {
                el.addEventListener('load', r, { once: true });
                el.addEventListener('error', r, { once: true });
                setTimeout(r, 8000);
            });
            return { src: el.currentSrc || el.src, w: el.naturalWidth, h: el.naturalHeight };
        }"""
    )
    assert dims, "成功卡应渲染 <img>"
    assert dims["src"].startswith("media://"), f"生成图应走 media:// 协议，实际 {dims['src'][:40]}"
    assert dims["w"] > 0 and dims["h"] > 0, f"media:// 图没解出像素（协议或 CSP 有问题）: {dims}"

    image_size = img.stat().st_size
    print(f"\n[live] 出图成功 {dims['w']}x{dims['h']}, "
          f"{image_size} bytes ({image_size // 1024}KB), {row['duration_ms']}ms, "
          f"成本 {row['cost']} 分, 墙钟 {elapsed:.1f}s, sha256={image_sha256}")


def test_live_lightbox_opens_generated_image(app):
    """成功卡能放大预览（media:// 在 Dialog 里也得能显示）。"""
    live_provider(app)
    goto_refine(app)
    app.page.fill('[data-testid="refine-prompt"]', "a small blue ceramic cup, studio light, minimal")
    cheap(app)
    wb_call(app, "submitDraft")
    settle(app)

    if wb(app, "s.turns[0].results[0].status") != "success":
        pytest.skip(f"本轮未成功出图（{wb(app, 's.turns[0].results[0].errorCode')}），跳过预览断言")

    app.page.click('[data-testid="generate-result-card"] img')
    app.page.wait_for_timeout(900)

    shot = app.page.evaluate(
        """() => {
            const imgs = [...document.querySelectorAll('[role="dialog"] img')];
            const el = imgs.find((i) => (i.currentSrc || i.src).startsWith('media://'));
            return el ? { w: el.naturalWidth, h: el.naturalHeight } : null;
        }"""
    )
    assert shot, "点图应打开放大预览"
    assert shot["w"] > 0, f"预览里的图没解出像素: {shot}"

    app.page.keyboard.press("Escape")
    app.page.wait_for_timeout(500)
    assert app.page.locator('[role="dialog"]').count() == 0, "Esc 应关闭预览"
    # Esc 关图不该顺手取消任务（这一轮已结束，主要防的是 Esc 被双重处理）
    assert wb(app, "s.turns[0].results[0].status") == "success", "关预览不该改动结果状态"


def test_live_cancel_aborts_real_inflight_request(app):
    """取消真能打断在途的 HTTP 请求（真服务商 ~45s，窗口足够）。"""
    live_provider(app)
    goto_refine(app)
    app.page.fill('[data-testid="refine-prompt"]', "a long winding mountain road at dusk")
    app.page.click('[data-testid="refine-ratio-trigger"]')
    app.page.click('[data-testid="refine-ratio-1:1"]')
    choose_quality(app, "low")
    choose_count(app, 2)
    app.page.wait_for_timeout(200)

    wb_fire(app, "submitDraft")
    app.page.wait_for_function(
        "() => !!window.__musefold_test.stores.workbench.getState().activeJobId",
        timeout=15_000,
    )
    app.page.wait_for_timeout(2500)  # 让请求真的发出去、在等服务端
    t0 = time.time()
    app.page.click('[data-testid="refine-cancel"]')
    settle(app, timeout=60_000)
    took = time.time() - t0

    statuses = wb(app, "s.turns[0].results.map(r => r.status)")
    assert "cancelled" in statuses, f"应有被取消的张，实际 {statuses}"
    assert "pending" not in statuses, f"收尾后不应残留 pending，实际 {statuses}"
    # 取消要立刻见效，不是等出图完再说
    assert took < 30, f"取消应立刻中止在途请求，实际等了 {took:.1f}s"

    rows = history_rows(app)
    assert rows, "在途那张应写一条历史"
    assert rows[0]["status"] == "cancelled", rows[0]
    assert rows[0]["error_code"] == "CANCELLED", rows[0]
    assert rows[0]["image_path"] is None, "取消不该留下半张图"
    assert len(rows) == 1, f"未开始的第 2 张不该发请求/写史，实际 {rows}"

    print(f"\n[live] 取消生效耗时 {took:.1f}s")


@pytest.mark.skipif(not FULL, reason="额外花一张图的钱，需 MUSEFOLD_LIVE_FULL=1")
def test_live_retry_success_writes_second_row(app):
    """成功后重试：再出一张，写**新的**历史行，原图与原记录都留着。"""
    live_provider(app)
    goto_refine(app)
    app.page.fill('[data-testid="refine-prompt"]', "one green apple on a wooden table")
    cheap(app)
    wb_call(app, "submitDraft")
    settle(app)

    if wb(app, "s.turns[0].results[0].status") != "success":
        pytest.skip("首轮未成功，重试断言无意义")

    first = history_rows(app)[0]
    first_img = Path(first["image_path"])

    turn_id = wb(app, "s.turns[0].id")
    card_id = wb(app, "s.turns[0].results[0].id")
    wb_call(app, "retryResult", turn_id, card_id)
    settle(app)

    rows = history_rows(app)
    assert len(rows) == 2, f"重试应另起一行，实际 {rows}"
    assert rows[0]["id"] == first["id"], "原记录不得被覆盖"
    assert rows[1]["id"] != first["id"]
    assert rows[1]["prompt_text"] == first["prompt_text"], "重试按快照重发"
    assert first_img.exists(), "原图不该被重试覆盖/删除"

    if rows[1]["status"] == "success":
        assert rows[1]["image_path"] != first["image_path"], "两张图应各自落盘"
        assert Path(rows[1]["image_path"]).exists()
