"""Musefold 2.0 desktop overlay geometry and keyboard contracts."""

from __future__ import annotations

from test_07_onboarding import force_show


DESKTOP_VIEWPORT = {"width": 1440, "height": 900}


def computed(app, selector: str, property_name: str) -> str:
    return app.page.locator(selector).evaluate(
        "(node, propertyName) => getComputedStyle(node)[propertyName]",
        property_name,
    )


def set_theme(app, theme: str) -> None:
    app.page.evaluate(
        "(value) => window.__musefold_test.stores.app.getState().setThemeSource(value)",
        theme,
    )
    app.page.wait_for_function(
        "(value) => document.documentElement.dataset.theme === value",
        arg=theme,
    )


def assert_centered(box: dict, viewport: dict, tolerance: float = 1.0) -> None:
    assert abs((box["x"] + box["width"] / 2) - viewport["width"] / 2) <= tolerance
    assert abs((box["y"] + box["height"] / 2) - viewport["height"] / 2) <= tolerance


def test_onboarding_theater_matches_desktop_v2_contract(app, tmp_path):
    app.page.set_viewport_size(DESKTOP_VIEWPORT)
    set_theme(app, "dark")
    force_show(app)

    surface = app.page.get_by_test_id("onboarding-surface")
    surface_box = surface.bounding_box()
    artwork_box = app.page.locator(".mf-onboarding-welcome-image").bounding_box()
    assert surface_box and artwork_box
    assert surface_box["width"] == 1080
    assert surface_box["height"] == 720
    assert_centered(surface_box, DESKTOP_VIEWPORT)
    assert abs(artwork_box["width"] - artwork_box["height"]) <= 1
    assert computed(app, '[data-testid="onboarding-surface"]', "borderRadius") == "20px"
    assert computed(app, '[data-testid="onboarding-surface"]', "backgroundColor") == "rgb(37, 39, 42)"
    assert computed(app, '[data-testid="onboarding-scrim"]', "backgroundColor") == "rgba(0, 0, 0, 0.68)"
    assert computed(app, '[data-testid="onboarding-start"]', "borderRadius") == "8px"
    app.page.wait_for_timeout(500)
    active = app.page.evaluate(
        """() => ({
          tag: document.activeElement?.tagName,
          testId: document.activeElement?.getAttribute('data-testid'),
          label: document.activeElement?.getAttribute('aria-label'),
          inside: document.querySelector('[data-testid=onboarding-surface]')?.contains(document.activeElement),
        })"""
    )
    assert active["inside"] is True, active
    app.page.screenshot(path=str(tmp_path / "onboarding-welcome-dark.png"))

    set_theme(app, "light")
    assert computed(app, '[data-testid="onboarding-surface"]', "backgroundColor") == "rgb(255, 255, 255)"
    assert computed(app, '[data-testid="onboarding-scrim"]', "backgroundColor") == "rgba(20, 20, 24, 0.32)"
    app.page.screenshot(path=str(tmp_path / "onboarding-welcome-light.png"))

    app.page.click('[data-testid="onboarding-start"]')
    app.page.wait_for_selector('[data-testid="onboarding-step-2"]')
    app.page.wait_for_function(
        "() => document.activeElement?.hasAttribute('data-onboarding-step-heading')"
    )
    app.page.evaluate(
        "() => window.__musefold_test.stores.onboarding.setState({ track: null })"
    )
    app.page.wait_for_selector('[data-testid="onboarding-track-account"]')
    app.page.click('[data-testid="onboarding-track-account"]')
    app.page.wait_for_selector('[data-testid="onboarding-account-auth"]')
    assert computed(app, '[data-testid="onboarding-account-username"]', "borderRadius") == "8px"
    assert computed(app, '[data-testid="onboarding-account-submit"]', "borderRadius") == "8px"
    auth_box = app.page.get_by_test_id("onboarding-account-auth").bounding_box()
    assert auth_box
    assert auth_box["x"] >= surface_box["x"]
    assert auth_box["x"] + auth_box["width"] <= surface_box["x"] + surface_box["width"]
    app.page.screenshot(path=str(tmp_path / "onboarding-account-light.png"))


def test_command_palette_matches_desktop_v2_keyboard_contract(app, tmp_path):
    app.page.set_viewport_size(DESKTOP_VIEWPORT)
    set_theme(app, "dark")
    app.page.evaluate(
        "() => window.__musefold_test.stores.app.getState().setCommandOpen(true)"
    )
    palette = app.page.get_by_test_id("command-palette")
    palette.wait_for()
    app.page.wait_for_timeout(240)

    box = palette.bounding_box()
    assert box
    assert box["width"] == 560
    assert abs((box["x"] + box["width"] / 2) - DESKTOP_VIEWPORT["width"] / 2) <= 1
    assert computed(app, '[data-testid="command-palette"]', "borderRadius") == "16px"
    assert computed(app, '.mf-command-overlay', "backgroundColor") == "rgba(0, 0, 0, 0.58)"
    assert computed(app, '[data-testid="command-palette"]', "backgroundColor") == "rgb(37, 39, 42)"

    search = app.page.get_by_role("combobox", name="搜索 Musefold")
    assert search.evaluate("node => node === document.activeElement")
    assert search.get_attribute("aria-controls") == "mf-command-results"
    first_id = search.get_attribute("aria-activedescendant")
    app.page.keyboard.press("ArrowDown")
    second_id = search.get_attribute("aria-activedescendant")
    assert first_id and second_id and first_id != second_id
    assert app.page.locator(f"#{second_id}").get_attribute("aria-selected") == "true"
    app.page.screenshot(path=str(tmp_path / "command-palette-dark.png"))

    app.page.keyboard.press("Escape")
    app.page.wait_for_function(
        "() => document.querySelector('[data-testid=command-palette]') === null"
    )
