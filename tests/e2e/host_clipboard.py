"""Real OS clipboard access for the `gui` marked tests.

Every backend drives the actual system clipboard, so the app still reads it
through its own narrow IPC exactly as it would for a user. Only the tool
differs per platform: pbcopy on macOS, xclip on X11/xvfb, PowerShell on
Windows. Tests keep calling pbcopy/pbpaste; conftest routes them here.

These tests are excluded on GitHub-hosted Windows (`-m "not gui"`): that runner
has no interactive window station, so no clipboard backend can work there.
"""
from __future__ import annotations

import subprocess
import sys

_POWERSHELL_WRITE = """
Add-Type -AssemblyName System.Windows.Forms
$text = [Console]::In.ReadToEnd()
if ($text.Length -eq 0) { [System.Windows.Forms.Clipboard]::Clear() }
else { [System.Windows.Forms.Clipboard]::SetText($text) }
"""

_POWERSHELL_READ = """
Add-Type -AssemblyName System.Windows.Forms
[Console]::Out.Write([System.Windows.Forms.Clipboard]::GetText())
"""


def paste_key() -> str:
    return "Meta+V" if sys.platform == "darwin" else "Control+V"


def write(data: bytes | str) -> None:
    payload = data.encode("utf-8") if isinstance(data, str) else data
    if sys.platform == "darwin":
        subprocess.run(["pbcopy"], input=payload, check=True)
    elif sys.platform.startswith("linux"):
        # xclip exits only once another client takes the selection; -selection
        # clipboard plus a detached run keeps the buffer alive for the app.
        subprocess.run(
            ["xclip", "-selection", "clipboard", "-i"], input=payload, check=True
        )
    else:
        _powershell(_POWERSHELL_WRITE, stdin=payload)


def read() -> bytes:
    if sys.platform == "darwin":
        return subprocess.run(["pbpaste"], capture_output=True, check=False).stdout
    if sys.platform.startswith("linux"):
        return subprocess.run(
            ["xclip", "-selection", "clipboard", "-o"],
            capture_output=True,
            check=False,
        ).stdout
    return _powershell(_POWERSHELL_READ)


def _powershell(script: str, stdin: bytes | None = None) -> bytes:
    completed = subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-STA", "-Command", script],
        input=stdin,
        capture_output=True,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(
            "PowerShell clipboard access failed "
            f"({completed.returncode}): {completed.stderr.decode('utf-8', 'replace')}"
        )
    return completed.stdout
