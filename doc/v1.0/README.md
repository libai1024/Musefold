# Musefold v1.0 项目交接文档

## 文档定位

本目录描述 2026-08-17 的当前代码。产品包版本为 `0.5.0-dev`，分支为 `v0.4-dev`。

| 项目 | 当前事实 |
| --- | --- |
| 桌面架构 | Electron Main + Preload + React Renderer + Core + Automation API |
| 数据库 | 主 SQLite + 设计方案 SQLite |
| 密钥 | 系统 keychain/safeStorage，不进 Renderer 或 SQLite |
| 复用模型 | 提示词库、设计方案、直接 GitHub Skill 运行 |
| 自动化 | 本地 HTTP API、CLI、MCP，共用 Core 和生图服务 |

桌面端旧 Recipe 产品面、IPC、CLI/MCP 工具和专用数据库已移除。启动升级时只会把旧库里的通用工作台会话、非 Recipe 运行和对应资产迁入主库，然后删除旧库。

## 阅读顺序

1. [产品与能力地图](./01-product-and-capability-map.md)
2. [系统架构](./02-system-architecture.md)
3. [数据模型与存储](./03-data-model-and-storage.md)
4. [生图与 Provider](./04-generation-and-provider.md)
5. [Skill 与设计方案](./05-skills-and-design-schemes.md)
6. [Automation、CLI 与 MCP](./06-automation-cli-mcp.md)
7. [IPC 与 Renderer](./07-ipc-and-renderer.md)
8. [安全、运维与验证](./08-security-operations-testing.md)
9. [交接清单](./09-handoff-checklist-and-known-gaps.md)
10. [仓库文件地图](./10-repository-file-map.md)
11. [契约与错误码](./11-contracts-and-error-catalog.md)

## 证据优先级

1. 当前源码、数据库迁移和 `shared` 契约。
2. 自动化测试与安装包验收。
3. 本目录文档。
4. `docs/v0.*` 历史文档，仅用于追溯。

文档与代码冲突时以当前代码和迁移测试为准。
