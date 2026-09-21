# v2.5 费用授权边界、B9 验证与 SP-D 持久化进度

> 更新日期：2026-09-07。**G-SPEND-02 仍为部分完成，不能勾选整卡完成。** §1–§7 是 B9 费用边界、测试与当时 open 的历史快照；其中“本轮/当前/尚未实现”均指 B9 时点。B9 后获授权实施的 SP-D 存储、G/R/S 接线与新增真实测试，以 §8 为最新结果；它已新增 SQLite 受管迁移，不能继续套用 B9 的“无数据库迁移”限制。云端审批、管理员代批、Cloud MCP 写工具均未新增。
>
> 执行入口见 [G-SPEND 任务卡](./V25-MIGRATION-GOALS.md)；总体进度见 [迁移路线图](./V25-MIGRATION-ROADMAP.md)，证据等级与阶段流程见 [测试手册](./V25-MIGRATION-TESTING.md)。通过数绑定命令、时间和当时未提交工作树；B9 统一门禁与后续 SP-D 统一门禁不得互相继承。

## 1. B9 时点的费用范围裁决

需要分别判断“用户主动提交”“用户授权本机 Agent 执行”“云端外部 Agent 读取”。这些入口的授权来源和预算含义不同，不能因为契约有 `pending_approval`，就推导出所有入口都缺一个审批后台。

| 入口 | 调用者与费用承担方 | 当前授权来源 | 预算、确认和费用事实源 | 当前范围结论 |
|---|---|---|---|---|
| 普通 Web 生图 | 登录用户；使用其云端账号对应的上游额度 | 用户在产品里显式提交 | API 创建 `actorType: web / approvalStatus: not_required / status: queued`；执行与费用字段来自云服务，是否已经上游账单核实须另有证据；不使用桌面 Automation 月预算 | 保留现有直接提交路径；额度不足引导、兑换后恢复和终态刷新属于产品恢复矩阵，不能改成管理员批准 |
| 普通 Desktop 生图 | 本机用户；按 Provider 凭据向对应服务发请求；遗留托管标记不能证明与当前登录账号是同一付款人 | 用户在桌面产品里显式提交 | IPC/core 生图；对共享界面映射 `desktop_local / not_required`；本地 Agent 预算闸不应插入普通用户点击路径 | 不伪造 `pending_approval`，不要求同一用户对自己的点击重复走 Agent 确认卡 |
| Desktop Automation / CLI / local MCP：`generate_image` | 持有本机 Automation 权限的调用方；费用取决于选定 Provider 凭据，付款账号绑定尚未闭合 | 账号托管预算覆盖，或 App 明确确认，或已有 CLI `consent: interactive` | 本机月度预算、预估积分、发送前预留、执行器数值冲销、SQLite 花费审计；预算不足/未知成本转用户确认；数值来源限制见 §1.2 | 本轮修复和补验的主要入口；HTTP 回执只解决本生图 gate 中的确认 |
| Desktop Automation / CLI / local MCP：`run_scheme`、`run_github_skill` | 本机 Agent；图像 Provider 承担图像调用，Skill 还可能调用独立 Agent 文本连接 | 同上；App 确认经宿主 IPC，CLI 可使用既有交互同意字段 | 两类运行与普通 Agent 生图共用本轮注入的图像费用预算协调器；Skill 文本连接/费用未纳入该估价与聚合 | 保留已有本地方案/Skill 能力；本轮补零预算、确认生命周期、幂等、图像费用聚合及审计，未证明全部文本/图像上游调用受同一费用身份约束 |
| Web 用户触发方案 Agent 编译/修改 | 未来明确点击创建/修改的登录用户；文本模型费用提供方尚须按云方案接入方案确定 | 用户触发的有限操作，不等于授予云端 Agent 无限自主消费权限 | 当前缺完整云端文本编译/修改 runtime；应在 G-CLOUD-02 明确凭据供给、计费主体、请求边界、预估未知和失败恢复 | 当前完整 document 的确定性创建与 Agent 编译分开；后者仍明确 unavailable，不因 UI 入口存在就算已可收费执行 |
| Cloud MCP | 外部远程客户端代表用户读取 | OAuth/consent + 只读 scopes | 七工具 allowlist；没有生图/写工具，没有可用 spend scope | **保持只读；审批与花费预留属于休眠、不迁移的范围** |
| 管理员运维 | 产品运营方 | 运维权限，与用户花费授权分开 | 排障、撤销、观察和审计可以单独建设；不能代替用户批准 Agent 花费 | 可选后台不属于本轮费用迁移前置条件 |

源码依据：[云端普通生成](../../apps/api/src/modules/generation/service.ts)、[桌面生成映射](../../apps/desktop/electron/main/ipc-v25/workbench-domain.ts)、[本地生成 gate](../../packages/automation-server/src/generation-routes.ts)、[方案/Skill 路由](../../apps/desktop/electron/main/automation-runs.ts)、[Cloud MCP manifest](../../apps/api/src/modules/mcp/manifest.ts)。[交付计划](./V25-DELIVERY-PLAN.md) 也明确云端 MCP 生图/审批/花费预留休眠。

### 1.1 必须保留的语义

- **零预算表示托管 Provider 的花费动作逐次确认。** 即使预估是 0，余额为 0 时也不走自动预算授权；用户明确批准与 CLI 已有交互同意仍可放行本次动作。
- **非托管 Provider 不计入 Musefold 账号的 Automation 月预算，不代表第三方服务免费。** 本轮保留既有自动放行策略，费用若由执行器报告仍如实进入本地审计。
- **预估不等于实际扣费。** 预估用于授权与飞行中预留；当前冲销消费执行器返回的 `costPoints/cost` 数值，名称为 `actualCost/actualPoints` 也不证明其来自上游账单。当前 OpenAI-compatible 实现返回的是本地价格估算，详见 §1.2。成功、失败、取消都可能产生费用，不能只在成功状态记账。
- **未知与 0 分开。** 执行器费用字段缺失保持 `null`；方案/Skill 多结果中任何一项未知，总额也保持 `null`，不能相加时把未知项当 0；明确报告零时记录 0。数值存在与费用来源可信是两个独立维度，不能把估算数值升级为已核实扣费。
- **确认授权属于具体请求。** 同一幂等键绑定冻结输入；不同输入返回冲突；相同请求共享同一次确认、任务和审计。拒绝/超时后的同键重放不会再弹卡或发送，新的尝试需新的幂等键和适用授权。
- `declaredBudgetPoints` 当前只属于普通本地 Agent 生图请求的自动预算判定。合法声明仍需覆盖预估且不超过可用余额；不满足时进入确认，**它不是用户明确确认后也不能突破的费用硬上限**。CLI `--max-cost` 的已知预估检查是另一层现有行为。方案/Skill 路由本轮没有新增该字段。
- CLI `interactive` 是现有受信本地调用协议中的声明，local MCP 工具不暴露它。本轮测试证明服务端分支和审计来源，未建立“终端确实由人点击”的独立不可抵赖凭证。
- 本地 App 确认卡和共享时间线中的只读 `pending/rejected` 提示是两种机制；不能据此给普通 Web 新增批准/拒绝按钮或云端审批接口。

### 1.2 执行器费用与支付身份的源码限制

- **费用 provenance 尚未闭合。** [OpenAICompatibleProvider](../../packages/core/src/providers/openai-compatible.ts) 在成功返回时调用 `estimateProviderCost(this.id, req)` 生成 `cost`；[GenerationService](../../packages/core/src/services/generation.ts) 再将它写为 `generation_runs.actual_cost` 并映射到 `costPoints`。[价格配置](../../apps/desktop/electron/settings/pricing.ts) 是本地托管 Provider 的按张估算，未读取本次调用的上游账单凭证。因此旧字段可以继续证明“执行器返回了多少、策略冲销了多少”，不能证明“上游实际扣了多少”。持久化任务需分开记录预估、策略用量、费用来源与可信账单证据；不能从旧审计反推真实扣费。
- **托管标记不等于付款账号绑定。** [providers schema](../../packages/desktop-db/src/schema.ts) 只有 `managed_by`，没有 paid-owner 字段；[BaseProvider](../../packages/core/src/providers/base.ts) 经 [主进程 keychain](../../apps/desktop/electron/security/keychain.ts) 按 Provider ID 读取密钥。[v25 账号会话](../../apps/desktop/electron/main/ipc-v25/account-domain.ts) 的 `ownerId` 属于该会话，源码没有把它与遗留 Provider key 可靠绑定。`managed_by = account`、当前登录用户、同步 workspace owner 三者不能直接画等号。绑定缺失必须保留 unbound，不能猜测 owner 后批准或对账。
- **Skill 包含独立文本费用入口。** [executeSkillRuntime / runSkillAgent](../../apps/desktop/electron/main/ipc/skill-runtime.ts) 会在执行时选择当前可用 [Agent 文本连接](../../apps/desktop/electron/ai/connection-store.ts)，先调用 `streamText`，再触发图像生成；当前路由只对图像 Provider 做估价，`aggregateCost` 只汇总图像结果。文本模型/凭据、调用步骤与费用既未被冻结到原确认，也未完整计入该审计。现有 `AGENT_STEP_LIMIT = 10`、`maxOutputTokens = 4000` 和 `maxRetries = 0` 是执行上限，不能代替支付身份及费用授权。
- **一次 gate 执行不等于一次上游发送。** [OpenAI-compatible 生图](../../packages/core/src/providers/openai-compatible.ts) 使用 [withRetry](../../packages/core/src/providers/retry.ts)，默认在网络错误、429 与 5xx 下最多重试 3 次；每次会重新取得 Client/key。SDK 的 `maxRetries = 0` 只关闭 SDK 自身重试。本轮 fake Provider 测试断言的是 gate/执行器调用次数，没有证明实际 HTTP 请求次数；SP-D3 必须明确每次发送及重试的冻结身份、许可与不确定失败策略。

以上是源码核对结果，不是新增测试通过结论，也不改变 §4 的真实通过数。B9 已验证的注入数值与窗口模拟结果继续有效；真实上游账单、key-owner 绑定、文本费用与内部重试仍须单独验收。

## 2. 本轮实际修复

修改的实现只有 [generation-routes.ts](../../packages/automation-server/src/generation-routes.ts)、[automation.ts](../../apps/desktop/electron/main/automation.ts)、[automation-runs.ts](../../apps/desktop/electron/main/automation-runs.ts)。新增两份就地测试，见 §4。

| 发现的缺陷 | 本轮修复后的行为 | 仍有的界限 |
|---|---|---|
| pending 状态下同键请求可以重复创建确认/执行；同键不同输入没有冲突 | 先冻结输入与幂等条目，再触发确认；相同键共享 Promise，不同输入返回 `IDEMPOTENCY_CONFLICT`；拒绝/超时也缓存本次结论 | 缓存是内存；生图 gate 与外部运行路由各有自己的作用域；重启/重新创建路由后的持久重放尚未实现 |
| 并发请求分别看到同一份剩余额度 | 主进程注入同一个 `GenerationBudget.reserve()` 协调器，三个入口在发送前同步预留 | 预留在进程内；账单和请求状态没有事务性持久关联 |
| 余额 0、估算 0 也可走预算；成功未知成本会冲销 0 | 托管预算自动放行要求剩余额度大于 0；未知实际成本保持 `null`，不释放自动预算资格 | 当前 unknown 标记没有受控对账解除入口；不能把重启当作恢复措施 |
| HTTP 确认缺少 `approved` 字段时默认批准 | `approved` 必须是明确布尔值；同步消费回执，重复回执立即失效 | HTTP `/v1/confirmations/:id` 对应普通生图 gate；方案/Skill 使用宿主确认回执，不能宣称三入口都有相同 HTTP 回执能力 |
| 超时后 renderer 记录仍存在；外部运行计时器未清理；停服与窗口关闭没有完整收敛 | 120 秒截止时间校验；迟到回执拒绝；解决后清理 renderer、timer、窗口监听；主窗口关闭或停服拒绝挂起请求；停服移除事件订阅 | 已验证的是主进程代码与模拟窗口事件；真实 Electron 窗口/跨窗口渲染仍需统一 E2E |
| 方案/Skill 拒绝、超时、准备失败或异常路径漏花费审计 | 授权失败及执行终态都尝试写一次审计；同步抛错也收敛；同键不重复审计 | 审计写入失败仍采用不触发重复执行的处理，没有持久 outbox/补写保证 |
| 多结果费用把未知项当 0，非托管结果仍冲销账号预算 | 完整已知才汇总数值；未知保持 null；非托管不冲销账号预算 | 真实上游费用核对、部分已知账单的后续 reconciliation 未实现 |
| Skill 准备期间取消仍可进入执行器，取消未联动既有运行时 | 准备结束前检查取消；联动既有 Skill cancel 和相关生成 job cancel；已终态取消为 no-op | 不改冻结运行时内部；完整运行中取消与上游不可撤回费用仍需更广的运行时矩阵 |

### 2.1 共享预算协调器的准确含义

本轮协调器是在已有月预算之上的**本机执行策略保护**，不是另建用户钱包，也不替代 New API 或第三方账单。

正常路径为：读取月预算剩余 → 判断自动预算是否覆盖 → 预留本次预估 → 执行 → 用执行器报告的有限非负费用数值冲销 → 释放预留。`finish` 幂等，不会因同一终态重复回执而再次冲销。该数值当前可能仍是价格估算，不是已核实账单；见 §1.2。

飞行中预估未知、终态实际成本未知或月预算写入失败时，协调器令后续自动预算不可用；用户仍可逐次明确确认独立请求。当前标记只存在于进程内，**没有已实现的对账/恢复接口**。关闭再开控制面与真正重启进程也不是同一证据层级：前者的事件清理已测，后者的请求账本恢复未测且未实现。

## 3. 入口 × Provider × 预算 × 结果矩阵

缩写：G = `generate_image`；R = `run_scheme`；S = `run_github_skill`。`P` 表示下列定向执行确实通过；`source` 表示已核对实现但本轮没有独立组合用例；`open` 表示仍未闭合。表中覆盖的是明确列出的组合，不声称所有维度的笛卡尔积均已测试。

**本表中的“实际成本/实际值”是测试注入的执行器结果字段，“一次发送”是 fake Provider/执行器调用次数；均不代表真实上游账单或 Provider 内部网络请求次数。**

| Case | 入口 / Provider | 预算或费用条件 | 确认/拒绝/超时与期望行为 | 本轮证据 / 状态 |
|---|---|---|---|---|
| SP-01 | G / 托管 | 预算 0；估算分别 0、5、null | 每个新请求均需确认，旧确认不能放行第二次；批准后只发送一次 | 包测试参数化矩阵，P |
| SP-02 | R、S / 托管 | 预算 0；估算 0，实际 0 | 两次独立请求逐次批准；每次审计实际值为 0，不改成 null | 宿主参数化矩阵，P |
| SP-03 | R、S / 托管 | 预算 0；估算 5 | 批准清理挂起项与 timer；拒绝/超时不进入执行器；重放不重复确认或审计 | 宿主参数化矩阵，P |
| SP-04 | G / 托管 | 估算 5，余额/声明为 5/5、10/5 | 预算覆盖自动放行，不出现确认 | 包测试，P |
| SP-05 | G / 托管 | 估算 5，余额/声明为 4/4、10/4、10/11 | 不自动放行；测试选择拒绝后无发送、无冲销 | 包测试，P |
| SP-06 | G / 托管 | 声明为负数、NaN、Infinity、字符串 | 参数拒绝；不弹确认、不发送 | 包测试，P；HTTP JSON 不可编码的值属于直接调用负例 |
| SP-07 | R、S / 托管 | 正余额的相等/超额/未知估算 | 公共预算谓词锁定边界；R 的完整自动放行/预留路径已测 | 公共谓词与 R 宿主路径 P；S 托管足额自动执行完整组合未单列，open |
| SP-08 | G / 托管 | 预估 8、余额 10，两不同键并发 | 第一个同步预留；第二个转确认；实际费用 3 后剩余为 7 | 包 deferred Provider 并发测试，P |
| SP-09 | G → R/S / 托管 | 余额 5，G 飞行中占用 5 | R、S 同时请求都需确认；拒绝后无两类执行器调用 | 宿主共享协调器测试，P |
| SP-10 | R → G / 托管 | 余额 5，R 同步占用 5 | G 不能插队自动放行；拒绝后无生成调用 | 宿主共享协调器测试，P |
| SP-11 | G / 托管 | 8 个并发请求使用同键同输入 | 同一确认、同一 job、一次发送、一次冲销和审计 | 包并发测试，P |
| SP-12 | R、S / 托管 | 各 5 个并发请求使用同键同输入 | 同一确认/运行；同键不同 n 冲突；一次冲销和审计 | 宿主并发测试，P |
| SP-13 | G / 托管 | 确认期间调用方改写原对象；同键不同输入 | 执行冻结前的输入；pending 和终态均拒绝不同输入；字段顺序变化不重复执行 | 包测试，P；R/S 深层输入规范化有 source，未单列原对象改写测试 |
| SP-14 | G / 托管 | 同键拒绝或超时后重放 | 返回原拒绝/超时结论，不再弹卡、发送、冲销；其他确认卡独立 | 包测试，P |
| SP-15 | R、S / 托管 | 同键拒绝或超时后重放 | 不重复弹卡或审计；独立请求用独立 key | 宿主参数化测试，P |
| SP-16 | G / 托管 | 终态 success、failed、cancelled 的实际成本均未知 | 审计 null，不调用 `settle(0)`；后续自动预算转确认；原键仍只返回原任务 | 包参数化测试，P |
| SP-17 | G / 托管 | failed/cancelled，注入执行器费用数值 2 | 按该数值冲销一次，重放不重复 | 包参数化测试，P |
| SP-18 | G / 托管 | 未知估算的请求正在执行 | 即使其他请求估算已知且原余额足够，也需重新确认 | 包测试，P |
| SP-19 | R、S / 非托管 | 多结果：一项费用 5，另一项费用未知 | 总额 null；不把未知项当 0，不冲销账号预算 | 宿主参数化测试，P；托管 R/S + unknown 的完整组合未单列，协调器 unknown 另测 |
| SP-20 | G、R、S / 非托管 | 估算未知，执行器报告费用 5 | 保留自动放行；审计可有实际费用，但账号预算不被冲销 | 包/宿主测试，P；不证明第三方免费 |
| SP-21 | G / CLI 交互同意 | 预算 0、估算未知、`interactive` | 不再弹 App 卡；审计来源是 consent，实际费用如实记录 | 包测试 P；真实 TTY 交互与 R/S consent 全组合仍待专项回归 |
| SP-22 | G / 确认 HTTP | approved 缺失、字符串、数字、null | 拒绝非法回执；显式 false 才是用户拒绝；true 才批准 | 包测试与原 HTTP gate 套件，P |
| SP-23 | G / 确认时间边界 | 120 秒已到；timer 回调尚未得到执行机会 | 仍按绝对截止时间拒绝迟到批准；超时审计一次 | 包假时钟测试，P |
| SP-24 | G、R、S / 宿主确认 | 已批准/过期；主窗口关闭；控制面停止后再启动 | 清理 renderer/timer/listener；旧回执失效；挂起请求被拒绝；不重复订阅 | 宿主事件模拟测试 P；真实 Electron 行为/视觉不能由此替代 |
| SP-25 | R、S / 执行失败 | 同步异常；Skill 准备返回失败或抛错 | 尝试写一次失败审计，实际未知保留 null；同键不再执行 | 宿主测试，P |
| SP-26 | S / 取消 | 准备阶段请求取消，随后准备成功返回 | 不进入 Skill 执行器；调用既有取消入口和生成取消；审计 cancelled | 宿主 deferred 测试，P；全运行时与真实上游取消仍 open |
| SP-27 | 共享协调器 | finish 重复、已知实际比预估低、实际未知、预算存储抛错 | finish 幂等；已知值释放差额；未知/写入失败保留不可自动花费状态 | 协调器测试，P；没有持久恢复/对账能力 |
| SP-28 | G / 本地审计 | 拒绝 + 未知费用结果；关闭并重开 SQLite 连接 | 已成功写入的两行仍存在、费用为 null，无同键重复行 | 真实临时 SQLite + 生产审计 service，P；不是进程重启幂等 |
| SP-29 | Cloud MCP | allowlist、scope、撤销和脱敏 | 七工具只读；禁止生图/写工具；撤销服务状态与 401 负例保持 | API 三套就地测试，P；不是两个远程客户端的真实 OAuth 验收 |
| SP-30 | 普通 Web/Desktop | 用户直接提交、兑换后恢复、退出/换账号 | 保留 not_required 语义；跨账号恢复意图不得串用 | 本轮源码边界核对；恢复链的新一轮完整测试未在上述命令中执行，open |

## 4. B9 已执行命令与真实结果

全部测试使用本地 fake Provider/价格/时钟。宿主测试模拟 Electron 窗口和服务接线，没有真实收费调用、真实终端人工操作、生产部署或新增数据库 migration。

### 4.1 本地费用与宿主定向门禁

2026-09-07 20:52（本机时区 Asia/Shanghai），执行：

```bash
pnpm exec vitest run packages/automation-server/src/__tests__ apps/desktop/electron/main/__tests__/automation-spend.test.ts apps/desktop/electron/main/ipc-v25/__tests__/automation-domain.test.ts apps/desktop/electron/main/__tests__/automation-setup.test.ts
```

**结果：9 个文件、120 个测试全部通过；0 failed、0 skipped；退出码 0。** 新增矩阵位于 [包费用测试](../../packages/automation-server/src/__tests__/generation-spend.test.ts) 与 [宿主费用测试](../../apps/desktop/electron/main/__tests__/automation-spend.test.ts)，同时包含原有 gate/server 等回归、automation IPC 与 setup 回归。

此前执行过包内 2 文件 / 47 例、包全量 6 文件 / 67 例，以及宿主首轮合并 7 文件 / 90 例；这些都是同一批次的阶段结果，**不与最终 120 相加**。后续增加了明确返回零费用、准备返回失败和预算写入失败回归，以最终组合命令为本段结果。

### 4.2 Cloud MCP 独立回归

2026-09-07 20:37，执行：

```bash
pnpm --filter @musefold/api exec vitest run src/modules/mcp/__tests__/manifest.test.ts src/modules/cloud-mcp/__tests__/routes.test.ts src/modules/cloud-mcp/__tests__/service.test.ts
```

**结果：3 个文件、12 个测试全部通过；0 failed、0 skipped；退出码 0。** 覆盖七个只读工具、scope 过滤、禁止写/生图、授权 owner 过滤、撤销与 secret-free 返回。测试使用就地替身，不能替代生产 OAuth 与两独立远程客户端验证。

### 4.3 静态门禁与范围限制

| 命令 / 检查 | 本子任务最后一次结果 | 解释 |
|---|---|---|
| `pnpm --filter @musefold/automation-server run typecheck` | 通过，退出码 0 | 包内接口与测试类型通过 |
| 对 5 个改动文件执行 `pnpm exec biome check` / 格式修正后复核 | 通过 | 无遗留本轮 lint 错误；包含两个新增测试 |
| `git diff --check`，范围限定上述源码与包 | 通过 | 不代替未跟踪新文件内容检查；新测试另经 Biome |
| 本子任务末次 `pnpm run typecheck` | 当时未通过 | 当时仅剩其他并行改动 `design-scheme/share.ts` 中 `PreparedAsset.origin` 未接受 `uploaded`；不是费用测试失败。后续是否修复、统一 check 是否通过，以 B9 主验收为准，本文不把旧失败当作最终版本结论 |
| `pnpm run check`、build 后完整 Electron E2E、双端 E2E | 本费用子任务未独立执行最终全量 | 交由主线程统一门禁，不从就地 120 例推导全量通过 |

证据分层：gate/宿主事件模拟属于 `unit`，其中原 HTTP gate 套件确实运行本地 HTTP server；SQLite 重开测试包含真实临时 SQLite 和实际审计 service，仍只证明已写审计能恢复。**没有独立 OS 进程退出再启动、Worker 重启或发布产物测试。** 这些运行未在本子任务内绑定新的提交或持久 artifact；最终机器可读证据需由主验收关联，不能仅复制数字将 manifest 改为 pass。

## 5. B9 时点仍开放的工作（后续进展见 §8）

| Open | 具体未闭合项 | 为什么本轮通过不够 | 后续归属 |
|---|---|---|---|
| SP-O1 | 进程/控制面重建后同键恢复、同键不同输入拒绝、跨入口幂等作用域 | 当前 submissions/jobs 是内存；外部运行和普通生图各有登记范围，重建后不能依靠原 Promise | §6 持久请求账本 |
| SP-O2 | 跨进程预留、发送边界、真实账单对账与 unknown 解除 | 当前 coordinator 只有内存标记，没有 durable reservation/reconcile API | §6 |
| SP-O3 | 月份切换、账号/Provider 切换、控制面重启期间的费用归属 | 月预算 settings 有月份逻辑，不等于请求与 owner/月度预算事务绑定；本轮未跑完整身份切换矩阵 | §6 与 G-SPEND-02.3/5 |
| SP-O4 | 审计写入故障后的可靠补写、终态与预算冲销原子性 | 当前 hook 故障不触发重复执行，但可能丢审计；真实 SQLite 重开测试只覆盖写入成功后读回 | §6 |
| SP-O5 | 真实 Electron 多卡排队、跨窗口去重、关闭/取消与视觉 | 本轮宿主测试使用模拟 EventEmitter/窗口，不能代替真窗口、IPC、渲染层完整组合 | T3 与 G-SPEND-02.2 |
| SP-O6 | 全部 Provider/入口组合、CLI TTY、托管 R/S unknown、S 足额自动执行、真实上游取消 | 当前矩阵逐项记录了 helper/source 与运行组合差别，未穷举所有组合 | G-SPEND-02.1/2/3 增量验证 |
| SP-O7 | 普通 Web/Desktop 额度恢复与退出/换账号完整回归 | 这是 B6 已有产品面；本轮没有重新执行其完整恢复测试，也没有新增云审批 | G-SPEND-02.5/6 |
| SP-O8 | 两个远程 MCP 客户端与生产撤销效果 | 12 个单测不等于远程 OAuth、持久 token、实际网络与发布配置通过 | G-RELEASE 的 MCP 验收 |
| SP-O9 | Web 方案 Agent 文本模型/图像调用的费用入口 | 方案确定性 CRUD 不代表 Agent 编译可执行；当前 unavailable 边界仍须后续正确接入 | G-CLOUD-02/03，见 §7 |
| SP-O10 | 执行器费用 provenance 与可信账单证据 | 本地 `cost → actual_cost/costPoints` 可来自价格估算；mock 返回数值只能证明传递与冲销，不能证明上游扣费 | SP-D1/4/5，§1.2 |
| SP-O11 | paid-owner 与 Provider/key 的可靠绑定 | 遗留 `managed_by` 无 owner；当前 v25 会话和同步 owner 不能补作付款人；key 变更与缺失绑定没有 durable 策略 | SP-D1/3/5，§1.2 |
| SP-O12 | Skill 文本连接、模型、凭据与费用的冻结范围 | 执行器后选当前文本连接；路由仅估图像价，结果聚合不含文本账单；B9 mock 没有证明该组合 | SP-D1/3/4/6，§1.2 |
| SP-O13 | Provider 内部 retry 与实际发送次数 | gate 一次执行内部可能多次 HTTP 请求，网络异常不能证明上游未收费；当前 retry 会重新读 key | SP-D3/5/6，§1.2 |

本轮改动不修改 G-SPEND-02 的整卡状态。后续不能通过删除上述 open、把 unknown 写成 0、重启丢弃内存状态，或将管理员批准当成用户批准来销账。

## 6. SP-D 原始任务拆解（B9 时点尚未实现，现状见 §8）

目标是让已有本地三类 Agent 花费动作在进程中断后仍能识别已授权、已发送和待核对的请求，防止自动重复发送或重复冲销。它属于本地执行控制记录，不建立影子用户钱包，不改变上游计费单位或余额。

### SP-D1：确定请求身份、状态与兼容策略

**范围**：先检查现有 core/desktop-db 运行账本能否复用；固定 owner/本机身份、Provider、action、调用者、幂等键的作用域。实体与 DTO 按仓库规则从 `packages/contracts` 的 zod schema 推导；本机内部字段留在正确的本地域。

**最小设计输出**：稳定 request ID；冻结输入摘要；确认来源/时间/截止时间；预算月份与支付身份快照（有证据的 owner 或明确 unbound）；图像与 Skill 文本连接/模型/credential epoch；预留值（nullable）；逐调用发送标记；结果与费用的独立状态；费用 provenance（本地价格估算、执行器报告、上游账单核实等，不因字段名推断）；与原 job/run/audit 的关系。状态可参考“已登记 → 待确认 → 已授权 → 发送边界已记录 → 终态 / 待核对”，最终名字需经源码契约落实，不直接复用云端 `pending_approval` 产品状态。

**验收**：同键何时重放、何时冲突、跨入口是否冲突、换账号如何拒绝都有明确规则；确认引用的是同一冻结输入与有依据的支付身份；paid-owner 缺失有受限行为，不能从当前登录/同步 owner 猜测绑定；Skill 文本/图像两个连接分别记录；估算数值不得升级为已核实扣费；没有凭据进入记录；无“管理员可代批”的隐含语义；不以现有终态 audit 反推曾经是否发送。

### SP-D2：受管存储与事务性预留

**依赖**：SP-D1。**范围**：使用受管 desktop-db/core 的增量迁移和 repository，不在 automation-server 内另开第二套持久 DB。若需要表/字段/索引，遵循 SQLite `db:generate → db:bundle → 旧库迁移测试`。

**验收**：同 key 并发插入由唯一约束裁决；记录请求和占用策略预算在同一事务边界完成；足额、临界、不足、unknown 以及事务回滚均有真实 SQLite 测试；旧用户数据和现有审计不丢失；inline migration 与生成文件同步。

### SP-D3：三个入口统一授权与发送边界

**依赖**：SP-D2。**范围**：G/R/S 都消费同一 repository，先完成 durable 登记/授权，再标记发送边界，之后才能调用 Provider 或会触发花费的执行器。必须接到实际图像请求、Skill 文本请求及后续图像调用；仅在三个路由外包一层不算闭合。Provider 配置/key epoch 和文本连接须冻结并在发送时校验；上游没有已验证幂等/查询能力时，不确定发送失败不能通过内部 retry 自动重发。保留已有 UI 确认和 CLI 协议，不新增 Cloud MCP 写工具。

**验收**：多个独立进程/连接同时使用同键，最多取得一个有效发送资格；不同输入/owner/Provider/key epoch/文本连接不能借旧确认放行；unbound 不得伪装已绑定付款人；过期/拒绝/取消不发送；未知预估仍需明确批准；三入口之间的预算竞争通过数据库而非单进程 Map 裁决。fake HTTP Provider 需同时统计实际网络发送次数与 executor 调用次数，注入重试期间换 key、图像网络错误/5xx、文本已发送后中断、文本后图像前取消，证明冻结范围与 unknown 保护没有绕过路径。

### SP-D4：终态、费用冲销和审计一致性

**依赖**：SP-D3。**范围**：终态记录、预算调节与审计/outbox 建立可恢复的一致性边界。现有 electron-store 月用量与 SQLite 不能假称是同一个事务：需明确它是可重建投影，或将策略用量改为从受管记录读取；迁移策略由该任务具体设计。

**验收**：相同结果重复到达只冲销一次；失败/取消带已报告费用仍记账并保留 provenance；部分未知不写成 0；明确零费用仍为 0；本地策略用量与已核实上游费用分开，旧 `actual_cost` 不自动升级为账单凭证；月度切换按已确定的请求归属处理；预算存储或审计写入中断后能可靠补齐，不靠重复上游请求补账；不修改上游实际账户余额。

### SP-D5：重启恢复与待核对请求处理

**依赖**：SP-D3/4。**范围**：在旧进程退出后恢复请求、确认和预留。已开始发送但缺少可信终态的请求进入待核对；只有上游支持且已验证的幂等/查询能力才能支撑安全重放。

**验收**：确认前、批准后发送前、发送标记提交后、上游返回后落库前、落库后审计投影前逐点终止并重启；恢复不会自动重复花费；旧确认不能放行新请求；无可信上游状态时保留 unknown 和预算保护，不自动释放。若上游不支持幂等或查询，不承诺网络意义的“恰好一次”，验收标准是**不自动重发不确定请求并提供明确、可审计的恢复选择**。

### SP-D6：真实进程验收、产品恢复与证据登记

**依赖**：SP-D1–D5。**范围**：新增独立子进程 harness，使用 fake Provider HTTP server 记录发送次数和冻结请求摘要，真实 SQLite 验证持久状态；再做必要的 Electron UI 恢复回归。

**验收**：两个进程竞争、重启、重复回执、撤销/换账号、月底跨月、预算持久化失败、审计补写、取消与 late result 全有断言；每项同时核对上游调用次数、策略用量、请求终态与审计条数。报告明确进程启动/停止方式与故障注入点，`test.skip` 不算通过；`check`、build 后 Electron E2E 和涉及共享 UI 的双端 E2E 按根 AGENTS 执行。

上述任务当前没有已实现的 durable harness 或可引用通过数。实现后把实际文件名和命令回填，不预先编造 `test:spend-restart` 一类不存在的脚本。

## 7. Web 方案 Agent 后续授权边界

G-CLOUD-02 接入文本编译/修改、G-CLOUD-03 接入图像运行时，应先在同一任务中明确：调用者是谁、凭据由谁配置、由哪个账户承担费用、用户本次操作授权多少步骤/输出、价格未知时如何解释或阻止、费用/终态从哪里读取，以及重复提交如何去重。

用户在 Web 显式点击“编译方案”可以作为有界文本操作的产品授权来源，但它不能自动扩展为任意图像生成、后台自动重试、市场安装或 Cloud MCP 自主花费。Agent 生成的计划、文本和 tool call 都不是新的费用授权。模型调用次数、修复循环和结果资产必须受本次操作已确定的边界约束。

如果接入确实需要新的云端预算产品或批准 API，先形成独立、可审阅的产品与契约方案；不能把本地 `reserve()` 接口复制到云端后就认为已获得实施授权。Cloud MCP 保持原七工具和只读 scopes，管理员后台继续与用户花费授权分离。

## 8. SP-D 后续实施进度与真实验证（2026-09-07 22:07）

这是 B9 后独立的源码阶段。SP-D1/2 的受管存储首刀已实现并通过 SQLite 测试，随后继续完成非豆包本地 `generate_image`、`run_scheme`、`run_github_skill` 的实际发送接线。**这不是 SP-D1–D6 或 G-SPEND-02 整卡验收完成。** 当前不存在真实上游已核实账单、unknown 解除 API 或已通过的本轮完整 Electron 发布验收。

### 8.1 已落地的边界

| 领域 | 当前源码与验证 | 明确限制 |
|---|---|---|
| 受管存储 | [desktop-db schema](../../packages/desktop-db/src/schema.ts)、[0007 增量迁移](../../packages/desktop-db/migrations/0007_strange_argent.sql) 与 bundled migration；新建 policy、budget period、request、call 四表，audit 增 request/event 关联 | 无新钱包；预算是本机执行策略，不生成、同步或修改上游余额 |
| 请求作用域 | [本地域 zod](../../packages/desktop-contracts/src/automation-spend.ts) 与 [repository](../../packages/core/src/db/repositories/automation-spend.ts)：同一物理 DB 的 `local-automation-v1` 作用域；三入口同 key 冲突；唯一索引 + immediate transaction；先登记输入/身份，再授权、外层 begin、逐调用 claim | 网络“恰好一次”没有承诺；无可信结果时不自动重发；备份回滚可把 SQLite 状态回退，尚无防回退 tombstone |
| 旧设置迁移 | [settings/automation](../../apps/desktop/electron/settings/automation.ts)：首次从 electron-store 导入已存在策略预算/历史期用量，此后 SQLite 为事实源，electron-store 仅最佳努力投影 | 导入不是新余额；旧冻结/legacy 入口的兼容用量仍使用过渡记账接口，不声称它们已全部 durable |
| 付款身份 | 图像 keychain 和 AI text keychain 读取一次密文/密钥快照，epoch 来自密文 SHA-256；Provider/文本连接、model、base URL、epoch 独立绑定，密钥只在主进程内存 | 遗留 `managed_by=account` **仍没有可信 paid-owner**。当前非豆包本地 Agent 对该连接记录 `PAYMENT_IDENTITY_UNBOUND` 并停止发送，CLI interactive/用户确认均不能虚构绑定；普通 UI 点击语义未改 |
| G 实际发送 | [adapter](../../apps/desktop/electron/main/automation-spend.ts)、[gate](../../packages/automation-server/src/generation-routes.ts) 与 [core execution](../../packages/core/src/providers/execution.ts)：参考图同批已读字节 hash、冻结 key/model、同步 claim 后才 fetch；durable 图像请求不做内部 retry/重定向重发 | CLI headless 独立宿主未接这个 desktop adapter；冻结豆包入口继续旧路径。不能把所有 localhost/所有 Provider 称为 durable |
| R 实际发送 | [durable routes](../../apps/desktop/electron/main/automation-durable-runs.ts) 在同库登记方案文档/revision、调用输入、固定 jobIds 和 provider identity；[run-session](../../apps/desktop/electron/main/design-scheme/run-session.ts) 在编译前校验文档，每张图分别 claim | 当前独立方案库和主库之间无跨库原子提交；中断后的部分结果可以读取，不自动继续剩余图片；普通 trial/formal/UI 默认路径未变 |
| S 文本与图像 | 同一 request 冻结实际 Skill source bytes 摘要、用户输入、图像与文本身份；[skill-runtime](../../apps/desktop/electron/main/ipc/skill-runtime.ts) 注入冻结文本 profile/key/fetch 与逐图执行器；[run spend](../../apps/desktop/electron/main/automation-run-spend.ts) 在真实文本 fetch 前 claim，限制最多 10 次文本调用，图像限定原 jobIds/张数 | 文本 usage/HTTP 成功不是积分账单，文本费用仍为 unknown；原有限文件 fallback 可在同一请求内继续已授权图像，不能另增图像数量或重试原不确定调用 |
| 费用来源 | 每 call 分 `unknown/local_price_estimate/provider_reported/verified_charge`；当前实际 image hook 为 local estimate 或 unknown；文本 hook 为 unknown。只汇总完整已知值；BYOK 不冲销 managed 策略预算 | `verified_charge` 契约存在不代表当前 Provider 已有可信账单核对；测试注入数字只证明记录逻辑 |
| 终态与恢复 | 终态、reservation 收敛和审计在 SQLite 事务内；审计写入失败回滚终态但保留已写 call evidence；G 优先恢复已提交 canonical success/cancel，再处理一般 interrupted；late cancel 的即时/重开费用一致 | 未发送中断可终止；started 未核实保留 unknown。unknown 的受控核对/释放仍未实现；待确认记录保留原绝对截止时间，启动时过期收敛；未过期卡片不自动重建 UI，需要同键重提交重新接续，不能宣称完整重启体验 |

只有绑定在当前请求中的明确身份能被复用。账号/Provider/凭据变化不能借旧确认执行；已终态同 key 的纯结果读取无需重新打开原输入文件或当前 Provider，因此输入 GC、Provider 删除后仍能取回已有结果。密钥从不写入 requests/calls/audit 或结果；正文和文件摘要是用户授权请求数据，不是密钥容器。

### 8.2 命令与真实结果

2026-09-07 22:07（Asia/Shanghai），执行：

```bash
pnpm exec vitest run packages/automation-server/src/__tests__ packages/core/src/db/repositories/__tests__/automation-spend.test.ts packages/core/src/db/repositories/__tests__/automation-spend-process.test.ts packages/core/src/db/__tests__/desktop-db-takeover.test.ts tests/repo/desktop-db-bundle-freshness.test.ts apps/desktop/electron/main/__tests__/automation-durable-generation.test.ts apps/desktop/electron/main/__tests__/automation-durable-runs.test.ts apps/desktop/electron/main/__tests__/automation-spend.test.ts apps/desktop/electron/settings/__tests__/automation-spend-projection.test.ts apps/desktop/electron/security/__tests__/keychain-spend-epoch.test.ts apps/desktop/electron/ai/__tests__/connection-store.test.ts apps/desktop/electron/main/design-scheme/__tests__/run-session.test.ts
```

**17 个文件 / 174 个测试通过；0 failed、0 skipped；退出码 0。** 同批 `pnpm run typecheck` 退出码 0；13 个本轮接线/测试文件已通过 Biome；最终取消修复涉及 3 个文件另经 `pnpm exec biome check` 复核无警告；限定本费用源码范围的 `git diff --check` 通过。就地通过不替代后续主线程 `check`、build/Electron E2E、打包和生产验证。

| 证据 | 实际做了什么 | 不证明什么 |
|---|---|---|
| SQLite/repository | 真实临时 SQLite、旧库升级、两个连接竞争、同键输入/身份冲突、零预算、超额、绝对截止/重复回执、跨月、estimate/unknown/external、终态 audit 故障回滚、导入与投影故障 | fixture 的 account owner 是测试输入，不能当作生产已有 owner 绑定 |
| 独立 OS 进程 | [process test](../../packages/core/src/db/repositories/__tests__/automation-spend-process.test.ts) fork Node，通过 IPC barrier 竞争同一真实 SQLite；发送标记后/本地 HTTP 返回后 SIGKILL；重开后不再次 claim，HTTP 次数保持 0 或 1 | 这是 repository/发送边界 harness，不是三条生产 Electron 路由都已经通过真实进程 kill/relaunch |
| G runtime + HTTP | [7 例](../../apps/desktop/electron/main/__tests__/automation-durable-generation.test.ts)：真实 core +本地 HTTP，一次发送、重开结果、输入 GC/Provider 删除、无 owner、503 无重试、key/ref bytes 改变、late cancel 的 3 点 evidence、canonical success 提交与 audit 之间中断 | 测试用 loopback fake Provider，3 点是配置的本地估算，不是真实收费 |
| R/S runtime + HTTP | [13 例](../../apps/desktop/electron/main/__tests__/automation-durable-runs.test.ts)：真实方案编译、真实 Skill `streamText`、真实 core、生图 loop 与 SQLite；2 图并发同键重放、分别记录文本/图像、image/text owner absent、text 503/307 不重试/不跟随、文本上限/epoch、登记后 revision 变化、文本期间换 image key、首张发送后取消、Skill generation-start 同步取消、text 预先 abort/流式 body 读取期间 abort；后三项均 HTTP 0/calls 0 | GitHub source 在本地 fixture 注入，不访问公网仓库；未穷举全部上游协议/商业模型，不证明收费渠道的真实取消效果 |
| legacy 回归 | 保留 B9 的 same-process gate/宿主矩阵及默认 scheme 管线，验证新可选接缝没有改变旧默认路径 | B9 测试显式隔离 durable wrapper，不能拿旧 mock 数再次证明新账本 |

前序 28 例存储/迁移、4 例独立进程、87 例阶段组合、14/25 例接线组合、22:00 的 171 例组合与最终 174 有重叠，**不累加**。B9 的 120 例/Cloud MCP 12 例保留其原日期与范围，不算为本 SP-D 新增通过数。

### 8.3 任务卡仍需完成的验收

- **SP-D1/2 已有可复用实现与真实 SQLite 证据**；paid-owner 生产绑定缺失被明确限制，不能标成“托管付款账号已接通”。
- **SP-D3 已接本机 Electron 的非豆包 G/R/S 实际发送**；三入口共用 DB，图像/文本分别冻结与 claim。独立 headless 宿主与冻结域不在本次接线；真实 Electron 生产路由 kill/relaunch、所有预算/确认组合仍需补齐。
- **SP-D4 已有 SQLite 终态/audit/策略记录一致性、electron-store 投影迁移与来源分离**；上游收费核实和未知费用后续升级/冲销没有实现。
- **SP-D5 部分完成**：自动恢复不重复发送，未知保持待核对；尚缺明确、可审计的 reconciliation 操作、未过期确认卡自动恢复、备份回滚防重复策略，以及 R/S 主库/独立方案库的完整恢复选择。
- **SP-D6 部分完成**：独立进程仓储 harness 与真实本地 Provider 接线测试通过；完整 Electron、CLI TTY、两独立远程客户端与发布产物/生产验证仍由各自阶段验收，不能从本节推导通过。
- §5 的 SP-O1–4、10、12、13 已获得上述实质进展，不能继续称“完全没有 durable 实现”；同时它们的剩余项、SP-O5–9/11 仍保留。Cloud MCP 持续七工具只读，Web scheme Agent 费用边界归云端任务，管理员不能替代用户确认。

## 9. 可独立领取的后续 goal

> 完成 SP-D5/6 的恢复闭环：基于现有本地 G/R/S SQLite 请求与 call 账本，实现明确且可审计的 unknown 核对/释放操作、原截止时间下的确认卡恢复与备份回滚防重复策略，并在真实 Electron 生产路由上逐点 kill/relaunch 验证不自动重复发送、策略用量和审计一致；保持无 paid-owner 时受限、估算不冒充账单、Cloud MCP 只读，按本节边界回写真实证据。

## 10. 可信付款身份与远端执行恢复（P1–3 本机切片已验，P4–6 待闭合）

本节始于 2026-09-07 的只读源码审计，09-08 已按 B12 源码与测试更新，细化 SP-O10–13、SP-D3/5/6 的后续工作。**P1本机实现与合成验收已收口，包括实际PG/宿主及live、backup保存间SIGKILL；真实历史来源审定仍是运维前置。不增加§8的174项历史通过数，不据此解锁托管连接，也不将G-SPEND-02整卡改为完成。** §9 的本地恢复任务仍有效；本节增加的是第一方托管图像的付款身份与远端恢复链路，不能替代 BYOK 上游没有查询能力时的受限处理。

推荐路径是：**桌面主进程使用已有 bearer 会话，复用现有 generation API、PostgreSQL 执行记录和 worker。** 在这条链路上补凭据来源、冻结身份、执行回执与查询恢复；本切片不另建 signed grant、独立签名密钥或平行图像代理。

### 10.1 当前源码事实与可复用边界

| 领域 | 已核对的事实 | 对下一切片的影响 |
|---|---|---|
| 桌面账户 | [account-domain](../../apps/desktop/electron/main/ipc-v25/account-domain.ts) 与 [session store](../../apps/desktop/electron/main/ipc-v25/account-session-store.ts) 加密整份版本化会话：bearer、issuer、auth epoch、principal、受限状态及独立空间恢复意图；本地空间以 issuer/principal 哈希隔离 | 已拒绝旧 A 的迟到成功/401 覆盖 B、未固定 issuer 的旧 token 转发以及受限 token 用于普通业务；本机 owner 仍不证明 payer。独立空间请求先持久化同一申请，远端成功/本地写失败后重启只重放该申请 |
| 两种用户 ID | [auth middleware](../../apps/api/src/auth/middleware.ts) 从 Better Auth session 得到内部 `userId/sessionId`；[account service](../../apps/api/src/modules/account/service.ts) 的 `AccountSummary.id` 来自 New API `getSelf().id` | 内部 principal 与上游 payer 必须分开记录；不可将 UI 账号 ID、同步 owner、PG `account_credentials.user_id` 混用 |
| 凭据来源 | account service 仍通过 relay 供给 token；[credential schema](../../packages/db/src/schema/credentials.ts) 和 PG 0009 已增加固定 issuer/owner、credential ref/语义版本、状态与验证时间；旧行保持 unverified | 新绑定来自同一次受信上游会话，不能由当前用户映射补填。`keyVersion` 是加密版本，不等于付款凭据版本；worker 实际使用这些字段仍属 P2/3 |
| 绑定提交 | [new-api delegation](../../apps/api/src/auth/new-api-delegation.ts) 与账号身份服务已按 issuer/owner 分离主体；外部验证后以 PG 版本/CAS 原子激活身份、relay、credential，失败补偿仅删除本次候选会话 | PG 内原子提交不覆盖 New API 供给/刷新和 Better Auth 先行创建会话；上游已完成、本地保存失败仍需恢复。PG COMMIT、cookie 输出、响应断连的独立故障矩阵尚未全覆盖 |
| 托管本地连接 | [图像管理](../../apps/desktop/electron/main/ipc-v25/providers-domain.ts) 与 [Agent 连接](../../apps/desktop/electron/ai/connection-store.ts) 有托管标记；[图像 keychain](../../apps/desktop/electron/security/keychain.ts) 与文本 keychain 的 epoch 表示本地密文未变 | 标记和密文 epoch 均不证明账户归属；不能把新服务端证明套到遗留 key。现有 local Agent 的 `PAYMENT_IDENTITY_UNBOUND` 保持有效，直至某个明确的新托管执行连接真正接通 |
| 现有 API 身份 | [API 接线](../../apps/api/src/app.ts) 对业务 generation 路由使用 `requireSession`，支持会话 cookie/bearer；路由把服务端解析出的 principal 传给 generation service | 第一方在线 API 已有可信调用身份，不需要另签一套身份 token。Cloud MCP OAuth token 是否能进入此会话路由必须有明确负例，不扩展 MCP scopes/manifest |
| 持久幂等 | [generation service](../../apps/api/src/modules/generation/service.ts) 在事务中创建 run、event、graphile job；[PG workbench schema](../../packages/db/src/schema/workbench.ts) 有 `(userId, idempotencyKey)` 唯一约束；并发输家再次比较冻结逻辑输入 | 可复用身份、入队和冲突语义。当前比较还没有 payer/version；跨 principal 允许同键，因此桌面不得把 A 的旧 call 改拿 B bearer 提交 |
| worker 发送 | [worker tasks](../../apps/worker/src/tasks.ts) 有行锁认领、attemptCount epoch、lease、发送前 CAS；已发送租约失效转 unknown；任务队列 `max_attempts = 1` | 可复用实际执行边界。但当前仍按 userId 读取最新 credential，未按 run 固定付款人/版本，也未检查授权账户会话是否已经失效 |
| HTTP 重发保护 | 文档写入时的 [image gateway](../../apps/worker/src/image-gateway.ts) 已为生成/编辑设置 `redirect: error`，在发送回调前后检查 abort | 这已是当前源码事实，不能继续登记成“尚未加 redirect”。仍需在新 binding/receipt 链路下复测；本节不引用其他任务尚未归档的通过数 |
| 查询和资产 | 已有 owner 范围的 GET/SSE/cancel、参考图上传、资产 URL、历史；固定云图像模型由 [cloud generation policy](../../packages/domain/src/cloud-generation-policy.ts) 定义 | 可以复用远端执行和资产通路。`GenerationJob` 当前没有完整 payer/dispatch/cost provenance 回执；响应丢失且尚未拿到 run ID 时缺按幂等键只读定位接口 |
| 历史清理 | generation service 的 purge/empty-trash 可硬删 run；幂等唯一键就在 run 行上 | 仅复用现有 run 不足以防止旧本地备份在历史清理后重新提交并收费；执行身份须独立于可删除历史/资产保留 |
| 费用与文本 | 当前 worker 不产出已核实单次收费凭证；[New API client](../../packages/new-api-client/src/index.ts) 没有已实现的逐调用账单查询方法；generation API 当前提供图像能力 | 远端成功、取消、usage、余额变化或 `costPoints` 均不能代替账单。托管 image 接通不代表托管 Skill 文本已接通，SP-O12 不能整项销账 |

### 10.2 为什么本切片不需要独立 signed grant

| 要保证的约束 | 本方案的强制位置 | 是否要求独立 grant |
|---|---|---|
| 谁提交请求、谁能读结果 | 同一 TLS 第一方 API 的 session 校验、owner 范围查询 | 不要求 |
| 使用哪个付款人、哪版凭据 | 服务端 credential provenance；run 快照；发送前再次核对 | 不要求；签名不能修复错误的来源绑定 |
| 同意后不换输入、不借旧确认换账号 | `expectedBinding` 与冻结 request digest；条件入队；本地 auth epoch | 不要求；客户端提交的 expected 值仅是期待值，不能授予权限 |
| 并发不重复执行、重启不重付 | PG 唯一约束、worker 发送 CAS、独立执行回执、查询恢复 | 不要求；即使签 grant，仍需要这些持久记录 |
| 到期、撤销、模型/输出数量限制 | 服务端状态与版本校验、冻结能力和请求上限 | 不要求 |
| 给第三方转交窄权限、跨信任域验证或离线验证权限 | 未来独立委派协议及其撤销/受众模型 | 这类新增需求才值得另评 grant；不属于本切片 |

桌面 Agent 继续经主进程既有 Automation 工具执行，不直接拿账号 bearer。普通用户点击的授权语义、Cloud MCP 七工具只读、管理员不能代批均保持原边界。此方案让图像实际在云端执行，提示词及适用的参考图进入云端通路；连接选择和能力描述必须如实表达该行为，不能把原本的本地 BYOK/遗留托管 key 静默转换成云执行。

### 10.3 最小接口与持久字段设计

下表区分已实施的 P1 接缝与待实施的 P2–6 接缝。共享传输实体从 `packages/contracts` 的 zod schema 定义；纯本机记录留在 desktop-contracts/desktop-db。优先扩展已有 account/generation 服务，不另建支付平台。

| 接缝 | 最小新增内容 | 必须保持的约束 |
|---|---|---|
| account credential 来源（已实施） | `upstreamIssuer`、`upstreamOwnerId`、`credentialRef`、`credentialVersion`、`status`、`verifiedAt`；保留现有 externalTokenId/ciphertext/keyVersion | owner 来自取得该 key 的同一受信 relay 身份；并发写入有版本/CAS。现有行不得默认填当前账户映射，应完成验证/重新供给后激活。加密密钥轮换和付款凭据变更分别处理 |
| 服务端执行 binding 查询（已实施） | `GET /api/v1/account/execution-binding`；[canonical schema](../../packages/contracts/src/account-identity.ts) 使用嵌套 `payer: {issuer, ownerId}`、`credential: {ref, version}`，另含 API issuer/principal/provider/model/能力与状态 | DTO 的 providerId 是 `cloud-default`，凭据存储 provider 才是 `new-api`；`AccountSummary.id` 仍是上游 ID。binding 只是查询时状态，不授予执行权限；P2 入队和 P3 发送仍必须重查 |
| POST generation 的 expectedBinding | 可选桌面执行上下文：稳定 localRequestId/localCallId、`expectedBinding`、对应冻结输入摘要；必要时附原确认截止时间 | 从 session 得到 actual principal，在事务中重查 credential 来源/状态并与期待值相等才创建。不同身份/版本/输入使用同键必须冲突。actor 来源可记录审计，但不能只相信客户端标签就获得权限 |
| run 执行快照 | 固定 payer issuer/owner、credential ref/version、模型/能力、规范化最终请求摘要；另存需要的 `authorizingAuthSessionId` | 现有 `generation_runs.sessionId` 是工作台会话，不能复用为 auth session。worker 只能使用该快照允许的凭据，不得临时回退到“当前最新 key” |
| execution receipt / tombstone | 独立持久行，唯一 `(principalId, idempotencyKey)`；存 run ID、请求与 binding 摘要、付款身份、发送状态、结果状态、费用 provenance/nullable amount、单调版本或事件序号 | 不随 run/资产 purge、retention 或历史清空 cascade 删除。相同执行终态重复到达幂等更新；不同摘要冲突。软/硬删历史后仍拒绝复用旧键创建新收费任务；若未来设置回执保留期限，过期键也须明确拒绝，不能悄悄恢复可执行 |
| 查询恢复 | 现有 GET run 返回非秘密执行证据；同 generation 域新增按 Idempotency-Key 的 owner 范围只读查找 | 有 run ID 查同一个 run；无 run ID 查同一个 key。本切片恢复默认 query-only；不能调用 `/retry`，也不因 404/网络失败改生成新 key 自动 POST |
| 本地 session 与 call 关联（session 已实施，远端 call 待 P4） | safeStorage 会话已固定 API issuer/auth epoch；待本地 call 存 issuer、principal、payer、binding ref/version、idempotency key、request digest、remoteRunId/receipt revision | bearer 只在主进程内存/安全存储；SQLite、审计、IPC、日志、导出不存密钥。将“本地已取得提交资格”“远端已受理”“上游可能已发送”分开，不能把等待远端回执误写成已知未收费 |

首刀只支持服务端明确公布的固定云图像模型和能力。`providerId` 当前在云端请求中不决定任意上游模型；不能把桌面本地模型字段直接当作服务端承诺。R/S 已编译 prompt、云端再次组合 prompt、8000 字符输入上限、本地参考图与云端 reference ID 的差异，须在扩大范围时明确适配并测试。

图像与文本继续分别冻结。新云图像连接使用账号 auth epoch 和服务端 credential version；BYOK 文本仍使用原 keychain epoch/外部付款身份。尚无可信来源的托管文本连接保留 unbound。不能用图像付款人填充文本 owner，也不能把本机 Automation 策略预算变成上游钱包或自动宣称服务器已执行该预算。

### 10.4 发送、换号与恢复的裁决顺序

1. 主进程读取一个完整 session snapshot，经同一 API 查询可用 binding；登记原输入、图像/文本各自身份与本地 call。预算为 0 或估价未知时保留现有逐次确认规则；无法核实付款身份时不弹一次确认就放行。
2. 确认后、发送 POST 前再次比较 auth epoch/API issuer；POST 仅携带该次捕获的 bearer。服务端用 session 和 credential 行重查 `expectedBinding`，在同事务冻结执行身份、写幂等回执并入队。客户端回包丢失也不能丢掉服务端唯一执行记录。
3. worker 在真正付费发送前校验 run epoch、credential 版本/owner/状态以及适用的 auth session 有效性，并以原有发送 CAS 获得资格。解密使用这次已核对的凭据快照；不能验证旧版本后再另读新 key。凭据失效/轮换与发送 claim 使用一致锁或条件更新，明确哪一方先成功。
4. 失效先于 claim：不发送；claim 先于失效：该次发送已进入不可可靠撤回的边界，保留原 payer 和可能收费状态，阻止后续 call。HTTP 失败、取消、迟到结果和 worker 重启均不得改用新版本重新发送。
5. A→B 切换立即使本地 A 的未提交 call 失效；旧 A 的 401/响应按期望 epoch 处理，不覆盖 B。B 不能读取 A 的远端记录，也不能拿 B bearer 重新提交 A 的 local call。重新登录 A 后可查询 A 的旧记录，不能把当前 credential mapping 覆盖到旧 receipt。
6. 服务端已经接受的任务是持久授权，本地 abort 不等于云任务已经取消。若要求“登出后尚未发上游的任务也停止”，须保存独立 authorizing auth session，并让 worker 发送前核对失效；账户切换需撤销旧桌面 session 或取消其未发送 runs。当前 signIn 不做此事。离线或远端登出失败时，不能承诺服务器立即获知；到期、已接受任务继续与可查询状态必须如实表达，signed grant 也不能消除这类网络时差。
7. 重启只查询原执行。远端 queued/running：保持等待；远端已发送而费用未核实：保留 unknown；明确未发送的终态：依据受信 receipt 收敛预留。`failed/cancelled/404/costPoints: null` 单独出现均不证明零收费。找不到回执时保持待核对，不自动重新提交。下载/本地落盘失败只重取同一资产，不再次生图。
8. 结果状态与费用状态独立收敛。远端成功可以同时费用 unknown；上游估算、provider 自报和 verified_charge 分开记录。只有关联同一 payer、credential、call 的可信单次账单证据才可升级为 verified_charge；重复/迟到证据只能冲销一次，unknown 未核实不得按 0 释放保护。

本切片不承诺上游网络意义的“恰好一次”，也不承诺已发请求可以取消收费。它保证冻结付款身份、服务端唯一执行和不自动重放不确定的付费动作。现有 `/generations/{id}/retry` 可为失败/取消创建新任务，属于显式新尝试，不能当成本切片的恢复接口。

### 10.5 可领取任务与依赖

**2026-09-08 更新：SP-P1 已完成本机实现与合成验收；B13 SP-P2/P3 已完成本机实现与合成验收，P4–6 尚未闭合。** B12 已新增身份/恢复服务、PG 0009、共享恢复界面和桌面安全存储/旧库恢复；定向结果、已发现缺陷与统一门禁进度见[开发记录](./V25-DEVELOPMENT-LOG.md)，不能继续将 P1 全部视为设计，也不能将整条付费执行链计为通过。建议按 SP-P1 → SP-P2 → SP-P3 → SP-P4 完成第一条托管 image 闭环，再扩大 SP-P5；SP-P6 随实现准备测试，并在目标范围完成后统一验收。

| 任务 | 依赖与最小文件范围 | 实施内容 | 出口 / 验收标准 |
|---|---|---|---|
| **SP-P1：服务端凭据来源与 binding** | 无新功能依赖；复核 §8。contracts、PG credential 增量迁移、API account/auth 供给接缝及就地测试 | 定义 principal/payer/issuer；原子写入实际 credential 来源与语义版本；处理旧行、并发登录、供给失败及映射变化；提供非秘密 binding 查询 | A/B 内部 ID 与上游 ID 不同仍准确；旧 key 不被新 owner 误领；版本变化可验证；缺来源 unavailable；无 key/token 出参。**此任务结束仍不解锁桌面发送** |
| **SP-P2：generation 冻结身份与非删除回执** | SP-P1；contracts generation、PG generation/receipt 增量迁移、API generation service/routes/tests | 入队事务重查 expectedBinding；run 冻结付款人与模型；执行回执唯一键及只读查询；purge/retention 保留去重证明；同键比较纳入身份和请求 | 同键同输入只一条执行；不同输入/人/版本冲突；跨 owner 查询拒绝；入队响应丢失仍可查；删除历史后旧键不能再付费；不能只写 DTO 不做服务端重查 |
| **SP-P3：worker 凭据版本与发送边界** | SP-P2；worker tasks/image gateway/真实 PG 与 HTTP 测试；必要的同域 credential 状态接口 | claim 前核对固定 credential/会话策略；发送使用同一快照；续租/终态/恢复同步 receipt；保留无内部 retry/重定向发送 | 两 worker 只有一个有效付费 claim；轮换/撤销先完成则 HTTP 0；已发送崩溃恢复不重付；旧 epoch 不能提交；cancel 与 unknown 不混同为免费；结果落盘失败保留执行证据 |
| **SP-P4：桌面 session epoch 与 G 托管云图像闭环** | SP-P1–3；account-domain、主进程 managed image adapter、既有 spend repository/automation gate 与就地测试；仅必要的本地域迁移 | 安全存储固定 issuer/auth epoch；A/B 事件 CAS；新增明确云执行连接；最初限固定云模型、无参考图的 G；复用既有预算/确认，持久关联 local call/remote run，query-only 恢复与资产转存 | 无来源仍受限；拒绝/到期/换号前未发 POST；丢回包和真实重启后 HTTP 上游总数不增；同一终态与费用幂等收敛；旧 BYOK/遗留托管路径不被静默切换 |
| **SP-P5：参考图与 R/S 图像调用适配** | SP-P4；既有 reference upload/asset 通路、run-session/skill-runtime 执行接缝及测试 | 固定参考图字节摘要与云 reference ID；适配最终 prompt/长度/图数；R/S 每个原 jobId 对应一个远端执行；文本保持独立冻结 | 本地 ID 不冒充云 ID；换图/换 prompt 不借旧确认；部分成功中断不续发剩余图；只重取资产；云图像 A + BYOK 文本/未绑定文本的行为分别正确。**不在此任务实现新的托管文本 API** |
| **SP-P6：真实进程矩阵与证据回填** | 对应被验收的 SP-P1–5；就地测试、真实 PG/SQLite/本地 fake HTTP、Electron 测试及本节结果回填 | 逐点 crash/relaunch、两个客户端/worker、旧备份与历史清理、账户切换、零预算/unknown、秘密扫描；执行仓库要求的阶段门禁 | §10.6 所有领取范围用例有真实命令/时间/结果；失败回写具体任务；跳过不算通过；不把 fixture 费用称为真实账单，不把 image 子集通过称为整卡完成 |

最小服务端首刀是 **SP-P1–3**：在已有账户、generation 与 worker 中形成可验证执行身份和非删除回执，但保持桌面 gate 原有限制。**SP-P1–4** 才构成第一条可使用的托管云 image 提交/查询/恢复闭环。SP-P5 扩大参考图与本地 R/S 的图像调用，托管文本和真实账单查询继续独立 open。

### 10.6 验收矩阵（P1 子范围已有证据，整矩阵未通过）

每个运行级用例同时核对：实际上游 HTTP 数、服务端唯一执行/receipt、原付款人和版本、本地预留/费用 provenance、终态与审计条数。只断言 helper 返回值不能替代运行级证据。

| ID | 场景 / 故障注入 | 必须观察到的结果 | 归属 |
|---|---|---|---|
| SP-PV01 | A/B 的内部 principal 与上游 payer 各不相同；篡改本地 owner、托管标记或 expectedBinding | 服务端从 session+credential 重查；不把两类 ID 混用；伪造期待值不能放行 | P1/2 |
| SP-PV02 | 映射更新后 token 供给失败；并发登录旧请求后返回；旧 credential 行缺来源 | P1 已验证身份/凭据不误绑及 CAS；未验证旧 queued run 实际付费 HTTP 为 0 必须在 P2/3 完成，不能由身份 middleware 推导 | P1/2/3 |
| SP-PV03 | 同 payer 重登、换 payer、换 API issuer、加密 keyVersion 轮换、实际 token 轮换分别发生 | auth epoch、issuer、credential semantic version 的失效原因准确区分；旧确认不能授权另一凭据 | P1/4 |
| SP-PV04 | 多 API 请求同时用同键；改变输入/张数/model/owner/version；两个 worker 同时认领 | 一次有效执行和付费 claim；冲突明确；冻结摘要一致 | P2/3 |
| SP-PV05 | 主进程发送 POST 后丢回包，在保存 remoteRunId 前退出 | 重启按原 issuer/principal/key 查询到唯一 run；不走 retry、不生新 key，上游 HTTP 不增加 | P2/4/6 |
| SP-PV06 | 服务端历史 purge/empty-trash/retention 后，本地恢复旧备份并重新提交原键 | tombstone 仍拦截新执行；历史/资产可以不可用，但去重证明不能随之丢失 | P2/6 |
| SP-PV07 | queued、参考图准备、发送 CAS 前后发生凭据轮换/撤销/会话失效 | 失效先赢则无上游发送；claim 先赢则记录原 payer，不承诺取消收费；不回退到新 key | P3/4 |
| SP-PV08 | A→B 切换，A 的状态请求迟到 401、迟到成功、原 POST 回包乱序 | 不清 B、不污染 B 的运行；B 不能查询或重放 A；重新登录 A 可只读恢复旧执行 | P4 |
| SP-PV09 | 已标发送后 worker 被杀、旧 epoch 迟到提交、上游返回后产物保存失败 | 不重发；unknown/原 payer 保留；旧 epoch 不覆盖；能恢复 canonical result 的场景按原记录收敛 | P3/6 |
| SP-PV10 | 生成与编辑返回 307/308、429/503、无效成功体、连接中断；发送回调前后 abort | 不产生隐藏的第二次 paid POST；明确未发送和可能已发送分开，未核实费用保持 unknown | P3/5 |
| SP-PV11 | 预算 0、估算 0/未知、超额、拒绝、确认截止、并发 G/R/S 与跨月 | 保留 §8 策略；旧确认不放新 call；unknown 不按 0 释放；外部文本费用不冒充 managed 图像用量 | P4/5 |
| SP-PV12 | 成功无账单、取消后收到响应、重复/迟到 receipt、伪造或错版本费用证据 | 结果与费用状态独立；不得以成功/取消/余额差推导 verified_charge；重复证据不重复冲销 | P3/4 |
| SP-PV13 | 查询返回 queued/running/failed/cancelled/404，网络离线或 receipt 丢失 | 按受信 dispatch 证据处理；404 不当未执行；query-only 保持，不自动重新 POST | P4 |
| SP-PV14 | 云 image 付款人 A，文本为另一外部连接；文本是未绑定托管连接；image/text 单独换 key | 分别冻结/审计；文本 unbound 不能借 image A 放行；G 接通不让 S 托管文本默认可用 | P4/5 |
| SP-PV15 | 本地参考图变化/删除、云 reference owner 不符、已编译 prompt 再组合、超长和超张数 | 原字节/摘要和云 reference 绑定；拒绝不支持输入；不悄悄修改已确认请求 | P5 |
| SP-PV16 | 云端图像成功，下载或本地存储失败；R/S 部分图成功后退出 | 只重新下载原资产，不再次生图；不自动续发剩余图片；保留部分结果和未知费用 | P4/5 |
| SP-PV17 | 同步 owner 重写会话、safeStorage 失败、SQLite 投影失败、旧会话备份恢复 | 不凭 ciphertext 重加密推断新付款人；写失败保持受限；旧执行由服务端 receipt 防重复收费 | P4/6 |
| SP-PV18 | 秘密 canary、跨 owner API、Cloud MCP OAuth、普通 Web/Desktop、Frozen 域回归 | key/bearer 不进 SQLite/日志/IPC/导出；MCP 不获写权限；普通点击/BYOK/Frozen 行为符合原范围 | P1–6 |

上游单次账单查询未在当前 New API client 中实现。若无法获得并验证与 call 对应的账单证据，SP-PV12 的合格结果就是保留 unknown/估算来源，**不是为凑齐验收而制造 actual charge**。这也不授予任何自动释放未知预留的权限。

### 10.7 阶段测试流程与结果登记

下表同时保留后续执行流程和 2026-09-08 已取得的 P1 子范围证据；完整命令/原始失败见[开发记录 B12](./V25-DEVELOPMENT-LOG.md)。不得把重叠专项相加成完整矩阵通过数。

| 阶段 | 入口 / 操作 | 出口与当前结果 |
|---|---|---|
| T0：契约与迁移审阅 | SP-P1/2 字段、issuer/principal/payer 区分、唯一作用域、历史清理策略、登出线性边界明确；检查就近 AGENTS | P1 canonical 身份/恢复/执行 binding、PG 0009 与备份证据0010已落地；P2 receipt 与发送绑定尚未落地 |
| T1：就地验证 | 契约/API/worker/adapter 的就地测试；按开发记录中的实际文件和包配置运行 Vitest | P1 API、共享恢复、桌面账号/旧库专项通过；桌面账号及桥接 4 文件/43 passed，其中会话竞态 20 项。不是完整 PV 矩阵通过 |
| T2：真实数据库与进程 | `pnpm run db:migrate`；临时 PG/SQLite、本地 HTTP fixture 与进程 barrier；新增 SQLite schema 时另做 generate/bundle | 01:46 的0009迁移/API123/worker47历史保留；接续在隔离PG中实际包级CLI迁移0009→0010及replay退出0、旧行保留，完整API12文件162 passed、Worker6/55 passed，0失败/跳过；含真实COMMIT/cookie/丢包/双PID7项，kill增量另记。55项worker不证明新付款绑定 |
| T3：仓库与 Electron | `pnpm run check`；完整 `pnpm run test:e2e` 含真实 Electron、Web 双视口及视觉 | 02:33–02:41接续检查点check35/35、28cached，E2E242 passed/7 skipped/0 failed/flaky，源码1223项前后无漂移。01:46旧239/8与原始失败不改写；此后测试增量另记 |
| T4：产物与安全 | `pnpm run package:mac:adhoc` 及 package-smoke；源码/产物内容扫描 | 接续source扫描1127文件、12,062,445字节，0 findings/errors/accepted；不等于依赖漏洞审计。B12当前源码产物、Windows、签名、公证、生产尚无结果 |

每次报告记录：日期/时区、源码提交或工作树状态、领取的 SP-P/PV 范围、完整命令、前置环境类别、通过/失败/跳过数、实际 HTTP 次数与失败注入点、数据库/receipt/审计断言、剩余 open。失败时写回对应 P 任务及 PV 行；修复后只将实际复跑范围标通过，重叠套件不累加。日志中不记录真实用户、密钥或可复用 bearer。§8 的 174 项历史结果继续绑定原命令与时点，P1 新证据单独登记。

### 10.8 服务端联合目标（SP-P1–3）

当前 SP-P1–3 已取得本机实现与合成验收，按[路线图 §6.5](./V25-MIGRATION-ROADMAP.md)继续 SP-P4。以下保留 P1–3 联合范围供审计，不要求重复已完成实现。

> 完成 SP-P1–3：在现有 bearer 会话、account credential、generation API 与 worker 中建立经真实凭据来源验证的 payer/credential version，入队时服务端重查 expectedBinding 并冻结身份，增加不随历史 purge 删除的 execution receipt 与按幂等键只读查询，落实版本变化和实际发送的条件裁决；使用真实 PG 与本地 fake HTTP 验证并发、丢回包、旧备份、撤销和 unknown 不重付，保持桌面未接线托管连接受限、费用来源真实及 Cloud MCP 只读，回填本节实际证据，不创建 signed grant 平行协议。

首刀交付后继续 SP-P4 才能宣称第一条桌面托管云图像闭环可用；参考图/R/S 图像、托管文本、真实账单与全部恢复体验各按上述范围验收，不能由服务端基础表完成推导整包完成。

### 10.9 Legacy issuer/payer 迁移判定与恢复边界

**本节保留 2026-09-07 的设计与缺陷快照，验收要求继续有效；实现状态已于 09-08 更新。** B12 已实施 `recovery_only`、身份/版本、恢复接口和业务鉴权，专项与统一验收进展见[开发记录](./V25-DEVELOPMENT-LOG.md)。下文“当前源码/尚无能力”描述均指设计时点，不覆盖 09-08 源码。该更新不增加或改写 §8 的 174 项历史证据，也不替换 §10.8 的后续联合目标。实现时必须同时交付证据充分用户的自动激活与证据不足用户的可行恢复入口，不能以全面拒绝历史用户登录作为完成标准。

#### 10.9.1 已核对的来源限制

[登录插件](../../apps/api/src/auth/new-api-delegation.ts) 当前按提交的用户名对应字段查找内部用户，并可能更新 `newApiUserId`，然后创建 Better Auth session、调用凭据持久化 hook，成功后才设置 cookie。[账户服务](../../apps/api/src/modules/account/service.ts) 当前先写 relay session，再调用上游供给图像 token。供给失败没有在该插件中补偿删除刚建的 session/relay，因此数据库中的旧 session 不一定曾成功交付给用户。**候选登录留下的失败行，不能在下一次尝试中自动变成历史归属证明。**

[凭据表](../../packages/db/src/schema/credentials.ts) 的旧 relay 密文只保存 JWT/refresh，旧图像凭据保存 key；二者都没有历史 issuer/payer 来源字段。[New API client](../../packages/new-api-client/src/index.ts) 已能以 JWT 调 `getSelf`、以 refresh cookie 刷新、认证读取指定 token 的 key，但没有为迁移验证历史发行者的专用接口。解码 JWT 的未验证 payload、旧 `jwtExpiresAt`、用户名相同、token 名字或掩码相同，都不能代替身份验证。

`getSelf` 的有效结果证明“受信接口 I 在验证时接受这份凭据，并识别为 owner O”。它不证明 I 就是该主体最初的历史发行者，也不证明该内部用户下每条旧记录从未被错误重绑。旧 `users.newApiUserId` 可能已经被覆盖，只作待调查线索，不作为自动激活的事实源。若过去的覆盖已消灭全部独立证据，现存行无法还原所有历史 owner；实现与报告必须保留这个限制。

旧 secret 的探测目标必须固定为有可信部署来源依据的 issuer；配置或候选请求不能任意指定接收地址。**NULL issuer 不得直接填成当前 `NEW_API_BASE_URL`，也不得为了试出 owner 把旧 JWT/refresh/key 逐个发送到任意新地址。** 配置切换、跨 issuer 迁移或无法确认来源时进入恢复流程。允许重新验证时记录目标 issuer、验证时间和证据类型 `legacy_revalidated`，不伪称恢复了原始签发元数据；不在记录中保存秘密。

#### 10.9.2 激活判定表

术语：I 是本次已确认的受信 issuer；N 是新登录 JWT 经 I 的 `getSelf` 验证后的 owner，必须与该次登录返回的 relay owner 一致；O 是候选写入前的旧证据在 I 验证得到的 owner。“用户持有旧会话”指调用方确实带来此次候选登录之前已存在且仍有效的 Better Auth bearer/cookie，不能仅由服务端任选一个旧 session ID 代替。

| 分支 | 必须具备或检查的证据 | 拟定行为 | 不允许推导 |
|---|---|---|---|
| L1：已有受管 active 绑定 | 固定 issuer/owner 与新 I/N 相同，版本和状态有效 | 正常登录；凭据变更按语义版本处理 | 不因同用户名允许改绑到不同 I/N |
| L2：用户持有旧会话，旧 key 可核对 | 候选前的旧 BA session 对应 relay 得到 O=N；在 N 授权下按旧 externalTokenId 取回 key，与旧密文解密值严格相等；没有相反 owner 证据；I 来源可信 | 自动激活主体和已核对的旧 key，记录会话连续性及 token 验证依据 | 不把未核实的旧 run 全部补为该 payer，不升级历史费用为真实账单 |
| L3：用户持有旧会话，旧 key 缺失或已失效 | 旧 BA 会话连续性明确、旧 relay 的 O=N、I 来源可信且无其他有效 owner 冲突 | 可激活主体并重新供给 N 的新凭据；旧 key/run 保持 unverified；无绑定的旧排队任务不得读新 key 自动继续 | “旧 key 不可用”不等于已证明它属于 N；若实际查得它属于另一 owner，应走 L6 |
| L4：跨设备，没有带来旧 BA bearer | 独立旧持久 relay 的 O=N；N 授权取回的旧 token/key 与旧密文一致；检查其他可验证旧会话，没有不同 owner；I 来源可信 | 多项证据一致时可形成自动迁移候选，再经事务 CAS 激活 | 任意一条旧 relay 匹配、最新一行匹配或多数匹配，都不足以直接领取历史主体；验证失败残留不能自证 |
| L5：旧 JWT 失效，refresh 可用 | 对旧 relay 独占刷新，再对新 JWT 调 getSelf；刷新返回 owner、getSelf owner 和 N 一致 | 满足 L2–4 的其他条件后继续；刷新结果本身不是绕过条件的授权 | 不能只信 refresh 响应字段而跳过身份比对；不能把刷新成功当上游付款凭据已核实 |
| L6：身份/凭据冲突 | O≠N；或同一内部主体出现 A/B 两个有效旧 owner；或旧 key 与候选认证取回的 token/key 不一致 | 标记待解决的身份冲突，不替换旧绑定/key；可建立受限恢复会话 | 不选最新 owner、不投票、不按当前 `newApiUserId` 覆盖证据，不自动合并历史 |
| L7：暂时无法验证 | 网络、429/5xx、短期刷新竞争或探测超时；没有确定的相反证据 | verification pending，提供安全重试；保留旧会话和证据 | 不当永久身份冲突，不全局登出其他仍有效会话 |
| L8：来源不明或配置已切换 | NULL issuer 且没有可信来源依据；或候选 issuer 与已有验证来源不同 | 不发送旧 secret 探测任意新地址，进入明确的来源恢复/迁移路径 | 相同数字 owner、相同用户名、当前环境变量，均不能填补发行者证据 |
| L9：旧证据永久缺失 | 旧 relay/key 均缺失、无法解密或永久失效，没有可核对的旧设备/备份证据 | 新登录可进入受限恢复状态；提供原设备验证、恢复可信服务端备份证据，或创建独立新工作区的路径；旧历史保留 | 新登录只能证明新账户身份，不能单独领取旧历史；不能将“已登录恢复页”报为历史迁移成功 |

L2–4 的激活证明的是此次恢复所依据的会话/凭据连续性和后续受管身份，不是对全部历史数据归属的不可抵赖证明。任何已经发现的反向证据优先阻止自动激活；探测不完整时不能声称“所有旧 session 已一致”。实际实现应记录检查范围、证据行版本与未能验证的原因，避免无界网络探测或把未检查行当不存在。

#### 10.9.3 可行的受限登录与恢复入口

建议沿用现有 Better Auth cookie/bearer，在服务端新增受控的会话授权模式与恢复状态；不引入新的 OAuth 授权协议或 signed grant。`recovery_only` 会话仅允许读取本次新登录自身的账户状态、执行明确恢复操作和登出。历史、同步、生图、敏感资产读取及 MCP 授权等业务面必须默认拒绝；仅在 UI 展示提示而仍将该 session 当 normal 使用，不符合验收。

拟定恢复入口至少需要完成以下实际操作，并以共享契约返回可执行状态/原因，不能只返回一个无法处理的 409：

1. **原设备验证**：仍登录原账户的设备提供其已有会话连续性，服务端按 L2/3 核查；验证必须绑定同一恢复申请、issuer 和候选 owner，不能变成任意账户合并功能。
2. **安全重试与证据恢复**：暂时网络失败可重试；可信服务端备份恢复到隔离核对过程，重新验证证据后再激活，不能将整个旧数据库直接覆盖现有付款/执行记录。
3. **证据永久缺失时继续使用**：用户明确选择独立新工作区，服务端建立独立 principal/来源映射，保留旧主体及其数据。现有用户名字段有唯一约束，不能通过覆盖旧 user 来绕过；需设计明确的新身份映射和数据隔离接缝。该路径完成不等于旧历史已恢复。

09-08 更新：以上三个入口均已有实现。普通重试、原设备验证和独立空间已通过宿主检查点；可信备份通过受控 CLI 暂存、原申请人重试核对，32项备份联测已包含于完整API162项通过结果，见[运维流程](./V25-ACCOUNT-RECOVERY-OPS.md)。首刀若只返回 `recovery_only` 字段而缺少适用恢复路径，仍只能记部分完成。管理员可以协助核对部署或备份来源，不可替用户批准花费或凭声明改写历史付款人。

#### 10.9.4 CAS、刷新和补偿边界

建议新增服务端受管的身份状态/版本、relay 证据版本与 session 授权模式；字段名和恢复 DTO 须按契约流程落实，不能把本节建议当已有 API。最小编排可拆为：读取候选前旧证据快照 → 在事务外验证 → 在事务内提交激活。

| 边界 | 拟定实现约束 | 失败/并发结果 |
|---|---|---|
| 快照 | 固定 user identity version、credential version、被检查 relay 的 revision、旧 session 有效性及 issuer；新 candidate 不进入自己的旧证据集合 | 不允许先写新 relay，再用该行自证历史身份 |
| 外部验证 | 新登录/旧 relay getSelf、适用的 refresh、旧 token/key 核对在短数据库事务之外进行；秘密只在服务端内存和加密存储 | 网络失败可重试，不提前覆盖旧 key/owner；不将上游 token 供给误称数据库可回滚动作 |
| 激活提交 | 按统一顺序锁 user → credential → relay；重查身份状态、候选来源、证据版本和 session 存活，CAS 成功才写固定绑定及本次 relay/credential | 两个候选倒序返回只能一方按匹配版本提交；快照变化则重新核对，晚回候选不得覆盖赢家；所有相关写路径遵守同一版本纪律 |
| 旧 relay 刷新 | 使用跨进程的短租约/版本资格，避免两个进程同时消耗同一 refresh；刷新后的提交检查原 revision 与 session 仍有效 | logout 已删除 session 后，旧刷新不得复活行；不能仅用进程内 Map 实现互斥 |
| 上游 refresh 中断 | refresh 可能先在上游轮换，再遇本机进程退出/保存失败 | 无法承诺跨系统原子性；证据丢失时走重新认证/恢复，不自动假设旧 refresh 仍有效，更不能切成未知 owner |
| Better Auth 会话创建 | 当前是 `createSession → 自定义持久化 hook → setSessionCookie`，后续自定义 PG 事务不自动包含前面的 BA adapter 操作 | hook 失败只补偿本次新 session；使用 `internalAdapter.deleteSession(session.token)` 保留 BA 删除 hook 语义，参数是 token 而非 session ID；不裸 SQL 假装等价，也不全局删除原用户全部会话 |
| 提交/回包异常 | cookie 只在身份/凭据处理成功后设置；已激活后网络响应丢失与事务失败分别判断 | 清理本次 session 不得回滚另一个已成功登录的版本或删除其 key；下次认证按受管身份幂等恢复；旧有效会话和冲突证据保留 |

09-07 审计时，[账户刷新](../../apps/api/src/modules/account/service.ts) 仅按 sessionId 更新，[业务鉴权](../../apps/api/src/auth/middleware.ts) 仅要求 Better Auth session；09-08 已改为受管身份/会话授权及 PG 租约和版本 CAS。安装依赖中的 `createSession` 仍使用自己的创建操作，不能据此认为项目自定义 hook 与其共享一个事务。新增独立 COMMIT、cookie 和实际丢包故障证据见下表。

#### 10.9.5 Legacy 专项验收矩阵（要求与当前覆盖）

下面是 SP-P1 对 §10.6 的细化要求。09-08 的 39 项身份 PG 集成测试已实际使用[身份 HTTP fixture](../../apps/api/src/__tests__/fixtures/new-api-identity-fixture.ts)，按 JWT → owner → token/key 隔离，并断言真实 PG 前后状态；另有 12 项 OAuth lineage PG 测试。普通 API fixture 的共享 token 集合不能代替该证据。矩阵仍有剩余项，不能将整行或整个 P1 自动勾选。

| Case | 注入条件 | 验收结果 |
|---|---|---|
| L-T1 | user 当前映射已被 B 覆盖，但用户带来原 A 会话，旧 relay 与旧 key 都证明 A | 新 A 可按规则恢复 A，不能因可变映射是 B 就错绑/永久拒绝；历史未核实 run 不被补成已知 payer |
| L-T2 | 候选 B 供给失败，留下未交付的 session/relay；随后重新登录 B | 失败残留不能独自证明历史主体；不能在新 candidate 写入后立即读取它并自证 |
| L-T3 | 同一 legacy principal 有可验证 A/B 两类旧 owner；或旧 key 与候选 token/key 不同 | 明确冲突，保留证据，不选最新/多数，不替换旧 key；恢复状态不能访问旧业务数据 |
| L-T4 | JWT 401 后 refresh 同 owner 成功、refresh 返回异 owner、getSelf 异 owner、网络失败分别发生 | 成功还需其余证据；异 owner 转冲突；网络失败可重试，不错误清空有效旧会话 |
| L-T5 | 两候选在验证后倒序提交；两个进程 refresh；refresh 期间 logout | CAS 只接受当前版本；晚回不覆盖；logout 后不复活；实际上游刷新次数与租约语义一致 |
| L-T6 | issuer 为 NULL、配置切换、另一 issuer 返回相同数字 owner，或请求试图自选旧 secret 接收地址 | 不自动继承 issuer；不向任意新地址发送旧秘密；相同数字 ID 不足以激活历史主体 |
| L-T7 | 证据充分自动激活；暂缺证据登录恢复页；原设备恢复；永久缺失后独立新空间 | 正常与受限权限可验证；恢复申请只能升级对应主体；新空间不领取旧数据；每条路径有真实可到达的操作，不只是状态字段 |
| L-T8 | prepare、hook、PG 提交、cookie/响应输出各阶段故障；秘密 canary；重复恢复回执 | 只补偿本次新 token，不删除原会话/赢家 key；相同申请幂等；秘密不进入日志/契约出参/非加密记录；无“数据库事务已回滚上游”的错误声明 |

09-08 当前覆盖映射（身份集成 [account-identity.integration.test.ts](../../apps/api/src/__tests__/integration/account-identity.integration.test.ts)，精确报告 `b12-identity/validation-summary.json`）：

| 验收项 | 已取得的证据 | 剩余边界 |
|---|---|---|
| L-T1/2/3 | 旧 A 与可变 B 映射分离、跨设备 relay+key 一致性、缺 key 的原会话路径；候选失败补偿、A/B 冲突与恢复权限隔离 | 只证明可核对的历史证据，不推导全部旧 run 的 payer 或费用 |
| L-T4/5 | 同 owner 刷新、不同 owner/getSelf 拒绝、瞬时失败重试、倒序登录 CAS；接续新增两真实生产 API PID、共享 PG 的独占 refresh 与另一 PID logout 后不复活，上游 refresh HTTP=1 | 原7项后新增live保存间SIGKILL、自然30秒租约与新PID明确重新登录，合跑8 passed；backup另有自然120秒租约case，完整API164项通过。仍不承诺跨系统原子恢复 |
| L-T6 | NULL issuer、服务地址切换、数字 owner 相同、非法额外恢复字段均不让旧秘密发往新地址 | 缺可信历史来源时持续受限，不能靠 current env 补证 |
| L-T7 | 自动激活、恢复重试、原设备 inspect/verify、独立新主体以及并发/重复申请；Web/桌面可到达恢复面、本机旧提示词库查看和明确复制；新增 PG 0010、独立 0008 来源核对与实际 inspect-source/inspect/stage CLI，32项备份联测与完整API162项已通过，退出0 | 首次160/2失败与第二次162断言通过但teardown退出1保留；真实历史备份来源须运维独立审定，不由合成fixture或本机库复制推导。备份专属kill已加入完整33项与最终API164项，失败历史见开发记录 |
| L-T8 | 原有 prepare/hook、补偿、秘密和重复恢复证据；新增延迟约束在实际 COMMIT 抛错、单实例 cookie 头构造失败、正常/受限登录 HTTP 回包实际丢失；与双 PID 合跑 7 passed，旧会话/赢家 key 保留 | cookie 失败源于测试实例配置注入；上游供给与数据库提交不是一个事务，已提交的丢包不能声称回滚。后续源码仍须完整 check/E2E |

配置边界：`LEGACY_NEW_API_ISSUER` 默认不设置，绝不继承 `NEW_API_BASE_URL`；恢复申请有效期 30 分钟，旧 relay 验证最多 16 条、总窗口 30 秒，live relay 刷新 PG 租约 30 秒；隔离备份批次租约为 120 秒，验证同样受条数和窗口限制。超限/超时不视作其余历史证据已一致；恢复状态与原因必须保留。成功消费或通过另一合法路径完成恢复时清除备份密文；过期立即禁止使用，worker 周期另做有界物理清理，详见运维流程。

首刀验收须同时证明：**证据充分的 legacy 用户能自动激活；证据不足的用户能受限登录并完成适用恢复或建立独立空间；未证明的历史主体/付款人不会被自动领取。** 仅实现拒绝分支、仅证明一个任意旧 relay 匹配、仅增加恢复状态名，均不构成 SP-P1 完成。实际命令、通过/失败/跳过和剩余限制按 §10.7 回填；首刀仍不等于 SP-P1–3 或 G-SPEND-02 整卡完成。


### 10.10 SP-P4 桌面托管链的实施接缝（B24 首批正式恢复已验，整卡待闭合）

领取前先核对 P2/P3 最终验收。首刀是用户明确新增并选择“账号云图像”连接，固定 `cloud-default / musefold-image-pro`，只接 G 的无参考图生成；现有 `managed_by=account` 标签不是凭据来源证明，不能自动重标 BYOK 或替换旧连接。参考图和 R/S 图像扩展继续归 P5，文本费用独立。

| 子任务 | 现有接缝与修改方向 | 验收出口 |
|---|---|---|
| P4-A：显式连接与会话捕获 | account-session-store 的 issuer/principal/authEpoch 和提交锁、account-domain 的前后 CAS/binding 查询可复用；增加主进程云执行 adapter 的 session capture/assert 接口。连接实体按 contracts 流程明确定义运输类型，不能伪造 hasKey 或把 BA bearer 当 Provider apiKey | 用户明确选择；A→B/改 issuer 先于提交时 POST 0；A 的迟到 401 不删除 B；token 不进渲染层或 SQLite |
| P4-B：异步准备后确认 | Automation G 入口现有 estimate/register 是同步；扩为可 await 的准备接缝，先读取并冻结真实远端 binding，再按原预算/确认规则授权 | 零预算、未知估价与超额仍逐次确认；拒绝/到期不发送；确认后的身份变化不能借旧同意发请求 |
| P4-C：执行 port | core generation 当前直接构造 OpenAICompatibleProvider，其同步 beforeDispatch 不适合远端 POST；提供主进程注入的受限执行 port，HTTP/poll/download 留在 desktop adapter，复用本地 run/取消/资产入账 | 不把 BA token 塞进 apiKey；不支持的模型、参考图、文本/R/S 在发送前拒绝；原始云输入与 API 的最终 prompt 分开，避免两端重复 compose |
| P4-D：持久远端关联 | desktop-contracts + desktop-db 内联迁移 + core spend repository 增加 local call→remote execution 关联与专用更新事务；首个 POST 前落盘，不能等回包后才存 | 固定 key 与绑定在真重启后不变；POST 回包丢失只查原 receipt；跨账号/issuer 不能接管；已有回执缺失时 query-only，不能自动补发 |
| P4-E：回执与预算收敛 | 远端 call 排除现有通用 recover 的直接 finish 路径；新增 applyRemoteReceipt，按绑定/receipt/run/key 和 revision 单调 CAS，审计单独追加 | queued/running 保留预留；claimed/unknown 保留未知；只有受信的明确未发送终态释放；provider_reported 不升级为 verified_charge；重复/乱序回执不重复扣减或审计 |
| P4-F：资产和故障 | 同 remoteRunId 下载与本地 asset 幂等关联；下载失败不走新 core retry；取消保留远端关联 | 网络中断只增加 GET，不再生图；晚到成功/费用仍收敛；旧 BYOK ID/key/epoch 及旧未绑定限制保持原行为 |

建议关联记录最少保存：local request/call/ordinal/local generation ID；完整 ExecutionBinding、apiIssuer/principal 和提交 authEpoch；稳定 remoteIdempotencyKey、冻结云请求及摘要；submissionState；可空 receipt/run ID、最新 receipt revision/dispatch/status/cost provenance；资产转存状态。使用本地 call 主键与 `(apiIssuer, principalId, remoteIdempotencyKey)` 唯一约束，不保存 token。具体字段仍由下一轮 schema 与测试裁决，本节不是已落库声明。

旧备份可能早于关联写入：不能每次恢复都重新生成 UUID。须使用受管 namespace 与稳定 caller 幂等键推导同一远端 key，或者在无法证明关联时固定为只核对、不自动 POST。`completeCall` 目前拒绝 unknown 更新、通用 recover 会结束跨进程 started；两者都不能直接冒充远端恢复。远端费用证据按原 budgetMonth 只计一次，跨月 unknown 保护应保留。

此阶段必须同时跑真实 SQLite/PG、回环 HTTP、实际桌面进程重启与必要 Electron E2E；最终覆盖费用矩阵中的本地预留/确认与远端发送两端证据，不能只证明新 adapter 发出一次 HTTP。


#### 10.10.1 接入前置（B14 下载支撑已验，其余待实施）

- 默认 compose 的 `S3_ENDPOINT=http://minio:9000` 被现有302签名直接使用，桌面不可达。B14已接受控同源 `/api/v1/assets/:id/content`，只接受assetId，服务端所有者校验、受管S3读取、期限/字节/图片校验；保留现有302路由。该下载子片的真实验证见测试手册 §5.7；桌面实际消费仍待接线。
- binding查询的 `status/verifiedAt` 必须从strict `expectedBinding`中剥离；同issuer/principal重新登录可以查旧执行，不要求当前key版本等于旧执行，否则轮换后无法核对。提交仍须当前epoch和实际绑定复核。
- 稳定key不等于预算防回退。当前restoreBackup替换整data.db，早期备份可丢失unknown预留，随后不同新key仍可能被旧预算自动放行。托管执行启用前须保护不可回退的执行索引/恢复限制并补真实恢复测试；不能以namespace散列替代这个验收。
- 支持字段须明确映射，G 的n仅映射count 1/2/4；本地sessionId/promptId、任意模型、background和不受支持size不能静默丢弃。第一次POST保留原始云输入，避免重复合成prompt。
- 本地换号不会自动撤销A的旧服务端会话；已接受云任务不能仅靠本地A→B宣称停止。取消未知提交先保留意图、查询原receipt，取得run后再取消；abort不等于服务端取消。


#### 10.10.2 防回退方案与接线边界（B15 基础与 B16 正式恢复已接线，托管业务链仍待验收）

方案采用独立于业务DB备份的小型防回退锚，最终由主进程注入 safeStorage；spend/remote明细继续只存在受管SQLite。B15 已实现 checkpoint 契约、0008 增量迁移、SQLite CAS、prepare/commit 协调和有界密文文件适配器；B16 已补正式 safeStorage 装配、restoreBackup 的数据库访问隔离/托管操作排空/停同步/安全备份保留，以及 restore_pending 写入。远端关联、预算全入口、显式托管连接与启用/核对入口仍待接线。放弃在首刀自动合并新旧整份账本，因为它要同时解决活跃请求、关联外键、确认与月份冲突，且无法识别用户直接替换data.db。

拟定安全事务顺序为：锚的prepare状态持久化 → SQLite IMMEDIATE事务提交revision/opId/checkpoint → 锚的commit状态持久化。只有双方一致且commit落稳，才允许首个云POST。锚已prepare而SQLite仍为旧状态时，一律保留托管query-only：这既可能是事务前崩溃，也可能是事务已提交后又恢复了旧备份，不能自动回滚锚后重新获得预算。namespace/revision/checkpoint缺失或不同也不能自动新建后发送。

基础层的具体 schema、文件 flush/原子替换、恢复分类和三个真实 SIGKILL 时点已有 B15 测试；结果见测试手册 §5.8。旧库升级不新增锚文件、不插入 checkpoint、不自动启用托管。B16 的真实恢复与安全存储证据见测试手册 §5.9；正式发送许可仍须通过后续远端关联与预算接线验收。若整套userData连同锚都被外部回退，本机两份状态无法单独证明回退，须保留远端回执与独立来源的边界，不能宣传成任意整机快照下的完整预算防回退。


防回退完整交付仍按下表验收：B15 仅完成 checkpoint/锚/事务协调基础；业务全入口、正式恢复和发送状态机仍开放。

| 对象/步骤 | 拟定字段与规则 | 验收重点 |
|---|---|---|
| SQLite checkpoint | 单行lineageId/namespace/revision/headHash/lastOperationId；影响托管许可、预算、预留、unknown、确认、远端回执的业务写与checkpoint同一IMMEDIATE事务 | 不存在先改预算再另提交checkpoint的窗口；持久幂等键及绑定必须在POST前已提交 |
| 安全存储锚 | formatVersion/lineageId/namespace；committed(revision/headHash)；pending(opId/from/to/revision/hash/kind)；active/query_only及原因；不存token或完整账本 | 临时文件flush、原子替换失败不得继续发送；锚不按月份或登录账号重置 |
| 首次启用 | 必须由用户明确启用；没有P4标记且不在恢复流程才可bootstrap；启动不自动重生namespace | DB有标记但锚缺失/损坏/不可解密、锚存在但DB早于P4均受限；本地同时回退两者与从未启用不可区分 |
| 正式恢复 | 先关新托管提交、提升数据库生命周期epoch、停本地提交/轮询/下载并等写事务；固定保留当前安全备份；锚进入restore_pending后替换DB | 老回调不得写进恢复后的DB；已接受云任务仍待核对，abort不代表取消费用；普通备份裁剪不能删恢复安全副本 |
| 恢复出口 | 匹配checkpoint的安全备份可用于恢复；缺失则保持query-only并按原key/独立来源核对 | 少量锚字段不能重建丢失的全部key与账本，不假装已恢复完整历史；不自动降锚到旧DB |

| 真实进程终止位置 | 下次启动的拟定裁决 |
|---|---|
| pending落盘前 | 两端旧状态仍匹配，无发送 |
| pending已落、DB旧 | query-only，不自动删pending；与提交后又回退DB无法区分 |
| DB匹配pending目标、锚未commit | 可以补齐锚commit；原调用仍只查询，不能据此补POST |
| 锚已commit、POST尚未发 | 依原持久key查询；404也不自动补发 |
| POST已接受、回包丢失 | 依原key查询独立receipt，资产按原run重取 |
| 回执DB已写、锚未commit | 按pending规则；不得提前释放unknown预算 |
| DB版本更旧/更大或同版本hash不同 | query-only，不任意挑“较新的一边”覆盖 |

阶段测试必须包含：备份早于namespace/request/call/POST、服务端已purge、unknown跨月和不同新key、账号A→B、活跃任务中恢复、锚写失败/DB提交失败/解密失败，均核对实际POST次数和两端状态。此前BYOK不自动改为托管，也不能因本片重构改变其原执行语义。这些完整业务场景仍是实现/验收待办，不能用 B14 下载或 B15 基础测试代替。B15 的安全备份测试只覆盖隔离 SQLite 文件替换；B16 已调用正式 restoreBackup 并验证真实 Electron IPC/安全存储/重启，托管发送与成本联测仍未完成。


B15 基础的使用约束：同一个数据目录由一个宿主进程独占；scope 只串行化同进程的 guard 实例，SQLite CAS 不等于跨进程文件锁。事务回调只能执行同步 SQLite 操作；原生 async 函数在调用前拒绝，普通函数返回 thenable 则回滚同步写入，不能借此宣称可取消任意异步回调。锚处于 pending 且 DB 精确匹配目标时允许修复锚，但 guard 的 active 只表示两份控制记录一致，不是旧调用可以重新 POST 的凭证；后续必须由持久关联的发送状态机限制为原 key 查询。

Unix 写入包含临时文件 fsync、原子 rename 和目录 fsync；Windows 跳过目录 fsync，本批未在 Windows 原生宿主验证，也不承诺断电恢复。两个文件同时被外部回退仍无法只靠本机判定。实际大小限制为明文 16 KiB、密文 64 KiB；新文件权限 0600，拒绝已存在的链接/非普通文件，文件目录必须是宿主拥有的可信路径。


#### 10.10.3 B16 主进程恢复协议（已接线，业务托管准入仍待接）

`createManagedExecutionAnchor` 直接使用 Electron safeStorage，拒绝不可用状态与 Linux basic_text，不调用 E2E 明文 fallback。Windows 写锚前先触发密钥初始化，再异步等待 Local State 密钥记录，20 秒未出现则拒绝写入；Windows 测试只有模拟分支，没有原生或断电证明。

正式恢复从校验起排他。原文件与 staging 都校验 SQLite 完整性、user_version 和当前支持的 Drizzle 前缀；未来/改写/缺段链在 DB 隔离之前拒绝。通过后 `beginDatabaseRestore` 使本 PID 的 getDb/initDb 不可再次进入并使旧访问 token 失效；托管 work scope 关闭准入、abort 并等已登记工作退出（20 秒超时拒绝继续），随后停止云同步。用旧 DB 句柄创建 `recovery-safety-*` 快照并 flush，普通 prune 不处理该前缀；锚进入 restore_pending 后才关库与替换。

进入隔离后的成功或失败都要求真实进程重启；失败可回迁原 DB 文件，但不在旧 PID 重新 initDb。安装完成后的 previous 文件清理失败不触发数据回滚。未启用托管且 DB/锚均无标记时不新建锚；已有标记但锚丢失/损坏时拒绝替换，保留安全备份。重启不会自动降锚、自动建立 namespace 或自动确认旧费用。

未来远端 POST/poll/download 必须走 `withManagedExecution`，异步返回写库前使用捕获的 assertCurrent；所有托管预算、关联与回执改动仍要走 B15 协调事务。该 work scope 尚没有正式云发送调用方，不能用排空测试证明实际生成已取消；取消网络不等于上游免费。安全副本目前独立保留，受控删除/回收与全部 userData 同时回退仍属后续边界。


#### 10.10.4 B17 持久关联与回执核心（实现已落库，阶段结果见测试手册 §5.10）

`desktop-contracts/managed-generation` 定义 G 无引用/无参考图的严格云请求；本地 session/prompt/parent ID、任意模型、background、token/headers 和不支持参数直接拒绝，沿用云 count 1/2/4。记录使用原始云输入，不再合成一次 prompt。SQLite 0009 的 `managed_generation_requests` 以 spend request 为主键，从待确认阶段即标记归属；对 call 和 `(apiIssuer, principalId, remoteKey)` 加唯一约束，JSON 实体与查询列有数据库一致性检查。没有结果/连接/账号外键级联删除，也不自动创建旧关联或启用 namespace。

`ManagedGenerationLedger` 是供受信宿主调用的 core 协调器。登记、确认、首发 claim、receipt 与对应 spend 写入均经 guard 的同步事务及锚 prepare/commit。新增 coordinate 预检分支在同一 scope 锁中先判断冲突/无变化，重复回执和普通拒绝不写 pending；真正 DB/审计失败仍回滚业务事务并保留 pending/query-only。异步锚写入之后再次检查捕获的 DB/账号访问。

远端 key 固定为 namespace + 稳定 callerKey + G/ordinal 0 的摘要，不含随机本地 run/call、当前凭据版本、authEpoch 或输入摘要。输入和 binding 用另外的摘要判冲突。已有 key 不能因换号、换 key 或修改输入获得新授权。只在本次新登记并成功提交后保留内存首发资格，claim 成功即持久 `query_only` 并保护 unknown 预留；实例重建、进程重启、丢回包、404 和 purge 都不重建首发资格。guard active 仍只说明控制记录一致。

只读恢复允许同 issuer/principal 重新登录后查询旧 binding；另一账号不可接管。回执必须匹配原 key/operation/binding/receipt ID/run ID；低 revision 忽略、相同 revision 不同内容拒绝、终态倒退及已知费用倒退拒绝。queued/not_started 保留原预留，claimed 或未知终态保护跨月 unknown；可信未发送终态释放为零，provider_reported 终态按原预算月记一次并冲销预留，绝不升级为 verified_charge。终态及后续更高版本终态各追加独立审计，重复/乱序不新增审计或金额。通用 recover 跳过托管请求，直接调用旧 claim/complete/finish/确认写接口会拒绝，避免被当成本地 BYOK 中断结束。

目前正式桌面生成尚未调用该协调器；跨层联测的 HTTP 驱动是测试进程。共享预算设置及其他影响同一额度的老入口尚待整体接入 guard，受信主进程还必须完成显式启用、实际绑定准备、账号切换 CAS、取消、只读恢复入口与资产转存。不能将本批的核心/合成 API 验收解释为用户已可选择托管连接，或旧备份全路径防重复付费已经完成。

#### 10.10.5 B18 主进程适配的当前边界

主进程已有 `captureManagedAccountSession` 和 `ManagedGenerationClient`：capture拒绝未验证/受限恢复会话，账号变更先同步使旧访问失效；发送/回包后都核对原epoch。HTTP只到原issuer内部路径，禁止redirect、限制JSON与完整读取期限，bearer不进入Provider/SQLite/渲染层。`submitInitial`只消费B17活跃实例的claim；失败/404保留unknown，`reconcile`按原key只读远端并单调更新本地receipt，`result`只读原run。工厂回调退出后对象失效，并参与正式恢复排空。

core已有无key的transport选项，接受原始prompt并在异步返回后重验访问；不允许与旧execution混用或普通本地retry。启动终态补记排除托管调用。实际HTTP/SQLite、账号切换、旧401、超时/限制与Electron回归见[测试手册 §5.11](./V25-MIGRATION-TESTING.md)。

尚无用户产品调用方，也无新客户端的取消/资产下载实现。下一步先枚举并保护**全部共享预算写入口**，包括设置和旧Automation/方案/Skill路径；然后联合接显式连接、准备/确认、持久取消意图、原run下载入账与匹配恢复核对。此前不得开放用户托管发送。网络abort只停本地等待，不能据此宣称云任务取消或零费用；404不释放unknown，也不授权重新POST。

#### 10.10.6 B19 共享预算写入现状与启用前置

受管SQLite检查点commit统一授予同步写资格；已有标记后，预算策略/兼容opening用量、新的有效托管登记及旧托管调用都不能从原repository直接修改。无remote关联不再是绕过条件；通用recover和启动补记保留这些旧托管请求，外部BYOK不参与账号预算。B17账本继续通过同一检查点事务更新原月回执。

预算设置和兼容结算经主进程work scope/guard，未启用模式与enable共用锁并以同步事务写入，不自动创建锚；只有DB与锚都不存在才可走兼容路径。settings IPC等待落稳；重复兼容finish共用一个Promise，预留在落稳前不释放。失败留下pending/query-only；恢复drain使旧预算回调失效。真实SQLite/文件、PG回执与实际Electron安全存储证据见[测试手册 §5.12](./V25-MIGRATION-TESTING.md)。

**完整启用仍需产品接线**：先核对/排空旧持久非终态、legacy内存预留和未结费用；不能在这些仍活跃时仅调用guard.enable，让旧回调被拒后便宣称已收敛。旧托管记录缺少绑定/remote关联时不补造证据，不自动核销或借新账号重发。B19的直接写拒绝保护预算，却不提供这条旧任务核对产品流程。G、P5的托管图像必须使用持久请求/回执，不把兼容累计用量接口当作逐调用账单。接完显式连接/准备确认/执行取消/下载恢复后联合验收P4。

#### 10.10.7 B20：持久账本前置检查已实现

`guard.enable`在写锚前调用repository检查，SQLite commit内在异步落盘之后再次检查；整库任一held/unknown、未终态托管请求或pending/started/unknown托管call都使启用拒绝。残留managed_generation_requests证明旧远端身份仍在，即使锚和checkpoint同时丢失也禁止生成新namespace。已结束且无未结调用/预留的旧历史、拒绝确认和外部BYOK不因此被禁用。

前置拒绝不改库和锚；pending落盘期间检测到晚到旧请求则保留query_only，不删除pending或自动结算。真实SQLite/第二连接验证见[测试手册 §5.13](./V25-MIGRATION-TESTING.md)。这不替代宿主legacy内存预留核对、操作准入排他、账号验证及用户恢复出口；G产品链开放前仍须联合实现这些接缝。整库与锚均回退到没有任何远端关联的旧状态，仍属于既有本机不可识别边界。


#### 10.10.8 B21：显式云图像与普通G产品接线

`musefold-cloud` 是明确的新执行类型，固定issuer/principal的散列ID不超过实体契约长度；legacy `managedBy` 标记不作为授权。账号、服务binding与本机检查点准备完后，主进程发一次性120秒reviewRef；连接确认独占托管work scope，并阻止legacy新预留、拒绝未结预留，成功后退役旧内存准入。原BYOK/独立文本连接保留，不自动搬移key或开启sync。匹配恢复有显式核对出口，不匹配/旧未映射费用仍拒绝，不自动清锚。

普通G点击发送使用`consent: interactive`，这是已有费用范围裁决，不加第二张费用卡、不授予Agent预算。主进程再次捕获身份与固定binding，登记冻结输入/原key后仅消费一次首发资格；当前无参考图/Prompt引用/微调，超范围在登记/发送前拒绝。可选negative/aspectRatio为空时省略，避免undefined进入JSON账本。1/2/4张由同一云请求处理。

停止先写持久cancelRequestedAt；先于claim的停止证明未发送，后于claim不能推断零费用。可重复发送原任务的幂等cancel POST以恢复丢失回包，绝不自动重发generation POST；迟到成功与实际费用仍保留。回执单调收敛，未知不释放，已知失败/取消成本也写本机历史。结果只经所属任务和捕获issuer的`assets/:id/content`下载，拒绝重定向，限30MiB并校验字节数/图片类型/尺寸；不跟随资产返回URL。确定文件名与单次running→success事务使重复恢复不增资产。

查询只能用原key；真实重启不会把有托管关联的本机run改成INTERRUPTED，也不会恢复首发资格。当前恢复卡最多最近20条，purge后的素材缺失、旧未映射托管诊断、正式API/PG合流和实际宿主SIGKILL/旧备份全矩阵按P4-R1..R4接续。用户主动重试目前是已知失败/取消终态后准备新G/新key、保留本地父记录，不是云explicit_retry接口；这条跨端谱系仍须联合验收。依据与实际结果见[测试手册 §5.14](./V25-MIGRATION-TESTING.md)。

### 10.10.9 B22：恢复分页、云终态与本机交付分离

当前账号云清单按 created_at/id 降序稳定分页，游标绑定 issuer/principal；不按会变化的终态筛选导致漏项。旧未映射记录共用启用阻塞判定，但只列本机诊断，不按当前云身份归属。字段只含时间、类型、原因、原请求 ID，读取不修改预算、锚或请求。

成功回执先将本机 run 投影为 success，费用按回执更新；图片可用性另列 available/download_pending/missing/purged/history_removed/not_ready。无素材不伪装仍在生图。获取素材失败可核对原 key 并重取受控原资产，已有资产须校验内容/元数据一致，只修复路径且不重建记录。云 purge 后无原素材不创建替代任务；已有本机完整结果继续可用，未知费用不当零。B21 最多 20 条的交互限制已由本批替代。

本机专项、真实 Electron 新 PID 与既有真 PG 回执回归通过，详见测试手册 §5.15。当前正式主进程→真实 Hono/PG 的产品合流及逐点 SIGKILL/旧备份矩阵仍属 P4-R2/R3，不以本批替身或既有 core 子进程结果代替。P4、P5/P6 和整包保持部分完成。

### 10.10.10 B23：真实服务中的已知未发送与未知金额

正式桌面客户端现已联合Hono/PG、队列/worker验证。成功/失败/发送后取消，在没有独立可信Provider金额时仍为unknown/null；1/2/4张及并发不靠测试注入固定费用。bound且从未dispatch的排队取消，API同事务明确记not_sent/0；历史not_sent终态null按未发送证明显示费用已知，legacy_unbound或claimed未知不归零。真实Electron四图/newPID/缺图恢复只查询原key和原资产。

本机联合证据见测试手册§5.16。正额账单、跨月回写和完整费用故障仍按P6，正式Electron逐点强杀/备份确认按P4-R3；普通正常关闭和API备份子进程SIGKILL不替代这些要求。

### 10.10.11 B24：真实强杀下的取消零费用与显式恢复

未领取且持久取消已成立证明本次请求未消费发送资格，因此恢复投影的本地历史现在与费用账本一致记0；领取完整但POST前崩溃不能仅凭重启推断免费，仍只查原key并保留未知。实际API取消在Provider领取前后分别验证0与unknown，两者不可混用。真实安全备份恢复保留原namespace/回执，过旧不降锚，匹配仍需要显式确认。正式macOS Electron强杀/备份证据见[测试手册 §5.17](./V25-MIGRATION-TESTING.md)；确认内部竞争与缺损锚等继续[路线图 §6.12](./V25-MIGRATION-ROADMAP.md)，不宣称完整P4/P6、跨月正额账单或管理员已完成。

### 10.10.12 B25：恢复确认的唯一授权提交点

`resumeMatchingCheckpoint` 先写 `pending.kind=resume`（committed=from，to为同lineage/namespace下一revision），异步写入后再次核对捕获账号、DB epoch和review到期；同步SQLite CAS是唯一启用点。提交前任何异常均不更新checkpoint，pending不会允许消费，只能在新显式review下复用准备操作；普通budget/claim pending不能借此解锁。提交后整理文件失败，只有pending.resume.to与SQLite精确一致才能被识别为已授权，不把整理当成第二次授权。restore仍先持久query_only，已提交resume的识别不抹掉这个限制。

成功恢复确认现在推进revision一次，原namespace、原key、payer/月、预算与费用均不改变；原安全备份会相应成为更旧版本，不能降锚继续付费。实际main的5项执行中竞争、7项写失败、2项确认强杀、2项实际任务缺损锚及claim提交中点见[测试手册 §5.18](./V25-MIGRATION-TESTING.md)。R3本机边界验收，后续先R4重试/legacy/BYOK，再P5/P6；Windows/真实费用与生产交付仍独立待验。

### 10.10.13 B26：显式重试是独立授权，恢复仍只核对原任务

同一 retry caller key 对应一个新持久请求/远端 key，本地与云端都保留原父关联。新授权冻结原请求、沿用原 payer，允许重新确认后的 credential version；不使用旧 authEpoch 恢复发送。API 与桌面均拒绝原执行/费用未知、缺可靠绑定或付款方变化；已接受远端 key 的旧绑定重放不受新准入重写。费用已知的失败/取消才能进入新 retry；本机未领取取消可以用新 ordinary_create，无需伪造云零费用回执。

原请求和子请求的预算/费用分开，由原回执驱动；返回坏 JSON 或重启不允许替换 POST。真实服务与 Electron 新 PID 已验证一父一子一 retry POST；正额为合成账本验证，不是独立生产账单。B26 时两个用户点击各自产生新 UUID；B27 已补工作台/历史同一进行中交互防重（下一节），不代表所有旧入口已统一；legacy 最终结算/启用竞争、BYOK/R/S 实际入口仍待 C3/C4，P5/P6继续开放。证据见[测试手册 §5.19](./V25-MIGRATION-TESTING.md)，下一步见[路线图 §6.14](./V25-MIGRATION-ROADMAP.md)。

### 10.10.14 B27：三个手动重试入口的交互准入

工作台、历史列表与详情以 QueryClient/账号 epoch/原任务为界共享未结束的 mutation，UUID 在准入后才创建。界面 pending、一次错误提示和账号隔离复用 TanStack Query；失败/完成后的新显式点击仍是新意图。云任务费用未知或已purge时不提供重试，保留只读核对。成功/过期不满足两端 retry 合同，不展示无效按钮。

本规则没有改变 B26 持久 key、付款方、费用或新授权规则；重启不保存 UI Promise，仍靠主进程账本恢复。实际服务/界面证据见[测试手册 §5.20](./V25-MIGRATION-TESTING.md)。兑换后续发仍是 account/hooks 的独立旧入口，当前会吞续发异常，必须随 R4-C4 补可解释反馈、并发和换号验收；本批未修复或宣称覆盖。R4-C2/C3/C4/C5 与 P5/P6 保持开放。

### 10.10.15 B28：重试故障的实际费用事实

R4-C2 本机17项验证已领取后只查询原key、不再POST，子请求不修改父付款方、预算月份、预留和调用费用。未领取取消后新授权为普通create并保留本地父关系；排队取消和发送前凭据再次轮换为可信未发送0，已领取后取消/成功但上游不返成本仍为unknown。父purge/再轮换后原retry拒绝不产生替代任务，已接受子任务有可见GET核对入口。

真实宿主/服务、强杀命中、原新PID、财务快照与精确调用次数见[测试手册 §5.21](./V25-MIGRATION-TESTING.md)。合成服务费用不代表可信正额账单或跨月全集；旧备份缺新子记录时只读限制不承诺完整任务列表恢复。C3正式旧入口、C4 BYOK/R/S/兑换续发及C5仍待，P4/费用整卡不关闭。

### 10.10.16 B29：兑换成功不等于生成成功

已到账的兑换独立成立；续发请求被拒绝或返回失败子任务时显示生成恢复失败，不把它变成兑换失败或自动再次兑换。同账号同原任务的未结束 retry 与手动入口共享一次请求；replay create 继续使用原输入/幂等键，晚到响应不写新账号。官方额度错误与 BYOK 上游余额分开：桌面只为 `ACCOUNT/QUOTA` 或契约官方额度码保留兑换引导。

本批只改交互与错误映射，不新增花费授权、重置 unknown、转换 payer 或改原月费用。真实/合成及首次失败边界见[测试手册 §5.22](./V25-MIGRATION-TESTING.md)。合成兑换/上游不能代表真实账单或跨月合流；C3、完整 C4/C5、P5/P6 和费用整卡保持开放。

### 10.10.17 B30：旧 Key 不代表付款身份，自备模型与费用来源保留

实际本地 G 曾绕过 Automation 的 unbound 拒绝；现所有进入公共 generation core 的旧 `managed_by=account` 请求在没有主进程可信 transport 时失败，Provider 构建与图像 HTTP 发送前停止，原运行留下身份错误。保留 Key 或显式点击不能制造 payer。正式 Automation G/R/S 的原持久授权继续生效；自备 R/S 不转云 G，其测试调用均为 external，不扣托管预算。

模型默认在创建 run 前固化，避免新请求实际使用默认模型却将历史写成 unknown。历史已有 unknown 不被猜测/重写，恢复分类仍待补。另三类旧月份/旧 scope 未结记录的真实 UI/IPC 启用均被拒绝，保留原费用/连接且不建锚；这不是完整异步最终结算或真实跨月计费证明。实际结果和边界见[测试手册 §5.23](./V25-MIGRATION-TESTING.md)，原 P4/P5/P6 继续开放。

### 10.10.18 B31：本地管理证明不替代云身份，自备客户端不转托管付款

本地 challenge 仅证明本机调用资格，不能制造账号云类型、写入自备 Key 充当云凭据，或在退出后激活云连接。云激活/探测复用当前账号绑定和持久执行状态核对；删除默认连接只自动选择非账号本地连接，无合适候选保留无默认。保留既有云连接本地删除语义，不删除远程任务或改变费用事实。

云启用前后自备取消/重试/方案/Skill 及实际 CLI/MCP 的本地 G/R/S 均验证了自备凭据与 external 归属，不更改托管月份/策略/预留/已记费用。客户端成功属于本地自备路线，不是账号云 G/R/S 接入或真实收费验收。细节见[测试手册 §5.24](./V25-MIGRATION-TESTING.md)；历史模型缺失、C3/C5 和 P5/P6 原条件继续开放。

### 10.10.19 B32：缺少原模型不能猜测重放

本地旧模型 unknown 不是使用当前模型的授权。core/IPC 在发送前明确拒绝，不读取Provider执行密钥，不写子记录，不改原模型、参数或费用；用户在连接设置核对当前模型后于工作台新建意图。独立托管云请求仍沿其可信 frozenRequest 和费用核对，不由本地字段猜测重绑定。实际零发送、原整行不变、新意图一次成功及费用fixture边界见[测试手册 §5.25](./V25-MIGRATION-TESTING.md)。C3/C5 和 P5/P6 仍按原条件验收。

### 10.10.20 B33：取消排空后再交出数据目录

独立 headless serve 仅接受环境变量自备凭据，旧 account 仍由公共 core 在发送前拒绝。停止时关闭新生成准入，取消并等待现有生成终结后才关库/释放 owner；桌面接管已识别旧守护时等待原 PID 退出。取消后费用仍未知/null，不承诺第三方取消成功或退款，不新增云账号授权，不清持久旧账。实际与替身、旧版本保证边界见[测试手册 §5.26](./V25-MIGRATION-TESTING.md)；C3/C5 的旧结算/身份竞争与 P5/P6 原条件保持开放。


### 10.10.21 B34：来源确认不产生模型或图像花费授权

内部单来源 `confirmationId` 只绑定本次固定 GitHub 快照。准备、确认和完整字节读取的模型/Provider 调用为 0；它不创建付款身份、预算预留或执行回执。未来 Agent 必须在独立且有效的会话/费用授权内使用已确认来源，发送前仍检查取消与身份。公开 confirmInstall/Agent 异步合同尚未接线，不因新增内部 schema 推断 Cloud MCP 花费能力恢复。详细已验和待验见[来源验证](./V25-CLOUD-SOURCE-VALIDATION.md)；C3/C5、P5/P6 原条件保持开放。


### 10.10.22 B35：异步受理不表示已授权模型执行

202 session 只确认服务器已持久受理来源阶段，并不代表产生成功草稿或获准调用收费模型。逐来源 confirmationId 允许消费特定来源，重放不能推进下一来源；确认结束后目前持久为 AGENT_COMPILER_UNAVAILABLE，模型调用0。取消会话与图像 run.cancel 分离，不产生生图付款/取消墓碑。

下一阶段必须在服务端模型配置、用户费用范围和持久发送资格确定后接编译；不得凭来源确认调用模型、用通用 Graphile 重投盲目重发未知模型调用或猜测成本为0。原 C3/C5/P5/P6 保持，Cloud MCP 只读与管理员不能代批不变。细节见[会话验证 §7](./V25-CLOUD-SOURCE-VALIDATION.md)。
