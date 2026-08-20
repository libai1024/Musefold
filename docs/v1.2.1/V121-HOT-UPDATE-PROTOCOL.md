# Musefold v1.2.1 内容层热更新协议

> **状态**：v1.2.1 协议基线
>
> **日期**：2026-08-20
>
> **范围**：Web、桌面 renderer 与 iOS webview 资产的远程替换协议
>
> **前置**：签名与回滚能力必须先于热更新开关上线

## 0. 适用范围与合规边界

本协议只覆盖**可由浏览器引擎解释执行的资产**：HTML、JavaScript、CSS、静态资源。它不覆盖任何原生二进制、Node 原生模块或 Electron 主进程代码，那些属于外壳层，只能通过 electron-updater 或应用商店分发。

边界由外部合规条件决定：

- macOS 启用 `hardenedRuntime` 且需 Developer ID 公证。签名后的 `.app` 内部文件一旦改动签名即失效，因此热更新产物**必须落在 `.app` 之外**，即 `app.getPath('userData')`。
- App Store 审核条款 2.5.2 禁止下载并执行代码，但对由 WebKit 解释执行的 JavaScript 有豁免。因此 iOS 侧只能替换 webview 资产，不能替换原生部分。

主进程代码的任何变更都不属于本协议范围。

## 1. 产物形态

内容层 bundle 是一个压缩归档，解开后即为一个可直接由 webview 加载的静态站点根目录。

| Surface | 构建产物 | 归档内容根 | 入口 |
|---|---|---|---|
| `electron-renderer` | `out/renderer` | 该目录全部内容 | `index.html`、`pet.html` |
| `web` | `apps/web/dist` | 该目录全部内容 | `index.html` |
| `capacitor-web` | `apps/web/dist`（iOS 变体） | 该目录全部内容 | `index.html` |

三个 surface 由同一条流水线产出、共用同一套签名与灰度机制，但**不是同一个文件**：桌面 renderer 通过 preload 桥与主进程通信，Web 与 iOS 通过 HTTP 访问 `/api/musefold/v1`。它们共享 `@musefold/product-ui` 与 `@musefold/contracts`，来自同一张构建图的不同入口。

表中构建产物路径以当前目录布局为准；v1.2.2 目录重构后 `out/renderer` 变为 `apps/desktop/out/renderer`，协议本身不变。流水线与打包脚本应从构建配置读取路径。

桌面 renderer 存在 `index.html` 与 `pet.html` 两个入口（见 `electron/main/window.ts` 与 `electron/main/pet/window.ts`），归档必须同时包含，切换时两者必须原子地一起切换，不允许出现主窗口与宠物窗口来自不同 bundle 的状态。

## 2. 清单格式

每个通道一份 `manifest.json`，位于 `https://zhaozhaoyue.top/Musefold/updates/<channel>/manifest.json`。

`updates/stable/` 已于 2026-08-20 创建。`latest.yml` 与 `latest-mac.yml` 现返回 200，清单版本为完整的 `0.3.2`，安装包仍放在 `downloads/0.3.2/`（yml 内使用绝对 URL，避免把约 450 MiB 复制进 `updates/`）。`0.5.0-dev` 因缺 macOS `.zip` 且客户端 `allowPrerelease = false`，未写入当前通道。`manifest.json` 仍待 M4 引入。

```json
{
  "schemaVersion": 1,
  "channel": "dev",
  "bundleVersion": "1.2.1-dev.412",
  "gitSha": "0ce9aac",
  "createdAt": "2026-08-20T00:00:00Z",
  "minShellVersion": "1.2.1",
  "maxShellVersion": null,
  "surfaces": {
    "electron-renderer": {
      "url": "https://<cdn>/Musefold/bundles/dev/1.2.1-dev.412/renderer.tar.zst",
      "sha256": "<hex>",
      "bytes": 2431044
    },
    "capacitor-web": {
      "url": "https://<cdn>/Musefold/bundles/dev/1.2.1-dev.412/capacitor.tar.zst",
      "sha256": "<hex>",
      "bytes": 2380112
    }
  },
  "rollout": { "percentage": 20 },
  "signature": "<base64 ed25519 over canonical body>"
}
```

字段约束：

| 字段 | 约束 |
|---|---|
| `schemaVersion` | 客户端遇到不认识的版本必须拒绝并保持当前 bundle |
| `bundleVersion` | 全局唯一且单调递增，包含构建号，不复用 |
| `minShellVersion` | 语义化版本；外壳低于该版本必须拒绝应用 |
| `maxShellVersion` | 可为 `null`；用于外壳发生破坏性变更时封顶旧 bundle |
| `surfaces` | 客户端只读取自己对应的 surface，未知 surface 忽略 |
| `sha256` | 解压前对归档文件本身计算 |
| `rollout.percentage` | 0-100 整数 |
| `signature` | 对去掉 `signature` 字段后的规范化 JSON 计算 |

`web` surface 不出现在 manifest 中。Web 由服务端 symlink 直接切换，客户端无需协商。客户端把 `web` 与任何未知 surface id 同等对待——直接忽略，不因此让整份文档失败。

**演进规则（must-understand）**：顶层字段、`rollout` 与 surface artifact 都容忍未知键（剥离而非报错）。规范化签名字节取自原始 JSON 对象，未知字段同样被签名覆盖，攻击者无法增删任何字段而不破坏验签，因此容忍未知键不损失安全性，只换来演进空间。据此：**新增可选字段保持 `schemaVersion` 为 1；任何老客户端必须理解才能安全应用的字段，必须 bump `schemaVersion`**。反之若顶层用严格模式，加一个可选字段就会让所有老外壳整份拒绝该通道的清单，等于对老外壳断供内容层更新。

`sha256` 与 `gitSha` 允许大写输入，但客户端解析后统一按小写比较，避免与本地计算出的小写摘要错配。归一只作用于解析结果，不影响签名字节。

## 3. 签名与信任链

### 3.1 为什么必须签名

热更新绕过了 Apple 公证与 Windows Authenticode。桌面渲染进程通过 preload 桥暴露的 `window.api` 可触达文件系统、SQLite 与密钥链。若不验签，攻击者只要控制分发服务器或 CDN，即可向每一个桌面安装投递任意 JavaScript 并获得上述全部能力。这是整套方案中爆炸半径最大的风险点。

### 3.2 验证流程

客户端在应用任何下载来的 bundle 之前，按顺序执行且任一失败即中止：

1. 用内置公钥验证 `manifest.json` 的 Ed25519 签名。
2. 校验 `schemaVersion` 受支持。
3. **校验 `channel` 等于本安装实际拉取的通道。**
4. 校验 `minShellVersion` / `maxShellVersion` 与当前外壳版本兼容。
5. 校验 `bundleVersion` 高于当前已应用版本。
6. 下载归档，校验 SHA-256 与 manifest 声明一致。
7. 解压到临时目录，校验解压结果不包含符号链接与路径穿越条目。
8. 原子改名到目标目录。

第 3 步不可省略。三个通道共用同一把签名私钥，因此 `dev` 通道的 manifest 是**合法签名**的：一旦攻击者控制分发服务器，或运维误把 dev 清单放到 `stable/manifest.json`，稳定版用户就会拿到 dev bundle，而验签、`schemaVersion`、外壳版本校验全部通过。签名元数据必须与它被消费的上下文绑定，**通道绑定是防跨通道投递的唯一防线**。

第 1 步先于第 2 步是有意的：先验签，再解析业务字段，任何未经验签的字段都不参与判断。

### 3.3 密钥管理

- 公钥以常量形式编译进主进程，同时内置一主一备两把，便于轮换。
- 私钥只存在于 GitHub Actions secret，不落入仓库、不进入 runner 工作目录、不写日志。
- 目标形态是通过 OIDC 换取短期签名凭据，而非长期私钥常驻 CI 变量。
- 公钥轮换需要外壳层发版，因此轮换周期与外壳发布节奏绑定。

### 3.4 解压安全

归档由自己的 CI 产出，但仍按不可信输入处理：拒绝绝对路径条目、拒绝 `..` 路径穿越、拒绝符号链接、限制解压后总大小与文件数上限。

## 4. 版本兼容

内容层的发布频率远高于外壳层，用户机器上的外壳可能落后数月。兼容性由两侧共同保证：

**客户端侧**：`minShellVersion` 是硬门槛。一个使用了新 IPC 通道的 renderer 落到旧外壳上会白屏，这个字段是唯一防线。CI 在构建 renderer bundle 时必须能自动推导该值——依据是本次构建实际引用的 IPC 通道集合与 `shared/types/ipc.ts` 中各通道的引入版本（v1.2.2 重构后该文件迁至 `packages/desktop-contracts`，推导脚本应通过包名而非文件路径解析）。

**服务端侧**：API 必须对最近 K 个已发布客户端版本保持后向兼容，K 初始取 3。CI 用这些版本的 `@musefold/contracts` schema 校验新 API 响应。数据库迁移强制 expand/contract，禁止在同一次部署中同时停止写入某列并删除它。

## 5. 灰度与回滚

### 5.1 灰度分桶

客户端用安装 ID 的稳定哈希对 100 取模，小于 `rollout.percentage` 则命中。服务端无状态，不需要上报安装列表，也不需要额外服务。

同一安装在同一 `bundleVersion` 上的判定结果必须稳定，否则会出现反复升降级。哈希输入为 `installId + bundleVersion`。

`stable` 通道默认节奏 5% → 20% → 100%，每档观察窗口不少于一个自然日。`dev` 通道直接 100%。

### 5.2 启动信标与自动回滚

客户端在应用新 bundle 后记录一次启动尝试。渲染进程成功完成首帧并建立 IPC 连接后，标记该 bundle 为「已知可用」。

同一 bundle 连续两次未能到达「已知可用」即判定失败：回退到上一个已知可用的 bundle，将该 `bundleVersion` 记入拒绝列表，不再重复尝试，并把失败状态通过现有 updater IPC 通道暴露到设置页。

若不存在可回退的历史 bundle，则回退到随包内置的 `out/renderer`。内置版本永远保留，是最终兜底。

### 5.3 服务端回滚

把目标通道的 `manifest.json` 重写为上一个 `bundleVersion` 即可。产物本身不删除，回滚是常数时间操作，不需要重新构建。

## 6. 各端的应用时机

| Surface | 检查时机 | 下载 | 生效时机 |
|---|---|---|---|
| Web | 不适用 | 不适用 | 服务端 symlink 切换后，用户下次加载页面即生效 |
| 桌面 renderer | 启动后延迟检查 + 定期检查 | 后台静默 | 下次启动，或用户在设置中主动重载窗口 |
| iOS webview | 冷启动时检查 | 后台静默 | 下次冷启动 |

桌面端不做「热替换正在运行的窗口」。运行中替换渲染层会导致状态丢失和难以复现的中间态，收益不足以抵消风险。用户可在设置中主动触发重载，或等待下次启动。

现有 electron-updater 的行为不变：仍然是自动检查、用户手动下载、用户手动重启安装（见 `docs/v0.5/V05-UPDATER.md`）。内容层更新是一条独立通道，两者互不干扰。

## 7. 桌面端改造点

以下是实现本协议需要触及的现有代码位置。

### 7.1 渲染层根目录解析

`electron/main/window.ts` 当前为：

```ts
win.loadFile(join(appRoot, 'out/renderer/index.html'), {
  search: e2e ? 'musefold_e2e=1' : undefined,
});
```

`electron/main/pet/window.ts` 同理加载 `out/renderer/pet.html`。

改造方式是引入一个活跃 bundle 解析器，按优先级返回渲染层根目录：已验签且已知可用的最新 bundle → 上一个已知可用 bundle → 随包内置的 `out/renderer`。开发模式下 `ELECTRON_RENDERER_URL` 的分支保持不变。

### 7.2 使用固定自定义协议而非 file://

这一点容易被忽略但会造成用户数据丢失。

渲染层的 `localStorage`、`IndexedDB` 与 Cache Storage 都按 web origin 隔离。若继续用 `loadFile` 从不同的 userData 子目录加载，每次 bundle 切换都可能改变存储分区，导致本地状态被清空。

因此应注册一个固定的特权自定义协议（例如 `app://`），由主进程把请求映射到当前活跃 bundle 目录。origin 恒定为 `app://musefold`，与 bundle 版本无关，本地状态因此在热更新中保持连续。

仓库已有同类实现可直接参照：`electron/main/media-protocol.ts` 使用 `protocol.registerSchemesAsPrivileged` 加 `protocol.handle` 注册了 `media` 协议，权限声明包含 `standard`、`secure` 与 `supportFetchAPI`。新协议沿用同一模式。注意 `registerSchemesAsPrivileged` 在 Electron 中只能调用一次，两个协议必须在同一次声明里完成。

**一次性 origin 变更的偏好迁移**：本节论证的是 bundle 之间的连续性，但切换本身会把 origin 从 `file://` 变成 `app://musefold`，老安装写在 `file://` 分区里的偏好会一次性失效——其中 `musefold:onboarded` 丢失会让每个老用户重新走新手引导。因此固定协议的落地必须与一次性偏好迁移同批发布，方案见交付计划任务卡 `V121-HOT-13`。渲染层不使用 IndexedDB（已全仓核实），迁移面仅限 `localStorage`。

### 7.3 CSP

`electron/main/window.ts` 的 `applyWebSecurity` 通过 `buildContentSecurityPolicy(devUrl)` 下发 CSP。切换到自定义协议后需要相应放行新的 origin，同时保持生产渲染层不出网的既有约束——内容层 bundle 的下载由主进程负责，渲染进程本身不应发起对 CDN 的请求。

### 7.4 更新源通道化

`electron/update/updater-service.ts` 当前为：

```ts
export const UPDATE_FEED_URL = 'https://zhaozhaoyue.top/Musefold/updates/stable/';
```

需改为按通道拼接，通道值来自设置项，可被 `MUSEFOLD_UPDATE_CHANNEL` 覆盖，默认 `stable`。`electron-builder.yml` 的 `publish.url` 同步调整。默认值保持不变，确保现有安装行为不受影响。

### 7.5 IPC 与设置页

内容层更新状态复用现有 updater IPC 的窄接口约定：只暴露当前 bundle 版本、目标版本、下载进度和脱敏错误文本，不暴露本地路径、签名细节或内部对象。设置页在现有「应用更新」分区下增加内容层版本显示与通道选择。

### 7.6 E2E 与打包

- `tests/e2e` 需要覆盖三条路径：验签失败拒绝应用、`minShellVersion` 不满足拒绝应用、连续两次启动失败自动回退。
- `electron-builder.yml` 的 `files` 与 `extraResources` 不变；内置 `out/renderer` 继续随包分发，作为兜底。
- 打包冒烟测试需新增一项：确认全新安装在没有网络的情况下仍能从内置 bundle 正常启动。

## 8. 威胁模型

| 威胁 | 缓解 |
|---|---|
| CDN 或分发服务器被入侵，投递恶意 bundle | Ed25519 验签，公钥编译进二进制 |
| 中间人替换归档内容 | HTTPS + SHA-256 + 签名三重校验 |
| 回滚攻击，强制降级到有漏洞的旧 bundle | `bundleVersion` 必须严格递增；拒绝列表持久化 |
| 归档解压路径穿越 | 拒绝绝对路径、`..` 与符号链接，限制大小与文件数 |
| CI 私钥泄漏 | 短期 OIDC 凭据；内置备用公钥支持轮换 |
| 新 bundle 与旧外壳不兼容导致白屏 | `minShellVersion` + 启动信标自动回退 |
| 恶意构造 manifest 触发解析漏洞 | 先验签再解析业务字段；`schemaVersion` 未知即拒绝 |

## 9. 分发容量

内容层 bundle 的体积远小于安装包——`apps/web/dist` 与 `out/renderer` 都在数 MiB 量级，压缩后更小。真正的容量压力来自安装包：生产主机 `/opt/musefold/site/Musefold/downloads/` 已占用约 1.07 GiB。2026-08-20 清理后全盘可用 39 GiB，但安装包仍会随发版线性增长。

因此分发策略按体积分开：

| 内容 | 位置 | 理由 |
|---|---|---|
| `manifest.json`、`latest*.yml` | 主域名 `zhaozhaoyue.top` | 体积小、需强一致、更新频繁，不适合 CDN 缓存 |
| bundle 归档 | 对象存储 + CDN | 每次合并都新增一份，需要保留历史用于回滚 |
| 安装包 | 对象存储 + CDN | 单个 100-200 MiB，不能继续占用主机磁盘与带宽 |

bundle 的保留策略：每个通道至少保留最近 5 个 `bundleVersion`，确保任意时刻都能回退到多个已知可用版本。

## 10. 上线顺序约束

签名、版本下限校验与自动回滚必须先于热更新开关上线。在这三项完成之前：

- 可以先上 Web 自动部署，该侧不存在本协议的风险面。
- 桌面端可以先只做通道化改造，不启用内容层下载。

另有一项前置：桌面 SQLite 迁移谱系当前在 Musefold 与 PromptForge 两条线之间存在编号错位（`0016` 之后整体顺延一位）。热更新只替换渲染层、不触碰迁移，但如果外壳谱系本身未收敛，`minShellVersion` 的语义就没有稳定基准。谱系收敛见交付计划任务卡 `V121-ENV-02`。

## 11. 相关文档

- [CI/CD 与持续交付架构](./V121-CICD-ARCHITECTURE.md)
- [技术选型与决策](./V121-TECHNOLOGY-DECISIONS.md)
- [交付计划](./V121-DELIVERY-PLAN.md)
- [v0.5 在线更新](../v0.5/V05-UPDATER.md)
- [桌面 IPC 契约](../07-ipc-contracts.md)
