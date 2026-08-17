#!/usr/bin/env python3
"""Privacy-friendly download event service for the Musefold website."""

from __future__ import annotations

import json
import logging
import os
import re
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit


PLATFORM_PATTERN = re.compile(r"^[a-z][a-z0-9-]{0,31}$")
VERSION_PATTERN = re.compile(r"^[0-9A-Za-z][0-9A-Za-z.+-]{0,31}$")
DOWNLOAD_PATH_PREFIX = "/Musefold/downloads/"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def load_catalog(path: str | os.PathLike[str]) -> dict[tuple[str, str], str]:
    with Path(path).open("r", encoding="utf-8") as source:
        payload = json.load(source)

    entries = payload.get("downloads") if isinstance(payload, dict) else None
    if not isinstance(entries, list) or not entries:
        raise ValueError("catalog must contain a non-empty downloads list")

    catalog: dict[tuple[str, str], str] = {}
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("each catalog entry must be an object")

        platform = entry.get("platform")
        version = entry.get("version")
        target = entry.get("path")
        if not isinstance(platform, str) or not PLATFORM_PATTERN.fullmatch(platform):
            raise ValueError("catalog platform is invalid")
        if not isinstance(version, str) or not VERSION_PATTERN.fullmatch(version):
            raise ValueError("catalog version is invalid")
        if not isinstance(target, str):
            raise ValueError("catalog path is invalid")

        parsed_target = urlsplit(target)
        decoded_segments = [segment for segment in parsed_target.path.split("/") if segment]
        if (
            parsed_target.scheme
            or parsed_target.netloc
            or parsed_target.query
            or parsed_target.fragment
            or not target.startswith(DOWNLOAD_PATH_PREFIX)
            or ".." in decoded_segments
        ):
            raise ValueError("catalog paths must stay inside /Musefold/downloads/")

        key = (platform, version)
        if key in catalog:
            raise ValueError(f"duplicate catalog entry: {platform} {version}")
        catalog[key] = target

    return catalog


class DownloadStore:
    def __init__(self, database_path: str | os.PathLike[str]) -> None:
        self.database_path = str(database_path)
        Path(self.database_path).parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=5)
        connection.execute("PRAGMA busy_timeout = 5000")
        return connection

    def _initialize(self) -> None:
        with closing(self._connect()) as connection:
            with connection:
                connection.execute("PRAGMA journal_mode = WAL")
                connection.execute("PRAGMA synchronous = NORMAL")
                connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS download_events (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        platform TEXT NOT NULL,
                        version TEXT NOT NULL,
                        created_at TEXT NOT NULL
                    )
                    """
                )
                connection.execute(
                    """
                    CREATE INDEX IF NOT EXISTS download_events_platform_version
                    ON download_events (platform, version)
                    """
                )

    def healthcheck(self) -> None:
        with closing(self._connect()) as connection:
            connection.execute("SELECT 1").fetchone()

    def record(self, platform: str, version: str) -> None:
        with closing(self._connect()) as connection:
            with connection:
                connection.execute(
                    "INSERT INTO download_events (platform, version, created_at) VALUES (?, ?, ?)",
                    (platform, version, utc_now()),
                )

    def statistics(self, catalog: dict[tuple[str, str], str]) -> dict[str, Any]:
        by_platform: dict[str, int] = {}
        by_version: dict[str, dict[str, Any]] = {}
        for platform, version in catalog:
            by_platform.setdefault(platform, 0)
            version_entry = by_version.setdefault(version, {"total": 0, "byPlatform": {}})
            version_entry["byPlatform"].setdefault(platform, 0)

        with closing(self._connect()) as connection:
            rows = connection.execute(
                """
                SELECT platform, version, COUNT(*)
                FROM download_events
                GROUP BY platform, version
                ORDER BY version, platform
                """
            ).fetchall()

        total = 0
        for platform, version, count in rows:
            count = int(count)
            total += count
            by_platform[platform] = by_platform.get(platform, 0) + count
            version_entry = by_version.setdefault(version, {"total": 0, "byPlatform": {}})
            version_entry["total"] += count
            version_entry["byPlatform"][platform] = count

        return {
            "total": total,
            "byPlatform": dict(sorted(by_platform.items())),
            "byVersion": dict(sorted(by_version.items())),
            "generatedAt": utc_now(),
            "metric": "download_starts",
        }


def make_handler(
    store: DownloadStore,
    catalog: dict[tuple[str, str], str],
) -> type[BaseHTTPRequestHandler]:
    class DownloadHandler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = "MusefoldDownloads/1.0"
        sys_version = ""

        def version_string(self) -> str:
            return self.server_version

        def log_message(self, _format: str, *_args: object) -> None:
            # Do not place client addresses or user agents in application logs.
            return

        def do_GET(self) -> None:
            self._route(head_only=False)

        def do_HEAD(self) -> None:
            self._route(head_only=True)

        def do_POST(self) -> None:
            self._json_response(405, {"error": "method_not_allowed"}, head_only=False)

        def _route(self, head_only: bool) -> None:
            request = urlsplit(self.path)
            if request.path == "/health":
                try:
                    store.healthcheck()
                except sqlite3.Error:
                    self._json_response(503, {"status": "unavailable"}, head_only)
                    return
                self._json_response(200, {"status": "ok"}, head_only)
                return

            if request.path == "/download-stats":
                try:
                    payload = store.statistics(catalog)
                except sqlite3.Error:
                    logging.exception("download_statistics_read_failed")
                    self._json_response(503, {"error": "statistics_unavailable"}, head_only)
                    return
                self._json_response(200, payload, head_only)
                return

            if request.path == "/download":
                self._download_response(request.query, head_only)
                return

            self._json_response(404, {"error": "not_found"}, head_only)

        def _download_response(self, query_string: str, head_only: bool) -> None:
            query = parse_qs(query_string, keep_blank_values=True)
            if set(query) != {"platform", "version"}:
                self._json_response(400, {"error": "invalid_download"}, head_only)
                return

            platforms = query.get("platform", [])
            versions = query.get("version", [])
            if len(platforms) != 1 or len(versions) != 1:
                self._json_response(400, {"error": "invalid_download"}, head_only)
                return

            platform = platforms[0]
            version = versions[0]
            target = catalog.get((platform, version))
            if target is None:
                self._json_response(404, {"error": "download_not_found"}, head_only)
                return

            recorded = False
            if not head_only:
                try:
                    store.record(platform, version)
                    recorded = True
                except sqlite3.Error:
                    # A metrics failure must never block an installer download.
                    logging.exception(
                        "download_event_write_failed platform=%s version=%s",
                        platform,
                        version,
                    )

            self.send_response(302)
            self.send_header("Location", target)
            self.send_header("Content-Length", "0")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("X-Robots-Tag", "noindex, nofollow")
            self.send_header("X-Download-Recorded", "true" if recorded else "false")
            self.end_headers()

        def _json_response(self, status: int, payload: dict[str, Any], head_only: bool) -> None:
            body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy", "default-src 'none'")
            self.end_headers()
            if not head_only:
                self.wfile.write(body)

    return DownloadHandler


def main() -> None:
    host = os.environ.get("DOWNLOAD_SERVICE_HOST", "0.0.0.0")
    port = int(os.environ.get("DOWNLOAD_SERVICE_PORT", "8080"))
    database_path = os.environ.get("DOWNLOAD_DB_PATH", "/data/downloads.sqlite3")
    catalog_path = os.environ.get("DOWNLOAD_CATALOG_PATH", "/app/catalog.json")

    catalog = load_catalog(catalog_path)
    store = DownloadStore(database_path)
    server = ThreadingHTTPServer((host, port), make_handler(store, catalog))
    server.daemon_threads = True
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    logging.info("download_service_started port=%s catalog_entries=%s", port, len(catalog))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
