# Musefold v1.2.1 CI/CD 技术选型与决策

> **状态**：v1.2.1 选型冻结
>
> **日期**：2026-08-20
>
> **目的**：在高频自动发布、跨境网络条件、单机生产部署和 Apple 签名约束之间作出可解释选择

## 0. 冻结结论

| 决策点 | 选择 | 主要理由 |
|---|---|---|
| CI 平台 | GitHub Actions | 仓库已托管在 GitHub，且托管 macOS/Windows runner 是签名打包的刚需 |
| 构建编排 | Turborepo | 原生适配 npm workspaces；affected-only 与远程缓存直接压缩反馈循环 |
| 部署执行位置 | 生产主机自托管 runner | 产物不跨境；无需为 GitHub 开放入站 SSH |
| Web 托管 | 保持 Caddy 同源 | Cookie 会话与 CSRF 依赖同源；境内可达性有保障 |
| 静态发布方式 | symlink 原子切换 | 单次系统调用完成，无半更新态，回滚是常数时间 |
| 服务发布方式 | 健康检查门控滚动重启 | 复杂度与当前规模匹配；蓝绿留作后续升级 |
| 安装包分发 | 对象存储 + CDN | 单台 VPS 无法同时承担静态站、API 与百 MB 级下载 |
| 内容层签名 | Ed25519 | 密钥短、验签快、实现简单；无需引入 X.509 体系 |
| 灰度机制 | manifest 百分比 + 安装 ID 哈希分桶 | 服务端无状态，客户端可自行判定，不需要额外服务 |
| 回滚机制 | 连续两次启动失败自动回退 | 无人值守时仍能自愈 |
| iOS 形态 | Capacitor 包 `apps/web` | 复用现有 SPA 与共享 UI；与桌面共用同一条热更新总线 |

## 1. 约束

选型以仓库与生产环境的当前事实为准：

- 仓库是 TypeScript npm workspace，`workspaces` 为 `apps/*` 与 `packages/*`。
- 桌面端使用 electron-builder，macOS 启用 `hardenedRuntime` 并需要 Developer ID 公证。
- 生产是单台境内主机 `45.207.211.136`，Caddy 终结 HTTPS，Docker Compose 编排，网络 `musefold_default`。
- Web API 使用 Cookie 会话（`mf_session`）与 CSRF 校验，与 Web 同源部署在 `zhaozhaoyue.top`。
- 维护主体是小团队，不具备维护多套基础设施的人力。
- 迭代节奏高，单次改动小而频繁，反馈循环长度是首要体验指标。
- iOS 尚未开始，预计 v3.0 落地，选型必须为其预留而不提前支付成本。

## 2. 决策指标

| 指标 | 权重 | 判断方式 |
|---|---:|---|
| 反馈循环长度 | 30% | 从合并到线上生效的墙钟时间，以及失败反馈的及时性 |
| 安全性 | 25% | 信任链完整度、密钥暴露面、被入侵后的爆炸半径 |
| 可维护性 | 20% | 需要维护的系统数量、故障排查路径、本地可复现程度 |
| 可回滚性 | 15% | 回滚是否自动、耗时、是否需要人在场 |
| 成本 | 10% | CI 分钟数、带宽、额外主机 |

### 2.1 整体方案比较

评分为 1 至 5，表示对当前约束的适合度。

| 方案 | 反馈 | 安全 | 维护 | 回滚 | 成本 | 加权 |
|---|---:|---:|---:|---:|---:|---:|
| 双车道 + 自托管 runner + 签名 bundle 总线 | 5 | 4 | 4 | 5 | 4 | **4.45** |
| 单流水线全量构建，仅加自动部署 | 2 | 4 | 5 | 3 | 3 | **3.35** |
| 全托管 PaaS（Vercel + 托管数据库） | 5 | 4 | 4 | 5 | 2 | **4.15** |
| 引入 Kubernetes + GitOps（Argo CD） | 4 | 4 | 1 | 5 | 2 | **3.25** |

全托管 PaaS 的加权分接近最优方案，但它在两个硬约束上直接失败：Cookie 会话要求 Web 与 API 同源，而 API 因为紧邻 new-api 和 PostgreSQL 无法迁出；境内访问 Vercel/Cloudflare 的可达性也不可控。因此不予采用。

## 3. CI 平台：GitHub Actions

选择 GitHub Actions，不自建 Jenkins/Drone/Woodpecker：

- 仓库已在 `git@github.com:libai1024/Musefold.git`，无需额外集成。
- macOS 与 Windows 托管 runner 是签名打包的刚需，自建意味着自购并维护 Mac 硬件。
- 现有 `.github/workflows/ci.yml` 的四个 job 可直接复用，迁移成本集中在触发条件而非重写。

约束：

- macOS runner 计费倍率高，必须靠 tag 触发把调用频次降到发布级别。
- 自托管 runner 只用于部署 job，不用于跑不受信任的代码。

## 4. 构建编排：Turborepo

选择 Turborepo，不选 Nx，也不维持现状：

- Turborepo 直接消费 npm workspaces 拓扑，不要求改造项目结构。
- affected-only 让文档或单个 app 的改动跳过无关构建，这是压缩反馈循环最直接的手段。
- 远程缓存让 CI 与本地共享构建结果，重复构建变成缓存命中。

不选 Nx 的原因是它的插件体系与代码生成能力对本仓库是净增复杂度；当前需要的只是任务图与缓存。

约束：

- 缓存键必须包含 Node 版本、锁文件与相关配置文件，避免跨环境误命中。
- Electron 打包不纳入缓存，原生产物与签名状态不适合复用。

## 5. 部署执行位置：生产主机自托管 runner

这是本次选型中收益最大也争议最大的一项。

### 备选比较

| 方案 | 跨境传输 | 入站端口 | 部署耗时 | 生产隔离 |
|---|---|---|---|---|
| 自托管 runner 本机部署 | 仅拉源码 | 不需要 | 短 | 差 |
| GitHub Actions → SSH/rsync | 传全部产物 | 需要 22 | 长且易断 | 好 |
| 推 GHCR，主机拉取 | 传镜像两次 | 不需要 | 最长 | 好 |

### 选择理由

跨境链路是整条发布链中最不稳定的一段。自托管 runner 让源码成为唯一过境的数据，镜像在本机构建本机启动。同时它是唯一不需要为 GitHub 开放入站 SSH 的方案。

代价是生产隔离最差：构建与生产服务共享 CPU、内存和磁盘。缓解措施是给 runner 设资源上限，并在预算允许时拆出独立构建机。这一项被记录为 v1.2.1 的首要架构风险。

## 6. Web 托管：保持 Caddy 同源

不迁移到 Vercel、Cloudflare Pages 或独立 CDN 域名：

- Web API 使用 `mf_session` Cookie 加 CSRF nonce。跨源部署会引入 SameSite 与预检问题，等于重做认证层。
- `apps/web/vite.config.ts` 的 `base` 已固定为 `/Musefold/app/`，与 `/api/musefold/v1` 同源是既有设计决策（见 `V11-WEB-ARCHITECTURE.md` 决策 D5）。
- 境内用户访问境外 PaaS 的可达性不可控，而 API 本身无法迁出境内主机。

因此 Web 继续由 Caddy 的 `file_server` 提供，v1.2.1 只把「手工拷贝」换成「symlink 原子切换」。

## 7. 安装包分发：对象存储 + CDN

`release/` 下的 DMG 与 NSIS 单个在 100-200 MB 量级。继续从生产主机直接分发会让下载带宽与 API、静态站争抢同一条链路。

选择对象存储 + CDN 承载 `downloads/` 与 `bundles/`，`manifest.json` 与 `latest*.yml` 仍留在主域名下——清单文件小、需要强一致、且更新频繁，不适合走 CDN 缓存。

`services/musefold-downloads` 的下载计数与重定向逻辑不变，只是重定向目标从本机路径改为 CDN 地址，`catalog.json` 相应更新。

## 8. 内容层签名：Ed25519

热更新绕过了 Apple 公证与 Windows Authenticode，必须自建信任链。

选择 Ed25519 而非 X.509 证书链或 RSA：

- 公钥 32 字节，可直接以常量形式编译进主进程，无需证书解析与吊销检查。
- Node 内置 `crypto` 原生支持 `ed25519`，无新增依赖。
- 签名验证在毫秒级，不影响启动路径。

不采用「仅依赖 HTTPS」：HTTPS 只保证传输通道，不保证内容来源。服务器一旦失守，攻击者可向每个桌面安装投递任意 JavaScript，而渲染进程通过 preload 桥可触达文件系统、SQLite 与密钥链。这是本方案中爆炸半径最大的风险点，签名是不可省略的。

密钥管理约束：

- 私钥只存在于 GitHub Actions secret，不落入仓库、不进入 runner 工作目录、不写日志。
- 目标形态是通过 OIDC 换取短期签名凭据，而非长期私钥常驻 CI 变量。
- 公钥轮换需要外壳层发版，因此公钥应同时内置一主一备两把。

## 9. 灰度与回滚

### 灰度

在 `manifest.json` 中声明 `rollout.percentage`，客户端用安装 ID 的哈希对 100 取模自行判定是否命中。服务端无状态，不需要额外服务，也不需要上报安装列表。

`stable` 通道的默认节奏为 5% → 20% → 100%，每档之间观察窗口不少于一个自然日。

### 回滚

- **内容层**：客户端记录启动信标。同一 bundle 连续两次未能完成启动即自动回退到上一个已知可用版本，并停止再次尝试该版本。服务端侧的回滚是把 manifest 指回旧 `bundleVersion`。
- **Web**：symlink 指回上一个 release 目录。
- **服务层**：Compose 回退到上一个镜像标签。数据库迁移因为强制 expand/contract，回退代码不需要回退 schema。

不采用「全量直推」：高频自动发布与无灰度叠加会放大事故影响面，而这套流程的目的恰恰是提高发布频率。

## 10. iOS 形态：Capacitor

v1.2.1 不实际接入 iOS，但形态选择会决定热更新协议的设计，因此在此冻结。

| 方案 | UI 复用 | OTA 能力 | 流水线数量 | 审核风险 |
|---|---|---|---|---|
| Capacitor 包 `apps/web` | 完全复用 | 与桌面共用同一条总线 | 1 | 4.2 最低功能性 |
| React Native + Expo | 需重写视图层 | EAS Update，能力更强 | 2 | 低 |

选择 Capacitor：

- `apps/web` 是纯客户端 Vite SPA，`packages/product-ui` 已承载 Desktop/Web 共享视图，Capacitor 可直接复用这一整层。
- OTA 消费的就是 web 资产，与桌面 renderer 的 bundle 属于同一种产物形态，可共用签名、灰度和回滚机制，不必新建流水线。
- App Store 条款 2.5.2 对 WebKit 解释执行的 JavaScript 有豁免，OTA 更新 web 资产是合规的。

已知风险与前置条件：

- 真正的风险不是 2.5.2 而是 4.2「最低功能性」——纯套壳应用容易被拒。需要具备实质原生集成，例如分享面板、存入相册、推送通知、Shortcuts 或小组件，至少落地两三项。
- Capacitor 中页面来源是 `capacitor://`，对 API 而言属于跨源，Cookie 会话不可用。必须切换到 bearer token。`@musefold/new-api-client` 已有 device-token 概念，可作为起点。

若 v3.0 阶段判定 webview 的交互质量不足以支撑产品目标，可改选 React Native + Expo；届时本文档第 10 节需要重写，但第 8、9 节的签名与灰度设计仍然适用。

## 11. 明确不采用

| 技术 | 不采用原因 |
|---|---|
| Kubernetes | 单机单实例部署，编排层的收益为负 |
| Argo CD / Flux 等 GitOps | 依赖 Kubernetes；Compose 场景下的收益不足以抵消复杂度 |
| Vercel / Cloudflare Pages | 破坏同源 Cookie 会话；境内可达性不可控 |
| Jenkins / Drone 自建 CI | 需自购并维护 macOS 构建机 |
| Nx | 插件与代码生成能力对本仓库是净增复杂度 |
| Redis / 独立队列服务做发布编排 | 发布链路无需持久队列，Compose 与 workflow 已足够 |
| PR 预览环境 | 单机资源有限，且当前团队规模下收益有限；不排除后续引入 |
| 蓝绿 / 金丝雀基础设施 | 先用健康门控与灰度百分比覆盖；出现可测量停机影响时再升级 |

## 12. 相关文档

- [CI/CD 与持续交付架构](./V121-CICD-ARCHITECTURE.md)
- [热更新协议](./V121-HOT-UPDATE-PROTOCOL.md)
- [交付计划](./V121-DELIVERY-PLAN.md)
- [v1.1 技术选型 ADR](../v1.1/V11-TECHNOLOGY-DECISIONS.md)
