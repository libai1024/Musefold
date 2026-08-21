"""Opt-in live matrix: 纯 Skill + 用户上传原图 -> Agent 以图 1 为主图出图。

gc-minimal-zine-poster 的上传图路径已由 test_18 覆盖；本文件补齐另外两个
生图类 Skill，三者共同验证「上传原图 + 直接粘贴 Skill 地址」的完整链路。
"""
from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

from host_clipboard import paste_key


TEXT_KEY = os.environ.get("MUSEFOLD_TEXT_AI_KEY", "").strip()
TEXT_BASE = os.environ.get("MUSEFOLD_TEXT_AI_BASE", "https://ai.tvt.wiki/v1").strip()
TEXT_MODEL = os.environ.get("MUSEFOLD_TEXT_AI_MODEL", "gpt-5.4-mini").strip()
IMAGE_KEY = os.environ.get("MUSEFOLD_TVT_KEY", "").strip()
IMAGE_BASE = os.environ.get("MUSEFOLD_TVT_BASE", "https://ai.tvt.wiki/v1").strip()
IMAGE_MODEL = os.environ.get("MUSEFOLD_TVT_MODEL", "gpt-image-2").strip()
REPO_ROOT = Path(__file__).resolve().parents[2]
SOURCE_IMAGE = REPO_ROOT / "generated/v31-skill-research/source-landscape.jpg"
EVIDENCE_ROOT = REPO_ROOT / "generated/v032-skill-upload-matrix"

SKILL_CASES = [
    pytest.param(
        "heytea-style",
        "https://github.com/Hchen1218/heytea-style",
        "将图 1 作为必须保留主体与场景的内容主图，严格执行这个 Skill 的风格规范，"
        "把图 1 转绘成喜茶风儿童简笔画海报。Skill 自带图片只用于学习风格，不能改变图 1 的题材。",
        id="heytea-style",
    ),
    pytest.param(
        "photo-abstract-editorial",
        "https://github.com/ZzzLc0405/photo-abstract-editorial",
        "以图 1 作为唯一的内容照片来源，严格执行这个 Skill，"
        "生成摄影与抽象记忆编辑面板。不得替换或虚构图 1 之外的照片内容。",
        id="photo-abstract-editorial",
    ),
]

pytestmark = pytest.mark.skipif(
    not TEXT_KEY or not IMAGE_KEY or os.environ.get("MUSEFOLD_E2E_REAL_GITHUB") != "1",
    reason="需要真实 GitHub 与文本/图片 API 临时凭证",
)


@pytest.mark.parametrize("slug,repo_url,prompt", SKILL_CASES)
def test_skill_with_uploaded_image(app, slug: str, repo_url: str, prompt: str):
    connection_id = None
    provider_id = None
    evidence_dir = EVIDENCE_ROOT / slug
    clipboard_before = subprocess.run(["pbpaste"], capture_output=True, check=False).stdout
    try:
        assert SOURCE_IMAGE.is_file()
        evidence_dir.mkdir(parents=True, exist_ok=True)
        connection = app.api_ok("aiConnection.create", {
            "name": "Skill upload Agent",
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
            "name": "Skill upload Image",
            "type": "openai-compatible",
            "baseUrl": IMAGE_BASE,
            "model": IMAGE_MODEL,
            "isActive": True,
        })
        provider_id = provider["id"]
        app.api_ok("provider.saveKey", provider_id, IMAGE_KEY)
        app.api_ok("provider.setActive", provider_id)
        app.page.evaluate("async () => window.__musefold_test.stores.generation.getState().loadProviders()")

        # 从可见的 Composer 粘贴 Skill 地址开始。
        prompt_box = app.page.locator('[data-workbench-testid="workbench-prompt"]')
        prompt_box.click()
        subprocess.run(["pbcopy"], input=repo_url.encode("utf-8"), check=True)
        app.page.keyboard.press(paste_key())
        app.page.wait_for_function(
            "() => ['ready', 'error'].includes(window.__musefold_test.stores.skillRuntime.getState().status)",
            timeout=240_000,
        )
        runtime = app.page.evaluate(
            "() => { const s = window.__musefold_test.stores.skillRuntime.getState();"
            " return { status: s.status, error: s.error }; }",
        )
        if runtime["status"] != "ready":
            tail = "".join(getattr(app, "console_tail", []))[-3000:]
            raise AssertionError(f"skill prepare failed for {repo_url}: {runtime}\n--- electron console ---\n{tail}")
        app.page.wait_for_selector('[data-testid="skill-runtime-chip"][data-status="ready"]')
        app.page.screenshot(path=str(evidence_dir / "01-skill-ready.png"), full_page=True)

        # 上传原图并选择低成本参数。
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
        app.page.screenshot(path=str(evidence_dir / "02-agent-running.png"), full_page=True)

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

        trace = runtime_state["trace"]
        agent_run = next(item for item in trace if item["id"] == "agent-run")
        assert agent_run["status"] == "success", agent_run
        assistant = next(item for item in trace if item["id"] == "assistant-output")
        assert assistant["output"] and len(assistant["output"]) > 40
        image_step = next(item for item in trace if item["id"] == "image-generation")
        assert image_step["status"] == "success", image_step

        app.page.wait_for_selector('[data-testid="generate-result-card"][data-status="success"]')
        turn = app.page.evaluate("() => window.__musefold_test.stores.workbench.getState().turns.at(-1)")
        assert turn["source"]["kind"] == "skill"
        # 必须是真 Agent 路径，而不是 file-fallback。
        assert turn["source"]["executionMode"] == "agent"
        # 上传原图必须作为图 1（首位参考图）传给生图模型。
        assert turn["referenceImages"], turn
        assert turn["referenceImages"][0]["name"] == SOURCE_IMAGE.name
        result_path = Path(next(item["imagePath"] for item in turn["results"] if item.get("imagePath")))
        assert result_path.is_file()
        assert result_path.stat().st_size > 10_000
        shutil.copy2(result_path, evidence_dir / "generated-image.png")
        app.page.screenshot(path=str(evidence_dir / "03-result.png"), full_page=True)
    finally:
        subprocess.run(["pbcopy"], input=clipboard_before, check=False)
        if provider_id:
            app.api("provider.delete", provider_id)
        if connection_id:
            app.api("aiConnection.deleteKey", connection_id)
            app.api("aiConnection.delete", connection_id)
