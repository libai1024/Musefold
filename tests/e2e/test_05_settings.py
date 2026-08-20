"""
tests/e2e/test_05_settings.py — M5「设置与数据」验收（全确定性，不需要密钥）。

对应 docs/product/16-onboarding-settings-data-deep-dive.md 的任务卡：
  TASK-SET-01  导出：信封格式 / 六类数据齐全 / **绝不含密钥** / zip 带图不带库
  TASK-SET-02  导入：三策略语义 / 单事务 / 悬空引用降级 / FTS 重建 / 密钥不还原
  TASK-SET-03  备份：VACUUM INTO 单文件快照 / replace 前强制备份 / 保留上限

为什么这一层只能是 E2E：better-sqlite3 是按 Electron ABI 编译的，vitest 的 Node
里 dlopen 直接失败。纯格式契约（信封校验、禁列完备性）已在
shared/__tests__/export-format.test.ts 覆盖，落库真相只能来真实应用。

断言尽量落在**产物文件本身**（json.load / zipfile.namelist）与**磁盘 DB**
（app.db_query）两侧。日志不作为证据。
"""
from __future__ import annotations

import json
import sqlite3
import threading
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest


# 1x1 透明 PNG —— 用来当"被引用的预览图"，不必真出图就能验 zip 打包逻辑
PNG_1PX = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082"
)

FORBIDDEN_SUBSTRINGS = ["apiKey", "api_key", "hasKey", "has_key", "keySuffix", "key_suffix"]
PREVIEWS_DIR_NAME = "musefold-previews-v0.3.0"
BACKUPS_DIR_NAME = "musefold-backups-v0.3.0"


@pytest.fixture()
def fake_text_ai_server():
    """OpenAI-compatible text endpoint with normal and no-model-list routes."""
    requests: list[dict] = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            return

        def _json(self, status: int, payload: dict):
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):  # noqa: N802
            requests.append({"method": "GET", "path": self.path, "authorization": self.headers.get("Authorization")})
            if self.path == "/manual/v1/models":
                self._json(404, {"error": {"message": "model listing disabled"}})
                return
            if self.path == "/v1/models":
                self._json(200, {"object": "list", "data": [
                    {"id": "text-model-a", "object": "model", "owned_by": "e2e"},
                    {"id": "text-model-b", "object": "model", "owned_by": "e2e"},
                ]})
                return
            self._json(404, {"error": {"message": "not found"}})

        def do_POST(self):  # noqa: N802
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length) or b"{}")
            requests.append({
                "method": "POST",
                "path": self.path,
                "authorization": self.headers.get("Authorization"),
                "payload": payload,
            })
            if self.path not in (
                "/v1/chat/completions",
                "/manual/v1/chat/completions",
                "/invalid/v1/chat/completions",
            ):
                self._json(404, {"error": {"message": "not found"}})
                return
            content = "OK"
            self._json(200, {
                "id": "chatcmpl-e2e",
                "object": "chat.completion",
                "created": 1,
                "model": payload.get("model", "manual-model"),
                "choices": [{
                    "index": 0,
                    "message": {"role": "assistant", "content": content},
                    "finish_reason": "stop",
                }],
                "usage": {"prompt_tokens": 2, "completion_tokens": 1, "total_tokens": 3},
            })

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield {
            "base": f"http://127.0.0.1:{server.server_address[1]}/v1",
            "manual_base": f"http://127.0.0.1:{server.server_address[1]}/manual/v1",
            "invalid_base": f"http://127.0.0.1:{server.server_address[1]}/invalid/v1",
            "requests": requests,
        }
    finally:
        server.shutdown()
        thread.join(timeout=2)


# ---------------------------------------------------------------- 工具

def export_to(app, target: Path, **req) -> dict:
    """带 targetPath 调导出 —— 绕开系统保存对话框（E2E 里没人点它）。"""
    req["targetPath"] = str(target)
    res = app.api_ok("system.export", req)
    assert not res.get("cancelled"), res
    return res


def import_from(app, source: Path, **req) -> dict:
    req["sourcePath"] = str(source)
    res = app.api_ok("system.import", req)
    assert not res.get("cancelled"), res
    return res


def read_envelope(path: Path) -> dict:
    return json.loads(path.read_text("utf-8"))


def open_data_section(app):
    """切到设置 → 数据分区。

    设置页默认停在 providers，DataSection 根本没挂载，直接找 open-export 会超时。
    走 store 而不是点导航按钮：这些用例要验的是数据分区本身，
    不该被导航的实现细节绑住。
    """
    app.set_view("settings")
    app.page.evaluate(
        "() => window.__musefold_test?.stores?.settings?.getState?.().setSection?.('data')"
    )
    app.page.get_by_test_id("open-export").wait_for(state="visible", timeout=5000)


def open_appearance_section(app):
    app.set_view("settings")
    app.page.evaluate(
        "() => window.__musefold_test?.stores?.settings?.getState?.().setSection?.('appearance')"
    )
    app.page.get_by_test_id("appearance-density-row").wait_for(state="visible", timeout=5000)


def open_about_section(app):
    app.set_view("settings")
    app.page.evaluate(
        "() => window.__musefold_test?.stores?.settings?.getState?.().setSection?.('about')"
    )
    app.page.get_by_test_id("about-version").wait_for(state="visible", timeout=5000)


def open_ai_section(app):
    app.set_view("settings")
    app.page.evaluate(
        "() => window.__musefold_test?.stores?.settings?.getState?.().setSection?.('ai')"
    )
    # 分区改名「Agent 模型」后，导航项与标题同文案；用动作按钮定位更稳。
    app.page.get_by_test_id("settings-ai-new").wait_for(state="visible", timeout=5000)


def test_cloud_mcp_connections_use_shared_screen_when_signed_out(app):
    app.set_view("settings")
    app.page.evaluate(
        "() => window.__musefold_test?.stores?.settings?.getState?.().setSection?.('connections')"
    )
    screen = app.page.get_by_test_id("connected-apps-screen")
    screen.wait_for(state="visible", timeout=5000)
    assert screen.get_by_role("heading", name="已连接应用").is_visible()
    assert screen.get_by_text("登录 Musefold 账号后可管理 Cloud MCP 连接").is_visible()


def test_ai_connection_settings_model_fallback_and_export_isolation(app, fake_text_ai_server, tmp_path):
    key = "test-ai-key-ends-4821"
    open_ai_section(app)
    app.page.get_by_test_id("settings-ai-new").click()
    dialog = app.page.get_by_test_id("ai-connection-dialog")
    dialog.get_by_test_id("ai-preset-custom").click()
    dialog.get_by_test_id("ai-connection-name").fill("E2E 文本模型")
    dialog.get_by_test_id("ai-connection-base-url").fill(fake_text_ai_server["base"])
    dialog.get_by_test_id("ai-connection-model").fill("text-model-a")
    dialog.get_by_test_id("ai-connection-api-key").fill(key)
    dialog.get_by_test_id("ai-connection-load-models").click()
    dialog.get_by_test_id("ai-connection-model-options").wait_for(state="visible", timeout=5000)
    assert dialog.get_by_test_id("ai-model-option-text-model-b").is_visible()
    dialog.get_by_test_id("ai-connection-test").click()
    dialog.get_by_test_id("ai-connection-capabilities").wait_for(state="visible", timeout=5000)
    dialog.get_by_test_id("ai-connection-save").click()
    dialog.wait_for(state="hidden", timeout=5000)

    row = app.page.locator('[data-testid^="settings-ai-row-"]').first
    assert row.get_by_text("E2E 文本模型", exact=True).is_visible()
    assert row.get_by_text("Key ····4821", exact=True).is_visible()
    assert "E2E 文本模型" not in app.page.evaluate(
        "() => JSON.stringify(window.__musefold_test.stores.generation.getState())"
    )

    row.get_by_role("button", name="编辑").click()
    dialog.get_by_test_id("ai-connection-base-url").fill(fake_text_ai_server["manual_base"])
    dialog.get_by_test_id("ai-connection-model").fill("manual-model")
    dialog.get_by_test_id("ai-connection-load-models").click()
    dialog.get_by_test_id("ai-connection-model-error").wait_for(state="visible", timeout=5000)
    assert dialog.get_by_test_id("ai-connection-model").input_value() == "manual-model"
    dialog.get_by_test_id("ai-connection-test").click()
    dialog.get_by_test_id("ai-connection-capabilities").wait_for(state="visible", timeout=5000)
    dialog.get_by_test_id("ai-connection-save").click()
    dialog.wait_for(state="hidden", timeout=5000)

    row.get_by_role("button", name="撤销 Key").click()
    row.get_by_role("button", name="撤销", exact=True).click()
    row.get_by_text("缺少 Key", exact=True).wait_for(state="visible", timeout=5000)

    target = tmp_path / "without-ai-connection.json"
    export_to(app, target, mode="db-only")
    raw = target.read_text("utf-8")
    assert key not in raw
    assert "E2E 文本模型" not in raw
    assert fake_text_ai_server["manual_base"] not in raw


@pytest.fixture(scope="module")
def seeded(app_shared, tmp_path_factory):
    """给共享实例补一批可辨识的数据，供只读导出用例复用。

    只读用例（导出）共享一个实例即可，省下每个函数一次 Electron 冷启动；
    会改库的导入用例一律用函数级 `app` fixture，互不污染。
    """
    a = app_shared
    tag = a.insert_tag("E2E导出标签", "风格")
    folder = a.insert_folder("E2E导出文件夹")
    # 预览图落在当前数据域的 previews 目录 —— 白名单允许的两个根之一
    previews = a.user_data_dir / PREVIEWS_DIR_NAME
    previews.mkdir(parents=True, exist_ok=True)
    png = previews / "e2e-export-preview.png"
    png.write_bytes(PNG_1PX)
    prompt = a.api_ok(
        "prompt.create",
        {
            "title": "E2E 导出用提示词",
            "content": "a lone lighthouse, storm, cinematic",
            "contentNegative": "blurry",
            "folderId": folder["id"],
            "tagIds": [tag["id"]],
            "previewImagePath": str(png),
        },
    )
    smart_set = a.insert_smart_set(
        "E2E 智能集合",
        {"search": "lighthouse", "tagIds": [tag["id"]], "sort": "updated", "sortDir": "desc"},
    )
    return {"tag": tag, "folder": folder, "prompt": prompt, "png": png, "smartSet": smart_set}


# ================================================================ TASK-SET-01 导出

def test_export_envelope_top_level(app_shared, seeded, tmp_path):
    """信封顶层字段齐全 —— 导入端与未来版本迁移都依赖它们。"""
    out = tmp_path / "db-only.json"
    res = export_to(app_shared, out, mode="db-only")

    assert res["path"] == str(out)
    assert out.is_file() and out.stat().st_size > 0
    env = read_envelope(out)

    assert env["format"] == "musefold-export"
    assert env["schemaVersion"] == 3
    assert isinstance(env["dbUserVersion"], int) and env["dbUserVersion"] >= 3
    assert env["appVersion"], "appVersion 缺失，跨版本导入无从判断兼容性"
    assert isinstance(env["exportedAt"], int) and env["exportedAt"] > 0
    assert env["mode"] == "db-only"
    assert isinstance(env["counts"], dict) and isinstance(env["data"], dict)


def test_export_categories_present(app_shared, seeded, tmp_path):
    """核心数据段齐全，且 prompts 用 tagIds 引用（而不是内嵌 tag 对象）。"""
    out = tmp_path / "cats.json"
    export_to(app_shared, out, mode="db-only")
    data = read_envelope(out)["data"]

    for key in ("prompts", "folders", "tags", "smartSets", "providers"):
        assert key in data, f"data 缺少 {key} 段"
        assert isinstance(data[key], list), f"{key} 不是数组"

    exported_set = next(s for s in data["smartSets"] if s["id"] == seeded["smartSet"]["id"])
    assert exported_set["query"]["tagIds"] == [seeded["tag"]["id"]]

    # 信封里 prompts 用 tagIds 引用 tags 段，而不是内嵌整个 Tag 对象
    mine = next(p for p in data["prompts"] if p["id"] == seeded["prompt"]["id"])
    assert mine["tagIds"] == [seeded["tag"]["id"]], mine["tagIds"]
    assert "tags" not in mine, "信封不该内嵌 tag 对象（会和 tags 段重复且可能不一致）"
    assert mine["folderId"] == seeded["folder"]["id"]
    assert mine["content"], "content 丢了"


def test_export_counts_match_payload(app_shared, seeded, tmp_path):
    """counts 必须和 data 数组长度一致 —— 对话框拿 counts 显示，不能骗人。"""
    out = tmp_path / "counts.json"
    res = export_to(app_shared, out, mode="db-only")
    env = read_envelope(out)
    for key, n in env["counts"].items():
        assert len(env["data"][key]) == n, f"{key}: counts={n} 实际={len(env['data'][key])}"
    assert res["counts"] == env["counts"], "IPC 回传的 counts 与文件内不一致"


def test_export_providers_have_no_secret(app_shared, tmp_path):
    """🔒 红线：providers 段无明文密钥、无密文、连 hasKey/keySuffix 都不带。

    先真的建一个带密钥的 Provider，再导出 —— 否则这条断言是在空集上通过的。
    """
    a = app_shared
    p = a.api_ok(
        "provider.create",
        {
            "name": "E2E 导出用站点",
            "type": "openai-compatible",
            "baseUrl": "http://127.0.0.1:9/v1",
            "model": "gpt-image-1",
        },
    )
    a.api_ok("provider.saveKey", p["id"], "sk-e2e-secret-value-should-never-leak-9999")
    assert a.api_ok("provider.hasKey", p["id"])["hasKey"] is True, "密钥没设上，后面断言无意义"

    out = tmp_path / "providers.json"
    export_to(a, out, mode="db-only")
    raw = out.read_text("utf-8")
    env = json.loads(raw)

    providers = env["data"]["providers"]
    mine = next(x for x in providers if x["id"] == p["id"])
    assert mine["baseUrl"] == "http://127.0.0.1:9/v1", "连接信息该导出"
    assert set(mine) == {
        "id", "name", "type", "baseUrl", "model", "isActive", "createdAt", "updatedAt",
    }, f"provider 段字段集变了：{sorted(mine)}"

    # 整个文件级 grep：密钥本体、末四位提示、任何 key 变体都不许出现
    assert "sk-e2e-secret" not in raw
    assert "9999" not in raw, "疑似 keySuffix 泄漏"
    for bad in FORBIDDEN_SUBSTRINGS:
        assert bad not in raw, f"导出文件出现禁列字段 {bad}"


def test_export_history_absent_by_default(app_shared, seeded, tmp_path):
    default_out = tmp_path / "no-history.json"
    export_to(app_shared, default_out, mode="db-only")
    env = read_envelope(default_out)
    assert "history" not in env["data"], "history 默认就不该出现在导出里"
    assert "history" not in env["counts"]

    with_out = tmp_path / "with-history.json"
    export_to(app_shared, with_out, mode="db-only", includeHistory=True)
    env2 = read_envelope(with_out)
    assert "history" in env2["data"], "includeHistory:true 时 history 该出现"
    assert env2["counts"]["history"] == len(env2["data"]["history"])


def test_history_prompt_references_round_trip_with_export_import(app, tmp_path):
    """历史引用快照随可选 history 段导出，并在 replace 导入后完整恢复。"""
    prompt = app.api_ok("prompt.create", {
        "title": "引用导出源",
        "content": "original reference snapshot",
    })
    result = app.api_ok("image.generate", {
        "jobId": "history-reference-export",
        "providerId": "missing-provider-for-deterministic-failure",
        "prompt": "user body\n\n参考提示词：\n\n【引用导出源｜整条】\noriginal reference snapshot",
        "size": "1024x1024",
        "quality": "low",
        "n": 1,
        "promptReferences": [{
            "promptId": prompt["id"],
            "title": prompt["title"],
            "text": prompt["content"],
            "scope": "full",
        }],
    })
    assert result["status"] == "failed"

    out = tmp_path / "history-references.json"
    export_to(app, out, mode="db-only", includeHistory=True)
    env = read_envelope(out)
    history = next(item for item in env["data"]["history"] if item["id"] == result["historyId"])
    assert history["promptReferences"] == [{
        "promptId": prompt["id"],
        "title": prompt["title"],
        "text": prompt["content"],
        "scope": "full",
        "sortOrder": 0,
    }]

    import_from(app, out, strategy="replace")
    restored = app.db_query(
        """SELECT history_id, prompt_id, prompt_title, excerpt, scope, sort_order
           FROM history_prompt_references WHERE history_id = ?""",
        (result["historyId"],),
    )
    assert restored == [{
        "history_id": result["historyId"],
        "prompt_id": prompt["id"],
        "prompt_title": prompt["title"],
        "excerpt": prompt["content"],
        "scope": "full",
        "sort_order": 0,
    }]


def test_export_redacts_secret_in_free_text(app_shared, tmp_path):
    """自由文本里的密钥要被 redact —— 用户会把 curl 命令粘进 content。"""
    a = app_shared
    leak = "sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD"
    p = a.api_ok(
        "prompt.create",
        {"title": "粘了 curl 的提示词", "content": f"curl -H 'Authorization: Bearer {leak}' x"},
    )
    out = tmp_path / "redact.json"
    res = export_to(a, out, mode="db-only")
    raw = out.read_text("utf-8")

    assert leak not in raw, "自由文本里的密钥没被 redact"
    assert res["redactedFields"] >= 1, "redactedFields 没计数，UI 无从提示用户"
    a.api_ok("prompt.purge", p["id"])  # 彻底删，别把噪音留给后面的用例


def test_export_dry_run_writes_nothing(app_shared, seeded, tmp_path):
    """预览只算数：不落盘、不弹框、counts 与真导出同源。"""
    ghost = tmp_path / "should-not-exist.json"
    res = app_shared.api_ok("system.export", {"mode": "db-only", "dryRun": True, "targetPath": str(ghost)})
    assert res["dryRun"] is True
    assert res["path"] == ""
    assert not ghost.exists(), "dryRun 竟然写了文件"

    real = tmp_path / "real.json"
    res2 = export_to(app_shared, real, mode="db-only")
    assert res["counts"] == res2["counts"], "预览与真导出的计数不一致"


def test_export_zip_has_images_and_no_db(app_shared, seeded, tmp_path):
    """mode:db-with-images → zip 含 JSON + 被引用的 previews/，不含 db/密钥/日志。"""
    runtime_paths = app_shared.api_ok("system.getPaths")
    assert (Path(runtime_paths["userData"]) / PREVIEWS_DIR_NAME).resolve() == seeded["png"].parent.resolve()
    assert seeded["png"].is_file()
    stored_path = app_shared.db_query(
        "SELECT preview_image_path FROM prompts WHERE id = ?",
        (seeded["prompt"]["id"],),
    )[0]["preview_image_path"]
    assert Path(stored_path).resolve() == seeded["png"].resolve()
    out = tmp_path / "bundle.zip"
    res = export_to(app_shared, out, mode="db-with-images")
    assert zipfile.is_zipfile(out), "产物不是 zip"

    with zipfile.ZipFile(out) as z:
        names = z.namelist()
        assert "musefold-export.json" in names, names
        previews = [n for n in names if n.startswith("previews/")]
        assert previews, "被引用的预览图没进包"
        assert any(n.endswith("e2e-export-preview.png") for n in previews), previews
        # 图片是真内容而非空壳
        assert len(z.read(previews[0])) > 0
        env = json.loads(z.read("musefold-export.json"))

    assert res["images"] >= 1
    assert env["mode"] == "db-with-images"

    # 🔒 禁区：库文件、electron-store 密钥文件、日志
    lowered = [n.lower() for n in names]
    assert not any(n.endswith(".db") or n.endswith(".db-wal") or n.endswith(".db-shm") for n in lowered), names
    assert not any("providers" in n and n.endswith(".json") for n in lowered), names
    assert not any(n.startswith("logs/") or n.endswith(".log") for n in lowered), names
    # zip 里也不许有 key 字段
    with zipfile.ZipFile(out) as z:
        raw = z.read("musefold-export.json").decode("utf-8")
    for bad in FORBIDDEN_SUBSTRINGS:
        assert bad not in raw, f"zip 内 JSON 出现禁列字段 {bad}"


def test_export_zip_skips_out_of_tree_image(app_shared, tmp_path):
    """DB 里的越界路径不得被打进包 —— 防 `../../../.ssh/id_rsa` 这类。

    直接往库里塞一条越界 previewImagePath（IPC 层不一定拦），验导出侧的白名单。
    """
    a = app_shared
    outside = tmp_path / "outside-secret.txt"
    outside.write_text("should never be packed", "utf-8")
    p = a.api_ok("prompt.create", {"title": "越界预览图", "content": "x", "previewImagePath": str(outside)})

    out = tmp_path / "traversal.zip"
    export_to(a, out, mode="db-with-images")
    with zipfile.ZipFile(out) as z:
        names = z.namelist()
    assert not any("outside-secret" in n for n in names), names
    a.api_ok("prompt.purge", p["id"])


def test_export_empty_library_is_valid_envelope(app, tmp_path):
    """空库导出得到合法空信封，不报错。

    用函数级 fixture + replace 一份空信封把库清空（seed 也一起清），
    这是唯一能造出"真空库"的确定性手段。
    """
    empty_src = tmp_path / "empty-src.json"
    empty_src.write_text(
        json.dumps(
            {
                "format": "musefold-export",
                "schemaVersion": 3,
                "dbUserVersion": 3,
                "appVersion": "0.0.0",
                "exportedAt": 1,
                "mode": "db-only",
                "counts": {},
                "data": {
                    "prompts": [], "folders": [], "tags": [], "smartSets": [], "providers": [],
                },
            }
        ),
        "utf-8",
    )
    import_from(app, empty_src, strategy="replace")
    assert app.api_ok("prompt.list", {}) == []

    out = tmp_path / "empty.json"
    res = export_to(app, out, mode="db-only")
    env = read_envelope(out)
    assert env["format"] == "musefold-export"
    for key in ("prompts", "folders", "tags", "smartSets", "providers"):
        assert env["data"][key] == [], f"{key} 非空"
        assert env["counts"][key] == 0
    assert res["redactedFields"] == 0


# ================================================================ TASK-SET-02 导入

@pytest.fixture
def bundle(app, tmp_path) -> Path:
    """从当前实例导出一份完整信封，供各策略用例当输入。"""
    out = tmp_path / "round-trip.json"
    export_to(app, out, mode="db-only")
    return out


def test_import_round_trip_restores_data(app, tmp_path):
    """导出 → 清库 → 导入：数据回来了，且 FTS 能搜到。"""
    a = app
    tag = a.insert_tag("回环标签", "风格")
    a.api_ok(
        "prompt.create",
        {"title": "回环提示词", "content": "一只戴礼帽的柴犬在雨中散步", "tagIds": [tag["id"]]},
    )
    smart_set = a.insert_smart_set(
        "回环集合",
        {"search": "柴犬", "tagIds": [tag["id"]]},
    )

    snapshot = tmp_path / "snapshot.json"
    export_to(a, snapshot, mode="db-only")
    before = len(a.api_ok("prompt.list", {}))

    # 清空
    empty = tmp_path / "empty.json"
    empty.write_text(json.dumps({**read_envelope(snapshot), "data": {
        "prompts": [], "folders": [], "tags": [], "smartSets": [], "providers": [],
    }}), "utf-8")
    import_from(a, empty, strategy="replace")
    assert a.api_ok("prompt.list", {}) == []
    assert a.db_query("SELECT COUNT(*) AS n FROM smart_sets")[0]["n"] == 0

    res = import_from(a, snapshot, strategy="replace")
    assert res["dryRun"] is False
    assert len(a.api_ok("prompt.list", {})) == before
    restored = next(p for p in a.api_ok("prompt.list", {}) if p["title"] == "回环提示词")
    # 运行期 Prompt 带的是 join 出来的 tags 对象；tagIds 只是信封里的引用形式
    assert [t["id"] for t in restored["tags"]] == [tag["id"]], "标签关联没跟着回来"
    restored_sets = a.db_query("SELECT id, query FROM smart_sets")
    assert any(
        s["id"] == smart_set["id"] and json.loads(s["query"]).get("search") == "柴犬"
        for s in restored_sets
    )

    # FTS 是独立表、无触发器 —— 不显式重建就搜不到，且不报错（静默失败）
    hits = a.api_ok("prompt.list", {"search": "柴犬"})
    assert any(h["title"] == "回环提示词" for h in hits), "导入后 FTS 没同步：中文搜索搜不到"


def test_import_skip_keeps_local(app, tmp_path):
    """skip：同 id 一律保留本地，不看时间。"""
    a = app
    p = a.api_ok("prompt.create", {"title": "原始标题", "content": "原始内容"})
    src = tmp_path / "skip.json"
    export_to(a, src, mode="db-only")

    # 改本地，再用旧信封 skip 导入 —— 本地的改动必须留着
    a.api_ok("prompt.update", p["id"], {"title": "本地改过的标题"})
    res = import_from(a, src, strategy="skip")

    assert a.api_ok("prompt.get", p["id"])["title"] == "本地改过的标题"
    assert res["byType"]["prompts"]["updated"] == 0, "skip 策略不该有 updated"
    assert res["byType"]["prompts"]["skipped"] >= 1


def test_import_merge_newer_wins(app, tmp_path):
    """merge：导入方 updatedAt 更新才覆盖，否则保留本地。"""
    a = app
    p = a.api_ok("prompt.create", {"title": "合并测试", "content": "v1"})
    src = tmp_path / "merge.json"
    export_to(a, src, mode="db-only")

    # 手工把信封里那条的 updatedAt 推到未来 → 它该赢
    env = read_envelope(src)
    for row in env["data"]["prompts"]:
        if row["id"] == p["id"]:
            row["content"] = "来自导入的 v2"
            row["updatedAt"] = row["updatedAt"] + 10_000
    src.write_text(json.dumps(env), "utf-8")

    res = import_from(a, src, strategy="merge")
    assert a.api_ok("prompt.get", p["id"])["content"] == "来自导入的 v2"
    assert res["byType"]["prompts"]["updated"] >= 1

    # 反过来：把 updatedAt 退回过去 → 本地该赢
    for row in env["data"]["prompts"]:
        if row["id"] == p["id"]:
            row["content"] = "更老的 v0"
            row["updatedAt"] = 1
    src.write_text(json.dumps(env), "utf-8")
    import_from(a, src, strategy="merge")
    assert a.api_ok("prompt.get", p["id"])["content"] == "来自导入的 v2", "旧数据覆盖了新数据"


def test_import_never_restores_keys(app, tmp_path):
    """🔒 导入只重建 Provider 连接信息，hasKey 必须为 false。

    否则 UI 显示"已配置"，用户一点生成必然 401，是最难自查的坑。
    """
    a = app
    src_env = {
        "format": "musefold-export", "schemaVersion": 3, "dbUserVersion": 11,
        "appVersion": "0.0.0", "exportedAt": 1, "mode": "db-only", "counts": {},
        "data": {
            "prompts": [], "folders": [], "tags": [], "smartSets": [],
            # 恶意/旧版信封：即便带了这些字段，导入端也不许采信
            "providers": [{
                "id": "prov-imported-1", "name": "导入的站点", "type": "openai-compatible",
                "baseUrl": "http://127.0.0.1:9/v1", "model": "gpt-image-1",
                "isActive": True, "createdAt": 1, "updatedAt": 1,
                "apiKey": "sk-should-be-ignored", "hasKey": True, "keySuffix": "8888",
            }],
        },
    }
    src = tmp_path / "providers-in.json"
    src.write_text(json.dumps(src_env), "utf-8")
    import_from(a, src, strategy="merge")

    got = next(x for x in a.api_ok("provider.list") if x["id"] == "prov-imported-1")
    assert got["baseUrl"] == "http://127.0.0.1:9/v1", "连接信息该恢复"
    assert got["hasKey"] is False, "导入竟然把 hasKey 置真"
    assert not got.get("keySuffix"), got

    # 落库也不许有痕迹
    rows = a.db_query("SELECT has_key, key_suffix FROM providers WHERE id = ?", ("prov-imported-1",))
    assert rows[0]["has_key"] in (0, None)
    assert rows[0]["key_suffix"] in ("", None)


def test_import_dangling_folder_id_downgraded(app, tmp_path):
    """悬空 folderId → 置空但 prompt 仍导入（不整条失败）。"""
    a = app
    src_env = {
        "format": "musefold-export", "schemaVersion": 3, "dbUserVersion": 11,
        "appVersion": "0.0.0", "exportedAt": 1, "mode": "db-only", "counts": {},
        "data": {
            "prompts": [{
                "id": "p-dangling-1", "title": "悬空文件夹的提示词", "content": "内容在",
                "folderId": "folder-does-not-exist", "tagIds": [],
                "createdAt": 1, "updatedAt": 1,
            }],
            # 故意不给 folders 段
            "folders": [], "tags": [], "smartSets": [], "providers": [],
        },
    }
    src = tmp_path / "dangling.json"
    src.write_text(json.dumps(src_env), "utf-8")
    res = import_from(a, src, strategy="merge")

    got = a.api_ok("prompt.get", "p-dangling-1")
    assert got is not None, "整条被拒了 —— 应该降级而非丢弃"
    assert not got["folderId"], f"folderId 没被置空：{got['folderId']}"
    assert got["content"] == "内容在"
    assert res["byType"]["prompts"]["imported"] == 1
    assert any("folder" in w.lower() or "文件夹" in w for w in res["warnings"]), res["warnings"]


def test_import_rejects_future_schema_version(app, tmp_path):
    """更高的 schemaVersion 硬拒 —— "尽力读一半"会静默丢数据。"""
    src = tmp_path / "future.json"
    src.write_text(json.dumps({
        "format": "musefold-export", "schemaVersion": 99, "data": {},
    }), "utf-8")

    before = len(app.api_ok("prompt.list", {}))
    r = app.api("system.import", {"sourcePath": str(src), "strategy": "merge"})
    assert not r["ok"], "更高版本的信封竟然被接受了"
    assert "99" in r["error"] and "升级" in r["error"], r["error"]
    assert len(app.api_ok("prompt.list", {})) == before, "失败的导入改了库"


def test_import_corrupt_json_leaves_db_untouched(app, tmp_path):
    """坏文件不能碰库 —— 单事务的底线。"""
    src = tmp_path / "corrupt.json"
    src.write_text("{ this is not json at all ", "utf-8")

    before = app.db_query("SELECT COUNT(*) AS n FROM prompts")[0]["n"]
    r = app.api("system.import", {"sourcePath": str(src), "strategy": "replace"})
    assert not r["ok"], "坏 JSON 竟然导入成功"
    after = app.db_query("SELECT COUNT(*) AS n FROM prompts")[0]["n"]
    assert after == before, f"replace 半路失败没回滚：{before} → {after}"


def test_import_wrong_format_rejected(app, tmp_path):
    """合法 JSON 但不是本应用的导出 → 明确报错，不当空信封处理。"""
    src = tmp_path / "alien.json"
    src.write_text(json.dumps({"format": "some-other-tool", "data": {}}), "utf-8")
    r = app.api("system.import", {"sourcePath": str(src), "strategy": "merge"})
    assert not r["ok"], "陌生格式被接受了"
    assert "Musefold" in r["error"] or "format" in r["error"], r["error"]


def test_import_dry_run_previews_without_writing(app, tmp_path):
    """试运行：拿到真实计数，但库一行不动（事务内跑完主动回滚）。"""
    a = app
    src_env = {
        "format": "musefold-export", "schemaVersion": 3, "dbUserVersion": 11,
        "appVersion": "0.0.0", "exportedAt": 1, "mode": "db-only", "counts": {},
        "data": {
            "prompts": [
                {"id": f"p-dry-{i}", "title": f"试运行 {i}", "content": "x",
                 "tagIds": [], "createdAt": 1, "updatedAt": 1}
                for i in range(3)
            ],
            "folders": [], "tags": [], "smartSets": [], "providers": [],
        },
    }
    src = tmp_path / "dry.json"
    src.write_text(json.dumps(src_env), "utf-8")

    before = a.db_query("SELECT COUNT(*) AS n FROM prompts")[0]["n"]
    prev = import_from(a, src, strategy="merge", dryRun=True)
    assert prev["dryRun"] is True
    assert prev["byType"]["prompts"]["imported"] == 3, prev["byType"]
    assert a.db_query("SELECT COUNT(*) AS n FROM prompts")[0]["n"] == before, "dryRun 写库了"
    assert prev["sourcePath"] == str(src), "sourcePath 没回传，确认时会二次弹框"

    # 真跑一遍，计数应与预览一致
    real = import_from(a, src, strategy="merge")
    assert real["byType"]["prompts"]["imported"] == 3
    assert a.db_query("SELECT COUNT(*) AS n FROM prompts")[0]["n"] == before + 3


def test_import_zip_extracts_images_and_rewrites_path(app, tmp_path):
    """zip 导入：图片落地到本机 previews/，DB 里的路径改写成新位置。"""
    a = app
    previews = a.user_data_dir / PREVIEWS_DIR_NAME
    previews.mkdir(parents=True, exist_ok=True)
    png = previews / "zip-src-preview.png"
    png.write_bytes(PNG_1PX)
    a.api_ok("prompt.create", {"title": "带图的提示词", "content": "x", "previewImagePath": str(png)})

    bundle = tmp_path / "with-images.zip"
    res = export_to(a, bundle, mode="db-with-images")
    assert res["images"] >= 1

    # 换个"本机"：清库 + 删掉原图，模拟导到另一台机器
    empty = tmp_path / "empty.json"
    empty.write_text(json.dumps({
        "format": "musefold-export", "schemaVersion": 3, "dbUserVersion": 11,
        "appVersion": "0.0.0", "exportedAt": 1, "mode": "db-only", "counts": {},
        "data": {"prompts": [], "folders": [], "tags": [], "smartSets": [], "providers": []},
    }), "utf-8")
    import_from(a, empty, strategy="replace")
    png.unlink()

    import_from(a, bundle, strategy="replace")
    got = next(p for p in a.api_ok("prompt.list", {}) if p["title"] == "带图的提示词")
    path = got["previewImagePath"]
    assert path, "预览图路径丢了"
    assert Path(path).is_file(), f"图片没落地：{path}"
    assert Path(path).read_bytes() == PNG_1PX, "落地的不是原图内容"
    assert "imported-" in Path(path).name, f"没加 imported- 前缀，可能覆盖了本机同名图：{path}"


@pytest.mark.parametrize(
    "entry_name",
    [
        "previews/../../pwned.txt",   # 穿目录
        "../../pwned2.txt",           # 根上就往外跑
        "previews/sub/nested.txt",    # previews 下再套一层（白名单只收单层）
        "data.db",                    # 想借导入把库文件塞进 userData
    ],
)
def test_import_zip_slip_entry_never_lands(app, tmp_path, entry_name):
    """zip-slip / 非预期条目：一律不得落到 userData 里。

    断言的是**安全性质**（磁盘上没有多出文件），不是实现细节：
    yauzl 自己就会把 `previews/../../x` 判成非法相对路径并抛错，
    更外层的白名单再兜一道。两种结局都可接受 —— 硬拒或静默跳过，
    唯一不可接受的是文件真被写出来。
    """
    a = app
    evil = tmp_path / "evil.zip"
    env = {
        "format": "musefold-export", "schemaVersion": 3, "dbUserVersion": 11,
        "appVersion": "0.0.0", "exportedAt": 1, "mode": "db-with-images", "counts": {},
        "data": {"prompts": [], "folders": [], "tags": [], "smartSets": [], "providers": []},
    }
    with zipfile.ZipFile(evil, "w") as z:
        z.writestr("musefold-export.json", json.dumps(env))
        z.writestr(entry_name, "pwned")

    root = a.user_data_dir.resolve()
    before = {p for p in root.rglob("*") if p.is_file()}

    # 抛错（yauzl 判非法路径）或静默跳过都行，只要没落地
    app.api("system.import", {"sourcePath": str(evil), "strategy": "merge"})

    leaked = [p for p in root.rglob("*") if p.is_file() and p not in before
              and "pwned" in p.read_bytes()[:64].decode("utf-8", "ignore")]
    assert not leaked, f"zip 条目 {entry_name} 落地了：{leaked}"
    assert not (root.parent / "pwned2.txt").exists(), "写到了 userData 之外"


# ================================================================ 导入的坏 JSON 不能污染库

def test_import_malformed_params_nulled_not_stored_raw(app, tmp_path):
    """信封里 params 是非法 JSON 字符串 → 落库前降级为 NULL。

    为什么这条重要：全库有十来处 `JSON.parse(r.params)` 是裸的
    （repositories 与 history/images 的 IPC）。在导入功能出现前，这些列的唯一
    写入方是本应用，永远合法。导入把「文件里的任意字符串」变成了新写入源 ——
    一条坏 params 落库后 prompt.list() 直接抛，**整个资源库视图打不开，
    用户在 UI 上无法自救**。闸门必须在写入侧。
    """
    a = app
    src_env = {
        "format": "musefold-export", "schemaVersion": 3, "dbUserVersion": 11,
        "appVersion": "0.0.0", "exportedAt": 1, "mode": "db-only", "counts": {},
        "data": {
            "prompts": [{
                "id": "p-badparams-1", "title": "坏参数的提示词", "content": "内容正常",
                "params": "{ 这不是 JSON",     # ← 关键：合法字符串、非法 JSON
                "tagIds": [], "createdAt": 1, "updatedAt": 1,
            }],
            "folders": [], "tags": [], "smartSets": [], "providers": [],
        },
    }
    src = tmp_path / "bad-params.json"
    src.write_text(json.dumps(src_env), "utf-8")
    import_from(a, src, strategy="merge")

    # 落库的值必须是 NULL 或合法 JSON，绝不能是那段原始字符串
    row = a.db_query("SELECT params FROM prompts WHERE id = ?", ("p-badparams-1",))[0]
    if row["params"] is not None:
        json.loads(row["params"])  # 抛就说明写进去的是坏数据

    # 真正的验收：读路径还能用
    assert a.api_ok("prompt.get", "p-badparams-1")["title"] == "坏参数的提示词"
    assert any(p["id"] == "p-badparams-1" for p in a.api_ok("prompt.list", {})), \
        "资源库列表加载失败 —— 一条坏 params 就让整个视图打不开了"


def test_retry_missing_history_returns_structured_error(app):
    """image.retry 撞上不存在的历史行 → 结构化返回，不是抛桥错误。

    throw 的话渲染层只能拿到
    "Error invoking remote method 'image:retry': Error: 历史记录不存在"，
    既没法按 code 分类，也不能直接展示给用户。
    """
    r = app.api("image.retry", "history-id-that-does-not-exist", "job-x")
    assert r["ok"], f"retry 抛异常了，说明还在 throw：{r.get('error')}"
    assert r["value"]["status"] == "failed"
    assert r["value"]["error"]["code"] == "NO_HISTORY", r["value"]
    assert "不存在" in r["value"]["error"]["message"]
    # 结构化错误不该顺手写一条垃圾历史
    assert app.api_ok("history.get", "history-id-that-does-not-exist") is None


# ================================================================ TASK-SET-03 备份

def test_replace_always_backs_up(app, tmp_path):
    """replace 前必做备份 —— 无视 autoBackup 入参（doc 16 验收标准）。"""
    a = app
    a.api_ok("prompt.create", {"title": "会被 replace 干掉的", "content": "x"})
    src = tmp_path / "for-replace.json"
    export_to(a, src, mode="db-only")

    res = import_from(a, src, strategy="replace", autoBackup=False)
    assert res.get("backupPath"), "replace 没备份 —— 用户丢数据就回不去了"

    bak = Path(res["backupPath"])
    assert bak.is_file() and bak.stat().st_size > 0
    # 两边都 resolve：macOS 上应用侧看到的是 /private/var，pytest 侧是 /var
    assert bak.resolve().parent == (a.user_data_dir / BACKUPS_DIR_NAME).resolve(), bak

    # VACUUM INTO 出来的是**自包含单文件**，能独立打开且带着数据
    con = sqlite3.connect(f"file:{bak}?mode=ro", uri=True)
    try:
        n = con.execute("SELECT COUNT(*) FROM prompts").fetchone()[0]
        assert n >= 1, "备份里没有数据"
        assert con.execute("PRAGMA user_version").fetchone()[0] >= 3
    finally:
        con.close()
    # 单文件快照：不该依赖 -wal / -shm
    assert not Path(str(bak) + "-wal").exists()


def test_merge_backup_can_be_opted_out(app, tmp_path, bundle):
    """merge/skip 默认备份，显式 autoBackup:false 才跳过。"""
    a = app
    with_bak = import_from(a, bundle, strategy="merge")
    assert with_bak.get("backupPath"), "merge 默认该备份"

    without = import_from(a, bundle, strategy="merge", autoBackup=False)
    assert not without.get("backupPath"), "显式关掉了还是备份了"


def test_dry_run_does_not_backup(app, tmp_path, bundle):
    """试运行不改库，就不该留下备份文件（否则点几次预览攒一堆垃圾）。"""
    res = import_from(app, bundle, strategy="replace", dryRun=True)
    assert not res.get("backupPath"), "dryRun 竟然备份了"


def test_backup_filename_sorts_by_time(app, tmp_path, bundle):
    """备份文件名的零填充时间戳 = 字典序即时间序。

    pruneBackups() 靠这个性质决定保留顺序，命名格式一改就会静默错序，
    所以这里把它钉住。设置页 listBackups 另按真实 mtime 排序。
    """
    a = app
    first = Path(import_from(a, bundle, strategy="replace")["backupPath"])
    second = Path(import_from(a, bundle, strategy="replace")["backupPath"])
    assert first != second, "两次备份写到同一个文件，旧快照被覆盖了"

    files = sorted((a.user_data_dir / BACKUPS_DIR_NAME).glob("*.db"))
    assert len(files) >= 2, files
    # 文件名里的时间戳必须让字典序 == 时间序
    mtime_order = [f.name for f in sorted(files, key=lambda f: f.stat().st_mtime)]
    assert [f.name for f in files] == mtime_order, f"字典序 != 时间序：{[f.name for f in files]}"
    for f in files:
        assert f.stat().st_size > 0


# ================================================================ TASK-SET-05 备份可见化与恢复

def test_manual_backup_list_and_restore_round_trip(app):
    """手动快照可见；恢复后磁盘回到快照点，并保全恢复前数据库。"""
    a = app
    before = a.api_ok("prompt.create", {"title": "恢复点内", "content": "before restore"})

    created = a.api_ok("system.backupNow")
    backup_path = Path(created["path"])
    assert backup_path.is_file() and backup_path.stat().st_size > 0

    listed = a.api_ok("system.listBackups")
    manual = next(row for row in listed if row["path"] == str(backup_path))
    assert manual["file"] == backup_path.name
    assert manual["kind"] == "manual"
    assert manual["size"] == backup_path.stat().st_size
    assert manual["createdAt"] > 0

    after = a.api_ok("prompt.create", {"title": "恢复点外", "content": "after restore"})
    assert a.db_query("SELECT id FROM prompts WHERE id = ?", (after["id"],))

    restored = a.api_ok("system.restoreBackup", {"file": manual["file"]})
    assert restored["ok"] is True and restored["needsRestart"] is True
    safety = Path(restored["safetyBackupPath"])
    assert safety.is_file() and "pre-restore" in safety.name

    assert a.db_query("SELECT id FROM prompts WHERE id = ?", (before["id"],))
    assert not a.db_query("SELECT id FROM prompts WHERE id = ?", (after["id"],)), "恢复点后的数据仍在"


def test_backup_list_includes_migration_style_auto_backup(app):
    """升级前的 db-*.db 也要出现在列表，不能只显示 import 备份。"""
    created = Path(app.api_ok("system.backupNow")["path"])
    auto = created.parent / "db-2026-08-04T10-20-30-000Z.db"
    auto.write_bytes(created.read_bytes())

    listed = app.api_ok("system.listBackups")
    row = next(item for item in listed if item["file"] == auto.name)
    assert row["kind"] == "auto"
    assert Path(row["path"]).resolve() == auto.resolve()


def test_restore_rejects_traversal_and_corrupt_database(app):
    """恢复入口既不能越过 backups/，也不能把任意 .db 内容覆盖主库。"""
    traversal = app.api("system.restoreBackup", {"file": "../data.db"})
    assert not traversal["ok"]
    assert "FORBIDDEN" in traversal["error"]

    backups = app.user_data_dir / BACKUPS_DIR_NAME
    backups.mkdir(parents=True, exist_ok=True)
    corrupt = backups / "corrupted.db"
    corrupt.write_bytes(b"not a sqlite database")
    invalid = app.api("system.restoreBackup", {"file": corrupt.name})
    assert not invalid["ok"]
    assert "INVALID_BACKUP" in invalid["error"]

    # 两次拒绝都不能伤到当前连接或主库。
    marker = app.api_ok("prompt.create", {"title": "主库仍可写", "content": "safe"})
    assert app.db_query("SELECT id FROM prompts WHERE id = ?", (marker["id"],))


# ================================================================ TASK-SET-09 危险区

def test_reset_data_is_transactional_backed_up_and_preserves_secrets_and_files(app):
    """清空业务表/FTS，但不碰 Provider、safeStorage 密钥和磁盘文件。"""
    a = app
    provider = a.api_ok(
        "provider.create",
        {
            "name": "清空保留服务商",
            "type": "openai-compatible",
            "baseUrl": "http://127.0.0.1:9/v1",
            "model": "gpt-image-1",
            "isActive": True,
        },
    )
    a.api_ok("provider.saveKey", provider["id"], "sk-reset-preserve-secret-7788")

    previews = a.user_data_dir / PREVIEWS_DIR_NAME
    previews.mkdir(parents=True, exist_ok=True)
    image = previews / "reset-must-not-delete.png"
    image.write_bytes(PNG_1PX)
    marker = a.api_ok(
        "prompt.create",
        {
            "title": "清空前必须进备份",
            "content": "reset backup marker",
            "previewImagePath": str(image),
        },
    )
    history = a.api_ok(
        "image.generate",
        {
            "jobId": "reset-history-marker",
            "providerId": "missing-provider-for-fast-failure",
            "prompt": "reset history",
            "size": "1024x1024",
            "quality": "medium",
            "n": 1,
        },
    )
    assert history["status"] == "failed"

    rejected = a.api("system.resetData", {"confirm": "WRONG"})
    assert not rejected["ok"] and "CONFIRMATION_REQUIRED" in rejected["error"]
    assert a.db_query("SELECT id FROM prompts WHERE id = ?", (marker["id"],))

    result = a.api_ok("system.resetData", {"confirm": "RESET"})
    backup = Path(result["backupPath"])
    assert result["ok"] is True
    assert backup.is_file() and "pre-reset" in backup.name

    for table in ("prompt_tags", "search_history", "smart_sets", "history_prompt_references", "history", "prompts", "tags", "folders", "prompts_fts"):
        count = a.db_query(f"SELECT COUNT(*) AS n FROM {table}")[0]["n"]
        assert count == 0, f"{table} 未清空：{count}"

    providers = a.api_ok("provider.list")
    assert any(row["id"] == provider["id"] for row in providers)
    key_state = a.api_ok("provider.hasKey", provider["id"])
    assert key_state == {"hasKey": True, "suffix": "7788"}
    assert image.is_file() and image.read_bytes() == PNG_1PX

    con = sqlite3.connect(f"file:{backup}?mode=ro", uri=True)
    try:
        assert con.execute("SELECT COUNT(*) FROM prompts WHERE id = ?", (marker["id"],)).fetchone()[0] == 1
        assert con.execute("PRAGMA quick_check").fetchone()[0] == "ok"
    finally:
        con.close()


# ================================================================ UI 冒烟

def test_export_dialog_opens_and_previews(app):
    """设置 → 数据 → 导出：对话框可开，且预览行有真实数字。"""
    a = app
    open_data_section(a)
    page = a.page
    page.get_by_test_id("open-export").click()
    dlg = page.get_by_test_id("export-dialog")
    dlg.wait_for(state="visible", timeout=5000)

    summary = page.get_by_test_id("export-summary")
    summary.wait_for(state="visible", timeout=5000)
    page.wait_for_function(
        "() => /\\d/.test(document.querySelector('[data-testid=export-summary]')?.textContent ?? '')",
        timeout=5000,
    )
    text = summary.inner_text()
    assert any(ch.isdigit() for ch in text), f"预览没数字：{text!r}"

    # 切到带图模式，预览应重算而不崩
    page.get_by_test_id("export-mode-db-with-images").click()
    page.wait_for_timeout(400)
    assert page.get_by_test_id("export-confirm").is_enabled()
    assert not a.console_errors(), a.console_errors()


def test_backup_ui_empty_create_and_restore_confirmation(app):
    """设置页呈现空态，手动备份即时入列，恢复必须经过应用内确认。"""
    a = app
    open_data_section(a)
    page = a.page

    page.get_by_test_id("backup-empty").wait_for(state="visible", timeout=5000)
    page.get_by_test_id("backup-now").click()
    page.get_by_test_id("backup-row").first.wait_for(state="visible", timeout=5000)
    assert page.get_by_test_id("backup-row").count() == 1
    assert "手动" in page.get_by_test_id("backup-row").first.inner_text()

    page.get_by_test_id("backup-restore").first.click()
    dialog = page.get_by_test_id("backup-confirm-dialog")
    dialog.wait_for(state="visible", timeout=5000)
    text = dialog.inner_text()
    assert "覆盖当前数据库" in text
    assert "自动保存为安全备份" in text
    assert page.get_by_test_id("backup-confirm").is_visible()
    page.get_by_test_id("backup-confirm").click()
    page.get_by_test_id("backup-restored").wait_for(state="visible", timeout=5000)
    assert page.get_by_test_id("backup-restart").is_visible()
    assert not a.console_errors(), a.console_errors()


def test_reset_data_ui_requires_phrase_offers_export_and_clears_stores(app):
    """危险区为应用内双重确认；执行后数据库和渲染层状态同时归零。"""
    a = app
    a.api_ok("prompt.create", {"title": "UI 清空目标", "content": "reset from settings"})
    open_data_section(a)
    page = a.page

    page.get_by_test_id("reset-data-open").click()
    page.get_by_test_id("reset-data-dialog").wait_for(state="visible", timeout=5000)
    confirm = page.get_by_test_id("reset-data-confirm")
    assert confirm.is_disabled()
    page.get_by_test_id("reset-data-phrase").fill("不匹配")
    assert confirm.is_disabled()

    page.get_by_test_id("reset-data-export").click()
    page.get_by_test_id("export-dialog").wait_for(state="visible", timeout=5000)
    page.get_by_role("button", name="取消", exact=True).click()

    page.get_by_test_id("reset-data-open").click()
    page.get_by_test_id("reset-data-phrase").fill("清空数据")
    assert confirm.is_enabled()
    confirm.click()
    page.get_by_test_id("reset-data-done").wait_for(state="visible", timeout=5000)

    for table in ("prompts", "folders", "tags", "smart_sets", "search_history", "history_prompt_references", "history", "prompts_fts"):
        assert a.db_query(f"SELECT COUNT(*) AS n FROM {table}")[0]["n"] == 0
    snapshot = page.evaluate(
        """() => ({
          prompts: window.__musefold_test?.stores?.library?.getState?.().prompts.length,
          history: window.__musefold_test?.stores?.history?.getState?.().records.length,
          searchHistory: window.__musefold_test?.stores?.library?.getState?.().searchHistory.length,
          turns: window.__musefold_test?.stores?.workbench?.getState?.().turns.length,
        })"""
    )
    assert snapshot == {"prompts": 0, "history": 0, "searchHistory": 0, "turns": 0}
    assert not a.console_errors(), a.console_errors()


def test_appearance_motion_density_and_persistence(app):
    """SET-07：密度真实改变布局，动效三态尊重用户覆盖并持久化。"""
    a = app
    page = a.page
    open_appearance_section(a)

    row = page.get_by_test_id("appearance-theme-row")
    comfortable_height = row.bounding_box()["height"]
    page.get_by_role("radio", name="紧凑", exact=True).click()
    page.wait_for_function("() => document.documentElement.dataset.density === 'compact'")
    compact_height = row.bounding_box()["height"]
    assert compact_height < comfortable_height, (comfortable_height, compact_height)
    assert page.evaluate("() => localStorage.getItem('musefold:density')") == "compact"

    # system 模式受操作系统偏好约束。
    page.emulate_media(reduced_motion="reduce")
    page.get_by_role("radio", name="系统", exact=True).click()
    system_duration_ms = page.get_by_role("radio", name="系统", exact=True).evaluate(
        """(node) => {
          const raw = getComputedStyle(node).transitionDuration;
          const value = parseFloat(raw);
          return raw.endsWith('ms') ? value : value * 1000;
        }"""
    )
    assert system_duration_ms < 0.1, system_duration_ms

    # 显式“完整”优先于系统 reduce；显式“减少”则加根 class。
    page.get_by_role("radio", name="完整", exact=True).click()
    full_duration_ms = page.get_by_role("radio", name="完整", exact=True).evaluate(
        """(node) => {
          const raw = getComputedStyle(node).transitionDuration;
          const value = parseFloat(raw);
          return raw.endsWith('ms') ? value : value * 1000;
        }"""
    )
    assert full_duration_ms >= 100, full_duration_ms
    page.get_by_role("radio", name="减少", exact=True).click()
    page.wait_for_function("() => document.documentElement.classList.contains('reduce-motion')")
    assert page.evaluate("() => localStorage.getItem('musefold:reduced-motion')") == "on"

    page.reload(wait_until="domcontentloaded")
    page.wait_for_selector("#root > *", timeout=10000)
    page.wait_for_function(
        """() => document.documentElement.dataset.density === 'compact'
          && document.documentElement.dataset.motion === 'on'
          && document.documentElement.classList.contains('reduce-motion')"""
    )
    assert not a.console_errors(), a.console_errors()


def test_compact_density_updates_library_virtual_rows_without_overlap(app):
    """紧凑模式须真正作用到主列表，并同步虚拟行估算高度。"""
    a = app
    for index in range(12):
        a.api_ok(
            "prompt.create",
            {
                "title": f"密度测试 {index:02d}",
                "content": f"compact density prompt content {index} with enough text for two lines",
                "description": "用于检查虚拟列表布局",
            },
        )

    a.set_view("library")
    page = a.page
    page.get_by_test_id("prompt-row").first.wait_for(state="visible", timeout=5000)
    comfortable_height = page.get_by_test_id("prompt-row").first.bounding_box()["height"]

    page.evaluate("() => window.__musefold_test?.stores?.app?.getState?.().setDensity?.('compact')")
    page.wait_for_function("() => document.documentElement.dataset.density === 'compact'")
    page.wait_for_timeout(100)
    compact_height = page.get_by_test_id("prompt-row").first.bounding_box()["height"]
    assert compact_height < comfortable_height, (comfortable_height, compact_height)

    # 双列布局：同一行的两张卡 top 相同，重叠校验按「行」分组后逐行比较
    rows = page.get_by_test_id("prompt-row").evaluate_all(
        """(nodes) => {
          const groups = new Map();
          for (const node of nodes) {
            const r = node.getBoundingClientRect();
            const key = Math.round(r.top);
            const g = groups.get(key) ?? { top: r.top, bottom: r.bottom };
            g.top = Math.min(g.top, r.top);
            g.bottom = Math.max(g.bottom, r.bottom);
            groups.set(key, g);
          }
          return [...groups.values()].sort((a, b) => a.top - b.top);
        }"""
    )
    for previous, current in zip(rows, rows[1:]):
        assert current["top"] >= previous["bottom"] - 0.5, (previous, current)
    assert not a.console_errors(), a.console_errors()


def test_about_version_copy_feedback_and_licenses(app):
    """SET-10：版本来自主进程，复制动作可用，第三方声明可读。"""
    a = app
    page = a.page
    expected = a.api_ok("system.getVersion")
    open_about_section(a)

    version = page.get_by_test_id("about-version")
    text = version.inner_text()
    assert f"v{expected['app']}" in text
    assert f"DB schema {expected['db']}" in text

    page.evaluate(
        """() => {
          window.__musefold_about_copies = [];
          navigator.clipboard.writeText = async (value) => {
            window.__musefold_about_copies.push(value);
          };
        }"""
    )
    version.click()
    page.get_by_test_id("about-copy-feedback").click()
    copied = page.evaluate("() => window.__musefold_about_copies")
    assert copied[0] == f"Musefold {expected['app']} · DB {expected['db']}"
    assert f"Musefold {expected['app']} · DB {expected['db']}" in copied[1]
    assert "Platform" in copied[1] and "复现步骤" in copied[1]

    page.get_by_test_id("about-open-licenses").click()
    dialog = page.get_by_test_id("about-licenses-dialog")
    dialog.wait_for(state="visible", timeout=5000)
    dialog_text = dialog.inner_text()
    assert "Musefold 采用 MIT License" in dialog_text
    assert "better-sqlite3" in dialog_text
    assert "Apache-2.0" in dialog_text
    assert page.get_by_test_id("about-open-docs").is_visible()
    assert not a.console_errors(), a.console_errors()


def test_about_resource_id_is_whitelisted(app):
    """渲染进程只能请求固定随包资源，路径与任意 ID 都不能穿透主进程。"""
    rejected = app.api("system.openAboutResource", "../package.json")
    assert not rejected["ok"]
    assert "ABOUT_RESOURCE_FORBIDDEN" in rejected["error"]


def test_settings_data_section_has_no_console_error(app):
    a = app
    open_data_section(a)
    assert a.page.get_by_test_id("open-export").is_visible()
    assert a.page.get_by_test_id("open-import").is_visible()
    assert not a.console_errors(), a.console_errors()
