# Musefold v1.2.1

v1.2.1 是持续交付版本。它不新增产品功能，交付的是让每次改动都能自动到达线上的发布链路，以及 Web、桌面端和未来 iOS 端的热更新能力。

## 文档

- [CI/CD 与持续交付架构](./V121-CICD-ARCHITECTURE.md)
- [技术选型与决策](./V121-TECHNOLOGY-DECISIONS.md)
- [内容层热更新协议](./V121-HOT-UPDATE-PROTOCOL.md)
- [iOS 接入预留](./V121-IOS-RESERVE.md)
- [交付计划](./V121-DELIVERY-PLAN.md)

后继版本：[v1.2.2 系统架构重构](../v1.2.2/README.md)。v1.2.1 交付的自动化流水线是 v1.2.2 目录重构的回归安全网，两者的顺序关系见交付计划第 0 节原则 7。

## 核心结论

发布按**能否绕过原生代码签名**分成三层，而不是按代码目录：

- **内容层**（Web SPA、桌面 renderer、iOS webview 资产）每次合并自动上线，分钟级。
- **服务层**（Web API、Generation Worker）每次合并自动上线，需过数据库迁移闸门。
- **外壳层**（Electron 二进制、iOS 二进制）只在打 tag 时发布，走完整签名与公证。

这条分界线由 macOS 的 `hardenedRuntime` 加公证要求和 App Store 条款 2.5.2 共同决定，不是工程偏好。两者恰好重合于同一位置：webview 内可解释执行的资产可以远程替换，原生二进制不可以。

三个内容层 surface 由同一条流水线产出，共用同一套 manifest、Ed25519 签名、灰度分桶与自动回滚机制。iOS 接入时是往这条总线上挂第三个消费端，不是新建流水线。

## 范围

| 属于 v1.2.1 | 不属于 v1.2.1 |
|---|---|
| 生产环境收敛：事实源统一、线上缺陷修复 | Kubernetes 与多节点编排 |
| 流水线提速：路径过滤、并发取消、Turborepo 缓存 | 真正的蓝绿 / 金丝雀基础设施 |
| Web 静态自动部署与原子回滚 | PR 预览环境 |
| API 与 Worker 自动部署、迁移闸门 | iOS 实际接入（属于 v3.0） |
| `dev` / `beta` / `stable` 三通道 | 更改 evidence 五道人工门禁的既有语义 |
| 内容层 bundle 签名、灰度与自动回滚 | 生产主机的冗余与灾备（属 v1.1 的 M9） |
| 外壳层 tag 触发的签名公证与 CDN 分发 | 新增产品功能 |
| ESLint + Prettier 基线（`V121-CI-08`） | 仓库目录重构与共享层补全（属 v1.2.2） |

## 生产环境实测（2026-08-20）

对 `musefold-cloud`（`45.207.211.136`）的实地盘点结果，完整数据见 [架构文档第 1 节](./V121-CICD-ARCHITECTURE.md)。

- Ubuntu 24.04，8 vCPU / 7.8 GiB 内存 / 49 GiB 磁盘（盘点时可用 33 GiB，2026-08-20 清理后可用 39 GiB），负载 `0.07`。
- 8 个容器全部在跑：Caddy、v11-web-api（healthy）、v11-worker、v11-minio、download-stats、new-api、postgres:16、redis:7。v1.1 全栈已真实上线。
- 宿主机**没有安装 Node 与 npm**，只有 Docker、git、rsync、curl。
- 站点根在宿主机是 `/opt/musefold/site`，只读挂载进 Caddy 容器后才是 `/srv/musefold-site`。
- 现有发布方式是从开发机 rsync 源码到 `/opt/musefold-v11-src`，再在服务器本机 `docker build`；构建缓存已积累 3.53 GiB。
- 对外仅开放 22、80、443；唯一可登录身份是 `root`。

这次盘点修正了两个原本基于推测的判断：CPU 余量充足，「构建与生产同机」的风险低于预估；真正的约束是**内存 7.8 GiB 不足以运行要求 8 GiB 堆的 `typecheck:mcp`**，因此自托管 runner 只能负责部署，验证必须留在 GitHub 托管 runner。

## 实测发现的三个线上缺陷

1. **桌面自动更新曾在生产环境 404**（2026-08-20 已止血）。`/Musefold/updates/` 原先不存在；现已补上 `stable/latest.yml` 与 `stable/latest-mac.yml`，指向完整的 `0.3.2` 产物。`0.5.0-dev` 仍缺 macOS `.zip`，且客户端 `allowPrerelease = false`，故未把它写成当前通道版本。
2. **线上源码来自 PromptForge 旧副本**。`/opt/musefold-v11-src/` 的 `package.json` 与 `README.md` 的 MD5 与 `PromptForge/` 完全一致。所幸 `apps/` 与全部服务端共享包（`contracts`、`domain`、`server-crypto`、`new-api-client`、`cloud-client`、`ui`）在两棵树间完全相同，线上 API 与 Worker 等价于 Musefold HEAD；分叉集中在桌面侧。
3. **桌面 SQLite 迁移编号已错位**。Musefold 插入 `0016_cost_points.ts` 后，后续三个迁移整体顺延一位，与 PromptForge 谱系冲突。两个仓库的 git 历史没有共同祖先，无法 merge，只能以 Musefold 为准重新收敛。

这三项加上权限与清理事项构成里程碑 M0，必须在建立自动化之前完成——否则流水线只会把错误状态固化下来。

## 当前状态（2026-08-20）

- 本轮产出仅为上述四份设计文档，代码尚未开工。
- `.github/workflows/ci.yml` 现有四个 job 全部只做验证，没有任何部署步骤。
- 更新源同时硬编码在 `electron-builder.yml` 与 `electron/update/updater-service.ts`，尚无通道概念。
- 镜像标签为 `musefold-v11:latest`，无法定位线上运行的具体提交，也无法回滚。
- `infra/v1.1/Caddyfile` 与 `remote-compose.yaml` 与线上逐字节一致，但一致性靠人工维持（服务器上留有 5 份 `Caddyfile.bak-*`）。
- `package.json` 版本为 `0.5.0-dev`，与文档基线 v1.2.1 不一致。统一版本号口径是 M1 的任务卡 `V121-CI-07`。

## 上线顺序约束

M0 的生产环境收敛先于一切自动化。签名、版本下限校验与自动回滚必须先于桌面热更新开关上线；在这三项完成之前，可以先交付 Web 与服务层的自动部署——那一侧不存在热更新绕过代码签名带来的风险面。

## 已知风险

| 风险 | 实测情况 | 缓解 |
|---|---|---|
| 内存不足以跑完整验证 | 7.8 GiB，而 `typecheck:mcp` 要 8 GiB 堆 | runner 仅部署，验证留在托管 runner |
| 磁盘增长 | 清理后可用 39 GiB；安装包仍占约 1.07 GiB | 安装包迁往对象存储；缓存定期回收 |
| 构建与生产同机 | 8 vCPU，负载 `0.07`，余量充足 | 容器化构建 + CPU/内存上限；风险低于最初评估 |
| 热更新绕过代码签名 | 尚未实现 | Ed25519 验签，公钥编译进主进程，签名能力先行 |
| 旧外壳遇上新 API 或新 bundle | 迁移编号已在两条谱系间错位 | `minShellVersion` + 契约后向兼容门禁 + 谱系收敛 |
| 部署身份权限过大 | 当前只有 `root` | 专用部署用户 + 受限 sudo，作为 runner 接入前置 |
| 高频自动发布放大事故 | 尚未实现 | 灰度分桶 + 连续崩溃自动回滚 |
| 单机无冗余 | PostgreSQL 等全部在一台机器 | 超出 v1.2.1 范围，属 v1.1 的 M9 |
