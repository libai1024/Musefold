"""
tests/e2e/test_02_library.py — 提示词库验收（v0.3.2 重塑版）。

页面契约：
  列表模式   960px 居中紧凑列表：置顶/全部分区、行尾「使用」、搜索 + 新建 + 溢出菜单
  详情模式   880px 轻量详情页（返回 > 头部 + 菜单/主动作 > 正文 > 相关作品 > 详情）
  编辑器     标题 + 正文必填，负面提示词折叠可选；脏检查二次确认
  已退役 UI  文件夹树 / 标签云 / 评分 / 智能集 / 批量操作（数据表与导入导出保留；
             folder/tag/smartSet IPC 已收缩，夹具改走 SQL 直写）

原则：断言落在**数据库真相**（app.db_query）与**可见 UI**（testid）两侧，
不信任「点了就等于成功」。
"""
from __future__ import annotations

import sqlite3
import time


# ---------------------------------------------------------------- helpers

def goto_library(app):
    app.set_view("library")
    app.page.wait_for_selector('[data-testid="library-search"]', timeout=15_000)
    app.page.wait_for_timeout(300)


def test_library_shell_owns_the_only_page_title(app):
    """2.0 桌面壳层提供页面身份，内容区使用两行控制区。"""
    goto_library(app)
    assert app.page.get_by_test_id("titlebar-title").inner_text() == "提示词库"
    assert app.page.get_by_test_id("library-page").locator("h1").count() == 0

    toolbar = app.page.locator(".mf-library-control-deck")
    tabs_box = app.page.locator(".mf-workspace-scope-tabs").bounding_box()
    search_box = app.page.get_by_test_id("library-search").bounding_box()
    create_box = app.page.get_by_test_id("library-new").bounding_box()
    secondary_box = app.page.locator(".mf-library-control-secondary").bounding_box()
    toolbar_box = toolbar.bounding_box()
    assert tabs_box and search_box and create_box and secondary_box and toolbar_box
    assert app.page.locator(".mf-library-section-summary").count() == 0
    assert abs(tabs_box["y"] - search_box["y"]) <= 2
    secondary_center = secondary_box["y"] + secondary_box["height"] / 2
    create_center = create_box["y"] + create_box["height"] / 2
    assert abs(secondary_center - create_center) <= 2
    assert create_box["y"] > search_box["y"] + search_box["height"]
    assert 340 <= search_box["width"] <= 400
    assert toolbar_box["y"] >= app.page.get_by_test_id("titlebar").bounding_box()["height"]


def test_single_prompt_group_uses_scope_count_without_a_duplicate_heading(app):
    mk(app, "唯一提示词")
    goto_library(app)

    total = len(app.api_ok("prompt.list"))
    assert app.page.get_by_test_id("library-filter-all").inner_text().split() == [
        "全部",
        str(total),
    ]
    assert app.page.locator(".mf-library-section-summary").count() == 0
    assert app.page.locator(".mf-section-heading").count() == 0


def mk(app, title: str, content: str = "a photo of a cat", **kw):
    """经真实 IPC 建一条，返回 Prompt 对象。"""
    payload = {"title": title, "content": content, **kw}
    return app.api_ok("prompt.create", payload)


def reload_list(app):
    """让 UI 重新拉一次（绕过防抖等待）。"""
    app.page.evaluate(
        "() => window.__musefold_test?.stores?.library?.getState?.()?.reloadPrompts?.()"
    )
    app.page.wait_for_timeout(500)


def row_titles(app) -> list[str]:
    return app.page.eval_on_selector_all(
        '[data-testid="prompt-row"] [data-testid="prompt-row-open"] > strong',
        "els => els.map(e => e.textContent.trim())",
    )


def open_detail(app, prompt_id: str):
    app.page.click(f'[data-prompt-id="{prompt_id}"] [data-testid="prompt-row-open"]')
    app.page.wait_for_selector(f'[data-testid="prompt-detail"][data-prompt-id="{prompt_id}"]')
    app.page.wait_for_timeout(200)


def test_prompt_detail_opens_as_a_non_overlaying_inspector(app):
    prompt = mk(app, "Inspector 布局", "保留列表上下文")
    goto_library(app)
    open_detail(app, prompt["id"])

    inspector = app.page.get_by_test_id("prompt-inspector").bounding_box()
    prompt_list = app.page.get_by_test_id("prompt-list").bounding_box()
    selected_row = app.page.locator(
        f'[data-testid="prompt-row"][data-prompt-id="{prompt["id"]}"]'
    )
    assert inspector and prompt_list
    assert prompt_list["x"] + prompt_list["width"] <= inspector["x"] + 1
    assert selected_row.get_attribute("data-highlighted") == "true"
    assert app.page.get_by_test_id("library-search").is_visible()

    app.page.set_viewport_size({"width": 960, "height": 760})
    app.page.wait_for_function(
        "() => getComputedStyle(document.querySelector('[data-testid=\"prompt-list\"]')).display === 'none'"
    )
    narrow_workspace = app.page.locator(".mf-library-workspace").bounding_box()
    narrow_inspector = app.page.get_by_test_id("prompt-inspector").bounding_box()
    assert narrow_workspace and narrow_inspector
    assert abs(narrow_workspace["width"] - narrow_inspector["width"]) <= 1

    app.page.get_by_test_id("detail-back").click()
    app.page.get_by_test_id("prompt-inspector").wait_for(state="detached")
    assert app.page.get_by_test_id("library-search").is_visible()


def open_detail_menu(app):
    app.page.click('[data-testid="detail-menu"]')
    app.page.wait_for_timeout(150)


def open_library_menu(app):
    app.page.click('[data-testid="library-menu"]')
    app.page.wait_for_timeout(150)


def _delete_all_prompts(app):
    for p in app.api_ok("prompt.list"):
        app.api_ok("prompt.delete", p["id"])


def _insert_related_history(app, prompt_id: str):
    image_a = app.user_data_dir / "library-work-a.png"
    image_b = app.user_data_dir / "library-work-b.png"
    image_c = app.user_data_dir / "library-work-c.png"
    png = bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
        "890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082"
    )
    image_a.write_bytes(png)
    image_b.write_bytes(png)
    image_c.write_bytes(png)
    now = int(time.time() * 1000)
    con = sqlite3.connect(app.db_path())
    try:
        con.execute("PRAGMA foreign_keys = ON")
        rows = [
            ("library-direct", prompt_id, "success", str(image_a), now + 2),
            ("library-reference", None, "success", str(image_b), now + 1),
            ("library-saved", prompt_id, "success", str(image_c), now + 3),
            ("library-failed", None, "failed", None, now),
        ]
        for history_id, source_prompt_id, status, image_path, created_at in rows:
            con.execute(
                """INSERT INTO history
                   (id, prompt_id, provider_id, model, prompt_text, status, image_path,
                    error_code, error_message, created_at)
                   VALUES (?, ?, 'e2e-provider', 'e2e-model', ?, ?, ?, ?, ?, ?)""",
                (
                    history_id,
                    source_prompt_id,
                    f"history prompt {history_id}",
                    status,
                    image_path,
                    "E2E_FAILED" if status == "failed" else None,
                    "simulated failure" if status == "failed" else None,
                    created_at,
                ),
            )
        con.execute(
            """INSERT INTO history_prompt_references
               (history_id, prompt_id, prompt_title, excerpt, scope, sort_order)
               VALUES ('library-reference', ?, '关联提示词', 'full snapshot', 'full', 0)""",
            (prompt_id,),
        )
        con.execute(
            "UPDATE prompts SET source_url = 'history://library-saved' WHERE id = ?",
            (prompt_id,),
        )
        con.execute(
            """INSERT INTO history_prompt_references
               (history_id, prompt_id, prompt_title, excerpt, scope, sort_order)
               VALUES ('library-failed', ?, '关联提示词', 'failed excerpt', 'excerpt', 0)""",
            (prompt_id,),
        )
        con.commit()
    finally:
        con.close()


# ---------------------------------------------------------------- 编辑器

def test_create_prompt_minimal_editor(app):
    """新建：标题+正文必填校验；负面提示词折叠展开后可填；保存落库。"""
    goto_library(app)
    app.page.click('[data-testid="library-new"]')
    app.page.wait_for_selector('[data-testid="editor-title"]')

    # 空表单时保存必须禁用
    assert app.page.is_disabled('[data-testid="editor-save"]'), "空表单应禁用保存"

    app.page.fill('[data-testid="editor-title"]', "赛博朋克街景")
    assert app.page.is_disabled('[data-testid="editor-save"]'), "缺正文应禁用保存"

    app.page.fill('[data-testid="editor-content"]', "cyberpunk street, neon rain, 85mm")

    # 负面提示词默认折叠，展开后才可填
    assert app.page.locator('[data-testid="editor-negative"]').count() == 0
    app.page.click('[data-testid="editor-negative-toggle"]')
    app.page.fill('[data-testid="editor-negative"]', "lowres, watermark")

    assert app.page.is_enabled('[data-testid="editor-save"]')
    app.page.click('[data-testid="editor-save"]')
    app.page.wait_for_timeout(600)

    rows = app.db_query(
        "SELECT title, content, content_negative FROM prompts WHERE title = ?",
        ("赛博朋克街景",),
    )
    assert len(rows) == 1, "应恰好落库一条"
    r = rows[0]
    assert r["content"] == "cyberpunk street, neon rain, 85mm"
    assert r["content_negative"] == "lowres, watermark"


def test_edit_dirty_check(app):
    """脏检查：改了内容点取消 → 出「放弃更改？」，不直接丢弃。"""
    p = mk(app, "待编辑")
    goto_library(app)
    reload_list(app)

    open_detail(app, p["id"])
    open_detail_menu(app)
    app.page.click('[data-testid="detail-edit"]')
    app.page.wait_for_selector('[data-testid="editor-title"]')
    app.page.fill('[data-testid="editor-title"]', "改过的标题")
    app.page.click("text=取消")
    app.page.wait_for_timeout(200)

    assert app.page.is_visible('[data-testid="editor-discard"]'), "有未保存改动应二次确认"
    app.page.click('[data-testid="editor-discard"]')
    app.page.wait_for_timeout(300)

    rows = app.db_query("SELECT title FROM prompts WHERE id = ?", (p["id"],))
    assert rows[0]["title"] == "待编辑", "放弃后不应落库"


def test_editor_edit_prefills_and_saves(app):
    """编辑：已有负面词时折叠区自动展开；保存后新值落库。"""
    p = mk(app, "编辑前", "old content", contentNegative="old negative")
    goto_library(app)
    reload_list(app)

    open_detail(app, p["id"])
    open_detail_menu(app)
    app.page.click('[data-testid="detail-edit"]')
    app.page.wait_for_selector('[data-testid="editor-negative"]', timeout=5_000)
    assert app.page.input_value('[data-testid="editor-negative"]') == "old negative"

    app.page.fill('[data-testid="editor-content"]', "new content body")
    app.page.click('[data-testid="editor-save"]')
    app.page.wait_for_timeout(600)

    rows = app.db_query("SELECT content, content_negative FROM prompts WHERE id = ?", (p["id"],))
    assert rows[0]["content"] == "new content body"
    assert rows[0]["content_negative"] == "old negative"


# ---------------------------------------------------------------- 列表 / 详情导航

def test_row_opens_detail_and_back(app):
    """行点击 → 详情页（标题/正文/元信息）；返回 → 列表。"""
    p = mk(app, "详情目标", "a very specific content string")
    goto_library(app)
    reload_list(app)

    open_detail(app, p["id"])
    assert app.page.text_content('[data-testid="detail-title"]').strip() == "详情目标"
    assert "a very specific content string" in app.page.text_content('[data-testid="detail-content"]')

    app.page.click('[data-testid="detail-back"]')
    app.page.wait_for_selector('[data-testid="library-search"]')
    assert app.page.locator('[data-testid="prompt-detail"]').count() == 0, "返回后详情应卸载"


def test_pin_section_via_detail_menu(app):
    """置顶：详情菜单置顶 → 列表出现「置顶」分区；取消后分区消失。"""
    p = mk(app, "会被收藏")
    mk(app, "普通条目")
    goto_library(app)
    reload_list(app)

    assert not app.page.is_visible('[data-testid="pinned-section"]'), "0 条置顶时应整段隐藏"

    open_detail(app, p["id"])
    open_detail_menu(app)
    app.page.click('[data-testid="detail-pin"]')
    app.page.wait_for_timeout(600)
    app.page.click('[data-testid="detail-back"]')
    app.page.wait_for_selector('[data-testid="pinned-section"]')

    rows = app.db_query("SELECT is_pinned FROM prompts WHERE id = ?", (p["id"],))
    assert rows[0]["is_pinned"] == 1

    pinned_ids = app.page.eval_on_selector_all(
        '[data-testid="pinned-section"] [data-testid="prompt-row"]',
        "els => els.map(e => e.dataset.promptId)",
    )
    assert pinned_ids == [p["id"]]

    open_detail(app, p["id"])
    open_detail_menu(app)
    app.page.click('[data-testid="detail-pin"]')
    app.page.wait_for_timeout(600)
    app.page.click('[data-testid="detail-back"]')
    app.page.wait_for_timeout(300)
    assert not app.page.is_visible('[data-testid="pinned-section"]')


def test_search_hits_and_no_match_state(app):
    """搜索：FTS 命中收敛列表；无命中出「没有找到」空态；清空恢复。"""
    mk(app, "夜景霓虹", "neon skyline at night")
    mk(app, "白日街拍", "daylight street snap")
    goto_library(app)
    reload_list(app)

    app.page.fill('[data-testid="library-search"]', "neon")
    app.page.wait_for_timeout(700)
    titles = row_titles(app)
    assert "夜景霓虹" in titles
    assert "白日街拍" not in titles

    # 注意：FTS 对中文做单字/双字宽召回，中文查询串会命中种子示例；
    # 无命中态用纯 ASCII 不存在词验证
    app.page.fill('[data-testid="library-search"]', "xyzzynomatchword")
    app.page.wait_for_timeout(700)
    app.page.wait_for_selector('[data-testid="empty-no-match"]')

    app.page.click('[data-testid="library-search-clear"]')
    app.page.wait_for_timeout(700)
    assert len(row_titles(app)) >= 2


# ---------------------------------------------------------------- 使用 / 复制

def test_row_use_prefills_workbench(app):
    """行尾「使用」→ 预填制作草稿并带来源，切到工作台。"""
    p = mk(app, "行内使用", "portrait of a sailor")
    goto_library(app)
    reload_list(app)

    app.page.click(f'[data-prompt-id="{p["id"]}"] [data-testid="prompt-row-use"]')
    app.page.wait_for_timeout(400)

    state = app.page.evaluate(
        "() => { const s = window.__musefold_test?.stores?.workbench?.getState?.(); "
        "return s ? { prompt: s.draftPrompt, source: s.draftSource } : null; }"
    )
    assert state is not None, "workbench store 不可达"
    assert state["prompt"] == "portrait of a sailor"
    assert state["source"]["kind"] == "prompt"
    assert state["source"]["id"] == p["id"]


def test_detail_use_and_source_unbind(app):
    """详情「使用」→ 工作台带来源 chip，解绑只断关联、不清空文本。"""
    p = mk(app, "送去生图", "portrait of an astronaut")
    # 没有 Provider 时精修面板整块换成「尚未配置服务商」引导，连带来源 chip 一起不渲染。
    app.api_ok("provider.create", {
        "name": "E2E 假站",
        "type": "openai-compatible",
        "baseUrl": "http://127.0.0.1:9/v1",
        "model": "gpt-image-2",
        "isActive": True,
    })
    app.page.evaluate(
        "async () => { await window.__musefold_test.stores.generation.getState().loadProviders(); }"
    )
    goto_library(app)
    reload_list(app)

    open_detail(app, p["id"])
    app.page.click('[data-testid="detail-generate"]')
    app.page.wait_for_timeout(600)

    state = app.page.evaluate(
        "() => { const s = window.__musefold_test?.stores?.workbench?.getState?.(); "
        "return s ? { prompt: s.draftPrompt, source: s.draftSource } : null; }"
    )
    view = app.page.evaluate("() => window.__musefold_test?.getView?.() ?? null")

    assert view == "generate", f"应切到生成工作区，实际 {view!r}"
    assert state["prompt"] == "portrait of an astronaut"
    assert state["source"]["kind"] == "prompt"
    assert state["source"]["id"] == p["id"]
    assert state["source"]["label"] == "送去生图"

    app.page.wait_for_selector('[data-testid="refine-source"]')
    app.page.click('[data-testid="refine-source-clear"]')
    app.page.wait_for_timeout(250)
    after = app.page.evaluate(
        "() => { const s = window.__musefold_test?.stores?.workbench?.getState?.(); "
        "return { prompt: s.draftPrompt, source: s.draftSource }; }"
    )
    assert after["source"]["kind"] == "manual", "解绑后来源应回到手动输入"
    assert after["prompt"] == "portrait of an astronaut", "解绑不应清掉已填正文"


def test_copy_increments_usage(app):
    """详情菜单「复制正文」→ usage_count++。"""
    p = mk(app, "复制计数")
    goto_library(app)
    reload_list(app)

    open_detail(app, p["id"])
    open_detail_menu(app)
    app.page.click('[data-testid="detail-copy"]')
    app.page.wait_for_timeout(600)

    rows = app.db_query("SELECT usage_count FROM prompts WHERE id = ?", (p["id"],))
    assert rows[0]["usage_count"] == 1


# ---------------------------------------------------------------- 相关作品

def test_detail_related_works_and_lightbox(app):
    """详情页相关作品：直接/引用/保存三种关联 + 全部记录切换 + Lightbox。"""
    prompt = mk(app, "关联提示词", "editorial portrait, soft daylight")
    _insert_related_history(app, prompt["id"])
    goto_library(app)
    reload_list(app)

    related = app.api_ok("history.related", {
        "promptId": prompt["id"],
        "status": "success",
        "limit": 10,
    })
    assert related["total"] == 3
    assert {item["id"] for item in related["items"]} == {
        "library-direct", "library-reference", "library-saved",
    }

    open_detail(app, prompt["id"])
    app.page.wait_for_selector('[data-testid="prompt-works-panel"]')
    app.page.wait_for_selector('[data-testid="prompt-works-grid"]')
    assert app.page.locator('[data-testid="prompt-work-image"]').count() == 3
    assert app.page.get_by_text("直接制作", exact=True).count() == 1
    assert app.page.get_by_text("引用整条", exact=True).count() == 1
    assert app.page.get_by_text("由作品保存", exact=True).count() == 1

    app.page.locator('[data-testid="prompt-work-image"]').first.click()
    app.page.wait_for_selector('[data-testid="image-lightbox"]')
    app.page.click('[data-testid="image-lightbox-close"]')
    app.page.wait_for_function("() => !document.querySelector('[data-testid=\"image-lightbox\"]')")

    app.page.click('[data-testid="prompt-works-all-toggle"]')
    app.page.wait_for_selector('[data-testid="prompt-works-status-list"]')
    assert "生成失败" in app.page.locator('[data-testid="prompt-works-status-list"]').inner_text()


# ---------------------------------------------------------------- 删除 / 回收站

def test_delete_from_detail_with_undo(app):
    """详情菜单删除 → 软删 + 回到列表 + 5s 内 toast 可撤销。"""
    p = mk(app, "撤销测试")
    goto_library(app)
    reload_list(app)

    open_detail(app, p["id"])
    open_detail_menu(app)
    app.page.click('[data-testid="detail-delete"]')
    app.page.wait_for_selector('[data-testid="library-search"]', timeout=5_000)

    rows = app.db_query("SELECT deleted_at FROM prompts WHERE id = ?", (p["id"],))
    assert rows[0]["deleted_at"] is not None, "应软删落库"

    app.page.wait_for_selector('[data-testid="toast-action"]', timeout=4_000)
    app.page.click('[data-testid="toast-action"]')
    app.page.wait_for_timeout(700)

    rows = app.db_query("SELECT deleted_at FROM prompts WHERE id = ?", (p["id"],))
    assert rows[0]["deleted_at"] is None, "撤销应恢复"


def test_trash_restore_and_purge(app):
    """回收站（溢出菜单进入）：恢复 / 彻底删除。"""
    a = mk(app, "回收站-恢复")
    b = mk(app, "回收站-彻底删")
    app.api_ok("prompt.delete", a["id"])
    app.api_ok("prompt.delete", b["id"])
    goto_library(app)

    open_library_menu(app)
    app.page.click('[data-testid="trash-open"]')
    app.page.wait_for_selector('[data-testid="trash-dialog"]')
    assert len(app.page.query_selector_all('[data-testid="trash-item"]')) == 2

    app.page.click(f'[data-prompt-id="{a["id"]}"] [data-testid="trash-restore"]')
    app.page.wait_for_timeout(600)
    assert app.db_query("SELECT deleted_at FROM prompts WHERE id = ?", (a["id"],))[0][
        "deleted_at"
    ] is None

    app.page.click(f'[data-prompt-id="{b["id"]}"] [data-testid="trash-purge"]')
    app.page.click('[data-testid="trash-purge-confirm"]')
    app.page.wait_for_timeout(600)
    assert app.db_query("SELECT id FROM prompts WHERE id = ?", (b["id"],)) == [], "彻底删除应删行"


def test_trash_purge_all_double_confirm(app):
    """清空回收站要过两道确认，且真的清空 FTS 一起走。"""
    for i in range(3):
        p = mk(app, f"清空-{i}")
        app.api_ok("prompt.delete", p["id"])
    goto_library(app)
    open_library_menu(app)
    app.page.click('[data-testid="trash-open"]')
    app.page.wait_for_selector('[data-testid="trash-dialog"]')

    app.page.click('[data-testid="trash-purge-all"]')
    app.page.wait_for_timeout(200)
    # 第一道确认后还不能真删
    assert app.db_query("SELECT COUNT(*) c FROM prompts WHERE deleted_at IS NOT NULL")[0]["c"] == 3

    app.page.click('[data-testid="trash-purge-all-step2"]')
    app.page.click('[data-testid="trash-purge-all-confirm"]')
    app.page.wait_for_timeout(900)

    assert app.db_query("SELECT COUNT(*) c FROM prompts WHERE deleted_at IS NOT NULL")[0]["c"] == 0
    orphans = app.db_query(
        "SELECT COUNT(*) c FROM prompts_fts f LEFT JOIN prompts p ON p.rowid = f.rowid"
        " WHERE p.id IS NULL"
    )
    assert orphans[0]["c"] == 0, "彻底删除必须同步清理 FTS"


# ---------------------------------------------------------------- 数据层回归（UI 退役、契约保留）

def test_search_filter_combo_ipc(app):
    """FTS 搜索 + 筛选组合在 IPC 层继续生效（组织 UI 退役、数据契约不变）。"""
    t = app.insert_tag("夜景", "场景")
    hit = mk(app, "夜景高分", "neon night city", rating=5, tagIds=[t["id"]])
    mk(app, "夜景低分", "neon night alley", rating=1, tagIds=[t["id"]])
    mk(app, "白天高分", "bright daylight", rating=5)

    res = app.api_ok("prompt.list", {"search": "neon", "filters": {"ratingGte": 5}})
    ids = [r["id"] for r in res]
    assert ids == [hit["id"]], f"搜索+评分筛选应只剩 1 条，实际 {[r['title'] for r in res]}"

    res2 = app.api_ok("prompt.list", {"tagIds": [t["id"]]})
    assert len(res2) == 2, "该标签下应有 2 条"


def test_sort_direction(app):
    """排序方向切换必须下推到 SQL（不是客户端 reverse）。"""
    mk(app, "AAA")
    mk(app, "ZZZ")
    desc = [
        p["title"]
        for p in app.api_ok("prompt.list", {"sort": "title", "sortDir": "desc"})
        if p["title"] in ("AAA", "ZZZ")
    ]
    asc = [
        p["title"]
        for p in app.api_ok("prompt.list", {"sort": "title", "sortDir": "asc"})
        if p["title"] in ("AAA", "ZZZ")
    ]
    # title 的 desc 语义 = A→Z（见 repositories/prompts.ts 注释）
    assert desc == ["AAA", "ZZZ"]
    assert asc == ["ZZZ", "AAA"]


def test_unfiled_filter_ipc(app):
    """「未归档」查询 → folder_id IS NULL（文件夹数据仍在，仅 UI 退役）。"""
    f = app.insert_folder("有家的")
    mk(app, "已归档", folderId=f["id"])
    mk(app, "没归档")

    res = app.api_ok("prompt.list", {"folderId": "__unfiled__"})
    titles = [p["title"] for p in res]
    assert "没归档" in titles
    assert "已归档" not in titles, "未归档筛选不应包含有文件夹的条目"


def test_prompt_list_filters_and_search_history_limit(app):
    """prompt.list 筛选契约 + 搜索历史去重/最近 10 条淘汰（智能集 IPC 已退役）。"""
    t = app.insert_tag("Flux集合", "模型")
    hit = mk(app, "Flux 高分霓虹", "neon city", modelId="flux-pro", rating=5, tagIds=[t["id"]])
    mk(app, "Flux 低分霓虹", "neon city", modelId="flux-pro", rating=2, tagIds=[t["id"]])

    query = {
        "search": "neon",
        "tagIds": [t["id"]],
        "filters": {"modelId": "flux-pro", "ratingGte": 5},
        "sort": "rating",
        "sortDir": "desc",
    }
    matched = app.api_ok("prompt.list", query)
    assert [p["id"] for p in matched] == [hit["id"]]

    for i in range(11):
        app.api_ok("searchHistory.add", f"term-{i}")
    app.api_ok("searchHistory.add", "term-5")
    history = app.api_ok("searchHistory.list", 20)
    terms = [item["term"] for item in history]
    assert len(terms) == 10
    assert terms[0] == "term-5"
    assert "term-0" not in terms


# ---------------------------------------------------------------- 空态 / 菜单入口

def test_empty_state_and_new(app):
    """删光所有 prompt 后回落到「还没有提示词」空态；空态新建打开编辑器。"""
    _delete_all_prompts(app)
    goto_library(app)
    reload_list(app)

    app.page.wait_for_selector('[data-testid="empty-no-prompts"]')
    app.page.click('[data-testid="empty-new"]')
    app.page.wait_for_selector('[data-testid="editor-title"]')


def test_menu_import_switches_to_settings_data(app):
    """溢出菜单「导入」应切到设置页的数据分区。"""
    goto_library(app)
    open_library_menu(app)
    app.page.click('[data-testid="library-import"]')
    app.page.wait_for_timeout(300)

    view = app.page.evaluate("() => window.__musefold_test?.getView?.() ?? null")
    section = app.page.evaluate(
        "() => window.__musefold_test?.stores?.settings?.getState?.()?.section ?? null"
    )
    assert view == "settings", f"应切到设置页，实际 {view!r}"
    assert section == "data", f"应落在数据分区，实际 {section!r}"


def test_highlight_intent_lands_in_list(app):
    """跨视图高亮意图（存为提示词 → 查看）：切回库页、选中并滚到该行。"""
    p = mk(app, "高亮目标", "highlight target body")
    app.set_view("generate")
    app.page.wait_for_timeout(300)

    app.page.evaluate(
        "(id) => window.__musefold_test.stores.app.getState().requestHighlightPrompt(id)",
        p["id"],
    )
    app.page.wait_for_selector(f'[data-testid="prompt-row"][data-prompt-id="{p["id"]}"]', timeout=8_000)
    assert app.page.evaluate(
        "(id) => window.__musefold_test.stores.library.getState().selectedPromptId === id",
        p["id"],
    )


# ---------------------------------------------------------------- 回归

def test_no_console_errors(app):
    """列表 → 详情 → 返回 → 搜索 → 菜单走一圈不应有 console error。"""
    p = mk(app, "冒烟")
    goto_library(app)
    reload_list(app)

    open_detail(app, p["id"])
    app.page.click('[data-testid="detail-back"]')
    app.page.wait_for_selector('[data-testid="library-search"]')
    app.page.fill('[data-testid="library-search"]', "冒烟")
    app.page.wait_for_timeout(500)
    app.page.click('[data-testid="library-search-clear"]')
    open_library_menu(app)
    app.page.keyboard.press("Escape")
    app.page.wait_for_timeout(300)

    errs = [e for e in app.console_errors() if "DevTools" not in e]
    assert errs == [], f"控制台报错：{errs}"
