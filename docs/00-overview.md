# 00 · 产品总览与技术栈

> PromptForge / 词炉 —— 面向个人创作者的跨平台(macOS + Windows)生图提示词管理桌面 App。

---

## 1. 产品定位

**一句话**：把"中转 API 调用 + 提示词管理 + 模板组合"打包成原生桌面体验，以一次性买断定价切个人创作者市场。

**目标用户**：频繁用 AI 生图（gpt-image / SD / MJ / Flux）的独立设计师、内容创作者、提示词爱好者。他们痛于：提示词散落在各处难找、复用靠手抄改字、中转站 API 调用要写脚本、无统一桌面管理工具。

**差异化支点**（市场空白）：
- **原生桌面 Mac+Windows**：现有提示词工具全 Web/扩展，生图客户端无桌面端管理
- **完整模板引擎**：PromptBox/PromptStorm 仅基础变量，本 App 完整 Fragment/Template/Composition 三层 + 权重序列化
- **用户自带 Key 直调云 API**：管理类无生图，生图类无桌面，本 App 一体化
- **一次性买断**：竞品全订阅制

---

## 2. 关键决策记录

| # | 决策 | 理由 |
|---|---|---|
| 1 | **落地页 = 提示词库** | 最高频动作是找/改/生成，库是主区；组合画布按需进入 |
| 2 | **Composition → "另存为 Prompt"** | 画布是造词工具，库是成品；单向提升，库不被半成品污染 |
| 3 | **MVP 两段式** | 第一段：管理+生图+历史闭环（2-3 周）；第二段：组合系统（2-3 周）。更早验证价值 |
| 4 | **视觉 = 原生系统风** | 贴 macOS/Windows 原生控件，毛玻璃/Mica 由系统提供，跨平台克制一致 |
| 5 | **暂不做 DRM** | 无 license 激活，先本地构建手动分发给早鸟用户，验证后再补 |
| 6 | **交付 = 规格 docs + 真实代码骨架** | 本次一次性把蓝图和可运行骨架搭好，后续子代理按模块独立填肉 |

---

## 3. 技术栈（基于 2026-07 调研确认）

| 层 | 选型 | 版本/依据 |
|---|---|---|
| 框架 | Electron + React 18 + TypeScript | 跨平台成熟 |
| 构建开发 | **electron-vite v5** | main/preload/renderer 隔离构建、HMR 最细致；文档 electron-vite.org |
| 打包分发 | **electron-builder** | 双平台签名，better-sqlite3 asarUnpack 配置成熟 |
| 数据库 | **better-sqlite3** + WAL + FTS5 | 同步 API、FTS5 全文搜索 |
| 中文分词 | **@node-rs/jieba** | napi-rs 预编译二进制，Electron 集成友好，无需 C++ 工具链（优于 nodejieba） |
| 密钥存储 | **safeStorage 异步 API** + electron-store | 官方推荐，OS 级加密（macOS Keychain / Windows DPAPI） |
| UI 组件 | **Tailwind v4 + Radix UI**（shadcn/ui copy-paste 模式） | 原生观感、跨平台一致；react-desktop 已死、NextUI 停更，不选 |
| 原生毛玻璃 | Electron `vibrancy`(mac) / `backgroundMaterial`(win) | 原生系统提供，非 CSS 模拟 |
| 标题栏 | mac: `titleBarStyle:'hiddenInset'` + `vibrancy:'under-window'`<br>win: `titleBarStyle:'hidden'` + `titleBarOverlay:true` + `backgroundMaterial:'mica'` | 2026 官方标准，保留原生系统按钮 |
| 状态 | **zustand v5 + immer v11** | 轻量、活跃 |
| 表单 | **react-hook-form v7 + zod v4** | 主流、活跃 |
| 拖拽 | **@dnd-kit/core** | 无更好替代，功能仍可用（接受发布停滞风险） |
| 树形 | **react-arborist** | 2026-07 仍活跃，虚拟化+拖拽内置 |
| 虚拟化 | @tanstack/react-virtual | 极活跃，列表场景备用 |
| 模糊搜索 | fuse.js | 离线轻量 |
| 文本 diff | diff-match-patch | 版本管理文本差异 |
| ID 生成 | ulid | 时间有序，便于排序 |
| Token 计数 | gpt-tokenizer | 快速 |
| 路径别名 | @shared / @electron / @renderer | 三进程隔离清晰 |

### OpenAI 图像 API 现状（2026-07）
- 当前推荐模型 **`gpt-image-2`**（已发布）；端点 `/v1/images/generations` 仍是推荐
- 返回 `b64_json` 未变；参数 `prompt/size/quality/n` 未变，但参数集扩展：新增 `stream`/`background`/`moderation`/`partial_images`
- size 取值扩展至 3840px 级（`1024x1024` / `1536x1024` / `1024x1536` / `2048x2048` / `auto` 等）
- **Provider 抽象层应零改动支持新模型**——只改 `model` 字符串即可

---

## 4. 调研变更记录（相对原始调研文档）

1. 原文档"未确认 gpt-image-2" → **确认已发布**，默认 model 字符串改 `gpt-image-2`
2. 原文档推荐 `nodejieba` → **改 `@node-rs/jieba`**（napi-rs 生态对 Electron 更友好，无需 C++ 工具链）
3. 原文档未提 safeStorage 异步 API → 骨架用 **异步 API**（`encryptStringAsync`/`decryptStringAsync`），同步 API 未来可能弃用
4. 原文档"tailwindcss + @radix-ui 主题" → 明确为 **Tailwind v4 + Radix primitives + shadcn/ui copy-paste 模式**
5. 原文档未提 Windows `backgroundMaterial: 'mica'` 与 mac `vibrancy: 'under-window'` 组合 → 骨架窗口配置补全

---

## 5. 架构原则（不可妥协）

1. **`contextIsolation: true` + `nodeIntegration: false`** —— 防止渲染进程 XSS 直接拿到 Node 能力
2. **密钥不进渲染进程** —— 明文 API key 只在主进程内存短暂存在，渲染进程用完即清，永不长期保存
3. **SQLite 只在主进程操作** —— 渲染进程通过 IPC 查询，不直连 DB
4. **所有跨进程调用走 IPC** —— 经 preload `contextBridge` 暴露的类型安全 API
5. **不内置任何中转站域名** —— App 保持 provider 无关，用户自配后端，规避合规风险
6. **不打包 API key 到代码/构建产物** —— 密钥用 safeStorage 加密存于本地

---

## 6. 相关文档索引

- [01-architecture.md](01-architecture.md) —— 进程划分、IPC 数据流、安全边界
- [02-data-model.md](02-data-model.md) —— DB schema、三层数据模型、迁移机制
- [03-prompt-library.md](03-prompt-library.md) —— 提示词库规格（落地页，MVP 第一段）
- [04-composition-engine.md](04-composition-engine.md) —— 组合引擎规格（MVP 第二段）
- [05-image-generation.md](05-image-generation.md) —— 生图调用、Provider、密钥、重试
- [06-ui-design-system.md](06-ui-design-system.md) —— 原生风视觉规范、组件规格
- [07-ipc-contracts.md](07-ipc-contracts.md) —— IPC 通道契约（类型驱动）
- [08-file-structure.md](08-file-structure.md) —— 文件结构与模块边界
- [09-development-roadmap.md](09-development-roadmap.md) —— 开发路线图、子代理任务拆分
