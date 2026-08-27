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


def _set_theme_and_view(
    app, theme: str, view: str, viewport: dict | None = None
) -> None:
    app.page.set_viewport_size(viewport or {"width": 1440, "height": 900})
    if viewport is not None and viewport["width"] <= 760:
        # ≤760px 产品侧栏转 overlay drawer；等折叠状态落地再量几何，避免量到收起中的布局。
        app.page.wait_for_function(
            "() => window.__musefold_test.stores.app.getState().sidebarCollapsed === true",
            timeout=5_000,
        )
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
          // v2 提示词库几何上移到 PromptLibraryWorkspace 后，列表态内容列是
          // .mf-library-screen；方案中心仍是 .mf-workspace-list-content。两者同为
          // 960px 居中栏，是跨工作区对齐比较的等价容器。
          const content = deck?.closest(
            prefix === 'library' ? '.mf-library-screen' : '.mf-workspace-list-content'
          );
          const primary = document.querySelector(`.mf-${prefix}-control-primary`);
          const secondary = document.querySelector(`.mf-${prefix}-control-secondary`);
          const tabs = primary?.querySelector('.mf-workspace-scope-tabs');
          const selected = tabs?.querySelector('[role="tab"][aria-selected="true"]');
          const search = primary?.querySelector(
            prefix === 'library' ? '.mf-prompt-search' : '.mf-scheme-search'
          );
          const searchIcon = search?.querySelector(':scope > svg');
          const searchInput = search?.querySelector('input');
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
          if (!content || !deck || !primary || !secondary || !tabs || !selected ||
              !search || !searchIcon || !searchInput || !refresh || !create) {
            return null;
          }

          const rect = element => element.getBoundingClientRect();
          const style = element => getComputedStyle(element);
          return {
            content: rect(content),
            deck: rect(deck),
            primary: rect(primary),
            secondary: rect(secondary),
            tabs: rect(tabs),
            selected: rect(selected),
            search: rect(search),
            searchIcon: rect(searchIcon),
            searchInput: rect(searchInput),
            refresh: rect(refresh),
            create: rect(create),
            selectedRadius: style(selected).borderRadius,
            selectedBackground: style(selected).backgroundColor,
            searchRadius: style(search).borderRadius,
            searchPaddingLeft: style(search).paddingLeft,
            searchInputPaddingLeft: style(searchInput).paddingLeft,
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
    secondary_center = geometry["secondary"]["y"] + geometry["secondary"]["height"] / 2
    create_center = geometry["create"]["y"] + geometry["create"]["height"] / 2
    assert abs(secondary_center - create_center) <= 2, geometry
    assert geometry["refresh"]["width"] == 34, geometry
    assert geometry["refresh"]["height"] == 34, geometry
    assert geometry["selectedRadius"] == "8px", geometry
    assert geometry["searchRadius"] == "8px", geometry
    assert geometry["searchPaddingLeft"] == "10px", geometry
    assert geometry["searchInputPaddingLeft"] == "0px", geometry
    assert abs(
        geometry["searchInput"]["x"]
        - geometry["searchIcon"]["x"]
        - geometry["searchIcon"]["width"]
        - 8
    ) <= 0.5, geometry
    assert geometry["refreshRadius"] == "8px", geometry
    assert geometry["createRadius"] == "8px", geometry
    assert geometry["selectedBackground"] != "rgba(0, 0, 0, 0)", geometry
    assert geometry["selectedCount"] == 1, geometry


def _assert_matching_geometry(
    library: dict,
    scheme: dict,
    keys: tuple = ("content", "deck", "search", "searchIcon", "searchInput"),
) -> None:
    for key in keys:
        for dimension in ("x", "width"):
            assert abs(library[key][dimension] - scheme[key][dimension]) <= 1, (
                key,
                dimension,
                library,
                scheme,
            )

    if "search" not in keys:
        return

    library_gap = (
        library["searchInput"]["x"]
        - library["searchIcon"]["x"]
        - library["searchIcon"]["width"]
    )
    scheme_gap = (
        scheme["searchInput"]["x"]
        - scheme["searchIcon"]["x"]
        - scheme["searchIcon"]["width"]
    )
    assert abs(library_gap - scheme_gap) <= 0.5, (library, scheme)


def _create_menu_geometry(app) -> dict:
    return app.page.evaluate(
        """() => {
          const menu = document.querySelector('[data-testid="scheme-create-menu"]');
          const items = Array.from(menu?.querySelectorAll('[role="menuitem"]') ?? []);
          if (!menu || items.length === 0) return null;
          const rect = element => element.getBoundingClientRect();
          const itemRects = items.map(rect);
          const icons = items.map(item => item.querySelector('.mf-scheme-create-option-icon'));
          const copies = items.map(item => item.querySelector('.mf-scheme-create-option-copy'));
          if (icons.some(icon => !icon) || copies.some(copy => !copy)) return null;
          return {
            menu: rect(menu),
            menuPadding: getComputedStyle(menu).padding,
            menuCssWidth: getComputedStyle(menu).width,
            itemRects,
            itemMinHeights: items.map(item => getComputedStyle(item).minHeight),
            iconRects: icons.map(rect),
            iconCssSizes: icons.map(icon => ({
              width: getComputedStyle(icon).width,
              height: getComputedStyle(icon).height,
            })),
            itemGap: itemRects[1].y - itemRects[0].bottom,
            copyFits: copies.every(copy => copy.scrollWidth <= copy.clientWidth + 1),
            viewportWidth: innerWidth,
          };
        }"""
    )


def test_library_and_scheme_control_decks_in_both_themes(app):
    output = _visual_output_dir()
    app.api_ok("prompt.create", {"title": "雨天城市人像", "content": "低饱和电影感街道"})

    for theme in ("dark", "light"):
        _set_theme_and_view(app, theme, "library")
        app.page.get_by_test_id("library-search").wait_for()
        assert app.page.locator(".mf-library-section-summary").count() == 0
        library_geometry = _geometry(app, "library")
        _assert_geometry(library_geometry)
        if output:
            app.page.screenshot(
                path=str(output / f"library-toolbar-v2-{theme}-1440x900.png"),
                full_page=False,
            )

        _set_theme_and_view(app, theme, "design-schemes")
        app.page.get_by_test_id("scheme-search").wait_for()
        assert app.page.locator(".mf-workspace-section-summary").count() == 0
        scheme_geometry = _geometry(app, "scheme")
        _assert_geometry(scheme_geometry)
        _assert_matching_geometry(library_geometry, scheme_geometry)
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


def test_library_and_scheme_control_decks_match_at_narrow_width(app):
    output = _visual_output_dir()
    viewport = {"width": 600, "height": 760}
    geometries = {}

    for view, prefix, search_test_id in (
        ("library", "library", "library-search"),
        ("design-schemes", "scheme", "scheme-search"),
    ):
        _set_theme_and_view(app, "light", view, viewport)
        app.page.get_by_test_id(search_test_id).wait_for()
        geometry = _geometry(app, prefix)
        assert geometry is not None
        assert geometry["documentWidth"] <= geometry["viewportWidth"] + 1, geometry
        if prefix == "library":
            # v2 提示词库工作区不建 workspace-detail 容器：600px 下牌组保持双列，
            # 搜索与 tabs 同行、右缘与 deck 对齐（minmax(240px, 44%) 轨道）。
            tabs_center = geometry["tabs"]["y"] + geometry["tabs"]["height"] / 2
            search_center = geometry["search"]["y"] + geometry["search"]["height"] / 2
            assert abs(search_center - tabs_center) <= 2, geometry
            assert geometry["search"]["x"] > geometry["tabs"]["x"], geometry
            assert geometry["search"]["width"] >= 240, geometry
            assert geometry["search"]["x"] + geometry["search"]["width"] <= (
                geometry["deck"]["x"] + geometry["deck"]["width"] + 1
            ), geometry
        else:
            # 方案中心容器查询（≤640px）折叠为单列：搜索整行落到 tabs 下方并撑满 deck。
            assert geometry["search"]["y"] >= (
                geometry["tabs"]["y"] + geometry["tabs"]["height"] + 11
            ), geometry
            assert abs(geometry["search"]["width"] - geometry["deck"]["width"]) <= 1, geometry
        geometries[prefix] = geometry
        if output:
            app.page.screenshot(
                path=str(output / f"{prefix}-toolbar-v2-light-600x760.png"),
                full_page=False,
            )

    # 窄屏两套牌组保持同一足迹（内容列与 deck 对齐）；内部排布按各自契约在上面对齐断言。
    _assert_matching_geometry(
        geometries["library"], geometries["scheme"], keys=("content", "deck")
    )


def test_scheme_create_menu_has_comfortable_spacing_and_responsive_bounds(app):
    output = _visual_output_dir()
    _set_theme_and_view(app, "light", "design-schemes")
    app.page.get_by_test_id("scheme-create").click()
    app.page.get_by_test_id("scheme-create-menu").wait_for()

    geometry = _create_menu_geometry(app)
    assert geometry is not None
    assert geometry["menuCssWidth"] == "324px", geometry
    assert 300 <= geometry["menu"]["width"] <= 324, geometry
    assert geometry["menuPadding"] == "8px", geometry
    assert len(geometry["itemRects"]) == 5, geometry
    assert all(value == "58px" for value in geometry["itemMinHeights"]), geometry
    assert all(rect["height"] >= 55 for rect in geometry["itemRects"]), geometry
    assert all(rect["width"] == geometry["itemRects"][0]["width"] for rect in geometry["itemRects"])
    assert all(
        size["width"] == "32px" and size["height"] == "32px"
        for size in geometry["iconCssSizes"]
    ), geometry
    assert all(rect["width"] >= 30 and rect["height"] >= 30 for rect in geometry["iconRects"])
    assert geometry["itemGap"] >= 1.8, geometry
    assert geometry["copyFits"], geometry
    if output:
        app.page.screenshot(
            path=str(output / "scheme-create-menu-light-1440x900.png"),
            full_page=False,
        )

    app.page.keyboard.press("Escape")
    app.page.get_by_test_id("scheme-create-menu").wait_for(state="detached")
    _set_theme_and_view(app, "light", "design-schemes", {"width": 360, "height": 760})
    app.page.get_by_test_id("scheme-create").click()
    app.page.get_by_test_id("scheme-create-menu").wait_for()
    narrow = _create_menu_geometry(app)
    assert narrow is not None
    assert narrow["menu"]["x"] >= 8, narrow
    assert narrow["menu"]["right"] <= narrow["viewportWidth"] - 8, narrow
    assert narrow["menu"]["width"] <= narrow["viewportWidth"] - 24, narrow
    assert all(value == "58px" for value in narrow["itemMinHeights"]), narrow
    if output:
        app.page.screenshot(
            path=str(output / "scheme-create-menu-light-360x760.png"),
            full_page=False,
        )
