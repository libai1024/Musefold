# 07-03 设置 · 偏好(生成默认值 + 外观) — 旧版 vs v2.5 对照

> **旧版源码**:`PreferencesSection`(装配)= `GenerationSection`(108 行)+ `AppearanceSection`(91 行),行组件 `SettingRow` + `ChoiceChips`。
> **新版源码**:`SettingsScreen` 内「外观」卡(主题/减弱动效/语言)+ `ThemeSync`。

---

## 1. 结论与迁移状态

外观三件套里**主题已完整对位**(且新版语义化为 `AppTheme` 契约、`ThemeSync` 数据驱动挂 class,实现优于旧版),**语言是新增项**(旧版无 i18n 设置)。原 P0(减少动效死开关)已于 2026-08-29 收口:契约升三态 + `MotionSync` + 压制规则 + `skipMotion()`,全局动效闸门就位(§4.1 存档为验收基准)。剩余回退:**界面密度整项消失**(P2);**生成默认参数卡整体缺失**(默认比例/质量/背景/张数/方案优先级),其中背景与方案优先级依赖暂缓域,但默认比例与质量是当前 Composer 就能消费的。

## 2. 外观对照

| 项 | 旧版 `AppearanceSection` | 新版「外观」卡 | 判定 |
|---|---|---|---|
| 主题 | ChoiceChips 三档(跟随系统 Monitor / 浅色 Sun / 深色 Moon,带图标);hint 动态显示「跟随系统,当前为深色」 | Select 三档(跟随系统/浅色/深色) | 一致;**动态 hint P3**(告知 system 解析结果);ChoiceChips vs Select 形态差异可接受,分组导航恢复时统一回 ChoiceChips |
| 减少动效 | **三态 ChoiceChips:跟随系统 / 减少动效 / 完整动效**;挂 `html[data-motion]` + `.reduce-motion`,`motion.css` 双通道:显式 on 全压 0.01ms,system 时仅在媒体查询命中时压,**off 可强制完整动效覆盖系统设置** | ✅ 已收口(2026-08-29):契约 `motionLevelSchema` 三态(旧布尔 preprocess 迁移 false→system/true→on)+ Select 三档 + `MotionSync` 挂标记 + ui globals.css 双通道压制 + `skipMotion()` + Spinner `data-motion-exempt` | 语义完整承旧;控件形态暂为 Select,恢复分组导航时统一回 ChoiceChips(见 §6-C2) |
| 界面密度 | 舒适 / 紧凑(`data-density` 驱动 7 个 `--density-*` token:行距/卡距/缩略图尺寸/导航行高) | 无 | **P2**:恢复需先在新 token 体系里重建密度变量(shadcn 无此概念,自建 `--density-*` 挂 `@theme`);受益屏:提示词行/历史行/设置行 |
| 语言 | 无 | 简体中文 / English Select | 新增保留;实际文案 i18n 化是独立大卡,本项现在只落偏好 |

## 3. 生成默认参数对照(旧 `GenerationSection`)

旧卡「生成参数——设置新设计默认使用的画幅、质量、背景和生成数量;修改会同步应用到当前工作台草稿」:

| 行 | 旧选项 | 新版 | 判定 |
|---|---|---|---|
| 默认比例 | 与工作台一致的画幅下拉 | 无(Composer 内每会话草稿记忆) | **P2**:新会话初始比例应读全局默认;契约 `preferences.defaultAspectRatio` |
| 默认质量 | 标准(low)/高清(medium)/超清(high) | 无 | 同上并入 P2;注意旧 label 映射(low=标准)与新 Composer(low=快速/medium=标准/high=精细)**不一致,统一文案时以新 Composer 口径为准并回写本表** |
| 默认背景 | 自动/透明/不透明 | 无(契约无背景参数) | 随生图参数扩展排卡(P3,依赖 provider 能力探测) |
| 默认张数 | 1/2/4 | 锁 1(D3) | 随 D3 解锁 |
| 方案运行优先级 | 三档,默认「方案主导」 | 无 | 暂缓域(设计方案)挂点 |
| 联动语义 | **修改默认值同步应用到当前工作台草稿** | — | 恢复时保留该联动(只改「未显式改过参数」的草稿,避免覆盖用户选择) |

## 4. 动效与 UIUX 细节

- 旧 ChoiceChips 选中态有背景滑移感(CSS 过渡),带图标;恢复分组导航时以 shadcn ToggleGroup 重建。
- 减少动效行 hint 旧版说明三态差异;新版已是三档 Select,副文「减少动效可降低视觉干扰与耗电;跟随系统读取系统辅助功能设置」——system 档的动态解析结果展示见 §6 0703-C1。
- 旧密度切换即时生效且虚拟列表重测行高(04 §6 提到的 `virtualizer.measure()`);恢复密度时新虚拟化实现要有同样的重测钩子。
- 偏好全部本机持久(桌面 SQLite/浏览器 localStorage 经 gateway),两代口径一致:「仅保存在本机」。

## 4.1 减少动效的完整规格(✅ 已收口 2026-08-29,存档为验收基准;承旧 `motion.css` 双通道)

旧版三态语义精确定义,已逐条落地(实现:契约 `motionLevelSchema` / `MotionSync` / ui globals.css 压制块 / `@musefold/ui/lib/motion`):

1. **on(减少动效)**:根挂 `.reduce-motion`,全局规则把 `transition-duration`/`animation-duration` 压到 0.01ms、`animation-iteration-count: 1`、`scroll-behavior: auto`——动画「瞬时到达终态」而不是「不执行」,保证依赖 animationend 的逻辑不悬挂。
2. **system(跟随系统,默认)**:根挂 `data-motion="system"`,仅 `@media (prefers-reduced-motion: reduce)` 命中时套用同一组压制规则;系统未开减弱则完整动效。
3. **off(完整动效)**:不挂压制,**即使系统开了 reduce 也播放**——这是给「系统全局减弱但想看 Musefold 动效」的用户的显式覆盖,布尔开关表达不了这一档,是三态化的核心理由。
4. 信息性动画豁免:进度条、spinner 不受压制(它们传达状态而非装饰);豁免用显式标记 `data-motion-exempt`(ui 包 Spinner 已带,旧版 `mf-spin` 的对位物)。
5. JS 侧读取:`skipMotion()`(`@musefold/ui/lib/motion`,旧 `skipTheaterMotion()` 对位)——结果 reveal、marquee 等 JS 驱动动效在启动前查询,命中直接置终态,不做帧工作。

密度的 token 清单(P2 任务基准,承旧 `tokens.css`):`--density-page-padding`(1.5rem→1rem)、`--density-card-padding`(0.75→0.5)、`--density-setting-row-y`(0.75→0.5)、`--density-row-padding`(0.5→0.375)、`--density-list-gap`(0.5→0.375)、`--density-nav-y`(7px→5px)、`--density-history-thumb`(3rem→2.5rem)。七个值原样搬,消费方接入时列表虚拟化行高估算必须联动重测(旧 `virtualizer.measure()` 教训)。

## 4.2 状态矩阵

偏好卡只有一份数据源(`usePreferences`),矩阵简单但要全:pending=Skeleton(现有 `settings-loading`)/ error=「偏好读取失败,请重试」红字(现有,**缺重试钮,P3 补**)/ ready=控件组。更新走乐观(现有 `useUpdatePreferences` 乐观回写),失败回滚 + toast——三态动效落地后,`MotionSync` 消费同一查询,偏好失败时动效档位回落 system(安全默认)。

## 5. 任务清单

> **已收口(2026-08-29)**:减少动效接线 + 三态化(原 P0,规格存档于 §4.1)。后续各屏动效恢复任务(01–06)引用该闸门即可,无需重复接线。

| 优先级 | 任务 | 验收要点 |
|---|---|---|
| P2 | 生成默认参数卡:defaultAspectRatio + defaultQuality 进偏好契约;新会话草稿初始化读取;设置行「同步应用到当前草稿」联动 | 改默认后新建会话 Composer 预选一致 |
| P2 | 界面密度:重建 `--density-*` token(行距/缩略图/行高),ChoiceChips 两档;提示词/历史/设置行接入 | 紧凑态快照;虚拟列表行高重测 |
| P3 | 主题动态 hint;质量档位文案统一(以 Composer 新口径为准) | — |

> 暂缓域挂点:默认背景(生图参数扩展)、方案运行优先级(设计方案域)、张数(D3)。

## 6. Codex 增益(C 系列,语汇见 [00-codex-craft.md](./00-codex-craft.md))

| 编号 | 级 | 增益 | 规格 |
|---|---|---|---|
| 0703-C1 | C1 | 动效行动态 hint(与主题 hint P3 同法同卡) | system 档 hint 显示解析结果:「跟随系统,当前:完整动效/减少动效」(读 `matchMedia`);on/off 档显示语义说明;让「off 覆盖系统」这档的价值可被发现 |
| 0703-C2 | C1 | 三档控件回 ChoiceChips(随分组导航,吸收 §2 形态注) | 主题/动效/密度统一 ToggleGroup 形态(带图标),选中滑移 `--dur-fast` + `--ease-out`(00 §4);Select 形态在此之前维持 |
| 0703-C3 | C2 | 密度 token 与 00 基线合流(挂靠 §5 密度 P2) | `--density-*` 七值(§4.1 下清单)进 ui 包 `@theme`,与 00 §3 动效 token 同一落点;紧凑档下 00 §2 法则 4 的行高取值整体下移一档 |

测试建议:动效三态用单测锁 `MotionSync` 的 class/attr 输出矩阵(3 档 × 系统媒体查询 2 态 = 6 组合),E2E 各取一条(on 态断言工作台空态无 marquee 轨道、off 态在模拟系统 reduce 下仍有);密度恢复时视觉快照加紧凑态一组;生成默认值用工作台单测断言「新会话草稿继承默认、已改草稿不被覆盖」。
