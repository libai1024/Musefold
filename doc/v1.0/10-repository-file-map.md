# 10 · 仓库文件地图

| 目录 | 责任 |
| --- | --- |
| `src/` | React 桌面 Renderer、页面、store 和组件 |
| `src/features/generation/` | 生图工作台、参考图、Skill Runtime 和微调 |
| `src/features/design-schemes/` | 设计方案中心、创建、运行和维护 UI |
| `src/features/library/` | 提示词库 |
| `src/features/history/` | 生成历史与成本 |
| `src/features/settings/` | 设置、账号/Provider/Agent 模型和数据管理 |
| `electron/main/` | Electron 宿主、IPC、OS、账号、Skill 和设计方案编排 |
| `electron/main/integration.ts` | CLI/MCP/Agent 接入检测、用户级 CLI 自动安装、修复与卸载 |
| `electron/main/integration-cli-path.ts` | zsh/bash/fish PATH 标记块的纯函数与可逆更新规则 |
| `electron/preload/` | typed context bridge |
| `shared/` | 跨层类型、Schema、错误码和纯逻辑 |
| `shared/design-scheme/` | 设计方案文档、编译和 Agent 交换契约 |
| `packages/core/` | 主库、设计方案库、Provider、generation 和业务服务 |
| `packages/automation-server/` | 本地 HTTP 控制面 |
| `packages/client/` | Automation API 客户端 |
| `packages/cli/` | `musefold` CLI |
| `packages/mcp/` | MCP stdio 适配器 |
| `packages/domain/` | 跨宿主 capability 描述 |
| `apps/web/` | v1.1 Web 前端 |
| `packages/contracts/` | 桌面/Web 共用契约 |
| `tests/e2e/` | Electron E2E |
| `tests/package/` | macOS/Windows 安装态冒烟测试 |
| `website/Musefold/` | 官网与公开 Skill |

## 所有权规则

- 数据库变更必须进入 `packages/core/src/db/migrations` 并有迁移测试。
- 新 IPC 先更新 `shared/types/ipc.ts`，再实现 main/preload/renderer。
- 新生图入口必须复用 Core generation。
- 新结构化视觉方法必须扩展 design-scheme，不得新建并行模型或专用数据库。
