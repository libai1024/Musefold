"""Consolidated secret and inert-Skill security checks for v0.3.0."""
from __future__ import annotations

import json
from pathlib import Path

from conftest import REPO


def test_managed_secrets_never_reach_renderer_databases_or_exports(app, tmp_path):
    provider_key = "sk-pfsec-provider-0123456789abcdefghijklmnopqrstuvwxyz"
    ai_key = "sk-pfsec-text-abcdefghijklmnopqrstuvwxyz0123456789"
    provider = app.api_ok(
        "provider.create",
        {
            "name": "安全审计图片服务",
            "type": "openai-compatible",
            "baseUrl": "http://127.0.0.1:9/v1",
            "model": "gpt-image-1",
        },
    )
    app.api_ok("provider.saveKey", provider["id"], provider_key)
    connection = app.api_ok(
        "aiConnection.create",
        {
            "name": "安全审计文本服务",
            "routeKind": "gateway",
            "presetId": "custom",
            "baseUrl": "http://127.0.0.1:9/v1",
            "model": "audit-text-model",
            "isActive": True,
        },
    )
    app.api_ok("aiConnection.saveKey", connection["id"], ai_key)
    assert app.api_ok("provider.hasKey", provider["id"])["hasKey"] is True
    assert app.api_ok("aiConnection.hasKey", connection["id"])["hasKey"] is True

    renderer_dump = app.page.evaluate(
        """() => JSON.stringify({
          localStorage: { ...localStorage },
          sessionStorage: { ...sessionStorage },
          body: document.body.innerText,
          providers: window.__musefold_test.stores.generation.getState().providers,
          aiConnections: window.__musefold_test.stores.aiConnections.getState().connections,
        })"""
    )
    assert provider_key not in renderer_dump
    assert ai_key not in renderer_dump

    main_export = tmp_path / "main-export.json"
    app.api_ok("system.export", {"mode": "db-only", "targetPath": str(main_export)})
    exported = main_export.read_bytes()
    assert provider_key.encode() not in exported
    assert ai_key.encode() not in exported

    app.api_ok("designScheme.list")
    scheme_dbs = sorted(app.user_data_dir.glob("musefold-design-scheme*.db"))
    assert scheme_dbs, "设计方案应落在独立 sqlite，而不是写进主库"
    for database in (app.db_path(), *scheme_dbs):
        assert database.exists(), database
        raw = database.read_bytes()
        assert provider_key.encode() not in raw
        assert ai_key.encode() not in raw

    leaked_paths: list[str] = []
    for path in app.user_data_dir.rglob("*"):
        if not path.is_file() or path.stat().st_size > 5_000_000:
            continue
        try:
            raw = path.read_bytes()
        except OSError:
            continue
        if provider_key.encode() in raw or ai_key.encode() in raw:
            leaked_paths.append(str(path.relative_to(app.user_data_dir)))
    assert leaked_paths == []
    assert provider_key not in "\n".join(app.console_errors())
    assert ai_key not in "\n".join(app.console_errors())


def test_skill_readers_have_no_execution_or_raw_html_escape_hatch():
    roots = (
        REPO / "apps/desktop/electron/main/skill-import",
        REPO / "apps/desktop/electron/main/skill-runtime-policy.ts",
        REPO / "shared/skill-scanner.ts",
    )
    forbidden = (
        "child_process",
        "exec(",
        "execFile(",
        "spawn(",
        "new Function",
        "eval(",
        "dangerouslySetInnerHTML",
    )
    scanned: list[Path] = []
    for root in roots:
        files = [root] if root.is_file() else sorted(root.rglob("*.ts"))
        for path in files:
            scanned.append(path)
            source = path.read_text("utf-8")
            for token in forbidden:
                assert token not in source, {"file": str(path.relative_to(REPO)), "token": token}
    assert scanned
    preload = (REPO / "apps/desktop/electron/preload/index.ts").read_text("utf-8")
    assert "invoke: (channel" not in preload
    assert "ipcRenderer: ipcRenderer" not in preload
