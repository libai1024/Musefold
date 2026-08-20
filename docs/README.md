# Musefold 文档

## 当前开发基线

| 文档 | 作用 |
|---|---|
| [v1.3 双端收敛索引](v1.3/README.md) | 实体类型统一、TanStack Query 状态分层、页面编排下沉 product-ui、巨型文件拆分与边界治理 |
| [前端开发规范](frontend/DEVELOPMENT-GUIDE.md) | 技术栈对照、目录与分层、实体/状态/表单/组件/样式/测试规范、端到端开发清单与红线 |
| [v1.2.2 系统架构重构索引](v1.2.2/README.md) | 双端 monorepo 目标结构、桌面 Gateway 抽象、技术栈重估和分阶段迁移计划 |
| [v1.2.1 CI/CD 文档索引](v1.2.1/README.md) | 持续交付分层、发布通道、三端热更新协议和交付计划 |
| [v1.1 Web 文档索引](v1.1/README.md) | Web/手机端、后端、同步、Cloud MCP、共享 UI 和交付计划 |
| [v1.1 技术选型 ADR](v1.1/V11-TECHNOLOGY-DECISIONS.md) | Node/Fastify/PostgreSQL/Graphile/MCP/OAuth/UI 的选型依据、评分和扩容阈值 |
| [桌面端代码手册](../doc/v1.0/README.md) | 当前桌面实现、模块地图、契约和已知风险 |
| [v0.5 账号与云通道](v0.5/README.md) | 账号、兑换、额度、托管 Provider 和服务器契约 |
| [v0.4 CLI/MCP/Automation](v0.4/README.md) | 本地控制面、CLI、MCP 和安全边界 |
| [桌面产品规格](product/README.md) | 提示词库、创作台、历史、设置和交互规格 |

## 长期有效的桌面规格

- `00-overview.md` 至 `11-ai-tvt-wiki-api.md`：桌面端基础架构、数据、IPC、UI 和 Provider 参考。
- `v0.2/DEVELOPMENT-RULES.md`：Local-first、单一状态源和安全开发规则。
- `v0.2/V02.2-UI-DEVELOPMENT-CONSTRAINTS.md`：桌面 UI 控件与图标约束。
- `v0.3/`、`v0.3.2/`、`v0.3.3/`：品牌、多图/精修、Agent/方案和朱点规格。
- `v3.1/`：Skills 加载与调用研究。

## 权威顺序

发生冲突时按以下顺序判断：

1. 当前源码、数据库迁移和自动化测试。
2. `docs/v1.3`（实体统一、状态分层与编排收敛，尚未实施）、`docs/v1.2.2`（仓库结构与共享层分层）、`docs/v1.2.1`（发布、CI/CD 与热更新）、`docs/v1.1`（Web）或 `doc/v1.0`（桌面）当前手册。目录结构以 `docs/v1.2.2` 为准，其中迁移未执行的部分以「当前路径」列为现状。
3. `docs/v0.5`、`docs/v0.4` 对应专题规格。
4. `docs/product` 和基础规格。

版本控制历史承担旧设计和旧发布记录的追溯职责。仓库不再保存一次性交接稿、进度快照、安装包、外部网页镜像和 API 调研输出图。
