"""Desktop-only visual contract for the Settings 2.0 workspace."""
from __future__ import annotations

import os
from pathlib import Path


def _visual_output_dir() -> Path | None:
    raw = os.environ.get("MUSEFOLD_VISUAL_OUTPUT_DIR")
    if not raw:
        return None
    target = Path(raw)
    target.mkdir(parents=True, exist_ok=True)
    return target


def _open_preferences(app, theme: str) -> None:
    app.page.set_viewport_size({"width": 1440, "height": 900})
    app.page.evaluate(
        """theme => {
          const appStore = window.__musefold_test.stores.app.getState();
          appStore.setThemeSource(theme);
          appStore.setDensity('comfortable');
          window.__musefold_test.stores.settings.getState().setSection('appearance');
          window.__musefold_test.setView('settings');
        }""",
        theme,
    )
    app.page.wait_for_selector('[data-testid="appearance-theme-row"]')
    app.page.wait_for_function(
        "theme => document.documentElement.dataset.theme === theme",
        arg=theme,
    )
    app.page.wait_for_timeout(120)


def _settings_geometry(app) -> dict:
    return app.page.evaluate(
        """() => {
          const workspace = document.querySelector('[data-testid="settings-workspace"]');
          const sidebar = workspace?.querySelector('.mf-settings-sidebar');
          const pane = workspace?.querySelector('.mf-settings-pane');
          const section = workspace?.querySelector('.mf-settings-section');
          const card = workspace?.querySelector('.mf-settings-card');
          const search = workspace?.querySelector(
            '[data-testid="settings-sidebar-search"] input'
          );
          const selected = workspace?.querySelector('.mf-settings-nav-item[data-active="true"]');
          const selectedIcon = selected?.querySelector('.mf-settings-nav-item-icon');
          const inactiveIcon = workspace?.querySelector(
            '.mf-settings-nav-item:not([data-active="true"]) .mf-settings-nav-item-icon'
          );
          const segmented = workspace?.querySelector('.mf-settings-segmented');
          if (!workspace || !sidebar || !pane || !section || !card || !search ||
              !selected || !selectedIcon || !inactiveIcon || !segmented) return null;

          const rect = element => element.getBoundingClientRect();
          const style = element => getComputedStyle(element);
          const workspaceRect = rect(workspace);
          const sidebarRect = rect(sidebar);
          const paneRect = rect(pane);
          return {
            viewportWidth: innerWidth,
            viewportHeight: innerHeight,
            documentWidth: document.documentElement.scrollWidth,
            workspace: {
              left: workspaceRect.left,
              right: workspaceRect.right,
              top: workspaceRect.top,
              bottom: workspaceRect.bottom,
            },
            sidebarWidth: sidebarRect.width,
            pane: {
              left: paneRect.left,
              right: paneRect.right,
              top: paneRect.top,
              bottom: paneRect.bottom,
              radius: style(pane).borderRadius,
              background: style(pane).backgroundColor,
              borderStyle: style(pane).borderStyle,
              shadow: style(pane).boxShadow,
            },
            gap: paneRect.left - sidebarRect.right,
            sectionWidth: rect(section).width,
            cardRadius: style(card).borderRadius,
            cardBorderStyle: style(card).borderStyle,
            cardShadow: style(card).boxShadow,
            searchRadius: style(search).borderRadius,
            selectedRadius: style(selected).borderRadius,
            selectedBackground: style(selected).backgroundColor,
            selectedIconColor: style(selectedIcon).color,
            inactiveIconColor: style(inactiveIcon).color,
            selectedCount: workspace.querySelectorAll(
              '.mf-settings-nav-item[data-active="true"]'
            ).length,
            segmentedRadius: style(segmented).borderRadius,
            titlebarCount: document.querySelectorAll('[data-testid="titlebar"]').length,
            emberMarkCount: document.querySelectorAll('[data-testid="ember-mark"]').length,
          };
        }"""
    )


def test_settings_v2_desktop_shell_and_themes(app):
    """Lock the inset MainView and tactile component treatment at desktop size."""
    output = _visual_output_dir()

    for theme in ("dark", "light"):
        _open_preferences(app, theme)
        geometry = _settings_geometry(app)
        assert geometry is not None
        assert geometry["documentWidth"] <= geometry["viewportWidth"] + 1, geometry
        assert abs(geometry["workspace"]["left"]) <= 1, geometry
        assert abs(geometry["workspace"]["right"] - 1440) <= 1, geometry
        assert abs(geometry["workspace"]["top"]) <= 1, geometry
        assert abs(geometry["workspace"]["bottom"] - 900) <= 1, geometry
        assert abs(geometry["sidebarWidth"] - 240) <= 1, geometry
        assert abs(geometry["gap"] - 4) <= 1, geometry
        assert abs(geometry["pane"]["top"] - 4) <= 1, geometry
        assert abs(geometry["pane"]["right"] - 1436) <= 1, geometry
        assert abs(geometry["pane"]["bottom"] - 896) <= 1, geometry
        assert geometry["pane"]["radius"] == "12px", geometry
        assert geometry["pane"]["borderStyle"] == "solid", geometry
        assert geometry["pane"]["shadow"] != "none", geometry
        assert geometry["sectionWidth"] <= 881, geometry
        assert geometry["cardRadius"] == "12px", geometry
        assert geometry["cardBorderStyle"] == "solid", geometry
        assert geometry["cardShadow"] != "none", geometry
        assert geometry["searchRadius"] == "8px", geometry
        assert geometry["selectedRadius"] == "8px", geometry
        assert geometry["selectedBackground"] != "rgba(0, 0, 0, 0)", geometry
        assert geometry["selectedIconColor"] != geometry["inactiveIconColor"], geometry
        assert geometry["selectedCount"] == 1, geometry
        assert geometry["segmentedRadius"] == "8px", geometry
        assert geometry["titlebarCount"] == 0, geometry
        assert geometry["emberMarkCount"] == 0, geometry

        if output:
            app.page.screenshot(
                path=str(output / f"settings-v2-{theme}-1440x900.png"),
                full_page=False,
            )


def test_settings_v2_desktop_search_can_be_cleared(app):
    """Keep search reversible without forcing users to erase text manually."""
    _open_preferences(app, "dark")
    search = app.page.locator('[data-testid="settings-sidebar-search"] input')
    item_count = app.page.locator('.mf-settings-nav-item').count()
    assert item_count > 1

    search.fill("额度")
    clear = app.page.get_by_role("button", name="清空设置搜索")
    clear.wait_for(state="visible")
    clear.click()

    assert search.input_value() == ""
    assert app.page.locator('.mf-settings-nav-item').count() == item_count
