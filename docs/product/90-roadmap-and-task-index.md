# 90 · 路线图 · 任务卡总索引 · 派工建议

> 本文是 Opus 开发的**执行入口**：分批开发计划、全部任务卡总索引、优先级矩阵、派工建议、验收门禁。
> 承接早期优先级计划并产品化为可认领批次。任务卡定义分散在各 deep-dive（[10](10-library-deep-dive.md)–[17](17-uiux-patterns.md)），本文汇总索引。

> **状态回写**：2026-08-06 · 基于源码实读、DIF-04 专项 E2E、`npm run check`、全量无 API E2E、测试产物治理、发布前本地预检、最新 macOS 打包冒烟与 Windows ARM64 结构级包冒烟。
> 图例：✅ 已完成 · 🚧 进行中 · 📋 未开始 · ⏸️ 阻塞
> **汇总（2026-08-06）**：85 卡中 ✅ **85** · 🚧 **0** · 📋 **0** = 完成当量 **100%**（✅计1 · 🚧计0.5）。Generation、Composer、History 与 Chat/探索均 **全部完成**；统一创作台已补齐图片产物管理、Lightbox、存为提示词、拆到画布、成本估算、成本看板、Provider/模型/参数内联快切、「生成 / 探索 / 制作」术语基线与空态激活路径；Composer 差异化已落地 AST 点击反查高亮、多 target 序列化产品化、版本管理 + diff、排列组合批量生图、分享卡片 + `promptforge://` 导入确认与 Fragment 智能元数据，Library 已补齐智能集合、最近搜索历史、列表/网格双视图与批量操作；本地测试/缓存产物已有清理脚本与忽略规则，并新增发布前本地预检脚本统一核对源码/文档/门禁不变量，另补齐 CI 远端绿灯证据脚本、Windows hosted runner 证据脚本、签名环境预检脚本、macOS 签名公证证据脚本和 Windows ARM64 目标机验收清单脚本；真实 TvT API 单图已通过；macOS ARM64 未签名验收包已按最新代码/文档重建，Windows ARM64 结构级包已验证。Windows 目标平台运行、Developer ID 签名/公证、Windows hosted runner 实跑和 CI 远端绿灯仍待验收。
> **比例选择子任务回写（2026-08-05）**：在既有自绘 `RatioPicker` 基础上补齐工作台弹层顶部当前画幅摘要和设置页默认比例摘要卡；两处都能直接感知横竖方向、比例、用途与像素档位，仍保持无原生 `<select>`。
> **比例选项补齐（2026-08-06）**：参考旧版创作台源码和 Wukong 生图组目录，新增 `3:4`、`4:3`、`4:5`、`5:4`、`21:9` 预览卡；OpenAI-compatible 请求仍映射到 `1024x1536` / `1536x1024` 合法像素档，Wukong 侧保留精确比例串。
> **比例下拉 UI 收口（2026-08-06）**：工作台比例触发器为应用内自绘按钮，不使用原生 `<select>`；展开层为玻璃浮层 + 旧版白底画幅轮廓预览卡。设置页改为一行文字摘要 + 常驻预览网格直接选择，不再重复提供第二个比例下拉和图形摘要。
> **比例下拉可访问性与窄屏回归（2026-08-06）**：比例选项支持方向键、Home/End、Enter/Space、Esc 和关闭后焦点回归；360×740 视口下弹层自动右对齐并完整落在视口内，网格内容独立滚动。新增窄屏边界 E2E 断言，防止后续布局调整造成裁切。
> **生成 Composer 与比例卡片视觉收口（2026-08-06）**：底部输入区改为输入优先；服务商/模型为轻量上下文控件，质量/数量/反向提示词统一进入“生成设置”浮层，发送/停止使用圆形图标按钮。比例选项和设置页常驻预览改为单层轻卡片，完整展示画幅框、比例、用途与像素档，横竖/超宽比例不再裁切；无 Provider 时不显示死的禁用生成按钮。
> **完成态 / Settings / 命令面板收口（2026-08-06）**：生成回合的继续探索、采用方向和查看历史使用统一圆角动作组；Settings 移除重复分区副标题和三重比例入口；命令面板修复动画重复横移，桌面严格居中，360×740 下保持左右 16px 安全边距。该阶段无 API 全量 E2E 为 253 passed / 6 skipped / 0 failed；提示词库与制作引用闭环的最新全量结果见下方 6.8，为 257 passed / 6 skipped / 0 failed。

> **路线图后增强：提示词库与制作引用闭环（2026-08-06）**：在原 85 张任务卡全部关闭后，按产品确认新增一项跨域增强。Library 列表优先、网格可选，右侧检视增加「详情 / 作品」；制作模式增加可折叠引用侧栏，支持搜索、整条引用和选段引用。SQLite migration 0009、`history.related`、导入导出/重置/重试已同步，真实测试结果见对应 deep-dive 与交接文件。本增强不改变 85 张既有任务卡计数，也不在探索模式引入引用栏。

---

## 1. 分批开发计划（Phase A–E）

> 目标序：先做「可日常使用的提示词管理 + 稳定生图」，再强化组合系统差异化，最后做数据安全与发布。

### Phase A · 可用性闭环（P0，最高优先）· 🚧 ~98%

**目标**：新用户 10 分钟内完成 **配 Key → 生图 → 回看历史 → 存一条提示词 → 组合造词**。这是产品从「Alpha」到「可日常用」的分水岭。

关键交付（跨 4 个功能域的 P0）：
1. **Generate 主链路修复**：挂载 Generate 工作区（修 GeneratePanel 死代码）+ **修复取消生图**（单一 AbortController 贯穿）+ 失败/取消写历史。→ [12](12-generation-deep-dive.md)
2. **Composer 可启动**：默认模板 seed（≥3 套）+ 模板创建 UI + 另存为 Prompt 跳转高亮。→ [11](11-composer-deep-dive.md)
3. **Library 管理闭环**：store 完整 actions + 文件夹 CRUD + CRUD 闭环 + 右栏检视生成入口 + 搜索分词验证。→ [10](10-library-deep-dive.md)
4. **数据可备份**：JSON 导入导出最小闭环。→ [16](16-onboarding-settings-data-deep-dive.md)

**Phase A 验收**：干净安装后无需手写 SQL / 手工插模板，即可完成一次生图；生图可取消；提示词可建/改/删/收藏/搜索；组合可产出并另存；数据可导出导入。

### Phase B · 组合系统与生产力可用（P0/P1）· ✅ ~100%

**目标**：Composer 成为真正可产出提示词的工作台；Library 达「管理工具」标准。

- 模板/Fragment 管理 UI 完善 + 内置 Fragment 扩到 80–100+
- 权重滑块 + Token 阈值 + 负面 target 适配（MJ `--no`）
- Composer 预览栏一键生成
- Library：收藏置顶区 / 多条件筛选栏 / 排序 / 标签管理 / 拖拽归类 / 回收站 / 批量操作
- 首次引导 onboarding（Provider 预设一键 + 校验）

**验收**：对照 [11](11-composer-deep-dive.md) §7 与 [10](10-library-deep-dive.md) §7（除差异化项）全部勾选。

### Phase C · 生图与历史专业化（P1）· ✅ 100%

- History：详情大图 + 参数完整回放 + 回填 Composer + 再次制作/失败重试
- 失败重试 UX（进度、错误码文案）+ 「重试中」状态
- 成本看板（按日 / 按 provider 汇总，可配单价）✅
- 图片输出管理（打开目录、复制路径、删除策略）
- Chat 收敛进 Generate「探索」模式 + 空态激活路径 + 提升通道 + 文案统一
- 中文搜索体验最终验证

**验收**：对照 [13](13-history-deep-dive.md) §7、[14](14-chat-deep-dive.md) §7。

### Phase D · 数据安全与发布基础（P1）· 🚧 ~95%

- JSON 全量导入导出完善（仅DB / DB+图片包）+ 备份恢复 UI
- CSP + 权限最小化复查（含 media:// 放行）✅
- `npm test` script + CI workflow（typecheck + vitest + build + full E2E + macOS package smoke + Windows package + runtime smoke）
- macOS ARM64 打包冒烟（启动、生图、落盘、导入导出）✅；Windows ARM64 结构级包冒烟 ✅；Windows 目标平台运行冒烟待执行
- 清理仓库测试产物、密钥风险说明
- README 补：配置 Provider、推荐模型、故障排查

**验收**：对照 [16](16-onboarding-settings-data-deep-dive.md) §7 + 打包冒烟清单（§5）。

### Phase E · 差异化 V1（P2）· ✅ ~100%

1. ✅ **AST 预览反查**（点预览词 → 高亮来源 slot）— 已产品化
2. ✅ **多 target 序列化的产品化呈现**（并排对比 + 一键复制各语法）— 已产品化
3. ✅ 版本管理 + diff（diff-match-patch）
4. ✅ 排列组合（permutation 多候选批量生成）
5. ✅ 分享卡片 + deeplink（P2P）
6. ✅ 智能集合 / 搜索历史（已完成）
7. ✅ Fragment 智能元数据（兼容/权重区间/冲突/同义词/多语软提示）

**验收**：对照 [15](15-differentiators-deep-dive.md) §7。

---

## 2. 优先级矩阵（价值 × 成本）

```
        高价值
          ▲
   P0 主链路修复          │  P0 Composer默认模板/另存
   (取消/GeneratePanel)   │  P1 Library筛选/回收站
   P0 Library store/文件夹 │  P1 History详情/回填
   P0 导入导出            │  P2 AST反查(高ROI)
──────────────────────────┼──────────────────────────▶
   P1 首次引导            │  P2 版本管理/排列组合
   P1 错误分类/重试UX     │  P2 分享卡片/智能集合
   P1 成本看板           │  P2 第二Provider适配
   (低成本先做)          │  (高成本后做)
          │
        低价值
```

**决策原则**：
- **左上（高价值低成本）先做**：P0 主链路修复、Library store、导入导出。
- **右上（高价值高成本）规划做**：Composer 完善、History 专业化、AST 反查。
- **右下（低价值高成本）暂缓**：多 Provider 适配、社区 Fragment 市场。
- **不要做的事**（承 docs/12 §6）：并行开多个 Provider 适配；社区市场；大重构状态管理/换栈；继续只堆 Chat 而让 Library/Composer 荒废。

---

## 3. 全部任务卡总索引

> 按功能域分组，标注优先级 / 预估 / 依赖 / 所属 Phase。
> **✅ 已回写（2026-08-04）**：状态列已与各 deep-dive 任务卡对齐；Opus 认领前先看状态，避免重复劳动。
> 点进对应 deep-dive 读任务卡详情与验收标准。

### 3.1 Library（[10](10-library-deep-dive.md)）
| 任务卡 | 状态 | 标题 | 优先级 | 预估 | 依赖 | Phase |
|--------|:---:|------|:---:|:---:|------|:---:|
| TASK-LIB-01 | ✅ | 提示词 CRUD 闭环 | P0 | L | — | A |
| TASK-LIB-02 | ✅ | store 完整 actions | P0 | M | — | A |
| TASK-LIB-03 | ✅ | 文件夹管理（≤2 层） | P0 | L | — | A |
| TASK-LIB-04 | ✅ | 收藏置顶区 | P1 | M | LIB-02 | B |
| TASK-LIB-05 | ✅ | 即时搜索 + 中文分词验证 | P0 | M | — | A |
| TASK-LIB-06 | ✅ | 标签云筛选 | P1 | M | LIB-02 | B |
| TASK-LIB-07 | ✅ | 多条件筛选栏 🆕 | P1 | M | LIB-02 | B |
| TASK-LIB-08 | ✅ | 排序 | P1 | S | LIB-02 | B |
| TASK-LIB-09 | ✅ | 右侧检视详情 + 生成入口 | P0 | M | LIB-02 | A |
| TASK-LIB-10 | ✅ | 拖拽归类 | P1 | M | LIB-03 | B |
| TASK-LIB-11 | ✅ | 标签管理 | P1 | M | LIB-02 | B |
| TASK-LIB-12 | ✅ | 回收站 | P1 | M | LIB-01 | B |
| TASK-LIB-13 | ✅ | 批量操作 | P2 | M | LIB-02,10 | C |
| TASK-LIB-14 | ✅ | 列表/网格双视图 | P2 | M | LIB-01 | C |
| TASK-LIB-15 | ✅ | seed 文件夹 + 空态引导 | P1 | S | — | A/B |

### 3.2 Composer（[11](11-composer-deep-dive.md)）· 14 卡
| 任务卡 | 状态 | 标题 | 优先级 | Phase |
|--------|:---:|------|:---:|:---:|
| TASK-CMP-01 | ✅ | 默认模板 seed（≥3 套）+ 首启空态引导 | P0 | A |
| TASK-CMP-02 | ✅ | Composer store 完整 actions | P0 | A |
| TASK-CMP-03 | ✅ | 模板管理 UI（body/slots/negativeBody/target/params） | P0 | A |
| TASK-CMP-04 | ✅ | 「另存为 Prompt」真流程（跳 Library + 高亮，修 alert） | P0 | A |
| TASK-CMP-05 | ✅ | 扩充内置 Fragment 库到 100 条（八类齐全 + v5 升级迁移） | P1 | B |
| TASK-CMP-06 | ✅ | Fragment 库左栏（两级树 + Fuse 搜索 + 收藏 + target 过滤 + 拖拽源） | P1 | B |
| TASK-CMP-07 | ✅ | Fragment 管理（自建/编辑/删除/收藏/筛选） | P1 | B |
| TASK-CMP-08 | ✅ | 槽位填充增强（replace/append/拖出移除） | P1 | B |
| TASK-CMP-09 | ✅ | 权重滑块增强（0.1–1.9 + reset + weightable 校验） | P1 | B |
| TASK-CMP-10 | ✅ | 实时预览参数面板（target 感知显隐 + 参数快照/制作台继承） | P1 | B |
| TASK-CMP-11 | ✅ | target 切换实时再序列化 | P1 | B |
| TASK-CMP-12 | ✅ | 负面提示词 target 适配（A1111/MJ --no/Flux/gpt-image） | P1 | B |
| TASK-CMP-13 | ✅ | 从预览面板直接生图（Composer→Generate） | P1 | B |
| TASK-CMP-14 | ✅ | 「在画布打开」入口（Library prompt→初始 body） | P2 | C |

### 3.3 Generate（[12](12-generation-deep-dive.md)）· 14 卡
| 任务卡 | 状态 | 标题 | 优先级 | Phase |
|--------|:---:|------|:---:|:---:|
| TASK-GEN-01 | ✅ | Provider CRUD + 预设一键 + 首启空态引导 | P0 | A |
| TASK-GEN-02 | ✅ | 密钥安全（safeStorage + hasKey/suffix + 硬化） | P0 | A |
| TASK-GEN-03 | ✅ | 测试连接 + 错误分类引导（401/429/余额/网络） | P1 | A/B |
| TASK-GEN-04 | ✅ | gpt-image-2 生成调用形式化（model 可配 + 全参数） | P0 | A |
| TASK-GEN-05 | ✅ | **Generate 统一创作台 + 探索/制作居中模式切换** | P0 | A |
| TASK-GEN-06 | ✅ | **统一时间线、结果组与 Library/Composer/History 跨入口** | P0 | A |
| TASK-GEN-07 | ✅ | **修复取消**：jobId 贯穿 + 取消按钮 + history cancelled | P0 | A |
| TASK-GEN-08 | ✅ | 重试：指数退避 + Retry-After + 「重试中」UI | P1 | C |
| TASK-GEN-09 | ✅ | 多 Provider 注册表 + 工厂（悟空为范例） | P1 | C |
| TASK-GEN-10 | ✅ | target 自动选择（按 Provider 渲染 Composition） | P1 | B |
| TASK-GEN-11 | ✅ | 失败/取消入历史 + 从历史重试 | P0 | A |
| TASK-GEN-12 | ✅ | 图片产物管理（落盘 + media:// + 打开目录 + 复制路径） | P1 | C |
| TASK-GEN-13 | ✅ | 成本估算（可配单价）→ 喂成本看板 | P1 | C |
| TASK-GEN-14 | ✅ | CSP + 权限加固 | P1 | D |

> **GEN 现状（2026-08-05）**：Generation 14/14 **已完成**——Generate 已切换为统一 Workbench；探索/制作共享时间线、Provider、取消/重试和 History；OpenAI/Wukong 均使用统一指数退避；Composer 进入制作前保存 Composition 快照，并按 Provider target 重渲染；图片产物管理、成本估算、生产 CSP 与默认拒绝权限策略已通过自动化验收。

### 3.4 History（[13](13-history-deep-dive.md)）· 14 卡
| 任务卡 | 状态 | 标题 | 优先级 | Phase |
|--------|:---:|------|:---:|:---:|
| TASK-HIS-01 | ✅ | 列表精修：三态徽标 + 空态文案对齐 + store 类型化 | P1 | C |
| TASK-HIS-02 | ✅ | 筛选栏（状态 + 日期范围 + Provider） | P1 | C |
| TASK-HIS-03 | ✅ | 右侧检视详情（大图/全提示词/全参数/错误/元数据） | P1 | C |
| TASK-HIS-04 | ✅ | 大图灯箱（缩放/上下张/键盘） | P1 | C |
| TASK-HIS-05 | ✅ | 系统集成：打开所在文件夹 + 复制路径 | P1 | C |
| TASK-HIS-06 | ✅ | 回填 Composer（历史→画布深化）🆕 | P1 | C |
| TASK-HIS-07 | ✅ | 另存为 Prompt（历史 prompt_text 入库）🆕 | P1 | C |
| TASK-HIS-08 | ✅ | 再次制作（回填 Workbench）+ 失败重试 | P1 | C |
| TASK-HIS-09 | ✅ | 失败重试 UX（错误码文案表 + 「重试中」进度态） | P1 | C |
| TASK-HIS-10 | ✅ | 删除与清理（单条 / 按时间 / 清失败+取消） | P1 | C |
| TASK-HIS-11 | ✅ | 图片文件管理（删源文件 + 磁盘占用感知） | P2 | E |
| TASK-HIS-12 | ✅ | 成本聚合查询 `db:history:stats` 🆕 | P2 | E |
| TASK-HIS-13 | ✅ | 单价配置（每 Provider·每图/每千 token） | P2 | E |
| TASK-HIS-14 | ✅ | 成本看板 UI（累计 + 按日周月 + 按 Provider + 图表） | P2 | E |

### 3.5 Chat（[14](14-chat-deep-dive.md)）· 11 卡
| 任务卡 | 状态 | 标题 | 优先级 | Phase |
|--------|:---:|------|:---:|:---:|
| TASK-CHT-01 | ✅ | Chat 快速生图核心打磨（多图/逐张/参数快照） | P1 | C |
| TASK-CHT-02 | ✅ | **收敛：Chat = Generate 工作区「快速」tab** | P1 | C |
| TASK-CHT-03 | ✅ | 取消 + 重试对齐（接 jobId / image:cancel，复用引擎） | P1 | C |
| TASK-CHT-04 | ✅ | Lightbox + 图片操作（放大/另存/打开文件夹/复制图） | P1 | C |
| TASK-CHT-05 | ✅ | **提升：Chat 消息 → 存为 Prompt（Library）** | P1 | C |
| TASK-CHT-06 | ✅ | **提升：Chat 消息 → 拆解到 Composer 画布** 🆕 | P2 | E |
| TASK-CHT-07 | ✅ | Provider/模型快切 + 参数内联 | P1 | C |
| TASK-CHT-08 | ✅ | 会话持久化决策 + 结果不丢兜底（全进 History） | P1 | C |
| TASK-CHT-09 | ✅ | 文案/心智一致性（生成/探索/制作/历史/资产统一） | P1 | C |
| TASK-CHT-10 | ✅ | 空态 + 首启引导（无 Provider 引导、双入口对齐） | P1 | C |
| TASK-CHT-11 | ✅ | **「探索 vs 制作」实际差异化（默认值/布局/结果动作）** | P2 | E |

### 3.6 差异化（[15](15-differentiators-deep-dive.md)）· 7 卡 · 全 P2 / Phase E（按 ROI 排序）
| 任务卡 | 状态 | 标题 | 预估 | 引擎就绪 | ROI |
|--------|:---:|------|:---:|:---:|:---:|
| TASK-DIF-01 | ✅ | **AST 点击反查高亮**（预览词 ↔ slot 双向） | S–M | 🟢 segments 已产出 | 最高 |
| TASK-DIF-02 | ✅ | 多 target 序列化产品化（切换器 + 并排 + 一键复制为 X） | M | 🟢 已就绪+单测 | 很高 |
| TASK-DIF-03 | ✅ | 版本管理 + diff（事件日志 + 快照 + 文本 diff + 分叉） | L | 🟢 已完成 | 中高 |
| TASK-DIF-04 | ✅ | 排列组合 permutation（多候选 → 笛卡尔积 → 批量生图） | L | 🟢 已完成 | 中 |
| TASK-DIF-05 | ✅ | 分享卡片 + deeplink（PNG + promptforge:// 导入） | L | 🟢 已完成 | 中 |
| TASK-DIF-06 | ✅ | 智能集合 + 搜索历史（保存筛选 + 最近 10 搜索） | M | 🟢 复用 list | 高 |
| TASK-DIF-07 | ✅ | Fragment 智能元数据（兼容/权重区间/冲突/同义词/多语） | M–L | 🟢 已完成 | 中低 |

### 3.7 引导·设置·数据（[16](16-onboarding-settings-data-deep-dive.md)）· 10 卡
| 任务卡 | 状态 | 标题 | 优先级 | Phase |
|--------|:---:|------|:---:|:---:|
| TASK-SET-01 | ✅ | 导出引擎 `system:export`（仅DB / DB+图片包 zip） | P0 | A |
| TASK-SET-02 | ✅ | 导入引擎 `system:import`（merge / replace / skip） | P0 | A |
| TASK-SET-03 | ✅ | Data 分区导入导出 UI（模式选择 + 进度 + 结果） | P0 | A |
| TASK-SET-04 | ✅ | 首启引导流（欢迎→配 Provider→校验→首图→seed） | P1 | B |
| TASK-SET-05 | ✅ | 备份：设置页可见 + 立即备份 + 从备份恢复 | P1 | D |
| TASK-SET-06 | ✅ | 生成默认值补齐（默认 Provider + background + 成本单价） | P1 | B/C |
| TASK-SET-07 | ✅ | 外观补齐：减少动效开关 + 界面密度 | P1 | B |
| TASK-SET-08 | ✅ | CSP + 权限硬化（session 头 + prod 严格 + media: 白名单） | P1 | D |
| TASK-SET-09 | ✅ | 危险区：清空全部数据（双重确认 + 强制先导出提醒） | P2 | D |
| TASK-SET-10 | ✅ | 关于分区补齐（版本 + 许可证 + 支持入口） | P2 | D |

### 3.8 UI/UX（[17](17-uiux-patterns.md)）
| 任务卡 | 状态 | 标题 | 优先级 | Phase |
|--------|:---:|------|:---:|:---:|
| ⏳ | 汇总中（前缀 TASK-UX；命令面板/快捷键/空态统一/撤销 toast/a11y 审查/可调三栏宽度等；比例选择子项已完成） | — | B–D |

---

## 4. Opus 派工建议

### 4.1 认领规则
1. **按 Phase 顺序**：先清 Phase A 全部 P0，再进 B。不要跳 Phase 摘 P2「好玩」的卡。
2. **按依赖顺序**：卡内 `依赖` 字段为空的先做（如 TASK-LIB-02 store 是多张卡的前置）。
3. **一次一卡**：每张卡是自包含单元，开发→自测→勾验收→回写状态，再认领下一张。
4. **契约不偏移**：涉及 IPC 的卡，严格对齐 `docs/07` 或卡内标注的 🆕 新增签名；新增通道要同步 `shared/types/ipc.ts` + preload + 主进程 handler 三处。

### 4.2 建议的 Phase A 执行序（关键路径）
```
并行起步（无依赖）：
  TASK-LIB-02 (store)  ┐
  TASK-LIB-05 (搜索)   ├─ 可同时开
  TASK-GEN-取消修复    │
  TASK-CMP-默认模板seed│
  TASK-SET-导入导出    ┘
接着（依赖就绪后）：
  LIB-02 → LIB-01(CRUD) → LIB-09(检视生成入口)
  LIB-02 → LIB-03(文件夹)
  GEN-取消修复 → GEN-Generate工作区挂载
  CMP-默认模板 → CMP-模板创建UI → CMP-另存跳转
闭环验证：
  跑「10分钟激活」端到端场景（见 §5.1）
```

### 4.3 并行安全提示
- **改公共契约的卡串行做**：动 `shared/types/ipc.ts`、preload、`electron/main/ipc/index.ts` 的卡，避免并行冲突。
- **纯前端组件卡可并行**：不同 feature 目录下的 UI 卡互不干扰。
- **DB migration 卡串行**：新增 migration 要保证 `user_version` 单调递增，不并行加两个同号迁移。

---

## 5. 验收门禁

### 5.1 端到端「10 分钟激活」场景（Phase A 出口）
1. 干净安装启动 → 看到 seed 文件夹 + 预设标签 + 引导空态
2. 进设置配 Provider（一键 TvT/OpenAI 预设 + 粘贴 key）→ 校验通过
3. Generate「快速」tab 输入一句 → 生成成功 → 图片落盘 + media:// 显示
4. 生成中点「取消」→ 成功中止 → History 记 `cancelled`
5. 再生成成功 → History 看到记录（缩略图/成本/耗时）
6. Chat/Generate 结果「存为提示词」→ Library 出现该条
7. Composer 选默认模板 → 拖 Fragment 填槽 → 预览更新 → 「另存为 Prompt」→ Library 高亮新条目
8. 导出 JSON → 重启/清库 → 导入 → 数据恢复

**全部通过 = Phase A 达标。**

### 5.2 每卡质量门禁（强制）
- [x] `npm run typecheck` 通过（`tsc --noEmit` 跨 node/web tsconfig）
- [x] 相关单测通过（引擎类改动跑 `npx vitest run`）
- [x] UI 可预览的卡：Electron E2E / preview 验证关键路径（见各卡「测试场景」）
- [x] 安全红线未破（密钥不入 DB/IPC/日志；网络端点不静默去鉴权）

### 5.3 发布门禁（Phase D 出口）
- [x] macOS ARM64 打包冒烟：启动、safeStorage、模拟生图、落盘/media://、History、导入导出/重置恢复
- [x] Windows ARM64 结构级包冒烟（macOS 交叉验证）：NSIS/PE、unpacked app、elevate helper、asar、product-docs、native dependency layout
- [ ] Windows hosted runner x64 安装后运行冒烟：测试已实现并接入 CI，待远端 Windows runner 执行 NSIS 静默安装、启动、假 Provider 生图、图片落盘/media://、History、导出/清库/导入、`promptforge://` 协议唤起与确认前不落库
- [x] Windows hosted runner 证据脚本：`npm run release:windows:hosted`；Windows runtime smoke 通过后生成 `windowsHostedRuntimeSmoke` JSON，记录 x64 installer SHA-256、Actions run URL、测试命令和安装/启动/假生图/`media://`/History/导入导出/协议唤起通过项，并在 CI 中上传 `windows-hosted-runtime-evidence` artifact
- [ ] Windows 目标平台运行冒烟：安装、启动、生图、落盘、导入导出、`promptforge://` 协议唤起
- [x] Windows ARM64 目标机验收清单脚本：`npm run release:windows:target`，输出当前 installer/app exe SHA-256、PE 架构校验、PowerShell 哈希命令、目标机手工/自动验收步骤和 `windowsArm64TargetRuntime` 证据 JSON 种子
- [ ] Developer ID 签名 + macOS 公证（当前本机构建无证书，仅开发验收）
- [x] Developer ID 签名环境预检脚本：`npm run release:signing:precheck`，默认不打印凭据、不修改产物，签名机可用 `--strict` 强制检查 Developer ID、notarytool/stapler、凭据环境、codesign/spctl/staple
- [x] macOS 签名公证证据脚本：`npm run release:macos:signing`；签名/公证/staple 后用 `--emit-evidence` 采集 codesign、Developer ID Team ID、spctl、DMG stapler validate、DMG/ZIP SHA-256，并输出 `macosDeveloperIdNotarization` JSON
- [x] CSP 生效（生产严格，media:// 放行）
- [x] `npm run check` + 完整无 API E2E 绿；`npm audit` 0 漏洞
- [x] 真实 TvT API 单图验收：`test_08_generation_workbench_live.py` 1 passed；`test_04c_generate_live.py` 连通性 + 真 PNG/成本/History 3 passed
- [x] GitHub Actions CI workflow 已配置：source checks + full E2E + macOS package smoke + Windows package + runtime smoke
- [x] GitHub Actions 远端绿灯证据脚本：`npm run release:ci:evidence -- --run-url <Actions run URL>`，读取 workflow run/jobs，校验 source checks、Electron E2E、macOS package smoke、Windows package/runtime smoke 全部 success，并输出 `githubActionsRemoteGreen` JSON 种子
- [ ] CI 绿（等待 GitHub Actions 首次远端运行通过）
- [x] 外部门禁证据模板与校验脚本：`docs/release-gate-evidence.template.json` + `npm run release:evidence -- --strict`，用于记录 CI/Windows/签名公证/真实 API 的客观证据
- [x] 用户提供的真实 API Key 精确扫描无仓库匹配；测试 profile/图片输出隔离
- [x] 历史 API 样例图、外部网页镜像和旧设计样例已从源码仓库清理，Git 历史负责追溯
- [x] 本地测试/缓存产物治理：`.gitignore` 覆盖 `test-results/`、`.pytest_cache/`、`__pycache__/`、`*.py[cod]`、`*.tsbuildinfo`、`.venv-test/`；`npm run clean:artifacts` 可清理测试缓存、构建输出和本地中间目录，保留受版本控制的研究素材
- [x] README 配置 Provider、推荐模型与故障排查完整

---

## 6. 状态看板（2026-08-06 回写）

> Opus 完成任务卡后，在对应 deep-dive 卡顶更新状态；**此处维护 Phase 级 + 域级汇总**。
> 当前事实以本看板、源码、自动化测试和对应版本文档为准；旧阶段进度记录已归档到 Git 历史。

### 6.1 Phase 级

| Phase | 主题 | 状态 | 完成估 | 出口验收 | 备注 |
|-------|------|------|--------|----------|------|
| A | 可用性闭环 | 🚧 **接近完成** | **~98%** | §5.1 端到端场景 | P0 主链路、首启引导、真实 TvT 单图与 macOS 包已验收；Windows hosted runner 运行冒烟已实现但待远端执行，Windows ARM64 目标平台运行待完成 |
| B | 组合与生产力 | ✅ 已完成 | **~100%** | 10/11 §7 | Composer 14/14、Library 15/15 与 Onboarding/设置联动已收口 |
| C | 生图历史专业化 | ✅ 已完成 | **100%** | 13/14 §7 | Workbench/取消/跨入口/自动重试、History 专业化和中文搜索已通过全量无真实 API E2E；发布平台验收单独归入 Phase A/D 外部门禁 |
| D | 数据安全与发布 | 🚧 进行中 | **~98%** | 16 §7 + §5.3 | Settings 10 卡、macOS ARM64 包/冒烟、Windows 结构级包冒烟、Windows runtime smoke 测试实现、CI workflow 配置、CI 远端证据脚本、Windows hosted runner 证据脚本、签名环境预检、macOS 签名公证证据脚本、Windows ARM64 目标机验收清单、测试产物治理、0 漏洞审计完成；Windows hosted runner 执行、Windows ARM64 目标平台运行、签名/公证、远端 CI 首跑待收口 |
| E | 差异化 V1 | ✅ 已完成 | **100%** | 15 §7 | AST 反查、多 target 产品化、版本/diff、排列组合、分享卡片 + deeplink、智能集合/搜索历史与 Fragment 智能元数据均已补齐 |

### 6.2 功能域级（85 卡）

| 域 | 名称 | 卡数 | ✅ | 🚧 | 📋 | 当量完成 |
|----|------|-----:|--:|--:|--:|--------:|
| LIB | Library | 15 | 15 | 0 | 0 | **100%** |
| CMP | Composer | 14 | 14 | 0 | 0 | **100%** |
| GEN | Generation | 14 | 14 | 0 | 0 | **100%** |
| HIS | History | 14 | 14 | 0 | 0 | **100%** |
| CHT | Chat/探索 | 11 | 11 | 0 | 0 | **100%** |
| SET | 设置·数据 | 10 | 10 | 0 | 0 | **100%** |
| DIF | 差异化 | 7 | 7 | 0 | 0 | **100%** |
| **合计** | | **85** | **85** | **0** | **0** | **100%** |

### 6.3 Phase A 出口自检（§5.1）

| # | 场景 | 状态 |
|---|------|:---:|
| 1 | 启动 App 无报错 | ✅ |
| 2 | 配置 Provider + 存 Key | ✅ |
| 3 | 测试连接 | ✅ |
| 4 | 生成工作台制作一张图 | ✅ |
| 5 | 历史可见成功记录 | ✅ |
| 6 | Library 新建/搜索/收藏 | ✅ |
| 7 | Composer 选默认模板填槽预览 | ✅ |
| 8 | 另存为 Prompt | ✅ |
| 9 | 导出备份包 | ✅ |
| 10 | 取消进行中的生图 | ✅ |

→ **Phase A 场景出口基本达标**；CSP/权限硬化、真实 TvT 单图、macOS ARM64 未签名包与 Windows ARM64 结构级包已验收，剩余是 Windows 目标平台运行、Windows hosted runner 实跑、CI 远端绿灯及签名/公证环境验收。

### 6.4 macOS 发布证据（2026-08-06）

- 工具链：Electron `43.2.0`、electron-builder `26.15.3`、better-sqlite3 `13.0.2`；`npm audit` 为 0。
- `npm run check`：35 个 Vitest 文件 / 235 项通过；FTS 纯 JS 分词单测 3 passed，DIF-04 permutation 单测 3 passed、真实 Electron permutation 专项 E2E 2 passed；DIF-05 分享 payload 单测 4 passed、main-process share-protocol queue 单测 3 passed、真实 Electron 分享专项 E2E 2 passed；DIF-07 专项 9 passed；关联回归 `test_03c + test_03d` 10 passed、harness + data layer 26 passed、Composer audit 26 passed；完整无 API Electron E2E：251 passed / 6 skipped / 0 failed（638.19 秒）；Workbench 专项 17 passed（含 CHT-05 存为提示词闭环、CHT-06 拆到画布、CHT-10 三态空态、示例即点即生、自绘比例预览、会话标题/新会话重置、fake `/v1/models` 模型列表、360×740 无横向溢出和移动端设置分区菜单）；History 专项 16 passed；Onboarding 专项 5 passed；成本单价与 `history.cost` 由 `test_provider_pricing_ui_and_history_cost` 覆盖。
- 测试产物治理：`npm run clean:artifacts -- --dry-run` 能列出 `.electron-driver`、`.pytest_cache`、`test-results`、`tests/**/__pycache__`、`*.tsbuildinfo`、构建输出和本地中间目录；清理规则保留受版本控制的研究素材，不保留根目录 API 样例图或外部网页镜像。
- 发布前本地预检（2026-08-06）：新增 `npm run release:preflight` 并接入 CI source checks，快速核对 renderer 无原生 `<select>`、旧 Studio/旧 generation 生成 API 不回流、比例预览与旧版常用画幅仍在、85 张任务卡全 ✅、外部门禁仍明确、CI workflow 覆盖源码/E2E/打包/Windows host runtime smoke/本地预检且无重复 `path: |` 缓存块、随包文档只来自当前 product docs、源码/测试/文档无疑似真实 Key、测试缓存产物已清理；该命令只证明本机自动门禁，不替代真实 API、远端 CI、Windows 目标机和签名/公证验收。
- 本地发布产物状态（2026-08-06）：新增 `npm run release:status`，在打包后核对 macOS/Windows release 产物存在、输出 SHA-256 与字节数、随包 `product-docs` 与 `docs/product` 完全一致、开发 `package.json` manifest 未被裁剪、测试缓存为 0，并把 GitHub Actions 远端绿灯、Windows hosted runner runtime、Windows ARM64 目标机和 Developer ID 签名/公证列为仍需外部证据的门禁；随后新增 `npm run release:evidence` 与 `docs/release-gate-evidence.template.json`，用于把这些外部门禁及真实 API 复测的 URL、哈希、设备、命令和通过项记录成可校验 JSON，`--strict` 模式要求全部证据齐全。
- CI 远端绿灯证据脚本（2026-08-06）：新增 `npm run release:ci:evidence`；默认离线校验 `release/release-gate-evidence.json` 的 `githubActionsRemoteGreen` 块，拿到 Actions run URL 后可用 `--run-url` 调 GitHub REST API 读取 workflow run 与 jobs，校验 source checks、Electron E2E、macOS package smoke、Windows package/runtime smoke 全部 success，并输出可直接合入外部门禁证据 JSON 的字段；脚本只读取 `GITHUB_TOKEN`/`GH_TOKEN`，不打印 token。
- Windows hosted runner 证据脚本（2026-08-06）：新增 `npm run release:windows:hosted`；默认离线校验 `release/release-gate-evidence.json` 的 `windowsHostedRuntimeSmoke` 块，Windows runner 在 `tests/package/windows_runtime_smoke.py` 通过后用 `--runtime-smoke-passed` 生成 x64 installer SHA-256、Actions run URL、测试命令与 runtime smoke 通过项，并由 CI 上传 `windows-hosted-runtime-evidence` artifact；脚本在非 Windows 生成模式会失败，避免误把本机 ARM64 结构包哈希当作 hosted runtime 证据。
- 签名环境预检（2026-08-06）：新增 `npm run release:signing:precheck`，默认只读检查 electron-builder mac 配置、macOS 签名工具、当前 release 产物哈希、Developer ID Application 身份、`CSC_*`/Apple notarization 环境变量、`codesign`/`spctl`/`stapler` 当前状态，且不打印凭据值；本机结果为配置/工具/产物通过，Developer ID 身份、签名选择、notarization 凭据、codesign/spctl/staple 仍为 manual，签名机公开发布前需用 `--strict` 通过。
- macOS 签名公证证据脚本（2026-08-06）：新增 `npm run release:macos:signing`；默认离线校验 `release/release-gate-evidence.json` 的 `macosDeveloperIdNotarization` 块，签名机在 Developer ID 签名、notarization accepted、DMG staple 后用 `--emit-evidence` 验证 `codesign --verify --deep --strict`、Developer ID Team ID、`spctl --assess`、`xcrun stapler validate`，并输出 DMG/ZIP SHA-256 与四个通过项。当前本机未签名包在生成模式下会失败，避免误报已签名/已公证。
- Windows ARM64 目标机验收清单（2026-08-06）：新增 `npm run release:windows:target`，本机只读检查 Windows installer 与 `win-arm64-unpacked/PromptForge.exe` 存在、SHA-256、NSIS i386 stub / ARM64 PE 标记、随包 product-docs 同步，并输出目标设备 PowerShell 哈希命令、安装/启动/假生图/`media://`/History/导入导出/`promptforge://` 清单和 `windowsArm64TargetRuntime` 证据 JSON 种子；本轮补充验证 `--json --out release/.tmp-windows-target-seed.json` 可直接落盘该种子，测试后已清理临时文件；默认缺少目标机证据时列 manual，目标机验收完成后可用 `--strict` 验证。
- 打包 manifest 防裁剪（2026-08-06，2026-08-20 路径迁移）：`package:*` 脚本经 `scripts/run-builder.mjs` 调用 electron-builder；Phase 1b 后 wrapper 保护 `apps/desktop/package.json`，根 workspace manifest 的 scripts/devDependencies 不再进入 builder 裁剪面。本机 macOS 与 Windows ARM64 打包均已复验。
- 默认 Provider 源迁移回归（2026-08-05）：`defaultProviderId` 以 `useAppStore` 为主源，Workbench / Generation 兼容路径统一兜底；旧 `studio/store` 已删除，回归改由 `test_workbench_retry_falls_back_to_default_provider` 覆盖；`npm run check` 35 files / 235 tests、`test_04_generate.py` 25 passed、`test_05_settings.py` 43 passed、`test_08_generation_workbench.py` 17 passed。
- 正式跨入口迁移回归（2026-08-05）：Library、History、Composer 已直接调用 Workbench `openDraft`，不再调用旧 `generation/store.requestRefine`；`test_02_library.py + test_06_history.py` 45 passed、`test_03e_composer_params.py` 7 passed、`test_08_generation_workbench.py` 17 passed。
- 旧生成状态收口回归（本轮）：`generation/store.ts` 已收敛为 Provider 配置 store，旧 `requestRefine`、`generateRefine`、`refine*`、旧取消/重试动作和 Workbench legacy bridge 已删除；`npm run typecheck` 通过、Vitest 35 文件/235 用例通过、`test_04_generate.py` 25 passed、Workbench 17 passed、设置 + Library/History/Composer 关联回归 95 passed；无真实 API live 套件 6 skipped。
- 比例预览摘要回归（2026-08-06）：`test_08_generation_workbench.py` 全部 17 passed，`test_03e_composer_params.py` 7 passed，`test_05_settings.py` 43 passed；额外断言工作台选中预览从竖向比例更新、设置页摘要从竖屏切换为宽屏，且页面不存在原生 `<select>`。随后补齐旧版/Wukong 常用 `3:4`、`4:3`、`4:5`、`5:4`、`21:9` 画幅，单测覆盖新增比例对合法 OpenAI 像素档的映射，E2E 覆盖 `4:5` 商品竖图、`5:4` 商品横图、`21:9` 超宽预览与设置页常驻预览网格。本轮 UI 收口追加验证：比例触发器均为 `button`，工作台和设置页下拉内均存在 `role=listbox` 卡片网格，设置页下拉摘要也会随竖屏/宽屏比例呈现真实方向。
- 真实 TvT API 回归（2026-08-06）：使用临时环境变量执行，不写入仓库/DB/localStorage/报告；`test_08_generation_workbench_live.py` 1 passed，覆盖 Workbench 制作模式低质量单图、图片落盘、`media://` 预览和 History 成功记录；`test_04c_generate_live.py::test_live_validate_connection_reports_model` 与 `test_live_generate_writes_real_png_and_history` 通过，随后增强 SHA-256 输出并重跑真 PNG 用例 1 passed，最终观测 1254×1254、约 1081KB、`duration_ms=17492`、成本 32 分、图片 SHA-256 `c6d80a30ef8fe473aa59982116c58314014b7a98313b1ae81eaa545348ac7e8b`。
- 打包版冒烟门禁覆盖版本/DB v8/100 条 Fragment seed、Fragment 模糊搜索/兼容过滤、用户片段 CRUD 与内置只读、Composer 参数快照/制作台继承、DIF-01/DIF-02/DIF-03/DIF-06/DIF-07 随包文档断言、mock-keychain 下的 safeStorage、模拟 OpenAI 生图、better-sqlite3 ARM64 原生模块、JS 侧 FTS 分词、`media://`、History、导出/重置/导入恢复、旧 Chat/Studio 页面组件与 `studio/store` 已清理，以及 GEN-13/HIS-14/CHT-05/CHT-06/CHT-09/CHT-10 随包文档断言。
- 旧阶段安装包与其哈希交接记录已从工作树清理。后续发布产物只由当前源码生成，哈希写入包外发布证据，不回填到产品文档。
- 限制：本机无 Developer ID，electron-builder 跳过签名，`codesign --verify --deep --strict` 返回 `code has no resources but signature indicates they must be present`；不可把当前产物描述为已签名/已公证发布包。

### 6.5 Windows 发布证据（2026-08-05）

- FTS 搜索已移除 native `@node-rs/jieba` 运行时依赖，改为 JS 侧汉字序列、单字、双字片段与英文词预分词；避免 Windows 交叉包携带 darwin native 模块或缺失 win32 native 模块。
- `npm run package:win -- --arm64` 已在 macOS 交叉构建 Windows ARM64 包，生成 `PromptForge Setup 0.1.0.exe` 与 `win-arm64-unpacked/PromptForge.exe`。
- `tests/package/windows_package_smoke.py` 1 passed：校验 NSIS installer PE、ARM64 app PE、elevate helper、随包 product-docs、asar 中 better-sqlite3 存在，且旧 `@node-rs/jieba*` native dependency 不再随包。
- Windows 10 x64 运行态烟测（2026-08-06）：远程 Windows 10 Pro 19045.7548 / AMD64 / PowerShell 5.1 / Node 24.12 / npm 11.6 / Python 3.10 机器先以 `npm ci --legacy-peer-deps` 安装依赖，再通过 `scripts/run-builder.mjs` 修复 `electron-builder.cmd` 的 Windows `spawn EINVAL` 后成功 `npm run package:win -- --x64`；随后 `tests/package/windows_runtime_smoke.py` 1 passed，覆盖静默安装、假 Provider 生图、`media://` 预览、History、导出/清库/导入与 `promptforge://` 唤起。该证据是 LAN x64 运行态，不等价于 GitHub-hosted runner 证据。
- `npm run release:windows:target`：通过本地结构/哈希/文档同步检查，并把 Windows ARM64 真机验收需要记录的设备、系统版本、安装、启动、假 Provider 生图、`media://`、History、导入导出与 `promptforge://` 项目整理成可粘贴进 `release/release-gate-evidence.json` 的字段。
- 限制：该测试是结构级验收，不等价于目标 Windows 设备运行验收；仍需在 Windows ARM64 上执行安装、启动、模拟/真实生图、落盘、导入导出与 `promptforge://` 协议唤起。

### 6.6 CI 发布证据（2026-08-06）

- `.github/workflows/ci.yml`：Ubuntu 跑 `npm run check`、`npm audit --json`、`npm run clean:artifacts`、`npm run release:preflight` 与全量 Electron E2E；macOS 跑 `npm run package:mac`、`hdiutil verify` 与 macOS package smoke；Windows 跑 `npm run package:win -- --arm64`、ARM64 结构 smoke、x64 host 包构建与 Windows runtime smoke。
- package jobs 复用 Electron / electron-builder 缓存，降低远端首跑下载抖动。
- Workflow 默认清空 `PF_TVT_KEY`，因此只跑无 API E2E；真实 TvT 单图已在本机用临时环境变量完成验收，不进入 CI 常规流程。
- macOS package smoke 后额外运行 `npm run release:macos:signing`，只提示签名证据 manual，不把未签名 CI 包当作发布包；真正证据必须在 Developer ID 签名机用 `--emit-evidence` 生成。
- 新增 `requirements-test.txt` 固化 Python 测试依赖为 `pytest==9.1.1` 与 `playwright==1.62.0`，供本地和 CI 共用。
- Windows CI 追加 host x64 安装后运行冒烟：先保留 ARM64 结构级包检查，再用 x64 包在 hosted runner 上验证安装、真实 Electron 主进程、假 Provider 生图、导入导出和 `promptforge://` 唤起；测试实现与 CI 接入已完成，本机 macOS 按平台条件 skipped，等待远端首跑；该项不替代 ARM64 目标机验收。跨平台无证书构建通过 `win.signExecutable: false` 保留资源编辑并跳过签名。
- Windows hosted runtime 证据脚本：Windows job 在 runtime smoke 通过后运行 `npm run release:windows:hosted -- --runtime-smoke-passed --out release/windows-hosted-runtime-evidence.json`，并用 `actions/upload-artifact@v4` 上传 `windows-hosted-runtime-evidence`；拿到 artifact 后可将 `windowsHostedRuntimeSmoke` 合入 `release/release-gate-evidence.json` 再跑 `npm run release:evidence -- --strict`。
- CI 远端绿灯证据脚本：`npm run release:ci:evidence -- --run-url <Actions run URL>` 会读取 GitHub workflow run/jobs，确认 source checks、Electron E2E、macOS package smoke、Windows package/runtime smoke 全部 success，并输出 `githubActionsRemoteGreen` JSON；没有 run URL 时只校验本地证据文件，`--strict` 要求证据存在。
- 外部门禁证据脚本：`npm run release:evidence` 默认检查 `release/release-gate-evidence.json`，缺失时只列为 pending；拿到全部外部结果后用 `--strict` 强制检查 GitHub Actions run URL、Windows hosted runner x64 runtime、Windows ARM64 目标机、Developer ID 签名/公证和真实生图的哈希/命令/布尔验收项，且拒绝疑似 API Key 或 secret 字段。
- 限制：这只是 workflow 配置完成，不等于 GitHub Actions 远端已出绿灯；远端首跑通过后再把 5.3 的 CI 门禁勾成 ✅。

### 6.7 回写规则（给后续开发者）

1. 改代码完成一张卡 → 同步改 deep-dive 卡顶 `**状态**` + 本表状态列 + §6.1/6.2 汇总。
2. 仅当验收标准可客观勾选时标 ✅；有主路径但缺打磨标 🚧；未开工保持 📋。
3. 不要只改本索引不改 deep-dive（或相反）——两处必须一致。

### 6.8 路线图后增强验收记录（2026-08-06）

本次增强未伪装成既有任务卡，单独记录为产品闭环增强：

- Library：列表默认、网格切换、舒适/紧凑密度、实色卡片、作品检视、Lightbox、失效图片和成功/失败/取消切换已实现。
- Workbench：制作模式引用侧栏默认展开，可折叠/窄屏抽屉；搜索不污染 Library；整条/选段引用可独立删除；提交不因引用点击自动生图。
- Data：migration 0009、history.related、成功/失败/取消引用写入、重试快照、导入/导出/重置已完成。
- 质量门禁：关联 Vitest 39 passed；全量无真实 API E2E 257 passed、6 skipped、0 failed；生产构建通过；1440px 深浅色、1100px、800px 视觉验收完成；清理测试产物后 `npm run release:preflight` 通过。
- 真实 API：本轮不重复回显或写入密钥；同日既有 TvT `gpt-image-2` 真 PNG 验收继续有效，引用最终 Prompt 已由假 Provider 和历史数据库断言覆盖。

### 6.9 作品关联错误修复与 v10 验收（2026-08-06）

- 修复 `db:history:related` 在旧 Electron 主进程中未注册时把错误暴露到作品面板的问题：前端显示能力状态和重启提示，兼容回退只展示可确定的直接来源，不渲染虚假的 0 条记录。
- 新增 `db:history:linkPrompt`：Workbench/History 的「存为提示词」创建后显式关联成功历史，并保存 `history://<historyId>` 稳定来源和首张成功图片预览。
- 新增 migration `0010_backfill_saved_prompt_history`，DB 版本由 9 升至 10。只回填“手动提示词、成功且有图片、未被其他提示词占用、正负正文精确一致、生成后 10 分钟内保存”的记录；禁止模糊匹配，避免把相同文案的不同作品错误归类。
- 作品面板增加关联原因标签：直接制作、引用整条、引用选段、由作品保存；查询结果携带 `promptRelations`，方便用户判断来源。
- `npm run check`：typecheck 通过，Vitest `39 files / 255 tests passed`，production build 通过。
- `.venv-test/bin/python -m pytest tests/e2e -q`：`257 passed, 6 skipped`，真实 API 测试按环境条件跳过；本轮没有重复真实生图调用。

### 6.10 网格照片册与关联血缘补强（2026-08-06）

- Library 网格改为作品优先的可交互照片册：桌面固定两列、内容区低于 520px 单列；单卡最多显示 4 张关联成功图片，并按 1/2/3/4 张自适应拼贴，点击图片或数量进入作品分栏。
- 无关联作品时回退提示词封面或正文，封面明确标注且不参与关联判定；图片失效不会破坏网格布局。
- History「再次制作」和 Workbench 的继续探索/采用方向制作保留明确的 prompt id 血缘；新历史仍记录 parent history id，直接来源不会因跨模式操作丢失。
- 关联文案抽为共享函数，网格相册和右侧作品面板统一显示直接制作、引用整条、引用选段、复合引用和由作品保存。
- 定向验收：typecheck 通过，关联/Workbench Vitest 4 files / 39 tests passed；Library 网格、作品面板、History 血缘 E2E 3 passed；桌面实际数据视觉检查确认两列布局、单图/四图拼贴和作品数量入口无重叠。

### 6.11 Windows x64 目标机安装验收（2026-08-07）

- 目标机确认为 Windows 10 Pro `10.0.19045.7548` / `AMD64`，本轮支持结论限定为 Windows x86-64（x64）；32 位 `ia32` 尚未适配和验收，不进入当前发布矩阵。
- Windows 本机重建 Electron `43.2.0` 与 `better-sqlite3 13.0.2` x64 依赖；About 与 Wukong 两组测试移除 POSIX 路径和跨 realm `Buffer` 假设。
- `npm run check`：typecheck、Vitest `39 files / 255 tests`、main/preload/renderer production build 全部通过。
- `npm run package:win -- --x64`：NSIS 构建通过，主程序 PE Machine 为 `0x8664`（AMD64）。
- `.venv-test\Scripts\python -m pytest tests\package\windows_runtime_smoke.py -q`：`1 passed`，覆盖静默安装、启动、DB v10、假 Provider 生图、图片落盘、`media://`、History、导出/重置/导入与 deeplink 导入；未调用真实 API。
- 已安装到当前 Windows 用户的 `%LOCALAPPDATA%\Programs\PromptForge`，开始菜单快捷方式与 HKCU 卸载项均存在。当前包未签名，只作为内网验收包；正式分发仍需代码签名。

### 6.12 v0.2.2 单一工作台与 UI 收口（2026-08-10）

- 工作台取消探索/制作开关，数量、来源、提示词引用和微调上下文成为彼此独立的普通能力；底部仅保留一个 Composer，配方交接不自动生图。
- recipe DB schema 11 新增持久会话及 run 的轮次/结果排序；`workbenchSession.*` 支持读取、重命名、归档和软删除。recipe-db export schema 3 覆盖导出、导入、替换、重置和备份恢复。
- 全 App 收敛为实色、细边框和统一图标契约；五项导航、命令面板、两列提示词照片册、配方五页、历史与设置完成深浅主题和 1440/1100/800/640 响应式验收。
- `npm run check`：130 files / 686 tests；完整无 API Electron E2E：196 passed / 9 skipped；视觉 2 passed；可访问性 2 passed。
- 真实 API：文本模型发现、对话与结构化配方草稿 2 passed；Skill 本地结构镜像到 `gpt-image-2` 真实图片 1 passed / 61.85s。远程 GitHub 因匿名限流和 TLS/HTTP2 网络失败未作为通过项；产物证据明确标记 `local-fixture`。
- 当前源码版本为 `0.2.2-dev`。产品与本地质量门禁完成；签名、公证、Windows 商业代码签名和正式安装包归档仍按 v0.2 发布门禁单独执行。
