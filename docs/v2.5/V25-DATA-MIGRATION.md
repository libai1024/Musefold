# Musefold v2.5 数据迁移方案

> **状态**:已批准
>
> **日期**:2026-08-28
>
> **前提**:线上无真实用户(账号事实源为自托管 New API 网关);数据迁移的保护对象是开发者本机桌面数据与自托管环境的可重建性。

## 1. 桌面 SQLite(唯一必须保数据的线)

开发者本机的提示词库、历史与设置必须在升级到 v2.5 构建后完整可用。

流程(M4-e 已落地,实施细化:**原位接管而非搬运**——legacy 链终态即 Drizzle baseline,零数据拷贝零语义变换,风险面最小):

1. **对齐**:首启仍先跑 core legacy 迁移链(0001→0020)把旧库带到终态(user_version=20);非终态旧库拒绝接管并报错;
2. **备份**:接管一瞬 `VACUUM INTO` 生成带时间戳备份(userData/backups);
3. **接管**:`@musefold/desktop-db` 的 baseline(终态 `sqlite_master` 忠实导出,含 CHECK/partial 索引/FTS5)对既有库 fake-apply 标记为已应用,全新空库则真跑 baseline(不再走 legacy 链);随后应用 Drizzle 增量迁移(首个:0001 workbench_drafts);
4. **校验**:22 表 + FTS + `__drizzle_migrations` 完整性断言,缺一拒绝启动;
5. **后续增量**:schema 变更全部走 `drizzle-kit generate` → 手工审阅 → `db:bundle` 内联(Electron 生产包无 fs 依赖)→ 启动时 migrate;core `run-migrations` 冻结在 0020,M5c 删除。

测试(`packages/desktop-db/__tests__`):「baseline 空库 ≡ legacy 链库」逐表列/索引一致性、既有库接管零搬运保数据、备份可开、重入 noop、增量迁移在被接管库上生效、非终态拒绝。

## 2. 服务端 PostgreSQL

无真实用户,**不做旧库 introspect,不做兼容层**:

1. `packages/db` 直接定义全新 Drizzle schema,生成 baseline 迁移;
2. 自托管环境重建数据库(旧 `apps/web-api` 的 13 个迁移与数据作废);
3. 后续变更遵守 expand/contract:写行与 drop 分属不同迁移,破坏性 SQL 必须在 PR 中显式标注。

## 3. 账号体系

- 事实源:New API 网关(自托管)。用户名/密码、余额、兑换码、模型令牌均在 New API 侧,不迁移。
- Musefold PG 侧只有:用户关联记录(Musefold user id ↔ New API 身份)、Better Auth 会话表、MCP OAuth 客户端与 grant 表——全部新建,无历史包袱。
- 桌面端已登录状态在升级后失效一次(重新登录),同步开关按「登录 ≠ 同步」语义保持关闭,由用户显式开启。
- MCP 客户端按 2026-07-28 规范(CIMD)重新授权,旧 grant 作废。

## 4. 热更与升级通道

- 无存量用户,不设旧客户端兼容窗口;旧安装包直接作废,v2.5 起重新分发。
- electron-updater feed 与签名密钥沿用现有配置;`update-protocol`(Ed25519 内容热更)协议不变,v2.5 构建重新出首个 manifest。

## 5. 不可逆动作清单

以下动作执行前必须确认对应批次验收已过:

| 动作 | 所在批次 | 前置 |
|---|---|---|
| 删除旧 `apps/web-api` 与其迁移 | M2-07 | 新 api 部署成功且 E2E 通过 |
| 自托管 PG 重建 | M2-07 | 同上 |
| 删除旧渲染层与旧包 | M4-e / M5-c1 | 对应域双端 E2E + 快照全绿 |
| 删除 Python 测试栈 | M5-a1 | Playwright Electron E2E 覆盖等价场景 |

所有批次都可整体回退到 `v2.5-baseline` tag;桌面本机数据因迁移前强制备份而始终可恢复。
