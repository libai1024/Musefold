"""Musefold 2.0 desktop contract for the scheme attachment popover."""

from __future__ import annotations


DESKTOP_VIEWPORT = {"width": 1440, "height": 900}


SCHEME_SOURCE = {
    "kind": "scheme",
    "schemeId": "phase-c-scheme",
    "revisionId": "phase-c-scheme-revision",
    "label": "高级产品摄影",
    "summary": "冷白背景、硬朗轮廓与克制高光。",
    "mode": "trial",
    "fidelity": "verified",
    "sourceLabel": "本地方案",
    "inputs": [
        {
            "id": "subject",
            "label": "主体",
            "kind": "text",
            "required": True,
            "description": "这次要生成的主体",
        },
    ],
    "coverAssetId": None,
    "hasSuccessfulTrial": False,
}


def set_theme(app, theme: str) -> None:
    app.page.set_viewport_size(DESKTOP_VIEWPORT)
    app.page.evaluate(
        "value => window.__musefold_test.stores.app.getState().setThemeSource(value)",
        theme,
    )
    app.page.wait_for_function(
        "value => document.documentElement.dataset.theme === value",
        arg=theme,
    )


def surface_style(app) -> dict:
    return app.page.get_by_test_id("scheme-attachment-popover").evaluate(
        """node => {
          const style = getComputedStyle(node);
          return {
            backgroundColor: style.backgroundColor,
            borderRadius: style.borderRadius,
            boxShadow: style.boxShadow,
          };
        }"""
    )


def mount_scheme_source(app) -> None:
    app.set_view("generate")
    app.page.wait_for_selector('[data-testid="workbench-composer"]')
    app.page.evaluate(
        "source => window.__musefold_test.stores.workbench.setState({ draftSource: source })",
        SCHEME_SOURCE,
    )
    app.page.wait_for_selector('[data-testid="scheme-run-chip-body"]')


def test_scheme_attachment_popover_uses_shared_desktop_surface(app):
    mount_scheme_source(app)
    trigger = app.page.get_by_test_id("scheme-run-chip-body")
    assert trigger.get_attribute("aria-expanded") == "false"

    set_theme(app, "dark")
    trigger.click()
    popover = app.page.get_by_test_id("scheme-attachment-popover")
    popover.wait_for()
    dark = surface_style(app)
    assert dark["backgroundColor"] == "rgb(43, 45, 49)"
    assert dark["borderRadius"] == "8px"
    assert dark["boxShadow"] != "none"
    chip = app.page.get_by_test_id("scheme-run-chip").bounding_box()
    menu = popover.bounding_box()
    assert chip and menu, {"chip": chip, "menu": menu}
    assert menu["y"] + menu["height"] <= chip["y"] + 1, {"chip": chip, "menu": menu}

    app.page.keyboard.press("Escape")
    popover.wait_for(state="detached")
    assert trigger.evaluate("node => node === document.activeElement")

    set_theme(app, "light")
    trigger.click()
    popover.wait_for()
    assert surface_style(app)["backgroundColor"] == "rgb(253, 252, 249)"

    app.page.evaluate(
        "() => document.querySelector('[data-testid=workbench-composer]')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))"
    )
    popover.wait_for(state="detached")
    assert trigger.evaluate("node => node === document.activeElement")
