# Musefold v1.2.1 CI/CD 交付计划

> **状态**：任务分解，尚未开工
>
> **日期**：2026-08-20
>
> **范围**：生产环境收敛、流水线提速、Web/服务层自动部署、通道化、内容层热更新、外壳发布自动化
>
> **当前实现状态（2026-08-20）**：全部里程碑均未开始。`.github/workflows/ci.yml` 只做验证，无任何部署步骤。生产环境已完成实地盘点，结果记录在 `V121-CICD-ARCHITECTURE.md` 第 1 节；盘点中发现三个需要在自动化之前修复的线上缺陷。

## 0. 交付原则

1. **先收敛现状，再建自动化**。生产环境跑的是 PromptForge 谱系的源码，事实源不唯一。更新源 404 已于 2026-08-20 止血；其余收敛未完成前建流水线，仍会把错误状态固化成不可逆的自动化。
2. 先缩短反馈循环，再扩大自动化范围。没有快速反馈时，自动发布只会更快地把问题推到线上。
3. 每个里程碑交付一条可用且可回滚的完整链路，不保留「能构建但不能回滚」的中间态。
4. 安全能力先于便利能力。签名、版本下限校验和自动回滚必须先于热更新开关落地。
5. 不改变外壳层既有的签名、公证与 evidence 门禁语义，只改变它们的触发时机。
6. 每一步都要能在不影响正式用户的前提下自测，因此通道化排在热更新之前。
7. **CI/CD 先于架构重构**。[v1.2.2 系统架构重构](../v1.2.2/README.md)会移动仓库目录并重排共享层，它依赖本版本交付的 affected 流水线、自动部署与回滚作为回归安全网。因此 v1.2.2 的目录迁移（Phase 1 起）必须等本版本发布门禁全部通过后开工；v1.2.2 Phase 0（纯仓库侧工程化，不动目录）可与 M4–M7 并行。所有会被目录迁移影响的配置（层级路径映射、Dockerfile 构建上下文、`out/renderer` 引用）在本版本内都要做到单点定义。

## 1. 里程碑总览

| 里程碑 | 交付结果 | 依赖 |
|---|---|---|
| M0 生产环境收敛 | 事实源统一、线上缺陷修复、部署身份与基础设施入仓 | 无 |
| M1 流水线基线 | 路径过滤、并发取消、Turborepo 缓存、affected-only | 无 |
| M2 Web 自动部署 | 自托管 runner、相对 symlink 原子切换、静态回滚 | M0、M1 |
| M3 服务层自动部署 | 镜像按 sha 打标、迁移闸门、健康门控滚动、镜像回滚 | M2 |
| M4 通道化与签名基座 | 三通道、Ed25519 签名与验签、manifest 发布 | M1 |
| M5 内容层热更新 | bundle 解析器、自定义协议、灰度、自动回滚 | M4 |
| M6 外壳发布流水线 | tag 触发、签名公证、CDN 上传、evidence 门禁 | M4 |
| M7 iOS 接入预留 | 协议侧 `capacitor-web` surface 与 bearer 认证准备 | M5 |

M0 与 M1 可并行：M0 是服务器侧操作，M1 是仓库侧改动。M2 必须等两者都完成。M4 只依赖 M1。M5 是本版本风险最高的一项，必须等 M4 的签名能力全部通过后才开工。M7 只交付预留，实际接入属于 v3.0。

## 2. M0：生产环境收敛

实地盘点发现的问题必须先处理掉，否则自动化会建立在错误的基线上。本里程碑全部是一次性操作，不产生长期维护负担。

### 2.1 事实源统一

- `V121-ENV-01`：确认 Musefold 为唯一事实源。`/opt/musefold-v11-src/` 当前是从 PromptForge rsync 上去的（`package.json` 与 `README.md` 的 MD5 与 PromptForge 完全一致）。需从 Musefold 重新部署一次并验证服务行为不变。
- `V121-ENV-02`：收敛桌面 SQLite 迁移谱系。Musefold 插入 `0016_cost_points.ts` 后，`cloud_prompt_sync`、`cloud_sync_snapshot`、`cloud_sync_usage_events` 从 `0016/0017/0018` 顺延为 `0017/0018/0019`，与 PromptForge 谱系冲突。需确认已发布的 `0.5.0-dev` 属于哪条谱系，并为已按旧谱系建库的安装设计升级路径。
- `V121-ENV-03`：归档或删除 `/Users/wangwei/Project/PromptForge`，避免继续产生歧义。两个仓库的 git 历史没有共同祖先，无法 merge，只能以 Musefold 为准。

`V121-ENV-01` 的风险低于表面：`apps/` 以及 `contracts`、`domain`、`server-crypto`、`new-api-client`、`cloud-client`、`ui` 六个服务端共享包在两棵树之间完全相同，线上 API 与 Worker 的行为等价于 Musefold HEAD。分叉集中在桌面侧的 `core`、`cli`、`client`、`automation-server`、`product-ui`，不影响当前线上服务。真正需要谨慎处理的是 `V121-ENV-02`。

### 2.2 修复线上缺陷

- `V121-ENV-04`：~~创建 `/opt/musefold/site/Musefold/updates/stable/` 并放入正确的 `latest.yml` 与 `latest-mac.yml`。~~ **已完成（2026-08-20）**。清单指向完整的 `0.3.2`（Windows exe + macOS zip），绝对 URL 指向 `downloads/0.3.2/`，不复制安装包。`0.5.0-dev` 因缺 zip 且为 prerelease 未写入通道。
- `V121-ENV-05`：补齐 `downloads/0.5.0-dev/` 的产物。缺 `.zip`（macOS 静默更新依赖）、缺 `dmg.blockmap`、缺 `SHA256SUMS.txt`；同时存在 `Musefold Setup 0.5.0-dev.exe` 与 `Musefold-Setup-0.5.0-dev.exe` 两个不同命名、不同大小的安装包，需确定唯一命名并删除多余项。
- `V121-ENV-06`：清除站点目录下的 macOS 资源派生文件（`._Musefold`、`._index.html`、`._styles.css` 等 163 字节 `._*` 文件），并在后续传输环节显式排除。

### 2.3 权限与基础设施

- `V121-ENV-07`：创建专用部署用户，授予部署所需的受限 `sudo` 条目，停止以 `root` 执行部署。
- `V121-ENV-08`：把 `Caddyfile` 与 `remote-compose.yaml` 的事实源固定在仓库，建立部署前的一致性校验。当前两者与仓库逐字节一致，但一致性靠人工维持——服务器上留有 5 份 `Caddyfile.bak-*` 与 3 份 `docker-compose.yml.bak-*`。
- `V121-ENV-09`：把镜像标签从 `musefold-v11:latest` 改为按 `gitSha` 打标，`latest` 仅作为别名。

### 2.4 清理

- `V121-ENV-10`：~~删除 `site-backup-v11-20260819-224253.tar.gz`（1.05 GiB）~~ **已完成（2026-08-20）**。有保留策略的备份方案仍待建立。
- `V121-ENV-11`：~~回收 Docker 构建缓存与未使用镜像层（合计约 5.1 GiB 可回收）~~ **一次性回收已完成（2026-08-20）**：`docker builder prune -af` 收回 3.53 GiB，删除无引用的 `node:24` 收回 1.64 GiB。定期回收仍待建立。
- `V121-ENV-12`：清除 `musefold-e2e.service` 与 `musefold-edits.service` 两个 failed 状态的遗留 systemd 单元，以及 `/opt/musefold/` 下的一次性调试脚本。

### 完成条件

- 线上运行的镜像可追溯到 Musefold 的某个具体提交。
- `https://zhaozhaoyue.top/Musefold/updates/stable/latest-mac.yml` 与 `latest.yml` 返回 200。已安装的 `0.3.2` 检查更新应得到「已是最新」；`0.5.0-dev` 因客户端 `allowPrerelease = false` 同样不会被提供更新。端到端「下载 → 重启」仍受 `V121-ENV-05` 产物不完整阻塞。
- 站点目录下不再有 `._*` 文件对外可见。
- 部署不再需要 `root` 登录。
- 磁盘可用空间回升到 38 GiB 以上（2026-08-20 已达到 39 GiB；定期回收与有保留策略的备份仍待建立）。

## 3. M1：流水线基线

本里程碑不改变任何发布行为，只压缩反馈循环。

### 任务

- `V121-CI-01`：~~为 `.github/workflows/ci.yml` 增加 `concurrency` 组~~ **已完成（2026-08-20）**。同分支新推送取消进行中的旧运行，tag 触发不取消。
- `V121-CI-02`：~~引入 Turborepo~~ **已完成（2026-08-20）**。任务图含 workspace 任务与 root 任务（`//#typecheck`、`//#test`、`//#build`、`//#lint`、`//#check:boundaries`）；root 任务 inputs 为显式清单（不含 docs/website），Electron 打包不纳入 turbo。
- `V121-CI-03`：~~接入 Turborepo 远程缓存~~ **仓库侧已完成（2026-08-20）**。缓存键含 `NODE_VERSION` 与锁文件；CI 用 `actions/cache` 缓存 `.turbo`；远程缓存经 `TURBO_TOKEN`/`TURBO_TEAM` 启用，**secrets 配置待运维执行**。
- `V121-CI-04`：~~实现路径过滤~~ **已完成（2026-08-20）**。映射集中在 `.github/layer-paths.yml`（发布三层 + `infra` + `desktop` E2E 门控组），判定脚本 `.github/scripts/detect-layers.mjs` 自带 self-test，未映射路径 fail-open。
- `V121-CI-05`：~~包冒烟改为 tag 触发~~ **已完成（2026-08-20）**。迁至 `.github/workflows/package-smoke.yml`，`push: tags: v*` + `workflow_dispatch`。
- `V121-CI-06`：~~修复硬编码 DMG 文件名~~ **已完成（2026-08-20）**。版本从根 `package.json` 派生；`scripts/release-windows-target-checklist.mjs` 的同类硬编码一并修复。
- `V121-CI-07`：~~统一版本号口径~~ **已完成（2026-08-20）**。决议：应用 semver 的单一事实源是根 `package.json` 的 `version`，CI 与脚本一律从此派生；文档基线号（v1.2.1/v1.2.2）是交付里程碑编号，与应用 semver 无关。

  **开发期递进口径（2026-08-20 追加）**：每完成一项内容推进一个预发布号 `0.5.0-dev.N`（`0.5.0-dev` → `0.5.0-dev.1` → …）。选预发布标识而非 patch 位，是因为 `0.5.0-dev.N` 在 semver 下严格大于 `0.5.0-dev` 且仍小于 `0.5.0`，既不占用发布号、也不与站点上已发布的 `downloads/0.5.0-dev/` 产物命名冲突；客户端 `stable` 通道 `allowPrerelease = false`，这些开发号不会被推给用户。配套放宽了 `shared/__tests__/brand-migration.test.ts` 的版本守卫正则（允许 `-dev.N`，仍拦旧品牌形态的版本串）。

  同时修复了 Skill 影响审查守卫的误报：`scripts/check-skill-update.mjs` 原先只要 `shared/constants.ts` 出现在变更清单里就禁止声明 `Skill-Impact: none`，而该文件是全仓通用常量文件，仅三个 `MUSEFOLD_SKILL_*` 常量与 Skill 有关。频繁误报的唯一现实出路是 `--no-verify` 或假装提升 Skill 版本，两者都会废掉这道审查，因此判定粒度从文件级收紧为符号级：比较两个版本中提取出的 `MUSEFOLD_SKILL_*` 声明映射，相等即放行。解析失败、缺失版本、以及内置 Skill 目录下的任何变更仍保守判定为已变更；新增 `--self-test` 用内联夹具覆盖六种判定分支。
- `V121-CI-08`：~~引入 ESLint + Prettier 基线~~ **已完成（2026-08-20）**。ESLint 10 flat config（实体在 `tooling/eslint.config.base.mjs`），存量违规按规则冻结并注明棘轮计数（见配置内注释，合计 214 处 17 条规则；`react-hooks/rules-of-hooks` 保持 error，唯一误报行内豁免）；Prettier 配置就位但**未做全仓 format**（推迟到 v1.2.2 目录迁移后，保护 `git mv` 历史），`format:check` 未接入 CI。

  **第一批棘轮已于 2026-08-20 收紧**：违规数最少的 8 条规则清零并启用（`no-useless-escape` 8、`no-useless-assignment` 8、`no-empty` 5、`preserve-caught-error` 2、`no-control-regex` 1、`@typescript-eslint/no-empty-object-type` 1、`@typescript-eslint/no-unused-expressions` 1，以及 `no-undef`）。修法要点：空块补中文原因注释（该规则不报含注释的块，注释同时说明了为何可以吞掉错误），重抛错误补 `cause`，死赋值删除，唯一故意匹配控制字符处用单行豁免并注明理由。

  `no-undef` 单独处理：它报的几乎全是 `NodeJS.Timeout`、`RequestInit` 这类 TS ambient 类型，属 typescript-eslint 官方说明的已知误报（TS 编译器本就负责未定义标识符），因此在 TS 家族**永久关闭**并注明这不是棘轮欠账，在 JS 家族保持 `error`。开启后它在 JS 侧立即报出真缺陷：`preview/bridge-plugin.mjs` 的 `provider:validate` 分支引用了该作用域不存在的 `res` / `providerId` / `costPoints`，成功路径必抛 `ReferenceError` 并被 catch 成失败——那行本属 `image:generate`，已归位。

  同批 `no-useless-escape` 还翻出一处潜在缺陷：`electron/doubao-web/browser-service.ts` 注入脚本的模板字符串里写了单反斜杠 `\s`，注入到页面后是字母 `s`，导致完成探测只能匹配「生成了1张」而漏掉「生成了 4 张」及其门控的 canvas 结果。已改为 `\\s`（注入后为 `\s`），与同函数其余正则一致；该改动严格更宽松，不会破坏已有匹配。

### 完成条件

- 纯文档改动不触发任何构建任务。✅（CI 层 `docs_only` 跳过 + turbo 缓存键不含 docs，实测 docs 探针 FULL TURBO）
- 仅改 `apps/web` 的提交不触发 Electron 打包与桌面 E2E。✅（打包已移出 ci.yml；E2E 按 `desktop` 组门控，self-test 锁定该语义）
- 二次运行同一提交时 Turborepo 缓存命中，`check` 耗时显著下降。✅（本地实测 28/28 FULL TURBO，约 40ms；CI 侧待推送后验证）
- `npm run check` 与 `npm run check:v1.1` 的既有语义不变。✅（入口保留，typecheck 实现随 v1.2.2 Phase 0 收敛为 `tsc -b`，覆盖不减）

M1 仓库侧于 2026-08-20 完成；GitHub 侧的实际运行验证（required checks、远程缓存 secrets）待首次推送后确认。

## 4. M2：Web 自动部署

### 任务

- `V121-WEB-01`：在生产主机部署自托管 runner，标签 `musefold-prod`，以 `V121-ENV-07` 创建的部署用户运行。
- `V121-WEB-02`：为 runner 配置 CPU 与内存上限（参考基线 4 vCPU / 3 GiB），禁止 fork PR 触发，限定仅本仓库 workflow 可用。
- `V121-WEB-03`：实现发布目录结构 `/opt/musefold/site/Musefold/releases/<gitSha>/`，以及 `app -> releases/<gitSha>` 的**相对**符号链接。
- `V121-WEB-04`：实现部署 job：构建 `apps/web`、落盘到新 release 目录、原子切换 symlink；传输时排除 macOS 资源派生文件。
- `V121-WEB-05`：部署后可达性验证，失败自动切回上一个 release。
- `V121-WEB-06`：保留最近 5 个 release 目录，实现一条命令手动回滚。

### 完成条件

- 合并到 `main` 后无需人工介入，`https://zhaozhaoyue.top/Musefold/app/` 在数分钟内呈现新版本。
- 符号链接为相对路径，能在 Caddy 容器内正确解析。容器内不存在 `/opt/musefold` 这个路径，指向宿主机绝对路径的软链会直接 404。
- 切换过程中不存在半更新状态，任意时刻访问都能拿到完整可用的一份产物。
- 回滚在一次命令内完成，不需要重新构建。
- 构建期间生产 API 的响应延迟无可观测劣化。

## 5. M3：服务层自动部署

### 任务

- `V121-SVC-01`：在自托管 runner 上实现容器内镜像构建，复用 `infra/v1.1/Dockerfile`；宿主机没有 Node 与 npm，构建不得依赖宿主机工具链。
- `V121-SVC-02`：把数据库迁移拆为独立前置步骤，使用 `musefold_migration` 角色执行，失败即中止部署。
- `V121-SVC-03`：在 CI 增加 expand/contract 静态检查，拒绝在同一次变更中同时移除写入与删除列。
- `V121-SVC-04`：把流量切换条件从 `/health/live` 改为 `/health/ready`，确认迁移版本匹配与依赖可用后才切。
- `V121-SVC-05`：为 Caddy 上游配置重试，隐藏容器重启期间的抖动。
- `V121-SVC-06`：实现镜像回滚，回退到上一个 `gitSha` 标签。
- `V121-SVC-07`：实现契约后向兼容门禁，用最近 3 个已发布客户端版本的 `@musefold/contracts` schema 校验新 API 响应。
- `V121-SVC-08`：`generation-worker` 同步纳入部署流程，确认在途任务不因重启丢失。
- `V121-SVC-09`：部署前校验线上 `Caddyfile` 与 `remote-compose.yaml` 与仓库版本一致，不一致即中止并告警。

### 完成条件

- 迁移失败时旧容器完全不受影响，线上无感知。
- 新容器未通过 `/health/ready` 时不接管流量。
- 部署期间的请求失败率在可接受范围内，且失败可由 Caddy 重试吸收。
- 契约门禁能拦截一个人为构造的破坏性 API 变更。
- 任意时刻可从镜像标签反查出线上运行的具体提交。

## 6. M4：通道化与签名基座

本里程碑不启用热更新，只建立其前置能力。

### 任务

- `V121-CHAN-01`：~~更新源按通道拼接~~ **已完成（2026-08-20）**。解析优先级 `MUSEFOLD_UPDATE_CHANNEL` > electron-store `update.channel` > 默认 `stable`；非法值回落 `stable` 且不抛异常。`resolveUpdateFeedUrl('stable')` 与旧常量逐字符相同。另定：`allowPrerelease` 随通道联动（`stable` 为 `false`，`dev`/`beta` 为 `true`）——否则 dev/beta 发布的 prerelease 版本永远不会被提供，通道功能形同虚设。
- `V121-CHAN-02`：~~调整 `electron-builder.yml` 的 `publish.url`~~ **已完成（2026-08-20）**。指向 `updates/stable/`，并注明运行时会按设置项覆盖。
- `V121-CHAN-03`：~~设置页通道选择~~ **已完成（2026-08-20）**。「应用更新」分区内新增通道行，默认 `stable`，切换走既有 `Dialog` 二次确认；环境变量锁定时只读。IPC 新增 `updater:getChannel` / `updater:setChannel`，只传通道标识、是否被环境变量锁定与脱敏文本；主进程对入参重新校验，不信任渲染层。
- `V121-CHAN-04`：~~manifest schema 与规范化序列化~~ **已完成（2026-08-20）**。落在新建的纯协议包 `@musefold/update-protocol`（零 workspace 依赖，仅 zod + semver）。见下方「M4 的三项协议加固」。
- `V121-CHAN-05`：~~Ed25519 签名工具~~ **工具已完成（2026-08-20）**，CI 真实签名 job 顺延至 `V121-HOT-10`（需要 bundle 产物与 CDN，均由 `V121-CHAN-07` 解锁）。私钥只从 `MUSEFOLD_BUNDLE_SIGNING_KEY` 环境变量读取，不支持命令行或文件传入，错误路径不打印任何密钥内容；CLI 提供 `keygen` / `sign` / `verify` / `--self-test`。
- `V121-CHAN-06`：~~主进程验签~~ **已完成（2026-08-20）**。`electron/update/bundle-trust.ts` 内置一主一备两个公钥槽位，**默认为空且 fail-closed**——不写占位公钥，因为占位值等于制造虚假信任锚。密钥仪式与轮换流程写在该文件头部注释。
- `V121-CHAN-07`：建立对象存储与 CDN，迁移 `downloads/` 并新增 `bundles/`；更新 `services/musefold-downloads/catalog.json` 的重定向目标。**外部门禁（采购），阻塞 `V121-HOT-10` 与本里程碑的收尾。**
- `V121-CHAN-08`：~~签名、验签、规范化序列化与 schema 版本拒绝的单元测试~~ **已完成（2026-08-20）**。

### M4 的三项协议加固（实现期新增的决策）

1. **通道绑定校验**。三个通道共用同一把签名私钥，因此 `dev` 通道的 manifest 是合法签名的。若客户端不校验 `channel` 字段，攻击者控制分发服务器（或运维配错）把 dev manifest 放到 `stable/manifest.json`，即可让稳定版用户拿到 dev bundle，而验签、`schemaVersion`、外壳版本全部通过。故 `verifyContentManifest` 的 `expectedChannel` 为**必填**参数，校验位置在验签与 `schemaVersion` 之后、外壳兼容性之前，失败原因 `channel_mismatch`。**通道绑定是防跨通道投递的唯一防线。**
2. **顶层字段前向兼容**。manifest 顶层、`rollout` 与 surface artifact 均不使用严格模式，未知键剥离而非报错。规范化签名字节取自原始 JSON 对象，未知字段已被签名覆盖，攻击者无法增删任何字段而不破坏验签，因此容忍未知键不损失安全性。演进规则：**新增可选字段保持 `schemaVersion` 1；任何老客户端必须理解才能安全应用的字段，必须 bump `schemaVersion`**。否则加一个可选字段就会让老外壳整份拒绝，内容层对老外壳直接断供。
3. **hex 大小写归一**。`sha256` 与 `gitSha` 接受大写输入，但 zod 解析输出统一为小写，避免与本地计算出的小写摘要比较时踩坑。归一只作用于解析输出，不影响签名字节。

### 完成条件

- 三个通道的 manifest 可独立发布与提升，提升操作不重新构建产物。⏳ 协议与工具就绪，实际发布待 `V121-CHAN-07`
- 篡改 manifest 任意字节后验签失败。✅ 单测覆盖改字段值、改键序、增删字段三类
- 未知 `schemaVersion` 被拒绝。✅ 且断言了「在验签之后才判定」的顺序
- 通道切换不影响现有安装的默认行为。✅ 默认 feed URL 与旧常量逐字符相同
- 安装包已从生产主机磁盘迁出，主机可用空间不再随发版线性下降。⏳ 阻塞于 `V121-CHAN-07`

## 7. M5：内容层热更新

依赖 M4 全部完成。这是本版本风险最高的里程碑。

### 任务

- `V121-HOT-01`：~~注册固定特权自定义协议~~ **已完成（2026-08-20）**。scheme `app`、host 固定 `musefold`，origin 恒为 `app://musefold`。实现约束：`registerSchemesAsPrivileged` 在 Electron 中只能调用一次，故 `media://` 与 `app://` 必须在同一次声明里（收敛到 `electron/main/privileged-schemes.ts`）。不做 SPA history fallback（未命中 404，避免缺失的 JS chunk 拿到 HTML 响应变成难定位的 MIME 报错）；`Cache-Control: no-store`（bundle 切换时任何缓存残留都可能让新旧资产混用，本地读盘成本可忽略）；除词法路径包含校验外，另用 realpath 独立防一层符号链接逃逸。
- `V121-HOT-02`：~~活跃 bundle 解析器~~ **已完成（2026-08-20）**。候选必须同时包含 `index.html` 与 `pet.html`，缺一即跳过。**解析结果在进程启动时冻结整个生命周期**——协议第 1 节要求两个入口原子共用同一份 bundle，运行中重解析会让主窗口与宠物窗口落到不同 bundle；协议第 6 节也规定桌面端生效时机是「下次启动」。回滚状态机留给 `V121-HOT-08`，解析器只消费一个可注入的候选读取器，默认实现返回空列表。
- `V121-HOT-03`：~~两个窗口切换到固定 origin~~ **已完成（2026-08-20）**。URL 由单一工具函数产出，禁止两处各写字面量。`ELECTRON_RENDERER_URL` 开发分支逐字符不变。完整 Electron E2E 通过（219 passed / 17 skipped，跳过项均为缺真实凭证的 live 用例）。
- `V121-HOT-04`：~~CSP 放行新 origin~~ **已完成（2026-08-20，零改动）**。实测 `app://musefold` 页面上 `'self'` 已覆盖同源资产，未出现任何 CSP 拦截报错，因此按最小放行原则**不追加**任何指令；生产 `connect-src` 仍为 `'self'`，新增断言禁止其出现 `http:`/`https:`/通配。electron-vite 在生产把 renderer `base` 强制为 `./`，相对资产路径在固定 host 下自然成立。
- `V121-HOT-13`：~~`file://` → `app://musefold` 的一次性偏好迁移~~ **已完成（2026-08-20）**。实现期新开的任务卡，见下方「origin 变更的偏好迁移」。
- `V121-HOT-05`：实现 bundle 下载、SHA-256 校验、安全解压（拒绝绝对路径、`..` 与符号链接，限制大小与文件数）和原子改名。
- `V121-HOT-06`：实现 `minShellVersion` / `maxShellVersion` 校验，并在 CI 中根据实际引用的 IPC 通道自动推导 `minShellVersion`。
- `V121-HOT-07`：实现灰度分桶，哈希输入为 `installId + bundleVersion`，保证同一安装判定稳定。
- `V121-HOT-08`：实现启动信标与自动回滚：连续两次未达「已知可用」即回退并记入拒绝列表。
- `V121-HOT-09`：扩展 updater IPC 与设置页，显示内容层版本与状态，保持窄接口与脱敏约定。
- `V121-HOT-10`：在 CI 增加 renderer bundle 构建、签名与发布到 `dev` 通道。
- `V121-HOT-11`：E2E 覆盖三条失败路径：验签失败、`minShellVersion` 不满足、连续两次启动失败自动回退。
- `V121-HOT-12`：打包冒烟新增一项，确认全新安装在无网络时可从内置 bundle 正常启动。

### origin 变更的偏好迁移（`V121-HOT-13`）

协议第 7.2 节只论证了「bundle 之间」的存储连续性，遗漏了从 `file://` 迁到 `app://musefold` 这一次性 origin 变更：渲染层的偏好全部存在 `localStorage`（主题、密度、减少动效、默认 Provider、账号图源、已读通知、工作台偏好等），origin 一换即全部失效，其中 `musefold:onboarded` 哨兵丢失会让**每一个老用户重新走一遍新手引导**。因此迁移是 `V121-HOT-03` 的发布门禁，不得分开发布。

实现要点：

- 已用实验钉死前提：Chromium（Electron 43.2 / Chrome 150）对 `file://` 页面的 localStorage **跨路径共享**，`location.origin` 就是 `file://`。因此用一个不含任何应用代码的专用导出页 `storage-export.html`（renderer 的第三个构建入口）以 `file://` 读取旧 origin，零应用启动风险。若将来 Chromium 改为按路径隔离，需改为加载真实 `index.html` 并在入口加「先判标记、再动态 import 应用模块」的守卫。
- 导出发生在创建主窗口之前；导入发生在新 origin 的页面脚本之前（preload 阶段）。主进程只通过 `additionalArguments` 传一个**布尔标记**，不传偏好值本体，避免偏好出现在系统进程列表。
- **通用拷贝所有 key，不用白名单**——`@musefold/product-ui` 也会引入 key，白名单必然漏。只写目标 origin 中不存在的 key，绝不覆盖。单 key 超 1 MiB 跳过，总量超 5 MiB 截断。
- 只有在载荷成功写入后才置位完成标记；导出失败最多重试一次后永久放弃，不允许每次启动都开隐藏窗口。旧 `file://` 数据不删除，保留回滚余地。
- preload 用 `sendSync` 取载荷，而 `sendSync` 无法设超时——handler 缺失会导致永久白屏。故主进程在附加标记前先核验 handler 已注册，未注册则**不加标记**，迁移自然推迟到下次启动。这是从生产侧杜绝硬故障，而非在消费侧兜底。
- 日志只记 key 数量、耗时与 key 名，绝不记 value。

已用同一 userData 目录做端到端实证：先经 `file://` 写入 15 个 key，再启动切换后的应用，15 个值全部一致（含 `musefold:onboarded` 与一个未列入清单的 key，证明通用拷贝生效），`onboarding` store 判定为已引导；第二次启动不再打开隐藏窗口。

### 完成条件

- 在 `dev` 通道上完成一次真实的端到端热更新并可回退。⏳ 阻塞于 `V121-CHAN-07`
- 三条失败路径均有自动化测试覆盖且通过。⏳ 属 `V121-HOT-11`
- 热更新前后渲染层的 `localStorage` 与 `IndexedDB` 数据保持连续。✅ 固定 origin 已就位；跨 origin 的一次性迁移见 `V121-HOT-13`（渲染层不使用 IndexedDB，已全仓核实）
- 断网、CDN 不可达、归档损坏三种情况下应用仍能正常启动。✅ 解析器在无候选时一律回落随包内置 `out/renderer`；完整能力待 `V121-HOT-05`

### 已知缺陷（实现期发现，不属本里程碑）

~~宠物窗口主题加载用 `app.getAppPath()` 解析 `resources/pet/cat/theme.json`，在 electron-vite 的**未打包构建**里会解析到 `out/main/resources/...` 而落空。~~ **已于 2026-08-20 修复**。

排查后发现这不是桌宠一处的问题，而是全主进程缺少统一的应用根解析：`media-protocol.ts`（桌宠 sprite）、`tray.ts`（托盘图标）同样直接拼 `app.getAppPath()`，而 `window.ts`、`renderer-bundle.ts` 用的是 `process.cwd()`——后者从仓库根启动才对，换工作目录同样会错。`integration.ts` 则自建了一套「候选目录逐个探测产物」的兜底。

修法是新增 `electron/main/app-paths.ts` 作为唯一解析入口：`resolveAppRoot()` 打包时直接用 `app.getAppPath()`，未打包时从它逐级向上找同时含 `resources/` 与 `name` 为 `musefold-app` 的 `package.json` 的目录，失败依次回落 `process.cwd()`（同样校验）与原始 appPath，不抛错；`resolveResourcePath()` 在此之上按打包形态切换 `process.resourcesPath` 与 `<appRoot>/resources`。7 处调用点全部改走它，`integration.ts` 的候选扫描随之收敛。**打包期路径行为零变化**（仍走 `process.resourcesPath`），`about.ts` 的未打包文档路径一并接入。

## 8. M6：外壳发布流水线

### 任务

- `V121-REL-01`：实现 tag 触发的打包 workflow，复用现有 `package:mac`、`package:win` 与 `tests/package/`。
- `V121-REL-02`：接入 macOS Developer ID 签名与公证，凭据经 secret 注入。
- `V121-REL-03`：接入 Windows 代码签名证书。
- `V121-REL-04`：在发布前校验 `release-gate-evidence.json`，沿用 `scripts/release-gate-evidence.mjs` 的 `--strict` 语义与既有五道门禁。
- `V121-REL-05`：实现安装包上传到对象存储与 CDN，并写入目标通道的 `latest.yml` / `latest-mac.yml`；产物完整性按 `V121-ENV-05` 的清单校验。
- `V121-REL-06`：更新 `website/Musefold/downloads/catalog.json` 与官网下载文案，保留上一版本用于回滚。
- `V121-REL-07`：更新 `docs/v0.5/V05-UPDATER.md` 的手工发布步骤，标注哪些步骤已自动化。

### 完成条件

- 打一个 tag 即可产出签名并公证的 macOS 与 Windows 安装包，且已上传到 CDN。
- 每个版本的产物集合完整：安装包、`.blockmap`、macOS `.zip`、`SHA256SUMS.txt`、`latest*.yml`。
- evidence 门禁不通过时不写入 `latest*.yml`。
- 从旧版本执行「检查更新 → 下载 → 重启更新」全流程通过。
- `stable` 通道保留上一版本，回滚不需要重新构建。

## 9. M7：iOS 接入预留

v1.2.1 只交付协议与认证侧的预留，实际接入属于 v3.0。

### 任务

- `V121-IOS-01`：在 manifest schema 中保留 `capacitor-web` surface，客户端对未知 surface 的忽略行为需有测试覆盖。
- `V121-IOS-02`：评估并记录 Cookie 会话到 bearer token 的迁移路径，以 `@musefold/new-api-client` 现有 device-token 为起点。
- `V121-IOS-03`：记录 App Store 条款 4.2 的应对方案，列出候选原生集成能力与优先级。

### 完成条件

- v3.0 开工时不需要修改 manifest schema 即可接入第三个 surface。
- bearer token 迁移路径有明确文档，且不破坏现有 Web 的 Cookie 会话。

## 10. 发布门禁

以下门禁在 v1.2.1 视为完成的前提，缺一不可：

1. 线上事实源与 Musefold 一致，且可从镜像标签追溯到具体提交。
2. 桌面更新源返回 200，已发布版本能完成一次真实的检查更新。
3. Web、API、Worker 三者均可自动部署并可在一次命令内回滚。
4. 内容层热更新在 `dev` 通道完成一次真实端到端验证，包含一次主动回退。
5. 签名私钥不出现在仓库、runner 工作目录与任何日志中，且有轮换方案。
6. 外壳层 tag 发布链路完整跑通一次，产出签名并公证的安装包。
7. 部署不以 `root` 执行；runner 的资源上限与权限边界经过验证，构建不影响线上服务。
8. `Caddyfile` 与 `remote-compose.yaml` 由仓库下发，服务器上无手工编辑入口。
9. `docs/v0.5/V05-UPDATER.md` 与 `website/Musefold/downloads/README.md` 中已自动化的手工步骤被更新或移除。

以下属于外部门禁，不由代码决定：对象存储与 CDN 的采购与备案、Developer ID 与 Windows 证书的有效期、生产主机的资源余量与冗余方案。

## 11. 相关文档

- [CI/CD 与持续交付架构](./V121-CICD-ARCHITECTURE.md)
- [技术选型与决策](./V121-TECHNOLOGY-DECISIONS.md)
- [热更新协议](./V121-HOT-UPDATE-PROTOCOL.md)
- [v1.1 Web 后端交付计划](../v1.1/V11-BACKEND-DELIVERY-PLAN.md)
- [v1.2.2 系统架构重构迁移计划](../v1.2.2/V122-MIGRATION-PLAN.md)
