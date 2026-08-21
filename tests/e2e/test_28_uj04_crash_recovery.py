"""UJ-04：跑一半强杀应用 → 重开不残留「正在生成」。

模拟真实用户合盖/强退：生成进行中直接 SIGKILL（不给收尾机会），
同一 userDataDir 重启后，中断的运行必须落为终态，界面不得再转圈。

覆盖测试卡：CV-31（重启恢复）、UJ-04（中断恢复全链路）。
"""
from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import psutil
import pytest

from conftest import _launch  # 复用真实 Electron 启动器（同目录重开）
from test_08_generation_workbench import PNG_1PX_B64, parse_request_body

SCHEME_DB_NAME = "musefold-design-scheme-v0.3.2.db"
# 每张图的人为延时：给「杀在半途」留出稳定窗口。
IMAGE_DELAY_SECONDS = 4.0


@pytest.fixture
def slow_provider_server():
    """假生图服务：逐张慢速返回，便于在生成中途强杀。"""
    served: list[float] = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            if self.path != "/v1/models":
                self.send_response(404)
                self.end_headers()
                return
            payload = json.dumps({"data": [{"id": "gpt-image-2", "object": "model"}]}).encode()
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def do_POST(self):  # noqa: N802
            length = int(self.headers.get("content-length", "0") or 0)
            raw = self.rfile.read(length) if length else b"{}"
            parse_request_body(raw, self.headers.get("content-type", ""))
            served.append(time.time())
            # 第一张快速返回（保证有「已完成」的结果），其余拖慢等待强杀。
            if len(served) > 1:
                time.sleep(IMAGE_DELAY_SECONDS)
            payload = json.dumps({"data": [{"b64_json": PNG_1PX_B64}]}).encode()
            try:
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
            except (BrokenPipeError, ConnectionResetError):
                pass  # 应用已被强杀，连接断开属预期

        def log_message(self, *_args):
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield {"base": f"http://127.0.0.1:{server.server_address[1]}/v1", "served": served}
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def db_rows(path: Path, sql: str, params: tuple = ()):
    assert path.exists(), f"db missing: {path}"
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        con.row_factory = sqlite3.Row
        return [dict(row) for row in con.execute(sql, params).fetchall()]
    finally:
        con.close()


def hard_kill_app(app):
    """强杀整棵进程树（不是 terminate）。

    真实的「强制退出 / 断电」会带走主进程与全部 helper；只杀父进程会留下
    孤儿 helper，既不符合现实，也会让 Electron 的单实例判定出现歧义。
    """
    try:
        if app.browser:
            app.browser.close()
    except Exception:  # noqa: BLE001
        pass

    # 先枚举再杀：杀掉父进程后子进程会被 reparent，届时就找不回这棵树了。
    try:
        parent = psutil.Process(app.proc.pid)
        doomed = parent.children(recursive=True) + [parent]
    except psutil.NoSuchProcess:
        doomed = []
    for process in doomed:
        try:
            process.kill()  # 关键：不给主进程任何收尾机会
        except psutil.NoSuchProcess:
            pass
    psutil.wait_procs(doomed, timeout=10)
    app.proc.wait(timeout=10)


def hard_kill_and_relaunch(app, pw):
    """强杀后用同一 userDataDir 重开。"""
    hard_kill_app(app)

    # 修复后（singleton-lock.ts 启动时清理死进程锁），强杀后**立即**重开
    # 必须一次成功——不允许再靠重试兜底掩盖回归。
    try:
        browser, handle = _launch(app.user_data_dir, pw)
    except RuntimeError as error:
        raise AssertionError(f"强杀后立即重开失败（陈旧单实例锁清理回归）：{error}") from error

    app.page = handle.page
    app.proc = handle.proc
    app.browser = browser
    app._errors = handle._errors  # type: ignore[attr-defined]
    return app


def test_uj04_hard_kill_leaves_no_running_state(app, _pw, slow_provider_server):
    main_db = app.db_path()

    # 1. 配一个慢速假服务商，发起 4 张生成。
    provider = app.api_ok("provider.create", {
        "name": "UJ04 慢速假站",
        "type": "openai-compatible",
        "baseUrl": slow_provider_server["base"],
        "model": "gpt-image-2",
        "isActive": True,
    })
    app.api_ok("provider.saveKey", provider["id"], "sk-uj04-crash-recovery-test")
    app.api_ok("provider.setActive", provider["id"])
    app.page.evaluate("async () => window.__musefold_test.stores.generation.getState().loadProviders()")

    app.set_view("generate")
    app.page.evaluate(
        """() => {
            const wb = window.__musefold_test.stores.workbench.getState();
            wb.setParams({ n: 4 });
            wb.setDraftPrompt('强杀恢复验证用海报');
            void wb.submitDraft();
        }"""
    )

    # 2. 等到「有一张已完成、整轮仍在跑」——这是最能暴露残留的时刻。
    deadline = time.time() + 30
    session_id = None
    while time.time() < deadline:
        state = app.page.evaluate(
            """() => {
                const s = window.__musefold_test.stores.workbench.getState();
                const turn = s.turns[0];
                return {
                    sessionId: s.sessionId,
                    isGenerating: s.isGenerating,
                    done: turn ? turn.results.filter((r) => r.status === 'success').length : 0,
                    pending: turn ? turn.results.filter((r) => r.status === 'pending').length : 0,
                };
            }"""
        )
        session_id = state["sessionId"]
        if state["isGenerating"] and state["done"] >= 1 and state["pending"] >= 1:
            break
        time.sleep(0.3)
    else:
        pytest.fail(f"未进入「部分完成 + 仍在生成」状态：{state}")

    # 落库确认确实有未终态运行（这正是旧版本重启后卡住的根因）。
    unfinished_before = db_rows(
        main_db,
        "SELECT id, status FROM generation_runs WHERE status IN ('queued','running')",
    )
    assert unfinished_before, "强杀前应存在未终态的 generation_runs"

    # 3. 强杀 → 同目录重启。
    hard_kill_and_relaunch(app, _pw)

    # 4. 数据库：中断运行必须被收尾，且可追溯原因。
    still_unfinished = db_rows(
        main_db,
        "SELECT id, status FROM generation_runs WHERE status IN ('queued','running')",
    )
    assert still_unfinished == [], f"重启后仍有未终态运行：{still_unfinished}"

    recovered = db_rows(
        main_db,
        "SELECT status, error_code FROM generation_runs WHERE id IN ({})".format(
            ",".join("?" * len(unfinished_before))
        ),
        tuple(row["id"] for row in unfinished_before),
    )
    assert all(row["status"] in {"cancelled", "failed"} for row in recovered), recovered
    assert any(row["error_code"] == "INTERRUPTED" for row in recovered if row["status"] == "failed"), recovered

    # 已完成的结果必须保留（用户的劳动成果不能因崩溃丢失）。
    survived = db_rows(main_db, "SELECT COUNT(*) AS c FROM generation_runs WHERE status = 'success'")
    assert survived[0]["c"] >= 1, "已完成的图片在重启后丢失"

    # 5. 界面：打开该对话不得再转圈。
    app.set_view("generate")
    app.page.evaluate(
        "(sid) => window.__musefold_test.stores.workbench.getState().openSession(sid)",
        session_id,
    )
    app.page.wait_for_function(
        "(sid) => window.__musefold_test.stores.workbench.getState().activeSessionId === sid",
        arg=session_id,
    )
    ui = app.page.evaluate(
        """() => {
            const s = window.__musefold_test.stores.workbench.getState();
            const turn = s.turns[0];
            return {
                isGenerating: s.isGenerating,
                runningTurns: Object.keys(s.runningTurns).length,
                pending: turn ? turn.results.filter((r) => r.status === 'pending').length : 0,
                statuses: turn ? turn.results.map((r) => r.status) : [],
                cancelButtons: document.querySelectorAll('[data-testid="refine-cancel"]').length,
            };
        }"""
    )
    assert ui["isGenerating"] is False, ui
    assert ui["runningTurns"] == 0, ui
    assert ui["pending"] == 0, f"重启后仍有 pending 骨架：{ui}"
    assert ui["cancelButtons"] == 0, "重启后 Composer 仍显示停止按钮（误判为生成中）"
    assert "success" in ui["statuses"], ui

    # 6. 侧栏不得有常亮运行指示。
    # 会话列表自 V13-SPLIT-03 起由 Query 持有，不再镜像进 workbench store；
    # 直接查渲染出来的行状态（running 覆盖 queued，见 Sidebar 的映射）。
    running_sessions = app.page.evaluate(
        """() => document.querySelectorAll(
            '[data-conversation-row][data-status="running"]'
        ).length"""
    )
    assert running_sessions == 0, "侧栏仍有常亮的运行指示"

    # 7. 恢复后可继续工作：对失败位重试成功。
    retried = app.page.evaluate(
        """async () => {
            const s = window.__musefold_test.stores.workbench.getState();
            const turn = s.turns[0];
            const target = turn.results.find((r) => r.status !== 'success');
            if (!target) return { skipped: true };
            await window.__musefold_test.stores.workbench.getState().retryResult(turn.id, target.id);
            const after = window.__musefold_test.stores.workbench.getState().turns[0]
                .results.find((r) => r.id === target.id);
            return {
                skipped: false,
                status: after.status,
                error: after.error,
                errorCode: after.errorCode,
                providerId: turn.providerId,
                historyId: target.historyId,
            };
        }"""
    )
    assert retried.get("skipped") or retried["status"] == "success", retried


def _plant_stale_singleton_lock(user_data_dir: Path) -> int:
    """在 userData 里种一个指向「确认已死」进程的 SingletonLock。

    强杀窗口能否自然复现取决于内核回收时序（本机时好时坏）；
    主动种锁让「陈旧锁存在」成为确定性前置，穿透 singleton-lock.ts 的清理路径。
    """
    import os
    import socket

    child = subprocess.Popen(["/bin/sleep", "0"])  # 拿一个必然已死的 PID
    child.wait(timeout=5)
    lock = user_data_dir / "SingletonLock"
    lock.unlink(missing_ok=True)
    os.symlink(f"{socket.gethostname()}-{child.pid}", lock)
    return child.pid


def _read_lock_pid(user_data_dir: Path) -> int | None:
    import os

    try:
        target = os.readlink(user_data_dir / "SingletonLock")
    except OSError:
        return None
    return int(target.rsplit("-", 1)[1])


@pytest.mark.skipif(
    os.name == "nt",
    reason="SingletonLock 符号链接是 Chromium 的 POSIX 单实例机制，Windows 走命名互斥量",
)
def test_immediate_relaunch_after_hard_kill(app, _pw):
    """强杀后零等待重开 ×3：不得再出现「点了图标没反应」（静默 rc=0 退出）。

    根因回归点：SIGKILL 留下的 SingletonLock 指向死进程，修复前
    requestSingleInstanceLock() 在 ~1s 窗口内可能拒绝新实例并静默退出；
    修复（electron/main/singleton-lock.ts）在请求锁之前清理可验证已死的锁。
    每轮额外把陈旧锁「种」回去，使清理路径不依赖内核时序、确定性被覆盖。
    """
    app.set_view("generate")
    for round_no in range(3):
        # 先杀（留下真实残骸），再确定性补种一个死进程锁。
        hard_kill_app(app)
        stale_pid = _plant_stale_singleton_lock(app.user_data_dir)

        try:
            browser, handle = _launch(app.user_data_dir, _pw)
        except RuntimeError as error:
            raise AssertionError(
                f"第 {round_no + 1} 次：强杀后立即重开失败（陈旧锁 pid={stale_pid} 未被清理）：{error}"
            ) from error
        app.page = handle.page
        app.proc = handle.proc
        app.browser = browser
        app._errors = handle._errors  # type: ignore[attr-defined]

        # 锁必须已被新实例接管：指向存活的新持有者，而非种下的死进程。
        # 注：app.proc 是 electron CLI 包装进程，真正持锁的主进程是其子进程，
        # 所以断言「非死进程 + 持有者存活」而非具体 pid 相等。
        lock_pid = _read_lock_pid(app.user_data_dir)
        assert lock_pid is not None and lock_pid != stale_pid, (
            f"第 {round_no + 1} 次：SingletonLock 未被接管（锁 pid={lock_pid}，死进程 pid={stale_pid}）"
        )
        import os
        try:
            os.kill(lock_pid, 0)
        except OSError:
            raise AssertionError(
                f"第 {round_no + 1} 次：锁持有者 pid={lock_pid} 不存活（又是一个陈旧锁）"
            ) from None
        # 重开后应用真实可用（渲染进程钩子就位）。
        ready = app.page.evaluate("() => Boolean(window.__musefold_test && window.api)")
        assert ready, f"第 {round_no + 1} 次强杀重开后应用不可用"


def test_uj04_scheme_run_recovered_after_hard_kill(app, _pw, tmp_path):
    """方案运行侧的同一承诺：非终态 design_scheme_runs 重启后落为 failed。"""
    from test_26_scheme_center_delete import _share_package

    # 导入分享包，拿到真实 scheme + revision（满足外键）。
    imported = app.api_ok("designScheme.importScheme", str(_share_package(tmp_path)))
    assert imported["ok"], imported
    # 导入 IPC 只回传方案摘要；当前版本即其 currentRevisionId。
    revision_id = imported["data"]["scheme"]["currentRevisionId"]

    scheme_db = app.user_data_dir / SCHEME_DB_NAME
    con = sqlite3.connect(scheme_db)
    try:
        con.execute(
            """INSERT INTO design_scheme_runs (run_id, revision_id, mode, status, policy_json, created_at)
               VALUES ('dsr_uj04_exec', ?, 'trial', 'executing', '{}', ?)""",
            (revision_id, int(time.time() * 1000)),
        )
        con.execute(
            """INSERT INTO design_scheme_runs (run_id, revision_id, mode, status, policy_json, created_at)
               VALUES ('dsr_uj04_plan', ?, 'trial', 'planning', '{}', ?)""",
            (revision_id, int(time.time() * 1000)),
        )
        con.commit()
    finally:
        con.close()

    hard_kill_and_relaunch(app, _pw)
    # 触发方案库初始化（恢复逻辑在 init 时执行）。
    app.api_ok("designScheme.list")

    rows = db_rows(
        scheme_db,
        "SELECT run_id, status, completed_at FROM design_scheme_runs WHERE run_id LIKE 'dsr_uj04_%' ORDER BY run_id",
    )
    assert [row["status"] for row in rows] == ["failed", "failed"], rows
    assert all(row["completed_at"] for row in rows), rows
