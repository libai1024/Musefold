# Musefold v2.1 Desktop 同步状态机与数据迁移

> **状态**：目标协议冻结；现有 `enabled` 登录硬门禁基础实现中，三态 consent 迁移尚未实施
>
> **日期**：2026-08-27
>
> **接棒**：本文增量修订 v1.1 同步协议的“首次启用、关闭与重新启用、兼容发布”部分；实体版本、outbox、change log、墓碑与冲突三选一继续以 v1.1 为准

## 0. 不可妥协的结论

1. Desktop 登录与同步授权是两个动作。登录成功不得自动注册 sync device、bootstrap、seed 本地实体或 push。
2. 同意按 `ownerId` 保存，不按应用全局保存；切换账号必须切换决定与同步元数据。
3. 登录、注册、登出再登录或账号切换后，该 owner 的同步必须关闭并等待当前会话再次显式启用；普通 App 重启不等同于重新登录，可恢复未变更会话的持久开关。
4. 关闭/暂停只停网络，不丢 outbox、usage outbox、conflict、cursor 或 entity state。
5. 重新启用一律先 pull 后 push；首次启用先 bootstrap，再 seed local-only 实体，最后 push。
6. 回滚不反向迁移用户内容。旧客户端看到 `enabled=false` 时保持不上传；新功能 kill switch 不修改用户 consent。

## 1. 当前实现基线

当前 Desktop 已具备：

- `cloud_sync_accounts.enabled` 布尔值；
- 账号登录变化后 `reconcileAccount()` 激活本地账号；
- 仅 `enabled=true` 时启动/恢复/聚焦/定时/本地写后调度同步；
- UI toggle、立即同步、冲突列表与三选一；
- SQLite outbox、usage outbox、entity state、conflict 与云端增量协议。

缺口是 `enabled=false` 同时表达“从未决定”和“用户暂停”，无法支持登录后的明确 consent 产品状态，也无法给兼容迁移提供可审计证据。

## 2. 两层状态模型

### 2.1 持久化 consent

```text
unset    用户尚未对该账号作出 v2.1 同步决定

enabled  用户已明确允许 Prompt/Folder/Tag 同步

paused   用户曾启用或明确选择暂停；保留全部同步元数据
```

只有 `enabled` 允许网络同步。`unset` 与 `paused` 都不上传，但 UI 不同：`unset` 提供首次说明与“启用/暂不启用”；`paused` 提供“继续同步”。

### 2.2 运行态 phase

| Phase | 含义 | 允许动作 |
|---|---|---|
| `signed_out` | 未登录 | 登录 |
| `unsupported` | 自定义账号服务器不支持 Musefold Cloud | 修改服务器/重新登录 |
| `awaiting_consent` | 已登录，consent=`unset` | 查看范围、启用、暂不启用 |
| `paused` | consent=`paused` | 继续同步；查看待同步数与冲突 |
| `enabling` | 用户确认后，正在注册设备/bootstrap | 取消后回 paused；不得重复提交 |
| `idle` | consent=`enabled`，当前无同步 | 立即同步、暂停 |
| `syncing` | 正在 pull/push | 查看进度；暂停在当前事务边界后生效 |
| `conflict` | 有待处理冲突，非冲突实体仍可继续 | 三选一、暂停 |
| `auth_blocked` | opaque session 失效且刷新失败/设备撤销 | 重新登录；不清 outbox |
| `error` | 可重试网络/服务错误或不可重试 schema 拒绝 | 重试、查看安全错误、暂停 |

`phase` 大部分由账号、consent、engine 和 summary 派生，不全部写库。持久化的只有 consent、同步元数据和必要错误码；`syncing` 不能在崩溃后被当成事实恢复。

## 3. 状态机

```text
App start
  ├─ no account ──────────────────────────────→ signed_out
  ├─ unsupported cloud identity ──────────────→ unsupported
  └─ supported owner with unchanged session
       ├─ consent=unset ──────────────────────→ awaiting_consent
       ├─ consent=paused ─────────────────────→ paused
       └─ consent=enabled ────────────────────→ idle → syncing

Login / register / account switch
  → stop scheduler + abort transport + disable old owner
  → authenticate and activate new owner with enabled=false
  → awaiting_consent or paused
  → explicit enable ──────────────────────────→ enabling

 enabing: register/bootstrap/seed/pull-push
       ├─ success, no conflict ───────────────→ idle
       ├─ success, conflicts ─────────────────→ conflict
       ├─ auth revoked/expired ───────────────→ auth_blocked
       └─ network/schema failure ─────────────→ error

 idle/conflict/error
       ├─ pause ──────────────────────────────→ paused
       ├─ account logout ─────────────────────→ signed_out
       └─ owner switch ───────────────────────→ load new owner's consent
```

### 3.1 登录成功

登录 handler 必须与同步服务协调，而不是仅等待账号 `onChanged`：

1. 先校验凭据输入，避免无效输入改变同步状态；
2. 停 scheduler、abort 旧 transport、等待 inflight 收敛并把旧 active owner 设为 disabled/inactive；
3. 执行账号登录或注册，凭据仍只留在主进程安全存储；
4. 解析新 cloud identity，激活该 owner row 并强制 `enabled=false`；
5. 广播已登录但同步关闭的状态，不创建 cloud client/session、不调用 `/sync/*`；
6. 认证失败则 fail-closed 地重新 reconcile 当前实际账号状态。

普通 App 启动且账号会话未发生登录变更时，才允许根据持久化 consent/开关恢复调度。任何新登录、注册或换号都必须由用户再次显式开启。

### 3.2 首次显式启用

确认面必须展示：

- 同步对象：Prompt、Folder、Tag；
- 会上传的本地活动记录数量（本地只读计数，不预先 seed outbox）；
- 不同步项：本地图片路径、Provider/API Key、生成历史、工作台草稿、设计方案、Agent/Skill/Automation 配置；
- 初始合并会保留双方数据，冲突不静默覆盖；
- “启用同步”与“暂不启用”两个明确命令。

用户确认后才按事务写 `consent_state=enabled` 和兼容 `enabled=1`，随后执行：

```text
register device
→ bootstrap cloud Folder/Tag/Prompt
→ pull bootstrap 期间变化
→ seed 从未同步的本地活动实体到 outbox
→ push（folder parent → child → tag → prompt）
→ pull again
→ publish summary
```

如果 bootstrap 失败，consent 仍为 enabled，phase 为 error；不得假装用户未确认。用户可以暂停，暂停将 consent 改为 paused。

### 3.3 暂停、恢复与登出

- 暂停：在当前 SQLite/HTTP 原子边界完成后停止后续批次，写 `paused` / `enabled=0`；不取消已进入服务端事务的 mutation。
- 暂停期间：本地写继续和业务数据同事务进入 outbox，UI 显示等待数。
- 恢复：写 `enabled` / `enabled=1`，先 pull 再 push。
- 登出：停 transport、清主进程内 opaque session、deactivate active owner；保留 owner 级 consent 与全部本地同步元数据。
- 换号：旧 owner outbox 绝不发送到新 owner；新 owner 读取自己的 consent。跨账号导入必须清 owner/device/cursor 并作为新本地数据处理。

## 4. SQLite 兼容迁移

### 4.1 Expand 迁移

在 `cloud_sync_accounts` 增加：

```text
consent_state       TEXT NOT NULL DEFAULT 'unset'
consent_decided_at  INTEGER NULL
consent_version     INTEGER NOT NULL DEFAULT 1
```

CHECK 约束或 repository 校验只允许 `unset | enabled | paused`。保留旧 `enabled` 列至少一个桌面兼容窗口。

### 4.2 旧行分类

迁移在同一事务按以下顺序分类：

| 旧数据证据 | 新 consent | 理由 |
|---|---|---|
| `enabled=1` | `enabled` | 已存在明确启用行为，升级不可关闭 |
| `enabled=0` 且存在 `bootstrap_completed_at` / `last_sync_at` / cloud entity state / outbox / usage outbox / conflict 任一同步参与证据 | `paused` | 证明账号曾进入同步生命周期；保持不上传并提供恢复 |
| `enabled=0` 且无上述证据 | `unset` | 无法区分默认关闭与明确暂停；保守保持不上传并允许重新选择 |

设备 row 本身不作为“曾同步”证据，因为当前 reconciliation 可能在未启用时创建本地账号/设备元数据。

### 4.3 双版本读写

兼容窗口内：

- 新客户端读取 `consent_state`；若列不存在，回退 `enabled ? enabled : unset`。
- 新客户端写 consent 时同步维护旧列：仅 `enabled` 写 1，`unset/paused` 写 0。
- 旧客户端继续只看 `enabled`：已启用账号可继续同步，unset/paused 均保持不上传。
- 不允许旧客户端的 `enabled=false` 后台写把已有 `paused` 重置为 `unset`；新 repository 只通过 consent API 修改两列。

### 4.4 Contract 条件

删除旧 `enabled` 列不是 v2.1 首发门禁。只有同时满足以下条件才另开 contract 卡：

1. 最低支持 Desktop 版本全部理解 `consent_state`；
2. 线上无旧客户端依赖旧列的证据；
3. 完成升级、降级、崩溃恢复、账号切换数据演练；
4. SQLite 备份恢复验收通过。

## 5. Cloud/API 兼容

v2.1 不要求服务端保存 Desktop consent。consent 是本机是否上传本地数据的决定；Cloud 只在用户启用后看到设备注册和同步请求。

如 parity 域需要新增字段/API：

1. contracts 先加 optional/default 兼容字段；
2. PostgreSQL expand migration 先上线，旧 API 实例可继续服务；
3. web-api 对新旧请求都能解析，响应保持旧客户端可读；
4. Cloud client/Desktop mapper/Web controller 再切换；
5. 观察至少一个发布窗口后才 contract；
6. `openapi:check` 与真 PostgreSQL 集成门禁必过。

不得把同步 consent 塞进 OAuth grant、Cookie 或账号 JWT；三者生命周期和撤销语义不同。

## 6. 数据迁移规则

### 6.1 不迁移的数据

- API Key、账号密码、JWT、opaque desktop session、OAuth token；
- `previewImagePath`、`coverImagePath`、`imagePath` 等绝对路径；
- 本地 Provider、设计方案、Automation 配置、本地 GitHub Skill；
- 生成历史和工作台草稿，除非对应 parity 卡为其建立独立 cloud contract。

### 6.2 迁移不变量

- 所有本地业务写与 outbox 同 SQLite 事务；
- pull 应用不生成回声 outbox；
- mutationId 重试复用，不能因 UI 重试重新生成；
- cursor 只有本页全部应用成功后推进；
- conflict 同时保留 local/remote snapshot；
- delete/restore 使用墓碑和 version，不看客户端时间；
- migration 和 rollback 均不能清空用户正文或本地资产。

### 6.3 版本与来源

共享 UI 使用 contracts 文档。Desktop mapper 提供来源/capability 上下文；存储行、sync metadata 和本地路径留在 core/main/runtime 边界。不得为了 parity 把 `cloud_version` 或 cursor 散到 UI 实体。

## 7. 发布与灰度

### 7.1 顺序

1. SQLite expand migration + repository 双读写测试；UI 不变。
2. 状态机与新 consent UI 上线，但同步网络路径受 kill switch 控制。
3. 仅内部/测试账号开放，验证 unset 不发请求、enabled 恢复、paused 保持。
4. 分批开放首次启用；观察 bootstrap、conflict、rejected、outbox backlog。
5. parity 域逐卡放量；Cloud/API contract 保持兼容。
6. 完成两台 Desktop + Web 的真实跨设备验收后才宣布同步迁移完成。

### 7.2 观测指标

- consent 各状态计数（不含 prompt 内容）；
- 登录后未确认时 `/sync/*` 请求必须为 0；
- bootstrap 成功/失败、耗时与 cursor expired；
- outbox backlog、duplicate、conflict、rejected；
- owner mismatch、device revoked、auth blocked；
- 工具/日志不得包含 payload、正文、路径或凭据。

## 8. 回滚策略

| 故障 | 回滚动作 | 不允许的动作 |
|---|---|---|
| consent UI/状态机错误 | 关闭新 UI，回退读取兼容 `enabled`；保持新列 | 把所有账号改 enabled/disabled |
| bootstrap 大量失败 | 停止新启用入口；已启用账号可暂停或继续旧 engine | 清 outbox/cursor 后重来 |
| 新 parity 写路径错误 | 关闭该域写开关，保留兼容读；服务端前滚修复 | 回滚已提交云版本或删墓碑 |
| schema/API 不兼容 | 回滚 app 读路径，服务端保持 expand schema | 同批 drop 新旧列 |
| 账号串线风险 | 全局停止 sync transport，保留本地数据并阻断请求 | 尝试自动“修复”owner 归属 |
| Cloud Agent 安全事件 | 独立停 Cloud MCP/tool，撤销 grant/token | 关闭 Desktop 本地数据访问 |

SQLite migration 的 `down` 仅用于开发/尚未写入真实 consent 的阶段。生产已写新状态后不执行破坏性 down；旧版本通过兼容列运行。

## 9. 测试矩阵

### 9.1 状态机

- 新账号登录进入 awaiting_consent，网络层断言没有 `/sync/*`。
- 选择暂不启用进入 paused；重启、登出再登录仍不上传。
- 明确启用后才注册/bootstrap，成功进入 idle。
- 迁移前已启用且账号会话未变：普通升级/重启可恢复；执行登录、注册或换号后必须关闭，且不重复注册设备或清 cursor。
- 旧 `enabled=0` 有参与证据迁 paused，无证据迁 unset。
- 账号 A/B 切换各自保留 consent 与同步元数据，但新登录会话均先关闭；A outbox 永不发给 B。
- session 过期进入 auth_blocked；重新登录后保留 outbox。

### 9.2 数据与失败

- bootstrap 每页失败、进程崩溃、重复响应均幂等。
- 暂停发生在 push 中时只停后续批次。
- 离线写 100 条、恢复、duplicate、conflict、rejected 全路径不丢。
- local path/Key/credential 从 HTTP body、日志和错误中为 0。
- cursor expired 完整重建不重复实体。
- 升级到新版本后降级旧客户端，unset/paused 不上传，enabled 可继续。

### 9.3 门禁

- SQLite migration + core engine/repository 单测；
- account/cloud-sync IPC 与 mapper 单测；
- Desktop E2E 登录、首次选择、暂停/恢复、冲突、换号；
- `npm run check`；触及 contracts/web-api 时另跑 `openapi:check` 与 `test:integration:v1.1`；
- 两台真实 Desktop + Web 跨网络验收是发布外部门禁，fixture 不可替代。

## 10. 与 v1.1 协议的修订点

| v1.1 表述 | v2.1 修订 |
|---|---|
| 登录并启用后触发同步 | 拆成账号登录、consent 决定、运行态三层 |
| enabled 布尔值 | 增加 `unset/enabled/paused`，旧列兼容保留 |
| 首次登录显示一次明确选择 | 明确为每 owner 持久状态，未确认不得建立 sync transport |
| 关闭同步 | 改称暂停；保留数据与 outbox，恢复先 pull 后 push |
| 当前已实现状态 | 仍以源码为准；本文目标态需按交付卡实施后才生效 |
