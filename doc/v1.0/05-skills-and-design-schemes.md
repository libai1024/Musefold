# 05 · Skill 与设计方案

## 模型边界

桌面端只保留两种复用机制：

- **GitHub Skill Runtime**：一次性读取公开仓库、固定 commit，交给 Agent 理解并在工作台执行。
- **设计方案**：可持久化、可版本化、可试运行和正式化的视觉方法。

旧 Recipe 模型不是设计方案的别名，也不再作为兼容 API 存在。

## GitHub Skill Runtime

1. 用户粘贴公开 GitHub URL。
2. `shared/skill-scanner.ts` 和 `electron/main/skill-import/*` 读取并限制文件。
3. 来源被固定到 commit，文本和元数据建立内容快照。
4. `skillRuntime.prepareGithub` 准备执行上下文。
5. `skillRuntime.execute` 调度 Agent 和统一生图服务。

仓库中的脚本、HTML 或指令不获得本机执行权。只有应用实现的明确工具边界可用。

## 设计方案

设计方案文档由 `shared/design-scheme/schema.ts` 校验，包含视觉规则、可填输入、参考资产、检查项和来源事实。

```text
source/idea
  → analysis
  → compiled draft
  → trial run + evaluation
  → formalized revision
  → modify / working draft / promote
```

当前支持：创建、取消、试运行、选封面、正式化、重命名、删除、输入编辑、修改、提升工作草稿、更新检查、市场搜索、导入和导出。

## 代码位置

- `src/features/generation/skill-runtime-store.ts`
- `src/features/design-schemes/*`
- `electron/main/skill-import/*`
- `electron/main/ipc/skill-runtime.ts`
- `electron/main/design-scheme/*`
- `electron/main/ipc/design-scheme.ts`
- `shared/types/skill-runtime.ts`
- `shared/design-scheme/*`
- `packages/core/src/db/design-scheme/*`
