# 07-07 设置 · 关于 App — 旧版 vs v2.5 对照

> **旧版源码**:`AboutAppSection`(装配)= `AboutSection`(244 行)+ `AboutContentLayerRow` + `AboutUpdateRow`(102 行)+ `UpdateChannelRow`(155 行)+ `AboutSupportCard` + `third-party-notices.ts`。
> **新版源码**:`packages/features/src/settings/AboutCard.tsx`(品牌 + 版本 + 支持资源 + 快捷键三卡)+ `third-party-notices.ts`(静态许可清单,双端同一份);设置分区 `about`(group `app`,双端注册)。
> **状态(2026-09-06)**:应用信息 / 支持资源 / 快捷键表 P2 **已交付**;更新体系(应用更新 / 内容层 / 通道)仍是登记暂缓域,卡内不出现。

---

## 1. 结论与迁移状态

「关于 App」承载四类内容:**应用信息**(品牌/版本/数据库结构版本)、**更新体系**(应用更新 + 内容层热更新 + 更新通道切换)、**支持资源**(文档/反馈/第三方声明)、**快捷键表**。其中更新体系是登记暂缓域;应用信息、支持资源与快捷键表已随 B1-T6 迁入(双端同一张卡:桌面经 `system.getAppInfo` 给版本/平台/库结构版本与只读更新通道,Web 版本行显示「Web 版」)。

## 2. 旧版结构存档(恢复基准)

### 2.1 应用信息卡(`about-brand`)

- 品牌面板:logo + 产品名 + slogan;版本行(App 版本 + 数据库 schema 版本);「复制版本信息」(toast「版本信息已复制」——报障粘贴用,含版本/平台/schema 汇总)。

### 2.2 更新体系(暂缓域挂点)

- **应用更新行**(`AboutUpdateRow`):当前版本/检查更新/下载进度/重启安装,状态机完整;失败 toast「更新操作失败」。
- **内容层行**(`AboutContentLayerRow`):内容包(Skill/预设等)独立热更,「内容更新检查失败」独立报错。
- **更新通道行**(`UpdateChannelRow`,155 行):stable/beta 等通道切换,失败双路径 toast(「切换更新通道失败」+ message);通道语义连着 release.yml 发布矩阵与 update-protocol 包。
- 全部走主进程更新服务;渲染层排卡前不迁,本节为恢复基准。

### 2.3 支持资源卡(`AboutSupportCard`)

- 「查看文档」(外链,失败 toast「文档打开失败」)、「复制反馈信息」(toast「可连同诊断日志一起发送给维护者」——与 07-06 日志行呼应)、第三方许可声明(`third-party-notices`,内嵌列表或对话框)。

### 2.4 快捷键表

- 数据源 `PRODUCT_SHORTCUTS` + `shortcutDisplay`(平台化 ⌘/Ctrl 显示);旧版落 domain 包,v2.5 依赖边界禁 features→domain,**单源已落 `packages/features/src/shell/shortcuts.ts`**(C-2,2026-08-29);**只列真实接线的条目**(设置评审 P0 教训:列了没接线的快捷键 = 撒谎);**Enter 系标注作用域**「聚焦工作台输入框时生效」,避免「全工作区可用」误导。

## 3. v2.5 迁入判定

| 块 | 暂缓域? | 判定 |
|---|---|---|
| 应用信息 + 复制版本 | 否 | ✅ **已交付**:品牌面板(ZCOOL)+ 版本行(版本 / 库结构 v{user_version} / 平台,tabular+mono)+ 复制版本信息(含通道) |
| 支持资源 | 否 | ✅ **已交付**:文档(桌面 `system.openProductDocs` 打开随包文档;Web 暂无公开文档站 → 不渲染死入口)+ 复制反馈信息 + 第三方声明 Dialog |
| 快捷键表 | 否 | ✅ **已交付**:数据源 `packages/features/src/shell/shortcuts.ts` 的 `PRODUCT_SHORTCUTS` 单源,平台化 ⌘/Ctrl(桌面按 `appInfo.platform`,Web 挂载后读 navigator),作用域逐条标注 |
| 应用更新/内容层/通道 | **是** | 挂点登记,排卡时按 §2.2 复刻;UI 恢复前用户仍可经安装包升级(通道当前只在复制的版本信息里只读出现) |

## 4. 交互口径(恢复时不可降级)

1. 快捷键表「只列真实接线」是硬规则;表数据从 domain 单一来源取,禁止在 UI 里手写平行表。
2. 复制版本信息聚合:App 版本 + 平台 + schema 版本 + 通道(有通道后),一次复制可粘贴报障。
3. 通道切换是危险偏好(影响收包稳定性):切换即生效 + toast,不需确认但文案说明 beta 含义。
4. 第三方声明必须可达(许可合规),形态可以是对话框内滚动列表。
5. 外链统一走宿主 `openExternal`(桌面)/新窗口(Web),features 内不直接 `window.open`(经 gateway 能力)。

## 5. 动效与 UIUX 细节

- 更新下载进度条:旧版真实进度 + 状态文案切换,reduce 下进度条保留(信息性动画不属装饰动效)。
- 快捷键表 `<kbd>` 样式:旧版有统一 kbd 视觉(边框+底色);新版 ui 包尚无 kbd 原语——已升格为跨屏任务 C-2([00-codex-craft.md](./00-codex-craft.md) §5.4/§6:菜单右列/tooltip/快捷键表三处共用),本篇只消费。
- 品牌面板是少数允许品牌字体(ZCOOL XiaoWei)出现的第二处(第一处是工作台空态水印,03 §5)——恢复时字体资产复用同一 @font-face。
- 版本号等宽(tabular-nums)。

## 5.1 更新体系的状态机存档(暂缓域恢复基准)

旧 `AboutUpdateRow` 应用更新状态机(主进程驱动,UI 只读 + 两个动作):`idle(当前已是最新/未检查)→ checking(「检查中…」)→ available(「发现 vX」+ 下载钮)→ downloading(进度条 + 百分比)→ downloaded(「重启以完成更新」+ 重启钮)→ error(就地红字 + 重试)`。内容层行独立同构状态机(检查/下载内容包),两行互不阻塞。通道行:切换 Select(stable/beta)即触发主进程校验,失败双路径报错(result.message 或异常 message),成功 toast 并触发一次检查。恢复 UI 时**不改主进程状态机**,渲染层是纯投影;E2E 用主进程 mock 通道跑全状态机。

## 5.2 快捷键表当前应列条目(随接线状态更新)

| 快捷键 | 作用域 | 接线状态(2026-08-29) |
|---|---|---|
| ⌘/Ctrl N | 全局 | ✅ 已接(SessionListPanel) |
| Enter / Shift+Enter | 聚焦工作台输入框 | ✅ 已接(Composer) |
| Esc | 浮层/行内编辑 | ✅ 已接(各 Dialog/rename) |
| ⌘/Ctrl K | 全局 → 库搜索 | ⏳ 待接(01 §7 P1),接线前**不上表** |
| ⌘/Ctrl S | 提示词编辑器 | ⏳ 待接(04 §8 P2) |
| ⌘/Ctrl Enter | 工作台发送别名 | ⏳ 待接(03 §7 P3) |

表的实现即 `PRODUCT_SHORTCUTS` 过滤已接线集合;本表是恢复时的初始数据,此后以代码为准。

## 5.3 状态矩阵与双端

关于卡几乎全静态,矩阵集中在动作反馈:复制成功/失败 toast;外链失败 toast(「文档打开失败」);第三方声明加载(内置 JSON,无网络态)。双端:版本信息桌面取 app.getVersion + schema 版本(桥),Web 取构建注入的版本/commit(next 环境变量);更新体系桌面 only;快捷键表双端同源但按宿主过滤(Web 上 ⌘N 可能被浏览器占用的注记照 02 §「浏览器可能保留 ⌘N」写入表格 hint)。

## 6. 任务清单

| 优先级 | 任务 | 验收要点 |
|---|---|---|
| ~~P2~~ | ~~「关于」卡(双端)~~ **已交付 2026-09-06**(B1-T6) | 单测断言复制串含版本 / `darwin arm64` / 库结构版本 / 通道;第三方声明可打开且逐条渲染 |
| ~~P2~~ | ~~快捷键表~~ **已交付 2026-09-06**:`PRODUCT_SHORTCUTS` 单源 + `@musefold/ui/components/kbd` | 单测遍历表内每条断言「标签 + 作用域 + 平台键」均渲染,新增条目自动上表 |
| P3 | Web 构建标识(commit / 构建时间):当前 Web 版本行只显示「Web 版」,`appInfoSchema.commit` 留空 | 需宿主注入(`PlatformProvider` 增可选 buildInfo 或 Web gateway 提供 system.getAppInfo 的 Web 变体) |
| ~~P3~~ | ~~ui 包 `<Kbd>` 原语~~ 已升格为跨屏 C-2 并交付(2026-08-29:`@musefold/ui/components/kbd` + features shell `PRODUCT_SHORTCUTS` 单源),本篇快捷键表恢复时直接消费 | — |

> 暂缓域挂点:应用更新行/内容层行/更新通道行(热更新控制面)。本分区已恢复 → 07-00 分组导航评估已触发(「应用」组 = 数据 + 关于)。
>
> **第三方声明的落点结论**(2026-09-06):清单是纯静态许可数据、双端都要展示,所以**不走 IPC** —— 数据住 `packages/features/src/settings/third-party-notices.ts`,形状由 contracts 的 `thirdPartyNoticeSchema` 约束(就地测试逐条 parse);`system` 域因此没有 `listThirdPartyNotices` 方法。

## 7. Codex 增益(C 系列,语汇见 [00-codex-craft.md](./00-codex-craft.md))

| 编号 | 级 | 增益 | 规格 |
|---|---|---|---|
| ~~0707-C1~~ | C1 | ✅ 已交付:版本行 mono + tabular-nums,复制类动作统一「钮内 Check 1.2s + toast」 | — |
| ◐ 0707-C2 | C2 | ◐ 部分交付:品牌字体复用工作台空态同一 @font-face(globals.css 的 ZCOOL XiaoWei);**入场淡入未做**(留待品牌面板动效批次) | 淡入需过 reduce 闸门 |

测试建议:快捷键表用单测断言「表内每条都在已接线集合中」——把接线状态做成显式常量,新增快捷键忘记上表或提前上表都会红;复制版本信息断言包含版本号与平台串;第三方声明断言可打开且非空。更新体系恢复时用主进程 mock 走全状态机 E2E(idle→checking→available→downloading→downloaded→error 各态 UI 投影)。
