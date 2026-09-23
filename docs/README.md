# Musefold 文档

## 当前开发基线

| 文档 | 作用 |
|---|---|
| [AI 代理开发约束](../AGENTS.md) | 根入口:项目地图、命令矩阵、全局红线;`apps/desktop`、`packages` 各有就近约束 |
| [v2.5 全栈重做](v2.5/README.md) | **当前基线(已实施)**:Next.js 16 / shadcn/ui / Hono / Drizzle / pnpm / Biome,一套 features 包复用四个交付面;含架构、交付计划、数据迁移与 **UI 规范(V25-UI-SPEC,渲染层唯一基准)** |
| [v2.5.1 收口补丁](v2.5.1/README.md) | **规划(未实施)**:v2.5 未完成项清单、阻断顺序与验收定义;只是清单,不是新规范,不改变下方权威顺序 |

## 历史版本文档(仅作追溯,与 v2.5 冲突时一律以 v2.5 为准)

| 文档 | 内容 |
|---|---|
| [v2.1 双端一致迁移](v2.1/README.md) | 已终止(被 v2.5 接替);其六条产品/安全语义由 v2.5 继承 |
| [v1.4 视觉切割](v1.4/README.md) / [v1.3 双端收敛](v1.3/README.md) / [v1.2.2 架构重构](v1.2.2/README.md) / [v1.2.1 CI/CD](v1.2.1/README.md) / [v1.1 Web](v1.1/README.md) | 旧渲染层与旧基建的设计记录 |
| [前端开发规范](frontend/DEVELOPMENT-GUIDE.md) | 旧渲染层分层规范,已被 V25-UI-SPEC 接替 |
| [桌面端代码手册](../doc/v1.0/README.md) | v1.0 桌面实现、模块地图与契约 |
| [v0.5 账号与云通道](v0.5/README.md) | 旧账号体系(托管 Provider 等);v2.5 账号见 V25-ARCHITECTURE |
| [v0.4 CLI/MCP/Automation](v0.4/README.md) | 本地控制面、CLI、MCP 和安全边界(该能力面仍活跃,专题规格仍有效) |
| [桌面产品规格](product/README.md) | 提示词库、创作台、历史、设置的产品语义(交互规格已被 V25-UI-SPEC 接替) |

## 长期有效的专题资料

- `00-overview.md` 至 `11-ai-tvt-wiki-api.md`:v1.0 桌面基础调研与 Provider 参考(IPC/UI 章节已过期)。
- `v0.2/DEVELOPMENT-RULES.md`:Local-first、单一状态源和安全开发原则(理念仍有效)。
- `v0.3/`、`v0.3.2/`、`v0.3.3/`:品牌、多图/精修、Agent/方案规格。
- `v3.1/`:Skills 加载与调用研究。

## 权威顺序

发生冲突时按以下顺序判断:

1. 当前源码、数据库迁移和自动化测试。
2. `docs/v2.5` 四份文档(架构 / 交付计划 / 数据迁移 / UI 规范)——当前唯一基线。
3. `docs/v0.4`(CLI/MCP/Automation 专题)与 `docs/product`(产品语义,交互细节除外)。
4. 其余版本目录仅作历史追溯,不用于裁决现状。

版本控制历史承担旧设计和旧发布记录的追溯职责。仓库不再保存一次性交接稿、进度快照、安装包、外部网页镜像和 API 调研输出图。
