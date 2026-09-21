import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { type ElectronApplication, type Page, expect, test } from '@playwright/test';
import { sha256, writeDesignSchemePackageBytes } from '@musefold/scheme-package';
import {
  PNG,
  mixedPackage,
  refreshDocument,
} from '../../packages/scheme-package/src/__tests__/fixtures';
import { designSchemeDbPath, launchV25App, v25ShellPage } from './electron-helpers';
import { localInvoke as invoke } from './local-execution-fixture';

/**
 * 真实层端到端：分享导入中途 SIGKILL（进程崩溃，非正常回滚路径）→ 残留的
 * design-scheme-imports/<dsch_> 目录由下一个 owner PID 在启动清扫中回收。
 *
 * 为什么不用 fs 钩子精确停在写中途：主进程 bundle 静态引入了压缩后的 fs 具名导出
 * （writeFileSync/mkdirSync），测试无法像 staging-pause spec 那样经
 * syncBuiltinESMExports 拦截。替代协议（概率窗口 × 重试保证确定性）：
 *   1. 先完成一次正常导入，其 dsch 根有 DB 引用——清扫必须放它过（存活证明）。
 *   2. 放大包内 4 张 PNG（canonical 导入只 hash+落盘不解码），拉长 mkdir→DB 提交窗口。
 *   3. 发起第二次导入并紧轮询 imports 根；一旦出现新 dsch 目录立即 SIGSTOP 主进程，
 *      只读打开设计方案库验证提交状态：已提交则 SIGCONT 等完成重试；未提交则 SIGKILL
 *      ——这就是一次真实的中途崩溃（目录已建、引用未提交、无人回滚）。
 *   4. 预置非候选 notes.txt，重启（新 PID、复用 userData）：断言孤儿目录被启动清扫
 *      回收、已提交导入字节不变且端到端可读、notes.txt 原样、gc 意图表清空、
 *      用户选中的原始 .musefold.design 文件字节不变。
 * 所有路径均取自 helper 返回值（TMPDIR 可能被剥离，禁止假设 /private/var）。
 */
test('导入中途 SIGKILL 崩溃 → 新 PID 启动清扫回收孤儿，已提交导入与用户原件不受影响', async () => {
  test.skip(process.platform === 'win32', 'SIGSTOP/SIGKILL 协议仅 POSIX');
  test.setTimeout(300_000);

  const temp = mkdtempSync(join(tmpdir(), 'musefold-imports-orphan-e2e-'));
  const input = join(temp, 'input.musefold.design');
  const DSCH = /^dsch_[0-9a-f]{32}$/;
  const delay = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
  const safeReaddir = (dir: string): string[] => {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  };
  const hashFile = (path: string) => sha256(readFileSync(path));
  const hashTree = (root: string): string => {
    const lines: string[] = [];
    const walk = (dir: string, rel: string) => {
      const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
        a.name < b.name ? -1 : 1,
      );
      for (const entry of entries) {
        if (entry.isDirectory()) walk(join(dir, entry.name), `${rel}/${entry.name}`);
        else lines.push(`${rel}/${entry.name}:${hashFile(join(dir, entry.name))}`);
      }
    };
    walk(root, '');
    return sha256(Buffer.from(lines.join('\n')));
  };
  const stateOf = (pid: number) => {
    try {
      return execFileSync('ps', ['-o', 'state=', '-p', String(pid)], { encoding: 'utf8' }).trim();
    } catch {
      return '';
    }
  };

  // 放大 fixture 的 4 张 PNG：保留原始 PNG 头（魔数嗅探与 IHDR 尺寸仍与 manifest 一致），
  // 追加确定性填充把每张拉到 ~3MB —— canonical 导入对图片只 hash+写盘，不解码。
  const BIG_BYTES = 3 * 1024 * 1024;
  const filler = Buffer.alloc(BIG_BYTES - PNG.length);
  for (let i = 0; i < filler.length; i += 1) filler[i] = (i * 31 + 7) & 0xff;
  const big = Buffer.concat([PNG, filler]);
  const bigHash = sha256(big);
  const fixture = mixedPackage();
  for (const [path, bytes] of fixture.content) {
    if (path !== 'scheme.json' && bytes.equals(PNG)) fixture.content.set(path, big);
  }
  for (const entry of fixture.manifest.content.entries) {
    if (entry.relativePath.endsWith('.png')) {
      entry.sizeBytes = big.length;
      entry.contentHash = bigHash;
    }
  }
  for (const snapshot of fixture.manifest.sourceSnapshots) {
    for (const file of snapshot.files) {
      if (file.relativePath.endsWith('.png')) {
        file.sizeBytes = big.length;
        file.contentHash = bigHash;
      }
    }
    snapshot.totalBytes = snapshot.files.reduce((sum, file) => sum + file.sizeBytes, 0);
  }
  for (const asset of fixture.manifest.assets) {
    asset.byteSize = big.length;
    asset.contentHash = bigHash;
  }
  for (const image of fixture.manifest.document.repositoryImages ?? []) {
    image.contentHash = bigHash;
  }
  refreshDocument(fixture.manifest, fixture.content);
  writeFileSync(input, await writeDesignSchemePackageBytes(fixture.manifest, fixture.content));
  const originalSha256 = hashFile(input);

  let app: ElectronApplication | undefined;
  let userDataDir = '';
  try {
    const first = await launchV25App('musefold-imports-orphan-', {
      env: { MUSEFOLD_E2E_DESIGN_IMPORT_PATH: input },
    });
    app = first.app;
    userDataDir = first.userDataDir;
    const firstPid = app.process().pid as number;
    const page = await v25ShellPage(app);
    const importsRoot = join(userDataDir, 'design-scheme-imports');
    const dbPath = designSchemeDbPath(userDataDir);
    const schemesCount = () => {
      const db = new Database(dbPath, { readonly: true });
      try {
        return (db.prepare('SELECT COUNT(*) AS n FROM design_schemes').get() as { n: number }).n;
      } finally {
        db.close();
      }
    };
    const gcCount = () => {
      const db = new Database(dbPath, { readonly: true });
      try {
        return (
          db.prepare('SELECT COUNT(*) AS n FROM design_scheme_import_gc').get() as { n: number }
        ).n;
      } finally {
        db.close();
      }
    };

    // 注：不直接 import '@musefold/contracts'——根 node_modules 目前没有该链接
    // （fixtures 经 packages/scheme-package 自身的 node_modules 可正常解析），
    // 这里按既有 wire 形状手动收窄即可，本 spec 断言的是文件系统与库行为。
    interface StagedPackage {
      stagedPackageId: string;
      packageHash: string;
      formatVersion: number;
    }
    const prepare = async (): Promise<StagedPackage> => {
      const result = (await page.evaluate(async () => {
        const bridge = (
          window as unknown as {
            musefoldV25: {
              prepareDesignSchemeImportPackage(
                input: unknown,
              ): Promise<{ ok: boolean; data?: unknown; message?: string }>;
            };
          }
        ).musefoldV25;
        return bridge.prepareDesignSchemeImportPackage({ acceptedFormatVersions: [2] });
      })) as { ok: boolean; data?: unknown; message?: string };
      if (!result.ok) throw new Error(result.message ?? 'Package staging failed');
      const staged = result.data as {
        status?: string;
        stagedPackageId?: string;
        packageHash?: string;
        formatVersion?: number;
      };
      if (staged?.status !== 'staged' || !staged.stagedPackageId || !staged.packageHash) {
        throw new Error('Expected staged package');
      }
      return {
        stagedPackageId: staged.stagedPackageId,
        packageHash: staged.packageHash,
        formatVersion: staged.formatVersion ?? 2,
      };
    };
    const runImport = async (stagedPage: Page, staged: StagedPackage) =>
      (await invoke(stagedPage, 'designSchemes.importPackage', {
        stagedPackageId: staged.stagedPackageId,
        packageHash: staged.packageHash,
        formatVersion: staged.formatVersion,
      })) as { scheme: { id: string } };

    // 第 1 步：一次完整成功的导入。它的 dsch 根有 DB 引用，是清扫必须放过的存活对照。
    const imported = await runImport(page, await prepare());
    const dschNames = () => safeReaddir(importsRoot).filter((name) => DSCH.test(name));
    expect(dschNames()).toHaveLength(1);
    const keptRootName = dschNames()[0] as string;
    const keptDir = join(importsRoot, keptRootName);
    const keptTreeHash = hashTree(keptDir);
    const knownRoots = new Set<string>([keptRootName]);
    const baseline = schemesCount();
    expect(baseline).toBe(1);
    expect(gcCount()).toBe(0);

    // 第 2 步：反复「发起导入 → 目击新目录 → 冻结 → 查提交」直到命中真正的中途崩溃。
    // 已提交（DB 计数已增）就恢复让它跑完并重试；未提交就 SIGKILL。
    let killed = false;
    let orphanName = '';
    let committedExtra = 0;
    for (let attempt = 0; attempt < 5 && !killed; attempt++) {
      const stagedAgain = await prepare();
      const pid = app.process().pid as number;
      const invokePromise = runImport(page, stagedAgain).then(
        (result) => result,
        () => 'killed-before-result' as const,
      );
      const deadline = Date.now() + 60_000;
      let fresh = '';
      while (Date.now() < deadline) {
        fresh = dschNames().find((name) => !knownRoots.has(name)) ?? '';
        if (fresh) break;
        await delay(2);
      }
      if (!fresh) throw new Error('Import never created its design-scheme-imports directory');
      process.kill(pid, 'SIGSTOP');
      await expect.poll(() => stateOf(pid)).toContain('T');
      if (schemesCount() > baseline + committedExtra) {
        // 提交已赢下竞速：恢复、等待完成、把新根登记为已知存活对照后重试。
        process.kill(pid, 'SIGCONT');
        await invokePromise;
        committedExtra += 1;
        const committed = dschNames().find((name) => !knownRoots.has(name));
        if (committed) knownRoots.add(committed);
        continue;
      }
      killed = true;
      orphanName = fresh;
      process.kill(pid, 'SIGKILL');
    }
    expect(killed).toBe(true);
    const orphanDir = join(importsRoot, orphanName);
    await app.close().catch(() => undefined);
    app = undefined;

    // 崩溃现场：目录在、引用无（DB 计数仍为基线）——没有任何进程会走正常回滚路径。
    expect(existsSync(orphanDir)).toBe(true);
    expect(schemesCount()).toBe(baseline + committedExtra);
    // 预置非候选文件：形状不匹配 dsch_ 模式，清扫必须原样保留。
    const notes = join(importsRoot, 'notes.txt');
    writeFileSync(notes, 'operator note: not an import staging dir\n');

    // 第 3 步：新 owner PID 启动（启动清扫在窗口创建前完成，拿到 shell 页即清扫已跑）。
    const second = await launchV25App('musefold-imports-orphan-', {
      reuseUserDataDir: userDataDir,
    });
    app = second.app;
    expect(app.process().pid).not.toBe(firstPid);
    const page2 = await v25ShellPage(app);

    // 孤儿被回收；所有已提交导入根存活且字节不变；非候选文件原样。
    await expect
      .poll(() =>
        safeReaddir(importsRoot)
          .filter((name) => DSCH.test(name))
          .sort(),
      )
      .toEqual([...knownRoots].sort());
    expect(existsSync(orphanDir)).toBe(false);
    expect(hashTree(keptDir)).toBe(keptTreeHash);
    expect(readFileSync(notes, 'utf8')).toBe('operator note: not an import staging dir\n');
    // 意图表先记后删：成功回收后表清空；方案行数与崩溃前一致（孤儿从未提交）。
    await expect.poll(gcCount).toBe(0);
    expect(schemesCount()).toBe(baseline + committedExtra);
    // 已提交导入在新 PID 端到端可读（引用即属主，素材齐活）。
    const detail = (await invoke(page2, 'designSchemes.get', { id: imported.scheme.id })) as {
      document: { assetIds: string[] };
    };
    expect(detail.document.assetIds).toHaveLength(2);
    // 用户选中的原始包文件从头到尾未被碰过。
    expect(hashFile(input)).toBe(originalSha256);
  } finally {
    await app?.close().catch(() => undefined);
    if (userDataDir) rmSync(userDataDir, { recursive: true, force: true });
    rmSync(temp, { recursive: true, force: true });
  }
});
