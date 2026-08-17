"""Windows live acceptance: official account + real GitHub Skill + source image."""
from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

import pytest


REPO_URL = "https://github.com/LiamGvchi/gc-minimal-zine-poster"
USERNAME = os.environ.get("MUSEFOLD_REAL_USERNAME", "").strip()
PASSWORD = os.environ.get("MUSEFOLD_REAL_PASSWORD", "").strip()
SOURCE_IMAGE = Path(os.environ.get("MUSEFOLD_REAL_SOURCE_IMAGE", "")).resolve()
OUTPUT_DIR = Path(os.environ.get("MUSEFOLD_REAL_POSTCARD_DIR", "")).resolve()

pytestmark = pytest.mark.skipif(
    not USERNAME
    or not PASSWORD
    or os.environ.get("MUSEFOLD_E2E_REAL_GITHUB") != "1",
    reason="real account and GitHub acceptance settings were not provided",
)


def test_real_account_github_skill_generates_postcard(app):
    assert SOURCE_IMAGE.is_file(), SOURCE_IMAGE
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    account = app.api_ok("account.login", {"username": USERNAME, "password": PASSWORD})
    assert account["loggedIn"] is True
    assert int((account.get("quota") or {}).get("value") or 0) > 0

    provider = next(
        item for item in app.api_ok("provider.list")
        if item["managedBy"] == "account"
    )
    connection = next(
        item for item in app.api_ok("aiConnection.list")
        if item["managedBy"] == "account"
    )
    if not provider["isActive"]:
        app.api_ok("provider.setActive", provider["id"])
    if not connection["isActive"]:
        app.api_ok("aiConnection.setActive", connection["id"])

    app.page.evaluate(
        """async () => {
          await window.__musefold_test.stores.generation.getState().loadProviders();
          await window.__musefold_test.stores.aiConnections.getState().load();
          window.__musefold_test.setView('generate');
        }"""
    )
    prompt_box = app.page.locator('[data-workbench-testid="workbench-prompt"]')
    prompt_box.wait_for(state="visible")
    prompt_box.click()

    # Dispatch a real paste event through the Composer's public interaction path.
    app.page.evaluate(
        """(url) => {
          const input = document.querySelector('[data-workbench-testid="workbench-prompt"]');
          if (!(input instanceof HTMLTextAreaElement)) throw new Error('prompt input missing');
          const clipboard = new DataTransfer();
          clipboard.setData('text/plain', url);
          input.dispatchEvent(new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: clipboard,
          }));
        }""",
        REPO_URL,
    )
    app.page.wait_for_function(
        "() => ['ready', 'error'].includes(window.__musefold_test.stores.skillRuntime.getState().status)",
        timeout=240_000,
    )
    prepared = app.page.evaluate(
        """() => {
          const state = window.__musefold_test.stores.skillRuntime.getState();
          return { status: state.status, error: state.error, attachment: state.attachment };
        }"""
    )
    assert prepared["status"] == "ready", prepared
    attachment = prepared["attachment"]
    assert attachment["repositoryUrl"] == REPO_URL
    assert attachment["textFileCount"] >= 1
    app.page.wait_for_selector('[data-testid="skill-runtime-chip"][data-status="ready"]')

    app.page.locator('[data-testid="workbench-image-input"]').set_input_files(str(SOURCE_IMAGE))
    app.page.wait_for_selector('[data-testid="workbench-draft-image-preview"]')
    app.page.click('[data-testid="refine-ratio-trigger"]')
    app.page.wait_for_selector('[data-testid="refine-ratio-menu"]')
    app.page.click('[data-testid="refine-ratio-3:2"]')
    app.page.click('[data-testid="workbench-more-settings"]')
    app.page.wait_for_selector('[data-testid="workbench-generation-options"]')
    app.page.click('[data-testid="refine-quality-low"]')
    app.page.click('[data-testid="refine-count-1"]')

    prompt = (
        "将图 1 作为明信片正面的唯一内容主图，保留明亮未来工作室、Windows 显示器、"
        "青绿色桌垫与珊瑚色点缀。严格执行这个 Skill 的安静极简 zine 编辑设计语言，"
        "制作横版 3:2 旅行明信片：纸张纹理、克制网格、充足留白与细窄边框；"
        "加入小号英文标题 HELLO FROM THE FUTURE 和日期 2026.08，不得替换图 1 的场景。"
    )
    prompt_box.click()
    prompt_box.fill(prompt)
    app.page.click('[data-workbench-testid="workbench-submit"]')

    app.page.wait_for_selector(
        '[data-testid="skill-runtime-conversation"][data-placement="conversation"]',
        timeout=60_000,
    )
    app.page.wait_for_function(
        "() => ['complete', 'error'].includes(window.__musefold_test.stores.skillRuntime.getState().status)",
        timeout=420_000,
    )
    runtime = app.page.evaluate(
        """() => {
          const state = window.__musefold_test.stores.skillRuntime.getState();
          return { status: state.status, error: state.error, trace: state.trace };
        }"""
    )
    if runtime["status"] != "complete":
        tail = "".join(getattr(app, "console_tail", []))[-4000:]
        raise AssertionError(f"skill runtime failed: {runtime}\n--- electron console ---\n{tail}")

    trace = runtime["trace"]
    read_steps = [
        item for item in trace
        if item["kind"] == "tool" and item["title"].startswith("读取 ")
    ]
    assert read_steps and all(item["status"] == "success" for item in read_steps)
    assert next(item for item in trace if item["id"] == "agent-run")["status"] == "success"
    assert next(item for item in trace if item["id"] == "image-generation")["status"] == "success"

    app.page.wait_for_selector('[data-testid="generate-result-card"][data-status="success"]')
    turn = app.page.evaluate("() => window.__musefold_test.stores.workbench.getState().turns.at(-1)")
    assert turn["source"]["kind"] == "skill"
    assert turn["source"]["executionMode"] == "agent"
    assert turn["referenceImages"]
    first_reference = turn["referenceImages"][0]
    assert first_reference["name"] == SOURCE_IMAGE.name
    assert Path(first_reference["path"]).read_bytes() == SOURCE_IMAGE.read_bytes()
    result_path = Path(next(
        item["imagePath"] for item in turn["results"] if item.get("imagePath")
    ))
    assert result_path.is_file() and result_path.stat().st_size > 10_000
    postcard_path = OUTPUT_DIR / "github-skill-postcard.png"
    shutil.copy2(result_path, postcard_path)

    quota_after = app.api_ok("account.refreshQuota")
    evidence = {
        "skill": {
            "name": attachment["name"],
            "description": attachment["description"],
            "repositoryUrl": attachment["repositoryUrl"],
            "resolvedRef": attachment["resolvedRef"],
            "commitHash": attachment["commitHash"],
            "textNames": attachment["textNames"],
            "usableImageCount": attachment["usableImageCount"],
        },
        "executionMode": turn["source"]["executionMode"],
        "readSteps": [item["title"] for item in read_steps],
        "sourceImage": str(SOURCE_IMAGE),
        "sourceImageWasFirstReference": True,
        "compiledPrompt": turn["source"]["compiledPrompt"],
        "providerModel": provider["model"],
        "agentModel": connection["model"],
        "quotaAfter": quota_after["quota"]["value"],
        "resultImage": str(postcard_path),
        "resultBytes": postcard_path.stat().st_size,
    }
    (OUTPUT_DIR / "result.json").write_text(
        json.dumps(evidence, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
