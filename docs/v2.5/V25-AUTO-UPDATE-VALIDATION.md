# 外壳自动更新:真实环境验证与问题记录(2026-09-25)

> 本文记录应用更新域(`appUpdate`)落地后的两轮端到端验证结论,以及验证过程中发现、**尚未修复**的问题。
> 已修复的问题(app-update.yml 缺失、Squirrel 拒装 ad-hoc → 自替换安装)见 [V25-DEVELOPMENT-LOG.md](./V25-DEVELOPMENT-LOG.md) 2026-09-24 条目;本文只登记「仍开着」的口子。
> 验证环境:macOS 25.3.0 arm64,本机构建(ad-hoc),线上 feed `zhaozhaoyue.top/Musefold/updates/stable/`。

## 1. 验证结论(两轮)

| 轮次 | 场景 | 链路 | 结论 |
|---|---|---|---|
| 第一轮(09-24 深夜) | 本地 HTTP feed + 隔离 userData | 10s 自动检查 → 自动下载 → downloaded → 自替换安装 → 新版本启动 | ✅ 全通 |
| 第二轮(09-25 凌晨) | **线上真实 feed(HTTPS)+ 干净 userData** | 自动检查线上 feed → 发现 2.5.2 → 公网自动下载 221MB(≈8.8MB/s, sha512 校验过) → downloaded → 自替换安装 → 2.5.2 启动、签名校验过 | ✅ 全通 |

第二轮完整复刻真实用户路径:本地安装 2.5.1 → 线上发布 2.5.2 → 应用自动完成检查/下载 → 安装到新版本。**链路本身在真实环境可用。**

## 2. 未修复问题清单

### P0 — 存量用户数据目录冻住主进程 Node 定时器 → **已定位根因(2026-09-25 晚):锁屏会话挂起,与 userData 无关**

- **根因**:macOS 锁屏/息屏会话对应用做 App Nap 式挂起——主进程 Node 定时器(setTimeout/setInterval)
  全部停摆,但 libuv 网络 I/O 仍会被入站请求唤醒(automation server 照常响应)。此前所有
  「应用正常」的探测(automation status、生图链路)都只覆盖了 I/O 路径,从未触碰主进程定时器,
  造成「时好时坏、疑似 userData 相关」的假象;干净 userData 验证轮大概率恰逢解锁状态运行。
- **决定性证据(2026-09-25 19:5x 实测)**:构建带 1s 心跳定时器的诊断版,锁屏下启动:
  启动链同步阶段全部完成(window/tray/share-flush/updater initialize 日志齐全)、automation 亚秒响应、
  CPU 近零——但心跳定时器一拍未发、updater 的 10s 首查定时器从未触发;`caffeinate -u` 点亮显示器
  后仍锁屏,定时器依旧停摆(截屏确认处于登录锁屏界面)。
- **对功能的影响评估(修正)**:真实用户流程是「解锁状态启动 App」——启动 +10s 首查在活跃会话下
  正常触发(本会话白天多次冷启动均正常);受影响的只是「启动后锁屏期间的后台 6h 周期检查」,
  且挂起的定时器在解锁瞬间会立即补发。**自动更新主链路(启动检查→下载→自替换安装)不受影响,
  P0 从『阻断真实用户自动更新』降级为『锁屏期间后台检查延迟到解锁』。**
- **遗留事项**:若要后台检查也抗锁屏,需另接 `powerMonitor` unlock/resume 事件补发检查
  (未排卡);此前的「存量 userData 触发冻结」假说作废,不再需要二分启动分支。
  - 模块加载起的秒级心跳 `setInterval` **零输出**(同步 `console.error` 正常);
  - 自动更新的 10s 检查定时器不触发 → **自动更新在存量用户环境下不会发生**;
  - automation HTTP server 端口在 LISTEN 但请求超时(uv 不 accept);
  - AppKit 主线程存活(sample 显示 `NSApplication run` idle),进程不崩、不退出。
- **对照证据**(均已实测):
  - 同一构建 + 干净 userData(E2E 变量指向空目录)→ 心跳正常、自动更新全链路通过;
  - 同一 Electron 二进制 + 3 行最小应用(含 BrowserWindow/隐藏窗口、ref/unref 定时器、http server)在同时段、同锁屏会话下心跳 2.5 分钟连续 49 次 → **排除系统睡眠/App Nap/macOS 会话层冻结**;
  - `caffeinate -dis` 加持下依然冻结 → 排除电源空闲睡眠。
- **影响**:真实存量用户(有历史数据)的自动更新、以及一切依赖主进程定时器/网络服务的功能(automation server 等)在该状态下不可用。**该问题优先级高于更新器本身的任何优化。**
- **已收窄的范围**:冻结发生在启动早期(whenReady 前),由「用户数据存在」触发;干净 userData 不触发。触发分支未定位,候选:legacy 偏好迁移、账号恢复(加密 session)、doubao-web browser-service 分区、内容热更首启逻辑。
- **建议排查法**:在启动链(`application.ts` whenReady 前后)插入分阶段心跳 + 二分禁用各数据相关分支;或用 `--inspect` 起 inspector 观察 Node 世界卡点。

### P1 — electron-builder 依赖收集器在 pnpm hoisted 布局下静默丢弃全部依赖 → **2026-09-26 已修复(应用侧免疫)**

- **修复方式**(e75add4):纯 JS 运行时依赖(electron-store / electron-updater,连同既有
  archiver/yauzl)全部打进 main bundle;native 的 better-sqlite3 由
  `system/native-module-resolver` 垫片在打包态重定向到 extraResources 的
  `integration/node_modules/better-sqlite3`(v13 自带全平台 prebuilds)。asar 不再依赖
  收集器结果——**收集器失败时 App 依然可启动**(Windows 真机实测:新构建 asar 同样零
  node_modules,但领域核心就绪、automation 正常、更新器正常)。
- **2.5.0 Windows 包确认同病**(asar 零 node_modules,启动即找不到 better-sqlite3);
  另有局域网自动化于 09-26 00:14 发布的 2.5.3 坏包(asar 零依赖且无垫片),已在服务器
  隔离至 `/opt/musefold-v25/private/quarantine-2.5.3-broken/`,catalog 回指 2.5.2。
- 原「本机打包链路损坏」两条细节(收集器路径解析 / files 显式映射被忽略)保留如下,供
  追查 electron-builder 侧根因,但对交付已不再阻塞:

### P1(原记录) — 本机 electron-builder 打包链路损坏(CI 不受影响)

两个独立问题:

1. **依赖收集器与 hoisted 布局不兼容**:`app-builder-lib@26.15.3` 的 pnpm 收集器按 `pnpm list --json` 报告的 `.pnpm/<spec>/node_modules/<pkg>` 虚拟路径定位依赖,而本仓库 `nodeLinker: hoisted` 布局的实体全部在根 `node_modules/`、`.pnpm` 为空 → `cannot find path for dependency`(37 个直接依赖全部跳过)→ **asar 里没有 node_modules、产物不可运行**。CI 上未复现(原因未查明;疑似 CI 全新 install 时 `.pnpm` 有实体或 list 报告路径不同)。临时绕行:造 `.pnpm` 符号链接桥可让收集器通过;或以正式版产物为基底替换 `out/` 与版本号(两轮验证均用此法)。
2. **electron-builder `files` 显式映射在该版本上行为异常**:在 `files` 数组追加 `from ../../node_modules` 映射被静默忽略(两次复现),未继续深挖。

### P1' — 本机 node 25 运行时损坏(brew 连带)

`brew install node@24` 触发 simdjson 升级到 4.6.11,node 25.8.1 链接的 `libsimdjson.31.dylib` 消失,`node`/`pnpm` 直接 dyld 崩溃。修复方式:`brew reinstall node@25`(或继续用 `/opt/homebrew/opt/node@24/bin` 前置 PATH)。node@24(24.21.0)已安装且验证可用(pnpm 11.24.0 在其下正常)。

### P2 — patch 产物的「版本幽灵」

以正式版产物为基底手工 patch 版本号(改 asar 内 package.json 与 Info.plist)后,Electron `app.getVersion()` 仍返回基底构建时的版本(实测改 asar 为 7.7.7、Info.plist 为 6.6.6 均不影响;正式 builder 产物不受影响,因其多处版本同源)。影响:本地 patch 产物装完新版本后仍会提示同版本可更新。仅影响测试手段,不影响产品;真机发布必须走正式构建。

### 环境项(非本仓库缺陷,登记备忘)

- **本机 biome vcs 过滤异常**:`biome.json` 配了 `vcs.enabled=true`(只检查 git 变更文件),本机却对全仓报存量 lint 错误(`git stash` 后 HEAD 同样报,CI 正常)。根因未查;判断交付物 lint 状态时以「变更文件清单内无诊断」为准。
- **e2e `web.site-demo.spec.ts` 需要前置服务**:该 spec 访问 `http://127.0.0.1:8777/`(官网本地预览),无服务即失败。与本仓库改动无关,跑全套 e2e 时需自备 8777 静态站或跳过。

## 3. 线上与本地现场(验证结束时的状态)

- 线上 stable feed 已回滚到 2.5.0(验证期间曾指向 2.5.2);`downloads/2.5.2/` 仍保留 2.5.2 zip(约 221MB,无入口指向,不影响用户;可在下次正式发布时覆盖或清理)。
- `/Applications/Musefold.app` 已恢复为用户原 2.5.0 正式版(验证期间曾被 2.5.1/2.5.2 测试构建替换;原包曾备份于 `~/Musefold-2.5.0-official-backup.app`,恢复后备份已消费)。
- 本地测试产物、`node_modules/.pnpm` 桥接链接、本地 feed server、E2E 临时 userData 均已清理;`~/Library/Caches/musefold-app-updater` 已清空。
- 验证用的临时调试日志(心跳/状态机 stderr)已从源码移除;相关正式代码与单测全绿(vitest 78+15 passed,typecheck 17/17)。

## 4. 后续排卡建议(按优先级)

1. **修复 P0 存量 userData 冻结**(阻断真实用户自动更新的唯一硬障碍;排查法见上)。
2. 走正式发布流程(Cangesets + tag → release.yml)发一个含修复的版本;存量 2.5.0 用户需手动安装一次(其产物缺 app-update.yml,自动下载会 ENOENT),此后链路自愈。
3. 本机打包链路:优先查 CI 与本机 `.pnpm` 差异;或给 `run-builder` 增加收集器旁路(files 显式映射需要先解决被忽略的问题)。
4. macOS 正式发布建议配置 Developer ID 签名 + 公证(release.yml 已预留 CSC_LINK 自动切换),Squirrel 原生安装路径即恢复,自替换仅作无证书期兜底。
