# Musefold v1.2.1 CI/CD 与持续交付架构

> **状态**：v1.2.1 架构基线
>
> **日期**：2026-08-20
>
> **范围**：Web、桌面端和未来 iOS 端的构建、发布、热更新与回滚链路
>
> **目的**：让每次合并到 `main` 的改动都能自动到达线上，同时不降低桌面端签名分发的安全等级

## 0. 最终推荐

v1.2.1 把发布拆成两条独立车道，而不是继续用一条流水线承载全部产物：

```text
内容层（每次合并，分钟级）
  ├─ Web SPA            apps/web/dist        → Caddy 静态目录原子切换
  ├─ 桌面 renderer      out/renderer         → 签名 bundle → userData
  └─ iOS webview 资产   （v3.0 起）           → Capacitor live update

服务层（每次合并，带迁移闸门）
  ├─ Web API            apps/web-api         → 健康检查门控滚动重启
  └─ Generation Worker  apps/generation-worker

外壳层（打 tag，小时级）
  ├─ Electron 二进制    electron/ + 原生依赖  → 签名/公证 → electron-updater
  └─ iOS 二进制         （v3.0 起）           → TestFlight / App Store
```

技术栈冻结为：

| 层 | v1.2.1 选型 |
|---|---|
| CI 平台 | GitHub Actions |
| 包管理器 | npm workspaces（v1.2.x 冻结，pnpm 评估见 [v1.2.2 技术决策 D4](../v1.2.2/V122-TECHNOLOGY-DECISIONS.md)） |
| 构建编排 | Turborepo，affected-only + 远程缓存，任务图以 workspace 包为节点定义 |
| 部署执行位置 | 生产主机上的自托管 runner（标签 `musefold-prod`），**仅部署，不做验证** |
| Web 托管 | 保持 Caddy 同源，静态目录相对 symlink 原子切换 |
| 服务发布 | Docker Compose 本机容器化构建，镜像按 `gitSha` 打标，`/health/ready` 门控 |
| 基础设施配置 | `Caddyfile` 与 `remote-compose.yaml` 由仓库下发并校验一致性 |
| 数据库迁移 | `node-pg-migrate`，强制 expand/contract |
| 内容层分发 | 签名 bundle + `manifest.json` |
| Bundle 签名 | Ed25519，公钥编译进主进程 |
| 安装包分发 | 对象存储 + CDN |
| 更新通道 | `dev` / `beta` / `stable` 三通道 |
| iOS 形态 | Capacitor 包 `apps/web`（v3.0 落地，v1.2.1 只预留协议） |

v1.2.1 不引入 Kubernetes、不引入第二套 CI 平台、不把 Web 迁出同源、不为 iOS 单开一条流水线。

## 1. 生产环境现状

以下为 2026-08-20 对 `musefold-cloud`（`45.207.211.136`）的实地盘点结果，所有后续设计以此为准。

### 1.1 主机

| 项 | 实测值 |
|---|---|
| 系统 | Ubuntu 24.04.4 LTS |
| CPU | AMD EPYC 7K62，8 vCPU |
| 内存 | 7.8 GiB，已用 1.3 GiB，可用 6.5 GiB |
| Swap | 2 GiB |
| 磁盘 | `/dev/vda1` 49 GiB；盘点时已用 16 / 可用 33 GiB。2026-08-20 清理后已用 11 / 可用 39 GiB |
| 负载 | `0.07 / 0.07 / 0.08`（8 核，基本空闲） |
| Docker | 29.7.2 + Compose v5.4.0 |
| 宿主机 Node/npm | **未安装** |
| 对外端口 | 仅 22、80、443；new-api 绑定 `127.0.0.1:3000` |
| 登录身份 | `root`，无专用部署用户 |

### 1.2 运行中的容器

全部挂在 Docker 网络 `musefold_default` 上：

| 容器 | 镜像 | 状态 |
|---|---|---|
| `musefold-caddy-1` | `caddy:2` | 对外 80/443 |
| `musefold-v11-web-api-1` | `musefold-v11:latest` | healthy，60160 |
| `musefold-v11-worker-1` | `musefold-v11:latest` | 运行中 |
| `musefold-v11-minio-1` | `minio/minio:latest` | 9000 |
| `musefold-download-stats-1` | `musefold-download-stats` | healthy，8080 |
| `musefold-new-api-1` | `calciumion/new-api:v1.0.0-rc.24` | 运行中 |
| `musefold-db-1` | `postgres:16` | healthy |
| `musefold-redis-1` | `redis:7` | 运行中 |

v1.1 全栈已经真实上线并 healthy，不是待部署状态。

### 1.3 目录与挂载

站点根在**宿主机**上是 `/opt/musefold/site`，以只读方式绑定挂载进 Caddy 容器后才叫 `/srv/musefold-site`：

```text
/opt/musefold/site            -> /srv/musefold-site (ro)    # Caddy 容器内路径
/opt/musefold/Caddyfile       -> /etc/caddy/Caddyfile (ro)
/opt/musefold/caddy_data      -> /data (rw)
/opt/musefold/caddy_config    -> /config (rw)
```

Web SPA 实际位于 `/opt/musefold/site/Musefold/app/`。部署工作区为 `/opt/musefold/`（compose、Caddyfile、数据卷）与 `/opt/musefold-v11-src/`（构建用源码）。

### 1.4 当前发布方式

`/opt/musefold-v11-src/` 的属主是 uid `501`/`staff`，即开发机 macOS 用户，且该目录**不是 git 仓库**。发布流程实际是：本地 rsync 源码到服务器 → 在服务器上 `docker build` → `docker compose up`。Docker 构建缓存已积累 3.53 GiB，可回收 3.46 GiB，印证镜像确实在服务器本机构建。

仓库内的 `infra/v1.1/Caddyfile` 与 `infra/v1.1/remote-compose.yaml` 与线上文件逐字节一致。配置目前没有漂移，但同步完全靠人工——`/opt/musefold/` 下留有 5 份带时间戳的 `Caddyfile.bak-*` 与 3 份 `docker-compose.yml.bak-*`，说明历史上是直接在服务器上改的。

### 1.5 实测发现的三个缺陷

1. **桌面自动更新曾在生产环境 404**（2026-08-20 已止血）。`/opt/musefold/site/Musefold/updates/` 原先不存在；现已写入 `stable/latest.yml` 与 `stable/latest-mac.yml`，清单指向完整的 `downloads/0.3.2` 安装包与 zip。`0.5.0-dev` 仍缺 macOS `.zip`，且客户端 `allowPrerelease = false`，故未把它写成当前通道版本。
2. **线上源码来自 PromptForge 旧副本**。`/opt/musefold-v11-src/package.json` 与 `README.md` 的 MD5 与 `PromptForge/` 完全一致，与 `Musefold/` 不一致。所幸 `apps/` 以及全部服务端共享包（`contracts`、`domain`、`server-crypto`、`new-api-client`、`cloud-client`、`ui`）在两棵树之间**完全相同**，因此线上 API 与 Worker 的行为等价于 Musefold HEAD。分叉集中在桌面侧的 `core`、`cli`、`client`、`automation-server`、`product-ui`。
3. **桌面 SQLite 迁移编号已错位**。Musefold 插入了 `0016_cost_points.ts`，把 `cloud_prompt_sync`、`cloud_sync_snapshot`、`cloud_sync_usage_events` 整体从 `0016/0017/0018` 顺延为 `0017/0018/0019`。两条谱系下同一个迁移号含义不同，已按旧谱系建库的安装升级到新谱系存在数据风险。

此外，两个仓库的 git 历史**没有共同祖先**（PromptForge 的 HEAD 在 Musefold 中不是合法对象，且 PromptForge 无 remote），因此无法用 merge 收敛，只能以 Musefold 为准重新部署。

### 1.6 待清理项

| 项 | 占用 / 影响 |
|---|---|
| `site-backup-v11-20260819-224253.tar.gz` | 1.05 GiB；2026-08-20 已删除 |
| Docker 构建缓存 | 3.53 GiB；2026-08-20 已 `docker builder prune -af` |
| 未使用镜像 `node:24` | 1.64 GiB；2026-08-20 已删除（无容器引用） |
| macOS 资源派生文件 | `._Musefold`、`._index.html` 等 163 字节文件正被 Caddy 对外提供 |
| `musefold-e2e.service`、`musefold-edits.service` | 两个 failed 状态的遗留 systemd 单元 |
| `downloads/0.5.0-dev/` | 缺 `.zip`、缺 `dmg.blockmap`、缺 `SHA256SUMS.txt`，且存在 `Musefold Setup 0.5.0-dev.exe` 与 `Musefold-Setup-0.5.0-dev.exe` 两个不同命名、不同大小的安装包 |

## 2. 要解决的问题

`.github/workflows/ci.yml` 当前有 4 个 job：`check`、`e2e`、`mac-package-smoke`、`windows-package-smoke`。它们全部只做验证，没有任何一步部署、推镜像或发布更新清单。

结合第 1 节的实地情况，需要解决五个问题：

1. **没有部署链路**。发布依赖开发机 rsync 加服务器上手工执行命令，不可复现、不可回滚、无审计，且与开发机的本地状态强耦合。
2. **反馈循环过长**。没有路径过滤，改一行 Web 文案也会触发 Windows 打包（超时上限 60 分钟）。
3. **更新源硬编码且原先 404**。`stable/latest*.yml` 已于 2026-08-20 补上（指向 `0.3.2`），通道概念仍未引入。
4. **桌面端任何改动都要走完整签名公证**。即使只改渲染层的一段 JS，也要重新打包、签名、公证、让用户重新下载上百 MB。
5. **事实源不唯一**。线上跑的是 PromptForge 谱系，仓库以 Musefold 为准，两者的桌面侧迁移编号已冲突。在建立自动化之前必须先收敛，否则自动化只会把错误的谱系固化下来。

## 3. 分层模型

### 3.1 分层依据

分层不是按代码目录划分的，而是按**能否绕过原生代码签名**划分：

- macOS 使用 `hardenedRuntime: true` 并需要 Developer ID 公证。签名后的 `.app` 内部任何文件被改动，签名立即失效，Gatekeeper 会拒绝启动。
- iOS 的 App Store 审核条款 2.5.2 禁止下载并执行代码，但对由 WebKit 解释执行的 JavaScript 有明确豁免。

这两条边界重合于同一个位置：**webview 内可解释执行的资产可以远程替换，原生二进制不可以**。因此分层是外部合规条件强加的结果，不是工程偏好。

### 3.2 三层定义

| 层 | 内容 | 触发时机 | 上线方式 | 目标耗时 |
|---|---|---|---|---:|
| 内容 · Web | `apps/web/dist` | 合并到 `main` | 静态目录 symlink 原子切换 | 2-4 min |
| 内容 · 桌面 renderer | `out/renderer` | 合并到 `main` | 签名 bundle 下载到 userData | 3-5 min |
| 内容 · iOS webview | Capacitor web 资产 | 合并到 `main`（v3.0 起） | live update 清单 | 3-5 min |
| 服务 · API / Worker | `apps/web-api`、`apps/generation-worker` | 合并到 `main`，过迁移闸门 | 健康检查门控滚动重启 | 5-8 min |
| 外壳 · Electron | `electron/`、原生依赖、`package.json` 版本 | 打 tag | 签名公证 + electron-updater | 40-60 min |
| 外壳 · iOS | Capacitor 原生壳 | 打 tag（v3.0 起） | TestFlight / App Store | 数小时至数天 |

表中 `out/renderer` 是当前 electron-vite 的输出路径；v1.2.2 目录重构后变为 `apps/desktop/out/renderer`。流水线应从构建配置读取该路径，不要在 workflow 中硬编码。

### 3.3 触发层级判定

同一次提交可能同时命中多层。判定按最高层执行，且高层必然包含低层。

**层级语义按产品面定义，路径清单只是它在当前目录布局下的映射。** 该映射必须集中定义在单一位置（推荐 `.github/layer-paths.yml`，由所有 workflow 引用），禁止把路径 glob 分散拼写到多个 workflow 里——v1.2.2 系统架构重构会移动这些目录，映射集中才能一处更新。

注意：`layer-paths.yml` 中除发布三层外，另设一个 `desktop` 路径组专用于桌面 E2E 门控（测试选择），以及一个 `infra` 组（根级工程文件，命中即视为全层变更）。发布分层与测试选择是两种用途，不得混用同一组定义。判定脚本为 `.github/scripts/detect-layers.mjs`，对未映射路径一律 fail-open（视为全层命中）。

当前布局下的映射：

| 层 | 当前路径 | v1.2.2 重构后路径（预告） |
|---|---|---|
| 外壳层（打 tag 才发布） | `electron/`、`resources/`、`electron-builder.yml`、原生依赖、`package.json` 的 `dependencies` | `apps/desktop/electron/`、`apps/desktop/electron-builder.yml`、`apps/desktop/package.json` |
| 服务层 | `apps/web-api/`、`apps/generation-worker/`（含 `migrations/`） | 不变 |
| 内容层 | `src/`、`apps/web/`、`packages/ui`、`packages/product-ui`、`packages/contracts`、`packages/domain` | `apps/desktop/src/` 替代 `src/`；新增 `packages/desktop-contracts` |
| 纯文档（不触发部署） | `docs/`、`doc/`、`*.md` | 不变 |

更新此映射是 v1.2.2 目录重构 Phase 1 的验收项之一，见 [v1.2.2 迁移计划](../v1.2.2/V122-MIGRATION-PLAN.md)。

`packages/contracts` 的变更同时影响内容层和服务层，必须触发两者，且必须通过第 6 节的兼容性门禁。

## 4. 环境与通道

### 4.1 三个通道

| 通道 | 来源 | 受众 | 内容层策略 | 外壳层策略 |
|---|---|---|---|---|
| `dev` | 每次合并到 `main` | 开发者自己 | 自动全量 | 手动触发，可未签名 |
| `beta` | 手动从 `dev` 提升 | 少量愿意尝鲜的用户 | 灰度 20% → 100% | 必须签名，可跳过公证外的门禁 |
| `stable` | 手动从 `beta` 提升 | 全部正式用户 | 灰度 5% → 20% → 100% | 必须签名 + 公证 + 完整 evidence 门禁 |

提升操作只重写目标通道的 `manifest.json`，不重新构建产物。同一个 `bundleVersion` 在三个通道之间流动，保证「测过的就是发出去的」。

### 4.2 目录布局

对外 URL 与宿主机路径的对应关系如下。宿主机根为 `/opt/musefold/site`，只读挂载进 Caddy 容器后为 `/srv/musefold-site`。

| 对外 URL | 宿主机路径 | 状态 |
|---|---|---|
| `/Musefold/` | `/opt/musefold/site/Musefold/` | 已存在 |
| `/Musefold/app/` | `…/Musefold/app` → `releases/<sha>` | 已存在，需改为 symlink |
| `/Musefold/downloads/<version>/` | `…/Musefold/downloads/<version>/` | 已存在，计划迁往 CDN |
| `/Musefold/updates/<channel>/manifest.json` | `…/Musefold/updates/<channel>/` | 不存在，属 M4 |
| `/Musefold/updates/<channel>/latest.yml` | 同上 | `stable` 已存在（0.3.2） |
| `/Musefold/updates/<channel>/latest-mac.yml` | 同上 | `stable` 已存在（0.3.2） |
| `<CDN>/Musefold/bundles/<channel>/<bundleVersion>/` | 对象存储 | 需新建 |

`electron/update/updater-service.ts` 中硬编码的 `UPDATE_FEED_URL` 需改为按通道拼接，通道值来自设置项并可被 `MUSEFOLD_UPDATE_CHANNEL` 覆盖。默认值保持 `stable`，确保现有安装的行为不变。

`updates/stable/latest*.yml` 已于 2026-08-20 补上，检查更新不再 404。通道化与 `manifest.json` 仍属后续里程碑。

### 4.3 通道与现有更新器的关系

`docs/v0.5/V05-UPDATER.md` 描述的 electron-updater 行为继续有效，v1.2.1 只做两处扩展：

1. feed URL 从常量变为按通道拼接。
2. 在 electron-updater 之外新增一条内容层通道；两者互不干扰，外壳层更新仍然只由 electron-updater 负责。

## 5. 流水线拓扑

### 5.1 快车道（合并到 `main` 触发）

```text
merge → turbo 判定 affected
      → 门禁：typecheck + 单测 + 契约兼容检查
      → 构建命中层的产物
      → 自托管 runner 本机部署
      → /health/ready 或静态可达性验证
      → 写入 dev 通道 manifest
```

任何一步失败即中止，且不写 manifest。已经部署的服务层保持在上一个健康版本。

### 5.2 慢车道（打 tag 触发）

```text
tag v1.2.1 → mac / win 打包
           → 签名 + 公证
           → 包冒烟测试（沿用现有 tests/package/）
           → release evidence 门禁校验
           → 安装包上传对象存储 + CDN
           → 写入目标通道的 latest*.yml
```

慢车道完全复用现有的 `npm run package:mac`、`package:win`、`release:evidence` 与 `tests/package/` 资产，不重写。变化只有两点：由 tag 而非每次 push 触发，以及末尾增加上传步骤。

### 5.3 现有 CI job 的归属

| 现有 job | v1.2.1 归属 | 变化 |
|---|---|---|
| `check` | 快车道门禁 | 改为 affected-only，接入远程缓存 |
| `e2e` | 快车道门禁 | 仅在 `desktop` 路径组命中时运行（`.github/layer-paths.yml` 中独立于发布三层的桌面 E2E 门控组，覆盖 `src/`、`electron/`、`shared/`、`packages/` 等；仅改 `apps/web` 或 `apps/web-api` 不触发桌面 E2E） |
| `mac-package-smoke` | 慢车道 | 从 push 触发改为 tag 触发 |
| `windows-package-smoke` | 慢车道 | 从 push 触发改为 tag 触发 |

`mac-package-smoke` 中 `hdiutil verify release/Musefold-0.3.0-dev-arm64.dmg` 的文件名是硬编码的旧版本号，与当前 `0.5.0-dev` 不一致，迁移时必须改为从 `package.json` 读取版本号拼接。

## 6. 契约兼容性门禁

内容层与外壳层的发布节奏不同，用户机器上的外壳可能比 API 落后数月。因此需要两道机器可判定的门禁：

1. **前向兼容**：`manifest.json` 的 `minShellVersion` 声明该 bundle 所需的最低外壳版本。主进程在应用 bundle 前比较自身版本，不满足则拒绝并停留在当前版本。
2. **后向兼容**：CI 用最近 K 个已发布客户端版本的 `@musefold/contracts` schema 校验新 API 的响应。K 的初始值取 3，随发布节奏调整。

数据库迁移强制 expand/contract：先加列并双写，等旧客户端淘汰后再单独发一次迁移删列。禁止在同一次部署中同时停止写入某列并删除它。

## 7. 执行位置与 runner 拓扑

### 7.1 为什么部署在自托管 runner 上执行

生产主机 `45.207.211.136` 位于境内，GitHub Actions 托管 runner 在境外。跨境传输构建产物或拉取容器镜像是整条链路中最不稳定的一段。把部署 job 放在生产主机自己的 runner 上，代码从 GitHub 拉取（体积小），镜像在本机构建本机启动（不过境），同时不需要为 GitHub 开放入站 SSH——当前对外只有 22、80、443 三个端口，这一点应当保持。

这也不是引入新做法，而是把既有做法自动化：服务器上已经积累了 3.53 GiB Docker 构建缓存，镜像本来就在本机构建，只是触发方式是人工 rsync 加手敲命令。

### 7.2 runner 只负责部署，不负责验证

这是本次实地盘点后的关键修正。生产主机有两条硬约束：

1. **宿主机没有 Node 和 npm**，只有 Docker。任何 JavaScript 构建都必须在容器内进行。
2. **内存只有 7.8 GiB**，而 `package.json` 中的 `typecheck:mcp` 显式要求 `--max-old-space-size=8192`。完整的 `npm run check` 在这台机器上会 OOM。

因此自托管 runner 的职责被严格限定为**部署**：拉取源码、构建 Docker 镜像、执行迁移、切换静态目录、滚动容器、写入 manifest。所有 typecheck、单元测试、契约检查、E2E 一律留在 GitHub 托管 runner 上，通过之后才允许触发部署 job。

镜像构建本身（`npm ci` + `npm run build:web`，见 `infra/v1.1/Dockerfile`）在容器内完成，内存占用远低于 `typecheck:mcp`，8 vCPU 与当前 `0.07` 的负载有充足余量。

### 7.3 runner 分工

| Runner | 位置 | 承担的 job |
|---|---|---|
| `ubuntu-latest`（托管） | GitHub | 快车道门禁：typecheck、单测、契约检查、Web/renderer 构建 |
| `musefold-prod`（自托管） | 生产主机 | 仅部署：镜像构建、迁移、静态切换、容器滚动、manifest 写入 |
| `macos-latest`（托管） | GitHub | 慢车道：macOS 打包、签名、公证 |
| `windows-latest`（托管） | GitHub | 慢车道：Windows 打包与运行时冒烟 |

### 7.4 自托管 runner 的隔离要求

自托管 runner 与生产服务同机，必须做资源与权限隔离：

- runner 以专用非 root 用户运行，仅授予部署所需的受限 `sudo` 条目。当前服务器只有 `root` 一个可登录身份，创建部署用户是前置任务。
- runner 进程设置 CPU 与内存上限。参考基线：容器化构建限制在 4 vCPU / 3 GiB 以内，为线上服务保留余量。
- 只接受来自本仓库的 workflow，禁止 fork PR 触发。
- 部署密钥通过环境注入，不写入工作目录。

## 8. 部署机制

### 8.1 Web 静态

Web SPA 的宿主机实际路径是 `/opt/musefold/site/Musefold/app/`。构建产物落到同级的 `releases/<gitSha>/`，通过 symlink 原子切换：

```text
/opt/musefold/site/Musefold/app        -> releases/<gitSha>      # 相对符号链接
/opt/musefold/site/Musefold/releases/<gitSha>/
```

**符号链接必须是相对路径。** `/opt/musefold/site` 是以只读方式绑定挂载到 Caddy 容器的 `/srv/musefold-site`，容器内不存在 `/opt/musefold` 这个路径。指向宿主机绝对路径的软链在容器内无法解析，会直接 404。

只读挂载不影响本方案：切换动作发生在宿主机侧，Caddy 只需要能读到切换后的结果。

切换是单次 `rename` 系统调用，不存在半更新状态。保留最近 5 个 release 目录用于即时回滚，回滚即把 symlink 指回上一个。

Caddy 当前对 `/Musefold/*` 设置了 `Cache-Control: no-cache`，配合 Vite 的内容哈希文件名，切换后用户刷新即可拿到新版本。

传输环节需要显式排除 macOS 资源派生文件。当前站点目录下已经存在 `._Musefold`、`._index.html`、`._styles.css` 等 163 字节的 `._*` 文件并正被对外提供，这是 rsync 未加 `--no-xattrs` 之类参数的产物。

### 8.2 API 与 Worker

顺序固定为：构建镜像 → 执行迁移 → 启动新容器 → 等待 `/health/ready` → 切走旧容器。

镜像必须打 `gitSha` 标签。当前线上 `v11-web-api` 与 `v11-worker` 共用 `musefold-v11:latest`，`latest` 无法定位版本也无法回滚，这是自动化前必须先改掉的。

迁移作为独立步骤在容器启动前执行，使用 `musefold_migration` 角色。迁移失败则整个部署中止，旧容器不受影响。

`infra/v1.1/remote-compose.yaml` 中 `v11-web-api` 已有 `http://127.0.0.1:60160/health/live` 健康检查。v1.2.1 需要额外用 `/health/ready` 作为流量切换条件——`live` 只表示进程存活，`ready` 才表示迁移版本匹配且依赖可用。

Caddy 侧配置重试，使重启期间的抖动对用户不可见。这不是零停机部署，但对当前规模足够；真正的蓝绿部署留到出现可测量的停机影响时再引入。

### 8.3 基础设施配置入仓

`infra/v1.1/Caddyfile` 与 `infra/v1.1/remote-compose.yaml` 目前与线上逐字节一致，但一致性完全靠人工维持——`/opt/musefold/` 下留有 5 份 `Caddyfile.bak-*` 与 3 份 `docker-compose.yml.bak-*`，说明历史上是直接在服务器上编辑的。

v1.2.1 要求这两份文件由流水线从仓库下发，并在部署前校验线上文件与仓库版本一致；不一致即中止并告警。服务器上不再保留手工编辑的入口。

### 8.4 内容层 bundle

构建 → 计算 SHA-256 → Ed25519 签名 → 上传 CDN → 写入通道 manifest。协议细节见 `V121-HOT-UPDATE-PROTOCOL.md`。

## 9. 已知风险

| 风险 | 实测情况 | 缓解 |
|---|---|---|
| 内存不足以跑完整验证 | 7.8 GiB，而 `typecheck:mcp` 要 8 GiB 堆 | runner 仅部署，验证留在托管 runner |
| 磁盘增长 | 清理后可用 39 GiB；安装包仍占约 1.07 GiB | 安装包迁往对象存储；构建缓存定期回收；release 目录只留 5 份 |
| 构建与生产同机 | 8 vCPU，负载 `0.07`，CPU 余量充足 | 容器化构建 + CPU/内存上限；风险低于最初评估 |
| 热更新绕过代码签名 | 尚未实现 | Ed25519 验签，公钥编译进二进制，签名能力先于热更新上线 |
| 旧外壳与新 API 不兼容 | 桌面 SQLite 迁移编号已在两条谱系间错位 | `minShellVersion` + 契约后向兼容门禁 + 迁移谱系收敛 |
| 自托管 runner 拥有生产写权限 | 当前只有 `root` 身份 | 受保护分支、禁止 fork 触发、专用部署用户与受限 sudo |
| 高频自动发布放大事故 | 尚未实现 | 灰度分桶 + 连续崩溃自动回滚 |
| 单机无冗余 | 所有服务含 PostgreSQL 均在一台机器 | 超出 v1.2.1 范围；备份与恢复演练属 v1.1 的 M9 |

## 10. 不在 v1.2.1 范围内

- 仓库目录重构、共享层补全与桌面 Gateway 抽象。这些属于 [v1.2.2 系统架构重构](../v1.2.2/README.md)，在 v1.2.1 发布门禁全部通过后开工。
- Kubernetes、多节点编排、自动扩缩容。
- 真正的蓝绿或金丝雀基础设施（v1.2.1 只做健康门控 + 灰度百分比）。
- PR 预览环境。
- iOS 的实际接入。v1.2.1 只在协议层预留 `capacitor-web` surface，实际落地属于 v3.0。
- 更换 `release-gate-evidence` 五道人工门禁的既有语义。它继续只约束外壳层的 tag 发布，不得挂到内容层快车道上。
- 生产主机的冗余与灾备。当前 PostgreSQL、MinIO、new-api 与全部应用容器都在同一台机器上，这属于 v1.1 交付计划 M9 的范围。

## 11. 相关文档

- [技术选型与决策](./V121-TECHNOLOGY-DECISIONS.md)
- [热更新协议](./V121-HOT-UPDATE-PROTOCOL.md)
- [交付计划](./V121-DELIVERY-PLAN.md)
- [v1.2.2 系统架构重构](../v1.2.2/README.md)
- [v0.5 在线更新](../v0.5/V05-UPDATER.md)
- [v1.1 Web 版总体架构](../v1.1/V11-WEB-ARCHITECTURE.md)
- [macOS 分发](../MACOS-DISTRIBUTION.md)
