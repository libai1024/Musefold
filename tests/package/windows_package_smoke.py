"""Cross-platform structure checks for Windows x64 and ARM64 packages."""
from __future__ import annotations

import json
import re
import struct
import subprocess
from dataclasses import dataclass
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]

PE_MACHINE_I386 = 0x014C
PE_MACHINE_AMD64 = 0x8664
PE_MACHINE_ARM64 = 0xAA64
# electron-builder default when win.defaultArch is unset (builder-util defaultArchFromString).
_DEFAULT_WIN_ARCH = "x64"


@dataclass(frozen=True)
class WindowsBuilderMeta:
    product_name: str
    output_dir: str
    default_arch: str = _DEFAULT_WIN_ARCH


@dataclass(frozen=True)
class WindowsPackageLayout:
    installer: Path
    unpacked: Path
    product_name: str


def package_version(repo: Path) -> str:
    version = json.loads(
        (repo / "apps/desktop/package.json").read_text(encoding="utf-8")
    )["version"]
    if not isinstance(version, str) or not version.strip():
        raise ValueError("package.json version must be a non-empty string")
    return version


def _yaml_top_level_scalar(text: str, key: str) -> str:
    match = re.search(rf"^{re.escape(key)}:\s*(.+)$", text, re.MULTILINE)
    if not match:
        raise ValueError(f"missing top-level {key} in electron-builder.yml")
    return _yaml_scalar(match.group(1))


def _yaml_block(text: str, key: str) -> str:
    match = re.search(rf"^{re.escape(key)}:\s*\n((?:[ \t]+.*\n?)*)", text, re.MULTILINE)
    if not match:
        raise ValueError(f"missing {key} block in electron-builder.yml")
    return match.group(1)


def _yaml_scalar(raw: str) -> str:
    value = raw.split("#", 1)[0].strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        return value[1:-1]
    return value


def electron_builder_windows_meta(yml_text: str) -> WindowsBuilderMeta:
    """Derive Windows artifact naming inputs from electron-builder.yml."""
    product_name = _yaml_top_level_scalar(yml_text, "productName")
    directories = _yaml_block(yml_text, "directories")
    output_match = re.search(r"^[ \t]+output:\s*(.+)$", directories, re.MULTILINE)
    if not output_match:
        raise ValueError("missing directories.output in electron-builder.yml")
    win = _yaml_block(yml_text, "win")
    if not re.search(r"^[ \t]+-\s+nsis\s*$", win, re.MULTILINE) and not re.search(
        r"^[ \t]+target:\s+nsis\s*$", win, re.MULTILINE
    ):
        raise ValueError("win.target is not nsis; installer filename pattern would differ")
    default_match = re.search(r"^[ \t]+defaultArch:\s*(.+)$", win, re.MULTILINE)
    default_arch = _yaml_scalar(default_match.group(1)) if default_match else _DEFAULT_WIN_ARCH
    return WindowsBuilderMeta(
        product_name=product_name,
        output_dir=_yaml_scalar(output_match.group(1)),
        default_arch=default_arch,
    )


def windows_unpacked_dir_name(arch: str, default_arch: str = _DEFAULT_WIN_ARCH) -> str:
    """electron-builder computeAppOutDir: `win` + arch suffix + `-unpacked`."""
    suffix = "" if arch == default_arch else f"-{arch}"
    return f"win{suffix}-unpacked"


def windows_package_layout_candidates(
    repo: Path,
    *,
    version: str,
    arch: str,
    meta: WindowsBuilderMeta,
) -> list[WindowsPackageLayout]:
    """Prefer current electron-builder output; keep the historical layout as fallback.

    Current NSIS default (buildUniversalInstaller unset/true) writes
    `{productName} Setup {version}.exe` into `directories.output`. Non-default
    arch also gets `{productName} Setup {version}-{arch}.exe` when
    `nsis.buildUniversalInstaller` is false. Unpacked dirs follow
    `win[-{arch}]-unpacked` relative to that output directory.
    """
    output = (repo / "apps/desktop" / meta.output_dir).resolve()
    unpacked_name = windows_unpacked_dir_name(arch, meta.default_arch)
    installer_names = [f"{meta.product_name} Setup {version}.exe"]
    if arch != meta.default_arch:
        installer_names.append(f"{meta.product_name} Setup {version}-{arch}.exe")

    candidates = [
        WindowsPackageLayout(
            installer=output / name,
            unpacked=output / unpacked_name,
            product_name=meta.product_name,
        )
        for name in installer_names
    ]
    # Historical layout from early 0.3.0 drops (`release/v0.3.0/windows-{arch}/`).
    # Last-resort fallback only; current builder output does not use this tree.
    historical_root = repo / "release" / "v0.3.0" / f"windows-{arch}"
    candidates.append(
        WindowsPackageLayout(
            installer=historical_root / f"{meta.product_name} Setup {version}.exe",
            unpacked=historical_root / unpacked_name,
            product_name=meta.product_name,
        )
    )
    return candidates


def _windows_packaged_layout(arch: str, *, repo: Path = REPO) -> WindowsPackageLayout:
    """Prefer electron-builder's current output; keep the historical layout as fallback."""
    version = package_version(repo)
    meta = electron_builder_windows_meta(
        (repo / "apps/desktop/electron-builder.yml").read_text(encoding="utf-8")
    )
    candidates = windows_package_layout_candidates(
        repo, version=version, arch=arch, meta=meta
    )
    exe_name = f"{meta.product_name}.exe"
    for layout in candidates:
        if (layout.unpacked / exe_name).is_file():
            return layout
    return candidates[0]


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


def assert_windows_target(layout: WindowsPackageLayout, expected_machine: int):
    installer = layout.installer
    unpacked = layout.unpacked
    app_exe = unpacked / f"{layout.product_name}.exe"
    native_root = unpacked / "resources/app.asar.unpacked/node_modules/better-sqlite3"
    native_arch = "arm64" if expected_machine == PE_MACHINE_ARM64 else "x64"
    native_candidates = [
        native_root / f"prebuilds/win32-{native_arch}.node",
        native_root / "build/Release/better_sqlite3.node",
    ]
    native = next((candidate for candidate in native_candidates if candidate.is_file()), native_candidates[0])
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
    assert "/apps/desktop/out/main/index.js" in joined
    assert "/apps/desktop/out/preload/index.cjs" in joined
    assert "/apps/desktop/out/renderer/index.html" in joined
    assert "/src/features/composer" not in joined


def test_windows_package_layout_candidates_follow_current_builder_output():
    """Path derivation is pure: config files only, packaged artifacts need not exist."""
    version = package_version(REPO)
    meta = electron_builder_windows_meta(
        (REPO / "apps/desktop/electron-builder.yml").read_text(encoding="utf-8")
    )
    repo = Path("/nonexistent/musefold")
    x64 = windows_package_layout_candidates(repo, version=version, arch="x64", meta=meta)
    arm64 = windows_package_layout_candidates(repo, version=version, arch="arm64", meta=meta)

    assert meta.product_name == "Musefold"
    assert meta.output_dir == "../../release"
    assert meta.default_arch == "x64"
    assert x64[0].installer == repo / f"release/Musefold Setup {version}.exe"
    assert x64[0].unpacked == repo / "release/win-unpacked"
    assert arm64[0].installer == repo / f"release/Musefold Setup {version}.exe"
    assert arm64[0].unpacked == repo / "release/win-arm64-unpacked"
    assert arm64[1].installer == repo / f"release/Musefold Setup {version}-arm64.exe"
    assert x64[-1].unpacked == repo / "release/v0.3.0/windows-x64/win-unpacked"
    assert arm64[-1].unpacked == repo / "release/v0.3.0/windows-arm64/win-arm64-unpacked"
    assert all("v0.3.0" not in layout.unpacked.as_posix() for layout in x64[:-1])
    assert all("v0.3.0" not in layout.unpacked.as_posix() for layout in arm64[:-1])


def test_windows_x64_package_structure():
    layout = _windows_packaged_layout("x64")
    if not (layout.unpacked / f"{layout.product_name}.exe").is_file():
        pytest.skip("missing package; run `npm run package:win -- --x64` first")
    assert_windows_target(layout, PE_MACHINE_AMD64)


def test_windows_arm64_package_structure():
    layout = _windows_packaged_layout("arm64")
    if not (layout.unpacked / f"{layout.product_name}.exe").is_file():
        pytest.skip("missing package; run `npm run package:win -- --arm64` first")
    assert_windows_target(layout, PE_MACHINE_ARM64)
