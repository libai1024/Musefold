# 07-01 设置 · 账号 — 旧版 vs v2.5 对照

> **旧版源码**:`AccountSettingsSection`(装配)= `AccountSection`(260 行,含 `AccountSignedOutForm` 205 行 / `AccountSignedInPanel` 257 行 / `AccountCloudSyncPanel` 138 行)+ `DoubaoSection`(332 行)。
> **新版源码**:`packages/features/src/account/{AccountPanel,CloudSyncPanel}.tsx`(设置页「账号」「云同步」两张卡)。

---

## 1. 结论与迁移状态

账号是设置域里**迁移最完整**的分区:账密登录/注册、注册确认密码、积分展示、兑换码、退出登录(带确认)、云同步开关全部就位,且形态按 D9(内联表单,四端同一份)重设计获批。差值集中在:**登出后用户名预填**、**兑换错误的错误码文案**、**云同步冲突处理 UI**、以及整个**豆包体验通道**(冻结面挂点)。

## 2. 未登录态对照

| 项 | 旧版 `AccountSignedOutForm` | 新版 `AccountPanel` 表单 | 判定 |
|---|---|---|---|
| 模式切换 | 「登录 / 注册」分段控件 | 文字链「没有账号?注册 / 已有账号?登录」 | 等价;分段控件可见性更高,P3 评估换回 |
| 字段 | 用户名、密码、**注册时确认密码** | 用户名、密码;注册模式增加 ShadCN 确认密码字段,失配显示可见错误并拦截按钮/Enter 提交 | **已收口(2026-08-29)**:确认值仅在渲染层精确比较,不进入 `RegisterRequest` 或 gateway payload;模式切换清理确认值与错误 |
| 描述文案 | 「推荐通道:一次登录,Agent 与生图模型自动配置,无需管理 API Key。」 | 简化版卡描述 | **范围说明**:旧版描述不代表 v2.5 UI 范围;当前 AI Connections 仅覆盖 image Provider,暂无可达 Agent connection/model UI,也无法配置 separate Agent key 或选择 `gpt-5.5`。 |
| 提交态 | 「登录中…/注册中…」+ disabled | 同 | 一致 |
| 错误 | 表单内红字(保留输入) | `account-auth-error` 红字 | 一致(I4) |
| 预填 | **登出/会话失效后回表单预填上次用户名**,只需重输密码 | 无 | **P2**:低成本高感知的细节,恢复 |

## 3. 已登录态对照

| 项 | 旧版 `AccountSignedInPanel` | 新版 | 判定 |
|---|---|---|---|
| 名片 | 头像/昵称/用户名 + 积分(带 ¥ 换算注释:积分 = 人民币 × 10) | 头像缩写 + 名称 + `account-points` 积分 | 一致;换算说明 P3 |
| 兑换 | 输入 + 兑换;**错误码翻译表**(`ACCOUNT/REDEEM_INVALID` → 「兑换码无效或已使用」/ 服务不可用 → 「稍后重试」);成功 toast 带到账积分 | 输入 + 兑换 + 成功 toast 到账积分 | 主干一致;**P2 错误码文案表迁移**(现在可能裸抛 message) |
| 余额刷新 | 进入已登录态时刷新;`account:changed` 事件回填,避免循环请求 | TanStack invalidation | 等价 |
| 退出登录 | 确认态二段钮(「退出登录」→「确认退出」) | `account-logout` + AlertDialog | 一致(I3),新版形态更标准 |

## 4. 云同步对照(旧内联面板 vs 新独立卡)

| 项 | 旧版 `AccountCloudSyncPanel` | 新版 `CloudSyncPanel` | 判定 |
|---|---|---|---|
| 开关语义 | 「提示词云同步」开关;未登录时警示条「登录后才能启用,本地内容可继续离线使用」 | 同语义(登录 ≠ 同步,开关独立;开启即全量同步一轮,此后写路径防抖) | 一致,新版语义注释更清晰 |
| 范围说明 | 「同步提示词、文件夹和标签;本机图片路径与密钥不会上传」 | 卡描述「数据仅在开启后上云」 | **P3 文案补齐**:不上传密钥/图片路径的安全承诺要显式说 |
| 手动同步 | 「立即同步 / 同步中…」钮 | `CloudSyncPanel` 已接 `useSyncNow → sync.syncNow`,同步中禁用并显示进行态 | 一致 |
| 冲突 | **「需要处理的同步冲突」列表区**(逐条处理) | `CloudSyncPanel` 显示冲突双方摘要与三种动作 | **已验证**:Electron E2E 覆盖四态、zero transport、首轮 `bootstrap → pull → push`、paused mutation/usage、逐条 `local`/`remote`/`duplicate` 以及 logout/relogin preservation。 |

**同步与安全证据**：secret plaintext scan 通过；四张同步视觉截图已人工检查。

## 5. 豆包体验通道(冻结面挂点,禁止顺手实现或删除)

旧 `DoubaoSection` 完整能力存档:「豆包 · 体验通道」卡,扫码登录(专用浏览器分区,「登录信息只保存在专用浏览器分区,不进入 Musefold 数据库、导出文件或日志」)、账号状态行(已连接名/未登录)、重新扫码、退出登录、每日限量说明;已登录官方账号时显示「推荐优先使用官方通道;官方不可用时可切换豆包应急」引导。主进程语义与渲染入口均为冻结面(V25-UI-SPEC §0.2 doubao-web),排卡前新设置页**不出现**该卡;本节仅作恢复时的规格基准。

## 5.1 状态矩阵(验收基准)

| 块 | loading | error | empty/边界 | ready |
|---|---|---|---|---|
| 账号卡 | 旧:骨架行;新:`Skeleton`(AccountFooter 同源) | 读取失败=视为未登录落表单(两代一致,登录动作本身会再报错) | 未登录=内联表单 | 名片 + 兑换 + 退出 |
| 兑换 | 钮 loading + disabled | 错误码翻译红字(P2 迁移) | 空输入禁用提交 | 成功 toast 到账数 |
| 云同步卡 | 状态行骨架 | 「同步状态读取失败,请重试」 | 未登录=开关禁用 + 警示条 | `unset`/`enabled`/`paused`/`conflict` 四态;`unset`/`paused` zero transport;开启首轮固定 `bootstrap → pull → push`;暂停仍累计本地 mutation/usage;冲突逐条含 `local`/`remote`/`duplicate`;登出/重新登录保留本地同步数据但要求重新显式开启 |

登录会话失效的全局路径(跨屏规则,登记在本篇):旧版任何 401 → account store 清态 → 设置账号卡回表单 + 预填用户名 + toast「登录已过期」;新版 gateway 层 401 处理已有(query error),但**过期 toast 与自动回表单的联动待核**(P2 并入用户名预填任务验收)。

双端差异:Web 端登录走同源 cookie(D12),表单提交后 session 由服务端种;桌面走凭据委托换 token 存 `safeStorage`。两端 UI 完全同一份,差异全部在 gateway 实现内——本分区是「四端一份」原则执行得最好的样板,后续分区以此为准。

## 6. 动效与 UIUX 细节

- 旧登录/登出切换有轻量 fade(`animate-fade-in`);身份切换过场动画属侧栏域(02 §5)。新版直切,fade 工艺规格见 §8 0701-C2(过 reduce 闸门)。
- 旧表单字段用 `Field`(label + 控件 + 行内错误)结构;新版 shadcn `Label` + Input 等价。
- 密码框:两代都不做明文切换(有意,降低肩窥面);保持。
- a11y:提交钮 `aria-busy` 语义旧版有(loading 文案),新版 disabled + 文案切换等价。

## 7. 任务清单

| 优先级 | 任务 | 验收要点 |
|---|---|---|
| P1 | 注册确认密码字段 + 不一致红字(Enter 提交路径也拦截) | **已收口(2026-08-29)**:ShadCN Input/Label;失配时提交被阻且错误可见,匹配后 payload 仅含 username/password;features 单测与 Web 双视口 E2E 已覆盖 |
| P1 | 云同步冲突处理 UI:冲突列表 + 逐条「保留本地/保留云端/另存本地副本」 | Electron E2E 已覆盖四态、zero transport、首轮顺序、paused mutation/usage、逐条三动作与 logout/relogin preservation;secret scan 与四张视觉截图已通过 |
| P2 | 兑换错误码文案表迁移 | 错误码→中文文案单测 |
| P2 | 登出后用户名预填 | 登出→表单用户名保留 |
| P3 | 云同步安全承诺文案、积分换算说明、登录/注册分段控件形态评估 | — |

> 冻结面:豆包体验通道整卡(§5)。

测试建议:P1 两项都要双端 E2E——注册不一致密码走 Enter 提交路径断言被拦;冲突处理用 api 集成测试造双端同键冲突,断言逐条处理后 `status` 回 idle 且数据落到所选侧。既有 `account.test.tsx` 的内存网关 fixture 扩展 `conflicts` 字段即可承载单测。

## 8. Codex 增益(C 系列,语汇见 [00-codex-craft.md](./00-codex-craft.md))

| 编号 | 级 | 增益 | 规格 |
|---|---|---|---|
| 0701-C1 | C1 | 数字排版(挂靠 00 C-4) | 积分 readout(名片/兑换到账/侧栏 footer/移动顶栏)全部 `tabular-nums` + `formatPoints` 千分位同源;同步「上次同步时间」时间戳 tabular |
| 0701-C2 | C1 | 表单切换 fade 用 token(吸收 §6 P3) | 登录↔注册模式切换、未登录↔已登录形态切换 `--dur-fast` 淡切(过闸门);字段错误红字就地出现不位移(预留高度或 `min-h`,防表单跳动) |
| 0701-C3 | C2 | 冲突处理 UI 的工艺基线(挂靠 §7 冲突 P1) | 冲突列表 = 00 §5.2 行解剖(标题 + 本地/云端时间戳 tabular + 行尾「保留本地/保留云端/另存本地副本」三动作);逐条处理后行 `--dur-base` 离场;不做全屏对比视图(≤5 条的常见规模不值) |
