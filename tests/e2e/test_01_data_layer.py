"""
M1 · 数据层地基 —— FTS 修复 / seed 补齐 / 回收站契约。

对应任务卡：TASK-LIB-01（CRUD 闭环）、TASK-LIB-05（搜索+中文分词）、
TASK-LIB-12（回收站）、TASK-LIB-15（seed 文件夹）。

全部经真实 IPC（preload → 主进程 → better-sqlite3），并对磁盘 DB 做交叉校验。
"""
from __future__ import annotations

import pytest


# ---------- seed 与迁移 ----------

def test_db_version_advanced(app):
    assert app.api_ok("system.getVersion")["db"] >= 8


def test_smart_set_tables_created(app):
    tables = {
        row["name"]
        for row in app.db_query(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('smart_sets', 'search_history')"
        )
    }
    assert tables == {"smart_sets", "search_history"}


def test_seed_folders_created(app):
    folders = app.db_query("SELECT name FROM folders")
    names = {f["name"] for f in folders}
    assert len(folders) >= 4, folders
    assert "人物" in names and "场景" in names, names


def test_seed_prompts_created(app):
    """干净安装应有 2-3 条示例 prompt，且是普通可删除的 prompt（TASK-LIB-15）。"""
    prompts = app.api_ok("prompt.list")
    assert 2 <= len(prompts) <= 5, f"示例 prompt 数量异常：{len(prompts)}"
    for p in prompts:
        assert p["content"], f"{p['title']} 缺正文"
        assert p["source"] == "manual", "示例 prompt 应是普通可删除的 manual 来源"


def test_seed_prompts_idempotent_across_reload(app):
    """页面重载不应重新触发 seed（迁移只在 user_version 落后时跑一次）。"""
    before = app.db_query("SELECT COUNT(*) c FROM prompts")[0]["c"]
    app.page.reload()
    app.page.wait_for_selector("#root > *", timeout=30_000)
    app.page.wait_for_timeout(800)
    after = app.db_query("SELECT COUNT(*) c FROM prompts")[0]["c"]
    assert after == before, f"示例 prompt 数量变了：{before} → {after}"


def test_seed_tags_grouped(app):
    tags = app.db_query("SELECT tag_group FROM tags")
    groups = {t["tag_group"] for t in tags}
    assert {"风格", "场景", "模型", "主体", "画质"} <= groups, groups


# ---------- CRUD 闭环（TASK-LIB-01） ----------

def test_prompt_crud_roundtrip(app):
    p = app.api_ok("prompt.create", {
        "title": "赛博朋克城市夜景",
        "description": "霓虹雨夜街道",
        "content": "cyberpunk city at night, neon signs, rain",
        "modelId": "gpt-image-2",
    })
    pid = p["id"]
    assert p["title"] == "赛博朋克城市夜景"
    assert p["rating"] == 0 and p["isPinned"] is False

    upd = app.api_ok("prompt.update", pid, {"title": "赛博朋克城市（改）", "rating": 4})
    assert upd["title"] == "赛博朋克城市（改）" and upd["rating"] == 4

    pinned = app.api_ok("prompt.togglePin", pid, True)
    assert pinned["isPinned"] is True

    app.api_ok("prompt.incrementUsage", pid)
    assert app.api_ok("prompt.get", pid)["usageCount"] == 1

    app.api_ok("prompt.delete", pid)
    assert all(x["id"] != pid for x in app.api_ok("prompt.list"))
    # 软删除：主表仍在，deleted_at 已置
    rows = app.db_query("SELECT deleted_at FROM prompts WHERE id = ?", (pid,))
    assert rows and rows[0]["deleted_at"] is not None


def test_prompt_create_with_tags_and_folder(app):
    folder = app.db_query("SELECT id FROM folders LIMIT 1")[0]
    tags = app.db_query("SELECT id FROM tags LIMIT 2")
    p = app.api_ok("prompt.create", {
        "title": "带标签与文件夹",
        "content": "a portrait of a woman",
        "folderId": folder["id"],
        "tagIds": [t["id"] for t in tags],
    })
    assert p["folderId"] == folder["id"]
    assert {t["id"] for t in p["tags"]} == {t["id"] for t in tags}
    # 按文件夹过滤命中
    listed = app.api_ok("prompt.list", {"folderId": folder["id"]})
    assert any(x["id"] == p["id"] for x in listed)


# ---------- FTS 搜索（TASK-LIB-05） ----------

@pytest.fixture()
def seeded(app):
    """写入一组中英文提示词供搜索测试。"""
    items = [
        ("赛博朋克城市夜景", "cyberpunk city at night, neon lights, rain reflections"),
        ("水彩风景画", "watercolor landscape, soft pastel colors, morning mist"),
        ("写实人物肖像", "photorealistic portrait of an old fisherman, 85mm lens"),
        ("三维渲染机械臂", "3d render of a robotic arm, studio lighting, octane"),
    ]
    created = [
        app.api_ok("prompt.create", {"title": t, "content": c}) for t, c in items
    ]
    return app, created


def test_search_chinese_word(seeded):
    app, _ = seeded
    hits = app.api_ok("prompt.list", {"search": "赛博朋克"})
    assert any("赛博朋克" in h["title"] for h in hits), [h["title"] for h in hits]


def test_search_chinese_partial_word(seeded):
    """汉字序列分词后「城市」应能命中「赛博朋克城市夜景」——unicode61 单独做不到。"""
    app, _ = seeded
    hits = app.api_ok("prompt.list", {"search": "城市"})
    assert any("城市" in h["title"] for h in hits), [h["title"] for h in hits]


def test_search_english(seeded):
    app, _ = seeded
    hits = app.api_ok("prompt.list", {"search": "watercolor"})
    assert any("水彩" in h["title"] for h in hits), [h["title"] for h in hits]


def test_search_with_punctuation_does_not_crash(seeded):
    """FTS5 MATCH 是查询语言：逗号/连字符/引号/AND 必须被安全转义。"""
    app, _ = seeded
    for q in ["a cat, cinematic", "neon-lights", 'say "hi"', "AND OR NOT", "((", "*", "-", "a:b"]:
        r = app.api("prompt.list", {"search": q})
        assert r["ok"], f"查询 {q!r} 崩溃：{r.get('error')}"


def test_search_reflects_update(seeded):
    app, created = seeded
    pid = created[1]["id"]  # 水彩风景画
    app.api_ok("prompt.update", pid, {"title": "油画静物", "content": "oil painting still life"})
    assert any(h["id"] == pid for h in app.api_ok("prompt.list", {"search": "油画"}))
    assert all(h["id"] != pid for h in app.api_ok("prompt.list", {"search": "水彩"}))


def test_search_excludes_deleted(seeded):
    app, created = seeded
    pid = created[0]["id"]
    app.api_ok("prompt.delete", pid)
    assert all(h["id"] != pid for h in app.api_ok("prompt.list", {"search": "赛博朋克"}))


def test_search_matches_tag_names(app):
    tag = next(t for t in app.db_query("SELECT id, name FROM tags") if t["name"] == "赛博朋克")
    p = app.api_ok("prompt.create", {
        "title": "无关标题", "content": "unrelated content", "tagIds": [tag["id"]],
    })
    hits = app.api_ok("prompt.list", {"search": "赛博朋克"})
    assert any(h["id"] == p["id"] for h in hits), "标签词未进 tags_index"


# ---------- 回收站（TASK-LIB-12） ----------

def test_trash_list_restore_purge(app):
    p = app.api_ok("prompt.create", {"title": "待删除", "content": "to be deleted"})
    pid = p["id"]
    app.api_ok("prompt.delete", pid)

    trash = app.api_ok("prompt.listDeleted")
    assert any(x["id"] == pid for x in trash), trash

    restored = app.api_ok("prompt.restore", pid)
    assert restored["deletedAt"] is None
    assert any(x["id"] == pid for x in app.api_ok("prompt.list"))
    # 恢复后可被搜索命中（FTS 行仍在）
    assert any(h["id"] == pid for h in app.api_ok("prompt.list", {"search": "待删除"}))

    app.api_ok("prompt.delete", pid)
    app.api_ok("prompt.purge", pid)
    assert not app.db_query("SELECT 1 FROM prompts WHERE id = ?", (pid,))
    # FTS 行也应清掉，避免 rowid 复用后搜到幽灵记录
    assert not app.api_ok("prompt.listDeleted")


def test_trash_purge_all(app):
    for i in range(3):
        p = app.api_ok("prompt.create", {"title": f"临时{i}", "content": f"tmp {i}"})
        app.api_ok("prompt.delete", p["id"])
    assert len(app.api_ok("prompt.listDeleted")) == 3
    assert app.api_ok("prompt.purgeAll")["purged"] == 3
    assert app.api_ok("prompt.listDeleted") == []


def test_fts_no_ghost_after_purge(app):
    """硬删除后 rowid 可能被复用；若旧 FTS 行残留会搜出错行。"""
    a = app.api_ok("prompt.create", {"title": "幽灵候选", "content": "ghost candidate alpha"})
    app.api_ok("prompt.delete", a["id"])
    app.api_ok("prompt.purge", a["id"])
    b = app.api_ok("prompt.create", {"title": "新条目", "content": "brand new entry"})
    hits = app.api_ok("prompt.list", {"search": "幽灵"})
    assert all(h["id"] != b["id"] for h in hits), "复用 rowid 命中了已清除的旧索引"
    assert not hits, hits
