# packages/ — 共享包开发约束

13 个 workspace 包,依赖方向全部由 `tooling/dependency-cruiser.cjs` 机器强制(`npm run check:boundaries`,当前 0 豁免)。本文件是人话版:每个包是什么、放什么、不放什么。深度规范在 `docs/frontend/DEVELOPMENT-GUIDE.md`。

## 依赖格架(谁能 import 谁)

```text
contracts          叶子,仅依赖 zod —— 全仓唯一实体规范形状
  ↑
domain             contracts;禁 desktop-contracts / electron / node:fs / window.api
  ↑
product-ui         ui + contracts + domain + @tanstack/react-query;禁一切平台 API
  ↑
apps/desktop 渲染层 / apps/web(宿主)

desktop-contracts  zod + domain + contracts(+ type-only update-protocol);不向上依赖任何宿主
core               contracts + desktop-contracts + better-sqlite3;禁 electron —— 仅主进程使用
ui                 零 workspace 依赖(叶子):token + 原语 + icons 唯一入口
cloud-client       仅 contracts
update-protocol    纯函数,禁 electron / 渲染层
server-crypto / new-api-client / client / automation-server / mcp / cli   各自独立边界,见 depcruise 对应规则
```

改包依赖前先问:「这个依赖方向在格架上成立吗?」格架不成立的需求,99% 是内容放错了包。

## contracts — 共同模型约定(最重要的一节)

**contracts 是唯一暴露给 UI 与客户端的实体形状,也是 web-api 出入参的校验源。**规则:

1. **单一事实**:实体 = zod schema;消费方类型一律 `z.infer` 推导。禁止手写平行 interface,禁止在 contracts 之外定义「和云语义相同但形状不同」的类型。
2. **schema 即文档**:字段注释写业务语义(成本单位、快照冻结时机、nullable 原因),与桌面 mapper 的有损字段注释一一配对。
3. **改动流程**(以给实体加字段为例):
   - contracts 定 schema → 更新/新增 schema 测试(默认值、拒绝非法形状);
   - 三类消费方同步:web-api(路由校验 + 出参)、cloud-client、桌面(`desktop-contracts` 行模型 + `runtime/mappers/` 逐字段映射);
   - 跑 `npm run openapi:check` 确认 OpenAPI 与实现同步;
   - mapper 测试逐字段断言(行↔文档),有损转换在 mapper 里逐条声明。
4. **不进 contracts 的东西**:桌面本地概念(桌宠、本地文件路径)留在 `desktop-contracts`;纯 UI 状态不进任何契约。

**行模型是存储细节**:`desktop-contracts/models.ts` 的 SQLite 行类型只允许出现在 core、主进程 `ipc/` 传输签名、`runtime/mappers/`;渲染层与 product-ui 引用即违规(`renderer-row-models-banned`)。桌面扩展用组合(`GenerationJob & { localImagePath? }`),不做平行模型。

## domain — 双端共享的业务规则

只放纯逻辑:字段校验、格式化、过滤推导、六端口 Gateway 接口(prompt/workbench/generation/history/account + PlatformServices)。禁 IO、禁平台 API、禁 electron。跨端共享的校验函数放这里,不放组件里。

## ui / product-ui — 多端组件复用

组件落位判定与上提流程的完整规范在 DEVELOPMENT-GUIDE §5.1 与 §5.1b,速查:

- **`ui`**:设计 token 单源(`src/tokens.css`)+ 原子控件 + icons 唯一入口。零 workspace 依赖;色值/字号不落在组件里。
- **`product-ui`**:双端同像素的共享产品组件 + page-controllers + 共享 query keys(`musefoldQueryKeys`)。只依赖 ui/contracts/domain/react-query;禁 `window.api` / `cloud-client` / `electron` / `desktop-contracts`。
- **宿主 feature**:依赖桌面语义(IPC、本地文件、desktop-contracts)或纯单端 UI 的组件留在宿主。
- 上提时机:出现第二个宿主消费者才上提,上提前过 `tests/repo/product-ui-dual-host-reuse.test.ts` 与共享视觉门禁(`npm run test:visual:shared`)。
- page-controller 一律显式 deps 注入(`{ ports…, platform }`),不引入 Context 隐式注入;queryFn 只调 gateway 端口。

## core — 桌面本地核

SQLite(better-sqlite3,WAL)+ repositories + services(生图/历史/库/Provider/方案)+ 云同步。仅主进程使用,禁 import electron(保持可单测)。迁移流程见 `apps/desktop/AGENTS.md`。

## 其余包速查

- **update-protocol**:内容热更协议(manifest schema + Ed25519 签名 + rollout)。保持纯函数,它被桌面与发布工具双端引用。
- **automation-server / mcp / cli**:Agent 对外能力面。任何接口/参数/行为改动 → 必然触发 `Skill-Impact: updated` 提交声明,先读 `CONTRIBUTING.md`。
- **server-crypto**:服务端加密,禁依赖桌面/UI 包。

## 测试要求

每个包的就地 `__tests__/` 是交付门禁的一部分;契约包必须有 schema 测试;mapper 测试逐字段;改动后按根 AGENTS.md 命令矩阵选跑,全量兜底 `npm run check`。
