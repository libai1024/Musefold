# 06 设计方案 — 旧版全量记录 vs v2.5(暂缓域迁移蓝图)

> **用途**:设计方案是 V25-UI-SPEC §0.2 登记的暂缓域——主进程语义完整保留(`apps/desktop/electron/main/design-scheme/`,automation/CLI/MCP 直连),渲染层在 v2.5 新壳中**尚无任何入口**。本文的性质与其他篇不同:不是「差距清单」,而是**旧版 UI/UX 的全量存档 + 未来迁入 v2.5 面时的蓝图基准**。排卡前禁止顺手实现或删除(CLAUDE.md 暂缓域红线)。
> **旧版源码**:`apps/desktop/src/features/design-schemes/*`(19 文件,4,124 行):`DesignSchemesPage`(600 行)/ `SchemeControlDeck` / `SchemeListPrimitives` / `SchemeListActions` / `SchemeInspector` / `SchemeRuntimeDetail` / `SchemeRuntimeDetailSections` / `SchemeRuntimeAlbum` / `SchemeRuntimeDialogs` / `SchemeCreationConversation` / `SchemeRunConversation` / `SchemeRunComposer` / `SchemeRunPicker` / `HistorySourcePicker` / `creation-store` / `run-store`。

---

## 1. 域概念模型(迁移时的领域词汇表)

- **方案(scheme)**:可反复使用的生成配方,分**草稿(draft)**与**正式(formal)**两态;草稿必须完成一次本机**试运行(trial)**成功后才能「设为正式」。
- **保真度(fidelity)**:`verified 已验证 / faithful 完整还原 / adapted 有取舍 / unsupported 暂不支持`——来源仓库能力与本地运行时的匹配程度,行内以圆角描边徽标展示。
- **来源(source)**:GitHub 仓库(带 commit 追踪,支持「检查更新」)、历史内容提取、提示词升级、`.musefold.design` 分享包导入。
- **输入槽位(inputs)**:方案的必需变量/可选变量;被 promptProgram 模板 `{{变量}}` 引用的文本槽位不可删除。
- **版本(revision)**:修改输入要求即生成新 revision,需重新试运行才能设为正式;上游更新自动编译为「待验证草稿」,校验后可**替换正式版本**。

## 2. 旧版布局(迁移蓝图)

```text
┌ SchemeControlDeck(顶部控制台)──────────────────────────┐
│ scope tabs: 我的方案 | 发现(市场)   搜索框   刷新  新建 │
├ 列表区(SchemeListSection 分节)── ┬ SchemeInspector 右栏 ┤
│ mine: 正式区 + 草稿区              │ 生命周期状态卡        │
│  RuntimeSchemeRow:                │ (可继续/待试运行)     │
│   56px 封面 | 名称+保真度徽标      │ 摘要/来源/运行记录    │
│   摘要 | 来源(GitBranch 图标)     │ [开始/继续试运行]     │
│   行尾: 主动作钮(使用/继续/试运行) │ [查看完整详情]        │
│         + hover 删除钮             │                      │
│ discover: MarketCandidateRow      │                      │
│   + MarketInstallDialog 安装确认   │                      │
└ 点行 → SchemeRuntimeDetail 全屏详情 ──────────────────────┘
   返回 | 名称/状态(正式/草稿) | 动作组(修改/设为正式/导出/检查更新/主动作)
   文档分节(SchemeRuntimeDocumentSections):固定规则/输入要求(草稿可编辑
   staged 槽位,保存生成新 revision)/prompt 程序
   RuntimeAlbum:试运行产物相册
```

关键布局事实:

- 列表行 grid `56px 封面 | 内容 | 主动作 | 删除`,行高 ≥76px;草稿未试运行成功时名称前有 accent 圆点(待办信号)。
- 主动作文案随状态:正式=「使用」,有成功试运行的草稿=「继续」,新草稿=「试运行」;Inspector 内对应「开始/继续试运行」。
- 市场(discover)**不自动加载**,只在用户显式搜索时请求(`marketSearch`);添加候选走「下载快照 → Agent 编译草稿」管线,过程在工作台 Composer 以对话形式呈现(`SchemeCreationConversation`)。
- 删除是 hover 渐显 + 确认弹窗(`SchemeListRemoveDialog`),文案区分「删除草稿 / 移除方案」。

## 3. 旧版交互全量清单(验收基准)

1. **新建入口**(`scheme-create` 菜单):从 GitHub 仓库创建 / 从历史内容创建(`HistorySourcePicker`:多选历史图 + 提示词,生成提取说明)/ 导入分享包(`.musefold.design`,校验后生成草稿并直达详情,toast「完成一次本机试运行后可设为正式」)。
2. **试运行**:进入工作台方案运行模式(`SchemeRunComposer`,Composer 锁定为「方案运行」态,`SchemeRunVariableFields` 渲染变量表单),运行过程 `SchemeRunConversation` 对话呈现;成功后 Inspector 生命周期从「待试运行」→「可继续」。
3. **设为正式**:主进程校验(必须有成功试运行),失败 toast「还不能设为正式」+ 原因;成功后「现在可以在 Composer 中直接使用」。
4. **修改输入要求**(草稿限定):槽位编辑为 staged 态,保存一次性生成新 revision,toast「需要重新试运行后才能设为正式」。
5. **检查更新**(GitHub 源):对比上游 commit,有变化自动编译为待验证草稿;「替换正式版本」需新版本已有成功试运行。
6. **导出**:仅正式方案可导出 `.musefold.design` 分享包。
7. **跨屏入口**:工作台 Composer「+」菜单(生成设计方案/从历史创建/寻找方案)、提示词详情「创建方案」菜单项、`useAppStore` intent(`surface` 深链)。
8. **Automation 面**:以上全部能力同时暴露给 CLI/MCP/Automation API——迁移渲染层时不得改主进程接口语义。

## 4. 旧版动效与状态细节

- 列表行 hover 背景过渡 + 删除钮 opacity 渐显(与 v2.5 行动作组口径一致,可直接映射)。
- 选中行 `border-accent/15 bg-accent-soft`(主色软底,区别于其他屏的中性选中——因为 Inspector 常驻,选中是强状态)。
- 创建/运行对话在 Composer 时间线内逐步呈现(流式 trace),复用 03 的 preface 挂点;`animate-scale-fade-in` 用于浮层。
- 空态:mine 空=「没有找到匹配的方案」+ 新建引导;discover 未搜索=搜索引导态,搜索空=无结果态;市场错误就地错误条。
- 加载:市场搜索 loading 态在搜索框旁;安装候选走对话式进度,不用全屏 spinner。

## 5. v2.5 迁入蓝图(排卡时的任务拆分建议)

前置依赖(按序):

1. **契约先行**:`packages/contracts` 新增 designScheme 域 schema(summary/detail/inputs/revision/market candidate),从旧 `desktop-contracts/design-scheme` 翻译,云端语义(是否入 PG)由架构卡决定——v2.5 首阶段建议**桌面 only + 能力开关 `hasDesignSchemes`**,Web 隐藏入口。
2. **导航**:`SHELL_NAV_ITEMS` 恢复 `design-schemes` 项(旧 ProductViewIcon 用 Blocks 图标),桌面宿主目录先行。
3. **屏骨架**:`packages/features/src/schemes/`,复用现有组件系:scope tabs=shadcn Tabs,行=参照 `PromptListRow` 结构(56px 封面 + 主动作 + hover 组),Inspector=参照 `HistoryInspector`(lg+ aside / 窄屏 Sheet),市场安装确认=AlertDialog。
4. **详情页**:v2.5 壳内以整屏视图承载(宿主 view 切换),分节结构承旧 `DetailSection`;槽位编辑的 staged 语义保留。
5. **工作台挂点回填**:03 登记的 preface(创建/运行对话)、Composer「+」菜单项、模式 tab、变量表单——与本域同卡交付。
6. **跨屏意图**:`useScreenIntent` 扩展 `schemes-surface` payload(承旧 `intent.surface` 深链)。
7. **工艺基线**:迁入时 UI 工艺直接按 [00-codex-craft.md](./00-codex-craft.md) 执行(六态/动效 token/行解剖/kbd),不再为本域单独发明;保真度徽标、生命周期状态卡等新组件按 00 §2 法则 1(状态色只在状态处)与法则 3(圆角 ≤3 种)设计。本域暂缓期间不排 C 卡。

迁移验收口径:§3 的 8 条交互全部可走通;automation 直连行为与渲染层操作产生的数据一致;三形态视觉快照 + 00 §8 评审检查单;V25-UI-SPEC 增补 §「设计方案」章节并把本文降级为历史存档。

## 5.1 状态矩阵存档(迁移验收基准)

| 面 | loading | error | empty | ready |
|---|---|---|---|---|
| 我的方案 | 列表骨架 | 就地错误 + 重试 | 「没有找到匹配的方案」+ 新建引导 | 正式/草稿分节 |
| 发现(市场) | 搜索中态在搜索框旁 | `marketError` 就地错误条 | 未搜索=引导态;搜索空=无结果 | 候选行 + 安装 |
| Inspector | 随选中即时渲染 | — | 未选中不渲染 | 生命周期卡 + 动作 |
| 详情 | 整屏骨架 | 错误卡 + 返回 | — | 文档分节 + 相册 |
| 试运行相册 | 缩略骨架 | 失败图占位 | 「还没有试运行记录」 | 产物网格 |

动效存档:候选安装与创建管线的进度以对话流呈现(不用进度条,与 Skill trace 同语言);列表行与 Inspector 直切;删除确认 `dialog-in`。全部过 reduce 闸门(依赖 07-03 P0 先行)。

## 6. 差距声明

当前 v2.5 面:**0% 迁入,0 个入口,主进程能力 100% 保留**。在排卡前唯一允许的动作:
- 保持 `electron/main/design-scheme/` 与 automation 通路不回归(现有集成测试守护);
- 新壳/新屏实现时为上述挂点留槽(03/04 已登记),不做死入口(D2)。
