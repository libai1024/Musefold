# 设置中心逐页 UI Review 与改进(2026-08-27)

> 流程:每页 基线截图 → 代码/像素分析 → 按报告实施改进 → 门禁验证 → 复截对比。
> 设计语言基准:`docs/research/codex-tui-ui-research.md`(Codex TUI 研究)+ DESIGN.md(Graphite/Porcelain/Ember)。
> 执行模型:glm 子代理(kimi 本周额度仅剩 9/100,按用户规则切换 glm)。glm 无图像输入,视觉分析以代码级审查 + 程序化像素分析补位,4.5v 视觉通道当日报错不可用——截图留档供人工复核。

## 结构性变更(用户指定)

1. **「数据与关于」拆分为「数据存储」+「关于 App」两个独立分区**。设置分区 7→8;`about` 成为真实分区 key(不再是 legacy 别名,旧深链直达新页);新增 `DataStorageSection.tsx` / `AboutAppSection.tsx`,删除 `DataAndAboutSection.tsx`。
2. **左下角账号切换器**:
   - 常驻标题由具体中转站名改为**「自定义中转站」**——生图与 Agent 中转站不一定同源,常驻身份不点名具体站点;副行仍显示当前生图模型名。
   - 菜单分组标签「中转站」→「**生图中转站**」(与「生图账号」对仗,消歧两通道)。
   - 底部新增**双管理快速入口**:「管理生图中转站」(直达 relay/生图 tab)与「管理 Agent 中转站」(直达 relay/Agent tab)。

## 逐页报告索引

| 页面 | 分析报告 | 主要改进(摘要) |
|---|---|---|
| 账号 | [01-account.md](01-account.md) | 卡片体系统一+内容宽度 680;登录/注册 busy 文案分立;SettingRow 标签语义修正;内置模型卡并入概览 facts(product-ui additive `extraFacts`);豆包尾注渐进披露;warning 呈现统一且深色可见;aria-label 稳定化;密码不一致可见错误 |
| 中转站·生图 | [02a-relay-providers.md](02a-relay-providers.md) | ProviderDetailPanel 528→368 行拆分;Field 错误槽+校验错误真正渲染(blur/提交触达);「拉取模型」不再倒置要求模型必填;dirty 切换守卫(InlineConfirm);隐式创建 toast+「完成」语义;正在测试 tone 区分;aria-live |
| 中转站·Agent | [02b-relay-ai.md](02b-relay-ai.md) | AiConnectionDetailPanel 563→257 行拆分(hooks/模型段/KeyField);同构错误渲染与 dirty 守卫;direct/gateway 一行说明+radiogroup 语义;「保存中…」等文案与生图 tab 统一 |
| 偏好 | [03-preferences.md](03-preferences.md) | 生成参数卡明示「同步应用到工作台草稿」;动效档位「跟随系统/减少动效/完整动效」;ChoiceChips 方向键漫游+hint aria 关联(product-ui additive,双端受益);选中 chip ember 收敛;智能协调成本提示 |
| 开放能力 | [04-open.md](04-open.md) | AutomationSection 580→135+4 文件拆分;refresh 错误三态;统一剪贴板 helper(修定时器泄漏);maskToken 收紧(前4后4);已配置客户端折叠降权;审计行 a11y 合法化+heading 层级;预算空串不误写 0;tabular-nums |
| 使用统计 | [05-usage.md](05-usage.md) | 6 个硬编码 hex→语义 token 派生(明暗两套);channelId→色单一事实源;空态修复(不再渲染空网格/格子墙/孤悬边线);加载中≠零(「—」);tabular-nums+单位拆层级;10px→11px 对比度升档;时间范围 radiogroup 键盘模型;图表 aria 数据 summary |
| 数据存储 | [06-data.md](06-data.md) | 危险区独立成卡(danger 描边);路径行 title+复制按钮;备份列表折叠(「共 N 份·最近…」);确认短语统一「清空全部数据」;getPaths 失败可重试;Import/Export busy 期 Esc 守卫 |
| 关于 App | [07-about.md](07-about.md) | 快捷键诚实化(移除未接线 ⌘F,Enter 系加「工作台输入框」限定);初始态「未检查更新」+aria-live;版本/进度 tabular-nums;AboutSection 512→244+3 文件;页面描述去重 |
| 已归档+切换器 | [08-archived-and-switcher.md](08-archived-and-switcher.md) | SidebarAccessSwitcher 565→68+3 文件拆分(testid 全保留);菜单项 menuitemradio+aria-checked;双管理入口图标区分(生图 Image/Agent Sparkles);归档错误隔离+年份;删除按钮 32px |

## 截图

- 基线(改进前):`/tmp/musefold-settings-review/baseline/`(15 张,深色全页+浅色抽样+切换器下拉;脚本 `tests/e2e/test_98_settings_review_shots.py`,未跟踪 scratch)。
- 复截(改进后):`/tmp/musefold-settings-review/after/`。

## kimi 二审(限额复核,2026-08-27 收尾)

主体完成后用 kimi(剩余额度内,单次 6 工具调用)对切换器与中转站面板做只读终审,结论「有保留」。5 条发现的处置:

| 发现 | 处置 |
|---|---|
| P1 隐式创建后 dirty 点「放弃」实为「保留并选中」 | **不改,登记**:该行为是既有 E2E 契约(test_04/test_05 discard 用例明确断言 放弃→选中持久化条目+回滚未存编辑),标签语义(放弃未保存修改)与行为一致;kimi 的「应加确认条」建议与既有契约冲突 |
| P2 生图面板拉取/测试无 requireKey 前置(Agent 面板有) | **已修**:ProviderDetailPanel 补对称守卫(提示+聚焦密钥框),test_04 discard 用例同步补 key 填写 |
| P2 面板局部态依赖 remount 重置 | **核实安全**:两个 section 均已 `key={creating ? 'new' : id ?? 'none'}`,选中切换必然 remount |
| P3 两组 menuitemradio 无 group 语义 | **已修**:IdentityMenuBody 账号/中转站分组包 `role="group" + aria-label` |
| P3 saveDisabled 未含 saving | **已修**:两面板 `saveDisabled={testing || saving}` |

修复后回归:tsc ✅ · 相关单测 130/130 ✅ · 定向 E2E 9/9 ✅ · npm run check(见下)。

## 验证门禁(全部通过)

| 门禁 | 结果 |
|---|---|
| `npm run check`(lint/no-emoji/边界/typecheck/单测/双端 build) | ✅ 235 文件 / 1295 测试全绿 |
| `npm run test:visual:shared`(共享 UI 双端像素) | ✅ 通过(账号概览 extraFacts 与 chip accent 的像素偏移在容差内) |
| `npm run check:v1.1`(Web 生产边界) | ✅ 通过 |
| `npm run test:e2e:web`(Web Playwright) | ✅ 26/26 |
| 桌面 E2E:`test_05/37/39/33` | ✅ 52/52 |
| 桌面 E2E:`test_32_v05_account / test_32_integration_guide / test_41_phase_c / test_04_generate` | ✅ 全过 |
| 桌面 E2E:`test_08`(切换器/中转站入口)`test_11`(设置视觉契约) | ✅ 全过 |
| 桌面 E2E:`test_05 全量 + test_07_onboarding + test_12_accessibility` | ✅ 56/56 |

实施中发现并修复的行为缺陷(非测试问题):
1. 隐式落库后 dirty 基线不重置——给共享 `useDraftForm` 增加 additive 的 `markPristine()`,两面板在测试/拉取隐式落库后调用;「完成/放弃」标签按「自上次落库是否有修改」切换(修正后才满足 E2E 既有契约:落库后再改名点「放弃」应回滚到持久化值)。
2. 使用统计汇总卡数值与单位拆层级后 innerText 丢失空格('0.4积分'),加显式空格(读屏同样受益)。

E2E 同步(行为是有意变更,断言跟随新契约,未删任何测试):
- `test_04_generate`/`test_08`:站点名断言从「常驻身份区」改为「打开身份菜单后可见」(常驻区现显示「自定义中转站」)。
- `test_05`:动效档位新文案、备份折叠开关、确认短语「清空全部数据」。
- `test_32_v05_account`:内置模型卡并入概览 facts 后选择器改读 `account-summary-panel`。
- `test_33`:导航标签「数据存储」「关于 App」。

## 前后截图像素差异(改进幅度参考)

| 截图 | 变化像素占比 | | 截图 | 变化像素占比 |
|---|---|---|---|---|
| 账号 dark | 4.47% | | 使用统计 dark | 1.26% |
| 账号 light | 5.90% | | 使用统计 light | 7.96% |
| 中转站·生图 dark | 0.01% | | 数据存储 dark | 2.61% |
| 中转站·Agent dark | 1.70% | | 关于 App dark | 0.17% |
| 偏好 dark | 0.34% | | 已归档 dark | 0.00% |
| 偏好 light | 0.42% | | 切换器下拉 dark | 0.34% |
| 开放能力 dark | 0.40% | | | |

(生图 tab 静态视图几乎不变是符合预期的:该页改进集中在错误渲染、dirty 守卫、隐式创建提示等交互层,空数据静态截图不呈现;已归档空态本就达标。)

## 已知未做(登记)

- ConnectedAppsScreen 页内 h1 降级(涉及共享包,留共享包任务)。
- Agent 预设 `quickPick` 契约字段(涉及 desktop-contracts,避免本轮动契约)。
- RatioPicker 触发器接入 hint `aria-describedby`(需透传 prop,超出最小增量面)。
- 模型分布与渠道分流为独立色板(现为共用派生色板,已去硬编码)。
- SettingsSegmentedControl 方向键已通过 ChoiceChips radiogroup 通道落地;relay tab 分段控件本身未单独改造。
