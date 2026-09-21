# packages/ — 共享包开发约束

workspace 包,依赖方向由 `tooling/dependency-cruiser.cjs` 机器强制(`pnpm run check:boundaries`,0 豁免)。本文件是人话版:每个包是什么、放什么、不放什么。

## 依赖格架(谁能 import 谁)

```text
═══ v2.5 四端复用面 ═══
contracts        叶子,仅依赖 zod —— 全仓唯一实体契约(z.infer 推导一切类型)
platform         contracts —— MusefoldGateway 接口 + query keys(接口叶子,不依赖实现)
ui               零 workspace 依赖 —— shadcn/ui 原语 + tokens + icons 唯一入口
features         contracts + platform + ui + TanStack Query —— 页面级产品模块,四端同一份;
                 禁 electron/next/宿主实现/Node 内置
api-client       contracts + platform —— Web 宿主的 gateway HTTP 实现
db               contracts + Drizzle PG schema/共享账号执行事务校验,只允许 apps/api 与 apps/worker 消费
desktop-db       桌面 SQLite Drizzle 受管层,生产代码零 workspace 依赖

═══ 桌面本地生态(存量,继续演进)═══
core             contracts + desktop-contracts + better-sqlite3;禁 electron —— 生图/历史/库服务
desktop-contracts contracts + domain + type-only update-protocol —— 桌面冻结面契约(pet/skill-runtime/automation)
domain           contracts —— 纯业务规则(prompt 编译、AppResult);禁 IO / fs / electron
update-protocol  纯协议(manifest schema + Ed25519 + rollout),被桌面与发布工具双端引用
automation-server / client / cli / mcp   Agent 对外能力面(Automation API / CLI / MCP)
new-api-client   apps/api 调 New API 网关的传输层;仅依赖 contracts
server-crypto    服务端加密;零 workspace 依赖
managed-fs       Node-API目录句柄IO叶子，零workspace依赖；仅Desktop主进程/core与持有本机owner.lock的CLI serve宿主消费，禁渲染层/云；native产物由build生成并随桌面资源打包
scheme-package   Node归档编解码;仅依赖contracts与ZIP库。API/worker和桌面主进程可用,禁渲染层/domain消费;不含账号/数据库/网络调用
```

改包依赖前先问:「这个方向在格架上成立吗?」格架不成立的需求,99% 是内容放错了包。

## contracts — 唯一实体契约(最重要的一节)

1. **单一事实**:实体 = zod schema;消费方类型一律 `z.infer` 推导。禁止手写平行 interface。
2. **schema 即文档**:字段注释写业务语义(成本单位、快照冻结时机、nullable 原因)。
3. **改动流程**(加字段为例):contracts 定 schema + schema 测试 → 三类消费方同步:apps/api(路由校验 + 出参)、api-client、桌面 ipc-v25 域方法 → features 消费新字段。
4. **不进 contracts**:桌面本地概念(桌宠、本地文件路径)留在 `desktop-contracts`;纯 UI 状态不进任何契约。

## features / ui — 四端复用的关键分界

- **`ui`**:设计 token 单源 + shadcn 原语 + icons。零 workspace 依赖;不含产品语义。
- **`features`**:屏幕组件 + query hooks + 域内状态。数据只经 `MusefoldGateway`(platform),UI 只用 ui 原语与 Tailwind token;**出现任何 `import 'electron'` / `import 'next'` / 宿主路径即违规**(depcruise 拦截)。
- 宿主(apps/desktop `src/v25`、apps/web-next)只做路由挂载、壳、gateway 注入,不写业务 UI。
- 屏幕布局/状态矩阵/组件复用矩阵以 `docs/v2.5/V25-UI-SPEC.md` 为准。

## 测试要求

每个包的就地 `__tests__/` 是交付门禁的一部分;契约包必须有 schema 测试;features 屏组件测试用 fake gateway 注入;改动后全量兜底 `pnpm run check`。
