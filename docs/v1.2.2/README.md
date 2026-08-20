# Musefold v1.2.2

v1.2.2 是系统架构重构版本。它不新增产品功能，交付的是桌面 + Web 双端的企业级 monorepo 结构：桌面 App 迁入 `apps/desktop`、共享层补全、桌面数据访问抽象与 Web 对齐，让双端「一致的交互体验和 UI 设计」建立在同一套代码上，而不是两套平行实现上。

**当前进度（2026-08-20）**：Phase 0 工程化地基与 Phase 1a 源码目录迁移已完成；Phase 2 桌面 Gateway 部分完成（GW-01 domain / GW-02 / GW-03 / GW-05 已完成；GW-01 的 WebGateway `implements` 补卡等待 web 并行工作流收口；GW-04 / GW-06 起未开工）；Phase 3 共享逻辑归位部分完成（SHARE-06 / 01 / 05 / 02 / 03 已完成；仅剩 SHARE-04，与 Phase 2 stores 切换同批）；Phase 1b（App manifest 下移）未开工。

前置版本是 [v1.2.1 持续交付](../v1.2.1/README.md)。v1.2.1 交付的 affected 流水线、自动部署与一键回滚是本版本大规模目录迁移的回归安全网，顺序不可颠倒。

## 文档

- [系统架构](./V122-ARCHITECTURE.md)
- [技术选型与决策](./V122-TECHNOLOGY-DECISIONS.md)
- [迁移计划](./V122-MIGRATION-PLAN.md)

## 核心结论

v1.1 已经完成双端复用最难的一半：`packages/ui` + `packages/product-ui` 约 1.2 万行产品组件被桌面和 Web 共同消费，并有像素级视觉门禁。剩余维护成本集中在五个结构性缺口：

1. **两套并行领域模型**。桌面行模型（原 `shared/types`，现 `packages/desktop-contracts`：SQLite 行、epoch 时间、offset 分页）与 `packages/contracts`（云文档、ISO 时间、cursor 分页、乐观锁）对同一批实体各有一份定义。
2. **桌面没有数据访问抽象**。Web 有 `WebGateway`，桌面 47 个渲染文件直接 import IPC，18 个 zustand store 就是数据层。Phase 2 已上提六端口并落地 `DesktopGateway` 骨架与 library 写路径样板；list/create 等桌面查询面仍直连 IPC（见[架构文档第 4 节](./V122-ARCHITECTURE.md)）。
3. **桌面 App 占据仓库根目录**（Phase 1a 前：`src/` + `electron/` + `shared/` 约 6.5 万行），导致三套互不一致的路径别名、无 project references、typecheck 入口分裂为三条。Phase 1a 已迁走源码并解散 `shared/`；根 package.json 仍兼 App manifest（Phase 1b）。
4. **宿主编排层重复**。Web `App.tsx` 与桌面 pages+stores 平行实现；`new-api` 客户端两份；纯函数多处复制；UI 原语迁移一半。
5. **依赖关系靠别名而非声明**。`core`、`cli`、`client`、`automation-server` 的 package.json 不声明真实依赖，zod v3/v4 分裂，包版本号三套。

对应五个动作：**目录归位**（桌面进 `apps/desktop`，`shared/` 解散进 `packages/desktop-contracts` 等）、**Gateway 补全**（桌面实现与 Web 同一组 domain 端口）、**模型映射而非强合**（mapper 层收口双模型转换，新功能以 contracts 形状为准）、**共享逻辑归位**（纯函数进 domain、UI 原语补齐、客户端去重）、**工程收口**（依赖声明补全、project references、dependency-cruiser 边界规则）。

## 范围

| 属于 v1.2.2 | 不属于 v1.2.2 |
|---|---|
| 桌面 App 迁入 `apps/desktop`，根目录只留 workspace 配置 | 更换桌面壳（Tauri）、后端框架、前端框架 |
| `shared/` 解散：类型进 `packages/desktop-contracts`，逻辑归位 domain/core | Prompt/History 实体的数据层统一（v1.3+ 候选） |
| domain 端口补全 + `DesktopGateway`，stores 与组件不再直连 IPC | 切换包管理器到 pnpm（评估后冻结 npm，见技术决策 D4） |
| dependency-cruiser 分层规则、依赖声明补全、zod v4 统一 | 新增产品功能、改变任何用户可见行为 |
| TypeScript project references，`tsc -b` 单入口 typecheck | Web 端补注册/兑换 UI 等产品缺口（属产品版本） |
| UI 原语迁移收尾、纯函数入 domain、new-api 客户端去重 | 修改 v1.2.1 已交付的发布链路语义 |

## 阶段总览

| 阶段 | 内容 | 状态 |
|---|---|---|
| Phase 0 工程化地基 | 依赖声明、zod v4、dependency-cruiser、project references | **已完成（2026-08-20）** |
| Phase 1a 源码目录迁移 | 桌面迁入 `apps/desktop`、`shared/` 解散、别名收敛、CI 层级映射 | **已完成（2026-08-20）** |
| Phase 1b App manifest 下移 | 根 package.json 变纯 workspace root；打包与发布路径同步 | 未开工（须 v1.2.1 发布门禁全部通过 + Phase 1a 稳定运行一周） |
| Phase 2 桌面 Gateway | domain 端口做全、`DesktopGateway`、stores 逐个切换 | **部分完成（2026-08-20）**：GW-01（domain）/ 02 / 03 / 05 已完成；GW-01 WebGateway `implements` 补卡等待 web 并行工作流收口；GW-04 / 06 起未开工 |
| Phase 3 共享逻辑归位 | 纯函数、UI 原语、客户端去重、工作台 store 拆分 | **部分完成（2026-08-20）**：SHARE-06 / 01 / 05 / 02 / 03 已完成；仅剩 SHARE-04（与 Phase 2 stores 同批；可与 Phase 2 交错，不依赖 Phase 1b） |

Prompt/History 实体统一与宿主编排进一步收敛列为 v1.3+ 候选，理由见[架构文档第 5 节](./V122-ARCHITECTURE.md)。

## 已知风险

| 风险 | 缓解 |
|---|---|
| Phase 1 目录迁移破坏 electron-builder 打包 | 拆成 1a（只动源码目录，**已完成**）与 1b（App manifest 下移）两步；每步以 `package:mac:adhoc` 冒烟为门禁 |
| 迁移与日常开发冲突产生大面积 rebase | `git mv` 纯移动提交与内容修改严格分离；Phase 1b 设短暂 feature freeze 窗口 |
| v1.2.1 流水线的路径过滤在迁移后失配 | 路径映射已按 `V121-CI-04` 单点定义；Phase 1a DIR-04 已切至 `apps/desktop/**` 并验证四类触发 |
| 热更新 `minShellVersion` 推导脚本失效 | 推导按包名解析（`V121-HOT-06` 已预留），Phase 1 验收项包含验证 |
| Gateway 抽象引入回归 | 按 feature 逐个 store 切换，每步过桌面 E2E 与共享视觉门禁 |
