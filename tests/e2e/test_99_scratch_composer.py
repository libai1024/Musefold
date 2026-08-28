"""临时复现:已有会话(历史对话)里 Composer 消失。"""
from __future__ import annotations

from test_08_generation_workbench import setup_provider, settle, workbench


def test_scratch_composer_visible_with_existing_session(app, fake_workbench_server):
    setup_provider(app, fake_workbench_server)
    app.page.fill('[data-workbench-testid="workbench-prompt"]', "复现探针")
    app.page.click('[data-workbench-testid="workbench-submit"]')
    settle(app)
    assert workbench(app, "s.turns.length") == 1

    composer = app.page.locator('[data-testid="workbench-composer"]')
    print("composer count after submit:", composer.count())
    if composer.count():
        print("composer box:", composer.bounding_box())
        print("composer visible:", composer.is_visible())

    # 模拟「历史对话」:从侧栏会话列表重新打开当前会话。
    app.page.locator(".mf-workbench-session-open").first.click()
    settle(app)
    composer2 = app.page.locator('[data-testid="workbench-composer"]')
    print("composer count after reopen:", composer2.count())
    if composer2.count():
        print("composer box after reopen:", composer2.bounding_box())
        print("composer visible after reopen:", composer2.is_visible())
    state = app.page.evaluate(
        "() => ({ turns: window.__musefold_test.stores.workbench.getState().turns.length })"
    )
    print("turns after reopen:", state)
