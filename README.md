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
npm run typecheck
npm run test
npm run build
npm run build:web
npm run check
npm run clean:artifacts -- --build
```

桌面端使用 Electron、React、TypeScript、SQLite 和 Zustand。账号模式通过 Musefold Cloud 托管文本与生图模型；自备 Provider 的 API Key 只由 Electron 主进程通过系统安全存储管理，不写入 SQLite、日志或导出文件。

## 文档

- [文档总入口](docs/README.md)
- [Musefold Agent Skills](https://github.com/libai1024/Musefold-Skills)
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
