# Musefold v2.1 功能与 Host Exception 矩阵

> **状态**：v2.1 目标矩阵冻结，当前差距以源码为准
>
> **日期**：2026-08-27
>
> **读法**：`P` 表示必须产品一致；`H` 表示已批准宿主例外；`N` 表示不进入该宿主。`H/N` 不是免做标记，必须同时满足下文 exception 登记、fallback 与测试。

## 0. 一致完成定义

矩阵中的 `P` 行完成必须同时满足：

- contracts/domain 中只有一份实体与能力语义；
- product-ui/page-controller 只有一份共享编排；
- Web/Desktop 的文案、状态、错误、动作权限和终态刷新一致；
- 两端 E2E 覆盖同一用户意图，触及共享 surface 时视觉门禁全绿；
- 任何剩余差异都能指向本文件中的 `HX-*`，不能只写“平台不同”。

## 1. Shell、账号与设置

| 能力 | Web | Desktop | 目标合同 | 允许例外 | v2.1 验收 |
|---|---:|---:|---|---|---|
| 主导航、页面标题、当前位置 | P | P | 共享 navigation catalog 与 product-ui shell | Web safe-area、Desktop titlebar：`HX-WEB-SAFE-AREA` / `HX-DESKTOP-WINDOW` | 1440/760/680/390 导航 E2E + shared visual |
| 登录 | P | P | 同一账号错误码、成功状态、额度刷新 | Web Cookie/OAuth 回跳；Desktop 主进程凭据交换 | 双端真实/fixture 合同测试 |
| 注册 | P | P | 同一校验、错误与登录后状态 | transport 不同 | 双端 E2E |
| 登出 | P | P | 撤销当前会话、清 Query 敏感缓存，不删创作数据 | Desktop 同时停用同步 transport | 双端 E2E + Desktop sync 状态断言 |
| 账号摘要与额度 | P | P | 服务端为额度唯一真值 | Desktop 可另显示本地 Provider 状态 | shared surface + 终态刷新测试 |
| 兑换码 | P | P | 同一端口、结果、错误与额度失效 | 无 | 双端 E2E |
| Cloud Agent 连接管理 | P | P | 同一 grant/scope/预算/暂停/撤销语义 | Web 完整 OAuth 页面；Desktop 共享摘要和跳转 | shared surface + web-api 集成 |
| 提示词同步设置 | N | H | Desktop 登录后显式 consent | `HX-DESKTOP-LOCAL-SYNC` | Desktop E2E + 迁移测试 |
| 本地 Provider / API Key | N | H | 仅 Desktop 主进程 safeStorage | `HX-DESKTOP-PROVIDER` | Desktop 安全/设置 E2E |
| 本地 Automation 控制面 | N | H | 仅 loopback、本机 token | `HX-DESKTOP-AUTOMATION` | 本地 MCP/Automation 回归 |
| 更新、窗口、托盘 | N | H | Electron shell 能力 | `HX-DESKTOP-WINDOW` | Desktop 专属 E2E |

## 2. 提示词库

| 能力 | Web | Desktop | 目标合同 | 允许例外 | v2.1 验收 |
|---|---:|---:|---|---|---|
| 列表、搜索、排序、置顶 | P | P | 同一 Query 参数、排序与空/错态 | Desktop 可虚拟化，结果语义不变 | controller 单测 + 双端 E2E |
| Folder/Tag 浏览与编辑 | P | P | contracts 版本、关系与删除语义一致 | 无 | OpenAPI + sync 集成 + 双端 E2E |
| Prompt 创建/查看/编辑 | P | P | 同一 schema、校验、冲突与保存结果 | Desktop 未启用同步时只写本地 | mapper/controller + 双端 E2E |
| 回收站、恢复 | P | P | 墓碑、恢复与版本语义一致 | 无 | 跨设备删除/恢复测试 |
| 永久删除 | P | H | 云端保留策略优先；本地清理不得绕过墓碑 | `HX-DESKTOP-LOCAL-PURGE` | 云/本地组合场景 E2E |
| 封面/预览 | P | P | 统一 asset capability，不同步绝对路径 | 本地路径与签名 URL 分别由宿主解析 | 双端无泄漏测试 |
| 冲突处理 | P | P | 不静默覆盖；保留云端/本地/两份的结果可解释 | Web 编辑冲突可用同语义不同布局 | 跨设备 conflict matrix |
| 离线编辑 | N | H | Desktop SQLite + outbox | `HX-DESKTOP-OFFLINE-DB` | 断网恢复测试 |
| 导入/导出本地文件 | H | H | 共享文档格式与校验 | Web 文件选择/下载；Desktop 文件系统 | 格式契约 + 双端 E2E |

## 3. 工作台与生成

| 能力 | Web | Desktop | 目标合同 | 允许例外 | v2.1 验收 |
|---|---:|---:|---|---|---|
| 新设计、会话列表、重命名、归档、删除 | P | P | 共享 session reducer/controller 与错误语义 | Desktop 可保留 local-only 会话来源 | 双端 E2E |
| 草稿保存与恢复 | P | P | 同一草稿状态、冲突提示与保存反馈 | Web cloud draft；Desktop local draft | controller 合同测试 |
| Prompt 引用 | P | P | 同一引用快照与失效语义 | 无 | shared visual + 双端 E2E |
| 生成参数、估价、提交 | P | P | 同一参数 schema、校验、幂等与状态词表 | Provider/model catalog 由 capability 给出 | contracts + 双端 E2E |
| 参考图 | P | P | 同一数量/类型/尺寸约束与 asset 抽象 | Web 先上传；Desktop 只允许受管本地路径 | 上传/路径白名单测试 |
| 生成状态、取消、重试 | P | P | queued/running/cancelling/terminal 与错误一致 | 本地/云 transport 不同 | 双端状态机 E2E |
| 终态额度刷新 | P | P | 同一 account Query 失效路径 | 无 | 成功/失败/取消三态测试 |
| 结果下载/另存 | P | P | 用户都能获得文件 | Web 下载 URL；Desktop save dialog | 双端 E2E |
| 打开所在目录、复制本地文件、微调本地源 | N | H | 本地路径存在时才提供 | `HX-DESKTOP-FILESYSTEM` | Desktop 专属 E2E |
| Generate 顶栏素材库开关（参考素材面板） | N | H | Desktop 顶栏开关打开参考素材 dock，消费 desktop-contracts 引用快照与本地受管参考 | `HX-DESKTOP-FILESYSTEM`；Web 不渲染该入口，引用经 composer 上下文菜单（`workbench-context-ref-prompt` 等）替代 | Web 负向断言（`titlebar-materials-toggle` 不存在 + 替代入口可见）+ Desktop E2E |
| Generate 顶栏任务摘要 | N | H | 摘要由桌面工作台回合状态推导，呈现在 Desktop titlebar 内；来源标记含桌面专属 Skill/方案 | `HX-DESKTOP-WINDOW`（titlebar 宿主面）+ 桌面工作台状态；Web 生成状态由共享 timeline/状态词表提供 | Web 负向断言（`titlebar-task-summary` 不存在）+ Desktop E2E |
| 本地 Provider 生图 | N | H | Desktop BYOK，不向云上传 Key | `HX-DESKTOP-PROVIDER` | safeStorage + 生成回归 |
| 云端后台任务 | H | P | 云任务在 Web/两端可恢复 | Desktop 本地任务不承诺 App 退出后继续 | `HX-CLOUD-BACKGROUND` | worker/reconnect E2E |

## 4. 历史与资产

| 能力 | Web | Desktop | 目标合同 | 允许例外 | v2.1 验收 |
|---|---:|---:|---|---|---|
| 历史列表、详情、来源、状态 | P | P | 同一 GenerationJob 文档与来源标记 | 无 | controller + 双端 E2E |
| 筛选与分页 | P | P | 同一筛选语义；cursor/本地分页由 adapter 处理 | Desktop 虚拟化 | 双端结果集合断言 |
| 费用与模型信息 | P | P | 单位、未知值与估价/实际值语义一致 | Desktop 可显示本地 Provider 名 | 契约 + surface 测试 |
| 取消、重试、存提示词 | P | P | 与工作台共用动作语义 | 无 | 双端 E2E |
| 软删、恢复 | P | P | 云墓碑与本地状态一致 | 无 | 跨设备 E2E |
| 本地文件管理 | N | H | 只操作受管本地资产 | `HX-DESKTOP-FILESYSTEM` | Desktop 专属 E2E |
| Web Share | H | N | 浏览器支持时提供，不作为核心完成条件 | `HX-WEB-SHARE` | capability 测试 |
| 成本看板 | P | P | 指标与区间语义一致 | 若只覆盖 local 数据须显式来源过滤 | 双端数据集合同测试 |
| 大列表虚拟化 | H | H | 性能实现可不同，排序/可达性不能不同 | `HX-HOST-PERFORMANCE` | 大数据量 E2E |

## 5. 设计方案、Skills 与 Agent

| 能力 | Web | Desktop | 目标合同 | 允许例外 | v2.1 验收 |
|---|---:|---:|---|---|---|
| 官方 Cloud Skills 列表/读取 | P | P | 已发布固定版本/hash，同一只读内容 | 无 | Cloud MCP + 双端 surface |
| Cloud Skill 生图引用 | P | P | generation 保存 Skill 版本/hash/输入快照 | 需云账号和预算/审批 | web-api 集成 + 双端历史 |
| 正式设计方案 | P | P | 同一方案契约、创建/编辑/使用语义与 shared surface；存储 transport 可不同 | Desktop 可离线保存，Web 保存云端规范副本 | 双端 controller/E2E + shared visual |
| 本地 GitHub Skill | N | H | 固定 commit、只读文本/图片、不执行脚本 | `HX-DESKTOP-GITHUB-SKILL` | 本地 MCP 安全测试 |
| Cloud 任意 GitHub Skill | N | N | 明确禁止 | 无 | tools/list 与安全负例 |
| Cloud Agent 账号/模型/Prompt/官方 Skill 上下文读取 | P | P | 精确 7 工具只读白名单与 OAuth scope | UI 宿主不同，服务端工具相同 | SDK + 两个真实客户端门禁 |
| 本地 MCP/CLI | N | H | stdio/loopback，本地策略与文件能力 | `HX-DESKTOP-AUTOMATION` | 本地全量回归 |
| 提高 scope/预算 | P | P | 只能由已登录用户 UI 操作并重认证 | Agent 工具不提供写策略能力 | 安全集成测试 |
| Agent 读取密钥/任意文件/任意 URL | N | N | 永久禁止 | 无 | 负面契约测试 |

## 6. 响应式与交互

| 能力 | Web | Desktop | 目标合同 | 允许例外 | v2.1 验收 |
|---|---:|---:|---|---|---|
| >760px 三栏几何 | P | P | 同一 product-ui shell 几何 | Desktop titlebar | shared visual |
| ≤760px compact drawer | P | P | 同一 drawer、scrim、Escape/focus | 触摸/鼠标输入差异 | 760 E2E |
| ≤680px phone 布局 | P | H | Web 完整 phone；Desktop 窄窗保持可达 | `HX-DESKTOP-NO-PHONE-SHELL` | 680/390 Web + Desktop 窄窗 |
| Prompt 手机详情 | P | H | Web 全页子状态；Desktop 窄窗可共享但不伪装浏览器导航 | `HX-DESKTOP-NO-PHONE-SHELL` | Web history/back E2E |
| History 手机详情 | P | H | Web bottom sheet；Desktop 窄窗可用同组件 | 输入模型差异 | 双端窄档测试 |
| 软键盘 inset/safe-area | H | N | Web 宿主胶水 | `HX-WEB-SAFE-AREA` | 390 mobile E2E |
| 键盘快捷键、原生菜单 | H | H | capability 目录共享意图 | 实际组合键/菜单由宿主 | 各宿主 E2E |

## 7. Host Exception Registry

| ID | Host | 能力边界 | fallback / 产品要求 | 数据红线 | 复审触发器 |
|---|---|---|---|---|---|
| `HX-DESKTOP-FILESYSTEM` | Desktop | 本地打开、另存、目录、受管参考图、参考素材面板（顶栏素材库开关） | 仅有真实本地资产时显示 | 路径不进云、日志、Agent Cloud | Web 获得等价 File System Access 且产品批准 |
| `HX-DESKTOP-PROVIDER` | Desktop | BYOK Provider 与模型连接 | Web 使用云模型目录 | Key 只在主进程 safeStorage | 云端批准 BYOK 托管方案 |
| `HX-DESKTOP-OFFLINE-DB` | Desktop | SQLite 离线读写/outbox | Web 断网时明确只读或保存草稿 | 不把缓存伪装已提交 | Web 离线产品单独立项 |
| `HX-DESKTOP-LOCAL-SYNC` | Desktop | local-first Prompt/Folder/Tag 同步控制 | 登录后显式选择，可暂停 | 未确认不上传 | 浏览器拥有本地副本时复审 |
| `HX-DESKTOP-LOCAL-PURGE` | Desktop | 清理本地记录/文件 | 云墓碑与保留策略不受影响 | 不删除未推送 outbox/conflict | 统一云清理产品上线 |
| `HX-DESKTOP-WINDOW` | Desktop | titlebar（含 generate 任务摘要）、窗口、托盘、更新 | Web 无占位设置 | 无密钥进入 renderer | 新宿主引入 |
| `HX-DESKTOP-AUTOMATION` | Desktop | stdio MCP/CLI/loopback Automation | Web 只管理 Cloud grants | loopback token 不进 Cloud | headless 产品立项 |
| `HX-DESKTOP-GITHUB-SKILL` | Desktop | 固定 commit 的公共 Skill 读取 | Cloud 只用官方 registry | 永不执行脚本 | Cloud 第三方 registry 安全评审通过 |
| `HX-WEB-SAFE-AREA` | Web | 软键盘、safe-area、浏览器导航 | Desktop 使用窗口 inset | 不影响产品状态 | Capacitor/新宿主引入 |
| `HX-WEB-SHARE` | Web | Web Share API | 不支持则回退下载/复制链接 | 只分享已授权 asset | Desktop 统一系统分享落地 |
| `HX-CLOUD-BACKGROUND` | Web/Cloud | worker 持久任务与断线恢复 | Desktop 本地任务明确生命周期 | 不把本地任务伪装云任务 | Desktop utility/background 方案立项 |
| `HX-HOST-PERFORMANCE` | Both | 虚拟化、缓存、滚动实现 | 结果、顺序、可访问性一致 | 不改变数据语义 | 性能实现收敛时 |
| `HX-DESKTOP-NO-PHONE-SHELL` | Desktop | Electron 窄窗不是手机浏览器 | 保证操作可达，不要求 safe-area/软键盘 | 无 | 移动桌面宿主立项 |

## 8. 新增或修改矩阵的规则

1. 新能力先加 `P` 行，再实现；不能先做成单端能力后补文档。
2. 申请 `H/N` 必须复用或新增 `HX-*`，写出不可替代的平台事实、fallback、数据边界和测试。
3. “暂未实现”只能进入交付计划的未完成状态，不能进入 exception reason。
4. exception 影响 CLI/MCP/Automation/capabilities 时，同卡必须按 `CONTRIBUTING.md` 判断 `Skill-Impact`。
5. `REL-03` 逐行核对本矩阵；没有证据的 `P` 行不得宣布 v2.1 完成。
