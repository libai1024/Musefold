# Musefold v1.2.2 技术选型与决策

> **状态**：v1.2.2 选型冻结
>
> **日期**：2026-08-20
>
> **目的**：对双端架构涉及的技术栈做一次完整重估，记录保留、变更与拒绝的理由，避免后续重复讨论

本轮是应「按企业级双端项目通用做法重新设计」的要求做的全面重估：桌面壳、后端、前端、包管理器、构建编排、质量工具全部重新评审，而不是默认沿用。结论是**运行时技术栈全部保留，工程化层全部补课**——瓶颈在结构而不在选型。

## 0. 冻结结论

| 决策点 | 结论 | 类型 |
|---|---|---|
| D1 桌面壳 | 保留 Electron；主进程瘦身为 packages 适配层 | 重估后保留 |
| D2 后端 | 保留 Fastify 5 + PostgreSQL 16 + Graphile Worker | 重估后保留 |
| D3 前端 | 保留 Vite + React 18 + product-ui 共享模式 | 重估后保留 |
| D4 包管理器 | v1.2.x 冻结 npm workspaces；pnpm 列入复审触发器 | 重估后保留 |
| D5 构建编排 | Turborepo（继承 v1.2.1）+ TypeScript project references | 继承 + 新增 |
| D6 质量与边界 | ESLint + Prettier（v1.2.1 CI-08）+ dependency-cruiser 分层规则 | 新增 |
| D7 领域模型 | 双模型 mapper 收口，不做实体统一；新功能以 contracts 为准 | 新增 |
| D8 依赖与版本 | 补全 package.json 真实依赖；zod 统一 v4；包版本统一 `0.0.0-internal` | 新增 |

## 1. 约束

- 维护主体是小团队，任何「同时动摇多个面」的变更都要有明确的止损点。
- v1.1 已上线并有真实用户；v1.2.1 交付的发布链路语义不得被本版本破坏。
- 桌面主进程约 1.9 万行 Node 代码，深度依赖 `better-sqlite3`、Electron `safeStorage`、Node 生态的 CLI/MCP/automation-server。
- `apps/web-api` 约 1 万行（含迁移）已按 v1.1 技术决策实现并在生产运行。
- 双端一致体验的载体是 `packages/product-ui`（约 1.1 万行）与像素级视觉门禁,任何选型不得破坏这一层。

## 2. D1 桌面壳：保留 Electron

**候选**：Electron（现状）、Tauri 2、Tauri 2 + Node sidecar。

| 维度 | Electron | Tauri 2（Rust 重写） | Tauri 2 + Node sidecar |
|---|---|---|---|
| 迁移成本 | 0 | 主进程 + core 约 2.7 万行 Node 重写为 Rust，业界基准 10–16 周 | 保留 Node 逻辑，但需重建 IPC 桥、打包 Node 运行时 |
| better-sqlite3 / safeStorage | 原生 | 需 rusqlite + Stronghold 重写，SQLite 迁移谱系风险 | sidecar 内保留 |
| 渲染一致性 | 双端同 Chromium，视觉门禁直接有效 | 各 OS webview 不同，像素门禁失效 | 同左 |
| 体积/内存收益 | — | 显著 | 被捆绑 Node 运行时抵消大半 |
| 团队 Rust 能力 | 不需要 | 必需 | 部分需要 |

**结论**：保留 Electron。像素级视觉门禁是双端一致体验的执行机制，Tauri 的系统 webview 差异会直接击穿它；迁移成本与本版本「降低维护成本」的目标相反。同时，本版本把主进程瘦身为 `packages/core` + `desktop-contracts` 的薄适配层后，未来若 Electron 出现不可接受的问题，Tauri + Node sidecar 的迁移量会从「半重写」降到「壳层替换」。复审触发器见第 10 节。

## 3. D2 后端：保留 Fastify 栈

v1.1 技术决策（加权 4.55 的评分记录见 [V11-TECHNOLOGY-DECISIONS](../v1.1/V11-TECHNOLOGY-DECISIONS.md)）在本轮复核中依然成立，且新增了两个事实支撑：

1. 全栈已真实上线（v1.2.1 实地盘点确认 healthy），重写没有对价。
2. API 同时服务浏览器、桌面云同步与 Cloud MCP 三类消费者，OpenAPI + Zod 契约是三者的公约数；tRPC 会把契约绑死在 TypeScript RPC 上，排除 MCP 与未来第三方客户端。

NestJS（样板重）、Hono（生态薄）、Next.js 全栈（无 SSR/SEO 需求且 API 不能绑前端框架）维持 v1.1 的拒绝结论。

## 4. D3 前端：保留 Vite + React 18

- React 19 / React Compiler：无当前痛点对应的收益，且 v1.1 明确「不升级 React major」以保护 product-ui 稳定性；列入复审触发器（当依赖生态强制或出现明确性能痛点时）。
- Next.js / Remix：同 D2 的拒绝理由；`apps/web` 还是 v3.0 Capacitor iOS 的复用基础，纯 SPA 是既定形态。
- 状态管理：维持 v1.1 结论——桌面 Zustand、Web 走 gateway + query cache，共享层只有受控组件与 reducer/controller。本版本不强行统一两端状态库，但 Phase 2 之后两端 store 都只依赖同一组 domain 端口，差异被压缩到「缓存策略」一层。

## 5. D4 包管理器：v1.2.x 冻结 npm workspaces

pnpm 的三项收益与对价：

| 收益 | 评估 |
|---|---|
| 严格依赖隔离（幽灵依赖不可 import） | 真实痛点（缺口五），但可用「补全依赖声明 + depcruise `banTransitiveDependencies`」在 npm 下获得 90% 效果 |
| 安装速度 | CI 端被 Turborepo 远程缓存大幅稀释 |
| workspace 协议 | npm workspaces 的 `*` 引用当前够用 |

对价：同时动摇 v1.2.1 刚建立的三个面——CI 缓存键与全部 workflow、`infra/v1.1/Dockerfile`（`npm ci`）、electron-builder 的依赖收集（2026 年对 pnpm 11 的兼容修复仍在密集提交，说明该路径 churn 未停）。

**结论**：v1.2.x 内冻结 npm。pnpm 迁移列入复审触发器：当 monorepo 包数量显著增长、或 npm 安装时间成为可测量瓶颈时，在无其他大变更的窗口单独执行。

## 6. D5 构建编排：Turborepo + project references

- Turborepo 在 v1.2.1 已冻结（理由见 [V121-TECHNOLOGY-DECISIONS 第 4 节](../v1.2.1/V121-TECHNOLOGY-DECISIONS.md)），本版本不重开。Nx 的模块边界与 sandboxing 能力被 D6 的 dependency-cruiser 覆盖，其余能力对本仓库是净增复杂度。
- 新增 TypeScript project references：这是 Turborepo 按包缓存 typecheck 的前提，也是消灭三条 typecheck 入口与 `typecheck:mcp` 8 GiB 堆的手段。落地方式见[架构文档第 7 节](./V122-ARCHITECTURE.md)。

## 7. D6 质量与边界：ESLint + Prettier + dependency-cruiser

- ESLint + Prettier 基线由 v1.2.1 `V121-CI-08` 建立（仓库此前没有任何 lint），本版本收入 `tooling/eslint` 并接入 turbo `lint` 任务。
- 分层依赖规则用 dependency-cruiser 表达（规则表见架构文档 3.2 节），进 CI 作为门禁。选它而不是 Nx `enforce-module-boundaries` 的原因：不绑定 Nx；规则粒度到文件夹级;能同时检测循环依赖与幽灵依赖。
- 存量违规用 baseline 文件冻结并只准减少（ratchet），避免一次性清零阻塞迁移。
- `scripts/check-shared-ui-boundaries.mjs` 中 import 类规则逐步折入 depcruise/ESLint；token 与 CSS 断言保留为脚本。

## 8. D7 领域模型：mapper 收口，不做实体统一

完整论证见[架构文档第 5 节](./V122-ARCHITECTURE.md)。要点：SQLite 行模型与云文档模型的差异是语义级（时间、分页、乐观锁、资产引用），统一实体是一次数据层改造，其前置条件（云同步在真实多设备稳定运行）尚未满足。v1.2.2 只做三件事：转换集中到 mapper 层、新功能以 contracts 形状为准、禁止新增重复形状。实体统一列为 v1.3+ 候选。

## 9. D8 依赖与版本收口

- `core`、`cli`、`client`、`automation-server` 补全 package.json 真实依赖（`better-sqlite3`、workspace 包等）。当前靠别名编译通过的状态使独立构建与依赖审计都不可能。
- zod 统一 v4：`packages/mcp` 当前锁 v3。若 `@modelcontextprotocol/sdk` 的 peer 限制不允许升级，则记录例外、锁定版本并在 depcruise 中禁止其他包 import mcp 的 zod。
- 包版本统一 `0.0.0-internal`（全部 private，不发布 npm），内部引用一律 `*`；`packages/cli` 包名从 `musefold` 改为 `@musefold/cli`（bin 名不变）。

## 10. 明确不采用与复审触发器

| 技术 | 不采用原因 | 复审触发器 |
|---|---|---|
| Tauri 2 | 迁移成本 10–16 周级；系统 webview 击穿像素门禁 | Electron 安全模型/体积成为可测量的用户问题，且主进程已完成瘦身 |
| NestJS / Hono / Next.js / Remix | 无对应痛点，重写无对价 | — |
| tRPC / ts-rest 取代 OpenAPI+Zod | API 消费者含 MCP 与非 TS 客户端 | — |
| pnpm / Yarn | 见 D4 | 包数量显著增长或安装时间成为瓶颈，且处于无大变更窗口 |
| Nx | 边界能力被 depcruise 覆盖，其余为净增复杂度 | 需要分布式 CI 执行时 |
| React 19 / React Compiler | 无痛点对应收益，保护 product-ui 稳定 | 依赖生态强制或出现明确渲染性能痛点 |
| 实体统一（Prompt/History 单一模型） | 数据层改造，前置条件未满足 | 渲染层部分已由 v1.3 ENT-01~04 完成；数据层（SQLite schema）仍待云同步真实多设备稳定运行后再评估 |
| micro-frontend / module federation | 单团队单产品，无独立部署诉求 | — |

## 11. 相关文档

- [系统架构](./V122-ARCHITECTURE.md)
- [迁移计划](./V122-MIGRATION-PLAN.md)
- [v1.1 技术选型 ADR](../v1.1/V11-TECHNOLOGY-DECISIONS.md)
- [v1.2.1 技术选型与决策](../v1.2.1/V121-TECHNOLOGY-DECISIONS.md)
