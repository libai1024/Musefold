# v2.5 后续开发执行记录

**当前开发（2026-09-13，B76永久清理专项）：** S01/S02保留，双端会话purge/清空、共享契约/客户端/IPC/HTTP、SQLite0011永久身份与旧库导入保护、PG恢复/生成/重试锁协调已接。本地101P、PG与实际HTTP联合36P，旧迁移兼容补验5P；当前check36/36和源码扫描通过。继续S04共享回收站、S03实际双宿主竞争及S05完整宿主/产物门禁，B76保持未勾选，管理员未开始。源码归属、夹具及兼容首败见[测试续篇§5.75.3](./V25-MIGRATION-TESTING-CONTINUED.md)。

**最新验收（2026-09-13，B75）：** 分类主表硬删、最小持久删除身份、旧行分批回填、引用/清理事务竞争、90天日志裁剪后不复活，以及Desktop core/IPC/共享界面保护均按原六组要求核对通过。05cd8f1f…完整E2E488P/7S/0F/0flaky，check36/36、明确双宿主build、源码和45实际ZIP/2明确UI替身扫描通过；17坏输入另列。API661P/1专用小时S及Worker101P/0S保留未变后端输入的02841618…归属。首轮route错误、红→绿及全部条件skip保留。只关闭B75，任务包84/91，下一Session S01–S05；完整v2.5和后续管理员目标不变。[逐条验收](../../tests/v25/.results/b75/acceptance.json)与[测试续篇§5.74.6](./V25-MIGRATION-TESTING-CONTINUED.md)。

> 本文接续 2026-09-07 的迁移规划，记录用户随后启动“开始完成剩余的 2.5 版本的开发工作”后的实际开发。任务定义见 [任务卡](./V25-MIGRATION-GOALS.md)，初始盘点见 [路线图](./V25-MIGRATION-ROADMAP.md)。记录批次完成不等于整包完成。当前 goal 已授权“剩余 v2.5 全部完成后开发管理员端”；尚未启动 G-OPS，先闭合迁移。下文各历史批次的“未纳入/可选后台”保留当时范围，不覆盖这一后续授权。

## B9：费用、云资产、Worker 与生产验证基础（本批切片验收通过，整包未闭合）

### 基线与修改范围

- 分支：`spec/2026-09-01_migrate-v21-to-v25`；起始 HEAD：`dcdf8d036c27f87e33de301ad4077a3110bb5b7f`。
- Cursor 的 B2–B8 大量未提交源码与测试保留。本轮在该工作树上继续，没有重置、恢复 stash、修改桌面版本号或发布远程代码；独立 logo 草稿保持原样。
- 本机：macOS arm64，Node `v25.8.1`、pnpm `11.24.0`。CI 配置使用 Node 24；本机通过不能代替 Windows/CI 结果。
- 涉及账号/Provider 的测试使用假凭据、回环服务与 disposable PostgreSQL；本轮不以此宣称真实上游生图、生产部署或远程 OAuth 通过。
- 仍为 dirty 工作树，manifest 的 commit/clean-tree 约束保留；执行结果先记于本文，不能将 HEAD 当作全部未提交源码版本后强填 manifest pass。

### 实际改动及验收边界

| 对应任务 | 本轮交付 | 当前边界 |
|---|---|---|
| G-SPEND-01 | 逐入口确定用户提交、本地 Agent、Web 方案 Agent、Cloud MCP 和管理员授权边界 | 详见 [费用边界与矩阵](./V25-SPEND-BOUNDARIES.md)；Cloud MCP 继续七工具只读 |
| G-SPEND-02 | 三类本地 Agent 花费共用同进程预算协调器；零预算确认、并发预留、冻结请求/幂等、过期回执、窗口/停服清理、未知费用、拒绝/失败/取消审计 | **部分完成**；跨进程幂等、预留持久化、月度/账号身份归属和费用对账仍开放 |
| G-CLOUD-01 | 上传图片安全暂存、可信图片解码、本人读取/删除、完整文档创建时事务晋升、资产引用验证、上传失败与过期清理衔接；追加 `uploaded` 来源 | 基础切片已通过定向和统一源码检查；不代表 GitHub 来源采集、云 Agent、run、市场或专用包云端链路已完成 |
| G-WORKER-01/02 | 真实子进程终止/新 PID 重启、Graphile reconcile、上游已发送 unknown 不重发、取消/重复投递/上传后崩溃、epoch 与 heartbeat 竞争 | 22 项 integration 已通过；复用生产 task/HTTP/S3 客户端，但不是生产 bin/容器/真实上游验收，也未穷举全部竞争组合 |
| G-DATA-02 | 修复已晋升方案资产可能被 GC 误删；正常及软删方案的对象键仍受永久引用保护 | 物理 purge 前保留；全资产 GC、来源包/staging 发现与两设备数据验证未整卡关闭 |
| G-RELEASE-01 | 默认 E2E 改用本次 Next standalone 生产构建；禁止复用旧 dev server；持久 JSON/HTML 报告；三 workflow 增强发布依赖与报告门禁 | 生产 Web 和 CI 基础已实现；CI runner 实际执行尚未发生 |
| G-RELEASE-02 | 独立严格 package 配置，按平台/架构定位产物，缺包失败；验证 asar/平台、数据库完整性/迁移、重启持久化；追加 bundle 字节匹配 | 最终 macOS arm64 ad-hoc 包严格冒烟 1/1，含当前 desktop bundle 每个文件的 SHA-256 匹配；Windows 未验 |
| G-RELEASE-04 准备 | 新增生产 Web Dockerfile、静态资源复制、非 root 运行、Compose Web 服务与同源地址；补 MCP OAuth discovery 转发 | Docker Web+假 API 冒烟通过；旧 `deploy:prod`/rollback 仍为 v1.1，生产发布/回滚未验 |

### 已执行的阶段测试

下表保留每个实际运行边界，定向结果不简单相加成“整包通过”。本机完整日志在 `.results/v25/2026-09-07-development/`；Playwright 报告在 `tests/v25/.results/`，均为临时验证产物。CI 已配置成功/失败均上传报告，尚无本轮 CI artifact 链接。

| 检查与命令 | 实际结果 | 证据范围 |
|---|---|---|
| 初始 `pnpm run check` | 退出 0；Turbo 35/35，其中 32 项缓存命中；另一次 Web production build 通过 | B8 起点可用，不能当成本轮新源码最终检查 |
| 初始 `pnpm --filter @musefold/api run test:integration` | 3 文件、41/41，退出 0 | 改动前的真实 PG 基线 |
| `pnpm exec playwright test -c tests/v25 --project web-desktop --project web-mobile` | 144 passed、6 skipped，退出 0；未重生视觉快照 | 首次生产 standalone 的两视口回归，业务网络仍使用各 spec 的 mock；报告已归档到 `.results/2026-09-07-initial/`（相对 `tests/v25`） |
| 初次 `pnpm run package:mac:adhoc` | 退出 0，签名验证通过，生成 arm64 App/DMG/ZIP | 本轮整合中的中间构建，后续源码变化后须重新打包 |
| 初次 `pnpm exec playwright test -c tests/v25/playwright.package.config.ts` | 1/1，退出 0 | 当时的 asar/架构、受管迁移、SQLite integrity、主题重启恢复；后加的 bundle 字节匹配尚未计入此结果 |
| 发布 helper 单测 | `pnpm exec vitest run tests/repo/v25-standalone-web.test.ts tests/repo/v25-package-artifact.test.ts`：2 文件、6/6 | 缺生产构建、构建 ID 不一致、错平台/缺产物失败；静态文件复制与旧资源清除 |
| Web 宿主单测 | `pnpm --filter @musefold/web-next run test`：8 文件、25/25 | 含同源 API/MCP/OAuth discovery rewrite 合同 |
| Cookie Origin 验证 | `pnpm --filter @musefold/api exec vitest run src/auth/__tests__/middleware.test.ts`：1 文件、2/2 | Web 公共 origin 写请求允许、跨站拒绝；会话解析为 fixture |
| 共享 features | 44 文件、548/548 | 含 `uploaded` 素材在 canonical 方案相册的来源展示；不是云 Agent E2E |
| Worker 最终定向 | `pnpm --filter @musefold/worker run test:integration`：4 文件、22/22；普通 `test`：55 passed、22 默认 skipped；typecheck 通过 | 新进程 11 项 + GC 保护 2 项 + 既有 9 项；普通单测 skip 不代替 integration |
| 费用定向 | 9 文件、120/120；Cloud MCP 独立 3 文件、12/12 | 精确命令与尚缺组合见 [费用验证记录](./V25-SPEND-BOUNDARIES.md) |
| Web Docker | `docker build -f apps/web-next/Dockerfile -t musefold/web:v25-validation .`：首次因新增 origin 消费方缺失失败，修复后退出 0 | 生产 standalone 镜像，无用户密钥进入构建 |
| Web 容器运行 | `node scripts/verify-v25-web-image.mjs musefold/web:v25-validation`：退出 0；页面、17 个静态资源、API、MCP POST、OAuth discovery、非 root 全过 | 两个隔离容器，上游是 echo API；不证明账号登录、付费生图或远程 OAuth |
| repo 守卫 | `pnpm exec vitest run tests/repo`：12 文件、54/54 | 含 manifest 现有约束、文件尺寸与新增 release helpers |
| 最终 API integration | 4 文件、54/54，退出 0 | 含 13 项新资产/PG/S3/用途隔离用例；CLI migrate 从 0006 升到 0007 并保留旧行 |
| 最终 Worker integration | 4 文件、22/22，退出 0（21:02，本轮总验收复跑） | 真进程、租约/epoch 和 GC 引用保护 |
| uploaded 桌面兼容 | 定向 7 文件、130/130；core/主进程 typecheck 通过 | v6→v7 升级保留资产/关系；专用包 export→import→v25 详情→媒体读取保真 |
| 最终 `pnpm run check` 重跑 | 退出 0；35/35（27 缓存），根 212 文件、1656/1656；features 44 文件、548/548 | 完整统一源码门禁。首次两条 archive 用例 5 秒超时，单独 15/15 后无额外 DB 并发完整重跑通过；未改其断言或超时 |
| 最终 API 镜像 | `musefold/api:v25-validation` 构建退出 0；无网络容器验证 PNG/JPEG/WebP 完整解码、SVG 拒绝通过 | Node 24.20.0、Linux arm64；生产依赖可运行，未连接真实账号/Provider |
| 最终 `pnpm run test:e2e` | 退出 0；219 passed、8 skipped、0 failed、0 flaky，4.6 分钟；Web desktop 73/2 skip、Web mobile 71/4 skip、Electron 75/2 skip | 当次 production standalone + Electron build；未更新视觉快照。报告归档在 `tests/v25/.results/b9/e2e/` |
| 最终 `pnpm run package:mac:adhoc` | 退出 0；重新构建、ad-hoc 签名验证通过；DMG/ZIP 已生成 | macOS arm64；不是正式签名、公证或用户安装流程验收 |
| 最终严格 package-smoke | `pnpm exec playwright test -c tests/v25/playwright.package.config.ts`：1/1，0 skip，退出 0，9.8 秒 | 真实打包 App 两次启动；当前 desktop bundle 文件与 asar 中对应文件逐一 SHA-256 相等；IPC/SQLite integrity/受管 migration journal/主题重启恢复通过；报告在 `tests/v25/.results/b9/package/` |

### 中间失败和修复

1. 首次新增报告使用相对路径，被 Playwright 解析到 `tests/v25/tests/v25/.results`，引发生成 HTML 被 lint 扫描。已改为基于 config 目录的绝对输出路径，错误目录只移动本轮生成报告后移除；没有批量格式化业务源码或删除测试。
2. 中间 `check` 在云资产/Worker 文件仍写入时因格式检查失败而中止。该次失败明确保留，后续必须在各 owner 交付后统一重跑。
3. 新 `uploaded` 来源触发 features label 与桌面包 PreparedAsset 类型缺口；前者已补，后者已通过独立方案库 v7 升级、真实包往返、v25 详情和媒体读取验证，不用类型断言掩盖不兼容。
4. 发布审核发现 `.results` 隐藏目录默认可能不上传，以及 Compose 新 Web `:3000` 与 API 公共 origin `:8787` 不一致。已分别加入 hidden artifact/JSON 存在门禁，并将 Compose 默认公共地址对齐 Web。

### 本批统一验收结论与后续入口

- `check`、API/Worker integration、双端 E2E、最终 macOS 包和严格冒烟均通过。源码冻结清单在打包后复核，1037 个文件无变化；结果属于本批切片，不是 v2.5 完整发布验收。
- E2E 的 8 个 skip：3 个真实账号登录用例未注入凭据；1 个真实生图 Key 连接用例未注入密钥；3 个壳用例按目标视口排除；1 个移动端会话删除入口仍暂缓，归 G-UI-01。macOS 原生全屏测试仍有既有事件 fallback，Windows 几何分支未在本机执行；不能从总通过数推导这两项已验证。
- G-CLOUD-02..06、持久费用账本、全资产/真实旧数据治理、Windows 产物、全安全扫描和生产/回滚/远程 MCP 保持开放。后续开发继续沿对应任务卡执行。

本批 macOS 产物摘要（完整记录在 `tests/v25/.results/b9/package-artifacts.json`）：

| 产物 | SHA-256 |
|---|---|
| `app.asar` | `aa4a25b5de7b6eac022d89b6acc1336601ef4e0ad7279bb58f6f9e37aae09ea5` |
| `Musefold-2.5.0-arm64.dmg` | `9e872f55e8cf685ce137153d71f1ecbbabafea9b8c2ba4c400361f8b03ae57dc` |
| `Musefold-2.5.0-arm64-mac.zip` | `313d79828ea6886094d7982db7d77bc5a391a3f6f519cc553efa01095b7c2038` |

当前冻结源码摘要：`663bb64d0f379229dad88f8ec72889ade5ee8ff87d59fd986f2da2a71e9e0601`，1037 个源码/配置/测试文件；清单在 `tests/v25/.results/b9/source-files.json`。摘要仅为本地工作树追踪，不绕过正式 manifest 的 clean commit 约束。

## B10：云端方案运行、持久费用与发布扫描（本批切片验收通过，整包未闭合）

本批接续 B9 的已验收切片；以下先保留实施过程，再列 B10 自身最终验证，B9 数字不继承为本批通过。

| 任务 | 本批实现方向 | 当前阶段证据 |
|---|---|---|
| G-CLOUD-03 | 服务端冻结固定四步计划，复用现有 generation queue/epoch，持久 executionId、双账本、取消与引用保护 | API integration 67/67、Worker integration 47/47；限制张数 1/2/4，未支持流程明确拒绝；没有真实付费调用 |
| G-CLOUD-03 桌面兼容 | canonical `cloud-run` 和 `output` 角色；独立方案库 v8；包导入/导出保真，不能自动获得本机 trial/封面资格 | 定向 7 文件 133/133；本批统一 check 与完整 E2E 已通过，平台限制见下文 |
| G-SPEND-02 / SP-D | 受管请求/调用/策略账本、事务预留、发送边界、成本 provenance 和 unknown 恢复，分入口接生产 | 真实 SQLite 迁移/仓储/进程和 G/R/S 接线已验；专项 17 文件/174 tests 通过，付款 owner 与恢复产品面等仍开放 |
| G-RELEASE-03 | 源码规则、合成 canary、归档内容扫描、脱敏报告、CI 门禁及安装包范围清点 | scanner/解包/发布依赖定向 3 文件 75/75；真实 Electron 运行出口随 B10 完整 E2E 通过；最终新包扫描见下方统一验收 |

发布扫描中已发现：旧包包含 workspace 测试源码与 `.turbo` 日志，日志及测试夹具带入本机路径。已在 builder 过滤已 bundle 的 `node_modules/@musefold`、测试与 Turbo 缓存；后续新包必须重新验证并保留完整扫描结果，不能用路径例外直接略过。第三方文档中的示例路径与本机路径分开：发布包扫描具体构建用户路径及已定义 secret 规则，面向远程的运行输出可开启一般用户路径规则。该扫描不是依赖漏洞、恶意代码或所有未知密钥形状的完整审计。

本批阶段报告：`tests/v25/.results/b10/security-installers-filtered.json`（重新生成的 DMG/ZIP 与 App，三份各校验 asar/CLI/MCP）；`tests/v25/.results/b10/security-electron/`（真实 Electron 合成密钥回归）。首次旧安装器扫描退出 1、20 条构建路径命中；修复后的完整内容扫描退出 0。扫描能力和未验证出口详见 [安全验证记录](./V25-SECURITY-VALIDATION.md)。

Web 方案运行最小接线已进入 B10：共享 hook 只提交用户选择，按 prepare → run 原样等待终态，cancel 与事件按 executionId 对齐；create/modify 不开放。发现并修复双宿主方案运行忽略 Composer 张数的问题，1/2/4 现随行。阶段单测：features 46 文件/555 tests，Web host 8/26，Desktop host 1/30；共享 hook 类型夹具错误修正后 1/6 重跑通过。Web 浏览器首轮 8 passed/4 failed，原因是新增 mock 将方案状态错误写为普通任务的 running，canonical 应为 executing；已改测试夹具，最终重跑 12/12、0 skipped/failed（双视口各 6，13.5 秒），报告归档 `tests/v25/.results/b10/cloud-run-web/`。未改断言或视觉快照掩盖失败。

费用最终专项（22:07）：17 文件/174 tests、0 failed/skip，含 G 7 与 R/S 13（重叠统计不相加），root typecheck 与定向静态检查通过。新增发送瞬间/读取 body 期间取消均为 HTTP 0、调用账本 0。该结果不代替真实 Electron 的逐点 kill/relaunch、可信付款 owner、账单核对或恢复产品面；详见费用边界 §8。

桌面 B10 首次构建失败：electron-vite 内置静态 import 正则将错误文案尾词 `import` 及随后的引号误识别为模块导入，把 CommonJS shim 插入 SQL 字符串。修复仅重述该初始化错误文案，错误码和费用事务保持不变；重建结果以下次实际命令记录，不修改依赖或冻结面。

桌面重建已退出 0（`b10-desktop-build-rerun.log`），受影响仓储 1 文件/20 tests 重跑通过。接下来使用新桌面 bundle 与本次 Web standalone 运行完整 E2E。

B10 完整 `pnpm run test:e2e` 已退出 0：224 passed、8 skipped、0 failed、0 flaky，4.7 分钟；Web desktop 75/2 skip、Web mobile 73/4 skip、Electron 76/2 skip。含本次 production standalone、新桌面 bundle、真实 Electron 合成密钥出口及完整视觉回归，未重生快照。报告归档 `tests/v25/.results/b10/e2e/`；8 个 skip 的原因与 B9 相同，不能用于宣称真实账号/Key或移动会话删除通过。统一 check 与最终包另行验收。

Windows 解包扫描增加解包前清单验证与 installer/nested 共享累计预算、解包后逐项核对、失败脱敏报告。最终定向 3 文件/75 tests 通过、0 skipped，Biome 通过；其中 3 项使用本机 macOS arm64 的真实 7zz，未运行 Windows/NSIS。

B10 首轮统一 `check` 因新生成的四个迁移 metadata JSON 格式不符合 Biome 失败（PG 0008 snapshot/journal、SQLite 0007 snapshot/journal）；只格式化这四个新文件，未改 SQL、迁移语义或内联 bundle。已重跑完整命令，首轮日志保留 `b10-check-final.log`，重跑见 `b10-check-rerun.log`。

B10 最终统一 `pnpm run check` 重跑退出 0：Turbo 35/35、0 cached，根 227 文件/1882 tests，features 46/555，Web host 8/26，API-client 2/39；API 普通套件 66 passed/66 gated skipped、Worker 普通套件 63 passed/47 gated skipped，隔离 integration 另验，不能用这些 skip 代替。日志 `b10-check-rerun.log`。检查后 1169 项源码/配置/资源身份均未变化；随后才启动本批新包构建。

最终 `pnpm run package:mac:adhoc` 退出 0，macOS arm64 App/DMG/ZIP 新建并通过 ad-hoc 签名校验。随后严格 package-smoke 1 passed、0 skipped/failed/flaky，9.7 秒：实际包启动两次，当前 bundle 与 asar 字节一致，8 条受管 SQLite 迁移及新费用表、integrity、重启持久化通过。报告归档 `tests/v25/.results/b10/package/`；未以中间旧包替代。

### B10 最终本地统一验收

| 门禁 | 结果 | 报告/范围 |
|---|---|---|
| `pnpm run check` | 退出 0；35/35、0 cached；根 227 文件/1882 tests，features 46/555 | `b10-check-rerun.log`；保留首次 metadata 格式失败 |
| API/worker integration | API 6 文件/67 passed；Worker 5 文件/47 passed；均退出 0、0 failed/skipped | `.results/v25/2026-09-07-development/cloud-run/`；真实隔离 PG/queue，Provider/S3 为测试替身 |
| PG 0007→0008 与 replay | 两次 `pnpm run db:migrate` 均退出 0；journal 8→9→9 | repository/local-run/uploaded 旧资产及普通生成旧字段保留，新 cloud-run 接受，重复迁移不变；`cloud-run/migration-0008-report.json` |
| `pnpm run test:e2e` | 退出 0；224 passed/8 skipped/0 failed/0 flaky | `tests/v25/.results/b10/e2e/`；Web desktop 75/2 skip、mobile 73/4 skip、Electron 76/2 skip |
| `pnpm run package:mac:adhoc` | 退出 0；签名验证通过 | `b10-package-final.log`；macOS arm64 ad-hoc App/DMG/ZIP，不是正式签名/公证 |
| 严格 package-smoke | 退出 0；1/1、0 skip、9.7 秒 | `tests/v25/.results/b10/package/`；当前 bundle、8 条内联迁移、新费用表、SQLite integrity 与两次启动持久化 |
| source 扫描 | 退出 0；1073 文件、11,028,502 字节，0 findings/errors/accepted exceptions | `tests/v25/.results/b10/security-source-final.json`；显式源码/配置范围 |
| App/DMG/ZIP 内容扫描 | 退出 0；6 targets、0 findings/errors/accepted exceptions；三份 App 各 3 项身份验证 | `tests/v25/.results/b10/security-installers-final.json`；不等同依赖漏洞/恶意代码/未知密钥格式审计 |

本批本地源码/配置/资源冻结清单 1169 项，经过 check、打包及扫描后内容均未变，摘要 `f084887742aaedb35dc4b27a1b1fab59571701735c2a4131acf661fa6c86dfb9`；清单 `tests/v25/.results/b10/source-files.json`。此清单包含 resources，范围宽于 source 扫描，不将两者文件数混用。HEAD 仍不包含 dirty 工作，正式 manifest 的 clean commit 约束不放宽。

本批产物身份（完整字节数及生成时刻在 `tests/v25/.results/b10/package-artifacts.json`）：

| 产物 | SHA-256 |
|---|---|
| `app.asar` | `08e494faef049afccca6675de93815aacd21a63b8f256b1bd2571f8a92426e15` |
| `Musefold-2.5.0-arm64.dmg` | `c55e0c68bb28d8042de0ef1f70f65a08d82856d32d15fbbb23081e6c4530fc2a` |
| `Musefold-2.5.0-arm64-mac.zip` | `e4ed0096841b56310b782edf56650b08cb7a2befc80e1572bfdf02e71ab9bf9c` |

本批完成的是固定云方案运行、本地持久费用与发布扫描的已列切片，整包仍未闭合。下一阶段按 G-CLOUD-02/04/05/06、费用边界 §10 的 SP-P1–6、完整 GC/真实数据与恢复、Windows/CI、生产部署回滚和远程 MCP 验收继续。现有 Cloud MCP 七工具只读、管理员可选增量和冻结面保持既有范围。

PG 精确升级补验的首次 fixture 缺少 canonical `promptProgram` 而失败，补齐测试文档后在新的 disposable PostgreSQL 17 重跑通过；未修改源码或迁移来迁就夹具。API integration 脚本也已纳入原来漏跑的详情测试文件，最终 67 项包含其 3 个真实 PG 用例和 1 个路由单测。API/worker 阶段 Docker 镜像早于最后 redirect/abort 修复，只证明 Node 24/Linux arm64 的依赖导入和 API Sharp 解码；未称为最终源码镜像或生产验收。

任务包校验 `check_spec_package.py --slug 2026-09-01_migrate-v21-to-v25 --compact` 退出 1：21/26、仍有 1 项验收清单未勾选，符合整包未完成的状态。B10 已列切片的勾选不改变设计方案全链、parity 和最终验收的未完成状态；日志 `b10-spec-check.log`。

云运行的支持范围、权威计划/双账本/参考图与取消边界、精确命令和未验项已汇总于[云运行验证记录](./V25-CLOUD-RUN-VALIDATION.md)。下一条可独立 goal 的市场搜索首刀见 G-CLOUD-04，可信付款与恢复首刀见费用边界 §10.8。

## B11：GitHub 市场发现与分页（本批本机验收通过）

上一 goal 回合为实际进展：B10 源码、集成、E2E、包和扫描已验收归档。B11 已重新核对当前 service 的市场 501、contracts 的 query/limit/cursor 与候选形状，继续 G-CLOUD-04。市场搜索只做发现；安装/来源确认仍等待云 Agent，付款身份与执行回执按费用边界后续推进。本批修改后 B10 产物仍保留为历史身份，不自动算本批通过。

B11 共享发现屏已增加按原 query/limit/cursor 读取下一页、跨页去重、缓存原始获取时间、未支持安装的解释，以及下一页失败保留现有结果的重试入口。请求仅由明确搜索动作触发；同轮重复点击合并，迟到的旧搜索/旧分页响应不覆盖新查询。共享分页保留每页 canonical 结果，不将多页拼成超出合同 100 条上限的伪页面。

阶段结果：features 新 7 项与原方案 26 项共 33/33，typecheck 通过；API-client 新 17 项与原方案 9 项共 26/26，typecheck/Biome 通过。Web production build 后专项 18/18、0 skipped/failed/flaky、14.9 秒，PC/移动各 9 项；报告和市场截图归档 `tests/v25/.results/b11/market-web/`，已人工看图并断言无横向溢出。该浏览器批次使用可控 HTTP fixture，尚不证明真实 GitHub/API 链路。

中间失败保留：新 hook 测试初次将 PlatformProvider 的 runtime 属性误写为 value，修正夹具后通过；fetchedAt 合同支持 string/number，初次 typecheck 暴露排序前未规范化，已改为有效日期校验及 ISO 归一，并增加 epoch 0 和越界日期测试；末次 E2E 格式检查的一处换行已格式化。未降低断言或重生视觉基线。


共享 hook 只读审查补发现同步 throw 会在请求 ref 写入前完成 finally，导致重试复用已拒绝 Promise。已把 gateway 调用延至 ref 登记后的微任务，并追加首页/分页同步 throw 后恢复、多跳游标回环、混合多页缓存最早日期 4 项。最终定向 2 文件 37/37，features typecheck/Biome 通过，日志 `b11-market/features-hook-review-*`。

B11 完整 `pnpm run test:e2e` 已退出 0：230 passed、8 skipped、0 failed、0 flaky，4.5 分钟；Web desktop 78/2 skip、mobile 76/4 skip、Electron 76/2 skip。命令先重新构建 Web production standalone 与 desktop bundle，未重生视觉快照；最终共享 hook 修复包含在该次构建。报告归档 `tests/v25/.results/b11/e2e/`。8 个 skip 与 B10 相同，未注入真实账号/Key，移动会话删除与平台几何限制不能从通过总数推导已验证。

真实公开 GitHub 探测已通过：同一个 production market service 使用 native fetch 查询 `topic:design-system`，第一页和下一页各 5 项、各 HTTP 200，中间另一主体的相同查询命中公共缓存且原 fetchedAt 不变，合计 2 次匿名 GET。记录型 limiter 只证明调用路径；真实 Better Auth 与 PG RateLimiter 另有隔离集成测试，不冒充生产登录/部署。样本 `b11-market/public-github-report.json`、复现脚本 `public-github-probe.ts`。


API 真实鉴权/PG 专项首次 4/5，唯一失败为 per-user 429 错将 retryable 与是否允许 stale 绑定。已分离重试语义和缓存权限：429 可重试，用户入口超额仍禁止读取 stale；另修并发上游 429 必须保留最长冷却期限，避免较短响应覆盖较长期限。之后完整 `pnpm --filter @musefold/api run test:integration` 退出 0，7 文件/72 passed、0 skipped/failed，含本批市场 5 项与原 B10 的 67 项；日志 `b11-market/api-integration-final.log`。覆盖真实会话无/伪造/过期/撤销均不能搜索，公共缓存与分页无方案/生图写入，PG 用户限额与跨用户/实例上游限额原子生效，窗口过期后恢复；GitHub 为计数 fixture，公开上游另验。


API 就地专项 2 文件/73 tests、0 skipped/failed，含 4 项真实 loopback HTTP 成功/307/慢正文/503，各仅 1 GET、重定向目标 0、无 Authorization、无自动重试；API typecheck 和 7 文件 Biome 通过，日志 `b11-market/api-targeted.log`、`api-typecheck.log`、`api-biome.log`。这里只替换市场专属 blocker，Agent/专用包仍保留原有降级断言。

B11 首次统一 check 退出 1：`.results` 内公开探测脚本及 B10 精确迁移复现脚本/JSON 报告的三处格式错误（后两份在 B10 check 后生成）。已保留三个 `.preformat.txt` 原始副本，只做格式化；未修改测试断言、业务源码、SQL 或门禁配置。当前 1175 项源码/配置/资源身份仍一致，重跑日志 `b11-market/check-rerun.log`，首次日志 `check-final.log`。


### B11 最终统一验收

| 门禁 | 最终结果 | 证据与边界 |
|---|---|---|
| `pnpm run check` | 退出 0；Turbo 35/35、24 cached；根 228 文件/1899 tests，features 47/566，API-client 3/56 | `b11-market/check-rerun.log`；API 普通套件 132 passed/71 gated skipped，Worker 63/47 gated skipped；真实 API 集成另验，不能用 skip 代替 |
| API 市场专项 | 2 文件/73 passed、0 skip | 4 项 native loopback HTTP；API typecheck/Biome 通过，`api-targeted.log` |
| API integration | 7 文件/72 passed、0 skip，退出 0 | 市场 5 项 + 既有 67 项；真实 Better Auth/PG，GitHub/Provider/S3 使用测试替身 |
| 共享与 client 专项 | features 37/37；client 26/26 | 并发/分页/缓存/同步 throw、错误映射和只读请求；与统一套件重叠，不相加 |
| Web/桌面完整 E2E | 230 passed/8 skipped/0 failed/0 flaky，退出 0，4.5 分钟 | `tests/v25/.results/b11/e2e/`，Web desktop 78/2 skip、mobile 76/4 skip、Electron 76/2 skip；跳过及平台限制沿 B10 |
| 真实公开 GitHub | 2 次 GET 均 200；缓存重读 HTTP 0 | `public-github-report.json`；实际排名不作为稳定断言，无账号登录/付费操作 |
| source 内容扫描 | 1079 文件、11,119,868 字节；0 findings/errors/accepted exceptions，退出 0 | `tests/v25/.results/b11/security-source-final.json`；不是依赖漏洞或恶意代码审计 |

源码/配置/资源冻结清单 1175 项，经统一检查及扫描后复核零变化，摘要 `48622163e1cf3c9784dd5434204cc106314e9fe1ea949a3766e4c988fbd254dc`，清单 `tests/v25/.results/b11/source-files.json`；包含 resources，范围宽于 source 扫描。HEAD 不包含 dirty 工作，不能用此本地摘要替代发布 clean commit 身份。

G-CLOUD-04 的公开发现切片已完成本机验收；市场安装及 Agent 创建/修改归 G-CLOUD-02，专用包归 G-CLOUD-05，完整三形态生命周期归 G-CLOUD-06。B11 没有重新打包或部署，B10 安装器保留为其历史验收产物。下一阶段优先接费用边界 §10.8–10.9 的可信主体/凭据与执行回执，同时可推进不付费的来源冻结/确认服务。§10.9 的 legacy 判定与恢复面仍是设计，不能算已实施功能。


B11 末任务包校验退出 1：22/27、检查清单仍有 1 项未勾选，原因是设计方案全链、共享 parity 和整包发布仍未完成；不将本批发现能力通过改写为全迁移通过。日志 `b11-market/spec-check.log`。九份相关文档 164 个相对链接均可达，最后源码身份复核仍为零变化。


## B12：可信账号/凭据身份、legacy 恢复与来源读取器（实施中，未验收整批）

### 2026-09-07 文档交付检查点（历史记录）

以下至本小节结尾的“当前/尚未实施/未执行”均指 09-07 23:49 检查点。后续源码与验证以紧接的 09-08 记录为准；保留原始失败，不能继续把它们当当前 reader 状态。

上一 goal 回合完成了 B11 的真实实现与验证，分类为进展。本回合开始前复核 B11 的 1175 项源码/配置/资源摘要仍完全一致，之后才开始新修改。主线按费用边界 §10.9 处理当前登录按用户名覆盖 newApiUserId、relay/key 分段写入、旧 session 残留及 refresh 缺 CAS；同步保留证据充分用户的自动激活与证据不足用户的恢复路径，禁止全面拒登冒充完成。

拟分工：API/PG 主体与凭据事务；contracts/共享恢复入口/宿主兼容；按 owner 隔离的真实 New API HTTP fixture；独立的非付费 GitHub 固定 SHA 来源读取器。当前先交付迁移文档，身份实现停在设计检查点；来源读取器只产生受验证、有资源上限的服务端字节和 metadata，后续仍须持久来源会话、S3/GC 保护、确认与 Agent 编译。不把 reader 或新增字段当完整功能闭环，B11 的产物和数字仅作历史。

| 工作项 | 实际完成 | 待完成 / 证据限制 |
|---|---|---|
| SP-P1 架构核对 | 已核对固定 issuer + 上游 owner 与内部 principal 的分离、凭据语义版本、会话恢复模式、原设备证明、CAS/刷新租约与本次 session 补偿 | 尚未改生产 auth/account、contracts、PG schema 或迁移，尚无身份业务测试；恢复 DTO/接口名称属于设计 |
| New API 身份 HTTP fixture | 新增 `apps/api/src/__tests__/fixtures/new-api-identity-fixture.ts` 与就地测试；按 owner 隔离 JWT/refresh/token/key、可控前后故障/屏障、非秘密请求计数。23:36（Asia/Shanghai）定向 1 文件/13 passed、0 failed/skipped，API typecheck 与限定 Biome 通过 | 真实 loopback HTTP 测试设施；未接入生产身份/PG 验收，不能证明付款人或旧历史已恢复。首次误用根 Vitest 配置未发现文件，改用 API 包命令后执行成功 |
| GitHub 来源读取 | 新增内部 reader/archive/common 及就地测试共四个文件，基础实现已落盘；23:49 定向复跑退出 1，57 项中 51 passed/6 failed/0 skipped | 5 项参数化测试写法错误；1 项虚报解压尺寸时流处理超时，必须修复后重验。许可证仍取仓库 metadata，未核实固定 commit 内容。尚未接 HTTP 业务路由、PG/S3 或 Agent，不能解除 501 |
| 依赖 | API 增加精确 `yauzl@2.10.0`，离线安装退出 0，日志 `b12-dependencies.log`；生成锁文件同步此前已有 manifest 差异 | 整体兼容须在 B12 合流后重新跑统一门禁，不把安装成功当运行验证 |
| 文档与后续调度 | README、路线图、任务卡、测试手册同步 B11/B12 边界；SP-P1–6 及原迁移卡可直接作为后续 goal 范围 | 本次文档验证记录在测试手册 §5.5；原迁移任务包未完成，不改勾选框伪造通过 |

身份 fixture 的完整命令：`pnpm --filter @musefold/api exec vitest run src/__tests__/fixtures/__tests__/new-api-identity-fixture.test.ts`。**B12 尚未执行完整 check、API/worker 身份 integration、PG migration、E2E、打包或生产验收。** 后续接续时先核对本段与实际工作树，再完成 SP-P1 的 L-T1–8；已验收的 B11 数字不覆盖新修改。

来源 reader 的真实复跑命令：`pnpm --filter @musefold/api exec vitest run src/modules/design-schemes/__tests__/github-source-reader.test.ts`；退出 1，5.48 秒，完整日志 `.results/v25/2026-09-07-development/documentation-refresh/b12-reader-checkpoint.log`。阶段 typecheck 曾通过，但在新增测试之前；Biome 首次失败后改过两处源码，尚无最终复跑，均不能计为 reader 最终通过。后续先修流错误收敛及测试参数，再验证固定 commit 许可证依据、完整定向/类型/格式和统一门禁，才可消费此 reader 构建持久来源服务。该失败作为明确后续任务保留，没有扩大本次文档工作为来源服务实现。


### 2026-09-08 实施与阶段验证（Asia/Shanghai，统一验收进行中）

本次继续已启动的 goal，SP-P1 已从设计进入生产源码、数据库、共享界面和真实宿主验证；没有将整个 G-SPEND-02 勾选完成。管理员端获授权在剩余 v2.5 全部完成后接续，当前未启动。

| 范围 | 当前实现 | 尚未关闭的边界 |
|---|---|---|
| 可信主体、凭据与恢复 | `account-identity` 唯一契约；PG 0009 的身份、session 授权与恢复申请；稳定 API issuer/principal 与上游 issuer/owner 分离；凭据 ref/语义版本；旧证据探测、CAS、跨进程刷新租约和本次 BA session 补偿；重试、原设备核查/确认、独立空间与只读 binding 接口 | API 123 项、worker 47 项真实 PG 集成及两次 CLI migration 已通过。旧 run 未补写已核实 payer；COMMIT/cookie/断连、两真实 API PID 刷新与可信备份恢复另保留，详见费用边界 §10.9.5 |
| 桌面会话 | bearer、issuer、principal、auth epoch 一起 safeStorage 加密并原子写入；旧无来源文件保留但不转发；只在本地提交期间串行锁；切换服务器、迟到请求、登出失败与候选清理保持身份边界；独立空间 intent 在远程提交前持久化，保存失败/重启重放同一申请 | mock safeStorage/临时文件单测与真实 Electron 回环服务已验证；远端付费 execution receipt 属于 P2/3，本项不防替尚未接线的付费入队 |
| 共享恢复体验 | Web/桌面使用同一恢复面板：原因、申请、截止、重试、原设备核对/确认、明确创建独立空间；恢复期间云业务受限，账号变化清除旧 Query 投影与恢复意图 | UI 状态不代替服务端授权；原设备路径没有改成任意账号合并；无管理员代批花费 |
| 本机提示词库 | 可查看旧本机容器，按 20 条预览；用户确认后复制到全新、按 issuer/principal 隔离的本机库，或建立空库；CAS 核对来源 revision，保留旧库、不复制旧 consent/outbox，随后另行开启同步；hash 逐行、复制分批 | 仅提示词/文件夹/标签/使用记录及本机封面引用。历史图片/生成/设计方案不是这个复制范围；已有目标只能预览旧库，禁止覆盖合并 |
| GitHub reader | 固定 ref→SHA→同 SHA 归档；实际字节/条目/解压大小/CRC/并发受限；修复参数化测试和伪造解压尺寸的流收敛；许可证文件字节随 SHA 保留，canonical license 为 unknown/null | 内部 reader 不等于云来源会话、S3/GC、确认/Agent。未创建路由、未调用付费模型，G-CLOUD-02 仍开放 |
| New API transport | 完整请求/响应统一 10 秒超时，实际解码响应默认上限 2 MiB；取消/流回收，错误脱敏，无自动重试/重定向 | 上游真实账户和账单不属于这些回环测试 |
| MCP 与 OAuth | 恢复 session 阻断正常业务/BA 授权面；legacy 激活撤销旧 grant，JWT 检查持久 consent 与正常会话；原始 BA 会话 bearer 不可枚举 | 已通过实际 OAuth code/refresh/rotation 与 PG barrier 验证：原 consent lineage 持久继承，撤销后即使在途 rotation 返回 token 材料，也不能复活 MCP 权限或后续刷新；七工具仍只读。没有声称 BA 两步变成原子事务 |

已直接读取日志的阶段结果如下；互相重叠的文件不累加成“整包测试总数”：

| 日期/命令 | 实际结果 | 原始证据与范围 |
|---|---|---|
| 09-08 reader + 图片：`pnpm --filter @musefold/api exec vitest run src/modules/design-schemes/__tests__/github-source-reader.test.ts src/modules/design-scheme-assets/__tests__/image.test.ts` | 2 文件，74 passed，0 failed/skipped；对应 API typecheck 和限定 Biome 退出 0 | `.results/v25/2026-09-08-development/b12-source/validation-summary.json` 与日志；覆盖受控 HTTP、ZIP 与解码。09-07 的 51/6 保留为已修复历史失败 |
| 09-08 client：`pnpm --filter @musefold/new-api-client exec vitest run src/__tests__/client.test.ts src/__tests__/transport.test.ts` | 2 文件，60 passed，0 failed/skipped；包 typecheck/Biome 0；API fixture 13 passed | `new-api-client-response/validation-summary.json`；同目录保留一次并行旧 API hook 形状的 typecheck 失败，不能把它写成全 API 通过 |
| 01:06:14 桌面：`pnpm exec vitest run apps/desktop/electron/main/ipc-v25/__tests__/account-domain.test.ts apps/desktop/electron/main/ipc-v25/__tests__/account-session.test.ts apps/desktop/electron/main/ipc-v25/__tests__/gateway-bridge.test.ts apps/desktop/src/v25/__tests__/desktop-gateway.test.ts` | 4 文件，40 passed，0 failed/skipped | `desktop-identity/account-bridge-final.log`；含 18 个新会话/磁盘/竞态例。首次 7 项失败是期望 `AUTH_SESSION_EXPIRED` 与既有 `CONFLICT` 语义不符，核对后修正测试，未改弱生产拒绝条件 |
| 01:05:14 定向真实宿主：`pnpm exec playwright test -c tests/v25 tests/v25/web.account-recovery.spec.ts tests/v25/electron.account-recovery.spec.ts tests/v25/electron.sync.spec.ts` | 7 passed，1 skipped，0 failed/flaky；36.2 秒 | `tests/v25/.results/b12/e2e-initial/report.json` 与 HTML/trace；Web PC/移动各 2，Electron 3。跳过真实 TvT Key 验证，缺 `MUSEFOLD_E2E_IMAGE_API_KEY`。使用本次重建的 Next/桌面；之后桌面额外增加迟到响应体 cancel，已过上行单测，待全量新 build/E2E |
| 合流首次 `pnpm run check` | 退出 1，lint 6 项格式错误；Turbo 中止其他任务，不能把 EPIPE 当独立已执行失败例 | `desktop-identity/check-intermediate.log`/`biome-errors.log`；账号/app、OAuth 在途代码、PG 生成 JSON 与报告格式，按 owner 修复。此记录不计统一门禁通过 |

统一验收按后续时间点逐项回填；API/worker 真 PG integration、实际增量迁移/replay、全仓 check 和 source 扫描已有下述结果，完整 E2E 的首次失败与复跑分开记录。B12 尚无当前源码打包/Windows/CI/生产部署结果。P2/3 入队冻结及 durable execution receipt、worker 凭据版本/发送边界、P4/5 托管桌面接线继续在后续任务里实施，不能因身份中间件通过就让旧 queued run 读最新 key 自动发送。


01:18 后的补验与已确认差异：

- 后端共同冻结：完整 API integration 9 文件/123 passed、0 failed/skipped（含身份 39 与 OAuth lineage 12）；01:16:54 API 单测 21 文件/244 passed、120 gated skipped。01:17:08 OAuth 又新增两项，最终全仓 check 的 API 为 244 passed/122 skipped，独立集成 123 已包含全部 12 项 OAuth；保留时点差异，不伪改原日志。报告已归档 `b12-identity/validation-summary.json`，OAuth 为 `b12-oauth-lineage/validation-summary.json`。Bearer/cookie、签名/空格形式、无效 Bearer 加恢复 cookie 均经过真实 BA 路径验证。
- 桌面增加两项并发恢复修复：锁内读取最新 pending intent，防止早先快照的不同申请覆盖；pending 期间拒绝另一恢复动作清除 intent，刷新仍重放原申请。01:15:03 `account-session.test.ts` 20 passed，日志 `desktop-identity/recovery-intent-concurrency-final.log`。第一次复跑中 1 项失败是 HTTP fixture 重复使用已消费的 Response，修正每次生成响应后通过；旧失败保留。旧 40 项报告仍对应其原源码，不能增加数字伪装已跑同一命令。
- 全量 `pnpm run test:e2e` 首轮 233 passed、8 skipped、4 failed，约 6.1 分钟，保存于 `tests/v25/.results/b12/e2e-full-first/`。4 处失败：移动账号页新增“验证另一台设备”造成截图变化；未登录同步卡原断言全部 button=0 与新增合法本机只读预览冲突；后续两例在 Playwright 重启 worker 后缺失设置页导航前置。分别审图并仅更新 mobile/settings-signed-in.png、改为明确禁止同步/复制动作的断言、让设置分区 helper 自行进入设置页，未删除用例或放宽产品权限。视觉定向 1 passed，命令记录 `account-visual-update.log`，原图/新图/diff 随首轮报告保留。
- 复核又发现“看到 A 的确认后，B 已在主进程登录”的边界。新增非授权性 reviewRef 绑定当时 auth epoch/issuer/principal/scope，准备/开启同步时须与当前会话匹配；确认框显示的目标也来自同一 review 响应。SQLite/core 3 文件/36 passed、features 3/63 passed、类型和限定 Biome 通过；完整 E2E 首轮发生在其之前，后续已重建，见下一检查点。

### 09-08 01:27–01:46 统一检查点（现有实现门禁通过，P1 剩余项继续）

- `pnpm run check` 首个完整绿灯：35/35、0 cached，退出 0；根 233 文件/2013 tests、features 50/594、API 244 passed/122 gated skipped、worker 63 passed/47 gated skipped，双端构建通过。日志 `desktop-identity/check-final.log`。API/worker gated 项由各自真实 PG 集成覆盖，不计单测通过。
- `pnpm --filter @musefold/worker test:integration` 5 文件/47 passed、0 failed/skipped；隔离 PostgreSQL 17 下实际 `pnpm run db:migrate` 两次退出 0，迁移账本 10 条，最终 0009；另外实际 0008→0009 保留旧数据测试通过。命令/容器清理与日志见 `b12-identity/validation-summary.json`，不再登记为待执行。
- 01:26:26 再跑完整桌面账号/桥接原命令：4 文件/43 passed、0 failed/skipped，含 20 项会话竞态；`desktop-identity/account-bridge-complete.log`。repo 的 manifest/尺寸守卫 2 文件/13 passed，`repo-guards.log`。
- `node scripts/security/scan.mjs source --report tests/v25/.results/b12/security-source-final.json` 退出 0：1114 文件、11,748,863 字节、0 findings/errors/accepted exceptions，规则 v25-content-1。不是依赖漏洞或恶意代码审计，也不代表本次尚未生成的发布包。
- 第二次全量 E2E：237 passed、8 skipped、2 failed、0 flaky，4.8 分钟；`desktop-identity/e2e-final.log`，报告完整归档 `tests/v25/.results/b12/e2e-final-first/`。两例生产拒绝已生效，错误在新增 spec 将 canonical IPC 平铺 `{ok:false,code,message}` 写成 HTTP 嵌套 `error`；只改 spec，改用 canonical `BridgeEnvelope` 类型和精确平铺断言，保留换号/同账号重登、目标库未写入和 0 sync HTTP 断言。定向三例 3 passed、0 failed/skipped，13.2 秒，`e2e-workspace-review-fixed.log` 与对应归档保留。
- 第一份 1210 项清单摘要 `f21913398ac00415e1a1ea3c3c02a1ca83056c49099dd88fc55a9b9b0f7f7287` 在首个绿灯 check 后无变化；随后差异仅 `tests/v25/electron.workspace-recovery.spec.ts`。旧清单归档为 `tests/v25/.results/b12/source-files-before-ipc-test-fix.json`，按明确测试修正重新冻结 1210 项为 `6bc9e7fc6925d13b10b26ce1a9f8a225d7fd046c80c4c4eb92abf92cbb61c442`。第二次 check 35/35、30 cached，退出 0，复核无漂移；日志 `check-verified.log`/`source-verified-after-check.log`。最终全量 E2E 正在以此清单运行，完成后另记，不将 3 项专项当全量绿灯。

工作树仍包含未提交的 B2–B12 修改，HEAD `dcdf8d036c27f87e33de301ad4077a3110bb5b7f` 不包含这些增量；本地清单不能代替发布 clean commit。P1 全矩阵仍缺独立 COMMIT/cookie/登录断连、两真实 API PID 刷新和可信服务端备份核对；P2/3 未实施，旧 worker 仍读取当前最新 credential。这些限制是后续开发项，不因本批统一检查通过而消失。

最终复跑 `pnpm run test:e2e` 于 01:40:10 开始，288.7 秒、退出 0：**239 passed / 8 skipped / 0 failed / 0 flaky**。Web desktop 80 passed/2 skipped、mobile 78/4、Electron 81/2；运行前重新构建两个宿主。原始报告/HTML/trace 归档 `tests/v25/.results/b12/e2e-verified/`，命令日志 `desktop-identity/e2e-verified.log`。8 项跳过为 3 项真实账号未提供条件、1 项真实 Key 未提供、3 项视口专用排除及 1 项移动会话删除入口待实现；原生全屏 fallback 与 Windows 实机未验边界保留。

最终 source 扫描重新执行为 `security-source-verified.json`：1114 文件、11,748,874 字节、0 findings/errors/accepted exceptions、退出 0；与前次增加 11 字节来自已说明的 IPC spec 修正。全量 E2E 之后 1210 项清单零漂移，摘要仍为 `6bc9e7fc6925d13b10b26ce1a9f8a225d7fd046c80c4c4eb92abf92cbb61c442`。统一摘要 `tests/v25/.results/b12/validation-summary.json`。该记录封存此时点，之后继续的账号故障测试和可信备份恢复须重新核对源码与门禁，不回填成此次已通过。

### 09-08 01:46 后接续（独立源码，合流验收进行中）

此段继续 B12 的 P1 剩余项，并收尾 G-UI-01 的移动会话操作。01:46 的通过数仍绑定旧清单；下表专项不累加成一份全仓总数。

| 子范围 | 实现和真实证据 | 限制/原始记录 |
|---|---|---|
| L-T8 COMMIT 与 cookie | 新增独立集成测试；PG 延迟约束 trigger 在实际 COMMIT 阶段验证激活写入已可见后抛错，用非事务 sequence 作命中证据；只补偿本次 BA token。另一用例在单个 auth 实例注入非法 cookie path，实际 Headers 构造失败，保留已提交身份/key和原会话 | 初次 2 passed/1 failed 是新主体壳被错期望为 legacy unverified；修正符合源码的 verification_pending/来源证据断言，生产未改。Cookie 故障是测试实例配置注入，不是客户端 CRLF 漏洞 |
| L-T5 两真实 API PID、登录丢包 | 两份生产 `apps/api/src/bin.ts`，独立 PID/监听端口/PG pool，经同一个公开 issuer 代理；真正丢弃正常/受限登录回包，刷新 barrier 竞争 HTTP=1，另一进程 logout 后晚回不复活 | 与上行最终合跑：02:02:47，2 文件/7 passed、0 failed/skipped，10.2 秒；API typecheck、3 文件 Biome 退出 0；40 项相关文件验证窗无漂移。报告 `b12-identity-faults/validation-summary.json`。没有在 refresh→PG 保存间隙 kill API，也不宣称回包丢失自动回滚 |
| 到期恢复密文清理 | 新 `account-recovery-retention.ts` 接现有每小时 maintenance/cleanup；到期 candidate/backup 密文清空、revision 增加、lease 清除，保留非秘密来源；SKIP LOCKED、不反向锁 user/session | 02:10:30，`RUN_DATABASE_TESTS=true pnpm --filter @musefold/worker exec vitest run src/__tests__/account-recovery-retention.integration.test.ts`：1 文件/8 passed、0 failed/skipped，3.49秒；真 PG、实际 Graphile、并发写锁、1001条积压与单侧满批。每次执行每类上限1000，不是自然小时全局限额。日志 `b12-recovery-retention/`；首轮6项保留，不累加 |
| 移动会话操作 | `<md` 操作组常显、更多触区44px、保留同源菜单/AlertDialog；取消、非当前、当前与最后一条删除行为补齐。原 skip 说明滞后于已挂载的移动抽屉，修正稳定可达性并移除该产品性 skip | features 2 文件/58 passed、类型/Biome0。Root 重建双宿主后执行 `pnpm exec playwright test -c tests/v25 tests/v25/web.workbench.spec.ts --project web-desktop --project web-mobile --grep '删除会话经确认对话框'`：4 passed、0 failed/skipped，28.6秒。日志 `mobile-session-delete/`，报告 `tests/v25/.results/b12/mobile-session-delete/`；原8skip历史不改写 |
| 可信服务端备份 | 新隔离证据表/0010、固定0008来源读取、受控profile/独立审定、实际inspect-source/inspect/stage CLI、现申请retry验证与lease/CAS接线均在实现/联测 | 实际流程见[运维说明](./V25-ACCOUNT-RECOVERY-OPS.md)。来源审定依赖独立运维事实；工具验证配置/字节一致性，不创造历史证明。未完成最终联测前不登记通过，不将本机提示词复制当此功能 |

针对本段新源码还须统一 `db:migrate`/API与worker集成、check、完整E2E及source扫描；当前没有新安装包或生产部署。P2/P3执行回执和付费发送绑定继续开放，管理员阶段仍等待全部迁移完成。

接续首轮合流发现并保留以下失败；修复前的记录不追记成通过：

- 第一次完整 API：160 passed/2 failed，`b12-backup/api-integration-final.log`。完整 live 证据集 CAS 暴露恢复兼容缺陷：旧 relay refresh 已推进租约 revision，但随后发现 owner 不同，失败分支仍拿原 revision 提交受限会话，导致正确阻断激活的同时错误拒绝恢复登录。修复仅接纳同主体、密文、issuer/owner、keyVersion、expiry 不变且 revision 恰加 1、lease 已释放的记账快照；失败原因仍保留，不加入成功 proof。另一项 OAuth 回放测试将可自然递减的 `expires_in` 误当固定值；改为核对 token 布尔相等、固定到期点/范围/类型，并按真实经过时间校验 TTL，不在失败输出中打印 token。
- 第二次完整 API：162 项断言全部通过，但出现 4 个未处理 PG 57P01 teardown 错误，进程退出 1，`b12-backup/api-integration-complete.log`。已核对安装的 pg-pool 源码：客户端先从池列表移除，socket 的 `end` 异步完成，`pool.end()` 可提前 resolve。market/backup 两个测试在连接建立时登记实际 client `end` Promise，结束时等待全部关闭再停止容器；不加 sleep、不吞错误、不放宽断言。market 定向 5 passed/0 failed/skipped，类型/Biome 退出 0，报告 `b12-market-teardown/validation-summary.json`。
- 同期首次 `pnpm run check` 退出 1、34/35：根 2010 passed/3 failed，旧 archive/ZIP 大条目拒绝和 SQLite 子进程并发三例超时 5 秒，`b12-followup/check-first.log`。当时 API/worker 的多个 PG 集成容器与全仓测试并发；资源竞争只是待核实因素，保留断言和超时，后续串行复跑后另记结果。
- 该轮 worker 完整 integration 独立退出 0：6 文件/55 passed、0 failed/skipped，02:21:30，51.94 秒，`b12-followup/worker-integration.log`。包含新增 8 项恢复清理；不是 P2/P3 付款绑定已完成的证据。
- 首次 source 扫描退出 0：1127 文件、12,059,794 字节，0 findings/errors/accepted exceptions，`tests/v25/.results/b12-followup/security-source-first.json`。清单 1223 项摘要 `2ec63b3cbe6090cb2c148b4e4448071314177e155467815cd05567e05ea59f36` 在首次 check 后无漂移，已保留为 `source-files-first.json`；随后只变更上述 identity/OAuth/market/backup 四个文件，按修复后清单重新统一验收。

### 09-08 02:33–02:41 接续统一检查点（通过，后续 kill 故障测试另记）

可信备份实现和联测已完成本机合流，真实使用隔离 PG 17 同一集群内的两库：source 为 0008，target 从 0009 迁到 0010。备份套件 beforeAll 以真实子进程执行 `pnpm --filter @musefold/db db:migrate` 两次，每次退出 0；旧 user 行保留、证据表 15 列和重复迁移通过。子进程 stdout 在测试内捕获，未单独持久化，不能冒称另有独立迁移原始日志。不是实际 dump 还原，也不是已审定真实历史备份。

| 门禁 | 实际命令/结果 | 原始证据 |
|---|---|---|
| 完整 API | `pnpm --filter @musefold/api test:integration`，02:33:09，13.41秒；12 文件/162 passed，0 failed/skipped/unhandled，工具确认退出 0 | `b12-backup/api-integration-verified.log` 与 `b12-backup/validation-summary.json`；其中备份32、身份39、OAuth12、独立故障7均包含于总数，不另累加 |
| 全仓检查 | `pnpm run check`，35/35、28 cached，退出 0；根233文件/2013 passed，features50/598；API259 passed/161 gated skipped，worker63/55 gated skipped | `b12-followup/check-final.log`；保留首次三例5秒超时，原断言/超时未变，单独复跑全部通过。与不再并发PG集成的运行条件相符，不把负载推测写成确定的产品缺陷 |
| 完整 Worker | 6文件/55 passed，0 failed/skipped，退出0；前述02:21:30结果纳入此检查点 | `b12-followup/worker-integration.log`；其后4个修复只涉及API生产/测试，worker/schema未再变化 |
| 双端及移动 E2E | `pnpm run test:e2e` 重建两宿主，02:35:32，319.95秒，退出0；242 passed/7 skipped/0 failed/0 flaky，报告errors为空 | `b12-followup/e2e.log`；完整JSON/HTML/trace归档 `tests/v25/.results/b12-followup/e2e/` |
| source 内容扫描 | `node scripts/security/scan.mjs source --report tests/v25/.results/b12-followup/security-source.json`，1127文件/12,062,445字节，0 findings/errors/accepted exceptions，退出0 | 规则v25-content-1，报告同命令；不是依赖漏洞扫描或最终安装包验收 |
| 源码一致性 | 1223项摘要 `c19604bbf4ed04194700da5a7be0445c726b9598dcfaf2841fd5d467af66ae1a`，check后与完整E2E后均无漂移 | `tests/v25/.results/b12-followup/source-files.json`；之前清单及4文件差异保留，仍为dirty工作树 |

E2E 按项目为 Web desktop 81 passed/2 skipped、mobile 80/3、Electron 81/2。7 skip 是3项真实账号条件未提供、1项真实Key条件未提供、3项视口专用排除；移动删除原产品性skip已消除。原生全屏 fallback、Windows实机和真实付费调用的边界保留。统一报告为 `tests/v25/.results/b12-followup/validation-summary.json`。

备份联测中发现的 FIFO 打开可能阻塞和错误当前密钥导致无法消费的暂存已修复：受控文件读取增加 O_NONBLOCK；stage在写入及幂等成功分支前解密核对当前候选。活体证据集CAS、独立空间/原设备路径清除暂存及异常备份不阻断合法原设备路径均有对应回归；完整32项及首轮14/2项失败原因保留于备份报告。原始备份来源/发行者/谱系真实性仍须运维独立核对，工具只验证受控输入与实际字节一致性。

此检查点后只继续新增API测试：真正进入refresh保存PG事务前SIGKILL、保留数据库启动新PID、租约到期与明确恢复；live relay与隔离备份为两条独立路径，不能相互推导。后续测试增量须保留与本检查点的源码差异，生产未变也不得伪造为同一份完整报告。P2/P3付费执行回执与发送绑定、后续托管接线/云Agent/GC/发布继续开放，管理员仍在迁移全部闭合后启动。

### 09-08 API 强制退出与恢复增量（仅测试/fixture，最终合流另记）

两条路径都先在上游消费一次性 refresh、fresh getSelf 已验证新JWT后暂停回包；父进程锁指定 user 行，再释放HTTP，使用 `pg_stat_activity` / `pg_blocking_pids` 确认真实生产API已经进入PG保存事务且被父连接阻塞，才发送SIGKILL并等待真实close。保留同一PG和公开issuer，启动新PID；没有生产测试开关、改时钟/租约期限或用sleep猜测故障点。

| 增量 | 实际结果与证明范围 | 证据 |
|---|---|---|
| live relay保存间隙 | 原故障7项加新增kill共2文件/8 passed、0 failed/skipped/unhandled；02:47:38，42.27秒，工具退出0。真实30秒租约前503且refresh次数不增；到期旧refresh401、原密文/身份/key保留；明确重新登录恢复同principal/ref/version/key | `b12-refresh-crash/validation-summary.json`；类型/Biome分别退出0；过滤首次1 passed/4 skipped只作前序记录，不累加 |
| live会话权限解释 | 旧bearer的account/status继续401，但已有BA授权尚未被撤销，binding仍可作为元数据读取；新增登录不修复旧relay。测试另外明确sign-out旧token后才断言旧session/relay/authorization删除，新session仍成功 | 不把refresh失败自动解释为全部业务权限失效，也不把重新登录当作旧会话已复活 |
| backup保存间隙 | 完整备份套件33 passed、0 failed/skipped、实际退出0，133.47秒；同一测试自然等待120秒持久lease，新PID到期前503且不再refresh，到期旧refresh401后API返回受限恢复结果；明确独立空间后旧prompt保留原主体，新空间无旧内容，candidate/backup密文清除 | `b12-backup/sigkill-suite-validation-summary.json`；原定向1 passed/32 skipped、126.18秒保留为较早证据；BA部署JWKS原ID未替换 |

新增backup测试的失败与修正完整保留：

1. 首次在测试SQL准备阶段重复用同一参数写varchar/text导致PG类型冲突，未进入生产恢复路径；修正参数使用。首次Biome的finally throw错误未在链尾typecheck结果中显现，后来已分别核实；旧Biome原日志曾被重跑覆盖，仅有实际工具输出摘录 `biome-sigkill-initial-excerpt.txt`，不能称仍有完整原始日志。后续类型和Biome按独立工具退出码记录。
2. 全API首次新164项合跑：163 passed/1 failed，退出1，203.33秒，`b12-p1-final/api-integration.log`。新case180秒超时，afterAll关闭连接又超时10秒。裸等待HTTP barrier未同时观察请求提前结束，失败时异步finally迟迟不执行，放大为连接未归还；增加有界barrier/请求完成竞争和全部资源清理，随后完整33可在12.39秒精确报告500且清理完成，不再悬挂。
3. 三次脱敏诊断进一步确认：已有JWKS=1，首次生产retry立即500、上游请求数0，子进程匹配 `Failed to decrypt private key`。前32例与真实bin共享目标PG，却使用不同的合成Better Auth secret；JWKS不随user级TRUNCATE清理。统一fixture里的同一部署secret，并显式保留/核对既有JWKS；未清表、禁加密或改生产逻辑。诊断日志、完整33通过及源码摘要见增量报告。

本段尚须最终完整API与check合流；旧162项/242项E2E检查点原样封存。与该检查点相比只涉及 `apps/api/src/__tests__/` 内的进程fixture及两个集成测试文件，生产和schema未修改；后续报告必须附实际差异，不将测试增量倒填为旧源码。

最终合流已完成：03:18:29开始的完整API **12文件/164 passed、0 failed/skipped/unhandled、135.67秒，工具退出0**；`b12-p1-final/api-integration-final.log`。`pnpm run check`最终35/35、31 cached、退出0，根2013/features598、API259 passed/163 gated skipped、worker63/55 gated skipped；`b12-p1-final/check-final.log`。该次check之前曾因两份根`.results` JSON报告格式退出1、31/35，限定格式修复后通过；不是新增生产缺陷，也不把中止的兄弟任务当独立失败。

最终source扫描1127文件、12,089,052字节，0 findings/errors/accepted、退出0；1223项摘要 `d7bd41e626af7317a6f014017549f1bc3ee90a33478be9bd2fbf951487adc7b7` 在API/check之后无漂移。统一报告 `tests/v25/.results/b12-p1-final/validation-summary.json`。首个测试增量清单54b62...及失败报告保留；最后修复相对该清单仅backup测试和fixture导出同值常量。

与242项E2E检查点的c19604...相比，最后差异精确为3个API测试/fixture，生产、schema、宿主与E2E源码均相同。因此E2E242/7和worker55沿用它们原先的真实执行证据，不重复运行，不伪称旧清单已经变成新清单。备份beforeAll在最终API运行中再次真实CLI迁移/replay；原生产历史来源/安装包/部署边界全部保留。

**B12按本机实现与合成验收切片收口**：SP-P1身份/恢复、可信备份证据与到期清理、两种保存间隙退出恢复、无付费GitHub reader及移动删除已具备对应证据。G-SPEND-02/云Agent/全资产/发布与整包不因此完成；真实历史材料在实际恢复前独立审定。下一阶段直接执行路线图§6.1的SP-P2/P3，补三入口冻结、非删除执行回执、三条清理路径与worker最后发送凭据/issuer重查。

## B13：持久执行回执与最后发送身份（2026-09-08，本机实现与合成验收通过）

本批接 SP-P2/P3。付款 binding 的稳定字段从 P1 契约提取，排除 `verifiedAt` 和登录次数；API、worker 共用 DB 事务校验及请求摘要。0011 新增 22 列独立回执表和 generation run 关联；回执不向 user/session/run/scheme 建级联外键。普通 create、专用 retry、方案 run 统一按 principal+key 去重，真实 BA 授权会话由服务端注入。客户端新增可选只读回执查询与 retry binding 期待，桌面托管 IPC 留给 P4。

新回执将逻辑输入摘要、最终请求摘要、payer/ref/version 和授权版本与入队一并保存。旧行保持 `legacy_unbound`；旧 `runKind=retry` 无法判明 HTTP 入口，记 `legacy_unknown`。回填不借用当前凭据、不伪造历史成本；已有硬删旧键无法由此次迁移重建。审查发现旧 refinement 的 parent 不能写到仅表示重试来源的 receipt.sourceRunId，0011 已限定只有歧义旧 retry 保留该来源，其余操作为 null，原 generation parent 保留。

worker 在取完参考素材后以 claim 事务验证冻结身份、正常且有效的 BA 登录授权、模型、最终请求摘要和 epoch，使用事务返回的凭据快照发送。claim 是发送授权的线性化时点：撤销/换凭据先于 claim 必须拦截；claim 后的崩溃或响应丢失不能推断免费，也不能改用新凭据自动重发。只有能证明这次执行尚未调用 fetch 的路径可以确认未发送。API/worker 清理统一先锁 run 再更新回执，避免原先反向锁序和 restore 后仍删的竞争。

方案 prepare/run 的对象读取和解码移出入队锁；最终入队事务重新读取 receipt、账号权限与 execution，锁定 owner/revision/reference 元数据后再写 receipt/run/queue。慢对象读取期间换凭据、登出、素材修订/到期可以正常提交，原请求随后拒绝且不留队列。worker 继续在发送前检查内容 hash。旧回执/legacy 重放先于新 Provider 规则：新云端意图必须匹配受支持 Provider，历史已接受的 Provider 值不能被新规则变成新付费执行。

### B13 实际结果与源码范围

以下时间均为 Asia/Shanghai。首轮与最终是不同检查点；定向套件是完整套件的子集，不累加测试数量。

| 检查 | 首轮/中间记录 | 最终结果与证据 |
|---|---|---|
| 契约、客户端与 DB 就地 | 契约/客户端首轮 5 文件/59 项和三包类型通过；DB 单测 39 项。首次 DB typecheck 缺 contracts 项目引用，静态迁移断言误把 `ON DELETE NO ACTION` 当删除语句，修项目引用和匹配边界后通过；未将这些静态失败当作 PG 迁移失败 | 最终全仓 check 覆盖当前契约/客户端/DB；DB 39 passed/5 gated skipped，5 项另在真实 PG 执行 |
| 根 CLI 迁移/replay | 03:51，`pnpm run db:migrate` 连跑两次退出 0，[首轮摘要](../../tests/v25/.results/b13/migration-summary.json)；当时尚未修 refinement source 回填 | 10:52:17 再在新的任务专用空 PG17 跑同一根 CLI 两次，均退出 0；迁移账本 12、receipt 22 列、run ref 存在、receipt 0、容器清理退出 0。[最终摘要](../../tests/v25/.results/b13/migration-summary-final.json) |
| 有旧行 PG | 03:57 首次 5 项通过，[旧报告](../../tests/v25/.results/b13/db-integration-summary-first.json)保留；之后修正 sourceRunId 并增加普通 refinement fixture | 10:52:24，`pnpm --filter @musefold/db exec vitest run src/__tests__/generation-execution.integration.test.ts`（任务专用 DATABASE_URL、RUN_DATABASE_TESTS 门禁）：1 文件/5 passed、退出 0；容器清理 0。[最终摘要](../../tests/v25/.results/b13/db-integration-summary-final.json)。在自己新建的数据库程序化迁到 0010、造 5 条旧 run、迁 0011/replay并断言 4 条旧回执，不是 dump/restore |
| API | 回执专项修 fixture 后 16 passed；首套完整 API fixture 修复后 13 文件/180 passed，随后新增方案预检/并发验收 | 11:04:04，`pnpm --filter @musefold/api test:integration`，139.60 秒，13 文件/188 passed、0 failed/skipped、退出 0；3 文件/46 项预检/回执/素材定向已经包含其中。generation 单测 2 文件/21 passed，类型和 16 文件 Biome 均退出 0。[完整摘要及失败索引](../../tests/v25/.results/b13/api-validation-summary.json) |
| worker | 权限专项 22 passed；首完整 7 文件/80 passed，未含真正 bin 入口；[旧摘要](../../.results/v25/2026-09-08-development/b13-worker/validation-summary.json)明确当时子进程采用隔离 task 入口 | 加入实际 `apps/worker/src/bin.ts` 3 项并修停机缺陷后，10:58:48 完整 `pnpm --filter @musefold/worker test:integration --reporter=verbose --silent=false`：26.99 秒，8 文件/83 passed、0 failed/skipped、退出 0。默认单测 77 passed/83 gated skipped；类型、27 文件 Biome、diff 全通过。[最终摘要](../../.results/v25/2026-09-08-development/b13-worker-production-bin/validation-summary.json) |
| 全仓 check | 不沿用 B12 的 35/35；本批重新运行，不命中旧 task cache | 11:11:04–11:11:47，`pnpm run check` 退出 0、35/35、0 cached；根 238 文件/2055 passed/5 gated skipped，features 50 文件/598 passed，API 271 passed/187 gated skipped，worker 77/83 gated skipped，DB 39/5 gated skipped。[check 摘要](../../tests/v25/.results/b13/check-summary.json)。独立真实 PG 结果见上行，默认 skip 不等于执行通过 |

API 最终范围为 88 文件，摘要 `47fdf91176008de2600ee5d092bfc717a984d082a3ad7e20a3b703cacc42df68`，最终全套后[无漂移](../../tests/v25/.results/b13/api-source-after-final.json)。worker 真实 bin 批为 17 文件，摘要 `184e9221d612bdbeb90f3846c91b8ae5230629573bfd28bbca89e4f208875fdc`，旧 15 文件清单无漂移；新增 bin 修复/测试另计，不能把早先 80 项报告冒充已验证该修复。

11:12:36 实际执行 `node scripts/security/scan.mjs source --report tests/v25/.results/b13/security-source.json`，退出 0，1147 文件、12,461,286 字节，0 findings/errors/accepted。全仓 1243 项冻结摘要 `bec320e638a2b1dd413b22c40375fe35d8db7fbf29cf2bf576d24a6ff7285eeb` 在 check 前后无漂移；[统一验收摘要](../../tests/v25/.results/b13/validation-summary.json)同时关联 API/worker/DB 报告。它是未提交 dirty 工作树的本机检查点，source 内容扫描不等于依赖漏洞审计或已安装产物扫描；后续 B14 源码变化另记，不能倒填 B13 清单。

### B13 失败保留与修复

1. API 回执首轮 `api-receipts-first.log` 为 2 passed/14 failed：fixture 从 Graphile 公共 view 读取不存在的 payload，且方案缺必需 size/quality。诊断轮 14 passed/2 failed 明确剩余输入错误，补 canonical fixture 后 16 passed。完整 API 首轮 `api-integration-first.log` 为 179 passed/1 failed：资产迁移 fixture 已由 0009 生成未验证 identity，再插 active fixture 同 PK 冲突；仅让合成 helper 显式替换已知 unverified/recovery_required 行，未松绑生产校验，180 项复跑通过。
2. API 预检首轮 typecheck 缺内部素材集合的 DB 推导类型；二轮发现测试 Promise.withResolvers 不在当前 TS lib、Hono request 返回值需 Promise.resolve；Biome 拒绝 finally 中 throw。改为 DB insert 推导、本地有界 barrier、全部清理后聚合抛错。预检首轮合跑 40 passed/6 failed 因 fixture 没声明 image slot，真实 prepare 提前拒绝，未到并发屏障；补合法 image input 后 46 passed，最终完整 188 再通过。各首轮与复跑路径都在 API 摘要中。
3. 独立源码审查发现旧 refinement parent 与 receipt 重试来源语义不同，以及 API purge/worker retention 锁序相反、restore 与删除竞争使用旧快照。前者修 0011 回填及真实旧行回归，后者统一 run→receipt 锁序并锁后重查，最终 DB/API/worker 通过。这些是审查发现，不能编造为当时实际失败的测试数量。
4. worker 默认 test 首轮为 76 passed/1 failed/79 gated skipped，`b13-worker/unit-first.log` 保留。旧断言期望 lease 文案，发送权限校验使用新的固定文案；依据当前拒绝语义修断言，未删除拒绝行为。最终默认 77 passed/83 gated skipped，真实集成 83 passed。
5. 新实际 production bin 首轮 3 failed：业务断言已完成但 SIGTERM 退出 1；诊断轮 1 failed/2 skipped 确认 Graphile 默认信号处理器先 stop，bin 再 stop 抛 `Runner is already stopped`。这是生产入口缺陷，已在 `apps/worker/src/bin.ts` 禁用 Graphile 默认信号处理器，由唯一入口处理信号、防重复执行，依次等待 runner.stop、销毁 S3、关闭 PG；失败只记录静态诊断并退出 1。限定 3 项与完整 83 项复跑通过，正常 SIGTERM PID 退出 0、观察到 PG 连接 0，捕获输出未出现合成 credential canary。原始首轮和诊断日志保存在 `b13-worker-production-bin/`，未覆盖。
6. 根 Biome 预检 `tests/v25/.results/b13/biome-preflight.log` 退出 1，原因为生成 DB snapshot 的格式和 journal 末尾换行；仅修改两份 JSON 的格式，`migration-format.log` 留存。最终 PG 和全仓 check 在格式修正后通过；这不是一次 SQL 迁移失败，也不应被写成最终 check 的失败轮。

### B13 能证明与不能证明的边界

- 本批真实 PostgreSQL/Graphile、HTTP、S3 协议和进程信号均使用任务拥有的隔离库及本机替身；账号授权行由合成 fixture 准备，没有真实上游账号或付费调用。当前 gateway 不消费可信账单，已发后费用保持 unknown/null；成功、401、取消或无输出均不表示零费用。
- 真实 production bin 已通过：Node/tsx fork 原入口，`NODE_ENV=production`，正常 HeadBucket 成功且未走 CreateBucket fallback；一次正确授权 HTTP、S3 落盘、终态回执、SIGTERM 清理/新 PID 重复投递，另有 issuer 不符零发送及上游已接收后 SIGKILL/重启不重发。不能继续笼统称“生产 bin 未验”。
- 该 worker crash 用例在观测旧 PID 死亡和 PG 断开后，于任务数据库显式解锁 Graphile 死 worker 并使应用 lease 到期；不是自然等待超时。正常停止用例每个 PID 仅发一次 SIGTERM，没有单独同时多信号矩阵。容器启动、生产宿主、远程 CI、签名安装包、真实账单及生产部署/回滚仍未执行。
- B13 新跑全仓 check（含构建），未新跑 UI E2E 或 installer/package-smoke。旧 B12 E2E 仍是旧源码证据；不把旧报告更名为 B13。SP-P4 明确托管图像连接与 local call→receipt 仅查询恢复、SP-P5 参考图/R/S、其他迁移任务继续开放；管理员后台已获当前 goal 授权，必须在剩余 v2.5 任务全部闭合后启动。

发布顺序仍是先排空或隔离旧 worker，再联合启用新 API/worker；compose 已让两者使用相同 PUBLIC_BASE_URL。单独应用 0011 不会让旧 worker 获得这些校验。未触生产服务、真实付费接口、账号数据或管理员端。


## B14：SP-P4 同源资产下载准备（2026-09-08，本机验收通过）

默认 compose 中 S3 在容器内使用 `http://minio:9000`，既有签名302将该内部地址交给外部客户端，桌面不可达。新增所有者鉴权的 `GET /api/v1/assets/:id/content`：客户端只给assetId，API用已授权的受管objectKey读取；原302保留。允许所有者读取软删历史，purge后不返回；不开放额外生成/审批权限，不转发用户bearer到S3。

读取前验证PG资产与run的owner、尺寸/字节/SHA256元数据；S3总期限30秒、输出30MiB上限，声明长度与实际流同时约束。错误状态在SDK解码错误XML前关闭流并映射固定404/503；成功体完整解码后核对mime、尺寸、byteSize及已有checksum，返回前再核对元数据。最后一次读取是可访问性判定时点，后续purge无法撤回已经交付的字节。响应使用no-store/nosniff/固定附件名；原方案上传的默认20MiB上限不变。

本片实际定向结果：真实loopback S3的13项通过（`tests/v25/.results/b14/storage-first.log`，0.681秒、exit0）；新真实BA/PG/S3组合21项通过（`content-integration-first.log`，4.45秒、exit0）。覆盖跨owner与recovery-only零S3、原302、软删/硬删、元数据预拒/全decode/hash、读取中purge/替换与20–30MiB有效PNG。新增fixture编写期间出现Buffer泛型推断错误（api-typecheck-second.log），限定修复后通过；这些定向检查时完整API与全仓check尚在合流；最终结果见下文。

独立审查发现施工中的空体404先被长度校验转为503；已改为先按HTTP状态分类，新增空404/XML404/空200真实HTTP回归。该问题为代码审查发现，不虚构成曾经失败的测试。下载首片不代表桌面托管提交、稳定key持久化、预算防回退或P4整卡完成。


B14 最终合流已完成：新增合法正Content-Length短体与真实临时API HTTP listener的客户端断开回归，37项（23条content集成、14条S3 transport）通过。客户端abort后在独立2秒观察窗口内确认S3 socket关闭，早于生产默认30秒读取期限；不是清理动作或等待超时造成的假通过。API最终单测5文件45项、类型均exit0；限定12文件Biome exit0、0错误但保留1条非阻断useOptionalChain warning。

完整API在11:43:27开始，14文件211 passed、0 failed/skipped，138.05秒，exit0。11:47:14–11:47:33的全仓check为35/35、28 cached、exit0，根238文件2055 passed/5 gated skipped，features598；API285 passed/210 gated skipped，完整集成211还含非gated detail；worker77/83为缓存结果，本批未重跑worker集成。B14无PG/schema迁移、桌面/UI源码变更、新E2E或安装包验收。

统一报告 `tests/v25/.results/b14/validation-summary.json`；源码1247项摘要 `389ac3ff537775777eea4de7c72b3e4c75a292e94802d7f13fa235e58e5d2c72` 在API/check后无漂移，相对B13仅12个API文件。source扫描1151文件、12,496,956字节，0 findings/errors/accepted，exit0。API独立92文件清单前后摘要e0987f28cb288fd7f6a0236534e2d28eff38ff200cb5e8615e58173650b51e7f一致。14项S3与23项新集成是相关门禁的子集，不与211/285相加。

下一步继续SP-P4：按费用边界§10.10.2落实持久远端关联与备份防回退，再联合显式账号云图像连接、异步准备确认、主进程执行port和资产转存。防回退锚当前只有设计，没有改变用户恢复流程；完整P4、P5/P6和整包仍未完成，管理员开发尚未启动。


## B15：SP-P4 防回退存储与事务协调基础（2026-09-08，本机验收通过）

新增 desktop-contracts 的检查点/操作/锚 schema、SQLite 0008 单行检查点及 9 项内联迁移链、core 同步 CAS repository、异步 prepare→DB commit→anchor commit 协调器，以及要求宿主注入加密器的有界文件适配器。旧库不自动生成 namespace 或启用托管；已有预算与备份入口未改动。缺失、损坏、旧 DB 和 pending 不明状态只核对，精确匹配 pending.to 才能补齐锚。

真实 SQLite/文件/子进程专项最终 52 passed；含三个实际 SIGKILL 时点与新 PID、真实旧库 backup 后替换、同事务预算示例、失败回滚、CAS、恢复限制及非普通文件边界。最终 check 35/35、0 cached、根 2082 passed/5 gated skipped、features 598；Electron 81 passed/2 gated skipped/0 failed/flaky。实际命令、时间、首轮提示与审查修复见测试手册 §5.8。

Electron 运行期间最后修改了两个尚未接入宿主的新模块：增加显式链接检查并修正加密注释。最终完整 check 和定向测试已复跑，21 项桌面构建文件与 E2E 所测产物字节一致；不能写成又重跑了 Electron。source 扫描 1162 文件零命中，最终源码 1258 项摘要 be7e16cb31f1f54488efd403e1e96ae2d2ddc707e2c5ff48bc41da6cbd4a3edc；相对 B14 16 文件变化。统一报告 tests/v25/.results/b15/validation-summary.json，前序日志保留 pre-review-*。

这不是完整防重复付费闭环：当前仅测试使用合成加密器，没有正式 safeStorage 工厂、托管远端关联、预算全入口或 restoreBackup 接线。目录要求单宿主独占；Windows 原生和断电未验，整套 DB+锚一起回退不能本机识别。接续任务卡已拆 P4-D2 宿主恢复、D3 持久关联、E1 预算回执以及 A/B/C/F 首条产品链；云 Agent、P5/P6、完整 GC 与发布仍开放，管理员未启动。


## B16：SP-P4-D2 安全存储与正式备份恢复隔离（2026-09-08，本机验收通过）

主进程锚直接使用 Electron safeStorage，拒绝不可用/明文后端；Windows 等待密钥记录 20 秒不到则拒绝写入。正式 restoreBackup 核对 SQLite 与 Drizzle 迁移前缀，排他进入数据库访问隔离，使旧 epoch 失效并禁止本 PID 惰性重开；排空登记的托管工作、停同步、独立保留安全副本、持久写 restore_pending 后才关库替换。安装失败可回迁原文件但仍须重启，安全副本不参与普通十份 prune。未启用托管的旧库不新建锚。

共享备份卡同步说明保留策略；普通坏备份仍可重试，隔离失败关闭确认框、禁用再次提交并提供显式重启。实际 Electron 以可见 UI 走损坏锚失败路径，另以正式 IPC 验证成功恢复、旧进程写拒绝、新 PID、独立密文与安全副本；不添加测试专用启用 IPC。

最终恢复/OS/域专项 4 文件42 passed，共享设置53 passed。check35/35、26cached、根2099passed/5gated skipped、features599；12:48:57–12:54:54 完整三形态 E2E244passed/7skipped/0failed/flaky（PC81/2、移动80/3、Electron83/2）。source1167文件、12,653,335字节零命中；最终源码1263项摘要 bd0343b02397c79f41cef13cb9f82ee65bc41f8b7d2ee0abd35dec580578ddb4，check/E2E后无漂移，相对B15共12文件。统一报告 tests/v25/.results/b16/validation-summary.json；详细失败记录见测试手册§5.9。

首轮迁移链fixture错误使用可空Drizzle id，2项失败；改用created_at且断言changes=1后42项通过。定向Playwright首命令把文件名当项目名导致零测试退出1，修参数后2项通过。gate runner初次输出目录残留B15，仅迁回新产生的两份check-first文件，未覆盖旧证据。UI前check35/35（0cached）、Electron83/2另存，UI变化后重新跑最终check与完整E2E。

本片不等于托管生图闭环：`withManagedExecution` 尚未接正式远端 POST/poll/download，关联持久化、预算全入口/回执、用户明确启用与匹配恢复后的核对仍待完成。Windows/Linux分支为模拟单测，真实safeStorage/重启为macOS；没有本批正式宿主SIGKILL、断电/整机回退、真实费用、安装包、部署或管理员验收。接续 SP-P4-D3/E1 后再完成 A/B/C/F 与其余迁移。


## B17（2026-09-08）：持久关联和预算回执核心

完成 desktop-contracts 严格托管 G 输入、SQLite 0009/十条内联迁移、ManagedGenerationLedger 的登记/确认/单次 claim/只读查询及单调 receipt 事务。原始输入、稳定 key 与固定身份在 POST 前落盘；重启不能从 unclaimed 或 active 状态恢复发送资格。托管请求不再被通用 recover/finish 收尾，费用 unknown 跨月保护，provider_reported 保持原 provenance 和预算月份，重复回执不重复计费或审计。

验证：check35/35（0cached），根2145passed/5gated skipped、features599；专项82passed；完整API集成212passed；Electron83passed/2skipped/0failed/flaky。四个真实SIGKILL窗口，以及实际Hono/PG接收后扣住回包、凭据轮换、新PID和purge后恢复，均未重复POST。source1178文件0findings/errors/accepted；1274项源码摘要b8b9c7a2448a7cd243946502cb9aac8efe931f353ca47058f4b767c3d93742d7无漂移。真实组件、替身、首次失败修复与报告见[测试手册 §5.10](./V25-MIGRATION-TESTING.md)。

本批尚无正式生成调用方；下一步A/B/C/F显式连接、异步准备/确认、主进程执行/下载，联合接入共享预算设置和老入口、匹配恢复核对。不要重做B17账本，也不能在这些前置完成前把用户托管发送开放。P4、其余迁移及管理员依赖仍开放。

## B18（2026-09-08）：主进程托管执行适配

完成账号同步失效/异步会话核对、固定 issuer 的受限 HTTP 客户端、原请求/key 单次首发及只读回执/结果查询，工厂接正式恢复的 abort/drain。core 新增无 Provider Key 的远端 transport 接缝，异步返回后重验身份再写结果。启动旧补记路径排除托管关联，避免本地失败覆盖云端未知状态或启动异常。

本机专项36passed；最终check35/35、30cached、根2167passed/5gated skipped、features599；Electron83passed/2skipped/0failed/flaky。source1180文件零命中，1276项源码摘要ceeead243aeee426217ed4dad48a57d7f7e4351feaeade3f6a900e64a50d13a1，各门禁后无漂移，相对B17共10文件。初次类型收窄失败与归档测试超时保留；计数 ZIP fixture 改用存储型条目后定向4项/全量复跑通过，没有放宽产品限制或测试期限。详细阶段、真实组件和局限见[测试手册 §5.11](./V25-MIGRATION-TESTING.md)。

尚无正式用户调用方；接续先保护共享预算全入口，再接显式云连接、冻结准备/确认、实际执行/持久取消意图/下载入账和恢复核对。B18 HTTP与core接口不代表完整P4；API/PG和完整Web E2E沿用各自原批次范围，本批未重新执行。云Agent/完整GC/平台与发布、整包及管理员前置仍开放。

## B19：共享预算写保护与异步结算（2026-09-08）

检查点事务统一授予受管预算写资格，策略上限/兼容用量、老托管请求及调用不能绕过协调器。未启用预算变更与enable同锁，不创建锚/namespace；异常异步回调回滚。主进程设置与兼容结算等待落稳，重复finish共用Promise；G的完成事件/结果及R/S审计等待结算，失败保留unknown，不自动重发。恢复排空也中止预算回调，启动补记保留旧托管状态。

本机check与真实PG回执/SQLite专项通过；新Electron用例证明正式预算IPC更新实际safeStorage锚，真实重启后同值不重复推进。最终84passed/2skipped，失败修复和具体源码统一见[测试手册 §5.12](./V25-MIGRATION-TESTING.md)。全仓门禁覆盖新增未启用回滚测试，专项177项不被改写成另一次执行。源扫描零命中，报告tests/v25/.results/b19/validation-summary.json。

下一步接用户启用前旧在途/内存预留核对、显式云图像连接和G完整执行/取消/下载/恢复。不得以旧写入已拒绝冒充旧任务恢复完成，完整P4/P5/P6及其余v2.5迁移仍开放；管理员未启动。

## B20：启用前持久账本检查（2026-09-08）

启用账号云执行时，先检查整库旧托管非终态、held/unknown和未结束调用；残留远端关联不能重新生成namespace。异步锚落盘后，SQLite commit内复查，另一连接晚到的登记会使启用拒绝并保留pending/query_only；旧请求和费用不被自动核销。已结束历史、已拒绝确认与外部BYOK保持兼容。

专项66项、全仓与桌面回归通过，新增10项覆盖持久前置与竞争；实际数字、命令、源码和边界见[测试手册 §5.13](./V25-MIGRATION-TESTING.md)。本批完成数据库检查，不等于宿主内存预留排空、用户启用或G产品链已经完成。下一步依旧联合接显式云连接/冻结准备确认/生成取消/下载恢复；完整P4、云Agent/GC/发布及管理员依赖仍开放。


## B21：桌面账号云图像首条产品链（2026-09-08）

设置新增显式账号云连接卡：review绑定账号/issuer/binding/DB与有效期；legacy预算准入排他、未结预留拒绝启用，旧托管标记不能充作新身份。普通G发送接持久账本，取消先保存意图，结果经受控资产接口下载并按确定文件名/单次事务入账；原任务查询、真实重启不恢复发送资格。普通发送沿用交互授权，无额外费用确认；当前只开放无参考图/Prompt引用/微调的文字生成，BYOK不迁移。

本机check35/35，根2229passed/5gated skipped、features606；完整三形态246passed/7skipped/0failed/flaky（PC81/2、移动80/3、Electron85/2）。实际Electron设置确认→工作台发送→丢回包→正常退出/新PID→原任务与素材恢复，总生图POST=1。真实SQLite/HTTP验证1/2/4张、持久取消/未知费用和幂等投影，API/Provider仍为受控替身。source1194文件零命中，最终源码1290项摘要ac876c6132f8fa0f295e50fdf4e5d1bff363c2b50d594eabc9ffbeccd2c09b96，相对B20共38路径，无漂移、无视觉基线更新。

修复了过早settings初始化、超长连接ID、缺省negative/aspectRatio进入JSON账本；合成fixture契约/旧数据库stub/必填n和Playwright参数失败均保留。命令、首次失败、最终分阶段结果及跳过详见[测试手册 §5.14](./V25-MIGRATION-TESTING.md)，统一报告tests/v25/.results/b21/validation-summary.json。

首条产品链已有验证，不等于完整P4。下一步P4-R1清单分页/purge与缺素材/旧未映射诊断，R2实际Hono/PG合流，R3正式宿主SIGKILL和恢复确认矩阵，R4明确重试与旧入口兼容；P5参考图/R/S、P6及云Agent/包/GC/平台发布继续。管理员未启动。

## B22：原云任务恢复分页、结果可用性与旧托管诊断（2026-09-08）

复用 B21 accountCloud 域，加入每页 20 条稳定游标，按当前 issuer/principal 隔离并包含终态任务。独立展示云执行、费用、本机素材：成功回执先结束执行；缺本机文件可重取原素材，云 purge 只解释缺失。旧未映射托管记录复用启用前阻塞判定，只作本机只读诊断，不重绑、清锚或清零。

check 35/35（29 cached），根 2241 passed/5 gated skipped，features 614 passed；恢复专项 33 passed、共享组件 15 passed、既有实际 Hono/PG 回执回归 25 passed。完整三形态 247 passed/7 skipped/0 failed/flaky（PC81/2、移动80/3、Electron86/2）。真实 Electron 关闭后新 PID 覆盖素材 purge 和缺文件恢复，两场景各保持生图 POST=1、原费用=4；后者资产记录与字节保持一致。

源码1297项摘要 `3250169f8d434be5adc26d7449b1058904b288ea6691be9836f29a59a266c375`，相对B21共26路径，所有最终门禁后无漂移；source1201文件、13,022,198字节、零命中。初始类型/测试fixture/二次格式化/全负载下持久注册超时均保留，未修改视觉基线。详细步骤与边界见[测试手册 §5.15](./V25-MIGRATION-TESTING.md)，统一报告tests/v25/.results/b22/validation-summary.json。

当前仅关闭 B22 恢复交互切片；正式主进程到真 Hono/PG 产品合流、逐点宿主强杀/恢复确认、重试兼容继续按 P4-R2/R3/R4；P5/P6、其余云生命周期/GC/发布和管理员前置未闭合。

## B23：正式桌面与真实云服务联合（2026-09-08）

新增隔离测试服务，Hono/PG17/Graphile/worker/正式客户端/SQLite连成实际链路；合成认证、Provider和S3，1/2/4不同图片、并发、凭据轮换、换号隔离、失败/取消、purge和原素材恢复均有联合证据。修复bound未发送取消的null金额和旧回执显示一致性，同时保留legacy/claimed未知费用。main/pr数据库job新增联合专项，未实际执行远程CI。

check35/35、30cached，根2242passed/17gated skipped、features614；联合18passed（12真服务+6恢复）、完整API213passed；完整三形态248passed/7skipped/0failed/flaky（PC81/2、移动80/3、Electron87/2）。实际Electron四图丢回包后新PID恢复总API POST=1、Provider调用=1，缺本机文件重取原素材不重复资产，unknown费用不清零。

1301项源码摘要9c6233b1c379b06201620fa0503b8a685accec60814ec7d7e951be70a16b9c7a，source1205文件零命中，门禁后无漂移；首次API取消金额缺陷、fixture/import/异步等待与legacy约束失败均保留。命令与边界见[测试手册 §5.16](./V25-MIGRATION-TESTING.md)，统一报告tests/v25/.results/b23/validation-summary.json。本批不关闭正式宿主强杀/备份确认与重试兼容、P5/P6和其余迁移/发布卡，管理员未启动。

## B24：正式 Electron 强杀与安全备份确认首批验收

复用 B23 实际服务，新增8个主进程精确强杀场景与4次完整投影后强杀；真实云任务的过旧/匹配安全备份、UI确认、过期/换号/恢复后的review拒绝组成另一项正式测试。发现并修复未领取取消的本地历史费用仍unknown：durable unclaimed取消投影0，已领取未知不变。生产仅修改主进程结果投影，未加IPC/测试后门，未改API/worker/schema或版本。

check35/35、联合34passed、完整三形态257passed/7skipped/0failed/flaky，源码1304项摘要`df35cfe5e4d5fa76b111e8fa18f1684c2f6e1512188154981e36b572814e4637`。所有首次失败、测试注入边界及最终数值见[测试手册 §5.17](./V25-MIGRATION-TESTING.md)。本批关闭这组已验场景，P4-R3确认执行中竞争/缺损锚/claim中点仍开放；下一条复制[路线图 §6.12](./V25-MIGRATION-ROADMAP.md)，再做R4/P5/P6和剩余云功能/GC/发布，管理员前置尚未满足。

## B25：恢复确认故障与持久授权提交

实际复现后，将 resume 从单次文件改写改为持久准备、最后有效性核对、同步SQLite CAS、可恢复整理；修复写入失败已安装及写入期间旧确认失效两种误启用。恢复成功 revision+1、namespace不变，原请求/素材/预算/费用不动。新增实际Electron17项，并回归既有9项强杀与安全备份；确认前后SIGKILL、实际任务缺损锚和执行中换号/恢复均有独立证据。

最终check35/35、完整三形态274passed/7skipped/0failed/flaky；源码1306项摘要`7bd7b59729519d834aad5540ef7487aa6486a9674a9a555c98f8e0be8c1a2f6c`。真服务联合、首次失败及精确边界见[测试手册 §5.18](./V25-MIGRATION-TESTING.md)。P4-R3本机矩阵验收，Windows及外部发布条件不提前关闭。下一步[P4-R4显式重试/旧入口兼容](./V25-MIGRATION-ROADMAP.md)，随后P5/P6与其余云Agent/包/GC/迁移/发布。管理员未启动。

## B26：显式重试主链（R4 继续部分完成）

修复 desktop gateway 丢弃幂等 key 的接缝；持久保存 retryOf 本地/远端父关联，主进程使用正式云 retry 路由，回执按 explicit_retry 和 sourceRunId 核验。同一意图重放返回原本地子任务；新授权重新核对当前身份和原付款方。API 补齐原费用/终态/绑定准入，既有已接受 key 重放保持不变；历史缺证据不自动赋予当前 payer。本机未领取取消在 core 可新授权普通生成且不伪造云回执。

实际主进程/服务联合与 Electron 可见取消→重试、丢回包→新PID已验；费用未知拒绝有明确原因。最终全仓、API完整集成、三形态、源码清单及首次失败只以[测试手册 §5.19](./V25-MIGRATION-TESTING.md)和[机器摘要](../../tests/v25/.results/b26/validation-summary.json)为准。R4 原卡保持开放，接[路线图 §6.14](./V25-MIGRATION-ROADMAP.md)的共享重试交互/其余故障/legacy/BYOK/R/S。管理员未启动。

## B27：工作台与历史的共享重试交互（R4-C1 本机验收）

三个手动入口改用共享交互：同步连续点击在创建 UUID 前合并，跨屏/详情共享提交中状态；mutation 自身的网络重放保留 key，失败显示原因，换号后的旧结果不弹错到当前账号。本次结束后新点击仍是新意图。成功/过期任务移除后端拒绝的重试入口；账号云未知费用/已purge保留原任务核对。

首次引用测试仍假设成功任务可在 fake host 重试，改成保留成功断言并另验取消任务的冻结引用；首次类型检查发现新测试使用非规范错误码，改用合同内 INTERNAL_ERROR。无后端授权、数据库迁移或视觉基线变更。定向组件、真实服务、PC/Mobile/Electron 与完整三形态结果和首次失败均见[测试手册 §5.20](./V25-MIGRATION-TESTING.md)和[机器摘要](../../tests/v25/.results/b27/validation-summary.json)。

代码审计另定位到兑换后自动续发的独立 gateway 调用和吞异常行为，写入 C4 的明确待办，不把本次三个手动入口当成所有恢复入口。接[路线图 §6.15](./V25-MIGRATION-ROADMAP.md)的 C2 故障、C3/C4 兼容、C5 合流；R4/P4/整包继续部分完成，管理员未启动。

## B28：真实重试故障与原任务恢复（本机 R4-C2 验收）

本批只增加测试及 fixture：精确命中云 retry 的强杀窗口、新 PID 原意图并发回放、未领取取消后界面新授权、binding/回执等待中的换号或实际备份恢复、父清理/再次轮换、取消坏回包，共17项。每项同时观察实际 Electron/SQLite/安全锚与 Hono/PG/队列/worker；身份/Provider/S3 为合成隔离服务。

专项首次全部通过，随后加强终态/Provider次数、可见设置页核对、图片与本地终态、父付款方/月份/预留/费用快照及证据脱敏。最终源码 check、扫描和完整三形态结果见[测试手册 §5.21](./V25-MIGRATION-TESTING.md)及[统一摘要](../../tests/v25/.results/b28/validation-summary.json)。父清理/轮换后原 retry 可能明确拒绝，已接受子任务通过 GET 核对恢复；旧备份不能承诺还原备份后新增的本机元数据。本批没有修改生产规则或将未知成本记为0。

C3 审计发现正式 Automation 普通生图及方案/Skill 已有持久包装，后续先证明旧内存分支的实际可达性；C4 兑换续发错误反馈/并发仍待修复。接[路线图 §6.16](./V25-MIGRATION-ROADMAP.md)，R4/P4/整包保持开放，管理员未启动。

## B29：兑换恢复独立反馈与桌面额度错误映射

到账后立即确认兑换结果，续发另行显示提交中/已提交/失败并定位对应任务。兑换续发复用手动重试的未结束准入，原 create 重放保留输入和 key；换号后的旧结果不更新新账号，旧兑换也不消费等待期间新选的恢复意图。保留 void 按钮回调，新增可等待异步方法，避免破坏已有组件调用方式。

真实 Electron 新用例揭示了桌面错误映射缺口：历史官方 `ACCOUNT/QUOTA` 被转成通用上游错误，无法进入兑换深链。现保留官方额度码并为 BYOK `NO_BALANCE` 加负例，避免误导充值。Web 首次 fixture 使用了契约外错误码，已修为正式契约码；原失败与复跑全部留证。组件最终62通过（9项新用例），旧入口基线24通过，界面专项5通过；最终 check/完整三形态/扫描结果见[测试手册 §5.22](./V25-MIGRATION-TESTING.md)和[统一摘要](../../tests/v25/.results/b29/validation-summary.json)。

只读审计确认旧官方 provisioning 固定 openai-compatible，不能伪造托管豆包来冒充生产旧内存路径。C3 正式在途/异步结算与启用、C4 BYOK/默认连接/R/S 及 C5 仍按[路线图 §6.17](./V25-MIGRATION-ROADMAP.md)实施。本轮未改付款授权/账本或 schema，也未验真实兑换计费；整包保持开放，管理员未启动。

## B30：旧账号公共准入与自备连接模型快照

正式 Electron 复现同一旧账号 Key 在 Automation 被拒绝、本地 G 却发送一次。公共 generation core 已拦截无可信 transport 的旧 account 托管连接；历史错误保留身份核对含义并可进入连接设置。真实本地 G/两种 retry/R 与 Automation G/R/S 负例已验。另一个真实测试揭示默认模型未写进 run，retry 变成 unknown；现先解析默认模型再保存和发送，修改连接/调用者输入后仍重放原参数。

自备连接生成、取消、默认切换和本地方案/Skill 路由已有实际 HTTP/SQLite 证据，五条 R/S 调用均 external、托管账目不变；三类其他 scope/旧月份的未结持久记录阻断实际云启用，过期事实下的事前 review 也不能绕过提交复查。它们是历史持久 fixture，不是假称当前旧入口可取得付款授权。

首次真实发送、unknown 模型、fixture 必填字段/locator 与一次既有进程超时均保留；修复及最终 check、三形态、源码扫描见[测试手册 §5.23](./V25-MIGRATION-TESTING.md)与[统一摘要](../../tests/v25/.results/b30/validation-summary.json)。完整 C3/C4 总任务不关闭，下一条见[路线图 §6.18](./V25-MIGRATION-ROADMAP.md)，其中历史 unknown-model 恢复、剩余在途/结算/客户端矩阵明确保留。管理员在整个 v2.5 验收后开始。

## B31：统一连接管理规则，补实际客户端与自备双向兼容

真实本地文件质询/HTTP 暴露云保留类型可创建、云 Key 可写、退出账号后可激活三个错误放行；真实 IPC 删除默认自备连接也会默默启用旧云行。现共用主进程连接服务统一编辑保护、可信激活/验证与默认接管，本地创建复用既有类型枚举并事务回滚。另补合法自备创建、Key 保存、当前可信云验证/激活、切回自备生成与删除接管；没有新增管理员功能或付款授权。

云前后自备取消、两种 retry、方案/Skill 已覆盖，十条 R/S 调用均 external。实际构建 CLI/MCP 分发文件并启动独立客户端进程，两个客户端各自 G/R/S 成功及旧未绑定账号拒绝，共十二次调用；成功图像六次/文本两次，拒绝阶段无新增发送。CLI 首次命令顺序 fixture 失败及四个真实缺陷均保留原报告。

专项25项单测、7项 Electron、完整 check/三形态与扫描结果见[测试手册 §5.24](./V25-MIGRATION-TESTING.md)和[统一报告](../../tests/v25/.results/b31/validation-summary.json)。仅关闭 B31 本机任务。历史模型缺失、C3 原条件适用性、C5 和后续云功能/数据/发布仍按[路线图 §6.19](./V25-MIGRATION-ROADMAP.md)继续，管理员未启动。

## B32：历史模型缺失拒绝与用户新意图恢复

真实 Electron 复现旧 unknown 模型仍被接受并创建运行中重试子任务。现 core 与本地 IPC 共用缺失模型校验，发送/密钥读取前拒绝，IPC 立即反馈而非等待不存在的新记录。独立可信云 transport 仍使用原冻结授权路径。实际历史重试提示后，用户到连接设置核对模型，再在工作台新建生成成功，原记录/费用完整保留、无错误父子关系。

本批另修既有注册挂起测试的瞬态断言，成功进入登录态、失败解锁表单，期间模式锁定保留，账号生产逻辑未改。首次真实受理错误、空白模型DB约束fixture、必填n、注册测试及错误mock修正全部留证。core/IPC44项、账号43项和最终 check/完整三形态/扫描见[测试手册 §5.25](./V25-MIGRATION-TESTING.md)及[统一报告](../../tests/v25/.results/b32/validation-summary.json)。仅关闭 B32；接续 C3/C5 及其余任务见[路线图 §6.20](./V25-MIGRATION-ROADMAP.md)。

## B33：守护在途退出与桌面接管

实际分发 serve 的退出缺陷已修：停止先关闭准入、取消并等待当前生成完成，再关库/释放目录；重复 stop 复用 Promise。桌面已识别守护时等待原 PID 真正退出，旧进程提前删锁不构成接管许可，超时仍活则拒绝。实际 CLI 环境变量 BYOK 成功、旧账号零额外发送拒绝、在途正常退出、桌面接管及新的 BYOK 意图已验。

就地实际 SQLite/HTTP 与子进程兼容共6项，既有云回执16项独立复核；最终全仓/完整三形态/扫描和源码见[测试手册 §5.26](./V25-MIGRATION-TESTING.md)及[统一报告](../../tests/v25/.results/b33/validation-summary.json)。保留原闭库缺陷、诊断脚本格式错误和一次既有receipt404等待超时；没有更改该超时用例以获取通过，也未证实根因。仅关闭 B33，原 C3/C5/R4/P4 与整包仍开放；按[路线图 §6.21](./V25-MIGRATION-ROADMAP.md)接续。


## B34：云端 GitHub 来源的持久准备与引用回收（2026-09-09）

复用 B12 固定 SHA reader，新增 contracts、PG 准备表、受管 S3 完整字节服务；owner/execution/requestHash 唯一领取、独立 confirmationId、取消/拒绝/过期、上传租约、损坏读取拒绝与失败补偿均已实现。确定性 document 创建/更新会建立两种来源形式的 canonical 绑定并核对首次确认；Worker 保护来源对象键，退役后仍被引用的不删，最后引用释放后重新进入回收。

新增 PG 0012 准备表和 0013 source_files.object_key 索引，真实根 db:migrate 在隔离 PG 的旧 0011 状态升级并保留旧用户。真实 Node 进程更换读取固定来源，回环 GitHub/S3 的请求次数证明确认后未追移动分支。新增反向测试暴露已退役准备不能在解绑后回收，修复后两种引用形式都通过；原始失败和最终复跑留证。

最终 `check`、API/worker 全量集成与源码扫描通过；数量、日志、时间、源码身份和实际/替身边界统一见[测试手册 §5.27](./V25-MIGRATION-TESTING.md)。本批不改 UI/桌面，不把 B33 E2E 当成本批结果。仅完成内部来源准备，不开放 Agent create/modify/confirm-install/check-update；后续协议、编译、产品接入和生命周期五步详见[来源验证 §5](./V25-CLOUD-SOURCE-VALIDATION.md)。C3/C5 与费用、GC、迁移、发布等原任务保持，管理员未启动。


## B35：云端 Agent 会话、逐来源确认与独立队列（2026-09-09）

新增 canonical 异步 session/事件/精确确认/取消合同和 API-client；PG 0014 增加 owner 会话/事件及来源 queued 状态。HTTP start 将会话、所有可取消来源、初始事件和 Graphile job 原子登记；独立 `agent-worker-bin.ts` 消费 API 域来源任务，原图像 worker 不导入 API 装配。来源依次确认、旧决定重放不推进下一来源，原同步 create/桌面结果与 Cloud MCP 保持兼容。

真实 Better Auth/PG/Hono 请求、Graphile 入队回滚、取消与并发、逐源重放、过期和遗漏队列修复已有专项；两个独立 Node PID 按持久进度接续；另实际生产 bin 消费普通任务后 SIGTERM 退出 0。源码错误映射避免队列失败把创建说明带入通用 HTTP 异常日志。生产 Compose 增加 API 镜像的 scheme-agent 运行角色，配置不代表已部署。

首次集成准备因测试 cwd、fixture 名称和类型失败；后续 S3 对象键取值与未签名 Cookie 夹具修复后通过。全仓并行构建时依赖扫描碰到被删除的临时 Vite 配置，已精准排除 timestamp 生成模块而保留原配置。并行门禁下既有 ZIP/SQLite 进程及 PG replay 发生 5 秒超时，保持原断言/超时，独立与完整复跑如实记录。最终结果/源码版本/范围见[测试手册 §5.28](./V25-MIGRATION-TESTING.md)。

来源阶段 A 已接通，模型编译仍以真实 blocker 结束，未创建草稿/调用模型；图片/历史素材、modify/update、专用包与共享产品仍待。下一步按[路线图 §6.23](./V25-MIGRATION-ROADMAP.md)接服务端模型/费用/发送身份及编译链。原 C3/C5/P5/P6、完整 GC/迁移/发布不由本批关闭，管理员尚未开始。


## B36：共享 Agent 角色与桌面编译/修订（2026-09-09）

- 已将输出与输入 schema 放入 contracts，三角色纯提示词与 JSON framing 放入 domain；桌面真实消费，旧导入路径指向同一个 schema，无新依赖或数据库迁移。
- 专项35项通过、十组旧/新提示词逐字一致；真实Electron通过回环文本HTTP创建草稿/修改并重启读取，旧版保持且仅2次模型POST。全仓check35/35，开启真实隔离数据库的Electron 147 passed/2 skipped，0失败/flaky；扫描1269文件无命中。首败/命令/真实与替身边界见[测试手册 §5.29](./V25-MIGRATION-TESTING.md)。
- 源码1365项摘要`182f9ad4b2991bf4fe19eaa13517b7d3e2c209210277c8de86b2c889b99bff2a`；报告`tests/v25/.results/b36/validation-summary.json`。仅完成共享编译基础，不是云端模型开放；接续[路线图 §6.24](./V25-MIGRATION-ROADMAP.md)及[来源验证 §8.1](./V25-CLOUD-SOURCE-VALIDATION.md)的独立文本身份、持久调用和云端草稿。原父卡/整包仍开放，管理员未启动。


## B37：云端文本授权、单次调用与事务草稿（2026-09-09）

- 新异步create显式冻结文字模型/付款身份/原会话/调用和输出范围；复用公共身份核对但保留图像策略。已确认来源经共享Analyst/Compiler和语义校验后生成真实草稿，PG落库与完成事件原子提交；unknown不重发、晚结果不复活取消任务。
- 正式API/PG/Graphile、回环模型/S3、实际强杀/新PID和原图像prepare已验；源码1381项摘要`e7a7bd43bf0265c8e9119255052ad599e1f03434dc719389b84dab6bebd5e5e3`，报告`tests/v25/.results/b37/validation-summary.json`。最终结果/首次失败/各次源码边界统一见[测试手册 §5.30](./V25-MIGRATION-TESTING.md)。
- 新PG0015只expand两表；未改变SQLite、桌面UI、旧同步Agent501、版本或生产环境。仅关闭B37文字create后端切片；[路线图 §6.25](./V25-MIGRATION-ROADMAP.md)拆出修改、上游更新、素材/包/共享产品及全生命周期，原C3/C5/P5/P6/worker/GC/迁移/发布条件保持，管理员未启动。


## B38：云端异步修改与精确版本保护（2026-09-09）

扩展canonical异步modify合同和取消身份，新增服务端revision_base/expectedVersion冻结及reviser调用角色（PG0016）。复用B37文本授权、单次发送/unknown和共享角色，纯cloud-reviser保留原来源、资产、参数；确定性update抽事务入口并统一scheme优先锁序，新child/指针和completed/event一起提交。API与独立消费者复用既有AssetService，原正式current保留，只有明确working draft变化；没有新增宿主依赖或管理后台。

修改专项、全仓和API/worker同源码结果、最初SQL/正式样本错误与SQLite多进程超时复跑、真实PNG/试运行准备、SIGKILL/新PID/bin范围集中记录于[测试手册 §5.31](./V25-MIGRATION-TESTING.md)。最终源码1387项摘要`488605abce3916acbf4898f13030a50e310df8a5d9286a12f6f3055d63c613a9`，报告`tests/v25/.results/b38/validation-summary.json`。首败全部保留，未放宽schema/超时或删除断言；测试实际模型/正式化边界不外推生产。

仅关闭本批异步修改后端，G-CLOUD-02/P01、原同步接口与共享产品、C3/C5/P5/P6及worker/GC/旧库/迁移/发布仍开放。接续[路线图 §6.26](./V25-MIGRATION-ROADMAP.md)的U1–U4上游更新，之后合流素材/方案包/共享界面，再依原条件完成全迁移；全部完成后才接管理员。


## B39：云端上游更新与独立授权（2026-09-09）

新增免费check-update及authorize-update：服务端冻结原基线、原跟踪ref/新SHA与逐源确认，所有变化确认后独立冻结会话版本/text身份及调用上限。无来源/无变化无模型调用，新更新复用Analyst/Compiler/持久调用及原子修订，保留原正式版/未变来源/资产。PG0017增加nullable update_context；纯规则在domain，状态和IO留API，未新增宿主依赖。

真实试运行暴露旧update无条件复制被替代来源绑定，修正为新revision只按自身文档建立引用，旧revision记录保留；新增直接PG断言、实际PNG/试运行准备和新PID/bin回归。阶段结果、原始合同/夹具错误及真实缺陷修复集中记录[测试手册 §5.32](./V25-MIGRATION-TESTING.md)。最终源码1394项摘要`b0d47bf519901bdb0df79525c90a97902de09626691a86d84bcf0702dec81b82`，统一报告`tests/v25/.results/b39/validation-summary.json`；完整API/worker/check/扫描同源码通过。

仅关闭B39更新后端，不把新异步接口等同原同步/共享产品完成。下一目标[路线图 §6.27](./V25-MIGRATION-ROADMAP.md)的D1–D2素材/历史上下文，再D3专用包、D4共享产品和原E条件；费用/旧版本/GC/迁移/发布与整包保持开放，管理员尚未开始。


## B40：云端Agent上传素材固定副本与草稿资产（上传切片已验，整包未闭合）

沿B39接续D1–D2，先完成已上传图片；审阅桌面历史语义后把历史作品/提示词和仓库图片采用留为明确后续H/R任务，避免将图片数量或路径称为视觉理解。contracts增加服务器素材上下文，PG0018加nullable材料列，AssetService复用既有注册表复制/校验，Agent冻结选择并在付费前校验副本，domain负责真实能力提示与资产引用，完成事务原子晋升。原用户上传可独立删除，未完成副本到期由既有GC处理。

新增真实API专项覆盖图片读取/原件删除、归属/元数据/副本篡改、取消/到期/unknown、真实SIGKILL/新PID、资产插入回滚、重复并发及实际含图片RunService.prepare；worker补注册表到期清理。最终结果、失败修复、缓存/默认skip、格式前后源码身份、真实与替身范围统一见[测试手册§5.33](./V25-MIGRATION-TESTING.md)及[阶段JSON](../../tests/v25/.results/b40/validation-summary.json)。没有运行实际生图、共享页面E2E、安装包或生产部署。未提交/推送/改版本；用户原工作树保留。下一步[路线图§6.28](./V25-MIGRATION-ROADMAP.md)的H1–H3，全部迁移完成后再开发管理员。


## B41：本人历史图片与选定提示词、混合来源和修订继承（2026-09-09）

完成H1–H3后端：真实历史身份/字节/快照核验，独立cloud-run/example图片副本，完整有界选定正向提示词和原run/asset溯源；共享Compiler不再因GitHub报告丢失历史文本。原历史在入队后删除不影响副本；创建、修改、更新、详情与实际图片prepare保持来源一致，多角色语义保留且正式current受保护。没有视觉解析、没有新增DDL或第二套GC。

历史25项包含于API355P，worker85P；全仓check35/35、0缓存，源码扫描1309文件0命中。Electron默认101P/48S后对46项DB门控补验46P，去重147P/2外部skip，0失败/flaky。首次伪造上下文TypeError、测试类型/清理FK、旧prompt遗漏断言与补跑CLI参数错误均留证，真实/SQL样本、源码前后仅根单测断言差异及未验边界见[测试手册§5.34](./V25-MIGRATION-TESTING.md)与[统一报告](../../tests/v25/.results/b41/validation-summary.json)。

仅完成B41后端切片。接续[路线图§6.29](./V25-MIGRATION-ROADMAP.md) R1.1–R1.4仓库图片采用，再D3方案包、D4共享产品及原E治理/发布；整包仍未闭合，管理员尚未启动。用户原工作树保留，未提交/推送/修改版本或部署。


## B42：已确认仓库图片采用、固定溯源与更新资产事务（2026-09-09）

完成R1.1–R1.4后端：从用户已确认GitHub快照和持久Analyst报告选择图片，明确采用/舍弃、原建议角色、来源/文件hash；实际解码并先登记后复制，Compiler前持久固定一个采用决定。新资产原子晋升，modify保留，update仅替换变化来源图片并保护旧revision/正式current。未知许可保持null，文本模型不冒充视觉解析，无新DDL或第二套GC。

仓库22项包含于最终API377P，worker85P；最终check35/35（28缓存），桌面方案/Agent/工作台定向16P、0失败/跳过/flaky；源码扫描1314文件0命中。最后源码1410项摘要`841cdd3ca5ca401d6c1f52e43847a5429f3439ab02e9deda81e37bd0a00675c8`，API/worker/check/Electron/扫描同源码。旧纯文本空采用记录误要求AssetService的生产缺陷已修，原20项回归通过；其他夹具/断言/typecheck首败、真实PID/SQL正式样本/自然期限及缓存/默认skip边界统一见[测试手册§5.35](./V25-MIGRATION-TESTING.md)与[统一报告](../../tests/v25/.results/b42/validation-summary.json)。

仅关闭B42后端切片，P01/G-CLOUD父卡、共享产品/方案包、C3/C5/P5/P6、worker/GC/旧库/同步/平台发布和整包仍开放。按[路线图§6.30](./V25-MIGRATION-ROADMAP.md) F1–F5接续云端专用包，再D4/E，全部v2.5完成后开发管理员。未提交/推送/修改版本/部署，用户原工作树保留。


## B43：共享Node方案包与桌面新素材往返（2026-09-09）

将v1/v2包实体和预算归入contracts单一来源，新增仅Node宿主可消费的共享归档包，桌面读写真实接入；有界ZIP/CRC/路径别名/内容图/历史正文和仓库图片一致性校验。修复桌面canonical与legacy桥接剥离新字段、导入身份映射及snapshot JSON/core/IPC重读、再次导出，API独立Node进程消费同一包。无新增DDL，没有伪造云端三个原包接口完成。

定向7文件73P，API377P/worker85P；全量重算check36/36无缓存，最终check36/36、33缓存，根2384P/20门控S、features633P，源码扫描1326文件0命中。完整Electron首轮146P/1F/2外部S；修复恢复用例单次isVisible的等待竞态后，两个场景各5次，共10P，逻辑用例去重147P/2外部S；这是首败加修复补验，不是一次完整全绿。原断言与超时保留，实际重启/原任务单次提交/素材补取通过。所有首败、源码差异、真实/SQL/替身、缓存及未验见[测试手册§5.36](./V25-MIGRATION-TESTING.md)与[统一报告](../../tests/v25/.results/b43/validation-summary.json)。

最终1422源码摘要`a94805b7f9721f96ac65014d8b5a1b23abe1c5e62540912d675165799e0ed22f`；API/worker后仅两处测试文件变化，产品源码一致。只关闭共享包与桌面立即往返切片；导入后修改/更新兼容、云端暂存/确认/事务/下载、F5/D4共享产品及原E全部条件按[路线图§6.31](./V25-MIGRATION-ROADMAP.md)接续，管理员仍未开始。未提交/推送/改版本/部署，原工作树保留。


## B44：导入方案修订继承与来源更新（2026-09-09）

修复桌面混合包导入后修改丢素材、更新缺来源身份；core以文档声明继承、资产行保留原始创建归属，export/prepare/run统一读取。变化来源/新图片和修订同事务写入，保留完整历史正文、旧修订及正式current；新版本仍需本版本真实试跑和封面资格。已知新增目录随事务失败清理，全崩溃孤儿/GC另验。审查修复Windows分隔符拒绝正常受管路径，Node win32/posix专项覆盖正常、跨盘和目录外负例。

最终定向12文件128P，check36/36（31缓存，根2396P/20门控S、features633P）；路径修复前后各一次完整Electron均148P/2外部S、0失败/flaky，最终报告对应修复后构建，自动重试0。源码扫描1331文件0命中。新增真实Electron导入→修改→新PID→导出→再导入通过；导出资格由repository的合成trial/封面建立，不能当真实付费试跑。API/worker全集和Web产品E2E本批未重跑。源码1427文件摘要`15077b90f428d41eef7a3818ce003c0727d757668fe024cfa1a7f4236efe94d9`；前后源码身份、首败和未验范围见[测试手册§5.37](./V25-MIGRATION-TESTING.md)与[统一报告](../../tests/v25/.results/b44/validation-summary.json)。

只关闭本批桌面修订切片；按[路线图§6.32](./V25-MIGRATION-ROADMAP.md)完成F1剩余兼容、F2–F5云端包、D4共享产品和原E全部条件。整个迁移仍未完成，管理员未启动；未提交/推送/改版本或部署，用户原工作树保留。


## B45：共享旧方案包解码与版本、来源事实（2026-09-09）

legacy文档schema和双向转换归入contracts，桌面旧入口继续兼容；共享Node包可在独立API工作目录读取v1完整正文/来源索引。SQLite实际创建列和修订基线保留user/agent/import及父版本，旧JSON不回写或猜测parent；编译证据、轨迹、share-import种类与显式来源绑定可往返。新v2导出固定en-US排序，旧包逐个核对运行时支持的locale精确摘要，格式号/字段不变。云端上传、确认和事务导入下载仍未接通。

最终定向14文件126P；子进程测试改造后locale/ZIP13P，四个真实Node默认locale完成20次交叉读取。API377P、worker85P；check36/36、0缓存，根2416P/20门控S、features633P；完整Electron148P/2外部S、0失败/flaky/自动重试。源码扫描1340文件0命中。创建来源/精确parent新增断言在实际Electron导入→修改→新PID→导出→再导入通过；正式导出资格仍为repository合成trial/PNG。首败、并发超时修复、B44首次typecheck原stdout被辅助脚本覆盖的证据缺口，以及真实/替身和未验范围见[测试手册§5.38](./V25-MIGRATION-TESTING.md)与[统一报告](../../tests/v25/.results/b45/validation-summary.json)。

最终1436源码摘要`2225fecf2c57bd81e6dcc44b504141d8dc69c46094356d60cee48aac955e3a5a`；API/worker之后只改新locale测试的进程组织，产品源码相同。仅关闭共享格式兼容切片，按[路线图§6.33](./V25-MIGRATION-ROADMAP.md)实施F2持久上传确认、F3/F4导入下载，再F5/D4与原E全部条件；整包和管理员前置仍开放。无新DDL、提交、推送、应用版本变化或部署，原工作树保留。


## B46：云端方案包持久上传与精确确认（2026-09-09）

接通Hono包上传意图、原始字节PUT、持久状态、精确确认与取消，api-client新增受验证的二进制传输。PG0019保存owner/request/hash/解析版本/身份摘要与租约；原对象登记/outbox先于PUT，取消/失败/拒绝登记cleanup_pending，worker检查有效暂存和在途租约后复用原清理。确认前重新核对S3原始字节，事务重查账号/会话/授权版本；确认不创建方案或授权模型花费。

定向包集成/流/S3共25P（19+4+2），contracts7P/client3P；最终API23文件396P、worker9文件88P，0失败/跳过；最终check36/36、30缓存，根2426P/20门控S、features633P；源码扫描1362文件/1归档，0命中/错误。覆盖v1/v2实际ZIP、真实分块HTTP/S3、并发/拒绝/取消/篡改/到期/事务失败与两个实际SIGKILL/新PID恢复点。首次完整API395P/1F为既有两worker进程测试5秒超时，改为直接Node启动后14项专项及完整API通过，未增加超时或删断言。生成文件格式、fixture漏mimeType、公共错误码和测试类型首败均留证；详情见[测试手册§5.39](./V25-MIGRATION-TESTING.md)与[统一报告](../../tests/v25/.results/b46/validation-summary.json)。

最终1455源码摘要`79032af137f1cd31e0bd919f88bba44763479f7342158788d8b430a40f9668e9`；worker后仅既有Agent测试启动方式变化，产品相同。本批没有运行产品E2E、实际生产账号/S3、256MiB最大负载或生产迁移/发布；GC新增用例验证保护/退休/ack，完整实际删除与自然期限另验。仅关闭上传/确认后端切片，按[路线图§6.34](./V25-MIGRATION-ROADMAP.md)继续F3/F4、F5/D4与原E。旧prepare/import/export仍501，整包和管理员前置开放；无提交/推送/应用版本变化，原工作树保留。


## B47：云端方案包导入内容准备与固定新身份（2026-09-09）

API私有内容准备从实际v1/v2 ZIP重建新实体身份、完整正文/素材和来源/编译事实，复用既有sharp完整像素解码。原封面/输出只作example；v1来源唯一匹配、manifest-only来源保留、预览实际持有、非canonical commit与scan隔离为私有出处。新seed产生独立身份，固定seed/时间的新Node PID可重建一致计划；它没有HTTP或数据库调用方，不能标为原子导入完成。

20项定向通过，完整check36/36（30缓存）、API默认318P/395门控S、根2426P/20门控S、features633P；源码扫描1367文件/1归档，0命中/错误。首次往返夹具将SKILL.md错误标为JSON，19P/1F及对应check失败均留证；改为源文件MIME后完整通过。类型推导首败、真实ZIP/像素/新PID、合成formal envelope、缓存及未验边界详见[测试手册§5.40](./V25-MIGRATION-TESTING.md)和[统一报告](../../tests/v25/.results/b47/validation-summary.json)。

最终1460源码摘要`80d153c9548f2e35ebefe3527df7932bd3478efa5f5c07125e9036dc78359b8e`；相对B46新增5文件，已有源码不改。无DDL、API/worker数据库全集或产品E2E复跑，无提交/推送/改版本/部署。接续[路线图§6.35](./V25-MIGRATION-ROADMAP.md) F3.1/F3.3、F4/F5/D4与原E；父卡/整个迁移与管理员前置继续开放。

## B48：云端方案包持久原子导入与幂等回执（2026-09-09）

生产import-package已接PG0020持久导入，原确认授权与实际包字节重验、固定seed/身份和结果；每attempt独立对象key、PUT前原registry/outbox，来源/完整文件/素材/新draft/回执同事务。当前epoch/租约保护提交，完成重放不重建后来修改或删除的方案。worker对仍被引用的导入对象保留延期清理intent，账号删除后可实际删除；修复包内大于20MiB图片在content/参考图预检读取预算不一致。

最终导入28P、合同/schema41P、包清理5P；完整check36/36、0缓存（根2427P/20门控S、features633P），启用数据库API24文件424P、worker9文件90P，均0失败/跳过。扫描1374文件/1归档0命中/错误。三个实际SIGKILL/新PID、旧epoch迟到、S3落物后错误、PG事务回滚和实际DeleteObjects协议有证据；会话、S3及来源为显式fixture，阶段TTL由PG注入。首败夹具mode/图片槽与update返回形状已修，不删除产品约束；详见[测试手册§5.41](./V25-MIGRATION-TESTING.md)和[统一报告](../../tests/v25/.results/b48/validation-summary.json)。

最终1467源码摘要`460aae4e44fd074279966420a92ea50ad5fa0f20912432b75db3174e01e443f0`，对B47新增7/修改14/删除0。没有本批完整UI/Electron、真实模型/生产桶/自然保留期/最大包或生产发布验收。仅关闭原子导入后端切片，按[路线图§6.36](./V25-MIGRATION-ROADMAP.md)完成F3剩余联合、F4/F5/D4及原E全部条件；整包和管理员前置仍开放。无提交/推送/应用版本变化/部署，用户原工作树保留。

## B49：云端正式归档、持久请求与受控下载（2026-09-09）

新增package-exports新接口/PG0021/客户端完整字节校验，正常会话及本人精确正式版本、当版本trial/cover与完整来源/素材逐次重验；原registry/outbox在PUT前，取消保留在途租约，原请求重放不重写对象。下载读前读后重验权限/版本/hash，ready不等于宿主已交付。发现并修复来源图片兼封面破坏角色校验的问题：保持来源原角色，归档内另存cover副本，PG原资产不变。

最终定向导出30P（含三个实际SIGKILL与不同新PID）、contract/client/schema22P、包清理7P；check36/36、5缓存，根2442P/20门控S、features633P；数据库API25文件454P、worker9文件92P，均0失败/跳过。源码扫描1386文件/1归档零命中/错误。真实HTTP/PG/S3与SQL trial/fetch流/Node helper边界、首次confirmed/baseRevisionId夹具失败、实际cover缺陷和后续角色夹具失败/格式修复见[测试手册§5.42](./V25-MIGRATION-TESTING.md)及[统一报告](../../tests/v25/.results/b49/validation-summary.json)。

最终1479源码摘要`ecc26a953d5fcce6bfb3650d9ef595d5f279ce1e83c3c988f815b7ac67cadee3`，新增12/修改10/删除0。原export-package/prepare宿主接缝和共享产品未接，真实试跑/Agent上游更新联合、自然期限、导出包独立扫描、旧消费者与全平台生产仍待。只关闭后端切片；按[路线图§6.37](./V25-MIGRATION-ROADMAP.md)继续F5/D4、F3/F4联合及原E，整个迁移与管理员前置不关闭。无提交/推送/应用版本变化/生产部署。

## B50：云端方案包导入页面与确认框快速重开修复（2026-09-09）

共享packageImport gateway及Web挂载，文件/格式选择→真实字节hash上传→服务端预览→明确确认→原子导入原回执/详情已接；关闭和迟到请求清理、响应丢失复核、重复点击与换号/账号刷新失败保护均有测试。Desktop原生入口继续。全量回归实际发现AlertDialog两兄弟portal在退出时差下重开倒序，已同组挂载修复，前后浏览器红绿证据与失败原始记录保留。

导入定向15P、client4P、确认框2P；PC/移动专项14P；完整check36/36（26缓存，根2443P/20门控S、features648P、ui15P、client87P）；启用数据库的完整E2E 325P/7S、0失败/不稳定。源码扫描1393文件/1归档零命中/错误。最终1486文件摘要`159885cd176722b491010bc06d99b2d944c10be08d21bd558ede5c98219296a3`，相对B49新增7/修改10/删除0。结果、首败/中止、真实/替身边界见[测试手册§5.43](./V25-MIGRATION-TESTING.md)与[报告](../../tests/v25/.results/b50/validation-summary.json)。

F5导出宿主交付/刷新恢复/跨端真包、D4与F3/F4及原E仍开放，按[路线图§6.38](./V25-MIGRATION-ROADMAP.md)继续。管理员未启动，不将本批当作整包验收完成。

## B51：正式方案包Web交付与移动详情排版（2026-09-09）

B51已接正式包共享导出与Web完整文件交付，并修复移动详情标题/待验证说明挤压。合同1P、host10P、features11P，PC/移动专项28P；check36/36（27缓存），数据库条件完整E2E335P/7S、0失败/不稳定。源码1492摘要11c92e956b1de9ccbe20501d1b8420033f88d4f22378f4cf1f5fd28cf21fc000，扫描1399文件/1归档0命中/错误。

同次意图冻结正式revision/version/request，复用B49受控归档字节；支持保存选择器时成功close才报delivered，浏览器Blob只报download-started，取消/权限/账号变化/迟到结果和清理失败各自保持真实语义。Desktop原生入口未换成云导出。视觉审查发现标题20px/版本说明52px的窄屏挤压，已补分行和真实浏览器前后断言；中间fixture、类型与几何阈值错误及两次主动中止全部留证。

证据和限制见[测试手册§5.44](./V25-MIGRATION-TESTING.md)与[报告](../../tests/v25/.results/b51/validation-summary.json)。本批HTTP非ZIPfixture与FSA替身不代表真实三方向交换；按[路线图§6.39](./V25-MIGRATION-ROADMAP.md)接F5-R/F5-X、D4、F3/F4及原E，管理员仅在全部2.5完成后接续。

## B52：服务器导入记录、刷新恢复与后续goal重整（2026-09-09）

**交付**：复用PG stage/import，通过本人只读分页和原回执恢复丢begin/丢提交回包的导入。共享页面支持明确查看历史、核对执行状态、重选原文件和明确继续；关闭/Esc/卸载保留服务器记录，取消另行确认。已完成回执可在上传过期后核对，不重新创建已删除草稿；当前账号错误隐藏旧内容，原会话变化阻止未完成任务继续。无新DDL，Desktop原生包流程沿用。

**验证**：合同/staging10P、client5P；真实PG/HTTP/S3导入上传53P，连导出83P；完整check36/36（16缓存，根2447P/20门控S、features666P、client88P）；数据库条件完整E2E **345P / 7S，0F/0 flaky**。新增真实ZIP生产页面reload/双页面使用真实包服务、隔离PG与本地S3协议，身份解析为fixture，未冒充实际登录。源码扫描1409文件/1归档0命中/错误。最终源码1502项，摘要`f0b3dc3fbcfd1eda916fa7bb1bfd2dfcf7510b2f020d9fd6e1e7366a2938c93d`，相对B51新增10/修改15/删除0。

**首败与修复**：两份浏览器测试格式问题修正；既有纯注入传输超时用例在全仓负载下出现取消断言失败，仅用受控时钟固定两个模拟用例的开始/到期时序，先证明fetch开始再验证取消，生产传输及真实HTTP用例未改；专项50P、完整check重跑通过。首轮浏览器16P/2F为两张预览文案/取消按钮变化，复核新旧图后只更新对应基线并定向2P，最终完整E2E通过。首次扫描缺少必需参数退出2，保留失败并用正确命令执行。截图已复核，不以扩大超时、force click或删用例掩盖失败。

**文档与下一步**：更新README/路线图§6.40、任务卡§5、测试手册§5.46、专用包§14、UI§8B/D40及旧卡导航。细拆F5-R.E1–E4导出恢复，并保留F5-X三方向真包、D4异步Agent共享产品、F3/F4费用/试跑/正式化联合与原E完整发布条件。管理员建议仍为迁移全验后权限/审计→只读诊断→受控操作，复用现有技术栈。报告见[统一证据](../../tests/v25/.results/b52/validation-summary.json)，完整测试/跳过与来源边界以[测试手册](./V25-MIGRATION-TESTING.md)为准。

**完成边界**：只关闭B52导入恢复切片；真实Better Auth、三方向文件交换、导出刷新、自然TTL/最大文件、实际Agent/worker全链、独立新包扫描及全平台/生产仍待。G-CLOUD-05/06、P01、整个v2.5和管理员前置不关闭；无提交/推送/版本修改/生产部署。

## B53：原导出归档恢复与明确交付（2026-09-09）

复用PG exports增加本人分页记录和原资格核对，接strict contracts/client/可选gateway及共享页面；中心历史入口允许方案变化或删除后核对原记录。GET不重新打包/读写对象/续租，不返回授权/对象键；旧授权、版本依据和剩余期限仍由原服务验证。关闭/迟到begin/宿主交付后保留原归档到TTL，取消单独确认；恢复不自动下载，ready不等于已保存。原生Desktop不改，无新DDL。

合同2P、client10P、路由1P、features18P，最终实际包PG三文件94项；完整check36/36（31缓存），数据库条件完整E2E **355P / 7S，0F/0 flaky**。源码1509项摘要`525b0f9a5e057dee1eb63ebc4d8d3c1138b58e8446a1f5ef8565fe05dc5895c4`，对B52新增7/修改17/删除0。源码扫描1416文件/1归档，以及专项和完整E2E各两份真实导出ZIP分别独立扫描，均0命中/错误。PC/移动实际文件下载、hash与重新解析通过；身份解析与SQL trial资格仍是fixture，不能代替真实账号或worker试跑。

首轮专项53P/3F：两处统计误含前置导入PUT，按精确导出GET修正；移动列表新历史动作换行引起视觉变化，复核后只更新对应1张baseline并定向1P。移除交付完成后的无效刷新控制；真实ZIP专项重跑2P，最终完整门禁通过。组合PG命令曾误写不存在的upload筛选，实际75P两文件，随后实际上传文件19P；三份B52专项原始日志被复制runner误覆盖，已修正并明确保留日志缺失记录，原汇总与完整check/E2E等未受影响。所有真实命令、首次结果和限制见[统一报告](../../tests/v25/.results/b53/validation-summary.json)及[测试手册§5.47](./V25-MIGRATION-TESTING.md)。

只关闭本批导出恢复切片。下一步F5-X三方向真包/真实身份、D4异步Agent共享产品、F3/F4费用/试跑/正式化联合及原E完整可靠性/数据/平台/安全/生产回滚，随后才是G-OPS管理员。P01、G-CLOUD-05/06与整包保持开放；无提交/推送/版本变化/生产部署。

## B54：真实登录与三方向v2方案包交换（2026-09-09）

B54已验证实际Better Auth登录及v2方案包三个交换方向，完整正文/来源/图片映射和新草稿身份一致；不同颜色/尺寸/hash及Unicode语料复验通过。实际外部上游、worker试跑和系统picker仍为独立待验条件。

B54证据：完整回归358P / 7S，0F/0 flaky（1518项原语料源码），最终不同图片语料身份33P与三方向3P、完整check及源码/两组实际ZIP扫描通过。最终1519项摘要5aae120bee8ec4b03fc42f5dd4367fe8475674673f67c7f9aa8e562b74b07d7e；两组源码和首次失败见tests/v25/.results/b54/validation-summary.json与测试手册§5.48。只关闭本批测试设施/证据切片，Web图片、F5-X剩余、D4/F3/F4/原E与整包及管理员前置继续。

复核原语料图片相同后，追加不同颜色/尺寸/hash和Unicode名称，只改测试语料/调用点/断言。保留原全量报告身份，最终单独执行适用专项和完整check；不将前次全量标成最终源码重跑。实际登录不等于生产上游，trial资格及系统picker替身不代替真实创作/系统交互。下一步Web方案图片接线→F5-X剩余兼容/边界→D4异步Agent与F3/F4真实试跑联合，再按原E完成数据、四端及发布验收。整包未闭合，管理员未启动。

## B55：Web方案图片与共享加载恢复（2026-09-09）

B55已接Web受保护方案图片，共享列表/Inspector/详情/相册/灯箱具备加载、可读失败与明确重试；实际不同图片解码、像素/hash、焦点恢复及身份拒绝已有本机证据。

B55：完整check36/36（27缓存），数据库条件完整E2E 360P / 7S，0F/0 flaky，共367项；最终源码1524项摘要c291a6c8dc63ba62621d317770a60e6e40dd8f16781906f0d5af009e462dc6c7，相对B54新增5/修改6/删除0。源码1431文件/1归档及两轮各8份和中止轮6份实际ZIP扫描零命中/错误。首次焦点失败与修复、真实/替身/skip边界见测试手册§5.49和tests/v25/.results/b55/validation-summary.json。只关闭图片切片，父卡及整包保持开放。

首次两个新浏览器用例发现灯箱关闭后焦点丢失，首次全量另发现截图遇URL重挂载；已显式归还原触发器或相册，保留原断言重跑通过；无baseline变更。新增任务卡§5.7把异步Agent拆为传输能力、原任务恢复、创建授权、修改更新及联合收口五组，明确每组阶段测试均待执行。继续F5-X剩余兼容/环境边界、D4异步Agent共享产品与F3/F4真实试跑联合，再按原E完成可靠性、数据、四端及发布。整包未闭合，管理员未启动。

## B56：异步Agent共享接缝与本人执行历史（2026-09-09）

B56已复用七个异步Agent客户端入口并接入可选gateway，补严格入参/执行身份/事件校验；新增本人只读执行历史、不可变创建时间和稳定分页。共享恢复页面、创建授权及修改/更新尚待接入。

B56：合同19P、客户端51P、Agent真实PG20P；完整API集成482P、worker集成92P；完整check36/36（17缓存）。源码1532项摘要`6f6d0793a6cb8e113fb7ddd3ecbacd8b370ad436631dd130f9e587ac4f8b350d`，相对B55新增8/修改14/删除0，源码扫描1439文件/1归档零命中/错误。首败与范围见测试手册§5.50及tests/v25/.results/b56/validation-summary.json。仅关闭异步接缝/执行发现基础，共享恢复UI与D4-C/D/E、F3/F4、F5-X剩余及原E保持开放。

新增0022创建时间/索引及旧记录回填，原requestHash/事件/费用和旧Desktop同步协议保持；提取包服务正常账号事务核对供只读历史复用。20项Agent实测包括实际旧库升级、重复迁移、微秒分页、丢响应、撤权和私有字段隔离。首次Zod、夹具数组、过期会话测试恢复及全仓进程超时均保留在测试手册，未放宽生产限制或断言。

下一步按任务卡§5.7.1接共享恢复、独立授权、创建/修改/更新及实际worker试跑。B55浏览器报告不冒充本批重跑，生产/跨平台条件仍开放；管理员未启动，无提交/推送/版本变更/部署。

## B57：共享云端创建授权与原任务恢复（2026-09-09，产品联合仍进行中）

B57已接共享云端创建的独立文本授权、逐源确认、本人任务分页与原执行恢复；工作台只在completed后报草稿成功。页面协议已验，实际Agent服务产品合流、修改/更新及完整试跑链仍待。

B57：新增mapper/controller18项、连既有方案组件专项52P；新增PC/移动协议流程4P；完整check36/36，数据库条件完整E2E 364P / 7S，0F/0 flaky。源码1540项摘要`648602ad13b33b8f2aea55d00517ff0a564d00b1d73c5b7e4e7bfa1d3b297465`，相对B56新增8/修改7/删除0；源码扫描1447文件/1归档及本轮10份真实方案ZIP独立扫描均零命中/错误。实际命令、首败和限制见测试手册§5.51及tests/v25/.results/b57/validation-summary.json。B57的实际API/PG产品联合未完成，任务保持进行中；父卡、整包和管理员前置不关闭。

新增显式费用offer、冻结原请求、来源精确确认、本人任务分页/get/events、关闭与取消分离，复用共享工作台和方案中心。修复移动Sheet留白；独立界面审查ship只覆盖新四张授权/来源截图。首次类型、异步断言、账号/来源夹具、残留测试端口和移动基线问题均保留，见[测试手册§5.51](./V25-MIGRATION-TESTING.md)。

当前新增浏览器流程为生产页面/客户端加HTTP协议夹具；实际Agent登录/PG/模型队列产品合流、修改/更新和真实试跑到导出继续任务卡§5.7.2。管理员结构补Next共享features/Hono/PG、最小角色及审计矩阵，尚未开发。没有提交、推送、版本变更或生产部署。

## B58：实际Agent创建与共享页面合流（2026-09-09，本批验收通过）

B58已验证共享云端Agent创建与实际Better Auth/Hono/PG/Graphile合流，涵盖纯描述、两GitHub来源、历史素材、丢回包/双页恢复和原请求重放、取消/撤权及未知费用。云端修改/更新入口、真实生图试跑到正式化与包交付的联合流程仍待。

生产改动仅在既有createApp服务装配中增加可选Agent注入，默认服务/认证/限流保持；测试复用实际登录及方案包隔离设施，新增真实Agent队列和浏览器7类双视口场景。未改共享UI、视觉基线或数据库schema。

B58真实服务PC/移动专项14P、关联API集成71P；完整check36/36，数据库条件完整E2E 378P / 7S，0F/0 flaky（1208.238秒）。最终源码1545项摘要`4ad6c44b0517c78df78854e500f13c0d5ee3429e1414510389505e145a758e52`，相对B57新增5/修改3/删除0；源码扫描1452文件/1既有归档、本轮10份实际方案ZIP独立扫描均零命中/错误。

文本模型、GitHub、S3和上游账号为受控服务；历史图为预置材料，不代表新方案已经试跑。Agent消费者在测试进程内运行，不替代正式进程重启或实际收费上游、全平台包及生产验收。 首败包括测试SQL保留字、来源断言、轮询退出次序、构建与浏览器误并行、历史身份与导航等待、JSON类型检查，均保留并修复；完整记录见[测试手册§5.52](./V25-MIGRATION-TESTING.md)与[批次报告](../../tests/v25/.results/b58/validation-summary.json)。

B57原verify保留的真实创建联合由本批补齐，两个切片可关闭。接续[任务卡§5.7.3](./V25-MIGRATION-GOALS.md)的D4-D→D4-E→D4-J，再完成F5-X/原E；整包与管理员前置未闭合。无提交、推送、版本变更或生产发布。

## B59：共享云端修改、固定版本与独立授权（2026-09-10）

B59已接共享云端方案修改：同次读取冻结revision/version，独立最多1次文本授权，丢回包按原执行恢复，连续修改精确working draft；取消、冲突、撤权和unknown保留原正式版。下一步是免费上游检查/独立更新授权，以及真正生图worker试跑→封面→正式化→专用包联合。

复用既有Agent控制器、授权Dialog/移动Sheet与工作台生命周期，不增新DDL/后端业务服务/平行任务表。附件从同次详情读取保存version与revision，提交前不换最新版本；失去202回包时取消仍使用modify语义。明确版本冲突停止原请求重试并保留描述；只有completed清正文。真实服务验证连续修改、旧资产保留、原请求重放、取消/冲突/撤权和unknown；点击转正但无新trial时被拒绝，原正式版未变。

B59组件专项83P、实际API三文件28P、PC/移动真实服务专项12P；完整check36/36（31缓存），最终数据库条件完整E2E **390P / 7S，0F/0 flaky**（1296.018秒）。最终源码1546项摘要`6f9aa0a1cc8821f29f92c5392ab6ae698b8b719b3f2c1f5df8f66f6dbc8f164f`，相对B58新增1/修改16/删除0；源码1453文件/1既有归档，以及本轮22份实际ZIP扫描均零命中/错误。

首次typecheck发现既有测试附件缺少新增必需expectedVersion，补齐各fixture真实版本；首次组件75P/1F因使用仓库未安装的jest-dom断言，改用既有Vitest断言后83P。未削弱类型或业务断言，完整门禁使用最终测试源码。新增12例首次专项后仅补转正拒绝断言及测试类型守卫，最终完整E2E包含这些改动。四截图与相关代码独立审查为局部ship，detector[]，不改视觉基线；记录已写入UI规范。

本轮归档共24份，其中12份为修改用例的合成既有方案输入ZIP，另外10份是既有跨宿主导出/交换ZIP，其余2份为HTTP交付字节夹具；不能称为22份新版本正式导出。旧正式基底通过fixture历史trial及实际封面/正式化HTTP准备，新Agent版本未用SQL补试跑资格。实际收费上游、正式Agent进程重启、真实新版本出图全链、全部GC/迁移/文件环境/各平台包/生产与回滚仍待。 后续拆解见[任务卡§5.7.4](./V25-MIGRATION-GOALS.md)，全部实际命令与首败见[测试手册§5.53](./V25-MIGRATION-TESTING.md)及[统一报告](../../tests/v25/.results/b59/validation-summary.json)。没有提交、推送、版本修改、生产部署或管理员开发。

## B60：免费上游检查与独立更新授权（2026-09-10）

B60已接共享上游更新：免费检查固定版本、逐变化来源采用、独立绑定会话版本的文本授权和原执行恢复；仅编译实际变化来源，未变化来源及图片保持。创建/修改/更新产品均已有实际后端合流证据，下一步是真正生图worker试跑、封面、正式化与方案包联合。

详情冻结同次读取的方案/revision/version；共享控制器支持无text的check-update、无来源/无更新终态、逐变化来源确认，以及历史恢复后单独获取offer。费用授权按变化数+1调用绑定原session.version；免费start与付费authorize各自保留原请求，丢响应不自动代批或重发。复用原Dialog/Sheet和文本offer呈现，Desktop旧路径保留，无新DDL、消费账本或业务后端。

B60初期组件专项91P（最终check含恢复回归后features716P）、实际API三文件45P、PC/移动真实服务专项18P；完整check36/36，最终数据库条件完整E2E **408P / 7S，0F/0 flaky**（1625.283秒）。最终源码1547项摘要`33ae75cbe64bd849c7d7e378086afc23914f71dcbef95d42d91efa202b4e063b`，相对B59新增1/修改8/删除0；源码1454文件/1既有归档及本轮22份实际ZIP扫描均零命中/错误。

首败：新Testing Library断言误用exact参数导致typecheck失败；首轮浏览器13P/3F，其中两处授权接口误断言202（实际200，免费start仍202），一处隔离后端启动120秒超时而尚未进入取消操作；第二轮16P/2F为测试Analyst未选仓库图片。修正测试接口预期、补明确图片选择并保留图片保护断言；加强异常时fixture清理及禁止退出期间新模型hold，原启动超时保持。第三轮17P/1F为账号status请求ECONNRESET；原未知结果场景原样重跑2P。视觉复核发现恢复成功仍显示旧错误，修复为仅首次核实或更新版本时清除，并新增自动恢复回归；调整草稿/正式版措辞和截图toast等待。最终专项18P，完整回归另验最终源码；无视觉基线/生产超时变化。

B60新用例的基底由真实Agent创建，未用SQL制造试跑/正式资格；账号上游、GitHub、文本模型与S3为本机受控服务。全量归档24份：12份B59修改用例的合成既有基底输入ZIP、10份既有跨宿主导出/交换ZIP、2份HTTP交付字节夹具；它们不证明新方案已经通过生图试跑并正式导出。真实收费上游、完整新版本出图链、全部生命周期/各平台包及生产回滚继续待验。 六截图和代码的局部评审、精确命令/源码身份与失败日志见[测试手册§5.54](./V25-MIGRATION-TESTING.md)及[统一报告](../../tests/v25/.results/b60/validation-summary.json)。下一步按[任务卡§5.7.5](./V25-MIGRATION-GOALS.md)完成D4-J、F5-X与原E；没有提交、推送、版本修改、生产部署或管理员开发。

<!-- B61:START -->
## B61：真实试跑与连续版本联合（2026-09-10，进行中）

B61进行中：新增取消前后、上游unknown和丢受理回包联合回归，实际API3P及PC/移动8P。真实generation worker已接入；纯描述、GitHub和历史素材三形态在PC/移动Web完成新方案出图、封面、正式化和实际方案包往返，GitHub还完成修改与上游更新后的独立新试跑/新封面/promote。修复新版本加载时Agent进度窗口重建，以及原生云端历史素材导出缺失完整内容。

新增生命周期回归1P、历史导出/篡改回归3P、实际API联合与导出42P；最终正向浏览器6P/0S/0F/0 flaky（120.974秒），完整check36/36（24.623秒）。源码1554项摘要`d0b30e3906f758d9019c39444fc528da306333dc83d5b444b0c5c81d97b87bcc`，相对B60新增7/修改8/删除0；源码及截至专项的16份实际ZIP扫描零命中/错误。故障增量源码1556项`600e79e2a45394e468c056bdc1455ed66224d3f12204893b8d5f7623cc655b8d`，只新增2个测试文件；API3P（13.444秒）、浏览器8P（78.449秒）、最终check36/36（6.683秒）。全量实际28ZIP及2份纯文本UI下载替身正确分类扫描零命中/错误；最新源码复扫零命中/错误。

历史正向全量414P/7S对应1554项快照，之后故障专项对应1556项；最新跨宿主修复与测试对应1559项，结果与适用回归见测试手册§5.55最新增量。J4-b三形态内容往返正向已验，系统picker取消仍由F5-X.H补验；J5详情读取故障、撤权/版本竞争、实际异常进程与资产清理组合，F5-X其余及原E/平台包/生产回滚仍待。B61、迁移整包和管理员前置保持开放。 详见[测试手册§5.55](./V25-MIGRATION-TESTING.md)、[后续任务§5.7.6](./V25-MIGRATION-GOALS.md)与[阶段报告](../../tests/v25/.results/b61/validation-summary.json)。
<!-- B61:J4 START -->
**J4-b最新进展（2026-09-10）**：B61跨宿主增量：纯描述、GitHub、历史素材三类真实新Agent结果均通过 Web→Desktop→Mobile Web（3P，83.409秒）；桌面以实际BYOK试跑获得本版资格，选新封面正式化，经新PID重启再导出，由另一Web账号导入为无资格新草稿。修复桌面导出按扩展名覆盖已接纳文本MIME的问题，完整分享单测21P、check36/36；本轮留存13份真实ZIP（最终专项6份）及源码扫描零命中/错误。 同源码完整Electron及受影响网页回归：160P/2S/0F/0 flaky（1004.633秒）；这不是全部Web用例重跑。 J4-b三形态内容往返正向已验，系统picker取消仍由F5-X.H补验；J5详情读取故障、撤权/版本竞争、实际异常进程与资产清理组合，F5-X其余及原E/平台包/生产回滚仍待。B61、迁移整包和管理员前置保持开放。 详见[测试手册§5.55](./V25-MIGRATION-TESTING.md)。
<!-- B61:J4 END -->
<!-- B61:AUTHORITY-READ START -->
**授权与读取恢复最新增量（2026-09-10）**：B61新增正式回归：授权失效/真实登出发送前后及版本冲突API6P（25.606秒）；PC/移动故障专项12P/0S/0F/0 flaky（127.780秒），含原取消/unknown/丢回包8项与新增事件/任务读取失败、详情错误态及显式重试4项。check36/36（33.404秒，30缓存），源码扫描零命中/错误。 当前仅测试及fixture变化，1561项源码摘要0cde8ba7…；J5实际浏览器撤权/跨owner/版本与promote组合、材料型交叉故障、实际bin异常重启/自然租约/stale epoch及对象/数据库清理仍待。F5-X、原E、平台/生产与管理员前置不随本片关闭。 证据与首次失败见[测试手册§5.55](./V25-MIGRATION-TESTING.md)。
<!-- B61:AUTHORITY-READ END -->
<!-- B61:PROCESS-NATURAL START -->
**进程与自然租约增量（2026-09-10）**：B61新增实际进程3项已验：领取前强杀后新PID一次成功；发送后强杀/暂停经生产10分钟租约自然到期与分钟巡检收敛unknown，图像请求仍各1次；旧暂停进程恢复后终态/回执不变、无新增资产。API完整集成496P、Worker完整集成92P，网页故障专项12P；最终check及源码扫描通过。 自然领取后未发送的epoch替换、取消交错、迟到上传/新引用保护、J5-e与F5-X/原E、平台包/生产回滚仍待；管理员前置保持开放。 首次失败、复验和源码身份见[测试手册§5.55](./V25-MIGRATION-TESTING.md)。
<!-- B61:PROCESS-NATURAL END -->
<!-- B61:ASSETS-EPOCH START -->
**资产与自然租约增量（测试2026-09-10，证据回填2026-09-12）**：B61新增7项资产/进程联合已验：参考图篡改或删除时零图像发送；实际10分钟租约后未发送任务由新PID以epoch2成功，取消交错与迟到PUT隔离；写入后删除失败保留对象并跨新PID等待实际5分钟退避再清理。完整API503P、Worker92P，网页正向与故障18P；check36/36及源码、6份实际新方案ZIP扫描通过。 PG输出落库/丢提交回包、cleanup与新引用竞争、J5其余/F5-X/原E及全平台/生产回滚仍待；本片未证明S3连接断开，完整迁移与管理员前置保持开放。 详见[测试手册§5.55](./V25-MIGRATION-TESTING.md)。
<!-- B61:ASSETS-EPOCH END -->
<!-- B61:ASSETS-WIRE START -->
**S3连接中断增量（2026-09-12）**：B61补齐2项真实S3回包断线测试：写成后首次断线由SDK同key重传成功；持续断线后原任务保留unknown费用，新PID维护删除孤立对象。两例各1次图像调用，成功资产跨重启/维护保留，失败不产生trial。最终完整API505P、Worker92P，check36/36及源码扫描通过。 继续PG输出落库冲突/提交回包丢失、cleanup与新引用争用、其余J5/F5-X/原E及全平台/生产回滚；B61和整包未关闭，管理员尚未开始。 源码、首次失败与实际证据见[测试手册§5.55](./V25-MIGRATION-TESTING.md)。
<!-- B61:ASSETS-WIRE END -->
<!-- B61:ASSETS-DATABASE START -->
**数据库输出与提交回包增量（2026-09-12）**：B61新增2项实际数据库故障已验：输出登记错误使generation/方案资产、trial和完成事件整体回滚；PG已提交而回包断线时，独立连接证实成功，新PID清理保留受引用图片。两例各1次图像调用、原版本/费用回执不被重启改写。完整API507P、Worker92P、网页18P，check36/36及源码/6份新方案ZIP扫描通过。 接续GC1真实新引用与清理竞争、其余J5数据库/权限/版本组合及F5-X/原E、全平台与生产回滚；B61和整包未关闭，管理员尚未开始。 证据及注入边界见[测试手册§5.55](./V25-MIGRATION-TESTING.md)。
<!-- B61:ASSETS-DATABASE END -->
<!-- B61:CLEANUP START -->
**引用与清理竞争增量（2026-09-12）**：B61新增真实新Agent引用/清理两种次序2项及Worker批次回收1项已验。修复已采用的过期参考图每次维护反复入队10轮的问题：候选排除方案引用，加锁后再次复查；保留最终对象保护。完整API509P、Worker93P、网页18P，check36/36及源码/6份新方案ZIP扫描通过。 继续J5浏览器撤权/跨owner/版本promote与素材交叉故障、在途预检后引用变化等剩余并发；F5-X自然TTL/格式/容量/系统文件交付、原E、全平台和生产回滚仍待。B61、迁移整包及管理员前置保持开放。 边界与真实证据见[测试手册§5.55](./V25-MIGRATION-TESTING.md)。
<!-- B61:CLEANUP END -->
<!-- B61:INFLIGHT-ISOLATION START -->
**在途预检与浏览器身份增量（2026-09-12）**：B61新增在途参考图读取与物理清理交错1项已验：旧GET返回有效字节，事务内重验仍404，零图像调用/新任务/回执/trial。双页面实际登出及独立账号隔离在PC/移动4场景通过，重新登录只恢复原结果。API定向9P，统一check36/36及源码扫描通过；本轮仅测试变化。 接续J5-c真实provider撤key、working-draft promote版本竞争与素材型交叉故障，再完成F5-X/原E/全平台/生产回滚。B61、整包及管理员前置仍开放。 当前1568项8fdc36f1…；API9P在9109d9e9…执行，其API测试/生产源码与当前逐文件一致，后续仅给网页测试追加独立账号检查。最近完整API509P/Worker93P/网页18P及6ZIP扫描属于上轮69d5898e…，本轮未重跑完整后端或全部E2E，不写成全量510P。 详见[测试手册§5.55](./V25-MIGRATION-TESTING.md)。
<!-- B61:INFLIGHT-ISOLATION END -->
<!-- B61:PROMOTE-CONFLICT START -->
2026-09-12：双页面改封面导致的旧转正请求409及显式恢复已验，修改/上游更新两种路径均完成真实新试跑和包往返。导出仍要求本revision封面，恢复流程由用户明确选回；不自动覆盖另一页选择或重新生图。继续J5-c上游凭据撤销、素材与其他故障组合及J5-f；F5-X、原E、四端/平台发布与生产回滚仍待。这里只关闭封面变化导致的promote CAS场景，不据此关闭所有并发交错或B61；管理员前置保持开放。 详细流程、首败与同源码报告见[测试手册§5.55](./V25-MIGRATION-TESTING.md)。
<!-- B61:PROMOTE-CONFLICT END -->
<!-- B61:PROVIDER-RECOVERY START -->
2026-09-12：上游按实际合成凭据撤销的HTTP401与显式恢复已验，包含纯文本和参考图输入。实测还修复了工作台迟到会话加载覆盖新方案正文/图片的问题；主动切会话仍恢复目标内容。完整E2E首轮112P/1F后中止（337项跳过或未执行）；焦点修正后的专项6P/2F进一步定位toast遮挡。补齐正常指针等待后，三形态试跑/版本竞争/导出重导入专项8P/0F/0S/0flaky。完整Web/移动/Electron复验尚未完成，不记整包通过。 详细范围、首败和源码报告见[测试手册§5.55](./V25-MIGRATION-TESTING.md)。继续J5-a/b素材与取消/unknown/丢回包/读取恢复组合及J5-f最终收口，再接F5-X、原E、四端/平台发布和生产回滚。上游采用本地受控HTTP，不是付费供应商实网；恢复是重新启用同一合成key，不声称验证key轮换或管理员代授权。B61、完整迁移与管理员前置仍开放。
<!-- B61:PROVIDER-RECOVERY END -->
<!-- B61:MATERIAL-FAULTS START -->
2026-09-12：B61已扩展纯文本/参考图输入×取消前后、unknown、受理回包丢失、事件/任务读取中断共六类故障的双视口测试；参考图经真实上传，核对正式run的冻结引用ID、实际图像端点和字节SHA256。 素材故障24项与修改/更新30项联合专项54P/0F/0S/0flaky（642.820秒）。 同源码API完整集成514P/0F/0S（673.167秒）；同源码Worker完整集成93P/0F/0S（53.911秒） 同源码完整E2E 455P/7S/0F/0flaky（2284.791秒），跳过项按实际项目/原因保留；当轮真实归档和明确UI替身分别扫描通过。 B61原boundary/verify的12项验收对照已通过，关闭D4-J联合试跑批次；接续F5-X旧格式/异常/容量/自然期限/原生交付、原E数据与同步、四端/平台发布及生产回滚。管理员仍在全部迁移闭合后开始。
<!-- B61:MATERIAL-FAULTS END -->
<!-- B61:END -->

<!-- B62:CORPUS START -->
2026-09-13（运行UTC 2026-09-12）：B62已修复桌面导入旧版方案包后来源/图片在共享详情中丢失：两宿主共用既有旧格式内容映射，桌面重绑来源与资产ID、保存完整正文/图片、隔离旧scan，导入仍为无试跑资格的新草稿。 12份永久语料的file/bytes reader一致；真实PC Web、Mobile Web、Electron共36个导入场景通过（6次合法新草稿、30次坏包拒绝），并验证刷新/新PID重启后的内容、原数据不变与图片hash。当前check36/36通过；API导入/导出/身份专项80P在此前6cc49667…执行，其API及共享生产源码与当前逐文件一致，之后仅测试比较helper变化。当前1579项源码5171ca41…的源码与三轮留存6份合法ZIP扫描零命中/错误；30份故意无效语料另记拒绝，不计为安全交付ZIP。 最终受影响回归163P/2S/0F/0flaky（1180.304秒）：完整Electron153P/2S，PC/移动Web各5P；两项skip分别缺真实登录凭据和生图key，保留为发布条件。四次实际宿主运行累计保存72个文件副本，其中30份有效ZIP扫描零命中/错误、42份故意无效输入另记拒绝；包含复制的picker输入，不把副本数写成独立测试数。最终回归自身新增22份有效ZIP和11份坏包输入。 B62/F5-X.C四项原定验收已通过，仅关闭本卡。继续F5-X.L容量及资源/失败清理，再接T自然期限、H系统文件交付与原E、平台包、生产回滚和远程MCP；完整迁移及管理员前置保持开放。
<!-- B62:CORPUS END -->

<!-- F5-X:L-API-PREPARATION START -->
2026-09-13：F5-X.L容量准备已推进到真实API：12份保存样本完成24次file/bytes reader判定和12条实际HTTP导入/拒绝流程（6允许、6拒绝），覆盖原始合同的manifest、条目数、64MiB条目、256MiB归档/展开量与压缩比。6份当前允许ZIP扫描零命中/错误。尚未完成永久回归集成、Web UI/Electron入口、并发资源与中途写入失败清理，F5-X.L继续开放。 实际最大reader峰值约1.34GiB，API测试进程包含内存S3与客户端，均不代表生产并发内存已验。首次大样本图片解码问题已改用既有可完整解码夹具重生成，旧失败/输入保留，生产代码未改。详见[测试手册§5.57](./V25-MIGRATION-TESTING.md)和[逐样本记录](../../tests/v25/.results/b63/capacity-host-v1-results.json)。
<!-- F5-X:L-API-PREPARATION END -->

<!-- B63:PERMANENT-CAPACITY START -->
**容量宿主增量（2026-09-13）**：B63 已将六类真实容量边界纳入永久回归，12P/0F/0S，共 PC Web、移动视口和真实 Electron 36 个导入/拒绝场景。修复 Next 代理默认 10 MiB 截断及原始大二进制上传的页面崩溃，实际 256 MiB 包在三种宿主均可完整导入、刷新/新 PID 重启读回。该源码 check36/36，16 份留存合法 ZIP 扫描零命中/错误；12 份故意超限输入另列。最大包写成后报错、用户取消和 HTTP 断线三例已通过真实两分钟租约与新 PID Worker 清理（3P），既有 API 导入回归34P；受影响宿主回归15P/0F/0S，最终check36/36及源码/实际合法包扫描通过；并发资源、桌面失败清理仍待；B63/F5-X.L、T/H、原 E、完整迁移和管理员前置继续开放。详见[测试手册 §5.58](./V25-MIGRATION-TESTING.md)。
<!-- B63:PERMANENT-CAPACITY END -->

<!-- B63:DISK-RESOURCE START -->
**容量任务最新进展（2026-09-13）**：真实磁盘满提示和清理已修复并通过完整Electron166P/2S；两项真实凭据skip保留。随后减少API上传缓冲及摘要计算的整包复制，当前b0698cad…的上传单元13P、check36/36、API专项39P、跨宿主容量/语料/交换14P及源码/12份实际合法ZIP扫描通过。独立API同输入四轮观测峰值约3.02→2.51GiB；桌面主进程/renderer亦完成分开测量和新PID读回。该观测不替代部署内存预算，继续混合请求和下载回压下的资源期限核验；B63/F5-X.L、T/H、原E与正式发布保持开放，管理员在全部迁移完成后启动。源码归属、首次失败、实际测试和采样见[测试手册§5.59–5.61](./V25-MIGRATION-TESTING.md)。
<!-- B63:DISK-RESOURCE END -->


<!-- B63:COMPLETE START -->
**容量与资源任务已验收（2026-09-13）**：B63/F5-X.L按原范围完成。修复上传/导入/导出独立计数导致混合请求超额受理、慢下载提前释放名额和HEAD占用名额问题；单API应用共用两个资源名额，查询/取消保持可用，下载消费/断开/真实60秒空闲后释放。当前1596项源码63102ada…的check36/36、API84P、受影响宿主14P（均零失败/跳过/flaky）及源码、23份实际合法ZIP扫描通过；17份故意无效输入另列。本轮包含实际256MiB跨宿主边界与自然租约清理回归，原独立API/桌面测量和HFS+失败恢复按各自源码保留。七项原验收逐条有证据，只关闭B63/F5-X.L。下一项为F5-X.T自然一小时上传/导出有效期、持久回执和清理竞争，再接H、原E、全平台/生产回滚与远程MCP；管理员仍在全部迁移完成后启动。详见[测试手册§5.62](./V25-MIGRATION-TESTING.md)与[逐条验收](../../tests/v25/.results/b63/capacity-acceptance.json)。
<!-- B63:COMPLETE END -->


<!-- B64:PREPARATION START -->
**自然期限测试已启动（2026-09-13）**：B64/F5-X.T复用原一小时stage/export期限，新增真实PG锁跨期导入/下载、Worker清理和持久回执验收。预检已通过，当前仅两份测试文件变化、check36/36；一小时自然测试正在运行，不能记为通过。到期预计上海04:24后核验，再补原范围其余竞争与适用回归。B63已完成，H/原E/全平台/生产与管理员条件保持。详见[测试手册§5.63](./V25-MIGRATION-TESTING.md)。
<!-- B64:PREPARATION END -->

<!-- B64:LIFETIME-GATE START -->
**长时发布门禁已接入（2026-09-13，尚未在远端CI执行）**：Main和Release复用独立85分钟job，测试步骤70分钟并显式启用自然一小时用例；macOS/Windows打包及后续发布依赖该job。校验器要求实际两项测试全通过、原期限已经过、Worker正常退出、两组证据完整且4份实际归档hash相符，再扫描归档；失败也上传报告。当前源码dd4d2436…的check36/36、门禁单测13P及源码扫描通过。真实负对照命令为1P/1S且退出0，校验器正确退出1拒绝skip；其两份实际ZIP扫描零命中/错误。自然运行仍使用c555b61d…，新增6份CI/校验相关文件不改变其API/Worker依赖。详见[测试手册§5.63](./V25-MIGRATION-TESTING.md)。
<!-- B64:LIFETIME-GATE END -->

<!-- B64:LEASE-RACE START -->
**自然租约竞争两种顺序已验（2026-09-13）**：B64新增原两分钟租约下的旧导入停顿、新epoch接续、旧清理与新引用竞争，2P/0F/0S（490.453秒）。两个实际新PID Worker场景均验证旧响应409、零额外PUT、原回执/新来源和资产hash不变；继续等待新对象原清理时间后维护，引用对象仍保留。首次以扣住S3回包模拟停顿触发既有30秒超时，修为真实PUT完成后的测试屏障，未改生产超时/租约；不冒称操作系统暂停了API进程。当前def62aeb…的check36/36和源码/4份本轮真实输入ZIP扫描通过；原API102P、Worker12P及其4份实际ZIP扫描另有准确源码归属。一小时自然有效期仍运行，T和完整迁移未关闭。详见[测试手册§5.63](./V25-MIGRATION-TESTING.md)。
<!-- B64:LEASE-RACE END -->

<!-- B64-B65:COMPLETE START -->
**最新验收（2026-09-13）**：B64/F5-X.T与B65/D03.4均已按原范围通过。一小时自然期限完整2P（3611.546秒）、自然两分钟租约新引用竞争2P、原API102P/Worker12P及18份实际ZIP扫描已核对；PG专项31P覆盖23中间前缀、四处数据回填、三种完整事务回滚与既有fresh replay。当前b88e2b03…check36/36与源码扫描通过，生产迁移SQL未改。仅关闭这两卡，继续H真实系统文件交付及原E中的Worker/费用/旧库/双设备/四端联合，之后全平台、实际CI与生产回滚/MCP；管理员仍待全部v2.5完成。详见[测试手册§5.63–5.64](./V25-MIGRATION-TESTING.md)。
<!-- B64-B65:COMPLETE END -->


<!-- B66:PROGRESS START -->
**B66已验收（2026-09-13，仅D03.5）**：九项真实双客户端同步恢复通过；修复丢回包假冲突、空日志水位及pull/裁剪一致性。当前df6478b1…专项35P、check36/36、完整API556P/1专用小时测试S、worker93P/0S，源码及本轮10份API归档扫描通过。未改变的desktop/core沿62b1f744…完整Electron166P/2外部S及17份实际ZIP扫描承接，源码归属分开记录。[逐条验收](../../tests/v25/.results/b66/acceptance.json)已完成，本卡勾选；D03.6真实Electron换号、旧库、原E与完整2.5继续开放，管理员尚未开始。详见[测试手册§5.65](./V25-MIGRATION-TESTING.md)。
<!-- B66:PROGRESS END -->


<!-- B67:COMPLETE START -->
**2026-09-13：** B67/D03.6 已验收：真实 Electron 跨账号、同步同意、会话失效恢复及本机方案隔离通过。继续 D03.2/3 旧库数据等价与备份故障补验；真实脱敏旧库、原生交付、原 E 与正式发布条件保持开放，管理员尚未开始。 原验收与本轮命令/报告见[测试手册§5.66](./V25-MIGRATION-TESTING.md)及[逐条证据](../../tests/v25/.results/b67/acceptance.json)。
<!-- B67:COMPLETE END -->


<!-- B68:COMPLETE START -->
**2026-09-13：** B68/D03.2–3 已验收：合成旧 SQLite 的逐字段保留、独立方案库升级、真实备份失败和事务回滚恢复通过。当前统一检查通过；继续原 E 的费用/Worker 完整矩阵与数据清理。真实 v2.1 脱敏旧库、原生四端交付、各平台发布及生产回滚仍待，管理员尚未开始。 实際31项迁移专项、28项相关回归、28份阶段摘要及首败记录见[测试手册§5.67](./V25-MIGRATION-TESTING.md)和[逐条验收](../../tests/v25/.results/b68/acceptance.json)。
<!-- B68:COMPLETE END -->


<!-- B69:COMPLETE START -->
**2026-09-13：** B69/原E-W已按W01/W02运行可靠性范围验收：完整Worker集成99P/0F/0S，含18项真实进程和2项正式Linux arm64容器测试；旧epoch不得改写结果，已发送/已认领任务不自动重发。继续费用兼容与完整retention/GC、真实旧库/原生交付和正式发布；远端CI及生产回滚仍待，管理员尚未开始。 原范围、状态矩阵、首败和源码归属见[测试手册§5.68](./V25-MIGRATION-TESTING.md)及[逐条验收](../../tests/v25/.results/b69/acceptance.json)。
<!-- B69:COMPLETE END -->


<!-- B70:COMPLETE START -->
**2026-09-13：** B70已修复提示词恢复与定期/手动永久删除的真实PG竞争：恢复不被误删、清空只处理锁定集合，同步日志和条数准确。当前完整API562P/1专用小时S、Worker100P/0S、check36/36及源码/20份留存合法ZIP扫描通过。只关闭本片；继续Desktop清空500条上限、完整数据清理/费用与正式交付，管理员尚未开始。 证据见[测试手册§5.69](./V25-MIGRATION-TESTING.md)，剩余实体与资产缺口见[生命周期核对](./V25-DATA-LIFECYCLE.md)。
<!-- B70:COMPLETE END -->


<!-- B71:COMPLETE START -->
**2026-09-13：** B71已完成Desktop提示词清空修复：501条一次清完、全部事务失败回滚、同步墓碑与其他workspace保护、真实Electron新PID持久性通过。当前check36/36、完整Electron170P/0F/2S/0flaky及源码/实际归档扫描通过。继续B72云端分页遗漏修复，再接Desktop查询与回收站筛选、完整数据清理/费用及正式交付；管理员未开始。 证据见[测试手册§5.70](./V25-MIGRATION-TESTING.md)及[查询缺陷复现](./V25-DATA-LIFECYCLE.md)。
<!-- B71:COMPLETE END -->


<!-- B72:COMPLETE START -->
**2026-09-13：** B72已完成云端提示词置顶/微秒/Unicode分页修复与严格游标校验，当前完整API604P/1专用小时S、check36/36及源码/10份实际ZIP扫描通过。接B73桌面SQL分页、显式工作区回读与双宿主回收站查询；费用、完整生命周期和正式交付仍开放，管理员未开始。 证据见[测试手册§5.71](./V25-MIGRATION-TESTING.md)。
<!-- B72:COMPLETE END -->


<!-- B73:PROGRESS START -->
**2026-09-13：** B73已按原范围完成Desktop SQL分页、显式工作区回读与双宿主回收站查询：当前check36/36、实际API52P、完整三端E2E476P/0F/7S/0flaky及源码/45份实际ZIP与2份明确UI替身扫描通过。7项skip分为4项外部凭据条件、3项视口不适用，具体项目与原因保留。接B74分类事务/FTS/outbox与真实同步，再补云端硬删除、完整生命周期/费用和正式交付；管理员未开始。证据见[测试续篇§5.72](./V25-MIGRATION-TESTING-CONTINUED.md)及[七项逐条验收](../../tests/v25/.results/b73/acceptance.json)，剩余阶段见[goal清单](./V25-MIGRATION-GOALS.md)。
<!-- B73:PROGRESS END -->

**B74实施中（2026-09-13）：** 分类事务/FTS/outbox已接入，当前本机56P、check36/36通过；继续共享删除确认、真实双客户端/宿主和完整门禁。原云硬删/Session/完整生命周期、费用及正式交付保持开放；[阶段结果](./V25-MIGRATION-TESTING-CONTINUED.md)。

**B74后续进展（2026-09-13）：** 新增共享分类 AlertDialog、失败保留/重试、提交期间防重复与焦点返回；通过原断言修复快速重开时 Escape 误关外层面板。真实两个客户端又复现分类云端 detach 导致三条本机 Prompt 自身版本冲突，现按已知云引用等待相关待发变更回执后发送分类墓碑，含退避/失败及账号空间隔离。新增16项组件和5项依赖回归；最新3c395774…的check36/36、明确build、真实双客户端与新PID1P/0F/0S、源码扫描通过。PC/移动当前未变组件的交互各连续三次通过；完整三端E2E正在运行，待终态、真实归档扫描和原范围逐条审核后再验收B74。首次失败、测试修正、真实数据库冲突和准确源码归属见[测试续篇§5.73.1](./V25-MIGRATION-TESTING-CONTINUED.md)。整包未完成，管理员未启动。

**B74已验收（2026-09-13，最新）：** Desktop分类事务、共享删除确认、FTS与真实双客户端同步/重启已完成；修复关联Prompt自身版本冲突。当前check36/36、明确build、完整三端E2E479P/7S/0F/0 flaky、源码及45份实际ZIP/2份UI替身扫描通过。7项skip逐项保留外部凭据与视口边界。接B75云端永久删除，再补Session、完整保留期/GC、费用和正式交付；管理员未开始。[最终测试及逐条验收](./V25-MIGRATION-TESTING-CONTINUED.md)。

**B75首轮实现（2026-09-13，当前）：** 云端分类永久删除、最小持久删除身份、引用锁、bootstrap投影与旧restore拒绝已接入；当前check、API27P、worker98P/2容器条件S、根迁移首次/重复及源码扫描通过。历史软删回填、长期离线/重放、Desktop冲突消费者和完整联合尚未验收，B75保持开放。[当前证据与下一步](./V25-MIGRATION-TESTING-CONTINUED.md)。


**B75接续进展（2026-09-13）：** 已补Desktop永久删除冲突保护及共享说明，真实双客户端/新PID与原分类同步专项2P；另接入旧软删分类分批回填与CLI，当前实际API/PG51P，含历史前缀/回滚34项。消费者与回填各自源码、首败和验证范围见[测试续篇§5.74.2–3](./V25-MIGRATION-TESTING-CONTINUED.md)。长期裁剪/重放、完整并发/分页与全部联合门禁仍待，B75及父卡不关闭，管理员未开始。


**B75长期离线与事务进展（2026-09-13）：** 90天边界/91天显式维护时钟裁剪、原/新请求防复活及每类205项混合分页已有真实HTTP/PG证据；双独立Electron的保留/过期日志与新PID专项4P。扩展分类事务与HTTP44P，覆盖中点回滚、跨owner、引用及实际worker清理竞争；该轮check36/36通过。当前正执行三形态分类与完整后端联合门禁，B75尚未验收，管理员未开始。准确源码、首败及测试时钟边界见[测试续篇§5.74.4](./V25-MIGRATION-TESTING-CONTINUED.md)。


**B75联合门禁与首败修正（2026-09-13）：** 完整API661P/1独立一小时条件S、worker101P/0S；完整E2E首轮115P/1F后保留现场并中止。已复现并修正浏览器测试代理取消后仍等待上游响应的生命周期缺陷，状态码/Cookie/字节及取消导航6P，实际方案修改/取消/恢复与分类联合20P，本轮12ZIP扫描通过。当前完整三形态E2E正在重跑，B75仍未验收；Session分页缺陷的隔离PG诊断已登记，未改产品代码。源码归属、原失败与范围见[测试续篇§5.74.5](./V25-MIGRATION-TESTING-CONTINUED.md)。


**B76共享会话回收站推进（2026-09-13）：** 新增恢复/永久删除/清空和分页/失败重试；恢复保留归档位置，删除失败保留当前输入，成功延续原有剩余会话回退，最后一条不残留旧草稿。133项局部回归与实际三形态回收站3项（含Electron新PID）通过，当前24da487d…check36/36、源码扫描通过；各源码归属、夹具首败与截图边界见[测试续篇§5.75.4](./V25-MIGRATION-TESTING-CONTINUED.md)。完整E2E已启动尚未终态，实际同时竞争及整卡门禁仍待；B76和全迁移继续开放，管理员未启动。


**B76最新进展（2026-09-13）：** 草稿冲突核对与会话回收站的真实PC/mobile/Electron六项已通过，追加桌面同时IPC恢复/永久删除两种顺序及新PID两项已通过；不同源码、截图及测试错误码首败分开记录。局部92P、统一检查36/36已有通过证据；继续当前完整后端与S03/S04剩余范围审核、S05全E2E和产物验收。原完整E2E已主动停止，B76及全迁移未验收，管理员未开始。详见[测试续篇§5.75.5](./V25-MIGRATION-TESTING-CONTINUED.md)。


**B76最新进展（2026-09-13）：** 完整后端API697P/1专用小时S、worker101P/0S及8份实际方案ZIP扫描通过，准确源码分开保留。另复现并修复重新载入后旧排队草稿借用新版本的问题，工作台/写入器回归和check通过；PG清空集合两种竞争及新到达保留10项通过。当前9项真实宿主复验运行中，完整E2E和原范围验收继续；B76及全迁移未关闭，管理员未开始。详见[测试续篇§5.75.6](./V25-MIGRATION-TESTING-CONTINUED.md)。


**B76最新进展（2026-09-13）：** 已修复重新载入后的防抖/排队草稿及迟到回包隔离，真实三形态会话专项9项通过，包含作品落盘后清理及新PID。PG清空新到达/恢复竞争、隔离根迁移首次/重复、当前check与源码扫描通过；此前完整API697P/1专用小时S、worker101P/0S和8ZIP扫描保留准确归属。当前完整三端E2E运行中，B76及全迁移未验收，管理员未开始。详见[测试续篇§5.75.6](./V25-MIGRATION-TESTING-CONTINUED.md)。
