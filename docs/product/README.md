# PromptForge 产品设计文档集（product design docs）

> 面向 **Opus 模型开发与测试** 的可执行产品设计文档。
> 本目录（`docs/product/`）在既有工程规格 `docs/00`–`docs/12` 之上，补齐**产品层设计**：
> 每个大功能 → 拆小功能 → UI/UX 设计 → **可直接派工的任务卡**（含验收标准、测试场景、涉及文件、IPC 契约、优先级、依赖）。

> **进度状态（本轮回写）**：85 张任务卡 → ✅ 85 · 🚧 0 · 📋 0（当量 100%）。Generation 14/14、Composer 14/14、History 14/14、Chat/探索 11/11、统一生成工作台、图片产物管理与 Lightbox、存为提示词、拆到画布、成本估算、成本看板、AST 点击反查高亮、多 target 序列化产品化、版本管理 + diff、排列组合批量生图、智能集合与最近搜索历史、列表/网格双视图、批量操作、Fragment 智能元数据、分享卡片 + `promptforge://` 导入确认、Provider/模型/参数内联快切、探索/制作核心多图生成与键盘交互、空态激活路径、Provider 自动重试、Composition target 自动选择、术语统一、测试产物治理、发布前本地预检、本地发布产物状态快照、CI 远端绿灯证据脚本、Windows hosted runner 证据脚本、签名环境预检脚本、macOS 签名公证证据脚本、Windows ARM64 目标机验收清单脚本、外部门禁证据模板/校验脚本、真实 TvT API 单图验收、打包 manifest 防裁剪及 Settings 10 卡已完成无真实 API 验收；旧 Chat/Studio 页面组件与 `studio/store` 已清理，Library/History/Composer 正式入口已直连 Workbench，`generation/store` 现在只负责 Provider 配置、密钥、模型与连通性测试，旧生成兼容 API 已删除。macOS ARM64 未签名验收包已按最新代码/文档重建，Windows ARM64 结构级包已验证；Windows 目标平台运行、Developer ID 签名/公证、Windows hosted runner 实跑和 CI 远端绿灯仍待验收。
> 桌面端任务卡已经收口；当前状态以 [90-roadmap §6](90-roadmap-and-task-index.md)、当前源码和自动化测试为准。

---

## 0. 这套文档解决什么问题

本目录保留桌面端产品意图和交互契约，不再承担实时开发进度看板。任务卡状态已回写；后续开发先读 [90 §6 看板](90-roadmap-and-task-index.md)，再以当前源码和测试确认真实行为。

本文档集的目标：把「设计意图」翻译成 Opus 能**直接认领、开发、自测**的任务单元，让每个大功能从「半成品」推进到「可验收闭环」，并把差异化壁垒逐条落地。

**产品范围**：完整产品愿景（MVP 补全 + V1 差异化 + V2 展望），分优先级标注，Opus 按优先级分批开发。

**导航定位决策（已确认）**：**融合双入口**。
- **Generate = 统一创作台**（探索：低门槛、多图发散；制作：参数收敛、单图定稿），已收敛进主导航；旧 Chat/Studio 页面与独立 Studio 状态源已清理。
- **Library → Composer → Generate → History = 核心生产力主路径**（资产沉淀、组合造词、批量生产、成本账本），优先补齐。
- 两者通过明确的「提升」动作连接：Chat 结果一键存入 Library / 进 Composer 深化；Composer 产物「另存为 Prompt」进 Library。详见 [01-vision-and-ia.md](01-vision-and-ia.md)。

---

## 1. 阅读顺序

**产品/设计视角（先读）**
| # | 文档 | 内容 |
|---|------|------|
| 01 | [vision-and-ia.md](01-vision-and-ia.md) | 产品定位、用户画像、竞品对照、差异化壁垒、**融合双入口信息架构与导航模型** |
| 02 | [feature-panorama.md](02-feature-panorama.md) | 核心功能全景、设计 vs 现状对照总表、大功能→小功能映射目录 |

**大功能深潜（deep-dive，按主路径顺序）**
| # | 文档 | 大功能 | 优先级重心 |
|---|------|--------|-----------|
| 10 | [library-deep-dive.md](10-library-deep-dive.md) | 提示词库 Library | P0 主路径起点 |
| 11 | [composer-deep-dive.md](11-composer-deep-dive.md) | 组合画布 Composer | P0/P1 造词工作台 |
| 12 | [generation-deep-dive.md](12-generation-deep-dive.md) | 生图与 Provider | P0 生产引擎 |
| 13 | [history-deep-dive.md](13-history-deep-dive.md) | 历史与成本 | P1 结果账本 |
| 14 | [chat-deep-dive.md](14-chat-deep-dive.md) | Chat 快速生图 | P1 轻入口 |
| 15 | [differentiators-deep-dive.md](15-differentiators-deep-dive.md) | 差异化壁垒 | P2 V1 竞争护城河 |
| 16 | [onboarding-settings-data-deep-dive.md](16-onboarding-settings-data-deep-dive.md) | 引导·设置·数据 | P1 首启与安全 |
| 17 | [uiux-patterns.md](17-uiux-patterns.md) | UI/UX 模式与设计系统扩展 | 贯穿全局 |
| 18 | [generation-workbench-redesign.md](18-generation-workbench-redesign.md) | 探索/制作统一创作台 | 当前 Generate 实现依据 |

**执行视角（最后读）**
| # | 文档 | 内容 |
|---|------|------|
| 90 | [roadmap-and-task-index.md](90-roadmap-and-task-index.md) | 分批开发计划、**全部任务卡总索引**、优先级矩阵、Opus 派工建议、验收门禁 |

---

## 2. Opus 如何使用本文档集

1. **认领批次**：从 [90-roadmap-and-task-index.md](90-roadmap-and-task-index.md) 找到当前 Phase 的任务卡列表，按 `依赖` 顺序认领。
2. **读任务卡**：每个任务卡（Task Card）是自包含的开发单元，含目标、涉及文件、IPC 契约、验收标准、测试场景。
3. **对照工程规格**：任务卡引用的 schema/IPC/类型均指向既有 `docs/00`–`docs/12` 与 `shared/types/`，**不要偏离契约层**。
4. **开发→自测→勾验收**：完成后逐条勾选任务卡的「验收标准」，跑「测试场景」，确认「质量门禁」。
5. **回写状态**：更新任务卡顶部的 `状态` 字段（📋 未开始 / 🚧 进行中 / ✅ 已完成 / ⏸️ 阻塞）。

> **重要**：本文档集是**产品设计蓝图**，不是最终代码。任务卡给出目标与约束，具体实现细节（组件内部结构、状态切片命名）Opus 可自主决定，但必须满足验收标准、遵守 IPC 契约与安全红线（`docs/01` §3）。

---

## 3. 任务卡（Task Card）规范

每个小功能对应一张任务卡，统一格式如下。**Opus 开发时逐张认领。**

```
### [TASK-XX-NN] 任务标题

- **状态**：📋 未开始
- **优先级**：P0 · 阻塞可用闭环 / P1 · 明显低于验收 / P2 · V1 差异化 / P3 · 工程债
- **所属大功能**：Library / Composer / Generation / …
- **依赖**：[TASK-XX-MM]（无则写「无」）
- **预估**：S（<0.5d）/ M（0.5-1.5d）/ L（1.5-3d）/ XL（拆分）

**目标**：一句话说明这张卡要交付什么用户价值。

**涉及文件**（新建/修改）：
- `src/features/.../Xxx.tsx`（新建）
- `electron/main/ipc/xxx.ts`（修改：补 handler）

**IPC 契约**（若涉及跨进程）：
- 通道 `db:xxx:yyy`，请求 `{...}`，响应 `{...}`（引用 docs/07 或新增）

**交互与 UI/UX**：
- 关键交互步骤、状态、边界、空态、错误态、快捷键

**验收标准**（勾选式，必须可客观判定）：
- [ ] 条件 1
- [ ] 条件 2

**测试场景**（Opus 自测用，含正常/边界/异常）：
1. 正常：…
2. 边界：…
3. 异常：…

**质量门禁**：
- [ ] `npm run typecheck` 通过
- [ ] 相关单测通过（若有）
- [ ] preview 验证（若 UI 可预览）
```

---

## 4. 优先级定义（全文档集统一）

| 标记 | 含义 | 判定标准 |
|------|------|----------|
| **P0** | 阻塞真实可用闭环 | 缺它则「新用户 10 分钟完成配 Key→生图→存词」走不通 |
| **P1** | 明显低于验收标准 | 影响专业度/完整度，但不阻断主流程 |
| **P2** | V1 差异化 / 竞争壁垒 | 拉开与竞品差距，可发布后迭代 |
| **P3** | 工程债 / 打磨 | 内部质量，用户不直接感知 |

## 5. 预估规模定义

| 标记 | 工作量 | 说明 |
|------|--------|------|
| **S** | < 0.5 天 | 单文件小改、补一个 store action |
| **M** | 0.5–1.5 天 | 一个组件 + 对应 IPC/store |
| **L** | 1.5–3 天 | 一个完整小功能闭环（UI+IPC+DB+自测） |
| **XL** | > 3 天 | 必须拆成多张卡，不允许直接认领 |

## 6. 图例（deep-dive 文档内统一使用）

- ✅ 已实现且基本达标　🟡 部分实现/半成品　🔴 未实现/死代码　🆕 本设计新增
- 📋 未开始　🚧 进行中　✅ 已完成　⏸️ 阻塞

---

## 7. 与既有 `docs/` 的关系

- `docs/00`–`docs/09`：**工程规格**（架构、schema、IPC 契约、引擎语法）——本文档集**引用不重写**。
- `docs/10`：已退役悟空接入的历史调研，不再作为实现依据；`docs/11`：TvT API 接入参考。
- `docs/12`：现状评估与优先级——本文档集是它的**产品化落地**。
- `docs/product/`（本目录）：**产品设计 + 可执行任务卡**——Opus 开发的直接依据。

> 契约冲突时，以 `shared/types/` 代码 + `docs/02`（data-model）+ `docs/07`（IPC）为准；本文档集若需扩展契约，会在对应任务卡显式标注「新增 IPC」并给出完整签名。
