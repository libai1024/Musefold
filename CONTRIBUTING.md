# Musefold 开发提交规范

## Skill 影响强制审查

任何包含 App 源码的 Git 提交，都必须判断是否需要同步更新官方 Musefold Agent Skill。源码范围包括 `apps/`、`electron/`、`packages/`、`preview/`、`resources/`、`scripts/`、`shared/`、`src/`、`website/Musefold/` 以及根目录构建、依赖和 TypeScript 配置。

提交消息必须且只能包含一个 `Skill-Impact` trailer：

```text
Skill-Impact: none - 仅调整工作台布局，不改变 CLI、MCP 或自动化行为
```

或者：

```text
Skill-Impact: updated - v0.4.1
```

- `none` 必须写具体理由，表示已经核对 MCP 工具、CLI 命令和参数、Automation API、capabilities、成本单位、授权语义、安装更新行为及兼容回退，确认 Skill 无需变化。
- `updated` 表示已按 `Musefold-Skills/SKILL-UPDATE-SPEC.md` 发布对应版本，并在同一 App 提交中同步 `website/Musefold/skills/musefold/` 与 `shared/constants.ts`。
- 修改内置 Skill 或版本常量时禁止声明 `none`。
- 文档、测试或 CI-only 提交没有 App 源码时可不写 trailer；只要同一提交含源码就必须写。

示例：

```bash
git commit -m "feat: add automation capability" \
  -m "Skill-Impact: updated - v0.4.1"

git commit -m "fix: align workbench spacing" \
  -m "Skill-Impact: none - 仅修改渲染层样式，不改变 Agent 可调用能力"
```

`npm install` 会通过 `prepare` 自动设置 `core.hooksPath=.githooks`。已有工作树可手动执行：

```bash
npm run hooks:install
```

本地 `commit-msg` hook 会阻止缺少决策、格式错误或伪造版本同步的源码提交。GitHub Actions 会对 push/PR 的完整提交范围再次运行相同检查，因此 `git commit --no-verify` 不能绕过远端门禁。

手动复核最近提交或指定范围：

```bash
npm run skill:check
npm run skill:check -- --range <base>..HEAD
```

完整 Skill 版本、发布、兼容和回滚规则见 [Musefold Skill 更新规范](https://github.com/libai1024/Musefold-Skills/blob/main/SKILL-UPDATE-SPEC.md)。
