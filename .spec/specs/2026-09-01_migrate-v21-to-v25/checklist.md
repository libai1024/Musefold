# Musefold v2.1 到 v2.5 全功能迁移 - 验收清单

- [x] 09-22 本地 CLI/MCP 普通云账号生图修复：付款身份保护保留，真实 xiaomiao 的安装版 CLI 与 stdio MCP 均完成生成/下载/同键重放；新 CLI 完整请求 68.407 秒，累计三张实图余额差 3.6 积分，未知费用回执不伪填。check 38/38、包 7/7、安全扫描零发现，已更新本机 App 并注册不含密钥的 Codex MCP；完整 Electron 串行 139P/0F/83 条件S，未重试或更新快照。首轮超时、只读恢复、菜单首败及边界见 [修复记录](../../../docs/v2.5/V25-CLI-MCP-CLOUD-FIX.md)。仅关闭本次缺陷，不关闭完整迁移或 Windows 父项。

- [x] 09-22新增独立云端部署：`/Musefold/v25` 页面/API/Cookie/OAuth隔离，根域不独占；独立库/对象/角色/不可变镜像上线，旧版保留。PC/移动公网真实账号与提示词CRUD/退出、macOS默认地址实际包登录/退出及正式安装通过，双Worker/私有S3/31迁移已验证。来源及首败见[V25-CLOUD-DEPLOYMENT](../../../docs/v2.5/V25-CLOUD-DEPLOYMENT.md)。仅此新增子项完成，不关闭原完整MVP、Windows、正式签名及远程MCP等父项；下列时间记录保留各自历史归属。

> 09-21 15:20当前：任务91/96，完整MVP仍未验收。最新1897项源码2cdf8e15…修复了迟到账号状态清空OAuth重登输入的问题，正式就地10P、PC/移动确定性浏览器4P，完整check38/38退出0；新582项三形态、完整API、自然小时及最新镜像验证仍运行，当前包/三旧备份在完整E2E通过后执行。真实同步1P和三端账号3P是此前实际结果，收费方案各节点逐段成功不替代从零完整整轮；paid20在模型读取503前停止且无新增费用，最近账本累计1,620,774原始quota（32.41548显示积分），含失败收费。此前616,178为较早阶段原始quota，并非显示积分。系统代理未改，网络路径仍待核对。原失败、历史源码和费用记录全部保留，不将旧报告改称新源码全绿。依据见[09-21真实验收](../../../docs/v2.5/V25-REAL-ACCEPTANCE-2026-09-21.md)。

> 09-20最新：会话机制开发、本地联合验证及上游账号扩展生产部署完成；先备份且实际恢复验证，仅New API重启，旧会话保留、真实新协议和释放通过，测试会话归零。事后唯一用户字段变化为验证登录的last_login_at，积分/计费与其他用户不变。1850项bb580e98…本地证据为check38/38、API1153P及2条件另验、三端552P/0F/13S/0flaky、包7P/真实备份3P、源码/包/49ZIP扫描0/0且构建字节匹配。13S保留原明细，不冒称独立实网全部通过。只关闭会话功能子项，任务91/96；Musefold v1.1站点未切换，真实同步/收费闭环及完整MVP仍开放，未提交。依据见[会话机制§8.3–§10](../../../docs/v2.5/V25-LOGIN-SESSIONS.md)，下方较早阶段仅作历史。

- [x] 新增账号会话治理验收：SSH仅释放xiaomiao；自动回收和正常登出释放可证，活跃设备不被静默挤下；登录满额可安全显示脱敏会话并显式选择释放，跨账号/并发/重放拒绝，真实新登录与双宿主交互验证通过。当前源码本地完整验收及上游账号扩展部署/实网结果见会话机制§8.3–§10；不等于发布Musefold v2.5公共站点。

> 09-20非Windows本轮终态以[独立记录](../../../docs/v2.5/V25-NONWINDOWS-ACCEPTANCE-2026-09-20.md)为准：1813项fa3235d0…无漂移，check38/38（root3216P/75条件S、features850P）、根75条件项全部独立补验、完整API1138P/0S含自然一小时、Worker322P/0S、镜像部署18P、完整三端545P/0F/11S/0flaky、当前macOS包7P及三旧备份3P，源码/安装包/49份实际ZIP扫描0/0。B26/B30按原非真实收费范围收口，任务89/94。官方网页确认AUTH_SESSION_LIMIT，真实同步/方案收费链路仍阻塞；已有收费授权，新增收费调用0。下面历史“凭据已解除/新增收费未授权/门禁运行中”等文字不覆盖本轮终态。

> 09-20用户最新范围：Windows App 测试延期，本轮完成其他 v2.5 开发/测试；Windows 专属验收保留未验，不阻塞 macOS/Web/API/Worker 的继续收口。其他非Windows验收标准不降低，未因本次范围排序直接勾选任何完成项或授权生产发布/额外收费。

> 09-20实网补验最新：新凭据的PC Web/移动Web/Electron真实登录及提示词CRUD 3P、桌面TvT连接1P，均无失败/跳过/重试；正式API读取真实账号15项模型/云价（3项图像模型）。962文件新密码/Key精确扫描0命中/0错误，未执行生图请求。原完整544P/8S保留，其中4项已独立补验；1810项4db5b5b8…源码未变。用户已指定局域网Windows SSH目标，但本机服务端banner超时，未取得原生验收。有效凭据不再是阻塞，真实云费用/方案文本/双设备、目标平台/正式发布及7父任务仍开放；87/94、未提交。详见[收口记录最新节](../../../docs/v2.5/V25-CLOSEOUT-2026-09-19.md)。

> 09-20接续审计最新：当前1810项4db5b5b8…的Skill可信来源、终态零来源重读及缓存账号校验修复已完成本机验证。最终check38/38（root3214P/75条件S、features850P），75条件项逐文件核对：本次服务17P，未变输入58项沿准确报告承接。最新完整三形态544P/0F/8S/0flaky、退出0、56.7分钟（PC167P/2S、移动166P/3S、Electron211P/3S），无重试/无截图更新。8S为3个视口不适用、3个真实账号及2个真实密钥/付费条件，不计通过。新arm64 ad-hoc包7P、三授权旧备份3P且原件不变；源码、App/DMG/ZIP及49份真实ZIP扫描0/0，2份UI占位按原始内容单独通过，17份故意拒绝输入另列。源码与23个包内构建文件收尾无漂移。87/94、完整MVP和真实账号/目标平台/正式发布条件仍开放，未提交。

> 09-20最终本机验收：完整check38/38（28缓存）、API1138P/0F/0S含自然一小时、Worker322P/0F/0S；三形态543P/0F/8S/0flaky（PC167P/2S、移动166P/3S、Electron210P/3S），未重试或更新截图。8S为3项不适用视口及5项实网条件，不计通过。当前1807项aafa2f35…摘要无漂移；实际arm64包7P、三真实旧备份升级3P、隔离镜像部署恢复回切18P，原数据不变、源码/包扫描0/0。新增账号模型子项完成，任务87/94；真实账号正向、Windows/正式签名安装、远端CI/TLS/独立远程MCP与完整迁移验收仍未闭合，未提交。以下保留历史，首轮528P/13F/8S不改写；最新证据见[收口记录](../../../docs/v2.5/V25-CLOSEOUT-2026-09-19.md)。

> 09-20最新：原549项累计9F，新失败为显式模型重试改走目录后测试暂停点失效，独立真实HTTP先复现再修夹具，双路径暂停/释放验证通过；受影响真实云服务17P，类型/格式通过，原UI pending和费用/幂等断言保留并补冻结模型断言，Electron未复验。当前1807项10511d4b…相对5b2a680d…仅五测试/夹具文件变化，生产源未变。API原进程已在自然一小时期限阶段，三端仍继续；最终全量/产物/外部条件不关闭，86/94且未提交。

> 09-20当前回归：原549项已出现Web方案协议6F、Electron账号恢复2F，均为旧账号/模型目录夹具缺失导致发送被正确禁止。补齐前置并新增访客零发送、model/binding、云价和恢复后model断言，类型检查通过但浏览器待复验。当前1807项d86c6b93…相对5b2a680d…仅DB测试与两个E2E夹具共三文件变化，旧hash重建校验通过，生产/API/Worker未变。原API/三端仍在运行，首败保留，最终全量及原外部条件不关闭，86/94、未提交。

> 09-20条件测试补验：根runtime27P、双客户端/HTTP同步12P、隔离PG复验17P；首轮16P/1F为过期固定迁移数量断言，已改完整链hash/时间戳比对，未改生产迁移。部署计划/manifest26P、类型检查通过；75条件S中57项补验，余18项实际镜像/部署须当前产物。仅独立DB测试变化，1807项74b0b9c6…与运行输入5b2a680d…的单文件差异已密码学复核，生产与E2E源未变。原API/549项三端仍运行，最终check、当前包三旧备份及原外部条件未闭合，86/94且未提交。

> 09-20当前终态：1807项5b2a680d…打包后无漂移；最终check38/38、root3203P/75条件S、features850P、完整Worker322P/0F/0S；当前arm64 ad-hoc包smoke7P/0F/0S/0flaky，源码/包扫描均0/0，相关进程退出0。完整API及自然一小时仍在原进程中，完整549项三形态回归已启动、快照更新关闭。当前包三真实旧备份及原真实账号/平台/发布条件尚未闭合；86/94与未提交状态不变。以下记录按阶段保留，不替代最终验收。

> 09-20最新：实际Electron引用组合揭示macOS系统父目录别名误拒绝上传路径，先复现后修复，相关60P；完整check38/38、root3203P/75条件S、features850P、扫描0/0。参考图实际HTTP模型/SHA、本地提示词投影与历史费用保留、身份变化零发送定向1P；联合14P/1定位器F保留。当前1807项5b2a680d…开始最终完整check/API（含自然一小时），Worker镜像重建中；最终同源全量/包与原外部条件未收，不勾父项或提前提交。

> 09-20当前接续：方案试跑/正式共享模型选择及两宿主提交映射已接，features64P、桌面映射3P，完整check38/38、root3199P/75条件S、features850P。实际PC/移动与Electron账号基础模型联合3P；Web完成态两张基线逐图核对并补消息滚动可达断言，重收后关闭更新的完整工作台32项通过。Electron引用/身份变化扩展与最终同源完整验收仍在进行，86/94和原外部条件不关闭；详见[收口记录最新节](../../../docs/v2.5/V25-CLOSEOUT-2026-09-19.md)。

> 09-20最新：普通模型共享UI/偏好隔离/发送前云价复核已接，默认模型静默改选修复后22P、PC/移动专项6P；工作台全文件30P/2视觉F未关闭。云端方案模型实际执行23P；桌面方案主进程已接所选模型与持久R/S传输，联合167P（真实SQLite/受控HTTP，含试跑/正式/历史/取消），不是实际Electron模型UI验收。当前完整check38/38、根3196P/75条件S、features837P，扫描0/0；当前构建既有Electron工作台11P/0F/0S/0flaky。方案UI映射、最终同源全量与原外部条件仍待，Spec校验仍退出1，86/94及未提交状态不变。详见[收口记录最新节](../../../docs/v2.5/V25-CLOSEOUT-2026-09-19.md)。以下按阶段保留历史，不覆盖本节。

> 09-20账号多模型接续：API权威目录/价格准入、Worker冻结模型实际发送、桌面持久请求已接线；API联合52P、Worker真实PG/HTTP27P、桌面SQLite/回环HTTP与账本123P。当前增量完整check第三轮38/38、根3180P/75条件S、features811P；源码扫描0/0，1796项05468314…。共享选择/价格展示/账号隔离持久化及最终三端交互尚未完成，不沿用此前包与全量E2E作为最终证明。详情见[收口记录](../../../docs/v2.5/V25-CLOSEOUT-2026-09-19.md)。

> 09-20当前事实：FTS升级修复后完整check38/38、专项67P、实际新macOS arm64包smoke7P、三真实旧备份副本升级与原记录/搜索/图片保留3P；原数据SHA不变。完整三端原报告530P/2F/8S，定向4P不能替代全量。账号多模型/云价开始实现后须重新绑定源码与最终验收；父项不勾选，86/94，未提交。见[收口记录最新节](../../../docs/v2.5/V25-CLOSEOUT-2026-09-19.md)。

> 09-20隔离部署接续：实际Compose业务/停写备份恢复/三个本地历史镜像回切专项8P/0F/0S；含真实PG69表108行、截断备份拒绝、MinIO物理清理与对象复制中断恢复。非应用构建检查36/36、root3117P/75条件S、源码扫描0/0；当前1778项7d7c783d…，完整E2E仍归属87010207…运行输入，增量完整check待验。受控账号/loopback/同集群恢复和非正式历史镜像不替代实网/TLS/平台/CI/远程MCP/生产，完整MVP和父项不勾选。见[收口记录](../../../docs/v2.5/V25-CLOSEOUT-2026-09-19.md)。

> 09-20最新终态：当前完整check38/38、API1113P/0F/1小时S+独立自然小时2P、Worker315P；受限镜像角色8P。PC/移动列表旧基线按D44看图更新并独立2P。当前macOS arm64 ad-hoc包7P/0F/0S、产物扫描0/0；旧包已备份。当前源码87010207…下完整540项三端重跑中，旧完整531P/1F/8S保留；Spec验收退出1，完整MVP/外部平台部署条件不因局部通过关闭。见[收口记录](../../../docs/v2.5/V25-CLOSEOUT-2026-09-19.md)。

> 2026-09-20 当前收口续进：当前API镜像迁移2P、受限运行角色7P、planner14P、正式Worker完整315P。完整API第二轮1112P/1F/1小时S，双进程5秒超时正在以保留断言的30秒预算完整复验；原跨端回归有移动旧基线1F，当前输入最终完整check/E2E与自然小时终态仍待。此为局部结果，不覆盖下方历史或勾选完整迁移；见[收口记录](../../../docs/v2.5/V25-CLOSEOUT-2026-09-19.md)。

> 2026-09-19 LIVE25：实网环境准备完成，TvT 1 张真实出图/图片读取/新 PID 重启保留通过；check 38/38、前置条件 8P、失败快照脱敏回归通过。账号服务拒绝用户提供凭据，三端正向登录未通过；保留真实外部输入待核对，不勾父项。详见[本轮报告](../../../docs/v2.5/V25-LIVE-ACCEPTANCE-2026-09-19.md)。

> 2026-09-19 D02PURGE：后端 purge/运行与费用保留/持久对象清理已实现，check 38/38、PG/API 51 项、真实 MinIO 3 项通过；已有 PG 与三份真实 SQLite 备份均在私有副本上验证升级和数据保留。最终 check 38/38、完整 API 1102P/0F/1 专用小时 S、Worker 315P/0F/0S（新正式镜像）已通过，本片后端已验收。旧库验证只写副本，原始备份不写入，本批不勾选完整 MVP/原生发布父项；详见[测试续篇 §5.113](../../../docs/v2.5/V25-MIGRATION-TESTING-CONTINUED.md#5113-d02purge方案永久删除后端与真实旧库副本验证2026-09-19)。

> 2026-09-08 当前状态：B9–B21 分层验收以[测试手册](../../../docs/v2.5/V25-MIGRATION-TESTING.md)为准，历史数字不覆盖当前源码。迁移仍部分完成；Cloud MCP继续只读。管理员已获迁移全部闭合后的后续授权，尚未启动。

## 假设与范围对齐
- [x] 产品范围与设计选择已确认；豆包内部与桌宠为范围外/冻结面。真实账号凭据、Windows/签名及远端验收环境仍是未满足的外部条件，见当前收口记录，不将其视为已完成。
- [x] 范围内/范围外与实现一致，豆包入口仍可到达；完整 Design Scheme parity 与若干旧版扩展能力仍明确记录为未完成
- [x] 本轮发现的可执行问题已回写任务包并完成，未甩给用户；外部环境阻塞已保留为 blocked

## 简洁性
- [x] 没有未请求的扩展、抽象或配置化；本轮沿用现有 gateway/features/Drizzle/Query 架构
- [x] 当前实现沿用既有接缝，云端 Design Scheme 管理与资产基础切片不伪装为可用的云 Agent/run runtime

## 变更边界
- [x] 每项已落地改动均能追溯到迁移任务或对应回归修复
- [x] 没有为本轮引入无关重构或顺手清理；桌宠冻结面和 Doubao 内部未被迁移

## 功能完整性
- [x] 2026-09-20 新增账号模式：当前账号云端模型可选、切换后展示与实际提交一致；价格与账号分组倍率以云端为准，缺失/失效数据不伪装为免费或静态本地价；重试及恢复仍保留原冻结模型和费用事实。 验证：组件22P、完整API账号目录15P/准入4P、Worker真实PG/HTTP以及最终Web双视口/Electron普通和方案用例通过；check38/38、完整E2E543P/0F/8S。受控上游不替代完整MVP的真实账号验收。
- [ ] MVP功能与完整验收闭合：壳、工作台、生图、提示词、历史、设计方案、设置、账号/连接、同步和归档会话。共享产品面、Web/桌面runtime、云资产、Agent创建/修改/更新、试跑/封面/转正及专用包已经实现；历史545P与552P分别归属各自源码，不替代09-21当前582项回归的待定终态。原AUTH_SESSION_LIMIT已按授权释放，线上账号服务新受管协议也已部署验证；真实同步已有通过证据，收费方案仍欠一次从零完整通过及最终源码复核，不将协议烟测或分段接续替代完整链路。Windows按用户要求延期、独立保留未验，不作为本轮非Windows收口的前置；其余验收未闭合，本项不勾选。
- [x] 批次 B2 产品面已交付并验证(2026-09-06,darwin,未 commit):工作台多图/Lightbox/张数(ui-parity/03,`workbench-multi-image.test.tsx`);开放能力 + AutomationConfirmCard(ui-parity/07-04,`electron.settings-open.spec.ts` 8/8);账号预填 + 错误码文案 + 会话重启逃生门(ui-parity/07-01、02);密度消费 + 提示词/历史虚拟化(ui-parity/04、05,`use-virtual-rows`);使用统计(ui-parity/07-05,`web.usage.spec.ts` / `electron.settings-usage.spec.ts` 已过);Win/Linux 窗控与 drag-region(ui-parity/01)。B2 批次验证通过,不把本项当作整包通过
- [x] 批次 B3 产品面已交付并验证(2026-09-06,darwin,未 commit):Cloud MCP 已连接应用(ui-parity/07-04,`web.cloud-mcp.spec.ts` 6/6,`electron.settings-open.spec.ts` 9/9);使用统计图表(ui-parity/07-05,`web.usage.spec.ts` / `electron.settings-usage.spec.ts` 图表存在性已过,无图表快照);Win/Linux 控件带避让(ui-parity/01,布局已预留,darwin band count=0,Windows 真机未目测)。B3 批次验证通过,不把本项当作整包通过
- [x] 批次 B4 产品面已交付并验证(2026-09-06,darwin,未 commit):promptId 服务端过滤(D22);归档游标分页(U05-archive-pagination);Key 失效引导(S01 产品面);豆包入口冻结证据(桌面有、Web 无);桌面 `.musefold.design` 导入导出 E2E(P01-9,不做云端 run)。xiaomiao Electron UI 登录/提示词/方案导入入口/登出已过;云端生图入队但终态 `GENERATION_UPSTREAM_UNKNOWN`,不冒充成功出图。B4 批次验证通过,不把本项当作整包通过
- [x] 批次 B5 产品面已交付并验证(2026-09-07,darwin,未 commit):云端生图落盘可解释 + 缺桶自建(xiaomiao 出图 `succeeded`/1 资产);提示词双列(≥760px);Taxonomy `<md` Sheet;工作台会话标题/任务摘要;移动软键盘 inset。B5 批次验证通过,不把本项当作整包通过
- [x] 批次 B6 产品面已交付并验证(2026-09-07,darwin,未 commit):额度「去兑换」深链账号分区;兑换成功后 retry/replay;终态刷 `account.status`;时间线只读审批卡(`job-approval-card`/`job-approval-rejected`)。不发明 approve API。B6 批次验证通过,不把本项当作整包通过
- [x] 批次 B7 产品面/基础设施已交付并验证(2026-09-07,darwin,未 commit):worker disposable runtime 第一刀;generation_runs 30 天软删 purge;桌面方案草稿重命名/删除 E2E;Web xiaomiao 活体登录(env-gated);PR/Main `database-integration` job。不宣称完整 U03-worker-runtime / D02 / Q03。B7 批次验证通过,不把本项当作整包通过
- [x] 批次 B8 产品面/基础设施已交付并验证(2026-09-07,darwin,未 commit):worker runtime 第二刀(续跑/late success/部分上传);提示词 30 天硬删 + sync 90 天裁剪;时间线键盘留白(D27);PG migrate replay 幂等 + desktop-db bundle CI;Electron xiaomiao 活体登录。不宣称完整 U03-worker-runtime / D02-c/d / Q03。B8 批次验证通过,不把本项当作整包通过
- [x] 批次 B9 部分切片已交付并验证(2026-09-07,macOS arm64,dirty)：本地 Agent 同进程费用协调；云上传资产暂存/事务晋升与 owner/用途隔离；`uploaded` 来源经 PG/独立方案 SQLite 升级、专用包和 v25 详情/媒体读取保真；Worker 真进程重启/epoch/unknown 禁重发与方案资产 GC 引用保护；生产 Web、严格 package 和 CI 报告门禁。完整费用账本、云方案执行、生产 Worker 恢复、全资产/旧库/跨设备与发布矩阵仍开放，不把本项当作整包或 goal 全部通过
- [x] 已实现范围内的边界条件已处理：无 Provider、加载/错误/空态、取消/重试/删除、移动抽屉和主要窗口状态
- [x] 错误处理符合预期：结构化 BridgeError/API 错误、用户可重试、生成/同步状态机可收敛

## 测试与验证
- [x] 核心逻辑有就地单测、集成测试或等价 runtime 证据；未覆盖的真实 PG/Worker/跨设备能力已单独列出。Design Scheme 本轮受影响套件 8 个文件、151 个测试通过，覆盖主进程权威 text-only `prepareRun`、strict renderer 输入、四步计划、formal/fidelity/source/Provider blocker、legacy 来源归一化、完整槽位/来源/Provider 执行前复核与 prepare→run 原样往返；Desktop cancellation-wins 已进入 checkpoint `607e7b5`。2026-09-01 Desktop Workbench Composer run/cancel 接缝有 desktop-shell 17 个用例与 features 297 个测试（workbench-schemes 14、integration-store 15）证据；Electron Workbench 9/9 并以回环 Provider 覆盖真实 IPC、同一 executionId、活动 Workbench 会话、运行中轮询、停止取消、双账本 `cancelled`、输入保留和零方案资产提交。参考图运行经上传暂存 id 接通（plan builder 35、run adapter 20、domain 65 tests）；Desktop 成功出图另有 09-03 记录；Web/cloud 全链与最终发布证据仍未宣称完成
- [x] Web 桌面/移动与 Electron 已验证 shell/workbench/prompts/settings/sync 关键路径；Design Scheme Web deep-link 的打开、返回、删除 query 生命周期和非法参数清理已有 22 个 Web host tests；本轮 `@musefold/features` 共 23 个文件、297 个测试通过，覆盖 Design Scheme 正式详情常驻修改入口、相册键盘与横向触控导航、History 成本展示、时间线内容尺寸变化贴底与用户离底不抢位；移动 Workbench 完成态视觉基线已刷新并连续复核通过；早期完整 Electron project 为 33 passed、1 failed、1 skipped（最新批次见 B9 与开发记录，原生/IPC 证据仍需分列），唯一失败是 macOS 原生全屏前的 shell focus 前置，Design Scheme Workbench 仍 9/9 通过

## 文档同步
- [x] 受影响的 v2.5 台账、UI 规范差异和证据边界已更新；未登记的历史数字未被冒充当前通过
- [x] `spec.md` / `tasks.md` / `checklist.md` 已同步当前实现、未完成项和外部阻塞

## 部署验证（如适用）
- [x] 本地源码构建与测试门禁正常；受影响的 `@musefold/features` 与 `@musefold/web-next` typecheck 通过，4 个 deep-link 变更文件 Biome 通过；空库 PG replay 与 desktop-db bundle freshness 已于 B8 接入 CI;生产 package-smoke、upgrade replay 全集和安全产物扫描仍由 Q03 记录为未闭合
- [x] Electron/Web 构建成功；早期 Electron project 为 33 passed、1 failed、1 skipped（已由 B8 新记录替代），原生 macOS fullscreen 用例因 runner 无法取得 shell 前台焦点而阻塞，未将失败改写为产品通过

## 跨载体一致性
- [x] 共享 contracts、platform gateway、Desktop bridge/preload/desktop gateway 的方法集合和错误边界保持一致
- [x] Web desktop/mobile 与 Electron 的 session URL、设置、工作台和同步回归路径已执行定向验证
- [x] Desktop-only window lifecycle 信号未混入业务 gateway，桌宠与 Doubao 冻结边界保持不变

## 项目结构与文档可信度
- [x] 已按第一性原理保留现有分层：features 复用产品 UI，宿主只负责路由/壳/gateway，contracts 为唯一实体源
- [x] 本轮未进行目录重排；依赖边界、源码路径、测试路径和台账引用已通过仓库检查
- [x] `.spec` 三件套、V25 migration ledger 与 evidence manifest 的未完成/blocked 语义保持一致

## 分支与多代理治理
- [x] 当前位于 `spec/2026-09-01_migrate-v21-to-v25` integration branch
- [x] 本包执行与验收均在该分支进行，已保留既有不推送 checkpoint `607e7b5`，最终收口 checkpoint 待本轮门禁复核后创建，未覆盖既有 dirty worktree
- [x] sidecar ownership、non-targets、verify 和主线程合流门禁已记录在 `spec.md` 编排策略

## 编排治理
- [x] 已启用 `build` 编排，route 与 ownership 可由 `spec.md` 复核
- [x] waiting strategy 明确主线程不因单一 sidecar 停工
- [x] verification gate 明确以主线程 `pnpm run check`、双端 E2E 和 Spec 校验为准

## 行为成效
- [x] B9 最终统一验证：`pnpm run check` Turbo 35/35，根 212 文件/1656 tests、features 44/548；API integration 4/54、Worker integration 4/22；最终 E2E 219 passed / 8 skipped / 0 failed / 0 flaky（Web desktop 73/2 skip、mobile 71/4 skip、Electron 75/2 skip）。8 skip 分别为 3 项 live account 未注入、1 项真实 Key 未注入、3 项视口排除、1 项移动端删除会话入口暂缓。最终 macOS arm64 打包及严格 smoke 1/1、0 skip 通过，含 bundle 字节匹配；源码清单 1037 文件未变。报告、产物 hash 和限制见 [开发记录](../../../docs/v2.5/V25-DEVELOPMENT-LOG.md)，不继承为 Windows/正式签名公证/CI runner/生产通过
- [x] 统一门禁结果：`pnpm run check` 通过，2026-09-07（批次 B8 统一验证,darwin,未 commit）为 turbo 35/35、根 vitest 207 文件 / 1586 例、features 44 文件 / 548 例（B7 206/1582、43/545；B6 205/1579、43/544；B5 204/1578、42/534；B4 203/1572、40/513；B3 202/1566、39/507；B2 200/1548、38/495；B1 收口 191/1460；2026-09-03 为 182/1357，此前基线 1301）
- [x] 批次 B8 统一门禁与双端 E2E:已验证(2026-09-07,darwin,未 commit)。`pnpm run check` turbo 35/35;Web mock E2E 144 passed / 6 skipped;活体 `web.live-account` 双视口 2/2、`electron.live-account` 1/1;Electron 75 passed / 2 skipped。worker integration 9/9;migrate-replay 1/1。整包仍部分通过
- [x] 已回填关键路径验证：Web session URL、Web mobile Settings/Workbench 视觉、Electron Workbench、Electron sync 定向 E2E 通过；2026-09-01 Workbench 接缝重构后复跑 `electron.workbench.spec.ts` 9/9，新增正式纯文本方案经真实 IPC 进入回环 Provider 并由停止钮取消的双账本证据；`web.workbench.spec.ts`（web-desktop + web-mobile）17 passed/1 skipped（移动端无侧栏的既有跳过）。普通生成、运行中取消与视觉基线不回归；移动 Workbench 完成态视觉基线已刷新，时间线尺寸变化贴底回归通过；早期完整 `pnpm run test:e2e` 为 98 passed、1 failed、5 skipped（最新批次见 B9 与开发记录），唯一失败是 macOS 原生全屏前的 shell focus 前置，不影响上述 Design Scheme/Workbench 断言
- [x] 本轮返工原因已记录：工作台会话列表竞态、孤立 draft/sync fixture、Settings 归档行视觉基线，以及 bare Escape 在串行 Radix dismiss layer 后的时序不稳定；Electron 方案 E2E 改用同语义的可见停止钮，Escape 继续由共享 Workbench 测试覆盖

## 验收证据
- 外部对标：以 task package 状态机和 `V25-MIGRATION-CARDS.md` 当前状态为真；Design Scheme、真实 PG/Worker/跨设备、完整 CI/package-smoke 仍未宣称完成
- 脚本验证：`pnpm run check` 通过；`check_spec_package.py` 已运行，当前因未完成 parity/全量证据与验收结果而不通过
- 旧新对比：已按 `docs/v2.5/V25-UI-SPEC.md` 与迁移台账反向覆盖表核对主要入口、状态和有意差异；完整 v2.1 parity 仍有明确待迁子卡
- 差异边界：桌宠不迁移；Doubao 内部不迁移但入口保留；Web Design Scheme capability 已开启；确定性管理和 B9 云上传资产基础切片可用，云端执行/Agent/市场/专用包全链仍未闭合
- 行为成效：共享 features 已覆盖主要 Web desktop/mobile 与 Electron shell/workbench/prompts/settings/sync 路径
- 构建：`pnpm run check` 内含 Electron/Web build、typecheck、Biome、unit/integration、dependency-cruiser，全部成功
- 测试：**2026-09-07 批次 B8**(darwin,未 commit):已验证。`pnpm run check` turbo 35/35,根 vitest 207 文件 / 1586 例,features 44 文件 / 548 例;Web mock E2E 144/6 skip;活体 Web 2/2 + Electron 1/1;Electron 全量 75/2 skip。worker `test:integration` 9/9;API migrate-replay 1/1;bundle freshness 1/1。就地指向:`apps/worker/src/__tests__/runtime.integration.test.ts`、`apps/worker/src/retention.ts`、`apps/worker/src/sync-retention.ts`、`tests/v25/electron.live-account.spec.ts`、`apps/api/src/__tests__/integration/migrate-replay.integration.test.ts`、`tests/repo/desktop-db-bundle-freshness.test.ts`。xiaomiao:Web + Electron UI 登录 + 提示词 CRUD;本轮不强制重生图。**2026-09-07 批次 B7**:根 206/1582、features 43/545;生图 job `cd07409f-e028-48ef-8334-ef419f06c36c` 终态 `succeeded`、1 张资产;market/Agent create `501`。更早批次数字见本文件历史段落,不以旧 Electron 33/1 fail 冒充当前失败
- 手工验证：xiaomiao(`https://zhaozhaoyue.top` 委托)已走本地 API 登录/额度/提示词 CRUD;2026-09-07 B8 Web + Electron UI 活体登录;B7 云端生图终态 `succeeded`、1 张资产(job `cd07409f-…`);凭据不落仓库

---

**验收结果**：部分通过（09-21 15:20）。任务91/96，最新源码1897项2cdf8e15…完整check38/38、OAuth正式就地10P及PC/移动专项4P已通过；582项完整E2E、新镜像/安装包与完整API、自然小时尚待终态。会话机制与上游部署已完成，原AUTH_SESSION_LIMIT不再阻塞；真实跨端同步及收费节点已有实际证据，但收费全流程仍欠一次从零完整通过，最近失败为上游读取网络超时。此前1813项fa3235d0…和1850项bb580e98…的全量/包/备份证据只证明各自输入，不再称为当前最终验收。Windows按要求延期；正式签名公证、远端CI/TLS/MCP与完整产品发布分列。尚不关闭完整MVP、注册正式pass claim或创建最终Git提交，管理员未启动。最新依据为[09-21真实验收](../../../docs/v2.5/V25-REAL-ACCEPTANCE-2026-09-21.md)，下方各批次保留历史来源与边界。

### B22 最新检查点（仅批次通过，整包仍未闭合）

恢复分页、独立结果状态及旧托管本机诊断已完成本机分层验收；check35/35，三形态247passed/7skipped/0failed/flaky，真PG回执回归25passed。源码1297项摘要3250169f8d434be5adc26d7449b1058904b288ea6691be9836f29a59a266c375、26路径差异和无漂移证明见tests/v25/.results/b22/validation-summary.json。当前实际Electron的服务端为fixture；正式主进程与真实Hono/PG产品合流、逐点故障/旧备份及重试兼容仍按P4-R2/R3/R4，不改变上方父级未完成验收或启动管理员。

### B23 历史检查点（联合切片通过，整包继续部分完成）

正式桌面→实际Hono/PG/队列/worker合流和真实Electron四图/新PID恢复已验。check35/35、联合18、API213、完整三形态248passed/7skipped/0failed/flaky；源码1301项摘要9c6233b1c379b06201620fa0503b8a685accec60814ec7d7e951be70a16b9c7a且无漂移，统一报告tests/v25/.results/b23/validation-summary.json。实际认证/Provider/S3仍为合成fixture，不代表收费账单、Windows、全部强杀/旧备份、安装包/部署或管理员已验；父级验收仍未闭合。

### B24 最新检查点（首批故障/备份验收通过，R3及整包部分完成）

check35/35、联合34、完整三形态257passed/7skipped/0failed/flaky；1304项源码摘要df35cfe5e4d5fa76b111e8fa18f1684c2f6e1512188154981e36b572814e4637，统一报告tests/v25/.results/b24/validation-summary.json。8个故障点和4次投影后强杀、真实云任务安全备份及显式确认已有证据；时钟注入不等于自然到期，review生成后转换不等于apply内部竞争。完整R3、R4、P5/P6及其余迁移/发布仍开放，父级验收不勾选，不启动管理员。

B25补充证据：本机P4-R3-C1..C4确认故障矩阵已验收；check35/35与完整三形态274passed/7skipped/0failed/flaky。统一报告`tests/v25/.results/b25/validation-summary.json`，源码1306项摘要`7bd7b59729519d834aad5540ef7487aa6486a9674a9a555c98f8e0be8c1a2f6c`。下一步P4-R4；原生Windows、其余迁移/发布及整包验收保持未完成，管理员未启动。


B26 阶段证据：显式重试主链验证通过，check35/35、联合171、API完整集成220、三形态276passed/7skipped/0failed/flaky。源码1307项摘要`5342cbb0df26f103ba89e49887fac42cb583ca1a854fd7e9faa791927d42c9dc`，统一报告`tests/v25/.results/b26/validation-summary.json`。B26 原任务仍未勾选，剩余R4-C1..C5见路线图§6.14：交互/剩余故障/legacy/BYOK/R/S完整矩阵不由同key专项代替；父级与整包仍部分完成，管理员未启动。


B27 阶段证据：R4-C1 工作台/历史三个手动入口的共享交互通过本机验收，check 35/35，组件专项 75、正式服务 15，完整三形态 278passed/7skipped/0failed/flaky。源码1309项摘要`8d7de8a9c596d518a2b567bafb703482a826f7b340596581e29ec1919e4e4f0c`，统一报告`tests/v25/.results/b27/validation-summary.json`。只关闭B27；B26/R4/P4/整包保持开放，兑换后续发的独立错误/并发缺口已登记C4。下一步路线图§6.15 C2→C3/C4→C5；管理员未启动。


B28 阶段证据：R4-C2 本机17项重试故障/恢复验收通过；check 35/35，完整三形态 295passed/7skipped/0failed/flaky。源码1312项摘要`1bae587d59ba8c56efa81e492cd78f1e23cb0a4ee798a658f5cf252c4eaed192`，统一报告`tests/v25/.results/b28/validation-summary.json`。仅关闭B28本机切片，B26/R4/P4/整包保持开放；下一步路线图§6.16 C3实际旧入口→C4 BYOK/R/S/兑换续发→C5，再原P5/P6及云Agent/包/GC/迁移/发布；管理员未启动。


B29 阶段证据：兑换恢复反馈/并发/账号隔离和桌面官方额度引导的本机切片通过；check 35/35，组件62通过，旧入口基线24通过，界面专项5通过，完整三形态300passed/7skipped/0failed/flaky。源码1315项摘要`da51f777c45d0f34758d9999faad1caad34c1c6208f938e48950ea0e376aa8a2`，统一报告`tests/v25/.results/b29/validation-summary.json`。首次void回调、Web fixture错误码和桌面映射失败留证；只关闭B29，C3真实旧入口和C4 BYOK/默认连接/R/S、C5仍待，B26/R4/P4/整包保持开放；管理员未启动。


B30 阶段证据：旧账号未绑定本地发送与默认模型快照缺陷已修；实际 G/R/S/BYOK 子矩阵和三类持久未结启用阻断已验。check 35/35，完整三形态305passed/7skipped/0failed/flaky；源码1321项摘要`1ab821e097e6d54ddf2ffb3245fa31774f9c607ea1b48270e3e7b9ac4c91ef19`，统一报告`tests/v25/.results/b30/validation-summary.json`。首次缺陷/fixture失败及一次既有进程超时均留证。B30总任务、C3/C4剩余条件、B26/R4/P4/整包不关闭，历史unknown模型分类仍待；接续路线图§6.18，管理员未启动。


B31 阶段证据：本地/IPC 共用连接规则、云前后自备兼容与实际 CLI/MCP 本地 G/R/S 已验。check 35/35，单元25项、专项7项，完整三形态311passed/7skipped/0failed/flaky；源码1325项摘要`40aba6dcc793e5f053194a9ee07f2c10107291b5a88dbd4d965814131915335e`，统一报告`tests/v25/.results/b31/validation-summary.json`。四个真实管理缺陷和首次CLI命令顺序fixture失败已留证。仅关闭B31，历史模型缺失/C3/C5、B30/B26/R4/P4/整包保持开放；接续路线图§6.19，管理员未启动。


B32 阶段证据：旧本地模型缺失在 core/IPC 发送前明确拒绝，历史反馈与连接核对后工作台新意图已验，原记录/费用不变。check35/35，core/IPC44项、账号测试43项；完整三形态312passed/7skipped/0failed/flaky。源码1327项摘要`8ef7aa3d4db46ec9bd8134df1275e456b7db64c52108df589e55533f8ed89034`，报告`tests/v25/.results/b32/validation-summary.json`。首次真实缺陷及fixture/注册瞬态断言错误留证；仅关闭B32，C3/C5、B30/B26/R4/P4/整包开放，接续路线图§6.20，管理员未启动。


B33 阶段证据：守护准入关闭、在途取消排空、关库/owner顺序及实际桌面接管已验；旧进程提前删锁后延迟退出/超时仍活以真实子进程fixture覆盖。就地6项、云回执独立复核16项；check35/35，完整三形态313passed/7skipped/0failed/flaky。源码1329项摘要`f4b05a835c6b2fe676530ac0f6d25c3bc7c699175995d2ac024fc7e1e6a708ad`，报告`tests/v25/.results/b33/validation-summary.json`。首次缺陷、诊断格式错误、既有回执等待超时留证；不证明历史安装包/Windows/真实账单，原C3/C5/B30/B26/R4/P4/整包继续开放，接续路线图§6.21。


B54阶段复核：B54证据：完整回归358P / 7S，0F/0 flaky（1518项原语料源码），最终不同图片语料身份33P与三方向3P、完整check及源码/两组实际ZIP扫描通过。最终1519项摘要5aae120bee8ec4b03fc42f5dd4367fe8475674673f67c7f9aa8e562b74b07d7e；两组源码和首次失败见tests/v25/.results/b54/validation-summary.json与测试手册§5.48。只关闭本批测试设施/证据切片，Web图片、F5-X剩余、D4/F3/F4/原E与整包及管理员前置继续。

B55阶段复核：B55：完整check36/36（27缓存），数据库条件完整E2E 360P / 7S，0F/0 flaky，共367项；最终源码1524项摘要c291a6c8dc63ba62621d317770a60e6e40dd8f16781906f0d5af009e462dc6c7，相对B54新增5/修改6/删除0。源码1431文件/1归档及两轮各8份和中止轮6份实际ZIP扫描零命中/错误。首次焦点失败与修复、真实/替身/skip边界见测试手册§5.49和tests/v25/.results/b55/validation-summary.json。只关闭图片切片，父卡及整包保持开放。

B56阶段复核：B56：合同19P、客户端51P、Agent真实PG20P；完整API集成482P、worker集成92P；完整check36/36（17缓存）。源码1532项摘要`6f6d0793a6cb8e113fb7ddd3ecbacd8b370ad436631dd130f9e587ac4f8b350d`，相对B55新增8/修改14/删除0，源码扫描1439文件/1归档零命中/错误。首败与范围见测试手册§5.50及tests/v25/.results/b56/validation-summary.json。仅关闭异步接缝/执行发现基础，共享恢复UI与D4-C/D/E、F3/F4、F5-X剩余及原E保持开放。


B66当前进展：原桌面/core修复62b1f744…完整Electron166P/2外部S/0F；新增空日志水位与pull/裁剪一致性修复，df6478b1…九项真实两设备及就地联合35P、check36/36和源码扫描通过。后续六处仅后端/测试变化与原Electron分开归属；完整API556P/1专用小时S、worker93P/0S与10份本轮API归档扫描通过，tests/v25/.results/b66/acceptance.json逐条验收，仅关闭B66/D03.5；D03父卡、全迁移与管理员前置继续开放。


B67/D03.6 已验收：真实 Electron 跨账号、同步同意、会话失效恢复及本机方案隔离通过。继续 D03.2/3 旧库数据等价与备份故障补验；真实脱敏旧库、原生交付、原 E 与正式发布条件保持开放，管理员尚未开始。 本批只改测试设施，逐条证据为 tests/v25/.results/b67/acceptance.json；不据单卡关闭父级迁移或管理员前置。


B68/D03.2–3 已验收：合成旧 SQLite 的逐字段保留、独立方案库升级、真实备份失败和事务回滚恢复通过。当前统一检查通过；继续原 E 的费用/Worker 完整矩阵与数据清理。真实 v2.1 脱敏旧库、原生四端交付、各平台发布及生产回滚仍待，管理员尚未开始。 当前证据：tests/v25/.results/b68/acceptance.json；无生产迁移代码改动，首败和条件skip保留。


B69/原E-W已按W01/W02运行可靠性范围验收：完整Worker集成99P/0F/0S，含18项真实进程和2项正式Linux arm64容器测试；旧epoch不得改写结果，已发送/已认领任务不自动重发。继续费用兼容与完整retention/GC、真实旧库/原生交付和正式发布；远端CI及生产回滚仍待，管理员尚未开始。 逐条核对及源版本见tests/v25/.results/b69/acceptance.json；整包前置不随本卡关闭。


B70进展（2026-09-13）：B70已修复提示词恢复与定期/手动永久删除的真实PG竞争：恢复不被误删、清空只处理锁定集合，同步日志和条数准确。当前完整API562P/1专用小时S、Worker100P/0S、check36/36及源码/20份留存合法ZIP扫描通过。只关闭本片；继续Desktop清空500条上限、完整数据清理/费用与正式交付，管理员尚未开始。 具体证据见docs/v2.5/V25-MIGRATION-TESTING.md §5.69；完整迁移验收保持开放。


B71进展（2026-09-13）：B71已完成Desktop提示词清空修复：501条一次清完、全部事务失败回滚、同步墓碑与其他workspace保护、真实Electron新PID持久性通过。当前check36/36、完整Electron170P/0F/2S/0flaky及源码/实际归档扫描通过。继续B72云端分页遗漏修复，再接Desktop查询与回收站筛选、完整数据清理/费用及正式交付；管理员未开始。 只关闭本片，完整迁移验收保持开放。


B72进展（2026-09-13）：B72已完成云端提示词置顶/微秒/Unicode分页修复与严格游标校验，当前完整API604P/1专用小时S、check36/36及源码/10份实际ZIP扫描通过。接B73桌面SQL分页、显式工作区回读与双宿主回收站查询；费用、完整生命周期和正式交付仍开放，管理员未开始。 只关闭本片，完整迁移验收保持开放。

B73已验（2026-09-13）：当前check、API52P、完整E2E476P/7S及源码/实际归档扫描通过，原七项验收留存。接B74 Desktop分类事务与同步；云硬删除、完整生命周期/费用、真实旧库/原生/发布与管理员前置仍开放，不勾选完整MVP。

B74原范围已验（2026-09-13）：完整E2E479P/7S、当前check/build及源码/实际归档扫描通过，11项对照见tests/v25/.results/b74/acceptance.json。继续B75云端永久删除等原范围，不勾选完整MVP。
