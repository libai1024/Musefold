# Musefold 历史开发规则（保留）

本文件保留 v0.2 时代仍有价值的工程约束，不再作为新功能的版本入口。用户需求、当前源码和已确认的产品决策优先于旧的历史描述；发生冲突时按 [`docs/README.md`](../README.md) 的权威顺序处理。

## 1. 开始一个小功能前

每次只领取一个可验收的小功能，不以“大模块已完成”作为任务粒度。开始编码前必须完成：

1. 阅读 [`docs/README.md`](../README.md) 和当前版本文档中的对应任务与验收标准。
2. 阅读相关 product deep-dive，不只阅读任务标题。
3. 阅读实际 renderer 组件/store、shared 类型、preload、main IPC、数据库 repository/migration 和相关测试。
4. 列出关联影响：UI 状态、IPC 通道、数据库字段、导入导出、重试、设置联动、打包资源和测试 fixture。
5. 先补或明确验收测试，再实现功能。

如果阅读后发现任务会改变既有数据语义、Provider 请求格式或版本边界，先更新当前版本文档中的决策段落，不要直接扩大范围。

新任务优先阅读这些当前事实源：

- [`docs/product/README.md`](../product/README.md)
- [`docs/v0.4/README.md`](../v0.4/README.md)
- [`docs/v0.5/README.md`](../v0.5/README.md)
- [`../../doc/v1.0/README.md`](../../doc/v1.0/README.md)
- [`../v1.1/V11-WEB-ARCHITECTURE.md`](../v1.1/V11-WEB-ARCHITECTURE.md)

## 2. 架构与安全边界

- Renderer 只负责界面和交互状态；Node、SQLite、文件系统、safeStorage 和 Provider 网络请求继续留在 main 进程。
- 新 IPC 必须同时更新 `shared/types/ipc.ts`、`electron/preload/index.ts`、main handler、preview/mock bridge、renderer 调用和测试。
- API Key 只能经现有 `safeStorage`/系统密钥链读取。不得进入 renderer、SQLite、localStorage、导出文件、日志、截图、测试报告、Git、命令行参数或第三方请求日志。
- Provider 的新增能力必须通过能力描述或显式适配契约表达，不能用 Provider 名称在多个页面散落硬编码。
- v0.2.1 配方 AI 遵循 D-026：用户自行提供 Key；文本 AI 助手连接与图片生成 Provider 分开建模，但复用 main + `safeStorage` 安全设施。renderer 只能读取脱敏连接 DTO。
- DeepSeek、Kimi、GLM、MiniMax、自定义中转站、LiteLLM 和 New API 统一走 OpenAI-compatible 适配器。预设只能填充表单和帮助文案，禁止按厂商名称复制请求、错误处理或页面分支。
- AI-01 首选 Vercel AI SDK `ai` + `@ai-sdk/openai-compatible`，必须锁定确切版本并验证 Electron main 打包、许可证和取消语义；不能用浮动版本或从完整 Chat 项目复制内部运行时代码。
- 模型列表不是可用性的硬前提；`/models` 不可用时必须支持手工模型 ID。结构化输出能力必须显式探测/降级，并始终经过本地 schema 校验。
- 不把完整 Chat/Agent 项目、LiteLLM Python 服务或 New API 服务打进 Electron 客户端；不为配方草稿转换启用工具调用、文件访问或无限 Agent 循环。
- 生成统一使用现有 Workbench 和 jobId/AbortController 链路；不得恢复旧 `studio/store`，不得新增第二套生成状态。
- 生成请求必须使用提交时不可变快照；生成中的 Provider/模型/比例/质量/数量/引用和参考图不能被后续编辑悄悄改变。

## 3. 数据库、历史和兼容性

- 已发布 migration `0001`–`0010` 只读，不修改、不重排、不复用编号；v0.2 新迁移从 `0011` 开始。
- 新表/字段必须考虑旧库升级、外键、软删除、导入导出、重置、测试清理和失败回滚。
- 例外：v0.2.1 配方域遵循 D-012，使用独立的新数据库/命名空间和新对象模型，不读取、不双写、不转换 v0.1 的 `Fragment`、`Template`、`Composition`；不得在旧 `recipes.fields_json`、`recipe_drafts` 或旧 Composer store 上继续扩展配方功能。
- 历史记录必须能够还原实际发送的 Prompt、用户原始输入、参数、引用快照、参考图快照和 Provider 结果状态。
- 关联关系优先使用稳定 ID 和明确关系表；禁止用 Prompt 文本模糊匹配推断作品归属。
- 删除源提示词后，历史快照不能丢失；如果关系只剩快照，应在 UI 中明确显示“来源已删除”。
- 所有涉及数据库的改动都要覆盖成功、失败、取消、重试、分页、导入、导出、清库和旧库升级。

## 4. UI/UX 规则

- 保持 PromptForge 现有 Codex 风格：实色表面、细边框、适度圆角、低装饰、清晰层级；避免渐变、玻璃叠加、强发光、夸张阴影和“AI 感”装饰。
- 选择器使用应用内自绘控件，不使用原生 `<select>`；比例选择必须展示可理解的横竖/超宽画幅预览，并在工作台与设置保持一致。
- 每个新交互都要明确默认态、hover、focus、disabled、loading、empty、success、partial、failed、cancelled、retry 和窄屏行为。
- 主要动作必须是真实可操作按钮；不能用裸文本或只改变视觉状态而没有功能的装饰控件。
- 桌面端、临界宽度和窄屏分别验收；侧栏、弹层和命令面板不能裁切、漂移或遮挡主要操作。
- 探索模式与制作模式的差异必须由产品文档解释。制作专属能力不能悄悄出现在探索模式。
- 不引入富文本编辑器、ContentEditable 或自动语义分段，除非后续产品决策单独批准。

## 5. 生成能力规则

- 先做无真实 API 测试，再做真实 API 测试；假 Provider 必须能断言最终请求 Prompt、参数和引用/参考图元数据。
- 真实 API 只使用临时环境变量和最小请求，优先单图、低质量；密钥不得出现在终端回显、报告或提交中。
- 失败和取消必须写入 History，并保留足够的请求快照以支持再次制作或重试。
- 重试必须创建新的历史记录/关系快照，不修改原记录的事实；用户明确取消时不能伪装成失败。
- 生成成功后图片必须完成落盘、`media://` 展示和路径失效兜底；涉及图片的功能必须验证 Lightbox/文件操作不崩溃。

## 6. 测试顺序

按风险选择最小但完整的验证链路：

```bash
# 纯逻辑/共享契约
npx vitest run <相关测试文件>

# 源码门禁
npm run typecheck
npm run build
npm run check

# 触及 Electron IPC、数据库、生成或历史
env -u PF_TVT_KEY .venv-test/bin/python -m pytest tests/e2e -q

# 触及打包/启动/native 模块/资源路径
.venv-test/bin/python -m pytest tests/package/macos_package_smoke.py -q
.venv-test/bin/python -m pytest tests/package/windows_runtime_smoke.py -q
```

测试要求：

- 单测验证纯逻辑、边界和错误分类。
- 无 API E2E 验证真实界面、IPC、SQLite、文件和假 Provider 闭环。
- AI 无 API测试使用 Fake AI 覆盖直连、网关、模型列表缺失、schema 降级、超时和取消；不得通过伪造厂商名称替代协议级测试。
- 真实 API E2E 验证 Provider 兼容性和实际图片，只在明确授权时运行。
- AI 真实 API E2E 同样只在明确授权时运行；最小验收至少记录连接类型、模型、耗时、schema 结果和是否发生降级，不记录 Base URL 查询参数、Key 或完整敏感输入。
- 视觉验收至少覆盖深色/浅色、1440px、1100px、800px 和加载/空态/失败态。
- 任何失败、跳过或未运行的测试都必须在交接中如实记录，不能只报告通过项。

## 7. 代码与文件变更

- 文件编辑使用 `apply_patch`；保留用户和其他开发者已有改动。
- 不使用 `git reset --hard`、`git checkout --` 或删除用户数据库来规避问题。
- 不把临时截图、缓存、API 响应、安装日志和密钥文件加入仓库；完成后运行项目现有产物清理命令。
- 新增文件应放在其功能域目录；不要为了兼容旧实现重新引入已删除的 legacy store。
- 代码注释解释“为什么”，不重复“做了什么”；共享类型优先于重复的页面局部类型。

## 8. 文档和交接

每个小功能完成后同步：

- v0.2 任务状态和验收结果。
- 受影响的 product deep-dive 或新增设计文档。
- migration、IPC、Provider 请求和导入导出变化。
- 实际测试命令、通过/失败/跳过数量。
- 已知限制、未完成门禁和下一步建议。

最终交接必须链接具体文件，说明当前 package 版本、数据库版本、平台产物和是否使用真实 API。文档中永远不写 API Key、证书密码、SSH 密码或可复用的凭证。
