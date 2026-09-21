# v2.5 真实账号与中转站验证

这套入口验证当前本地构建与真实外部服务。它与受控上游回归、安装包验收、生产发布分开计数。

## 服务与数据

- 官方账号事实源：`https://zhaozhaoyue.top`，配置为服务端 `NEW_API_BASE_URL`。
- TvT 自备生图连接：`https://ai.tvt.wiki/v1`。它不提供 Musefold 使用的 New API 账号接口，不能拿来替换账号服务。
- 本机验证 API：`http://127.0.0.1:8787`；Web：`http://127.0.0.1:3399`。桌面通过主进程 `MUSEFOLD_API_URL` 选择该 API。
- 使用独立 PostgreSQL 数据库、S3 bucket 和 Electron userData，避免把真实账号验证变成对原数据库的覆盖升级。旧库升级另按数据迁移任务验收。

API 和 Worker 的变量见 `apps/api/src/env.ts` / `apps/worker/src/env.ts`。启动前先对目标验证数据库执行根 `pnpm run db:migrate`，随后启动 API、Worker；Worker 会建立缺失的验证 bucket。方案文本编排还需单独配置 `SCHEME_AGENT_TEXT_MODEL` 并运行 agent-worker，不把普通出图当作方案 Agent 全链路验收。

2026-09-19 本机配置保存在仓库外的 `~/.config/musefold-v25-live/`，目录权限 0700、文件 0600：`runtime.env` 是服务配置，`verification.env` 是测试凭据。不要把它们复制进仓库、报告或附件。

## 验证入口

`verification.env` 的账号验证变量是 `MUSEFOLD_LIVE_E2E=1`、`MUSEFOLD_E2E_USERNAME`、`MUSEFOLD_E2E_PASSWORD`。填写真实值时使用本机私有文件；文档、命令历史和 CI 输出中不放密码。

只验证账号时，将 `MUSEFOLD_LIVE_GENERATION` 留空或设为 0。执行：

```sh
set -a
source ~/.config/musefold-v25-live/verification.env
set +a
pnpm run test:e2e:live
```

命令先检查前置变量，再构建 Web 和 Electron，最后使用 `tests/v25/playwright.live.config.ts`。PC Web、Mobile Web、Electron 各走真实登录及提示词创建/读取/删除；Web 同时检查设计方案列表入口。测试自行占用 3399，不复用旧 Web 进程。

要额外验证一次真实中转站生图，需明确设置：

- `MUSEFOLD_LIVE_GENERATION=1`
- `MUSEFOLD_E2E_IMAGE_API_KEY`
- `MUSEFOLD_E2E_IMAGE_BASE_URL`：无用户信息、查询参数或片段的 HTTPS 地址
- `MUSEFOLD_E2E_IMAGE_MODEL`：从该中转站实际模型列表选择

该用例会产生真实费用：只发送 1 张、标准质量，不自动重试；验证连接、终态、图片解码、SQLite 资产、新 PID 重启后图片 hash 与原 run 不变，以及 userData 中无 API Key 明文。一次运行通过不允许自动再次执行付费部分来“补报告”。费用金额只有上游提供可信账单时才能计入验收。

## 报告与失败处理

严格入口缺变量直接失败，不以 skip 冒充实网验证。结果在 `tests/v25/.results/live/`，与普通 E2E 报告隔离。关闭 trace、自动截图、视频和自动失败页面快照；只有密码/密钥输入框消失后的成图页面才手动截图。Playwright 的失败页面快照原本会包含密码输入值，因此实网模式设置 `PLAYWRIGHT_NO_COPY_PROMPT=1`。

账号服务拒绝凭据时，停止重复尝试，核对账号服务与密码；不要改成绕过认证、换用管理员身份或清除身份保护。网络不确定或生图超时时先核对原任务与账单，不自动再发一次。记录通过、失败、未执行与外部条件，不能用模型列表探测代替成功出图，也不能用桌面 BYOK 代替 Web 云生图或设计方案完整验收。
