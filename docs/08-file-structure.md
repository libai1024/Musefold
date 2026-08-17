# 08 · 文件结构与模块边界

> vibe coding 友好的目录约定：每个模块有独立规格 doc + 清晰边界 + 共享类型契约，子代理读一份 doc + 对应目录即可独立开发。

---

## 1. 文件树

```
PromptForge/
├── docs/                          # 设计规格（子代理蓝图，读一份即开工）
│   ├── 00-overview.md
│   ├── 01-architecture.md
│   ├── 02-data-model.md
│   ├── 03-prompt-library.md
│   ├── 04-composition-engine.md
│   ├── 05-image-generation.md
│   ├── 06-ui-design-system.md
│   ├── 07-ipc-contracts.md
│   ├── 08-file-structure.md       ← 本文件
│   └── 09-development-roadmap.md
├── shared/                        # 契约层：类型 + 常量，无运行时逻辑
│   ├── types/
│   │   ├── ipc.ts                 # IPC 通道名 + 请求/响应类型（07 doc 代码化）
│   │   ├── models.ts              # Prompt/Fragment/Template/Composition/History
│   │   ├── providers.ts           # ImageProvider 接口、Request/Result
│   │   └── enums.ts               # PromptTarget/FragmentType/TagGroup 枚举
│   └── constants.ts               # 路径常量、默认值、枚举字面量
├── electron/                      # 主进程
│   ├── main/
│   │   ├── index.ts               # 入口：app.whenReady、createWindow
│   │   ├── window.ts              # 窗口配置（titleBar/vibrancy/Mica）
│   │   └── ipc/
│   │       ├── index.ts           # 注册所有 handler
│   │       ├── prompts.ts
│   │       ├── folders.ts
│   │       ├── tags.ts
│   │       ├── fragments.ts
│   │       ├── templates.ts
│   │       ├── compositions.ts
│   │       ├── providers.ts
│   │       ├── images.ts
│   │       └── history.ts
│   ├── preload/
│   │   └── index.ts               # contextBridge 暴露 window.api
│   ├── db/
│   │   ├── index.ts               # 连接、WAL、pragma
│   │   ├── schema.ts              # 建表 DDL
│   │   ├── migrations/
│   │   │   └── 0001_initial.ts
│   │   └── repositories/          # 按表分文件
│   │       ├── prompts.ts
│   │       ├── folders.ts
│   │       ├── tags.ts
│   │       ├── fragments.ts
│   │       ├── templates.ts
│   │       └── compositions.ts
│   ├── providers/                 # 生图 Provider
│   │   ├── base.ts                # ImageProvider 抽象基类
│   │   ├── openai-compatible.ts   # OpenAICompatibleProvider
│   │   ├── retry.ts               # 指数退避
│   │   └── registry.ts            # 工厂 + 注册表
│   ├── security/
│   │   └── keychain.ts            # safeStorage 异步 API 封装
│   └── system/
│       ├── paths.ts               # userData / Pictures 路径
│       └── migrations.ts          # user_version 迁移调度
├── src/                           # 渲染进程
│   ├── main.tsx                   # React 入口
│   ├── App.tsx                    # 路由 + 三栏布局
│   ├── pages/
│   │   ├── LibraryPage.tsx
│   │   ├── ComposerPage.tsx
│   │   └── HistoryPage.tsx
│   ├── features/                  # 按业务域（子代理开发单元）
│   │   ├── library/
│   │   │   ├── components/
│   │   │   ├── hooks/
│   │   │   └── store.ts
│   │   ├── composer/
│   │   │   ├── components/
│   │   │   ├── engine/            # 纯逻辑（可独立单测）
│   │   │   │   ├── parser.ts
│   │   │   │   ├── renderer.ts
│   │   │   │   ├── serializer.ts
│   │   │   │   └── tokenizer.ts
│   │   │   └── store.ts
│   │   ├── generation/
│   │   │   ├── components/
│   │   │   └── store.ts
│   │   └── history/
│   │       ├── components/
│   │       └── store.ts
│   ├── components/
│   │   ├── ui/                    # shadcn 基础组件
│   │   └── layout/
│   │       ├── TitleBar.tsx
│   │       ├── Sidebar.tsx
│   │       └── AppShell.tsx
│   ├── stores/
│   │   └── app.ts                 # 全局状态
│   ├── lib/
│   │   ├── ipc.ts                 # window.api 类型安全封装
│   │   ├── utils.ts               # cn() 等
│   │   └── format.ts              # 时间/成本格式化
│   ├── styles/
│   │   └── globals.css            # Tailwind + CSS 变量
│   └── assets/
├── resources/
│   ├── icon.icns / icon.ico
│   └── builtin/
│       └── fragments.json         # 内置 Fragment 库（第二段填充）
├── package.json
├── electron.vite.config.ts
├── tsconfig.json / tsconfig.node.json / tsconfig.web.json
├── tailwind.config.ts
├── postcss.config.js
├── electron-builder.yml
├── .gitignore
└── README.md
```

---

## 2. 模块边界与依赖方向

```
                    shared (契约层)
                   ↑              ↑
          electron/main          src/renderer
            ↑                        ↑
        preload  ←──── contextBridge ──→ window.api
```

**依赖规则**（禁止逆向）：
- `shared/` 不依赖 `electron/` 或 `src/`
- `electron/` 依赖 `shared/`，不依赖 `src/`
- `src/` 依赖 `shared/`，通过 preload 暴露的 `window.api` 与主进程通信，不直接依赖 `electron/`
- `preload` 是主进程侧最后一层，只做转发，无业务逻辑

---

## 3. 子代理开发单元划分

每个单元 = 一个 feature 目录 + 对应 doc + 对应 ipc handler + 对应 repository。子代理认领一个单元即可独立开发。

| 单元 | doc | feature 目录 | ipc handler | repository |
|---|---|---|---|---|
| 提示词库 | 03 | `src/features/library/` | `ipc/prompts.ts` | `repositories/prompts.ts` |
| 文件夹标签 | 03 | `src/features/library/`（侧栏部分） | `ipc/folders.ts` + `ipc/tags.ts` | `repositories/folders.ts` + `tags.ts` |
| 组合引擎 | 04 | `src/features/composer/engine/` | —（纯逻辑，无 IPC） | — |
| 组合 UI | 04 | `src/features/composer/components/` | `ipc/fragments.ts` + `templates.ts` + `compositions.ts` | 三个 repository |
| 生图 | 05 | `src/features/generation/` | `ipc/images.ts` + `providers.ts` | — |
| 历史 | 05 | `src/features/history/` | `ipc/history.ts` | — |

---

## 4. 约定

1. **先读 doc 再写代码**：每个单元的 doc 是规格，实现要符合 doc 中的字段、交互、验收标准
2. **类型契约先行**：`shared/types/` 已完整定义，实现时引用，不自行定义重复类型
3. **IPC 一一对应**：每加一个 IPC 通道，同步更新 `shared/types/ipc.ts` + `preload/index.ts` + `ipc/<域>.ts`
4. **repository 按表分文件**：一个表一个 repository 类，方法签名完整，不跨表耦合
5. **纯逻辑优先**：`composer/engine/` 不依赖 Electron/React，可独立单测，最易开发与验证
6. **UI 组件复用**：用 `components/ui/` 的 shadcn 基础组件，不重复造轮子
