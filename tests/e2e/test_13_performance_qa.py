"""Large-library and bounded-query checks for v0.3.0."""
from __future__ import annotations

import time


def seed_prompts(app, count: int = 140) -> None:
    app.page.evaluate(
        """async (count) => {
          for (let index = 0; index < count; index += 1) {
            await window.api.prompt.create({
              title: `性能夹具 ${String(index).padStart(3, '0')}`,
              content: index === count - 1
                ? '性能专项检索词：四层系统架构图，中文标签清晰'
                : `性能测试提示词 ${index}，用于验证虚拟滚动和分页边界。`,
              description: 'v0.3.0 performance fixture',
            });
          }
          await window.__musefold_test.stores.library.getState().loadAll();
        }""",
        count,
    )


def test_large_prompt_library_keeps_ipc_and_dom_bounded(app):
    seed_prompts(app)
    app.set_view("library")
    app.page.wait_for_selector('[data-testid="prompt-list"]')
    app.page.wait_for_selector('[data-testid="prompt-row"]')

    state = app.page.evaluate(
        """async () => {
          const start = performance.now();
          const items = await window.api.prompt.list({});
          return {
            elapsedMs: performance.now() - start,
            fetched: items.length,
            storeCount: window.__musefold_test.stores.library.getState().prompts.length,
          };
        }"""
    )
    assert state["fetched"] <= 1000, state
    assert state["storeCount"] >= 140, state

    # 「全部」区虚拟化：140 条数据时挂载的行必须有界（双列 × 视口行数 + overscan）
    initial_nodes = app.page.locator('[data-testid="prompt-row"]').count()
    assert initial_nodes < 60, {"rendered": initial_nodes, "state": state}

    list_box = app.page.get_by_test_id("prompt-list").bounding_box()
    assert list_box, list_box
    app.page.get_by_test_id("prompt-list").evaluate("node => node.scrollTop = node.scrollHeight")
    app.page.wait_for_timeout(150)
    end_nodes = app.page.locator('[data-testid="prompt-row"]').count()
    assert end_nodes < 60, {"rendered": end_nodes, "state": state}
    metrics = app.page.evaluate(
        "() => ({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, scrollHeight: document.querySelector('[data-testid=\"prompt-list\"]')?.scrollHeight })",
    )
    assert metrics["documentWidth"] <= metrics["viewport"] + 1, metrics
    assert metrics["scrollHeight"] > list_box["height"], metrics

    search_start = time.monotonic()
    app.page.get_by_test_id("library-search").fill("四层系统架构图")
    app.page.wait_for_timeout(700)
    app.page.wait_for_function(
        "() => { const s = window.__musefold_test.stores.library.getState(); return s.search === '四层系统架构图' && s.loading === false && s.prompts.length < 143; }",
    )
    search_elapsed = (time.monotonic() - search_start) * 1000
    search_state = app.page.evaluate(
        "() => ({ count: window.__musefold_test.stores.library.getState().prompts.length, rendered: document.querySelectorAll('[data-testid=\"prompt-row\"]').length })",
    )
    assert search_state["count"] == 1, search_state
    assert search_state["rendered"] <= 4, search_state
    assert search_elapsed < 3000, {"elapsedMs": search_elapsed, "state": search_state}

    app.page.get_by_test_id("library-search").fill("")
    app.page.wait_for_timeout(350)
    app.page.wait_for_function(
        "() => { const s = window.__musefold_test.stores.library.getState(); return s.search === '' && s.loading === false && s.prompts.length >= 140; }",
    )
    cleared_nodes = app.page.locator('[data-testid="prompt-row"]').count()
    assert cleared_nodes < 60, {"rendered": cleared_nodes}
