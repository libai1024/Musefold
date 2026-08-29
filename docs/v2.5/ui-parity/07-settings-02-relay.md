# 07-02 设置 · 中转站(生图 / Agent 连接) — 旧版 vs v2.5 对照

> **旧版源码**:`RelaySection`(79 行,tab 壳)+ 生图 tab:`ProvidersSection`(169 行)+ `ProviderDetailPanel`(379 行,含 `provider-detail-models/parts/hooks`)+ Agent tab:`AiConnectionsSection`(259 行)+ `AiConnectionDetailPanel`(257 行)+ `relay-dirty-store`。
> **新版源码**:`packages/features/src/account/AiConnectionsPanel.tsx`(360 行,设置页「AI 连接」卡,桌面 `hasLocalAiProviders` 门控)。

---

## 1. 结论与迁移状态

旧「中转站」是设置域交互最重的分区:**生图 / Agent 双通道 tab**,各自 master-detail 分栏(左列表右编辑面板)、就地编辑 + **dirty 守卫**、测试连接、**拉取模型列表**、默认服务商切换、状态点体系。新版收敛为单卡 `AiConnectionsPanel`:连接列表行 + 新建/编辑 Dialog(名称/Base URL/模型/API Key 四字段)+ 测试连接 + 删除 + 默认 Badge,协议锁 `openai-compatible`(D11 已登记)。**Agent 通道整个未迁**(Skill/设计方案的模型依赖,随暂缓域);生图通道主干已迁但丢了三件高价值工具:**拉取模型列表、dirty 守卫、接入预设(一键接入)**。

## 2. 结构对照

| 项 | 旧版 | 新版 | 判定 |
|---|---|---|---|
| 通道 | 「生图 / Agent」分段 tab(能力门控可见性,深链可指定 tab) | 仅生图语义(Agent 未迁) | Agent 随暂缓域挂点 |
| 布局 | master-detail:左列表(状态点 + 名称)+ 右编辑面板,就地编辑 | 列表行 + Dialog 编辑 | 形态简化可接受(连接数通常 ≤3);连接 ≥5 的重度用户体验随分组导航评估 |
| 新建 | 「新建服务商」→ 右栏草稿态(未落库,保存才创建;首个自动设默认) | 「新建连接」Dialog | 一致 |
| **接入预设** | 空态「一键接入」预设列表(`settings-ai-quick-{preset}` + 自定义) | 无,全手填 | **P2 缺口**:预设(常见网关的 Base URL 模板)大幅降低首配门槛 |
| 默认切换 | relay 模式下可切默认服务商 | `ai-provider-active-badge` 展示默认 | **P2:缺「设为默认」动作**(现在默认只随首建) |

## 3. 编辑面板对照

| 项 | 旧版 `ProviderDetailPanel` | 新版 Dialog | 判定 |
|---|---|---|---|
| 字段 | 名称、Base URL、API Key(加密入钥匙链)、模型(可留空,拉取后再选) | 名称、Base URL、模型(手填)、API Key | 一致;模型字段见下 |
| **拉取模型** | 「拉取模型列表」:只需名称+Base URL+Key,拉到后模型下拉选择;单模型自动选中;失败就地红字「模型列表获取失败」 | 无,模型手填字符串 | **P1 缺口**:手填模型名是最易错的一步;桥已有 `/models` 探测(测试连接),扩展为列模型即可 |
| 测试连接 | 「测试连接」;**前置校验:无 Key 时提示「先填写 API Key,再拉取模型或测试连接」并聚焦密钥框**;新建草稿测试会先隐式落库(按钮变「完成」),但不切选中防止 remount 丢状态 | 行内「测试连接」(已存在连接),结果行内展示(延迟/401/超时区分) | 主干一致;**新建流程内测试**(保存前验证)P2;无 Key 前置提示 P3 |
| dirty 守卫 | `relay-dirty-store`:面板有未保存修改时,切 tab/切选中/新建先弹 InlineConfirm「放弃修改/继续编辑」 | Dialog 关闭即弃(无确认) | **P1 缺口**:与 04 §4 编辑器同一条规则(脏表单防误关),统一实现 |
| 密钥展示 | 已存 Key 显示掩码,可输入新 Key 覆盖;绝不回显明文 | `apiKey` 留空=不改,填=覆盖 | 一致(安全口径同) |
| 状态点 | 列表行状态点:缺 Key 告警优先,其余随测试状态(`connection-status`) | 无状态点 | **P2**:行首点(缺 Key=warning/测试通过=success)一眼扫出问题连接 |

## 4. Agent 通道(暂缓域挂点存档)

旧 Agent tab(`AiConnectionsSection` + `AiConnectionDetailPanel`):文本模型连接的 master-detail,空态「连接一个可用的文本模型——API Key 由你提供并在本机加密保存。没有连接也不影响空白搭建、Prompt 标注、YAML 或 Skill 手动导入」+ 一键接入预设;读取失败特判「需要重启应用」(`settings-ai-relaunch`,与 02 §3 同一逃生门);连接供 Skill 运行时/设计方案 Agent 编译消费。**随 Skill/设计方案域排卡时一并恢复**,恢复形态建议与生图连接同卡同组件(协议同为 openai-compatible,仅用途标记不同)。

## 4.1 状态矩阵(验收基准)

| 块 | loading | error | empty | ready |
|---|---|---|---|---|
| 连接列表 | 旧:「正在读取…」spinner 行;新:Skeleton | 旧:错误卡 + 重试 + RESTART_REQUIRED 特判重启钮;新:错误文案 + 重试 | 旧:一键接入预设空态;新:「还没有 AI 连接」+ 新建引导 | 行列表 + 默认 Badge |
| 测试连接 | 钮内 spinner + disabled | 行内失败文案(区分 401「API Key 无效或无权限」/ 超时「检查 Base URL 与网络」/ HTTP n) | — | 行内「连接正常 · {n}ms」 |
| 拉取模型(待恢复) | 钮 loading | 就地红字「模型列表获取失败」+ 原因 | 拉到 0 个=提示检查网关 | 模型下拉可选,单模型自动选中 |

密钥安全口径全表(两代一致,恢复任何能力时逐条对照):Key 只经主进程 `safeStorage` 入系统钥匙链;渲染层只见「已配置/未配置」与掩码;编辑时留空=不变更;删除连接同时删钥匙链条目;测试连接的 Key 在主进程拼装请求头,渲染层不经手明文;导出/日志/toast 里永不出现 Key 片段。其中「删除连接删钥匙链」在新桥的行为**待核对**(P2 验收项:删除后钥匙链无残留)。

默认服务商的消费链:Composer provider 预选(03 §3)读连接目录的 `available` + 默认标记——恢复「设为默认」后,Composer 未显式选择时应落到默认项而非首项;这条联动加进 P2 任务验收。

## 5. 动效与 UIUX 细节

- 旧 master-detail 切换选中即换右栏(直切);测试中按钮 spinner;拉取模型 loading 行内。新版测试结果行内展示带成功/失败色调,等价。
- 旧删除服务商有确认(危险动作);新版删除也有 AlertDialog,一致。
- 旧密钥说明文案「密钥仅保存在本机系统密钥链」在分区描述;新卡描述有等价句,保持。
- a11y:表单 label/htmlFor 两代齐全;测试结果需 `role="status"`(新版待核,P3)。

## 6. 任务清单

| 优先级 | 任务 | 验收要点 |
|---|---|---|
| P1 | 拉取模型列表:桥扩展 `aiProviders.listModels`(复用 probe 通道),编辑 Dialog 模型字段=可输可选 combobox;失败就地红字 | 填 Key+URL 即可拉取;单模型自动选中 |
| P1 | 编辑 Dialog 脏表单守卫(与 04 提示词编辑器共用方案) | 有改动关闭需确认 |
| P2 | 「设为默认」行动作 + 默认切换联动 Composer provider 预选;行首状态点(缺 Key 告警);新建流程内测试连接 | — |
| P2 | 接入预设目录(常见网关 Base URL 模板 + 一键填充) | 空态显示预设组 |
| P3 | 无 Key 时测试的前置提示与聚焦;测试结果 `role="status"` | — |

> 暂缓域挂点:Agent 通道整 tab(依赖 Skill 运行时/设计方案排卡);「需要重启应用」逃生门随桌面装壳(02 §7 P2)统一处理。

## 7. Codex 增益(C 系列,语汇见 [00-codex-craft.md](./00-codex-craft.md))

| 编号 | 级 | 增益 | 规格 |
|---|---|---|---|
| 0702-C1 | C1 | 行首状态点规格(挂靠 §6 P2 状态点) | 6px 实心圆:缺 Key = `--warning`、近测通过 = `--success`、未测 = `--muted-foreground`/40%;**静态不呼吸**(呼吸只保留给「进行中」语义,与 02 §6 区分);点带 `aria-label` |
| 0702-C2 | C1 | 测试结果排版(吸收 §6 P3 `role="status"`) | 「连接正常 · NNNms」延迟数字 tabular,结果行 `role="status"`;失败引导文案就地红字不位移(预留行高);Base URL/模型名/密钥尾号 mono(00 C-4) |
| 0702-C3 | C2 | 拉取模型的渐进披露(挂靠 §6 P1 拉模型) | combobox 拉取中钮内 Spinner(豁免压制);拉到列表后选项 `--dur-fast` 淡入;单模型自动选中时输入框闪一次 `--muted` 底(300ms 内完成,提示「已替你选好」) |
