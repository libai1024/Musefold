# 生产部署脚本

v1.1 的 `deploy:prod` / `deploy:rollback` 流水线（`run.mjs`、`rollback.mjs`、`state.mjs`、`web-release.mjs`、`infra-guard.mjs`、`bootstrap-runner.sh` 及对应 npm 入口）已于 v2.5.1 退役删除：其依赖的 `infra/v1.1` 与 `apps/web` 均已不存在，脚本不可用。需要时从 git 历史找回（v2.5.1 退役提交之前的版本）。

当前目录仍在使用：

```text
scripts/deploy/
  v25-plan.mjs           # v2.5 部署计划(deploy:v25:plan);只生成计划,发布需授权
  publish-desktop.mjs    # 桌面安装包发布(deploy:desktop)
  marketing-site.mjs     # 官网/下载服务同步(供 publish-desktop 使用)
  expand-contract.mjs    # PG 迁移 expand/contract 纪律 lint(独立工具)
```

v2.5 部署流程见 [V25-README.md](./V25-README.md)；退役守卫测试见 `tests/repo/deploy-pipeline.test.ts`。
