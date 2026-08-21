# v1.2.1 自动推送与部署：执行卡片

> **日期**：2026-08-21  
> **目标**：合并到 `main` 后，无需人工 rsync，Web SPA 与 Web API / Worker 自动上到 `https://zhaozhaoyue.top/`，并可一条命令回滚。  
> **不在本批**：桌面外壳签名/公证、对象存储/CDN、内容层热更新开关（仍受 `V121-CHAN-07` 与 M6 阻塞）。

权威拓扑见 [V121-CICD-ARCHITECTURE.md](./V121-CICD-ARCHITECTURE.md)。本文件把 M0 残留 + M2 + M3 拆成可执行卡片，并记录本轮仓库落地状态。

完成定义（本批）：

1. 仓库里有可测的部署脚本、相对 symlink、sha 镜像、迁移闸门、`/health/ready`、Caddy 重试、一键回滚。
2. `CI` 在 `main` 的 push 上绿之后，`Deploy production` 在 `musefold-prod` runner 上跑同一套脚本。
3. 生产机仍缺 runner 身份时，卡片标 **外部门禁**，不把「尚未实跑」写成已上线。

---

## 批次 A — 生产身份与 runner（M0 / M2 前置）

### V121-ENV-07 专用部署用户

| 项 | 内容 |
|---|---|
| 目的 | 停止以 `root` 部署 |
| 做法 | 生产机执行 `scripts/deploy/bootstrap-runner.sh`：创建 `musefold-deploy`，加入 `docker` 组，拥有 `site/`、`Caddyfile`、`docker-compose.yml`、`.deploy-state.json` 写权限；`.env.v11` 保持 `root:docker` `640` |
| 验收 | `id musefold-deploy` 含 `docker`；该用户能 `docker ps`；不能读其他用户家目录 |
| 状态 | **仓库已交付脚本**。生产机执行待 SSH + root。 |

### V121-ENV-08 / V121-SVC-09 基础设施入仓

| 项 | 内容 |
|---|---|
| 目的 | Caddyfile 与 compose 以仓库为事实源 |
| 做法 | 每次部署把 `infra/v1.1/Caddyfile` 覆盖到 `/opt/musefold/Caddyfile`，把 `infra/v1.1/remote-compose.yaml` 覆盖到 `/opt/musefold/remote-compose.yaml`。`docker-compose.yml` 是 Caddy/Postgres/new-api 宿主栈，**禁止覆盖**。compose 调用始终 `-f docker-compose.yml -f remote-compose.yaml`。旧文件进 `archive/` |
| 验收 | 线上文件与当前 sha 的仓库副本一致；手工改线上文件会在下次部署被覆盖 |
| 状态 | **仓库已落地**。 |

### V121-ENV-09 镜像按 sha 打标

| 项 | 内容 |
|---|---|
| 目的 | 可从运行中的容器反查提交 |
| 做法 | `musefold-v11:<gitSha>`；`latest` 仅在 `/health/ready` 通过后打别名。compose：`musefold-v11:${MUSEFOLD_IMAGE_TAG:-latest}` |
| 验收 | `docker inspect` 的 RepoTags 含完整 sha |
| 状态 | **仓库已落地**。 |

### V121-WEB-01 自托管 runner

| 项 | 内容 |
|---|---|
| 目的 | 部署发生在生产机，验证仍在 GitHub 托管 runner |
| 做法 | 标签 `musefold-prod`；以 `musefold-deploy` 跑；注册 token 只从 GitHub UI 现取 |
| 验收 | Actions 出现 `musefold-prod` Idle；`Deploy production` 不再一直 Queued |
| 状态 | **外部门禁**（需 GitHub runner 注册 token）。引导见 `scripts/deploy/bootstrap-runner.sh`。 |

### V121-WEB-02 runner 资源与触发面

| 项 | 内容 |
|---|---|
| 目的 | 构建不挤占线上；fork PR 不能写生产 |
| 做法 | systemd drop-in：`CPUQuota=400%`、`MemoryMax=4G`。workflow 只接受 `workflow_run` 且 `event == push` 到 `main`/`master`，或手动 `workflow_dispatch`。Docker build `--cpus 4 --memory 3g` |
| 验收 | fork PR 的 CI 绿不会触发本 job；runner 内存上限可在 `systemctl show` 看到 |
| 状态 | **workflow 已落地**；drop-in 随 runner 安装。 |

---

## 批次 B — Web 静态（M2）

### V121-WEB-03 相对 symlink 布局

| 项 | 内容 |
|---|---|
| 目的 | Caddy 容器内能解析 `app` |
| 做法 | `/opt/musefold/site/Musefold/app -> releases/<sha>`（相对）。若 `app/` 仍是 rsync 目录，先改名为 `releases/pre-symlink` 再链回去 |
| 验收 | `readlink app` 不以 `/` 开头；容器内 `ls /srv/musefold-site/Musefold/app/index.html` 成功 |
| 状态 | **已实现并单测**（含目录晋升、绝对链拒绝/改写）。 |

### V121-WEB-04 构建与落盘

| 项 | 内容 |
|---|---|
| 目的 | 宿主机无 Node 也能出 Web 产物 |
| 做法 | 复用 `infra/v1.1/Dockerfile` 的 `npm run build:web`，`docker cp` 出 `/app/apps/web/dist`，拷贝时丢弃 `._*` / `.DS_Store` |
| 验收 | 新目录有 `index.html` 与 `release-sha.txt`；无 `._*` |
| 状态 | **已实现**。 |

### V121-WEB-05 可达性与自动回滚

| 项 | 内容 |
|---|---|
| 目的 | 切错不把坏包留在线上 |
| 做法 | 拉取 `https://zhaozhaoyue.top/Musefold/app/release-sha.txt`，必须含本次 sha；失败则 symlink 指回 previous |
| 验收 | 人为放空 dist 时线上仍是上一版 |
| 状态 | **已实现并单测**。 |

### V121-WEB-06 保留 5 份 + 一键回滚

| 项 | 内容 |
|---|---|
| 目的 | 回滚不重新构建 |
| 做法 | 保留 5 个 release 目录；`npm run deploy:rollback -- --layers content` |
| 验收 | 回滚后 `release-sha.txt` 为 previous |
| 状态 | **已实现并单测**。 |

---

## 批次 C — 服务层（M3）

### V121-SVC-01 容器内构建

| 项 | 内容 |
|---|---|
| 目的 | 不在宿主机装 npm |
| 做法 | `docker build -f infra/v1.1/Dockerfile`；镜像纳入 `@musefold/generation-worker` |
| 验收 | 同一镜像 `command` 可跑 web-api 与 worker |
| 状态 | **Dockerfile 已改**。 |

### V121-SVC-02 迁移闸门

| 项 | 内容 |
|---|---|
| 目的 | 迁移失败时旧容器不动 |
| 做法 | `docker run --rm` 新镜像，先 `db:migrate`（`musefold_migration`）再 `queue:migrate`，最后 `compose up --force-recreate` |
| 验收 | 迁移失败时 `docker ps` 仍是旧 sha |
| 状态 | **已实现并单测顺序**。生产 `.env.v11` 必须有 `MIGRATION_DATABASE_URL`。 |

### V121-SVC-03 expand/contract 静态检查

| 项 | 内容 |
|---|---|
| 目的 | 同一迁移 `up()` 不得既写行又 `DROP COLUMN` |
| 做法 | CI 对变更的 `apps/web-api/migrations` 跑 `scripts/deploy/expand-contract.mjs`；存量 `000002` 不回溯 |
| 验收 | 构造一份违规迁移时 check job 红 |
| 状态 | **已落地**。 |

### V121-SVC-04 /health/ready

| 项 | 内容 |
|---|---|
| 目的 | 依赖未就绪时不切流量 |
| 做法 | compose healthcheck 改为 `/health/ready`；部署轮询公开 URL，body 含 `"status":"ready"` 才把 `latest` 指过来 |
| 验收 | ready 失败时回滚到 state 里的旧 sha |
| 状态 | **已落地**。 |

### V121-SVC-05 Caddy 重试

| 项 | 内容 |
|---|---|
| 目的 | 容器重启的 502 尽量不漏到用户 |
| 做法 | `(v11_api)` snippet：`lb_try_duration 8s` / `lb_try_interval 250ms` |
| 验收 | Caddy 配置校验通过；重启 API 时浏览器少见硬失败 |
| 状态 | **Caddyfile 已改**。 |

### V121-SVC-06 镜像回滚

| 项 | 内容 |
|---|---|
| 目的 | 一条命令回到上一 sha |
| 做法 | `/opt/musefold/.deploy-state.json` + `npm run deploy:rollback -- --layers service` |
| 验收 | 容器 RepoTags 回到 previous |
| 状态 | **已实现**。 |

### V121-SVC-07 契约后向兼容（K=3）

| 项 | 内容 |
|---|---|
| 目的 | 用最近 3 个已发布客户端的 `@musefold/contracts` 校验新 API |
| 阻塞 | 仓库里 contracts 仍是 `0.0.0-internal`，没有三份已发布 schema 快照可对 |
| 状态 | **本批不做假门禁**。有发布客户端版本后再开卡。 |

### V121-SVC-08 Worker 与在途任务

| 项 | 内容 |
|---|---|
| 目的 | 重启不丢 graphile 队列表里的活 |
| 做法 | 同一镜像 recreate worker；`stop_grace_period: 30s`；先 `queue:migrate` |
| 验收 | 重启后 `graphile_worker.jobs` 未完成行仍在并被捡起 |
| 状态 | **compose / 镜像已纳入**。在途任务需生产实跑确认。 |

---

## 批次 D — 流水线接线

### V121-CD-01 Deploy production workflow

| 项 | 内容 |
|---|---|
| 触发 | `workflow_run`：工作流名 `CI`、`completed`、`push`、分支 `main`/`master`；另支持 `workflow_dispatch` |
| Runner | `[self-hosted, musefold-prod]` |
| 步骤 | checkout 该 sha → `detect-layers` → `node scripts/deploy/run.mjs` |
| 并发 | `deploy-production`，不取消进行中的部署 |
| 状态 | **已落地** `.github/workflows/deploy.yml` |

### V121-CD-02 层过滤

| 项 | 内容 |
|---|---|
| 目的 | 纯文档 / 纯外壳不碰生产 Web/API |
| 做法 | 复用 `.github/layer-paths.yml`；`infra/` 与 `scripts/deploy/` 视为 infra，两层都部署 |
| 状态 | **已落地**。 |

---

## 本批不执行（刻意）

| 卡片 | 原因 |
|---|---|
| V121-ENV-02 SQLite 谱系 | 桌面安装问题，与 Web/API 部署解耦 |
| V121-ENV-05 桌面产物补齐 | 外壳层 |
| V121-CHAN-07 CDN | 采购 |
| M5 热更新开关 | 必须先有签名与 CDN |
| M6 tag 公证 | 证书 |

---

## 生产机操作清单（外部门禁，需人）

在 `musefold-cloud` 上用 root：

1. 把本仓库 checkout 到任意路径（或从已推送的 `main` 拉）。
2. `bash scripts/deploy/bootstrap-runner.sh`
3. 确认 `/opt/musefold/.env.v11` 含 `MIGRATION_DATABASE_URL`、`WORKER_DATABASE_URL`、`APP_DB_PASSWORD`、`WORKER_DB_PASSWORD`。
4. GitHub → Settings → Actions → Runners → New self-hosted runner，按脚本打印的步骤注册，标签必须是 `musefold-prod`。
5. 装上 systemd drop-in 的 CPU/内存上限。
6. 在 Actions 里对 `Deploy production` 做一次 `workflow_dispatch`（`layers=all`），确认站点 `release-sha.txt` 与 `docker inspect` 的 sha 一致。
7. 此后：`git push origin main` → CI 绿 → 自动部署。

回滚：

```bash
node scripts/deploy/rollback.mjs --layers content,service
```
