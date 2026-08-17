"""Opt-in live run of the full v0.3.2 design-scheme lifecycle.

create (idea) -> trial run (deterministic pipeline, real image generation)
-> select cover -> formalize -> use the formal scheme from the scheme center.

Asserts each stage in both UI (conversation cards, composer attachment,
scheme-center rows) and persistence (design-scheme DB via IPC).
"""
from __future__ import annotations

import os
import shutil
from pathlib import Path

import pytest


TEXT_KEY = os.environ.get("MUSEFOLD_TEXT_AI_KEY", "").strip()
TEXT_BASE = os.environ.get("MUSEFOLD_TEXT_AI_BASE", "https://ai.tvt.wiki/v1").strip()
TEXT_MODEL = os.environ.get("MUSEFOLD_TEXT_AI_MODEL", "gpt-5.4-mini").strip()
IMAGE_KEY = os.environ.get("MUSEFOLD_TVT_KEY", "").strip()
IMAGE_BASE = os.environ.get("MUSEFOLD_TVT_BASE", "https://ai.tvt.wiki/v1").strip()
IMAGE_MODEL = os.environ.get("MUSEFOLD_TVT_MODEL", "gpt-image-2").strip()
REPO_ROOT = Path(__file__).resolve().parents[2]
SOURCE_IMAGE = REPO_ROOT / "generated/v31-skill-research/source-landscape.jpg"
EVIDENCE_DIR = REPO_ROOT / "generated/v032-scheme-run"

pytestmark = pytest.mark.skipif(
    not TEXT_KEY or not IMAGE_KEY,
    reason="需要真实文本/图片 API 临时凭证",
)


def _api_result(app, dotted: str, *args):
    value = app.api_ok(dotted, *args)
    assert value.get("ok"), value
    return value["data"]


def _last_turn(app, kind: str):
    return app.page.evaluate(
        "(kind) => window.__musefold_test.stores.workbench.getState().turns"
        ".filter((turn) => turn.source.kind === kind).at(-1)",
        kind,
    )


def _wait_scheme_run_terminal(app, timeout=300_000):
    app.page.wait_for_function(
        "() => { const turn = window.__musefold_test.stores.workbench.getState().turns"
        ".filter((t) => t.source.kind === 'scheme-run').at(-1);"
        " return turn && ['succeeded', 'failed', 'cancelled'].includes(turn.source.state); }",
        timeout=timeout,
    )
    turn = _last_turn(app, "scheme-run")
    if turn["source"]["state"] != "succeeded":
        tail = "".join(getattr(app, "console_tail", []))[-3000:]
        raise AssertionError(
            f"scheme run ended in {turn['source']['state']}: {turn['source'].get('error')}\n"
            f"--- electron console ---\n{tail}"
        )
    return turn


def _fill_scheme_variables(app, topic: str):
    fields = app.page.locator('input[data-testid^="scheme-run-variable-"]')
    for index in range(fields.count()):
        fields.nth(index).fill(topic)


def _submit_scheme_run(app, brief: str, topic: str):
    """挂载好的方案附件 → 填变量、传原图、低成本参数 → 提交。"""
    app.page.wait_for_selector('[data-testid="scheme-run-attachment"]')
    _fill_scheme_variables(app, topic)
    # 无论方案是否声明图片槽位都传一张原图：必填槽位得到满足，可选时是合法的额外参考。
    app.page.locator('[data-testid="workbench-image-input"]').set_input_files(str(SOURCE_IMAGE))
    app.page.wait_for_selector('[data-testid="workbench-draft-image-preview"]')
    app.page.click('[data-testid="workbench-more-settings"]')
    app.page.wait_for_selector('[data-testid="workbench-generation-options"]')
    app.page.click('[data-testid="refine-quality-low"]')
    app.page.click('[data-testid="refine-count-1"]')
    prompt_box = app.page.locator('[data-workbench-testid="workbench-prompt"]')
    prompt_box.click()
    prompt_box.fill(brief)
    app.page.click('[data-workbench-testid="workbench-submit"]')
    app.page.wait_for_selector('[data-testid="scheme-run-conversation"]', timeout=30_000)


def test_scheme_lifecycle_trial_cover_formalize_use(app):
    connection_id = None
    provider_id = None
    try:
        assert SOURCE_IMAGE.is_file()
        EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
        connection = app.api_ok("aiConnection.create", {
            "name": "Scheme Run Agent",
            "routeKind": "gateway",
            "presetId": "custom",
            "baseUrl": TEXT_BASE,
            "model": TEXT_MODEL,
            "isActive": True,
        })
        connection_id = connection["id"]
        app.api_ok("aiConnection.saveKey", connection_id, TEXT_KEY)
        app.api_ok("aiConnection.setActive", connection_id)

        provider = app.api_ok("provider.create", {
            "name": "Scheme Run Image",
            "type": "openai-compatible",
            "baseUrl": IMAGE_BASE,
            "model": IMAGE_MODEL,
            "isActive": True,
        })
        provider_id = provider["id"]
        app.api_ok("provider.saveKey", provider_id, IMAGE_KEY)
        app.api_ok("provider.setActive", provider_id)
        app.page.evaluate("async () => window.__musefold_test.stores.generation.getState().loadProviders()")

        # ---- 1. 纯想法创建草稿 --------------------------------------------
        prompt_box = app.page.locator('[data-workbench-testid="workbench-prompt"]')
        prompt_box.click()
        prompt_box.fill(
            "/创建设计方案 做一套手绘贴纸风插画方案：白底、黑色粗轮廓线、高饱和撞色，"
            "主体居中周围留白。使用者只需提供一个文本主题即可，不要求上传图片。",
        )
        app.page.click('[data-workbench-testid="workbench-submit"]')
        app.page.wait_for_selector('[data-testid="scheme-creation-conversation"]', timeout=30_000)
        app.page.wait_for_function(
            "() => { const turn = window.__musefold_test.stores.workbench.getState().turns"
            ".filter((t) => t.source.kind === 'scheme-creation').at(-1);"
            " return turn && ['draft_ready', 'blocked', 'failed', 'cancelled'].includes(turn.source.state); }",
            timeout=240_000,
        )
        creation = _last_turn(app, "scheme-creation")
        assert creation["source"]["state"] == "draft_ready", creation["source"].get("error")
        draft = creation["source"]["draft"]
        scheme_id = draft["id"]
        app.page.screenshot(path=str(EVIDENCE_DIR / "01-draft-ready.png"), full_page=True)

        # ---- 2. 从草稿卡片进入试运行 ---------------------------------------
        app.page.click('[data-testid="scheme-creation-trial"]')
        app.page.wait_for_selector('[data-testid="scheme-run-attachment"][data-mode="trial"]')
        app.page.screenshot(path=str(EVIDENCE_DIR / "02-trial-attached.png"), full_page=True)

        _submit_scheme_run(app, brief="给贴纸加一点夏天的光感。", topic="抱着西瓜的柴犬")
        turn = _wait_scheme_run_terminal(app)
        assert turn["source"]["mode"] == "trial"
        trace_ids = {item["id"]: item for item in turn["source"]["trace"]}
        assert trace_ids["compile-prompt"]["status"] in ("success", "warning"), trace_ids
        assert trace_ids["image-generation"]["status"] == "success", trace_ids
        # 确定性管线：没有 Agent 轨迹（无 read/analyst 步骤）。
        assert "agent-run" not in trace_ids and "analyst" not in trace_ids
        result_path = Path(next(item["imagePath"] for item in turn["results"] if item.get("imagePath")))
        assert result_path.is_file() and result_path.stat().st_size > 10_000
        shutil.copy2(result_path, EVIDENCE_DIR / "trial-result.png")
        # 试运行成功结果进入草稿相册（带 assetId，作为封面候选）。
        assert any(item.get("assetId") for item in turn["source"]["generations"]), turn["source"]["generations"]
        app.page.screenshot(path=str(EVIDENCE_DIR / "03-trial-succeeded.png"), full_page=True)

        # ---- 3. 选封面 → 设为正式 ------------------------------------------
        app.page.wait_for_selector('[data-testid="scheme-run-trial-actions"]')
        formalize_button = app.page.locator('[data-testid="scheme-run-formalize"]')
        assert formalize_button.is_disabled()  # 未选封面前不可转正
        app.page.click('[data-testid="scheme-run-cover-option"]')
        app.page.wait_for_selector('[data-testid="scheme-run-cover-option"][data-selected="true"]')
        app.page.click('[data-testid="scheme-run-formalize"]')
        app.page.wait_for_selector('[data-testid="scheme-run-formalized"]', timeout=15_000)
        app.page.screenshot(path=str(EVIDENCE_DIR / "04-formalized.png"), full_page=True)

        schemes = _api_result(app, "designScheme.list")
        formal = next(item for item in schemes if item["id"] == scheme_id)
        assert formal["status"] == "formal"
        assert formal["hasSuccessfulTrial"] is True
        assert formal["coverAssetId"]
        assert formal["coverImagePath"] and Path(formal["coverImagePath"]).is_file()

        # ---- 4. 方案中心：行点击进详情 → 详情「使用」 ------------------------
        app.page.evaluate("() => window.__musefold_test.setView('design-schemes')")
        row = app.page.locator(f'[data-testid="runtime-scheme-row-{scheme_id}"]')
        row.wait_for(timeout=15_000)
        assert row.get_attribute("data-status") == "formal"
        app.page.screenshot(path=str(EVIDENCE_DIR / "05-scheme-center-formal.png"), full_page=True)

        app.page.click(f'[data-testid="runtime-scheme-open-{scheme_id}"]')
        detail = app.page.locator('[data-testid="runtime-scheme-detail"]')
        detail.wait_for(timeout=15_000)
        assert detail.get_attribute("data-status") == "formal"
        # 相册展示试运行结果；当前在封面上时不出现「设为封面」；正式方案没有转正按钮。
        app.page.wait_for_selector('[data-testid="runtime-scheme-album"] img', timeout=15_000)
        assert app.page.locator('[data-testid="runtime-scheme-set-cover"]').count() == 0
        assert app.page.locator('[data-testid="runtime-scheme-formalize"]').count() == 0
        # 文档区块：输入要求与方案规则来自真实版本文档。
        app.page.wait_for_selector('text=需要提供', timeout=15_000)
        app.page.screenshot(path=str(EVIDENCE_DIR / "05b-scheme-detail.png"), full_page=True)

        # 返回列表可回到方案中心，再次进入详情后从主按钮「使用」。
        app.page.click('[data-testid="runtime-scheme-detail-back"]')
        app.page.wait_for_selector(f'[data-testid="runtime-scheme-row-{scheme_id}"]')
        app.page.click(f'[data-testid="runtime-scheme-open-{scheme_id}"]')
        app.page.wait_for_selector('[data-testid="runtime-scheme-detail"]')
        app.page.click('[data-testid="runtime-scheme-primary-action"]')
        app.page.wait_for_selector('[data-testid="scheme-run-attachment"][data-mode="formal"]')

        _submit_scheme_run(app, brief="", topic="打伞散步的企鹅")
        turn = _wait_scheme_run_terminal(app)
        assert turn["source"]["mode"] == "formal"
        result_path = Path(next(item["imagePath"] for item in turn["results"] if item.get("imagePath")))
        assert result_path.is_file() and result_path.stat().st_size > 10_000
        shutil.copy2(result_path, EVIDENCE_DIR / "formal-result.png")
        # 正式使用不写草稿相册。
        assert all(not item.get("assetId") for item in turn["source"]["generations"])
        app.page.screenshot(path=str(EVIDENCE_DIR / "06-formal-use-succeeded.png"), full_page=True)
    finally:
        if provider_id:
            app.api("provider.delete", provider_id)
        if connection_id:
            app.api("aiConnection.deleteKey", connection_id)
            app.api("aiConnection.delete", connection_id)
