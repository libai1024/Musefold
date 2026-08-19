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
| 构建编排 | Turborepo，affected-only + 远程缓存 |
| 部署执行位置 | 生产主机上的自托管 runner（标签 `musefold-prod`） |
| Web 托管 | 保持 Caddy 同源，静态目录 symlink 原子切换 |
| 服务发布 | Docker Compose 本机构建，`/health/ready` 门控 |
| 数据库迁移 | `node-pg-migrate`，强制 expand/contract |
| 内容层分发 | 签名 bundle + `manifest.json` |
| Bundle 签名 | Ed25519，公钥编译进主进程 |
| 安装包分发 | 对象存储 + CDN |
| 更新通道 | `dev` / `beta` / `stable` 三通道 |
| iOS 形态 | Capacitor 包 `apps/web`（v3.0 落地，v1.2.1 只预留协议） |

v1.2.1 不引入 Kubernetes、不引入第二套 CI 平台、不把 Web 迁出同源、不为 iOS 单开一条流水线。

## 1. 现状与要解决的问题

`.github/workflows/ci.yml` 当前有 4 个 job：`check`、`e2e`、`mac-package-smoke`、`windows-package-smoke`。它们全部只做验证，没有任何一步部署、推镜像或发布更新清单。

由此产生四个具体问题：

1. **没有部署链路**。线上的 `/srv/musefold-site`、`musefold-v11:latest` 容器和 `/Musefold/updates/stable/` 目录全部靠手工拷贝，发布过程不可复现、不可回滚、无审计。
2. **反馈循环过长**。没有路径过滤，改一行 Web 文案也会触发 Windows 打包（超时上限 60 分钟）。这与高频迭代的工作方式直接冲突。
3. **更新源硬编码且只有一个通道**。`https://zhaozhaoyue.top/Musefold/updates/stable/` 同时写死在 `electron-builder.yml` 与 `electron/update/updater-service.ts`，没有 channel 概念，无法在不影响正式用户的前提下自测发布链路。
4. **桌面端任何改动都要走完整签名公证**。即使只改渲染层的一段 JS，也必须重新打包、签名、公证、让用户重新下载上百 MB。

## 2. 分层模型

### 2.1 分层依据

分层不是按代码目录划分的，而是按**能否绕过原生代码签名**划分：

- macOS 使用 `hardenedRuntime: true` 并需要 Developer ID 公证。签名后的 `.app` 内部任何文件被改动，签名立即失效，Gatekeeper 会拒绝启动。
- iOS 的 App Store 审核条款 2.5.2 禁止下载并执行代码，但对由 WebKit 解释执行的 JavaScript 有明确豁免。

这两条边界重合于同一个位置：**webview 内可解释执行的资产可以远程替换，原生二进制不可以**。因此分层是外部合规条件强加的结果，不是工程偏好。

### 2.2 三层定义

| 层 | 内容 | 触发时机 | 上线方式 | 目标耗时 |
|---|---|---|---|---:|
| 内容 · Web | `apps/web/dist` | 合并到 `main` | 静态目录 symlink 原子切换 | 2-4 min |
| 内容 · 桌面 renderer | `out/renderer` | 合并到 `main` | 签名 bundle 下载到 userData | 3-5 min |
| 内容 · iOS webview | Capacitor web 资产 | 合并到 `main`（v3.0 起） | live update 清单 | 3-5 min |
| 服务 · API / Worker | `apps/web-api`、`apps/generation-worker` | 合并到 `main`，过迁移闸门 | 健康检查门控滚动重启 | 5-8 min |
| 外壳 · Electron | `electron/`、原生依赖、`package.json` 版本 | 打 tag | 签名公证 + electron-updater | 40-60 min |
| 外壳 · iOS | Capacitor 原生壳 | 打 tag（v3.0 起） | TestFlight / App Store | 数小时至数天 |

### 2.3 触发层级判定

同一次提交可能同时命中多层。判定按最高层执行，且高层必然包含低层：

- 命中 `electron/`、`resources/`、`electron-builder.yml`、原生依赖或 `package.json` 的 `dependencies` → 外壳层，需要打 tag 才发布。
- 命中 `apps/web-api/`、`apps/generation-worker/`、`apps/web-api/migrations/` → 服务层。
- 命中 `src/`、`apps/web/`、`packages/ui`、`packages/product-ui`、`packages/contracts`、`packages/domain` → 内容层。
- 仅命中 `docs/`、`doc/`、`*.md` → 不触发任何部署，只跑文档检查。

`packages/contracts` 的变更同时影响内容层和服务层，必须触发两者，且必须通过第 5 节的兼容性门禁。

## 3. 环境与通道

### 3.1 三个通道

| 通道 | 来源 | 受众 | 内容层策略 | 外壳层策略 |
|---|---|---|---|---|
| `dev` | 每次合并到 `main` | 开发者自己 | 自动全量 | 手动触发，可未签名 |
| `beta` | 手动从 `dev` 提升 | 少量愿意尝鲜的用户 | 灰度 20% → 100% | 必须签名，可跳过公证外的门禁 |
| `stable` | 手动从 `beta` 提升 | 全部正式用户 | 灰度 5% → 20% → 100% | 必须签名 + 公证 + 完整 evidence 门禁 |

提升操作只重写目标通道的 `manifest.json`，不重新构建产物。同一个 `bundleVersion` 在三个通道之间流动，保证「测过的就是发出去的」。

### 3.2 目录布局

```text
https://zhaozhaoyue.top/Musefold/
  app/                                  # Web SPA，指向 releases/<sha> 的 symlink
  updates/<channel>/manifest.json       # 内容层清单（新增）
  updates/<channel>/latest.yml          # electron-updater Windows 元数据
  updates/<channel>/latest-mac.yml      # electron-updater macOS 元数据

<CDN>/Musefold/
  bundles/<channel>/<bundleVersion>/    # 内容层 bundle 产物（新增）
  downloads/<version>/                  # 安装包，从 VPS 迁出
```

`electron/update/updater-service.ts` 中硬编码的 `UPDATE_FEED_URL` 需改为按通道拼接，通道值来自设置项并可被 `MUSEFOLD_UPDATE_CHANNEL` 覆盖。默认值保持 `stable`，确保现有安装的行为不变。

### 3.3 通道与现有更新器的关系

`docs/v0.5/V05-UPDATER.md` 描述的 electron-updater 行为继续有效，v1.2.1 只做两处扩展：

1. feed URL 从常量变为按通道拼接。
2. 在 electron-updater 之外新增一条内容层通道；两者互不干扰，外壳层更新仍然只由 electron-updater 负责。

## 4. 流水线拓扑

### 4.1 快车道（合并到 `main` 触发）

```text
merge → turbo 判定 affected
      → 门禁：typecheck + 单测 + 契约兼容检查
      → 构建命中层的产物
      → 自托管 runner 本机部署
      → /health/ready 或静态可达性验证
      → 写入 dev 通道 manifest
```

任何一步失败即中止，且不写 manifest。已经部署的服务层保持在上一个健康版本。

### 4.2 慢车道（打 tag 触发）

```text
tag v1.2.1 → mac / win 打包
           → 签名 + 公证
           → 包冒烟测试（沿用现有 tests/package/）
           → release evidence 门禁校验
           → 安装包上传对象存储 + CDN
           → 写入目标通道的 latest*.yml
```

慢车道完全复用现有的 `npm run package:mac`、`package:win`、`release:evidence` 与 `tests/package/` 资产，不重写。变化只有两点：由 tag 而非每次 push 触发，以及末尾增加上传步骤。

### 4.3 现有 CI job 的归属

| 现有 job | v1.2.1 归属 | 变化 |
|---|---|---|
| `check` | 快车道门禁 | 改为 affected-only，接入远程缓存 |
| `e2e` | 快车道门禁 | 仅在内容层或服务层命中时运行 |
| `mac-package-smoke` | 慢车道 | 从 push 触发改为 tag 触发 |
| `windows-package-smoke` | 慢车道 | 从 push 触发改为 tag 触发 |

`mac-package-smoke` 中 `hdiutil verify release/Musefold-0.3.0-dev-arm64.dmg` 的文件名是硬编码的旧版本号，与当前 `0.5.0-dev` 不一致，迁移时必须改为从 `package.json` 读取版本号拼接。

## 5. 契约兼容性门禁

内容层与外壳层的发布节奏不同，用户机器上的外壳可能比 API 落后数月。因此需要两道机器可判定的门禁：

1. **前向兼容**：`manifest.json` 的 `minShellVersion` 声明该 bundle 所需的最低外壳版本。主进程在应用 bundle 前比较自身版本，不满足则拒绝并停留在当前版本。
2. **后向兼容**：CI 用最近 K 个已发布客户端版本的 `@musefold/contracts` schema 校验新 API 的响应。K 的初始值取 3，随发布节奏调整。

数据库迁移强制 expand/contract：先加列并双写，等旧客户端淘汰后再单独发一次迁移删列。禁止在同一次部署中同时停止写入某列并删除它。

## 6. 执行位置与 runner 拓扑

### 6.1 为什么部署在自托管 runner 上执行

生产主机 `45.207.211.136` 位于境内，GitHub Actions 托管 runner 在境外。跨境传输构建产物或拉取容器镜像是整条链路中最不稳定的一段。把部署 job 放在生产主机自己的 runner 上，代码从 GitHub 拉取（体积小），镜像在本机构建本机启动（不过境），同时不需要为 GitHub 开放入站 SSH。

### 6.2 runner 分工

| Runner | 位置 | 承担的 job |
|---|---|---|
| `ubuntu-latest`（托管） | GitHub | 快车道门禁：typecheck、单测、契约检查、Web/renderer 构建 |
| `musefold-prod`（自托管） | 生产主机 | 部署：静态切换、镜像构建、迁移、容器滚动、manifest 写入 |
| `macos-latest`（托管） | GitHub | 慢车道：macOS 打包、签名、公证 |
| `windows-latest`（托管） | GitHub | 慢车道：Windows 打包与运行时冒烟 |

### 6.3 自托管 runner 的隔离要求

自托管 runner 与生产服务同机，必须做资源与权限隔离：

- runner 以专用非 root 用户运行，仅授予部署所需的受限 `sudo` 条目。
- runner 进程设置 CPU 与内存上限，避免构建把生产服务挤出。
- 只接受来自本仓库的 workflow，禁止 fork PR 触发。
- 部署用的密钥通过环境注入，不写入工作目录。

单机同时承担构建与生产是本方案已知的主要架构风险，见第 8 节。

## 7. 部署机制

### 7.1 Web 静态

构建产物落到 `releases/<gitSha>/`，通过 symlink 原子切换：

```text
/srv/musefold-site/app          -> releases/<gitSha>/
/srv/musefold-site/releases/<gitSha>/
```

切换是单次 `rename` 系统调用，不存在半更新状态。保留最近 5 个 release 目录用于即时回滚，回滚即把 symlink 指回上一个。

Caddy 当前对 `/Musefold/*` 设置了 `Cache-Control: no-cache`，配合 Vite 的内容哈希文件名，切换后用户刷新即可拿到新版本，无需清理 CDN。

### 7.2 API 与 Worker

顺序固定为：构建镜像 → 执行迁移 → 启动新容器 → 等待 `/health/ready` → 切走旧容器。

迁移作为独立步骤在容器启动前执行，使用 `musefold_migration` 角色。迁移失败则整个部署中止，旧容器不受影响。

`infra/v1.1/remote-compose.yaml` 中 `v11-web-api` 已有 `http://127.0.0.1:60160/health/live` 健康检查。v1.2.1 需要额外用 `/health/ready` 作为流量切换条件——`live` 只表示进程存活，`ready` 才表示迁移版本匹配且依赖可用。

Caddy 侧配置重试，使重启期间的抖动对用户不可见。这不是零停机部署，但对当前规模足够；真正的蓝绿部署留到出现可测量的停机影响时再引入。

### 7.3 内容层 bundle

构建 → 计算 SHA-256 → Ed25519 签名 → 上传 CDN → 写入通道 manifest。协议细节见 `V121-HOT-UPDATE-PROTOCOL.md`。

## 8. 已知风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 单机同时跑构建与生产 | 构建占满 CPU 拖慢线上服务 | runner 资源上限；预算允许时拆出独立构建机 |
| 热更新绕过代码签名 | 服务器失守等于全端任意代码执行 | Ed25519 验签 + 公钥编译进二进制；签名能力先于热更新上线 |
| 旧外壳与新 API 不兼容 | 老版本桌面端功能异常 | `minShellVersion` + 契约后向兼容门禁 + expand/contract 迁移 |
| 自托管 runner 拥有生产写权限 | workflow 被篡改即等于拿到生产 | 受保护分支、禁止 fork 触发、受限 sudo |
| 高频自动发布放大事故 | 坏版本快速铺开 | 灰度分桶 + 连续崩溃自动回滚 |

## 9. 不在 v1.2.1 范围内

- Kubernetes、多节点编排、自动扩缩容。
- 真正的蓝绿或金丝雀基础设施（v1.2.1 只做健康门控 + 灰度百分比）。
- PR 预览环境。
- iOS 的实际接入。v1.2.1 只在协议层预留 `capacitor-web` surface，实际落地属于 v3.0。
- 更换 `release-gate-evidence` 五道人工门禁的既有语义。它继续只约束外壳层的 tag 发布，不得挂到内容层快车道上。

## 10. 相关文档

- [技术选型与决策](./V121-TECHNOLOGY-DECISIONS.md)
- [热更新协议](./V121-HOT-UPDATE-PROTOCOL.md)
- [交付计划](./V121-DELIVERY-PLAN.md)
- [v0.5 在线更新](../v0.5/V05-UPDATER.md)
- [v1.1 Web 版总体架构](../v1.1/V11-WEB-ARCHITECTURE.md)
- [macOS 分发](../MACOS-DISTRIBUTION.md)
