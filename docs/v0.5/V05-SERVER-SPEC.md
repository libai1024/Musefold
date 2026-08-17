# V05 · 服务器部署与运营规范（Musefold Cloud 中转站）

> **状态**：设计规格（待评审；部署待运营者提供服务器后执行）
> **日期**：2026-08-13
> **选型**：[new-api](https://github.com/QuantumNous/new-api)（AGPL-3.0；2026-08 约 45k star；v1.0.0 已发布）。**原样部署、不改源码**（NFR-LEGAL-01）。
> **安全前提**：本文档与仓库任何文档不得写入真实域名之外的敏感信息——上游 Key、管理员密码、兑换码一律不入库（延续「文档不含密钥」纪律）。

---

## 1. 拓扑与选型

```text
用户 App ──HTTPS──▶ 反向代理（Caddy，自动证书）
                      └─▶ new-api:3000 ──▶ PostgreSQL（账号/令牌/日志）
                                        ├─▶ Redis（缓存/限流）
                                        └─▶ 上游渠道（TvT 等第三方中转站，仅出网）
```

| 项 | 基线 | 说明 |
|---|---|---|
| 实例 | 阿里云 ECS 2C4G 起步 | new-api 为 Go 单体，转发为主，2C4G 支撑内测规模富余 |
| 系统 | Ubuntu LTS + Docker / Docker Compose | |
| 数据库 | PostgreSQL 16（容器 + 数据卷） | 不用 SQLite——便于备份与后续多实例 |
| 缓存 | Redis 7 | new-api 官方 compose 自带 |
| 入口 | Caddy（或 Nginx + certbot） | 只对外暴露 443；3000 端口仅监听容器网络 |
| 域名 | OQ-05：大陆地域须 ICP 备案；免备案可选港区 | App 的 `DEFAULT_ACCOUNT_SERVER_URL` 待此定稿 |

---

## 2. 部署清单（V05-SRV-01）

`docker-compose.yml` 骨架（以 new-api 仓库自带 compose 为基准做如下固化）：

```yaml
services:
  new-api:
    image: calciumion/new-api:v1.x.x        # 固定版本 tag，禁用 latest（升级见 §6）
    restart: always
    ports:
      - "127.0.0.1:3000:3000"               # 仅回环，经 Caddy 出公网
    environment:
      - TZ=Asia/Shanghai
      - SQL_DSN=postgres://newapi:<强密码>@db:5432/newapi
      - REDIS_CONN_STRING=redis://redis
      - SESSION_SECRET=<随机 64 hex>         # 重启会话不失效
    volumes:
      - ./data:/data
    depends_on: [db, redis]
  db:
    image: postgres:16
    restart: always
    environment:
      - POSTGRES_USER=newapi
      - POSTGRES_PASSWORD=<强密码>
      - POSTGRES_DB=newapi
    volumes:
      - ./pgdata:/var/lib/postgresql/data
  redis:
    image: redis:7
    restart: always
```

部署步骤：

1. 服务器初始化：升级系统、装 Docker、开启防火墙（仅放行 22/80/443）、SSH 密钥登录 + 禁密码登录。
2. 起 Caddy：`api.<域名>` 反代 `127.0.0.1:3000`（自动 HTTPS）。
3. `docker compose up -d`；首次访问 `https://api.<域名>` 走初始化引导，设置 root 账号（强密码，仅运营者持有）。
4. 立即完成 §3 配置基线，再进行 §7 烟测。

---

## 3. new-api 系统配置基线（V05-SRV-02 / FR-SRV-02）

后台「系统设置」逐项核对：

| 配置 | 值 | 决策 |
|---|---|---|
| 允许新用户注册 | ✅ 开 | D4 |
| 邮箱验证注册 | ❌ 关 | D4（App 内注册只有用户名+密码） |
| Turnstile / 人机校验 | ❌ 关 | 会卡死 App 内注册；滥用由 D5 + 限流化解 |
| 第三方 OAuth（GitHub/微信/OIDC 等） | ❌ 全关 | v0.5 App 不支持，避免网页/App 账号形态分裂 |
| 新用户初始额度 | **0** | D5 |
| 兑换码功能 | ✅ 开 | 唯一充值方式 |
| 在线充值/易支付 | ❌ 关 | 范围外（v0.6 候选） |
| 全局限流（RelayRateLimit 等） | ✅ 开，保守值（如 60 req/min/token） | 防滥用兜底 |
| 日志记录消费正文 | ❌ 关（仅计量日志） | FR-SRV-06 / NFR-PRIV-01 |
| 公告/关于页 | 填写服务说明 + 管理员联系方式 | 支撑「忘记密码联系管理员」文案 |

留存核对截图进入包外发布证据（不含敏感值）。

---

## 4. 渠道与模型（V05-SRV-03 / FR-SRV-03）

1. **渠道 · 上游中转站**：类型 OpenAI，Base URL 填上游站地址，密钥填上游 Key（仅存服务器）。模型列表放通计划提供的全部文本模型 + `gpt-image-2`。
2. **默认模型别名（D6）**：在渠道「模型重定向」中配置：

```json
{
  "musefold-agent": "gpt-5.5",
  "musefold-image-pro": "gpt-image-2"
}
```

并把两个别名加入渠道模型列表与用户分组可见模型，保证 `/v1/models` 会返回它们（App 托管记录默认模型即别名，FR-GW-07）。

3. **倍率与分组**：默认分组即可；模型倍率按上游成本 + 期望毛利设定（运营者决定，文档不定价）。
4. **⚠️ 改别名必须同步定价（2026-08-13 实测教训）**：渠道里修改/新增模型别名后，必须同时在「倍率设置」里为**新名字**补 `ModelRatio`/`CompletionRatio`（文本）或 `ModelPrice`（生图）条目——**未定价的模型会从 `/v1/models` 中消失且调用报错**（HTTP 400"价格尚未配置"），对全体用户立即生效。别名是与 App 的契约（D6），改名属于破坏性变更，需确认 App 端兜底常量同步。
5. **上游可替换演练（G4 验收）**：新增第二渠道或改别名指向 → 老客户端请求无感知成功。
6. **悟空生图组不接入**——非 OpenAI 协议（范围外，见需求 §8）。

---

## 5. 运营 SOP（V05-SRV-04/05）

### 5.1 兑换码

1. 后台「兑换码」→ 批次生成：命名 `批次-日期-面额`（如 `beta-0901-500`），单批 ≤ 100 张。
2. 发放台账（线下表格）：码 → 接收人 → 日期；**兑换码明文不进任何仓库文档**。
3. 面额规划：内测建议小面额多批次，便于回收失控成本。

### 5.2 密码重置（替代自助找回，D4 代价）

1. 用户经「关于/帮助」里的联系方式找到管理员，提供用户名 + 辅助身份证明（如兑换码后 4 位/注册时间）。
2. root 后台「用户管理」→ 编辑该用户 → 重置密码 → 经原联系渠道回传临时密码，嘱咐立即在网页控制台修改。
3. 台账记录重置事件（时间/用户名/操作者）。

---

## 6. 备份、升级与监控（NFR-OPS-01）

| 项 | 做法 |
|---|---|
| 备份 | 每日 cron：`pg_dump` + `tar ./data` → 本地保留 14 天 + 异地（OSS/对象存储）各一份；每月做一次恢复演练 |
| 升级 | 锁定镜像 tag → 变更前 `pg_dump` → 修改 compose tag → `docker compose up -d` → 跑 §7 烟测 → 失败则回滚旧 tag + 恢复 dump；**升级前读 new-api release notes（AGPL 与 schema 变更）** |
| 监控 | 最低配：`docker compose ps` 健康检查 + Caddy 访问日志；建议加 Uptime 探针打 `/api/status`（对外可用性）与磁盘告警 |
| 安全 | fail2ban（SSH）、root 后台账号开 2FA（网页侧支持，不影响 App 用户）、定期轮换上游 Key |

---

## 7. 烟测清单（V05-SRV-05 出口 / P1 门禁）

以下脚本化执行（占位符自替），全部通过才算服务器就绪；证据（脱敏输出）进入包外发布系统：

```bash
BASE=https://api.<域名>

# 1 注册
curl -sf $BASE/api/user/register -H 'Content-Type: application/json' \
  -d '{"username":"smoke01","password":"<测试密码>"}'
# 2 登录（留 cookie）→ 换 access_token
curl -sf -c /tmp/na.jar $BASE/api/user/login -H 'Content-Type: application/json' \
  -d '{"username":"smoke01","password":"<测试密码>"}'
AT=$(curl -sf -b /tmp/na.jar $BASE/api/user/token | jq -r '.data')
# 3 建令牌 → 取 sk
curl -sf $BASE/api/token/ -H "Authorization: $AT" -H 'Content-Type: application/json' \
  -d '{"name":"smoke-device","unlimited_quota":true,"expired_time":-1}'
SK=<从创建响应或列表取回>          # ← OQ-01 验证点
# 4 零额度断言：chat 应返回额度不足错误（记录错误体 → OQ-02 golden）
curl -s $BASE/v1/chat/completions -H "Authorization: Bearer $SK" -H 'Content-Type: application/json' \
  -d '{"model":"musefold-agent","messages":[{"role":"user","content":"ping"}]}'
# 5 兑换 → 余额断言
curl -sf $BASE/api/user/topup -H "Authorization: $AT" -H 'Content-Type: application/json' \
  -d '{"key":"<测试兑换码>"}'
curl -sf $BASE/api/user/self -H "Authorization: $AT" | jq '.data.quota'
# 6 模型列表含两个别名
curl -sf $BASE/v1/models -H "Authorization: Bearer $SK" | jq '.data[].id' | grep musefold
# 7 文本别名调用成功
# 8 生图别名调用成功（/v1/images/generations, model=musefold-image-pro）
# 9 图生图/精修经中转成功（/v1/images/edits，multipart 带 image 文件 + 别名模型）
#   —— 2026-08-13 已实测通过（红叶→金叶）；App 的精修/多图输入依赖此路径
```

烟测同时产出三份 golden 快照给 V05-ACC-01：登录/令牌响应、额度不足错误体、topup 响应。

---

## 8. 合规与许可

| 项 | 结论 |
|---|---|
| AGPL-3.0 | 原样运行不产生开源义务；**若修改 new-api 源码并对外提供服务，必须向用户提供修改后源码**——v0.5 明确不修改（NFR-LEGAL-01） |
| ICP 备案 | 大陆地域 ECS 挂域名提供 HTTP 服务需完成备案后方可上线；否则选免备案地域（OQ-05 一并定稿） |
| 上游条款 | 转售/二次分发上游中转站能力前确认其服务条款允许；上游 Key 泄露风险由「仅存服务器 + 定期轮换」控制 |
| 用户隐私 | 服务器不留存请求正文（§3）；隐私说明在 App 内明示"账号模式下请求经由 Musefold Cloud 转发"（NFR-PRIV-01） |
