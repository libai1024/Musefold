"""OS clipboard for E2E. Electron clipboard.readText() reads this buffer.

macOS uses /usr/bin/pbcopy. Linux needs xclip on X11/xvfb. Windows uses the
Win32 clipboard. File-backed shims are not sufficient: the app never reads them.
"""
from __future__ import annotations

import subprocess
import sys


def paste_key() -> str:
    return "Meta+V" if sys.platform == "darwin" else "Control+V"


def write(data: bytes | str) -> None:
    payload = data.encode("utf-8") if isinstance(data, str) else data
    if sys.platform == "darwin":
        subprocess.run(["/usr/bin/pbcopy"], input=payload, check=True)
        return
    if sys.platform.startswith("linux"):
        subprocess.run(
            ["xclip", "-selection", "clipboard", "-i"],
            input=payload,
            check=True,
        )
        return
    _write_windows(payload.decode("utf-8"))


def read() -> bytes:
    if sys.platform == "darwin":
        result = subprocess.run(["/usr/bin/pbpaste"], capture_output=True, check=False)
        return result.stdout
    if sys.platform.startswith("linux"):
        result = subprocess.run(
            ["xclip", "-selection", "clipboard", "-o"],
            capture_output=True,
            check=False,
        )
        return result.stdout
    return _read_windows().encode("utf-8")


def _write_windows(text: str) -> None:
    import ctypes

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    GMEM_MOVEABLE = 0x0002
    CF_UNICODETEXT = 13
    data = text.encode("utf-16-le") + b"\x00\x00"
    if not user32.OpenClipboard(None):
        raise OSError("OpenClipboard failed")
    try:
        user32.EmptyClipboard()
        handle = kernel32.GlobalAlloc(GMEM_MOVEABLE, len(data))
        locked = kernel32.GlobalLock(handle)
        ctypes.memmove(locked, data, len(data))
        kernel32.GlobalUnlock(handle)
        if not user32.SetClipboardData(CF_UNICODETEXT, handle):
            kernel32.GlobalFree(handle)
            raise OSError("SetClipboardData failed")
    finally:
        user32.CloseClipboard()


def _read_windows() -> str:
    import ctypes

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    CF_UNICODETEXT = 13
    if not user32.OpenClipboard(None):
        return ""
    try:
        handle = user32.GetClipboardData(CF_UNICODETEXT)
        if not handle:
            return ""
        locked = kernel32.GlobalLock(handle)
        try:
            return ctypes.wstring_at(locked)
        finally:
            kernel32.GlobalUnlock(handle)
    finally:
        user32.CloseClipboard()


def main() -> None:
    command = sys.argv[1] if len(sys.argv) > 1 else "write"
    if command == "write":
        write(sys.stdin.buffer.read())
        return
    if command == "read":
        sys.stdout.buffer.write(read())
        return
    raise SystemExit(f"unknown command: {command}")


if __name__ == "__main__":
    main()
