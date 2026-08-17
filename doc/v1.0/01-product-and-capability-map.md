# 01 · 产品与能力地图

## 核心主线

Musefold 是本地优先的 AI 视觉创作工作台：

1. 从文本、提示词库、参考图、设计方案或 GitHub Skill 开始。
2. 在统一工作台选择模型、参数和参考资产。
3. 生成、比较、微调、重试，并将有效结果存回提示词库。
4. 使用 CLI/MCP 把同一条生图链路开放给本机 Agent。

## 桌面页面

| ViewKey | 用途 |
| --- | --- |
| `generate` | 对话式生图、参考图、Skill 运行、设计方案运行和微调 |
| `library` | 提示词搜索、编辑、分类、评分、回收站和复用 |
| `design-schemes` | 设计方案创建、试运行、正式化、修改、导入导出和更新检查 |
| `history` | 生成事实、成本、错误、文件操作和再次制作 |
| `settings` | 账号、Provider、Agent 模型、默认生成参数、Automation 和数据管理 |

## 能力边界

- 提示词是可搜索、可编辑的内容资产。
- 设计方案是唯一的结构化复用和版本化方法模型。
- GitHub Skill 可在工作台直接准备和执行；仓库脚本不会被执行。
- 生图、Skill 和设计方案运行都可产生真实费用，必须经过用户明确动作或自动化预算授权。
- 应用不再暴露 Recipe 路由、数据、IPC、CLI 命令或 MCP 工具。

## 主要源码

- `src/features/generation/*`
- `src/features/design-schemes/*`
- `src/features/library/*`
- `src/features/history/*`
- `src/features/settings/*`
- `packages/core/src/*`
- `packages/automation-server/src/*`
- `packages/cli/src/*`
- `packages/mcp/src/*`
