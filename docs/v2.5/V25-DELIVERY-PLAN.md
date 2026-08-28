# Musefold v2.5 交付计划

> **状态**:实施中
>
> **日期**:2026-08-28
>
> 批次只能按序推进;每批验收全绿后才进入下一批。旧测试随其覆盖的旧代码在对应批次删除,迁移全程保有安全网。

## 批次总览

```text
M0 基线冻结 → M1 工具链原子切换 → M2 服务端重建 → M3 共享层地基
→ M4 按域垂直切换(a 提示词库 / b 工作台 / c 历史 / d 账号 / e 桌面数据与 IPC)
→ M5 收尾(a 测试与门禁 / b 发布链 / c 清库与文档)
```

## M0 基线冻结

| 卡 | 内容 | 验收 |
|---|---|---|
| M0-01 | v2.1 进行中改动全部提交主干,打 tag `v2.5-baseline` | tag 存在,工作区干净 |
| M0-02 | 创建 `docs/v2.5`(README / ARCHITECTURE / DELIVERY-PLAN / DATA-MIGRATION),`docs/README.md` 挂载 v2.5 条目 | 文档入库 |

## M1 工具链原子切换

原则:只换底盘,不动业务代码;旧代码在新底盘上必须全绿。

| 卡 | 内容 | 验收 |
|---|---|---|
| M1-01 | npm → pnpm:`pnpm-workspace.yaml`、`workspace:*` 协议、`.npmrc`(`node-linker=hoisted`)、删除 `package-lock.json`、补幽灵依赖 | `pnpm install` 成功,双端 build 通过 |
| M1-02 | Turborepo 接管全部任务图:`turbo.json` 定义 build/test/typecheck/lint 及依赖关系,本地与 CI 统一走 turbo | `turbo run build test typecheck` 全绿 |
| M1-03 | Biome 2 上线:根 `biome.json` + 全仓一次性 format;legacy 目录 lint 放宽(仅 format + 少量规则) | `biome check` 全绿 |
| M1-04 | 三条新 workflow(pr.yml / main.yml / release.yml 骨架)替换旧四条;`.githooks` Skill-Impact hook 停用;旧自研门禁脚本从 scripts 引用中断开 | PR workflow 在 CI 跑通 |
| M1-05 | 根 package.json scripts 精简为新命令面(dev / build / test / lint / check 等) | 命令清单与文档一致 |

## M2 服务端重建(已完成)

| 卡 | 内容 | 验收 |
|---|---|---|
| M2-01 ✅ | `packages/db`:全新 Drizzle PG schema(Better Auth 核心表 + oauth* 插件表 + prompts/sync/workbench/generation/credentials/skills/ops,28 表),drizzle-kit generate 基线迁移 + 程序化 `migrateDatabase` | 迁移在空库可重放(集成测试即重放) |
| M2-02 ✅ | `apps/api` 骨架:Hono + `@hono/zod-openapi`(registry 注册 + zod 手动校验)+ AppError 错误模型 + zod env;/healthz;/api/v1/openapi.json | 集成测试(testcontainers 真 PG)10/10 通过 |
| M2-03 ✅ | Better Auth 落地:`newApiDelegation` 插件把登录/注册委托 New API,会话建立后固化中继凭据(relay_sessions)与生图 token(account_credentials,AES-GCM 单列密文);bearer + jwt + mcp + cimd 插件 | 登录成功/错误密码 401/会话保护/凭据固化集成测试 |
| M2-04 ✅ | 产品路由重建:account(余额/兑换,自动 refresh 中继 jwt)、prompts(乐观锁)、workbench、generation(幂等键 + graphile add_job 同事务入队 + SSE 事件)、sync(设备/bootstrap/pull/push 幂等重放) | 集成测试覆盖 CRUD/冲突/幂等/重放 |
| M2-05 ✅ | Cloud MCP:官方 TS SDK v2 `createMcpHandler`(legacy: 'reject')+ `requireMcpAuth`(JWT/JWKS)+ 按 scope 过滤的 7 个只读工具白名单 | manifest 单测锁定白名单;401 WWW-Authenticate 挑战集成测试 |
| M2-06 ✅ | `apps/worker`:graphile-worker + Drizzle,租约恢复(upstream_request_sent 永不盲重试)、image-gateway 语义原样搬运;`apps/generation-worker` 退役(删除在 M5c) | 租约决策/图像网关单测 8/8 |
| M2-07 ✅ | 部署:apps/api、apps/worker Dockerfile(pnpm deploy 隔离包)+ `infra/v2.5/compose.yaml`(PG17/minio/api/worker)+ main workflow 镜像构建 job;旧 `apps/web-api` 不再部署(源码删除在 M5c) | 本地镜像构建 + 启动冒烟通过 |

落地备注:云端 MCP 生图/审批/花费预留(v2.1 休眠功能)刻意不迁移;PG RLS + set_config 方案改为应用层 userId 过滤;限流从 SQL 函数改为应用层固定窗口原子 upsert。

## M3 共享层地基

| 卡 | 内容 | 验收 |
|---|---|---|
| M3-01 ✅ | shadcn/ui monorepo 初始化:`packages/ui` 重建(components.json、Tailwind v4 主题、现有设计 tokens 映射);旧包重命名 `packages/legacy-ui` 原位保活 | 组件单测 + 双宿主渲染一致(E2E 快照) |
| M3-02 ✅ | contracts 精炼:新增 preferences 契约;查询参数改 `queryIntegerSchema`/`queryBooleanSchema`(替代 z.coerce)修正类型推导 | schema 测试全绿 |
| M3-03 ✅ | `packages/platform`(MusefoldGateway + query keys + 能力 flags + PlatformProvider)、`packages/api-client`(fetch 封装 + zod 响应校验 + ApiRequestError)、`packages/features`(设置域 hooks/屏幕/ThemeSync) | 类型编译贯通 + 三包单测 |
| M3-04 ✅ | `apps/web-next` Next.js 16.3 壳:App Router + React Compiler、自适应壳(md+ 侧栏/移动底部导航)、Tailwind `@source` 跨包扫描、localStorage 偏好 gateway、防闪主题脚本 | dev/build 通过 |
| M3-05 ✅ | `apps/desktop` 新渲染壳:electron-vite `shellV25` 入口消费 features;`musefold:invoke` 单通道 IPC 桥(每方法 zod 校验 + 结构化错误信封)+ v25 preload;`MUSEFOLD_V25_SHELL=1` 切换 | build 通过,Electron E2E 冒烟 |
| M3-06 ✅ | 「设置」域打样:features/settings 贯通双宿主;`tests/v25` Playwright(web-desktop/web-mobile/electron 三 project)+ 首批视觉快照基线 4 张 | 双端 E2E 10/10,复跑稳定 |

落地备注:web-mobile 项目用 iPhone 13 视口但统一 Chromium 内核;Next dev 需 `allowedDevOrigins` 放行 127.0.0.1;Biome 开 `css.parser.tailwindDirectives`;React 类型统一 @types/react@19。旧 `apps/web` 壳保活至 M4 各域迁完。

## M4 按域垂直切换

每域固定动作:features 重建 → 双宿主接入 → 该域旧实现与旧测试删除 → 新 E2E + 快照。

**界面基准**:各卡布局/状态/交互/组件复用一律以 [V25-UI-SPEC.md](./V25-UI-SPEC.md) 为准(承旧优先,差异须进其 §9 登记表);桌宠与 EmberMark 朱点冻结不迁(UI-SPEC §0.2)。

| 卡 | 域 | 特有事项 |
|---|---|---|
| M4-a ✅ | 提示词库 | CRUD、搜索、置顶、回收站、文件夹/标签;桌面本地事务 + 云同步语义 |
| M4-b ✅ | 工作台/生成 | 会话、草稿、提交/取消/重试、Provider 选择(桌面本地 Provider 能力 flag) |
| M4-c ✅ | 历史 | 列表、筛选、详情、重试、软删/恢复、来源标签 |
| M4-d ✅ | 账号/连接 | New API 余额/兑换面、本地 AI 连接管理;同步开关(登录 ≠ 同步)移交 M4-e(依赖桌面同步域收口) |
| M4-e ✅ | 桌面数据与 IPC 收口 | SQLite → Drizzle 受管迁移(备份 → 迁移 → 校验);主进程结构搬迁完成;旧渲染层入口删除 |

M4-e 落地备注:
- `packages/desktop-db` 新包:桌面 SQLite 的 Drizzle 受管层。0000 baseline 是 core legacy 链(0001→0020)终态的忠实 `sqlite_master` 导出(含 CHECK/partial/DESC 索引/FTS5,这些 drizzle-kit 表达不了,故 meta 快照有意不含);`schema.ts` 供后续 `drizzle-kit generate` 增量。接管流程 `takeoverDesktopDatabase`:legacy 链先跑到 user_version=20 → VACUUM INTO 备份 → baseline fake-apply → 增量迁移 → 22 表 + FTS 完整性校验;全新空库直接真跑 baseline(fresh),不再走 legacy 链。单测含「baseline 空库 ≡ legacy 链库」逐表列/索引一致性断言。
- 迁移打包:`scripts/bundle-migrations.ts` 把 journal+SQL 内联为 `migrations.generated.ts`(Electron 生产包无 fs 依赖);`drizzle-kit pull` 对多表 CHECK 约束有合并/截断 bug,不可用于生成 baseline(教训)。
- 0001 增量 `workbench_drafts`:Composer 草稿从 userData JSON 旁存并入受管表(`importLegacyDraftsFile` 一次性导入后删文件),重启持久化 E2E 覆盖。
- 云同步收口(M4d 移交的开关):契约增 `desktopSyncStatusSchema`(登录 ≠ 同步);`ipc-v25/sync-domain.ts` 用 core `DesktopSyncEngine/Repository` + 新 API `/api/v1/sync/*`(bearer)重建 transport,写路径 `scheduleV25CloudSync()` 防抖 2s + 60s 兜底轮 + 启动恢复;登录/登出/换账号自动关开关(须重新显式开启);旧 `CloudSyncService` 不再启动(绑旧登录体系与已下线 web-api,防止与新桥抢 `cloud_sync_accounts`)。设置页新增云同步卡(开关/状态/立即同步/冲突计数)。
- 旧渲染层入口删除:主窗口恒加载 `v25/shell.html` + v25 preload,`MUSEFOLD_V25_SHELL` 开关退役;旧 index 入口/旧 IPC handlers 保活到 M5c 物理删除(无 UI 触达)。
- 全局教训:turbo 根任务 `//#lint` 长期 cache hit 重放旧绿日志,存量 38 个 lint error 被掩盖到本卡才暴露(biome --write 收干净);`vi.fn(async (input) => …)` 会吞上下文参数推断,transport fake 需显式标参数类型。
- 遗留:同步冲突处理 UI(repository 已有 listConflicts/resolveConflict,UI 后续卡);时间线事件推送仍 1.5s 轮询(M5);`canRevealLocalFile` 等能力 flag 尚无消费界面。

M4-b 落地备注:
- 契约扩展:`providerId` 进 `cloudGenerationRequestSchema`(桌面选本地连接,云端忽略);资产 URL 允许 `media:`(桌面本地读盘协议)与 `data:`;`providerOptionSchema` + `GET /generations/providers`;actorType 增 `desktop_local`。
- 壳按 UI-SPEC §2 收口:会话列表住壳侧栏(`SessionListPanel`,zustand `useActiveSession` 跨壳/屏共享活动会话),「新设计」为侧栏首要动作;品牌行可收起,macOS 红绿灯 inset + 侧栏拖拽区。移动端会话选择器留工作台屏顶。
- Composer 按 §3.2:比例 Popover(预设 6 档,自定义暂缓 D7)+ 设置 Popover(质量/反向词)+ Provider select;数量锁 1(D3)。
- 桌面桥 `ipc-v25/workbench-domain.ts`:会话 CRUD 直写 workbench_sessions,草稿 userData JSON 旁存(M4e 并入 Drizzle schema);生成走 core `generate()` 同一编排,run 状态轮询翻译成契约 job;providers 目录读本地连接表。
- E2E 教训:`--update-snapshots` 默认 changed 模式可能静默保留脏基线,布局改版后用 `=all` 强制重收;桌面渲染层改动必须先 `pnpm run build` 再跑 Electron E2E(加载 out/ 产物);残留 `next dev`(3399)会被 Playwright reuse 造成卡死/旧 UI,跑前清端口。
- 遗留(登记 UI-SPEC §2.5/§3.3):会话行状态点/置顶、移动顶栏搜索与额度、时间线事件推送(现为 1.5s 轮询)→ M4d/M4e。

M4-d 落地备注:
- 登录形态定稿(UI-SPEC §7.1/D9):双端同一账密表单,凭据委托 New API;Web 同站 cookie,桌面 bearer token 经 safeStorage 落 userData。已用真实网关(zhaozhaoyue.top 测试账号)走通登录→积分显示→刷新保活→退出全链路。
- Web↔API 同源部署定稿(D12):Next rewrites `/api/* → API`(dev),生产由部署层同域路由;`ApiHttp` 支持空 baseUrl 相对路径;API 刻意不开 CORS。`ApiHttp` 错误解析兼容 Better Auth 顶层 `{code,message}` 形状。
- 契约:`connections.ts` 增 aiProvider 三式(密钥 write-only,读侧只有 hasKey/keySuffix);`AccountGateway` 增 login/register/logout;capabilities 增 `hasLocalAiProviders`。
- 桌面桥:`account-domain`(token 安全存储 + 云端代调)与 `providers-domain`(SQLite providers 表 + keychain,设默认单选、删默认自动接管)。
- features/account:`AccountPanel`(表单/身份/兑换/退出)+ `AiConnectionsPanel`(CRUD/设默认/删除确认)+ `AccountFooter`(壳侧栏底部);登录后全量 invalidate、退出全量 reset(修复登录前失败查询不刷新)。
- E2E:web 登录/失败/兑换/退出(mock 网关)+ electron AI 连接全链路(SQLite+keychain 落库断言);已登录设置页视觉基线。
- 遗留(登记 §7):MCP 已连接应用列表(等云端端点)、连接「测试连接」钮、New API 兑换码真流水验证(测试账号无兑换码,mock 与集成测试覆盖协议层)。

M4-c 落地备注:
- 契约:`generationHistoryQuerySchema` 增 `deletedOnly`(回收站视图,分页不再靠客户端过滤);云端 service 与桌面桥同步实现,API 集成测试补软删→回收站→恢复闭环。
- features/history:筛选栏(搜索 300ms 防抖/状态/模型聚合/时间预设,默认近 30 天)+ 线程缩进列表(同页 parentRunId 归组,跨页不装配)+ 详情 Inspector(lg+ 内嵌右栏,窄屏 Sheet;含参数表/复制/错误卡)+ 回收站 tab;`queryKeys.generation.history` 独立于时间线 list key。
- 「查看会话」经 `onOpenSession` 宿主回调接通工作台(共享 `useActiveSession` store)。
- 视觉基线教训:行时间戳随运行时刻变化,截图一律 `mask` 时间元素。
- 遗留(登记 UI-SPEC §4.5/§5.4):历史/提示词回收站的永久删除(契约 purge)、发起微调入口 → 后续卡。

M4-a 落地备注:
- features/prompts:行式列表(信息架构承自 v2.0 PromptListRow:缩略图/摘要/元信息/常驻操作组,操作不藏浮层)、「置顶/全部」分节、回收站 tab、文件夹与标签管理 Popover、编辑器对话框;全部走语义 token,零硬编码色。
- 双宿主:Web 走 api-client(M2 路由已就绪);桌面主进程 `ipc-v25/prompts-domain.ts` 挂 15 个 `prompts.*` 方法(contracts↔core 映射内嵌,folders/tags 目录直写 SQL,写路径保留 `scheduleCloudSync()`);共享壳 `features/shell/AppShell` 双宿主统一(Web 接 Next 路由、桌面本地视图切换)。
- E2E 教训:Electron 不能 `firstWindow()`(prefs 迁移窗口先开即关,须按 URL 等 v25 壳窗口);Playwright `workers:1` 串行(headed Electron 并行互抢 macOS 焦点,Radix 浮层失焦即关);行内常驻操作钮让用例免于浮层时序,32 用例三轮连跑全绿。
- 旧实现/旧测试物理删除集中到 M5-c(旧 CI 已不跑 Python E2E,旧壳保活到 M4-e 整体切换,安全网已转移到 tests/v25)。

## M5 收尾

| 卡 | 内容 | 验收 |
|---|---|---|
| M5-a1 ✅ | Playwright Electron E2E 全量;Python 测试栈删除(打包产物冒烟移交 M5-b1 发布矩阵) | CI 桌面 lane 全绿 |
| M5-a2 ✅ | 视觉快照全量基线(三平台 + 明暗);depcruise 新规则 8 条;单文件 ≤3000 行门禁扫描面补全 | 门禁在 PR workflow 生效 |
| M5-b1 ✅* | Changesets 接管版本;release.yml:tag → macOS(签名/公证)+ Windows 矩阵 → updater feed + GitHub Release;打包产物冒烟(接替已删 tests/package Python 冒烟) | 一次端到端发布演练 |
| M5-b2 ✅* | 热更 feed 验证(update-protocol 通道) | 安装包可收到内容热更 |
| M5-c1 ✅ | 删除全部 legacy:旧 apps(web/web-api/generation-worker)、旧渲染层(apps/desktop/src 旧壳)、旧多域 IPC/账号服务/云同步/origin 迁移、旧包(product-ui/legacy-ui/cloud-client)、旧脚本与旧门禁 | depcruise 0 违例 |
| M5-c2 ✅ | 重写 `AGENTS.md` / `CLAUDE.md` / 各目录 AGENTS.md / `docs/README.md` 权威顺序 / `CONTRIBUTING.md` | 新约束与实现一致 |

M5-a 落地备注:
- Python 栈删除:`tests/e2e`(pytest 桌面 E2E 34 个文件)、`tests/package`(打包冒烟)、`requirements-test.txt` 全删;根脚本 `test:e2e` 改指 Playwright 三平台全量(`test:e2e:v25` 保留为别名)。打包产物冒烟职责移交 M5-b1(在发布矩阵产物上跑,Playwright `_electron` 可直接加载打包 app)。
- CI E2E lane:pr.yml 与 main.yml 各增 `e2e` job,跑 **macos runner**——视觉基线在 darwin 生成可直接复用(不维护第二套 linux 基线),Electron 真窗口无需 xvfb;失败上传 `.results` + 基线 artifact。CI `retries: 2` 过滤高负载偶发渲染帧抖动(本机 0 重试暴露问题)。
- 视觉基线:三平台 22 张(electron 6:四屏浅色 + settings/prompts 深色;web-desktop/web-mobile 各 8)。深色用例走真实主题切换路径(设置屏切换,不直接改 `documentElement.class`,避免与 ThemeProvider 打架),且自含导航(不依赖前序用例停留屏,允许 `-g` 过滤单跑)。
- depcruise v2.5 规则 8 条(超计划 5 条):features 平台无关(禁 electron/next/宿主实现/legacy 包)+ 禁 Node 内置、platform 接口叶子、db 只进 api/worker、v25 preload 纯转发(仅 electron)、ui 原语叶子、api-client 只依 contracts+platform、desktop-db 生产代码独立。规则用违规探针验证过真实生效;旧规则随 M5-c 删包一并退役。
- 3000 行门禁扫描面补 `apps/web-next/src`、`apps/api/src`、`apps/worker/src`(M1 建门禁时尚无这三个目录)。
- 教训:`electron.vite.config.ts` 的 workspace 打包守卫测试用严格顺序正则断言列表,M4e 加 `desktop-db` 后未同步更新,全量 check 才暴露——列表型守卫测试改动配置时须同卡更新。

M5-b 落地备注(✅* = 代码/脚本/工作流就绪并本机演练通过;标 * 的人工残项见文末):
- App semver 定 **2.5.0**(`apps/desktop/package.json`,自 0.5.0-dev.75;版本冻结红线随 v2.5 废除)。Changesets 接管版本记录:`.changeset/config.json`(全 private 包,`privatePackages.version: true`,发布 tag 仍手动打)。
- release.yml 全量重写:tag(v*)→ verify(全量 turbo check)→ mac-package(hosted runner 无证书走 `package:mac:adhoc`,配好 CSC_LINK/APPLE_ID 等 secrets 自动切正式签名+公证)+ win-package(nsis x64)→ 双平台 Playwright 打包产物冒烟 → publish-site(self-hosted `musefold-prod`,沿用 `scripts/deploy/publish-desktop.mjs`:downloads + `updates/<channel>/` feed)+ github-release(产物挂 GH Release)。
- 打包产物冒烟 `tests/v25/package.smoke.spec.ts`(新 `package-smoke` project):启动 electron-builder 产物验证 app:// 协议 + asar 下壳加载、desktop-db 接管、真实 IPC;产物缺失自动 skip,发布矩阵必跑。本机 mac-arm64 演练通过。
- **打包冒烟当场抓到发版级 bug**:electron-builder 26 的 pnpm 收集器剥掉嵌套传递依赖(`lazystream → readable-stream@2`),打包 App 主进程启动即崩(M1 切 pnpm 后从未打过包)。修法:纯 JS 运行时依赖(archiver/archiver-utils/yauzl)进 main bundle(externalizeDeps.exclude),asar 不再依赖其 node_modules 树。教训:**打包链路必须随工具链迁移立即演练,不能等发布卡**。
- 热更生产端演练(update-protocol CLI,`pnpm run bundle:manifest`):keygen → pack(真 out/renderer,2.5MB)→ sign(私钥经 env)→ verify=valid 全链通过;客户端链(check→verify→install→runtime swap→回滚)单测已全量覆盖。
- **人工残项(发布前必做,代码无法代劳)**:① 密钥仪式——`bundle:manifest keygen` 产出的公钥填入 `electron/update/bundle-trust.ts` 常量槽、私钥进 GH secret `MUSEFOLD_BUNDLE_SIGNING_KEY`(当前槽空 = 内容热更 fail-closed,安全);② 推首个 `v2.5.0` tag 走通矩阵(需 self-hosted `musefold-prod` runner 在线);③ macOS Developer ID 证书 secrets(可选,无证书产物走 ad-hoc + dev 通道)。

M5-c 落地备注:
- 删除面(全部 `pnpm run check` 全绿分批提交):批1 旧三 apps + 旧 infra;批2 旧渲染层(`apps/desktop/src` 只留 `v25/`、`pet/`、pet.html、storage-export.html 与两个薄桥文件);批3 主进程收口(旧多域 IPC 14 文件、`electron/account`、`electron/cloud-sync`、prefs-origin 迁移、preload/api 目录);批4 三旧包(product-ui/legacy-ui/cloud-client)+ v1.1 脚本/fixtures + depcruise 旧规则大扫除。
- 保留决策:`ipc/skill-runtime.ts` 与 `main/design-scheme/` 服务函数被 automation(CLI/MCP)直连,摘 IPC 注册后整体保留;生图门面(桌宠追踪)提为 `main/generation-facade.ts`;豆包登录态→providers 表同步独立为 `main/doubao-login-sync.ts`(渲染层暂缓域的主进程语义保留);`ipc/updater.ts` 保留(pet content-ready 信标 + 未来设置「关于」卡);automation-setup 的账号快照改读 v25 account-domain(异步窄接口,不再依赖旧 AccountService)。
- 桌宠窗口 preload 收为专用薄桥(`preload/index.ts`:pet.* + updater.notifyContentReady),`window.api` 多域面随旧渲染层退役。
- 文档:根/desktop/packages 三份 AGENTS.md 与 docs/README 权威顺序、CONTRIBUTING 全部按 v2.5 现状重写;`dev-guide-freshness` 守卫随旧规范退役。

## 风险与回退

| 风险 | 缓解 | 回退 |
|---|---|---|
| pnpm 切换暴露幽灵依赖 | M1 集中补依赖声明 | 基线 tag 可整体回退 |
| Better Auth × New API 集成面 | M2-03 先 spike 三链路 | 保留旧 session-store 语义重写为备选 |
| doubao-web/生图编排搬迁 | 只搬不改算法,每步跟 E2E | 按域回退到基线实现 |
| 视觉全变 | M3-06 打样域先建基线再铺开 | 快照基线按域重置 |
