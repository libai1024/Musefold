# v2.5 独立云端部署（2026-09-22）

用户明确要求先提交当前版本，再部署独立 2.5，保留旧版；随后明确拒绝由 `www.zhaozhaoyue.top` 根入口承载单一 App。当前开发快照为 `dedace4`。后续路径适配单独提交，部署必须绑定该提交，不能把旧镜像当作新路由版本。

## 路由

| 用途 | 正式路径 |
| --- | --- |
| 2.5 页面 | `https://zhaozhaoyue.top/Musefold/v25/` |
| 登录/会话 | `/Musefold/v25/api/auth/*` |
| 业务接口 | `/Musefold/v25/api/v1/*` |
| MCP | `/Musefold/v25/mcp` |
| OAuth 发现 | `/.well-known/oauth-authorization-server/Musefold/v25/api/auth` |
| MCP 资源发现 | `/.well-known/oauth-protected-resource/Musefold/v25/mcp` |
| 签名对象 | `/musefold-v25/*`，独立私有 bucket；匿名请求拒绝 |
| 旧版 | `/Musefold/app/`、`/api/musefold/v1/*` 等原路径继续提供 |

`PUBLIC_BASE_URL` 与桌面服务身份均为 `https://zhaozhaoyue.top/Musefold/v25`；Web 构建 `NEXT_PUBLIC_APP_BASE_PATH=/Musefold/v25`。代理保留完整路径，API 自身挂载在此前缀。Cookie 使用路径派生的独立名称并限定 `Path=/Musefold/v25`，登录容量挑战 Cookie 限定至该目录下的 `api/auth`。Next 导航、history、图片、OAuth 回跳及同源请求都须保留目录。CSRF 仍验证 origin，不能将含路径的服务身份当作浏览器 origin。

域名根入口、根 `/login`、根 `/api/auth` 和其他 App 的发现文档不被接管。其他应用可占用各自命名空间；未来版本升级需显式决定是否更换服务身份，不自动重写历史账号或费用身份。`www` 独占入口方案已经撤销，没有切换上线。

## 独立资源与切换

部署目录 `/opt/musefold-v25`，Compose project `musefold-v25-production`。使用独立 PostgreSQL、对象卷、只绑定回环的镜像仓库；四个服务为 API、生成 Worker、方案 Agent Worker、Web。迁移和三个运行角色分别配置私有凭据；运行角色无 DDL，镜像固定 registry digest。私有配置不进入 Git。

顺序：提交源码 → 从指定提交构建镜像并存入本机回环 registry → 创建独立空库和 bucket → 单次迁移 → 审核运行角色授权 → 启动运行服务 → 验证内部服务 → 保存现有 Caddy 配置并验证新增精确路由 → reload → 真实登录与页面验证。旧版容器、数据库和账号网关保持运行，不迁移或删除其数据。

回退：恢复切换前 Caddy 配置并 reload，停止新应用四个运行服务；保留新库、对象与镜像以便恢复。禁止数据库 down、删除卷或覆盖旧部署配置。`/healthz` 仅证明存活，不能替代真实认证、业务读写、队列消费和对象存储验收。

## 上线结果

2026-09-22 已完成公网切换，API/Web 健康，两个 Worker 正常运行。`www` 仅对 `/Musefold/v25` 及其子路径作 308 到主域同路径；`www` 根入口仍为 200、无重定向。新入口可直达工作台，设置页可直接访问。旧 `/Musefold/app/`、`/health/ready`、`/api/status` 均复验 200。

源码与产物：

| 部分 | 来源提交 | 不可变摘要 |
| --- | --- | --- |
| 开发快照 | `dedace4` | 部署前按用户要求提交 |
| API / 方案 Agent | `02d339abb42045c70acbd848aa047bd04cd631c7` | `sha256:c9b127d8db030aec9e5e95256f92b9a41e92ce07c153b4a2ef94bbdcb331aaa6` |
| 生成 Worker | 同上 | `sha256:056cb60c35e7ba32258dff091717f91ed59073257384b3c262687709c10544bc` |
| Web | `165a2f57fa6e377c57d61f168894875ef585ee9f` | `sha256:7c0a7f27da8b86c943ae0e82eac6d2c7c7494536fc96ae88647f4e92fa876d81` |
| 代理路由 | `215f9dd` | 仓库 `infra/v2.5/routes.caddy` |
| macOS arm64 App | `02d339a`，ad-hoc 签名 | `app.asar` SHA-256 `f7be00bc752e59b261e17a136c6f7dcf9f4af231a16b04a42d43789fa57b0ed7` |

API/Worker/共享包/桌面生产输入在 `02d339a` 至 `215f9dd` 间经 Git 精确差异检查不变；Web 修正 Next router 自动添加 basePath 与原生 history 需要显式路径前缀的区别。部署 manifest 使用 `165a2f5` 干净源码身份，各镜像保留自身来源标签；不是把旧 Web 镜像重新命名。镜像存于服务器回环 registry，运行使用 digest。

验收：

- 完整 `pnpm run check` 两轮退出 0，最终 38/38；最终日志 `/tmp/musefold-final-route-check.log`。路径挂载、OAuth、会话生命周期实际 PostgreSQL 专项 32 项通过。Web 宿主专项 6 项通过。
- 正式构建 Web 的 PC/移动路径导航检查通过，覆盖页面刷新和原生 history；首次双前缀故障已修复后复验。macOS 严格 package-smoke 7/7；源码凭据扫描零发现、零错误。
- 独立数据库已执行 31 次迁移，三运行角色无 superuser/createdb/createrole/bypassrls/数据库 CREATE 权限。真实私有对象上传、读取、签名下载、匿名 403、删除通过；生成与方案 Agent 两类 reconcile 队列均实际消费确认。
- 公网 PC（1280×800）和移动（390×844）使用真实账号完成登录、账号身份核对、提示词创建/读取/软删、提示词页面导航及退出，均通过；API 请求未逃逸到根 `/api/`。测试提示词进入回收站，可恢复；未触碰既有提示词。
- 实际 macOS 安装包以隔离测试数据目录、**不设置 `MUSEFOLD_API_URL`** 的方式完成真实登录，服务身份精确等于 `https://zhaozhaoyue.top/Musefold/v25`，退出通过。真实登录首两次因本地旧验收密码与用户提供值不一致被正常拒绝；改用用户提供值后 PC/移动/macOS 全部通过，未修改密码或认证规则。
- 已将 `/Applications/Musefold.app` 替换为上述实测包，签名校验通过，安装目录与 release 的 `app.asar` 摘要一致，并启动新进程。原 App 可从 `/Users/wangwei/.Trash/Musefold-2.5.0-before-namespaced-cloud-20260922.app` 恢复；用户数据目录未删除、未覆盖。登录验收使用隔离数据，不宣称正式用户目录已登录。

服务器运维证据位于 `/opt/musefold-v25/releases/165a2f57fa6e377c57d61f168894875ef585ee9f/`（manifest、plan、artifact-sources），私有回退配置为 `/opt/musefold-v25/private/Caddyfile.before-v25`。路由生效前通过 Caddy 校验，首次候选中导入顺序错误在修改线上配置前已修复；最终 reload 成功。

本次未触发收费生成、未迁移旧版业务库、未推送 Git 或触发旧发布流水线。新增部署与实网登录子项完成，不代表 Windows、正式签名公证、完整远程 MCP 授权流程或全部迁移父验收已完成；完整三形态 E2E 未因本次专项通过而改写为新一轮全绿。
