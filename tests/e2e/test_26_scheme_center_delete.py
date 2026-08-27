"""临时验证：方案中心列表页删除真实方案（导入分享包 → 悬停删除 → 确认 → 消失）。"""
import hashlib
import json
import zipfile
from pathlib import Path


def _share_package(tmp_path: Path) -> Path:
    document = {
        "schemaVersion": 1,
        "revisionId": "dsrv_seed",
        "schemeId": "dsch_seed",
        "name": "待删除方案",
        "summary": "删除流程验证用",
        "fidelity": "adapted",
        "sources": [{"id": "src_brief", "kind": "user-brief", "role": "context"}],
        "inputs": [],
        "parameters": [],
        "constraints": [],
        "promptProgram": [{
            "id": "pm_1", "order": 0, "kind": "input-template",
            "template": "测试海报", "variables": [], "sourceIds": ["src_brief"],
        }],
        "compilation": {
            "compiledAt": 1, "model": {"model": "t", "connectionName": "t"},
            "adopted": [], "omitted": [], "warnings": [], "trace": [],
        },
    }
    scheme_bytes = json.dumps(document, ensure_ascii=False).encode("utf-8")
    manifest = {
        "format": "musefold.design",
        "formatVersion": 1,
        "exportedAt": 1,
        "scheme": {
            "name": "待删除方案", "summary": "删除流程验证用", "fidelity": "adapted",
            "sourceLabel": "Musefold 创建", "sourcePresentation": "musefold-created",
        },
        "revisionId": "dsrv_seed",
        "snapshots": [],
        "files": {"scheme.json": hashlib.sha256(scheme_bytes).hexdigest()},
    }
    package = tmp_path / "seed.musefold.design"
    with zipfile.ZipFile(package, "w") as zf:
        zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False))
        zf.writestr("scheme.json", scheme_bytes)
    return package


def test_delete_scheme_from_center_list(app, tmp_path):
    package = _share_package(tmp_path)
    imported = app.api_ok("designScheme.importScheme", str(package))
    assert imported["ok"], imported
    scheme_id = imported["data"]["scheme"]["id"]

    app.set_view("design-schemes")
    row = app.page.locator(f'[data-testid="runtime-scheme-row-{scheme_id}"]')
    row.wait_for()
    assert app.page.locator(".mf-workspace-section-summary").count() == 0
    assert app.page.get_by_test_id("scheme-list-workspace").locator("h2").count() == 0

    # 悬停出现删除按钮 → 确认对话框 → 行消失。
    row.hover()
    app.page.locator(f'[data-testid="runtime-scheme-remove-{scheme_id}"]').click()
    dialog = app.page.locator('[data-testid="scheme-list-remove-dialog"]')
    dialog.wait_for()
    assert "删除草稿" in dialog.inner_text()
    app.page.locator('[data-testid="scheme-list-remove-confirm"]').click()
    row.wait_for(state="detached")

    # 软删除生效：列表 API 不再返回该方案。
    listed = app.api_ok("designScheme.list")
    assert all(item["id"] != scheme_id for item in listed["data"]), listed


def test_scheme_row_opens_non_overlaying_inspector(app, tmp_path):
    package = _share_package(tmp_path)
    imported = app.api_ok("designScheme.importScheme", str(package))
    assert imported["ok"], imported
    scheme_id = imported["data"]["scheme"]["id"]

    app.set_view("design-schemes")
    row = app.page.locator(f'[data-testid="runtime-scheme-row-{scheme_id}"]')
    row.wait_for()
    row.get_by_test_id(f"runtime-scheme-open-{scheme_id}").click()

    inspector = app.page.get_by_test_id("scheme-inspector-shell")
    app.page.wait_for_function(
        """schemeId => {
          const inspector = document.querySelector('[data-testid="scheme-inspector-shell"]');
          const row = document.querySelector(`[data-testid="runtime-scheme-row-${schemeId}"]`);
          const search = document.querySelector('[data-testid="scheme-search"]');
          if (!(inspector instanceof HTMLElement) || !(search instanceof HTMLElement)) return false;
          const rect = inspector.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0
            && row?.getAttribute('data-selected') === 'true'
            && search.getBoundingClientRect().width > 0;
        }""",
        arg=scheme_id,
    )
    list_box = app.page.get_by_test_id("scheme-list-workspace").bounding_box()
    inspector_box = inspector.bounding_box()
    assert list_box and inspector_box
    assert list_box["x"] + list_box["width"] <= inspector_box["x"] + 1
    assert row.get_attribute("data-selected") == "true"
    assert app.page.get_by_test_id("scheme-search").is_visible()

    app.page.set_viewport_size({"width": 960, "height": 760})
    app.page.wait_for_function(
        "() => getComputedStyle(document.querySelector('[data-testid=\"scheme-list-workspace\"]')).display === 'none'"
    )
    narrow_workspace = app.page.get_by_test_id("design-schemes-page").bounding_box()
    narrow_inspector = inspector.bounding_box()
    assert narrow_workspace and narrow_inspector
    assert abs(narrow_workspace["width"] - narrow_inspector["width"]) <= 1

    app.page.get_by_test_id("scheme-inspector-close").click()
    inspector.wait_for(state="detached")
    assert row.get_attribute("data-selected") == "false"


def test_delete_untrialed_scheme_from_detail_page(app, tmp_path):
    """未试运行草稿：Inspector → 完整详情 → 删除草稿 → 返回列表。"""
    package = _share_package(tmp_path)
    imported = app.api_ok("designScheme.importScheme", str(package))
    assert imported["ok"], imported
    scheme_id = imported["data"]["scheme"]["id"]
    assert imported["data"]["scheme"]["hasSuccessfulTrial"] is False

    app.set_view("design-schemes")
    row_open = app.page.locator(f'[data-testid="runtime-scheme-open-{scheme_id}"]')
    row_open.wait_for()
    row_open.click()
    app.page.get_by_test_id("scheme-inspector-open-detail").click()
    app.page.get_by_test_id("runtime-scheme-detail").wait_for()

    # 详情页 ... 菜单使用共享 Dropdown：层级、质感和键盘导航都与其他 2.0 菜单一致。
    app.page.evaluate("() => window.__musefold_test.stores.app.getState().setThemeSource('dark')")
    app.page.wait_for_function(
        "() => document.documentElement.dataset.theme === 'dark'"
    )
    menu_trigger = app.page.locator('[data-testid="runtime-scheme-menu"]')
    menu_trigger.click()
    menu = app.page.locator('[data-testid="runtime-scheme-menu-list"]')
    menu.wait_for()
    menu_style = menu.evaluate(
        """node => {
          const value = getComputedStyle(node);
          return {
            backgroundColor: value.backgroundColor,
            borderRadius: value.borderRadius,
            boxShadow: value.boxShadow,
          };
        }"""
    )
    assert menu_style["backgroundColor"] == "rgb(43, 45, 49)"
    assert menu_style["borderRadius"] == "8px"
    assert menu_style["boxShadow"] != "none"
    first = menu.get_by_role("menuitem").first
    last = menu.get_by_role("menuitem").last
    assert first.evaluate("node => node === document.activeElement")
    app.page.keyboard.press("End")
    assert last.evaluate("node => node === document.activeElement")
    app.page.keyboard.press("Home")
    assert first.evaluate("node => node === document.activeElement")
    app.page.keyboard.press("Escape")
    menu.wait_for(state="detached")
    app.page.wait_for_function(
        "selector => document.activeElement === document.querySelector(selector)",
        arg='[data-testid="runtime-scheme-menu"]',
    )
    assert menu_trigger.evaluate("node => node === document.activeElement")

    app.page.evaluate("() => window.__musefold_test.stores.app.getState().setThemeSource('light')")
    app.page.wait_for_function(
        "() => document.documentElement.dataset.theme === 'light'"
    )
    menu_trigger.click()
    menu = app.page.locator('[data-testid="runtime-scheme-menu-list"]')
    menu.wait_for()
    assert menu.evaluate("node => getComputedStyle(node).backgroundColor") == "rgb(253, 252, 249)"
    app.page.keyboard.press("Escape")
    menu.wait_for(state="detached")

    # 详情页 ... 菜单里删除草稿。
    menu_trigger.click()
    app.page.get_by_test_id("runtime-scheme-menu-remove").click()
    app.page.locator('[data-testid="scheme-remove-dialog"]').wait_for()
    app.page.locator('[data-testid="scheme-remove-confirm"]').click()

    # 删除后回到列表，行消失，数据库软删除。
    app.page.locator(f'[data-testid="runtime-scheme-row-{scheme_id}"]').wait_for(state="detached")
    listed = app.api_ok("designScheme.list")
    assert all(item["id"] != scheme_id for item in listed["data"]), listed
