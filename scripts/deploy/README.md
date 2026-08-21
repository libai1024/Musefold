# 生产部署脚本

仓库侧入口。生产主机没有系统级 Node；GitHub Actions 的 `setup-node` 只装在 runner 工作目录。

```text
scripts/deploy/
  run.mjs                 # 合并到 main 后的自动部署
  rollback.mjs            # 一键回滚 Web symlink 与服务镜像
  web-release.mjs         # 相对 symlink、排除 ._*、保留 5 份
  bootstrap-runner.sh     # 一次性：部署用户 + runner 安装说明
```

## 自动触发

`CI` 在 `main` 的 **push** 上绿 → `Deploy production` 在标签 `musefold-prod` 的自托管 runner 上执行。

- 禁止 fork / pull_request
- 文档-only 与纯外壳层变更会跳过
- 镜像标签 = git sha；`latest` 只在 `/health/ready` 通过后作为别名

## 主机一次性

```bash
# as root on 45.207.211.136
bash /path/to/Musefold/scripts/deploy/bootstrap-runner.sh
# then register the runner (token from GitHub UI)
```

`.env.v11` 必须能被 `musefold-deploy`（docker 组）读取，并包含：

```text
MIGRATION_DATABASE_URL=postgres://musefold_migration:...@db:5432/musefold
WORKER_DATABASE_URL=postgres://musefold_worker:...@db:5432/musefold
APP_DB_PASSWORD=...
WORKER_DB_PASSWORD=...
```

## 手动回滚

```bash
node scripts/deploy/rollback.mjs --layers content,service
```

回滚读 `/opt/musefold/.deploy-state.json`，不重新构建。
