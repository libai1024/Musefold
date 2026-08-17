# 03 · 数据模型与存储

## 数据库

| 数据域 | 文件 | 内容 |
| --- | --- | --- |
| 主库 | `musefold-data-v0.3.0.db` | 提示词、标签、文件夹、Provider 元数据、历史、工作台会话、运行和资产 |
| 设计方案库 | `musefold-design-scheme-v0.3.2.db` | 方案、revision、来源快照、试运行、评估、封面和资产 |

密钥只在系统安全存储中。数据库只保存脱敏状态和 Provider 配置。

## 主库 v15

- `prompts`、`prompts_fts`、`folders`、`tags`、`prompt_tags`、`smart_sets`。
- `providers`、`provider_pricing`、`automation_audit`。
- `history`、`history_prompt_references`。
- `workbench_sessions`、`generation_runs`、`generated_assets`。

`generation_runs.run_kind` 只允许 `free_generation | refinement | retry`。`prompts` 和 `history` 已移除旧 Recipe 外键及快照列。历史仍保留实际发送的 prompt、Provider/model、参数、状态、成本、耗时和图片路径。

## 旧库退役

`packages/core/src/db/index.ts` 执行一次性退役：

1. 打开旧 `musefold-recipe-data-v0.3.0.db`。
2. 只迁移通用 `workbench_sessions`、非 Recipe `generation_runs` 和对应 `generated_assets`。
3. 不迁移 Recipe、revision、material、authoring/use session 或相关运行。
4. 事务成功后删除 `.db`、`-wal` 和 `-shm`。
5. 将遗留的 queued/running 通用运行收敛为 `failed/INTERRUPTED`。

保护性测试位于 `packages/core/src/db/migrations/__tests__/remove-recipes.test.ts`。

## 设计方案库

设计方案是独立 revision 聚合，包含方案文档、输入定义、来源 commit/file 快照、run、evaluation 和 asset。其 schema 和迁移在 `packages/core/src/db/design-scheme/*`，结构契约在 `shared/design-scheme/*`。

## 文件与导入导出

- 图片输出在受管 `Pictures/Musefold/...` 目录。
- 预览、备份、日志和设计方案来源快照有独立白名单目录。
- 主数据导出不包含密钥。设计方案通过自身包格式导入导出。
