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
    text = payload.decode("utf-8")
    subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "$t = [Console]::In.ReadToEnd(); Set-Clipboard -Value $t",
        ],
        input=text,
        text=True,
        encoding="utf-8",
        check=True,
    )


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
    result = subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Get-Clipboard -Raw",
        ],
        capture_output=True,
        check=False,
        encoding="utf-8",
    )
    return (result.stdout or "").encode("utf-8")


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
