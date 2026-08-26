"""Desktop-only visual contract for the ZCode-inspired workspace control decks."""
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


def _set_theme_and_view(app, theme: str, view: str) -> None:
    app.page.set_viewport_size({"width": 1440, "height": 900})
    app.page.evaluate(
        """([theme, view]) => {
          const store = window.__musefold_test.stores.app.getState();
          store.setThemeSource(theme);
          store.setDensity('comfortable');
          window.__musefold_test.setView(view);
        }""",
        [theme, view],
    )
    app.page.wait_for_function(
        "theme => document.documentElement.dataset.theme === theme",
        arg=theme,
    )


def _geometry(app, prefix: str) -> dict:
    return app.page.evaluate(
        """prefix => {
          const deck = document.querySelector(`.mf-${prefix}-control-deck`);
          const primary = document.querySelector(`.mf-${prefix}-control-primary`);
          const secondary = document.querySelector(`.mf-${prefix}-control-secondary`);
          const tabs = primary?.querySelector('.mf-workspace-scope-tabs');
          const selected = tabs?.querySelector('[role="tab"][aria-selected="true"]');
          const search = primary?.querySelector(
            prefix === 'library' ? '.mf-prompt-search' : '.mf-scheme-search'
          );
          const summary = secondary?.querySelector(
            prefix === 'library'
              ? '.mf-library-section-summary'
              : '.mf-workspace-section-summary'
          );
          const refresh = secondary?.querySelector(
            prefix === 'library'
              ? '[data-testid="library-refresh"]'
              : '.mf-workspace-icon-action'
          );
          const create = secondary?.querySelector(
            prefix === 'library'
              ? '[data-testid="library-new"]'
              : '[data-testid="scheme-create"]'
          );
          if (!deck || !primary || !secondary || !tabs || !selected || !search ||
              !summary || !refresh || !create) return null;

          const rect = element => element.getBoundingClientRect();
          const style = element => getComputedStyle(element);
          return {
            deck: rect(deck),
            primary: rect(primary),
            secondary: rect(secondary),
            tabs: rect(tabs),
            selected: rect(selected),
            search: rect(search),
            summary: rect(summary),
            refresh: rect(refresh),
            create: rect(create),
            selectedRadius: style(selected).borderRadius,
            selectedBackground: style(selected).backgroundColor,
            searchRadius: style(search).borderRadius,
            refreshRadius: style(refresh).borderRadius,
            createRadius: style(create).borderRadius,
            selectedCount: tabs.querySelectorAll('[role="tab"][aria-selected="true"]').length,
            documentWidth: document.documentElement.scrollWidth,
            viewportWidth: innerWidth,
          };
        }""",
        prefix,
    )


def _assert_geometry(geometry: dict) -> None:
    assert geometry is not None
    assert geometry["documentWidth"] <= geometry["viewportWidth"] + 1, geometry
    assert abs(geometry["tabs"]["y"] - geometry["search"]["y"]) <= 2, geometry
    assert geometry["search"]["x"] > geometry["tabs"]["x"], geometry
    assert 340 <= geometry["search"]["width"] <= 400, geometry
    assert geometry["secondary"]["y"] >= geometry["primary"]["y"] + 50, geometry
    summary_center = geometry["summary"]["y"] + geometry["summary"]["height"] / 2
    create_center = geometry["create"]["y"] + geometry["create"]["height"] / 2
    assert abs(summary_center - create_center) <= 2, geometry
    assert geometry["refresh"]["width"] == 34, geometry
    assert geometry["refresh"]["height"] == 34, geometry
    assert geometry["selectedRadius"] == "8px", geometry
    assert geometry["searchRadius"] == "8px", geometry
    assert geometry["refreshRadius"] == "8px", geometry
    assert geometry["createRadius"] == "8px", geometry
    assert geometry["selectedBackground"] != "rgba(0, 0, 0, 0)", geometry
    assert geometry["selectedCount"] == 1, geometry


def test_library_and_scheme_control_decks_in_both_themes(app):
    output = _visual_output_dir()
    app.api_ok("prompt.create", {"title": "雨天城市人像", "content": "低饱和电影感街道"})

    for theme in ("dark", "light"):
        _set_theme_and_view(app, theme, "library")
        app.page.get_by_test_id("library-search").wait_for()
        _assert_geometry(_geometry(app, "library"))
        if output:
            app.page.screenshot(
                path=str(output / f"library-toolbar-v2-{theme}-1440x900.png"),
                full_page=False,
            )

        _set_theme_and_view(app, theme, "design-schemes")
        app.page.get_by_test_id("scheme-search").wait_for()
        _assert_geometry(_geometry(app, "scheme"))
        if output:
            app.page.screenshot(
                path=str(output / f"scheme-toolbar-v2-{theme}-1440x900.png"),
                full_page=False,
            )


def test_discover_submit_is_part_of_search_field(app):
    output = _visual_output_dir()
    _set_theme_and_view(app, "dark", "design-schemes")
    app.page.get_by_test_id("scheme-surface-explore").click()
    submit = app.page.get_by_test_id("market-search-run")
    submit.wait_for()

    assert submit.locator("xpath=ancestor::*[contains(@class, 'mf-scheme-search')]").count() == 1
    assert app.page.get_by_test_id("scheme-search").get_attribute("placeholder") == "搜索市场中的方案"
    if output:
        app.page.screenshot(
            path=str(output / "scheme-toolbar-v2-discover-dark-1440x900.png"),
            full_page=False,
        )
