# 偏好页 review

> 评审对象:设置中心「偏好」分区(`preferences`,v2 设置整合 = 生成默认值 + 外观)。
> 设计语言基准:`docs/research/codex-tui-ui-research.md`(下称 codex 报告)+ `DESIGN.md`(Graphite / Porcelain / Ember)。
> **本报告仅基于代码分析**:两张截图(03-preferences-dark/light.png)无法被本次评审模型读取(图像输入不支持,视觉分析工具仅支持远程 URL 且触发限流)。涉及像素对比、间距观感的结论待视觉复评确认;凡「截图观察」节内容均为代码推导,已逐条标注。

## 截图观察

(代码推导,非目视结论)

- 页面结构:h1「偏好」+ 描述一行(`PreferencesSection.tsx:9`),下接三张 SettingsCard:「生成参数」(4 行)、「方案运行」(1 行)、「界面设置」(3 行)。段落 `max-width: 880px` 居中(`styles.css` `.mf-settings-section`),行高由 `--density-setting-row-y` 驱动(默认 12px 纵向 padding)。
- 每行左侧 label(13px/600/`--fg-primary`)+ hint(12px/`--fg-tertiary`),右侧控件区 `minmax(192px, 288px)`(`styles.css:616`)。明暗两主题均走 `--fg-*` / `--bg-*` / `--border-*` 语义 token,settings 域 CSS 无硬编码色值,主题切换理论上自洽;具体 12px tertiary hint 在暗色底的实际对比度需目视复核。
- 控件形态:质量/背景/数量/优先级/主题/动效/密度都是 ChoiceChips 分段组(选中 = `--bg-elevated` 凸起块 + `--shadow-sm`,无 ember 参与);默认比例是 RatioPicker 下拉(触发器带比例小预览 + 比例值,弹层为三列比例卡网格 + 自定义行,选中卡 `border-accent/40 bg-accent-soft/70` 有 ember)。同一页存在「凸起白块」与「ember soft」两种选中语言。
- 主题三项带 14px 图标(Monitor/Sun/Moon,`aria-hidden`),其余 chips 纯文字。
- 弹层内自定义比例行:两个 W/H 数字输入 + 「应用」按钮(`rounded-full` 胶囊)+ 一行常驻注释「OpenAI 档位就近取 1024/1536 像素档」。
- 无 emoji(红线合规,lint 亦有 no-emoji 门禁)。

## 代码问题(file:line)

1. **「默认生成参数」与工作台草稿实时同值,UI 无任何说明** — `GenerationSection.tsx:33-34` 直接读写 `useGenerationWorkbenchStore` 的 `params`(即工作台当前草稿);`workbench/store.ts:81-83` 的 `setParams` 会立即 `persistWorkbenchPreferences` 落盘。后果:在设置页改「默认数量」会立刻改掉工作台进行中的草稿;反过来在 Composer 临时调比例也会静默改写「新设计默认」。codex 报告 §3.2/§5-P0-5 的要求是「设置项旁标注当前值来自哪一层」,这里「官方默认 / 用户偏好」两层完全同体且不可感知。卡片 description(`GenerationSection.tsx:38`)只说「设置新设计默认使用的画幅…」,与实际语义(同步改草稿)不符,属误导性文案。
2. **ChoiceChips 无键盘箭头导航,点击已选项重复提交** — `SettingsComponents.tsx:124-152`:`role="radiogroup"/role="radio"` 但每个 radio 都是 `tabIndex=0` 的普通 button,Tab 需逐个穿过全部选项;无 ArrowLeft/Right/Home/End 移动(WAI-APIA radio 组应为组内单 tab stop + 箭头漫游)。且 `onClick` 无条件 `onChange(option.value)`(L137),点击当前已选中项会重复触发 `setParams` → 多余持久化写盘。
3. **hint 与控件无可访问性关联,状态性 hint 读屏不可达** — `SettingsComponents.tsx:88-98`:hint 是裸 `div`,无 id、无 `aria-describedby` 透传。偏好页的 hint 大量承载状态信息(如 `AppearanceSection.tsx:45-49`「跟随系统,当前为深色」、`GenerationSection.tsx:80` 优先级档位说明),读屏用户选中档位后听不到这些解释,与明眼用户信息不对等。
4. **主题即选即生效,但无快照/恢复出口(codex 三件套缺一环)** — `stores/app.ts:92` `setThemeSource` 同时更新运行时 + zustand persist 同步写 localStorage;`App.tsx:60-63` effect 落 `data-theme`,跟随系统有 matchMedia 监听(`App.tsx:70-76`)。live-preview 与持久化分离两步都有,但 codex 报告 §3.5 的「打开时快照、Esc 恢复」没有对应物:误点「深色」整应用瞬间换肤,无撤销、无反馈。GUI 设置页「点击即持久化」本身可接受,缺的是生效反馈与后悔药。
5. **减少动效三档文案不自明** — `AppearanceSection.tsx:19-23`:label 为「系统 / 减少 / 完整」,单看选项不知道「减少/完整」的对象是什么,需读 hint 才明白;对照同页主题档「跟随系统 / 浅色 / 深色」四字内的自明标准,动效档差半步。
6. **「智能协调」与另两档平铺同层,无成本提示** — `GenerationSection.tsx:28, 80-90`:agent_mediated 涉及文本模型自动取舍(消耗与行为复杂度都不同量级),codex 报告 §3.4 的做法是高成本档隔离 + 警示;这里三档等权平铺,`describePriorityMode` 的一句说明也未提消耗。
7. **方案运行卡三层文案重复** — `GenerationSection.tsx:76-80`:卡 description「控制方案、用户输入与 Agent 调解之间的默认优先关系」、行 label「方案运行优先级」、hint `describePriorityMode(...)` 三层讲同一件事,违反克制原则(一句话只在最合适的一层出现)。
8. **「默认比例」hint 描述实现方式而非用户价值** — `GenerationSection.tsx:39`「与工作台一致的画幅下拉」是对控件实现的说明;部分 hint 有真实约束(质量→成本、透明→模型支持)是好的,这一条属「为写而写」。
9. **RatioPreview 硬编码 `bg-white`** — `RatioPicker.tsx:70`:比例预览块填充色不走语义 token,暗色主题下是纯白块(靠 `border-current` 描边撑着),与「派生色优于新增色」(codex §4.1)和 DESIGN token 体系不符。
10. **CustomRatioRow 细节** — `RatioPicker.tsx:524`「应用」按钮 `rounded-full` 胶囊,DESIGN.md 明确 pill 仅限紧凑状态或真分段控件;`RatioPicker.tsx:533-537` 校验错误是普通 `<p>`,无 `role="alert"`/`aria-live`,两个数字输入(L497-517)也未与错误/说明建立 `aria-describedby`。
11. **同一页两种选中表达** — ChoiceChips 选中 = 凸起白块(`styles.css:672+`,`--bg-elevated` + shadow,无 ember);RatioPicker 卡选中 = ember(`RatioPicker.tsx:262-264`)。DESIGN.md「single ember accent marks creation, selection, and active progress」——分段控件未用 ember 与该条存在张力;两种控件语义不同(紧凑分段 vs 卡片网格)可以辩护,但规则没有写明,属设计语言未收敛。
12. **无按条件置灰的通道** — `SettingsComponents.tsx:106-153`:`SettingsSegmentedControl` 只有整组 `disabled`,选项级不支持 disabled + 原因;「透明背景需上游模型支持」(`GenerationSection.tsx:57`)永远只是 hint 文案,无法在模型不支持时置灰该 chip 并解释(codex §3.2:不隐藏不可选项,置灰并给原因)。

## 改进建议

### P0

1. **消除「默认参数」的误导语义**(`apps/desktop/src/features/settings/components/GenerationSection.tsx:33-38`)
   最小修复(文案级,当天可完成):卡 description 改为明示同步语义,如「这些默认值与工作台画幅面板实时同值:在此修改会同步到当前草稿,工作台中的调整也会更新这里的默认值」,并对齐 `hint` 措辞;「默认比例」hint(问题 8)一并改写为用户价值(如「新设计创建时的初始画幅,可在提交前调整」)。
   结构修复(择期,涉及 `features/generation/workbench/draftController.ts`):拆 `defaultParams`(设置页唯一写入点,新会话创建时快照进草稿)与 `draftParams`(工作台私有,不回写默认),从根上落实 codex「值来自哪一层」。做此项需补 e2e 断言(默认值与草稿分离后的行为)。

### P1

2. **补齐 ChoiceChips/radiogroup 键盘语义**(涉及共享包 `packages/product-ui/src/settings/SettingsComponents.tsx:106-153`)
   roving `tabIndex`(仅选中项 0,其余 -1)+ ArrowLeft/Right(垂直组再加 Up/Down)+ Home/End;`onClick` 改为 `if (!active) onChange(option.value)`。桌面 `ChoiceChips.tsx` 无需改动,自动受益。改后跑 `npm run test:visual:shared`。
3. **hint 接入 `aria-describedby`**(涉及共享包 `packages/product-ui/src/settings/SettingsComponents.tsx:88-98`)
   `SettingsRow` 用 `useId` 给 hint 生成 id,经 context 或 render-prop 把 id 透传给 control;`ChoiceChips`/`RatioPicker` 触发器消费之。有 hint 的行(本页 8 行里 7 行)读屏信息即可对齐明眼用户。
4. **主题变更的生效反馈与后悔药**(`apps/desktop/src/features/settings/components/AppearanceSection.tsx:51-56`)
   保持「即选即生效即持久化」的桌面惯例,但补两件事:hint 末尾追加「已即时生效」状态变化反馈;误换肤场景给一条可撤销 toast(toast store 已有 `stores/toast.ts`,复用即可,撤销 = 恢复换肤前的 `themeSource` 快照)。完整搬 codex「Esc 恢复快照、Enter 持久化」三件套与桌面设置页习惯冲突,不建议。
5. **动效三档文案自明化**(`apps/desktop/src/features/settings/components/AppearanceSection.tsx:19-23`)
   「系统 / 减少 / 完整」→「跟随系统 / 减少动效 / 完整动效」,与主题档「跟随系统 / 浅色 / 深色」句式对齐;密度档「舒适 / 紧凑」可不动。

### P2

6. **选中表达收敛**(涉及共享包 `packages/product-ui/src/styles.css:663-697`)
   两个方向二选一并写进 DESIGN.md:(a) 选中 chip 增加 ember 参与(如 `text-accent` + 保留凸起,或选中项底部 2px accent 短线),使「选中 = ember」在设置域也成立;(b) 维持双轨,但在 DESIGN.md 明确规则「卡片网格选中用 ember,紧凑分段用抬升」。推荐 (a) 的最轻版本(text-accent),视觉验证双主题后定稿。
7. **RatioPreview 去 `bg-white`**(`apps/desktop/src/features/generation/components/RatioPicker.tsx:70`)
   改 `bg-inset`(或 `color-mix` 派生画布色),双主题验证比例预览块在暗色下的观感。
8. **CustomRatioRow 打磨**(`apps/desktop/src/features/generation/components/RatioPicker.tsx:518-537`)
   「应用」按钮 `rounded-full` → `rounded-sm` 与设置域控件半径一致;错误 `<p>` 加 `role="alert"`;两输入加 `aria-describedby` 指向错误与像素档说明。
9. **「智能协调」加成本提示或降级披露**(`apps/desktop/src/features/settings/components/GenerationSection.tsx:28, 80`)
   hint 前缀补「调用文本模型自动取舍」;若后续该档仍低频,可仿 codex 模型选择器把第三档收进「高级…」次级。`describePriorityMode` 在 `packages/desktop-contracts`(涉及共享包)改一句话即可双端受益。
10. **方案运行卡去重**(`apps/desktop/src/features/settings/components/GenerationSection.tsx:76-80`)
    单行卡删卡级 description,label「方案运行优先级」+ hint 已足够;省一层文案即省一层噪音。
11. **选项级置灰通道**(涉及共享包 `packages/product-ui/src/settings/SettingsComponents.tsx:100-153`)
    `SettingsSegmentedOption` 增加可选 `disabled?: string`(原因),置灰 + `title` 展示原因;生成参数页在当前模型不支持透明背景时消费之。依赖「模型能力」数据面,可等能力元数据就绪再做。
12. **渐进披露规划(观察项)**:当前 8 行平铺在 880px 内密度尚可,不必为折叠而折叠;但动效/密度属低频一次性设置,若本页再加项(语言、启动行为等)应引入「高级」披露层,届时按 codex「按使用时机分层」重排。

## 保持不动

- **卡片分组与标题层级**:h1(24px)→ 卡 h2(14px/600)→ 行 label(13px/600)→ hint(12px/tertiary),三卡分工(生成参数 / 方案运行 / 界面)清楚,`SettingsRow` 两栏栅格与 macOS 系统设置同构,是本仓库设置域的正确基线。
- **主题写入链路**:`setThemeSource` → `resolveTheme` → `data-theme`(tailwind darkMode class)+ matchMedia 跟随系统 + persist `partialize` 字段级持久化(`stores/app.ts:92,118-124`)——即选即生效的实现本身完全正确,只缺反馈层(P1-4)。
- **密度/动效的全局落地**:`--density-setting-row-y` 由 `[data-density=compact]` 真实改变行高(`packages/ui/src/tokens.css:136-142`);`data-motion`/`reduce-motion` 单一闸门驱动全部动效(`styles.css:494+` 等),与 codex motion 理念一致;且各有 e2e 守卫(`tests/e2e/test_05_settings.py:1259` 起)。
- **RatioPicker 与 Composer 共用一份比例选择器**(注释明示「改一处两边生效」),键盘模型完整(箭头/Home/End/Esc、roving tabIndex、`autoFocusSelected`、关闭还原焦点),自定义比例的 1:4~4:1 校验和就地错误提示都在,不要在偏好页另造比例控件。
- **持久化的字段级 patch**:workbench 偏好 `{...DEFAULT, ...parsed}` 合并、app 偏好 `partialize` 只写偏好字段,符合 codex「最小化写回」;写盘失败静默降级不阻断生成(`draftController.ts:182-190`)是既定取舍,保持。
- **hint 的一句话克制风格**:随当前值动态变化(主题/动效/密度/优先级)而非静态说明书,方向正确,只需修个别条目(问题 8)。
- **红线合规**:本页全部文件 ≤600 行(最大 RatioPicker 543 行)、图标一律经 `components/ui/icons`(无直接 lucide-react)、无 emoji、类型取自 contracts(`desktop-contracts` enums / design-scheme),均无需变动。
- 旧分区深链兼容(`settings/store.ts:50` appearance→preferences)与设置搜索 keywords 已覆盖本页,不动。

---

*评审:2026-08-27;基准 codex 报告(2026-08-25)+ DESIGN.md;截图未目视,待视觉复评项:暗色下 tertiary hint 对比度、ChoiceChips 凸起选中态在两主题的可辨识度、RatioPicker 弹层在设置页右对齐时的溢出表现。*
