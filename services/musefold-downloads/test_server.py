from __future__ import annotations

import json
import sqlite3
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path

from server import DownloadStore, load_catalog, make_handler


CATALOG = {
    ("macos", "0.3.2"): "/Musefold/downloads/0.3.2/Musefold-0.3.2-arm64.dmg",
    ("windows", "0.3.2"): "/Musefold/downloads/0.3.2/Musefold%20Setup%200.3.2.exe",
}


class DownloadServiceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_directory = tempfile.TemporaryDirectory()
        self.store = DownloadStore(Path(self.temp_directory.name) / "downloads.sqlite3")
        self.server = ThreadingHTTPServer(
            ("127.0.0.1", 0),
            make_handler(self.store, CATALOG),
        )
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.server.server_address[1]

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.temp_directory.cleanup()

    def request(self, method: str, path: str) -> tuple[int, dict[str, str], bytes]:
        connection = HTTPConnection("127.0.0.1", self.port, timeout=5)
        connection.request(method, path)
        response = connection.getresponse()
        body = response.read()
        headers = {key.lower(): value for key, value in response.getheaders()}
        connection.close()
        return response.status, headers, body

    def test_download_records_event_and_redirects(self) -> None:
        status, headers, body = self.request(
            "GET",
            "/download?platform=macos&version=0.3.2",
        )
        self.assertEqual(status, 302)
        self.assertEqual(headers["location"], CATALOG[("macos", "0.3.2")])
        self.assertEqual(headers["x-download-recorded"], "true")
        self.assertEqual(body, b"")

        status, _, body = self.request("GET", "/download-stats")
        self.assertEqual(status, 200)
        payload = json.loads(body)
        self.assertEqual(payload["total"], 1)
        self.assertEqual(payload["byPlatform"], {"macos": 1, "windows": 0})
        self.assertEqual(payload["byVersion"]["0.3.2"]["byPlatform"]["macos"], 1)

    def test_head_redirect_does_not_increment(self) -> None:
        status, headers, _ = self.request(
            "HEAD",
            "/download?platform=windows&version=0.3.2",
        )
        self.assertEqual(status, 302)
        self.assertEqual(headers["x-download-recorded"], "false")

        _, _, body = self.request("GET", "/download-stats")
        self.assertEqual(json.loads(body)["total"], 0)

    def test_database_write_failure_still_redirects(self) -> None:
        original_record = self.store.record

        def fail_record(_platform: str, _version: str) -> None:
            raise sqlite3.OperationalError("test failure")

        self.store.record = fail_record
        try:
            with self.assertLogs(level="ERROR") as captured_logs:
                status, headers, body = self.request(
                    "GET",
                    "/download?platform=macos&version=0.3.2",
                )
        finally:
            self.store.record = original_record

        self.assertEqual(status, 302)
        self.assertEqual(headers["x-download-recorded"], "false")
        self.assertEqual(body, b"")
        self.assertIn("download_event_write_failed", captured_logs.output[0])

    def test_invalid_or_unknown_download_is_rejected(self) -> None:
        status, _, body = self.request("GET", "/download?platform=macos")
        self.assertEqual(status, 400)
        self.assertEqual(json.loads(body)["error"], "invalid_download")

        status, _, body = self.request(
            "GET",
            "/download?platform=linux&version=0.3.2",
        )
        self.assertEqual(status, 404)
        self.assertEqual(json.loads(body)["error"], "download_not_found")

    def test_concurrent_downloads_are_counted(self) -> None:
        def record_download(_index: int) -> int:
            status, _, _ = self.request(
                "GET",
                "/download?platform=windows&version=0.3.2",
            )
            return status

        with ThreadPoolExecutor(max_workers=10) as executor:
            statuses = list(executor.map(record_download, range(30)))

        self.assertEqual(statuses, [302] * 30)
        _, _, body = self.request("GET", "/download-stats")
        payload = json.loads(body)
        self.assertEqual(payload["total"], 30)
        self.assertEqual(payload["byPlatform"]["windows"], 30)


class CatalogTest(unittest.TestCase):
    def test_catalog_rejects_external_paths(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "catalog.json"
            path.write_text(
                json.dumps(
                    {
                        "downloads": [
                            {
                                "platform": "macos",
                                "version": "0.3.2",
                                "path": "https://example.com/installer.dmg",
                            }
                        ]
                    }
                ),
                encoding="utf-8",
            )
            with self.assertRaises(ValueError):
                load_catalog(path)


if __name__ == "__main__":
    unittest.main()
