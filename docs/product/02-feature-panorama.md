# 02 · 核心功能全景与现状对照

> **状态回写**：2026-08-04 · 任务卡进度见 [90 §6](90-roadmap-and-task-index.md)；本文「现状对照」表可能滞后于代码，以当前源码和自动化测试为准。

> 本文给出 PromptForge 的**核心功能全景**、**设计要求 vs 当前实现**对照总表，以及**大功能 → 小功能**映射目录，作为所有 deep-dive 的总纲。
> 现状判定依据：`docs/12`（2026-08-03 的代码×设计交叉核对）+ `shared/types/`。图例：✅达标 🟡半成品 🔴未实现/死代码 🆕本设计新增。

---

## 1. 功能全景图

```
                         ┌───────────────────────────────────────────────┐
                         │              PromptForge / 词炉                 │
                         │        生图提示词管理与生产桌面 App              │
                         └───────────────────────────────────────────────┘
                                              │
        ┌───────────────┬─────────────────────┼─────────────────┬──────────────────┐
        ▼               ▼                     ▼                 ▼                  ▼
   ┌─────────┐    ┌──────────┐         ┌────────────┐    ┌──────────┐      ┌──────────┐
   │ Library │    │ Composer │         │  Generate  │    │ History  │      │ Settings │
   │ 提示词库 │    │ 组合画布 │         │ 生图工作区 │    │ 历史账本 │      │ 引导/设置 │
   └─────────┘    └──────────┘         └────────────┘    └──────────┘      └──────────┘
   双轨组织        三层引擎              快速/精修双tab     列表+详情         引导/外观
   搜索筛选        拖拽填槽              Provider+密钥      成本看板          Provider
   CRUD收藏        权重/Token           取消/重试          回填/再生成       导入导出
   回收站          多target序列化        target自动渲染     文件管理          备份/CSP
        │               │                     │                 │
        └───────「另存为 Prompt」──┘         ▲   └──「回填/另存」──┘
                                    ┌────────┴─────────┐
                                    │  差异化壁垒 (V1)  │
                                    │ AST反查/版本diff  │
                                    │ 排列组合/分享卡片 │
                                    │ 智能集合/多Provider│
                                    └──────────────────┘
```

**主路径（核心生产力）**：`Library → Composer → Generate → History`，四者通过资产提升/消费闭环。
**轻入口**：Chat（收敛为 Generate 的「快速」tab）。
**贯穿**：UI/UX 模式、引导/设置/数据、差异化壁垒。

---

## 2. 六大功能域总判

| 功能域 | 一句话职责 | 设计完成度 | 实现完成度 | 主要缺口 | deep-dive |
|--------|-----------|:---:|:---:|----------|-----------|
| **Library 提示词库** | 资产的存放/查找/管理 | 高 | 🟡 后端近达标，前端管理闭环缺失 | 文件夹管理/删除/拖拽/筛选栏/回收站 | [10](10-library-deep-dive.md) |
| **Composer 组合画布** | 把片段组合造词 | 高 | 🟡 引擎优秀，画布半成品 | 默认模板 seed/模板创建 UI/另存跳转/Fragment 扩充 | [11](11-composer-deep-dive.md) |
| **Generate 生图** | 调 API 出图 | 中高 | 🟡 能生图但主链路偏移 | 取消失效/GeneratePanel 死代码/首次引导/错误分类 | [12](12-generation-deep-dive.md) |
| **History 历史成本** | 结果与成本账本 | 中 | 🟡 列表可用，详情/回放弱 | 详情大图/回填/再生成/成本看板 | [13](13-history-deep-dive.md) |
| **Chat 快速生图** | 低门槛试验入口 | 中（超范围） | 🟡 较完整但割裂 | 收敛进 Generate/提升通道/文案统一 | [14](14-chat-deep-dive.md) |
| **差异化壁垒** | 竞争护城河 | 中 | 🔴 基本未做 | AST 反查/版本/排列/分享/智能集合 | [15](15-differentiators-deep-dive.md) |
| **引导·设置·数据** | 首启激活与数据安全 | 中 | 🟡/🔴 导入导出未实现 | onboarding/export-import/CSP/成本单价 | [16](16-onboarding-settings-data-deep-dive.md) |
| **UI/UX 系统** | 原生风与交互一致性 | 高 | 🟡 组件齐、模式散 | 命令面板/快捷键/空态统一/a11y | [17](17-uiux-patterns.md) |

> **总判**（承 docs/12）：**架构与契约层完成度高于业务闭环。** 后端 repository/IPC/schema/引擎质量高；前端主路径（Library→Composer→Generate→History）有明显断点，差异化未闭环。定位风险：易被误看成「薄封装聊天生图客户端」。

---

## 3. 设计要求 vs 当前实现（模块对照总表）

> 承接 `docs/12` §3，细化到小功能粒度。「结论」列决定优先级归属。

### 3.1 Library 提示词库
| 小功能 | 设计 | 现状 | 结论 |
|--------|------|:---:|------|
| prompts CRUD 后端 + IPC | 齐全 | ✅ | 达标 |
| 列表虚拟化 | @tanstack/react-virtual | ✅ | 达标 |
| FTS5 + JS 侧汉字/词分词 | 写入预分词 | 🟡 查询端已收口 | 验证/修复 |
| store update/delete/togglePin | 完整 actions | 🔴 缺 | **P0** |
| 文件夹 CRUD + 拖拽归类 | 完整 | 🔴 只读 | **P0** |
| 软删/回收站 | 软删可恢复 | 🔴 | P1 |
| 收藏置顶区 | pin 区 + 重排 | 🟡 | P1 |
| 多条件筛选栏 | 6 维度 | 🔴 | 🆕 P1 |
| 右栏检视 + 生成入口 | 详情/生成 | 🟡 | **P0** |

### 3.2 Composer 组合画布
| 小功能 | 设计 | 现状 | 结论 |
|--------|------|:---:|------|
| 插值引擎（6 语法） | parser/renderer/serializer | ✅ 21/21 单测 | **最高质量** |
| 权重按 target 序列化 | 4+ target | ✅ | 达标 |
| 三栏画布 UI | 库/画布/预览 | 🟡 骨架 | 半成品 |
| dnd 拖拽填槽 + 权重滑块 | 替换/追加 | 🟡 | 补齐 |
| 默认模板 seed | ≥3 套 | 🔴 无 | **P0 阻塞** |
| 模板创建/编辑 UI | body/slots/target | 🔴 缺 | **P0** |
| 内置 Fragment 库 | 100+ | 🟡 ~45 | P1 |
| 另存为 Prompt 跳转高亮 | 跳 Library | 🟡 仅 alert | **P0** |
| Token 计数颜色阈值 | 绿/黄/红 | 🟡 待核 | P1 |

### 3.3 Generate 生图 + Provider
| 小功能 | 设计 | 现状 | 结论 |
|--------|------|:---:|------|
| Provider CRUD + active | 多 Provider | ✅ | 达标 |
| safeStorage 密钥 | 异步 API + 脱敏 | ✅ | 达标 |
| gpt-image-2 调用 + 写盘 | b64→媒体 | ✅ | 达标 |
| 指数退避重试 | max 3 + 抖动 | 🟡 有模块 | 验证 |
| **取消生图** | AbortController 贯穿 | 🔴 失效 | **P0** |
| GeneratePanel 挂载 | Library/Composer 生图 | 🔴 死代码 | **P0** |
| 首次引导预设 | TvT/OpenAI 一键 | 🔴 | P1 |
| 错误分类展示 | 401/429/余额 | 🟡 | P1 |
| target 自动渲染 | 按 provider 选语法 | 🟡 | P1 |
| CSP | 有 | 🔴 | P1 |

### 3.4 History 历史成本
| 小功能 | 设计 | 现状 | 结论 |
|--------|------|:---:|------|
| 列表（缩略图/成本/耗时/状态） | 时间倒序 | 🟡 | 基本可用 |
| 失败重试 + 删除 | retry/delete | ✅ | 重试 UX + 清理菜单已补 |
| 详情大图 + 参数回放 | lightbox + 参数 | ✅ | 达标 |
| 回填 Composer / 再次生成 | 结果反哺 | ✅ | Composer / Prompt / Generate 回流已补 |
| 成本看板汇总 | 按日/provider | 🟡 | 聚合 IPC + 单价配置已补，UI 看板待补 |

### 3.5 Chat / 差异化 / 数据
| 小功能 | 设计 | 现状 | 结论 |
|--------|------|:---:|------|
| Chat 多图生成 + 灯箱 + 重试 | 快速入口 | 🟡 完整但割裂 | 收敛 P1 |
| Chat→库/画布 提升 | 单向提升 | 🔴 | 🆕 P1/P2 |
| AST 点击反查高亮 | 差异化 | 🔴 引擎已具 segments | P2 高 ROI |
| 版本管理 + diff | 事件+快照 | 🔴 diff-match-patch 未用 | P2 |
| 排列组合 permutation | 多候选 | ✅ | P2 |
| 分享卡片 + deeplink | P2P | 🔴 | P2 |
| 智能集合/搜索历史 | 保存筛选 | 🔴 | P2 |
| JSON 导入导出 | 仅DB/DB+图 | 🔴 throw Not impl | **P0** |
| 首次引导 onboarding | <10min 激活 | 🔴 | P1 |

---

## 4. 大功能 → 小功能映射目录

> 每个小功能对应 deep-dive 里的一张任务卡（Task Card）。任务卡 ID 前缀见括号。完整索引见 [90-roadmap-and-task-index.md](90-roadmap-and-task-index.md)。

| 大功能 | 任务卡前缀 | 小功能数（规划） | 文档 |
|--------|:---:|:---:|------|
| Library 提示词库 | `TASK-LIB` | 15 | [10](10-library-deep-dive.md) |
| Composer 组合画布 | `TASK-CMP` | — | [11](11-composer-deep-dive.md) |
| Generate 生图/Provider | `TASK-GEN` | — | [12](12-generation-deep-dive.md) |
| History 历史成本 | `TASK-HIS` | — | [13](13-history-deep-dive.md) |
| Chat 快速生图 | `TASK-CHT` | — | [14](14-chat-deep-dive.md) |
| 差异化壁垒 | `TASK-DIF` | — | [15](15-differentiators-deep-dive.md) |
| 引导·设置·数据 | `TASK-SET` | — | [16](16-onboarding-settings-data-deep-dive.md) |
| UI/UX 模式 | `TASK-UX` | — | [17](17-uiux-patterns.md) |

> （「小功能数」由各 deep-dive 最终确定，本表在 [90](90-roadmap-and-task-index.md) 汇总为总索引。）

---

## 5. 关键跨功能依赖（产品视角）

```
LIB-09(库→生成入口) ──┐
CMP(另存为Prompt) ────┼─→ 主路径闭环依赖 GEN(Generate工作区挂载 + 取消修复)
CHT(Chat收敛) ────────┘
GEN(成本估算) ─→ HIS(成本看板)
HIS(回填) ─→ CMP/GEN
SET(导入导出) ─→ 全部数据域
UX(命令面板/快捷键/空态) ─→ 贯穿全部页面
DIF(AST反查) ─→ 依赖 CMP 引擎 segments（已就绪）
```

**闭环关键路径（P0）**：`GEN 取消修复 + GeneratePanel 挂载` × `CMP 默认模板 + 另存跳转` × `LIB store/文件夹/检视生成入口` × `SET 导入导出`。这四组一旦打通，「新用户 10 分钟完成配 Key→生图→存词→组合」的核心闭环即成立。

---

## 6. 下一步

- 按功能域读对应 deep-dive（[10](10-library-deep-dive.md)–[17](17-uiux-patterns.md)）。
- 执行顺序与批次见 [90-roadmap-and-task-index.md](90-roadmap-and-task-index.md)。
