# Musefold v1.1

v1.1 是面向个人用户的 Web 产品面，支持手机浏览器；桌面端继续维护完整能力。

## 文档

- [Web 版总体架构](./V11-WEB-ARCHITECTURE.md)
- [技术选型与架构决策](./V11-TECHNOLOGY-DECISIONS.md)
- [Web 后端 MVP 实施规格](./V11-WEB-BACKEND-MVP.md)
- [提示词云同步协议](./V11-PROMPT-CLOUD-SYNC.md)
- [云端 MCP 与 Skills](./V11-CLOUD-MCP-AND-SKILLS.md)
- [Desktop/Web 共享 UI 架构](./V11-SHARED-UI-ARCHITECTURE.md)
- [Web 后端交付计划](./V11-BACKEND-DELIVERY-PLAN.md)

## 当前状态

- 已完成：现有桌面端边界回顾、共享代码判断、成熟架构调研、Web v1.1 架构基线。
- Phase 0 已落地：`@musefold/contracts`、`@musefold/domain`、Web capability manifest、Web Vite/React 工作区和开发态 API 夹具。
- 已验证：共享类型检查与单测、Web 生产构建、桌面/手机浏览器核心生成流程、无水平溢出、手机 44px 触控门槛。
- 已冻结首版：Web 制作工作台、生成历史、云端提示词库、桌面/Web 提示词双向同步和账号授权的 Cloud MCP 均进入 P0；参考图仍为后续能力。
- 已冻结后端：Node.js 24 + Fastify 5 + Zod/OpenAPI + PostgreSQL 16/Kysely + Graphile Worker + 外部 S3-compatible object storage；Musefold P0 不依赖 Redis。
- 已冻结云端 MCP：以 Fastify 模块挂载在 Web API，同进程复用 application services；达到文档中的独立扩容阈值后再拆服务。
- 已冻结 UI：Desktop/Web 共用产品组件、token 和交互状态机，仅平台 shell 与数据 adapter 分开。
- 下一阶段：按交付计划 M0 补齐契约，再建立 `apps/web-api`、数据库/RLS 和 HttpOnly 会话。

## 开发命令

```bash
npm run dev:web
npm run check:v1.1
npm run build:web
```

本地开发默认使用显式的 fixture gateway；生产构建使用 `/api/musefold/v1`，也可通过 `VITE_API_BASE_URL` 覆盖。夹具模式始终在界面显示“开发预览”，不能作为线上服务配置。
