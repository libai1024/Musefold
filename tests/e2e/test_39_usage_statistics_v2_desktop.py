"""Desktop-only visual contract for Usage Statistics 2.0."""
from __future__ import annotations

import json
import os
import time
from pathlib import Path


def _visual_output_dir() -> Path | None:
    raw = os.environ.get("MUSEFOLD_VISUAL_OUTPUT_DIR")
    if not raw:
        return None
    target = Path(raw)
    target.mkdir(parents=True, exist_ok=True)
    return target


def _insert_usage_history(app, provider_id: str, index: int, channel: str, model: str) -> None:
    created_at = int(time.time() * 1000) - index * 86_400_000
    status = "failed" if index in {5, 17} else "success"
    name = {
        "account": "Musefold 账号",
        "doubao": "豆包体验",
        "provider": "Studio Relay",
    }[channel]
    app.db_exec(
        """
        INSERT INTO history (
          id, provider_id, model, prompt_text, params, status,
          error_code, error_message, cost, cost_unit, duration_ms, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'point', ?, ?)
        """,
        (
            f"usage-visual-{index}",
            provider_id,
            model,
            f"usage visual prompt {index}",
            json.dumps({
                "schemaVersion": 1,
                "usageChannel": channel,
                "providerNameSnapshot": name,
            }),
            status,
            "SERVER" if status == "failed" else None,
            "visual fixture failure" if status == "failed" else None,
            0.4 if channel == "account" and status == "success" else 12,
            900 + index * 13,
            created_at,
        ),
    )


def _seed_usage(app) -> None:
    provider = app.api_ok("provider.create", {
        "name": "Studio Relay",
        "type": "openai-compatible",
        "baseUrl": "http://127.0.0.1:9/v1",
        "model": "gpt-image-2",
        "isActive": True,
    })
    models = ["musefold-image-pro", "seedream-4", "flux-1.1", "gpt-image-2"]
    channels = ["account", "provider", "account", "doubao"]
    for index in range(28):
        _insert_usage_history(
            app,
            provider["id"],
            index,
            channels[index % len(channels)],
            models[index % len(models)],
        )


def _open_usage(app, theme: str) -> None:
    app.page.set_viewport_size({"width": 1440, "height": 900})
    app.page.evaluate(
        """theme => {
          const appStore = window.__musefold_test.stores.app.getState();
          appStore.setThemeSource(theme);
          appStore.setDensity('comfortable');
          window.__musefold_test.stores.settings.getState().setSection('usage');
          window.__musefold_test.setView('settings');
        }""",
        theme,
    )
    app.page.wait_for_function(
        "theme => document.documentElement.dataset.theme === theme",
        arg=theme,
    )
    app.page.wait_for_selector('[data-testid="settings-usage-channel"]')
    app.page.wait_for_timeout(120)


def _geometry(app) -> dict:
    return app.page.evaluate(
        """() => {
          const section = document.querySelector('.mf-usage-section');
          const summary = document.querySelector('.mf-usage-summary');
          const panel = document.querySelector('.mf-usage-panel');
          const segmented = document.querySelector('.mf-usage-segmented');
          const heatCell = document.querySelector('.mf-usage-heatmap__cell');
          const heatmap = document.querySelector('.mf-usage-heatmap');
          const trend = document.querySelector('.mf-usage-trend-chart svg');
          if (!section || !summary || !panel || !segmented || !heatCell || !heatmap || !trend) {
            return null;
          }
          const rect = element => element.getBoundingClientRect();
          const style = element => getComputedStyle(element);
          return {
            documentWidth: document.documentElement.scrollWidth,
            viewportWidth: innerWidth,
            sectionWidth: rect(section).width,
            summaryColumns: style(summary).gridTemplateColumns.split(' ').length,
            summaryRadius: style(summary).borderRadius,
            summaryShadow: style(summary).boxShadow,
            panelRadius: style(panel).borderRadius,
            panelBorder: style(panel).borderStyle,
            segmentedRadius: style(segmented).borderRadius,
            heatCell: { width: rect(heatCell).width, height: rect(heatCell).height },
            heatCellCount: heatmap.children.length,
            trendHeight: rect(trend).height,
            channelCount: document.querySelectorAll('[data-testid="settings-usage-channel"]').length,
            activeRangeCount: document.querySelectorAll(
              '.mf-usage-segmented [role="radio"][aria-checked="true"]'
            ).length,
          };
        }"""
    )


def test_usage_statistics_desktop_layout_and_themes(app):
    output = _visual_output_dir()
    _seed_usage(app)

    for theme in ("dark", "light"):
        _open_usage(app, theme)
        geometry = _geometry(app)
        assert geometry is not None
        assert geometry["documentWidth"] <= geometry["viewportWidth"] + 1, geometry
        assert geometry["sectionWidth"] <= 1121, geometry
        assert geometry["summaryColumns"] == 5, geometry
        assert geometry["summaryRadius"] == "8px", geometry
        assert geometry["summaryShadow"] != "none", geometry
        assert geometry["panelRadius"] == "8px", geometry
        assert geometry["panelBorder"] == "solid", geometry
        assert geometry["segmentedRadius"] == "8px", geometry
        assert geometry["heatCell"] == {"width": 15, "height": 15}, geometry
        assert geometry["heatCellCount"] == 371, geometry
        assert geometry["trendHeight"] >= 220, geometry
        assert geometry["channelCount"] == 3, geometry
        assert geometry["activeRangeCount"] == 1, geometry

        if output:
            app.page.screenshot(
                path=str(output / f"usage-statistics-v2-{theme}-1440x900.png"),
                full_page=False,
            )
