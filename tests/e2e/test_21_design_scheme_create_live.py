"""Opt-in live runs of the v0.3.2 design-scheme creation pipeline.

Two creation paths through the real Agent runtime (Analyst → Compiler):
1. idea-only     — `/创建设计方案 <想法>` compiles straight into a draft.
2. idea + skill  — `/create design plan <github url> <想法>` must pause for the
                   install confirmation card before snapshotting the source.

Both paths assert the conversation turn shows real trace steps, the draft card
appears in the dialogue, and the draft lands in the new design-scheme DB.
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest


SKILL_REPO_URL = "https://github.com/LiamGvchi/gc-minimal-zine-poster"
TEXT_KEY = os.environ.get("MUSEFOLD_TEXT_AI_KEY", "").strip()
TEXT_BASE = os.environ.get("MUSEFOLD_TEXT_AI_BASE", "https://ai.tvt.wiki/v1").strip()
TEXT_MODEL = os.environ.get("MUSEFOLD_TEXT_AI_MODEL", "gpt-5.4-mini").strip()
REPO_ROOT = Path(__file__).resolve().parents[2]
EVIDENCE_DIR = REPO_ROOT / "generated/v032-scheme-create"

pytestmark = pytest.mark.skipif(
    not TEXT_KEY or os.environ.get("MUSEFOLD_E2E_REAL_GITHUB") != "1",
    reason="需要真实 GitHub 与文本 AI 临时凭证",
)


def _api_result(app, dotted: str, *args):
    """designScheme.* 返回 AppResult；断言 ok 并返回 data。"""
    value = app.api_ok(dotted, *args)
    assert value.get("ok"), value
    return value["data"]


def _setup_text_connection(app):
    connection = app.api_ok("aiConnection.create", {
        "name": "Scheme Agent",
        "routeKind": "gateway",
        "presetId": "custom",
        "baseUrl": TEXT_BASE,
        "model": TEXT_MODEL,
        "isActive": True,
    })
    app.api_ok("aiConnection.saveKey", connection["id"], TEXT_KEY)
    app.api_ok("aiConnection.setActive", connection["id"])
    return connection["id"]


def _teardown_text_connection(app, connection_id):
    if connection_id:
        app.api("aiConnection.deleteKey", connection_id)
        app.api("aiConnection.delete", connection_id)


def _creation_turn(app):
    return app.page.evaluate(
        "() => window.__musefold_test.stores.workbench.getState().turns"
        ".filter((turn) => turn.source.kind === 'scheme-creation').at(-1)",
    )


def _wait_for_terminal_creation(app, timeout=240_000):
    app.page.wait_for_function(
        "() => { const turn = window.__musefold_test.stores.workbench.getState().turns"
        ".filter((t) => t.source.kind === 'scheme-creation').at(-1);"
        " return turn && ['draft_ready', 'blocked', 'failed', 'cancelled'].includes(turn.source.state); }",
        timeout=timeout,
    )
    turn = _creation_turn(app)
    if turn["source"]["state"] != "draft_ready":
        tail = "".join(getattr(app, "console_tail", []))[-3000:]
        raise AssertionError(
            f"creation ended in {turn['source']['state']}: {turn['source'].get('error')}\n"
            f"--- electron console ---\n{tail}"
        )
    return turn


def test_create_scheme_from_idea_only(app):
    connection_id = None
    try:
        EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
        connection_id = _setup_text_connection(app)

        prompt_box = app.page.locator('[data-workbench-testid="workbench-prompt"]')
        prompt_box.click()
        # 输入 / 先出现指令提示
        prompt_box.fill("/")
        app.page.wait_for_selector('[data-testid="composer-command-hints"]')
        app.page.screenshot(path=str(EVIDENCE_DIR / "idea-01-command-hints.png"), full_page=True)

        prompt_box.fill("/创建设计方案 做一套胶片颗粒感的城市夜景插画方案：蓝橙对比色，画面下三分之一留白放标题，适合做播客封面。")
        # 完整指令切换为设计方案模式，正文只留想法文本
        app.page.wait_for_selector('[data-testid="composer-mode"] [data-active="true"]')
        assert app.page.locator('[data-testid="composer-mode"] [data-active="true"]').inner_text() == "设计方案"
        assert "/创建设计方案" not in prompt_box.input_value()
        app.page.screenshot(path=str(EVIDENCE_DIR / "idea-01b-design-plan-mode.png"), full_page=True)
        app.page.click('[data-workbench-testid="workbench-submit"]')

        # 创建轮立即出现在对话里，且没有任何图片骨架
        app.page.wait_for_selector('[data-testid="scheme-creation-conversation"]', timeout=30_000)
        assert app.page.locator('[data-testid="refine-results"]').count() == 0
        assert app.page.locator('[data-testid="generate-result-card"]').count() == 0
        # 用户消息里保留指令标签（图标+指令名），模式状态已随提交清空
        app.page.wait_for_selector('[data-testid="generation-command-tag"]')
        assert app.page.locator('[data-testid="composer-mode"] [data-active="true"]').inner_text() == "图像"
        app.page.screenshot(path=str(EVIDENCE_DIR / "idea-02-agent-running.png"), full_page=True)

        turn = _wait_for_terminal_creation(app)
        trace_ids = [item["id"] for item in turn["source"]["trace"]]
        # 纯想法路径不应有来源步骤，但必须有编译与保存步骤
        assert "compiler" in trace_ids and "save-draft" in trace_ids, trace_ids
        assert "source-resolve" not in trace_ids, trace_ids
        compiler_step = next(item for item in turn["source"]["trace"] if item["id"] == "compiler")
        assert compiler_step["status"] in ("success", "warning"), compiler_step

        draft = turn["source"]["draft"]
        assert draft and draft["status"] == "draft"
        assert draft["sourcePresentation"] == "musefold-created"
        assert len(draft["creationSummary"]) > 20

        # 草稿卡片渲染在对话里
        app.page.wait_for_selector('[data-testid="scheme-creation-draft-card"]')
        app.page.wait_for_selector('[data-testid="scheme-creation-summary"][data-complete="true"]', timeout=30_000)
        app.page.screenshot(path=str(EVIDENCE_DIR / "idea-03-draft-ready.png"), full_page=True)

        # 新库里能读到草稿
        schemes = _api_result(app, "designScheme.list")
        assert any(item["id"] == draft["id"] for item in schemes), schemes
        document = _api_result(app, "designScheme.getRevision", draft["currentRevisionId"])
        assert document["promptProgram"], document
        assert document["compilation"]["trace"], document["compilation"]

        # 方案中心显示草稿行
        app.page.evaluate("() => window.__musefold_test.setView('design-schemes')")
        app.page.wait_for_selector(f'[data-testid="runtime-scheme-row-{draft["id"]}"]', timeout=15_000)
        app.page.screenshot(path=str(EVIDENCE_DIR / "idea-04-scheme-center.png"), full_page=True)
    finally:
        _teardown_text_connection(app, connection_id)


def test_create_scheme_from_idea_and_skill(app):
    connection_id = None
    try:
        EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
        connection_id = _setup_text_connection(app)

        prompt_box = app.page.locator('[data-workbench-testid="workbench-prompt"]')
        prompt_box.click()
        prompt_box.fill(
            f"/create design plan {SKILL_REPO_URL} 把这个海报 Skill 整理成可复用方案，保留双色印刷与网格排版规则。",
        )
        app.page.click('[data-workbench-testid="workbench-submit"]')

        # 来源解析完成后出现安装确认卡片；确认前不得进入分析
        app.page.wait_for_selector('[data-testid="scheme-creation-confirm"]', timeout=200_000)
        turn = _creation_turn(app)
        assert turn["source"]["state"] == "awaiting_install_confirmation"
        trace_ids = [item["id"] for item in turn["source"]["trace"]]
        assert "analyst" not in trace_ids, trace_ids
        confirmation = turn["source"]["confirmation"]
        assert confirmation["repositoryUrl"] == SKILL_REPO_URL
        assert confirmation["textFileCount"] >= 1
        app.page.screenshot(path=str(EVIDENCE_DIR / "skill-01-confirm.png"), full_page=True)

        app.page.click('[data-testid="scheme-creation-confirm-accept"]')

        turn = _wait_for_terminal_creation(app)
        trace_ids = [item["id"] for item in turn["source"]["trace"]]
        for step in ("source-resolve", "source-confirm", "source-snapshot", "analyst", "compiler", "save-draft"):
            assert step in trace_ids, trace_ids

        draft = turn["source"]["draft"]
        assert draft and draft["sourcePresentation"] == "skill"
        assert draft["sourceLabel"] == "LiamGvchi/gc-minimal-zine-poster"

        document = _api_result(app, "designScheme.getRevision", draft["currentRevisionId"])
        repo_binding = next(item for item in document["sources"] if item["kind"] == "github-skill")
        # 归档下载拿不到 commit SHA 时（GitHub codeload），至少固定 ref
        assert repo_binding.get("commit") or repo_binding.get("ref"), repo_binding
        app.page.wait_for_selector('[data-testid="scheme-creation-draft-card"]')
        app.page.screenshot(path=str(EVIDENCE_DIR / "skill-02-draft-ready.png"), full_page=True)
    finally:
        _teardown_text_connection(app, connection_id)
