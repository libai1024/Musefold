# v2.5 迁移阶段测试记录（续篇）

本篇接续[测试手册](./V25-MIGRATION-TESTING.md) §5.71，避免单文件超过 3000 行。原手册的证据分级、源码归属和 pass/fail/skip 规则继续适用。历史报告不因后续修改而自动成为当前源码的全量证明。

## 5.72 B73：Desktop SQL 分页、工作区回读与回收站查询

**状态（2026-09-13）**：B73原范围已验收。实现、就地测试、统一检查、明确构建、真实三端专项、完整E2E及本轮归档扫描均通过；仅关闭B73，D01/D02与完整迁移保持开放。当前 1621 项源码摘要 `cb081adef663298ab536648eefd3b8bec87ba6b9d5862c1e0f4738d2549fac3a`；[源码清单](../../tests/v25/.results/b73/source-files.json)及[相对 B72 的 16 路径变化](../../tests/v25/.results/b73/source-diff.json)可追溯。

### 修复范围与产品行为

1. Prompt 查询契约增加可选 `deletedOnly`，布尔字符串经现有查询解析规则处理；true 优先于 `includeDeleted`。API 与 Desktop 都在数据库查询中先筛选已删除记录，再分页。公开实体和数据库 schema 不变，无迁移 SQL。
2. v25 Desktop 不再拼接预先截断的普通列表和 `listDeleted()`。core 使用参数化 `LIMIT/OFFSET`，每次最多读取请求页大小加一条；保留原 FTS5 搜索与排序，并添加稳定同值排序。旧调用未传分页窗口时仍保留原普通 1000／搜索 500 上限，旧 `listDeleted()` 仍最多 500，不能宣称全部旧接口已改为无限列表。
3. Desktop 非当前 workspace 的 create/update 写后读取携带原 scope，返回实际目标记录。同 ID 的当前空间记录不再冒充目标结果；当前空间 FTS 与同步 outbox 保持隔离。
4. 回收站直接请求 `deletedOnly`。筛选无结果时可清除筛选；查询失败显示重试，下一页失败保留已加载内容，并停止自动触底重试。用户显式重试后重新读取有效页面。
5. 清空确认准确说明作用于全部回收站，包括未加载和被筛选隐藏的条目；只在无筛选且已加载完整集合时显示确定总数。取消不删除；恢复后刷新列表。未新建总数接口或为了确认框而全量加载。

### 实际运行与首次失败

| 阶段 | 结果和证据 | 证明范围 |
|---|---|---|
| Desktop/core 原实现复现 | [0P/14F](../../tests/v25/.results/b73/desktop-repro-vitest.json) | 预先截断、过滤/排序、显式空间回读及新增非法游标拒绝要求；不将 14 项解释为 14 个独立生产缺陷 |
| 原查询接缝复现 | [契约 0P/9F](../../tests/v25/.results/b73/contract-repro-vitest.json)、[共享页面 32P/5F](../../tests/v25/.results/b73/feature-repro-vitest.json)、[实际 API 42P/2F](../../tests/v25/.results/b73/api-repro-vitest.json) | 首次新增 deletedOnly/回收站行为尚未实现，原 API 分页回归仍通过 |
| Desktop/core/契约/client 修后 | [55P/0F/0S](../../tests/v25/.results/b73/desktop-fixed-vitest.json)，1.905 秒 | 自有真实 SQLite，1001 条普通/搜索和 501 条已删分批可达；搜索、文件夹、多标签、置顶、四种本地排序；空间隔离、原清空事务回归及查询传输 |
| 共享页面修后 | [37P/0F/0S](../../tests/v25/.results/b73/feature-final-vitest.json)，2.244 秒 | 首页活跃记录超过一页时仍可打开回收站；筛选空态、取消、失败重试和保留首屏。初次修后 36P/1F 是夹具把 loading 误当筛选完成，已改为等待匹配行出现，保留[原报告](../../tests/v25/.results/b73/feature-fixed-vitest.json) |
| 当前实际 API/路由 | [52P/0F/0S](../../tests/v25/.results/b73/api-final-vitest.json)，5.013 秒；[命令](../../tests/v25/.results/b73/api-final-summary.json) | 44 项真实 PG 分页/回收站（含外部 owner 已删记录隔离）和 8 项路由解析；不将 B72 的完整 API604P 改标为本轮完整 API |
| 当前统一检查 | [check36/36](../../tests/v25/.results/b73/check-typed-summary.json)，28.367 秒 | lint、类型、单测、双宿主 build 与边界；任务数不是测试用例数，默认数据库 skip 不算集成通过 |
| 明确构建与源码扫描 | [build](../../tests/v25/.results/b73/build-summary.json) 3.646 秒；[source 扫描](../../tests/v25/.results/b73/source-security.json)零命中/错误 | 与当前源码摘要一致；不代替实际归档或最终安装包安全检查 |
| 实际三端专项 | [3P/0F/0S/0flaky](../../tests/v25/.results/b73/hosts-focused-result.json)，Playwright 24.907 秒；[命令](../../tests/v25/.results/b73/hosts-focused-summary.json) | PC Web、移动 Web 和真实 Electron 各一项，实际 HTTP/PG 或 preload/IPC/SQLite |
| 完整 E2E | **476P/0F/7S/0flaky**，Playwright2681.855秒；[命令](../../tests/v25/.results/b73/e2e-full-summary.json)、[逐项结果](../../tests/v25/.results/b73/e2e-full-result.json) | 实际开启数据库条件，PC Web153P/2S、Mobile Web152P/3S、Electron171P/2S；本轮新增三端场景全部实际通过 |
| 本轮归档扫描及验收 | 45份实际ZIP、17份故意坏输入、2份明确UI文本替身；[分类与hash](../../tests/v25/.results/b73/e2e-full-archive-inventory.json)、[扫描](../../tests/v25/.results/b73/e2e-full-archive-security.json)零命中/错误 | 45ZIP与2文本替身分别扫描；17坏输入按既定拒绝场景保留，不伪装为合法安全包。[七项原范围核对](../../tests/v25/.results/b73/acceptance.json)通过 |

前三组修后专项在本轮中间快照执行；其后测试代码补类型、外部 owner 场景及宿主测试，最终统一检查覆盖当前实现。当前 API52、build、源码扫描与真实三端专项均对应上述 `cb081ade…`。不同运行的测试数不可相加作为唯一总量。

首次统一检查分别发现新 RTL 测试误用 `exact` 选项、链式调用格式、查询输入 `number|string` 类型处理，以及原 Desktop 方案夹具缺少已要求的 `expectedVersion`。已修测试并通过最终 check；最后一项只补夹具的现有版本字段，未改方案生产逻辑。原失败日志 [check](../../tests/v25/.results/b73/check.log)、[check-fixed](../../tests/v25/.results/b73/check-fixed.log)、[check-final](../../tests/v25/.results/b73/check-final.log)保留，未删除正式测试或放宽排除规则。

### 真实宿主证据与限制

专项[原始报告附件](../../tests/v25/.results/b73/hosts-focused-report.json)记录：

- PC／移动 Web 各创建 35 条已删和更新的 31 条正常记录；正常第一页全部为活跃记录。实际中断下一页请求两次后重试恢复，恢复 1 条、清空其余 34 条，最终保留 32 条正常记录。
- Electron 通过实际 IPC 创建 1001 条正常及 501 条已删记录，以最多 100 条每页遍历完整集合；恢复 1 条并清空剩余 500 条。PID 从 18017 变为 18026，同 userData 重读保留全部 1001 条正常 cohort，回收站为零。
- 已人工查看专项保存的移动 Web 与 Electron 确认框截图：全部清空范围及筛选隐藏说明完整可读，危险动作和取消按钮可见。截图是确认框区域，不能据此宣称所有页面、系统窗口或全平台视觉已验收。

本轮 Web 使用实际本地 Hono/Better Auth/PG 与受控外部服务；Electron 使用自有临时 userData，不读正式用户数据库、不调用付费 Provider。Chromium 移动视口不替代 Safari／移动系统文件选择器；本地 offset 分页证明静态集合完整性，不承诺任意外部并发重排下的数据库快照一致性。

### 原范围验收与保留条件

完整E2E已结束并完成原B73 boundary/verify逐项核对，仅关闭本卡。7项skip包括三宿主真实登录（缺实网测试开关/密码）、Electron真实中转key，共4项外部凭据条件；另3项是抽屉/侧栏/断点测试在不适用视口跳过，实际场景在对应项目执行，不能写成7项都缺凭据。保留跨宿主完整排序 parity、Folder/Tag/Session、retention、GC、费用、真实旧库、原生交付和正式发布的原范围。管理员在全部 v2.5 迁移完成后启动。

完整回归的附件再次核验两种Web各31live/35trash→恢复1/清空34/保留32；Electron新PID22475→22482，1001条正常cohort保留、恢复记录正常、回收站0。PC确认框实际截图另已查看，文案及两个动作完整可读。该证据与专项18017→18026分开保留，均不替代Windows/macOS安装包或原生移动验收。

## 5.73 B74：Desktop分类事务与同步意图（已验收，保留阶段记录）

2026-09-13：B73验收后已正式接入core分类事务仓库、Prompt索引刷新入口与薄IPC适配，新增core11项和IPC3项就地回归。当前1624项源码 `88d31b6526d8b85256a92068dc4cb220db7ec118d9dc7e8d62542aed64d9ff35`，与B73相比新增3个文件、修改2个文件；尚未改API/schema/费用。

| 阶段 | 实际结果 | 范围 |
|---|---|---|
| 原实现复现与草稿 | 见[生命周期§6](./V25-DATA-LIFECYCLE.md) | 原DDL/实际IPC缺陷、两版隔离草稿及11项草稿Vitest分别保存，不改标为正式产品全量结果 |
| 正式本机专项 | [56P/0F/0S](../../tests/v25/.results/b74/taxonomy-focused-vitest.json)，2.845秒；[命令](../../tests/v25/.results/b74/taxonomy-focused-summary.json) | 新core11/IPC3、既有分页/空间/清空与同步repository/engine回归；包含原云版本7墓碑、已删Prompt原mutationId不变及子文件夹待发create摘除父关联 |
| 当前统一检查 | [check36/36](../../tests/v25/.results/b74/check-summary.json)，47.017秒 | 当前源码lint、类型、单测、双端build、边界通过；普通DB条件skip不当实际API集成通过 |
| 产品/远端合流 | **未执行，未验收** | 尚需明确build、真实Electron新PID与两个独立客户端/API/PG、交互和适用完整回归、源码及本轮归档扫描 |

接入后复核发现分类删除按钮直接调用mutation，缺少UI-SPEC §8 I3要求的不可逆动作AlertDialog。按原B74 verify的确认/取消/失败/刷新出口补共享交互及就地测试；此后必须再跑当前源码check和完整E2E，不以本阶段56P/check代替。当前云端分类仍是soft-delete，原D01云硬删/持久删除标记/旧restore与Session继续，B74及完整v2.5均未关闭。

### 5.73.1 共享删除确认与真实同步合流（2026-09-13 阶段记录，最终验收见 §5.73.2）

最新源码为 1627 项 `3c3957749f1a827fa3ee6f9ff2a6ccf550c376b4f35087b2d0509c6c7e290ad3`，以 [源码清单](../../tests/v25/.results/b74/source-files.json) 为准。上表 `88d31b65…` 是首次 core/IPC 接入的历史检查点。本阶段已经补上删除确认和真实双客户端验证，不能继续将它们标为“未实现”；本节保留当时全量回归前的进展，最终通过结果见 §5.73.2。

实际改动：

- `TaxonomyManager` 的桌面 Popover、移动 Sheet 共用 AlertDialog，说明删除分类会保留提示词与子文件夹。取消/Escape 不发删除请求；请求期间禁止重复确认及关闭；失败提示并保留目标、输入和重试入口。成功后的列表刷新独立进行，刷新挂起不使已提交的删除一直等待。创建失败亦保留名称并提示错误，Enter 遵守请求期间的禁用状态。
- 快速取消、重开后，原 Radix 层注册/退出时序会使 Escape 偶发关闭整个管理面板。除内层处理外，外层也根据当前确认状态处理关闭；保留原焦点返回断言，没有通过等待固定时间或放宽断言隐藏问题。
- 实际双客户端发现三条本机提示词的“自身冲突”：分类删除先发送，云端 detach 将原版本 1 递增到 2/3，随后相关本机变更因旧 baseVersion 被拒绝。现在 `listReadyMutations` 依据已知云快照的引用，等待相关待发变更收到回执后才放行分类墓碑；检查包含退避和失败的相关 outbox，不仅是当前 ready/limit 切片。无关记录、其他 owner/workspace 的相同 ID 不阻塞删除，原 CAS 与显式冲突处理继续保留。

| 阶段 | 实际结果及证据 | 解释与范围 |
|---|---|---|
| 组件原行为 | [0P/16F](../../tests/v25/.results/b74/taxonomy-ui-red-vitest.json) | 缺确认框、错误提示及创建防重复；不是测试环境初始化失败 |
| 组件修复 | [16P/0F](../../tests/v25/.results/b74/taxonomy-ui-first-vitest.json)；最新统一检查再次覆盖这 16 项 | Popover/Sheet 的取消、Escape/焦点、重复点击、失败保留与重试、刷新挂起、新建失败 |
| 第一次真实宿主 | [1P/2F](../../tests/v25/.results/b74/taxonomy-host-first-result.json) | PC 通过；移动 Escape 关闭了外层；桌面错误提示定位器匹配多条 toast。定位器改为错误类型，产品错误文本仍使用真实信封的“主进程处理失败” |
| 时序修复复核 | [第二轮 2P/1F](../../tests/v25/.results/b74/taxonomy-host-second-result.json)、[第三轮 0P/3F](../../tests/v25/.results/b74/taxonomy-host-third-result.json)、[第四轮 6P/3F](../../tests/v25/.results/b74/taxonomy-host-fourth-result.json) | 第三轮暴露仍间歇出现的 Escape 问题；外层保护后 PC/移动各连续三次通过。桌面早期错误还包括将另一客户端延迟请求算入暂停计数、误用首次开启按钮、未等恢复提交就发后续 IPC；均按实际 UI/调度语义修测试，原数据断言不变 |
| 实际自身冲突 | [首次完整冲突](../../tests/v25/.results/b74/taxonomy-host-fifth-result.json)、[再次诊断及持久冲突记录](../../tests/v25/.results/b74/taxonomy-host-diagnosis-result.json)均 0P/1F | 自有 SQLite 冲突表、真实 API/PG 与原 baseVersion 证明三条提示词正文未竞争修改，而分类 detach 提升版本；记录保留在各报告对应的 `two-client-taxonomy.json` 附件 |
| 发送依赖原行为 | [21P/3F](../../tests/v25/.results/b74/taxonomy-order-red-vitest.json) | ready、backoff、error 三种相关变更未确认时，旧实现都过早放行墓碑 |
| 发送依赖修复 | [45P/0F/0S](../../tests/v25/.results/b74/taxonomy-order-final-vitest.json)，1.774 秒 | core 分类、IPC、sync repository/engine；新增 5 项依赖/隔离回归。此专项对应 `c0a3061e…`；其后仅给新测试回执补齐必需 version 字段，最终统一检查覆盖同组测试 |
| 中途检查失败 | [check-order 退出 1](../../tests/v25/.results/b74/check-order-summary.json) | 新单测回执漏填契约必需的 `version`；补齐类型字段后重跑，没有删除断言。旧 IPC 单测将“持久排队”误当“立即可发送”，现分别核对持久墓碑、原 mutationId，以及相关删除确认后的可发送状态 |
| 最新统一检查 | [check 36/36](../../tests/v25/.results/b74/check-order-typed-summary.json)，44.056 秒 | 根 2566P/29S、features 740P；根及 API/worker 的条件 skip 不等于真实数据库集成通过 |
| 最新明确构建 | [build 退出 0](../../tests/v25/.results/b74/build-order-summary.json)，3.541 秒 | 真实 Electron 专项之前重新构建当前主进程及渲染产物 |
| 最新实际双客户端 | [1P/0F/0S/0 flaky](../../tests/v25/.results/b74/taxonomy-host-order-result.json)，Playwright 15.316 秒 | 两个独立 Electron 进程/userData/deviceId，同 owner、真实生产 API bin/Better Auth/PG。另一个客户端 PID 34066→34077；双方 outbox 和未解决冲突均为 0，完整性检查通过，云端持久回执 16 条。所有自有进程正常清理 |
| 最新源码扫描 | [0 findings / 0 errors](../../tests/v25/.results/b74/source-security-final.json)，0.677 秒 | 当前源码扫描；不替代安装包、全量 E2E 新归档或生产扫描 |
| 完整三端 E2E | **已通过，最终结果见 §5.73.2** | 同源码479P/7S/0F/0 flaky；本轮报告与归档已保存，源码及实际归档扫描通过；B73旧结果仍独立保留 |

实际双客户端用例覆盖：分类及三层文件夹的创建、另一客户端改名与 FTS 更新；暂停期间创建后删除压缩；已有 Prompt delete 的 mutationId 保留；文件夹确认/取消；自有 SQLite DELETE 触发器注入一次存储失败、真实事务回滚与 UI 明确重试；恢复同步后直接子文件夹摘除 parent、孙级仍归原子级、正常/已删 Prompt 均保留正确状态；删除旧标签后旧词不再命中，而其他标签与正文仍可检索；新 PID 再同步后事实不变。触发器仅作用于本测试自有数据库，账号上游为受控服务，未触碰正式用户库或真实付费生成。

浏览器用例通过实际鉴权 API 创建分类与关联，注入一次 DELETE 网络失败；取消/Escape 发送 0 次、失败保留原分类/输入、明确重试成功后子文件夹与正文保留，刷新仍成立。当前云分类仍 soft-delete；完整 D01 云端硬删除/持久墓碑/旧 restore、Session、保留期、GC、费用及正式发布继续开放。B74 和完整 v2.5 均未勾选，管理员尚未开始。

### 5.73.2 B74 原范围最终验收（2026-09-13）

B74 已按原 boundary/verify 的 11 项对照验收，只关闭本卡。[逐项审核及证据](../../tests/v25/.results/b74/acceptance.json)绑定当前 1627 项源码 `3c3957749f1a827fa3ee6f9ff2a6ccf550c376b4f35087b2d0509c6c7e290ad3`；与 B73 相比 12 个生产/测试文件发生变化。最终源摘要复核无差异，未修改 schema、当前云端 soft-delete、冻结面或费用。

| 最终门禁 | 实际结果 | 证据 |
|---|---|---|
| 统一检查 / 明确构建 | check36/36、build退出0 | 上节当前源码命令及日志；包含core11、IPC3、sync repository25和共享组件16项回归 |
| 完整三端 E2E | 479P / 0F / 7S / 0 flaky，486项；Playwright2722.881秒，包装命令2730.874秒 | [报告汇总](../../tests/v25/.results/b74/e2e-full-result.json)、[命令](../../tests/v25/.results/b74/e2e-full-summary.json)；PC154P/2S、移动153P/3S、Electron172P/2S |
| 跳过项审核 | 外部凭据条件4项、视口不适用3项 | 上述报告保存每项名称/位置/原因；未执行的真实外部账号/中转key仍为正式交付条件，不能算通过 |
| 源码扫描 | 0命中/0错误 | [当前源码报告](../../tests/v25/.results/b74/source-security-final.json) |
| 本轮归档扫描 | 45份实际ZIP + 2份明确UI文本替身，共47目标，0命中/0错误；另17份故意无效输入 | [逐文件分类](../../tests/v25/.results/b74/e2e-full-archive-inventory.json)、[扫描](../../tests/v25/.results/b74/e2e-full-archive-security.json)，19.946秒；不把64份文件全部称为合法方案包 |

完整回归中的分类专项三形态均首跑通过。桌面两独立设备ID、API/Better Auth/PG与新PID39848→39859再次验证：直接子级摘除parent、孙级关联保留、正常/已删Prompt与其余标签/正文搜索正确；两边outbox、未解决冲突及FK异常均为空，SQLite integrity为ok，自有进程全部清理。两种Web各验证1次失败、3次删除尝试（失败1+成功2）、取消/Escape零请求、保留未提交输入和正文、刷新后子级可见。当前三张确认框截图已打开复核，标题/不可恢复说明/保留关联说明及确认、取消按钮均完整可读；这是实际对话框截图审核，不外推为原生平台视觉验收。

首次失败、修复过程、协议/存储故障注入及各阶段源码归属仍保留在 §5.73.1。继续 B75 云端硬删除/持久删除身份/旧restore与离线冲突消费者；Session、完整retention/GC/费用、真实旧库、原生四端、各平台包、生产回滚和远程MCP均保持原范围，完整v2.5及管理员前置尚未完成。

## 5.74 B75 准备：云端删除、日志过期及引用竞争诊断

2026-09-13：B74 完整回归的同一源码 `3c395774…` 下执行两个隔离诊断命令，均退出 0；**退出 0 表示成功复现缺口，不表示永久删除已开发通过**。原始命令、输入脚本和输出的 SHA-256、执行时间及生产源码归属见[证据清单](../../tests/v25/.results/b75/diagnostic-evidence.json)。生产源码/迁移均未修改，所有自有数据库/容器已关闭。

| 诊断 | 实际结果 | 证据与限制 |
|---|---|---|
| 当前删除/恢复与朴素硬删反例 | 当前主表仍保留 Folder/Tag 且可恢复；将已摘除关联的目标行直接 SQL 删除后，真实 retention 用显式 now+91 天移除 13 条日志、2 条回执；真实 DesktopSyncEngine 经游标过期和重建后仍留分类，原创建重放均 applied | [最终结果](../../tests/v25/.results/b75/cloud-delete-repro.json)、[日志](../../tests/v25/.results/b75/cloud-delete-repro.log)。最后的 SQL 是反例，非产品路径；91 天非自然等待；同步输入/输出经当前 contracts 校验，设备为合法 UUID，适配器直调服务，不覆盖 HTTP/鉴权 |
| 父级删除与新引用竞争 | Prompt 和子 Folder 的真实校验完成后，先提交父级删除，再放行创建；两者都留下指向已删父级的持久引用 | [两种实际结果](../../tests/v25/.results/b75/cloud-reference-race.json)、[日志](../../tests/v25/.results/b75/cloud-reference-race.log)。自有真实 PG17/迁移/PromptService；通过真实 requireFolder 后的测试屏障控制事务，不是操作系统暂停，不含模拟物理删除 |

第一个诊断的[首次结果](../../tests/v25/.results/b75/cloud-delete-repro-first.json)使用直调服务允许但 wire schema 不接受的非 UUID deviceId，故额外保留原脚本/日志并用合法 UUID、请求/响应契约校验重跑。最终输出重复确认相同缺口；不能将首次直调结果描述为实际 HTTP 合同已验。

这两组证据固定了后续实现边界：最小持久删除身份、兼容分页 bootstrap、过期后的重放拒绝、分类 restore 退役、引用与删除事务协调，以及 Desktop 冲突消费者。详尽拆分及 B75.1–6 验收见[生命周期§8](./V25-DATA-LIFECYCLE.md)。本阶段未运行 B75 产品单测、实际 HTTP/Electron 联合或迁移门禁，均保持待验；B74 完整回归仍单独运行，不将这两项诊断计入其通过数。

### 5.74.1 B75 首轮正式服务与数据库实现（2026-09-13，整卡未验收）

B74 已结束并按 §5.73.2 验收后，B75 首组测试及生产实现正式接入。当前 1632 项源码 `3bb1383943992d71424dba30b6ea78469147b0a872ca77518456e8dad2518f6c`，以[该阶段源码清单](../../tests/v25/.results/b75/source-backend-before-consumer.json)与[实施检查点](../../tests/v25/.results/b75/implementation-checkpoint.json)为准；不能再将 §5.74 的旧 service 诊断称为当前新删除路径。

已接入最小 `sync_taxonomy_tombstones` 表及新增迁移0023。Folder/Tag 新删除事务先协调引用写入，摘除关联、记录最终版本和删除身份、物理删除实体并追加变更日志；旧restore拒绝，已删除ID的新建返回显式版本冲突。文件夹结构写按owner协调，引用读取持KEY SHARE；删除分类先锁目标，标签摘除前先按ID锁Prompt行，与purge顺序对齐。bootstrap在原快照事务中合并实体和删除身份ID分页，使用旧合同可解析的删除投影；持久表不保留名称、父级、分组、颜色或完整JSON。**既有软删数据批量回填、离线长期联合、桌面冲突消费者和整卡门禁仍待完成。**

| 阶段 | 实际结果 | 源码与范围 |
|---|---|---|
| 正式回归验证旧行为 | [0P/9F/0S](../../tests/v25/.results/b75/classification-red-vitest.json)，[命令](../../tests/v25/.results/b75/classification-red-summary.json) | `cb739dbc…`只加测试；3项主表物理删除断言、2项restore拒绝、4项真实事务阻塞/引用顺序失败，非环境故障 |
| 首轮修复 | [27P/0F/0S](../../tests/v25/.results/b75/classification-first-vitest.json)，5.875秒 | `fe9e7e16…`；新增9、原版本冲突12、原Prompt purge6。之后仅格式化生成JSON和补新测试类型 |
| 中途统一检查 | 首次格式失败；第二次类型失败 | [格式检查失败](../../tests/v25/.results/b75/check-first-summary.json)：Drizzle新snapshot/journal需Biome格式化；[类型失败](../../tests/v25/.results/b75/check-formatted-summary.json)：新测试默认UUID推导过窄及Promise联合推导。均修正确切问题，未删除断言 |
| 当前统一检查 | [check36/36通过](../../tests/v25/.results/b75/check-typed-summary.json)，33.120秒 | 当前源码；根2566P/29S，features740P，普通API/worker条件skip不计真实集成 |
| 当前实际API专项 | [27P/0F/0S](../../tests/v25/.results/b75/api-current-vitest.json)，[命令](../../tests/v25/.results/b75/api-current-summary.json)，8.150秒 | 自有PG17，9项新分类服务+12版本冲突+6 purge；不是完整API集成或HTTP/浏览器联合 |
| 当前worker数据库集成 | [98P/2S/0F](../../tests/v25/.results/b75/worker-current.log)，[命令](../../tests/v25/.results/b75/worker-current-summary.json)，35.408秒 | 2项container-runtime需额外RUN_WORKER_CONTAINER_TESTS=true，本轮未启用；不继承B69旧源码容器结果，也不将普通维护回归当作删除身份90天保留已验 |
| 根迁移命令 | 隔离新PG中 `pnpm run db:migrate` 首次和重复均退出0；累计24条迁移，新表6列准确 | [实际迁移结果](../../tests/v25/.results/b75/db-migrate-cli.json)；自有容器已关闭。证明fresh/repeat，不证明既有软删回填、中间前缀或生产回滚 |
| 当前源码扫描 | [0命中/0错误](../../tests/v25/.results/b75/source-security.json)，1.609秒 | 不替代后续实际方案包或发布产物扫描 |

后续按生命周期§8.2完成旧数据迁移和失败回滚、持久删除身份的隔离/重放/分页矩阵、标签/维护并发、真实90天裁剪后的双客户端及新PID验证、Desktop core与共享冲突UI，最后完整API/宿主回归与实际归档扫描。B75及其父卡保持未勾选；B74的479P属于`3c395774…`，不能标为当前B75完整E2E。


### 5.74.2 B75 桌面永久删除冲突消费者（2026-09-13）

消费者阶段源码为1634项`01465b7185568f78d28a590c30074883ee13f92f9ac08cd1afc9e91a4fe5759b`，[不可变源码清单](../../tests/v25/.results/b75/source-consumer-verified.json)与[分层检查点](../../tests/v25/.results/b75/consumer-checkpoint.json)保存实际范围。后续回填工具的源码增量不冒用本节完整检查结果。

contracts提供从现有冲突类型/删除时间推导的共享规则，没有扩展wire字段。Desktop core在修改outbox、实体或冲突前拒绝已删除Folder/Tag的local决议，抛出明确类型错误，IPC映射为VALIDATION_FAILED。共享CloudSyncPanel禁用保留本地并说明正文保留，仍允许明确采用云端；未删分类的local更新与Prompt软删恢复/副本保持原规则。

| 层级 | 实际结果 | 范围与证据 |
|---|---|---|
| 旧行为复现 | core/IPC52P、3F；组件43P、2F | [数据层首次失败](../../tests/v25/.results/b75/consumer-core-red-vitest.json)、[组件首次失败](../../tests/v25/.results/b75/consumer-ui-red-vitest.json)：原实现接受已删除分类的local决议，按钮仍可点击 |
| 定向修复 | core/IPC/规则61P、组件45P，均0F/0S | [core与IPC](../../tests/v25/.results/b75/consumer-core-fixed-vitest.json)、[共享组件](../../tests/v25/.results/b75/consumer-ui-fixed-vitest.json)属0806113f阶段；之后规则测试改用完整schema解析快照，生产消费者未变 |
| 最终统一检查与构建 | check36/36；根2579P/29条件S，features742P；明确build退出0 | [check](../../tests/v25/.results/b75/consumer-check-isolated-summary.json)、[build](../../tests/v25/.results/b75/consumer-build-summary.json)。普通API/worker条件skip不作实际数据库验收 |
| 实际桌面联合 | 2P/0F/0S/0flaky，28.428秒 | [保留报告与逐项结果](../../tests/v25/.results/b75/consumer-electron-selected-result.json)：新永久删除冲突与原B74分类/FTS/双客户端回归；不是完整Electron或全部三形态 |
| 源码扫描 | 0命中/0错误 | [本阶段源码扫描](../../tests/v25/.results/b75/consumer-source-security.json)，0.662秒；本专项没有生成方案包，不虚报归档或安装包扫描 |

新场景使用两个独立Electron进程、userData及deviceId，实际生产API bin、Better Auth、PG；仅账号上游受控，没有向客户端注入伪造冲突。B暂停同步后改名，A删除同一Folder/Tag并提交，PG主表物理为空、两个删除身份版本为2。B重连得到实际冲突，暂停并以新PID48276→48283重启后冲突逐字段保持；界面禁用local，直接IPC调用同样拒绝，outbox与本机事实不变、暂停期间没有新增sync请求。采用remote后分类清空、正文保留、重新同步无冲突/待发送；两边完整性与外键检查通过。两个实际冲突行截图已打开复核，说明和禁用动作完整可读；这不是完整窗口或所有原生平台的视觉验收。自有客户端、API和容器全部正常清理。

保留中途失败：新IPC测试遗漏transportFactory解构、组件断言误用对象参数（实际gateway为两个位置参数）、规则测试缺完整快照类型，均按真实接口修正；首个Playwright命令被可变长project参数吞掉文件筛选，未启动测试，改为文件筛选在前后重跑。全仓检查还发现旧D03测试使用固定临时目录，先前中断遗留备份会污染“一次备份”断言；改为每次mkdtemp独立目录，新增相同标签/残留备份隔离与固定语料hash回归。原备份数量、内容保留、失败回滚及完整性断言保持。

B75整卡仍开放：继续旧软删回填/迁移、90天裁剪后离线重放、多页bootstrap、owner/版本/事务竞争矩阵和全部宿主/数据库门禁；本节两项桌面专项不替代原B75.1–6逐项审核。


### 5.74.3 B75 历史软删分批回填与迁移前缀（2026-09-13）

新增taxonomy-backfill服务与实际CLI，复用正式删除事务；具体运行参数、兼容写入者部署前置、计数和逐分类回滚边界见[数据迁移§31.1](./V25-DATA-MIGRATION.md)。源码为1637项`9ebbe22cdd0b55e82b8c97683dba0eaa3b5586ac0e561a02a260cd48f5ade913`；没有新增schema迁移或修改旧SQL。与§5.74.2相比，新增工具及测试、API脚本入口，并完善已有迁移回滚测试；桌面消费者生产代码未变。

[当前真实API/PG专项](../../tests/v25/.results/b75/backfill-final-vitest.json) **51P/0F/0S**，[命令](../../tests/v25/.results/b75/backfill-final-summary.json)14.718秒：分类删除9、fresh迁移重放1、历史前缀/回滚34、回填7。不是全部API集成；新CLI由测试实际启动三个独立进程执行preview/apply/repeat，不是直接函数调用冒充命令行。

- 回填7项：预览零写入、limit=1分批、重复执行无变化；三层Folder与正常/软删Prompt正文及其他标签保留；分类原删除时间/最终版本保留、引用方版本递增、同步日志正确；后一个分类插入标记故障时本分类关联/日志全回滚，前一个分类已提交，重跑处理剩余；已有实体/标记同时存在与两种跨owner异常引用原子拒绝；实际旧写者事务在候选选出后恢复live，回填真实阻塞并在获锁后跳过；实际CLI预览/apply/重跑且输出不含名称/连接串。旧写者用例只证明锁后防御，不代表支持混合部署。
- [历史前缀逐项证据](../../tests/v25/.results/b75/backfill-prefix-final/pg-upgrade-HWQHOm/results.json)34项：24个历史前缀升级保持schema、Drizzle精确SQL hash与原始数据；既有回执和Agent时间回填；前缀1/23保留历史软删Folder/Tag与引用，先expand再分批清理，两次运行保留正文、另一owner的已删Prompt、最终版本及迁移账本；前缀1/11/22/23实际DDL错误后全部待执行迁移回滚，再次升级成功。

首次失败没有删除：初次新工具使用了桌面可用、API合同不含的CONFLICT错误码，改为既有VALIDATION_FAILED配409；旧前缀测试的故障仅注入0022索引，新增0023后的最新前缀已不经过该索引，导致未实际触发错误。保留原1/11/22测试并新增23，以新表ALTER外键作为当前晚期故障，验证创建表也被回滚。之后一次CLI测试在同时跑全仓构建时超过默认5秒，保存50P/1F结果，给三个子进程测试明确30秒总时限和每进程8秒超时，最终51项通过；没有增加重试或删除断言。

本节不证明90天记录裁剪后的同步重放、完整多页bootstrap、所有owner/事务竞争、实际生产数据及混合部署。B75.1–6仍按原范围联合审核，完整API/worker/E2E和本轮实际归档扫描尚待；§5.74.2的桌面2P与§5.73.2的全量479P各自保留源码归属。


本回填阶段最终[check](../../tests/v25/.results/b75/backfill-check-final-summary.json)退出0（36/36，17.979秒），[源码扫描](../../tests/v25/.results/b75/backfill-source-security.json)0命中/0错误（1.345秒），源码复核无漂移。[不可变清单](../../tests/v25/.results/b75/source-backfill-verified.json)及[最终阶段检查点](../../tests/v25/.results/b75/backfill-checkpoint.json)分别保存当前来源和仍缺的原范围证据；不将本阶段51P/检查通过写成整卡验收。

### 5.74.4 B75 长期离线、原请求重放与事务竞争（2026-09-13）

本阶段补齐正式回归和隔离跨进程夹具，生产服务行为沿用§5.74.1–3；没有新增用户功能、迁移SQL或管理员接口。以下各轮源码分开登记，完整联合门禁尚未据此通过。

| 验证轮次与源码 | 实际结果 | 覆盖及边界 |
|---|---|---|
| 保留期 HTTP，`ea0c6711…` | [3P/0F/0S](../../tests/v25/.results/b75/retention-http-current-vitest.json)，18.321秒 | 实际API bin/Better Auth/PG，独立Node进程执行正式worker裁剪函数；Folder/Tag原创建回执重放与指纹不变、过期后原/新mutation不能复活、另一owner同ID保持隔离；每类205个live/marker混合实体按37条分6页，无漏重 |
| worker边界，`ea0c6711…` | [9P/0F/0S](../../tests/v25/.results/b75/retention-worker-vitest.json)，4.238秒 | 新增真实PG精确90天边界，连同既有保留期集成/纯函数回归；cutoff前1ms、恰好cutoff、后1ms及重复维护，水位不回退；跨owner/type同ID的六字段最小标记不变化 |
| 双桌面，`ea0c6711…` | [4P/0F/0S/0 flaky](../../tests/v25/.results/b75/retention-electron-result.json)，53.487秒 | 两种流程各含保留/过期日志：无本机待发修改的旧客户端重新bootstrap清理分类；有离线编辑的客户端形成冲突、真实新PID保留、拒绝local恢复并采用云端。Prompt正文、软删状态、子级和FTS保留 |
| 扩展事务及HTTP，`dc5d9bb5…` | [44P/0F/0S](../../tests/v25/.results/b75/classification-matrix-final-vitest.json)，29.272秒 | 分类事务41、上述HTTP3；具体矩阵见下文。该源码[check](../../tests/v25/.results/b75/matrix-check-final-summary.json)36/36通过，21.747秒 |

保留期时钟是明确传入的测试参数：HTTP/桌面用维护时间推进91天，认证和API仍使用实际当前时间；边界测试传入固定now及±1ms。不是自然等待90/91天，也不是调度器或正式worker-bin已经连续运行91天。跨进程执行的是正式维护函数，调度入口/镜像另外验收。日志和回执裁剪后，旧游标返回实际HTTP410；桌面显示错误并重置bootstrap状态，用户点击“立即同步”后完成重取，测试没有把它写成自动无感重连。

过期冲突轮记录API PID52757、维护PID52777、桌面重启52767→52778，清理6条日志/6条回执，2条持久标记保留；干净离线轮清理18条日志/16条回执，2条标记保留。实际截图已复核：删除标记不显示原名称，“保留本地”禁用，说明明确正文保留。各轮原始API请求、数据库状态、独立device/userData与资源清理状态在[归档目录](../../tests/v25/.results/b75/retention-electron-artifacts)；认证令牌未写入报告。[不可变源码](../../tests/v25/.results/b75/source-retention-verified.json)为1641项。

分类事务41项包含原9项，再补：

- Folder/Tag各自陈旧版本、已删update、重复delete。原版本冲突不写入；不带版本或带最终版本的重复删除返回同一身份/最终版本且不追加日志。
- 每类四个实际SQL触发器故障点：关联摘除后、最小标记插入后、主表删除后、最终日志插入后。不可回滚序列证明命中故障点，七张相关表逐行比较证明事务回滚；移除触发器后重跑成功。测试仅安装在自有临时PG。
- 标签create/update引用分别先提交和删除先提交；Prompt/Folder移动到父分类的两种提交顺序。用pg_blocking_pids证明真实锁等待，获锁后拒绝已删除引用；保留其他标签和完整正文。
- Folder/Tag × 单条purge/清空回收站 × 两种提交顺序，共8项；无死锁或读取已消失Prompt的假快照，最终日志版本/数量准确。
- Folder/Tag × worker先提交/分类删除先提交，共4项；独立Node进程执行正式purgeExpiredSoftDeletedPrompts，实际PG事务屏障固定交错次序，存活Prompt保留，过期Prompt清理及分类最小标记均提交。维护使用固定时钟，不代表正式定时器调度。
- 两类实体在live/永久删除后，对另一owner的读取、修改、删除均404且无写入；bootstrap不泄漏。与HTTP同ID重用测试互补。

首败保留：[首轮31项](../../tests/v25/.results/b75/classification-matrix-first-vitest.json)23P/8F，8项均为测试直接使用pg读取bigint版本得到字符串、却与number比较；改测试SELECT显式整数投影，生产代码未因该失败修改。随后35事务+3HTTP全部通过，但[check](../../tests/v25/.results/b75/matrix-check-current-summary.json)发现测试observe泛型不能推断Folder/Tag的Promise联合，改为unknown观察结果；扩展owner和移动引用后最终44项及check通过。没有增加重试或删除断言。

当前联合源码为1641项`028416184b94ab13eb355fdcd5b2fdb0845a1e0cb85cca75ef26b382e7e97554`：相对dc5d9bb5仅补现有真实PC/移动分类页面测试中的永久删除投影与includeDeleted列表断言，并纠正其历史soft-delete证据说明。已启动当前API完整集成、三形态分类专项及正式worker镜像构建/完整集成；完整E2E、当前扫描和原六项逐条审核还未完成，B75保持未勾选。后续终态追加于本节，不能将启动命令写成通过。

当前联合终态增量（同`02841618…`）：[三形态分类专项](../../tests/v25/.results/b75/taxonomy-hosts-current-result.json) **6P/0F/0S/0 flaky**（PC1、移动1、Electron4，116.878秒），PC/移动确认截图已复核；[check](../../tests/v25/.results/b75/check-current-summary.json)36/36通过（19.873秒），[源码扫描](../../tests/v25/.results/b75/source-security-current.json)0命中/0错误。[当前root db:migrate](../../tests/v25/.results/b75/db-migrate-current-cli.json)在新自有PG首次/重复均通过，24条迁移、6个最小标记字段，资源已关闭。没有对正式数据库执行迁移。

[正式worker镜像构建](../../tests/v25/.results/b75/container-build-current-summary.json)通过，镜像`musefold-worker-b75:local`为Linux arm64、非root用户musefold，ID `sha256:c6f092ed80d131258c6b3b494a27644e05699180c6de23ff4e641250830d9510`；[完整worker集成](../../tests/v25/.results/b75/worker-full-current-vitest.json) **101P/0F/0S**（95.330秒），明确开启RUN_WORKER_CONTAINER_TESTS并使用本次镜像，含实际容器正常退出和SIGKILL/新容器不重发两项。该证据属于本机正式镜像，不证明远端CI、其他架构或生产部署。

[阶段检查点](../../tests/v25/.results/b75/retention-matrix-checkpoint.json)保留所有首败、源码和完整范围剩余项。API完整集成和完整三形态E2E已经启动，后者包含当前明确Web/Desktop构建；必须等终态后归档、扫描实际新归档并逐条审核B75.1–6，不能使用旧B74的479P替代。B75与父卡继续开放。

完整E2E运行中首败（尚未终态）：PC Web 的`actual cloud modify cancel after dispatch cannot overwrite the formal version or resend`失败，报错为共享测试代理`package-exchange-browser.ts:21`的`route.fulfill: Route is already handled!`。[原始错误现场](../../tests/v25/.results/b75/e2e-first-route-failure.md)已单独保留，根因尚未证明；后续取消/鉴权/未知状态用例仍继续执行。本轮完整E2E不能判为通过，待终态归档后复现并修复，不能靠增加重试、吞掉路由异常或删除业务断言通过验收。

### 5.74.5 B75 完整回归首败、代理生命周期修正（2026-09-13）

`02841618…`的[完整API集成](../../tests/v25/.results/b75/api-full-current-vitest.json)已终态：**661P/0F/1S**，676.222秒。唯一跳过项为package-lifetime的独立一小时自然到期测试，本轮未启用；不得写成662项全通过。[本次历史前缀/回滚证据](../../tests/v25/.results/b75/api-full-current-prefix.json)34项全部通过，和本次实际API迁移测试相符。worker101P、镜像、root迁移及源码扫描见上一节。

[完整E2E首轮](../../tests/v25/.results/b75/e2e-full-current-result.json)在已知取消用例失败后，对核实属于本轮的Playwright PID57361发送SIGINT并等待终态：**115P/1F/373跳过或未执行**，489项总计，进程退出130。373项含中止后的未执行项，不能当作有意跳过，更不能据此宣称其他宿主已通过。原report/错误及已产生的归档均保留；[本轮13份实际ZIP和1份明确UI字节替身扫描](../../tests/v25/.results/b75/e2e-full-current-archive-scan.json)0命中/0错误。没有结束正式App或其他任务进程。

原取消场景在不改源码时，PC/移动各重复3次共[6P](../../tests/v25/.results/b75/route-cancel-repro-result.json)，带trace的结果已归档。这不足以消除偶发错误，故继续对共享测试代理的请求生命周期作受控验证。新增`web.exchange-transport.spec.ts`，使用自有HTTP上游和真实浏览器，分别验证状态码/二进制字节/Cookie、显式AbortController取消、页面导航取消及一次POST不重发。

[旧代理红测](../../tests/v25/.results/b75/route-lifetime-red-result.json)证明：浏览器abort后5秒，上游连接仍未关闭；测试清理自有socket后旧route.fetch又抛socket hang up。首项传输保真通过、取消失败、导航未执行，原始错误保留。原完整回归“Route is already handled”的具体瞬时顺序没有被此测试完整复现；确定修复的是浏览器请求已取消、代理独立fetch仍在等待响应的生命周期缺陷。

代理现在使用`route.continue`把原浏览器请求转发到实际API，取消/导航关闭同一上游连接，不再独立fetch再fulfill。没有catch-all、忽略错误、虚构响应、增加重试或修改业务断言。新传输测试[PC/移动6P/0F/0S](../../tests/v25/.results/b75/route-lifetime-green-result.json)通过：Cookie、201/206/409状态和二进制保留，abort/导航后服务端观察连接关闭，接收POST恰好一次，正常通过不需要测试主动释放上游。

修正源码为1642项`05cd8f1f4865be287f72dc648110c31cb8aab7a95f197c5946d927ba5a9dba5e`，[check](../../tests/v25/.results/b75/route-check-summary.json)36/36通过，[源码扫描](../../tests/v25/.results/b75/route-source-scan.json)0命中/0错误。[逐文件比较](../../tests/v25/.results/b75/route-source-comparison.json)确认相对02841618仅新增浏览器传输测试、修改共享浏览器测试代理；API/worker及全部生产源码与迁移未变，661P/101P仍按原源码归属引用。受影响方案修改/取消、分类和传输20项专项运行中；之后必须重新执行完整三形态E2E，当前不能关闭B75。

修正后[受影响联合专项](../../tests/v25/.results/b75/route-affected-result.json) **20P/0F/0S/0 flaky**，PC/移动各10项、119.653秒，含原修改取消/撤权/unknown/版本竞争、丢回包恢复及分类和传输。该轮[12份实际ZIP扫描](../../tests/v25/.results/b75/route-affected-archive-scan.json)0命中/0错误；此前重复诊断的[6份实际ZIP扫描](../../tests/v25/.results/b75/route-cancel-repro-archive-scan.json)也通过。完整三形态E2E以`e2e-full-route-fixed`启动，保持05cd8f1f源码冻结，仍需终态和全量产物扫描；20项专项不替代整包门禁。

等待完整回归期间只读核对后续Session，隔离PG已复现会话游标截断微秒导致漏项，同时验证归档恢复保持原archivedAt。源码未修改，诊断与后续出口见[生命周期§9](./V25-DATA-LIFECYCLE.md)。这属于下一阶段准备，不计作B75实现或Session修复通过。

完整回归期间的原范围核对：已将B75.1–6与实际迁移、API/Worker、core/IPC/UI和宿主结果建立[验收预核对记录](../../tests/v25/.results/b75/acceptance-preflight-review.json)，关联193条已通过断言及报告SHA256。此数包含原有相关回归，不是193项新测试，也不是本轮重新执行结果。逐文件比较确认消费者所用core/features/contracts/desktop路径自01465b71…以来未变；后端结果继续保留02841618…归属。已阅读UI禁用/零调用/remote采用、真实双客户端和新PID断言，以及迁移前缀/回填实际流程。预核对全部保持待最终门禁状态，不能据此勾选B75；完整E2E handle99154实查仍在运行并进入Electron阶段，终态、全部skip分类和该轮实际归档扫描仍待。

### 5.74.6 B75 最终验收（2026-09-13）

**仅关闭B75原范围。** [原六组逐条验收](../../tests/v25/.results/b75/acceptance.json)已核对：存储/迁移与旧行回填、事务引用及维护竞争、长期裁剪/重放/分页、core/IPC/UI消费者、真实双客户端及三形态、完整门禁和扫描。Session S01–S05、完整保留期/GC、费用、真实旧库/原生交付、远端CI/平台包/生产回滚/MCP及后续管理员仍按原范围接续。

当前1642项[不可变源码](../../tests/v25/.results/b75/source-route-fixed.json)为`05cd8f1f4865be287f72dc648110c31cb8aab7a95f197c5946d927ba5a9dba5e`，终态后逐文件核对零漂移。`e2e-full-route-fixed`进程99154于UTC05:39:24正常退出0，包含明确Next生产构建与Electron构建，命令总耗时2795.574秒。[完整E2E](../../tests/v25/.results/b75/e2e-full-route-fixed-result.json) **488P/7S/0F/0flaky**，共495项；每项最终执行状态仅passed或声明的skipped，没有中断或不明未执行。

| 实际项目 | 通过 | 跳过 | 说明 |
|---|---:|---:|---|
| PC Web | 157 | 2 | 活体账号凭据未启用；移动抽屉专用用例在移动项目通过 |
| Mobile Web | 156 | 3 | 活体账号凭据未启用；桌面侧栏与765/768断点专用用例均在桌面项目通过 |
| Electron | 175 | 2 | 活体账号凭据及真实图像中转Key未配置 |

四项真实外部凭据检查保留为正式交付条件，未调用真实付费上游；三项视口专用跳过逐一核对相同标题的另一项目为通过。六项分类宿主用例全部通过且无skip：PC/移动各一次实际确认/取消/失败重试；双Electron保留/过期日志的正常同步与离线编辑冲突各一次。

当前过期冲突轮桌面PID65417→65426，维护独立PID65425清6条日志/6条回执，保留2条最小标记；过期正常同步轮65477→65499，维护PID65496清18条日志/16条回执，保留2条标记。四轮均为不同device ID和userData的两个客户端，数据库integrity=ok、外键检查空，资源清理全部fulfilled。91天为明确推进的维护时钟，不代表自然等待。实际PC/移动确认与过期标签冲突截图已复核：删除不可恢复、子级/正文保留、local禁用及remote采用说明清楚；原始记录在[本轮归档目录](../../tests/v25/.results/b75/e2e-full-route-fixed-artifacts)。

[本轮实际归档扫描](../../tests/v25/.results/b75/e2e-full-route-fixed-archive-scan.json) **0命中/0错误**，20.012秒：64个文件副本中45份实际ZIP、2份明确UI字节替身接受扫描，17份故意无效输入按语料hash单列；不将副本数当作独立测试数。[清单](../../tests/v25/.results/b75/e2e-full-route-fixed-archive-inventory.json)保留路径、大小、hash及类别。源码扫描及check36/36见§5.74.5；API661P/1专用自然小时S、Worker101P/0S和24条根迁移fresh/repeat见§5.74.4–5，全部生产/API/Worker输入与当前的精确对应关系保留，不重写历史源码归属。

原先完整E2E的115P/1F后主动中止、373跳过或未执行，以及代理红测和各阶段首败继续保留，最终成功不覆盖失败证据。B75任务已勾选，父卡不勾；当前任务包84/91，剩余九个调度阶段不变。

## 5.75 B76 会话查询、写入与回收站（进行中）

本批来自原D01.1/2和会话parity，完整边界/验收为任务包B76与生命周期§9的S01–S05，不把查询切片等同完整Session功能。起点为B75已验的05cd8f1f…，没有重跑或改写其验收记录；本批新增执行卡后任务数为84/92。

### 5.75.1 严格查询与实际HTTP第一轮（2026-09-13）

先加入真实PG服务与实际IPC/完整初始化SQLite回归，在[1644项红测源码](../../tests/v25/.results/b76/source-query-red.json)`5b766090…`执行：[PG21项](../../tests/v25/.results/b76/api-query-red-vitest.json)11P/10F，[桌面17项](../../tests/v25/.results/b76/desktop-query-red-vitest.json)7P/10F。失败包括微秒边界遗漏、同时间多页因同一精度问题提前终止、前页删除漏掉中间行、deletedOnly被旧schema剥离、旧/畸形游标被接受或抛非稳定底层错误。部分场景共享根因，不按20个独立缺陷计数；原报告保留。

接入共享过滤/游标schema及严格编码、PG保留六位时间与C排序、core会话专用keyset和薄IPC后，[1647项源码](../../tests/v25/.results/b76/source-query-green.json)`375dc2f9…`的[PG21P/0F/0S](../../tests/v25/.results/b76/api-query-green-vitest.json)、[本地84P/0F/0S](../../tests/v25/.results/b76/local-query-green-vitest.json)通过，后者包括契约23、core7、会话IPC17及既有workbench域37。`pnpm run check`[退出0](../../tests/v25/.results/b76/query-check-summary.json)，55.249秒。没有SQLite/PG schema迁移；真实业务版本和写入事务仍待S02。

随后增加实际HTTP和客户端字段传输测试，生产源码未变：[API bin/Better Auth/PG查询及原PG联合22P/0F/0S](../../tests/v25/.results/b76/query-http-vitest.json)，6.069秒；[API client完整文件30P/0F/0S](../../tests/v25/.results/b76/query-client-vitest.json)，0.789秒。真实API PID68829与fixture PID68821分离，账号上游为受控fixture；验证回收站两页含已归档删除会话、有效筛选变化400、旧游标400、未登录401、跨owner404、恢复保留archivedAt、无生成记录。原始[HTTP证据目录](../../tests/v25/.results/b76/session-http-evidence)保留会话ID/分页与资源清理，未保存身份令牌。微秒和Unicode数据注入由服务层PG测试覆盖，不声称这一个HTTP用例另做了微秒注入。

当前`191d4fd0…`为1648项，新增HTTP/客户端测试后的统一检查继续。完整实际PC/mobile/Electron、会话写入/清理故障矩阵及最终全量门禁仍在B76原范围内；没有用B75的488P作为本批已通过的完整回归。

查询切片检查终态：[当前check36/36](../../tests/v25/.results/b76/query-check-final-summary.json)退出0，36.693秒；[源码扫描](../../tests/v25/.results/b76/query-source-scan.json)0命中/0错误。当前[不可变源码](../../tests/v25/.results/b76/source-query-verified.json)`191d4fd0a43a9601747c3bbac7910d2ed792b19a294b9af21db43f2447915558`，相对375dc2f9…仅新增实际HTTP测试和补客户端deletedOnly传输断言，生产输入未变。[阶段检查点](../../tests/v25/.results/b76/query-checkpoint.json)明确本批尚未验收，下一S02真实版本/事务；S03–S05继续。

### 5.75.2 真实版本、原子写入与进程竞争（2026-09-13，B76未验收）

SQLite增量0010给会话增加持久version，既有/新行默认1；经generate及bundle生成11份内联迁移，没有修改历史SQL或PG schema。core集中会话创建/草稿、组合修改、删除/恢复和旧草稿导入事务；旧rename/archive/softDelete递增业务版本，活动touch只单调更新排序时间。列表读事务保证版本/草稿一致。PG复用既有CAS并拒绝已删除行的编辑。共享UI与永久清理尚未实现，B76继续未勾选。

| 实际检查 | 结果与证据 | 证明范围 |
|---|---|---|
| Desktop写入正式红测 | [0P/10F](../../tests/v25/.results/b76/session-writes-red-vitest.json)，[源码85a0f198…](../../tests/v25/.results/b76/source-writes-red.json) | 旧合成版本、陈旧写入、非原子create/update、旧写者版本及状态要求；不是10个互不相关根因 |
| 第一次修后联合测试 | [70P/8F](../../tests/v25/.results/b76/session-writes-first-green-vitest.json) | 新写入10项已通过，但移除共享常量使旧Prompt引用发生ReferenceError；已把该固定回退限定为legacyPromptVersion，保持原语义。命令含一个不存在的workbench.test.ts过滤路径，因此不声称执行了该文件 |
| 迁移/旧草稿扩展首轮 | [95P/1F](../../tests/v25/.results/b76/session-writes-focused-vitest.json) | prefix2预期遗漏历史0002新增的prompt_id；核对SQL后显式纳入null默认，其余原字段仍精确等价，未放宽为部分匹配 |
| Desktop/core完整专项 | [97P/0F/0S](../../tests/v25/.results/b76/session-writes-process-vitest.json)，[源码5ac6a2b2…](../../tests/v25/.results/b76/source-writes-process.json) | IPC写入10、查询17、既有工作台37、core查询7、旧生命周期3、store5、原接管7、新迁移10、进程竞争1 |
| 两个OS进程和新PID | 包含于上述97项的workbench-session-process | 两个独立进程读version1；父连接持有真实BEGIN IMMEDIATE锁，两个进程报告开始写且均未返回，释放后仅一个version2成功、另一个稳定冲突；退出后第三PID读取胜者版本/标题/草稿。该案例不是Electron、不是正式用户库，也不证明进程崩溃中间时点 |
| PG已删除编辑红测 | [4P/1F](../../tests/v25/.results/b76/session-writes-api-red-vitest.json)，[源码16381038…](../../tests/v25/.results/b76/source-writes-api-red.json) | 当前版本仍可修改已删除行，真实PostgreSQL17复现；其余CAS/回滚/owner/恢复通过 |
| PG修后联合 | [27P/0F/0S](../../tests/v25/.results/b76/session-writes-api-green-vitest.json)，[源码b91307ae…](../../tests/v25/.results/b76/source-writes-api-green.json) | 写入5、原微秒/分页查询21、实际API bin/Better Auth/PG HTTP1；仅HTTP案例使用真实HTTP，其余为正式服务+真实PG，均为隔离环境 |
| 一致列表快照补验 | [IPC完整文件11P/0F/0S](../../tests/v25/.results/b76/session-writes-snapshot-vitest.json) | 新增另一真实SQLite连接在列表行查询之后、草稿查询之前保存；列表保留旧版本+旧草稿，下次get读新版本+新草稿。用prepare观察点控制交错，SQL和事务是真实的。11项包含先前10项，不与97重复相加 |
| 当前统一检查 | [check退出0](../../tests/v25/.results/b76/session-writes-check-verified-summary.json)，36/36、34.522秒 | lint、类型、单测、边界、双宿主构建与Web生产构建；不替代完整E2E/外部环境 |
| 当前源码扫描 | [0命中/0错误](../../tests/v25/.results/b76/session-writes-scan-verified.json) | 本轮源码；没有新增正式包/ZIP产物，不挪用B75产物扫描作为B76产物验收 |

迁移专项覆盖受管前缀2–10升级：Session原字段和草稿字节保留，作品字段/会话引用/实际费用保留、FK有效、重复迁移不重置已更新版本；另含新库默认值和草稿FK行为。旧草稿专项覆盖缺失补入一次、既有不覆盖、无会话忽略、整批中途失败回滚、12000字符/旧比例可读以及只改标题保留原草稿字节。进程竞争使用本轮已迁移库，不冒充真实v2.1用户库或安装包升级证据。

第一次[check退出1](../../tests/v25/.results/b76/session-writes-check-summary.json)来自生成的0010快照/迁移journal格式，已按Biome格式化；并行任务被终止，不计作产品测试全部通过。修后[5ac6a2b2…检查](../../tests/v25/.results/b76/session-writes-check-second-summary.json)及[b91307ae…检查](../../tests/v25/.results/b76/session-writes-check-final-summary.json)均退出0，当前最后一轮亦通过。

当前[1657项不可变源码](../../tests/v25/.results/b76/source-writes-verified.json)为`2d8b057f09f5c9235f96b68b8c237f8e191dd7f2ffcd4e869b513200b34a399a`。5ac6→b913仅API服务及新增API写入测试不同，本地生产/测试输入一致；b913→当前仅IPC写入测试增加快照场景，所有生产输入一致。各次原报告/日志均保留，不把未执行环境标成通过。[写入检查点](../../tests/v25/.results/b76/writes-checkpoint.json)记录精确命令与范围。S03永久清理/引用竞争、S04共享产品面、S05当前完整API/worker/E2E/产物与逐条验收仍开放，管理员未开始。

### 5.75.3 永久清理、生成关联与旧导入保护（2026-09-13，B76未验收）

实现范围见[生命周期§9.5](./V25-DATA-LIFECYCLE.md)：共享cleanup计数契约、两个gateway方法、API客户端/HTTP/IPC、core与PG事务清理；SQLite0011最小永久身份与INSERT/改ID触发器、旧ensure/recipe导入保护；PG普通生成共享锁及显式重试关联重验。未修改PG schema，不删除作品、资产或费用/原执行回执；未增加生成发送路径。共享页面按钮/确认/导航和完整实际宿主验收继续S04–S05。

| 阶段 | 实际结果和证据 | 覆盖与限制 |
|---|---|---|
| 新能力红测 | [0P/5F](../../tests/v25/.results/b76/session-purge-red-vitest.json)，[c6c4e16b…源码](../../tests/v25/.results/b76/source-purge-red.json) | 当时core尚无purge/emptyTrash方法；5项失败表示能力未接入，不是5个独立既有缺陷 |
| 第一轮本地 | [27P/0F](../../tests/v25/.results/b76/session-purge-local-first-vitest.json) | 清空/回滚/身份保护与迁移基础通过；当时生成夹具未start，不能证明非空资产和费用保留，最终有效证据以后续修正为准 |
| 本地联合首败 | [87P/2F](../../tests/v25/.results/b76/session-purge-local-vitest.json) | IPC方法数仍期待92而实际94；新PID断言发现夹具直接queued→complete没有资产/费用。已调用真实start→complete，并在清理前明确断言success、0.25费用和一份资产，不改生产状态机、不放宽断言 |
| 修正后聚焦 | [27P/0F](../../tests/v25/.results/b76/session-purge-local-fixed-vitest.json) | 非空作品/费用、真实生成入口零发送、新PID旧导入及方法映射通过；包含新测试，不与前一27项相加 |
| 本地完整专项 | [101P/0F/0S](../../tests/v25/.results/b76/session-purge-local-verified-vitest.json)，[3b9a1ec0…源码](../../tests/v25/.results/b76/source-purge-verified.json) | client30、cleanup契约7、desktop gateway11、旧接管7、0011迁移2、新PID旧导入1、版本迁移10、真实core生成1、bridge9、Session IPC12、版本进程1、purge5、store5 |
| PG/HTTP联合 | [36P/0F/0S](../../tests/v25/.results/b76/session-purge-api-verified-vitest.json)，同3b9a1ec0… | purge/生成锁8、写入5、查询21、实际API bin/Better Auth/PG HTTP2。只有后2项为实际HTTP；其余调用正式服务与真实PG17 |
| 旧迁移兼容修正 | [5P/0F/0S](../../tests/v25/.results/b76/session-purge-legacy-compat-vitest.json) | 原0015 recipe合并2、0011迁移2、新PID旧导入1；兼容未接管Drizzle的旧库，受管永久身份保护仍生效 |
| 当前统一检查 | [check36/36、退出0](../../tests/v25/.results/b76/session-purge-check-compat-summary.json)，51.064秒 | lint、类型、单测、边界、桌面/共享构建及Web生产构建；不是全量数据库集成/E2E |
| 当前源码扫描 | [0命中/0错误](../../tests/v25/.results/b76/session-purge-scan-compat.json) | 本轮源码。尚无B76实际安装包或新归档产物扫描，不能引用B75产物结果作为本轮通过 |

**永久删除专项的真实边界：** SQLite单条只处理软删会话、重复返回0、恢复先完成则拒删，清空501条含归档且保留活跃行；后一个DELETE触发故障时已摘除的作品关联、草稿、会话与永久身份全部回滚。0011从既有0010库升级保留version7和原草稿，不推断历史墓碑；触发器DDL故障时新表及journal整体回滚，修正故障后可重跑。新OS进程真实运行takeover和旧recipe文件合并，保留已有生成、非空资产与0.25费用，置空会话引用、删除合并成功的旧文件；旧ID不能ensure。该旧文件为合成夹具，不是用户真实v2.1数据。core `generate`实入口遇永久删除ID，在生成记录创建阶段失败，run/请求/调用账本不变，fetch调用0；没有真实付费provider。

**PG竞争与交付：** 通过`pg_blocking_pids`确认实际锁等待，分别让restore或purge先排队，释放锁后验证恢复保留归档且purge拒绝，或purge成功且restore 404。生成INSERT的受控触发器暂停时，实际普通生成已持Session共享锁，删除等待；入队提交后清理摘关联，原任务/回执不变。另一案例让真实显式retry读源run后等待原回执锁，同时完成会话删除/purge；释放后关联重验拒绝，不新增任务/回执。purge先提交后新的普通生成亦拒绝；原幂等key仍返回原任务。资产保留案例包含一份显式SQL植入的资产，在精确比较清理前后事实后才由夹具删除它以避免回放触发签名IO，不能当作真实图片生成/交付。HTTP2使用独立API进程、Better Auth和隔离PG；新增案例验证无登录401、跨owner幂等0、活跃行400、单删/清空各[1,0]、跨owner保留和purge后get/restore 404，生成数量0。进程清理及无敏感凭据的运行证据位于[HTTP证据目录](../../tests/v25/.results/b76/session-http-evidence/)。

**统一检查首败均保留：** [第一次](../../tests/v25/.results/b76/session-purge-check-first-summary.json)是两个typed gateway夹具缺少新方法，另有bridge mock未注册；已补测试替身，保持实际接口严格性。[第二次](../../tests/v25/.results/b76/session-purge-check-second-summary.json)是并发辅助函数泛型不能接受两类Promise的联合，改为`Promise<unknown>`；[类型修正证明](../../tests/v25/.results/b76/purge-type-only-attribution.json)验证前后转译JavaScript完全一致。[第三次](../../tests/v25/.results/b76/session-purge-check-final-summary.json)发现原0015合并路径尚无永久身份表，已在表存在时查询，在受管启动前置迁移后仍严格保护；没有删除原测试。最终当前检查通过。

当前[1666项源码](../../tests/v25/.results/b76/source-purge-compat-verified.json)为`338e4406407b27800b4fefb65ae414bcc86a28dc61c04992ba4905e0f2790638`。相对3b9a1ec0…只有上述API测试类型标注和core旧合并兼容分支变化；所有API生产输入不变，变更的core合并路径由5项及最终check重新覆盖。[清理检查点](../../tests/v25/.results/b76/purge-checkpoint.json)保留命令、源码及原结果。当前不宣称Desktop同时恢复/清理的真实双Electron竞争、共享回收站UI、全量API/worker/三形态E2E或安装包迁移已经通过；这些继续S03实际宿主补验及S04–S05。任务包84/92，B76和全2.5仍未关闭，管理员未开始。


### 5.75.4 B76 S04共享会话回收站与当前会话隔离（2026-09-13，整卡未验收）

**实际实现。** 设置数据卡新增四端共用`SessionTrashPanel`与独立trash无限分页缓存；按`deletedOnly`查询普通及已归档的已删除会话，展开才读、后页失败保留已加载行、重试沿原游标。恢复调用专用接口并保留归档位置；单条永久删除和清空均有明确不可恢复说明，清空包含未加载页且反馈服务端实际条数。提交中防重复/关闭，失败保留目标和确认框，成功或失败后均刷新以核对竞争结果；恢复不抢走当前会话，成功移除行后的焦点有回退位置。生成/图片/费用保留沿S03服务边界，本轮UI测试不替代其非空资产/费用证据。

侧栏删除和归档改为成功后才导航，删除失败保留确认框与输入。**保留既有行为：当前会话删除后选中剩余列表首项，最后一条删除后进入空白新设计。** 工作台不再把分页未出现当作已删除；按ID核对，网络失败保留输入、阻止发送并可显式重查，确认离场才加载另一会话草稿或清空。未跟随后台refetch覆盖用户正在编辑的内容。初稿曾一律进入空白新设计，检查既有验收后已纠正，未修改原Web回退验收来迁就实现。

| 验证 | 实际结果与源码归属 |
|---|---|
| 组件/工作台/归档/设置联合 | `session-trash-navigation-vitest.json` 133P/0F/0S，源码80045bcf…；含新增分页错误、恢复位置、取消焦点、恢复/purge竞争反馈、501服务条数、删除失败草稿保留、最后一条清空、分页遗漏/网络核对失败与跨页面删除回退 |
| 真实三形态回收站专项 | `session-trash-runtime-third-result.json` 3P/0F/0S/0flaky，25.433秒，源码988edf67…；PC/mobile使用实际API/Better Auth/PG，Electron使用实际IPC/SQLite并新PID重启；每形态26条trash、恢复2条、单删1条、清空23条、保留3条live。含确认后被另一调用恢复时服务拒删、Esc/焦点、加载更多/刷新后未加载页清空；另一调用为实际服务顺序交错，不冒充两个同时阻塞的Electron进程 |
| 当前统一检查 | `session-trash-navigation-check-summary.json` EXIT0、36/36，36.829秒；当前源码24da487d…（1672项），相对133专项仅提取effect依赖的首项ID；相对三形态专项另包含上述导航纠正，当前完整E2E负责复验 |
| 当前源码扫描 | `session-trash-navigation-scan.json` 0 findings/0 errors；源码24da487d… |
| 完整三形态E2E首轮（已终止） | `session-full-e2e-first` 在确认草稿覆盖缺陷后主动 SIGINT、EXIT130；125P/373跳过或未执行，不把未运行项当作声明skip。后续修复与复验见§5.75.5 |

**首败保留。** 第一轮组件79P/1F是测试`gcTime:0`立即回收未观察缓存，导致无法断言失效；修正测试保留期后联合通过。首次Playwright在发现阶段因首参数未解构而失败，随后Biome空模式规则按仓库已有Playwright专用注释处理。第一轮实际宿主2P/1F：桌面renderer刷新回到工作台，测试漏了重新打开设置；补测试宿主导航后3P。未删除断言或修改宿主刷新策略。全部原日志、报告及前后源码清单保留在`tests/v25/.results/b76/`。

实际截图已检查：移动列表、PC清空确认、Electron列表、移动清空确认；原截图在`session-trash-runtime-{second,third}-artifacts/`，无横向溢出断言通过。截图不覆盖完整滚动/主题/所有错误状态矩阵；本轮没有真实用户旧库、安装包、付费生成或生产环境证据。

**仍需完成。** S03实际Desktop同时恢复/清理及迟到生成/ensure宿主矩阵、清空新到达/恢复竞争原范围核对；S04当前会话/未保存草稿与真实宿主完整矩阵；S05完整API/worker、migrate/check/build/全E2E、实际新产物扫描和逐条验收。B76、父卡与全迁移保持未勾选，84/92不是完成百分比，管理员未启动。[机器接续记录](../../tests/v25/.results/b76/shared-ui-checkpoint.json)。


### 5.75.5 B76 草稿版本冲突保护与实际宿主复验（2026-09-13，整卡开放）

**确认的产品缺陷。** 工作台保留本页未保存输入，但后台会话查询曾把写入版本推进到其他写者的新版本；下一次防抖保存因此通过CAS并覆盖另一份草稿。独立实际`WorkbenchScreen`/TanStack Query/版本化memory gateway诊断复现：期望远端输入保持，实际变为本地未保存输入，0P/1F/53过滤。该诊断没有实际PG或Electron，不把它当作真实宿主证据。其前两次诊断因隔离路径解析和双QueryClient模块失败，原报告保留。正式回归已纳入工作台组件测试。

**实现边界。** 共享`useSessionDraftWriter`将写入版本绑定到实际载入的草稿；只在草稿内容相同时承接标题等元数据的新版本。任何写入失败（包括提交成功但回包丢失）都会停止已排队的后续写入。工作台保留输入并阻止生成，提供显式核对：取消保留本页；载入所核对的远端草稿；按对话框固定版本保存本页。核对后又有更新则拒绝覆盖，必须重新读取后再决定。重新读取本身不采用该版本续写。切换会话后的迟到读取不得打开旧会话对话框。继续沿用共享features、原gateway与版本契约，未新增宿主业务接口。

| 阶段 | 实际结果与归属 |
|---|---|
| 原缺陷诊断 | `draft-refetch-diagnostic-runtime-vitest.json` 0P/1F，源码24da487d…；原始错误断言保留 |
| 工作台/写入器/方案/回收站联合 | `session-draft-conflict-first-vitest.json` 92P/0F/0S，源码e29b9a3f…；7项写入器测试含丢回包、排队停止、固定核对版本、载入、元数据更新及切换后的迟到读取 |
| 实现统一检查 | `session-draft-conflict-check-second-summary.json` EXIT0、36/36，36.513秒，源码7dfef631…；明确桌面build通过，源码扫描0命中/0错误。首次检查仅新增RTL用例使用了不适用的`exact`类型参数，已修正并复验 |
| 实际宿主首轮 | `session-draft-conflict-runtime-result.json` 3P/3F/0S：回收站PC/mobile/Electron全部通过；新增草稿用例PC/Electron错误依赖窗口聚焦刷新，移动用例在缩放动画中测量44px目标 |
| 实际宿主第二轮 | `session-draft-conflict-runtime-second-result.json` 5P/1F/0S/0flaky，102.078秒，源码820e5efb…；草稿PC/mobile/Electron三项全部通过，含版本竞争、取消/焦点、固定版本再冲突、重读保存、显式载入与实际UI改标题后的正常编辑；回收站Electron在截图稳定性等待超时，未通过该项 |
| 全量首轮中止留存 | `session-full-e2e-first-result.json` 125P/373跳过或未运行、EXIT130，源码24da487d…；`session-full-e2e-first-stop.json`记录具体PID与主动停止原因。14份实际ZIP和1份明确UI文本替身分别扫描0命中/0错误 |

**测试修正不改变产品要求。** 实际Web和Desktop QueryClient均为`refetchOnWindowFocus:false`，不能通过派发visibility事件冒称完成查询刷新。真实用例现在依赖失败后的正式失效刷新，以及用户重命名引起的正式查询刷新；“后台refetch先于autosave”的精确交错由正式组件回归覆盖。移动触控目标仍要求44px，等待动画稳定后再测量。静态弹窗截图随后改用Playwright的`animations:'disabled'`完成有限动画；不修改应用动画或宿主刷新策略。第二轮移动错误态和Electron初始核对截图已检查，存在瞬时toast遮标题/淡入未结束的取帧局限，最终稳定截图仍需复核。

**并发验收边界。** 原B76要求实际Desktop恢复/清理竞争；桌面产品通过单实例/owner锁持有一个SQLite写者。新增测试通过同一真实renderer在等待回包前连续发送两个IPC，分别验证恢复先处理和永久清理先处理，随后新PID读回；该测试不声称两个Electron进程同时写同一库，不绕过生产锁，也不替代PG独立事务阻塞或非空作品/费用保存证据。当前新增两项尚待执行结果。

后续：修正截图取帧并复验上述六项和新增IPC两项，完成S03迟到准入/清空竞争与S04草稿隔离原范围审核，再接S05当前完整API/worker、迁移、完整E2E和实际产物扫描。B76仍未勾选，84/92保持；完整v2.5和管理员前置继续开放。全部命令和失败现场位于`tests/v25/.results/b76/`。


**本轮后续复验（同日）。** `session-draft-cleanup-runtime-result.json`在07ff7e7c…执行8项，7P/1F/0S/0flaky（84.590秒）：原6项草稿/回收站全部通过，Electron恢复先处理通过；永久删除先处理的实际拒绝码为`WORKBENCH_SESSION_NOT_FOUND`，新增测试误写为`NOT_FOUND`。首次改正恢复断言后，第二轮1P/1F在重启后的get断言暴露同一预期错误；当前get同样沿`WorkbenchSessionStore`返回领域错误码，不沿旧`getSessionRow`。两处测试预期均修正，未改生产错误映射。`session-cleanup-race-third-result.json`在a9f90e6f…最终2P/0F/0S/0flaky（13.013秒）：两条消息均在等待任何回包前发送；恢复先处理时归档/草稿/版本保持，永久删除先处理时恢复拒绝，新PID仍读不到且重复purge返回0；独立会话完整保留。a9f90e6f…相对07ff7e7c…仅上述错误码测试断言变化，产品及三宿主共用helper未变，不将不同源码报告拼作单轮8P。

静态截图采用有限动画结束后再取帧，Electron清空确认已通过；已检查本轮Electron草稿初始框和mobile初始框，Electron不再出现淡入半透明帧，移动内容和按钮完整可读，仍能看到短暂toast位于框上方。该截图不宣称完成所有主题/长正文/原生移动端的视觉矩阵。两个Session宿主运行均未生成方案ZIP，单独记录空产物清单，不宣称执行了零目标的归档扫描。新增IPC证据不替代迟到生成入口与非空资产/费用、清空并发集合的剩余审核。


**当前完整后端门禁已启动。** a9f90e6f…的最终check36/36（33缓存、12.808秒）及源码扫描0命中/0错误；1930个本地文档目标有效、diff空白检查通过，spec验证仍以84/92拒绝整包验收。完整API由`session-api-full`运行中，实际导出证据定向保留本批目录；当前官方Worker Dockerfile镜像已构建成功（75.829秒，Linux arm64，身份见`session-worker-image-identity.json`），以此镜像显式启用容器用例的完整worker集成`session-worker-full`已启动。两套完整集成未终态，不计通过；后续继续完整E2E、迁移和原范围剩余验证。


### 5.75.6 B76 重新载入后的排队草稿隔离及清空集合竞争（2026-09-13）

**完整后端回归已终态。** a9f90e6f…的`session-api-full-vitest.json`697P/0F/1S，671.044秒；唯一skip为普通集成未启用的一小时原期限专用测试，不能算本轮通过。`session-worker-full-vitest.json`101P/0F/0S，39.075秒，含18项实际进程和2项正式Dockerfile镜像容器测试。当前Linux arm64镜像身份已留存。实际API生成并保留8份合法方案ZIP，逐份hash与扫描均0命中/0错误。详见`session-backend-result.json`、`session-api-full-archive-inventory.json`及`session-api-full-archive-scan.json`。

**再次发现并修复的草稿缺陷。** 原修复保护后台refetch，但没有区分同一Session先后两次明确载入的编辑状态。当B的保存等待回包，A的旧输入已排队；切走再载入A的新草稿后，旧A写入仍可能读取新版本并覆盖。隔离真实hook/TanStack/版本化memory gateway诊断0P/1F/7过滤；正式写入器11项回归8P/3F，分别复现旧队列覆盖、迟到成功回包回退版本、迟到失败回包阻断新编辑。最初从根Vitest启动该包测试时未收集到用例，EXIT1/0执行，随后从features包执行，未把根调用计为红测证据。

共享写入器现在区分每次明确载入：输入产生时先`prepareWrite`绑定当时的编辑状态，800ms防抖后才进入串行队列；同一编辑状态的成功回包和仅元数据刷新可以推进其版本。再次明确载入后，旧队列不发送，旧成功/失败回包不能改变新编辑状态的版本或错误。旧写入失效只结束该旧工作，不显示新输入已保存的虚假确认。已发送请求不宣称撤回，实际数据库仍靠CAS裁决，查询仍会刷新核对真实结果。显式冲突保存的迟到回包也遵循相同隔离。

验证：`queued-draft-focused-vitest.json`97P/0F/0S（16.068秒，写入器/工作台/方案/回收站联合）；随后新增真实工作台800ms防抖、切走再载入与继续编辑回归，`queued-draft-screen-vitest.json`67P/0F/0S（17.996秒）。这些是实际React、Query与内存版本网关的组件测试，不冒充实际Electron/API进程交错。8aefda2d…统一check36/36通过（51.955秒）；当前29dc9e82…相对仅新增实际宿主证据附件，明确桌面build和源码扫描通过。当前实际宿主9项正在执行，未记为通过。

**清空集合的实际PG竞争。** 在原`session-purge.integration.test.ts`追加恢复先处理/清空先处理两种顺序：独立连接持行锁，通过`pg_blocking_pids`确认第一和第二个真实事务排队；清空语句已开始但仍阻塞时，另一会话才软删除提交。恢复先完成则原会话保留草稿/归档位置并只清另一原记录；清空先完成则两条原记录清除、恢复返回不存在；两种情况下新到达记录均保留给下一次清空，另一账号记录始终保持。完整该文件10P/0F/0S（4.235秒），未改生产清理逻辑。此前完整API697P属于追加这两项之前的源码，不能算成当前单轮699P。

实际Desktop新增验证将通过回环图像Provider产生真正落盘的作品，再永久清理所属会话，核对作品/图片hash/账本字段只发生预期关联摘除；同PID和新PID的迟到生图请求不得复活会话或增加调用。该用例正在随9项宿主专项执行；Provider为本机替身，不涉及真实付费或账单。

S03/S04原范围仍须结合实际宿主终态逐项审核，S05完整当前E2E/迁移及实际新产物尚未完成，B76和整包保持开放。原后端运行期间仅改其不依赖的features；后台结果明确归属a9f90e6f…，之后追加的PG测试另记。完整变更文件对照保留于`session-backend-result.json`，不以当前总摘要冒领旧测试。


**本轮实际宿主与迁移终态。** 29dc9e82…的`session-queued-runtime-result.json`9P/0F/0S/0flaky（93.554秒）：三形态草稿/回收站6项、同时IPC两种顺序2项、Electron实际生图后清理1项。后者PID15052→15061，一次回环图像调用、1份实际作品及1份图片hash保持，迟到请求在重启前后均拒绝。该本地UI用例的Automation requests/calls原本均为0，不能据此声称验证了非空费用授权账本或真实付费；已有core实际费用字段和PG非空请求/回执/资产证据仍须单独核对。精简附件见`session-generation-retention-evidence.json`。

当前同源码最终check36/36（31缓存、33.034秒）、明确build和源码扫描均通过；`session-owned-migration-result.json`记录独立自有PostgreSQL17.11上根`pnpm run db:migrate`首次/重复均EXIT0，24份迁移及Session表一致，容器清理EXIT0；没有操作用户库或把它当作安装包升级。`session-full-e2e-second`完整三形态回归已启动，当前未终态，最终产物扫描/skip分类和原S01–S05逐条审核仍待。B76、84/92及完整目标保持开放。


### 5.75.7 B76 安装包内迁移验收缺口核对（2026-09-13）

按原§9.2 S05逐项核对，当前`package.smoke.spec.ts`只有全新建库、当前bundle字节匹配及重启持久化，尚无升级前会话库输入。已有core真实SQLite前缀/字段等价/故障回滚和实际Electron开发构建证据，不能替代安装包内升级。该项保留为B76必须补齐的出口，未改为后续可选项。[核对记录](../../tests/v25/.results/b76/session-package-acceptance-gap.json)。

已准备两种受管前缀夹具：10份迁移（尚无version）和11份迁移（version=7、尚无永久身份保护）。各含12000字符旧草稿、旧比例、归档且软删的会话、带0.25费用字段的作品及实际PNG文件。两份夹具的真实SQLite建库、完整性/外键、字段和图片hash核对通过，候选测试TypeScript语法检查通过；[准备结果](../../tests/v25/.results/b76/package-prefix-preparation.json)只证明夹具有效，尚未运行安装包或产品迁移。夹具为自有合成数据，费用字段不是实际付费账单。

候选测试将复用打包文件逐字节核对，启动当前asar执行升级，验证原字段/图片保留、恢复仍归档、恢复后不可purge、再次删除清理和新PID防复活。完整E2E `session-full-e2e-second`的26568句柄已实查仍在运行；为保留29dc9e82…的测试身份，候选暂存于本批`.results`，未写入正式测试或重建宿主。待完整回归终态归档后接入候选、运行统一检查与实际macOS arm64打包/严格冒烟，并扫描真实产物。其他目标平台、真实用户旧库及安装器交互仍保留各自正式交付要求。B76保持未验收，84/92及全迁移范围不变。

**验收前对照补充。** [13项原范围对照](../../tests/v25/.results/b76/session-requirement-review-before-package.json)关联了实际PG断言、当前check中的12份本地测试文件及9项真实宿主结果。522个后端相关非测试文件与a9f90e6f…逐文件一致，保留API697P/1S及新增PG10P的不同归属；根check中条件跳过的PG测试不当作实际PG通过。此对照标记为切片证据存在，并非最终验收；完整E2E终态、实际包内升级和最终新产物扫描三项仍开放。候选包测试经Biome的stdin模式检查/格式化通过，仍未改正式源码或干扰当前回归。

**独立安装包测试已接入。** 核对当前Playwright配置后确认基础回归仅选择`web.*.spec.ts`与`electron.*.spec.ts`，没有引用安装包测试。因此在保持实际运行输入和构建不变的情况下，已写入独立package smoke与新夹具；原全量回归仍绑定29dc9e82…，工作树新增两份包测试的身份为c9b38d63…，区别记录于`session-live-input-isolation.json`。严格包配置的用例发现列出3项（原fresh/restart及两个升级起点），不表示实际包已通过。首次独立tsc未带仓库别名，报无法解析`@musefold/contracts`；改为继承现有tsconfig别名后严格noEmit检查EXIT0，未修改实体契约。实际文件Biome检查与新源码扫描通过；完整回归终态前不重建宿主或运行另一个实际窗口测试。包测试执行、当前统一门禁及新产物扫描继续待验。


### 5.75.8 B76 完整回归终态与实际打包启动（2026-09-13）

完整`session-full-e2e-second`已终态，根命令EXIT0、3382.594秒（含双宿主构建），Playwright执行3374.241秒：**497P/7S/0F/0flaky，共504项**。PC Web159P/2S、移动视口158P/3S、Electron180P/2S。7项全部为声明skip：真实账号登录三项、真实生图连接一项缺外部凭据；三项视口专属测试均已在对应视口通过，无不明跳过或未执行。源码归属29dc9e82…，当轮完整测试输入未变化；后来独立加入的包测试不在该配置选择范围。[完整结果及分类](../../tests/v25/.results/b76/session-full-e2e-second-closure.json)。

终态报告及全部实际产物已先行归档。本轮64份方案文件中45份实际合法ZIP、2份明确界面文本夹具分别扫描，0命中/0错误；17份故意无效输入按语料拒绝分类，不作可交付ZIP。首次全量中止125P/373跳过或未执行及全部后续故障记录保持原归属，没有用本轮成功覆盖。

当前c9b38d63…仅增加独立安装包测试/夹具，1679项源码；三项包用例发现、严格类型检查、源码扫描已通过。当前根check EXIT0（36/36、33缓存，完整命令15.421秒）通过。现已启动`CSC_IDENTITY_AUTO_DISCOVERY=false pnpm run package:mac:adhoc`构建实际本地arm64 App/DMG/ZIP；三项严格包冒烟及实际安装包扫描尚未执行。B76原S05包内升级要求和最终逐项验收仍开放，84/92及全部迁移后再开发管理员的顺序保持。


### 5.75.9 B76 最终验收：包内升级与交付扫描通过（2026-09-13）

**B76原S01–S05已验收，只关闭本卡。** [17项要求与证据摘要](../../tests/v25/.results/b76/acceptance.json)保存原boundary/verify、逐项依据和报告SHA256。任务包85/92，完整生命周期/费用/真实旧库/其他平台/生产及管理员前置保持开放。

当前c9b38d63…的实际`package:mac:adhoc`完成（53.901秒），App经本地ad-hoc签名及严格校验；源码1679项保持零漂移。严格包冒烟3P/0F/0S/0flaky（命令26.320秒）：全新建库/重启、0010前受管前缀10、0011前受管前缀11。当前out的全部bundle字节与运行asar一致。前缀10由无version升级为1，前缀11原version7保留；12000字符草稿、旧比例、归档/删除字段、作品和实际PNG哈希、合成0.25费用字段保持。恢复后仍归档且不能purge，重新删除再清理仅摘作品关联；PID37304→37319、37326→37484后重复purge为0、restore不存在、持久触发器拒绝复用旧ID。[实际包内升级证据](../../tests/v25/.results/b76/session-package-migration-evidence.json)。这是合成受管旧库在真实本地包中的升级，不冒称真实用户2.1库、其他平台或安装器交互验收。

实际App/只读挂载DMG/ZIP共6个内容目标扫描0命中/0错误（22.390秒），扫描同时核对打包关键文件身份。DMG SHA256为`d32b659c74740c49f94606a3ad12536d375c3c2f0f0d08204cda265ce7cd5d6c`；ZIP为`2a04ba73b8e2919f4b004b5719d2d92c321c3918047a851e4df3ab9f2939fad8`。仅排除DMG中指向系统`/Applications`的安装快捷链接，不跟随扫描系统目录。[完整扫描](../../tests/v25/.results/b76/session-package-security.json)。没有发布或覆盖用户应用/数据库。

完整E2E497P/7S与此前实际后端的源码区别、四项外部凭据和三项对应视口skip、首次缺陷红测/中止及类型检查调用错误均保留。当前check36/36和源码扫描、当前实际包构建/3项冒烟/产物扫描共同完成S05；不把不同时间的专项相加成一次完整API699。接续D01.3/4/6：保留30/90天边界、有界分批维护及Automation/Skill审计策略，再推进完整GC、费用和正式交付。


## 5.76 B77 保留期、有界维护与审计政策（2026-09-13，进行中）

原D01.3/4/6已登记为B77，任务包85/93；范围保持R01–R05完整条件，不因局部通过关闭B77、D01或迁移。B76会话原验收继续有效，其497P/7S及真实macOS包3P属于当时源码，不能标为B77当前全量结果。

### 5.76.1 分批、锁等待和事务回滚

保留30天软删终态生成/Prompt、90天sync日志/结果的原边界，新增每类每次最多1000个父记录。sync两表各最多1000，合计最多2000；mutation结果按user/device/mutation完整复合键选择。维护事务使用`SET LOCAL lock_timeout = '2s'`，该值限制每次锁等待，**不是整项任务运行时间或所有子引用总量的上限**；不泄漏给连接池后续调用。恢复先提交时保留原FOR UPDATE重新核验行为，没有改成跳过锁。生成资产仅写入现有对象清理意图，独立执行回执保留。

| 当轮命令名（报告目录b77） | 源码摘要 | 实际结果及含义 |
|---|---|---|
| retention-batches-red | d8aa236a… | 0P/3F：原Prompt/生成/sync每类都实际处理1001，复现无限批次 |
| retention-batches-first-green | 0cdd9027… | 14P/0F/0S：1000+1+no-op、复合键隔离及原30/90天/恢复边界 |
| retention-lock-red | 4a26318e… | 3P/3F：三类被真实PG事务持锁后超过4秒观察期限；最终释放锁并等待清理退出，非失联或强杀 |
| retention-lock-first-green | 062c1e82… | 17P/0F/0S：实际2秒55P03、原行保留、释放后重试、连接设置不泄漏 |
| retention-atomic-concurrent | a18b7419… | 22P/0F/0S：另含sync第二表删除失败回滚日志与水位，Prompt删除失败回滚usage，以及三类各2001行的双维护并发、准确计数/积压续跑/no-op |

生成批次夹具是SQL直接插入的历史终态记录及running/cancelling保护行；不是完整付费准入/真实账单，也不以此声称终态unknown全矩阵通过。时钟为显式NOW，非自然等待30/90天。失败注入只在自有PG触发器；双维护以独立真实事务Promise.all运行，不冒称每次都观察了相同锁交错。首版夹具的unknown命名已改为实际cancelling状态。

### 5.76.2 正式Worker维护、暂停与安全计数

实际`bin.ts`、Graphile、PG、回环HTTP/S3测试先复现缺少暂停策略：`maintenance-pause-red`在25ca91db…为0P/1F（另3项按名称未选），传入暂停配置后Prompt仍从1001删到1，限流记录1001全删。已接严格`MAINTENANCE_CLEANUP_PAUSED=true|false`启动配置（默认false，其他字符串拒绝），compose worker透传；暂停入口在任何清理阶段前返回，记录`[maintenance] paused`，generation/reconcile不受此开关影响。

开关按进程启动读取：运维修改后须重启所有相关worker并等待旧进程排空；不能宣称一个配置变更能中止已在执行的事务或暂停旧实例。API过期/授权判断仍即时生效；暂停只延后后台物理清理，包括过期密文清除，不延长有效资格。恢复后由下一次原定维护任务继续，两个既有dotted/slash任务别名均接同一策略。

限流记录继续按数据库now减2天选择，但改为每次1000条、事务内锁等待2秒。账户恢复原有100×10上限不重做，仅补返回实际累计候选/备份数。阶段完成后日志只记录选定数值：退役数、清理数、对象意图数或sync水位；不包含owner/对象键/业务正文。中途失败保留此前已提交阶段，当前阶段整体回滚；Graphile持久last_error只含固定阶段名，避免原SQL参数或上游秘密进入任务错误。

`maintenance-pause-first-green`在17ac96c0…实际生产入口完整4P/0F/0S（10.817秒）；`maintenance-runtime-current`在2f27125f…合计41P/0F/0S（16.009秒），包括新增启动配置拒绝歧义、真实Worker新PID暂停/恢复、1001→1→0→no-op及真实Graphile阶段失败/安全last_error/下一任务恢复；没有调用付费供应商。当前统一check EXIT0（36/36，27缓存，总39.156秒）及源码扫描零命中/错误。完整API、完整Worker结果待终态；正式Dockerfile镜像两次构建因下载pnpm时npm TLS连接重置EXIT1，首败日志保留。不能使用B76镜像替代当前容器验证。

### 5.76.3 原范围剩余与下一次验收

- R01/R02：已有1001/2001与精确cutoff、恢复、部分失败和锁等待证据；继续核对未来时间/时区、生成引用与费用回执中途失败、全部相关锁等待边界，不能把父记录上限外推为资产明细或总运行时间有界。
- R03：分批后非时间顺序seq、事务晚提交、并发裁剪/提交的完整水位安全；实际API410/bootstrap和保留客户端未同步编辑联合回归。`appendSyncChange`目前直接分配identity seq，需用真实交错验证提交顺序与游标推进，不能仅凭水位Math.max或数组模型断言无空洞。
- R04：已有实际启动/两别名/暂停新PID/准确阶段计数/失败恢复；继续包括暂存、账户恢复、对象队列在内的暂停保护完整矩阵、故障竞争及最终同源码真实容器验证。当前整个cleanup分阶段提交，不宣称跨八阶段全局事务。
- R05：继续按真实存储逐表逐入口确认Automation/Skill保留、授权及有效引用；持久费用/回执不按30天机械裁剪，暂态运行时缓存与持久审计必须区分。完整GC发现/物理删除仍是下一阶段，不恢复冻结UI、不增加Cloud MCP destructive工具。

上述41项与此前专项有重合，不能相加成一次独立完整测试数。每个命令的`*-summary.json`记录原命令/时间/退出码，`*-vitest.json`含实际用例，`source-*.json`保存对应源码；所有报告位于[本轮结果目录](../../tests/v25/.results/b77/)。


### 5.76.4 当前完整Worker与同步晚提交缺陷

2f27125f…完整Worker本机集成EXIT0，112P/0F/2S（49.170秒）。两项skip明确为正式容器启动/正常退出与SIGKILL恢复，因本轮官方镜像未构建成功而没有执行；现有B76容器证据不可换名复用。当前23项真实进程测试（process-runtime 18、production-bin 5）已执行。源码1683项零漂移，完整API仍在执行。

在相同源码和自有PostgreSQL17上，用正式PromptService事务与SyncService读路径完成[实际晚提交诊断](../../tests/v25/.results/b77/sync-late-commit-diagnostic.json)，输入/报告摘要见[证据](../../tests/v25/.results/b77/sync-late-commit-evidence.json)：

1. 事务A创建Prompt及seq=1日志后保持未提交。
2. 独立事务B创建第二个Prompt及seq=2并提交；实际pull已经返回游标2。
3. 实际retention没有删除任何日志，却根据可见最小seq将水位提高到1；此时bootstrap只返回B，snapshotCursor为2。
4. A提交后数据库确有seq1/seq2两条日志，但实际pull(cursor=2)为空，客户端依赖该快照/游标将遗漏A。

**这是尚未修复的真实服务缺陷，不是通过验收，也不是HTTP/客户端级证据。** 清理分批不能消除identity分配顺序与事务提交顺序的差异；简单抬高水位、降低游标或仅数组测试都不能证明正确。下一轮应先将该交错固化为就地红测，协调写事务、读快照及裁剪的提交边界，覆盖REST/sync、同/跨owner、设备锁顺序、失败回滚和无日志bootstrap；随后实际HTTP410及客户端本地编辑联合验收。需验证新增协调不会引入锁反序、全局写串行或无界等待。当前完整API在运行，诊断没有修改它的源码。


### 5.76.5 B77 同步迟提交修复与完整后端终态（2026-09-13）

§5.76.4是修复前历史。现在写入、读取快照和裁剪共同使用`packages/db/src/sync-publication.ts`：写事务在业务/设备行锁之前取得ROW EXCLUSIVE；读事务在REPEATABLE READ的首个快照查询前取得SHARE，在保存点内固定快照后回滚该保存点释放锁；裁剪取得SHARE ROW EXCLUSIVE直到事务结束。写者彼此仍可并发。读边界最多等待2秒，超时转换为HTTP503、retryable=true，不前移设备游标；读保存点同时恢复局部锁超时设置。读取后续设备锁等待不被宣称为全程2秒限制。无新增schema或迁移，无事务内外部请求。锁与保存点规则参照[PostgreSQL锁文档](https://www.postgresql.org/docs/17/explicit-locking.html)，快照语义参照[事务隔离文档](https://www.postgresql.org/docs/17/transaction-iso.html)，具体交错以下列真实PG测试证明。

首版让SHARE锁覆盖整个读事务，导致原双客户端“设备被锁时裁剪仍可提交”用例500；保留原测试，修复为上述短时快照边界，没有删减竞争条件。首次把跨API/worker集成测试放在API目录触发TypeScript rootDir错误，随后移到根repo集成目录，不放宽项目依赖；根目录直接导入未声明的`@musefold/db`导致一次加载失败，改为既有相对源码入口。错误typecheck产生的4份worker声明文件经确认属本轮生成物后清除，首败报告保留。

| 命令名 | 源码 | 实际结果 |
|---|---|---|
| sync-publication-red | e2e0ef32… | 0P/3F，真实迟提交遗漏和错误裁剪水位 |
| sync-publication-first-green | 72f27236… | 50P/0F/0S，首轮局部回归；不代表客户端已验 |
| sync-publication-matrix | a108f264… | 57P/0F/0S，新增7项实际PG及原相关用例 |
| sync-publication-two-clients | a108f264… | 8P/1F，原设备锁/并发裁剪测试暴露SHARE持锁过久 |
| sync-publication-snapshot-release | 08fccf4d… | 原9项通过，但新增文件加载失败；命令EXIT1，不记整轮成功 |
| sync-publication-snapshot-release-second | d7a72811… | 16P/0F/0S：新增PG7项和原独立双SQLite客户端/HTTP/PG9项全部通过，69.147秒 |
| sync-publication-http | 31e548d8… | 3P/0F/0S，实际Better Auth/Hono/HTTP/PG：REST写者迟提交下pull/bootstrap，及503重试/游标不动，12.929秒 |
| sync-publication-final-check | 31e548d8… | 36/36，32缓存，EXIT0，51.658秒 |
| sync-publication-api-full | 31e548d8… | 699P/0F/1S，EXIT0，727.345秒；S为原专用自然一小时过期测试，不冒充本轮执行 |
| sync-publication-worker-current | 31e548d8… | 112P/0F/2S，EXIT0，99.167秒；23项真实进程已执行，2项正式容器仍未执行 |
| sync-publication-source-scan / sync-publication-api-archive-scan | 源码31e548d8…及该API实际产物 | 源码及8份实际ZIP均0命中/0错误；归档扫描19.424秒，另18份JSON是测试元数据，不计为ZIP或坏包 |

完整API/worker、专项有重叠且分属不同命令，不能相加成一次全量通过。正式PG7项覆盖迟提交pull/bootstrap、无删除裁剪、低序号回滚、跨owner裁剪/410/bootstrap、长写者503和push先于设备锁；双客户端原9项包含未同步本地编辑/410重建。报告与不可变源码快照在[本轮结果目录](../../tests/v25/.results/b77/)。后续本地授权改动不得将31e548d8…改称其当前全量结果。

正式worker镜像下载pnpm的npm TLS问题仍未解除；本节未重试同一网络失败，也未将旧镜像算作新源码验证。R01/R02剩余边界、R04全类别暂停/正式容器及R05审计政策继续按原范围推进，B77未验收，85/93与剩余8大阶段保持。

### 5.76.6 B77 本地质询清理路径缺陷与修复（2026-09-13，原R05内）

[修复前真实HTTP诊断](../../tests/v25/.results/b77/local-proof-diagnostic.json)在31e548d8…复现：有效Bearer配合未签发的`../owned-marker.txt:wrong-proof`返回403且业务操作0次，但服务端在校验前拼接请求ID并删除文件。诊断只使用自有临时目录和合成标记，EXIT0表示复现完成，不表示产品正确。

永久回归在5c6d293c…为6P/6F：两种越界路径、相对路径和未知UUID均误删现有文件；60秒精确边界还接受已到期质询，新签发亦未清理恰好到期记录。修复后只允许请求ID查找服务端签发映射，未知ID立即403且零文件动作；已签发记录保存可信路径，失败或成功均只消耗该记录。文件独占创建，TTL判断统一`expiresAt <= now`。e0628727…原12项全部通过（1.284秒）。这不意味着完成了整个审计保留政策；所有本地入口授权矩阵与当前统一门禁正在补验。


### 5.76.7 本地入口矩阵与实际Electron（2026-09-13）

642d3e24…的`local-proof-matrix`为99P/0F/0S（2.380秒），涵盖automation-server全部测试及本地MCP服务测试。新增11个本地入口逐一验证无token401、无质询/未知质询403、合法质询仅调用对应业务一次、重放403；错误秘密只消耗对应已签发质询，其他质询不受影响。原路径/TTL测试亦在其中。本轮`local-proof-check`36/36（28缓存，35.248秒）和源码扫描通过。它证明路由授权守卫，不证明假业务适配器背后的备份/导入全部真实落库。

追加实际Electron断言后的源码768c5709…共1687项：`local-proof-build`EXIT0，`local-proof-electron-second`5P/0F/0S/0flaky（21.564秒）。实际主进程收到带有效token的越界质询后返回403，自有userData中的合成标记文件字节与Provider表均不变；随后原有效本地管理/自备生成流程通过。没有接触正式用户目录或付费上游。第一次Playwright命令将文件过滤项放在可变参数`--project`后，被误解析为项目名，启动前EXIT1；改用`--project=electron`。JSON报告的相对路径按配置目录解析，已将唯一误写报告移入本批结果目录，未修改报告内容；后续统一用绝对报告路径。

当前`local-proof-final-check`36/36（33缓存，15.689秒）通过，源码零漂移；`local-proof-electron-full`完整182项Electron回归正在运行，尚无终态/最终产物扫描结果，不能算全量通过。完整回归与同期check使用同一固定源码；以后安排应先等check/build结束，再启动宿主回归以避免构建与运行争用。

R05进一步核对得到[真实HTTP端点审计诊断](../../tests/v25/.results/b77/audit-path-diagnostic.json)：已鉴权动态路由200和未鉴权未知路由401，审计回调均保留请求中的原始路径参数（2条记录）。诊断使用合成隐私标记、输出布尔结果，不包含真实凭据；不冒称已验证桌面磁盘泄漏。当前桌面recordAudit仍原样复制path进入内存和NDJSON，因此下一步应建立永久回归，在审计入口记录可信路由模板/受控未知标记，并结合端点文件轮转、写失败可见性及持久费用表保留完成原R05。该问题尚未修复，不能以质询修复关闭审计政策。


### 5.76.8 Electron首轮终态与审计路径正式修复（2026-09-13）

`local-proof-electron-full`在768c5709…终态EXIT1，411.213秒：109P/1F/72S/0flaky，共182项。[失败归档](../../tests/v25/.results/b77/local-proof-electron-full-closure.json)保留原命令和报告SHA256。70项隔离数据库测试因命令漏设`RUN_DATABASE_TESTS=true`而跳过，另2项为真实账号/上游凭据门控；不能把72项全部解释为无可用环境或产品通过。留存1份实际ZIP扫描0命中/0错误（6.911秒），不替代未执行用例的产物。

唯一失败在Session草稿核对：Escape关闭对话框后焦点归还正确，但再次点击时鼠标悬停错误通知，Sonner暂停通知计时，通知持续遮挡按钮。已核对当前通知组件与安装的Sonner实现，测试改为先hover正文使鼠标离开通知、等待通知自然消失，再执行原真实点击；没有force点击、删除节点、伪造版本、改toast时长或删掉草稿/焦点断言。三形态实际草稿及本地管理联合正在补跑。§2.4规范要求错误手动关闭，而当前Toaster未配置关闭按钮/统一错误持久策略，此差异须在原G-UI验收中解决；本测试协调不是该产品差异已修复的声明。

R05正式新增`audit-privacy.test.ts`：09cc902b…红测2P/10F（0.851秒），复现动态/编码参数、未授权/Origin/限流/未知路由及错误回调的原始信息流入日志。`server.ts`现在由matchRoute返回可信注册模板供审计使用，健康/events内建端点使用固定名称，鉴权/限流前拒绝和未知匹配均使用固定`/<unmatched>`；业务路由、参数解码和返回语义不变。审计回调失败只记录固定告警，不转发原始Error。

a2b22532…的`audit-privacy-green`111P/0F/0S（2.431秒）：automation-server全部测试与本地MCP服务联合；含新增11种真实HTTP成功/拒绝/编码/正文场景和1个日志失败场景，原质询24项亦保留。ff3b4735…加入通知等待后统一check EXIT0（35.642秒），后来又在实际Electron测试中增加磁盘NDJSON断言，源码bd90fa02…共1688项，明确build EXIT0（3.791秒）。正在实际宿主验证原始动态ID/查询参数和token不进入NDJSON，不能提前将HTTP回调证据称为磁盘脱敏通过。

npm可达性复查`worker-registry-connectivity-current`仍EXIT35、5.022秒，保留TLS错误；未再次启动注定失败的镜像构建，也未替换正式镜像。R05端点文件轮转、写失败/重启及持久费用/引用保留、原R01–R05其他条件继续；B77未验收，85/93和剩余8大阶段保持。


### 5.76.9 实际磁盘审计与三形态草稿补验结果（2026-09-13）

bd90fa02…的`audit-privacy-host`为10P/1F/0S/0flaky（101.483秒）：PC Web、移动视口、Electron各2项Session真实服务/草稿测试均通过，含前述真实鼠标移开通知/等待/再次点击及全部版本、持久性和焦点断言；4项本地Provider管理亦通过。唯一失败是新增磁盘断言误读`userData/logs`，实际宿主使用core常量`LOGS_DIR_NAME`。修正为共享常量后源码6d9bf7ca…，仅该测试文件变化，[逐文件差异](../../tests/v25/.results/b77/audit-privacy-host-source-diff.json)保留归属，没有修改生产日志位置。

6d9bf7ca…的`audit-privacy-host-second`实际Electron5P/0F/0S/0flaky（23.463秒）。实际主进程接受HTTP后，NDJSON中出现`/v1/local/providers/:id`、403及`LOCAL_PROOF_REQUIRED`；原始动态ID/查询参数的合成隐私标记和本轮实际token均未进入文件。拒绝后Provider表不变；原质询路径保护、自备连接/生图/管理流程通过。该例通过实际文件读取断言，使用自有userData并在结束清理；未宣称历史日志已经脱敏或轮转。

当前统一check36/36、32缓存、EXIT0（35.172秒），当前源码扫描0命中/0错误（0.874秒），1688项源码零漂移。所有本轮进程均已终态，没有仍运行的完整Electron。完整Electron首轮失败/72S不被上述专项覆盖；待端点文件轮转及相关R05条件接入后，按`RUN_DATABASE_TESTS=true`重跑原完整Electron和适用门禁，原2项真实凭据门控另保留。B77、D01及全迁移未验收；下一步是端点NDJSON有界保留、写失败/恢复/重启、持久费用表与Skill有效引用矩阵，不开始管理员。


### 5.76.10 端点日志有界轮转与实际进程恢复（2026-09-13，R05子项）

新增`apps/desktop/electron/system/automation-request-log.ts`并接入现有主进程recordAudit。当前与上一份NDJSON各最多2MiB，追加前检查容量；单条新记录最多4096字节，等待/正在写入总数最多200。仅选择时间、方法、可信路由模板、状态、耗时和可选错误码；保留原内存环200条。超出单条或队列容量的端点诊断不落盘，给出固定告警；相同失败状态合并提示，后续成功记录恢复。该策略只管理最近端点诊断，SQLite费用/批准路径/请求/回执/来源保留规则不变。

旧超大文件在下一次成功写入前保留最新完整行，读取缓冲最多2MiB+1字节；没有完成的末尾半行丢弃后再追加，避免下一条被拼进残缺JSON。改写先写固定受管pending文件、sync后rename，正常结束不留pending；进程中断最多留下额外一份2MiB改写文件，下次写入清理该未提交文件。正常两份诊断合计最多4MiB，改写中或遗留pending时最多再加2MiB；现有超大文件遇I/O错误保持原文件，容量保证不能外推为磁盘故障时已完成清理。日志目录和文件拒绝符号链接，文件另拒绝硬链接/非普通文件；新文件和正常读取到的旧文件收紧为0600。该文件机制不是跨机器文件系统事务或掉电后零日志丢失保证。

写入严格串行，stat/rename/append失败不会继续追加突破上限，不向日志转发原始异常或路径；下一请求重试文件维护/追加，不重放失败请求的业务操作。停止控制面先停HTTP，再await已接收写入队列；正常应用关闭沿原shutdown流程等待同一函数。没有更改正式用户日志或数据库，本轮仅运行自有临时目录和隔离应用。

| 命令 | 源码 | 结果 |
|---|---|---|
| audit-file-first | 2e271b8d… | 11P/0F/0S（0.970秒），真实文件串行/容量/旧大文件/半行/队列/链接/故障恢复；当时尚未接宿主 |
| audit-file-host-red | 914cb279…测试、既有宿主构建 | 0P/1F，夹具误把automation.setEnabled对象入参写成boolean，在校验处失败，不算容量缺陷红测 |
| audit-file-red-build / audit-file-host-red-second | fefbb976… | 明确构建通过；实际Electron0P/1F（5.176秒），正式对象入参后日志3145901字节超过2097152，复现旧主进程无限追加 |
| audit-file-wired | 27f96229… | 146P/0F/0S（2.477秒），真实文件14项（新增stat/rename/append注入失败）、主进程费用测试与automation-server全部回归 |
| audit-file-check / audit-file-source-scan | 27f96229… | check36/36，EXIT0（40.756秒）；源码0命中/0错误 |
| audit-file-build | 27f96229… | 明确构建EXIT0（4.014秒） |
| audit-file-host-green | a6f12749… | 6P/0F/0S/0flaky（28.113秒）：新增轮转/停止排空/新PID和原本地管理5项（含真实磁盘路径保护） |

最后的a6f12749…仅给第二次启动补等待发现文件，不改运行实现；1691项源码快照单独保存。实际[进程与文件证据](../../tests/v25/.results/b77/audit-file-runtime-evidence.json)：PID71630→71657，最终当前文件220字节/2行，上一份2097140字节/22310行；两份预置旧文件均超过3MiB。正常停止后直接读取全部完整NDJSON，重启后保留原health并追加404的受控未知路由。该用例验证正常进程退出/新PID，未假称SIGKILL中途改写已实测；残留pending/末尾半行由真实文件故障夹具覆盖，之后仍需按原R05决定完整异常进程矩阵。

日志文件政策专项已有上述证据，完整费用/Skill保留与有效引用矩阵、原R01–R05其他出口继续。B77保持未验收；最终当前check与带`RUN_DATABASE_TESTS=true`的完整Electron回归继续补齐，不能把6项替代原183项配置（本轮新增1项）。


**本轮后续核验：** 同a6f12749…的`audit-file-final-check`退出0，36/36（15.698秒）；`audit-file-final-source-scan`0命中/0错误（0.874秒）。`audit-file-electron-full`已以`RUN_DATABASE_TESTS=true`启动完整183项配置，目前仍运行；待终态统计通过/失败/skip/flaky，并分类扫描实际留存归档，不能先记全绿。

另有独立[受控进程诊断](../../tests/v25/.results/b77/audit-crash-diagnostic.json)：实际生产writer经测试专用rename屏障，暂停在pending已sync/close但尚未rename；只SIGKILL本轮自有临时目录对应的子进程PID74114，然后新PID74132用未注入writer恢复。原当前/上一份各3145804字节，pending2097140字节；恢复后当前98字节/1行、上一份2097140字节/22310行，均为完整JSON，pending移除。命令退出0（1.354秒），wrapper退出1与被杀child分别记载；这是scratch故障诊断，尚非永久自动回归，也不证明突然掉电时零数据丢失。原费用/引用与B77全范围仍待。


### 5.76.11 持久审计清理保护与Skill精确到期红测（2026-09-13，R05继续）

在完整Electron持续使用a6f12749…的全部1691个原文件及原构建期间，只新增独立Vitest与子进程夹具；逐文件哈希确认原输入没有变化，见[运行输入归属](../../tests/v25/.results/b77/audit-file-electron-frozen-inputs.json)。不把新增用例算入正在执行的183项，也不声称后加测试已经由那轮Playwright覆盖。

`audit-retention-regressions-first`在e3a3d83d…（1694文件）20P/0F/0S，退出0，3.220秒：

- `automation-request-log-process.test.ts`3项永久回归使用生产writer，分别在pending替换前、替换后、current轮转后注入屏障；只SIGKILL本测试fork的子进程，确认signal为SIGKILL，新PID恢复成功，两份文件不超2MiB且每行可解析，pending清除。保留轮转后的上一份内容；不宣称被中断的未提交诊断已经落盘。
- `automation-retention.test.ts`17项使用自有真实SQLite、实际受管迁移/费用协调器/回执服务和清理仓库。已知费用、未知费用、确认未发送三种状态各覆盖Prompt永久删除/清空、Session永久删除/清空、历史软删除，共15项；七张非空持久表在清理及重新打开数据库后保持一致，当前月/未来月预算不变，同key回读原请求，原claim不可重新发送。
- 另验证有效回执仍引用时，直接删除策略/请求/调用父行均被实际FK拒绝；审计读取上限200不会删除更早记录，未知费用跨月仍限制预算。G/R/S的审计记录来自实际record入口，但该用例仅证明本地持久/引用保护，不替代所有实际HTTP入口、完整云GC、真实备份恢复或费用父卡联合验收。

`skill-retention-red`在9e7580ab…（1695文件）4P/3F/0S，退出1，1.358秒。新测试复现两处实际服务缺口：sourceDigest未触发过期检查，缓存创建后1800000与1800001毫秒仍可给授权摘要；execute使用严格大于号，刚满30分钟仍会调用Provider。到期前正例、超期执行拒绝、活跃执行在源缓存清理后仍可取消、摘要不匹配拒绝均通过。网络reader/Provider边界为本地测试替身，不调用真实GitHub或付费服务。下一修复统一精确到期检查，并补失败后控制器释放；当前未关闭R05或B77。


### 5.76.12 日志完整宿主收取与Skill修复后门禁（2026-09-13，仍为PROGRESS）

`audit-file-electron-full`已终态退出0：UTC12:14:49→12:41:44，1614.884秒；a6f12749…原1691文件在结束前再次哈希验证全部未变。实际181P/0F/2S/0flaky，总183；2S逐项为`electron.live-account.spec.ts`真实账号密码门控、`electron.sync.spec.ts`真实中转生图key门控，**没有数据库开关造成的skip**。完整[终态及skip](../../tests/v25/.results/b77/audit-file-electron-full-closure.json)保留。更早local-proof首轮109P/1F/72S仍是历史失败，不删除、不改成通过。

留存方案文件34份，经语料/容量manifest哈希分类：17份实际合法ZIP、17份明确故意非法输入；没有以扩展名直接把34份都称为可扫描合法产物。`audit-file-electron-full-archive-scan`扫描17个实际ZIP目标，0命中/0错误，退出0（48.712秒）；[分类](../../tests/v25/.results/b77/audit-file-electron-full-archive-inventory.json)、[扫描结果](../../tests/v25/.results/b77/audit-file-electron-full-archive-scan.json)单独保存。

收取完整运行后才修改原Skill实现：`skillRuntimeSourceDigest`先执行过期清理；`cleanupExpiredRuntimes`将`>`改为`>=`，明确30分钟到点后不能新授权/新执行。正在执行的局部snapshot和执行控制器不随cache删除，保留取消与finally释放；没有改冻结渲染层、增加端点或新增费用许可。

| 命令/范围 | 源码 | 实际结果 |
|---|---|---|
| skill-retention-red（修改前） | 9e7580ab… | 7项中4P/3F；见§5.76.11，未包含后来补的finally释放第8项 |
| skill-retention-green | e2d83acc…，1695文件 | 197P/0F/0S，7.029秒；Skill8、文件14、日志真实进程3、费用保留17、原managed ledger/真实进程与Automation/MCP联合 |
| skill-retention-check | e2d83acc… | 36/36，0缓存，退出0，53.061秒 |
| skill-retention-build | e2d83acc… | 明确构建退出0，3.571秒 |
| skill-retention-source-scan | e2d83acc… | 0命中/0错误，退出0，0.806秒 |
| skill-retention-electron-full | e2d83acc… | 已带RUN_DATABASE_TESTS=true启动当前构建完整183项；运行中，不能预填通过 |

本节关闭的是上述缺陷及相应专项证据，未关闭B77。原R01/R02仍须完整核对未来时间/时区、引用/费用/回执故障与锁边界；R04全类别暂停/恢复及当前正式worker容器证据仍待（原npm TLS失败保留，不复用旧镜像冒充当前）；R05仍需完成现存服务逐入口/来源有效引用的最终矩阵。完整GC发现/物理删除、费用父卡与其他7个大阶段继续。文档相对链接存在性426项通过（不声明锚点校验），git diff --check通过；本节新增链接会在最终文档校验时重新计数。


### 5.76.13 八阶段暂停、失败对象重试与Skill完整宿主收取（2026-09-13）

新增`maintenance-bin-matrix.integration.test.ts`及两个自有夹具：实际fork正式`bin.ts`，使用真实PostgreSQL、迁移、Graphile队列和生产AWS SDK；仅对象存储为本地HTTP协议夹具，不替换task函数或runner。十八张表均有非空记录：方案包、来源准备/快照/文件、账号恢复请求/备份、限流、生成/资产、Prompt/使用记录、同步设备/日志/幂等/水位、上传注册与对象清理队列。

暂停时分别执行两种正式任务别名，所有表逐字段保持原样，S3删除HTTP请求数为0；正常退出、新PID恢复后八个阶段均实际执行，清理五个到期对象，五个未到期对象及各表对应未来记录保持。阶段日志严格核对retired/purged/候选/备份/同步及对象条数；再次执行须等待八份新阶段报告后核对全零（同步水位字段保留），避免空日志断言误通过。日志不含合成内容、对象路径或凭据标记。

另覆盖实际S3 503：已提交的数据库维护阶段不重复回滚，五条对象删除意图保存attempt=1和至少约五分钟后重试时间，失败诊断保持受控，未成功删除的上传注册仍在。退出后**仅将自有夹具的持久due时间推进到过去**，不宣称自然等待五分钟；新PID暂停仍不发送删除请求，再新PID恢复只续做五个对象删除，先前已清理的生成/Prompt阶段报告0，未到期对象/队列保留。

| 命令 | 源码 | 结果与归因 |
|---|---|---|
| maintenance-bin-matrix-first | 6d27db26… | 0P/1F：夹具ready方案缺preview/confirmationHash，建库约束拒绝；非产品失败 |
| maintenance-bin-matrix-second | 613cc83d… | 0P/1F：夹具误用usage.kind，实际列为action；非产品失败 |
| maintenance-bin-matrix-third | c71ad891… | 初版全阶段暂停/恢复1P，退出0，5.430秒 |
| maintenance-bin-matrix-retry | 5b2cc43d… | 1P/1F：第二例未清独立rate_limit_buckets导致夹具重复键；已显式清本测试库独立表 |
| maintenance-bin-matrix-final | 0bc3067f… | 两例完整2P/0F/0S，退出0，8.085秒；含未来记录逐字段保护与非空报告校验 |
| maintenance-matrix-worker-local | 0bc3067f… | 本机完整集成114P/0F/2S，退出0，39.075秒；2S明确为尚无当前正式镜像，命令显式RUN_WORKER_CONTAINER_TESTS=false |

运行中的Skill完整Electron使用的原1695输入未改变；本轮只在其运行时新增独立worker测试/夹具，结束前再次核对哈希，见[输入归属](../../tests/v25/.results/b77/skill-retention-electron-frozen-inputs.json)。其[终态](../../tests/v25/.results/b77/skill-retention-electron-full-closure.json)为e2d83acc…181P/0F/2S/0flaky，183总计，1398.386秒；2S仍为真实账号密码和真实中转生图key门控。实际34方案文件分17合法ZIP/17明确故意非法输入；17ZIP[扫描](../../tests/v25/.results/b77/skill-retention-electron-full-archive-scan.json)0命中/0错误，19.334秒。以上不能当作后续共享PG函数变更的API回归。

npm地址于UTC13:04再次独立HEAD探测（距前次约80分钟），5.025秒后仍EXIT35/TLS连接失败；没有重复同一正式镜像构建，也没有用旧镜像冒充当前镜像。R04全阶段暂停/失败重试已有本机证据，正式容器及原R01–R05其他条件仍保留。

### 5.76.14 暂存积压与子表锁等待红→绿（2026-09-13，原R01/R02）

新增`staging-retention-boundaries.integration.test.ts`：方案包、来源准备各用真实PG1001行积压，单次最多100，十次100后一次1再0；另一用户未来记录不变，来源表还以相同executionId验证复合身份隔离。包队列最终1001条且owner准确，来源无snapshot时不伪造对象队列。本测试证明父记录处理数量，不把它外推为每次资产明细数量、总耗时或完整GC都已有限。

锁测试实际持有上传注册/来源文件行锁，再调用对应生产retire函数。93c28902…红测2P/2F：两类积压已通过，但两个清理事务都超过4秒探测期限，未返回55P03；finally释放自有持锁连接后await原pending结束，未启动替代操作或遗留进程。首败[结果](../../tests/v25/.results/b77/staging-retention-red-result.json)保留。

修复将既有worker `runRetentionTransaction`原实现移入`packages/db/src/retention-transaction.ts`，从db导出，worker原路径仅转出同一实现，保持其他调用入口稳定。两种scheme清理复用该函数，统一`SET LOCAL lock_timeout='2s'`，按整个事务回滚；连接池后续调用恢复原lock_timeout。没有改变表结构、30/90天期限、各阶段批次大小或新增全局statement timeout。实际子表竞争、整表状态回滚、原池连接设置恢复和释放锁后继续/最终no-op验证通过。

8c2fb7f8…（1700文件）当前证据：

- `staging-retention-green`17P/0F/0S，10.345秒：新暂存4、原retention-batches11和全阶段实际bin2联合通过。
- `staging-retention-check`36/36、26缓存、退出0，61.408秒；当前源码扫描0命中/0错误，1.621秒，源码哈希零漂移。
- `staging-retention-worker-local`本机完整118P/0F/2S，101.293秒；两项正式容器测试仍明确未执行，不能写成全部Worker环境已验。
- `staging-retention-api-full`正以现有完整集成配置运行，产物保留在`staging-retention-api-artifacts`；尚未收取终态、skip及真实ZIP扫描，不预填通过。

B77仍未验收：继续原R02未来时间/时区、生成引用/费用回执故障与剩余锁边界的证据核对，R05完整逐入口/有效来源引用矩阵，以及当前正式worker容器。共享函数的API消费者正在回归；不以以上17项或118项替代原完整验收范围。完整GC、费用父卡、真实旧库/四端/发布部署和管理员继续原任务依赖。


### 5.76.15 时区边界、费用回执/引用回滚与上轮API终态（2026-09-13）

`retention-timezone-receipts.integration.test.ts`在6beaea6e…（1701文件）首次8P/0F/0S，10.671秒，生产代码无新增缺陷修复。真实隔离PG和正式迁移，使用显式2026-11-02T00:00Z，不伪称自然等待30/90天：

- UTC、Asia/Shanghai、America/Los_Angeles各验证30/90天截止前1ms、正好截止、后1ms和未来一天；仅前两类清理，sync水位推进到2且再次no-op不回退，设备和未来行不变；max=1确保时区设置及恢复是同一池连接。
- 已知费用、未知费用两类历史`legacy_unbound`回执，含资产、输入来源引用和上传注册；BEFORE DELETE触发器使整个生成purge失败，队列、回执、费用及引用全部回滚；释放故障重试后仅回执purgedAt/updatedAt/revision按规则变化，原key/费用/结果保留，未来行及注册保留。SQL历史夹具不等同实际付费准入。
- 分别持有回执、资产、来源引用行锁，正式函数在2秒锁策略下返回55P03；验证全回滚、连接设置恢复、释放后继续及最终no-op。

上轮`staging-retention-api-full`已终态退出0，727.849秒，8c2fb7f8…的1700个原输入在结束时全部未变（期间仅新增独立Worker时区测试）。实际699P/0F/1S，总700；唯一skip是专门的一小时自然过期场景，并非漏开数据库开关。[终态](../../tests/v25/.results/b77/staging-retention-api-full-closure.json)及[输入归属](../../tests/v25/.results/b77/staging-retention-api-frozen-inputs.json)保留。留存8个实际ZIP已按manifest哈希分类，内容扫描0命中/0错误，18.710秒；[扫描](../../tests/v25/.results/b77/staging-retention-api-archive-scan.json)。该结果不冒称覆盖后续来源文件预算修改。

### 5.76.16 来源文件总预算：缺陷、修复、门禁与仍待处理的子行（2026-09-13）

原来源retire每次只限制100个父记录，文件SELECT无LIMIT；单个来源1001文件或两个来源合计1501文件都会在一个事务内全部摘key并入队。首轮8bf2c73d…0P/2F属于测试SQL参数类型推导冲突，修正显式text后cb04cb4a…0P/2F才是真实产品红测，分别观察1001/1501超过期望1000，不混淆两类失败。

`packages/db/src/design-scheme-source-cleanup.ts`现在在整个事务内共享RETENTION_BATCH_SIZE=1000文件预算，按relative_path取有限文件，摘key和持久cleanup入队仍在同一事务；现有父候选EXISTS条件继续发现已retired但仍有未采用文件的来源。父候选上限仍100，来源元数据保留，不改变TTL/表结构/有效绑定/上传租约规则。返回值仍表示本次处理的父候选数，续跑同一父记录会再次计数，不能累计当作唯一首次退役人数。物理S3删除仍由后续现有队列执行，本片不证明完整GC发现能力。

永久回归`source-retention-file-budget.integration.test.ts`6项涵盖单/多来源共享预算、两轮排空再0、未来来源不变、实际入队中途失败全回滚、锁住第1001个文件不阻塞第一批而第二批超时回滚/释放后继续、已绑定及有上传租约的1002文件来源始终保持完整且不入队。故障和锁仅施加于自有隔离PG。

| 命令/源码 | 实际结果 | 范围 |
|---|---|---|
| source-file-budget-green / b5e1c966… | 16P/0F/0S，9.969秒 | 最初2项文件预算 + 暂存4 + 时区/回执8 + 正式bin2 |
| source-file-budget-boundaries / 38fe1b33… | 31P/0F/0S，11.179秒 | 扩充后的6项 + 前述14项 + 原批次11项 |
| source-file-budget-worker-local / 146ba8f0… | 217P/0F/2S，总219，74.034秒 | 显式RUN_DATABASE_TESTS=true，运行全部src（含单测与集成）；2S正式镜像启动/强杀恢复，明确RUN_WORKER_CONTAINER_TESTS=false |
| source-file-budget-check / 146ba8f0… | EXIT2，21.344秒 | 新测试pending声明比真实返回联合类型宽，TS2345两处；不是生产运行失败，保留日志 |
| source-file-budget-check-types / 741cfa97… | 36/36，30缓存，EXIT0，59.303秒 | pending改用ReturnType复用真实类型，没有改变生产或测试运行逻辑 |
| source-file-budget-final-tests / 741cfa97… | 6P/0F/0S，36.084秒 | 修正类型后的全部新文件预算回归 |
| source-file-budget-source-scan / 741cfa97… | 0命中/0错误，EXIT0，1.496秒 | 当前源码扫描 |

`source-file-budget-api-full`已终态退出0，712.428秒，实际699P/0F/1S，总700；唯一skip为专用一小时自然期限测试。启动源146ba8f0…，期间唯一变化是独立Worker测试的pending类型；结束时再次核验API/DB生产代码、API用例、配置和依赖未变，[归属说明](../../tests/v25/.results/b77/source-file-budget-api-input-lineage.json)。未改UI或桌面运行时，不把旧Electron结果标作本轮PG改动的证明，也不因此重复已通过的完整Electron。

**R01还存在具体缺陷，尚未修复：** [实际子行诊断](../../tests/v25/.results/b77/retention-child-cardinality-diagnostic.json)在741cfa97…真实PG/正式迁移/生产purge下确认，一个过期generation父记录可删1001资产并入队1001key；一个过期Prompt父记录可删1001使用明细。退出0代表诊断执行成功，绝不代表有界验收通过。仅以合法SQL历史行测数据库维护上限，不将1001资产写成正常用户单次生成上限。

下一步须将诊断固化为长期测试，处理关联行预算和持久续跑，并覆盖：在首批前恢复应完整保留；一旦开始不可逆purge，恢复必须得到明确永久删除结果，不能恢复缺图/缺明细的半条记录；每批费用回执/幂等key保留；队列/删行故障原子回滚；新PID与双维护不重复或遗漏；未来和其他owner保持。不得简单给子表DELETE加LIMIT后直接级联删父行，也不得让超大父记录永久被跳过。生成events、输入引用、Prompt标签链接等实际关联全集也须核对。原R01–R05和B77未勾状态不变。


**§5.76.16最终门禁收取：** 本轮所有工具进程已终态。当前API[完整结果](../../tests/v25/.results/b77/source-file-budget-api-full-closure.json)699P/1S及准确输入归属已保存；8份留存文件均经manifest哈希分类为实际ZIP，[内容扫描](../../tests/v25/.results/b77/source-file-budget-api-archive-scan.json)0命中/0错误，18.364秒。源码1702文件零漂移；文档相对文件链接存在性和git diff空白检查通过（不宣称验证Markdown锚点）。正式Worker依赖下载在UTC13:50再次HEAD探测，仍TLS错误EXIT35，5.029秒；未重复启动无变化的镜像构建，亦不使用旧镜像作为当前证明。当前有可继续修复的R01子行缺陷，整目标保持active，未标记blocked/complete。


### 5.76.17 关联行分批永久删除与恢复保护（2026-09-13，原R01/R02）

前一节1001子行诊断已固化为`retention-child-batches.integration.test.ts`。cf56fd8b…首轮0P/5F（4.722秒）分别证明生成资产、事件、普通输入引用链接、Prompt使用明细、Prompt标签链接均随一个父行直接级联清空，未保留下一批。失败是生产行为，不是测试夹具错误。

已增加共享`packages/db/src/retention-purge.ts`，Worker原入口转出同一实现；API读取/恢复共同识别数据库进度。0024 expand迁移增加`generation_runs`及`prompts`的nullable `purge_started_at`、资产及使用明细的批次索引、两类父状态CHECK、不可撤回标记及六类迟到子写入保护触发器。旧数据默认null且不自动开始purge，不新增公共实体字段。

每次事务最多锁1000父候选；生成资产、事件、普通输入引用链接、方案输入引用四表各1000子行，最多产生2000个资产/方案引用对象意图；Prompt使用明细及标签链接各1000。预算由整个候选集合共享，不是每个父行各1000。只有所有相关子表已空才删除父行，现有FK cascade不能越过本次预算。首批标记后逻辑永久删除，后续依靠持久行恢复，无进程内cursor；独立费用回执在第一批标记purgedAt并只增一次revision，原费用/unknown/接受key保持。对象意图和当批删除同事务，之前已提交批次在后续失败时保留。

API的详情、历史、资产URL/字节、Prompt列表/bootstrap及恢复/手动清理排除进行中的purge记录；方案已接受结果也识别不可用生成结果。单条生成读取和历史使用一致快照，重试读取原生成时保护源行；Prompt使用/同步usage以父行key-share锁同维护协调。数据库拒绝重置标记、恢复deletedAt以及向已开始purge的父行迟到写子行，避免旧进程恢复出半条记录。相关旧代码回滚约束见[数据迁移§32](./V25-DATA-MIGRATION.md)。

`purged`仍只计本批最终删除的父记录，首批仅清理子行时可为0；不是未发生任何工作。`queuedObjects`计当前批次返回的去重key。源码数量/锁等待/事务边界分开描述：每次锁等待2秒不等于整轮SQL或维护总耗时上限，也不等于多个阶段全局原子。

| 验证命令/源码 | 实际结果 | 证明范围 |
|---|---|---|
| child-batches-first-green / 74bdcb91… | 24P/0F/0S，12.315秒 | 新5类1000→1→0、新池继续，加原父批次/时区/费用回滚 |
| child-purge-http-first / b97b8309… | 4P/0F/0S，17.845秒 | 正式API进程/Better Auth/PG：已知及unknown费用部分purge后读/恢复拒绝、第一批前恢复保留、已经等锁的恢复在维护提交后仍拒绝 |
| child-purge-migration-first / faba0245… | 根db:migrate fresh/repeat均0；DB专项9P，整体5.195秒 | 自有隔离PG，迁移25项；有数据0023→0024及重放原字段不变，新字段null；标记不可重置及六表有效迟到写入拒绝；容器清理0 |
| child-purge-restart-first / 90434df1… | 29P/0F/0S，11.681秒 | 子清理后续批次失败完整回滚并仅续剩余；实际正式bin首批成功后SIGKILL、新PID暂停零变更、再新PID完成，两父明细各1001；真实AWSSDK对自有回环S3，最终1005过期key一次清理、未来key保留及no-op |
| child-purge-http-snapshot / 90434df1… | 60P/0F/0S，21.187秒 | 新HTTP4 + 原执行回执/实际资产读取联合，读取快照与重试源保护后的回归 |
| child-purge-final-specialized / fbf60c49… | 9P/0F/0S，9.154秒 | 另补100个父行×每行16方案引用，共1600按1000+600处理；两事务同时清2001资产，各1000不重叠、再1收尾 |

源字段/金额来自明确自有SQL历史夹具；HTTP验证采用真实登录但不伪称这些1001资产是正常单次生成或已支付生产账单。强杀发生在首批已完成后的两个批次之间，不宣称覆盖每条SQL提交瞬间断电。完整GC发现/物理路径安全仍是原后续阶段。

### 5.76.18 本轮统一门禁与尚未关闭的范围

`child-purge-check`在fbf60c49…退出1，11.875秒：新增Drizzle snapshot/journal的格式未符合Biome，保留[日志](../../tests/v25/.results/b77/child-purge-check.log)。Turbo停止其他任务时出现的EPIPE不是另一项已定位产品错误。仅格式化本轮0024 snapshot/journal，没有改DDL或通过删除测试修门禁。

当前8fca6f9d…（1708文件）：`child-purge-check-final`36/36、26缓存、退出0，64.950秒；`child-purge-worker-local`全src227P/0F/2S，总229，103.642秒。显式RUN_DATABASE_TESTS=true、RUN_WORKER_CONTAINER_TESTS=false；两项skip仍是正式镜像启动/强杀恢复，不包装为已通过。源码扫描0命中/0错误，1.667秒。当前SQL与已执行CLI/DB升级专项完全相同，后续仅Worker用例及JSON格式改变，见[迁移输入归属](../../tests/v25/.results/b77/child-purge-migration-lineage.json)。

`child-purge-api-full`已于14:36:01 UTC终态，8fca6f9d…源码零漂移，701P/3F/1S，726.378秒退出1；1S为专用自然一小时期限用例。三项失败及后续修复见§5.76.19。实际保存的8份ZIP均经内容分类与扫描，0命中/0错误、18.367秒退出0；扫描通过不替代功能回归通过。

原R01–R05未缩减、B77未勾选、85/93及剩余8阶段保持。继续对象清理事务/引用复查的锁与结果数量边界、R05逐表逐入口政策核对、当前正式worker镜像及适用完整门禁。已完成的来源文件预算、同步迟提交修复和本轮子表purge不重复开发；完整GC、费用、真实旧库/四端/发布部署和管理员仍按原依赖推进。


### 5.76.19 完整API首败、旧库回滚探针及重试锁修复

完整`child-purge-api-full`的三项失败均保留在[原报告](../../tests/v25/.results/b77/child-purge-api-full-result.json)，没有删除原断言：

| 失败 | 原因与修复 | 实际验证 |
|---|---|---|
| 旧generation回填字段等价 | 0024新增nullable purge_started_at，旧测试用SELECT *却只列0023以前新增字段。补充新字段必须为NULL，仍逐字段比较原请求/状态/费用 | 原前缀升级与回填测试继续运行 |
| 最新前缀24故障回滚 | 旧事件触发器只注入0022索引/0023外键，新迁移不再触发故障。加入0024最后一个用户trigger的DDL故障；schema快照新增retention函数和用户trigger定义 | 要求P0001、整批DDL/账本/旧数据回滚，移除故障后升级及重复执行一致 |
| Session purge与retry并发超时 | 新retry先持源run SHARE、再等费用回执，Session清理需更新该run；锁强度阻塞原已验交错。改为KEY SHARE，阻止永久删除及retention FOR UPDATE，同时允许清理Session关联；新任务入队前继续核对继承Session | 保留原迟到retry拒绝场景，新增retention-first/retry-first两种真实PG锁次序 |

新两种竞争用实际取消后的合法任务与费用回执，添加1001条历史事件以形成两次清理。PG阻塞关系证明两事务确实排队：清理先取得源run锁时，retry等待后因永久清理标记拒绝且不新增任务/回执/队列；retry先取得KEY SHARE时，清理等待其准入提交，随后保留新任务和两张原费用回执。两者均第一批清理1000事件、第二批完成父删除、再次no-op，原回执只更新purgedAt/updatedAt/revision。隔离数据库与拒绝外部IO的夹具不代表真实付费上游验收。

`child-purge-retry-first`在b3ca3674…为47P/0F/0S，15.254秒退出0，覆盖完整升级文件35项与Session文件12项。当前完整检查第一次发现新测试row缺显式类型（TS7006），首败`retention-locks-check`保留；仅增加类型注解并格式化。后续当前专项与完整API按各自源码归属，见[输入差异](../../tests/v25/.results/b77/retention-locks-input-lineage.json)，不把开始于旧源码的报告直接更名。

### 5.76.20 对象队列锁预算与事务回滚（原R01/R02/R04）

新增[真实PG锁回归](../../apps/worker/src/__tests__/object-cleanup-locks.integration.test.ts)：过期参考图入队、删除确认、普通保护丢弃、导入与普通混合保护、活跃租约延后、失败退避六种写入，均持有独立连接的目标outbox行锁。`object-cleanup-locks-red`在7deca4f7…为0P/6F/0S，28.686秒退出1：全部在4秒探针期限仍未结束。测试最终释放自己的锁并等待原操作，未杀业务进程。

生产PostgresObjectCleanupStore各写事务统一复用runRetentionTransaction：SET LOCAL lock_timeout=2s、失败整事务回滚、不污染池中下一次调用。claim仍按100条SKIP LOCKED领取；导入保护延后与普通保护撤销现处于同一事务，不能先提交半批。没有对外开放新的删除权限，也没有给费用审计加TTL。此预算限制单次锁等待，不宣称S3调用或完整维护轮次有两秒总耗时上限。

`object-cleanup-locks-green`在c2608d30…为20P/1F/0S，16.143秒：新增六项均通过，逐表证明失败前后registry/outbox相同、池参数恢复、释放锁后重试成功、已确认删除再调用no-op。唯一失败来自既有Agent过期复制测试的混合时钟：先以25小时未来时间入队，再用PG微秒now()改到期日期并立即用JS毫秒时间领取。测试改为同一显式cleanupAt贯穿入队与领取；不把显式推进时间当作自然24小时等待。

91d60327…（1709文件）的生产代码与该次完整API启动时c2608d30…相同，期间仅API测试类型注解和独立Worker测试时钟改变。最终check36/36、28缓存、62.122秒退出0；完整Worker本机233P/0F/2S（235项）、88.560秒退出0；API升级/Session专项47P、72.815秒退出0；源码扫描0命中/0错误、10.016秒退出0。完整API37521已终态，见§5.76.22；原R01–R05保持开放。


### 5.76.21 同key重放与永久清理的结果一致性

在91d60327…源码，用隔离PG与正式GenerationService做[实际调度诊断](../../tests/v25/.results/b77/replay-retention-diagnostic.json)：保留正常准入后取消的原key，写入1001条历史资产；仅在原run查询真实返回后暂停调用方，允许维护事务完成第一批删除再继续读取资产。结果为原任务正常返回但assets只剩1条，同时purge_started_at已提交。该诊断3.856秒退出0代表诊断执行成功，**它证明缺陷，不是产品验收通过**。未修改上游费用或调用付费服务。

已新增[长期回归](../../apps/api/src/__tests__/integration/retention-replay.integration.test.ts)四项：有独立费用回执的原key、历史缺回执fallback，各覆盖重放先读/清理先锁两种次序。通过真实pg_blocking_pids检查源记录锁，查询仍由正式Drizzle/PG执行，只控制响应交付的调度时机，不伪造数据库结果。原源码0ff66f96…四项全失败（0P/4F/0S，8.856秒），保留[红测](../../tests/v25/.results/b77/retention-replay-red-result.json)。历史缺回执夹具只验证父记录尚在时的旧读取分支，不声称缺回执损坏库在物理删除后仍具有完整付费身份；正式旧库回执回填由迁移矩阵另证。

`findIdempotentRun`读取时持KEY SHARE到资产查询完成：重放先行则清理等待，重放返回完整1001条；清理先行则重放等待并重新检查已提交purge标记，返回GENERATION_RESULT_CLEANED。任务、原Graphile job、已存在费用回执保持原事实；维护首批1000、第二批最后一条及父记录、第三批no-op。同key重放不新建授权或任务。本轮只改原有查询锁，不改变公开实体/API或生成费用政策。

da8fea85…（1710文件）`retention-replay-green`53P/0F/0S，17.643秒退出0，包含新4项、原Session12项、回执和实际HTTP原用例。当前`retention-replay-check`36/36，21.604秒退出0；源码扫描0命中/0错误，0.910秒退出0。相较91d60327…仅API查询锁与新API测试变化，原Worker/db生产代码保持，233P/2容器S继续按原输入归属，不换名成当前另一次全量运行。

### 5.76.22 完整API回归的剩余失败与接续

`retention-locks-api-full`于14:56:02 UTC终态：697P/9F/1S（707项），690.475秒退出1。该次输入c2608d30…到91d60327…的两处测试变动已逐项登记[输入归属](../../tests/v25/.results/b77/retention-locks-input-lineage.json)。八项为原默认约5秒期限内未完成（Agent进程2项、export5项、text新PID1项），另有Agent stale queue断言1项。不能把这些失败删掉或并入skip，也不能未经核实归咎于产品或机器负载。该次8份实际ZIP内容扫描0命中/0错误，18.520秒退出0，扫描通过不等于功能通过。

停止同时运行构建/完整Worker后，在da8fea85…对三个失败文件执行`retention-api-failed-files`，**84P/0F/0S，80.154秒退出0**；未修改这些文件的断言、超时或用例。此结果支持继续核对运行条件，尚不足以声明该次完整回归通过。最新`retention-replay-api-full`已在同一da8fea85…单独启动（工具会话60497），没有重启仍在运行的任务；输出保留至`retention-replay-api-artifacts`。需收取终态、逐项skip、源码漂移和本次实际归档扫描后再填写全量结果。

正式Worker镜像仍有外部下载条件：14:49:22–27 UTC对相同pnpm11.24.0官方tarball的HEAD检查为SSL connection timeout、退出28，5.022秒。未关闭TLS验证、未用旧B76镜像冒充当前镜像、未在下载条件未改变时盲目重跑构建。两项正式容器启动/SIGKILL测试仍未执行；本机正式bin及自有S3进程测试不能代替容器证据。还有可执行的R05/GC工作，因此完整goal保持active。

R05的实际七表、11入口与Skill缓存证据及夹具限制已整理到[生命周期§10.8](./V25-DATA-LIFECYCLE.md)。原R01–R05、B77未勾选、85/93、剩余8大阶段及管理员前置不变；不因任何专项或全量绿测缩小原验收范围。


### 5.76.23 完整API终态与新增宿主验证输入

§5.76.22中的60497已于15:15:02 UTC结束：`retention-replay-api-full`在da8fea85…源码为710P/0F/1S（711项），700.638秒退出0；唯一skip仍为专用自然一小时包期限。收取结果时1710份源文件零漂移，见[终态记录](../../tests/v25/.results/b77/retention-replay-api-closure.json)。本次实际8份合法ZIP内容扫描0命中/0错误、18.415秒退出0。先前697P/9F/1S及三个失败文件84P保留历史，当前完整运行未改变那些原断言或超时。

之后新增一份Electron用例，当前9f6ecc6d…为1711文件；相对完整API源码只有`tests/v25/electron.agent-retention.spec.ts`新增，生产/API/Worker输入不变，见[输入差异](../../tests/v25/.results/b77/agent-retention-input-lineage.json)。不因新增独立宿主用例重命名旧报告或重复执行完整API。

### 5.76.24 真实G/R/S清理、非空账本与新PID重放

新增[长期Electron测试](../../tests/v25/electron.agent-retention.spec.ts)两项分别走单条永久清理和清空回收站。自有临时userData、真实Electron/SQLite、独立API/PG/Worker、受控回环图像/文本/GitHub/对象存储构成执行链；无真实付费上游。正式方案初始来源由合成SQL夹具建立，Skill则实际通过GitHub reader读取自有回环内容。

真实登录启用云连接后，通过IPC云生成一次；通过鉴权Automation HTTP实际执行G（生成）、R（方案运行）、S（Skill）各一次。七张表先断言非空：audit 4、spend_requests 4、spend_calls 5、policies 1、budget_periods 1、managed_requests 1、managed_checkpoint 1。四张正式来源表亦各1行。全字段快照只在测试中比较，附件保存计数/哈希，不保存密钥或账本明文。

无证明的HTTP Prompt删除403且无变化；实际签发文件质询后删除200，同一证明重放403。随后Prompt、Session和两条生成历史分别经真实IPC单条purge或empty-trash处理；两张实际图片文件消失，R/S两张产物的字节哈希与四表来源保持。关闭宿主后以新PID重启，七表逐字段仍相等；向实际HTTP重放原G/R/S请求，均回同一任务且成功，没有新增图像/文本/GitHub或云生成调用。源Prompt为本地记录，云请求使用其文本副本，不冒称云Prompt外键来源。

| 门禁 | 源码 / 结果 | 解释 |
|---|---|---|
| agent-retention-first | 94f85503…，0P/2F，21.096秒 | 新测试漏传Prompt必填description，IPC拒绝；保留首败 |
| agent-retention-valid-input | c8779967…，0P/2F，21.394秒 | 补description后仍缺必填nullable negative；按实际contracts补齐negative/folderId/modelId/params |
| agent-retention-contract-input | b32e4740…，2P/0F/0S，24.193秒 | 两条新真实业务流通过 |
| agent-retention-check | 2366c9a6…，退出1，9.529秒 | 增加GitHub无重复读取断言后新文件Biome格式失败；只格式化新文件 |
| agent-retention-check-final | 9f6ecc6d…，36/36、33缓存，14.305秒退出0 | 当前统一门禁 |
| agent-retention-electron-joint | 9f6ecc6d…，10P/0F/0S/0flaky，64.300秒退出0 | 新2项、日志1项、本地管理5项、Session生成清理1项、CLI/MCP1项联合 |
| agent-retention-source-scan | 9f6ecc6d…，0命中/0错误，0.739秒退出0 | 本轮源码扫描 |

联合报告见[实际结果](../../tests/v25/.results/b77/agent-retention-electron-joint-result.json)，完整命令及时间见[命令摘要](../../tests/v25/.results/b77/agent-retention-electron-joint-summary.json)。这10项不替代全部Electron/四端或费用父卡；未知结果、换号、备份恢复等仍按原C3/P5/P6范围核对。七表非空与实际物理清理填补§10.8所列具体证据缺口，完整GC发现、路径攻击、持久删除失败恢复仍待。

15:17:29–34 UTC新增IPv4官方pnpm tarball检查仍SSL连接超时（退出28、5.023秒）。正式Worker镜像两项仍待；B77未关闭，原R01–R05与剩余8阶段保持。


### 5.76.25 Desktop永久清理误删：真实负例与持久清理服务（原D02）

核对现有两条生产入口后，加入四条使用真实临时文件/SQLite的长期负例：单条purge删除受管根外原件、清空回收站沿目录symlink删除根外原件、两条入口各删除仍由存活作品引用的同一图片。`local-purge-path-red`在04a9effc…为46P/4F/0S，1.827秒退出1；四个新负例全部实际丢失文件。没有接触正式用户路径。

已新增共享[本机资产清理服务](../../packages/core/src/services/local-asset-cleanup.ts)，两条IPC入口统一调用；`local_asset_cleanup`经Desktop Drizzle增量0012生成，并内联为13项迁移，属于必需表。清理意图与作品/资产行删除处于同一个SQLite事务，意图不挂作品或账号cascade。路径只存在本机服务/SQLite，日志只记固定错误码和聚合计数。

只允许pictures/previews内的真实常规文件，不把整个userData当图片目录；源文件本身symlink、根外文件和目录保留为blocked。记录canonical路径与device/inode，执行时重新检查；文件身份变化拒绝删除。每轮最多100个到期意图；磁盘失败保留原意图和有上限的指数退避，原件仍可用。缺失文件可确认，已被替换文件不能被旧意图删除。被引用项延后且不增加失败次数；临时故障不作为成功ack。

保护查询覆盖剩余generated_assets、存活generation的params_json.referenceImages、独立方案库design_scheme_assets与source_files（包括相对legacy store_key）。流式读取引用，只保存候选路径的集合；两SQLite库锁保护引用核对至文件决定完成。源码主进程单实例所有权锁继续存在。应用启动及每分钟调用同一drain，退出先停止定时器。当前候选入队按每页100条读取避免全量资产数组；**这不等于整个作品删除事务只处理100行**，也不等于完整D02的所有类别/未知孤儿发现已交付。

第一次实现`local-purge-path-green`44P/6F：better-sqlite3在活跃iterator期间拒绝同连接写入，事务回滚；改用有界分页读取后再入队。新专项`local-purge-durable-first`63P/3F：两项ESM模块不可spy、一个来源夹具使用了错误列名；改为包装真实fs.unlink的单次故障注入，并按真实SQLite来源schema建夹具。随后65P/1F为macOS /var与/private/var路径别名的预期不一致；生产存canonical路径正确，测试改比较realpath。以上首次失败均保留原报告，不删除断言。

最终`local-purge-durable-final`在a044a929…为66P/0F/0S，1.780秒退出0：新增9项持久清理/旧0011升级与重放，原接管7项、两IPC文件50项。新9项验证入队故障整事务回滚、删除失败/重开两库/精确退避重试、旧意图面对新inode、缺失文件no-op、执行参考图/方案来源保护、1001文件分11轮清完、数据库/目录/文件symlink禁止删除，以及旧作品逐字段保留。单元“crash窗口”通过保留队列并改变文件状态模拟，不冒称真实进程SIGKILL。

统一检查第一次a044…仅新Electron附件链式调用格式错误（退出1，12.172秒）；格式修复后e0ddf9bf…发现导出函数默认数据库参数TS4076（退出1，28.434秒）。加显式Database.Database类型后bb3558c5…check36/36、0缓存、52.361秒退出0，build3.622秒退出0，源码扫描0命中/0错误、0.766秒退出0。随后只改新Electron夹具目录，354a2955…check再次36/36通过，34.845秒退出0。生产/API/Worker归属见[输入核对](../../tests/v25/.results/b77/local-purge-input-lineage.json)。

### 5.76.26 实际Electron磁盘权限故障与启动重试

[新Electron用例](../../tests/v25/electron.generation-file-cleanup.spec.ts)两项分别走single和empty-trash：真实受管文件、共享作品、根外原件与目录symlink；通过POSIX目录权限制造unlink失败，原IPC删除记录后检查持久失败事实。恢复目录权限并将已有重试时间明确改为到期，再以新PID启动验证自动续清。不是自然等待60秒，也不是实际付费上游；Windows需原生ACL故障夹具，本用例明确不冒充Windows证据。

`local-purge-electron-first`在bb3558c5…为2P/2F/0S/0flaky，39.892秒：原Agent费用保留两项均通过；两项新夹具错误地沿普通核心路径放文件，E2E宿主实际使用userData/Pictures，因此生产正确blocked。按宿主system/paths.ts修正夹具目录，保留生产保护。当前354a2955…`local-purge-electron-owned-path`已4P/0F/0S/0flaky，41.460秒退出0；单条删除PID18928→18935、清空回收站PID18949→18956。两条目录权限故障均实际留下attempt_count=1及固定失败原因，恢复权限/显式到期后新PID启动清完；外部原件、共享资产及原Agent两条七表费用保留均通过。见[实际宿主结果](../../tests/v25/.results/b77/local-purge-electron-owned-path-result.json)和[当前进展摘要](../../tests/v25/.results/b77/local-purge-progress.json)。

当前最终源码扫描0命中/0错误、0.745秒退出0，1716文件零漂移。完整`local-purge-electron-full`已于15:56:36 UTC启动，工具25444，显式开启RUN_DATABASE_TESTS=true；必须收取本轮结果及实际归档扫描，不能使用旧181P/2S替代主进程/SQLite变更后的完整门禁。完整API710P/1专用小时S与Worker233P/2正式容器S的生产输入未改变，只按原来源沿用；当前完整Electron尚未填通过。

原D02仍须继续全部资产目录/未知孤儿发现、staging、S3兼容服务、全部引用类别和并发OS路径替换的安全验证。本轮仅证明列明的静态路径/身份替换和引用保护，不声称抵御任意本机恶意进程在最后检查与unlink之间修改父目录。B77原R01–R05及正式Worker镜像待验保持，85/93和剩余8阶段不变。

**正式镜像条件变化（2026-09-14北京时间；日志用UTC）：** 15:57:45–46 UTC官方pnpm tarball IPv4 HEAD已退出0，1.138秒。此前TLS阻断已发生实际变化，因此按原apps/worker/Dockerfile启动当前源码镜像`musefold-worker:b77-354a2955`构建（23219）。Corepack阶段已通过，依赖下载仍有重试；需收取构建终态、镜像ID，再执行原两项正式容器测试。没有用旧镜像或关闭TLS验证。完整Electron25444仍在运行，源码保持354a2955…冻结。任务包校验器退出1，明确85/93与一项未勾验收，不把阶段结果当作整包验收。


### 5.76.27 当前正式Worker镜像与1001参考图积压补验（2026-09-14）

网络条件恢复后，原Dockerfile镜像构建于16:03:05 UTC完成，164.078秒退出0。当前镜像为linux/arm64、非root用户musefold、正式tsx src/bin.ts入口，镜像ID为`sha256:f8fbb7a500978d25c9f841adda25253d8682d1231b7bf593701410fd7b7825e7`；[镜像与源码归属](../../tests/v25/.results/b77/local-purge-worker-image-evidence.json)保留构建和测试入口。

显式开启RUN_DATABASE_TESTS及RUN_WORKER_CONTAINER_TESTS，并选择刚构建的镜像运行原container-runtime.integration.test.ts：**2P/0F/0S，9.297秒退出0**。第一项实际容器正常停机/新容器新PID保持结果、上游只调用一次；第二项上游已接受后SIGKILL退出137，替换容器将执行与费用回执标记unknown，迟到响应及重复投递不能重新发送。租约在隔离PG中明确加速到期，不代替自然10分钟期限证据。测试使用自有真实HTTP/PG/对象存储夹具，不代表实际收费上游或生产部署。原Worker233P/2容器S的两项条件已有本次独立正式容器证据，旧报告的skip原样保留。

另对原R01每类1001+要求补做[参考图积压诊断](../../tests/v25/.results/b77/reference-backlog-diagnostic.json)：真实PG1001条过期upload加1条未过期他人记录；实际AWS SDK向自有回环S3写入1002对象，然后正式processObjectCleanupBatch按100×10+1处理，逐轮校验expiredReferences/deleted、对象剩余数量和未过期记录全字段。最终1001对象及登记行清完、队列为空，未过期对象与记录保留，再执行全部计数0。4.485秒退出0；这不是生产S3或自然TTL测试。待完整Electron终态后固化长期回归，当前源码冻结354a2955…不变。

完整Electron25444仍在运行，B77/D02均未关闭；正式镜像下载条件已解除，不再把先前TLS失败当作当前阻断。


### 5.76.28 B77原R01–R05最终验收及接续（2026-09-14）

**仅B77原范围已验收，整包与完整GC仍未闭合。** [25条逐项验收](../../tests/v25/.results/b77/acceptance.json)关联当前源文件哈希、实际执行用例与门禁；覆盖每类1001+积压/子行预算/复合身份、30/90天与时区/恢复/回滚/锁预算、同步迟提交/水位/HTTP恢复、正式维护暂停/准确计数/新PID，以及七表审计/权限/日志和Skill暂态政策。G-DATA-02的无意图对象发现、其他资产类别及完整物理删除竞争，C3/C5/P5/P6的费用与恢复联合范围继续，不随B77关闭。

| 最终证据 | 实际结果 / 源码 | 范围与限制 |
|---|---|---|
| local-purge-electron-full | 354a2955…；185P/2S/0F/0flaky，1413.593秒退出0 | 完整Electron；2S为真实账号密码、真实中转站图像Key缺失，逐条见[终态](../../tests/v25/.results/b77/local-purge-electron-full-closure.json)，不是未执行的普通数据库测试 |
| full实际归档 | 34份文件中17实际ZIP、17故意无效输入；17ZIP扫描0命中/0错误，23.876秒退出0 | 实际产物按内容分类，未把坏输入或UI文本算合法ZIP |
| current-sync-publication | 354a2955…；7P/0F/12S，6.431秒退出0 | RUN_DATABASE_TESTS=true只开启PG文件；另外两文件要求值1。保留本次配置遗漏 |
| current-sync-http-clients | 354a2955…；12P/0F/0S，36.491秒退出0 | 使用RUN_DATABASE_TESTS=1补跑真实HTTP3项与两独立SQLite客户端9项；不将前一报告改写成19P |
| reference-backlog-check | e0c19cb5…，1717源文件；36/36、31缓存，17.745秒退出0 | 仅新增独立Worker长期回归；其余生产/Electron输入与已通过完整E2E完全相同，见[归属](../../tests/v25/.results/b77/reference-backlog-input-lineage.json) |
| reference-backlog-worker-full | e0c19cb5…；236P/0F/0S，39.166秒退出0 | 全src、真实PG及正式镜像门控全部打开；新1001参考图长期回归与原正式容器两项均实际通过 |
| reference-backlog-source-scan | e0c19cb5…；0命中/0错误，0.779秒退出0 | 当前源码；源码零漂移，真实归档另扫 |

当前正式镜像及8份实际镜像关键生产文件与宿主源码逐字节哈希相等，见[镜像内容核对](../../tests/v25/.results/b77/worker-image-source-bytes.json)。这不等于基镜像漏洞、全部镜像层或生产环境安全扫描。API710P/1专用自然小时S保留da8fea85…归属，API/PG生产输入未变；必要PG0024 CLI/升级及SQLite0012内联13项旧库升级/重放证据逐项关联，未用当前普通check中DB skip替代实际集成。

R05授权11入口矩阵证明真实HTTP守卫及一次性质询，不声称业务ops spy覆盖全部管理业务；七表三费用状态保留、真实G/R/S正常链/物理清理/新PID，以及备份/换号其他父卡各自保持证据边界。原冻结UI与Cloud MCP只读边界未变。此前所有失败、修复与重跑原样保留。

任务包仅勾选B77，现86/93；剩余第4–10阶段共7个大阶段。下一按G-DATA-02推进完整资产目录和无DB意图孤儿发现，不重复已验保留期机制，也不提前开发管理员。


## 5.77 原 G-DATA-02：上传保护与真实对象存储故障（2026-09-14）

本轮是完整 GC 的推进，不关闭原 D02.1–7。发现并修复 `findProtected` 对未链接但 TTL 有效的 Composer/方案图片上传保护缺失；共享 registry 的专用包仍由独立 stage 状态和上传租约裁决。真实字节、权限、超时和重启矩阵见[生命周期§13](./V25-DATA-LIFECYCLE.md)。下一接 D02.3 无 DB 记录对象发现，不将已有 outbox 当作 inventory。

最终源码 1720 文件，摘要 `4651236e4b91a063b4884decec0399d1847da99e62c7521f7b7b66f41aa7a270`。相对 B77 `e0c19cb5…` 只修改 Worker `tasks.ts`、原 object-cleanup 集成测试，新增真实存储测试与两个夹具，共五个文件；API/PG schema/Desktop 生产输入不变。此前验收仍按原输入保留，不声称重跑完整 API/Electron。整体保持 86/93、剩余 7 大阶段。

| 门禁/测试 | 实际结果 | 报告（`tests/v25/.results/d02/`） |
|---|---|---|
| PG 上传 TTL 红测 | 5P/2F，uploading/available 两状态均复现未保护 | `upload-lease-red-result.json` |
| 初次修复后原文件 | 7P/0F/0S；包括两类上传到期前1ms/到点 | `upload-lease-green-result.json` |
| 首次 MinIO | 1P/2F；root 策略绕过与重启随机端口两个夹具错误 | `storage-runtime-first-result.json` |
| 修正夹具 | 3P/0F/0S，5.361秒 | `storage-runtime-corrected-result.json` |
| 增加实际 PUT 响应超时 | 4P/0F/0S，5.979秒 | `storage-runtime-ambiguous-put-result.json` |
| 第一次完整 Worker | 237P/1F/4S，38.617秒；原包取消测试揭示 registry TTL 额外延长包租约。MinIO 文件标记 failed、四项 skipped，JSON 没有保留 setup 堆栈，原因未判定；不把它算成主动条件跳过 | `upload-storage-worker-full-result.json` |
| 包独立生命周期修复后联合 | 18P/0F/0S，7.252秒；不改旧包断言，保留取消后在途上传租约保护 | `upload-package-joint-result.json` |
| 最终统一检查 | 36/36，31缓存，18.266秒，退出0 | `package-aware-check-summary.json` |
| 最新原 Dockerfile Worker 镜像 | 61.886秒，退出0；linux/arm64，非root musefold，原CMD | `package-aware-image-summary.json`、`package-aware-image-evidence.json` |
| 最终完整 Worker，开启 PG 和正式容器测试 | **242P/0F/0S，25文件，39.243秒，退出0**；default+JSON 双报告保留诊断；四项 MinIO 与两项最新镜像容器均实际通过 | `package-aware-worker-full-result.json`、同名 `.log` |
| 最终源码扫描 | 0命中/0错误，0.739秒，退出0 | `package-aware-source-scan.json` |

最终镜像 `musefold-worker:d02-package-aware` 的 ID 为 `sha256:3e4b68dd8b5469dd7aaafae6358c581a63db49f3f071ae5eee5591384baf5937`。实际容器读取 `/app/src/tasks.ts` 哈希与宿主最新文件一致，均为 `b714ef0b8d80b0c0a76422d5ee41f9a1f8c53968e03021eceefba81537bd7d86`；不以旧 B77 镜像代替本次修改。固定 MinIO ID/version 在最终 `.log` 的 `[gc fixture]` 中记录，版本为 `RELEASE.2025-09-07T16-13-09Z`，服务与 DB 均为无生产数据的独立临时容器。

真实存储测试证明：未过期对象 GET 字节不变，到点 HEAD 404；匿名 DeleteObjects 返回 HTTP 200 + AccessDenied 时不 ack；12次真实失败后 abandoned，恢复队列后重新检查新引用；原生产上传函数经过响应丢失代理，MinIO实际收到一次成功 PUT、客户端 TimeoutError、DB 意图留存，后续回收；真实停机/重启后字节和重试恢复。上传对象内容是测试字节，时间与重试等待显式加速，不宣称图片上游/收费、生产环境或自然 TTL 演练。

完整 GC 的未知对象发现、所有资产类别/引用竞争、Desktop staging/Windows，以及后续费用/旧库/四端/发布部署仍未验收。汇总为[本轮推进证据](../../tests/v25/.results/d02/upload-storage-progress.json)，当前保持 goal active，不创建后台、不关闭完整 GC。


## 5.78 D02.3 对象发现与0025迁移推进（2026-09-14，完整API进行中）

新增受管对象扫描和独立候选观察，详见[生命周期§14](./V25-DATA-LIFECYCLE.md)与[数据迁移§34](./V25-DATA-MIGRATION.md)。本轮没有实现新候选物理删除执行器，不把已发现或超过宽限期等同于可安全删除。当前整体86/93、剩余7大阶段；原D02.1–7全部验收出口保持。

最终源码1731文件，摘要 `95394369c2421514cc3ffdf5aa6ae4a8325c095d951cf378d39bb94d09da6538`。新增0025 migration两表、共享引用查询、inventory扫描和真实进程/迁移/对象存储测试；原HTTP替身补合法ListObjects页以适配新的周期任务，不把替身作为真实存储证据。未改Desktop产品代码。

| 本轮记录 | 实际结果 | 报告（`tests/v25/.results/d02/`） |
|---|---|---|
| 首次inventory/引用/包联合 | 19P/2F；新7项通过，两个旧包夹具的“立即到期”跨PG/Node时钟精度后可能尚未到期 | `inventory-first-result.json` |
| 首次check | fixture SQL字符串引号编辑错误，退出1；已修 | `inventory-check-first-summary.json` |
| 类型/统一检查 | 36/36，37.532秒，退出0 | `inventory-check-typed-summary.json` |
| CLI迁移与扫描联合 | 12P/1F；实际CLI迁移通过，另一个旧包初始队列仍取默认now，已改明确过去的fixture期限，断言不变 | `inventory-migration-result.json` |
| 新实际bin专项 | 1P/0F/0S，6.620秒；SIGKILL与新PID恢复、两个暂停别名 | `inventory-bin-first-result.json` |
| 最终专项联合 | **23P/0F/0S**，8.416秒；包含1001对象、同内容覆盖、非空游标故障/并发、CLI迁移和实际bin | `inventory-joint-final-result.json` |
| 最终check第一次 | 原未改动的本机1001文件测试命中5000ms超时，退出1；保留首次失败，不放宽断言/超时 | `inventory-check-final-summary.json` |
| 本机失败文件隔离复核 | 9P/0F/0S，1.325秒；没有改该文件 | `inventory-local-gc-isolated-result.json` |
| check完整复核 | **36/36，32缓存**，38.458秒，退出0 | `inventory-check-recheck-summary.json` |
| 正式原Dockerfile镜像 | 65.534秒，退出0；当前4个Worker文件及新DB schema/0025 SQL实际包内hash等于宿主 | `inventory-image-summary.json`、`inventory-image-evidence.json` |
| 当前完整Worker | **251P/0F/0S，29文件**，45.518秒，退出0；开启真实PG和最新镜像容器测试 | `inventory-worker-full-result.json` |
| 当前源码扫描 | 0命中/0错误，0.862秒，退出0 | `inventory-source-scan.json` |
| 首轮完整API（已终态） | **706P/5F/1S**，670.644秒，退出1；四项自然租约队列清空及一个0025前缀回滚故障注入失败 | `inventory-api-full-result.json`、`inventory-api-full-summary.json`；实际8份ZIP已扫描通过 |

最新正式镜像ID为 `sha256:5acc0643fc2882bd819dbd7c039536fd63e08a3ead9cabe848eff9521b4c7c82`，linux/arm64、非root musefold、原CMD；不以旧镜像代替新增扫描/迁移输入。MinIO实际版本仍为固定 `RELEASE.2025-09-07T16-13-09Z`。

删除条件探针只在独立临时桶执行：修改时间不匹配和ETag不匹配分别仍得到HTTP204，HEAD确认对象消失。该MinIO版本没有执行这两种测试中的删除条件，因此最终候选执行器不能只依赖这些header。探针原始结果为 `inventory-delete-condition-probe.json`，源码阶段汇总为[本轮进度证据](../../tests/v25/.results/d02/inventory-progress.json)。继续实际可用的对象身份/发布竞争保护、删除失败重试和剩余完整GC条件；不关闭D02.3或启动后台。

### 5.78.1 API 回归修复与删除发布竞争核查（2026-09-14）

首轮完整 API 的四项自然租约测试仍保留旧的 S3 HTTP 测试服务：桶级 `ListObjectsV2` 落入对象 GET 的404分支，新增五分钟inventory cron留下两个反复失败的队列任务。此处发现目录协议缺口，但第二轮仍失败，进一步根因见§5.78.2。原队列清空断言正确，不过滤inventory任务、不改10分钟租约或20秒清空等待。补桶级分页、metadata、XML转义及独立对象GET屏障；永久协议回归先实际复现 `NoSuchKey`，再修复通过。第五项为最新迁移前缀已变为25，但故障注入只覆盖到0024；保留既有三种注入点，增加0025最终索引，继续验证所有pending DDL/ledger/data整体回滚及再次升级等价。

本轮只变动三份API测试/fixture文件，没有修改API、Worker或DB生产输入。源码1732项，摘要 `f47c94663076b207d2994a9f5e55067852739a0df0418608edfdeae941bbd742`，归属见 `source-inventory-api-fix.json`；上一轮251项Worker、实际CLI及正式镜像保持各自原输入归属。

| 执行 | 实际结果 | 报告（`tests/v25/.results/d02/`） |
|---|---|---|
| 新协议红测 | 1F，真实SDK收到404/NoSuchKey，0.790秒，退出1 | `inventory-api-protocol-red-result.json` |
| 协议及全部升级前缀专项 | **37P/0F/0S**，14.044秒，退出0 | `inventory-api-fixture-upgrade-result.json` |
| 当前统一检查 | **36/36**，38.597秒，退出0 | `inventory-api-fix-check-summary.json` |
| 当前源码扫描 | 0命中/0错误，0.711秒，退出0 | `inventory-api-fix-source-scan.json` |
| 首轮实际归档扫描 | 8个实际ZIP，0命中/0错误，18.407秒，退出0 | `inventory-api-archive-inventory.json`、`inventory-api-archive-scan.json` |
| 完整API第二轮（已终态） | **707P/4F/1S**，688.566秒，退出1；迁移回滚已通过，四项自然租约清空仍失败 | `inventory-api-fixed-full-result.json`；另8个实际ZIP扫描通过，18.402秒 |

另外，在独立临时PG与实际MinIO中，清理最终引用检查结束后由独立SQL提交一个canonical资产，再执行真实删除，结果是canonical行仍为1、对象HEAD404且outbox已ack。此探针证明当前DB缺少通用发布屏障，**不声称普通产品API允许传入任意objectKey或已证明同一用户路径**。证据：`publication-race-probe.json`，4.700秒退出0；该退出码表示复现探针预期成立，不表示产品安全条件通过。

隔离数据库原型进一步验证“同key事务锁＋持久退休摘要＋canonical发布trigger”的三种实际锁等待：发布先提交时保留资产/不退休；退休先提交时迟到发布被拒；退休事务回滚时发布成功。三个次序通过，3.655秒退出0，`publication-fence-prototype.json`。原型仅安装在一次性数据库，不是生产迁移或完整安全删除实现；所有canonical/租约写者、锁顺序、在途PUT及旧outbox仍须接入和验证。完整G-DATA-02及86/93、剩余7阶段不变。

### 5.78.2 实际 cron 元数据兼容修复（2026-09-14）

第二轮API仍有四项队列清空失败。核对当前安装的Graphile 0.17.3 `dist/cron.js`，`makeJobForItem` 会给每个自动调度任务加 `_cron: { ts, backfilled }`；原inventory严格schema只接受mode，实际定时任务因此抛出 `InvalidInventoryRequest`，两个cron任务保留重试。之前实际bin专项经 `add_job('{}')` 手动触发，只证明生产消费者/进程恢复，没有证明自动cron成功，不能再把这两项等同。

新增永久红测2P/1F后，生产schema明确接受可选的严格 `_cron` 结构（ISO时间、boolean backfilled），不接受任意扩展字段、prefix或对象key；日志不输出元数据，默认record/dry-run和受管scope不变。新增长期实际bin测试不手动入队、不覆盖时钟或crontab：由原五分钟cron自然产生任务，用独立PG观察trigger记录真实payload，验证候选持久化、任务清空、原字节保留及分钟边界。该测试最长等待五分钟，本轮已在实际17:55UTC调度点通过。

当前1732项源码摘要 `16c915a7d0ddb1f84ea92bad2a981c85d9b1cf4d4344ccf943076a5d104964c8`，相对f47仅新增三处Worker生产schema/就地测试改动；见 `source-inventory-cron-fix.json`。统一check首次因两份scratch探针格式失败，保留原探针`.source.txt`后格式修正，复验36/36、17.872秒退出0。生产源码/断言未因该格式问题改变。原Dockerfile镜像构建48.234秒通过，当前四Worker文件及两DB输入实际包内hash相等，镜像 `sha256:a369394f5a9936b9dc3ecb3095fbd65fecec2cb13107de08bc9b6cf94a3a18cc`，linux/arm64非root，证据 `inventory-cron-image-evidence.json`。

原cron专项 `inventory-cron-bin-result.json` 已5P/0F/0S，275.967秒；开启实际PG/当前镜像的完整Worker `inventory-cron-worker-full-result.json` 已253P/0F/0S，29文件，153.237秒。两次实际bin PID分别41018和41983，均由原crontab在2026-09-13T17:55:00.000Z自然调度，PG观测到backfilled=false，扫描候选持久化、任务完成、字节保留。当前源码扫描零命中/错误，2.009秒通过。最新完整API `inventory-cron-api-full-result.json` 正在运行（会话34468），其 `inventory-cron-api-artifacts/` 必须待终态后分类并扫描，尚不记完整API通过。未关闭D02.3或完整GC，仍为86/93与7阶段，管理员前置保持。


### 5.79 删除授权与新引用发布之间的数据库保护（2026-09-14，进行中）

实际 PG/MinIO 重现了“清理最终查询结束后插入引用、随后字节仍被删除”的竞争。新增 0026 expand 迁移及 Worker 删除授权：逐 key/执行命名空间事务锁、锁后独立语句复查引用与租约、提交仅保存 SHA-256 的永久退休标记，然后才访问对象存储。有效引用发布遇到已退休 key 必须拒绝；过期同 epoch 租约不能复活，新 attempt/epoch 保持原恢复语义。该保护现已进入生产源码，不再只是隔离原型。

| 验证 | 实际结果 | 报告（tests/v25/.results/d02/） |
|---|---|---|
| 原缺陷红测 | 1 失败，真实对象已删除但晚到引用可提交 | publication-red-result.json |
| 首批实际删除与原清理回归 | 41 通过 | publication-first-result.json |
| 发布/退休锁次序、超时回滚、各写入表及实际 CLI 升级 | 16 通过 | publication-matrix-result.json |
| 全迁移前缀与最新 0026 最后 trigger 故障回滚 | 37 通过 | publication-upgrade-result.json |
| 统一检查 | 36/36，通过；首轮仅生成 JSON 格式失败并已修复 | publication-check-final-summary.json |
| 最新正式 Worker 镜像及 11 个包内文件摘要 | 构建通过，实际包内摘要与宿主一致 | publication-image-evidence.json |
| 当前完整 Worker | 262 通过 / 2 失败 / 4 跳过，尚未收口 | publication-worker-full-result.json |
| 失败定向重现 | 3 通过 / 4 失败；真实 MinIO 已启动 | publication-worker-failures-result.json |
| 当前完整 API | 会话 46908 仍在运行，不能预记通过 | publication-api-full-result.json（终态后核对） |
| 当前源码扫描 | 0 命中 / 0 错误 | publication-formatted-source-scan.json |

当前源码摘要 `0e3600f0f3cbff4dc0e0f0a7a93d193d88cc6bb157588a577f4b0b7bd5605fc4`，1740 文件。完整 Worker 失败原因：两个维护用例复用了已退休 key，但测试重置没有清空无 account 外键的退休表；MinIO 健康接口先于 CreateBucket 实际就绪，导致整套四项未执行。定向运行另确认原 12 次失败后恢复用例的新发布会被永久退休政策拒绝；应分别验证退休任务重试与升级前 abandoned 任务的新引用保护，不能删除原恢复要求或解除生产退休标记。后续停机恢复用例还受到前例遗留行影响，保留原失败。

上一源码 `16c915a7…` 的完整 API 已终态：711 通过 / 0 失败 / 1 专用小时测试跳过，645.313765 秒；8 个实际 ZIP 分类扫描 0 命中/错误。其报告为 inventory-cron-api-full-result.json 与 inventory-cron-api-archive-scan.json，仅属于上一源码，不代替当前新增 0026 的完整 API。

本节只推进原 D02.2–4。inventory 候选实际删除、状态/重试/abandoned、全资产与 Desktop staging 原范围均继续；不关闭 G-DATA-02、迁移整包或管理员前置。


### 5.79.1 Worker 恢复测试收口及新发现的参考图关联竞争（2026-09-14）

0026 版本的完整 API 已终态：712P/0F/1S（专用原一小时期限测试），685.234963 秒；8 个实际 ZIP 扫描通过，publication-api-archive-scan.json。仅修改三个 Worker 测试/fixture 后，`72ac0b30…` 的定向8P、check36/36、源码扫描、完整 Worker269P/0F/0S（32文件，223.080818秒）通过。实际原五分钟 cron 于18:35UTC执行。生产输入与原正式镜像/API输入一致，精确差异为 publication-test-fix-inputs.json；不能把该轮通过归给后续0027。

继续独立 SQL 并发探测发现0026缺口：link trigger读取上传记录旧key后等待旧key锁，另一事务可把registry改到新key；GC退休新key后，link仍可提交，形成1关联+1退休标记。真实PG探测reference-link-race-probe.json（2.804228秒）证明缺陷，范围是数据库写入边界，不声称公开API提供任意改key接口。

永久测试reference-link-publication.integration.test.ts先1P/2F：等待期间registry可改key，以及inactive但已关联registry可改到退休key。新增0027追加迁移，保留0026历史摘要：读取registry时FOR SHARE；inactive但有link的registry写入也执行退休检查。原合法cleanup状态变化仍允许。修复后联合实际PG/MinIO/CLI 24P/0F/0S（6文件，6.55625秒），未改原失败断言。

升级首轮命令误用包含整目录的test:integration脚本；实际最新前缀故障暴露event trigger未订阅CREATE FUNCTION。保留日志并向已核实的自有Vitest52697发SIGINT，原97735终态130，59.960085秒，未记为通过；确认原进程组无残留。修复测试事件订阅后用exec vitest精确选文件，当前7125运行；check67962、正式镜像58231正在运行。当前源1743文件`ac4016a86d1ae0a59ddbab40d19b988ddc8f6a506065a560ba09f6ae23b5471f`，新源码完整API/Worker尚未开始。见reference-link-progress.json。完整候选删除与原D02范围继续。


**§5.79.1 当前完整验证进展：** 精确升级38P/0F/0S，50.186474秒；check36/36，50.120565秒；源码扫描0命中/0错误，0.742258秒。正式镜像构建101.078613秒通过，中途registry ECONNRESET由原构建自动重试恢复；镜像`musefold-worker:d02-reference-link`，ID`7aebe95746b08f6ae730195a4cbec4f107bbc186cb555049169a0dae05a1a899`，linux arm64/非root/原CMD，12个相关Worker/DB/迁移文件实际包内与宿主摘要一致。当前完整API72124（reference-link-api-full，独立reference-link-api-artifacts）与完整Worker74971（reference-link-worker-full，启用真实PG和该正式镜像）均已启动并重查为运行中。源摘要ac4016a8…无漂移；完整结果及新实际归档扫描待终态，不能预记通过。任务包仍86/93，原G-DATA-02未关闭。


### 5.80 原 D02.3 候选对象实际删除执行器（2026-09-14，进行中）

上一0027版本完整回归已终态：Worker272P/0F/0S（33文件，285.324576秒）、API713P/0F/1专用小时S（690.458251秒），8实际ZIP扫描通过（18.455183秒）。这些结果对应ac4016a8…，不代替本节0028新执行器完整验收。

**生产实现**：0028对独立inventory候选表增加claim token/租约、尝试次数、下次尝试、上次错误/时间和abandoned时间，保留已有观察信息。原inventory任务在扫描后最多领取20项、4项并发，10分钟领取租约，单次存储请求30秒上限；已有两个别名、全局暂停、record/dry-run沿用。最终事务锁候选与key/命名空间，在同一事务中复查有效引用/租约并提交退休授权；网络IO在事务外。文件信息变化则重算24小时宽限；不存在则幂等确认；存储错误保留5分钟至24小时退避，第12次失败或最后一次领取后失联可见为abandoned。扫描不修改已领取/abandoned记录，计数只包含实际提交行；人工重试仍复查引用。对象退休哈希不随删除成功而删除。

| 验证 | 实际结果 | 报告（tests/v25/.results/d02/） |
|---|---|---|
| 首轮实际存储联合 | 10P/6F，未变化对象被误判为变化 | inventory-delete-first-result.json |
| 独立存储字段探测 | 同一对象List时间含毫秒、HEAD时间截断到秒，etag/size一致 | storage-metadata-probe.json |
| 改用精确key目录字段复查后 | 15P/1F；匿名权限fixture还需授权精确key的List读取 | inventory-delete-metadata-fixed-result.json |
| 扫描/执行及abandoned回归红测 | 5P/2F；计数虚增及失败观察被刷新 | inventory-delete-scan-red-result.json |
| 修复后PG/实际MinIO/原保护/CLI联合 | 33P/0F/0S，7文件，13.026233秒 | inventory-delete-joint-result.json |
| 真实bin暂停/dry-run/SIGKILL/新PID接手删除 | 1P；2项因本次名称过滤未运行，7.767807秒 | inventory-delete-bin-result.json |
| 0027已存在候选/游标及0024业务数据实际CLI升级，各两次 | 2P/0F/0S，9.447639秒 | inventory-delete-cli-result.json |
| 全前缀与新增0028故障回滚 | 39P/0F/0S，15.38299秒 | inventory-delete-upgrade-result.json |
| 统一检查（新增CLI测试前） | 36/36，通过49.355422秒 | inventory-delete-check-summary.json |
| 当前统一检查 | 93040运行，新增一条CLI保留测试后重查 | inventory-delete-cli-check-summary.json（待终态） |
| 正式镜像/包内源码 | 构建57.448988秒，14相关文件摘要与当前宿主一致 | inventory-delete-image-evidence.json |
| 当前完整Worker/API | 88572 / 57375运行中，不能预记通过 | inventory-delete-worker-full-result.json / inventory-delete-api-full-result.json |

当前源码1747文件`7a3af09f981909ee830e1f9ddbdde2077ca54fedf3d38a722c6655e964980f82`。镜像`musefold-worker:d02-inventory-delete`，ID`24340a7bab3e860512d6118d418d2d34ed5b984c3794319b4004b7b0eda6bfe9`，linux arm64/非root/原CMD；构建后仅新增CLI测试内容，生产输入相同，详见包内摘要证据。实际bin强杀PID58805→新PID58809，HEAD已经到达真实存储但响应被自有代理保持；旧领取保留，新进程删除完成且HEAD404。只加速本例候选宽限和失联领取到期，不把加速过程写成自然24小时/10分钟验证。2个按名称过滤的同文件用例留待完整Worker，包括原自然五分钟cron。

33项联合中的新执行器9项覆盖七类对象、活跃上传/非受管原件保护、scope/dry-run/原宽限、最终授权前后引用、新旧池领取竞争、相同内容和不同内容覆盖、删除后ack失败、实际HTTP200 per-object Errors十二次失败/人工恢复、末次失联可见abandoned/恢复时新引用、真实存储停机重启和1001对象有界排空。1001排空使用独立新PG连接池，真实进程退出证据单独来自bin，不能混称。

本节实际删除代码已实现，但新源码完整回归、晚到PUT/全引用租约和服务边界联合、Desktop全类别staging及原D02.1–7仍待收口。未新增后台写动作；七阶段、86/93及管理员前置不变。


### 5.80.1 完整Worker收口与Desktop暂存目录缺陷（2026-09-14）

0028首轮完整Worker为281P/2F/0S，143.969525秒。一个用例把两种覆盖及秒级等待放在同一默认5000ms时限中，在全量运行时超时；1001用例未能领取首批。后者未保留当时各对象期限明细，不能声称已有完整故障快照；源码核对发现fixture把“开始时间+24小时”误作所有实际对象到期，忽略后续写入或时钟领先的修改时间。修复仅涉及Worker新测试文件：两种覆盖独立执行，用目录毫秒时间等待实际变化，不提高默认测试时限；推进到持久化eligible_at最大值。另新增真实对象“修改时间晚于观察时钟”的用例，证明提前一秒不能领取，到实际期限才允许删除。

修改后定向11P，11.010418秒；当前完整Worker285P/0F/0S（34文件，103.523276秒），check36/36（30.314709秒）及源码扫描0命中/0错误（2.153914秒）。实际原五分钟cron于19:10UTC执行。当前源码1747文件`fc12ecc52054ee3677590f1151e88e55bf0706006ebf4cb8653b5069149745cd`。API57375仍运行；其生产/API输入及正式镜像不受这一个Worker测试文件变化影响，差异记录inventory-delete-clock-inputs.json。API实际终态和本轮独立产物扫描仍待，不能预记通过。

**原D02.5实际缺陷探测**：在自有临时根内创建一个“原件”目录，并把受管staging根替换为指向该目录的符号链接；执行当前DesignSchemePackageStaging.cleanupOwner(11)后，原件被删除。desktop-staging-link-probe.json记录originalPreserved=false，0.676277秒，退出0表示缺陷成功复现。全部路径都在一次性测试目录，未使用实际userData。此结果证明当前按字符串拼接后rmSync不足以保护受管根，尚未修复；下一接根目录/祖先身份校验、启动残留回收及真实Electron原件保留，保留原D02.5双窗口/暂停/崩溃等范围。

## 5.81 Desktop 方案包 staging 路径保护、在途生命周期与启动回收（2026-09-14）

本轮继续原 **D02.5/6/7**。完整资产 GC 尚未验收，任务包保持 **86/93、剩余七阶段**，管理员不提前开始。上轮云候选实际删除的完整 API 已终态 **714P/0F/1 专用自然一小时条件 S**，8 份实际 ZIP 扫描 **18.514336 秒、0 findings/0 errors**；原 Worker **285P/0F/0S** 与输入归属保留在 `inventory-delete-progress.json`，不将这些后端结果当作本轮 Desktop 的运行证据。

### 实际缺陷与变更

- 新增永久回归 `package-staging-boundary.test.ts`：旧实现 **0P/7F**，实际复现初始 root symlink 下 `cleanupOwner` 删除外部原件、root/owner/stage 链接替换与普通目录替换仍进入导入、清理 owner 提前删掉在途消费文件，以及 inspection 等待中取消后仍发布 stage。全部 fixture 只使用自有临时目录。
- 新 `PackageStagingDirectory` 固定可信父目录及受管链各目录的设备/inode/birthtime 身份；仅在可信父边界首次规范化系统别名，受管链逐级拒绝符号链接与身份替换。生产明确以当前 `userData` 为可信父，不把 `staging` 链接自动提升为可信目录。不再用递归 `rm` 清理 root/owner/stage；只 unlink 受管平面文件名，再 rmdir 空目录，未知条目留下等待处理。
- 复制先校验普通源文件，再同步打开源/目标描述符并核对源身份；流消费已打开描述符，`pipeline` 收齐关闭后再进入受管清理。仍保留字节上限、SHA256、格式检查与消费前独立 verify 副本。
- preparation 有独立取消标记，inspection 或复制在途时不会被回收，也不能在取消后重新发布。消费中清理 owner/退出会阻止后来的重复调用，但文件保留到已受理的唯一导入结束；同一 owner 新 stage 不受旧消费 finally 影响。
- `application.ts` 取得独占 owner lock 后、窗口创建前启动受管 orphan 扫描。每批最多 **20 个目录条目**，未知条目也计预算；每个 stage 每次最多处理 **32 个文件**。满批 1 秒后继续，扫描完 60 秒后重扫。保留 preparation、preview 和 consumer，不用墙钟年龄过期活跃 stage。目录未成功删除就留在磁盘作为可重发现清理意图；内存 pending 和安全计数可观察，退出释放扫描句柄并停止 timer。**尚不声称具有跨重启持久化的 attempt/backoff/abandoned 元数据**。

### 验证与首败保留

| 验证 | 真实结果 | 证据（`tests/v25/.results/d02/`） |
|---|---|---|
| 旧实现缺陷红测 | 0P/7F，0.891453 秒 | `desktop-staging-boundary-red-result.json` |
| 第一轮修复，既有 staging/host 联合 | 23P/0F，0.876840 秒 | `desktop-staging-boundary-first-result.json` |
| 增补恢复、目录替换、超大 orphan、长期 preview、退出保护 | 30P/0F，0.885833 秒 | `desktop-staging-recovery-first-result.json` |
| 当前 staging/host/archive 专项 | 35P/0F/0S，3.763297 秒 | `desktop-staging-focused-result.json` |
| 第一次 check | lint 失败：新增 Playwright 空对象参数；保留 11.317170 秒原失败 | `desktop-staging-check-first-summary.json` |
| 第二次 check | TypeScript 失败：generator.return 缺显式参数；保留 12.764037 秒原失败 | `desktop-staging-check-second-summary.json` |
| 参数修复后 check | 36/36，38.773572 秒；生产源 f91f3ba9… | `desktop-staging-check-typed-summary.json` |
| Desktop build | 3.663190 秒、exit 0 | `desktop-staging-build-summary.json` |
| 第一轮真实 Electron | 3P/1F：新建第二窗口未装载预加载桥；窗口安全配置保持不变，改为显式使用当前构建的 v25 preload | `desktop-staging-electron-focused-result.json` |
| 修正测试窗口装配后真实 Electron | **4P/0F/0S/0 flaky，9.177306 秒** | `desktop-staging-electron-preload-result.json` |
| 报告路径修复 | 首次相对 JSON 输出落入 `tests/v25/tests/...` 被 lint 收集；原报告逐字节归档后仅移除误放副本，后续用绝对输出路径 | `desktop-staging-check-preload-summary.json` |

真实 Electron 的四条为：①实际 **PID 68663 SIGKILL → PID 68668**，确认旧目录在强杀后仍存在，新主进程启动回收且所选原件不变；②两真实 BrowserWindow 分别持有 stage，销毁第二窗口只回收其目录，正常退出再回收第一窗口；③启动前 root symlink 指向自有外部原件目录，prepare 被拒且启动/退出均保留原件；④实际 POSIX 权限失败保留 orphan，恢复目录权限后 **PID 68687 → PID 68693** 成功回收。原生 Windows ACL 对应场景仍待目标平台证据，未用 POSIX 结果代替。

本轮运行时代码在 `f91f3ba9…` 后未变，仅 Electron 第二窗口 fixture 改为显式 preload。最新源清单 `source-desktop-staging-final.json`：**387fc8976e29cdff2201cdf358890839813cd7e4949fdd72309e8daa9f470449 / 1750 文件**。最终 check、完整真实 Electron 和本次归档扫描仍按后续记录写入实际终态，不预记通过。

### 仍须继续的原范围

完整 Electron 回归与实际方案包归档扫描必须收齐；继续审核独立进程在系统调用间主动替换路径的边界、慢复制/进程暂停的实测覆盖、Windows 原生路径及权限、其他 Desktop 暂存类别。云端晚到 PUT 与完整服务引用/租约矩阵、所有资产类别和原 D02.1–7 仍开放。四条实际窗口测试不代表整张 GC 卡关闭。

### 5.81.1 更严格的跨进程路径替换：确认剩余缺陷与原型证据

完整 Electron 对 `387fc897…` 的回归运行期间，生产源码保持不变。`staging-unlink-race-probe.json` 在隔离目录实际复现：在最后一次父目录检查与 `unlinkSync` 系统调用之间，通过 `node:fs` 包装器注入确定性调度点，启动独立 Node 子进程把 stage 移走并换成指向自有外部原件的链接；随后执行**当前生产方法的原 unlink**，结果 `externalOriginalPreserved=false`。子进程实际成功，所选输入原件仍在；仅自有外部测试原件被删除。这是受控调度点下的真实 OS 目录替换，**不是未注入调度的随机压力测试**。准确命令/脚本和 0.694435 秒终态均留存。

因此当前身份检查修复不能据此宣称覆盖所有跨进程竞争。下一修复必须把删除操作锚定在已经验证并持有的目录句柄上，而不能继续增加一次 `realpath/lstat` 来替代原子性。复制目标的创建、verify 的打开、目录创建与删除也要审查同一条件。

已用自有 `.results` 中的 N-API/POSIX `unlinkat(dirfd, basename, 0)` 原型做独立验证，未接入任何生产文件或安装包。真实子进程替换目录后，持有的目录句柄仍只删除原 stage 的副本，外部原件保留；在 **Node 25.8.1** 与当前 **Electron 43.2.0 / Node 24.18.0** 两个运行时均成功。证据 `staging-relative-unlink-node.json`、`staging-relative-unlink-electron.json`，原型源码/编译命令见同名前缀与 `.results/v25/2026-09-14-development/d02/*.source.txt`。该结果只证明 POSIX 原语可行，不算产品修复、Windows 支持或正式包验证。

Windows 实现需采用相同句柄锚定语义；微软文档提供相对 `RootDirectory` 打开与禁止跟随重解析点的原语：[NtCreateFile](https://learn.microsoft.com/zh-cn/windows/win32/api/winternl/nf-winternl-ntcreatefile)，以及通过已打开句柄标记删除的 [SetFileInformationByHandle](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-setfileinformationbyhandle)。这些是实现候选，尚无 Windows 本轮运行证据。原型应补参数校验、句柄释放/重复关闭、打包路径和本机 CI 后才可接入，不直接分发实验 `.node`。

最新 check **36/36、15.268480 秒**（`desktop-staging-check-final-summary.json`），当前源扫描 **0 findings/0 errors、0.754166 秒**（`desktop-staging-source-final.json`）；完整 Electron 正在原句柄 **24728** 运行，计划 **191 项**，按真实终态收证。全 GC 和 D02.5 均保持开放。


## 5.82 Desktop 方案包原生目录句柄接入与实际安装包验证（2026-09-14）

本节承接 §5.81.1 的实际误删缺陷，继续原 G-DATA-02 / D02.5；**86/93、剩余七阶段不变**，不以新增专项通过替代完整资产 GC 验收。

### 前轮完整回归终态

`387fc897… / 1750 文件` 的完整 Electron 已结束，**188P / 1F / 2S / 0 flaky，1419.492345 秒**；原会话 24728 已终态。唯一失败是 `electron.package-disk-full.spec.ts` 在空 staging 根已被清理后直接 readdir 得到 ENOENT。实际磁盘写满已发生，但后续恢复断言当轮尚未执行；不能称全绿。测试修正为仅将 ENOENT 视为空集合，其他 IO 错误仍抛出，保留实际 ENOSPC、原件/SQLite 不变、新 PID 恢复与重启持久化全部断言。前轮实际归档分类为 20 ZIP、17 故意无效输入；20 ZIP 扫描 19.525039 秒、0 命中/0 错误，见 `desktop-staging-electron-full-archive-*`。

### 实现与边界

1. 新增零 workspace 依赖的 `@musefold/managed-fs`，作为仅允许 Desktop 主进程/core 消费的 Node-API 8 叶子包。原生对象使用类型标签、明确关闭与 finalizer；文件描述符转交 Node 后由调用方关闭。拒绝伪造/已关闭句柄、路径分隔符、NUL、点路径和无效枚举批量。
2. POSIX 使用 pinned directory + openat/mkdirat/unlinkat，创建、读取、枚举和删除均相对于已持有目录句柄；目录/文件不跟随符号链接，目标独占创建，读文件拒绝 FIFO 等非普通文件。每个枚举器拥有独立游标，结束或退出释放句柄。
3. Windows 候选实现使用相对 RootDirectory 的 NtCreateFile、禁止重解析点跟随和句柄删除/枚举；**已写代码，不代表已完成 Windows 编译或原生运行验证**。同平台/架构编译和实际 ACL/junction/文件身份/关闭行为仍需验收。
4. `PackageStagingDirectory` 接入该能力；保留可信父和目录身份复查，但最终 IO 不再依赖可能被替换的字符串路径。`DesignSchemePackageStaging` 的目标复制、verify 打开、包读取采用原生描述符；校验字节及 SHA256 后直接将 Buffer 传给实际 importer，防止消费回调再次按绝对路径读入另一份包。
5. 共享产品界面、实体契约、gateway、preload 和 Cloud MCP 能力没有新增。原生资源从开发构建目录或安装包 `resources/native/managed_fs.node` 加载，无网络下载或不安全路径回退。根 dev/test/build 已补编译前置，electron-builder 将原生资源放在 ASAR 外。
6. 原生目录句柄只解决 IO 定位；所有权、引用/保留期和可删除文件名仍由业务检查。Desktop 跨重启的 attempt/backoff/abandoned 元数据尚未实现，其他临时资产类别及全 GC 不据此关闭。

### 实际测试结果与首次失败

| 验证 | 实际结果 | 证据（`tests/v25/.results/d02/`） |
|---|---|---|
| 首次生产接线联合 | 121P/1F；domain 测试替身未转发新增 bytes 参数 | `managed-fs-staging-first-result.json` |
| 原生与 domain 接续 | 83P/1F；原生20项已通过，domain 旧断言仍期待两参数 | `managed-fs-native-tests-result.json` |
| 修正替身与断言后六文件联合 | **153P/0F/0S，2.233228秒** | `managed-fs-staging-matrix-result.json` |
| 生产原生边界竞争覆盖 | 上述含12条：root/owner/stage × 创建/读取/枚举/删除，原生调用前真实独立子进程换目录，原件保留 | `package-staging-boundary.test.ts` 对应结果 |
| importer 实际字节消费 | 路径被替换、路径被删除仍正确导入素材；无效 bytes 不回退读取有效路径。新增3项在完整check通过 | `managed-fs-check-final.log` |
| 完整check（安装包测试修订前） | 38/38，55.793101秒；默认数据库条件skip不冒充实际PG集成 | `managed-fs-check-final-summary.json` |
| 真实Electron专项 | **5P/0F/0S/0 flaky，25.508024秒**；含完整ENOSPC恢复 | `managed-fs-electron-focused-result.json` |
| 实际专项归档 | 4个实际ZIP，7.084492秒，0命中/0错误 | `managed-fs-electron-focused-archive-scan.json` |
| 首次实际macOS arm64打包 | exit0，46.853314秒；实际App/DMG/ZIP及ad-hoc签名验证 | `managed-fs-package-mac-summary.json` |
| 首次安装包冒烟 | 3P/1F；把已签名与链接器签名的原生文件原始摘要直接比较，未到导入断言 | `managed-fs-package-smoke-first-result.json` |
| 签名比较修正后安装包冒烟 | **4P/0F/0S/0 flaky，22.053141秒**；实际UI/IPC导入、staging清空、旧库前缀10/11迁移与重启 | `managed-fs-package-smoke-signature-result.json` |
| 首次安装包安全扫描 | **失败：3命中/0错误**；同一原生模块调试符号带入构建用户目录，分别在App/DMG/ZIP发现 | `managed-fs-package-scan.json` |
| 去除调试信息后的原生构建 | exit0，0.868390秒；二进制不再包含构建用户目录，正式包待复跑 | `managed-fs-native-no-debug-evidence.json` |

跨进程竞争测试使用确定性调度注入和真实独立子进程，未声称是无调度注入的随机压力验证。真实 Electron SIGKILL **PID77809→77814** 回收遗留 stage；权限恢复 **PID77833→77837** 回收 orphan。所有文件/数据库为一次性 fixture，不访问正式用户库，不产生 Provider 费用。

签名比较修正位于测试 helper `native-package-identity.ts`：先验证原生签名，仅对临时副本调用 codesign 去签名，规范化签名增长留下的 `__LINKEDIT.vmsize`；其余全部字节（代码、数据、UUID、导入和其余加载命令）仍精确比较。没有改安装包或源码二进制来让测试通过。首败和剥离后仍差一处内存分配字段的探测保留。安全扫描命中则通过 `binding.gyp` 禁止发布调试符号修复，未添加扫描豁免。

### 当前输入与继续验收

当前源码 **43777dbd23a2b28103b41d11bc60258bcc47c8d078a1d15e0fa3549b38d8c5c5 / 1760文件**（`source-managed-fs-no-debug.json`）。此前 `e9dfaccc… /1759` 对应首次check/真实Electron，`ba94b204… /1760` 仅新增/修正签名测试 helper；当前再修改原生构建配置去除调试符号。不能把去符号前的安装包结果直接算作最终产物通过。

当前去符号构建的完整check运行中，随后重新打包、安装包冒烟、App/DMG/ZIP扫描及完整Electron；终态记录在本节续记。原D02.5的暂停/慢复制和Windows实际边界、Desktop其他资产类别/持久重试、云端晚到PUT及全服务引用/租约矩阵继续。之后依次费用C3/C5→P5/P6→真实旧库→实际平台→发布门禁→生产部署回滚/远程MCP；完成v2.5全部原验收后才接管理员。


### 5.82.1 去调试符号后的实际产物终态与完整回归启动

最终 `43777dbd… /1760` 输入已检查无漂移。去符号后的 **check38/38，57.331875秒**；最终原生/方案包六文件 **156P/0F/0S，3.575309秒**。`pnpm run package:mac:adhoc` **46.591623秒、exit0**，生成真实App/DMG/ZIP并完成ad-hoc签名验证；新安装包 **4P/0F/0S/0 flaky，23.938296秒**，实际UI/IPC导入并清空staging，两个合成受管旧库前缀升级和新PID持久化通过。

最终 App/DMG/ZIP 安全扫描 **20.801173秒，0 findings/0 errors**（2安装归档、6扫描目标），原三处构建目录命中消失，无新增豁免。源码扫描 **0.862990秒、0命中/0错误**；安装包冒烟生成的1个实际方案ZIP扫描 **0.081909秒、0命中/0错误**。源码/测试、构建命令、产物摘要和扫描范围见 `managed-fs-progress.json`、`managed-fs-package-scan-no-debug.json` 及相应 `*-summary.json`。最终native本地文件SHA256 `cf58c748b24c2851f50317e8a944a2d51c7dd4352c42f69165116cfe7979ef4d`；随包已签名文件 `8c814fff33be2bbc881590ac3d0f4e8a320453606605a2929d3f5f65a9159f41`。electron-builder重新编译原生依赖，使用当轮实际构建二进制比对，不能把先前Node编译二进制摘要当成本次随包摘要。

最终完整 Electron 已使用 `RUN_DATABASE_TESTS=true` 启动，报告 `managed-fs-electron-full-result.json`、原会话 **1586**；**运行中，不预记通过**。保持测试/源码/构建输入不变，收齐真实终态后再分类扫描该轮生成的包。此前专项与安装包结果不替代本轮完整回归，也不替代Windows实际编译/运行、真实旧用户库、其他资产类别或完整GC。spec核对仍返回未验收（86/93、一条总验收未勾选），与本节范围一致。


## 5.83 完整回归期间的剩余 IO 边界核对（2026-09-14，修复前证据；后续见 §5.84）

原生方案包最终输入 `43777dbd… /1760` 的完整 Electron 仍在原会话1586运行。本节只读取生产源码并在自有临时目录构建隔离探测；不改该轮源码、测试或构建输入。以下是新发现的原 D02 任务缺口，不能因 §5.82 的156专项或安装包通过而忽略。

| 缺口 | 原生产实现的实际证据 | 后续修复及验收 |
|---|---|---|
| 方案包选择源在 lstat 后变成 FIFO，主进程同步 open 阻塞 | `staging-source-fifo-probe.json`：独立子进程将自有普通源文件移走，原路径换为真实 FIFO；生产 open 不带 O_NONBLOCK，观察进程3000ms超时后仅对该子进程SIGKILL，原件仍在 | 选择源打开加入非阻塞标志，随后继续 fstat 普通文件及身份校验；正式就地回归用独立进程证明立即拒绝，不以增大超时或跳过FIFO替代 |
| 本机生成资产清理仍用路径 unlink，存在相同 syscall 间隙 | `local-asset-unlink-race-probe.json`：真实临时SQLite入队并删除原generation记录；最终检查后独立子进程移走图片父目录并链接到自有原件目录。结果 `originalPreserved=false`、原受管生成文件仍在，计数deleted=1且队列n=0 | 将 core 清理 IO 接入目录句柄能力；保留原双SQLite事务、引用复查、文件身份、批量、失败退避和重启语义。真实跨进程替换后原件必须保留，不得对未删除目标伪造成功/清空意图 |

两项都是在真实生产函数调用的 syscall 边界注入确定性调度点，再由独立 OS 子进程实际修改文件系统；没有操作正式App、用户库或用户素材，不声称无调度注入的随机压力覆盖。

FIFO最小修复已只在隔离bundle中验证：`staging-source-fifo-proposed-fix.json` 同样的真实替换得到 exit0、`REJECTED_WITHOUT_BLOCKING`，原件保留。候选源码在 `.results/v25/2026-09-14-development/d02/package-staging-nonblock-proposed.source.txt`；**未装入生产**，不能以该实验关闭缺陷。原全量终态收齐后转入正式源码和就地测试，再执行适用完整门禁。

core生成文件持久清理此前的B77证据只覆盖列明静态路径/身份与引用条件；本节并不抹去那些结果，也不把它们外推为主动OS路径竞争已验。完整GC及七阶段保持开放，管理员仍等待全部v2.5。对应资产创建/引用/租约/删除者的最新核对见生命周期文档§18。


## 5.84 完整 Electron 终态、真实暂停与 core 清理正式接线（2026-09-14）

**仍为86/93、剩余7大阶段，当前第4阶段完整资产GC。** §5.82–5.83中“1586运行中”和“未接生产”是各自记录时的状态，以下终态与新源码接线覆盖这些状态，原失败证据保留。3个开发与联合验收阶段后，仍有4个真实环境/发布阶段；管理员在全部v2.5验收后开始。

### 前一冻结版本的完整终态

`43777dbd… /1760` 完整Electron已结束：**189P/0F/2S/0 flaky，1380.202776秒，exit0**。报告 `managed-fs-electron-full-result.json` 和命令摘要同名前缀；原1586已终态，不再重启或视为运行中。2项外部凭据条件跳过保持未验。37个实际输入分为20个合法ZIP与17个故意无效夹具；20 ZIP扫描 **19.534517秒、0 findings/0 errors**，见 `managed-fs-electron-full-archive-{inventory,plan,scan}.json`。这些结果属于该冻结版本，不代替下面新core/FIFO源码的完整门禁。

另以实际独立Node进程执行同版生产staging和正式native模块，复制真实256MiB包，在读取256KiB、目标已写196608字节时SIGSTOP。父进程确认OS状态T，实际等待**64000ms**再SIGCONT，期间部分文件保留；恢复后即时及60秒维护均保护在途对象，校验/preview成功、原件摘要一致，最终cleanupAll清空stage。`staging-paused-copy-probe.json` 保留PID1368、计数、hash及终态。**这是实际Node进程与生产函数证据，尚不等同Electron窗口或Windows暂停验收**，没有模拟墙钟。

### 正式实现与验收边界

- 选择源打开加入O_NONBLOCK，保留fstat普通文件及原身份检查。新的就地测试在独立子进程中使用生产模块，在源open前由另一实际子进程换成真实FIFO；及时拒绝并保留原件。超时仅终止该自有子进程，不会阻塞Vitest进程。
- native新增`fileIdentity`：POSIX以fstatat/AT_SYMLINK_NOFOLLOW读取普通文件身份；Windows候选以相对句柄和FILE_READ_ATTRIBUTES取身份，后者仍未实际编译/运行。避免把读取文件内容的权限当作删除受管文件的前提。
- `core/local-asset-file.ts`依次持有受管根与祖先目录句柄，核对叶子文件身份后相对句柄删除；原双SQLite事务、引用保护、批量100、持久失败退避、缺文件确认和替换阻断保留。CoreRuntime通过主进程注入native能力，主进程统一选择开发/安装包可信资源。缺能力时保留重试，不回退字符串unlink。
- 实际临时SQLite测试在删除系统调用前让独立子进程分别替换root/ancestor/parent；均仅删除原受管目录中的目标，外部原件保留，deleted计数和队列确认匹配真实文件结果。另验叶子身份检查时替换阻断、原件保留和缺能力持久退避。它们证明列明的确定性调度窗口，**不代表所有OS文件替换窗口、其他资产类别或完整GC已验收**。
- CLI/serve目前不调用该drain；未给CLI暗加启动清理。Composer上传、未提交生成图片、scheme-sources、已导入保留资产及所有引用/租约继续按生命周期§18补齐。

### 本批测试与接续

初版源码 `67a31049… /1764`（`source-local-asset-native.json`）正式原生构建exit0；7文件专项**67P/0F/0S、2.868026秒**，`local-asset-native-focused-result.json`。全仓check首轮**37/38、exit1、52.958332秒**；根测试2816P/1F/48S，唯一失败为workbench-domain旧测试自行配置CoreRuntime时未注入新native能力，文件按设计保留待重试。修正该fixture接入真实native，保留原“文件实际消失”的断言。

新源码 `6b10e19e… /1764`（`source-local-asset-native-runtime.json`）仅比上一版增加该测试装配，生产代码相同。修正后完整check **38/38、exit0、41.592644秒**（`local-asset-native-check-runtime-summary.json`），根测试**2817P/0F/48条件S**；当前源码扫描 **0 findings/0 errors、0.736375秒**。新源码实际macOS arm64打包 **52.107570秒、exit0**；包内UI/IPC导入及旧前缀升级冒烟 **4P/0F/0S/0 flaky、24.606737秒**，实际App/DMG/ZIP扫描 **23.480846秒、0 findings/0 errors**，冒烟1个实际方案ZIP扫描 **0.069984秒、0命中/0错误**。命令/摘要见`local-asset-native-package*`及`managed-fs-progress.json.followUp`；仅本机ad-hoc产物，不宣称正式签名/公证或其他平台。输入再次核对零漂移后，新版完整Electron（RUN_DATABASE_TESTS=true，原会话24942）已启动，报告`local-asset-native-electron-full-result.json`；**运行中，不预记通过**，终态后分类扫描当轮实际归档。当前专项及前一版完整结果不能用于勾选G-DATA-02或D02.5；完整Windows、其他资产类别与持久stage重试、云端晚到PUT/全引用租约仍开放。


## 5.85 未入账生成图片的实际缺陷与隔离候选（2026-09-14，未正式安装）

当前 `6b10e19e… /1764` 完整Electron保持原24942运行，源码/测试/构建不变。继续D02全资产而非仅方案包：通过实际`generate`→取消/Provider返回→业务提交路径，使用受控进程内Doubao Provider结果和真实一次性SQLite/文件，取得以下证据。没有请求实际Provider，没有用户数据；目录替换为确定性调度点的独立OS子进程。

| 实际场景 | 当前生产结果 | 隔离候选结果 |
|---|---|---|
| 方案source_files仍引用迟到图片 | source行保留，文件被rm删除，清理队列0 | 文件保留，队列1并受引用保护 |
| 另一保留generation的params.referenceImages仍引用 | 保留run仍在，图片被删，队列0 | 图片和原run保留，队列1受保护 |
| 文件删除失败 | 文件保留但无持久意图，日志包含原文件路径（报告仅记录布尔值） | 队列pending/attempt1/安全错误码；无路径日志。重开两库后按持久next_attempt_at触发，真实删除成功、队列0 |
| 最终rm前独立进程替换父目录 | 外部自有原件被删，原受管生成文件仍在，队列0 | 已持有目录句柄内原受管文件被删，外部原件保留、队列0 |
| Provider返回图片后，generated_assets插入触发真实SQLite故障 | 返回failed，资产0，图片留下且队列0 | 返回failed，补偿删除实际未引用图片，队列0 |

原证据 `uncommitted-assets-probe.json`，命令exit0表示上述缺陷按预期复现，不是5个产品测试通过，耗时0.265000秒。候选在esbuild的onLoad中仅替换隔离bundle，原文件未改；`uncommitted-assets-proposed-probe.json` 0.313037秒，五场景按右列成立。候选元数据原写rm边界，实为native unlinkFile；`uncommitted-assets-proposed-verified.json`保留原报告SHA256并纠正说明，不伪装重新执行。候选源码为`.results/v25/2026-09-14-development/d02/uncommitted-{cleanup,generation}-proposed.source.txt`，**不是发布实现**。

正式接线需复用`local_asset_cleanup`：增加统一入队入口，在已返回文件但取消/终态失败/资产落库异常时补偿，保持双SQLite引用检查和native句柄删除；错误日志只给安全计数。不得让过期transport上下文写入当前账号数据。CLI/serve目前没有native port，正式变更须补兼容装配/产物验证或明确持久接续，不能静默让其原清理失效。仍须覆盖Provider在返回前部分写盘失败、进程硬崩溃无意图窗口、所有资产引用、其他Desktop类别与完整D02.1–7；这五场景不缩小父卡范围。

上传引用核对同时确认：workbenchDraftSchema不存图片；当前Composer图片存于页面references内存state，generation落库后才有原图片路径，不能把“workbench_drafts查不到图片”当成孤儿。方案run适配器会再拷上传副本，并在失败/finally直接rm与吞错，需纳入同一保留引用/租约/重试边界。实际源码落点与类别清单见生命周期§18。


### 5.85.1 真实 Electron 暂停验证的首败与契约修正

为补齐§5.84仅Node进程的边界，以当前完整Electron同一构建另起自有userData/实际窗口，生产preload prepare IPC复制真实256MiB包。读到256KiB时暂停实际主进程PID14968，目标已写196608字节；父进程检查OS状态T，实际等待64000ms再SIGCONT。复制最终完成，实际维护日志持续保护stage。后续导入验证**首轮失败**：探测代码将prepare结果中的`sizeBytes`一并送给严格import契约，生产正确返回VALIDATION_FAILED，不是导入通过。探测的退出清理未在期限内结束，复核PID/父进程后仅终止该自有Electron；完整回归24942未动。

原失败保留`electron-paused-copy-probe-summary.json`（exit1、227.390317秒）、日志和`electron-paused-copy-owned-timeout.json`。按canonical import契约只发送stagedPackageId/packageHash/formatVersion，并在准备结束后恢复观察包装、为退出设置独立截止；同源码第二轮原会话53308正在验证，**未预记通过**。这是测试fixture修正，生产源码/构建未改；不以首轮已复制完毕代替完整导入出口。


第二轮 `electron-paused-copy-verified-summary.json` **exit1、76.211487秒**：PID15658实际暂停/恢复后，prepare、维护保护和原件/副本hash断言已过，但随后用于撤销观察包装的`app.evaluate`返回“Target page, context or browser has been closed”，尚未进入导入。保留该测试通道失败，不记产品导入通过。第三轮改为复制结束时自动撤销文件IO观察，恢复后仅经已有renderer/preload IPC导入及读回；原会话24639运行中。仍为同一冻结生产构建；探测退出有独立期限和仅针对自有子进程的强杀兜底，不将此探测算作正常退出验收。


### 5.85.2 真实 Electron 暂停、导入与清理终态

第三轮同一`6b10e19e…`生产构建，`electron-paused-copy-renderer-summary.json` **exit0、77.723159秒**；`electron-paused-copy-renderer.json`保留真实PID16023及各出口。实际主进程读取256KiB、暂存副本已写196608字节时SIGSTOP，父进程确认OS状态T，实际暂停**64004ms**。期间文件长度不变；SIGCONT后生产60秒维护扫描2/保护1/删除0/失败0，复制及格式校验完成。

随后实际renderer→preload→IPC导入为draft，`designSchemes.get`读回同一方案，staging中包文件清空，用户所选自有原包SHA256与复制摘要一致。输入为既有实际256MiB合法ZIP。没有模拟时钟/存储结果、没有网络生成或用户库；独立userData和观察包装仅存在于本次测试进程。**这补齐macOS arm64真实Electron的暂停后导入窗口，不代表Windows、所有资产类别或正常退出验收**；就地永久回归随下一源码批次纳入，前两次fixture/测试通道失败保留。

完整回归仍在原24942运行，源码/测试/构建不变。本轮正式待做的是§5.85未提交生成补偿的统一入队与CLI兼容接线，以及其他资产/创建中断发现与原D02完整矩阵；86/93和剩余七阶段不变。


## 5.86 完整回归终态与未入账图片补偿接线（2026-09-14）

本节更新§5.84–5.85的“运行中/未正式安装”状态；历史失败与当时结论保留。当前仍为86/93、剩余7大阶段，完整G-DATA-02未验收。

- 冻结源码 `6b10e19e… /1764` 的完整Electron已结束：**189通过、0失败、2项外部条件跳过、0 flaky**，命令总耗时1387.777秒、exit0。见[结果](../../tests/v25/.results/d02/local-asset-native-electron-full-result.json)及[命令摘要](../../tests/v25/.results/d02/local-asset-native-electron-full-summary.json)。本轮20个实际合法ZIP与17个故意无效输入分类留存；合法ZIP扫描0 findings/0 errors、19.611922秒，见[扫描报告](../../tests/v25/.results/d02/local-asset-native-electron-full-archive-scan.json)。2项跳过仍未取得外部证据。
- 完整回归终态后，未入账生成图片补偿已正式接入：复用持久清理队列，在取消、结果无法提交及资产落库异常时入队，沿用引用检查、原生目录句柄删除及失败退避；过期transport仍先校验，错误日志避免文件路径。CLI serve补原生能力装配，在取得所有权后的启动、定时维护和退出阶段接续清理；原生能力失败在取得锁和打开数据库前拒绝。
- 新批次7文件专项**47通过、0失败、0跳过**，1.796547秒、exit0，见[结果](../../tests/v25/.results/d02/uncommitted-formal-focused-result.json)及[具体命令](../../tests/v25/.results/d02/uncommitted-formal-focused-summary.json)。覆盖保留引用、真实删除失败与重开数据库重试、目录替换、资产落库故障、CLI所有权和启动/停止清理。清理意图自身落库失败时文件保留且没有持久队列，该用例记录未完成窗口，不能算作孤儿恢复成功。
- **新增源码尚未经过新一轮完整check、Electron和打包验证。** CLI编译后及安装包内原生加载仍待验；Provider返回前部分写盘、硬崩溃无意图、全部资产类别/引用/租约、持久staging重试和Windows等仍属完整GC范围。此前全量、扫描和包冒烟结果只属于此前冻结源码。

后续阶段仍依次为：完整资产GC → 费用确认/重试兼容 → 参考图及费用联合验收 → 真实v2.1旧库迁移 → 四端实际环境验收 → CI/各平台打包与安全验收 → 部署、回滚及远程MCP。前三项属于开发与联合验收，后四项主要取得真实交付证据；每个阶段可含多个goal，不能把剩余7阶段理解成7次操作或按86/93推算工期。


## 5.87 未入账补偿与实际CLI交付验证（2026-09-14，完整GC仍开放）

本批继续§5.86已安装的补偿：不会用这些局部通过关闭G-DATA-02。新增编译后CLI进程回归、安装包内CLI回归、真实Electron暂停永久回归，并修复实际入口发现的两处缺陷。

### 实际CLI的失败与修复

1. `cli-cleanup-compiled-red`：实际编译CLI从仓库外的工作目录执行serve，因bundle垫片与原生模块的`createRequire`声明重名，在就绪前失败；exit1、3.893870秒。构建垫片改用独立导入别名。
2. `cli-cleanup-compiled-buildfix`：启动与重启清理通过后，实际SIGINT导致exit130。bin通用处理器先于serve的停机处理器立即退出，最终清理未完成；exit1、4.019183秒。bin在命令已注册中断处理器时交由命令处理；serve保留信号处理器直到stop结束，重复信号不重复发起清理，成功/失败均移除两个处理器。
3. 修复后`cli-cleanup-compiled-fixed`：**1通过、0失败/跳过**，2.486663秒。实际不同PID启动、持久队列删除、SIGTERM/SIGINT退出和锁释放通过。`uncommitted-cli-focused`：**18通过、0失败/跳过**，1.259075秒，含就地信号处理成功/失败与重复信号测试。

前面三份Playwright报告首次使用相对输出路径，落入`tests/v25/tests/v25/.results/d02`；已原样移到[统一结果目录](../../tests/v25/.results/d02/)，保留命令摘要中的原参数与失败记录。后续报告全部指定绝对路径。新增CLI信号回归明确使用POSIX信号；Windows需要原生控制台事件测试，不能把该fixture的skip算作Windows通过，也不能凭本批关闭全平台发布门禁。实际本机验证为Node25及包内Electron43；CLI最低Node版本尚未实测。

### 源码、安装包与真实暂停

- 首轮`uncommitted-cli-check`被8项lint错误拦住，未完成的其他并行子任务不算通过。四份旧探测脚本原文另存`.preformat.source.txt`后仅格式化，修正一份测试格式及三份报告位置；不修改原失败结论或放宽扫描规则。
- `d6748242… /1772`：`uncommitted-cli-check-lintfixed` **38/38**、56.085966秒，根测试**2834通过/0失败/48条件跳过**；源码扫描0 findings/0 errors。实际macOS arm64 ad-hoc打包46.500688秒；`uncommitted-cli-package-smoke` **5通过/0失败/0跳过/0 flaky**、27.431352秒，新增包内CLI使用Resources/integration与随包native模块。App/DMG/ZIP扫描0 findings/0 errors、22.756674秒；冒烟实际方案ZIP扫描通过。仍非正式签名/公证或其他平台证据。
- 随后仅增加Windows信号适用范围说明，`9f9d6ba9…`check38/38、39.582604秒。永久暂停用例发现阶段暴露Playwright首参必须解构的fixture错误，保留`uncommitted-pause-discovery.log`，修正为标准fixture参数。
- `0ac260ce…`永久回归`uncommitted-cli-electron-focused` **2通过/0失败/0跳过/0 flaky**、82.547712秒：实际CLI重启/退出与实际Electron暂停。主进程PID29852在256KiB读取、196608字节已写时被真实SIGSTOP，OS状态T，实际暂停**64004ms**；恢复后生产维护扫描2/保护1/删除0/失败0，renderer/preload导入、读回、原件hash和staging清空全部通过。实际256MiB方案ZIP扫描0 findings/0 errors、7.841326秒。测试有针对自有子进程的有限退出兜底，不能外推为Electron正常退出证明。
- 最终整仓复验`uncommitted-cli-check-final` **37/38失败**、36.346966秒，唯一失败是已有账号切换用例在默认1秒内尚未观察到真实POST；同一源码整组独立核查16通过、4.990005秒。改为等待测试服务器实际收到POST的事件，保留发送、账号隔离、无迟到写入断言及测试总截止，未修改产品账号逻辑。新`0dd8c52a… /1772`完整check正在运行，未预记通过。

安装包构建后变化仅为三份测试文件，逐项输入比较见[产物源码对应关系](../../tests/v25/.results/d02/uncommitted-cli-package-input-equivalence.json)；不将源码等价比较本身称为实际包运行通过。当前版本还需收齐check终态、最终包冒烟及完整Electron/归档扫描，再记录本批验证完成。

### 下一缺口已取得真实失败证据

[Provider返回前部分写盘失败](../../tests/v25/.results/d02/provider-partial-before-return.json)：在当前生产generate和OpenAI-compatible Provider中，使用本机受控HTTP返回两张图片，第二个目标预置测试自有目录，操作系统真实报EISDIR。第一张确实写盘，但整次返回failed、generated_assets=0、local_asset_cleanup=0；发送一次。没有拦截写盘、伪造Provider方法、真实收费调用或用户库。命令exit0、0.170319秒只表示**成功复现缺陷**，不是产品恢复通过。

下一步须把文件创建/业务提交间的所有权与恢复接续纳入持久协议，覆盖写入前、第一张完成后、后续写入失败、进程硬崩溃和意图提交失败；与保留引用和正在执行的租约联合验收。仍需其他上传/方案来源/导入正式素材类别、持久staging退避、云端晚到PUT/全服务引用租约以及Windows。不能只增加catch删除就宣称完整资产GC完成；仍为86/93、剩余7大阶段，管理员继续等待全部v2.5验收。


### 5.87.1 全仓复验的第二处测试时限问题

`uncommitted-cli-check-cloudfixture`终态37/38、exit1、36.201243秒：上面的账号切换事件等待已通过；本次唯一失败为1001个真实文件清理用例触及默认5000ms测试时限。相同用例前几轮实际耗时596/1171/1269ms，检查内容是分批100、11批累计1001、最终目录为空和下一批no-op，不是5秒性能承诺。仅为这一个实际IO用例设置15000ms总截止，所有文件数、批量和删除断言不变，未改全局测试时限或产品清理批量。新源码`5fbef189… /1772`正在完整check复验；本节保留两次全仓失败，不能用此前通过覆盖本次未结束状态。


### 5.87.2 当前完整check与安装包对应关系

`5fbef189… /1772`的`uncommitted-cli-check-iobudget`已终态**38/38、exit0、57.859093秒**；源码扫描0 findings/0 errors、0.772446秒。两处测试修正均未减少原验收断言。

随后复用早先安装包做最终冒烟，`uncommitted-cli-package-smoke-final` **3通过/2失败、0跳过**、22.829316秒；两个原生身份断言发现当前开发目录native与先前安装包的指纹不同，分别为`3eda355b…`和`e95d6bb0…`。此前“生产源码输入相同”不能代替原生构建产物一致，失败原样保留；没有放宽身份比较。该轮1实际方案ZIP扫描通过。现在从当前源码重新执行完整打包（`uncommitted-cli-package-final`），随后重新核对实际包冒烟/扫描，再开始完整Electron。完整GC及Provider返回前部分写盘缺口仍开放。


### 5.87.3 当前实际产物终态与完整回归接续

同一`5fbef189… /1772`源码重新实际打包`uncommitted-cli-package-final`已完成，47.682374秒、exit0。`uncommitted-cli-package-smoke-rebuilt` **5通过/0失败/0跳过/0 flaky**、24.963734秒，严格native身份和实际包内CLI清理均通过；App/DMG/ZIP扫描 **0 findings/0 errors**、21.634957秒；本轮1实际方案ZIP扫描0 findings/0 errors、0.070288秒。构建结束时的实际native副本和CLI摘要留在[二进制输入记录](../../tests/v25/.results/d02/uncommitted-cli-rebuilt-binary-inputs.json)，避免后续开发构建覆盖原生模块后混用证据。

再次核对1772份源码零漂移后，`uncommitted-cli-electron-full`于22:00 UTC后启动，RUN_DATABASE_TESTS=true，当前运行中（原会话86326）；最终报告名为`uncommitted-cli-electron-full-result.json`，当前可查[完整Electron运行日志](../../tests/v25/.results/d02/uncommitted-cli-electron-full.log)。保持源码/测试/构建输入不变，终态后对本轮实际归档分类和扫描。当前仍不关闭完整GC、Provider返回前部分写盘缺口或原D02.1–7；86/93与剩余7阶段不变。


## 5.88 写入前持久意图与崩溃恢复的隔离候选（2026-09-14，尚未安装）

完整Electron原会话86326继续运行，`5fbef189… /1772`源码零漂移。针对§5.87实际复现的Provider返回前部分写盘缺陷，只在独立esbuild bundle中替换生成作用域、Provider写入和清理保护三处接线；未改变正式源码或正在回归的构建。精确输入及候选bundle摘要见[候选输入记录](../../tests/v25/.results/d02/prewrite-reservation-candidate-inputs.json)。

### 候选协议及真实证据

候选先在既有`local_asset_cleanup`提交身份尚未确认的预留记录，再经native独占创建文件、从实际fd读取身份并更新记录，最后才写图片内容。当前生成操作持有作用域保护直到业务提交/失败，避免第一张写完后在等待其他图片时被维护删除。成功落入canonical资产的文件退出临时意图；失败文件保留持久记录并经原引用保护、退避与native清理处理。同名已有文件独占创建失败，不截断、不采用其身份；没有加入路径写入回退。

| 场景 | 实际结果与边界 |
|---|---|
| 第二张目标为真实目录，第一张已写 | 生成failed；第一张有持久意图，释放操作保护后按记录的到期时间真实删除，队列归零；原目录保留 |
| 成功单图 | 实际内容保留，canonical资产1条，临时队列0 |
| 意图插入真实SQLite触发器失败 | 生成failed，未留下图片或资产；没有新意图可供后续成功宣称 |
| 目标已有测试自有原文件 | 生成failed，原字节保留，队列0；没有覆盖文件 |
| 已确认身份并写完首张后实际SIGKILL | 旧进程被杀、新PID打开同一临时SQLite，按持久next_attempt_at执行真实native清理，删除1、队列0；不发送新Provider请求 |
| 文件已独占创建、身份更新前实际SIGKILL | 新PID发现预留记录，文件仍为0字节但身份未确认；清理blocked1/deleted0，空文件与记录保留。**这是有记录的安全阻断，不是空文件已被回收** |

四场景见[预留候选结果](../../tests/v25/.results/d02/prewrite-reservation-proposed-probe.json)，exit0、0.240374秒。已写内容强杀恢复见[新PID恢复](../../tests/v25/.results/d02/prewrite-reservation-crash-proposed.json)，exit0、0.371359秒；身份提交前强杀见[未确认身份阻断](../../tests/v25/.results/d02/prewrite-empty-crash-proposed.json)，exit0、0.395552秒。均为真实SQLite/native文件IO、测试自有目录和本机受控HTTP；崩溃由独立进程确认OS暂停状态后真实SIGKILL。到期时间使用已持久化数值显式传入，不是自然60秒等待证明，也不是正式CLI/Electron启动恢复。

首个“文件创建后才插入身份”的候选和强杀结果仍保留`prewrite-scope-proposed-probe.json`、`prewrite-crash-proposed.json`；后来把预留提前到创建前，补上无记录空文件窗口。两次候选首败分别来自探测在记录已退避后仍期待立即扫描、以及多图时误把全队列数量固定为1；修正探测的到期时间和按路径记录断言后重跑，原失败log/summary和旧候选原文保留。候选没有将未确认身份改判为可安全删除。

### 正式接线仍须完成

正式代码需补类型、将活跃写入保护分为无环的内部IO接缝，确保作用域覆盖整个生成到业务提交；直接Provider测试的协议装配需显式处理，缺写入上下文必须在发送前拒绝。必须保留过期账号/transport守卫，验证文件命名空间变化不会导致错误发布或删除；补实际主进程/CLI的强杀恢复、就地故障矩阵与全部门禁。已有生成账目不能靠文件清理随意改为成功或重发。

其他上传、方案来源/导入正式素材、持久staging维护、云端晚到PUT与全服务引用/租约、Windows仍属原G-DATA-02/D02.1–7；候选通过不关闭完整GC、剩余7阶段或管理员前置。


## 5.89 Provider 写入前持久意图正式接入与永久回归（2026-09-14）

### 前一批终态与本批输入归属

§5.87.3 的 `5fbef189… /1772` 完整 Electron 已终态：191通过、2项外部凭据跳过、0失败/0 flaky，1466.180877秒、exit0。21份实际合法ZIP扫描零命中/错误，17份故意无效输入单列，不计为安全交付包。证据见[完整结果](../../tests/v25/.results/d02/uncommitted-cli-electron-full-result.json)、[命令与时间](../../tests/v25/.results/d02/uncommitted-cli-electron-full-summary.json)、[归档清单](../../tests/v25/.results/d02/uncommitted-cli-electron-full-archive-inventory.json)。该源码与此前包冒烟不作为随后新增代码的验收。

§5.88隔离候选随后正式接入 `local-asset-writes.ts` 与无环的 `local-asset-write-leases.ts`：写盘前持久预留，native独占创建，实际fd身份提交后才写内容；生成作用域保护覆盖所有图片与最终资产事务。正常提交移除临时意图，失败走既有引用保护、退避和原生句柄删除。缺宿主IO在HTTP发送前拒绝；写完及业务入账前重新校验目录/文件身份。图片根被替换的已测场景拒绝发布，保留外部原件；不声称所有事后文件读取或Windows命名空间竞争已验。

首批类型检查发现新增测试的两个Promise回调被推导为 `() => undefined`，已显式改为 `() => void`；生产类型检查随后通过。原Provider协议/执行测试显式装配测试写入端口，其43项通过只用于协议回归；以下新增用例不替换Provider或真实写入服务。

### 正式生产服务的永久故障回归

| 验证组 | 实际行为与结果 |
|---|---|
| 创建与业务发布 | native创建前SQLite已有NULL身份记录；空文件阶段维护判定活跃保护；实际图片内容落入canonical资产，临时意图归零 |
| 多图部分失败 | 第二个输出目标是实际目录；调用第二次native创建时第一张真实内容已存在，两个活跃意图受保护；失败后第一张删除、原目录保留、零资产/零意图 |
| SQLite故障 | INSERT失败则完全不调用创建文件；身份UPDATE失败只补偿本人独占创建的空文件；补偿也失败时保留NULL身份blocked记录和0字节文件，不能称已回收 |
| 原文件与引用 | 同名原文件不截断、不采用；另一run快照引用的部分输出保留，最后引用移除后才删除 |
| 删除失败恢复 | 实际native删除故障后attempt_count=1与退避持久化；两个数据库重新打开，到期前不删，到期后实际删除，无新HTTP |
| 命名空间与并发 | 独立进程将pictures根改为测试自有外部目录链接，原件保持、业务拒绝发布、意图blocked；两并行写作用域分别保护，完成一方仅释放自己的文件 |
| 缺宿主能力 | 在任何Provider HTTP请求前失败，实际服务器收到0次请求 |

11项就地专项通过，1.365104秒，见[写入协议结果](../../tests/v25/.results/d02/prewrite-formal-protocol-result.json)。再新增独立编译的正式服务进程fixture，native调用边界仅用来观测；操作系统确认旧PID为T暂停状态后实际SIGKILL，再由不同PID打开原SQLite恢复：

1. 预留后/创建前：恢复发现目标不存在，missing1、队列0。
2. 独占创建后/身份更新前：0字节文件保留，blocked1、deleted0，NULL身份及阻塞原因可回读。
3. 图片内容写完并fsync后/业务提交前：known identity文件实际删除，deleted1、队列0。

三种场景都保持生成账目failed、资产0、HTTP总请求1；恢复从持久到期数值执行，不冒称自然60秒流逝。该组与11项就地联合14P/0F/0S，1.679862秒，见[真实强杀联合结果](../../tests/v25/.results/d02/prewrite-formal-crash-result.json)。这是独立Node进程消费正式core的恢复证据，尚不替代CLI/Electron宿主准入、安装包和Windows实际控制事件。Windows用例明确条件跳过，未宣称已验。

### 全仓首败与修正

`71449533… /1777` 首轮check为37/38，根测试2838P/10F/48S，53.876971秒；10项失败集中于两组Automation实际HTTP/SQLite测试，原因是它们手工装配CoreRuntime时遗漏了宿主native IO，新发送前门禁因此拒绝执行。核实正式 `core-instance.ts` 已注入 `getManagedFilesystem` 后，为测试接入真实native binding并关闭新增方案库句柄；没有放开生产回退、跳过用例或修改原费用/取消/幂等断言。两组原测试21P/0F，1.708703秒。见[首败命令](../../tests/v25/.results/d02/prewrite-formal-check-summary.json)与[Automation复验](../../tests/v25/.results/d02/prewrite-formal-automation-native-result.json)。

最新源码[f4a0de4e… /1777](../../tests/v25/.results/d02/source-prewrite-formal-native-fixtures.json)完整check38/38通过，根2848P/48条件S、零失败，40.834365秒；源码扫描零命中/错误，1.639998秒。实际macOS arm64 ad-hoc打包通过，55.082896秒；当前新包冒烟及App/DMG/ZIP扫描运行中，随后完整Electron回归，结果按各自输入保留。完整G-DATA-02/D02.1–7未关闭：其他上传/预览、方案来源与导入正式资产、staging持久重试、云晚到PUT及所有引用/租约、Windows仍待；86/93、剩余7大阶段和管理员前置均不变。


### 5.89.1 新产物验收与完整Electron接续

同一 `f4a0de4e… /1777` 实际macOS arm64 ad-hoc包冒烟 **5P/0F/0S/0 flaky**，27.832203秒；App/DMG/ZIP扫描零命中/错误，21.954698秒；1份实际方案ZIP扫描零命中/错误，0.073144秒。构建与签名后实际native和CLI输入摘要单独留存，后续CLI重新构建native不会改变本轮证据归属。见[新包冒烟](../../tests/v25/.results/d02/prewrite-formal-package-smoke-result.json)、[包扫描](../../tests/v25/.results/d02/prewrite-formal-package-scan.json)、[实际方案包扫描](../../tests/v25/.results/d02/prewrite-formal-package-smoke-archive-scan.json)、[二进制输入](../../tests/v25/.results/d02/prewrite-formal-binary-inputs.json)。

再次核对1777份源码零漂移后，`prewrite-formal-electron-full`于22:47 UTC启动，RUN_DATABASE_TESTS=true，原会话57145，当前运行中；[运行日志](../../tests/v25/.results/d02/prewrite-formal-electron-full.log)可查，终态后读取JSON结果、分类并扫描本轮实际归档。运行中不修改正式源码/测试/构建输入；完整G-DATA-02、七阶段与管理员前置不关闭。


### 5.89.2 实际开发版与安装包CLI的写盘中断及启动恢复

完整Electron原会话57145仍运行，`f4a0de4e… /1777`源码保持零漂移。独立探测不改生产源码/构建，先复用正式写入服务的三个崩溃点，再分别启动现有编译CLI和包内CLI：6场景通过，2.371757秒。恢复完全通过正常CLI准入与启动维护，不手工插入清理记录、不直接调用drain、不推进到期时间。创建前记录自动ack；未确认身份空文件保持blocked；已写且身份确定的文件自动回收。各场景生成账目failed、资产0、Provider请求总数1，Ctrl-C正常退出并释放owner.lock。见[6场景结果](../../tests/v25/.results/d02/prewrite-cli-recovery-hostpaths-evidence.json)。首次探测用了core测试目录而CLI E2E宿主实际根为`dataDir/Pictures`，导致已知身份文件仍被正确阻断；原1.229113秒失败及2项先通过记录保留。修正仅为fixture提供实际宿主路径，未扩大生产受管根或取消身份校验。

随后不用写入fixture，直接启动实际CLI，通过其正常鉴权Automation API发起本机受控HTTP生成。测试返回32MiB合成PNG头部载荷，OS文件变化通知观测实际分块写盘并向CLI发送SIGSTOP；确认OS状态T和SQLite中真实身份/运行中账目后SIGKILL。新CLI进程在同一数据目录正常准入，自动处理旧owner与清理队列：

| 实际宿主 | 旧PID→恢复PID | 被杀时已写/总字节 | 恢复结果 |
|---|---|---|---|
| 编译CLI（Node） | 59724→59732 | 20,381,696 / 33,554,432 | 已知身份残留删除，队列0，资产0，原run failed，Provider请求总数1 |
| 安装包CLI（随包Electron Node） | 59733→59742 | 18,546,688 / 33,554,432 | 同上，Ctrl-C正常退出并释放owner.lock |

两项实际宿主测试通过，1.129564秒。见[实际CLI写盘强杀结果](../../tests/v25/.results/d02/prewrite-real-cli-crash-evidence.json)、[命令及时间](../../tests/v25/.results/d02/prewrite-real-cli-crash-summary.json)、[探测与二进制输入](../../tests/v25/.results/d02/prewrite-cli-host-inputs.json)。无真实付费调用、无用户库，临时进程/目录均已清理。这证明本机实际CLI从产生半成品到下次启动清理的链路；尚不代表原生Windows或Electron主窗口的同场景，也不替代所有上传/来源类别。两组独立探测仍须纳入永久宿主回归；完整Electron终态与归档扫描待原会话完成。


## 5.90 参考图上传磁盘满残留的真实复现（2026-09-14，未修复）

完整Electron原会话57145运行期间，正式源码 `f4a0de4e… /1777` 保持冻结。使用既有 `capacityDiskImage` 在全新测试目录挂载128MiB HFS+映像，只在该卷内填充到约2MiB可用；分别调用原 `stageLocalImageBytes` 与 `stageLocalImage` 处理20MiB合成PNG头部载荷。fs.promises包装仅观察实际系统错误和文件大小，不改写内容、不注入ENOSPC、不改变返回结果。

| 入口 | 实际OS结果 | 失败后残留与维护结果 |
|---|---|---|
| 字节上传 `stageLocalImageBytes` | writeFile请求20,971,520字节，实际ENOSPC；产品返回IMAGE_READ_FAILED | uploads留下2,097,152字节副本，local_asset_cleanup=0，实际drain examined/deleted均0，残留仍在 |
| 文件复制 `stageLocalImage` | copyFile请求20,971,520字节，实际ENOSPC | 该HFS+场景目标文件不存在，队列0；不能据此推广为所有OS复制失败都无残留 |

两项原文件SHA256均保持不变。实际卷已按其唯一映像身份卸载，之后才删除测试目录；没有填满用户文件系统。见[真实故障结果](../../tests/v25/.results/d02/upload-disk-full-evidence.json)、[命令与时间](../../tests/v25/.results/d02/upload-disk-full-compiled-summary.json)、[输入归属](../../tests/v25/.results/d02/upload-disk-full-inputs.json)。探测exit0、2.231252秒表示**成功复现开放缺陷**，不是上传GC通过。首个探测构建因CJS顶层await失败，0.049198秒未启动有效业务验证；改为异步main后运行，首败日志和原输入保留。

下一修复须在上传写入前记录持久创建意图、使用受管目录句柄与真实身份，并保护已返回Composer/Automation/Skill及方案run的有效引用。上传成功不等于无引用，不能直接套用生成作用域结束即回收的策略；DB草稿没有图片字段也不构成删除授权。需补上传失败/中断重启、存活保护及最后引用释放，方案run中直接rm暂存副本的保留引用风险继续按原D02核对。此处未修改正式代码，不关闭G-DATA-02、七阶段或管理员前置。


### 5.90.1 上传持久写入与引用保护隔离候选（未接入正式代码）

仍保持完整Electron原会话57145对应的 `f4a0de4e… /1777` 正式输入不变。在独立bundle中复用生成写入的预留、native独占创建和fd身份协议，增加成功上传的进程内保留保护与显式释放接缝；只替换测试bundle中的字节上传写入调用，文件复制入口未改。

真实HFS+磁盘满下，原生fd写入实际报ENOSPC，出错时已写2,097,152字节、该次请求块65,536字节；候选随后按已落库身份清理残留，最终文件/队列均0，原件hash不变。对照copyFile仍是原实现在该文件系统上失败无目标。随后成功上传12字节：到持久next_attempt_at维护仍被活跃保护；显式释放上传保护后，原generation params参考路径继续保护文件；移除最后引用并按持久到期时间维护后删除1。这里显式使用持久到期数值，不声称自然60秒已流逝。

见[候选真实IO结果](../../tests/v25/.results/d02/upload-disk-full-candidate-observed-evidence.json)、[命令与时间](../../tests/v25/.results/d02/upload-disk-full-candidate-observed-summary.json)、[隔离输入](../../tests/v25/.results/d02/upload-writes-candidate-inputs.json)，exit0、2.562390秒。首次候选探测2.569549秒失败：成功写入的finalizer已按活跃保护推迟下一维护，探测却马上要求examined1；改按持久到期数值检查，并补对实际fd-write ENOSPC的观察，保留首败和旧bundle。未改变生产退避。

这只是写入底层与显式释放的候选证据。正式接入必须明确每个成功上传的所有者与释放点（Composer窗口/移除与晚到上传、Automation会话、Skill与方案执行），不能用永久进程持有冒充完整上传GC；须覆盖副本复制、真实崩溃恢复和保留引用，保留跨宿主契约。候选没有扩大生产受管根、没有安装UI释放方法、没有完成原D02或管理员前置。已另准备实际CLI写盘强杀的永久测试helper草稿，待原完整Electron终态后接入。


## 5.91 写入恢复完整回归终态与永久CLI强杀门禁（2026-09-14）

### 完整Electron与归档扫描

`f4a0de4e… /1777` 完整Electron于UTC22:47:47–23:12:32执行完毕，**191P/2外部凭据S/0F/0 flaky**，1485.130891秒。运行结束核对源码零漂移。见[完整JSON结果](../../tests/v25/.results/d02/prewrite-formal-electron-full-result.json)与[命令/时间](../../tests/v25/.results/d02/prewrite-formal-electron-full-summary.json)。

38份留存输入中，21份为实际合法ZIP，17份为故意无效语料，后者不计安全交付包。原始21ZIP扫描26.698354秒、exit1：发现1条user-path规则命中、0扫描错误。命中来自64MiB随机Base64容量数据 `sources/repo-snap/capacity-1.txt`，字节偏移43,792,553，随机片段中偶然含大小写混合的路径形状。已核实整个文件仅由Base64字符组成，其生成器 `package-capacity-large.ts/sourceBytes(printable=true)` 只读取随机字节；未读取用户目录。

复核保留原ZIP及原始失败，只对该target、entryHash、rule、matchHash作精确例外，并在复核扫描计划中额外固定该entry完整SHA256。复核21ZIP扫描24.928901秒、exit0，**0未处理命中/0错误/1条已核实合成数据例外**；不能写成原扫描零命中。扫描规则和其他文件均未放宽，没有重新随机生成语料规避命中。见[原始扫描](../../tests/v25/.results/d02/prewrite-formal-electron-full-archive-scan.json)、[复核依据](../../tests/v25/.results/d02/prewrite-formal-electron-full-random-fixture-review.json)、[精确例外](../../tests/v25/.results/d02/prewrite-formal-electron-full-archive-exceptions.json)、[复核扫描](../../tests/v25/.results/d02/prewrite-formal-electron-full-archive-reviewed.json)。

### 永久CLI写盘强杀验证

新增共享 `cli-write-crash-process.ts`，分别接入开发版CLI和安装包CLI测试。通过正常鉴权Automation API和本机HTTP发送32MiB合成图像载荷，真实CLI记录创建意图并分块写盘；独立Node观察进程在上游返回前就绪，轮询已知文件，首次观察到内容后对CLI发送SIGSTOP。父测试确认OS状态T、文件为非零未完成内容、SQLite已有身份且无canonical资产，再SIGKILL并启动新CLI；验证旧owner接管、队列/文件清理、原run failed、Provider请求总数1和Ctrl-C退出释放owner.lock。

首轮命令将文件筛选放在可变长`--project`参数后，0.522068秒未发现目标项目，不计执行；修正参数后原清理用例1P、新强杀1F，3.327912秒：macOS目录fs.watch通知发生合并，32MiB已全部写完才收到通知，未满足“半成品”条件。保留失败并改为上述独立进程提前观察；没有延迟生产写入、注入错误或放宽partialBytes必须小于总量的断言。

| 永久用例 | 实际PID与文件状态 | 结果 |
|---|---|---|
| 编译CLI新强杀 + 原启动/退出清理 | 63108→63120，已写131,072 / 33,554,432字节 | 2P/0F/0S/0 flaky，3.767077秒 |
| 实际安装包CLI新强杀 | 63257→63270，已写196,608 / 33,554,432字节 | 1P/0F/0S/0 flaky，4.900131秒 |

见[开发版永久回归](../../tests/v25/.results/d02/prewrite-permanent-cli-observer-result.json)、[包内永久回归](../../tests/v25/.results/d02/prewrite-permanent-packaged-cli-result.json)。各报告附件保留完整前后SQLite状态、实际字节数和进程身份；Windows显式保留原生控制事件验收，不宣称本机信号测试覆盖Windows。

最新源码[3bffd9b3… /1778](../../tests/v25/.results/d02/source-prewrite-permanent-cli.json)相对已完整回归的f4a0de4e，仅新增/修改上述3份宿主测试文件，所有生产文件逐项相同。最新check38/38通过、17.367124秒（按实际缓存记录），源码扫描零命中/错误、0.739327秒。实际包仍是f4a0de4e已留存二进制，不把随后开发native重新构建产生的文件冒称同一包输入。没有因仅新增这两项宿主测试重复整轮24.7分钟回归；原完整结果、产物结果与新增针对性证据按各自输入保留。

本节关闭的是本批永久测试接入与前轮完整运行的待记录事项，不关闭完整G-DATA-02。§5.90的正式上传磁盘满缺陷仍未修，§5.90.1仅隔离候选；下一正式接通成功上传所有者/释放、写入与引用安全，再覆盖其他资产、持久staging、云和Windows原范围。任务86/93、七大阶段和管理员前置保持不变。


## 5.92 D02：正式字节上传所有者与持久写入（2026-09-14）

**状态：开发与专项验证推进，完整 G-DATA-02 仍开放。** `stageLocalImageBytes` 正式复用写入前持久意图、原生独占创建和 fd 身份提交，再将成功上传的活跃保护交给不可序列化的宿主所有者。未增加数据库迁移或公开实体。Desktop 的所有者由可信 IPC sender 决定，在窗口销毁、渲染进程退出和主文档重载时释放；同文档与子框架导航保留。CLI/Automation 在服务退出时释放，Skill 在执行结束时释放。释放仍检查任务、生成资产和方案来源引用；不能按上传时间直接删除。

### 实测与首败

| 证据 | 实际结果 | 范围 |
|---|---|---|
| 原生与窗口生命周期专项 | [95P/0F](../../tests/v25/.results/d02/upload-owner-native-lifecycle-summary.json)，1.969912 秒 | 真实 SQLite/native 上传、原生成写入回归、IPC 桥、CLI 与 Automation 原有生命周期；窗口事件部分为 EventEmitter 夹具，不能代替实际 Electron |
| 首次新增测试 | [63P/1F](../../tests/v25/.results/d02/upload-owner-native-first-summary.json) | ESM 内置模块 namespace 无法 spy；改为在真实 native 创建后排 microtask 关闭，断言实际仅写 64KiB、持久身份保留、维护回收；没有替换磁盘写入或放宽半成品断言 |
| 正式磁盘满复测 | [exit0](../../tests/v25/.results/d02/upload-owner-formal-enospc-summary.json)，12.275420 秒；[实际证据](../../tests/v25/.results/d02/upload-owner-formal-enospc-evidence.json)、[输入摘要](../../tests/v25/.results/d02/upload-owner-formal-enospc-inputs.json) | 独立 128MiB HFS+ 卷保留约 2MiB 空间，20MiB 上传实际 fd-write 返回 ENOSPC，已写 2,097,152 字节；返回错误后副本和队列清空，原件不变。成功上传存活保护、释放后原任务引用保护、末引用删除后回收均成立 |
| 首次统一检查 | [exit1](../../tests/v25/.results/d02/upload-owner-formal-check-summary.json)，27.330163 秒 | TS4058：推导返回类型无法导出 SQLite 类型；增加明确本地 IO 能力类型，不新增平行实体 |
| 第二次统一检查 | [exit2](../../tests/v25/.results/d02/upload-owner-typed-check-summary.json)，44.190218 秒 | 新窗口夹具函数推导为 false 字面量，改为 boolean；保留失败报告 |

首轮原生专项在加入永久 Electron 测试前运行。HFS+ 复测属于正式运行时代码，不再是 §5.90.1 的隔离替换候选；它只证明字节上传路径，并不覆盖仍使用 copyFile 的 `stageLocalImage(path)`。原始磁盘满缺陷证据保留，不能改写为当时已经通过。

### 尚未闭合与下一步

1. `stageLocalImage(path)` 的方案参考图复制仍须接相同所有者和有界安全读取；方案适配器目前直接 rm 的清理必须改为引用保护释放，保留可重试任务的参考图。
2. 工作台移除/清空、迟到上传结果、共享组件卸载需要正式释放协议；主窗口仍打开时不得只依赖销毁事件。云端与桌面应遵守同一 gateway 语义。
3. CLI/Automation 当前保护周期是服务生命周期，仍需客户端释放或明确可恢复的过期协议。长期存活的服务不得无限保留未使用上传；服务退出异常与令牌切换也要验证。
4. 所有者在异步写入中途关闭时，本次已提交的 64KiB 写入允许结束，随后拒绝继续和交付；持久记录留待正常维护/启动恢复。本专项调用记录的到期时间验证清理，不冒称自然时间或实际新宿主 PID 已覆盖该上传场景。
5. `NULL` 身份空文件仍按既有 blocked 规则保留，不冒称可靠回收；方案来源、导入资产、staging 重试、云 late PUT/全引用租约以及实际 Windows 矩阵仍沿原 D02.1–7。

后续统一检查、真实 Electron、安装包冒烟与扫描须归属本轮最终源码，不继承 §5.91 的旧生产构建结论。父任务仍为 86/93、七个大阶段；管理员继续排在 v2.5 全部验收之后。


### 5.92.1 真实退出顺序缺陷与修复

`13681e49… /1783` 完整 [check38/38](../../tests/v25/.results/d02/upload-owner-lifecycle-typed-check-summary.json) 43.474171秒通过，root单测2866P/48条件S；[源码扫描](../../tests/v25/.results/d02/upload-owner-current-source-scan.json)0命中/0错误。随后[真实Electron首次1P/1F](../../tests/v25/.results/d02/upload-owner-electron-focused-summary.json)发现：第二窗口销毁可释放自身上传，主文档重载也通过，但 app.close 后主窗口上传仍存在。原因是应用排空后先关闭 SQLite，窗口 destroyed 事件来得太晚，所有者只释放了内存保护，未能在退出时清理。

修复将 `closeWindowUploadOwners` 接在 `closeApplicationAdmission` 和请求/方案执行排空之后、两数据库关闭之前；同时解除对应窗口监听器，幂等关闭全部上传所有者。保留主窗口文件必须消失的原 E2E 断言，补就地双窗口退出回归。当前源码 `3b3e852c… /1783` 的统一检查与实际宿主复验单独收集，不能以修前check代替修后验收。


修后 `3b3e852c… /1783` [check38/38](../../tests/v25/.results/d02/upload-owner-shutdown-check-summary.json) 41.475087秒通过，root单测2867P/48条件S；[源码扫描](../../tests/v25/.results/d02/upload-owner-shutdown-source-scan.json)0命中/0错误。[同一两项真实Electron复验2P/0F/0S/0flaky](../../tests/v25/.results/d02/upload-owner-shutdown-electron-summary.json) 7.765153秒：不同窗口隔离、整应用退出后主窗口副本消失、主文档重载释放且新上传正常。原1P/1F保留，没有把数据库关闭后的遗留放宽为通过。安装包与完整Electron仍须另收终态。


### 5.92.2 当前产物与完整回归

同 `3b3e852c… /1783` 实际 [macOS arm64 ad-hoc打包](../../tests/v25/.results/d02/upload-owner-shutdown-package-summary.json) 46.878244秒；[6P/0F/0S/0flaky包冒烟](../../tests/v25/.results/d02/upload-owner-package-smoke-summary.json) 28.766093秒；[App/DMG/ZIP产物扫描](../../tests/v25/.results/d02/upload-owner-package-scan.json)0命中/0错误，21.599844秒。包冒烟生成的[1份实际方案ZIP分类](../../tests/v25/.results/d02/upload-owner-package-smoke-archive-inventory.json)及[扫描](../../tests/v25/.results/d02/upload-owner-package-archive-scan.json)0命中/0错误。实际native与CLI输入保留在[二进制摘要](../../tests/v25/.results/d02/upload-owner-binary-inputs.json)，避免后续开发native重建与既有签名包混用。

**完整Electron正在运行，未记通过。** 命令前缀 `upload-owner-electron-full`，实际196项、单worker、RUN_DATABASE_TESTS=true；于2026-09-13 23:46:47之后UTC启动。仍需收齐逐项结果、退出码和新归档扫描，再继续修改本轮冻结源码。§5.91 的旧191P不替代当前完整回归。实际Windows与云引用/租约等原D02范围均未缩减。


## 5.93 D02：方案参考图保留与复制竞态复现、隔离候选（2026-09-14）

**正式源码仍为 `3b3e852c… /1783`，完整196项Electron回归继续运行。以下候选未安装，不能计为完整GC通过。** 通过独立测试加载配置/编译探测，不修改正在验收的源码、构建或安装包。[输入清单](../../tests/v25/.results/d02/local-image-copy-probe-inputs.json)固定测试替换范围、候选源码、首版源码、探测bundle与原生模块摘要。

### 两个正式缺陷与真实证据

1. **仍被任务引用的参考图被方案退出直接删除。** 实际 `stageLocalImage` 复制有效PNG，实际SQLite插入保留任务引用，运行真实 `runCanonicalDesignScheme` 的准备/结束路径。方案返回 completed 后原图仍在，副本消失，但任务引用仍在：[失败证据](../../tests/v25/.results/d02/adapter-reference-retention-red-evidence.json)、[1F/20按名称未运行](../../tests/v25/.results/d02/adapter-reference-retention-red-summary.json)，1.624881秒。生成服务使用既有协议stub；不冒称实际付费生图或全链路重试已测试。原适配器直接rm绕过引用保护，是开放生产缺陷。
2. **检查后源文件增长可绕过20MiB复制限制。** 正式 `stageLocalImage` 检查12字节PNG后，在实际copyFile之前把自有临时源文件扩大至20MiB+1，再调用真实copyFile，正式函数成功返回sizeBytes=12，副本实际20,971,521字节：[证据](../../tests/v25/.results/d02/local-image-copy-size-race-evidence.json)、[命令exit0](../../tests/v25/.results/d02/local-image-copy-size-race-summary.json)，0.104536秒。exit0代表缺陷已复现；不是验收通过。包装器只制造真实源文件竞争，没有伪造copyFile返回值或错误。

### 候选行为与检验

- 路径复制使用明确上传所有者，单个原生文件描述符、有界64KiB读取及最多20MiB+1字节缓冲；读取前后比较真实大小、mtime/ctime及文件身份。只接受受管根内的普通文件，拒绝链接、FIFO、越界路径与变化的上下文。成功副本继续使用正式持久上传写入协议。
- 方案适配器持有执行期所有者，结束时按持久引用释放副本；不再直接rm已被任务引用的路径。隔离适配器[1项通过](../../tests/v25/.results/d02/adapter-reference-retention-revalidated-summary.json)，1.400950秒：保留任务存在时副本保留，删除最后引用后实际清理1个副本，原图保留。其他20项按名称未运行，不算整套适配器通过。
- [首次真实读取专项8P/1F](../../tests/v25/.results/d02/local-image-copy-candidate-tests-summary.json)发现持有旧目录句柄仍可读出原字节，但没有重新检查当前目录是否被独立进程替换。候选补上从当前根重新逐层打开目录并对照已持有的身份，保留原拒绝断言；[修后9P/0F/0S](../../tests/v25/.results/d02/local-image-copy-candidate-revalidated-summary.json)，1.275186秒。覆盖普通复制/释放、越界、链接叶/祖先、超限、真实FIFO、目录、读取中关闭、读取中增长和独立进程替换源目录。这里的实际平台为macOS，不能当作Windows已验。
- 候选接实际独立HFS+卷：[字节与路径两次真实ENOSPC](../../tests/v25/.results/d02/local-image-copy-candidate-enospc-evidence.json)、[exit0](../../tests/v25/.results/d02/local-image-copy-candidate-enospc-summary.json)，12.060864秒。两次20MiB请求均在2,097,152字节后返回真实fd-write ENOSPC，副本及记录清空；原图摘要不变。正常上传的存活、保留引用、末引用删除也通过。卷与临时目录已清理。

### 正式接入出口

完整Electron终态与当轮归档扫描完成后，将候选整理为正式服务和就地测试：删除适配器不再需要的stagedPaths/重复catch；更新旧适配器夹具以真实受管复制和显式所有者测试，不增加生产测试分支。保持coreDb与方案DB依赖明确，补方案资产/来源引用、取消和准备失败、实际重试/重启及跨宿主验证；随后按源码变更跑统一检查、实际Electron与所需产物门禁。

`readLocalImage` 的其他读取路径、UI主动移除/清空/迟到结果、长期Agent上传释放、全部来源/导入/staging/云引用与租约、Windows实际环境仍沿原D02任务继续。当前86/93、七阶段和管理员前置不变。


### 5.93.1 正式接入前的双数据库依赖与原有测试补齐

仍未修改冻结中的正式源码。候选清理明确使用适配器传入的coreDb与方案DB，两者贯穿上传所有者和写入作用域，避免注入数据库时清理误用另一份全局方案库。适配器旧stagedPaths和直接rm已从候选删除，原3处伪造文件的stage夹具改用真实受管复制，原断言保留；来源文件增加相对legacy store key保留场景。

首次整组[21P/2F](../../tests/v25/.results/d02/design-scheme-owned-copy-v2-summary.json)1.968576秒，文件保留已经正确，但新测试按`/var`别名查询使用`/private/var`规范路径的清理记录而取不到到期时间；仅修测试查询归一化，保留首版夹具和日志。随后[23P](../../tests/v25/.results/d02/design-scheme-owned-copy-v2-canonical-summary.json)通过，再增加来源文件场景并联合原生成写入/上传所有者回归，[44P/0F/0S](../../tests/v25/.results/d02/design-scheme-owned-copy-v2-sources-summary.json)1.707844秒通过（适配器24、生成写入11、上传所有者9）。候选及待接入的真实Electron参考图重启断言列于[第二版输入摘要](../../tests/v25/.results/d02/local-image-copy-v2-inputs.json)；未执行的宿主断言不计通过。


## 5.94 D02：方案参考图复制正式接入（2026-09-14）

前批 `3b3e852c… /1783` [完整Electron已终态](../../tests/v25/.results/d02/upload-owner-electron-full-summary.json)：194P/2外部凭据S/0F/0flaky，1477.835980秒。跳过项分别需要真实账号登录凭据及真实中转站key，未伪造为实际通过。本轮[21份实际ZIP与17份故意坏输入分类](../../tests/v25/.results/d02/upload-owner-electron-full-archive-inventory.json)完成，[21份实际ZIP扫描](../../tests/v25/.results/d02/upload-owner-electron-full-archive-scan.json)0命中/0错误，27.184458秒，无例外。上述进程已终态，不再是待等待任务。

随后正式安装受管路径复制、双数据库依赖和方案执行期所有者释放；删除原copyFile及适配器直接rm清理。正式就地增加真实复制9项、数据库关闭/双数据库清理2项，旧适配器夹具使用真实受管复制，并覆盖任务/方案资产/相对来源引用。新增真实Electron断言将核对方案试跑后的参考图字节摘要及新PID重启后的可读性，尚未执行时不记通过。

正式源码 `3a14bacd… /1784`，[专项60P/0F/0S](../../tests/v25/.results/d02/owned-copy-formal-focused-summary.json)1.641952秒；后续正式统一检查、实际HFS+、Electron方案试跑、产物/扫描与完整回归证据见本节各小节。§5.93 的候选记录和原缺陷保留，不改写成当时已交付。原完整GC、86/93七阶段和管理员前置不变。


首次正式统一检查[exit1](../../tests/v25/.results/d02/owned-copy-formal-check-summary.json)13.745937秒：6份独立探测用的`.config.mts`未格式化被全仓lint发现，其余并行任务随失败终止，不将取消报告当作产品缺陷。已保留[原配置逐字节快照与摘要映射](../../tests/v25/.results/d02/copy-probe-config-preformat-snapshots.json)，仅格式化这些配置；不删测试、不改排除规则，正式产品源码摘要不变，重新运行完整check。


### 5.94.1 正式检查与实际磁盘满

正式 `3a14bacd… /1784` [check38/38](../../tests/v25/.results/d02/owned-copy-formal-formatted-check-summary.json)58.151568秒通过，root单测2881P/48条件S；[源码扫描](../../tests/v25/.results/d02/owned-copy-formal-source-scan.json)0命中/0错误。这里没有把默认数据库条件跳过改记为集成通过。

不替换任何生产模块的[正式HFS+复测](../../tests/v25/.results/d02/owned-copy-formal-enospc-summary.json)exit0、2.450140秒；[字节与路径两次实际fd错误/清理证据](../../tests/v25/.results/d02/owned-copy-formal-enospc-evidence.json)均为20MiB请求、2,097,152字节后ENOSPC，失败返回后无残留副本/无遗留队列，原图摘要不变；存活上传、保留任务引用与末引用删除的保护/回收也通过。[实际输入摘要](../../tests/v25/.results/d02/owned-copy-formal-enospc-inputs.json)固定正式bundle及native，不继承隔离候选结论。临时卷已卸载清理。

真实Electron五项专项结果见§5.94.2，包含三种来源方案的实际云/桌面试跑与交换，以及两个窗口上传生命周期回归。新增断言要求任务参考图在实际试跑后和新PID重启后均可读、内容摘要与Provider收到的参考图一致。


### 5.94.2 实际方案试跑、新PID参考图与归档

同一 `3a14bacd… /1784` [真实Electron专项5P/0F/0S/0flaky](../../tests/v25/.results/d02/owned-copy-formal-electron-summary.json)，103.198760秒。brief、GitHub、history三种来源各完成实际云端/桌面试跑与跨端包交换；桌面任务的参考图副本在方案结束后和应用新PID启动后均能读取，摘要与本次受控Provider真正收到的参考图一致（brief无图时按空集合核对）。另外两项验证独立窗口关闭/整应用退出/主文档重载的上传释放。测试使用自有临时userData、实际API/PG/worker与受控模型服务，没有调用付费模型。

专项产出的[6份实际方案ZIP](../../tests/v25/.results/d02/owned-copy-formal-electron-archive-inventory.json)逐份扫描，[0命中/0错误](../../tests/v25/.results/d02/owned-copy-formal-electron-archive-scan.json)，0.092092秒。与前批源码的[9个变化路径](../../tests/v25/.results/d02/owned-copy-formal-source-diff.json)可追溯；新的实际安装包与完整Electron仍需收齐终态，不能继承前批194P。


### 5.94.3 当前安装产物与完整回归

同 `3a14bacd… /1784` [实际macOS arm64 ad-hoc打包](../../tests/v25/.results/d02/owned-copy-formal-package-summary.json)46.619778秒；[包冒烟6P/0F/0S/0flaky](../../tests/v25/.results/d02/owned-copy-package-smoke-summary.json)28.619231秒；[App/DMG/ZIP扫描](../../tests/v25/.results/d02/owned-copy-package-scan.json)0命中/0错误，21.713253秒。包冒烟产生[1份实际方案ZIP](../../tests/v25/.results/d02/owned-copy-package-smoke-archive-inventory.json)，[扫描](../../tests/v25/.results/d02/owned-copy-package-archive-scan.json)0命中/0错误，0.068823秒。[实际native/CLI摘要和native快照](../../tests/v25/.results/d02/owned-copy-binary-inputs.json)保留，避免全量回归期间后续CLI/native重建与已签名包混用。

**本批完整Electron正在运行，未记通过。** 前缀 `owned-copy-electron-full`，RUN_DATABASE_TESTS=true，实际196项，2026-09-14 00:21:22之后UTC启动。保持当前源码/测试/构建冻结，收齐终态后扫描本轮实际归档；不得以此前 `3b3e852c…` 的194P代替。完整G-DATA-02与后续六阶段仍继续，86/93未变，管理员仍在v2.5全部验收之后。


### 5.94.4 本批完整Electron及实际归档终态

`3a14bacd…/1784` [完整Electron](../../tests/v25/.results/d02/owned-copy-electron-full-summary.json)已终态：194P/2外部凭据S/0F/0flaky，1497.828821秒，2026-09-14 00:21:22.437418–00:46:20.266239 UTC。两项skip仍分别需要真实账号凭据及真实中转站key。本轮[归档分类](../../tests/v25/.results/d02/owned-copy-electron-full-archive-inventory.json)为21实际ZIP、17故意无效输入；[21实际ZIP扫描](../../tests/v25/.results/d02/owned-copy-electron-full-archive-scan.json)0命中/0错误，29.764376秒，无例外。源码漂移0核对后才解除冻结，后续新源码不能继承此完整回归结论。


## 5.95 工作台迟到读取/上传与账号变化复现（2026-09-14，候选未安装）

上一goal回合仅回答剩余阶段，没有代码或新验收，按no progress核对；本轮重新轮询真实会话56541仍在执行，未重启。正式源码冻结3a14bacd…/1784，漂移0。完整Electron结果继续归属§5.94.3，以下是独立组件探测，不能替代该实际宿主回归。

使用Vite pre-load仅替换既有工作台测试夹具，运行真实React/WorkbenchScreen与现有内存gateway。原源码[首轮1F/1P](../../tests/v25/.results/d02/workbench-reference-lifetime-red-summary.json)发现会话切走后仍上传；预览URL卸载释放实际通过。扩展到读取/上传迟到错误、卸载、当前错误反馈，[4F/2P](../../tests/v25/.results/d02/workbench-reference-lifetime-expanded-red-summary.json)；再覆盖账号epoch切换，[6F/2P](../../tests/v25/.results/d02/workbench-reference-lifetime-epoch-red-summary.json)，55项因定向名称过滤跳过。错误指向旧工作台源码行号是load替换夹具映射造成，准确探测正文由输入摘要固定。

候选只为仍属于本页/当前账号epoch的待上传操作启动IO或反馈，清空/移除/卸载失效本页待处理标记；当前上传失败保留原错误出口。原工作台55项与新增8项全部运行，[63P/0F/0S](../../tests/v25/.results/d02/workbench-reference-lifetime-epoch-candidate-summary.json)，18.360759秒。前两个候选57P、61P亦保留原始结果，不以重跑覆盖失败。正式主文件、构建与安装包均未改，候选和拟追加双视口浏览器用例见[全部输入摘要](../../tests/v25/.results/d02/workbench-reference-lifetime-probe-inputs.json)。浏览器新用例尚未执行。

本片解决尚未上传时的失效与迟到反馈；已到宿主的成功上传仍需独立释放协议，候选不声称已物理删除。已有ready参考图跨账号清理、窗口/服务长期保留、生成/方案在途与兑换恢复引用所有权仍须结合服务端GC补齐，具体接续条件见生命周期§18.1。原G-DATA-02范围、86/93和七个剩余阶段均不变。

### 5.95.1 扩大测试发现预览释放时序，双视口原构建复现

候选扩大到全部features后[777P/1F](../../tests/v25/.results/d02/workbench-reference-lifetime-all-features-candidate-summary.json)，19.697986秒。失败是原预览地址卸载测试：清理放在React setState更新函数内，卸载时不保证执行；此前单文件通过不足以证明无此缺口。新候选同步维护参考资源集合、再投影到React状态，未放宽原断言；[全部features 778P/0F/0S](../../tests/v25/.results/d02/workbench-reference-lifetime-owned-state-all-candidate-summary.json)，19.867972秒。仍是隔离load候选，正式代码与构建不变。

另启动独立headless浏览器上下文，读取会话56541已持有的同一冻结production Web服务器；不重建/准备服务器、不改native，不调用实际后端或数据库。首轮[2F](../../tests/v25/.results/d02/workbench-reference-read-browser-red-summary.json)是夹具起点错误：空白新设计中再次点新设计没有发生会话离场，不能据此宣称目标上传缺陷已复现。改为通过既有内存API创建会话并从其实际深链开始，PC/移动均到达原上传缺陷：[2F](../../tests/v25/.results/d02/workbench-reference-read-existing-session-browser-red-summary.json)，2.220476秒；释放被屏障暂停的真实File.arrayBuffer后，请求实测同时包含已清空的旧图片和当前新图片，预期仅新图片。此证据证明实际构建的前端行为；API仍是既有memory mock，不是云S3存储验收。原失败、修正夹具及全量候选摘要均保留。

### 5.95.2 队列受理复核及正式接入

代码复核补查TanStack异步onMutate/离线等待边界：即使Composer读取后已验证，上游实际调用仍可能晚于卸载或换号。使用真实MutationCache异步回调屏障，前候选[2F](../../tests/v25/.results/d02/workbench-reference-lifetime-admission-red-summary.json)证明网关仍被调用；hooks在mutationFn实际入网关之前复核同一有效性回调，原两条断言不变，[全部features 780P/0F/0S](../../tests/v25/.results/d02/workbench-reference-lifetime-admission-all-candidate-summary.json)，18.942074秒。公共UploadReferenceImageInput不变，此回调只属于共享页面内部生命周期，不进入IPC/HTTP。

上一批完整Electron及扫描终态后，正式接入Workbench同步预览集合、待上传失效/账号epoch及hook受理复核，增加10项就地组件回归和1项双视口浏览器场景。[四个变化路径](../../tests/v25/.results/d02/workbench-reference-lifetime-formal-diff.json)，新源码`d9215df1…/1784`；正在执行完整check、随后新浏览器用例与完整test:e2e。此时不记后者通过。已上传宿主文件的显式释放/持久回收、在途生成与费用恢复引用仍待原D02接续，不关闭整卡。

### 5.95.3 正式检查、双视口修复验证与完整回归

当前`d9215df1…/1784` [正式check38/38](../../tests/v25/.results/d02/workbench-reference-lifetime-formal-check-summary.json)，46.679107秒；features780P、root2881P/48条件S，API默认跳过的714项不记集成通过。[源码扫描](../../tests/v25/.results/d02/workbench-reference-lifetime-formal-source-scan.json)0命中/0错误，0.850097秒。[真实production Web双视口4P/0F/0S/0flaky](../../tests/v25/.results/d02/workbench-reference-lifetime-formal-browser-result.json)，3.511290秒：原拖拽→生成请求/回合附件，以及新旧图片读取隔离各在PC和移动执行；网络层沿既有memory mock，当前正式修复后只发送新图片。没有更新视觉基线。

已启动实际`pnpm run test:e2e`（RUN_DATABASE_TESTS=true），前缀`workbench-reference-lifetime-full-e2e`，包括重新双端build及全部web-desktop/web-mobile/electron，当前未结束、不记通过。保持此源码/测试/build/native/包冻结，终态后分类扫描本轮实际归档；前版3a14完整Electron不能当作本次完整三端结论。完整GC及后续六阶段不变。


## 5.96 已上传参考图释放协议的双后端候选（2026-09-14，未装正式源码）

上一goal回合正式修复工作台异步生命周期并完成check/局部宿主验收，属于progress。本轮重验`d9215df1…/1784`源码漂移0，真实会话5926仍运行完整520项三端E2E，不重启、不把已启动计数当作通过。以下候选用独立Vite pre-load验证，正式源码、构建、native及安装包未修改；完整G-DATA-02和七阶段继续。

### 5.96.1 协议及认证/数据库证据

候选从contracts定义严格`releaseReferenceImageInputSchema`，只接受图片id，类型由z.infer派生。云端新增候选DELETE `/reference-images/:id`：认证owner匹配且处于available的确定对象键，单条UPDATE将expiresAt缩短到当前数据库时间；不改status、不删引用、不直接调用对象删除、不写执行/费用。重复/缺失/其他owner均幂等204，非法id或额外query拒绝，未登录401。明确释放的是暂存保留，不代表物理删除已完成。

原路由缺席[5F](../../tests/v25/.results/d02/reference-release-api-red-summary.json)，这是待实现接口的对照，不是既有路由回归。候选[5P](../../tests/v25/.results/d02/reference-release-api-candidate-summary.json)，4.658326秒；随后加入真实生成事务已持有参考图行锁的竞争：[6P](../../tests/v25/.results/d02/reference-release-api-lock-summary.json)，4.783821秒。实际pg_blocking_pids证明释放UPDATE被原采用事务阻塞；采用提交后释放成功，原run及引用保持可读。已释放且无引用的旧输入不能授权新生成，费用/事件/队列无新增。23项既有资产用例仅因名称过滤跳过，不能登记为本次通过。

该组运行真实Better Auth、隔离PostgreSQL和Hono Request处理器，上传经实际S3 signer→回环HTTP存储替身；没有实际API bin或生产服务验收。原请求/来源/临时数据均为测试自有。

### 5.96.2 桌面受管文件与独立owner

候选方法表新增`generation.releaseReferenceImage`，主进程只接严格图片id，按受管uploads目录及既有三种图片扩展名定位，再交给可信sender的现有owner.release；既有owner只释放自己实际持有的文件，仍复查generation/方案/来源引用。原方法缺席[3F](../../tests/v25/.results/d02/reference-release-desktop-red-summary.json)，候选[3P](../../tests/v25/.results/d02/reference-release-desktop-candidate-summary.json)，1.300628秒，39项名称过滤跳过。验证另一窗口不能释放本窗口文件、重复释放、禁止路径/伪造sender入参、无可信sender拒绝，以及真实SQLite任务引用保护与最后引用删除后真实磁盘回收。Electron窗口身份用EventEmitter替身；core、native目录句柄、文件及SQLite为真实执行，不能据此宣布跨进程IPC完成。

### 5.96.3 实际MinIO维护、引用及故障重试

候选GenerationService经SDK实际上传到隔离MinIO，释放后仍能读原字节；未修改的生产worker清理执行器在维护时删除无引用对象并删除登记，重复维护无新删除。有正常生成API受理的run时释放及维护均保留原字节；正常cancel→remove→purge后才允许物理删除。实际停止MinIO使删除失败，持久队列保留；重启后原字节仍在，新数据库连接按记录的重试时间完成删除。仅推进next_attempt_at对应的调度时间，没有伪造存储失败或补写删除结果，也不把新连接写成新worker进程。

首次[2P/1F](../../tests/v25/.results/d02/reference-release-storage-candidate-summary.json)，5.248703秒：第三项夹具误查不存在的attempts列，真实schema为attempt_count；保留原文件与失败。修正查询列后[3P/0F](../../tests/v25/.results/d02/reference-release-storage-v2-summary.json)，4.891716秒，5项名称过滤跳过。临时MinIO/PG均已关闭清理，镜像身份及版本保留在日志。[全部候选/夹具/配置摘要与证据边界](../../tests/v25/.results/d02/reference-release-probe-inputs.json)。

### 5.96.4 正式接线仍待的原范围

当前公共platform、api-client、Desktop gateway/方法允许表以及共享UI尚未提供此新方法。正式接入还须补齐这些层、就地契约/传输/真实IPC测试与完整门禁。UI在建会话、生成受理、方案prepare/run及丢回包期间必须单独保留引用；兑换恢复需把原输入的保留责任从工作台移交到恢复意图，并在消费、替换或取消时归还，不能因页面卸载提前释放。迟到上传成功、ready图换号和释放回包失败分别处理；本机窗口关闭/持久队列与云24小时TTL作为故障回收依据，不能把仅内存标记当作持久恢复。长期Agent显式释放/期限、其他资产类别、原D02全矩阵及后续六阶段仍开放。

### 5.95.4 原工作台上传修复的完整三端终态（2026-09-14）

`workbench-reference-lifetime-full-e2e` 已于 01:41:01 UTC 终态退出 0，耗时 3029.675197 秒。实际执行原 `pnpm run test:e2e --reporter=json`，开启 `RUN_DATABASE_TESTS=true`，完整 520 项：**513P / 7S / 0F / 0flaky**；PC Web 160P/2S、Mobile Web 159P/3S、Electron 194P/2S。7 项跳过为 4 项外部凭据条件与 3 项视口不适用，不计为通过。输入仍是 `d9215df19752ed44970af44474f942cf6b07ecd1f4bdd0c9601886e2ee41fb11 /1784`，终态后再次确认 0 漂移。

实际留存 68 份方案文件，按内容区分 49 份实际 ZIP、17 份故意非法输入、2 份明确的 UI 文本替身。扫描实际 ZIP 与文本替身的 51 个目标，`workbench-reference-lifetime-full-e2e-archive-scan` 退出 0，27.207610 秒，0 findings / 0 errors；未将非法输入或 UI 替身称为正常安装包。上述结果只证明这一输入版本，不能继承为下面释放协议修改后的完整回归。

证据：[完整回归摘要](../../tests/v25/.results/d02/workbench-reference-lifetime-full-e2e-summary.json)、[逐项结果](../../tests/v25/.results/d02/workbench-reference-lifetime-full-e2e-result.json)、[文件分类](../../tests/v25/.results/d02/workbench-reference-lifetime-full-e2e-archive-inventory.json)、[扫描](../../tests/v25/.results/d02/workbench-reference-lifetime-full-e2e-archive-scan.json)。

### 5.97 参考图释放协议与生成/兑换恢复保留责任（2026-09-14）

#### 5.97.1 实现范围与保留条件

原完整回归与实际归档扫描终态后，正式接入 25 个文件的变更（含新 helper），涉及 canonical release schema、方法白名单、platform、两种 gateway、API、桌面域、共享工作台、账号恢复和就地/真实窗口测试。

- 释放只接受 strict `{id}`。云端以认证用户与规范对象键限定到期更新，与生成采用图片使用同一行锁；不会直接删除有持久引用的对象，不延长已到期时间。桌面以可信 IPC sender 找到本窗口 owner，只释放该 owner 已持有的受管路径；其他窗口、任意路径、伪造 owner 不获得删除权限。
- 工作台给图片的视图、在途普通生成/方案运行、兑换恢复分别保留引用。移除、切会话、卸载和账号 epoch 变化只放下视图的引用；迟到的上传成功立即归还其无用引用。普通/方案提交在首次异步建会话之前取得保留责任，直到提交返回/失败的 `finally` 才释放。
- 额度不足时，原输入、参考图和原幂等键一同保留。`consumeQuotaRecovery` 返回独立持有记录，恢复流程在 `finally` 释放；替换或重置只影响尚未消费的记录，不能提前释放已在途的恢复。兑换失败仍保留输入供用户明确再次兑换；清理失败不得引发生图/兑换重发。此记录只存在 features 内存，不扩展持久实体或把函数传进 IPC/HTTP。
- 账号切换后尚未完成的首次建会话不得继续向新账号提交原图片；方案迟到结果也不更新新账号界面。普通提交成功仅清理已提交的图片集合。
- 释放是归还临时保留责任；桌面持久清理队列、云端原有上传有效期仍作为故障兜底。本片不证明长期 Agent 上传续约、所有资产类别、自然有效期全矩阵或所有平台 GC 已完成。

#### 5.97.2 隔离探测与首败记录

完整回归运行期间没有修改冻结的正式源代码/构建。隔离 loader 只替换指定候选文件；下列数字是候选验证，独立于正式门禁。

| 检查 | 实际结果 | 意义与限制 |
|---|---|---|
| `reference-recovery-red` | 9F / 9 名称过滤 S，8.801836 秒 | 原恢复 store 没有释放责任；包含在途、换号、替换、卸载、兑换失败后再次兑换与清理错误 |
| `reference-recovery-candidate` | 20P，2.679803 秒 | 原相关测试与新增恢复场景合跑，真实 React/TanStack、内存 gateway |
| `reference-workbench-release-red-v4` → `candidate-v4` | 10F/65 名称过滤 S → 10P/65S，12.362716 → 2.279115 秒 | 原正式实现没有宿主释放；新增测试经过真实组件事件和异步提交。更早 v1–v3 的按钮名/初始会话 hydration 夹具失败均保留，未当作产品失败 |
| `reference-workbench-release-features` | 800P，23.020098 秒 | 候选完整 features，非浏览器或实际存储验收 |
| `reference-scheme-release-candidate` | 23P，3.987965 秒 | 原方案界面测试与异步建会话/在途运行保留责任两项 |
| `reference-release-transport` → `transport-v2` | 48P/2F → 51P，1.297937 → 0.938517 秒 | 首败揭示 HTTP 客户端解析空 204 的真实接缝缺口，另一项为新增 IPC 方法后的调用数；修为按响应 schema 校验 `undefined`，数据接口仍拒绝空响应 |
| `reference-release-type-probe-v2` | features/api-client 各 0 diagnostics，5.385901 秒 | 只读 TypeScript 源码覆盖探测；初版配置参数错误、测试只读数组及必选方法 fixture 缺失已修。该探测不代替项目原 `tsc -b` |
| `reference-workbench-release-final-features` | 803P，19.945882 秒 | 补首次建会话时换号用例、方案两项及类型 fixture 后完整候选复跑 |

候选文件、失败输出均留在 D02 证据目录。真实 PG/BA/MinIO 的先前后端探测边界见 §5.96；不把内存 gateway 断言称为对象存储删除或收费模型验证。

#### 5.97.3 正式门禁进行中

正式变更清单为 [reference-release-formal-diff.json](../../tests/v25/.results/d02/reference-release-formal-diff.json)。第一轮 `reference-release-formal-check` 因新 Electron 测试一处链式调用格式退出 1；修格式后启动原完整 `pnpm run check`，保留首败。正式 API 全部资产读取/释放集成与实际 MinIO 完整测试同时验证；MinIO 测试仍使用隔离的扩展测试文件，但加载的是当前正式 API/Worker 源码，没有替换生产实现，不把新 DB 连接称为新 Worker PID。

本节截至写入时这些新门禁尚未登记通过；真实 Electron 两窗口跨 owner、重复释放及 Composer 移除后的磁盘字节检查已写入，待当前双端构建成功后执行，随后执行完整三端回归和新输入的源码/实际归档扫描。长期 Agent、其他本地/云端资产生命周期、费用联合验收、真实旧库、四端交付和生产仍按原七阶段推进。管理员前置不变，86/93 不勾选更多父卡。

#### 5.97.4 正式统一检查、API 与存储终态

最终输入 `e6ea59a7482e07b6335d6d118153264638635ccf79f67e711f09661fb2b84932 /1785`，相对上一 d921 输入共 27 个文件变化；[当前差异与摘要](../../tests/v25/.results/d02/reference-release-formal-current-diff.json)保留来源。新入口加入后，原 IPC bridge 单测 fixture 少列一个方法导致第二轮 root 8F；补齐 fixture 后第三轮原 `check` 通过。随后新增 PC/移动 Web 真实 client→模拟 HTTP 的 DELETE/204 场景，第四轮只报其一处格式，按实际文件二次格式化后第五轮完整检查成功。未删除测试或降低方法集合断言；进程因上游 lint 退出出现的 EPIPE 不当作独立产品根因。

| 正式验证 | 结果 | 证据边界 |
|---|---|---|
| `reference-release-formal-check-v5` | 38/38，17.465811 秒；其中34项缓存 | features803P，root2892P/48条件S；API默认361P/720条件S、Worker默认88P/197条件S，默认skip不是PG验收；双宿主构建与边界检查通过 |
| `reference-release-formal-api` | 29P/0F/0S，8.278119 秒 | 原正式API资产整文件，真实BA/PG/Hono与本机S3 HTTP夹具；包含6项释放/采用锁/引用保留。不等于整个API集成目录或实际MinIO |
| `reference-release-formal-storage` | 8P/0F/0S，7.937882 秒 | 正式API/Worker生产源码、实际PG和MinIO，原5项与新增3项合跑；只有测试文件由隔离loader扩展，未修改生产模块加载。故障恢复是MinIO重启和新DB连接，不是新worker PID |
| `reference-release-formal-source-scan-v2` | 0 findings / 0 errors，0.783388 秒 | 对应当前源代码；没有用旧d921扫描替代 |

[统一检查](../../tests/v25/.results/d02/reference-release-formal-check-v5-summary.json)、[API摘要](../../tests/v25/.results/d02/reference-release-formal-api-summary.json)、[存储摘要](../../tests/v25/.results/d02/reference-release-formal-storage-summary.json)、[当前源码清单](../../tests/v25/.results/d02/source-reference-release-formal-v2.json)、[扫描](../../tests/v25/.results/d02/reference-release-formal-source-scan-v2.json)。真实Electron新增跨窗口/重复释放与Composer移除后的字节删除、PC/移动DELETE/204及原上传回归已启动，结果待终态；本轮完整三端仍须另跑，D02父卡不关闭。

#### 5.97.5 真实宿主通过，当前完整回归已启动

`reference-release-formal-hosts` **10P / 0F / 0S / 0flaky**，16.238485 秒。PC/移动各3项覆盖原拖图→生成、已取消文件读取、新DELETE/204；使用正式production Web构建与memory HTTP，不把它称为云端对象存储集成。Electron4项运行实际窗口、preload、IPC、SQLite/受管文件：原窗口关闭与文档重载、新两窗口保持打开时的跨owner/严格输入/重复释放、Composer选图再移除的磁盘字节回收。每项保留另一窗口/同窗口的无关文件，隔离userData终态清理；不是Windows实际平台或新安装包冒烟。

当前 `e6ea59a7…/1785` 再次0漂移后启动 **`reference-release-full-e2e`**，执行原 `pnpm run test:e2e --reporter=json` 并开启DB条件。此处仅记录已启动，必须等待实际终态与本轮新生成归档扫描后登记通过。期间保持正式源码、测试、构建与原生二进制不变；后续独立分析/候选验证不混入这一输入。上次d921的513P不继承给本次。

证据：[10项摘要](../../tests/v25/.results/d02/reference-release-formal-hosts-summary.json)、[逐项结果](../../tests/v25/.results/d02/reference-release-formal-hosts-result.json)。本批使参考图临时引用可以按产品动作释放，但原完整GC（长期Agent、其他来源/导入/staging写入与崩溃、云端晚到PUT/全引用租约、实际Windows）以及后续费用/旧库/交付/生产仍未完成，七阶段与86/93保持。

### 5.98 本地图片读取与控制面退出：已复现并验证候选，正式接入待当前完整回归终态

2026-09-14，当前正式源码仍为 `e6ea59a7…/1785`，再次检查无漂移；实际会话58734的原524项完整三端回归仍运行。下述测试通过隔离loader替换指定文件，未修改正在受测的正式源码、测试或构建。前次状态答复只重新确认了该具体活跃会话，本轮新增了可复现故障、候选实现和证据。

#### 5.98.1 同一文件句柄读取参考图

现有读取函数先检查文件头并关闭句柄，再按路径调用无界`readFile`。真实文件操作已复现：检查与打开之间替换、读取中增长到20 MiB以上、同一inode内容修改、叶节点替换、祖先目录转向，均可能返回未按同一内容检查的字节或过期元数据。真实`OpenAICompatibleProvider`→本地HTTP负例进一步证实，旧实现会发送被替换的参考图，最终得到测试端点的400，而不是在发送前拒绝图片。

候选保留系统选择的外部图片和稳定目录别名，解析选择路径后只开一个只读句柄；打开前后复核身份与元数据，分64 KiB读取且最多分配初始长度加1字节，再复核路径/身份/大小/时间。MIME和返回大小来自实际读取的字节。正常和错误出口均关闭句柄；Unix实际FIFO替换用例验证非阻塞打开后拒绝非普通文件。该函数只读外部原图，未扩大GC的删除授权；既有`stageLocalImage`的native受管复制仍保持原语义。

#### 5.98.2 发现文件清理失败不能中断资源退出

对实际控制面发现目录短暂设置不可写权限，再执行原始删除函数，实际产生`EACCES`，随后恢复测试目录权限。旧实现将`info`置空后抛错，实际HTTP端口仍监听。真实CLI宿主使用HTTP上传图片后再触发同一磁盘故障，得到上传副本仍存在、SQLite仍打开、owner.lock仍存在的失败结果。

候选记录固定诊断并继续关闭监听，允许宿主沿原顺序释放上传副本、清理持久队列、关闭数据库和释放所有权。实际HTTP后续连接失败，同进程再次启动成功且清理队列为空。测试没有收费Provider请求；同进程重新启动不登记为新PID崩溃恢复，macOS权限和FIFO证据不登记为Windows通过。

#### 5.98.3 实际命令结果与证据边界

| 探测 | 实际结果 | 范围与首败说明 |
|---|---|---|
| `local-image-read-red` | 退出1，worker OOM | 首个负例直接输出意外返回的大Buffer，导致断言诊断耗尽堆；不是产品内存故障结论。原日志保留，改用仅含长度/MIME的回执后重跑 |
| `local-image-read-red-v2` | 6F / 2P / 5名称过滤S，0.930374秒 | 真实文件操作；旧实现实际返回20,971,521字节。未修改正式reader |
| `local-image-read-candidate-v3` | 27P，1.235243秒 | 18项reader与9项实际native复制；读/关句柄异常、FIFO及真实Provider→本地HTTP包含在内 |
| `local-image-read-provider-red` | 1F / 1P / 16名称过滤S，1.277998秒 | 同一真实Provider下稳定图片可发送，被替换图片也被旧实现发送；候选要求后者在请求前拒绝 |
| `local-image-read-candidate-v4` | 18P，1.273789秒 | 改用目录junction别名以避免Windows文件symlink权限前置；本次命令误列不存在的native-copy测试名，实际仅运行reader，不能记27P |
| `automation-stop-discovery-red` → `candidate` | 1F/5P → 6P，1.351757 → 1.253849秒 | 实际HTTP监听与磁盘EACCES；失败用例终态由夹具关闭捕获的真实服务器 |
| `automation-stop-cli-red` → `cli-candidate` | 1F/2P → 联合9P，1.586414 → 1.474072秒 | 真实HTTP上传、native文件、SQLite与所有权锁；候选含原server测试整文件 |
| `reference-io-stop-type-probe` | 0 diagnostics，1.617561秒 | 只读TypeScript compiler-host覆盖5个候选文件；前一reader探测因跨项目`.ts`后缀选项报8项错误，修正noEmit探测配置后通过，不替代原`tsc -b` |
| `reference-io-stop-combined` → `combined-v2` | 5文件33P → **6文件42P / 0F / 0S**，1.387192 → 1.369132秒 | 更正遗漏的真实`local-image-copy.test.ts`文件名；最终包含reader、native复制、Provider传输、server、CLI清理与CLI runtime。Provider原传输单测mock reader，不作为真实文件证明 |

[候选文件摘要与完整命令](../../tests/v25/.results/d02/reference-io-stop-candidate-evidence.json)、[最终联合摘要](../../tests/v25/.results/d02/reference-io-stop-combined-v2-summary.json)、[类型探测](../../tests/v25/.results/d02/reference-io-stop-type-probe-summary.json)。候选原文及各次首败都保留；探测脚本格式化前摘要另存，不覆盖失败报告。

正式接入出口：等待`reference-release-full-e2e`真实终态，分类并扫描其实际归档；再按候选映射更新两个生产文件及三份就地测试，保存新的源码摘要，执行完整`pnpm run check`、适用真实Electron/CLI流程与新输入扫描。原完整GC、费用矩阵、真实旧库、四端和生产验收仍按七阶段推进，86/93不变，管理员尚未开始。


#### 5.98.4 独立CLI进程与原生不可删除文件（候选，2026-09-14）

本轮将同一实际CLI入口分别构建到隔离目录，原版使用冻结正式源码，候选仅替换`automation-server/server.ts`；不重建或替换正式CLI/native/Electron产物。两份均复制相同现有native二进制，保留esbuild逐输入/输出摘要。使用实际macOS `chflags uchg`使隔离发现文件无法删除，其他目录保持可写，真实HTTP上传后向CLI发送SIGTERM；不是mock stop、伪造errno或改DB状态。

- 原版进程红测退出1，4.773290秒：停止后进程仍活、health返回200、上传副本与owner.lock均在。夹具仅强杀自己启动的失败进程并移除自己的文件保护，原失败结果保留。
- 候选通过，6.044369秒：PID15624正常退出0，原端口不可连接，副本和锁已释放，故意不可删除的发现文件仍在；撤销该测试文件保护后PID15637实际重新启动，持久清理队列为0，并再次正常退出。未发出生图请求。
- 两份CLI目录共14个实际文件（含native）扫描0命中/0错误，0.108549秒；这是隔离CLI构建扫描，不是正式App/DMG或Windows发布验收。
- 同一流程已抽成开发CLI/打包CLI共用helper候选。实际Playwright装配先1P，修复新helper的循环返回类型推导后再1P（2.004047秒、0F/0S/0flaky），输入仍为隔离候选CLI。新增helper及生产/就地测试的只读类型探测0诊断，1.902086秒。广泛宿主探测曾报11项：新helper2项已修；既有`cli-write-crash-process`2项与探测配置的DOM/JS类型项分别保留，未据此声称整个宿主类型门禁已通过。

准备正式接入的映射现为8个文件（2生产、3就地测试、新helper及2宿主测试），其中helper为新增文件。正式源码仍e6ea59a7…/1785无漂移，原完整524项回归仍运行。实际开发CLI与安装包测试必须在正式合入及对应构建后执行；候选进程成功不提前登记这两项。

证据：[独立进程、候选映射与摘要](../../tests/v25/.results/d02/reference-io-stop-process-evidence.json)、[构建输入](../../tests/v25/.results/d02/stop-process-build-inputs.json)、[实际构建扫描](../../tests/v25/.results/d02/stop-process-artifact-scan.json)、[Playwright新版摘要](../../tests/v25/.results/d02/stop-process-playwright-v2-summary.json)。本证据推进原D02退出/重启边界，不关闭长期Agent上传全生命周期、完整GC、七阶段或管理员前置。


#### 5.97.6 完整三端回归终态（2026-09-14，e6ea59a7…）

`reference-release-full-e2e`原命令实际终态退出0，3019.835442秒；517P/7S/0F/0flaky。PC Web161P/2S、Mobile Web160P/3S、Electron196P/2S。七项跳过逐条保存在[结果分类](../../tests/v25/.results/d02/reference-release-full-e2e-classification.json)：四项实际外部登录/图片Key条件，三项视口不适用，不作为已通过用例。共68份方案文件已分类为49实际ZIP、17故意非法输入及2明确UI文本替身，51个目标的扫描进行中。此结果属于冻结e6ea59a7…/1785，不包含§5.98尚未安装的读取/退出候选。[实际执行摘要](../../tests/v25/.results/d02/reference-release-full-e2e-summary.json)。


### 5.99 读取与退出修复已正式合入（2026-09-14）

前一e6ea59a7…完整三端517P/7S/0F/0flaky已终态；49实际ZIP和2明确UI文本替身共51扫描目标0命中/0错误，27.232734秒，[归档扫描报告](../../tests/v25/.results/d02/reference-release-full-e2e-archive-scan.json)。17故意非法输入单独归类，未用宽泛例外绕过检查。

随后按8文件映射正式接入本地reader、Automation stop、三份就地测试、共用独立CLI helper及开发版/打包CLI回归。初始正式输入2079e93e…/1786专项42P，原完整check首败为reader在finally抛错和3处格式。修为成功返回前关闭句柄、出错时只关闭一次并保留原始错误，不在finally覆盖控制流；格式修复仅涉及准确报错文件。原stdin候选检查没有证明仓库完整lint，实际首败保留。正式宿主首次命令因`--project`多值解析误将文件名当项目名，未运行测试；改用文件参数在前和`--project=electron`，不算产品失败或降低测试范围。

当前正式输入 `48ddbae75f19771563f8ad726f24331f8303c39459311d6569de79800452a170 /1786`，相对e6ea59共8文件变化（1个新增helper），[差异](../../tests/v25/.results/d02/reference-io-stop-formal-current-diff.json)、[不可变源码清单](../../tests/v25/.results/d02/source-reference-io-stop-formal-v2.json)。

| 正式检查 | 实际结果 | 边界 |
|---|---|---|
| `reference-io-stop-formal-focused-v2` | 6文件42P/0F/0S，2.253517秒 | 原正式源码，无loader替换；实际文件/HTTP/native/SQLite及回归 |
| `reference-io-stop-formal-check-v2` | 38/38，61.777420秒，0缓存 | root2907P/48条件S、features803P；API默认361P/720条件S与Worker默认88P/197条件S不登记为DB全量通过；双宿主构建与边界通过 |
| `reference-io-stop-formal-source-scan` | 0命中/0错误，10.217108秒 | 当前48ddbae7…输入 |
| `reference-io-stop-formal-hosts-v2` | 已启动，终态待收取 | 10项实际Electron/CLI、上传owner与三来源方案试跑/交换；尚未登记通过 |

[统一检查](../../tests/v25/.results/d02/reference-io-stop-formal-check-v2-summary.json)、[专项](../../tests/v25/.results/d02/reference-io-stop-formal-focused-v2-summary.json)、[源码扫描](../../tests/v25/.results/d02/reference-io-stop-formal-source-scan.json)。§5.98的两份隔离CLI构建在扫描后移入既有ignored证据目录，14文件字节相同，[迁移收据](../../tests/v25/.results/d02/stop-process-build-relocation.json)保留历史/当前路径；未修改lint规则、删除证据或把隔离构建当正式安装包。

接续当前真实宿主终态/新归档扫描、实际macOS包及新增包内退出用例、当前完整Electron；前一e6ea59全量结果不继承到本次新生产代码。完整G-DATA-02和后续费用/真实旧库/四端/发布/生产保持开放，86/93七阶段不变。


#### 5.99.1 宿主首败、诊断与重复验证

正式10项宿主`reference-io-stop-formal-hosts-v2`终态为**9P/1F**（93.533283秒），不登记为整组通过。3项CLI、4项上传owner及brief/history方案交换通过；GitHub方案在Web端`iterateFormalScheme`选图后提交钮5秒仍禁用，此时尚未进入Desktop方案部分。4份实际方案ZIP已扫描0/0。仅凭失败位置不能认定reader回归或已修复偶发问题。

对同一失败场景启用完整trace的独立诊断1P（48.342683秒），保留原失败；成功trace包含启动鉴权401与未试跑晋升的预期409，没有草稿PATCH409。随后只为`selectTrialReferences`增加失败时、关闭浏览器前保存body aria快照，未修改生产UI、断言或超时。原GitHub场景`repeat-each=3`实际3P/0F/0S，137.149713秒；2份诊断与6份重复验证实际ZIP分别扫描0/0。首次失败原因仍未确定，不能将这些复跑写成一次已定位的产品修复。

因此正式源码清单更新为`8bdd4329d8d6e202dbbc50938bc4184daea20a02d88ea068a7598481d1530b0e /1786`（相对e6ea59共9文件变化，最后一项仅测试诊断）；[当前清单](../../tests/v25/.results/d02/source-reference-io-stop-formal-v3.json)。原完整check-v3再次38/38，32项缓存，41.480365秒；root2907P/48条件S、features803P，API/Worker默认条件skip口径不变；当前源码扫描0/0，1.660259秒。实际完整10项宿主-v3已启动，后续完整Electron仍需执行以核对偶发性。

[首败完整结果](../../tests/v25/.results/d02/reference-io-stop-formal-hosts-v2-result.json)、[trace诊断摘要](../../tests/v25/.results/d02/reference-io-stop-github-diagnostic-summary.json)、[3次重复摘要](../../tests/v25/.results/d02/reference-io-stop-github-repeat-summary.json)、[当前check](../../tests/v25/.results/d02/reference-io-stop-formal-check-v3-summary.json)。包构建/包冒烟及当前完整Electron仍待，不提前关闭本片的宿主出口或D02父卡。

#### 5.99.2 当前宿主、实际安装包终态与完整Electron（2026-09-14）

正式输入保持8bdd4329…/1786，打包后冻结检查0漂移。原10项宿主-v3本次10P/0F/0S/0flaky，115.302297秒；6份真实ZIP扫描0命中/0错误，0.094879秒。保留§5.99.1首败与诊断，不将复跑通过表述为已定位并修复偶发根因。

| 检查 | 实际结果 | 适用范围 |
|---|---|---|
| `reference-io-stop-package` | exit0，46.228747秒 | 当前macOS arm64 ad-hoc构建，未改版本、未正式签名公证或部署 |
| `reference-io-stop-package-smoke` | 7P/0F/0S，28.725629秒 | 整个严格包smoke；包含实际包内CLI发现文件不可删除后正常退出、新PID接管和上传回收 |
| `reference-io-stop-package-scan` | 6 targets，0命中/0错误，21.577611秒 | 本轮实际App/DMG/ZIP内容 |
| `reference-io-stop-package-archive-scan` | 1实际ZIP，0命中/0错误，0.070026秒 | 本轮包内产品导出的方案包 |
| `reference-io-stop-full-electron` | 已启动原完整199项，终态待收取 | RUN_DATABASE_TESTS=true，无缩减用例；测试期间正式源码/build/native/产物冻结 |

[宿主完整结果](../../tests/v25/.results/d02/reference-io-stop-formal-hosts-v3-result.json)、[打包摘要](../../tests/v25/.results/d02/reference-io-stop-package-summary.json)、[严格包冒烟](../../tests/v25/.results/d02/reference-io-stop-package-smoke-result.json)、[产物扫描](../../tests/v25/.results/d02/reference-io-stop-package-scan.json)、[包内方案扫描](../../tests/v25/.results/d02/reference-io-stop-package-archive-scan.json)。

当前只证明读取/退出修复和相应宿主/包边界，完整GC继续原D02.1–7。下一核对长驻Automation上传的显式归还、自然期限、等待确认/在途/重启的持久引用保护；其他方案来源、导入素材、未知孤儿、云端迟到PUT/全引用竞争和Windows仍未据此验收。管理员继续等待全部v2.5。

### 5.100 长驻Agent上传前置：持久引用漏保护与哈希读取（隔离候选，2026-09-14）

本轮完整Electron仍验证8bdd4329…正式源码，以下四个已有文件的候选通过loader读取，另准备一个真实宿主用例；尚未合入、构建或声称安装包已修复。完整D02.1–7保持不变。

**已证实的问题**：本机清理器读取generation/方案/来源引用，但未查`automation_spend_requests.frozen_input_json.references`。实际ledger.register已先于生图历史冻结输入；owner释放后，等待确认、已授权、执行中、终态的原图均被删除。真实Desktop持久化适配器也复现：登记SHA256和references后、首次Provider调用前，owner关闭即丢图。候选流式读取所有scope的generate_image冻结引用，不因终态或换scope忽略；只识别实际references字段，提示词中的文件名不构成引用；损坏快照使本批停止并保留待重试记录。既有ledger保留政策未改变，测试删除最后请求仅用于验证引用谓词，不新增生产删除接口。

**第二处已证实的问题**：`automation-spend.ts/referenceHash`另有同步文件读取，尚未复用上一批异步reader。真实替换、同inode改写、祖先目录替换均被原实现接受；原文件67字节在fstat后长到20MiB+1时，实际先读入20,971,521字节再报错。描述符读完后改写文件也未被拒绝。真实FIFO在独立自有Vitest进程进入referenceHash后阻塞12秒，外层仅终止自有进程组并清理自有fixture；这是有界红测，非程序正常退出。

候选保持同步授权入口，改为先检查普通文件、`O_NONBLOCK|O_NOFOLLOW`打开、64KiB分块增量SHA256、最多选择时大小+1字节，并在读后复核fd、原选择路径的dev/ino/size/mtimeNs/ctimeNs。错误保持固定安全消息；不拓宽原受管路径授权。额外覆盖恰好20MiB、稳定目录别名和拒绝授权时零读取。

| 隔离验证 | 实际结果 | 限制 |
|---|---|---|
| `automation-reference-red-v2` | 12P/6F，1.565491秒 | 原生产清理器，真实SQLite/native owner；首次red含一个FK夹具错误，已修正scope初始化后再证实6个产品失败 |
| `automation-reference-adapter-red` | 8P/1F，1.759284秒 | 实际Desktop适配器；凭据为合成配置，尚未调用Provider即丢失原图 |
| `automation-reference-candidate-joint` | 4文件58P/0F/0S，3.303399秒 | 候选引用保护、owner/cleanup/retention及真实适配器→本地HTTP单次出图 |
| `automation-hash-races-red` | 3F/10筛选S，1.533297秒 | 三种实际路径/内容替换；筛选跳过不是环境通过 |
| `automation-hash-fifo-red` | 达到调用点后12秒未退出 | 原实现阻塞，外层终止自有测试进程组；原FIFO路径及清理收据保留 |
| `automation-hash-read-red` | 2F/13筛选S，1.251148秒 | 实际fstat/read调度点间改写真实文件，非伪造read成功 |
| `automation-reference-hash-checked` | 4文件64P/0F/0S，3.714726秒 | 已格式化候选，含真实FIFO即时拒绝；随后新增20MiB正边界用例继续验证 |
| `automation-reference-hash-type-probe` | 0诊断，2.396428秒 | 只读TS compiler host加载候选，不是正式`tsc -b`或完整check |

[候选与输入哈希](../../tests/v25/.results/d02/automation-reference-candidate-evidence.json)、[引用红测](../../tests/v25/.results/d02/automation-reference-red-v2-summary.json)、[实际适配器红测](../../tests/v25/.results/d02/automation-reference-adapter-red-summary.json)、[FIFO有界红测](../../tests/v25/.results/d02/automation-hash-fifo-red-summary.json)、[联合64项](../../tests/v25/.results/d02/automation-reference-hash-checked-summary.json)。

已准备真实Electron Automation上传→生图→输出purge→停用服务→新PID→原key回读场景，当前仅`--list`发现1项，不记录为已执行。须等正在运行的完整Electron真实终态与归档扫描后，再验证新场景、合入候选、运行正式check/受影响宿主/新安装包及完整Electron。长驻Agent的显式归还/期限本轮尚未接入，先修引用保护前置；原云端迟到PUT、全引用/其他目录与Windows仍继续。

#### 5.100.1 候选最终专项与宿主准备

增加恰好20MiB、稳定目录别名和拒绝授权零读取正边界后，`automation-reference-hash-final`原4文件**65P/0F/0S**，3.744907秒；最终只读TS probe-v2 **0诊断**，2.456364秒。四文件的stdin Biome check --write均0，随后正式冻结检查仍8bdd4329…/1786、0漂移；stdin预检不替代后续真实仓库check。候选映射为`automation-reference-hash-type-map-v2.json`，实际Electron新场景仅收集1项，尚未运行。

本轮时间线包含真实inode/文件替换、fstat/read后增长及FIFO；POSIX FIFO红测的12秒超时是外层观察上限，不是应用自身恢复保证。无真实付费请求、正式App/用户库或生产动作。正式合入与门禁仍待当前完整Electron终态。

#### 5.99.3 正式完整Electron终态（8bdd4329…）

2026-09-14：原完整199项本轮197P/2S/0F/0flaky，1496.039358秒；跳过为活体登录凭据与真实中转站API Key各一项，原因逐项保留，不登记为生产验证通过。38份留存方案文件中21实际ZIP扫描0命中/0错误（27.174305秒），17故意无效输入另列。GitHub方案交换本轮通过，§5.99.1首败未再出现，但根因仍未确认。

[完整结果](../../tests/v25/.results/d02/reference-io-stop-full-electron-result.json)、[跳过明细](../../tests/v25/.results/d02/reference-io-stop-full-electron-skips.json)、[实际归档分类](../../tests/v25/.results/d02/reference-io-stop-full-electron-archive-inventory.json)、[归档扫描](../../tests/v25/.results/d02/reference-io-stop-full-electron-archive-scan.json)。这次结果完成读取/退出批次的当前本机完整门禁，不能关闭整个GC；§5.100的新候选及其实际宿主验证接续，正式源变更后重新取得对应证据。

### 5.101 Agent持久引用与哈希读取已正式接入（2026-09-14）

当前正式源码`558067cfe205cf60f0ef471545cdf5f766dc9a65f68c349c145196662be87421 /1787`，相对8bdd4329四个已有文件变化、新增一个永久Electron回归。生产改动仅core引用保护及Desktop referenceHash；测试包含真实SQLite/native、适配器/HTTP和新宿主用例。没有增加费用批准接口、改变账本保留或开始管理员开发。

先对原正式bundle执行新真实Electron用例：正常Automation上传、带图生图成功并核对实际multipart字节，随后产品入口purge生成输出、停用控制面，参考图被删，实际1F/4.401332秒。确认缺口后合入候选；第一次正式check仅新宿主文件format一处错误而中止（15.299579秒），修复确切格式后原check再次**38/38**（5缓存，60.920399秒）。root2922P/48条件S、features803P；API默认361P/720条件S和Worker88P/197条件S不能当数据库完整集成验收。双宿主构建与边界通过。源码扫描0命中/0错误，2.120135秒，构建后冻结0漂移。

[当前源码](../../tests/v25/.results/d02/source-automation-reference-formal-v2.json)、[实际宿主首败](../../tests/v25/.results/d02/automation-reference-host-red-result.json)、[正式完整check](../../tests/v25/.results/d02/automation-reference-formal-check-v2-summary.json)、[源码扫描](../../tests/v25/.results/d02/automation-reference-formal-source-scan.json)。当前11项正式宿主专项已启动，包含新引用保留、实际CLI/MCP G/R/S、全部CLI清理/上传owner和原Agent保留矩阵；尚不登记为终态通过。后续新包与完整Electron仍需当前输入证据，不能继承§5.99.3的197P。

#### 5.101.1 真实宿主修复验证与路径别名断言

原11项正式宿主终态10P/1F（52.793981秒）。新用例已证明停用后文件存活、字节及账本不变，失败在队列路径断言：清理队列保存规范`/private/var/...`，上传回执为系统别名`/var/...`。按实际规范化策略把预期改为`realpathSync(image.path)`，不放宽引用/字节/账本断言。原失败完整保留；其余10项原生CLI、上传与Agent G/R/S/retention通过，未生成方案包（留存归档0份，不伪写扫描通过）。

测试修正后正式源码`e400c923db533d4c7418abc9453ae9750a74ac4c3a181fb2cdcaa3d107668d26 /1787`；check-v3 **38/38**，32缓存，41.867307秒；root2922P/48条件S、features803P，API/Worker条件口径同上；源码扫描-v2 0命中/0错误，10.399376秒。仅重跑本次修改的新宿主场景：**1P/0F/0S/0flaky**，6.154981秒，实际PID38957→38966，原图SHA256一致，生成发送计数始终1，保留1条请求、purge1份输出；原key回读不重发。不能把分次结果改写成一次11P的报告，后续原完整200项Electron统一收口。

[首轮11项结果](../../tests/v25/.results/d02/automation-reference-formal-hosts-result.json)、[当前源码](../../tests/v25/.results/d02/source-automation-reference-formal-v3.json)、[check-v3](../../tests/v25/.results/d02/automation-reference-formal-check-v3-summary.json)、[新场景终态](../../tests/v25/.results/d02/automation-reference-formal-host-fixed-result.json)、[实际新PID/字节/调用次数](../../tests/v25/.results/d02/automation-reference-formal-host-fixed-evidence.json)。当前新macOS包构建进行中，包smoke/扫描与本批完整Electron仍需执行。

#### 5.101.2 原完整200项Electron终态（e400c923…）

2026-09-14：e400c923…/1787 的原完整200项本轮 **197P/2S/1F/0flaky**（1595.084秒，RUN_DATABASE_TESTS=true）。2项跳过为活体登录凭据与真实中转站Key各一，逐项保留。唯一失败 `electron.package-disk-full.spec.ts`「actual full filesystem during maximum package import…」在点击 `scheme-create-option-import` 时30秒超时（元素已解析、等待可见/启用/稳定未满足）；定向复跑同用例 **1P/0F（25.9秒）**，根因未确认，按§5.99.1同型登记为间歇失败，不改断言不删用例。留存38份方案文件中**21实际ZIP扫描0命中/0错误**、17故意无效输入另列。该结果连同§5.101.1闭合读取/退出与引用保护批次的宿主出口；不能关闭完整GC。

[完整结果](../../tests/v25/.results/d02/automation-reference-full-electron-result.json)、[归档分类](../../tests/v25/.results/d02/automation-reference-full-electron-archive-inventory.json)、[归档扫描](../../tests/v25/.results/d02/automation-reference-full-electron-archive-scan.json)、[失败复跑命令留存](../../tests/v25/.results/d02/package-disk-full-rerun-result.json)。

### 5.102 长驻上传显式释放/TTL与云端晚到PUT联合矩阵（2026-09-14）

本批继续 **G-DATA-02 / D02.3+D02.6**：桌面长驻Automation上传的显式释放与自然期限回收、云端晚到PUT/全引用租约×服务边界联合验收。86/93、剩余七阶段不变，管理员不提前开始。两块各由一个子代理（glm/kimi）并行开发，主代理统一门禁；域隔离（core/desktop/cli 与 worker/api/db）无交叉改动。

**生产实现（桌面，D02.6）**：`packages/core` 新增 `LOCAL_UPLOAD_TTL_MS=24h`（对齐云端参考图registry TTL先例，不进contracts、无用户配置）；`LocalUploadOwner.hold` 记录获取时刻并登记存活owner，新增 `expireLocalUploadHolds`（仅uploads根内、持有超TTL的项走owner自身release——归还写租约+提前next_attempt_at+drain）与宿主timer入口 `reclaimLocalAssets`；`application.ts` 60秒timer与headless `serve-runtime` 的cleanupTimer复用该入口，不新建timer。请求终态自动降级：`createDesktopGenerationPersistence` 增可选 `hooks.onTerminal`（finishRequest落库后回调，失败不污染终态），Electron宿主以 `releaseTerminalReferences(uploadOwner, request)` 对冻结references路径幂等release；共享包 `packages/automation-server` 零改动。误释放不误删：删除决策始终由drain的protectedPaths复查兜底（§5.100谓词未变）；blocked行不受TTL触碰。denied/timeout确认终态不经persistence.finish，此类上传由owner close或TTL兜底，属拍板边界。

**生产修复（云端，D02.3）**：实测确认热key饥饿缺陷——批内一个key被写入事务持锁时 `authorizeDeletion` 整批55P03回滚，无辜同批key每轮白烧claim次数、12轮后被连坐abandoned。修复仅 `apps/worker/src/tasks.ts`：多key批量遇55P03逐key重试退休，仍争用的key按leased走既有deferLeased退避（不abandoned），同批其余正常退休；锁释放后下一轮收敛；单key调用与inventory执行器路径不变。S2b（SDK默认重试覆写致registry byteSize漂移）实测排除：六条上传路径均为缓冲字节，丢响应重发后MinIO落盘ContentLength/ETag与声明一致。

**新测试**：core `local-upload-ttl.test.ts`（9项，真实SQLite）；desktop `automation-upload-release.test.ts`（6项）；cli `serve-cleanup.test.ts` +1；Electron新宿主回归 `electron.automation-upload-release.spec.ts`（控制面运行中终态释放、SIGKILL新PID启动回收、冻结引用字节与账本不变）。worker `late-put-recovery.integration.test.ts`（11项：七类对象「删除完成后PUT字节才落盘→再扫描→二次删除→HEAD 404」端到端闭环、退休键重发布P0001、退休提交后/删除前PUT删除序、multipart悬挂探针、第三次PUT仍收敛）；`reference-lease-matrix.integration.test.ts`（4项：generation_references/exports/generation_runs三分支授权前一瞬保护、热key饥饿+修复锁定）；`lost-storage-response` 扩展延迟转发模式。api `late-put-retirement.integration.test.ts`（4项：参考图/包stage confirm被P0001拒绝+补偿、退休哈希vs唯一约束语义）；`gc-service-boundary.integration.test.ts`（2项：真实API子进程×真实worker bin×真实MinIO）；新fixtures `gc-object-storage.ts`、`package-stage-process` upload模式。

| 检查 | 实际结果 | 备注 |
|---|---|---|
| 定向：core 6文件 / desktop 5文件 / cli 3文件 | 76P / 67P / 16P，0F | 子代理就地真实层 |
| 定向：worker late-put+matrix / api 4新文件 | 15P / 6P，0F | 真实PG+MinIO |
| 统一check | 38/38，exit0 | 首轮2处类型错误已修（见首败） |
| 完整Worker 单测/集成 | 88P/212门控S；210P/2S | 2S为container-runtime外部镜像门控，既有条件 |
| 完整API 单测/集成 | 361P/726门控S；首轮725P/1F/1S→串行复跑53文件**726P/1S**，0F | 1S为专用自然期限小时测试 |
| 源码扫描 | 1702文件，0命中/0错误 | ruleset v25-content-1 |
| 冻结源码清单 | 1795项 `3bede98cd37eebb59b867b4b6832be0c351d361e673a2d5aa18b1e43c443639a` | 相对e400c923新增8文件（本批测试/fixture） |
| 完整Electron（3bede98c…） | 199项：**197P/2S/0F/0flaky**，exit0，1549.68秒 | 2S为既有外部凭据用例（活体登录、真实TvT尾号），与§5.101口径一致 |
| Electron归档扫描 | 21实际ZIP+17故意无效输入，0命中/0错误 | ruleset v25-content-1 |
| 新macOS包（3bede98c…，2.5.0 arm64） | adhoc构建exit0（48.1秒，turbo缓存命中），app/dmg/zip 15:04新鲜产物，签名"valid on disk" | 与既往批次同口径 |
| 包产物扫描 | 2产物/6目标，0命中/0错误 | DMG挂载校验asar/cli/mcp哈希一致 |
| 7项包smoke | **7P/0F/0S/0flaky**，exit0，28.5秒 | CLI中断清理/原生资源恢复/方案导入暂存清理/真实产物+受管迁移+重启/前缀10、11升级/端口关闭与上传副本释放 |
| 包smoke归档扫描 | 1实际ZIP，0命中/0错误 | ruleset v25-content-1 |
| 收尾冻结校验 | 1795项 `3bede98c…`，drift=0 | 包构建/冒烟后源码未变 |

**首败与根因（全部保留）**：①统一check首轮typecheck失败——`automation.ts` 丢失 `GenerationHost` 返回标注致host回调参数隐式any、测试一处onCost参数unknown；补回标注+参数类型后过。②`local-upload-ttl` 别名用例在check下失败而单独跑通过，定位为**环境决定性**：turbo任务剥离TMPDIR后 `os.tmpdir()` 落到 `/tmp`（realpath `/private/tmp`），用例硬假设临时目录在 `/private/var` 下；改为自建symlink别名链验证同一realpath回退（两种TMPDIR环境各9/9），非间歇失败。③完整API集成首轮 `design-scheme-package-export` it.each('version') 5秒超时——与并发执行的完整Worker集成互相压载所致（主代理调度失误）；单文件复跑44P/0F、串行完整726P/0F，首败日志保留。

**登记的开放项**：参考图confirm遇P0001在HTTP层表现为500 INTERNAL_ERROR（app.ts无409映射），服务级栅栏与补偿已验，语义显式记录未改；双进程矩阵D③（worker领取后SIGKILL×租约接管×confirm恰在窗口）未单独实施，等价领取-接管机制由既有inventory-bin用例覆盖；`object_key_retirements` 无界增长与哈希不含bucket前提高危部署需容量/多桶观测，属后续expand/contract新卡。Desktop慢复制/进程暂停实测覆盖、Windows原生路径及原D02.1–7其余出口继续开放。

[上传释放/TTL证据](../../tests/v25/.results/d02/upload-release-ttl-candidate-summary.json)、[晚到PUT矩阵证据](../../tests/v25/.results/d02/late-put-matrix-summary.json)、[源码扫描](../../tests/v25/.results/d02/upload-ttl-lateput-source-scan.json)、[冻结清单](../../tests/v25/.results/d02/source-files.json)、[完整Electron终态](../../tests/v25/.results/d02/upload-ttl-lateput-full-electron-result.json)、[Electron归档扫描](../../tests/v25/.results/d02/upload-ttl-lateput-full-electron-archive-scan.json)、[包扫描](../../tests/v25/.results/d02/upload-ttl-lateput-package-scan.json)、[包smoke终态](../../tests/v25/.results/d02/upload-ttl-lateput-package-smoke-result.json)、[包smoke归档扫描](../../tests/v25/.results/d02/upload-ttl-lateput-package-smoke-archive-scan.json)。

### 5.103 慢复制/进程暂停实测、暂存类别复核与消费后账本保留出口（2026-09-14）

本批继续 **G-DATA-02 / D02.5+D02.6+D02.2+D02.1**：桌面受管复制慢速窗口与真实进程暂停（SIGSTOP≠SIGKILL）、其余 Desktop 暂存类别复核、云端消费后上传账本保留政策出口、云端资产目录与保护矩阵。86/93、剩余七阶段不变，管理员不提前开始。glm（桌面域：core/desktop/cli/tests spec）与 kimi（云端域：worker/api/db/lifecycle 文档）并行开发，主代理统一门禁，域隔离无交叉改动。

**桌面（D02.5/D02.6）：零生产改动**。慢复制/暂停语义由既有 hold-at-acquisition、写租约、24h TTL 与 drain 引用复查机制承载，本批以真实层测试钉死：core `local-upload-slowcopy.test.ts`（3 例，真实 fs.write 钩子先转发真实写再注入干预）：mid-copy `expireLocalUploadHolds` 只释放老化 sibling（在飞无 hold）、mid-copy `reclaimLocalAssets` 经写租约把在飞行 defer `writing` 且老化 sibling 照删、mid-copy 写失败残渣由 finish drain 回收且原件 bytes+dev/ino 不变；desktop `automation-upload-release.test.ts` 新例以真实 `stageLocalImageBytes`+owner 走真实 POST /v1/uploads 复测同窗口（7P）；Electron `electron.staging-pause-resume.spec.ts` 真 2 MiB 控制面上传在 256 KiB 处 SIGSTOP：冻结 64 秒跨完整 60 秒维护周期（ps state 'T'），磁盘/账本零变化（含预置到期无主行），SIGCONT 后复制完成（SHA256 相等）、受保护 deferral、恢复 drain 只回收无主行、`automation_spend_requests` 始终 0；CLI 层 `electron.cli-cleanup.spec.ts` 新例：真 CLI serve 冻结 65 秒跨维护 tick 零变化，恢复后回收收敛、SIGINT 干净退出。**暂存类别复核表（7 类）**：方案包暂存/上传暂存/Composer 工作台/方案修订-源-run 复制/skill 源缓存均完备（证据逐类列出）；分享导入 staging 失败回滚完备但崩溃孤儿无启动 GC（登记）；分享导出 .partial/.backup 按设计不走 owner.release（用户目录不跨根删，登记）。

**云端（D02.2/D02.1）：一处最小生产修复 + 语义钉死**。查证现状查询已天然满足政策出口：`generation_reference_uploads` 的保护由行级引用（links/design_scheme_generation_references 存在即永久）与 registry TTL（uploading/available 且未到期为 leased）叠加，纯年龄不构成出口；引用行按既有保留政策（B77 R01 软删终态 30 天 `purgeGenerationRetentionBatch`）消失后，保护经同一组查询自动退出（registry 行 expires_at 已过 → `queueExpiredReferences` 入队 → retirement 授权 → ack 同事务删 queue+registry 行）；方案 attach 同事务删 registry 行（消费即退出）。**未改生产删除路径**。生产改动仅 `apps/api generation/service.ts`：`uploadReferenceImage` 补偿落库后把 P0001 映射 409 VALIDATION_FAILED+`details.reason='REFERENCE_UPLOAD_RETIRED'`——收口 §5.102 登记的「confirm 遇 P0001 表现为 500」开放项；`late-put-retirement` 两条用例从记录 500 改钉 409（未删用例）。**文档**：V25-DATA-LIFECYCLE.md 新增 §13.3（政策出口语义）、§14.5（云端资产目录与保护矩阵，11 类：创建者/引用者/保留期/租约/可重建性/实际删除者），由 worker `asset-protection-matrix.integration.test.ts` 10 类参数化矩阵强制，非纯文档。

**新测试**：core slowcopy 3；desktop upload-release +1（7P）；worker `consumed-upload-ledger-exit.integration.test.ts`（2：未消费 TTL 保护/已消费引用保护/引用行政策退休后可退休删对象三态）+ `asset-protection-matrix.integration.test.ts`（10 类参数化）；api late-put-retirement 4（含 409 改钉）；Electron SIGSTOP 双 spec；CLI serve 暂停 1 例。

| 检查 | 实际结果 | 备注 |
|---|---|---|
| 定向：core slowcopy / desktop release | 3P / 7P，0F | 主代理独立复跑合并 10P/4.79s |
| 定向：worker 新2文件 / api late-put | 12P / 4P，0F | 主代理独立复跑；真实PG+MinIO |
| 统一check | **38/38**，exit0 | 5轮收口，首败链见下 |
| 完整Worker 单测/含DB | 88P/224门控S；**310P/2S** | 2S为容器镜像门控既有 |
| 完整API 单测/串行集成 | 361P/7门控S；**89文件1086P/1S** | 1S为自然期限小时测试既有 |
| 源码扫描 | 1617文件范围，0命中/0错误 | ruleset v25-content-1 |
| 冻结源码清单 | 1799项 `70f24a57bfed4ce3b35bc7e4d07bc745ebfb669689f916c27892a8e550f6777d` | 相对§5.102新增4文件 |
| 新Electron双spec（SIGSTOP） | 首轮1F→次轮1F→**2P/0F/0flaky**（141.8秒） | 两处期望侧错误，见首败⑤⑥ |
| 完整Electron（70f24a57…） | 201项：**199P/2S/0F/0flaky**，exit0，1701.01秒 | 2S为既有外部凭据用例；+2为本批SIGSTOP双spec |
| Electron归档扫描 | 首报1命中→exception处置复扫**0命中/0错误** | 命中为随机容量填充假阳性（见首败⑦），21实际ZIP+17故意无效输入 |
| 新macOS包（70f24a57…，2.5.0 arm64） | adhoc构建exit0（48.1秒），app/dmg/zip 17:14新鲜产物 | 与§5.102同口径 |
| 包产物扫描 | 2产物/6目标，0命中/0错误 | DMG挂载校验asar/cli/mcp哈希一致 |
| 7项包smoke | **7P/0F/0S/0flaky**，exit0，26.3秒 | 同§5.102七项 |
| 包smoke归档扫描 | 1实际ZIP，0命中/0错误 | ruleset v25-content-1 |
| 收尾冻结校验 | 1799项 `70f24a57…`，drift=0 | 包构建/冒烟后源码未变 |

**首败与根因（全部保留）**：①统一check首轮 core typecheck——slowcopy 测试 `fs.write` 重载直转函数类型不重叠（回调形态返回 void）+内层回调隐式 any；经 `unknown` 中转的 `forwardWrite` +显式标注修复（断言与拦截语义不变）。②次轮根 typecheck——automation-upload-release 同模式同修。③//#test 1F `managed-cloud-runtime`「projects known costs for a remote failed result」：全量并行负载下 `vi.waitFor` 默认 1 秒窗口不足（终态 running→failed 投影超窗），单文件复跑 4/4 绿；按同文件其余等待惯例显式 `timeout: 4000`，断言不变。④//#lint 19 findings 全在根级 `.results/` 历史批次脚本（09-08～09-14 探针/证据）：biome `vcs.useIgnoreFile=true` 但根 `.results/` 缺 .gitignore 条目（`tests/v25/.results/` 有；本批编辑 apps/** 使 lint 缓存首次失效后暴露）；补 `.gitignore` 条目对齐既有设计，不改写 19 份留存证据工件。⑤新 SIGSTOP spec 首轮 1F：期望写死 `last_error='writing'`——实现（local-asset-cleanup.ts:212–219）写租约活跃时记 `writing`、写完成 owner 持有时记 `referenced`，两分支都是受保护 deferral；SIGCONT 后 IO 回调先于恢复的维护 tick，drain 看到已完成持有文件记 `referenced`；spec 首次真实执行（glm 未跑过 Electron 层），修正为接受两种受保护标记。⑥次轮 1F：恢复后立即重读 seeded 无主行——恢复的 drain 可在 HTTP 响应返回前合法回收它（正是下方轮询断言的行为），该重读是与「冻结期不变（已证）」和「恢复后回收（已断言）」之间竞态的冗余断言，删除；冻结期不变性、上传字节存活、队列 deferral、requests=0 断言全保留。⑦Electron归档扫描首报1命中 `user-path`：匹配串为 capacity 测试 64MiB 随机 base62 填充中偶然拼出的大小写不敏感 `/hOme/A1Lkbq0K0Od`（正则 `/giu`），非真实用户路径；主代理独立用同正则从实际 ZIP 提取、matchHash `ec2349f9…` 与扫描器一致，属有界检测器对随机内容的假阳性；按扫描器自带 exceptions 机制（target+entryHash+rule+matchHash+理由逐项精确匹配、未用尽即报错）登记处置并复扫 0 命中，首报原件与处置版并存。

**登记的开放项**：glm——design-scheme-imports 崩溃孤儿无启动 GC（补齐=新增删除授权，需单独排卡设计谓词）；分享导出崩溃遗留 .partial/.backup 点文件（用户目录不跨根删，只能文档化或导出前清扫自己已知名）；编译后 CLI 无进程内钩子面（mid-copy 窗口由 Electron 层 spec 覆盖，CLI 以跨维护周期冻结代偿）。kimi——方案硬删未实现（软删资产持续保护属政策，出口=账号级联+inventory 重发现）；导出/导入租约为时间型出口无独立退休函数（现状设计，§14.5 已写明）；`object_key_retirements` 哈希表自身压缩另立卡。Windows 原生暂停对应（spec 显式 skip win32）随发布阶段。

[slowcopy/pause证据](../../tests/v25/.results/d02/slowcopy-pause-summary.json)、[账本出口证据](../../tests/v25/.results/d02/ledger-exit-consumed-upload-summary.json)、[保护矩阵证据](../../tests/v25/.results/d02/ledger-exit-protection-matrix-summary.json)、[409映射证据](../../tests/v25/.results/d02/ledger-exit-p0001-409-summary.json)、[源码扫描](../../tests/v25/.results/d02/slowcopy-ledger-source-scan.json)、[完整Worker含DB](../../tests/v25/.results/d02/slowcopy-ledger-full-worker-integ-summary.json)、[完整API串行](../../tests/v25/.results/d02/slowcopy-ledger-full-api-integ-serial-summary.json)、[SIGSTOP双spec终态](../../tests/v25/.results/d02/slowcopy-pause-electron-targeted-v3-result.json)、[完整Electron终态](../../tests/v25/.results/d02/slowcopy-ledger-full-electron-result.json)、[归档扫描首报](../../tests/v25/.results/d02/slowcopy-ledger-full-electron-archive-scan.json)、[归档扫描处置版](../../tests/v25/.results/d02/slowcopy-ledger-full-electron-archive-scan-accepted.json)、[包扫描](../../tests/v25/.results/d02/slowcopy-ledger-package-scan.json)、[包smoke终态](../../tests/v25/.results/d02/slowcopy-ledger-package-smoke-result.json)、[包smoke归档扫描](../../tests/v25/.results/d02/slowcopy-ledger-package-smoke-archive-scan.json)、[冻结清单](../../tests/v25/.results/d02/source-files.json)。

### 5.104 imports 崩溃孤儿启动 GC、方案硬删 GC 出口与 D02.7 计数/暂停接缝（2026-09-14）

本批为 **G-DATA-02 第4阶段联合收口的最后一组开发项**：①glm（桌面域）实现 design-scheme-imports 崩溃孤儿启动 GC（§5.103 开放项①）；②kimi（云端域）钉死方案硬删 GC 出口语义（零生产改动）并落地 D02.7 最小实现（安全计数聚合 + 只读观察任务 + 暂停接缝钉死）。86/93 与管理员顺序不变。

**imports 崩溃孤儿启动 GC（glm，新增删除授权按纪律设计）**。摸底证实 `design-scheme-imports/` 唯一写者为 `share.ts` 导入路径（mkdir→写文件→DB 提交；错误路径 rmSync 回滚有测试），mkdir 与 DB 提交之间被 SIGKILL/断电打断的目录此前无任何清扫者；owner lock（桌面单实例+serve 互斥）保证新 owner PID 启动时刻不存在他进程在途导入。**孤儿谓词刻意不用年龄**：受管 imports 根下名为 `dsch_[0-9a-f]{32}` 的真实目录，当且仅当①无持久属主（design-scheme 库 assets/source_files 无任何 store_key 相对/绝对形态指向该目录，`..` 段拒绝）且②无会话属主（`retainDesignSchemeImportSession` 进程内注册表未持有；`importDesignScheme` 现改为 schemeId 先生成、hold 先于 mkdir、finally 统一释放）时可回收。删除授权纪律：先即时事务写 `design_scheme_import_gc` 意图行（schema v9/迁移 `0009_import_gc_intents`，无 FK 防方案级联误删意图，与 local_asset_cleanup 同纪律）再动磁盘；删除只经 managed-fs dev:ino 锚定句柄（openChild 拒 symlink，全树校验 entries≤2048/dirs≤128/depth≤12，'other' 即 TREE_UNSAFE 转 blocked）；每轮有界（扫描 24/删除 8）、失败退避 60s·2ⁿ 封顶 24h、5 次后 blocked 人工处置、崩溃中断下次启动经到期意图行续跑；绝不触碰受管根之外路径。宿主接入：桌面 `application.ts` 新 owner PID 启动（reclaimLocalAssets 之后、窗口创建前）与 `packages/cli serve-runtime.ts` 持锁启动各一次 `trySweep…`（永不抛）。不复用 local_asset_cleanup 的理由成文：其 `inspect()` 刻意只收规范根、写租约按 Database 实例隔离、无目录树删除语义。

**方案硬删 GC 出口（kimi，零生产改动以测试钉死）**。出口已存在且完整：软删方案的资产/来源行持续保护（政策不变）；方案行硬删（账号级联 `DELETE FROM "user"` 或未来显式硬删的行级联形态）移除引用行后，孤儿对象经既有 inventory 重发现记候选（仅观察、字节可读）、宽限后由既有候选执行器 HEAD/精确 List 身份复核 + `retireObjectsInTransaction` 退休授权 + 真实 DeleteObjects + ack；存活的用户级来源快照继续保护固定副本，解绑后经既有 `retireDesignSchemeSourcePreparations`→共享 outbox 退出；退休后迟到发布被 0026 trigger P0001 拒绝；重复硬删/重复执行幂等。未新增「全部清空」出口（D02.7 红线）。

**D02.7 最小实现（kimi，三处增量生产面）**：`packages/db object-maintenance-stats.ts` `collectObjectMaintenanceSnapshot`——纯 SELECT 聚合五类计数（candidates=outbox 存活 intent+inventory 存活观察、protected=租约/保护延后+宽限观察、deleted=退休哈希事实、failed、abandoned）+每仓诊断面；对象标识在 SQL 内 `sha256`（与退休哈希同约定，真实 key/bucket/签名 URL 不出库，failed/abandoned 各上限 100、计数始终精确）。worker `maintenance.safety-snapshot` 只读任务（+斜杠别名）：**不被 `MAINTENANCE_CLEANUP_PAUSED` 门控**（暂停期正是观察窗口）、不登记 crontab（按需 add_job）、日志只输出计数。暂停接缝钉死：既有进程级暂停标志在执行器领取前检查，暂停只停新领取不中断已发删除；新 seam 测试断言 paused 时零领取（attempt_count 保持 0、无退休、字节存活）、恢复后同 intent 正常删除。文档 §14.5 增两行（方案硬删出口链、计数/暂停接缝）。

**新测试**：core `design-scheme-import-gc.test.ts` 12 例（谓词全矩阵：提交存活/绝对 key/会话保护/意图先行证明/形状跳过/树内 symlink/有界批/退避 blocked/崩溃续跑/无 fs/越界不碰）；migrations v8→v9 1 例（既有 v7→v8 用例 slice 保留）；desktop share 30P（新增导入中途落盘回调真实清扫断言 `{held:1,reclaimed:0}`）；worker `scheme-hard-delete-exit.integration.test.ts` 2 例 + `maintenance-safety-seam.integration.test.ts` 1 例（真实 PG17+MinIO）；db `object-maintenance-stats.integration.test.ts` 3 例（计数镜像/仅 SHA-256 无真实 key/同时钟幂等无副作用）；Electron `electron.imports-orphan-gc.spec.ts`（SIGSTOP 验证未提交→SIGKILL→新 PID 启动清扫回收；已提交导入树哈希不变、gc 表清空、用户原件 sha256 不变）。

| 检查 | 实际结果 | 备注 |
|---|---|---|
| 定向：glm 三套件（根 vitest） | **49P/0F**（12+7+30） | 主代理独立复跑；cwd 约定见首败③ |
| 定向：kimi worker 四文件 / db stats | **11P/0F** / **3P/0F** | 真实PG17+MinIO / 一次性 postgres:17 容器 |
| 新Electron spec 首跑 | **1P/0F**（5.7秒） | 主代理首跑（glm 未跑过 Electron 层） |
| 统一check | **38/38**，exit0 | 首败链见下 |
| 源码扫描 | 1713文件范围，0命中/0错误 | ruleset v25-content-1 |
| 冻结源码清单 | 1806项 `45abbe73e795536a3d630ffab04f8c6828d80b74c467d2acc90623a5a6cd2936` | §5.103 后 +7 = 两域新文件精确数 |
| 完整Worker 单测/含DB | **313P/2S/0F** | §5.103 基线 310P+本批 3P |
| 完整API 串行集成 | 89文件**1086P/1S/0F** | 与基线持平；本批无 API 面改动 |
| 完整Electron（DB门控） | 首轮 201P/2S/**1间歇F** → 隔离3/3绿 → 复跑**202P/2S/0F/0flaky** exit0（29.7分） | 基线 199P+新 spec 1P；2S 为既有外部凭据 |
| 新macOS包（45abbe73…，2.5.0 arm64） | adhoc构建exit0，`Musefold-2.5.0-arm64.dmg` | 版本号未动（红线） |
| 包产物扫描 | 2产物/6目标，0命中/0错误 | DMG挂载校验哈希一致 |
| 7项包smoke | **7P/0F/0S/0flaky**，exit0 | 含打包 App 随包原生句柄导入+暂存清理用例 |
| 包smoke归档扫描 | 1实际ZIP，0命中/0错误 | ruleset v25-content-1 |
| 收尾冻结校验 | 1806项 `45abbe73…`，drift=0 | 包构建/冒烟后源码未变 |

**首败与根因（全部保留）**：①统一check首轮 `//#lint` 5 个 error 全为 format 违规：4 个本批新文件（glm 的定向 biome 声明与其最终落盘状态不一致）+ `electron.staging-pause-resume.spec.ts`（mtime 停在 16:39，即 §5.103 SIGSTOP spec 终稿时刻——复盘确认 §5.103 的 38/38 check 跑在该 spec 最终修订**之前**、其后只做冻结漂移校验未重跑 lint，违规因此跨批存留；本批门禁顺序已纠正为内容定稿后全新 check）。一律 `biome check --write` 纯格式修复，断言零变化；修复后 lint 0 error（211 警告+176 提示为存量、不阻断）。②次轮 `//#test` 1F：该轮输出仅 tail 留存、具体用例名未捕获（过程瑕疵如实登记）；单独全量根 vitest **2956P/51S/0F** 全绿、第三轮完整 check 38/38 exit0——单次间歇，特征与 §5.103 案例③（全并行负载 waitFor 超窗）同型但无法归因到具体断言。③glm 定向复跑首次 1 文件加载失败：`design-scheme-import-gc.test.ts` 以 `resolve('packages/managed-fs/…')` 解析原生二进制、依赖 cwd=仓库根（仓库既有 7 个测试文件同款约定），从 packages/core 目录运行解析为 `packages/core/packages/…`；改由根目录运行后 49P/0F，非 glm 缺陷。④完整 Electron 首轮忘带 `RUN_DATABASE_TESTS=true`：130P/74S，72 个 DB 门控用例被跳过、证据链不完整，该轮作废由 DB 门控轮取代（日志留存 `…-nodb.log`）。⑤DB 门控首轮 1F `electron.taxonomy-deletion-conflict.spec.ts`（retained-log 期望 `[]` 实收 12 条 folder/tag）：隔离复跑 3/3 绿（每次 2P）、全量复跑 202P/2S/0F/0flaky——负载敏感间歇；该 spec 家族 B74 时代即有间歇记录；本批改动（启动清扫+设计库 v9 迁移+worker 只读任务）与其无数据面交集，未改断言。⑥glm 报告「root node_modules 缺 `@musefold/contracts` 链接、既有 spec 可能加载失败、建议改根 package.json」：实证为**误报**——`playwright --list` 成功加载值导入该包的既有 spec 与新 spec（node 直解不代表 Playwright 解析路径）；未动根 package.json/lockfile。

**登记的开放项**：imports 清扫只在宿主启动时刻跑一次（失败下个启动重试；blocked 行≥5 次需人工清理；无运行期 timer，与 local_asset_cleanup 同节奏）；`maintenance.safety-snapshot` 未登记 crontab（周期观察由运维 add_job 或后续排卡）；显式方案硬删的产品入口（方案 purge API）属未来排卡（本批钉死其行级联形态 GC 出口链）；导出/导入时间型租约出口、`object_key_retirements` 表自身压缩、分享导出 `.partial`/`.backup` 点文件清扫保持 §5.103 登记；Windows 原生路径/暂停对应随发布阶段。

[imports-orphan 定向证据](../../tests/v25/.results/d02/imports-orphan-core-gc-result.json)、[migrations](../../tests/v25/.results/d02/imports-orphan-migrations-result.json)、[share](../../tests/v25/.results/d02/imports-orphan-share-result.json)、[spec离线验证](../../tests/v25/.results/d02/imports-orphan-e2e-spec-verification.json)、[scheme-hardexit证据](../../tests/v25/.results/d02/scheme-hardexit-d027-scheme-hard-delete-exit-summary.json)、[safety-seam证据](../../tests/v25/.results/d02/scheme-hardexit-d027-safety-seam-summary.json)、[主代理复验](../../tests/v25/.results/d02/scheme-hardexit-d027-reverify-summary.json)、[源码扫描](../../tests/v25/.results/d02/imports-orphan-source-scan.json)、[完整Worker](../../tests/v25/.results/d02/imports-orphan-full-worker-summary.json)、[完整API串行](../../tests/v25/.results/d02/imports-orphan-full-api-integ-serial-summary.json)、[完整Electron摘要](../../tests/v25/.results/d02/imports-orphan-full-electron-summary.json)、[完整Electron首报1F](../../tests/v25/.results/d02/imports-orphan-full-electron-first-run.log)、[完整Electron终态](../../tests/v25/.results/d02/imports-orphan-full-electron-result.json)、[taxonomy隔离复跑](../../tests/v25/.results/d02/imports-orphan-taxonomy-isolated-rerun.log)、[check复跑日志](../../tests/v25/.results/d02/imports-orphan-check-run2.log)、[包构建](../../tests/v25/.results/d02/imports-orphan-package-build-summary.json)、[包扫描](../../tests/v25/.results/d02/imports-orphan-package-scan.json)、[包smoke](../../tests/v25/.results/d02/imports-orphan-package-smoke-result.json)、[包smoke归档扫描](../../tests/v25/.results/d02/imports-orphan-package-smoke-archive-scan.json)、[冻结清单](../../tests/v25/.results/d02/source-files.json)。

### 5.105 第5阶段首批：C3-A 入口矩阵、C3-B 结算竞争三层、C3-C 升级边界与 C5 台账（2026-09-14）

本批开启 **G-SPEND-02 / R4-C3+C5 第5阶段**（路线图 §6.21/§6.22.1）：glm 负责 C3-B 可达结算/身份竞争（三层递进测试）与 C3-C 历史升级边界（域：core/desktop/cli/tests spec，证据前缀 `c3b-settle-`）；kimi 负责 C3-A 入口/版本适用性矩阵与 C5 原 R4-1..4 证据台账（域：docs/v2.5 + 机器可读证据，源码只读，证据前缀 `c3a-c5-map-`）。**本批零生产逻辑改动**（对 §5.104 冻结 45abbe73…/1806 的机器核验漂移=8 个新测试文件；后续 3 个既有测试侧文件的修改均为门禁修复：2 个时序测试加显式 30s 超时、1 个共享 fixture 补 additive key 日志）。

**C3-A（kimi，只读）**：15 行矩阵——可达 8 行（桌面 Automation G/R/S、v25 工作台 G+retry、v25 本地方案、CLI/MCP→桌面 HTTP、独立 serve、冻结豆包），每行带当前工作树 file:line 调用链与付款/凭据来源；应拒绝入口的 0 付费发送有 B30/B31/B33 实测证据；仅历史 2 行（v2.1 桌面进程/headless serve，git tag `v2.5-baseline` 行级引用，标注「未实际运行」不外推）；持久旧行 5 行（托管行/未结 spend/unknown 模型/云 lineage/旧 store）。托管行唯一合法来源钉死为 baseline `managed-provisioner.ts`，当前四个写入方均无法伪造「托管豆包」形状。C5 台账：R4-1 证据分散齐备但缺跨面汇总用例（随 R4-4）；R4-2 本机矩阵已过但缺最终源码回归复跑；R4-3 本批交付 C3-A、C3-B/C 仍开放；R4-4 未启动——**B30/B26/R4/P4 全部保持未勾选**。

**C3-B（glm，三层）**：层① 规则（纯 SQLite，`c3b-settle-rules.test.ts` 5 例）——旧 epoch 迟到回调（`SPEND_RECONCILIATION_REQUIRED`/`SPEND_CLAIM_MISMATCH`）、换号（`MANAGED_IDENTITY_CHANGED`/`MANAGED_QUERY_ONLY`/`MANAGED_RECEIPT_MISMATCH`）、旧 lineage（`MANAGED_RECONCILIATION_REQUIRED`，锚点 pending 保持 null）、失败重试（新键 authorized、旧键 replayed 不双占）、未落稳期间二次 enable 拒绝+新预留 pending_confirmation。层② 真实边界（fork+回环 HTTP+真实 SQLite，`c3b-settle-interleave.test.ts` 3 例）——暂停点在 applyReceipt 前（回执 GET 已真实发出）；窗口内新预留/并发重复回调只入账一次、known 费用才释放；SIGKILL 后新 PID 换号回执被拒且无副作用 HTTP、原键恢复 POST 计数不增；重启不能解除持久未结（二次 enable/直接 finish/新预留三路拒绝）。层③ 正式主进程（`electron.c3b-settle-main.spec.ts` 2 例，首跑由主代理执行）——真实 Electron/OS cipher/SQLite/Hono/PG/队列/worker 与正式 IPC：hold 模式窗口内换号后旧回执不落新主体、重登后单次落账、幂等重复核对、未知费用不清账不写 0；kill 模式 SIGKILL 后新 PID 原键恢复不重发（POST/Provider 各保持 1）、持久未结不被重启清掉。

**C3-C（glm，实测与静态分列）**：行① 单写者——实测 serve 双开拒 `OWNER_LOCK_HELD`（锁先于 DB/发现文件）+ 源码级断言桌面壳与 serve 的启动（锁<initDb）与停机（双库 close<锁释放最后）顺序；旧签名包无法真跑（owner.lock 自仓库基线即存在）、Windows 未运行，均标注不外推。行② 内容更新不碰持久库——实测字节级：两个真实 SQLite 库+既有文件全量 SHA256 不变，新增文件仅在 `content-bundles/`。行③ 在途退出 vs 新 PID——实测 SIGKILL 后新 PID 接管陈旧锁，run 标记 `failed/INTERRUPTED`、`actual_cost=null`、Provider 发送数保持 1、零持久费用行。行④ 锁+发现文件双失且旧进程仍活——实测当前实现仍会接管（双写者风险）；**分类为「非合法迁移路径」**（外部破坏输入），机器强制需 owner 锁携带启动纪元、另立卡。

**新测试**：core rules 5 + interleave 3（+fixture 进程）、cli serve-upgrade-boundary 3（+fixture）、desktop startup-order 3（静态源码断言）、desktop update/content-db-boundary 1、Electron spec 2。合计定向 15 例 + Electron 2 例。

| 检查 | 实际结果 | 备注 |
|---|---|---|
| 定向复跑（5 vitest 文件，主代理） | **15P/0F**，exit0，4.73s | 与 glm 交付一致 |
| 冻结漂移核验（vs 45abbe73…/1806） | 漂移=8 新测试文件 | 机器证实零生产逻辑改动 |
| 统一 check | **38/38**，exit0（final2） | 6 轮收口，首败链①-⑥见下 |
| 源码扫描 | 1721 文件（+8），0命中/0错误 | ruleset v25-content-1 |
| 完整 Worker（含 DB） | **313P/0F/2S** | =§5.104 基线，本批无 worker 改动 |
| 完整 API 串行（含 DB） | **89文件 1086P/1S**，687.25s | =基线；另集成子集预跑 53文件 726P/1S 亦绿 |
| 全量 build | exit0 | |
| 新 Electron spec 首跑 | 裁决后 **2P/0F/0flaky**，22.8s | 首败⑤⑥均为期望侧，见下 |
| 完整 Electron（RUN_DATABASE_TESTS=true） | 204 项：**204P/2S/0F/0flaky**，exit0，1742.65s | =§5.104 的 202+本批 2；**首跑即绿无间歇** |
| 新 macOS 包（2.5.0 arm64） | adhoc 构建 exit0，产物 00:11 新鲜 | 版本号未动 |
| 包产物扫描 | 2产物/6目标，0命中/0错误 | DMG 挂载校验哈希一致 |
| 7 项包 smoke | **7P/0F/0S/0flaky**，27.5s | 同 §5.103/104 七项 |
| 包 smoke 归档扫描 | 1 实际 ZIP，0命中/0错误 | |
| 收尾冻结校验 | 1814 项 `6b7f2206…`，drift=0 | 包构建/冒烟后源码未变 |

**首败与根因（全部保留）**：①统一 check 首轮 `//#lint` 下 managed-fs 原生 make 收到 `Interrupt: 2`（SIGINT）、20s 中止——孤立重跑 `pnpm --filter @musefold/managed-fs run build` 干净 exit0，判定 turbo 并行下瞬态，非代码问题。②次轮 biome **10 个 error** 全在本批 8 个新文件（8 format + noUnusedImports/Variables/EmptyPattern 等）：glm 的定向 biome 与最终落盘状态不一致（老毛病，同 §5.104①）；`biome check --write` 安全修复 + 2 处 `noEmptyPattern` 手工处置。③首轮修复后 core typecheck 3 个 TS 错误：`db.close()` 返回值塞进 `() => void` cleanup（块包裹）、`receipt.binding` 可空展开（前置收窄守卫，fixture 必带 binding、运行时安全）。④run4 根 vitest **5F** 全为默认 5000ms 超时：turbo 并行下根 vitest 与其它包测试抢 CPU（glm 2 个新真进程用例 + §5.103 既有 slowcopy/控制面 3 例同时超窗）；孤立复跑 13P/0F 证明负载诱发；按 §5.103③ 惯例为恰好这 5 例加显式 30000ms 超时（断言零改动），run5 起 38/38。⑤新 Electron spec 首跑 0 例执行——主代理把 `({}, testInfo)` 改成 `(_fixtures, testInfo)` 规避 biome `noEmptyPattern`，但 Playwright 要求首参必须对象解构；回滚为仓库标准形态 `({}, testInfo)` + `// biome-ignore lint/correctness/noEmptyPattern` 注释（同 backup-restore/cloud-crash 等 6 处既有惯例）。⑥真实首跑 2F 均期望侧：其一，窗口期 `automation_spend_calls` 行处于在飞占用态 `state='started'`（claimSubmission→prepareCall+claimCall 的持久状态），glm 期望写成结算后的 `'unknown'`（playwright diff 的「+6」是 diff 行数不是行数组的 6 行，首读勿误判）；其二，正式壳 `generation.get` 会 `scheduleManagedReconciliation`，UI 自动对账的只读 GET 可与显式恢复并发被服务端计数（其 applyReceipt 被断言拒绝、run 保持 running 证实无副作用），改为「GET≥1 且全部命中原 remoteKey」+ POST/Provider 严格=1；为此给共享 fixture `desktop-cloud-service-process.ts` 补 additive key 日志（GET 查询参数回退，POST 头语义不变）并放宽其类型 `key?: string | null`——该改动使 final check 首轮 api typecheck 1 error（⑦），对齐后 final2 38/38。

**登记的开放项**：C3-B 层③ 未断言「窗口内经正式 IPC 的新预留表象」（恢复态二次提交的 UI 拒绝码，层①②已按 ledger 语义覆盖规则）；known-cost 释放面由层②受控 HTTP fixture 覆盖（合成 joint 服务回执恒 unknown/null）；C3-C 行④ owner 锁启动纪元机器强制另立卡；旧签名安装包旧→新真机升级矩阵、原生 Windows 未运行（发布卡）；C5 R4-1 跨面汇总用例与 R4-2 最终源码回归复跑随 R4-4 同源码验收；**B30/B26/R4/P4 保持未勾选**。下一步：路线图 §6.21 SP-P5/6（可信参考图/最终输入固定、R/S 独立身份、费用矩阵）。

[C3-A矩阵](../../tests/v25/.results/c3/c3a-c5-map-entry-matrix.json)、[C5台账](../../tests/v25/.results/c3/c3a-c5-map-r4-ledger.json)、[链接校验](../../tests/v25/.results/c3/c3a-c5-map-summary.json)、[层①证据](../../tests/v25/.results/c3/c3b-settle-rules-result.json)、[层②证据](../../tests/v25/.results/c3/c3b-settle-realhttp-result.json)、[C3-C证据](../../tests/v25/.results/c3/c3b-settle-upgrade-boundary-result.json)、[源码扫描](../../tests/v25/.results/c3/c3b-source-scan.json)、[完整Worker](../../tests/v25/.results/c3/c3b-full-worker-result.json)、[完整API串行](../../tests/v25/.results/c3/c3b-full-api-serial-summary.json)、[完整Electron](../../tests/v25/.results/c3/c3b-full-electron-result.json)、[check终态日志](../../tests/v25/.results/c3/c3b-unified-check-final2.log)、[包扫描](../../tests/v25/.results/c3/c3b-package-scan.json)、[包smoke](../../tests/v25/.results/c3/c3b-package-smoke-result.json)、[包smoke归档扫描](../../tests/v25/.results/c3/c3b-package-smoke-archive-scan.json)、[冻结清单](../../tests/v25/.results/d02/source-files.json)。

### 5.106 第5阶段第二批：SP-P5 出口三层测试与费用矩阵/接入边界台账（2026-09-15）

本批为路线图 §6.21/§6.22.2 的 **SP-P5**（G-SPEND-02 子目标，B35 后第5阶段第二批）：glm 负责五条出口的审计与三层递进测试（域：core/desktop/tests spec，证据前缀 `sp-p5-`）；kimi 负责费用矩阵（5 维度×5 面=25 格）与 CLI/MCP 云接入边界台账及 roadmap §6.22.2 回写（域：docs/v2.5 + 机器可读证据，源码只读，证据前缀 `sp-p5-matrix-`）。**本批零生产逻辑改动**（对 §5.105 冻结 6b7f2206…/1814 的机器核验漂移=3 个新测试文件，共 1298 行测试）。

**glm 审计结论（五出口）**：①参考图/R/S 图按原 jobId 映射、最终输入冻结——本地 BYOK 面（G gate + R/S durable wrapper）已实现且已测；云端两半（云 G 参考图、云 R/S 每原图远端执行）未实现，当前为**有界拒绝（0 付费发送）**。②文本/图像身份独立——已实现，本卡补 service 层「托管文本不能搭图像授权」直接用例。③部分成功不续发——已实现，补「R/S 部分失败+同键重放」与「中途中断恢复+重放」组合直接用例。④只重取资产——已实现（云 G finishLocal + 本地 SQLite 重放），补部分成功重放 0 新 HTTP 用例。⑤不新增托管文本 API——成立（负向约束：无托管文本执行路径、serve 无 R/S、Cloud MCP 只读）。

**三层测试**：层① 规则（纯 SQLite，`sp-p5-spend-rules.test.ts` 5 例）——计划外 jobId 拒绝（账本行/执行器之前）、参考摘要冻结+每原 jobId 单次发送资格、musefold-cloud 类型行经 readDesktopSpendBinding→终态 PAYMENT_IDENTITY_UNBOUND+同键重放同终态（首次钉住该行形状，既有测试只覆盖 legacy managed_by='account'）、unbound 托管文本阻断整 run、中断恢复终态+SPEND_NOT_AUTHORIZED+同键重放零发送；core-instance mock 为抛错证明规则层不触网。层② 真实边界（回环 HTTP+SSE+真实文件字节+磁盘 SQLite 重开，`sp-p5-boundary.test.ts` 3 例）——n=2 第 2 张 503→部分成功 success/null/单资产+同键重放+重开 DB 再重放全 0 新发送；真实文本 SSE 调用后改写参考字节→图像 dispatch 在发送边界被拒（首次在 R/S 文本调用后钉住该边界，既有仅 G 面）；路由级 musefold-cloud 默认行 409+显式 BYOK providerId 旁路。层③ 正式主进程（`electron.sp-p5-runs.spec.ts` 1 例四阶段 A-D，只写不跑、主代理统一首跑）——真实 Electron 主进程+自含回环服务：G 参考图→/v1/images/edits 一次成功；R 方案 n=2 第 2 张 503 部分成功不续发+同键重放 200 不补发；S Skill 文本/图像账本 [image,text] 分列且 reported_points 全 NULL（真实应用 BYOK 无本地价格→cost_source='unknown'）；真实 connectCloud 后默认路径 409 PAYMENT_IDENTITY_UNBOUND+cloudCreates=[]+审计恰 1+同键重放同 409+显式 BYOK 新键成功。

**kimi 台账（25 格矩阵）**：9 归档 / 5 合成 / 3 源码级 / 3 不适用 / 5 in-flight（S5 列 R/S 云映射，归 glm 本批出口测试钉边界、实现归后续批次）。合成与真实严格分列：`provider_reported` 当前全仓无生产者（仅 worker 保留已有值），New API client 无逐调用账单查询，一切已发送云调用费用保持 unknown——真实正额/跨月回写归 P6（SP-PV12/SP-O10）。8 条 CLI/MCP 接入边界与 §10.4 裁决顺序核对 9/10 一致，登记 3 缺口：**GAP-B1**（CLI/MCP 客户端均不发送幂等键，同 Agent 意图无客户端侧去重，SP-P5/P6 合流裁决）、**GAP-B2**（headless serve 预算在 electron-store 与桌面 SQLite 事实源分立，§8.1 已声明非新矛盾）、**GAP-B3**（Cloud MCP token × 业务 generation 路由负例未定位专项用例，P6/SP-PV18）。29 条引用链接 SHA256/字节数逐条登记、0 缺失。**B30/B26/R4/P4 与 SP-P5 父项保持未勾选**。

| 检查 | 实际结果 | 备注 |
|---|---|---|
| 定向复跑（2 vitest 文件，主代理） | **8P/0F**（5+3），exit0，954ms | 与 glm 交付一致 |
| 冻结 capture | 1817 项 `cc5ece92…` | §5.105 的 1814+3 新测试文件 |
| 统一 check | **38/38**，exit0 | **首跑即过**，本批主代理门禁零运行期失败 |
| 源码扫描 | 1724 文件（+3），0命中/0错误 | ruleset v25-content-1 |
| 完整 Worker（含 DB） | **313P/0F/2S** | =§5.105 基线 |
| 完整 API 串行（含 DB） | **89文件 1086P/1S**，708.93s | =基线；**勘误（R4F-D1，kimi R4-4 台账发现并经主代理确认）**：首跑经 `run test --` 传参未生效（pnpm 未转发，且 vitest v4 无 `--serial` 选项），实为默认并行执行、JSON 未落盘；文末引用的 `sp-p5-full-api-serial-result.json` 为同冻结源码（复核 drift=0）下 `exec vitest run src --no-file-parallelism` 复跑归档（startTime 01:58+08，89 文件 1086P/1S 与首跑一致；收集时 R4-1 新测试尚未定稿故未含，含新测试的复跑归 R4-4 门禁），首跑控制台摘要存 `sp-p5-full-api-serial-firstrun-console.log` |
| 全量 build | exit0 | |
| 新 Electron spec 首跑 | **1P/0F/0flaky**，7.0s，exit0 | **一次通过**；glm 编写期静态拦截 3 处均未在运行期出现 |
| 完整 Electron（RUN_DATABASE_TESTS=true） | 207 项：**205P/2S/0F/0flaky**，exit0，28.6m | =§5.105 的 204+本批 1；**首跑即绿无间歇** |
| 新 macOS 包（2.5.0 arm64） | adhoc 构建 exit0，`Musefold-2.5.0-arm64.dmg` | 版本号未动（红线） |
| 包产物扫描 | 2产物/6目标，0命中/0错误 | DMG 挂载校验哈希一致 |
| 7 项包 smoke | **7P/0F/0S/0flaky**，27.7s | 同七项 |
| 包 smoke 归档扫描 | 1 实际 ZIP，0命中/0错误 | |
| 收尾冻结校验 | 1817 项 `cc5ece92…`，drift=0 | 包构建/冒烟后源码未变 |

**首败与根因（全部保留）**：本批主代理门禁**零运行期失败**（check 首跑 38/38、spec 首跑一次过、全 Electron 无间歇）。代理侧编写期首失败按纪律留档：①glm 层① `expect(()=>fn).toMatchObject` 对同步抛错不生效（vitest toMatchObject 不适用于函数主体）→ `expectCode` 辅助。②glm 层③ 编写期静态核对拦下 3 个必然首失败：`automation_audit` 无 `detail` 列（改 `automation_request_id` 计数，INSERT 为唯一事实源）；层② mock 的 `local_price_estimate` 在真实应用不成立（BYOK Provider 无本地价格→`cost_source='unknown'`、reported_points 全 NULL）；云默认选择 `WHERE is_active=1 LIMIT 1` 无 ORDER BY 不确定（显式 `aiProviders.setActive` 保证确定性）。③流程性修正 1 处：包 smoke 首次以 `-c playwright.package.config.ts` 于仓库根运行报「不存在」——实际位于 `tests/v25/playwright.package.config.ts`（outputDir `tests/v25/.results/package/artifacts`），修正路径后 7P/0F；零测试语义影响。

**登记的开放项**：云 G 参考图桌面接线（服务端/worker/Web 已通）与云 R/S 每原图 managed ledger 映射——两项均 B21 级产品工作，当前行为为 0 付费发送的有界拒绝；S5 列 5 格实现缺口同归后续批次；真实正额账单（provider_reported 生产者）、真实跨月回写归 P6；GAP-B1/B2/B3 排卡；C3-C 行④ owner 锁纪元另立卡；旧签名包真机升级矩阵、原生 Windows 随发布；**B30/B26/R4/P4 保持未勾选**。下一步：R4-4 同源码验收（补 R4-1 跨面汇总用例 + R4-2 最终源码回归），随后云/发布阶段（G-CLOUD/WORKER/DATA/RELEASE）直至 86/93。

[审计](../../tests/v25/.results/s5/sp-p5-audit.json)、[层①证据](../../tests/v25/.results/s5/sp-p5-rules-result.json)、[层②证据](../../tests/v25/.results/s5/sp-p5-boundary-result.json)、[层③预记录](../../tests/v25/.results/s5/sp-p5-electron-spec.json)、[层③首跑](../../tests/v25/.results/s5/sp-p5-electron-spec-run.json)、[定向复跑](../../tests/v25/.results/s5/sp-p5-targeted-rerun.json)、[费用矩阵](../../tests/v25/.results/s5/sp-p5-matrix-cost.json)、[接入边界](../../tests/v25/.results/s5/sp-p5-matrix-access-boundary.json)、[矩阵汇总](../../tests/v25/.results/s5/sp-p5-matrix-summary.json)、[统一check日志](../../tests/v25/.results/s5/sp-p5-unified-check-run1.log)、[源码扫描](../../tests/v25/.results/s5/sp-p5-source-scan.json)、[完整Worker](../../tests/v25/.results/s5/sp-p5-full-worker-result.json)、[完整API串行](../../tests/v25/.results/s5/sp-p5-full-api-serial-result.json)、[完整Electron](../../tests/v25/.results/s5/sp-p5-full-electron-result.json)、[包构建日志](../../tests/v25/.results/s5/sp-p5-package.log)、[包扫描](../../tests/v25/.results/s5/sp-p5-package-scan.json)、[包smoke日志](../../tests/v25/.results/s5/sp-p5-package-smoke.log)、[包smoke归档清单](../../tests/v25/.results/s5/sp-p5-package-smoke-archive-inventory.json)、[包smoke归档扫描](../../tests/v25/.results/s5/sp-p5-package-smoke-archive-scan.json)、[冻结清单](../../tests/v25/.results/d02/source-files.json)。

### 5.107 第5阶段第三批：R4-4 同源码验收（R4-1 三端合同汇总 + R4-2 专项复跑 + 台账回填）（2026-09-15）

本批为 C5 台账 R4-4 原条件的执行批（路线图 §6.22.3）：glm 负责三端合同汇总用例与 R4-2 复跑清单（域：core/api 测试 + tests/v25 只读审计，证据前缀 `r4-1-`/`r4-2-`）；kimi 负责最终台账骨架、六位置静态对照与 roadmap §6.22.3 回写（只读，证据前缀 `r4-final-`）。**零生产逻辑改动**（对 §5.106 冻结 cc5ece92…/1817 的机器核验漂移恰=1 修改+1 新增，均为 glm 测试侧：core ledger 测试 +92 行 1 用例、API 新集成文件 188 行 2 用例）。

**glm R4-1**：四断言（①原身份/金额不变 ②新请求单独授权+独立 idempotency key ③未知不可重试 ④桌面/Web 同一合同）×五面（core/Electron/Web/api-client/worker）审计——层A 补 explicit_retry 子回执失配矩阵用例（篡改拒绝+原回执不变）；层B 新增 `generation-retry-key-contract.integration.test.ts`（真实 PG17 容器+graphile 迁移：重试复用 create 键被拒保持 ordinary_create 回放、源/重试键各守 canonical 合同一侧）；层C 审计确认既有 cloud-retry/retry-faults/retry-recovery 四断言全覆盖，**按纪律不硬凑新 spec**。canonical 唯一事实源 `packages/contracts/src/generation-receipt.ts`。**kimi 台账**：20 个 PENDING_MAIN_GATE 槽位骨架、35 个 file:line 静态锚点（六位置同引一份 schema 族）、66 条引用 0 缺失 0 哈希不符、2 项矛盾登记（R4F-D1/R4F-D2）。

| 检查 | 实际结果 | 备注 |
|---|---|---|
| 定向复跑（主代理） | core **38/38** + API 集成 **2/2**，exit0 | 与 glm 交付一致；R4F-D2 日期笔误不影响内容 |
| R4-2 专项：Electron 10 spec | **59P/0F/0flaky**，9.1m，exit0 | retry-faults 7/retry-recovery 10/cloud-retry 2/cloud-crash 9/resume-faults 16/retry-model 1/redeem-recovery 1/workbench 11/legacy-generation 1/sp-p5-runs 1 |
| R4-2 专项：Web 双视口 3 spec | **60P/0F**，1.5m，exit0 | redeem-recovery 4/workbench 26/history 30 |
| 冻结重捕（R4-4 新基线） | **1818 项 `2fb474dd…`** | 规则②：对 cc5ece92…/1817 漂移恰=台账 knownDelta（1改+1增全为 R4-1 测试侧） |
| 统一 check | **38/38**，exit0 | **首跑即过** |
| 源码扫描 | 0命中/0错误 | ruleset v25-content-1 |
| 完整 Worker（含 DB） | **313P/0F/2S** | =基线 |
| 完整 API 串行（含 DB） | **90 文件 1088P/1S**，exit0（`--no-file-parallelism`） | 对基线 +1 文件/+2 用例=层B 新集成测试，已解释 |
| 全量 build | exit0 | |
| 新 Electron spec 首跑 | **不适用（登记）** | glm 审计层C 无缺口未新写 spec，r4-1-crossface-map layerCNote 声明 |
| **完整三形态 test:e2e** | **526P/7S/0F/0flaky**，54.5m，exit0 | T3 产品形态：web 双视口 321P/5S + electron 205P/2S；B32 时代 312 项以来 specs 增量全量现值 |
| 新 macOS 包（2.5.0 arm64） | adhoc 构建 exit0 | 版本号未动（红线） |
| 包产物扫描 / smoke / 归档扫描 | 2产物/6目标 0/0；**7P/0F** 28.4s；1 ZIP 0/0 | |
| 收尾冻结校验 | 1818 项 `2fb474dd…`，**drift=0** | 同源码成立：T0-T3 全序列无源码漂移 |
| 台账回填 | **PENDING_MAIN_GATE 剩余 0** | 逐 slot 实际结果+证据指针；r42RerunTemplate 五行执行数/skip 落盘 |

**首败与根因（全部保留）**：①**R4F-D1（kimi 发现，主代理确认并修复）**：§5.106 引用的 s5 API 串行 JSON 缺失——根因链：`pnpm --filter run test -- --serial` 的参数未被转发（实际默认并行执行）且 vitest v4 本无 `--serial` 选项（直接传参会 `CACError: Unknown option`）；补救复跑又与 glm 交付竞态（01:58 收集时 02:08 定稿的新测试未含），故先归档 89 文件 1086P/1S 同源码复跑+§5.106 勘误注，本批门禁再以 90 文件 1088P/1S 含新测试收口。②R4-2 归档收集首次中断：zsh 对空目录 `rm dir/*` 报 no matches 使 `&&` 链断裂、cp 未执行→脚本断言失败；去掉该步后 1 ZIP 0/0，零证据影响。③glm 层B 首跑 suite 失败：import 包名笔误 `@hono/zod-open-api`→`@hono/zod-openapi`。④R4F-D2：glm 两份 result 的 ranAt 日期笔误（-14 vs -15），登记于台账 discrepancies，不影响 exit/计数。⑤API 串行耗时 55 分钟（串行模式下 121s 自然租约慢用例不可重叠），非故障。

**同源码判定与出口**：R4-1（合同/独立授权，含本批三端汇总用例）、R4-2（产品/防重/恢复，含同源码专项 119P）、R4-3（§5.105 闭环）、R4-4（本批 T0-T3+逐项记录）四行证据在冻结源码 2fb474dd…/1818 上齐备且收尾 drift=0——**R4 验收在同源码口径下完成**。**B30/B26/R4/P4 父项仍不勾选**：原生 Windows 矩阵随发布卡、真实脱敏旧库归 G-DATA-03、真实账单/跨月归 P6、C3-C 行④ owner 锁纪元另立卡——按归属登记，不在本批关闭条件内。

**登记的开放项**：云 G 参考图桌面接线与云 R/S managed ledger 映射（B21 级，SP-P5 登记）；GAP-B1/B2/B3（SP-P5 台账）；provider_reported 生产者/真实跨月（P6）；行④ 纪元卡；旧签名包真机升级、原生 Windows（发布）；真实旧库（G-DATA-03）。下一步：云/发布阶段（G-CLOUD/WORKER/DATA/RELEASE，Windows 原生项随发布），直至 86/93；管理员端在全部 v2.5 验收后启动。

[R4-1审计](../../tests/v25/.results/r44/r4-1-audit.json)、[三端对照](../../tests/v25/.results/r44/r4-1-crossface-map.json)、[层A实跑](../../tests/v25/.results/r44/r4-1-core-result.json)、[层B实跑](../../tests/v25/.results/r44/r4-1-api-result.json)、[R4-2清单](../../tests/v25/.results/r44/r4-2-rerun-list.json)、[主代理定向](../../tests/v25/.results/r44/r4-targeted-rerun.json)、[专项Electron日志](../../tests/v25/.results/r44/r4-2-specials-electron.log)、[专项Web日志](../../tests/v25/.results/r44/r4-2-specials-web.log)、[最终台账](../../tests/v25/.results/r44/r4-final-ledger.json)、[静态对照](../../tests/v25/.results/r44/r4-final-crossface-static.json)、[链接校验](../../tests/v25/.results/r44/r4-final-link-checks.json)、[统一check](../../tests/v25/.results/r44/r4-unified-check-run1.log)、[源码扫描](../../tests/v25/.results/r44/r4-source-scan.json)、[完整Worker](../../tests/v25/.results/r44/r4-full-worker-result.json)、[完整API串行](../../tests/v25/.results/r44/r4-full-api-serial-result.json)、[三形态日志](../../tests/v25/.results/r44/r4-full-three-forms.log)、[包构建](../../tests/v25/.results/r44/r4-package.log)、[包扫描](../../tests/v25/.results/r44/r4-package-scan.json)、[包smoke](../../tests/v25/.results/r44/r4-package-smoke.log)、[归档扫描](../../tests/v25/.results/r44/r4-package-smoke-archive-scan.json)、[冻结清单](../../tests/v25/.results/d02/source-files.json)。

### 5.108 第5阶段第四批：云 G 参考图桌面接线（含 F5-X 误派发纠偏）（2026-09-15）

本批经历一次中途纠偏：原派发为 F5-X.1/4 语料/边界测试，kimi 台账中途核实 **F5-X.C/L/T 已于 2026-09-12 被 B62/B63/B64 验收关闭**（第一手册 §5.55–5.63；GOALS §5.2 卡面「截至B55」摘要过时即 F5X-D2，是误派发根因）。glm 已写的 29 例语料被完整撤回（存档 `f5x/archive-corpus-suspended.ts.txt`，scheme-package 复跑 42/42 全绿、fixtures 精确回退自身增量）。改派目标为 SP-P5 审计登记的 B21 级开放项：**云 G 参考图桌面接线**（服务端/worker 通路 B46+ 已实现，桌面侧原为 0 付费发送的有界拒绝）。

**glm 交付**：A 契约（`packages/desktop-contracts/src/managed-generation.ts` 新增 `managedReferenceImageSchema`——云 reference ID/url/name/mimeType/byteSize + 冻结 sha256 digest，`referenceImages` 由 `z.array(z.never()).max(0)` 放开为受形状约束数组 ≤16，旧记录 `[]` 原样解析，POST 体 digest 被服务端剥离）。B api-client 零改动（`uploadReferenceImage` multipart+zod 已存在，`gateway.ts:353`）。C 主进程（`managed-generation-client.ts`：upload/release，Bearer 仅主进程、≥60s 超时、401→invalidate；`managed-generation-runtime.ts`：`freezeReferenceImages` 在 **ledger.register 之前**逐张 readLocalImage（TOCTOU+isManagedUploadPath 双重把关）→上传刚读字节→校验服务端 byteSize/mimeType→冻结 `{…cloud, digest}`，失败对已受理 id 尽力释放——**0 付费发送由顺序保证**（失败路径无 spend 行、无 `/api/v1/generations` POST）；3 条新错误码用户文案含「此次没有产生生成费用」）。D 测试：runtime 单测 21/21（新 5）；**集成 16/16（新 1 端到端：真实 Hono/PG/S3/worker 下 multipart 上传→冻结摘要→单次云创建→worker `/v1/images/edits` 携带参考字节派发→本机 success**，共享 joint fixture 增量补 edits 通道、既有路由零改动）；system 108/108、workbench-domain 42/42 回归；`tests/v25/electron.cloud-g-reference.spec.ts` 只写不跑（自含回环，正向 A + 失败面 B，含 bearer 不落 DB 断言）。**sp-p5 钉点审查：既有断言 0 处修改**（两处「拒绝参考图」钉点实际构造 promptId 域仍成立；契约负例转形状负例仍有效），净增 12+2 段。**kimi 交付**：F5-X 三态台账（88 引用 0 缺失 0 哈希不符）+ 86/93 口径钉死（tasks.md 实测 86[x]/7[ ]=93；7 张未勾卡与「剩余第 4–10 阶段」是两个集合）+ F5X-D1（b61 顶层 status 停留 in-progress，按切片日期读验收件）/F5X-D2/C1（§5.48 命令为子串过滤器）三条登记。

| 检查 | 实际结果 | 备注 |
|---|---|---|
| 定向复跑（3 文件，主代理） | **86/86**（23+21+42），4.67s，exit0 | 与 glm 交付一致 |
| 集成复跑（真实 Hono/PG/S3/worker） | **16/16**，34.2s，exit0 | 含新端到端 edits 通道用例 |
| 冻结重捕（本批基线） | **1819 项 `00f4b6ca…`** | 对 §5.107 的 1818 恰 +1=新 spec；其余修改与 glm 申报清单一致 |
| 统一 check | run1 首败留档 → run2 **38/38**，exit0 | 唯一失败 `c3b-settle-interleave` SIGKILL 用例（负载下 5011ms 超时）；§5.105 交付真进程用例与本批无代码交集，隔离复跑 3/3（804ms）绿，判定并行负载时敏间歇 |
| 源码扫描 | 1726 文件，0命中/0错误 | ruleset v25-content-1 |
| 完整 Worker（含 DB） | **313P/0F/2S**，exit0 | =基线 |
| 完整 API 串行（含 DB） | **1088P/0F/1S**（1089 项），exit0 | =§5.107 基线（90 文件口径） |
| 全量 build | exit0 | |
| 新 Electron spec 首跑 | **2P/0F/0flaky**，7.8s，**一次通过** | 正向 3.3s + 失败面 3.1s；firstRun 已回填 glm 结果文件 |
| **完整三形态 test:e2e** | **528P/7S/0F/0flaky**，54.3m，exit0 | =§5.107 的 526+本批 2；web 双视口 + electron 全量，新 spec 在全量中再次双绿 |
| 新 macOS 包（2.5.0 arm64） | adhoc 构建 exit0 | 版本号未动（红线） |
| 包产物扫描 | 2产物/6目标，0命中/0错误 | DMG 挂载校验哈希一致 |
| 7 项包 smoke | **7P/0F**，28.4s | 同七项 |
| 包 smoke 归档扫描 | 1 实际 ZIP，0命中/0错误 | |
| 收尾冻结校验 | 1819 项 `00f4b6ca…`，**drift=0** | 包构建/冒烟后源码未变 |

**首败与根因（全部保留）**：①**流程性最大首败=本批误派发**：GOALS §5.2 卡面摘要未随 B62–B64 关闭更新（F5X-D2），导致按过时缺口派发语料/边界批次；kimi 中途台账核实后 glm 完整撤回（42/42 复跑绿），根因文本本批修正。②统一 check run1 唯一失败：`c3b-settle-interleave.test.ts`「结算暂停时 SIGKILL」用例在并行负载下 5011ms 超时——真进程时敏用例（隔离 804ms 绿），run2 38/38；run1 日志留档。③主代理 spec 首跑首次命令参数顺序错误（`--project electron` 后置文件名被解析为 project 名报 "not found"）——命令行错误非测试失败，文件名前置修正后一次通过。④归档收集首试 `cp` 未带 `-R`（artifacts 为目录）报错中断——补 `-R` 后 6 目录齐；另有 zsh `echo ===` 前缀展开中断一条辅助命令，零证据影响。

**出口与开放项**：云 G 参考图桌面接线完成（Electron 面真实壳+IPC 实测；Web 面零改动零影响）。**剩余 B21 项：云 R/S 每原图 managed ledger 映射**（下批首选）；automation 面（CLI/MCP/Automation API）云参考图仍按 sp-p5 规则有界拒绝（登记未动）；F5-X.H 原生文件交付/lifetime CI 远端/原生 Windows（发布卡）；真实旧库（G-DATA-03）；真实账单/跨月（P6）；GAP-B1/B3 裁决排卡。tasks.md 86[x]/7[ ] 结构本批不变。下一步：云 R/S 映射批次 → GAP 裁决 → 原E 剩余 → G-RELEASE；管理员端在全部 v2.5 验收后启动。

[glm结果](../../tests/v25/.results/f5x/cloud-g-wiring-glm-result.json)、[撤回存档](../../tests/v25/.results/f5x/archive-corpus-suspended.ts.txt)、[暂停记录](../../tests/v25/.results/f5x/f5x-glm-status.json)、[F5-X台账](../../tests/v25/.results/f5x/f5x-ledger.json)、[台账链接校验](../../tests/v25/.results/f5x/f5x-link-checks.json)、[定向复跑](../../tests/v25/.results/f5x/cloud-g-targeted-rerun.log)、[集成复跑](../../tests/v25/.results/f5x/cloud-g-integration-rerun.log)、[check-run1首败](../../tests/v25/.results/f5x/cloud-g-unified-check-run1.log)、[check-run2](../../tests/v25/.results/f5x/cloud-g-unified-check-run2.log)、[源码扫描](../../tests/v25/.results/f5x/cloud-g-source-scan.json)、[完整Worker](../../tests/v25/.results/f5x/cloud-g-full-worker-result.json)、[完整API串行](../../tests/v25/.results/f5x/cloud-g-full-api-serial-result.json)、[build日志](../../tests/v25/.results/f5x/cloud-g-build.log)、[spec首跑](../../tests/v25/.results/f5x/cloud-g-electron-spec-firstrun.log)、[三形态日志](../../tests/v25/.results/f5x/cloud-g-full-three-forms.log)、[包构建](../../tests/v25/.results/f5x/cloud-g-package.log)、[包扫描](../../tests/v25/.results/f5x/cloud-g-package-scan.json)、[包smoke](../../tests/v25/.results/f5x/cloud-g-package-smoke.log)、[归档清单](../../tests/v25/.results/f5x/cloud-g-smoke-archive-inventory.json)、[归档扫描](../../tests/v25/.results/f5x/cloud-g-smoke-archive-scan.json)、[冻结清单](../../tests/v25/.results/d02/source-files.json)。

## 5.109 第5阶段第五批：云 R/S 每原图 managed ledger 映射（RS-MAP）（2026-09-15）

**背景与侦查**：SP-P5 审计开放项②——managed ledger 与 R/S durable wrapper 的按原 jobId 远端执行映射。侦查先纠正口径：R/S=run_scheme/run_github_skill（非 refine/scale），核心接缝是 `managed_generation_requests` 严格 1:1（一行=一个 callId=一个 remoteKey，desktop-db schema.ts:377-408），而云 R/S 需要一个 run 级请求（单预算预留+单确认，maxImageCalls=n）× 每原 jobId 一个子执行；当前 musefold-cloud 图像绑定在登记处即终态 PAYMENT_IDENTITY_UNBOUND（0 付费发送）。

**glm 交付（A–F，双代理并行 kimi 只读台账）**：
- **A 契约**：`managed-generation.ts` 新增 managedRunRegistration/ChildInput/Record 等 run 级词汇（frozen originalJobIds 1–4 唯一、input/frozenRun z.json 记录、textBinding 可空 BYOK），zod `.strict()` 单一事实源。
- **C 桌面库**：迁移 **0013** 新建 `managed_run_requests`+`managed_run_children`（G 表与行为零变化），按 apps/desktop/AGENTS.md 流程内联主进程 bundle（migrations.generated.ts + journal + snapshot）。
- **B 台账**（packages/core managed-generation-ledger）：registerRun=一条 run 级 automation_spend_requests（estimatedPoints null → 单次 interactive 确认，拒绝即零成本终止）+ N 个 managed_run_children；每子稳定 remoteKey `desktop-rs-v1:hash(namespace, callerKey, originalJobId)`；**子一次性发送许可 `${requestId}#${ordinal}` 随进程死亡**（崩溃协调者永不重发，恢复=仅收据查询）；部分成功不自动补发剩余子；文本调用 claimRunTextCall 挂同一预留（序号排在图像子之后）。
- **D runtime/client**：`managed-run-runtime.ts`（新）+ managed-generation-client——run 级参考冻结一次（onReferences 一次/全 run，digest 缓存上传一次服务所有子）；每子 count:1 独立 Idempotency-Key POST /api/v1/generations，逐子收据/取消/资产/费用投影；未领取子取消=零成本；领取后不确定发送只轮询不终败（镜像 G）；**零 apps/api 生产改动**（复用 G 的全部端点）。
- **E 接线**（automation-durable-runs/run-spend/spend）：`type==='musefold-cloud' && verifiedAccountSessionAvailable()`（纯本地 safeStorage 会话探测：登出/受限/待恢复/不可读全部回落）→ 走 managed 子执行；否则保持 legacy unbound 终态拒绝。托管文本（账号文本绑定）仍在登记即 PAYMENT_IDENTITY_UNBOUND（登记负向约束：不新增托管文本 API）；BYOK 文本照旧本地执行恒 unknown。managed 重放按 callerKey 路由（跳过 legacy 哈希门，冻结 originalJobIds/executionId/runId 逐字节复用）。
- **F 测试**：新 run-ledger 单测（一预留一确认 N 子/重放/费用释放）、迁移就地测试（真实 0000–0012 旧库→0013→数据保留）、接线路由测试（mock 分层：路由断言+真 HTTP 语义分层）、runtime R/S describe 8 类用例（n=2 两 remoteKey 单预留、子1成子2败同键重放零新发送、丢失回包恢复只查询、run 级 digest 跨子冻结变更拒 SPEND_REFERENCE_CHANGED、未验证绑定上传前有界拒绝、托管文本拒绝、edits/generations 通道逐子、BYOK 回归）+ 集成扩展（真实 Hono/PG/S3：17 例含 R/S 真服务端到端）。

**主代理门禁（15 项 + 修复链）**：glm 交付后其自跑核心套件有 1 失败与 tsc 盲区，按「确认哪边错、修错的一方」逐项裁决修复：
1. `local-asset-cleanup.test.ts:307` 硬编码迁移链长度 13——glm 加 0013 后为 14，错在过期断言：改 `DESKTOP_MIGRATIONS.length`（不再随迁移腐化）。
2. `MigrationMeta` 未从 migrations.generated 导出——生成文件勿手改，改测试从 `drizzle-orm/migrator` 导入。
3. check run3：core 7 个 TS 错（生产 2=claimId 可空收窄改 `?? fail()` 永不冒名；测试 5=childInput 补全冻结形状/AuditRow 标注/两个绑定字面量 `satisfies AutomationPayerBinding`）。
4. check run4：desktop 3 个 TS 错（spec 接口 input/frozenRun 改 `RegisterManagedRun['run'][…]` 推导零 cast；`options?.retryOfRunId`）。
5. **三形态唯一失败=预期内契约演进**：electron.sp-p5-runs D 段钉的「云默认→409 有界拒绝」写于云路径未接线时代；本批后已验证会话走 managed（挂在 run 级确认门→测试 30s 中止）。已验证路径的真实 API 级覆盖=集成 17 例（含 R/S 真服务）；e2e 层改为钉**未验证**边界：登出（`account.logout` 移除本地会话，provider 行与默认选择保留）后原 409/零发送/1 审计/同键重放断言**逐字保留**通过；标题与头注释同步勘误。verified 正例 e2e（需真 Hono fixture 接入该 spec）登记后续卡。

**门禁结果**（新基线 1825/`7547c77f…`，初始 drift 17 文件=glm 16+主代理断言修复 1，全可解释；收尾 drift 18=+sp-p5 spec 改写，集合精确一致）：
| 项 | 结果 |
|---|---|
| 定向复跑 | contracts 60 / desktop-db 3 / **core 546**（含计数修复）/ main 852 / system 113+17S / 集成(真DB) 17，全绿 |
| 统一 check | run1–4 首败链留档（format 13 文件→TS2459→core 7 错→desktop 3 错），**run5 38/38 exit0** |
| 源码扫描 | 0 命中/0 错误 |
| Worker 全量串行 | 315 tests / 313P / 0F / 2S（=基线） |
| API 全量串行 | 1089 tests / 1088P / 0F / 1S（=基线；耗时偏长为本机当日门禁负载） |
| 双端 build | exit0 |
| 三形态 test:e2e | 527P/1F/7S 54.9m → sp-p5 D 段改写后定向重跑 1P → **口径 528P/7S/0F** |
| 包 | 2.5.0 arm64 zip；包扫描 6 目标 0/0；smoke 7P×2；归档 1 actual ZIP 0/0 |
| 收尾 drift | **0（18 文件集合与申报精确一致）** |

**出口与开放项**：SP-P5 开放项②关闭（开放项①已于 §5.108 关闭）；B21 两项全数落地，automation 面（CLI/MCP/Automation API）云 R/S 从有界拒绝进入 managed 执行（已验证会话）。**未关闭**：verified managed R/S 的 Electron 真机正例 e2e（下批候选，需真 Hono fixture 接入）；崩溃托管 run 的开机对账扫描（现为惰性：重放/DELETE/取消时对账，reconcile 已查询安全）；F5-X.H 原生交付/lifetime CI 远端/原生 Windows（发布卡）；真实旧库 G-DATA-03；真实账单 P6；GAP-B1/B3 裁决。tasks.md **86[x]/7[ ] 结构不变**（B21 已勾，本批不推进父项勾选）。下一步：verified 正例 e2e 小批或 GAP 裁决 → 原E 剩余 → G-RELEASE；管理员端在全部 v2.5 验收后启动。

[glm结果](../../tests/v25/.results/rsmap/rs-glm-result.json)、[glm状态](../../tests/v25/.results/rsmap/rs-glm-status.json)、[kimi台账](../../tests/v25/.results/rsmap/rs-kimi-ledger.json)、[台账链接校验](../../tests/v25/.results/rsmap/rs-link-checks.json)、[定向-contracts](../../tests/v25/.results/rsmap/rs-targeted-packages_desktop-contracts.log)、[定向-db](../../tests/v25/.results/rsmap/rs-targeted-packages_desktop-db.log)、[定向-core](../../tests/v25/.results/rsmap/rs-targeted-packages_core.log)、[定向-main](../../tests/v25/.results/rsmap/rs-targeted-main.log)、[定向-system](../../tests/v25/.results/rsmap/rs-targeted-system.log)、[集成复跑](../../tests/v25/.results/rsmap/rs-integration.log)、[check-run1](../../tests/v25/.results/rsmap/rs-unified-check-run1.log)、[check-run2](../../tests/v25/.results/rsmap/rs-unified-check-run2.log)、[check-run3](../../tests/v25/.results/rsmap/rs-unified-check-run3.log)、[check-run4](../../tests/v25/.results/rsmap/rs-unified-check-run4.log)、[check-run5](../../tests/v25/.results/rsmap/rs-unified-check-run5.log)、[源码扫描](../../tests/v25/.results/rsmap/rs-source-scan.json)、[Worker全量](../../tests/v25/.results/rsmap/rs-full-worker-result.json)、[API串行](../../tests/v25/.results/rsmap/rs-full-api-serial-result.json)、[build](../../tests/v25/.results/rsmap/rs-build.log)、[三形态日志](../../tests/v25/.results/rsmap/rs-full-three-forms.log)、[sp-p5改写重跑](../../tests/v25/.results/rsmap/rs-sp-p5-spec-rerun.log)、[包构建](../../tests/v25/.results/rsmap/rs-package.log)、[包扫描](../../tests/v25/.results/rsmap/rs-package-scan.json)、[包smoke](../../tests/v25/.results/rsmap/rs-package-smoke.log)、[smoke复跑](../../tests/v25/.results/rsmap/rs-package-smoke-rerun.log)、[归档清单](../../tests/v25/.results/rsmap/rs-smoke-archive-inventory.json)、[归档扫描](../../tests/v25/.results/rsmap/rs-smoke-archive-scan.json)、[冻结清单](../../tests/v25/.results/d02/source-files.json)。

## 5.110 第5阶段第六批：RSPOS verified managed 云 R 正例 e2e（2026-09-15）

**背景**：§5.109 登记的后续卡——RS-MAP 后已验证会话的 managed 云 R/S 只有集成层正例（17 例真 Hono/PG/S3 含 R/S）与 e2e 层未验证边界（sp-p5 D 段登出后 409），缺 Electron 真机正例。侦查（Explore 只读）确认可行性：复用 `CloudServiceProcess`（Testcontainer postgres:17-alpine + 应用迁移 + Graphile Worker 迁移 + 真实 Hono generation routes + 内存 S3）已有 Playwright-Electron 先例（electron.account-cloud-service.spec.ts）；关键陷阱=合成 sign-in 按 body.username 选人（Electron 发 body.email）须固定 joint-a、确认期间 run promise 挂起须先保存未 await 再点卡、userData/端口/请求记录全隔离。

**glm 交付（零生产改动）**：新 spec `tests/v25/electron.rsmap-verified-r.spec.ts`（285 行，单 database-gated 正例，skip 仅限 RUN_DATABASE_TESTS/Docker）：joint-a 真实 sign-in/status 登录并激活账号云默认 → 关壳种正式 R 方案（n=2）→ 二次启动经 automation 入口 POST（无 providerId、无 consent）→ **run promise 不 await**，等 `automation-confirm-card`（断言「2 张」「成本未知」「运行方案「E2E 文本海报方案」」）→ 点 `automation-confirm-approve` → await 首提 202 → 轮询至 success → 先 poll 本地资产投影再查账本（回执先于资产落盘的竞态防护）→ 同键重放。kimi 只读台账 12 锚点（含 6 个确认卡 testid 实数、joint-a 机制精确依据）+3 差异（D2=spec 文件名沿用 rsmap 前缀系主代理指定，有意）。

**主代理门禁**（基线仍 1819/00f4b6ca…；交付 drift=19=§5.109 的 18+新 spec，集合精确；收尾 drift=19 集合与交付一致零未解释）：
| 项 | 结果 |
|---|---|
| 静态核对 | helpers/routes/testids/方案名全部对上（automation-runs.ts:224/:385 等） |
| 新 spec 首跑 | **1P/0F 一次通过（16.7s，真 Testcontainer+真 Electron）** |
| 统一 check | run1 首败=新 spec 1 处 format（biome max-diagnostics=20 上限把既有 20 条警告级诊断排前、真错误被截断，全仓日志需单文件复跑定位）→ `biome format --write` 修复 → **run2 38/38 exit0** |
| 源码扫描 | 1733 文件（+1 新 spec）0 命中/0 错误 |
| Worker 全量 | 首跑漏带 RUN_DATABASE_TESTS（88P/227S 口径留档）→ 重跑 **315/313P/0F/2S=基线** |
| API 全量串行 | **1089/1088P/0F/1S=基线** |
| 三形态 test:e2e | **529P/7S/0F 54.5m 首跑零失败**（=基线 528P+新 spec 矩阵内 1P；7S 与基线一致；本轮带 DB 门控） |
| 包 | 2.5.0 arm64 exit0；包扫描 6 目标 0/0；smoke 7P/29.4s；归档 1 actual ZIP 0/0 |

**出口与开放项**：§5.109 登记的「verified managed R/S 的 Electron 真机正例 e2e」**R 半边关闭**；S 半边（run_github_skill 正例，需 GitHub/tree/blob+文本模型 fixture，可参考 electron.agent-retention 双 fixture 组合）与「真 production createApp+Better Auth+MinIO 全真后端」仍属集成层之上的更高成本项，登记不在本批。附：spec 的 testInfo.attach 证据未持久化为文件（通过用例不留 artifacts 目录），实际结果以 rspos-electron-spec.json（从实测日志落档）为准。tasks.md 86[x]/7[ ] 不变。下一步：GAP-B1/B3 裁决 → 原E 剩余（G-DATA-02/G-WORKER lifecycle）→ G-RELEASE；管理员端在全部 v2.5 验收后启动。

[glm结果](../../tests/v25/.results/rspos/rspos-glm-result.json)、[glm状态](../../tests/v25/.results/rspos/rspos-glm-status.json)、[kimi台账](../../tests/v25/.results/rspos/rspos-kimi-ledger.json)、[T0冻结](../../tests/v25/.results/rspos/rspos-t0-freeze.json)、[首跑日志](../../tests/v25/.results/rspos/rspos-first-run.log)、[spec结果](../../tests/v25/.results/rspos/rspos-electron-spec.json)、[check-run1](../../tests/v25/.results/rspos/rspos-unified-check-run1.log)、[check-run2](../../tests/v25/.results/rspos/rspos-unified-check-run2.log)、[源码扫描](../../tests/v25/.results/rspos/rspos-source-scan.json)、[Worker首跑](../../tests/v25/.results/rspos/rspos-full-worker.log)、[Worker重跑](../../tests/v25/.results/rspos/rspos-full-worker-rerun.log)、[Worker结果](../../tests/v25/.results/rspos/rspos-full-worker-result.json)、[API串行结果](../../tests/v25/.results/rspos/rspos-full-api-serial-result.json)、[API串行日志](../../tests/v25/.results/rspos/rspos-full-api-serial.log)、[三形态日志](../../tests/v25/.results/rspos/rspos-full-three-forms.log)、[包构建](../../tests/v25/.results/rspos/rspos-package.log)、[包扫描](../../tests/v25/.results/rspos/rspos-package-scan.json)、[包smoke](../../tests/v25/.results/rspos/rspos-package-smoke.log)、[归档清单](../../tests/v25/.results/rspos/rspos-smoke-archive-inventory.json)、[归档扫描](../../tests/v25/.results/rspos/rspos-smoke-archive-scan.json)、[收尾drift](../../tests/v25/.results/rspos/rspos-final-drift.json)、[冻结清单](../../tests/v25/.results/d02/source-files.json)。

## 5.111 第5阶段第七批：GAPX——GAP-B1 幂等键透传 + GAP-B3 Cloud MCP 负例（GAP-B2 by-design 关闭）（2026-09-15）

**背景与裁决**：§5.106 SP-P5 台账登记的三缺口，本批先经 Explore 只读复核取证再裁决：**GAP-B1=开发**（服务端幂等键接收+指纹去重+持久 register/replay 均前序已交付，缺口仅在调用者面——client 具备发键能力但 CLI/MCP 均不产生/不透传）；**GAP-B2=by-design 关闭**（headless serve 预算在 electron-store 与桌面 SQLite 事实源分立是 V25-SPEND-BOUNDARIES §8.1 已声明边界：serve 是 BYOK/G-only 独立宿主、非第二花费权威面，kimi 台账按实校正锚点为节首 :219+表格 :223-227 与 core generation.ts :601-606 PAYMENT_IDENTITY_UNBOUND，零代码改动）；**GAP-B3=测试**（Cloud MCP token × 业务路由跨面负例无专项用例）。

**glm 交付（8 文件，apps/api 生产零改动，仅动 B3 集成测试文件）**：B1——`packages/client` G/R/S 三方法统一可选 `idempotencyKey` 参（存在时才附 `idempotency-key` 头，复用 G 既有头名与服务端读头）；CLI `--idempotency-key` flag 挂 generate/scheme run/skill run 三写命令+USAGE 重试说明；MCP 三写工具 zod schema 暴露 `idempotencyKey`（camelCase、min1/max200、describe 写明重放/409/无键兼容），handler 解构透传不混入业务 body。**硬规则**：键=调用者显式选择的意图身份，跨重试复用；不做 payload hash、不自动生成、不持久化；无键路径完全兼容；桌面 R/S 受管运行 `key ?? executionId` 语义未动。B3——account-identity 集成 +2 用例：真 PKCE（oauth_client require_pkce+resource+consent→authorization_code）换真 access token（at+jwt EdDSA、aud=${API}/mcp），跨面隔离负例（MCP 受众 token 打 `/api/v1/generations` 写与 `/api/v1/private/history` 读均 **401**、生图 sentinel 计数 0——红线未触发）与协议负例（只读白名单无写工具/未知工具 -32602/malformed 经 Proxy 计数证明不触达下游）；fixture 以生产同构 `createCloudMcpRequestHandler` 挂载 POST /mcp（_meta envelope+Mcp-Method/Mcp-Name 现代协议）。**证伪留档**：requireMcpAuth 的 `jwksUrl=${baseURL}/jwks` 在本仓库恰好正确——Better Auth 最终 baseURL 含 /api/auth 前缀（token iss 为证），JWKS 生产实径 /api/auth/jwks 由 /api/auth/* 挂载承接；fixture 以 `routeFixtureJwksFetch` 定向 fetch stub 仅路由该 URL 回 app.request，jose 验签全程真实。kimi 只读台账 21 锚点（17 代码锚点 15 sha256 MATCH、1 DIFF+1 MISSING 均精确落在登记漂移集）+3 差异（D1/D2 锚点行号按实校正、D3 与 RSPOS 台账一致）。

**主代理门禁**（基线 1819/00f4b6ca…；T0 交叉对照 1826/8c23dace… drift=19=§5.110 收口集）：
| 项 | 结果 |
|---|---|
| 脚印核对 | 交付 drift=**27**=19+8 精确集合匹配（files 1826→1828=新增 2 个 B1 测试文件），零未解释漂移 |
| 定向复跑 | 主代理独立复现 **112/112**：client 4/cli 47/mcp 20/api 集成 41（含新 17 用例：CLI 7+MCP 8+API 2） |
| 统一 check | run1→run4 三轮首败链留档修复（run1=B3 文件 3 处 format，biome max-diagnostics=20 截断需 500 全量+awk 定位；run2=2 个新 B1 测试文件 format；run3=api typecheck TS2552/TS2322 `routeFixtureJwksFetch` 签名，改 `Parameters<typeof fetch>[0]`+async 包装；主代理修复后 B3 仍 41/41）→ **run4 38/38 exit0**；post-format 定向 cli 7P/mcp 8P/api 集成 41P 全绿 |
| 源码扫描 | 1735 文件（+2 新测试文件）0 命中/0 错误 |
| Worker 全量 | **315/313P/0F/2S=基线** |
| API 全量串行 | **1091/1090P/0F/1S**（=基线 1088P+B3 新 2 用例） |
| 三形态 test:e2e | **527P/7S/2F 54.9m**：两失败同签名 `composer-submit` disabled（web.design-schemes:674 web-desktop、web.scheme-trial:28 github-conflict web-mobile），**定向复跑 10/10 全绿**（含两条原失败用例双视口及同 describe 全部变体）→ 裁定负载敏感 flake 非回归：本批零 web 渲染/gateway 代码（client 头仅在显式传键时追加）、该签名在既往全部批次日志零前科、§5.110 基线 0F；登记观察项=helper 5s toBeEnabled 等待在全量并行负载下时敏 |
| 包 | 2.5.0 arm64 exit0；包扫描 6 目标 0/0；smoke 7P/28.3s；归档 1 actual ZIP 0/0 |
| 收尾 drift | **drift=27 集合与交付脚印完全一致**，零未解释漂移 |

**出口与开放项**：**GAP-B1 关闭**（client/CLI/MCP 三面键透传落地，调用者可复用意图身份契约统一）；**GAP-B2 以 by-design 注记关闭**（§8.1 已声明边界，不改代码）；**GAP-B3 关闭**（真 token 跨面负例钉死：MCP 受众 token 打业务路由全 401、sentinel 0）。可选后续登记不 preemptive 实现：requireSession 显式 token-type 区分（现为隐式隔离，若需显式错误码/日志另立卡）；`routeFixtureJwksFetch` 定向 JWKS 路由模式可复用。S 半边正例 e2e（GitHub fixture）与真 production 后端维持 §5.110 登记。tasks.md 86[x]/7[ ] 不变。下一步：原E 剩余（G-DATA-02/G-WORKER lifecycle）→ G-RELEASE CI 基础；管理员端在全部 v2.5 验收后启动。

[glm结果](../../tests/v25/.results/gapx/gapx-glm-result.json)、[glm状态](../../tests/v25/.results/gapx/gapx-glm-status.json)、[kimi台账](../../tests/v25/.results/gapx/gapx-kimi-ledger.json)、[T0冻结](../../tests/v25/.results/gapx/gapx-t0-freeze.json)、[脚印drift](../../tests/v25/.results/gapx/gapx-footprint-drift.json)、[定向client](../../tests/v25/.results/gapx/gapx-targeted-client.json)、[定向cli](../../tests/v25/.results/gapx/gapx-targeted-cli.json)、[定向mcp](../../tests/v25/.results/gapx/gapx-targeted-mcp.json)、[定向api集成](../../tests/v25/.results/gapx/gapx-targeted-api-int.json)、[cli复跑](../../tests/v25/.results/gapx/gapx-targeted-cli-postformat.log)、[mcp复跑](../../tests/v25/.results/gapx/gapx-targeted-mcp-postformat.log)、[api集成复跑](../../tests/v25/.results/gapx/gapx-targeted-api-int-postformat.log)、[check-run1](../../tests/v25/.results/gapx/gapx-unified-check-run1.log)、[check-run2](../../tests/v25/.results/gapx/gapx-unified-check-run2.log)、[check-run3](../../tests/v25/.results/gapx/gapx-unified-check-run3.log)、[check-run4](../../tests/v25/.results/gapx/gapx-unified-check-run4.log)、[源码扫描](../../tests/v25/.results/gapx/gapx-source-scan.json)、[Worker结果](../../tests/v25/.results/gapx/gapx-full-worker-result.json)、[Worker日志](../../tests/v25/.results/gapx/gapx-full-worker.log)、[API串行结果](../../tests/v25/.results/gapx/gapx-full-api-serial-result.json)、[API串行日志](../../tests/v25/.results/gapx/gapx-full-api-serial.log)、[三形态日志](../../tests/v25/.results/gapx/gapx-full-three-forms.log)、[失败定向复跑](../../tests/v25/.results/gapx/gapx-three-forms-failure-rerun.log)、[包构建](../../tests/v25/.results/gapx/gapx-package.log)、[包扫描](../../tests/v25/.results/gapx/gapx-package-scan.json)、[包smoke](../../tests/v25/.results/gapx/gapx-package-smoke.log)、[归档清单](../../tests/v25/.results/gapx/gapx-smoke-archive-inventory.json)、[归档plan](../../tests/v25/.results/gapx/gapx-smoke-archive-plan.json)、[归档扫描](../../tests/v25/.results/gapx/gapx-smoke-archive-scan.json)、[收尾drift](../../tests/v25/.results/gapx/gapx-final-drift.json)、[冻结清单](../../tests/v25/.results/d02/source-files.json)。

## 5.112 第5阶段第八批：GRCI——G-RELEASE-01 CI 身份/报告/端口基础（2026-09-15）

**背景与裁决**：Explore 只读侦查对「原E 剩余」证据裁决：**G-WORKER 本地 M=0**（B69 已覆盖 W01/W02 真进程/容器矩阵，`apps/worker/src` 无生产 TODO/未接线 lifecycle 路径；远端 CI/其他平台/真实部署归 G-RELEASE，不重复开发）；**D02.3「候选删除执行器仍待」为文档过期断言**——0028 迁移+`object-inventory-delete.ts`+cron 接线+真实 MinIO 测试均已落地（本批顺手完成 V25-DATA-LIFECYCLE :44 表行与 §14 标题段勘误，开发缺口关闭，剩余为完整联合验收与容量/多桶后续卡）；按 GOALS 既定执行顺序（「先完成 G-RELEASE-01 的构建身份/CI/启动设施」）选定 **GRCI 切片=R01.2/R01.3/R01.6 缺口**：web Docker 构建零 build-arg（main.yml:135-136、release.yml:140-141）、Dockerfile 无 BUILT_AT、无统一 build manifest、3399 端口无归属预检、报告上传 hygiene 不齐。

**glm 交付（9 文件，零 apps/api 生产改动）**：新 `scripts/build/v25-build-manifest.mjs`（117 行：GITHUB_* 环境优先回退 git；version 只读 apps/desktop/package.json；webBuildId 自动读 .next/BUILD_ID；**白名单字段绝不复制环境/不写 secret**（单测注入假 token 断言不外泄）；--artifact 缺失=硬错误零部分写出；exit 0/1/2）；main/release 的 web Docker 构建注入 `NEXT_PUBLIC_GIT_COMMIT/NEXT_PUBLIC_APP_VERSION/NEXT_PUBLIC_BUILT_AT`（ARG 命名与既有 Dockerfile/next.config 约定一致，属 openQuestion① 裁决接受）+ verify 任务在 Web production build 后新增 manifest 生成（`if: always()`，成败均有清单=R01.6）与上传（`if:always()`+`if-no-files-found: error`）；pr/main/release 的 database-integration-results 上传补 `if-no-files-found: error`（openQuestion② 接受：取消运行显示上传错误仅为外观代价）；**package-lifetime.yml 未动**（kimi D1 证伪侦查前提：其 `if: always()` 原本就在）；Dockerfile 补 BUILT_AT ARG/ENV；`start-v25-web.mjs` 导出 `assertPortAvailable()`（spawn 前探测 3399，占用时 lsof+ps 报 PID/命令退出非零；仅清理自启进程语义保留）；`v25-release-gates.test.ts` +7 断言块（build-args/Dockerfile ARG/manifest 步骤及顺序与 if:always()/package-lifetime 合规/端口预检标记，job 依赖链原断言未动）；新 `tests/repo/v25-build-manifest.test.ts`（5 例）+ `v25-standalone-web.test.ts` 端口行为 2 例（文件合计 5P）。kimi 只读台账 14 锚点 6 差异（D1 material=package-lifetime 前提证伪；D4=主代理批次内落档的 D02.3 勘误已被台账确认；余为行号精度与 R01/R4 命名空间警示）。openQuestion④：apps/desktop/package.json 的 worktree 改动系基线内既有（不在 27 收口集=冻结基线已含），非本批改动。

**主代理门禁**（基线 1819/00f4b6ca…；T0 1828/573a96f8… drift=27=§5.111 收口集）：
| 项 | 结果 |
|---|---|
| 脚印核对 | 交付 drift=**36**=27+9 精确集合匹配（files 1828→1830=新 manifest 脚本+其测试），零未解释漂移 |
| 定向复跑 | 主代理独立复现 **24/24**：release-gates 14/build-manifest 5/standalone-web 5 |
| 统一 check | **run1 首跑 38/38 exit0（零修复轮）** |
| 源码扫描 | 1737 文件（+2 新文件）0 命中/0 错误 |
| Worker 全量 | **315/313P/0F/2S=基线** |
| API 全量串行 | **1091/1090P/0F/1S=基线**（零 apps/api 改动，口径逐位不变） |
| 三形态 test:e2e | **529P/7S/0F 54.8m 首跑零失败**（=§5.110 基线；§5.111 两例负载 flake 未复现） |
| 包 | 2.5.0 arm64 exit0；包扫描 6 目标 0/0；smoke 7P/30.1s；归档 1 actual ZIP 0/0 |
| 收尾 drift | **drift=36 集合与交付脚印完全一致**，零未解释漂移 |

**出口与开放项**：R01.2 身份注入（Docker build-args+Dockerfile）落地；R01.3 端口归属预检落地（3399 占用即报 PID 退出，仅清自启进程）；R01.6 统一 build manifest（成败均生成/上传，白名单无 secret）+上传 hygiene 落地；R01.1 门禁完整性由 +7 断言块扩展。**登记后续**：manifest 的 --artifact 产物哈希接入 mac-package/win-package（G-RELEASE-02/03，脚本已就绪仅接线）；PR workflow 不含 manifest 步骤（按本批范围，PR 属 affected 优化入口）；D02 剩余开发项=方案硬删产品出口（purge service）与导入/导出时间型 lease 策略裁决、退休表容量/多桶身份独立卡；D02.3 文档勘误已完成（本批）。tasks.md 86[x]/7[ ] 不变。下一步：D02 方案 purge 产品出口（或导入/导出 lease 策略注记）→ G-RELEASE-02/03；管理员端在全部 v2.5 验收后启动。

[glm结果](../../tests/v25/.results/grci/grci-glm-result.json)、[glm状态](../../tests/v25/.results/grci/grci-glm-status.json)、[kimi台账](../../tests/v25/.results/grci/grci-kimi-ledger.json)、[T0冻结](../../tests/v25/.results/grci/grci-t0-freeze.json)、[脚印drift](../../tests/v25/.results/grci/grci-footprint-drift.json)、[定向gates](../../tests/v25/.results/grci/grci-targeted-gates.json)、[定向manifest](../../tests/v25/.results/grci/grci-targeted-manifest.json)、[定向web](../../tests/v25/.results/grci/grci-targeted-web.json)、[check-run1](../../tests/v25/.results/grci/grci-unified-check-run1.log)、[源码扫描](../../tests/v25/.results/grci/grci-source-scan.json)、[Worker结果](../../tests/v25/.results/grci/grci-full-worker-result.json)、[Worker日志](../../tests/v25/.results/grci/grci-full-worker.log)、[API串行结果](../../tests/v25/.results/grci/grci-full-api-serial-result.json)、[API串行日志](../../tests/v25/.results/grci/grci-full-api-serial.log)、[三形态日志](../../tests/v25/.results/grci/grci-full-three-forms.log)、[包构建](../../tests/v25/.results/grci/grci-package.log)、[包扫描](../../tests/v25/.results/grci/grci-package-scan.json)、[包smoke](../../tests/v25/.results/grci/grci-package-smoke.log)、[归档清单](../../tests/v25/.results/grci/grci-smoke-archive-inventory.json)、[归档plan](../../tests/v25/.results/grci/grci-smoke-archive-plan.json)、[归档扫描](../../tests/v25/.results/grci/grci-smoke-archive-scan.json)、[收尾drift](../../tests/v25/.results/grci/grci-final-drift.json)、[冻结清单](../../tests/v25/.results/d02/source-files.json)。


## 5.113 D02PURGE：方案永久删除后端与真实旧库副本验证（2026-09-19）

本轮接续工作树中未完成的 purge 契约、0029/schema 与共享对象退休策略；起点 `packages/db/src/index.ts` 导出不存在的模块，API/Worker 类型检查 TS2307。范围为后端单方案永久删除，不扩展 UI、gateway、同步或管理员端。本片后端已验收：统一检查、专项、完整 API/Worker 和真实旧库副本验证通过；完整 v2.5 与 86/93 父项保持开放。

**实现与语义：** 新增 `POST /api/v1/design-schemes/purge`，严格接受 `{ schemeId, expectedVersion }`。真实会话与正常账号授权在事务中复核；只允许所属账号、已软删、当前版本匹配且无活动方案/生图任务的方案。终态运行与费用记录保留，scheme/revision 外键解绑并保存 origin 身份；历史结果仍可读取。方案、版本、资产关联、无其他绑定且没有 preparation 的导入来源、永久删除身份、对象退休和 cleanup 意图在同一事务提交。仍有 preparation 的来源沿用原生命周期。共享来源、冻结生成引用和有效上传租约受保护；清理 Worker 复查引用并执行物理删除。方案/版本插入触发器与 advisory lock 防止永久删除后的 ID 复活；重复请求返回墓碑中保存的相同计数。`retiredKeys` 是逻辑退休数，不能解释为对象已物理删除。

0029 尚未发布，本轮在这份工作树增量中补齐计数和身份保护；已发布的 0000–0028 不改写。生成器最终报告无 schema 差异。迁移新增 origin 回填及可空关联；根 `pnpm run db:migrate` 在隔离旧前缀首次和重复执行均验证。旧故障注入只匹配至 0028，新增 0029 最后一个 trigger 的真实 DDL 故障，验证全部 pending SQL、schema、业务行和 journal 原子回滚再升级。

| 验证 | 当前结果与证据 |
|---|---|
| 统一门禁 | 最终 `pnpm run check` **38/38**，33 缓存，50.863 秒；包含 lint/typecheck/unit/desktop build/boundaries，随后 Web production build 成功。初轮曾以零缓存通过 38/38。[最终日志](../../tests/v25/.results/d02purge-20260919/check-final-isolated.log)、[初轮日志](../../tests/v25/.results/d02purge-20260919/check-2.log) |
| API + PG 迁移专项 | **51P/0F/0S**：10 项真实生产 API/Better Auth/PG purge，41 项全部 journal 前缀/回填/回滚及根迁移 CLI；上游账号为受控 fixture。[日志](../../tests/v25/.results/d02purge-20260919/api-targeted-final.log) |
| 实际对象存储专项 | **3P/0F/0S**：真实独立 MinIO 停机→持久重试→新 Worker PID 恢复→HEAD 404；有效租约到期；两方案共享同一对象直到最后引用释放。维护时钟显式推进到持久 retry/expiry，不冒充自然等待。[日志](../../tests/v25/.results/d02purge-20260919/storage-final-2.log) |
| API 全量 | **91 文件/1102P/0F/1S**，761.21 秒；唯一 skip 为未启用 `RUN_PACKAGE_LIFETIME_TESTS` 的自然一小时 package 生命周期专项。[完整 JSON](../../tests/v25/.results/d02purge-20260919/api-full-fixed.json)、[日志](../../tests/v25/.results/d02purge-20260919/api-full-fixed.log) |
| Worker 全量 + 正式镜像 | **40 文件/315P/0F/0S**，376.39 秒；启用数据库及容器门禁，镜像 `sha256:be6aca127daa315c488e30b127e2d9f881085014731ae7a25d7e160fe514da66`。[全量日志](../../tests/v25/.results/d02purge-20260919/worker-full.log)、[当前源码构建](../../tests/v25/.results/d02purge-20260919/worker-image-build.log) |
| schema / 扫描 | Drizzle 无新增差异；源码扫描零命中、零错误。[schema](../../tests/v25/.results/d02purge-20260919/schema-drift-final.log)、[最终扫描](../../tests/v25/.results/d02purge-20260919/source-scan-final.json) |

**真实 PostgreSQL 样本：** 对现有本机 `musefold_v25` 仅做只读 pg_dump，私有临时目录恢复到独立 PG17。原 7 份迁移 hash 与源码一致，升级到 30 份；8 条提示词、5 条生成记录、1 个方案、1 个 revision 的所有原列 hash 升级前后相同，重复迁移不增加 journal。仅在副本中为原 owner 建立合成的正常账号会话授权，然后通过正式 service 永久删除原有软删方案并重放；提示词/生成记录保持原 hash，原库未执行写入。该样本没有 scheme run 或待清理对象，因此费用保留、实际 S3 清理和真实云登录分别由专项证明，不能混称真实账号全链路。[脱敏统计与 hash](../../tests/v25/.results/d02purge-20260919/real-pg-copy.json)、[复现脚本](../../tests/v25/.results/d02purge-20260919/real-pg-copy.mts)。

**真实 SQLite 样本：** 使用本机已有 8 月 25 日、8 月 29 日及 9 月 19 日备份的私有副本，分别为 legacy user_version 19、20，以及受管前缀 7；正式 `runMigrations` + `takeoverDesktopDatabase` 均升级到 14 份受管迁移。三份原记录分别为 Prompt 7/7/7、generation 99/115/208、asset 77/92/178、session 56/59/79，原行全部原列保持。前两份另外按既有 0002 规则回填旧 history 77/87 条，核验 75/84 条成功作品路径、原提示词/引用快照、状态、时间和费用换算。三份 integrity=ok、外键违规=0、重复接管 noop、升级备份存在、原文件 SHA256 未变。这里只证明真实数据的迁移与接管，不替代图片文件字节可用性、原生安装器/签名包升级和跨端同步联合验收。[脱敏结果](../../tests/v25/.results/d02purge-20260919/real-sqlite-copies.json)、[复现脚本](../../tests/v25/.results/d02purge-20260919/real-sqlite-copies.mts)。所有真实 SQL/SQLite 临时副本已删除，报告无行内容或凭据。

**首次失败保留：** 初期类型检查/专项中的错误码枚举、缺失 `sql` import，以及 MinIO 子进程模块路径/上传夹具必填列均已修复；迁移首轮 40P/1F 是上述 0029 故障注入缺口；check 首轮因三个格式错误失败，修后全绿。SQLite 初版验收错误地要求整表数量不变，实际多出的行为既有 history 回填，改为逐条保留原行并独立核验迁入历史（生产代码未因此更改）。`api-*.log`、`storage-*.log`、`migration-upgrade-1.log`、`check-1.log` 和 `real-sqlite-comparison-first.json` 留存，不把首败计为通过。

后续全量 API 暴露原有参考图 release 测试将 PostgreSQL `CURRENT_TIMESTAMP` 与宿主 `Date.now()` 比较，相差 1ms 即失败。现改为在同一 PG 时钟上断言 `expires_at <= clock_timestamp()`，业务断言不放宽、生产代码不改；修复后重新执行完整 API。串行轮次因多组自然租约累积等待主动中断；并发首轮发现时钟问题后中断重跑，两次 exit 130 均不计作完整通过。后续 check 在并发负载下遇既有 `c3b-settle-interleave` 的 5s 超时，同源码独立复跑该文件 3 项、完整 check 38/38 及 Web build 全部通过；保留 5 秒时限敏感观察，没有修改 core 逻辑或放宽其测试超时。首次日志分别为 `api-full.log`、`api-full-final.log`、`check-final.log`。

最终冻结 1737 项输入、摘要 `6e13b8d996617bd7c74675cb0e6e2b513abd7aa86f01cbb184f0e209d7028bab`；相对起点新增 6/修改 11/删除 0，Worker 验收后唯一变化是上述测试文件，生产输入不变。[源码归属](../../tests/v25/.results/d02purge-20260919/source-drift-final.json)。完整 API 与最终综合检查通过，最终冻结输入漂移为 0；**本片后端范围验收通过**。[验收摘要](../../tests/v25/.results/d02purge-20260919/acceptance.json)、[最终输入核对](../../tests/v25/.results/d02purge-20260919/source-final-verification.json)。本轮不重跑全部 UI E2E 或桌面安装包；没有改 features/ui/桌面源码，不沿用 §5.112 的全量 UI 数字作为本轮结果。后续仍需方案 purge 客户端产品接线、完整 D02 联合验收、导入/导出 lease 策略裁决、退休表容量/多桶、真实旧库的安装包与双设备、真实费用及正式发布环境验收。
