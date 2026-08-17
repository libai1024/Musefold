# V04 · 实施计划与验收

> **状态**：设计规格（待评审）
> **节奏**：四阶段约 7 周（P1 两周 / P2 两周 / P3 两周 / P4 一周），每阶段有硬出口标准，未达标不进下一阶段。
> **纪律**：延续 v0.2 开发规则——契约先行（类型 + 错误码先冻结）、每张任务卡带验收、E2E 全量绿灯是每阶段门禁。

---

## 1. 阶段与任务卡

### P1 · 基座：core 抽取 + 控制面（只读域）

| 卡 | 内容 | 验收 |
|---|---|---|
| V04-CORE-01 | npm workspaces 改造（`packages/*`），App 构建/打包脚本适配 | `npm run dev` / `npm run build` / 打包产物与 v0.3 等价 |
| V04-CORE-02 | 定义 ports（Secrets/Paths/EventSink/Logger）+ `createMusefoldCore` 骨架 | 类型审查通过；Electron 适配器实现 |
| V04-CORE-03 | 搬移 `electron/db` + `electron/providers` 进 core（搬移不重构，re-export 兼容） | 全部既有单测通过；IPC handler 改薄委托后 E2E 全绿 |
| V04-CORE-04 | 服务面 v1：Library/History/Recipe(读+compile)/Provider(读)/Material 六服务 | 服务级单测 ≥ 30 条（复用现 repo 测试数据） |
| V04-API-01 | 控制面服务器：绑定/token/发现文件/健康检查/错误信封/审计骨架 | 加固清单（V04-SECURITY §6）逐项自测 |
| V04-API-02 | 只读端点 + SSE 通道 + 契约测试（golden request/response） | `GET /v1/prompts` 等 12 端点契约测试绿 |
| V04-CLI-01 | CLI 骨架：发现链、全局参数、退出码、`status`/`prompt`/`history`/`recipe compile` | `musefold prompt list --json | jq` 可用；三态发现（App/守护/无）正确 |
| V04-SET-01 | 设置页「自动化」面板 v1：开关 + token 展示/轮换 | 关闭后端口不监听、发现文件删除 |

**P1 出口**：桌面 App 零回归（全量单测 + Playwright E2E）；`musefold status` 与只读命令在 App 运行时可用。

### P2 · 生图闭环 + MCP 服务器

| 卡 | 内容 | 验收 |
|---|---|---|
| V04-CORE-05 | GenerationService 进 core（`generate()` 汇聚点迁移，双库账本、进度事件） | App 内生图路径回归绿（E2E 生图用例） |
| V04-API-03 | `POST /v1/generations` + 策略闸门（估算/确认/预算/审计）+ `/v1/confirmations` | 单测覆盖 a/b/c/d 四分支；确认卡 UI 联动 |
| V04-API-04 | `POST /v1/uploads`（参考图转存）+ 路径白名单实现 | 穿越/symlink/超限用例全拒 |
| V04-MCP-01 | MCP 服务器骨架（官方 SDK、stdio、stderr 日志纪律、降级目录） | Inspector 连接 + `musefold_status` 通过；stdout 污染专项测试 |
| V04-MCP-02 | 只读工具组（core/library/providers/recipes/history）+ resources + prompts | Inspector schema 校验；`ttlMs` 缓存头 |
| V04-MCP-03 | `generate_image`（wait/no-wait、进度通知、elicitation 确认、错误映射） | Claude Code 实测场景 A；Codex `wait:false` 轮询路径实测 |
| V04-CLI-02 | `musefold generate`（进度条、`--json` NDJSON、Ctrl-C 取消、`-o` 复制） | 场景 B 实测；退出码矩阵测试 |
| V04-SET-02 | 设置页预算配置 + 审计列表 + 朱点接入外部任务忙碌态 | 预算冲销准确；外部任务点亮朱点 |

**P2 出口**：Claude Code 与 Codex 双客户端跑通「检索 → 编译 → 确认 → 生图 → 拿到本地路径」。

### P3 · 高阶能力：方案 / Skill / 写入

| 卡 | 内容 | 验收 |
|---|---|---|
| V04-CORE-06 | SchemeService（list/get/compile/run，仅正式方案）+ SkillService（github run 聚合） | 方案运行事件流经 SSE 完整转发 |
| V04-MCP-04 | `list/get/compile/run_scheme` + `run_github_skill` + `save_prompt` + `search_materials` | 18 工具全量 Inspector 绿；`--toolsets`/`--readonly` 裁剪断言 |
| V04-CLI-03 | `scheme`/`skill`/`material`/`prompt add/rm`/`cancel` 命令组 | 场景 C 管道链路实测 |
| V04-SEC-01 | 速率限制 + 熔断 + 审计完整落库 + token 轮换广播 | 安全清单（V04-SECURITY §6/§7）全项通过 |
| V04-QA-01 | 三客户端手工矩阵（Claude Code / Codex / Cursor × 只读/全量 × App 三态） | 矩阵表全绿，问题清零或降级记录 |

**P3 出口**：暴露矩阵（V04-CORE-FEATURE-SUMMARY §6）中所有 v0.4 项可用。

### P4 · headless + 发布

| 卡 | 内容 | 验收 |
|---|---|---|
| V04-SRV-01 | `musefold serve`：owner.lock 互斥、headless SecretsPort（keychain/env/加密文件三级）、优雅退出 | App/守护互斥实测；CI（Linux 无 GUI）跑通场景 C |
| V04-PKG-01 | npm 发布流水线（`musefold` + `@musefold/mcp`）、版本策略落地、`npx` 冷启动优化 | 干净机器 `npx -y musefold mcp` 接入三客户端成功 |
| V04-DOC-01 | 用户接入文档（App 内「自动化」面板链接 + 官网/README 配置样例） | 文档评审通过 |
| V04-REL-01 | v0.4.0 发布清单：变更日志、已知问题、包外发布证据冻结 | 发布验收会 |

---

## 2. 测试策略

| 层 | 手段 | 门禁 |
|---|---|---|
| core 单测 | vitest，服务级黑盒（内存/临时目录 DB） | 每卡随附；P 门禁全绿 |
| 控制面契约 | golden request/response 快照 + 错误码矩阵 | API 变更必须先改契约测试（契约先行） |
| MCP 协议 | MCP Inspector CLI 自动化（tools/list schema、逐工具冒烟）+ stdout 污染专项 | P2 起进 CI |
| CLI E2E | 子进程级：真实拉起 `musefold` 对着测试守护（`--data-dir` 隔离） | 退出码/JSON 契约断言 |
| 桌面回归 | 既有全量单测 + Playwright E2E **一条不删** | 每阶段门禁 |
| 真 Provider 冒烟 | 环境变量注入 key 的手动/夜间任务（避免 CI 烧钱），复用 `generated/` 证据目录惯例 | P2/P3 出口各跑一轮 |
| 安全测试 | 路径穿越/Origin/限流/token 轮换/argv 明文 专项用例 | V04-SEC-01 验收 |

---

## 3. 风险登记

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| workspaces 改造牵动打包（electron-builder 路径） | 中 | 高 | P1 第一周只做 V04-CORE-01 并出打包验证；不行则退化为「core 仍在仓内目录、以 tsconfig paths 引用」 |
| `shared/` 与 core 双份领域逻辑漂移 | 中 | 中 | P1 用 re-export 单源；P3 收口 `shared/recipe-domain` → core |
| MCP SDK 大版本（v1→v2）切换期 API 变动 | 中 | 低 | 薄适配层隔离 SDK；实现周锁版本 |
| elicitation 在部分客户端不可用 | 高 | 中 | 预算路径为第一公民；`CONFIRMATION_REQUIRED` 引导文案打磨 |
| headless keychain 在 Linux CI 不可用 | 高 | 低 | env 注入路径（§4.2 优先级 2）作为 CI 标准姿势写进文档 |
| npm 包名 `musefold` 被占 | 低 | 中 | 立项时立刻核验/注册；备选 scope `@musefold/cli` |

---

## 4. 开放问题（已全部拍板，2026-08-13，随 P1 冻结）

| # | 问题 | 拍板结论 |
|---|---|---|
| Q1 | 自动化预算默认值 | ✅ **默认 0**（一切花钱动作须确认），onboarding 卡引导设置 |
| Q2 | `save_prompt` 默认开还是默认关 | ✅ **默认开**——写入无成本且可回收站兜底 |
| Q3 | MCP 工具 title/描述语言 | ✅ **description 英文、title 中文**（规格已按此撰写） |
| Q4 | `--autostart` 拉起 App 是否默认开启 | ✅ **默认关**（避免 Agent 悄悄拉起 GUI 吓到用户） |
| Q5 | 审计中提示词保留策略 | ✅ **完整存储**（与原建议不同：产品选择追溯完整性优先；审计数据仅在本机所有者进程 SQLite 内，永不出机）——V04-SECURITY §3/§6 已同步修订 |
| Q6 | 清理 `docs/README.md` 版本漂移 | ✅ 已完成（2026-08-13 随 v0.4 开工修正，无需等 V04-DOC-01） |

---

## 5. 与既有文档的关系

- 本目录新增，不修改任何 v0.3.x 事实源。
- `docs/README.md` 索引追加 v0.4 条目（设计中）。
- v0.4 实现完成后的发布说明和校验哈希放在包外发布系统；工作树只保留长期有效的开发文档。
- 旧 `docs/07-ipc-contracts.md` 为 v0.1 时代快照，**不作为**控制面设计依据；控制面契约以 V04-ARCHITECTURE §5 + 契约测试为准。
