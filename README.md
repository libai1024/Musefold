# Musefold / 未像

> 让灵感成为图像。

Musefold 是面向个人创作者的 AI 生图与提示词管理产品。当前桌面端版本为 `0.5.0-dev`；v1.1 正在增加支持手机浏览器的 Web 产品面。

## 开发

```bash
npm install
npm run dev
```

从开发环境切回已安装的正式版前，停止当前仓库启动的桌面/Web 开发进程：

```bash
npm run dev:stop
```

该命令只匹配当前仓库路径下的 Electron、Vite、esbuild、`release/` 测试 App、开发 CLI 守护和 MCP 进程，不会结束 `/Applications/Musefold.app`。需要先检查目标时使用 `npm run dev:stop -- --dry-run`。当前支持 macOS/Linux；它只清理进程，不删除构建产物或用户数据。

Web v1.1 开发预览：

```bash
npm run dev:web
npm run check:v1.1
```

常用门禁：

```bash
npm run check                 # lint、边界、typecheck、单测、双端 build
npm run check:v1.1            # Web 共享 UI 与生产边界
npm run release:preflight     # 本地发布预检（不替代签名/远端 CI/真机）
npm run clean:artifacts -- --build
```

所有包含 App 源码的提交必须写 `Skill-Impact` trailer，明确记录官方 Agent Skill 是否需要同步更新。本地 hook 和 GitHub Actions 都会强制校验；格式、判定范围和示例见 [开发提交规范](CONTRIBUTING.md)。首次拉取或旧工作树执行 `npm install` 或 `npm run hooks:install` 启用 hook。

桌面端使用 Electron、React、TypeScript、SQLite 和 Zustand。账号模式通过 Musefold Cloud 托管文本与生图模型；自备 Provider 的 API Key 只由 Electron 主进程通过系统安全存储管理，不写入 SQLite、日志或导出文件。

## 文档

- [文档总入口](docs/README.md)
- [Musefold Agent Skills](https://github.com/libai1024/Musefold-Skills)
- [v1.3 双端收敛](docs/v1.3/README.md)（当前渲染层分层基线）
- [v1.2.2 系统架构重构](docs/v1.2.2/README.md)
- [v1.2.1 CI/CD 与持续交付](docs/v1.2.1/README.md)
- [v1.1 Web 架构与开发文档](docs/v1.1/V11-WEB-ARCHITECTURE.md)
- [当前桌面端代码手册](doc/v1.0/README.md)
- [v0.5 账号与云通道](docs/v0.5/README.md)
- [v0.4 CLI/MCP/Automation](docs/v0.4/README.md)
- [桌面产品规格](docs/product/README.md)

## 构建

```bash
npm run package:mac
npm run package:win
```

构建结果写入 `release/`，该目录不进入 Git。公开分发前仍需在对应平台完成代码签名、公证和安装态测试。

## CLI 安装

正式版内置 `musefold` CLI，不依赖系统 Node.js，也不要求管理员权限：

- macOS DMG 本身只负责拖拽安装；首次从 `/Applications` 或 `~/Applications` 启动 App 时，自动把 shim 写入 `~/.local/bin`，并为当前 zsh、bash 或 fish 配置可逆的 PATH 标记块。
- Windows NSIS 安装阶段自动写入 `%USERPROFILE%\.musefold\bin\musefold.cmd` 和 HKCU 用户 PATH；首次启动还会幂等修复缺失或过期的 shim。
- 已打开的终端或 Agent 不会收到新的环境变量，安装后需重新启动。设置 → 自动化保留“修复安装/移除”入口。
