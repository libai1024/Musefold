# Musefold / 未像

> 让灵感成为图像。

Musefold 是面向个人创作者的 AI 生图与提示词管理产品。v2.5 起「一次开发,四端复用」:同一套页面模块(`packages/features` + `packages/ui`)交付 Windows / macOS 桌面(Electron)与 PC / Mobile Web(Next.js)。当前桌面版本 `2.5.0`。

## 开发

```bash
pnpm install
pnpm run dev        # 桌面(Electron)
pnpm run dev:web    # Web(Next.js)
```

后端(账号/云同步/生图队列)本地栈:

```bash
pnpm run dev:infra   # PostgreSQL + MinIO(docker compose)
pnpm run dev:api     # Hono API
pnpm run dev:worker  # graphile-worker 生图消费者
```

从开发环境切回已安装的正式版前,停止当前仓库启动的开发进程:

```bash
pnpm run dev:stop
```

该命令只匹配当前仓库路径下的进程,不会结束 `/Applications/Musefold.app`。加 `--dry-run` 可先检查目标。

常用门禁:

```bash
pnpm run check       # Biome lint、typecheck、单测、双端 build、depcruise 边界
pnpm run test:e2e    # Playwright:web(桌面/移动视口)+ Electron,含视觉快照
```

技术栈:Electron 43、Next.js 16、React 19、shadcn/ui + Tailwind v4、TanStack Query、zod、Hono、Drizzle(SQLite + PostgreSQL)、Better Auth(凭据委托 New API)、pnpm + Turborepo、Biome、Vitest + Playwright。自备 Provider 的 API Key 只由 Electron 主进程经系统安全存储管理,不写入 SQLite、日志或导出文件。

## 文档

- [文档总入口](docs/README.md)(含权威顺序)
- [v2.5 全栈架构与 UI 规范](docs/v2.5/README.md)(当前基线)
- [AI 代理开发约束](AGENTS.md)
- [Musefold Agent Skills](https://github.com/libai1024/Musefold-Skills)
- [v0.4 CLI/MCP/Automation](docs/v0.4/README.md)
- [桌面产品规格](docs/product/README.md)

## 构建与发布

```bash
pnpm run package:mac         # 需签名证书;无证书用 package:mac:adhoc
pnpm run package:win
```

构建结果写入 `release/`,不进 Git。正式发布由 `vX.Y.Z` tag 触发 `release.yml` 矩阵:双平台打包 + Playwright 打包冒烟 + 更新 feed 发布 + GitHub Release。版本记录用 Changesets(`pnpm exec changeset`)。

## CLI 安装

正式版内置 `musefold` CLI,不依赖系统 Node.js,也不要求管理员权限:

- macOS 首次从 `/Applications` 或 `~/Applications` 启动 App 时,自动把 shim 写入 `~/.local/bin`,并为当前 zsh、bash 或 fish 配置可逆的 PATH 标记块。
- Windows NSIS 安装阶段自动写入 `%USERPROFILE%\.musefold\bin\musefold.cmd` 和 HKCU 用户 PATH;首次启动幂等修复缺失或过期的 shim。
- 已打开的终端或 Agent 不会收到新的环境变量,安装后需重新启动。
