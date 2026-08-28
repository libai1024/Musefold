# Musefold 开发提交规范

## 提交格式

```text
type(scope): subject
```

- `type`:`feat` / `fix` / `chore` / `docs` / `refactor` / `test` / `perf`。
- `scope`:改动主体(如 `desktop`、`api`、`features`、`repo`),可省略。
- 一个提交做一件事;含 App 源码的提交交付前必须 `pnpm run check` 全绿。

## 版本与发布

- 版本由 Changesets 管理(`pnpm exec changeset`),桌面 App 发布由手动 tag(`vX.Y.Z`)触发 `release.yml` 矩阵(macOS 签名/ad-hoc + Windows + 打包冒烟 + 发布站点)。
- 不要在功能提交里改 `apps/desktop/package.json` 的 `version`。

## Agent Skill 同步义务

改动影响 CLI / MCP / Automation API 对外能力(工具、命令、参数、capabilities、成本单位、授权语义、安装更新行为)时,提交者有义务同步官方 Musefold Agent Skill(仓库 [Musefold-Skills](https://github.com/libai1024/Musefold-Skills),规范见其 `SKILL-UPDATE-SPEC.md`)。

> 历史沿革:v2.5 之前该义务由 `commit-msg` hook + `Skill-Impact` trailer 机器强制;hook 已随 v2.5 退役,义务本身不变,由提交者自行判断执行。
