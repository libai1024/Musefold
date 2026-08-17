"""临时验证：后台生成期间，新对话的 Composer 保持可用（+ 可点、可加图）。"""


def _begin_scheme_run(app):
    return app.page.evaluate(
        """() => {
            const wb = window.__musefold_test.stores.workbench.getState();
            const begin = wb.beginSchemeRunTurn({
                userPrompt: '试运行',
                executionId: 'debug-bg',
                providerId: 'p1',
                params: { ...wb.params, n: 1 },
                referenceImages: [],
                source: {
                    kind: 'scheme', schemeId: 's1', revisionId: 'r1', label: '小黑插画',
                    summary: '', mode: 'trial', fidelity: 'faithful', sourceLabel: 'x',
                    inputs: [], coverAssetId: null, hasSuccessfulTrial: false,
                },
            });
            return { turnId: begin && begin.turnId, sessionId: wb.sessionId };
        }"""
    )


def test_new_conversation_composer_usable_during_generation(app):
    app.set_view("generate")
    begin = _begin_scheme_run(app)
    assert begin["turnId"], begin
    run_session_id = app.page.evaluate(
        "() => window.__musefold_test.stores.workbench.getState().sessionId"
    )

    # 运行中的对话：+ 禁用，显示停止按钮。
    picker = app.page.locator('[data-testid="workbench-image-picker"]')
    assert picker.is_disabled(), "运行中的对话应禁用 +"
    assert app.page.locator('[data-testid="refine-cancel"]').count() == 1

    # 新开对话：+ 可点，能打开添加菜单；本对话无运行，提交不受影响。
    app.page.evaluate("() => window.__musefold_test.stores.app.getState().newConversation()")
    # newConversation 经动态 import 重置会话，负载下 120ms 不稳，等 sessionId 真正切换。
    app.page.wait_for_function(
        "(sid) => window.__musefold_test.stores.workbench.getState().sessionId !== sid",
        arg=run_session_id,
    )
    assert app.page.evaluate(
        "() => window.__musefold_test.stores.workbench.getState().isGenerating"
    ) is True
    app.page.wait_for_selector('[data-testid="workbench-image-picker"]:not([disabled])')
    assert not picker.is_disabled(), "新对话的 + 不应被后台生成禁用"
    picker.click()
    app.page.wait_for_selector('[data-testid="workbench-context-menu"]')
    assert app.page.locator('[data-testid="workbench-context-add-image"]').count() == 1
    app.page.keyboard.press("Escape")
    # 新对话不显示停止按钮，显示（禁用的）发送按钮。
    assert app.page.locator('[data-testid="refine-cancel"]').count() == 0
    assert app.page.locator('[data-testid="refine-generate"]').count() == 1

    # 切回运行中的对话：恢复运行态（+ 禁用、停止按钮回来）。
    app.page.evaluate(
        "(sid) => window.__musefold_test.stores.workbench.getState().openSession(sid)",
        run_session_id,
    )
    app.page.wait_for_selector('[data-testid="refine-cancel"]')
    assert picker.is_disabled()

    # 引用方案的运行轮：用户消息上方出现方案引用卡片（对齐引用提示词的表达）。
    card = app.page.locator('[data-testid="generation-scheme-run-reference"]')
    card.wait_for()
    assert "小黑插画" in card.inner_text()
    assert "试运行" in card.inner_text()


def test_parallel_submit_enabled_in_other_conversation(app):
    """A 对话方案运行中，B 对话的发送按钮不再被全局锁禁用（并行生图）。"""
    app.set_view("generate")
    # 配一个有密钥的服务商（只为满足提交门槛，不实际点击生成）。
    provider = app.api_ok("provider.create", {
        "name": "并行测试服务商",
        "type": "openai-compatible",
        "baseUrl": "http://127.0.0.1:9",
        "model": "gpt-image-2",
        "isActive": True,
    })
    app.api_ok("provider.saveKey", provider["id"], "sk-parallel-test-1234")
    app.api_ok("provider.setActive", provider["id"])
    app.page.evaluate("async () => window.__musefold_test.stores.generation.getState().loadProviders()")
    app.page.wait_for_timeout(200)

    begin = _begin_scheme_run(app)
    assert begin["turnId"], begin
    run_session_id = app.page.evaluate(
        "() => window.__musefold_test.stores.workbench.getState().sessionId"
    )
    # A 对话运行中：发送按钮被停止按钮取代。
    assert app.page.locator('[data-testid="refine-cancel"]').count() == 1

    # B 对话：输入提示词后发送按钮可用（不被 A 的运行阻塞）。
    app.page.evaluate("() => window.__musefold_test.stores.app.getState().newConversation()")
    app.page.wait_for_function(
        "(sid) => window.__musefold_test.stores.workbench.getState().sessionId !== sid",
        arg=run_session_id,
    )
    app.page.fill('[data-testid="refine-prompt"]', "并行生成一张海报")
    submit = app.page.locator('[data-testid="refine-generate"]')
    submit.wait_for()
    app.page.wait_for_selector('[data-testid="refine-generate"]:not([disabled])')
    assert not submit.is_disabled(), "B 对话的发送不应被 A 的运行禁用"
