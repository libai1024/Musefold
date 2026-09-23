# 本地 CLI / MCP 普通云账号生图修复（2026-09-22）

## 问题与修复

安装版 2.5 的本地控制面已连通，但普通 `generate` / `generate_image` 仍走旧 Provider 付款绑定：账号云连接无本地 API Key、且 `managed_by=account`，因此被登记为 `PAYMENT_IDENTITY_UNBOUND`。界面使用 `startManagedGeneration`，没有经过这条旧路。方案/Skill 的独立 managed run 路径不能作为普通生图已接入的证据。

本次为普通生图增加云账号路由，复用原 managed generation session、身份校验、单次发送许可、确认/预算、持久幂等、回执及本地图片投影。旧账号 Key 仍拒绝；BYOK/豆包路由不变；远程 Cloud MCP 仍只读。没有为失败请求补造付款身份或自动重发。

- 原始自动化意图摘要随 managed record 保存，重放先检查原账号和原输入，不根据当前默认连接重选付款方。
- MCP 不提供 CLI 的交互同意字段，沿用预算或原生确认；拒绝确认零发送。显式费用上限低于云估价、或无法形成相应有界估价时先拒绝。
- 参考图经受管路径、真实字节读取与原有云上传冻结；历史图先转存。结果必须实际落盘才返回图片成功。
- 取消指向原云任务；断线/重启只查原回执，不重新 POST。不同账号不能读取原结果。
- `account status` 的健康不再仅由本地 token 存在推断；云连接可用性不再错误依赖本地 API Key。

## 自动化验证

最终 `pnpm run check` 退出 0，38/38；根测试 3335 通过、77 条件跳过，见 `tests/v25/.results/cli-cloud-20260922/musefold-cli-cloud-check-confirmed.log`。实际 HTTP/SQLite 云执行、自动化状态专项 48 通过，新增契约 2 通过。源码扫描零发现/零错误，见 `tests/v25/.results/cli-cloud-20260922/musefold-cli-cloud-source-scan.json`。

保留首败：参考图夹具目录与受管目录常量不符，修正夹具后通过；类型/格式错误修正后通过。完整检查曾有原有 `local-asset-cleanup` 迁移测试 5 秒超时；未放宽时限或修改断言，原文件 14 项单独复验通过，之后原完整检查通过。

## 安装包与真实验收

用户明确授权使用真实 xiaomiao 账号进行收费验证。正式服务为 `https://zhaozhaoyue.top/Musefold/v25`，没有使用模拟上游；凭据只在进程环境/正常登录链路中传入，不写入本报告或测试源码。

- macOS adhoc 打包通过；实际包冒烟 7/7，App/DMG/ZIP 安全扫描零发现/零错误。日志分别为 `tests/v25/.results/cli-cloud-20260922/musefold-cli-cloud-package.log`、`tests/v25/.results/cli-cloud-20260922/musefold-cli-cloud-package-smoke.log`、`tests/v25/.results/cli-cloud-20260922/musefold-cli-cloud-package-security.json`。
- `/Applications/Musefold.app` 已替换为该包；严格签名校验通过，`app.asar` SHA256 为 `2714fe7707f84f243364554086df67e45a22c02d8ac952b4c7f508525149d346`。旧包移至用户废纸篓 `Musefold-2.5.0-before-cli-cloud-fix-20260922.app`，可恢复，用户数据未删除。首次启动等待系统钥匙串授权，用户允许后，真实用户目录的 CLI 报告 2.5.0、账号 `health: ok`、默认账号云连接 `available: true`。
- 新请求 CLI 完整验收：通过 `/Applications` 内实际 CLI 提交、等待、下载，68.407 秒成功；任务 `1da7e963-72b0-4273-b51b-298706564f28`，图片 1,309,656 字节，SHA256 `3d1b63b9aae46e68a7b999948a30b30d661d00dbdbee0726ad548c8a06928f3a`。同键重放返回原任务。证据 `tests/v25/.results/cloud-cli-fresh-1790077137969/evidence.json`。
- 真实 stdio MCP 完整验收：通过随包 `musefold-mcp.mjs` 的 `generate_image` 生成、等待、下载；确认按既有控制面批准，没有注入 CLI 的交互同意字段。任务 `376e9be5-3f58-4190-b5e8-9f7bf7e0d4c4`，图片 1,237,216 字节，SHA256 `6efc9062df2a32d753dac47e2426df1c941752a2403f7afe08cf37990f2bf924`。同键重放仍为原任务。持久副本 `tests/v25/.results/cloud-cli-mcp-1790075980228/mcp/monitor-report.png`；原返回路径及验证记录在同目录 `evidence.json`。
- 首轮 CLI 真实失败保留：5 分钟等待超时，本地审计存在状态查询 500，而云端任务 77 秒已完成。未重新 POST，通过原账号/原任务只读恢复取回真实图片，再以原键取回与重放成功；不把这次恢复冒充首次端到端成功。任务 `63433e8e-8b0d-435b-b10b-6c3b5b602628`，图片 3,439,976 字节，SHA256 `409f65907ef0ccbfaf44ea885565de1ead0349f644b0354c2356a28ff3b3e625`。首轮 500 的具体异常码未留存，不能断言原因；后续串行独立 CLI 新请求与 MCP 均完整成功。首败日志 `tests/v25/.results/cli-cloud-20260922/musefold-cli-cloud-live.log`，恢复日志 `tests/v25/.results/cli-cloud-20260922/musefold-cli-cloud-resume.log`。
- 费用如实分层：三张图对应实际余额从 89,340,570 降至 89,160,570 quota，共 **3.6 积分**；其中首轮 CLI 与 MCP 共 2.4，后续 CLI 新请求 1.2。同键重放未额外扣费。服务端三份原回执均 `succeeded`、每份一张素材；本地受管调用数分别 2 和 1。上游回执仍为 `costProvenance: unknown / costPoints: null`，没有将估价或余额差伪装成逐任务结算回执，也没有自动清除未知费用保护。

真实验收使用独立本地测试资料目录；正式用户目录仅核对连接及账号健康，未覆盖其库。三张输出均已读取字节并目视核对为监控页＋报告页参考图；返回的实际图像尺寸为正方形，不宣称上游严格履行了请求的 16:9。

## Codex 本地 MCP 注册

原 `~/.codex/config.toml` 未注册 Musefold，当前任务工具目录也没有 Musefold MCP。按 [OpenAI 官方 MCP 配置说明](https://learn.chatgpt.com/docs/extend/mcp) 和产品自身启动片段，仅新增 `mcp_servers.musefold`，指向 `/Applications/Musefold.app` 的随包 stdio 服务，启动等待 20 秒、工具等待 600 秒。配置无账号口令、API Key 或本地 bearer；仍由 App 的发现及权限机制提供连接。

`codex mcp get musefold --json` 确认启用。实际读取该配置启动 stdio 客户端，发现 20 个工具，`musefold_status` 返回 2.5.0，`get_setup_status` 返回账号 `health: ok`。本任务已经建立的工具目录不据此假装热更新；重开 Codex 以加载新工具。远程 Cloud MCP 不在本次写权限范围。

## Electron 回归终态

首轮 138 通过、83 条件跳过、1 失败：豆包侧栏菜单点击期间浮层失去稳定性/脱离 DOM。该轮并行启动真实验收 App，违反测试配置关于真窗口焦点需串行的约束。未修改产品、断言、超时或快照，原失败文件单独复跑 2/2 通过；首轮日志 `tests/v25/.results/cli-cloud-20260922/musefold-cli-cloud-electron.log` 保留。

随后不再并行启动其他测试窗口，完整原命令 `pnpm exec playwright test -c tests/v25 --project=electron` 退出 0：**139 通过、0 失败、83 条件跳过，13.8 分钟**，无重试或快照更新。条件跳过不计通过，付费 CLI/MCP 实网验证采用前述独立实际安装包流程，不冒充所有条件集成场景均已执行。最终日志 `tests/v25/.results/cli-cloud-20260922/musefold-cli-cloud-electron-serial.log`；原始日志和最终 JSON 报告另存 `tests/v25/.results/cli-cloud-20260922/`。最终源码扫描 `musefold-cli-cloud-source-final.json` 再次零发现/零错误。

本次不表示整个 2.5 迁移、Windows、正式签名公证或所有历史待验项完成。

## 提交与证据绑定（2026-09-23 补）

- 代码与测试已提交为 `2561d2a`（`fix(v25): route plain CLI/MCP generation through account cloud session`），包含本文所述全部 11 个代码与测试文件。
- 本机安装包 `app.asar`（SHA256 `2714fe7707f84f24…`）与该提交的绑定见 `tests/v25/.results/cli-cloud-20260922/musefold-cli-cloud-source-manifest.json`（commit `2561d2a0b78fb218dd9742e1c93a59afcce9af7b`）。安装包一致性以最终候选提交的重新打包（P0-05）为准，届时替换本机安装。
- 原 `/tmp` 下的打包日志、源码扫描与三次失败 check 日志（lint、typecheck、`local-asset-cleanup` 超时）已复制进同一证据目录，本文中的路径已同步改写；`musefold-cli-cloud-check-3.log` 复核无失败标记，归类为中间轮，不入证据目录。
