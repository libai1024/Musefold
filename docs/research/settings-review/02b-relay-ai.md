# 中转站·Agent tab review

> 评审对象:设置「中转站」页 Agent tab(文本模型连接)。
> 设计语言基准:`docs/research/codex-tui-ui-research.md`(克制、按使用时机分层、渐进披露、动词短语按钮、语义色 token)+ `DESIGN.md`(Graphite/Porcelain/Ember)。
> 代码基线:RelaySection.tsx / AiConnectionsSection.tsx / AiConnectionDetailPanel.tsx(563 行)/ AiConnectionDialogParts.tsx / MasterDetail.tsx / ai-connection-store.ts / electron/ai/connection-store.ts,对照生图侧 ProvidersSection.tsx / ProviderDetailPanel.tsx。

**本报告仅基于代码分析。**截图 `/tmp/musefold-settings-review/baseline/02b-relay-ai-dark.png` 两次尝试读取均失败(本会话 Read 工具无图像输入通道;外部图像分析服务持续 429 限流),凡依赖像素的结论(间距、状态点实际颜色、暗色下对比度)均已标注「待视觉复核」。

## 截图观察

无法读取截图。以下为从代码推演的预期画面结构,供对照截图核验:

- 页壳:`SectionShell` 标题「中转站」+ 一句 description;其下 `SettingsSegmentedControl`(product-ui)两段「生图 | Agent」,`relay-tab-bar` 包裹。
- Agent 面板(已配 1 个连接):`SettingsCard` 标题「已配置连接」,body 内 `settings-md` 网格 = 左 240px 列 + 右详情。左栏一行「E2E Agent 连接」= 28px 品牌图标砖(右下角 8px 状态点;未测试应为边框灰「未测试」,缺密钥应为 warning 黄)+ 名称 + 第二行等宽模型 id + 「默认」徽标(若激活);列表底部 hairline 分隔的「+ 新建连接」ghost 按钮。
- 右栏详情:头部「E2E Agent 连接」+「默认」徽标(或「设为默认」ghost 按钮);「连接」分组(名称 / 连接方式二段控件 / Base URL / API Key 密钥状态行+密码框+眼睛)→ hairline 分隔「模型」分组(默认模型输入、可选模型行列表、「刷新」outline 按钮)→ 可选测试结果卡;底部 sticky 操作条 = 左删除图标(ghost)/ 右 dirty 圆点 + 放弃 / 测试连接 / 保存(primary)。

待视觉复核项:左栏 240px 与右栏比例;`sm:grid-cols-2` 字段两列在详情列宽下是否局促;密钥状态行(success 绿)与状态点黄色在 graphite 暗色下的观感;sticky 操作条 `bg-elevated` 与滚动内容的衔接。

## 代码问题(file:line)

以下行号基于当前工作区文件。

1. **563 行逼近 600 红线**:`AiConnectionDetailPanel.tsx` 全文 563 行,距 `file-size-ratchet` 硬门禁仅 37 行余量。任何增量(哪怕加一个字段)都必须先拆。
2. **managed 死分支**:`AiConnectionsSection.tsx:30` 过滤 `managedBy !== 'account'`,且该面板是 `AiConnectionDetailPanel` 唯一调用方;而 `AiConnectionDetailPanel.tsx:87,132,177-179,197,326,334,451,468,490,522` 存在大量 `managed` 分支(含 `px-4 shadow-none` 两条样式特例)在本面板**不可达**。约 40 行死代码撑大了文件体积。
3. **校验错误从不显示**:`AiConnectionDetailPanel.tsx:131-138` 的 validate 产出「请填写连接名称 / 请填写 Base URL / 请填写默认模型」,但组件从不渲染 `form.errors` / `errorFor`;`Field`(AiConnectionDialogParts.tsx:75-91)没有 error 槽。结果是「保存」被 `saveDisabled` 静默禁用(`:558`),用户不知道差什么。product-ui `useDraftForm` 提供的 `errorFor/markTouched/touchAll` 全部闲置(涉及共享包 product-ui 的既有 API,只需消费,不需改包)。
4. **隐式落库 +「放弃」语义陷阱**:新建草稿点「测试连接 / 刷新」会先 `persist()` 真实创建连接(`AiConnectionDetailPanel.tsx:247,265`);此后按钮从「取消」变「放弃」(`:547`),而「放弃」执行的是 `onCreated(createdId)`(`:227-232`)——名为放弃、实为保留并选中。API Key 的 hint(`:384`)有做披露(「会先保存当前填写内容」),但按钮语义仍是坑。`ProviderDetailPanel.tsx:209-220` 同款,两 tab 一致地坑。
5. **脏数据无保护**:左栏点选(`AiConnectionsSection.tsx:168-171`)或切 tab(`RelaySection.tsx:45`)时,dirty 草稿被 `key` remount(`AiConnectionsSection.tsx:188`)静默丢弃;`MasterDetail` 无任何拦截钩子。违反 Codex「Esc 恒等于安全默认」精神——离开编辑不等于确认放弃。
6. **`presets.slice(0, 6)` 魔数**(`AiConnectionsSection.tsx:101`):静默截断预设目录(new-api、custom 两个进不了空态快捷列表)。依赖 AI_CONNECTION_PRESETS 数组顺序隐式表达「常用层」(electron/ai/connection-store.ts:25-91),与 Codex「常用层 + 全量层」分级意图相符,但未显式声明;同时「推荐」在空态是纯文本(`:113-115`)、在详情面板预设网格是 8.5px 徽标(AiConnectionDialogParts.tsx:45-53),同一概念两种表达。
7. **连接方式无渐进披露**:`RouteButton` 二选一(`AiConnectionDetailPanel.tsx:350-368`)选中后无任何说明。direct/gateway 的实际差异——结构化输出默认策略(gateway→json-object、direct→json-schema,electron/ai/connection-store.ts:18)——对用户完全不可见。
8. **与生图 tab 的文案/表达不一致**:
   - 「保存中」(`AiConnectionDetailPanel.tsx:556`)vs「保存中…」(ProviderDetailPanel.tsx:522);
   - Agent 眼睛按钮无 `title`(`:429-440`)vs 生图有(ProviderDetailPanel.tsx:387);
   - 左栏 meta 用原始 model id(`AiConnectionsSection.tsx:161`)vs 生图用 `displayModelName` 人性化(ProvidersSection.tsx:74);
   - 删除确认文案「确认删除连接?」(`:526`)vs「确认删除?」(ProviderDetailPanel.tsx:491)。
9. **CapabilityResult 恒定行**:「流式输出:本版本不使用」(AiConnectionDialogParts.tsx:161)永远不变,占去 4 列网格的 1/4。违反 Codex「装饰元素的存亡由内容价值决定」。
10. **a11y 细节**:连接方式是两个独立 `aria-pressed` 按钮(AiConnectionDialogParts.tsx:93-115),单选语义应为 `role="radiogroup"` + `aria-checked`;`Field` 的 span label 与 input 无编程关联(靠 input 各自 `aria-label` 双轨标注);预设网格 `grid-cols-2 → sm:grid-cols-3`、能力卡 `sm:grid-cols-4` 在 240px rail 右侧的详情列里可能过挤(待视觉复核)。
11. **relayMode 判定链脆弱**:`AiConnectionsSection.tsx:33` 用**生图** provider 列表推断 `providers[0]` 兜底;生图通道完全为空时 `activeProvider=null` → `relayMode=null` →「设为默认」不出现。通常场景(首连接自动激活,connection-store.ts:213)不触发,但纯 Agent 用户在特定删除顺序下可能遇到,值得确认语义。
12. **testing 状态点为 muted 灰**(connection-status.ts:41-42):进行中弱化为灰与「临时态」相符,但只有 title 提示、无任何动态指示;生图侧同款(一致)。

红线核验:图标全部经 `components/ui/icons` 转发,无直接 lucide-react import(通过);全部文案无 emoji(通过);颜色全部走 token(`text-primary/bg-elevated/border-border-subtle/--accent-ring`,预设选中态 `bg-primary text-background` + `text-background/70` alpha 派生,符合「派生色优于新增色」),无硬编码 hex——暗色一致性从代码层成立,像素层面待视觉复核。

## 改进建议

### P0(红线相关,先做)

1. **拆分 AiConnectionDetailPanel.tsx(563 → 约 250-300 行),同时清理 managed 死分支。**
   目标文件与做法(按收益排序):
   - `AiConnectionDialogParts.tsx`(现 186 行,余量足):把 API Key 字段块(`AiConnectionDetailPanel.tsx:382-442`,状态行 + 密码框 + 眼睛 + 撤销)迁为 `AiConnectionKeyField`,props 传 `keySaved/keySuffix/apiKey/showKey/revoking` 与回调——与生图侧 `provider-detail-parts.tsx` 的 `ApiKeyStatusRow` 演化路径同构;
   - 新文件 `AiConnectionModelSection.tsx`:模型分组(`:448-513`,标题 + 默认模型 + ModelOptionList + 刷新 + modelError);
   - 新文件 `ai-connection-panel-hooks.ts`:`useAiConnectionDraftActions` 收拢 `persist/handleSave/handleDiscard/handleLoadModels/handleTest/handleRevoke/handleDelete`(`:172-307`,约 135 行纯编排逻辑,可就地 `__tests__`);
   - 先与 owner 确认 managed 分支是否保留复用意图(账号托管连接将来是否进本面板):不保留则整支删除,保留则收进 hook 单点。拆分后各文件远低于 600,ratchet baseline 不需要新增条目。
2. **显式呈现校验错误**(修「保存为什么是灰的」)。
   目标:`AiConnectionDialogParts.tsx` 的 `Field` 加 `error?: string` 槽(input 下红色 text-meta);`AiConnectionDetailPanel` 在保存被 valid 拦截时 `form.touchAll(['name','baseUrl','model'])` 后逐字段 `errorFor` 渲染。生图侧 `ProviderField`(generation-access)同步改造保持同构。注意:不改 product-ui,只消费 `useDraftForm` 已有 API,**涉及共享包**的仅是调用面。

### P1(体验与一致性)

3. **修「放弃」语义陷阱**:低成本方案——`persist()` 首次创建成功时 `toast.success('AI 连接已创建')` 并把按钮文案改为「完成」;根治方案是主进程提供「不落库校验」入口(需动 desktop-contracts,涉及契约变更,单独立卡)。先做前者,两 tab(含 ProviderDetailPanel.tsx:209-220)同改。
4. **脏数据保护**:`MasterDetail.tsx` 增加可选 `onRequestSelect` 拦截或 `AiConnectionsSection` 维护 `onDirtyChange` 上报;切行 / 切 tab 且 dirty 时弹共用 `InlineConfirm`(「放弃未保存的修改?」确认/继续编辑)。MasterDetail 是桌面 settings 内共享组件(非 product-ui),生图侧同步受益。
5. **routeKind 渐进披露**:连接方式控件下按选中值渲染一行 dim hint——direct:「厂商官方接口,结构化输出优先 JSON Schema」;gateway:「OpenAI 兼容网关,结构化输出优先 JSON Object」(文案与 electron/ai/connection-store.ts:18 的真实行为对齐)。同时把 `RouteButton` 容器升级为 `role="radiogroup"`(子项 `role="radio" aria-checked`)。
6. **预设快捷入口显式化**:去掉 `slice(0, 6)`;在 `AiConnectionPreset`(desktop-contracts)+ `AI_CONNECTION_PRESETS` 上加 `quickPick` 布尔(涉及 desktop-contracts 类型与 electron 预设目录,渲染层零改动即可控制常用层);空态「推荐」统一为与预设网格同款小徽标。目录顺序仍即展示顺序(Codex 3.8),tvt 保持首位。

### P2(打磨)

7. 文案与表达对齐生图:「保存中…」;眼睛按钮补 `title`;左栏 meta 优先显示模型显示名(可用 listModels 结果的 `name` 回退 id);删除确认统一句式(建议都带宾语:「确认删除此连接?」/「确认删除此服务商?」)。
8. CapabilityResult 删掉恒定行「流式输出」,或与 message 合并;窄详情列下 4 列 dl 降为 2 列(Codex 表格转置思路)。
9. testing 状态点维持 muted 灰 + title 即可(克制);若要动态,走 `html[data-motion]` 既有门控加轻脉冲,勿引新动画。
10. relayMode 判定链补 fallback(生图 providers 为空时在 Agent 面板视为 relay?)——先与 owner 确认产品语义再动,避免误放开「设为默认」。
11. 空态快捷列表与生图 `ProviderEmptyGuide` 骨架已对齐(注释亦然),不强求抽公共组件;若后续第三处出现再收敛。

## 保持不动

- **master-detail 语言本身**:左栏行(图标砖 + 状态点 + 名称 + meta + 默认徽标)、`PanelActions`(sticky 操作条、dirty 圆点、danger 槽)、`InlineConfirm`、`PanelSectionTitle` 两 tab 完全共用——这是本页最大的结构资产。
- **API Key 只写不读**、Stripe 式状态行(状态 + 掩码 + 撤销同排)+ 密钥仅走 safeStorage 的安全模型。
- **状态点 token 化**(`connection-status.ts` 只取 --success/--warning/--danger/边框灰,未测试不刷存在感)。
- **测试/刷新共享 store 的 testStatus 状态机**,生图与 Agent 的 state 合集归一(`ok/success` 同映射)。
- **useDraftForm 受控草稿范式**与「API Key 留局部状态不参与实体 dirty」的边界划分。
- **预设注册表顺序即展示顺序**(数组顺序显式编排,禁字母排序),tvt 推荐位第一、custom 兜底在末。
- 空态文案的克制(「没有连接也不影响空白搭建、Prompt 标注…」给出不焦虑的边界说明)。
- 密钥 hint 对隐式落库副作用的披露文案方向(存在即好,按 P1-3 补按钮语义即可)。
