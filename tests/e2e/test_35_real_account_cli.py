"""Windows live acceptance: real account redemption and CLI image generation."""
from __future__ import annotations

import json
import os
import time
from pathlib import Path

import pytest

from test_34_cli_skill_generation import assert_clean_exit, json_lines, run_cli


REDEEM_CODE = os.environ.get("MUSEFOLD_REAL_REDEEM_CODE", "").strip()
USERNAME = os.environ.get("MUSEFOLD_REAL_USERNAME", "").strip()
PASSWORD = os.environ.get("MUSEFOLD_REAL_PASSWORD", "").strip()
LOGIN_ONLY = os.environ.get("MUSEFOLD_REAL_LOGIN_ONLY", "") == "1"
OUTPUT_DIR = Path(os.environ.get("MUSEFOLD_REAL_OUTPUT_DIR", "")).resolve()
RESULT_JSON = Path(os.environ.get("MUSEFOLD_REAL_RESULT_JSON", "")).resolve()

pytestmark = pytest.mark.skipif(
    not all((REDEEM_CODE, USERNAME, PASSWORD, str(OUTPUT_DIR), str(RESULT_JSON))),
    reason="real account acceptance credentials were not provided",
)


def _wait_for_quota(app, minimum: int, timeout: float = 45) -> dict:
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = app.api_ok("account.status")
        value = (last.get("quota") or {}).get("value")
        if isinstance(value, int) and value > minimum:
            return last
        time.sleep(1)
    raise AssertionError({"message": "redeemed quota did not increase", "lastStatus": last})


def test_real_account_redeem_and_cli_generate(app):
    app.page.evaluate("() => window.__musefold_test.setView('settings')")
    app.page.evaluate("() => window.__musefold_test.stores.settings.getState().setSection('account')")
    app.page.wait_for_selector('[data-testid="settings-account-signed-out"]')
    app.page.get_by_role("tab", name="登录" if LOGIN_ONLY else "注册").click()
    app.page.get_by_label("用户名").fill(USERNAME)
    app.page.get_by_label("密码", exact=True).fill(PASSWORD)
    if not LOGIN_ONLY:
        app.page.get_by_label("确认密码").fill(PASSWORD)
    app.page.click(
        '[data-testid="account-login-submit"]'
        if LOGIN_ONLY else '[data-testid="account-register-submit"]'
    )
    app.page.wait_for_selector('[data-testid="settings-account-signed-in"]', timeout=60_000)

    before = app.api_ok("account.status")
    before_quota = int((before.get("quota") or {}).get("value") or 0)
    if LOGIN_ONLY:
        after = app.api_ok("account.refreshQuota")
        assert int((after.get("quota") or {}).get("value") or 0) > 0
    else:
        app.page.locator("#account-redeem").fill(REDEEM_CODE)
        app.page.get_by_role("button", name="兑换", exact=True).click()
        after = _wait_for_quota(app, before_quota)
        # new-api's management balance is immediate; its /v1 quota cache settles later.
        time.sleep(65)

    # Exercise the visible switch, including the stopped -> running transition.
    app.page.evaluate("() => window.api.automation.setEnabled(false)")
    app.page.evaluate("() => window.__musefold_test.stores.settings.getState().setSection('automation')")
    toggle = app.page.get_by_test_id("automation-toggle")
    toggle.wait_for(state="visible")
    app.page.wait_for_function(
        "() => document.querySelector('[data-testid=\"automation-toggle\"]')?.getAttribute('aria-checked') === 'false'"
    )
    toggle.click()
    app.page.wait_for_function(
        "() => document.querySelector('[data-testid=\"automation-toggle\"]')?.getAttribute('aria-checked') === 'true'"
    )
    automation = app.page.evaluate("() => window.api.automation.status()")
    assert automation["enabled"] is True and automation["running"] is True

    providers = app.api_ok("provider.list")
    account_provider = next(provider for provider in providers if provider["managedBy"] == "account")
    if not account_provider["isActive"]:
        app.api_ok("provider.setActive", account_provider["id"])
    account_provider = next(
        provider for provider in app.api_ok("provider.list")
        if provider["id"] == account_provider["id"]
    )
    assert account_provider["isActive"] is True

    status = run_cli(app, "status", "--json")
    assert_clean_exit(status)
    assert json_lines(status)[-1]["owner"] == "desktop-app"

    prompt = (
        "一张明亮精致的未来科技工作室插画，桌面上的 Windows 电脑正在运行图像生成自动化，"
        "青绿色与珊瑚红点缀，柔和自然光，干净构图，高清细节"
    )
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    generated = run_cli(
        app,
        "generate",
        "--prompt",
        prompt,
        "--yes",
        "--json",
        "--out",
        str(OUTPUT_DIR),
        timeout=300,
    )
    assert_clean_exit(generated)
    payload = json_lines(generated)[-1]
    assert payload["status"] == "success", payload
    image_path = Path(payload["assets"][0]["path"])
    assert image_path.is_file() and image_path.stat().st_size > 0

    history = app.db_query(
        "SELECT status, provider_id, prompt_text, image_path FROM history ORDER BY created_at DESC LIMIT 1"
    )[0]
    assert history["status"] == "success"
    assert history["provider_id"] == account_provider["id"]
    assert history["prompt_text"] == prompt

    audit = app.page.evaluate("() => window.api.automation.auditList(20)")
    matching = [entry for entry in audit if entry["promptText"] == prompt]
    assert matching and matching[0]["status"] == "success"

    RESULT_JSON.parent.mkdir(parents=True, exist_ok=True)
    RESULT_JSON.write_text(json.dumps({
        "username": USERNAME,
        "serverUrl": after["serverUrl"],
        "quotaBefore": before_quota,
        "quotaAfter": after["quota"]["value"],
        "providerModel": account_provider["model"],
        "automationOwner": json_lines(status)[-1]["owner"],
        "cliExitCode": generated.returncode,
        "prompt": prompt,
        "imagePath": str(image_path),
        "imageBytes": image_path.stat().st_size,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
