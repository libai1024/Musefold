"""Cross-platform structure checks for Windows x64 and ARM64 packages."""
from __future__ import annotations

import json
import struct
import subprocess
from pathlib import Path

from tests.e2e.conftest import REPO


PACKAGE_VERSION = json.loads((REPO / "package.json").read_text(encoding="utf-8"))["version"]
X64_ROOT = REPO / "release/v0.3.0/windows-x64"
ARM64_ROOT = REPO / "release/v0.3.0/windows-arm64"
PE_MACHINE_I386 = 0x014C
PE_MACHINE_AMD64 = 0x8664
PE_MACHINE_ARM64 = 0xAA64


def pe_machine(path: Path) -> int:
    data = path.read_bytes()
    assert data[:2] == b"MZ", f"{path.name} missing DOS header"
    pe_offset = struct.unpack_from("<I", data, 0x3C)[0]
    assert data[pe_offset:pe_offset + 4] == b"PE\0\0", f"{path.name} missing PE header"
    return struct.unpack_from("<H", data, pe_offset + 4)[0]


def asar_entries(asar: Path) -> list[str]:
    result = subprocess.run(
        ["npx", "asar", "list", str(asar)],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.splitlines()


def assert_windows_target(root: Path, unpacked_name: str, expected_machine: int):
    installer = root / f"Musefold Setup {PACKAGE_VERSION}.exe"
    unpacked = root / unpacked_name
    app_exe = unpacked / "Musefold.exe"
    native = unpacked / "resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node"
    asar = unpacked / "resources/app.asar"
    docs = unpacked / "resources/product-docs"

    assert installer.is_file(), installer
    assert pe_machine(installer) == PE_MACHINE_I386
    assert app_exe.is_file() and pe_machine(app_exe) == expected_machine
    assert native.is_file() and pe_machine(native) == expected_machine
    assert asar.is_file() and docs.is_dir()
    assert (docs / "README.md").is_file()
    assert (docs / "90-roadmap-and-task-index.md").is_file()

    entries = asar_entries(asar)
    joined = "\n".join(entries)
    assert "/node_modules/better-sqlite3" in joined
    assert "/out/main/index.js" in joined
    assert "/out/preload/index.cjs" in joined
    assert "/out/renderer/index.html" in joined
    assert "/src/features/composer" not in joined


def test_windows_x64_package_structure():
    assert_windows_target(X64_ROOT, "win-unpacked", PE_MACHINE_AMD64)


def test_windows_arm64_package_structure():
    assert_windows_target(ARM64_ROOT, "win-arm64-unpacked", PE_MACHINE_ARM64)
