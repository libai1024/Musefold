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

当前状态：路由适配与专项测试进行中，尚未切换公网路由；最终提交、镜像摘要和实网结果待完成后追加。
