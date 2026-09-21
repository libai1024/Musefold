// RSPOS 层③（正式主进程 Electron，只写不跑：Playwright 首跑由主代理统一执行）。
// RS-MAP 后「已验证会话的账号云默认 R（run_scheme）」正向 e2e：
//   真实 Hono/PG/Graphile worker（CloudServiceProcess：Testcontainer postgres:17-alpine
//   + 应用迁移 + worker fixture）+ 真实 Electron 主进程/渲染壳确认卡/safeStorage/SQLite；
//   joint-a 真实 sign-in/status 登录并激活账号云为默认 provider（合成 fixture 按
//   body.username 选人，Electron 发 body.email → joint-a 落默认分支 joint-owner-a，须用 joint-a）；
//   正式 R 方案（n=2 → 2 张原图）经 automation 入口发起，不带 providerId、不带 consent →
//   run 级确认卡（estimatedPoints=null → 成本未知）→「允许生成」→ 每张原图各自一次
//   managed 子发送（count:1、独立 desktop-rs-v1: Idempotency-Key）→ 双图成功、费用未知。
// 断言：本地恰好 1 条 run 级 spend request（interactively confirmed）、2 个 managed
//   children、2 条 spend calls、2 个互不相同 remote key；远端 2 次 POST /api/v1/generations、
//   2 次 n:1 provider 调用、2 张回执；2 个本地投影资产文件存在；同键重放返回冻结结果
//   （202 首提 / 200 重放），POST/provider/回执计数均不增长。未验证边界（登出 409
//   PAYMENT_IDENTITY_UNBOUND）由 electron.sp-p5-runs.spec.ts D 段钉死，本文件不重复。
// 证据：tests/v25/.results/rspos/（首跑后由主代理回填实际结果）。

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { type ElectronApplication, expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { CloudServiceProcess } from '../../apps/desktop/electron/system/__tests__/fixtures/cloud-service-process';
import { managedRunRecordSchema } from '../../packages/desktop-contracts/src/managed-generation';
import { cloudEvidence, cloudLocalState, connectCloud } from './cloud-crash-helpers';
import { seedFormalTextScheme } from './design-scheme-test-helpers';
import { desktopDbPath, launchV25App, v25ShellPage } from './electron-helpers';

/** 服务侧 snapshot（CloudServiceProcess 'snapshot' 动作，见 desktop-cloud-service-process.ts）。 */
type Snapshot = {
  calls: Array<{ method: string; path: string; key?: string | null; status?: number }>;
  providerCalls: Array<{ authorized: boolean; body: { n?: number } }>;
  runs: Array<{ id: string; status: string }>;
  receipts: Array<{
    idempotency_key: string;
    status: string;
    cost_provenance: string;
    cost_points: number | null;
  }>;
  assets: unknown[];
};

/**
 * automation 控制面 /v1/scheme-runs 出参的既有冻结形态
 * （automation-run-spend.ts payload() + automation-durable-runs.ts 的 runId 包装）。
 */
type SchemeRunPayload = {
  jobId: string;
  kind: 'scheme';
  status: string;
  assets: Array<{ path: string }>;
  costPoints: number | null;
  runId?: string;
};

type SpendRequestRow = {
  state: string;
  outcome: string | null;
  error_code: string | null;
  approval_source: string | null;
  estimated_points: number | null;
  idempotency_key: string | null;
};

type SpendCallRow = {
  kind: string;
  state: string;
  cost_source: string;
  reported_points: number | null;
};

/** run 级本地账本：record_json 以 desktop-contracts schema 解析，SQL 行只做窄投影。 */
function readManagedRunLedger(userData: string) {
  const db = new Database(desktopDbPath(userData), { readonly: true });
  try {
    const requests = db
      .prepare(
        `SELECT state,outcome,error_code,approval_source,estimated_points,idempotency_key
         FROM automation_spend_requests WHERE action = 'run_scheme'`,
      )
      .all() as SpendRequestRow[];
    const row = db.prepare('SELECT record_json FROM managed_run_requests').get() as {
      record_json: string;
    };
    const record = managedRunRecordSchema.parse(JSON.parse(row.record_json));
    const calls = db
      .prepare(
        `SELECT kind,state,cost_source,reported_points FROM automation_spend_calls
         WHERE request_id = ? ORDER BY ordinal`,
      )
      .all(record.requestId) as SpendCallRow[];
    return { requests, record, calls };
  } finally {
    db.close();
  }
}

// biome-ignore lint/correctness/noEmptyPattern: Playwright requires a destructured fixture argument.
test('已验证会话账号云默认 R：run 级确认后每张原图一次 managed 子发送，同键重放零新发送', async ({}, testInfo) => {
  test.skip(
    process.env.RUN_DATABASE_TESTS !== 'true',
    '需要 RUN_DATABASE_TESTS=true 与 Docker（Testcontainer postgres:17-alpine），身份/Provider/S3 为合成 fixture',
  );
  test.setTimeout(300000);
  const service = new CloudServiceProcess();
  let app: ElectronApplication | undefined;
  let userData = '';
  try {
    const info = await service.ready;
    await service.request('startWorker'); // 队列消费者先就位：子发送入队即被消化。
    const snapshot = () => service.request<Snapshot>('snapshot');

    // ---- joint-a 真实登录（sign-in/status/execution-binding HTTP）并激活账号云为默认 ----
    const first = await launchV25App('musefold-rspos-verified-r-', {
      env: { MUSEFOLD_API_URL: info.baseUrl },
    });
    app = first.app;
    userData = first.userDataDir;
    await connectCloud(await v25ShellPage(app));
    await app.close();
    app = undefined;

    // ---- 种入正式 R 方案（n=2 → 2 张原图），二次启动经 automation 入口发起 ----
    seedFormalTextScheme(userData);
    const second = await launchV25App('musefold-rspos-verified-r-', {
      reuseUserDataDir: userData,
      env: { MUSEFOLD_API_URL: info.baseUrl },
    });
    app = second.app;
    const page = await v25ShellPage(app);
    await expect.poll(() => existsSync(join(userData, 'automation.json'))).toBe(true);
    const discovery = JSON.parse(readFileSync(join(userData, 'automation.json'), 'utf8')) as {
      port: number;
      token: string;
    };
    const call = (path: string, init: RequestInit = {}, timeoutMs = 30000) =>
      fetch(`http://127.0.0.1:${discovery.port}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${discovery.token}`,
          'content-type': 'application/json',
          ...init.headers,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });

    // ---- 发起 run：不带 providerId、不带 consent → run 级确认卡 ----
    // 确认期间 HTTP 提交就地挂起（submit → startManagedDurableRun → authorize 等 UI 回执）：
    // 先保存未 await 的 run promise，等卡出现并批准后才 await。
    const runBody = JSON.stringify({
      inputs: { topic: 'rspos verified cloud r' },
      brief: '固定输入',
      n: 2,
    });
    const submitted = call(
      '/v1/schemes/scheme_e2e_formal/runs',
      { method: 'POST', body: runBody, headers: { 'idempotency-key': 'rspos-verified-r' } },
      90000,
    );
    submitted.catch(() => undefined); // 断言失败路径不留未处理拒绝。

    const card = page.getByTestId('automation-confirm-card');
    await expect(card).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('automation-confirm-meta')).toContainText('2 张'); // n=2 原图。
    await expect(page.getByTestId('automation-confirm-meta')).toContainText('成本未知'); // estimatedPoints=null。
    await expect(card).toContainText('运行方案「E2E 文本海报方案」'); // promptPreview 来自方案名。
    await page.getByTestId('automation-confirm-approve').click();
    const response = await submitted;
    expect(response.status).toBe(202); // 首次提交；同键重放是 200。
    const started = (await response.json()) as SchemeRunPayload;
    expect(started.kind).toBe('scheme');

    // ---- 轮询方案 run 至终态成功（drive 在后台完成两张原图的 managed 子发送） ----
    const runState = async () =>
      (await (await call(`/v1/scheme-runs/${started.jobId}`)).json()) as SchemeRunPayload;
    await expect.poll(async () => (await runState()).status, { timeout: 60000 }).toBe('success');
    // 终态先行、资产投影随后落盘（finishChildLocal 在回执后下载）：轮询本地投影补齐后
    // 再取最终载荷与账本，避免把投影窗口误判为缺行。
    await expect.poll(() => cloudLocalState(userData).assets.length, { timeout: 30000 }).toBe(2);
    const terminal = await runState();
    expect(terminal.jobId).toBe(started.jobId);
    expect(terminal.costPoints).toBeNull(); // provider 无点数上报 → 总费用未知。
    expect(terminal.assets).toHaveLength(2);
    expect(terminal.runId).toMatch(/^dsr_/); // 冻结的方案 run id 随载荷返回。

    // ---- 本地 SQLite 账本：恰好 1 条 run 级 spend request（interactively confirmed） ----
    const ledger = readManagedRunLedger(userData);
    expect(ledger.requests).toHaveLength(1);
    expect(ledger.requests[0]).toMatchObject({
      state: 'terminal',
      outcome: 'success',
      error_code: null,
      approval_source: 'confirmation', // run 级确认卡放行，不是预算/consent。
      estimated_points: null,
      idempotency_key: 'rspos-verified-r',
    });
    const keys = ledger.record.children.map((child) => child.remoteKey);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2); // 2 个互不相同的 remote key。
    for (const key of keys) expect(key).toMatch(/^desktop-rs-v1:/);
    for (const child of ledger.record.children) {
      expect(child.callId).not.toBeNull(); // 每张原图各自领取过一次发送。
      expect(child.receipt).toMatchObject({ status: 'succeeded', costProvenance: 'unknown' });
    }
    expect(ledger.calls.map((row) => row.kind)).toEqual(['image', 'image']); // 2 条 spend calls。
    for (const row of ledger.calls)
      expect(row).toMatchObject({
        state: 'unknown',
        cost_source: 'unknown',
        reported_points: null,
      });

    // ---- 本地投影：2 个子运行成功 + 2 个资产文件真实存在 ----
    const projected = cloudLocalState(userData);
    expect(projected.runs).toHaveLength(2);
    for (const run of projected.runs)
      expect(run).toMatchObject({ status: 'success', actual_cost: null });
    expect(projected.assets).toHaveLength(2);
    for (const asset of projected.assets) expect(existsSync(asset.media_path)).toBe(true);

    // ---- 远端/服务侧：每张原图一次普通 POST、n:1 provider 调用、各一张回执 ----
    const remote = await snapshot();
    const posts = remote.calls.filter(
      (entry) => entry.path === '/api/v1/generations' && entry.method === 'POST',
    );
    expect(posts).toHaveLength(2);
    expect(posts.map((entry) => entry.key).sort()).toEqual([...keys].sort());
    expect(remote.providerCalls).toHaveLength(2);
    for (const providerCall of remote.providerCalls)
      expect(providerCall).toMatchObject({ authorized: true, body: { n: 1 } });
    expect(remote.receipts).toHaveLength(2);
    for (const receipt of remote.receipts)
      expect(receipt).toMatchObject({
        status: 'succeeded',
        cost_provenance: 'unknown',
        cost_points: null,
      });
    expect(remote.assets).toHaveLength(2);

    // ---- 同键重放：返回冻结结果，远端计数零增长 ----
    const replayResponse = await call('/v1/schemes/scheme_e2e_formal/runs', {
      method: 'POST',
      body: runBody,
      headers: { 'idempotency-key': 'rspos-verified-r' },
    });
    expect(replayResponse.status).toBe(200);
    const replayed = (await replayResponse.json()) as SchemeRunPayload;
    expect(replayed).toMatchObject({
      jobId: started.jobId,
      kind: 'scheme',
      status: 'success',
      costPoints: null,
    });
    expect(replayed.assets).toHaveLength(2);
    const afterReplay = await snapshot();
    expect(
      afterReplay.calls.filter(
        (entry) => entry.path === '/api/v1/generations' && entry.method === 'POST',
      ),
    ).toHaveLength(2); // 重放不补发任何子发送。
    expect(afterReplay.providerCalls).toHaveLength(2);
    expect(afterReplay.receipts).toHaveLength(2);

    await testInfo.attach('rspos-verified-r-evidence.json', {
      body: cloudEvidence(
        {
          boundary:
            'Real Electron main process + renderer confirm card + safeStorage + SQLite, real Hono/PG/Graphile worker (Testcontainer postgres:17-alpine). Synthetic identity/Provider/S3, no paid upstream. Run-level confirmation resolved via the real UI before the managed per-original child sends.',
          started: { httpStatus: response.status, jobId: started.jobId },
          terminal,
          spendRequest: ledger.requests[0],
          children: ledger.record.children,
          calls: ledger.calls,
          projected: { runs: projected.runs, assets: projected.assets },
          remote: {
            generationPosts: posts.length,
            providerCalls: remote.providerCalls,
            receipts: remote.receipts,
          },
          replayed,
        },
        userData,
      ),
      contentType: 'application/json',
    });
  } finally {
    await app?.close();
    await service.stop();
    if (userData) rmSync(userData, { recursive: true, force: true });
  }
});
