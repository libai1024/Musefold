"""Opt-in live check: structural editing of scheme inputs, using the
ian-xiaohei-illustrations skill as the example (user question: does this
scheme really need a main image?).

Flow:
1. create a scheme draft from the xiaohei GitHub skill (Agent pipeline);
2. dump the compiled input slots as evidence (are image slots declared? required?);
3. in the runtime detail page, structurally edit inputs: every image slot ->
   optional (or deleted), assert template-bound text slots cannot be deleted;
4. save -> new revision, trial verification resets;
5. run a trial WITHOUT uploading any image -> must succeed, proving the
   scheme generates from text alone.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import pytest


SKILL_REPO_URL = "https://github.com/helloianneo/ian-xiaohei-illustrations"
TEXT_KEY = os.environ.get("MUSEFOLD_TEXT_AI_KEY", "").strip()
TEXT_BASE = os.environ.get("MUSEFOLD_TEXT_AI_BASE", "https://ai.tvt.wiki/v1").strip()
TEXT_MODEL = os.environ.get("MUSEFOLD_TEXT_AI_MODEL", "gpt-5.4-mini").strip()
IMAGE_KEY = os.environ.get("MUSEFOLD_TVT_KEY", "").strip()
IMAGE_BASE = os.environ.get("MUSEFOLD_TVT_BASE", "https://ai.tvt.wiki/v1").strip()
IMAGE_MODEL = os.environ.get("MUSEFOLD_TVT_MODEL", "gpt-image-2").strip()
REPO_ROOT = Path(__file__).resolve().parents[2]
EVIDENCE_DIR = REPO_ROOT / "generated/v032-scheme-inputs-edit"

pytestmark = pytest.mark.skipif(
    not TEXT_KEY or not IMAGE_KEY or os.environ.get("MUSEFOLD_E2E_REAL_GITHUB") != "1",
    reason="需要真实 GitHub 与文本/图片 AI 临时凭证",
)

TEXT_KINDS = {"text", "article", "choice"}


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


def test_edit_inputs_then_text_only_trial(app):
    connection_id = None
    provider_id = None
    try:
        EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
        connection = app.api_ok("aiConnection.create", {
            "name": "Inputs Edit Agent",
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
            "name": "Inputs Edit Image",
            "type": "openai-compatible",
            "baseUrl": IMAGE_BASE,
            "model": IMAGE_MODEL,
            "isActive": True,
        })
        provider_id = provider["id"]
        app.api_ok("provider.saveKey", provider_id, IMAGE_KEY)
        app.api_ok("provider.setActive", provider_id)
        app.page.evaluate("async () => window.__musefold_test.stores.generation.getState().loadProviders()")

        # ---- 1. 从 xiaohei skill 创建方案草稿 -------------------------------
        prompt_box = app.page.locator('[data-workbench-testid="workbench-prompt"]')
        prompt_box.click()
        prompt_box.fill(f"/create design plan {SKILL_REPO_URL} 把小黑角色插画风整理成可复用方案。")
        app.page.click('[data-workbench-testid="workbench-submit"]')
        app.page.wait_for_selector('[data-testid="scheme-creation-confirm"]', timeout=200_000)
        app.page.click('[data-testid="scheme-creation-confirm-accept"]')
        app.page.wait_for_function(
            "() => { const turn = window.__musefold_test.stores.workbench.getState().turns"
            ".filter((t) => t.source.kind === 'scheme-creation').at(-1);"
            " return turn && ['draft_ready', 'blocked', 'failed', 'cancelled'].includes(turn.source.state); }",
            # 预算 = 仓库下载上限 180s + Repository Analyst + Scheme Compiler 两次真实 AI 调用。
            # 网关高峰期单次调用可达 3~4 分钟，240s 会误报超时（实测 2026-08-13）。
            timeout=480_000,
        )
        creation = _last_turn(app, "scheme-creation")
        assert creation["source"]["state"] == "draft_ready", creation["source"].get("error")
        scheme_id = creation["source"]["draft"]["id"]
        revision_id = creation["source"]["draft"]["currentRevisionId"]

        # ---- 2. 记录编译出的输入声明（主图问题的证据） -----------------------
        document = _api_result(app, "designScheme.getRevision", revision_id)
        (EVIDENCE_DIR / "xiaohei-scheme-document.json").write_text(
            json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8",
        )
        image_slots = [slot for slot in document["inputs"] if slot["kind"] not in TEXT_KINDS]
        text_slots = [slot for slot in document["inputs"] if slot["kind"] in TEXT_KINDS]
        assert text_slots, document["inputs"]  # 至少有一个文本输入（主题）
        # 编译器新规则下，纯生成类 skill 不应声明「必需」图片输入
        required_images = [slot for slot in image_slots if slot["required"]]
        assert not required_images, f"纯生成类方案不应必需图片输入: {required_images}"

        # ---- 3. 详情页结构化编辑 ---------------------------------------------
        app.page.evaluate("() => window.__musefold_test.setView('design-schemes')")
        app.page.wait_for_selector(f'[data-testid="runtime-scheme-open-{scheme_id}"]', timeout=15_000)
        app.page.click(f'[data-testid="runtime-scheme-open-{scheme_id}"]')
        app.page.wait_for_selector('[data-testid="runtime-scheme-detail"]')
        app.page.wait_for_selector('[data-testid="runtime-scheme-edit-inputs"]', timeout=15_000)
        app.page.click('[data-testid="runtime-scheme-edit-inputs"]')
        app.page.wait_for_selector('[data-testid="runtime-scheme-inputs-editor"]')
        app.page.screenshot(path=str(EVIDENCE_DIR / "01-inputs-edit-mode.png"), full_page=True)

        # 模板引用的文本槽位删除按钮必须禁用
        for slot in text_slots:
            delete_btn = app.page.locator(f'[data-testid="runtime-scheme-input-delete-{slot["id"]}"]')
            if delete_btn.count() and slot["id"] in _template_variables(document):
                assert delete_btn.is_disabled(), slot

        # 必须产生**真实**变更，保存按钮才会亮（编译器新规则下图片槽位往往
        # 已经是可选的，再点一次「可选」是空操作，不能作为保存链路的证据）。
        changed = False
        for slot in image_slots:
            if slot["required"]:
                app.page.click(f'[data-testid="runtime-scheme-input-optional-{slot["id"]}"]')
                changed = True
        # 删除一个未被模板引用的槽位，顺带覆盖删除路径。
        deletable = [
            slot for slot in image_slots
            if slot["id"] not in _template_variables(document)
            and app.page.locator(f'[data-testid="runtime-scheme-input-delete-{slot["id"]}"]').count()
        ]
        if deletable:
            victim = deletable[0]["id"]
            app.page.click(f'[data-testid="runtime-scheme-input-delete-{victim}"]')
            app.page.wait_for_selector(f'[data-testid="runtime-scheme-input-row-{victim}"][data-removed]')
            changed = True

        # 兜底：没有图片槽位可动时，切换第一个文本槽位的必需状态。
        if not changed:
            first = text_slots[0]
            target = "optional" if first["required"] else "required"
            app.page.click(f'[data-testid="runtime-scheme-input-{target}-{first["id"]}"]')

        save = app.page.locator('[data-testid="runtime-scheme-inputs-save"]')
        assert save.is_enabled(), "已产生结构化变更，保存按钮应可用"
        save.click()
        app.page.wait_for_selector('[data-testid="runtime-scheme-inputs-editor"]', state="detached", timeout=15_000)
        app.page.screenshot(path=str(EVIDENCE_DIR / "02-inputs-saved.png"), full_page=True)

        # ---- 4. 校验新 revision 落库、试运行校验重置 -------------------------
        schemes = _api_result(app, "designScheme.list")
        updated = next(item for item in schemes if item["id"] == scheme_id)
        assert updated["currentRevisionId"] != revision_id
        assert updated["hasSuccessfulTrial"] is False
        new_document = _api_result(app, "designScheme.getRevision", updated["currentRevisionId"])
        for slot in new_document["inputs"]:
            if slot["kind"] not in TEXT_KINDS:
                assert slot["required"] is False, slot
        (EVIDENCE_DIR / "xiaohei-scheme-document-edited.json").write_text(
            json.dumps(new_document, ensure_ascii=False, indent=2), encoding="utf-8",
        )

        # ---- 5. 不上传任何图片直接试运行：纯文字也必须能出图 ------------------
        app.page.click('[data-testid="runtime-scheme-primary-action"]')
        app.page.wait_for_selector('[data-testid="scheme-run-attachment"][data-mode="trial"]')
        fields = app.page.locator('input[data-testid^="scheme-run-variable-"]')
        for index in range(fields.count()):
            fields.nth(index).fill("小黑第一次去海边写生")
        app.page.click('[data-testid="workbench-more-settings"]')
        app.page.wait_for_selector('[data-testid="workbench-generation-options"]')
        app.page.click('[data-testid="refine-quality-low"]')
        app.page.click('[data-testid="refine-count-1"]')
        app.page.click('[data-workbench-testid="workbench-submit"]')
        app.page.wait_for_selector('[data-testid="scheme-run-conversation"]', timeout=30_000)
        app.page.wait_for_function(
            "() => { const turn = window.__musefold_test.stores.workbench.getState().turns"
            ".filter((t) => t.source.kind === 'scheme-run').at(-1);"
            " return turn && ['succeeded', 'failed', 'cancelled'].includes(turn.source.state); }",
            # 单张真实生图实测可达 230s（2026-08-13 网关），留足余量避免误报。
            timeout=480_000,
        )
        run_turn = _last_turn(app, "scheme-run")
        assert run_turn["source"]["state"] == "succeeded", run_turn["source"].get("error")
        result_path = Path(next(item["imagePath"] for item in run_turn["results"] if item.get("imagePath")))
        assert result_path.is_file() and result_path.stat().st_size > 10_000
        import shutil
        shutil.copy2(result_path, EVIDENCE_DIR / "text-only-trial-result.png")
        app.page.screenshot(path=str(EVIDENCE_DIR / "03-text-only-trial.png"), full_page=True)
    finally:
        if provider_id:
            app.api("provider.delete", provider_id)
        if connection_id:
            app.api("aiConnection.deleteKey", connection_id)
            app.api("aiConnection.delete", connection_id)


def _template_variables(document) -> set[str]:
    variables: set[str] = set()
    for module in document["promptProgram"]:
        variables.update(module.get("variables", []))
    return variables
