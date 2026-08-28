"""临时:设置 v2 八分区逐页基线截图(供 UI review 用,不入 CI 断言)。

输出到 /tmp/musefold-settings-review/baseline/。
"""
from __future__ import annotations

from pathlib import Path

OUT = Path("/tmp/musefold-settings-review/after")


def _shot(app, name: str):
    OUT.mkdir(parents=True, exist_ok=True)
    app.page.wait_for_timeout(350)
    app.page.screenshot(path=str(OUT / f"{name}.png"))


def _set_visual(app, *, width=1440, height=900, theme="dark", density="comfortable"):
    app.page.set_viewport_size({"width": width, "height": height})
    app.page.evaluate(
        """([theme, density]) => {
          const store = window.__musefold_test.stores.app.getState();
          store.setThemeSource(theme);
          store.setDensity(density);
        }""",
        [theme, density],
    )
    app.page.wait_for_function(
        """([theme, density]) => document.documentElement.dataset.theme === theme
          && document.documentElement.dataset.density === density""",
        arg=[theme, density],
    )
    app.page.wait_for_timeout(150)


def _open_section(app, key: str):
    app.set_view("settings")
    app.page.evaluate(
        f"() => window.__musefold_test.stores.settings.getState().setSection('{key}')"
    )
    app.page.wait_for_timeout(500)


def test_settings_v2_page_baselines(app):
    provider = app.api_ok("provider.create", {
        "name": "视觉检查中转站",
        "type": "openai-compatible",
        "baseUrl": "http://127.0.0.1:9/v1",
        "model": "gpt-image-1",
    })
    connection = app.api_ok("aiConnection.create", {
        "name": "E2E Agent 连接",
        "routeKind": "gateway",
        "presetId": "custom",
        "baseUrl": "http://127.0.0.1:9/v1",
        "model": "deepseek-chat",
    })
    app.api_ok("provider.saveKey", provider["id"], "sk-visual-image")
    app.api_ok("aiConnection.saveKey", connection["id"], "sk-visual-agent")
    app.page.evaluate(
        "() => Promise.all(["
        "window.__musefold_test.stores.generation.getState().loadProviders(),"
        "window.__musefold_test.stores.aiConnections.getState().load()"
        "])"
    )
    # 进入 relay 模式:左下角身份区显示「自定义中转站」形态。
    app.page.evaluate(
        "(id) => window.__musefold_test.stores.generation.setState({ activeProviderId: id })",
        provider["id"],
    )

    _set_visual(app)
    _open_section(app, "account")
    _shot(app, "01-account-dark")
    _open_section(app, "providers")
    app.page.wait_for_selector('[data-testid="settings-provider-master-detail"]')
    _shot(app, "02a-relay-providers-dark")
    _open_section(app, "ai")
    app.page.wait_for_selector('[data-testid="settings-ai-list"]')
    _shot(app, "02b-relay-ai-dark")
    _open_section(app, "preferences")
    _shot(app, "03-preferences-dark")
    _open_section(app, "open")
    _shot(app, "04-open-dark")
    _open_section(app, "usage")
    _shot(app, "05-usage-dark")
    _open_section(app, "data")
    _shot(app, "06-data-dark")
    _open_section(app, "about")
    _shot(app, "07-about-dark")
    _open_section(app, "archived")
    _shot(app, "08-archived-dark")

    # 浅色抽样:导航壳 + 三张代表性页面。
    _set_visual(app, theme="light")
    _open_section(app, "account")
    _shot(app, "01-account-light")
    _open_section(app, "providers")
    app.page.wait_for_selector('[data-testid="settings-provider-master-detail"]')
    _shot(app, "02a-relay-providers-light")
    _open_section(app, "preferences")
    _shot(app, "03-preferences-light")
    _open_section(app, "usage")
    _shot(app, "05-usage-light")

    # 左下角身份切换器下拉(relay 模式,含生图中转站分组与管理入口)。
    _set_visual(app, theme="dark")
    app.set_view("generate")
    app.page.wait_for_timeout(400)
    app.page.click('[data-testid="provider-quick-switch"]')
    app.page.wait_for_selector('[data-testid="identity-switcher"]')
    _shot(app, "09-switcher-dropdown-dark")
    app.page.keyboard.press("Escape")
