# 07-04 设置 · 开放能力(自动化 + 已连接应用) — 旧版 vs v2.5 对照

> **旧版源码**:`OpenCapabilitiesSection`(装配)= `AutomationSection`(135 行)+ `LocalControlCard`(172 行)+ `IntegrationGuide`(接入向导)+ `SkillManagementBlock`(164 行)+ `AutomationAuditList`(106 行)+ `ConnectedAppsSection`(52 行)。
> **新版**:**无对位实现**(0%)。本分区是「Agent 对外能力」的控制面,主进程语义(automation server / Cloud MCP)完整保留且持续被 CLI/MCP 使用——**只有控制 UI 消失了**。

---

## 1. 结论与迁移状态

这是设置域里「不可见但在运行」风险最高的分区:旧版在这里控制**本地控制面**(automation HTTP server 的开关/令牌/预算)与 **Cloud MCP 授权**。v2.5 渲染层没有任何入口,意味着:automation server 若默认开启,用户无法从 UI 关闭或轮换令牌;花钱动作的月度预算无法调整(01 §4 登记的 `AutomationConfirmCard` 缺失与本分区是同一条风险链)。**建议本分区在设置系列中优先级排第二(仅次于偏好的动效接线)**,因为它是安全边界控制面。

## 2. 旧版结构存档(恢复基准)

### 2.1 本地控制面卡(`LocalControlCard`)

- **开关行**(`automation-toggle-row`):「配置监听状态」——开=本机 HTTP 端口监听 + 写发现文件;关=端口停听、发现文件删除(安全边界注释:token 只用于本机 Agent/CLI 接入)。
- **令牌行**(`automation-token-row`):掩码展示(`maskToken`),动作:显示/隐藏、复制、**轮换**(rotateToken,即时失效旧令牌)。
- **预算行**:每月自动化积分预算;空串/非法草稿不落盘(防 `Number('') === 0` 把「逐次确认」预算误写成 0),负数 clamp 到 0。预算语义与 `AutomationConfirmCard`(超预算逐次确认)联动。
- 状态矩阵:loading(`automation-loading`)/ 读取失败(`automation-load-error` + 重试 `automation-load-retry`)/ ready。

### 2.2 接入向导(`IntegrationGuide` + `SkillManagementBlock`)

- 标题「在 Agent 里使用 Musefold」;说明「MCP 服务器与命令行工具已内置在应用里,无需安装 Node 或其他依赖;配置中不含任何密钥」。
- 条目:Cursor 一键安装(`integration-cursor-install`)、MCP 配置片段(可展开 details + 复制)、CLI 块、**Musefold 自动化 Skill 条目**(`SkillManagementBlock`:未安装 · App 内置 vX / 发现更新 vY / 已安装计数,安装/更新动作走主进程 skill-release 通道,现仍有集成测试 `integration-skill-release.test.ts` 守护)。
- 通知条(`integration-notice`)。

### 2.3 最近调用审计(`AutomationAuditList`)

- 外部调用一览:动作、时间、消耗积分(`actualPoints ?? '-'`);空态 `automation-audit-empty`。数据源主进程审计表(0012_automation_audit 迁移)。

### 2.4 已连接应用(`ConnectedAppsSection`)

- Cloud MCP 客户端授权管理;门控:未登录=「登录 Musefold 账号后可管理」;自定义账号服务器=「暂不支持」。授权列表 + 撤销(v2.5 云端 Better Auth MCP 语义已在 apps/api,只缺 UI)。

## 3. v2.5 迁入判定

| 块 | 依赖 | 判定 |
|---|---|---|
| 本地控制面 | 主进程 automation 域(在);桌面能力开关 | **P1**:桌面 only 卡「开放能力」,开关/令牌/预算三行照搬;与 01 §7 `AutomationConfirmCard` 同一张卡交付 |
| 审计列表 | 主进程审计表(在) | P2:进同一卡的「最近调用」折叠区 |
| 接入向导 | skill-release 通道(在,冻结勿动) | P2:静态内容 + 复制动作,成本低感知高(Agent 用户的入门路径) |
| Skill 管理条目 | 同上 | P2 随向导 |
| 已连接应用(Cloud MCP) | apps/api Better Auth MCP(在) | **P2(Web+桌面)**:云端能力开关 `hasCloudMcpControls`;撤销授权 = 破坏性动作走 AlertDialog |

## 4. 交互与安全口径(恢复时不可降级)

1. 令牌只显掩码,复制走系统剪贴板,**轮换必须即时失效旧令牌**(主进程语义已保证,UI 需二次确认)。
2. 预算输入的防呆(空串不落盘/负数 clamp)原样保留——这是真实事故驱动的规则。
3. 开关关闭 = 端口停听 + 发现文件删除,UI 文案必须说清(旧文案照搬)。
4. Cloud MCP 撤销授权后,对应客户端的下次调用必须 401——恢复 UI 时补 api 集成断言。
5. 审计列表是只读面,不提供删除(审计完整性)。

## 5. 动效与 UIUX 细节

- 令牌显示/隐藏切换无动画(即时);复制成功 toast。
- 审计列表行 hover 中性;时间用相对+绝对混合(旧 `automation-format`)。
- 向导 details 展开用原生 `<details>`(无 JS 动画)——恢复时可换 shadcn Collapsible + 高度过渡,过 reduce 闸门。
- 所有卡片状态矩阵齐全(loading/error+重试/ready/empty),恢复时按 I1/I4 复刻。

## 5.1 恢复时的完整验收细则(逐控件)

**开关行**:副文两态——开:「本机 Agent 与脚本可经 HTTP 端口调用 Musefold」;关:「端口已停止监听,发现文件已删除」。切换有主进程往返延迟,钮期间 disabled + spinner;失败回滚开关态 + toast 原因。

**令牌行**:掩码格式沿旧 `maskToken`(前 4 后 4 中间省略);「显示」切换 5 秒后自动回掩码(旧版行为待核,若无则不加);「复制」永远复制完整令牌(与显示态无关);「轮换」二次确认文案:「轮换后现有接入立即失效,需要在 Agent 侧更新令牌」。

**预算行**:输入为整数积分;placeholder「留空 = 每次动作都确认」;保存时 `parseBudgetDraft` 规则(空串→null 不落盘、非法→不落盘、负数→0);当前月已用额度 readout 与预算并排(旧版有,恢复时从审计聚合取)。

**审计列表**:行 = 动作名(automation-format 翻译表:generate→「生成图像」等)+ 相对时间 + 实际积分(null 显示「-」);最多显示最近 20 条 + 「仅保留最近 90 天」说明;不分页(控制面不是审计终端,完整数据走导出)。

**接入向导**:Cursor 一键安装按钮走 deeplink(`cursor://`),失败(未装 Cursor)fallback 复制配置;MCP 配置片段 `<details>` 内代码块 + 复制钮;CLI 块显示二进制路径(随 App 打包)+ 复制;三块共用「配置中不含任何密钥」承诺行。

**Skill 条目**:三态文案(未安装 · App 内置 vX / 发现更新 vY / 已安装 n 个);安装/更新动作期间 disabled + 进度;结果 toast。skill-release 主进程通道有集成测试守护,UI 只做薄绑定。

## 5.2 状态矩阵与双端

| 块 | loading | error | ready |
|---|---|---|---|
| 控制面卡 | `automation-loading` 骨架 | `automation-load-error` + 重试钮 | 三行 + 审计 |
| Cloud MCP | 授权列表骨架 | 就地错误 + 重试 | 列表 + 撤销;未登录/自定义服务器=门控文案替代整卡 |

双端:本地控制面/向导/审计 = 桌面 only(`hasLocalAutomation` 能力开关,Web 不渲染);已连接应用 = 双端(云能力)。桌面能力开关命名与 `DESKTOP_CAPABILITIES` 现有风格一致(`hasLocalAiProviders` 先例)。

## 6. 任务清单

| 优先级 | 任务 | 验收要点 |
|---|---|---|
| P1 | 「开放能力」卡(桌面):开关/令牌(掩码+显隐+复制+轮换二次确认)/月度预算三行,接主进程 automation 域;与 AutomationConfirmCard 同卡 | 关闭后端口停听(集成测试);预算防呆单测 |
| P2 | 最近调用审计折叠区;接入向导(Cursor 安装/MCP 配置复制/CLI/Skill 管理条目) | Skill 版本状态三态文案对齐旧版 |
| P2 | 已连接应用卡(Cloud MCP 授权列表 + 撤销,`hasCloudMcpControls` 门控) | 撤销后 401 集成断言;未登录/自定义服务器门控文案照搬 |

## 7. Codex 增益(C 系列,语汇见 [00-codex-craft.md](./00-codex-craft.md))

本分区是「终端级密度」的天然主场(Warp/Codex 同类面):机器可读的东西一律 mono,人读的保持常规字阶。

| 编号 | 级 | 增益 | 规格 |
|---|---|---|---|
| 0704-C1 | C1 | mono/tabular 排版(挂靠 00 C-4,随 §6 P1 卡同交付) | 令牌掩码、MCP 配置片段、CLI 路径 = mono;审计行时间与积分、预算数字、月已用额度 = tabular;动作名保持常规字体(翻译表中文) |
| 0704-C2 | C1 | 复制反馈统一 | 令牌/MCP 配置/CLI 路径三处复制:钮内 Copy→Check 1.2s + toast 双反馈(与 04 §8 P3 复制反馈同实现,一处封装) |
| 0704-C3 | C2 | 轮换令牌的危险感分级 | 轮换确认走 AlertDialog 红主钮(I3 顶格),但**开关行不用红色**(关闭可逆);危险色只给不可逆动作,承 00 法则 1 |
