# Musefold v1.1 提示词云同步协议

> **状态**：P0 协议基线
>
> **日期**：2026-08-17
>
> **目标**：让 Web 与桌面端在同一 new-api 个人账号下安全同步提示词库，同时保留桌面本地优先能力

## 0. 协议结论

P0 采用“云端版本 + 客户端 outbox + 服务端变更日志”的增量同步方案：

- Web 是 cloud-first，所有提示词写入直接提交 Web API。
- 桌面继续以 SQLite 提供离线读写，通过独立 sync engine 与云端增量同步。
- 服务端为每个实体维护单调递增 `version`，为每次变化分配 `change_seq`。
- 客户端写入使用稳定 `mutationId` 和 `baseVersion`，重试不会重复应用。
- 删除使用墓碑；服务端不会因离线设备晚到而让已删除内容重新出现。
- 并发冲突不使用 last-write-wins，不比较客户端时钟，不静默覆盖。
- P0 不引入 CRDT。冲突由用户明确选择保留云端、保留本地或保留两份。

## 1. 同步范围

### 1.1 同步实体

| 实体 | 同步内容 |
|---|---|
| Prompt | 标题、描述、正文、负向提示词、文件夹、标签、模型提示、参数、评分、收藏、来源、删除状态 |
| Folder | 名称、父文件夹、排序、删除状态 |
| Tag | 名称、分组、颜色、删除状态 |
| Usage event | copy/apply/generate 使用事件，按幂等键计数 |

### 1.2 不同步内容

- `previewImagePath`、`coverImagePath`、`imagePath` 等本地绝对路径。
- 本地 Provider id、API Key、模型连接和账号凭据。
- SQLite FTS 行、搜索历史、智能集合和纯 UI 筛选状态。
- 工作台草稿和生成历史不通过本协议同步；它们直接使用 Web 工作台 API。
- Agent、Skills、设计方案、CLI/MCP 配置。

后续若同步提示词封面，应先把图片上传为 cloud asset，再同步 `coverAssetId`，不能上传本地路径字符串。

## 2. 云端提示词契约

P0 的云端提示词聚合冻结为：

```ts
interface CloudPromptDocument {
  id: string;                    // ULID，客户端可生成
  title: string;
  description: string | null;
  content: string;
  negative: string | null;
  folderId: string | null;
  tags: CloudPromptTag[];
  modelId: string | null;
  params: Record<string, unknown> | null;
  rating: number;                // 0..5
  isPinned: boolean;
  pinOrder: number | null;
  usageCount: number;            // 服务端拥有
  lastUsedAt: string | null;     // 服务端拥有
  source: 'manual' | 'import' | 'share' | 'slip' | 'generation';
  sourceUrl: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface CloudPromptTag {
  id: string;
  name: string;
  group: string | null;
  color: string | null;
  version: number;
  deletedAt: string | null;
}
```

写入约束：

- 标题 1 至 80 字符，正文 1 至 12,000 字符，负向提示词最多 4,000 字符。
- 每条提示词最多 20 个标签，参数 JSON 编码后最多 32 KiB。
- `sourceUrl` 只接受 `https:` 或明确允许的 `http:` 地址，禁止 `file:`、`data:` 和脚本协议。
- `usageCount/lastUsedAt/version/createdAt/updatedAt` 由服务端产生，普通 mutation 不能覆盖。
- 首次导入本地提示词时允许一次性的 `initialUsageCount`，只在服务端不存在该 id 时生效。

## 3. 桌面字段映射

| Desktop `Prompt` | Cloud | 规则 |
|---|---|---|
| `id` | `id` | 保留现有 ULID，不重新生成 |
| `title` | `title` | 原样同步，服务端 trim/校验 |
| `description` | `description` | 空字符串规范化为 null |
| `content` | `content` | 原样同步 |
| `contentNegative` | `negative` | 空字符串规范化为 null |
| `folderId` | `folderId` | folder 必须先存在或在同批次先创建 |
| `modelId` | `modelId` | 只作为提示信息，不用于选择云 Provider |
| `params` | `params` | 仅保留 cloud-safe JSON 字段 |
| `previewImagePath` | 不同步 | 本地路径不能进入云端 |
| `coverImagePath` | 不同步 | 只读派生字段 |
| `rating` | `rating` | 0 至 5 |
| `isPinned` | `isPinned` | 同步 |
| `pinOrder` | `pinOrder` | 同步；空值允许服务端重排 |
| `usageCount` | `initialUsageCount` | 仅首次导入使用，之后由事件维护 |
| `lastUsedAt` | `lastUsedAt` | 首次导入可作为参考，之后服务端维护 |
| `source` | `source` | 不支持值规范化为 `import` |
| `sourceUrl` | `sourceUrl` | 通过 URL 白名单校验 |
| `createdAt/updatedAt` | 对应 ISO 时间 | 首次导入保留；后续 server time 为准 |
| `deletedAt` | `deletedAt` | 已经同步过的实体删除必须上传墓碑 |

Folder 与 Tag 保留现有 id。桌面标签关联在 push 时作为 prompt 聚合的一部分提交，服务端在同一事务内维护 `prompt_tag_links`。

## 4. 标识、版本和时间

### 4.1 标识

- 实体 id：ULID，由创建端生成，服务端校验格式。
- `deviceId`：UUID v4，桌面首次启用同步时生成并保存在本地安全配置；重装视为新设备。
- `mutationId`：ULID，每次本地业务写入生成一次，网络重试必须复用。
- `change_seq`：PostgreSQL `bigserial`，全局递增，客户端只视为不透明 cursor。

### 4.2 版本

- 服务端实体 `version` 从 1 开始。
- create 的 `baseVersion = null`。
- update/delete/restore 必须携带客户端最后见到的 `baseVersion`。
- 服务端 mutation 成功后增加 version 并写入同版本 change。
- 客户端重复收到相同或更低版本实体时忽略实体写入，但仍推进 cursor。

### 4.3 时间

- 冲突判断只使用 version，不使用 `updatedAt`。
- 服务端时间用于展示、排序和保留策略。
- 客户端时间只作为诊断元数据，不影响覆盖优先级。

## 5. 服务端变更日志

每次 prompt/folder/tag 的成功 create/update/delete/restore 必须与实体更新在同一事务中追加：

```text
sync_changes
  seq
  owner_id
  entity_type      prompt | folder | tag
  entity_id
  operation        upsert | delete
  entity_version
  snapshot         当前规范化实体；delete 也含最小墓碑快照
  created_at
```

规则：

- change log 只对同 owner 可读，并启用 RLS。
- snapshot 不包含签名 URL、本地路径、密钥或其他账户信息。
- 同一事务内关联标签变化只产生一个 prompt upsert change。
- 日志至少保留 180 天；压缩前记录 owner 的最小可用 cursor。
- cursor 早于保留边界时返回 `410 SYNC_CURSOR_EXPIRED`，客户端必须重新 bootstrap。

## 6. API 契约

统一前缀：`/api/musefold/v1/sync`。

### 6.1 注册设备

```http
POST /sync/devices
```

```json
{
  "deviceId": "3a38...",
  "name": "Musefold on Wang's Mac",
  "platform": "macos",
  "clientVersion": "1.1.0"
}
```

重复 device id 只更新名称、版本和最后在线时间。已撤销设备不能自行恢复，需要重新注册新 id。

### 6.2 Bootstrap

```http
GET /sync/bootstrap?entity=prompt&after=01...&limit=200
```

响应：

```json
{
  "snapshotCursor": "78421",
  "items": [],
  "nextPage": null
}
```

流程：

1. 第一页读取当前 owner 最大 change seq 作为 `snapshotCursor`。
2. folders、tags、prompts 按实体类型和 id 使用 keyset 分页。
3. 客户端把每页以 cloud-origin 事务写入本地，不生成 outbox。
4. 全部分页完成后，从 `snapshotCursor` 调用 pull，补齐 bootstrap 期间发生的变化。

bootstrap 允许重复实体；客户端按版本幂等应用。使用不可变 id 分页，不能用 `updatedAt` 分页。

### 6.3 Pull

```http
GET /sync/pull?cursor=78421&limit=500
```

```json
{
  "changes": [
    {
      "seq": "78422",
      "entityType": "prompt",
      "entityId": "01...",
      "operation": "upsert",
      "version": 4,
      "snapshot": {}
    }
  ],
  "nextCursor": "78422",
  "hasMore": false
}
```

- `limit` 默认 200，最大 500。
- 空页仍返回当前安全 cursor。
- 客户端只有在本页所有 changes 本地事务提交后，才保存 `nextCursor`。
- 响应被重放时必须得到同一结果，不要求 exactly-once transport。

### 6.4 Push

```http
POST /sync/push
```

```json
{
  "deviceId": "3a38...",
  "mutations": [
    {
      "mutationId": "01...",
      "entityType": "prompt",
      "entityId": "01...",
      "operation": "update",
      "baseVersion": 3,
      "payload": {}
    }
  ]
}
```

单批最多 100 个 mutation 或 512 KiB。结果逐项返回：

```json
{
  "results": [
    {
      "mutationId": "01...",
      "status": "applied",
      "version": 4,
      "snapshot": {}
    }
  ]
}
```

`status`：

| 状态 | 含义 |
|---|---|
| `applied` | 已成功应用并写 change |
| `duplicate` | mutationId 已处理，返回第一次结果 |
| `conflict` | baseVersion 不是当前版本，返回 current snapshot |
| `rejected` | schema、依赖或业务规则不合法，不应原样重试 |

push 批次不是全有或全无。每个 mutation 独立事务，防止一条冲突阻塞其他本地修改；同一实体的 mutation 必须按 outbox 顺序发送。

## 7. 桌面本地数据结构

桌面主库新增独立同步元数据，不把 cloud-only 字段散落到所有业务表：

```text
cloud_sync_accounts
  owner_id, device_id, enabled, cursor,
  bootstrap_completed_at, last_sync_at, last_error

cloud_entity_state
  owner_id, entity_type, local_id, cloud_id,
  cloud_version, last_synced_hash, sync_status,
  last_synced_at,
  PK(owner_id, entity_type, local_id)

cloud_sync_outbox
  mutation_id PK, owner_id, entity_type, entity_id,
  operation, base_version, payload_json,
  created_at, attempt_count, next_attempt_at, last_error

cloud_sync_conflicts
  id, owner_id, entity_type, entity_id, mutation_id,
  base_version, local_snapshot, remote_snapshot,
  detected_at, resolved_at, resolution
```

`sync_status`：`clean | pending | conflict | error`。

Repository 约束：

- 用户在桌面 create/update/delete/restore 时，同一个 SQLite 事务写业务表和 outbox。
- sync engine 应用 pull 时走专用 `applyCloudSnapshot()`，不得再次生成 outbox。
- mutation 成功后，以响应 snapshot 更新业务表和 entity state，再删除对应 outbox。
- outbox payload 是 cloud-safe 快照，不得包含本地路径或密钥。

## 8. 同步循环

桌面每次同步按以下顺序执行：

```text
1. ensure authenticated account + registered device
2. pull remote changes from saved cursor
3. apply changes to clean entities; dirty entities enter conflict check
4. push ordered local outbox mutations
5. apply applied/duplicate results; persist conflicts/rejections
6. pull once more to receive own and concurrent server changes
7. update last_sync_at and UI status
```

触发时机：

- 登录并启用云同步后。
- App 启动、网络恢复、从休眠恢复。
- 本地 mutation 后 debounce 2 秒。
- 前台每 60 秒轻量 pull；后台不保持永久忙轮询。
- 用户点击“立即同步”。

退避：网络/503/429 使用带 jitter 的指数退避，最大 5 分钟；鉴权失败暂停并要求重新登录；schema rejected 不自动重试。

## 9. 首次启用与已有数据

### 9.1 用户确认

提示词可能包含个人内容。桌面首次登录同一账号时显示一次明确选择：

- “启用提示词云同步”：上传本地提示词并合并云端库。
- “暂不启用”：桌面仍保持纯本地，Web 云库不受影响。

选择会按账号保存；启用后自动同步，可在设置中暂停。暂停不删除云端数据，也不丢弃新的本地修改。

### 9.2 初始合并

1. 注册 device，完成 cloud bootstrap。
2. 云端实体写入本地；id 不冲突的本地实体保持不变。
3. 为所有从未同步的本地活动 folder/tag/prompt 生成 create mutation。
4. 依赖顺序为 folder parent、folder child、tag、prompt。
5. 本地已删除且从未同步的实体不上传墓碑。
6. 相同 id 且内容相同直接建立 entity state；内容不同进入冲突，不按时间覆盖。

### 9.3 关闭与重新启用

- 关闭只停止网络同步，不清理 `cloud_entity_state/outbox/conflicts`。
- 关闭期间的本地修改仍写 outbox，界面显示“等待同步”，避免重新启用后遗漏。
- 重新启用先 pull，再 push。
- “从云端重新构建”是独立的破坏性操作，执行前必须备份本地提示词并二次确认。

## 10. 冲突处理

### 10.1 冲突条件

- 本地 update 的 `baseVersion` 小于服务端当前 version。
- 本地 update 遇到服务端墓碑。
- 本地 delete 遇到服务端已更新实体。
- bootstrap 发现同 id、不同内容且没有已知同步基线。
- folder/tag 删除与仍在使用的 prompt 关系冲突。

### 10.2 UI 决策

每条冲突保留本地和云端完整快照，用户可以选择：

| 选择 | 行为 |
|---|---|
| 保留云端 | 丢弃冲突 mutation，以 remote snapshot 覆盖本地并标记 clean |
| 保留本地 | 以 remote 当前 version 生成新的 update/restore mutation，明确覆盖云端 |
| 保留两份 | 原 id 接受 remote；本地快照使用新 ULID 创建“标题（本地副本）” |

删除冲突也使用同一三选一逻辑。任何选择都可审计，且不会直接修改历史 mutation 记录。

### 10.3 Web 编辑冲突

Web `PATCH /prompts/:id` 同样携带 `expectedVersion`。409 时编辑器保留草稿，显示服务端新版本；用户选择重新加载、覆盖或另存为副本。Web 不因其 cloud-first 身份获得无条件覆盖权限。

## 11. 删除、恢复和墓碑

- delete 把 `deletedAt` 设为服务端时间、version + 1，并写 delete change。
- 恢复是显式 mutation，version 再 + 1，并写 upsert change。
- 普通列表默认不返回 deleted；回收站通过 `includeDeleted=true` 查询。
- Prompt 墓碑至少保留 180 天；正文在 30 天恢复期后可从主表清除，但保留最小 tombstone：id、owner、version、deletedAt。
- Folder 删除默认把活动 prompt 移到未分类，并在同事务为受影响 prompt 写变化；P0 不级联删除提示词。
- Tag 删除移除关系，并为受影响 prompt 写聚合变化。
- 设备 cursor 过期后必须 bootstrap，不能只从“最后看到的时间”猜测删除。

## 12. 多标签页与多 Web 设备

- Web 所有写入直接落云端，不建立浏览器离线主数据库。
- TanStack Query 或等价 query cache 只做缓存；窗口重新聚焦时 revalidate。
- Web 编辑草稿可以保存在 IndexedDB，但草稿不能伪装为已同步。
- 同账号多标签页通过 `BroadcastChannel` 通知缓存失效；服务端 version 仍是最终并发控制。
- 后续可复用 `/sync/pull` 做低频实时刷新，但 P0 不要求 Web 保持永久同步连接。

## 13. 隐私与安全

- sync API 必须使用 HttpOnly session，桌面 cloud client 使用账号服务颁发的设备会话，不保存 Web Cookie 明文到普通配置。
- 所有查询同时带 owner 条件并受 PostgreSQL RLS 保护。
- 普通日志不记录 mutation payload、prompt snapshot 或正文 hash。
- rejected 响应只返回字段级安全错误，不回显未经清洗的完整 payload。
- 设备可以在账号页撤销；撤销后 push/pull 返回 401/403，不能继续同步。
- 客户端数据库导出需明确包含同步元数据；导入到另一账号时必须清除 owner/device/cursor，按新本地数据处理。

## 14. 性能边界

| 项目 | P0 限制 |
|---|---:|
| 单用户提示词 | 50,000 |
| 单次 bootstrap page | 200 |
| 单次 pull changes | 默认 200，最大 500 |
| 单次 push mutations | 最大 100 |
| 单次 push body | 最大 512 KiB |
| prompt params | 最大 32 KiB |
| sync change 保留 | 至少 180 天 |

服务端必须使用 `(owner_id, seq)`、`(owner_id, entity_type, entity_id)`、`(owner_id, device_id, mutation_id)` 索引。bootstrap 和 pull 不允许 offset 分页。

## 15. 测试矩阵

### 15.1 协议测试

- create/update/delete/restore 的 version 和 change_seq 单调。
- 同一 mutation 重放 10 次只产生一次业务变化。
- pull 页在本地事务失败后重试不漏、不重。
- cursor 过期正确进入 bootstrap。
- 标签关系变化只产生规范化 prompt snapshot。

### 15.2 桌面集成

- 离线创建 100 条后恢复网络，按依赖顺序全部上传。
- push 响应丢失后重试，服务端返回 duplicate，本地正确清 outbox。
- pull 应用不产生回声 outbox。
- 关闭同步期间修改，重新启用后不遗漏。
- preview/cover 本地路径从不出现在 HTTP body。

### 15.3 冲突

- Web 和桌面从同一 version 修改正文，后提交方收到冲突。
- 保留云端、保留本地、保留两份三条路径均无内容丢失。
- 一端删除、另一端离线编辑时不会静默复活。
- folder/tag 删除与 prompt 关系得到确定结果。

### 15.4 隔离

- owner A 的 cursor、device、mutationId 和实体 id 无法读取 owner B 数据。
- 猜测实体 id、asset id 或 cursor 都不泄露资源存在性。
- 被撤销 device 不能继续 pull/push。

## 16. P0 验收场景

1. 桌面 A 登录并启用同步，已有本地提示词上传；Web 刷新后完整可见。
2. Web 创建、编辑、收藏和删除提示词；桌面 A 自动拉取一致状态。
3. 桌面 B 首次登录完成 bootstrap，得到同一云库且不产生重复条目。
4. 桌面 A 离线编辑，Web 同时编辑同条提示词；A 恢复网络后出现可处理冲突。
5. 用户选择“保留两份”，Web 和两台桌面都最终看到两条完整内容。
6. 任意 sync 请求重放、API 重启或网络中断都不丢数据、不重复 mutation。
7. 删除状态在离线超过一个月的设备重新上线后仍然正确；游标过期时完整重建。

