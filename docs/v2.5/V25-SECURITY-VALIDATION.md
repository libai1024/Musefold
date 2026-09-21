# v2.5 发布内容扫描与运行出口验证

> 2026-09-07 B10 实施记录；G-RELEASE-03 **仍为部分完成**。本文区分扫描器能力、实际受检内容和未验证范围。最终统一门禁、构建身份见 [开发记录](./V25-DEVELOPMENT-LOG.md)；任务定义见 [任务卡](./V25-MIGRATION-GOALS.md)。没有执行生产密钥扫描、真实账号登录或付费调用。

## 1. 输出边界

| 数据 | 允许的位置 | 本轮验证方式 |
|---|---|---|
| Provider Key、Bearer、会话密钥、私钥 | 主进程/服务端受控内存及规定的加密存储；授权请求的请求头 | 禁止出现在保存后的渲染状态、SQLite/WAL/备份、日志、IPC/HTTP/MCP 返回、发布包；使用合成 canary，不读取用户个人 secret store |
| 构建机用户目录 | 构建过程内部 | 发布包检测本次构建用户目录及其编码；扫描发现依赖收集器带入 workspace 测试与 Turbo 日志，已修 builder 过滤 |
| 用户已授权的本机文件路径 | 桌面本机文件功能、内部诊断与备份定位 | 不将正常本机路径访问机械判为漏洞；面向远程或应当无路径的响应另启 `detectUserPaths` |
| 用户 Prompt 正文 | 当前 owner 正常业务查询与操作 | 本轮只用合成内容；正常查询返回正文与日志泄漏分别判断，不用禁止所有正文的规则破坏功能 |
| Chromium Singleton 锁 | 临时进程协调链接 | 真实 Electron live 扫描明确登记三种符号链接排除，不读取链接指向的系统临时目录；已关闭进程的数据目录仍全量检查 |

## 2. 已实现的扫描入口

实现：[内容规则](../../scripts/security/content-scan.mjs)、[文件与归档扫描](../../scripts/security/artifact-scan.mjs)、[CLI](../../scripts/security/scan.mjs)、[平台产物扫描](../../scripts/security/scan-packages.mjs)。规则版本由代码中的 `RULESET_VERSION` 记录。

- 内置规则检测特定 Provider/GitHub/AWS/Slack token 形状和私钥头；规则不能识别所有未知凭据格式。动态场景通过明确的合成 canary 补充。
- canary 同时检查 UTF-8、UTF-16LE、JSON 字符串转义、URL 编码和 Base64。文件名也受检，报告里的可逆编码同样脱敏。
- 文件按块扫描，保留跨块重叠；SQLite/WAL、二进制和文本均读实际字节。
- ZIP 包括压缩及未压缩条目，asar 包括真实 unpacked 原生模块，`.musefold.design` 可以嵌套。归档扩展名不区分大小写，另检测 ZIP 文件签名、asar 结构化头和常见压缩容器魔数，改名为 `.bin` 也递归或拒绝；不保证识别任意前导/嵌入式 polyglot 或所有未知格式。拒绝越界、重复路径、异常大小、外部链接及未支持的压缩容器，不以文件名存在判成功。
- ZIP 使用逐条、限量读取；真实旧 ZIP 暴露过未压缩条目迭代悬挂，已改为 `data/end` 读取并补回归与读取超时。过期失败调用留下的本轮临时挂载、解包目录已清理。
- source 模式只从 Git 受管/未忽略清单收集应用、包、脚本、测试、tooling、infra、workflow 和根构建配置；不发现 userData、忽略的 `.env` 或仓库外凭据。复制前拒绝越界符号链接。
- 单项报告含规则、目标 ID、脱敏相对位置、匹配哈希；不输出匹配正文或原始解析器异常。例外需准确目标、文件身份、规则、匹配哈希与理由，未命中旧例外也失败；当前实际扫描未使用 secret/path 例外。
- 必扫目标缺失/为空会失败。live 运行目录中允许为空的子目录须由调用方明确声明，报告仍记录空目录。发布目标没有此放宽。

源码扫描：

```bash
node scripts/security/scan.mjs source --report tests/v25/.results/security/source.json
```

显式计划扫描（JSON 内容由测试生成，含 `targets`、可选 `canaries`、`exceptions`）：

```bash
node scripts/security/scan.mjs plan --plan path/to/task-plan.json --report tests/v25/.results/security/plan.json
```

canary 必须是本任务生成的假值，不把真实密钥写到计划文件或命令行。输出报告只含哈希与脱敏结果。计划路径必须对应任务自己的数据和产物。

## 3. 发布产物与身份

在本平台构建完成、package-smoke 通过后执行：

```bash
node scripts/security/scan-packages.mjs tests/v25/.results/package/security.json
```

- macOS：扫描 App 目录、ZIP 解包内容、经 `hdiutil verify` 后只读挂载的 DMG 内容。DMG 的 `/Applications` 安装快捷方式单独登记为系统链接，不读取用户应用目录；其他携带内容受检。成功与失败均卸载本次挂载。
- Windows：显式匹配本版本/架构 NSIS 安装器，使用 `7z` 解包安装器及应用 payload，同时扫描 win-unpacked。解包前创建私有快照，解析 `7z l -slt -ba`，校验路径、ADS、保留名、大小写冲突、链接及单项/累计资源上限；installer 与所有嵌套包共享预算。解包后逐项比对清单、大小和真实链接；失败写脱敏 fatal 报告。缺工具、缺包、解包失败或剩余未支持压缩容器会失败。**本轮没有 Windows 运行结果**，不能由 macOS 继承。
- DMG/ZIP/NSIS 内的 asar、CLI、MCP 必须匹配当前 App 的对应 SHA-256，缺文件或旧内容失败。package-smoke 另负责当前 desktop bundle 与运行 asar 的字节一致性。
- 用户目录检测使用构建机器实际 home 前缀；第三方依赖文档中的示例路径不直接等同于泄漏。本轮旧包的实际构建目录命中来自 workspace 测试及 `.turbo` 日志，修复方法是停止打入这些文件，而非添加扫描例外。
- [builder 配置](../../apps/desktop/electron-builder.yml) 已排除已被 electron-vite bundle 的 workspace 依赖副本、`__tests__` 和 `.turbo`；Windows 安装器文件名明确带版本与架构。未删除源码测试，也未修改版本号。

PR/Main/Release 的 verify job 都执行 source 扫描并始终上传报告；Release 两个平台 package job 在冒烟后执行实际产物扫描。两个发布 job 都依赖这些门禁。关系由 [发布依赖测试](../../tests/repo/v25-release-gates.test.ts) 验证；**本轮尚未触发远程 CI**。

## 4. 本轮实际结果

| 检查 | 当前结果 | 证明范围 |
|---|---|---|
| scanner 与 workflow 单测 | `pnpm exec vitest run tests/repo/v25-security-scan.test.ts tests/repo/v25-release-gates.test.ts`：2 文件、39/39 | canary/编码/二进制/WAL/备份、嵌套包、未压缩 ZIP、缺目标/旧包/越界/例外、CI 依赖；后续新增测试时以开发记录更新 |
| Windows 解包与扫描门禁专项 | `pnpm exec vitest run tests/repo/v25-installer-extraction.test.ts tests/repo/v25-security-scan.test.ts tests/repo/v25-release-gates.test.ts`：3 文件、75/75，0 skipped | 其中 3 项在 macOS arm64 使用真实 7zz，覆盖普通包、跨包累计预算、小压缩体积/大展开体积；不是 Windows/NSIS 实机结果 |
| source 初次扫描 | 退出 0；随后补根配置范围后再扫仍通过 | 当时 working tree；不代表全部二进制或运行出口 |
| 旧 macOS App | 找到 workspace 源码/日志中的构建机路径；扫描结果失败 | 首次完整实际内容检查，没有把失败改成 pass |
| builder 过滤后的 App | 16,134 条文件扫描记录，0 findings、0 errors；打包清单中 workspace 副本/测试/Turbo 日志为 0 | 使用 B9 已有 desktop bundle + 新打包过滤的阶段产物；**不是 B10 全源码最终包** |
| 旧 DMG 与 ZIP | 完整扫描退出 1，20 条构建路径命中；0 读取错误 | 新 App 通过不能掩盖仍旧的安装器；证明 gate 确实拒绝旧包 |
| 真实 Electron 运行出口 | `pnpm exec playwright test tests/v25/electron.security.spec.ts -c tests/v25 --project=electron`：1/1，退出 0 | 真窗口/IPC、合成密钥保存与轮换、授权 `/models` 探测、上游错误返回、删除后不再访问、渲染保存后状态、实际 SQLite/WAL/备份、进程日志；初次使用 B9 bundle；B10 全量 E2E 重新构建后此用例再次通过，完整报告 224 passed/8 skipped/0 failed/0 flaky，归档 `tests/v25/.results/b10/e2e/` |
| 过滤后 App/DMG/ZIP 复扫 | 退出 0，6 个目标，0 findings、0 errors；三份 App 内容均通过 3 项 SHA-256 身份校验 | DMG 与 ZIP 已重新生成；使用 B9 desktop bundle + 新打包过滤，仍须 B10 全源码最终重建 |
| B10 最终 source 扫描 | 退出 0；1073 文件、11,028,502 字节；0 findings/errors/accepted exceptions | 格式修复后冻结的本批源码/配置；`tests/v25/.results/b10/security-source-final.json` |
| B10 最终新包扫描 | 退出 0；6 目标、0 findings/errors/accepted exceptions；三份 App 各 3 项 SHA-256 验证 | 新 ad-hoc App/DMG/ZIP；App 和 DMG 内 App 各 16,077 条文件记录，ZIP 含归档自身 16,078 条；包内 CLI/MCP/asar 身份匹配，`tests/v25/.results/b10/security-installers-final.json` |
| B10 统一门禁与真实包 | `check` 35/35；E2E 224 passed/8 skipped/0 failed/flaky；严格 package-smoke 1/1、0 skip | 当前 bundle 字节、8 条受管迁移、费用新表、数据库完整性与重启持久化；详见开发记录的失败及平台限制 |

真实 Electron 用例见 [运行出口测试](../../tests/v25/electron.security.spec.ts)。它不发送生成请求，不登录真实账号，不读取实际 API Key；只在独立 userData、回环假服务和测试生成的 canary 下运行，结束清理数据。测试保存的是扫描摘要，不保留合成原始请求头或 canary。

## 5. 仍须完成的验收

1. B10 本地统一 `check`、双端 E2E、macOS arm64 package-smoke 和对应 App/DMG/ZIP 扫描已通过（见下表最终行与开发记录）。未来源码变更后须重跑相应门禁；本批通过不覆盖整包后续开发或其他平台。
2. Windows x64/arm64 自身构建、运行、解包与内容扫描；正式签名/公证与安装体验另验。当前本机只验证 macOS arm64。
3. 真实登录/退出、生成失败、方案导入/导出、Automation 与云 HTTP/MCP 的更多动态 canary 出口，账号轮换/撤销与安全存储不可用矩阵。现有就地负例仍保留，不能把单条连接 E2E 当成这些全部通过。
4. API/Worker/Web 镜像内容、对象存储 staging 与专用包的新云运行出口，按任务归属加入明确扫描计划和实际结果。
5. 扫描器按既定格式与假值检测内容泄漏，**不是依赖漏洞扫描、恶意代码检测、完整密码学审计或所有未知编码的保证**；需要新增规则的入口应补正负例，不扩大“无命中”的结论。

本卡没有引入管理员审批、Cloud MCP 花费工具或生产发布动作。完整迁移保持未闭合。

## 6. B12 账号恢复实现检查点（2026-09-08 01:46）

本段只补充当次源码与真实宿主结果，不替换上文 B10 产物的历史身份。

| 检查 | 实际结果 | 范围与证据 |
|---|---|---|
| source 内容复扫 | 1114 文件、11,748,874 字节；0 findings/errors/accepted exceptions，退出 0 | `tests/v25/.results/b12/security-source-verified.json`；v25-content-1，不是依赖漏洞审计 |
| 新账号安全边界 | API 全集成 123 passed，其中身份 39、OAuth lineage 12；桌面账号/桥接 43 passed，其中会话 20 | 本地 HTTP 假上游、真实临时 PG/文件；固定 issuer/epoch、受限权限、迟到响应不覆盖新会话、原始 bearer 不枚举、OAuth 撤销后迟到 token 不复活权限 |
| 全量真实宿主 | E2E 239 passed/8 skipped/0 failed/0 flaky；含真实 Electron 运行出口用例与新增账号/本机库恢复 | `tests/v25/.results/b12/e2e-verified/`；8 skip 与原生窗口/Windows 边界见开发记录，不升级为真实账号或付费调用证据 |
| 源码身份 | 1210 项，check/E2E 后无漂移，摘要 `6bc9e7fc6925d13b10b26ce1a9f8a225d7fd046c80c4c4eb92abf92cbb61c442` | `tests/v25/.results/b12/source-files.json`，dirty 工作树，不是 clean release commit |

P1 尚缺 COMMIT/cookie/真实登录断连、两真实 API PID 刷新和可信备份恢复的完整矩阵；P2/3 尚未将付款绑定接到入队与 worker 实际发送。此检查点之后新增功能另验。B12 尚无当前源码 App/DMG/ZIP、Windows、生产或远程 CI 安全报告；B10 包扫描不能继承为 B12 通过。

B10 中间包严格冒烟另有一次失败：当前受管 SQLite 已有 8 条迁移，而旧 B9 bundle 只有 7 条。该失败保留，证明旧构建不能代替本批源码验收；最终 B10 重建后严格冒烟已通过 8 条迁移与新费用表；未修改迁移数量断言迁就旧包。

## 7. B12 备份与移动操作接续检查点（2026-09-08 02:33–02:41）

源码冻结1223项，摘要 `c19604bbf4ed04194700da5a7be0445c726b9598dcfaf2841fd5d467af66ae1a`，完整check和E2E后均无漂移。source扫描1127文件、12,062,445字节，0 findings/errors/accepted exceptions、退出0；规则仍为v25-content-1。报告 `tests/v25/.results/b12-followup/security-source.json`，统一摘要 `tests/v25/.results/b12-followup/validation-summary.json`。

完整API集成162项、worker集成55项通过；含受控profile、实际隔离CLI核对/暂存、固定issuer/owner/key验证、lease/CAS与密文消费/过期清理，以及COMMIT、cookie和两真实API PID的竞争/丢包证据。实际生产历史来源没有被本轮合成fixture核实；源记录完整性摘要不能独立证明发行者真实性。错误当前加密key、FIFO受控文件读取、异常备份不阻断合法原设备恢复已有回归。

check35/35和完整E2E242 passed/7 skipped/0 failed/0 flaky通过，E2E报告errors为空；沿用真实Electron秘密出口测试。7skip与平台边界见开发记录。真正refresh保存间隙的SIGKILL增量在本检查点后另验，生产源码不变也不重写本次清单；当前没有B12新安装包、镜像全集、Windows、正式签名、CI或生产安全报告。

## 8. P1最终测试增量（2026-09-08）

最终API164项、check35/35通过；source扫描1127文件、12,089,052字节，0 findings/errors/accepted，退出0。源码1223项摘要 `d7bd41e626af7317a6f014017549f1bc3ee90a33478be9bd2fbf951487adc7b7` 在API/check后无漂移，报告 `tests/v25/.results/b12-p1-final/validation-summary.json`。相对§7仅三个API测试/fixture变化，生产/schema/宿主/E2E源码字节相同；242项E2E与55项worker保持原命令与清单，不宣称重复执行。

新增live与backup保存前SIGKILL、新PID及自然30/120秒lease验证已通过，仍须明确重新登录或独立空间恢复。首次合跑失败为同一测试PG的JWKS被不同合成BA secret读取造成500，已统一测试部署配置并保留JWKS/加密，未改生产；原失败/诊断/报告格式失败见开发记录。该测试不是JWKS密钥轮换功能验收，真实来源、安装包、CI及生产的未验边界不变。


## 9. B13 执行回执与固定身份发送（2026-09-08）

本批 `node scripts/security/scan.mjs source --report tests/v25/.results/b13/security-source.json` 实际退出 0：1147 文件、12,461,286 字节，0 findings/errors/accepted，ruleset `v25-content-1`。源码清单 1243 项、摘要 `bec320e638a2b1dd413b22c40375fe35d8db7fbf29cf2bf576d24a6ff7285eeb`，完整 API/check 后复核无漂移。扫描范围为源码/配置；它与含 resources 的清单范围不同，不是安装包扫描。

API 的 188 项与 worker 的 83 项集成通过；三入口在同一事务冻结可信 binding/真实 BA 授权/摘要/receipt，素材读取在授权锁外完成并在入队前重核元数据。worker 最后 claim 返回固定凭据和可信 endpoint，后续不查最新 key；历史缺绑定不自动补付款人，claimed 不确定保持 unknown，purge 留存最小去重证据。正式 bin 的五个实际 PID 均未在捕获输出泄露合成秘密，停机连接回收有断言；本批发现并修复 Graphile 与入口重复 stop。详细证据和手动加速租约的限制见测试手册 §5.6。

全仓 check 实际 35/35、0 cached。没有 B13 新 E2E、App/DMG/ZIP/Windows、部署容器或生产安全报告，不继承旧包结果；P4 桌面托管和 P5/P6 费用恢复仍须逐阶段验收。API/worker 必须按数据迁移 §7 联合升级、排空旧 worker 后启用；只升级 schema 不构成旧执行器安全证据。


## 10. B14 同源资产下载支撑（2026-09-08）

新增GET只接受assetId，先查所有者和run，再读受管S3；30MiB/30秒读取约束、完整图片解码、PG原checksum与元数据前后比对、no-store/nosniff/固定附件名均有真实PG/HTTP证据。非法id/query、无登录/受限恢复会话/跨owner均前置拒绝；空404分类审查问题已修复，错误体不会进入SDK XML解析或回显对象key/endpoint。真实临时API HTTP listener的客户端断开会关闭S3连接，测试在独立2秒窗口确认；此证据不是生产bin/容器。

source扫描1151文件、12,496,956字节，0 findings/errors/accepted、exit0；完整1247项源码摘要 `389ac3ff537775777eea4de7c72b3e4c75a292e94802d7f13fa235e58e5d2c72` 在API/check后无漂移。完整API211项、全仓check35/35（28cached）通过；限定API Biome为exit0且1条非阻断warning。统一报告 `tests/v25/.results/b14/validation-summary.json`，具体范围/失败记录见测试手册 §5.7。

Sharp解码保留独立10秒timeout，不能即时abort；最后元数据核对后的purge不能撤回已交付字节。没有新E2E、安装包/Windows/容器或生产扫描，不继承旧包结果。桌面托管提交与备份防回退仍待实现，Cloud MCP和用户花费授权范围没有扩展。


## 11. B15 本地防回退基础（2026-09-08）

最终 source 扫描 1162 文件、12,616,719 字节，0 findings/errors/accepted，exit 0；[报告](../../tests/v25/.results/b15/security-source.json)与[源码清单](../../tests/v25/.results/b15/source-files.json)对应摘要 be7e16cb31f1f54488efd403e1e96ae2d2ddc707e2c5ff48bc41da6cbd4a3edc。全仓 check 与 52 项专项通过；Electron 81 passed/2 skipped，最终重建的 21 项桌面文件与所测产物字节一致，详细适用范围见测试手册 §5.8。

新增控制文件限制大小、固定错误、临时文件 flush/原子替换及链接/非普通文件拒绝。仅测试注入合成加密器，正式 safeStorage、预算全入口和备份恢复尚未接线；core 协议不单独提供发送授权。目录须单宿主独占，DB 与锚同时回退无法本机识别，Windows 原生/断电未验。本批未运行依赖漏洞审计、安装产物扫描、生产部署或真实付费调用。


## 12. B16 正式恢复与安全存储（2026-09-08）

正式锚直接使用safeStorage，不走E2E明文fallback，拒绝不可用/Linux basic_text；Windows等待密钥记录有20秒期限，原生Windows与断电仍未验。正式恢复在数据库访问隔离、托管排空和停同步后，保留独立安全副本并写restore_pending；同PID不能惰性重开替换库。用户失败出口与真实Electron重启均有本机证据，托管远端关联和预算链尚未接入。

最终source扫描1167文件、12,653,335字节，0 findings/errors/accepted，exit0；[报告](../../tests/v25/.results/b16/security-source-final.json)。源码1263项摘要bd0343b02397c79f41cef13cb9f82ee65bc41f8b7d2ee0abd35dec580578ddb4在check/E2E后无漂移；check35/35、完整E2E244passed/7skipped/0failed/flaky，见[统一摘要](../../tests/v25/.results/b16/validation-summary.json)。无真实付费调用、新安装包扫描、依赖漏洞审计或生产部署。


## 13. B17 关联与回执核心（2026-09-08）

严格输入拒绝 token/headers、任意本机 ID 与不支持参数；关联保存非秘密 binding，查询按原 issuer/principal 隔离。首次提交资格不从数据库记录重建，回执按 key/身份/run/revision 校验；SQLite/审计失败不释放 unknown 预算。实际支付与正式宿主接线仍待完成。

source 扫描1178文件、12,798,674字节，0 findings/errors/accepted，exit0；[报告](../../tests/v25/.results/b17/security-source.json)。1274项源码摘要b8b9c7a2448a7cd243946502cb9aac8efe931f353ca47058f4b767c3d93742d7，最终check/API/Electron后无漂移；[统一摘要](../../tests/v25/.results/b17/validation-summary.json)。未执行新安装包扫描、依赖漏洞审计、Windows原生、真实付费或生产部署。核心与合成授权集成不能替代正式用户授权链的验收。

## 14. B18：固定账号与受限主进程 HTTP（2026-09-08）

账号切换先同步作废旧捕获，再等待慢订阅者；网络与异步准备后重查持久会话。客户端只构造原issuer的内部路径，bearer仅在主进程设置，请求不接受任意URL/headers，禁止redirect，JSON限制1MiB与完整期限。旧401不清新登录，提交不确定/404不能转为新POST或零费用；恢复排空中止HTTP并使旧对象失效。

source扫描1180文件、12,830,476字节，0 findings/errors/accepted，exit0；[报告](../../tests/v25/.results/b18/security-source.json)。1276项源码摘要ceeead243aeee426217ed4dad48a57d7f7e4351feaeade3f6a900e64a50d13a1，最终check/Electron后无漂移；[统一摘要](../../tests/v25/.results/b18/validation-summary.json)。专项采用真实回环HTTP/SQLite和测试账号捕获，账号域另有真实函数/测试存储验证；没有新一轮BA登录/PG权限集成或真实付费结论。仍无用户托管生成接线，未跑新包扫描、依赖漏洞审计、Windows或生产部署。

## 15. B19：共享预算写资格与实际系统密文（2026-09-08）

写资格仅在同步检查点事务内生效，旧托管记录不能以缺失remote关联绕过；预算设置/兼容结算受独立锚和恢复生命周期约束。新增真实Electron测试经正式IPC改预算，核对SQLite与safeStorage密文、真实新PID和同值幂等；初始化checkpoint由fixture合成，没有产品启用捷径或付费请求。

最终source扫描1182文件零findings/errors/accepted，源码1278项摘要3b9be5d51987b6d94ceaf3e8478935dd9a916ee8da44a558e1f6b666248fbe88；[扫描](../../tests/v25/.results/b19/security-source-final.json)、[分层验收](./V25-MIGRATION-TESTING.md)。未执行新安装包/依赖漏洞审计、Windows原生、实际收费或生产部署；用户启用前在途核对仍是后续前置。
