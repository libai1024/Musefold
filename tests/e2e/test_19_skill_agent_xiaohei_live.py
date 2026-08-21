"""Opt-in real Agent-Skill run with a nested-directory skill and prompt-only input.

Repo: ian-xiaohei-illustrations (SKILL.md lives in a subdirectory; user pastes the
tree URL). No user image is uploaded — the Agent must still read the skill files,
narrate its plan, and drive generate_image to completion.
"""
from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

from host_clipboard import paste_key


REPO_URL = "https://github.com/helloianneo/ian-xiaohei-illustrations/tree/main/ian-xiaohei-illustrations"
TEXT_KEY = os.environ.get("MUSEFOLD_TEXT_AI_KEY", "").strip()
TEXT_BASE = os.environ.get("MUSEFOLD_TEXT_AI_BASE", "https://ai.tvt.wiki/v1").strip()
TEXT_MODEL = os.environ.get("MUSEFOLD_TEXT_AI_MODEL", "gpt-5.4-mini").strip()
IMAGE_KEY = os.environ.get("MUSEFOLD_TVT_KEY", "").strip()
IMAGE_BASE = os.environ.get("MUSEFOLD_TVT_BASE", "https://ai.tvt.wiki/v1").strip()
IMAGE_MODEL = os.environ.get("MUSEFOLD_TVT_MODEL", "gpt-image-2").strip()
REPO_ROOT = Path(__file__).resolve().parents[2]
EVIDENCE_DIR = REPO_ROOT / "generated/v032-skill-agent-xiaohei"

pytestmark = [
    pytest.mark.gui,
    pytest.mark.skipif(
        not TEXT_KEY or not IMAGE_KEY or os.environ.get("MUSEFOLD_E2E_REAL_GITHUB") != "1",
        reason="需要真实 GitHub 与文本/图片 API 临时凭证",
    ),
]


def test_skill_agent_prompt_only_run(app):
    connection_id = None
    provider_id = None
    clipboard_before = subprocess.run(["pbpaste"], capture_output=True, check=False).stdout
    try:
        EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
        connection = app.api_ok("aiConnection.create", {
            "name": "Xiaohei Agent",
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
            "name": "Xiaohei Image",
            "type": "openai-compatible",
            "baseUrl": IMAGE_BASE,
            "model": IMAGE_MODEL,
            "isActive": True,
        })
        provider_id = provider["id"]
        app.api_ok("provider.saveKey", provider_id, IMAGE_KEY)
        app.api_ok("provider.setActive", provider_id)
        app.page.evaluate("async () => window.__musefold_test.stores.generation.getState().loadProviders()")

        prompt_box = app.page.locator('[data-workbench-testid="workbench-prompt"]')
        prompt_box.click()
        subprocess.run(["pbcopy"], input=REPO_URL.encode("utf-8"), check=True)
        app.page.keyboard.press(paste_key())
        app.page.wait_for_function(
            "() => ['ready', 'error'].includes(window.__musefold_test.stores.skillRuntime.getState().status)",
            timeout=180_000,
        )
        prepare_state = app.page.evaluate(
            "() => { const s = window.__musefold_test.stores.skillRuntime.getState();"
            " return { status: s.status, error: s.error, sourceUrl: s.sourceUrl }; }",
        )
        assert prepare_state["status"] == "ready", prepare_state
        attachment = app.page.evaluate("() => window.__musefold_test.stores.skillRuntime.getState().attachment")
        assert attachment["textFileCount"] >= 1
        app.page.wait_for_selector('[data-testid="skill-runtime-chip"][data-status="ready"]')
        app.page.screenshot(path=str(EVIDENCE_DIR / "01-skill-ready.png"), full_page=True)

        app.page.click('[data-testid="refine-ratio-trigger"]')
        app.page.wait_for_selector('[data-testid="refine-ratio-menu"]')
        app.page.click('[data-testid="refine-ratio-16:9"]')
        app.page.click('[data-testid="workbench-more-settings"]')
        app.page.wait_for_selector('[data-testid="workbench-generation-options"]')
        app.page.click('[data-testid="refine-quality-low"]')
        app.page.click('[data-testid="refine-count-1"]')

        prompt_box.click()
        prompt = "为概念「信任不是喊出来的，而是一块证据一块证据铺过去」生成一张小黑怪诞正文配图，16:9 白底手绘，小黑必须承担核心动作。"
        prompt_box.fill(prompt)
        app.page.click('[data-workbench-testid="workbench-submit"]')
        app.page.wait_for_selector(
            '[data-testid="skill-runtime-conversation"][data-placement="conversation"]',
            timeout=60_000,
        )
        app.page.wait_for_selector('[data-trace-status="running"]', timeout=60_000)
        # Agent 阅读/编排阶段不显示图片骨架占位；生图开始后才出现结果卡片。
        assert app.page.locator('[data-testid="refine-results"]').count() == 0
        assert app.page.locator('[data-testid="generate-result-card"]').count() == 0
        app.page.screenshot(path=str(EVIDENCE_DIR / "02-agent-running.png"), full_page=True)

        app.page.wait_for_function(
            "() => ['complete', 'error'].includes(window.__musefold_test.stores.skillRuntime.getState().status)",
            # Agent 循环 = 多轮工具调用（列目录/逐个读文件）+ 一次真实生图。
            # 网关高峰期单次生图即可达 230s，360s 会在「Agent 执行 Skill」步骤上误报
            # 超时（实测 2026-08-13：轨迹推进正常但未跑完）。
            timeout=900_000,
        )
        runtime_state = app.page.evaluate(
            "() => { const s = window.__musefold_test.stores.skillRuntime.getState();"
            " return { status: s.status, error: s.error, trace: s.trace }; }",
        )
        if runtime_state["status"] != "complete":
            tail = "".join(getattr(app, "console_tail", []))[-3000:]
            raise AssertionError(f"skill runtime ended in {runtime_state['status']}: {runtime_state}\n--- electron console ---\n{tail}")

        trace = app.page.evaluate("() => window.__musefold_test.stores.skillRuntime.getState().trace")
        read_steps = [
            item for item in trace
            if item["kind"] == "tool" and item["id"] != "github" and item["title"].startswith("读取 ")
        ]
        assert read_steps, trace
        agent_run = next(item for item in trace if item["id"] == "agent-run")
        assert agent_run["status"] == "success", agent_run
        assistant = next(item for item in trace if item["id"] == "assistant-output")
        assert assistant["output"] and len(assistant["output"]) > 40
        image_step = next(item for item in trace if item["id"] == "image-generation")
        assert image_step["status"] == "success", image_step
        narration = [
            item for item in trace
            if item["kind"] == "assistant" and item["title"] == "Agent" and (item.get("output") or "").strip()
        ]
        print("agent narration segments:", len(narration))

        turn = app.page.evaluate("() => window.__musefold_test.stores.workbench.getState().turns.at(-1)")
        assert turn["source"]["kind"] == "skill"
        assert turn["source"]["executionMode"] == "agent"
        result_path = Path(next(item["imagePath"] for item in turn["results"] if item.get("imagePath")))
        assert result_path.is_file()
        assert result_path.stat().st_size > 10_000
        shutil.copy2(result_path, EVIDENCE_DIR / "generated-illustration.png")
        app.page.screenshot(path=str(EVIDENCE_DIR / "03-result.png"), full_page=True)
    finally:
        subprocess.run(["pbcopy"], input=clipboard_before, check=False)
        if provider_id:
            app.api("provider.delete", provider_id)
        if connection_id:
            app.api("aiConnection.deleteKey", connection_id)
            app.api("aiConnection.delete", connection_id)
