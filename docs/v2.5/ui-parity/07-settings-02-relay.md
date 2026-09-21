# 07-02 设置 · 中转站(生图 / Agent 连接) — 旧版 vs v2.5 对照

> **旧版源码**:`RelaySection`(79 行,tab 壳)+ 生图 tab:`ProvidersSection`(169 行)+ `ProviderDetailPanel`(379 行,含 `provider-detail-models/parts/hooks`)+ Agent tab:`AiConnectionsSection`(259 行)+ `AiConnectionDetailPanel`(257 行)+ `relay-dirty-store`。
> **新版源码**:`packages/features/src/account/{ConnectionsPanel,AiConnectionsPanel,AgentConnectionsPanel}.tsx`(设置「连接」区并列两卡,桌面 `hasLocalAiProviders` / `hasAgentConnections` 门控)。

---

## 1. 结论与迁移状态

旧「中转站」是设置域交互最重的分区:**生图 / Agent 双通道**,各自 master-detail、dirty 守卫、测试连接、拉取模型、默认切换、状态点、接入预设。v2.5 收敛为共享 `ConnectionsPanel` 列表行 + Dialog,协议锁 `openai-compatible`(D11)。**B1-T3(2026-09-06)已按 §6 收口**:`listModels` 可输可选 combobox、脏表单守卫、设为默认、行首状态点、新建草稿测试、接入预设、删除清钥匙链。Agent 卡与生图卡共用同一面板实现,testid 前缀独立。

## 2. 结构对照

| 项 | 旧版 | 新版 | 判定 |
|---|---|---|---|
| 通道 | 「生图 / Agent」分段 tab | 连接区并列两卡(`AiConnectionsPanel` / `AgentConnectionsPanel`) | 已恢复;形态为双卡而非 tab |
| 布局 | master-detail | 列表行 + Dialog 编辑 | 形态简化可接受 |
| 新建 | 右栏草稿态 | 「新建连接」Dialog;保存才落库 | 一致;草稿测试/拉模型不落库 |
| **接入预设** | 空态 `settings-ai-quick-{preset}` | 空态与 Dialog 顶 `ai-provider-preset-*` / `agent-connection-preset-*` | **已收口(P2)** |
| 默认切换 | relay 模式切默认 | 行「设为默认」+ `*-active-badge`;`generation.listProviders` 活跃置首 | **已收口(P2)** |

## 3. 编辑面板对照

| 项 | 旧版 `ProviderDetailPanel` | 新版 Dialog | 判定 |
|---|---|---|---|
| 字段 | 名称、Base URL、API Key、模型 | 同左;模型=可输可选 combobox | 一致 |
| **拉取模型** | 「拉取模型列表」;单模型自动选中;失败就地红字 | `*.listModels` + combobox;1 个自动选中并 300ms muted 闪;0 个提示检查网关;失败「模型列表获取失败:{原因}」 | **已收口(P1 / 0702-C3)** |
| 测试连接 | 无 Key 前置提示并聚焦;新建可测 | 行内 + 新建 Dialog 内均可测;草稿走 `{ baseUrl, apiKey }`,主进程不落库;无 Key 提示并聚焦密钥框 | **已收口(P2/P3)** |
| dirty 守卫 | `relay-dirty-store` | Esc/点外/X/取消 → AlertDialog「放弃修改?」(`useDiscardGuard`,与 PromptEditorDialog 同方案) | **已收口(P1)** |
| 密钥展示 | 掩码,留空=不改 | 同左 | 一致 |
| 状态点 | 缺 Key / 测试通过 | 6px 实心圆(0702-C1),会话内记住测试结果 | **已收口(P2)** |

## 4. Agent 通道

Agent 卡已与生图卡并列交付(2026-09-03),B1-T3 起共用 `listModels` / 预设 / dirty / 状态点 / 草稿测试。读取失败「需要重启应用」逃生门仍随桌面装壳(02 §7 P2)。

## 4.1 状态矩阵(验收基准)

| 块 | loading | error | empty | ready |
|---|---|---|---|---|
| 连接列表 | Skeleton | 错误文案 + 重试 | 引导文案 + 预设 chips + 新建 | 行列表 + 默认 Badge + 状态点 |
| 测试连接 | 钮内 spinner + disabled | 行内失败文案(401/超时/HTTP n),`role="status"` 预留行高 | — | 「连接正常 · {n}ms」tabular |
| 拉取模型 | 钮内 Spinner | 就地红字「模型列表获取失败」+ 原因 | 0 个=提示检查网关 | combobox 可选,单模型自动选中 |

密钥安全口径:Key 只经主进程 `safeStorage`;渲染层只见 hasKey/keySuffix;草稿 Key 只在本次 IPC 往返拼请求头,不落库/不进日志;删除连接同时 `deleteApiKey` / `secrets.delete`(单测已断言)。

默认服务商消费链:`generation.listProviders` 已 `ORDER BY is_active DESC`;Composer 未显式选择时用 `providers.data[0]`(本卡不改 Composer)。

## 5. 动效与 UIUX 细节

- 拉取中钮内 Spinner;选项 `--dur-fast` 淡入;单模型选中 muted 底闪 300ms。
- 删除仍走 AlertDialog;密钥说明保持在卡描述。
- a11y:测试结果 `role="status"`;状态点 `aria-label`;表单 label/htmlFor 齐全。
- Base URL / 模型 / 密钥尾号 mono(00 C-4)。

## 6. 任务清单

| 优先级 | 任务 | 状态 |
|---|---|---|
| P1 | 拉取模型列表 + combobox | **已收口** `aiProviders.listModels` / `agentConnections.listModels` |
| P1 | 编辑 Dialog 脏表单守卫 | **已收口** `useDiscardGuard` |
| P2 | 设为默认 + Composer 预选联动;行首状态点;新建内测试 | **已收口**(Composer 预选由 `listProviders` 活跃置首承担,本卡不改 Composer) |
| P2 | 接入预设目录 | **已收口** `connection-presets.ts` |
| P3 | 无 Key 前置提示与聚焦;`role="status"` | **已收口**(0702-C2) |

> 仍挂:「需要重启应用」逃生门已由 B2-T3 接 `useRelaunchApp()`。S01 产品面已于 2026-09-06 B4-T3 闭合(连接测试失败引导 + 工作台/历史 `check_key` 深链连接分区);safeStorage/asar 扫描仍属 S01 全卡。

## 7. Codex 增益(C 系列,语汇见 [00-codex-craft.md](./00-codex-craft.md))

| 编号 | 级 | 增益 | 状态 |
|---|---|---|---|
| 0702-C1 | C1 | 行首状态点规格 | **已收口**:6px 实心圆,缺 Key=`--warning`、近测通过=`--success`、未测=`--muted-foreground`/40%,静态不呼吸,带 `aria-label` |
| 0702-C2 | C1 | 测试结果排版 | **已收口**:`role="status"` + tabular 延迟 + 预留行高 + mono 副行 |
| 0702-C3 | C2 | 拉取模型渐进披露 | **已收口**:钮内 Spinner;选项 `--dur-fast` 淡入;单模型 300ms muted 底闪 |
