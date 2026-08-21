"""Opt-in real Composer Skill runtime: GitHub -> Agent -> image -> visible trace."""
from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

from host_clipboard import paste_key


REPO_URL = "https://github.com/LiamGvchi/gc-minimal-zine-poster"
TEXT_KEY = os.environ.get("MUSEFOLD_TEXT_AI_KEY", "").strip()
TEXT_BASE = os.environ.get("MUSEFOLD_TEXT_AI_BASE", "https://ai.tvt.wiki/v1").strip()
TEXT_MODEL = os.environ.get("MUSEFOLD_TEXT_AI_MODEL", "gpt-5.4-mini").strip()
IMAGE_KEY = os.environ.get("MUSEFOLD_TVT_KEY", "").strip()
IMAGE_BASE = os.environ.get("MUSEFOLD_TVT_BASE", "https://ai.tvt.wiki/v1").strip()
IMAGE_MODEL = os.environ.get("MUSEFOLD_TVT_MODEL", "gpt-image-2").strip()
REPO_ROOT = Path(__file__).resolve().parents[2]
SOURCE_IMAGE = REPO_ROOT / "generated/v31-skill-research/source-landscape.jpg"
EVIDENCE_DIR = REPO_ROOT / "generated/v032-real-skill-ui"

pytestmark = pytest.mark.skipif(
    not TEXT_KEY or not IMAGE_KEY or os.environ.get("MUSEFOLD_E2E_REAL_GITHUB") != "1",
    reason="需要真实 GitHub 与文本/图片 API 临时凭证",
)


def test_skill_runtime_agent_trace_to_image(app):
    connection_id = None
    provider_id = None
    clipboard_before = subprocess.run(["pbpaste"], capture_output=True, check=False).stdout
    try:
        assert SOURCE_IMAGE.is_file()
        EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
        connection = app.api_ok("aiConnection.create", {
            "name": "Skill runtime Agent",
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
            "name": "Skill runtime Image",
            "type": "openai-compatible",
            "baseUrl": IMAGE_BASE,
            "model": IMAGE_MODEL,
            "isActive": True,
        })
        provider_id = provider["id"]
        app.api_ok("provider.saveKey", provider_id, IMAGE_KEY)
        app.api_ok("provider.setActive", provider_id)
        app.page.evaluate("async () => window.__musefold_test.stores.generation.getState().loadProviders()")

        # The runtime must begin at the visible Composer paste surface.
        prompt_box = app.page.locator('[data-workbench-testid="workbench-prompt"]')
        prompt_box.click()
        subprocess.run(["pbcopy"], input=REPO_URL.encode("utf-8"), check=True)
        app.page.keyboard.press(paste_key())
        app.page.wait_for_function(
            "() => window.__musefold_test.stores.skillRuntime.getState().status === 'ready'",
            timeout=180_000,
        )
        attachment = app.page.evaluate("() => window.__musefold_test.stores.skillRuntime.getState().attachment")
        assert attachment["name"]
        assert attachment["textFileCount"] >= 1
        app.page.wait_for_selector('[data-testid="skill-runtime-chip"][data-status="ready"]')
        assert prompt_box.input_value() == ""
        app.page.screenshot(path=str(EVIDENCE_DIR / "01-skill-ready.png"), full_page=True)

        # Upload a real landscape and choose all generation controls through UI.
        app.page.locator('[data-testid="workbench-image-input"]').set_input_files(str(SOURCE_IMAGE))
        app.page.wait_for_selector('[data-testid="workbench-draft-image-preview"]')
        app.page.click('[data-testid="refine-ratio-trigger"]')
        app.page.wait_for_selector('[data-testid="refine-ratio-menu"]')
        app.page.click('[data-testid="refine-ratio-2:3"]')
        app.page.click('[data-testid="workbench-more-settings"]')
        app.page.wait_for_selector('[data-testid="workbench-generation-options"]')
        app.page.click('[data-testid="refine-quality-low"]')
        app.page.click('[data-testid="refine-count-1"]')
        prompt_box.click()

        prompt = "将图 1 作为必须保留内容与构图特征的主图，严格执行这个 Skill，生成留白充足的竖版纸张杂志海报。主标题 FAR / STILL。Skill 自带图片只用于学习纸张、排版与印刷质感，不能改变或替换图 1 的题材。"
        prompt_box.fill(prompt)
        app.page.click('[data-workbench-testid="workbench-submit"]')
        app.page.wait_for_selector(
            '[data-testid="skill-runtime-conversation"][data-placement="conversation"]',
            timeout=60_000,
        )
        app.page.wait_for_selector('[data-trace-status="running"]', timeout=60_000)
        assert app.page.locator('[data-testid="skill-runtime-chip"]').count() == 0
        assert app.page.locator('[data-testid="workbench-composer"] [data-testid="skill-runtime-conversation"]').count() == 0
        # Agent 阅读/编排阶段不显示图片骨架占位；生图开始后才出现结果卡片。
        assert app.page.locator('[data-testid="refine-results"]').count() == 0
        assert app.page.locator('[data-testid="generate-result-card"]').count() == 0
        app.page.screenshot(path=str(EVIDENCE_DIR / "02-agent-running.png"), full_page=True)

        app.page.wait_for_function(
            "() => ['complete', 'error'].includes(window.__musefold_test.stores.skillRuntime.getState().status)",
            timeout=360_000,
        )
        runtime_state = app.page.evaluate(
            "() => { const s = window.__musefold_test.stores.skillRuntime.getState();"
            " return { status: s.status, error: s.error, trace: s.trace }; }",
        )
        if runtime_state["status"] != "complete":
            tail = "".join(getattr(app, "console_tail", []))[-3000:]
            raise AssertionError(f"skill runtime ended in {runtime_state['status']}: {runtime_state}\n--- electron console ---\n{tail}")

        trace = app.page.evaluate("() => window.__musefold_test.stores.skillRuntime.getState().trace")
        assert [item["id"] for item in trace][:3] == ["github", "scan", "files"]
        # 真实 Agent 循环：轨迹里必须出现主进程真实执行的 read_skill_file 工具调用。
        read_steps = [
            item for item in trace
            if item["kind"] == "tool" and item["id"] != "github" and item["title"].startswith("读取 ")
        ]
        assert read_steps, trace
        assert all(step["status"] == "success" for step in read_steps), read_steps
        agent_run = next(item for item in trace if item["id"] == "agent-run")
        assert agent_run["status"] == "success", agent_run
        assistant = next(item for item in trace if item["id"] == "assistant-output")
        assert assistant["output"] and len(assistant["output"]) > 80
        assert "图 1" in assistant["output"]
        image_step = next(item for item in trace if item["id"] == "image-generation")
        assert image_step["status"] == "success", image_step
        app.page.wait_for_selector('[data-testid="skill-runtime-conversation"][data-placement="conversation"]')
        app.page.wait_for_selector('[data-testid="skill-runtime-agent-output"]')
        assert app.page.locator('[data-testid="workbench-composer"] [data-testid="skill-runtime-conversation"]').count() == 0
        app.page.wait_for_selector('[data-testid="generate-result-card"][data-status="success"]')
        assert app.page.locator('[data-testid="generation-skill-reference"]').is_visible()

        turn = app.page.evaluate("() => window.__musefold_test.stores.workbench.getState().turns.at(-1)")
        assert turn["source"]["kind"] == "skill"
        assert turn["source"]["executionMode"] == "agent"
        assert turn["referenceImages"]
        assert len(turn["referenceImages"]) == 3
        assert turn["referenceImages"][0]["name"] == SOURCE_IMAGE.name
        result_path = Path(next(item["imagePath"] for item in turn["results"] if item.get("imagePath")))
        assert result_path.is_file()
        assert result_path.stat().st_size > 10_000
        shutil.copy2(result_path, EVIDENCE_DIR / "generated-poster.png")

        user_box = app.page.locator('[data-testid="generation-user-message"]').bounding_box()
        trace_box = app.page.locator('[data-testid="skill-runtime-conversation"]').bounding_box()
        result_box = app.page.locator('[data-testid="refine-results"]').bounding_box()
        assert user_box and trace_box and result_box
        assert user_box["y"] < trace_box["y"] < result_box["y"]
        app.page.screenshot(path=str(EVIDENCE_DIR / "03-result.png"), full_page=True)

        app.page.click('[data-testid="result-zoom"]')
        app.page.wait_for_selector('[data-testid="image-lightbox-image"]')
        app.page.wait_for_function(
            """() => {
              const image = document.querySelector('[data-testid="image-lightbox-image"]');
              return image?.complete && image.naturalWidth > 100 && image.naturalHeight > 100;
            }""",
        )
        app.page.screenshot(path=str(EVIDENCE_DIR / "04-result-lightbox.png"), full_page=True)
    finally:
        subprocess.run(["pbcopy"], input=clipboard_before, check=False)
        if provider_id:
            app.api("provider.delete", provider_id)
        if connection_id:
            app.api("aiConnection.deleteKey", connection_id)
            app.api("aiConnection.delete", connection_id)
