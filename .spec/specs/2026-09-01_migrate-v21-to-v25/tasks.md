# Musefold v2.1 到 v2.5 全功能迁移 - 任务拆解

- [ ] 2026-09-22 共享域名下的独立云端 2.5 部署与客户端真实登录
  - boundary: 已按用户要求创建当前开发快照 dedace4；不独占 www 或域名根登录路径，按 /Musefold/v25 隔离页面、API、Cookie 和 OAuth；新数据库/对象存储/运行角色与旧版独立，不迁移旧业务数据，不删除旧服务。
  - verify: 路径挂载真实认证/PG回归、完整 check、按提交构建的三个镜像及单次迁移/权限验证、旧路由保留、TLS实网登录/账号/业务读写、对象和队列验证、macOS新包与真实登录。最终证据写入 V25-CLOUD-DEPLOYMENT.md，不把健康200或单元测试代替部署成功。

## 2026-09-19 全迁移收口、全量验证与提交

- 09-21 13:09接续：1886项776bf50e…完整check38/38通过，根3296P/77条件S；当前生产三镜像已构建并实际Worker2P/部署18P，根条件两组27P/43P。实网paid15普通图/Agent成功、模型目录503；paid16初版试跑和设置封面200后测试5秒等待失败，已修有界等待并实际PC/移动6.5秒延迟2P。paid17/18未进入收费，18明确登录200→touch200→账号status503，余额/请求/收费日志未变，不宣称上游已修复。579项完整三形态无重试回归已启动，完整API/自然小时沿原活进程继续；最新包/三旧备份/实网闭环/反向复核/最终提交仍待，91/96不变。详见09-21真实验收13:09节。

- 09-21 12:43当前：1884项88104ad1…完整check38/38已退出0（root3293P/77条件S、features871P），源码复核无漂移；完整API在原进程运行，当前三形态清单579项待最终整轮。paid-13模型目录503、免费预检登录502、paid-14登录Loading等待超时均保留，未发生收费；免费实际登录/连续三次目录及浏览器计时随后通过，尚未证明原失败根因，不放宽时限/限流。paid-15从零实网与当前三镜像构建已启动；最新包/备份/扫描/提交仍待，5个父项不提前关闭，详见09-21真实验收最新节。

- 09-21 09:00当前：真实同步1P、三端账号3P、付费方案全节点已逐段完成并实际下载格式2包，失败报告不改写为整轮成功；实际费用616,178点（含2次失败文本），与余额差完全一致。两条旧测试提示词经正常API软删可恢复，26条登录释放责任均released。修复限流映射/提示词契约说明/方案轮询节拍后，1851项ee593e6d…完整check38/38退出0；565项三端全量与API低并发复跑/自然小时仍运行，之后重建验证当前macOS包，不提前勾父项。当前逐屏源码/覆盖核对见ui-parity/README最新表；Windows/正式签名发布分列，未提交。

- 09-21最新：真实同步sync-6完整1P、退出0，含PC/移动/macOS双向修改、新PID、退出重登与删除收敛；429映射实际PG/认证及就地24P。普通账号生图1张成功；Agent实网输出中文domain违反英文枚举，独立诊断复现后补创建/修改共享提示词的契约单源说明，正式红测7P/2F→领域134P。中间真实实扣244,920点（含两次失败文本），与余额差精确一致；成功图片后续复用，无盲目重发。当前修复后方案链继续，最终全量/包/提交未完成。详细首败、授权和费用见[09-21真实验收](../../../docs/v2.5/V25-REAL-ACCEPTANCE-2026-09-21.md)，不提前勾父项。

- 09-21实网续验：sync-1至5首败均保留，第三/四轮暴露测试等待和清理需改用精确自有对象、记录首个失败；第五轮首次登录即502，直接上游诊断确认为429而非密码或会话容量。只读核实上游关键请求默认20次/20分钟、Redis窗口TTL，未清桶/改限制/伪造IP。新增实际Better Auth+PG回归先13P/2F复现错误映射；补账号域及认证边界后23P，保留原操作/选择重放保护，继续就地回归和真实三端复验。当前仅账号API错误映射及验收测试变化，最终全量/包证据须重新绑定；未新增收费、未关闭父项。

- 09-21接续：用户明确继续真实跨端同步、账号收费/方案全链、最后修复/回归/产物/验收及Git提交；Windows继续延期，正式签名公证/完整产品上线独立。上线后1850项源码逐文件复核无变化，已启用独立LIVE25新库与对象桶，不复用正式App/生产业务库。真实同步首轮在清理脚本漏JSON请求体处415；第二轮确认PC→macOS→移动→新PID→退出重登均经过，删除显示断言失败。只读核对云端及第二轮本地记录已删除，定位测试直接IPC绕过了共享UI的查询刷新，且第一轮删除提交前就拉取；改成实际“立即同步”按钮并等待Web删除HTTP成功，保留首败，待复验。没有新增收费，不提前勾选其余父项。

- [x] SSH释放目标账号旧会话并完成会话治理设计（2026-09-20 用户新增）
  - boundary: 核实实际账号主机与唯一xiaomiao身份，只撤销其50条旧登录；审阅线上精确版本，输出自动回收、完整认证后的满额选择、已登录设备管理、故障/并发安全与实施验收方案，不把设计冒称已上线。
  - verify: 生产事务确认仅目标50行三字段变更，其他418行完整摘要和财务字段未变；最终两次验证会话正常退出，active=0。纠正首轮探测列表路径后，新登录200/会话列表200且仅当前1条/退出200/旧access及refresh401，exit0。完整报告与设计见docs/v2.5/V25-LOGIN-SESSIONS.md及session-release-*.json；没有收费或应用部署。
- [x] 账号会话生命周期机制落地与验收（2026-09-20 开发/本地联合验收及上游账号扩展上线完成）
  - 09-20生产终态：已按明确授权完成可恢复备份，仅升级New API，7.016秒恢复健康。切换时412有效旧会话、11保护表摘要及原SESSION_SECRET/环境/其他容器不变。旧凭据跨升级可用，真实新协议/显式释放/重放/refresh后清理及双旧凭据401验证通过，测试活跃会话归零、其他411条不变。事后字段级审计确认唯一用户数据变化为xiaomiao.last_login_at，精确匹配验证登录，积分/计费/其他字段不变；首败报告保留。证据见会话机制§10及new-api-deploy-20260920目录。仅关闭该功能子项（91/96），不关闭完整MVP或将Musefold v1.1公共站点宣称已切换；真实同步/收费方案继续独立验收，未收费、未提交。
  - 09-20上线授权已取得：用户在确认需要修改New API账号服务源码及后续维护成本后回复“好的，拿去修改吧”。执行先备份、仅部署已验兼容New API扩展并做实网验证；保留SESSION_SECRET、账号/积分/计费与有效旧会话，不自动切换Musefold线上站点。该授权不代表部署已经成功。
  - 09-20 16:38本地终态：完整E2E552P/0F/13S/0flaky、60分钟、退出0（PC170/4S、移动169/5S、Electron213/4S），源码1850项bb580e98…不变。13S=3视口不适用+2真实镜像UI已专项补验+8实网入口未执行。重新打包7P/3真实备份升级、原件SHA不变，源码/安装包/49ZIP扫描0/0，23构建/7集成/原生字节精确匹配。旧包原生UUID差异已通过重打包解决，早期包/失败均保留。完整本地结果见local-validation-summary-final.json及会话机制§8.3–8.4；真实账号同步/收费需账号扩展生产部署后继续，未收费、未部署、未提交。
  - 09-20 16:09接续：方案包自然小时2P/0F/0S、退出0，实际自然等待3606秒，原6个期限不变；前置场景与API全轮重合不重复累计。完整API的2项条件跳过已分别以真实账号扩展镜像及自然小时报告补齐。完整E2E在macOS阶段，会话满额真实IPC→继续登录、离线退出→新PID释放已再次通过；最终安装包等待整轮成功后串行重建和验证。
  - 09-20 15:44接续：完整API干净复跑99文件1153P/0F/2S、1475.41秒退出0，迁移43项和旧HTTP9项在整轮再次通过。2S为已独立通过的真实账号扩展镜像全链及仍运行的自然一小时方案包场景，不算通过或重复累计前置场景。第6次check38/38、当前565项完整E2E仍在原进程运行；源码生产输入未变，未部署/未提交。
  - 09-20后续：三组旧HTTP登录夹具按主进程绑定/候选确认适配后9P，根条件组干净复跑27P；完整API已重跑。E2E旧账号视觉基线漏新增设备卡，原夹具返回404；补正常脱敏列表、当前禁选/滚动/稳定时区，人工复核PC/移动4张截图后无更新模式8P。首轮失败保留，完整三形态仍待干净终态。新包/镜像生产源码无漂移；仅测试与基线变化，1850项bb580e98…；无生产写入/收费，详见会话机制§8.2。
  - 09-20 15:15接续：实际arm64/amd64账号扩展镜像均通过跨服务认证/容量/释放测试，PC/移动真实页面2P，macOS包7P/三备份3P、扫描0/0。完整API发现0030新增迁移后旧故障注入不再命中，已保留0029并补0030末尾trigger故障，43项真实迁移回滚全过；旧受管失效授权断言及purge测试登录也已按新协议修复并复验，不放宽产品授权。全量API/E2E与自然小时仍运行，最终check须在E2E结束后串行执行以免重建其服务产物。生产待明确授权，未收费/未提交。
  - 本轮补充：满额自动弹出清理框，固定选择明确确认后继续同次登录；仍满则刷新并再次提示。先实现上游事务与生命周期，再接服务端持久补偿、双Gateway和共享弹窗，隔离安全测试后实网复验。不将本项局部完成当作全迁移完成或提前提交。
  - boundary: 经SSH核实实际账号服务及xiaomiao唯一身份，先只撤销该账号阻塞会话；实现合理的过期/闲置回收、当前登出释放、登录上限安全恢复与脱敏会话列表/用户显式选择撤销。沿contracts→服务端/New API→双宿主Gateway→共享features，不列出凭据、不放宽身份校验，不静默踢活跃设备，不改余额/费用/生成或其他用户。
  - verify: 过期/闲置/活跃边界、登出与失败补偿、并发容量、跨账号越权、挑战时效/单次使用、敏感字段不泄露；共享组件/API/真实数据库及Web/Electron交互、最终统一check/E2E/新版产物均完成，详见V25-LOGIN-SESSIONS.md§8.3–8.4。上游同源amd64镜像已备份后生产部署，实际兼容登录/新协议/会话释放和数据保护审计通过，见§10；生产未做满额挤占/时钟注入。其余带日期记录为历史阶段，不覆盖最新终态。

- 09-20本轮终态：1813项fa3235d0…无漂移，check38/38、完整API96文件1138P/0S（自然小时3604秒）、Worker322P/0S、根75条件项全部补验、实际镜像部署18P、完整三端545P/0F/11S/0flaky、当前macOS arm64 ad-hoc包7P及三授权旧备份3P，源码/安装包/49份实际ZIP扫描0/0。按B26/B30原boundary关闭这两个非真实收费的重试/旧入口子任务，不连带关闭P6、完整MVP或发布；其实际条件及11S明细见[本轮记录](../../../docs/v2.5/V25-NONWINDOWS-ACCEPTANCE-2026-09-20.md)。真实账号官方网页确认AUTH_SESSION_LIMIT，已请求用户释放旧会话；新增收费调用0，真实同步/方案链路仍未完成。Windows延期，未提交、未发布、管理员未启动。

- 09-20非Windows最新续验：现有积分内收费授权已确认，不充值；外部账号登录仍返回409，已修复误报密码错误（客户端87P），两次真实同步首败保留，新增收费调用0。C3-B旧暂停夹具锁住响应流的假阳性风险已用同账号正例先红后绿排除，最终3P覆盖正向恢复、换号与窗口新意图确认、SIGKILL原键恢复。当前1813项fa3235d0…统一check38/38、完整Worker322P、实际镜像部署18P、根默认75条件项全部独立补验、源码扫描0/0；完整API/三端E2E尚在运行，当前macOS包待它们结束后重建。实网报告密码已脱敏并复核0命中，helper受控成功路径2项通过，不替代真实账号。详细首败/授权/证据以[本轮记录](../../../docs/v2.5/V25-NONWINDOWS-ACCEPTANCE-2026-09-20.md)为准；下面按阶段保留历史，不提前关闭父项。

- 09-20用户调整：Windows App 验收延期，先完成其余 v2.5 开发与测试。推翻“Windows SSH 未通即停止其他平台收口”的顺序假设，不删 Windows 验收或降低其他平台标准。当前沿原7个父任务逐项复核：先核对重试/旧入口与页面完整性的现有同源证据，补实际账号模型/同步/方案链路和非Windows包测试，再做最后统一验证与验收记录。Windows 专属缺口独立保留；真实收费预算待本轮用户确认，生产发布不自动执行。boundary：原迁移范围及验证入口；verify：非Windows每项都有匹配源码的实际结果，外部条件与延期项分列，不把历史未更新文档当作新的代码缺口。

- 09-20新凭据补验：三端真实登录/提示词CRUD 3P、桌面TvT连接1P；正式API读取真实15项账号目录/云价（3项图像模型）。新凭据只入本次进程，962文件精确扫描0命中/0错误，没有新收费请求；原完整544P/8S不改写，其中4项实网跳过已独立补验。用户已指定局域网Windows SSH目标，但本机仍在服务端banner阶段超时，尚未远端执行。boundary：原LIVE25隔离数据与既有测试，不改线上或正式App；verify：两份独立Playwright报告均退出0、无跳过/重试，源码1810项4db5b5b8…未变；证据见收口记录及`live-reconfirmed-summary-1.json`。真实云费用/方案文本/双设备、Windows/签名和远端发布父条件继续开放，87/94且未提交。

- 09-20接续审计最新：当前1810项4db5b5b8…的Skill可信来源、终态零来源重读及缓存账号校验修复已完成本机验证。最终check38/38（root3214P/75条件S、features850P），75条件项逐文件核对：本次服务17P，未变输入58项沿准确报告承接。最新完整三形态544P/0F/8S/0flaky、退出0、56.7分钟（PC167P/2S、移动166P/3S、Electron211P/3S），无重试/无截图更新。8S为3个视口不适用、3个真实账号及2个真实密钥/付费条件，不计通过。新arm64 ad-hoc包7P、三授权旧备份3P且原件不变；源码、App/DMG/ZIP及49份真实ZIP扫描0/0，2份UI占位按原始内容单独通过，17份故意拒绝输入另列。源码与23个包内构建文件收尾无漂移。87/94、完整MVP和真实账号/目标平台/正式发布条件仍开放，未提交。 boundary：既有managed run接缝及关联测试，不改收费授权、冻结UI或云MCP能力。verify：可信来源、原调用/费用不变、同键/重启及真实换号身份断言、同源全量与实际包。

- [x] 账号模式支持云端新增模型、用户切换及云端权威价格（2026-09-20 用户新增）
  - 最新终态（09-20，本子项完成）：完整check38/38（28缓存）、API1138P/0F/0S（含自然一小时）、Worker322P/0F/0S；最终完整三形态543P/0F/8S/0flaky，PC167P/2S、移动166P/3S、Electron210P/3S，快照更新及重试关闭。当前1807项aafa2f35…摘要复核无漂移。组件22P、完整API账号目录15P/准入4P、Worker真实PG/HTTP及最终Web/Electron模型用例验证不同价格、云端新增/价格更新、分组、缺价拒绝、选择持久化/换号隔离、普通和方案实际发送、参考图及冻结模型/原费用。当前实际arm64包7P、三真实旧备份升级3P、镜像部署恢复回切18P、源码/包扫描0/0；根75条件S另行分组补验。首轮528P/13F/8S及四文件复验34P保留。仅关闭本新增功能子项，任务87/94；真实账号、Windows/正式签名安装、远端CI/TLS/MCP与完整迁移父项继续开放，未提交。详见收口记录09-20最终节。
  - 下列开发与首败记录按阶段保留；其中“仍运行/待复验/未完成”为当时状态，不覆盖上述最终结果。
  - boundary: contracts/platform/api-client、New API 模型与定价客户端、API账号/生成/Worker权威校验、桌面账号云连接与IPC、共享工作台模型选择及相关测试/规范；不修改上游收费配置，不自动发起真实收费测试，不放宽账号身份/幂等/旧费用恢复保护，不扩展冻结面。
  - verify: 至少两个云端模型与不同价格、云价格变化、账号分组适用性、缺失/无效数据失败态、选择持久化与换号隔离、展示/预估/实际发送模型一致；API/Worker真实集成和Web/Electron交互测试，最终check/全量E2E。最小路径沿现有模型/定价接口与共享Gateway；先审计固定别名与执行绑定约束，不能只改下拉框或保留本地静态价格兜底。
  - 原549项当前累计13F：恢复竞争的binding/before-claim × account/restore另4F，原因同为fetch暂停钩子未识别模型目录。待该文件全部10项结束才补路径；保留原恢复/换号/费用/零重发断言，新增目录与第1/2次读取、子任务冻结模型断言。类型/格式通过，Electron待复验。当前1807项aafa2f35…相对最初5b2a680d…仅七测试/夹具文件变化，旧hash重建通过，生产源未变；证据models-final-test-delta-5.json及收口最新节，父项不勾选。
  - 原完整回归现9F：另有云重试pending测试的holdBinding漏拦新模型目录，实际HTTP先复现models提前返回，补两路径暂停后释放前零发送/释放后双契约验证通过；原UI三入口pending断言保留，新增真实held计数及重试冻结模型断言。受影响真实云服务17P、类型/格式通过，Electron尚待复验。当前1807项10511d4b…与最初5b2a680d…五测试文件差异已精确重建，生产未变。API自然小时UTC21:27:38开始、原到期约22:27:41；原两进程继续，不重启或提前提交。详见收口最新节与models-final-test-delta-4.json。
  - 当前完整549项已有8F：PC/移动方案协议夹具未登录/无目录6F，Electron账号恢复回环服务未提供目录2F，均在发送前被正确阻止。补齐各自账号/目录前置，新增访客零发送、model/binding、云价及重启后model断言，保留原发送/取消/恢复/费用保护；类型检查通过，浏览器复验未执行。当前1807项d86c6b93…与原5b2a680d…三个测试文件差异已重建核对，生产/API/Worker未变，E2E源码已变。原完整API/三端仍运行，待终态后串行复验及最终check/全量；不抹去首败，不勾父项。详见收口最新节与models-final-test-delta-3.json。
  - 根目录条件回归已补27P+12P；隔离PG首轮16P/1F发现旧测试固定12条迁移断言，改为实际完整链hash/时间戳精确比对后17P，生产迁移未改。部署计划/manifest26P、类型检查通过；75个条件跳过中的57项已补验，余18项实际镜像/隔离部署待当前镜像。唯一变化为独立DB测试，当前1807项74b0b9c6…，替回该文件旧hash可精确重建原5b2a680d…，生产/E2E/API/Worker源码未变。原完整API和549项三端仍运行，最后完整check待其终态后执行；当前包三旧备份输入SHA已核对不变，后续私有副本补验。首败与边界见收口最新节，父项仍不勾选。
  - 当前同源终态：1807项5b2a680d…打包后复核无漂移；最终check38/38、root3203P/75条件S、features850P、源码扫描0/0，生产镜像完整Worker322P/0F/0S；当前arm64 ad-hoc实际包7P/0F/0S/0flaky、扫描0/0，相关进程均退出0。完整API（含自然一小时）仍存活，完整549项三端回归已启动且不更新快照。三真实旧备份须按当前包补验；其他原外部验收条件保留，最终结果和manifest未闭合，不勾选或提前提交。详见收口记录最新节。
  - 最新共享方案入口已接：试跑/正式模型在建会话前复核，取消/换号不续发、同步双击锁与独立文本授权隔离；features专项64P、桌面映射3P，完整check38/38、root3199P/75条件S、features850P。实际PC/移动方案与Electron账号基础模型联合3P；新增参考图/提示词投影和身份变化扩展继续。两张完成态截图已逐图核对并补消息滚动可达断言，重收后关闭更新的Web工作台32项通过。后续测试增量最终完整检查、同源全量及原外部条件未完成，仍不勾选；首败与范围见收口记录最新节。
  - 引用扩展已复现并修复macOS系统父目录别名导致合法参考图误拒绝：路径单测首败3P/1F，修复后相关60P，完整check38/38、root3203P/75条件S、features850P、扫描0/0。新构建联合14P/1定位器F，精确定位inline错误后Electron账号参考图/提示词投影/身份变化定向1P。当前1807项5b2a680d…已启动最终完整check、完整API和自然一小时；Worker镜像重建中，后续三端/包与原外部条件未验，不提前提交。
  - 09-20接续：鉴权目录已接通；显式model经API当前目录/价格与事务身份校验后冻结，Worker最终校验并用于generations/edits；桌面持久请求与提交保留所选模型，连接行不改。API/回执联合52P、Worker真实PG/HTTP27P、桌面/账本/契约123P，单元53P+74P；首败与边界见收口记录。共享UI、选择持久化/换号隔离、展示/发送联合E2E及最终全量尚未完成，不勾选本项。
  - 当前增量完整check第三轮退出0，38/38、根3180P/75条件S、features811P；源码扫描0/0，1796项05468314…。首两轮失败保留；IPC目录夹具字段与R/S测试变更窗口已修、定向38P。旧包/旧三端报告不继承为本片最终验收。
  - 普通生成共享模型选择、按账号保存偏好、云价展示及发送前复核已接线；首次默认模型被移除/缺价后静默改选已以20P/2F复现并修复，模型专项22P，PC/移动真实浏览器6P。工作台全文件30P/2视觉F仍待核对；未把旧截图自动改为通过。
  - 方案模型后端：云端契约/计划103P、真实PG/API/回执与Worker子进程23P；桌面主进程模型计划、持久R/S发送、工作台投影和双账本已接线，真实SQLite/回环HTTP及原IPC/adapter联合167P（含不同模型试跑/正式、缺价拒绝、已领取后取消与剩余零发送）。当前完整check38/38、根3196P/75条件S、features837P，源码扫描0/0。当前构建既有Electron工作台11P/0F/0S/0flaky，不替代新账号模型路径。共享方案提交映射/模型UI、完整账号Electron与引用/身份组合、最终同源全量继续沿本项；Spec校验仍退出1，证据和首败见收口记录，不勾选父项。

- 09-20本轮：真实旧备份实际包首轮0P/3F揭示FTS中文分词丢失；新增0014派生索引标记及core原子重建，不改历史SQL/接管账本。专项67P、完整check38/38、实际arm64新包smoke7P及三旧备份升级/数据保留/媒体双重启3P通过；原备份和图片SHA不变。包前输入1787项4023c3d8…；之后进入多模型传输/价格校验，最终全量须按新源重跑。原完整E2E终态530P/2F/8S，相关登录前置原样定向4P，不改写全量失败；详见[收口记录](../../../docs/v2.5/V25-CLOSEOUT-2026-09-19.md)。任务86/94和完整迁移/外部平台条件不关闭。

- 09-20接续G-DATA-03/实际包：新增显式授权真实备份专用验证入口；仅私有复制三份已授权历史备份，不读取活动库或复制凭据。boundary：`tests/v25`真实备份fixture/专用Playwright配置/包身份共享校验及就地安全测试，测试类型检查接入；不改生产迁移、不触原App数据。verify：实际包逐字节绑定当前desktop/out，原记录/费用/路径与FTS先保留；再在停止的副本中显式重定位真实图片，核对两次新PID的media协议字节/renderer解码与原文件SHA；单测5P，实际包待当前540项E2E结束后串行运行。路径重定位属于测试准备，不当作产品升级步骤；正式安装、其他平台、真实账号和完整父任务仍开放。

- 09-20最新：隔离实际Compose专项最终8P/0F/0S（`staging-rollback-3.json`），双Worker队列ack、双视口登录/CRUD/同步、受控成功/失败/取消、真实MinIO清理、69表108行停写备份恢复/截断备份拒绝/对象复制中断续传、三个实际历史镜像回切并切回均通过。boundary：部署测试/fixture、测试env白名单及`tests/repo`类型检查接入，不改生产应用/旧线上；verify：原始报告与收口记录，非应用构建检查36/36、源码扫描0/0，当前1778项`7d7c783d…`。完整E2E原87010207…仍运行，最终增量完整check待结束后执行；受控账号、本机源身份占位、同PG集群恢复及非正式旧镜像边界明确，TLS/实网/平台/远程MCP/CI/生产条件和86/93不关闭，不提前提交。

- 接续G-RELEASE-04的R04.4/R04.5：新增隔离实际镜像Compose夹具，使用独立PG/受限角色/MinIO、受控HTTP账号及图片上游；生产Web双视口同源登录与提示词、owner/乐观锁/同步重放、成功/失败/取消/对象清理、运行服务重启和退出正在实测。boundary：scripts/deploy就地integration/fixture与测试env白名单，不改线上、付费Provider或未授权发布；verify：真实不可变镜像实跑、截图/HTTP/PG/队列/S3证据，之后补备份恢复与版本回切。当前夹具计划source字段不是正式源/产物证明，远程TLS/独立MCP/生产仍未验；当前完整E2E继续使用87010207…启动输入，不因新增部署测试冒称全树同源。

- 最新：当前arm64 ad-hoc包构建退出0、严格包测试7P/0F/0S、DMG/ZIP/App扫描0/0；旧包已备份，当前hash见收口记录。重新核对源码87010207…漂移0后，当前完整540项三端回归已启动，终态待收。Spec验收退出1，86/93与完整MVP未验语义保持；完整staging、真实账号/平台/安装升级、远程MCP/CI/生产授权等仍开放，尚未Git提交。

- 当前完整check已退出0（38/38，root3117P/67条件S、features811P，双端及末尾Web构建），源码摘要仍87010207…；当前三端完整重跑待启动。为继续原生包验收，原09-15 DMG/ZIP/App已保留到本轮报告目录，当前arm64 ad-hoc包构建正在执行；严格包测试与产物扫描待验，Windows/正式签名/真实旧库安装升级不外推。

- 09-20最终续进：完整API第三轮1113P/0F/1专用小时S（小时单独2P已验）；角色所有权检查覆盖函数/类型后实际镜像8P。原完整三端531P/1F/8S/0flaky，唯一移动D44旧基线已按规范看图并重收PC/移动、关闭更新独立2P；保留旧1F。当前1775项源码87010207…，再次扫描0/0，完整check正在运行、完整三端需重跑；新包/完整staging/外部账号平台生产条件保持原范围未闭合。

- 最新终态：原自然一小时生命周期2P/0F/0S，3613.85秒退出0，实际API/PG/Worker与受控S3HTTP；到期前保护、到期后清理与回执/已采用资产保留通过，不外推真实云S3。新部署增量非应用构建检查36/36、root3117P/66条件S，角色7项另有实际镜像7P；源码扫描1778项0/0。Web正式镜像已构建，完整staging业务仍未验。完整check/当前全量E2E及API第三轮仍待，不关闭父项。

- 09-20接续：当前API镜像迁移2P、受限运行角色首轮4P/1F（实际入队RLS拒绝）后定向四表策略修复，最终真实镜像7P；未知schema回滚、DDL/账本拒绝、无关角色拒绝、双Worker ack/退出均覆盖。planner授权步骤14P。容量3P、retention4P后，完整API第二轮1112P/1F/1小时S，双进程默认5秒超时原样定向1P，调整到真实进程30秒预算后完整复验中。原完整E2E/自然小时测试继续；快照新增入口和无横向溢出断言尚待重收，Web镜像正在构建。boundary仍为既有G-RELEASE-04与回归修复；verify见收口记录新节。父任务不关闭，未提前提交。

- 最新证据：当前正式Worker镜像完整315P/0F/0S；API首轮1102P/1F/1小时S及PG关闭竞争已定位，最终持久租约等待/连接end修正后完整复验进行中。新部署计划联合36P（含实际Compose）、迁移PG/CLI10P、首个实际API镜像2P；当前非应用构建检查36/36与源码扫描通过，最终镜像构建及完整check/跨端仍待。原540项回归移动方案列表旧基线1F已人工看图，须终态后刷新验证；一小时测试仍按自然期限继续。boundary/verify与原全部父任务不变，证据见[收口记录](../../../docs/v2.5/V25-CLOSEOUT-2026-09-19.md)，不把局部通过算作最终交付。

- G-RELEASE-04 当前实施：补 v2.5 生产镜像内的受控迁移入口（应用 schema + Graphile、独立迁移凭据、并发锁、幂等回放）及不可变镜像部署计划/dry-run。boundary：API deployment/migrate entry、部署脚本及就地测试、infra/v2.5 说明；不修改旧 v1.1 线上资源、不执行生产发布。verify：真实 PG 的空库/回放/竞争/失败锁释放与实际入口、计划负例及 Docker Compose 校验、完整 check；readiness、隔离 staging、回滚、远程 MCP 和生产授权继续按原 R04.1–8，不以计划生成代替部署验收。当前永久删除完整回归仍归属先前 930b6676… 输入，本增量需另外验证。

- 当前联合增量：永久删除共享入口组件34P；新增接口矩阵5F、检查更新在途保护2F、旧方案空sourceLabel二次解析1F、新用户无Pictures目录导致受管图片404的1F均已复现并修复。最终真实三端专项3P（Electron含v9→v11、221条分页、三个PID、实际文件删除/结果图片解码与字节保留）；`purge-check-5`完整check退出0、root3104P/56S、features811P，源码扫描0/0。1765项源码摘要930b6676…下的完整540项E2E与自然一小时测试已启动，当前Worker镜像构建进行中，终态待收。boundary：同一永久清理及旧数据兼容；verify：closeout原始日志与[收口记录](../../../docs/v2.5/V25-CLOSEOUT-2026-09-19.md)，不据局部结果关闭父任务或提前提交。

- 桌面永久清理接续：v11 持久文件清理队列、保留运行结果资产及双端 gateway/IPC 已接入；已复现并修复规范化路径与 macOS userData 别名不一致导致目录 GC 漏保的问题。新增跨版本结果、共享来源、原件保护、205 文件分批、v11 迁移回滚测试；core 专项 47P。宿主与媒体读取、共享删除入口及新 PID/全量验证继续进行，不据此勾选父卡；原失败保留在 `closeout-20260919/purge-core-reproduced.log`。

本轮沿原范围推进：双平台 artifact 哈希清单已接线；独立 Desktop 方案库 v10 保留运行/步骤/评估并增加 purge 身份防复活；双端已移除方案查询及无 200 条上限的严格分页已接入。191 项合同/仓储/IPC/发布专项、真实 PG 205 行分页、实际 Electron v9→v10/221 行/新 PID 验证通过。boundary：既有方案清理、发布身份及必要测试稳定性；verify：收口记录与 closeout-20260919 原始报告，最终 check 38/38（0 缓存，root3080P/56S），新构建 Electron 再验 1P、源码扫描 0/0。永久清理事务、文件生命周期、共享操作入口、完整三端/API/Worker/新包及实网/跨平台仍待，不勾选父卡。

- boundary：延续全部未关闭父任务；补方案永久删除的客户端与双宿主产品入口、D02 生命周期联合验收、发布产物身份绑定及 v2.5 部署/回滚缺口。复用既有服务与共享组件，保留原真实账号、Windows/macOS 原生包、旧库升级、双设备、费用、远程 MCP 验收范围；管理员仍在迁移全部闭合后接续。
- verify：最终同一源码运行 `pnpm run check`、完整数据库 API/Worker（含实际容器与独立一小时生命周期）、三形态 E2E、Electron、严格安装包冒烟与源码/产物扫描；实际环境结果分别绑定构建身份。真实凭据、平台、签名或部署条件缺失时保留未验结论。按任务逐条审查后更新清单/manifest，运行 Spec 校验，最后 Conventional Commit 提交，不自动推送。
- 当前可执行子项：安装包哈希接入 release 的 mac-package/win-package；方案删除记录查询与清理产品接线；其余逐项证据见 [收口记录](../../../docs/v2.5/V25-CLOSEOUT-2026-09-19.md)。本次核对分支仍为原 integration branch；原 337 个已修改路径与 708 个未跟踪项均作为既有工作保留。

## 2026-09-19 接续：真实账号与中转站验收准备（LIVE25）

- boundary：在既有数据与费用接缝之后，建立独立本地 PG/S3/API/Worker 验证环境；补齐可重复的真实账号、TvT 连接与单次生图/持久化验证。账号凭据仅由本机私有环境文件注入，密钥仅由现有 safeStorage/服务端保存；不改写原数据库、不发布生产或变更上游配置。
- verify：当前构建的 PC Web、Mobile Web、Electron 真实登录与提示词 CRUD；TvT 连接、一次明确生图、图片可读及重启保留、明文泄漏检查；`pnpm run check`、适用回归及脱敏报告。外部服务失败与功能失败分开记录，禁止把跳过算通过。证据目录 `tests/v25/.results/live25-20260919/`。
- 当前目标是达到并验证真实账号/中转站测试入口，不据此关闭跨平台签名安装包、生产部署/回滚及整包迁移父任务。安装包 manifest 与原生升级仍保留原验收范围。
- resolved_current：新增独立实网配置、严格凭据/收费开关/URL 校验及单张出图重启测试；修复实网失败页面快照记录密码的问题，并完成真实 Chromium 受控失败脱敏回归。最终 check 38/38、前置条件 8P、TvT 实际出图 1P、源码扫描 0/0；本轮源码 1738 项复核漂移 0。
- external_blocked（仅账号正向验收）：三端登录均被实际账号服务拒绝，独立上游请求同样 success=false，已停止重复尝试并请求用户核对。Web/API/双 Worker/PG/S3 与桌面入口均运行；准备阶段完成，账号正向验收、云费用/方案文本/同步及原发布父任务不勾选。报告：[LIVE25](../../../docs/v2.5/V25-LIVE-ACCEPTANCE-2026-09-19.md)。

## 2026-09-19 接续：设计方案永久删除（D02PURGE，后端切片已验收）

- boundary：补齐现有契约、0029/schema、共享对象退休策略、单方案已认证 purge 服务与 HTTP 入口；只允许已软删且版本匹配的方案。保留运行/费用/冻结引用，保护其他方案与租约；不扩展 UI、同步或管理员范围。
- verify：隔离真实 PostgreSQL 与 MinIO 验证迁移、权限/版本、重复请求、并发、事务回滚、来源共享、物理删除失败与重启恢复；运行 `pnpm run check`、根 `db:migrate` 首次/重复、完整 API/Worker 数据库测试；证据保存在 `tests/v25/.results/d02purge-20260919/`。
- resolved_current：补齐缺失模块与 API/Worker 类型错误；迁移故障注入扩展至 0029；修正原有参考图测试跨宿主/PG 时钟的错误断言（生产代码不改）。
- 验收：最终 check 38/38；API 91 文件/1102P/0F/1 专用小时 S；Worker 40 文件/315P/0F/0S（当前正式镜像）；PG/API 专项 51P、真实 MinIO 3P；现有 PG 与三份真实 SQLite 旧备份仅在副本上验证升级、原行保留、历史回填及重复执行，原备份不改写。源码最终核对漂移 0。
- 证据与边界：[测试续篇 §5.113](../../../docs/v2.5/V25-MIGRATION-TESTING-CONTINUED.md#5113-d02purge方案永久删除后端与真实旧库副本验证2026-09-19)。本片完成不等于 86/93 父任务全部关闭；客户端接线、原生安装包升级、真实费用/双设备/生产发布等继续按原范围验收。

> 2026-09-07 当前状态：B9 部分切片已完成统一源码、API/Worker integration、Web/Electron E2E 和 macOS arm64 严格包冒烟，最终命令、报告、产物摘要和未闭合项以 [开发记录](../../../docs/v2.5/V25-DEVELOPMENT-LOG.md) 为准。B1–B8 保留为历史，工作树仍含未提交增量，整包与各大任务不因批次通过而关闭。后续入口见 [迁移路线图](../../../docs/v2.5/V25-MIGRATION-ROADMAP.md)、[goal 任务卡](../../../docs/v2.5/V25-MIGRATION-GOALS.md)与[测试手册](../../../docs/v2.5/V25-MIGRATION-TESTING.md)；Cloud MCP 继续只读；随后 goal 已授权在剩余 v2.5 全部完成后开发管理员端，当前仍先闭合迁移。

## 使用规则
- 每个任务都要写清楚 `boundary` 和 `verify`
- 如果一个任务没有验证方式，就不能开始
- 发现的可执行问题必须回写本包，并在本轮做完
- 新任务包使用 `YYYY-MM-DD_<verb>-<object>`，详见 `references/naming-and-commits.md`

## 阶段一：基线与任务包
- [x] 固化迁移目标、关键假设、非目标和 integration branch
  - boundary: 只更新本包 `spec.md`
  - verify: `spec.md` 写明 v2.1 parity、四端范围、豆包入口、桌宠冻结面和 branch
- [x] 创建独立 integration branch 并保存上一轮未提交成果
  - boundary: 只执行 Spec 初始化与 Git 保存/切换，不改业务逻辑
  - verify: 当前分支为 `spec/2026-09-01_migrate-v21-to-v25`，上一轮改动可由 `stash@{0}` 恢复
- [x] 恢复并盘点上一轮迁移成果
  - boundary: 只恢复 `stash@{0}`，按 `git diff --stat`、迁移卡和测试目录建立本包基线，不删除已有改动
  - verify: 工作树包含上一轮迁移改动；盘点结果记录在本包或 `docs/v2.5/V25-MIGRATION-CARDS.md`，无无主文件

## 阶段二：契约、数据与服务主链路
- [x] 收口 v2.5 contracts、platform gateway 和 API client 的实体/方法契约
  - boundary: `packages/contracts`、`packages/platform`、`packages/api-client` 及其就地测试；不改宿主 UI
  - verify: contracts/platform/gateway tests 通过，所有 gateway 方法由 zod schema 推导且 Web 调用出入参一致；`pnpm run check` 已通过
- [x] 完成 PostgreSQL、SQLite 和 core 本地数据迁移与兼容性校验
  - boundary: `packages/db`、`packages/desktop-db`、`packages/core`、相关 migrations/tests；不改云端路由或 UI
  - verify: schema tests、desktop takeover/migration tests、repository lifecycle tests 通过，旧数据保留且生成账本唯一；`pnpm run check` 已通过。真实 PG replay、匿名 v2.1 语料和备份恢复仍由后续门禁单独判定
- [x] 收口 API、Worker、生图状态机、同步和 workbench 服务
  - boundary: `apps/api`、`apps/worker` 及其 integration/unit tests；不改桌面 IPC 或 features
  - verify: API integration、generation/worker、sync/workbench tests 通过；取消、重试、幂等和 reconcile 不会卡死；`pnpm run check` 已通过。B9 已补真实子进程、PG/Graphile 和 epoch 竞争证据，生产 bin/容器恢复及完整竞争矩阵仍待验，边界见下方 B9 与开发记录

## 阶段三：桌面与共享产品 UI
- [x] 收口桌面 v25 IPC、preload、window lifecycle 和 desktop gateway
  - boundary: `apps/desktop/electron/main/ipc-v25`、`preload/v25.ts`、`main/application.ts`、`main/window.ts`、`apps/desktop/src/v25/desktop-gateway.ts`
  - verify: 各域 IPC 单测、preload/window/gateway tests 通过；数据域保持 `musefold:invoke`，窗口信号不混入业务 gateway；`pnpm run check` 已通过。最近 Electron project 为 33 passed、1 failed、1 skipped，唯一失败是 macOS 原生全屏前 runner 无法让 shell BrowserWindow 获得前台焦点；Workbench 与 Design Scheme 业务用例通过
- [ ] 完成设计方案全链路迁移与 v2.1 功能 parity
  - 09-21 14:55：paid20在账号模型503处终止，0P/1F，无新增费用。透明API网络记录证明本轮profile/定价读取在10秒无响应头超时，退出释放由既有持久补偿最终200；未改超时或鉴权，未把链路暂时恢复当根因修复。既有第二模型结果保留，移动修改/升级/导出接续和从零整轮仍待。
  - 09-21 14:26：paid19实际初版转正及第二模型正式运行成功，随后详情503，原整轮失败保留；新增60,000原始quota已核账。免费连接对照复现10秒TLS/HTTP头前超时，不把它误作方案业务失败或通过加超时掩盖；正从精确成功run/真实字节校验后继续移动修改、升级、导出，不重复已成功收费。完整新整轮仍待。
  - 09-21后续：paid-11发现转正后旧版本竞态，正式修复mutation等待刷新及依赖动作禁用，组件57P、全features865P、PC/移动真实慢读取2P；paid-12复用已有正式版免费检查并导出2,159,628字节真实包1P，严格解码/递归安全扫描及账本零新增收费通过。该次是接续，不关闭从零完整收费复验；失败报告保留，见09-21真实验收最新节。
  - 09-21限流专项14P后paid-10无429（325次读取全部成功），完整收费节点含移动修改/新版试跑已完成，但最终选封面等待加载态失败；费用6次461,100已与账本核对。补实际详情就绪等待并从原成功版本免费恢复，仍不勾整轮验收；paid-9与paid-10首败保留。
  - 09-21最新实网：paid-9全新整轮仍因读取429失败；普通图、Agent创建、初版试跑/转正、第二模型实际成功，未进入移动修改。发现事件逐条失效四组查询叠加轮询的请求放大，正合并刷新并加入仅原GET的有界限流退避；不放宽上游限制/缓存鉴权/自动重发付费POST。原失败、实际272,378增量quota与新红绿测试见09-21真实验收，完整复验未通过前此父任务保持开放。
  - 09-20当前依据：后续B批次已实现Web/桌面runtime、资产、云端Agent创建/修改/更新、试跑/封面/转正及专用包。Worker完整与新镜像补验322项、实际镜像部署18项、本机新包与三旧备份已通过；会话增量后的完整API/E2E终态及真实账号收费方案链路仍待。下面早期逐步实现记录不再作为“Web尚无runtime/云资产/包”的现状判断。
  - boundary: `packages/contracts`、`packages/platform`、`packages/features/src/design-schemes`、`packages/core/src/db/design-scheme`、`packages/db`、`packages/desktop-db`、`apps/api`、`packages/api-client`、桌面 `ipc-v25/design-scheme-domain.ts`/gateway、双端路由与就地/E2E 测试；不触碰豆包内部或桌宠
  - verify: v2.1 设计方案导航、列表/详情、创建/编辑/复制/删除、AI 生成/运行、版本与工作台联动按历史实现逐项验证；Web 与 Electron E2E、contracts/repository/API/IPC/features tests 通过。当前本地历史来源 owner-safe 链路、确定性 adapter、固定计划校验、取消和 `.musefold.design` 安全 staging/archive 已接线；Desktop cancellation-wins 已进入 checkpoint `607e7b5`：部分成功加后续取消时 canonical result、Design Scheme run ledger、terminal event 与 execution registry tombstone 统一为 `cancelled`，所有 active generation job IDs 均 fan-out cancel，并在评估/terminal outward event 前重检重入取消。主进程权威、text-only `prepareRun` 已接线：renderer 只提交选择、文本值与执行设置，主进程从 exact revision/source binding/Provider 事实生成并校验 `desktop-fixed-v1` 四步计划；reference assets、图片槽位、缺失/多余输入、revision/scheme mismatch 和未知 Provider 均 fail-closed。2026-09-01 Desktop Workbench run/cancel 接缝已接通：`WorkbenchScreen.designSchemes` 的宿主提交处理拆为 `onRun/onCancelRun/onCreate/onModify` + `runInputSupport`，桌面 `useDesignSchemeComposerHandlers()` 注入 `onRun`（prepareRun → run，await 终态）与 `onCancelRun`（按同一 executionId，含取消先于登记仲裁）；Composer 运行中转停止钮、成功复位保留附件、blocked/failed 就地错误行并保留输入、text-only 下图片输入禁用并解释、运行落活动会话并短轮询时间线。desktop-shell 17 tests、features 297 tests 通过；Electron Workbench 9/9，新增回环 Provider 下真实 IPC 运行后停止取消的双账本证据，Composer 输入保留且无方案资产提交。2026-09-03 Desktop Workbench `onCreate/onModify` 已接到主进程 Agent adapter（brief / 历史来源 runId/assetId 身份 → Compiler 落草稿；exact revision + 指令 → Reviser 产出待验证草稿），`checkUpdate` 以同一 Agent 文本连接做上游重编译；Agent 文本连接沿用 v2.1 `AiConnectionStore`（可在「设置 → Agent 连接」配置（2026-09-03 补齐 `AgentConnectionsPanel`）），无连接时结构化 `DESIGN_SCHEME_AGENT_AI_UNAVAILABLE`；同时修复 v2.1 历史来源 `history:<id>` 伪 URI 导致方案详情映射失败的 parity 缺陷。desktop-shell 22、domain 61、agent-adapter 4 tests 通过。GitHub Skill 来源已于 2026-09-03 闭环：`confirmInstall` 进部署方法表（18 项），renderer 从 brief 提取仓库地址，主进程解析后经 confirmation-required → 共享 `SourceInstallConfirmDialog` → confirmInstall 决定继续或整体取消（域 64、desktop-shell 25、features 305 tests）；Agent 创建/修改过程以一行进度展示在 Composer 上方；参考图运行已接通（Composer 上传暂存 id → prepareRun 按声明顺序分配图片槽位 → run 解析为受管本地图；桌面 text-and-images；plan builder 35、run adapter 20、domain 65、desktop-shell 26 tests）；Web runtime/cloud assets/package 和成功出图 E2E 尚未闭合
- [x] 重构设置界面为「分区注册表 + 分组导航」并写入设置项开发规范
  - boundary: `packages/features/src/settings`(SettingsScreen、sections 注册表、nav store、AppearanceCard 拆分)、就地测试、`tests/v25/{web,electron}.settings.spec.ts` 与设置视觉基线、`docs/v2.5/V25-UI-SPEC.md` §6 与 `docs/v2.5/V25-FEATURE-DEV-GUIDE.md` 新增「新增设置项」走线;不改 account/connections 各面板内部,不改契约与宿主
  - verify: 已交付(2026-09-03)。桌面 md+ 左分组导航(220px,搜索)+ 右分区面板,移动一级列表 → 二级面板(返回行);分区按 capability 门注册(Web 只有外观/账号),深链意图落分区并点亮、兜底账号,分区记忆跨屏保持、不可用时兜底首个分区,搜索按标题/描述/关键词过滤;面板只渲染当前分区,md+ 面板头让位卡片自述(消除标题重复);既有 testid 全部保留。features settings 25 tests(含注册表可用性/意图/搜索),Electron 设置 E2E 10/10、Web 桌面+移动 16/16,设置视觉基线三形态重收并人工核对(发现并登记:设置页留白多,2% 像素容差可吞掉整页布局变化,重收基线必须人工看图);根 `pnpm run check` 182 文件/1357 tests 全绿。UI-SPEC §6 改写为已交付形态+§6.4 新增设置项规范,DEV-GUIDE 新增 §8-C 走线
- [x] 打通官方账号登录闭环(xiaomiao 测试账号)
  - boundary: 账号登录链路涉及的 `apps/api` 账号模块、`apps/desktop/electron/main/ipc-v25/account-domain.ts`、`packages/api-client`、`packages/features/src/account`,以及本地起服务所需的 `infra`/环境配置;不改 New API 网关本体
  - verify: 已验证(2026-09-03,零代码改动——链路本身是通的,缺的是运行环境与正确的网关地址)。账号事实源为自托管 New API 网关 `https://zhaozhaoyue.top`(v1.1 生产主机;`docs/11-ai-tvt-wiki-api.md` 的 ai.tvt.wiki 是 Sub2API 生图中转,无账号接口,不可作 `NEW_API_BASE_URL`)。本地链路:OrbStack 起 `infra/v2.5` 的 postgres(55433)+minio → `pnpm run db:migrate` → `apps/api` dev(`NEW_API_BASE_URL=https://zhaozhaoyue.top` 等 env)→ HTTP 实测 `sign-in/new-api` 200 返回 token、`/api/v1/account/status` 返回 username=xiaomiao/quota=97,544,980/canGenerate=true → 真实 Electron 壳(`MUSEFOLD_API_URL=http://127.0.0.1:8787`)一次性 Playwright 驱动:设置→账号分区→表单登录→`account-signed-in` 显示 xiaomiao/1950.9 积分→登出确认→回未登录且 `v25-account-session.json` 已删除(脚本跑完即删,凭据不落仓库)。途中修复本地库 JWKS 密钥错配(换 BETTER_AUTH_SECRET 后清 jwks/session/user 表)。**阻塞登记**:生产 `https://api.musefold.app` TLS 不可达(未部署/被阻),云端部署属人工发布门禁(Q03);Web 宿主同链路经 dev proxy 指向同一本地 API,未单独驱动 UI
- [ ] 完成共享 AppShell、工作台、提示词库、历史、设置、账号/连接和归档会话 parity
  - 09-21 15:10：完整E2E发现OAuth强制重登表单竞态；迟到的账号状态改变review查询key，旧表单卸载并清掉正在输入的凭据，导致按钮禁用。确定性就地9P/1F→10P已修复：只在同一签名请求重新核对期间保留未提交登录表单，不保留旧consent权限，换请求或校验失败仍清空；实际PC/移动延迟真实status响应的重登用例及新全量已排入当前协调链。不得以隔离候选通过代替正式源码/浏览器通过。
  - 09-21 14:26：公告原始空白旧ID兼容已修，组件11P/契约传输桥接17P；两轮截图核对与独立局部ship完成。仅移动旧快照同步后，notices-hosts-3真实PC/移动/Electron新PID及app/file旧origin联合13P/0F/0S/0flaky，零重试、不更新快照。check4已38/38；局部通过不关闭整页及完整parity。
  - 09-21公告正式补迁：有界纯文本契约、New API独立严格读取、API认证前后核对、Web/桌面Gateway和共享卡片已接；显式已读仅保存本设备内容ID，按账号/服务隔离并保留旧origin白名单已读记录。传输先5F后通过，组件9P、契约/旧偏好迁移专项通过、真实PG/Better Auth/HTTP公告4P；双宿主、新PID/旧origin实际升级、全量及视觉复核待验，父项不提前关闭。
  - 09-21反向核对新增缺口：baseline旧`AccountSignedInPanel.tsx`有“服务公告”和“全部已读”，旧`AccountSection`按内容稳定id过滤已读。当前仅`new-api-client.getNotices()`保留，上层account契约/gateway/API/双宿主/共享账号页均未接入，且未登记为暂缓。需沿现有接缝补独立、非阻塞读取和持久已读动作，公告不进入登录关键路径、仅纯文本展示，不因此额外签发会话或触发收费；补共享与真实双宿主验收。当前冻结全量不能作为此修复后最终证据，保留原报告并有意停止其自动打包链。
  - 09-21 OAuth入口已实现并专项通过：实际BA/PG安全与原谱系27P，共享组件15P、client3P/契约2P、Web宿主58P；实际PC/移动独立双HTTP客户端浏览器2P，覆盖首登/同意/拒绝/强制重登/换码/只读工具/撤销B而A仍有效，以及小屏横竖/暗色/键盘。受控NewAPI不冒称远端实网；当前1884项88104ad1…完整check及原整体收口继续。首败与测试初始化/时钟/协议修正见09-21真实验收最新节；下方404为发现时历史，不再作为当前源码现状。
  - 09-21偏好缺口resolved_current：主进程正式接入只读白名单file/app旧origin→新JSON原子不覆盖迁移；真实Electron2F→2P，偏好/引导/设置/窗口20P，就地与守卫49P。已有v25选择、旧存储与凭据边界保留；新源码的全量check/产物仍待。下条09:57为发现时历史，OAuth入口缺口与其余反向复核尚未关闭。
  - 09-21反向旧版审计：旧版`musefold:app-preferences`/onboarding/生成默认与会话置顶存于Chromium localStorage；当前`readV25Preferences`只读新JSON文件，缺档直接默认，旧origin迁移实现也已删除。偏好控件对位不能证明升级保留。需补主进程一次性、白名单、只读旧数据的迁移，保留已有v25选择、失败可重试、不复制凭据或暂缓字段，真实Electron旧origin→新PID及文件持久化验收后才能关闭；当前冻结回归继续作为修复前基线，不改写为修复后证据。
  - 09-21反向旧版OAuth入口审计：API的Better Auth MCP仍声明`loginPage=/login`、`consentPage=/consent`，而当前Next生产宿主两个地址实测均404，旧Web的安全returnTo登录入口未迁入。已有令牌/授权撤销与程序化授权码测试不覆盖用户浏览器登录→同意→回调。需恢复共享用户授权界面和安全续接（不复制token进renderer、不接受任意returnTo、不放宽scope/owner/CSRF/PKCE），以两个独立客户端的真实浏览器授权及拒绝/撤销负例验收；已登录应用列表可用不能替代首次接入闭环。
  - 09-20当前依据：共享产品面和账号云模型/价格、登录设备卡/满额弹窗已落地，最新features860项及check第6轮通过，账号PC/移动8项与新设备卡截图复核通过；当前完整三形态复跑中。早期B9中“仍缺费用账本/生产Worker恢复/云Agent”等已由后续批次实现并验证，原记录保留供追溯；不能因此遗漏本次完整回归与真实账号验收。
  - boundary: `packages/features`、必要的 `packages/ui`；共享组件不得 import electron/next，桌宠代码不触碰
  - verify: features unit tests、`V25-UI-SPEC.md` 状态矩阵和 testid 对照通过；主要 v2.1 动作均有可发现入口。当前主路径和定向 Web/Electron E2E 已通过。B1–B8 已收口引导、历史/提示词完整性、多图、开放能力、使用统计、窗控、promptId、归档游标、Key 引导、豆包入口证据、桌面方案包、云端出图落盘、双列、Taxonomy Sheet、会话标题、移动键盘与时间线留白、额度引导/兑换重试/只读审批卡、worker 两刀 disposable、提示词/sync 裁剪、PG replay/bundle CI、双端活体登录。B9 已补本地费用协调、真子进程/epoch、云上传资产与生产验证基础；仍缺持久费用账本及完整矩阵、生产 Worker 恢复、云端 design-scheme run/市场/Agent、完整 D02-c/d 与 Q03 发布门禁
- [x] 批次 B1(2026-09-06,并行 6 卡,checkpoint 起点 `8b0ef3c`):按 ui-parity 差距清单收口 v2.1 parity
  - boundary: 每卡只改自己的屏/域文件;枢纽文件(contracts gateway-methods/index/preferences、platform gateway/capabilities/query-keys、desktop-gateway、settings/sections、shell/shortcuts)只做增量编辑;不动桌宠、豆包内部、V25-UI-SPEC/MIGRATION-CARDS(由主代理批次末统一回写)
  - verify: 已验证(2026-09-06)。六卡全部交付;批次末统一门禁:`pnpm run check` 35/35 任务绿(根 vitest 191 文件 1460 测试、features 396、boundaries 0 违规)、Web E2E 双视口 122 passed / 4 skipped、Electron project 55 passed / 1 skipped(真实 key 用例),三形态全绿。主代理修复:① `appPreferencesPatchSchema` zod 4 `.partial()` 回填 default → 桌面 bridge spread 会重置置顶/密度/生成默认/引导哨兵,改为剥 default 后 partial + 契约回归测试;② `useClearAllData` `onSuccess` 返回全量 `invalidateQueries()` Promise 被离线 `account.getStatus` 挂住 → mutation 永远 pending,改为只失效 prompts/workbench/generation/system 且不 await;③ 设置段控件(主题/动效/密度/质量 ToggleGroup)在 390px 视口溢出卡片,新增 `settings/segment-classes.ts`(<sm 铺满行宽、字号/内距收一档);④ `history.test.tsx` 两处 TS(自由错误码越过枚举、闭包赋值 never);⑤ drizzle 生成的 `0006_snapshot.json`/`_journal.json` 未按 biome 格式化;⑥ `electron.sync.spec.ts` 未适配设置分区导航(account/sync/connections 分区跳转);⑦ `electron.settings-data.spec.ts` 备份状态断言未计入首启 takeover 快照;⑧ `electron.prompts.spec.ts` 浅色基线吞入前序 toast,加 toast 消散等待;⑨ 宿主注入 `onOpenHistory`(desktop-shell / web prompts page)。视觉基线重收(先删再生,2% 容差不会自动重写):web `settings-light/dark`(双视口)、`prompts-detail`(双视口)、`history-list`(双视口)、electron `desktop-prompts-light/dark`、`desktop-history-light`、`desktop-settings-light/dark`。文档回写:V25-UI-SPEC §2.6/§4/§5/§6.2-6.3/§7.2/§8-I7/§9(D10、D13 过期项更正,新增 D18–D22)/§10.2;MIGRATION-CARDS U01-onboarding `done`、U02/U04/U05 已迁与待迁重写;ui-parity 01/04/05/07-02/07-03/07-06/07-07 由各卡销账;`docs/product/16` 清空边界表述更正。遗留(转 B2/B3):大库/大列表虚拟化(features 声明 `@tanstack/react-virtual`)、`promptId` 服务端过滤、密度 token 消费、S01 Key 失效引导、「需要重启应用」逃生门、Composer 预选断言补 `workbench-domain.test.ts`
  - B1-T1 提示词库完整性(U02,ui-parity 04 §8):封面缩略(契约 `coverImageUrl` + 存为提示词写入)、详情 Inspector/窄屏 Sheet(头部/正文/相关作品/元数据,「使用」主动作)、行点击开详情、清除筛选/新建 CTA、清空回收站(`prompts.emptyTrash`)、⌘/Ctrl+S、更新时间、复制 Check、`prompt-highlight` 接收端、⌘K/`/` 聚焦搜索
  - B1-T2 历史完整性(U04,ui-parity 05 §7):自定义日期区间、批量清理(30 天前/失败取消/清空回收站,`generation.cleanup`)、磁盘用量(桌面)、检视谱系「来自/派生」、桌面文件操作(打开目录/复制图片,`canRevealLocalFile` 门控)、错误建议文案、孤儿微调标注与「+n 微调」、成本/用时/种子字段、lg+ 检视 slide-in
  - B1-T3 AI 连接完整性(07-02 §6):`aiProviders.listModels`(草稿亦可拉取)+ 模型 combobox、编辑 Dialog 脏表单守卫、「设为默认」+ Composer 预选联动、行首状态点、新建流程内测试连接、接入预设目录、无 Key 前置提示、`role=status`;Agent 连接同享
  - B1-T4 偏好完整性(07-03 §5):`defaultAspectRatio`/`defaultQuality` 进偏好契约 + 生成默认参数卡 + 新会话草稿初始化/未改草稿联动;界面密度 `--density-*` 七 token + 两档 chips + `data-density` 同步;主题/动效动态 hint;偏好 error 重试钮
  - B1-T5 首启引导(U01-onboarding,基线 `apps/desktop/src/features/onboarding/*`):welcome → connect(官方账号 / 桌面 BYOK / 豆包冻结入口三轨;Web 只官方账号)→ validate → first-image → complete;跳过/返回/失败恢复;完成哨兵(`preferences.onboardingCompletedAt`)持久化、再启动不重放;已有 Provider 或已登录不触发;E2E 夹具默认已完成引导
  - B1-T6 设置·数据存储 + 关于(07-06 §6 / 07-07 §6,新 `system` 桌面域):数据库备份卡(立即备份/列表/恢复确认+重启)、存储位置(复制/打开)、诊断日志查看、危险区(确认短语「清空全部数据」)、关于卡(品牌/版本/schema/复制版本信息/文档/反馈信息/第三方声明/快捷键表 `PRODUCT_SHORTCUTS` 单源);`system.relaunch` 供「需要重启应用」逃生门
- [x] 批次 B2(2026-09-06,并行 6 卡,checkpoint 起点 `dcdf8d0`):工作台多图/开放能力控制面/账号与壳收尾/密度消费与虚拟化/使用统计/窗口控件
  - boundary: 同 B1(每卡只改自己的屏/域;枢纽文件只增量;不动桌宠、豆包内部、UI-SPEC/MIGRATION-CARDS/.spec);`packages/features/package.json` 仅 B2-T4 可改(加 `@tanstack/react-virtual`);`SessionListPanel.tsx` 仅 B2-T3 改;`AppShell.tsx` 仅 B2-T6 改;`Composer.tsx`/`GenerationTimeline.tsx` 仅 B2-T1 改
  - verify: 已验证(2026-09-06,darwin,未 commit)。六卡全部交付并验证。`pnpm run check` turbo 35/35 全绿(根 vitest 200 文件 / 1548 例,features 38 文件 / 495 例);Web E2E(web-desktop+web-mobile) 136 passed / 4 skipped / 0 failed,重生 web-mobile/settings-light.png、settings-dark.png(390×1253,默认张数,1134→1253);Electron E2E 67 passed / 1 skipped / 0 failed,重生 desktop-workbench-light.png、desktop-history-light.png;`electron.settings-open.spec.ts` 8/8、`electron.settings-usage.spec.ts` 已过、张数 2、history 新组、shell 增量均过;desktop-settings 基线未重生(视口内容差 < 2%)。额外修复:根 Vitest 为 use-virtual-rows 补 jsdom;引导 gate 用 isFetched,避免 BYOK validate invalidate 未登录账号查询打出 /models 风暴(曾 15s/2208 次)。Windows 控件带重叠本机未验。
  - B2-T1 工作台多图与结果消费(U03 / 03 §7 P2,D3 解锁):已交付并验证。契约 `count` 1|2|4 + capability `maxGenerationCount`(桌面 4,Web 依成本闸判定);Composer 设置弹层「张数」;桌面 workbench-domain 透传 `n`、资产按 position 多行;结果网格多图排布 + 逐图/全部保存;Lightbox 左右翻 + 方向键 + 「复制图片」(复用 `generation.copyAssetToClipboard`);用户消息 meta 参数摘要行(比例/质量/张数/微调来源);偏好 `defaultCount` 进生成参数卡
  - B2-T2 开放能力控制面 + AutomationConfirmCard(07-04 P1 / 01 §4 P1):已交付并验证。桌面 `automation` 可选域 9 方法接既有 `electron/main/automation.ts`;设置新分区 `open`(`hasLocalAutomation` 门控):开关/令牌(掩码 + 主进程复制,不进渲染层)/月度预算/最近调用审计;壳级 `AutomationConfirmCard`(花钱动作确认,超时=拒绝);Cloud MCP 已连接应用卡为 stretch(`hasCloudMcpControls`,仅当 apps/api 已有端点)
  - B2-T3 账号细节 + 会话逃生门(07-01 P2 / 02 §4 P2 / 07-00 P2):已交付并验证。登出后用户名预填;兑换/登录错误码文案表;`SessionListPanel` 读取失败 `WORKBENCH_SESSION_RESTART_REQUIRED` 特判 + 「立即重启」(`useRelaunchApp`,无 system 域时隐藏);`settings-section` 通用深链意图 + Composer「前往设置添加连接」直达连接分区;会话重命名 maxLength 对齐契约 120;`SessionListPanel` 行高/内距接 `--density-nav-y`
  - B2-T4 密度消费 + 列表虚拟化(07-03 P2 / 04 §6 / 05 §6):已交付并验证。features 声明 `@tanstack/react-virtual`;提示词库「全部」分节与历史列表 >150 行虚拟化(置顶常驻、线程缩进保留、滚动哨兵分页兼容、`data-density` 变化 `measure()`);U05 表列出的密度 token 消费接入点(SettingsScreen/AppearanceCard/GenerationDefaultsCard/ui card/PromptListRow/HistoryRow),紧凑态数值断言 E2E
  - B2-T5 使用统计(07-05 P2):已交付并验证。契约 `usageSummarySchema` + `usage.summary({ range })`(桌面聚合 `generation_runs`、云端聚合 PG generation jobs,同形状);设置新分区 `usage`(应用组):四指标(生成次数/成功率/成图数/消耗积分)+ 范围切换(7/30/90 天)+ 刷新 + 四态;数字 `tabular-nums`,空数据「—」;图表 P3 不做
  - B2-T6 壳收尾:已交付并验证。Win/Linux 自绘窗口控件(`WindowControls`,经 `window.musefoldV25` 既有 minimize/maximizeToggle/close/isMaximized/onMaximizeChanged,非 mac 显示;`IS_MAC=false` 单测);drag-region 收尾(内容区顶部 12px 拖拽带 + 设置页拖拽条,交互元素 no-drag,桌面宿主 CSS 作用域);`TooltipProvider` 300ms 壳级唯一(移除屏内重复 Provider);Web 关于卡构建标识(`PlatformProvider` 可选 `buildInfo`)
- [x] 批次 B3(2026-09-06,并行 3 卡,Grok):Cloud MCP 已连接应用 / 使用统计图表 / Win 控件带避让
  - boundary: 同 B2;枢纽文件只增量;不动桌宠、豆包内部、微调链、Skill runtime、通用分享/导入、命令面板、热更新(spec §3.3)
  - verify: 已验证(2026-09-06,darwin,未 commit)。三卡全部交付并验证。`pnpm run check` turbo 35/35(根 vitest 202 文件 / 1566 例,features 39 文件 / 507 例);Web E2E(web-desktop+web-mobile) 142 passed / 4 skipped / 0 failed,未重生快照(`web.cloud-mcp.spec.ts` 6/6、`web.usage.spec.ts` 已过);Electron E2E 69 passed / 1 skipped / 0 failed,`electron.settings-open.spec.ts` 9/9、`electron.settings-usage.spec.ts` 图表存在性已过、`electron.shell.spec.ts` 控件避让 darwin band count=0、desktop-settings 基线未重生(视口差 < 2%)。额外修复:macOS 原生全屏 E2E 在 Cursor 占前台时 `setFullScreen` 空操作,改为优先原生、失败则发与 `enter-full-screen` 相同的 `window:fullscreenChanged`,afterEach 已是目标态则直接返回。Windows 真机目测仍未验。
  - B3-T1 Cloud MCP 已连接应用卡(07-04 P2):已交付并验证。契约 `cloudMcp.listAuthorizations` / `revokeAuthorization`;`apps/api` `GET/DELETE /api/v1/mcp/authorizations`;双端网关;设置卡(未登录/自定义服务器门控 + 撤销 AlertDialog);撤销=删 consent + token.revoked,MCP handler 再查 consent → 401
  - B3-T2 使用统计图表(07-05 P3):已交付并验证。`usage.summary` 补 `byDay`/`byModel`;`UsageCharts` 趋势/渠道/模型/成功率图(`--chart-*` token,无新图表依赖);`skipMotion()` 降级;sr-only 表;空态文案;不做图表视觉快照
  - B3-T3 Win/Linux 控件带避让:已交付并验证(布局)。主区右上 32×138 安全区(`data-window-controls-safe` + 宿主 CSS 仅当有控件带);darwin E2E band count=0 跳过几何;Windows 真机目测仍登记未验
- [x] 批次 B4(2026-09-06,并行 5 卡,Grok):promptId 下推 / 归档游标 / Key 失效引导 / 豆包入口证据 / 桌面方案包 E2E
  - boundary: 同 B3;每卡只改自己的屏/域;枢纽文件只增量;不动桌宠、豆包内部 renderer/登录管理、微调链、Skill runtime、通用分享/导入、命令面板、热更新(spec §3.3);不实现云端 design-scheme run/市场/对象存储
  - verify: 已验证(2026-09-06,darwin,未 commit)。五卡全部交付。`pnpm run check` turbo 35/35(根 vitest 203 文件 / 1572 例,features 40 文件 / 513 例);Web E2E(web-desktop+web-mobile) 首次 143 passed / 4 skipped / 1 failed(mobile 豆包 footer 超时,账号入口在抽屉),修 `sidebar-drawer-open` 后 `web.doubao-entry.spec.ts` mobile 1/1,合计视为 144 passed / 4 skipped;Electron 首次 72 passed / 1 skipped / 1 failed(导出后困在方案详情,找不到 `scheme-create`),补 `runtime-scheme-detail-back` + describe 级 serial 后 `electron.design-schemes.spec.ts` 3/3,合计视为 75 passed / 1 skipped。xiaomiao 冒烟:HTTP 登录/额度/提示词 CRUD 通;云端 design-scheme market/export 诚实 501;`POST /generations` 入队且 worker 跑完,终态 `failed`/`GENERATION_UPSTREAM_UNKNOWN`(链路通,上游未出图,不冒充成功);Electron UI(`MUSEFOLD_API_URL=http://127.0.0.1:8787`)登录显示 xiaomiao / 1931.7 积分、新建提示词、方案中心「导入分享包」可见、登出回表单。途中修:`generation.list` `limit ?? 20` 防 SQLite `LIMIT NaN`;`account.test` `testProvider` 联合类型;`e2e-dialogs` SaveDialog `{ canceled:true, filePath:'' }`;worker crontab 点号非法改为 `generation/reconcile`/`maintenance/cleanup`(任务名 `generation.generate` 不变);本地 PG 补迁 `prompts.cover_image_url`。
  - B4-T1 promptId 服务端过滤(D22 / U02 相关作品):已交付。`generationHistoryQuerySchema` 可选 `promptId`;API `history` 与桌面 `generation.list` 按 `r.prompt_id` 过滤,limit 缺省 20;`usePromptRelatedWorks` 下推 `{ promptId, status:'succeeded', limit:100 }`,客户端只滤 `assets.length > 0`
  - B4-T2 归档会话游标分页(U05-archive-pagination):已交付。`useArchivedSessions` 改 `useInfiniteQuery`;`ArchivedSessionsPanel` flatten pages +「加载更多」/`archived-load-more` + `useAutoLoadMore`;跨页恢复/删除仍走既有 hooks;软删语义未改(D17)
  - B4-T3 Key 失效可解释引导(S01 产品面,非全卡):已交付。连接测试失败中文 + `*-test-result-key-invalid-hint`;工作台/时间线/历史 `check_key`/`setup_provider` → 连接分区,`sign_in` → 账号分区;`runRowToJob` 把 AUTH/`ACCOUNT/AUTH`/AUTH_FAILED/UNAUTHORIZED/NO_KEY 映射 `AUTH_CREDENTIALS_INVALID`(NO_KEY 不是 job.error.code);不做 safeStorage/asar 扫描
  - B4-T4 豆包入口冻结边界证据:已交付。`electron.doubao-entry.spec.ts`(设置 `settings-doubao-card` + 账号菜单「去登录」深链连接区);`web.doubao-entry.spec.ts`(无 connections/豆包卡/更多菜单,移动先开抽屉);未改 `electron/doubao-web`、桌宠、豆包登录内部
  - B4-T5 桌面 `.musefold.design` 导入导出 E2E(P01-9):已交付。`MUSEFOLD_E2E=1` 对话框旁路(`e2e-dialogs.ts`);`electron.design-schemes.spec.ts` 覆盖导航/导入入口/正式方案导出往返(封面真实 1×1 PNG)/取消不落文件/toast 无绝对路径;不做云端 run
- [x] 保留豆包入口并验证冻结边界
  - boundary: 只改共享壳/账号连接入口和对应测试；不迁移豆包网页 renderer、登录内部或桌宠
  - verify: 已验证(2026-09-06,B4-T4)。桌面账号菜单「豆包」→ 设置连接区 `settings-doubao-card`;Web 不伪造豆包轨;冻结面文件无业务改动
- [x] 批次 B5(2026-09-07,并行 5 卡,Grok):云端生图本地落盘 / 提示词双列 / Taxonomy Sheet / 工作台会话标题 / 移动键盘 inset
  - boundary: 同 B4;每卡只改自己的屏/域;枢纽文件只增量;不动桌宠、豆包内部、微调链、Skill runtime、通用分享/导入、命令面板、热更新、云端 design-scheme run/市场(仍 501);不改 `V25-UI-SPEC.md` / `V25-MIGRATION-CARDS.md` / `.spec`(主代理批次末回写)
  - verify: 已验证(2026-09-07,darwin,未 commit)。五卡全部交付。`pnpm run check` turbo 35/35(根 vitest 204 文件 / 1578 例,features 42 文件 / 534 例);Web E2E(web-desktop+web-mobile)首次 142 passed / 4 skipped / 2 failed(自定义日期「今天」在 UTC+8 午夜后漏跨日种子),夹本地日首后合计视为 144 passed / 4 skipped;Electron 首次 73 passed / 1 skipped / 1 failed(工作台浅色基线 3%:时间线头顶标题 + 失败文案归一),先删 `desktop-workbench-light.png` 再跑后 `electron.workbench.spec.ts` 11/11,合计视为 74 passed / 1 skipped。xiaomiao 云端生图:`POST /api/v1/generations` job `87de0f9c-a3c9-4562-b262-5a16c3f94665` 约 26s 终态 `succeeded`、1 张资产;账号 `canGenerate=true`,quota `95658034`。不实现完整 disposable worker 矩阵(U03-worker-runtime 仍 todo)
  - B5-T1 云端生图本地落盘可解释(U03-worker-runtime 本地证据):已交付。`mapGenerationError` 拆 LeaseLost / 对象存储失败;PutObject 包 `ObjectStorageError`;worker 启动 `HeadBucket` 缺则 `CreateBucket`;xiaomiao 再跑出图成功
  - B5-T2 提示词库双列自适应(U02 / ui-parity 04):已交付。≥760px 且详情关闭时「全部」2 列(`grid-cols-2 gap-x-7` / `gap-y-1`);虚拟化按行成对;`prompt-grid[data-columns]`;置顶始终单列
  - B5-T3 Taxonomy 移动端 Sheet(U02):已交付。`<md` Sheet / `md+` Popover,共用 `taxonomy-panel`
  - B5-T4 工作台会话标题与任务摘要(ui-parity 01 P1):已交付。md+ `workbench-session-title`(16 字截断)+ `workbench-task-summary`;空态不渲染;移动端不重复
  - B5-T5 Composer 移动软键盘 inset(U03):已交付。`<md` `visualViewport` 抬 `composer-dock` / 空态 `composer-empty-inset`;md+ / jsdom 恒 0
- [x] 批次 B6(2026-09-07,U03-spend 产品面):额度引导可点 / 兑换后重试 / 终态刷额度 / 只读审批卡 / 全流程验证
  - boundary: 只做产品恢复面,不发明 approve/reject API,不伪造云端审批后端,不改 worker 计费;桌面不出现 pending_approval;云端 design-scheme run/市场仍 501;不动桌宠、豆包内部、Skill runtime、通用分享/导入、命令面板、热更新
  - verify: 已验证(2026-09-07,darwin,未 commit)。五卡全部交付。`pnpm run check` turbo 35/35(根 vitest 205 文件 / 1579 例,features 43 文件 / 544 例);Web E2E(web-desktop+web-mobile) 144 passed / 4 skipped;Electron 74 passed / 1 skipped(真实 key)。xiaomiao:登录 200,quota `95039800`→生图后 `94979800`;提示词 CRUD;`POST /generations` job `c5ccf47c-f9d5-436a-916d-0fcba0aef43d` 约 26s 终态 `succeeded`、1 张资产;云端 market `501`。不实现完整预算/审批后端矩阵(U03-spend 仍 partial)
  - B6-T1 额度引导可点:已交付。`isSettingsGuidance` 含 `top_up`;「去兑换」深链 `settings-section`/`account`
  - B6-T2 兑换后重试:已交付。`spend-recovery-store` 记 `retry-job`/`replay-create`;`useRedeem` 成功后 retry(新幂等键)或 replay create;Web `canGenerate===false` 预检不打网关
  - B6-T3 终态刷新额度:已交付。`useInvalidateGeneration` 失效 `account.status`;时间线活动→终态亦刷
  - B6-T4 审批提示卡:已交付。`job-approval-card` / `job-approval-rejected` 只读;会话活动点含 `pending_approval`;无 approve 网关
  - B6-T5 统一验证 + xiaomiao 全流程:已交付,见上 verify
- [x] 批次 B7(2026-09-07,并行 5 卡):worker disposable runtime 第一刀 / 软删 30 天 purge 第一刀 / 桌面方案改名删除 / Web 活体登录 / CI Testcontainers
  - boundary: 每卡只改自己的域;枢纽文件只增量;不动桌宠、豆包内部、微调链、Skill runtime、通用分享/导入、命令面板、热更新;不实现云端 design-scheme run/市场/create-Agent/对象存储(仍 501);不发明 approve/reject API。密码只走 env,不落仓库
  - verify: 已验证(2026-09-07,darwin,未 commit)。五卡全部交付。`pnpm run check` turbo 35/35(根 vitest 206 文件 / 1582 例,features 43 文件 / 545 例);Web mock E2E 144 passed / 6 skipped(含 live spec 双视口默认 skip);`web.live-account.spec.ts` 双视口 2/2(`MUSEFOLD_LIVE_E2E=1`);Electron 75 passed / 1 skipped(真实 key),`electron.design-schemes.spec.ts` 4/4。xiaomiao HTTP:提示词 CRUD、方案 document create/rename/remove、market/Agent create `501`;生图 job `cd07409f-e028-48ef-8334-ef419f06c36c` 终态 `succeeded`、1 张资产。worker `test:integration` 4/4(默认单测 skip)。完整 disposable 矩阵与 90 天 sync 裁剪仍不宣称完成
  - B7-T1 U03-worker-runtime 第一刀:已交付。disposable PG + graphile-worker `runOnce` + fake generate/S3;入队→succeeded、过期租约已发上游 → `GENERATION_UPSTREAM_UNKNOWN`、运行中取消 → cancelled、30 天软删 purge
  - B7-T2 D02-b 第一刀:已交付。共享 `SOFT_DELETE_RETENTION_DAYS=30`;maintenance 硬删过期软删终态 generation_runs 并入对象清理队列;不删 outbox/conflict/tombstone;未做提示词/90 天 sync
  - B7-T3 桌面方案确定性动作 E2E:已交付。导入草稿后重命名「B7 重命名草稿」+ 删除确认;4/4
  - B7-T4 Web xiaomiao 活体登录:已交付。env-gated `web.live-account.spec.ts`;编辑器同次打开只快照一次(修 Strict Mode 清表单);dev CSRF 默认信任 `:3399`
  - B7-T5 CI/CD 增量:已交付。PR/Main `database-integration` job;统一门禁数字见上 verify
- [x] 批次 B8(2026-09-07,并行 5 卡):worker runtime 第二刀 / D02 提示词+sync 裁剪 / 时间线键盘留白 / PG replay+bundle CI / Electron 活体登录
  - boundary: 每卡只改自己的域;枢纽文件只增量;不动桌宠、豆包内部、微调链、Skill runtime、通用分享/导入、命令面板、热更新;不实现云端 design-scheme run/市场/create-Agent/对象存储(仍 501);不发明 approve/reject API。密码只走 env,不落仓库
  - verify: 已验证(2026-09-07,darwin,未 commit)。五卡全部交付。`pnpm run check` turbo 35/35(根 vitest 207 文件 / 1586 例,features 44 文件 / 548 例);Web mock E2E 144 passed / 6 skipped;`web.live-account.spec.ts` 双视口 2/2;`electron.live-account.spec.ts` 1/1(密码只走 `MUSEFOLD_E2E_PASSWORD`);Electron 全量 75 passed / 2 skipped(活体 + 真实 key 默认 skip)。worker `test:integration` 9/9(runtime 7 + retention 2,默认单测 skip);API migrate-replay `RUN_DATABASE_TESTS` 1/1;`tests/repo/desktop-db-bundle-freshness` 1/1;`db:bundle` + `git diff --exit-code` 干净。完整 worker 矩阵、D02-c/d、Q03 其余子卡仍不宣称完成
  - B8-T1 U03-worker-runtime 第二刀:已交付。过期租约未发上游续跑 succeeded;飞行中丢租约的 late success 不覆盖 `GENERATION_UPSTREAM_UNKNOWN`;第二张上传失败不得 succeeded,已上传键入 cleanup
  - B8-T2 D02-b 第二刀:已交付。提示词软删满 30 天硬删(folder/tag/device 保留);sync changelog/mutation 90 天裁剪并抬 `minAvailableCursor`;cleanup 顺序 rate-limit → generation purge → prompts → sync → object cleanup
  - B8-T3 时间线软键盘留白:已交付。`GenerationTimeline` 底部 padding = 172/220 + inset;`data-keyboard-inset`;md+ 几何不变
  - B8-T4 Q03 增量:已交付。空库 `migrateDatabase` 再 replay 幂等;`desktop-db` bundle 纯读门禁;CI `db:bundle` + `git diff --exit-code`
  - B8-T5 Electron xiaomiao 活体登录:已交付。env-gated `electron.live-account.spec.ts`;设置登录 → 提示词 CRUD;无 env 1 skipped
- [x] 批次 B9 部分切片(2026-09-07):费用协调 / 云上传资产 / Worker 真进程恢复 / 生产验证基础
  - boundary: 复用既有费用、generation、scheme、cleanup 和发布接缝；保留 B1–B8 dirty 工作、桌宠与豆包冻结边界；不接入云端方案 Agent/run/市场，不开放 Cloud MCP 花费，不引入管理员后台。本项只关闭已交付切片，G-SPEND/G-CLOUD/G-WORKER/G-DATA/G-RELEASE 大任务与整包继续开放。
  - verify: 最终 `pnpm run check` Turbo 35/35，根 212 文件/1656 tests，features 44/548；API integration 4/54，Worker integration 4/22；`pnpm run test:e2e` 219 passed / 8 skipped / 0 failed / 0 flaky（Web desktop 73/2 skip、mobile 71/4 skip、Electron 75/2 skip）。最终 `package:mac:adhoc` 与严格 package-smoke 1/1、0 skip 通过，含当前 bundle 与 asar 逐文件 SHA-256 匹配；打包后 1037 项冻结源码清单无变化。实际命令、失败重跑、报告和产物摘要见 [B9 开发记录](../../../docs/v2.5/V25-DEVELOPMENT-LOG.md)，本项不代替 Windows、正式签名/公证、安全扫描、生产部署或远程 MCP 验收。
  - B9-T1 费用切片：三类本地 Agent 入口共用同进程预算协调、预留/确认/拒绝/过期/取消及 unknown 审计；跨进程幂等、预留持久化、月份/账号归属与费用对账仍待完成。
  - B9-T2 云资产与桌面消费：图片安全暂存、owner/用途隔离、事务晋升、失败/过期清理及 PG 0006→0007 旧行保留；canonical `uploaded` 来源贯穿独立方案 SQLite v6→v7、专用包 export→import、v25 详情与媒体读取，定向 7 文件/130 tests。云 Agent/run/市场/包全链未完成。
  - B9-T3 Worker/GC：11 项真实子进程 kill/新 PID 重启、Graphile reconcile、发送前恢复、发送后 unknown 禁止重发、取消与 epoch/heartbeat 竞争；另 2 项保护已晋升方案资产（含 soft deleted，直至真实 purge）。PG/Graphile、生产 task 与 HTTP/S3 客户端为真，上游及 S3 服务为本地替身；生产 bin/容器、真实 S3、全资产 GC 与跨设备恢复仍欠。
  - B9-T4 生产验证基础：默认 Web E2E 使用本次 Next standalone，持久报告和 CI 隐藏产物/JSON 门禁、严格平台/架构/缺包验证、Web Docker 与同源 OAuth discovery 接缝已交付。Web 容器上游为 echo API，CI runner/Windows/部署回滚未执行。
  - B9 skip 说明：3 项 live account 未注入凭据，1 项真实 Key 未注入，3 项按目标视口排除，1 项移动端会话删除入口暂缓（G-UI-01）；未以 skip 代替相应能力验收。


- [x] 批次 B10 部分切片(2026-09-07):云端方案运行 / 持久费用账本 / 发布内容扫描
  - boundary: G-CLOUD-03 固定四步方案运行、PG 0008 与双账本、可信引用和 worker epoch；G-SPEND-02 本地 G/R/S 持久授权、发送 claim 与重启恢复；G-RELEASE-03 source/归档/运行出口扫描与 CI，修复实际包内泄漏。保持 Cloud MCP 七工具只读、桌宠/豆包冻结与管理员不纳入；不改版本号、不部署生产。
  - verify: 最终 check 35/35（0 cached），根 227 文件/1882 tests、features 46/555；API integration 6/67、worker 5/47、PG 0007→0008 旧行保留并 CLI replay；完整 E2E 224 passed/8 skipped/0 failed/flaky；全新 macOS arm64 ad-hoc 包与严格冒烟 1/1、0 skip（含 8 条内联迁移、新费用表、当前 bundle 字节和重启）。source 1073 文件、App/DMG/ZIP 6 targets 均0 findings/errors；1169 项冻结源码/配置/资源打包后未变。完整命令、失败修复、报告/身份和限制见 B10 开发记录，未据此关闭 G-CLOUD/G-SPEND/G-RELEASE 等父卡或整包。
  - B10 已发现并修复：打包依赖收集带入 workspace 测试和 Turbo 日志；ZIP stored entry 读取可能无报告退出；包身份须匹配当前 App；durable fetch 禁自动重定向，防止绕过每次发送的持久 claim。云固定运行与 G/R/S 已列接线切片通过本批验证；可信 payer/账单/全部恢复、云 Agent/市场/专用包、Windows/生产与其余矩阵继续开放。

- [x] 批次 B11(2026-09-07):云端 GitHub 市场发现与分页产品接线
  - boundary: G-CLOUD-04 的公开 GitHub 搜索、分页/缓存/限流与结构校验；共享发现屏下一页与缓存反馈、API-client 和双视口回归。只发现，不下载/安装/执行，云 Agent/专用包继续由后续卡实现，Cloud MCP 保持只读；无版本/生产发布动作。
  - verify: API 就地与真实 HTTP/路由测试、client契约、features并发/分页/错误测试、双视口市场 E2E、统一 check；涉及共享UI另跑完整 E2E。公开 GitHub 只读探测与稳定mock测试分开，保存实际报告，不继承 B10 数字。

## 阶段四：双宿主集成与回归
- [x] 打通 Web 桌面/移动宿主路由、gateway 注入和响应式交互
  - boundary: `apps/web-next/src/app`、`components/app-shell.tsx`、宿主适配及 Web E2E；业务 UI 继续留在 features
  - verify: Web desktop/mobile E2E 覆盖导航、工作台、提示词、设置、账号和同步；移动抽屉/底栏焦点和 deep-link 可用；session URL、设置和成图视觉用例已在定向重跑中通过
- [ ] 打通 Electron 宿主关键用户路径和窗口行为
  - 09-20当前依据：本轮真实macOS Electron的会话离线退出/新PID补偿专项通过，当前ad-hoc包7项、三授权旧备份升级3项与原件不变已验；完整Electron纳入本次三形态重跑，未以早期75项或历史包结果替代。Windows原生几何/安装验收已由用户延期，独立记录未验，不阻止其他平台继续。
  - boundary: `tests/v25/electron.*.spec.ts`、electron helpers 和必要宿主修复；不改 pet E2E 语义
  - verify: `pnpm run build` 后 Electron v25 E2E 覆盖 shell/workbench/prompts/settings/sync。2026-09-07 B9 最终 Electron project 75 passed / 2 skipped(真实 key + 活体登录未注入)；B8 `electron.live-account.spec.ts` 有 env 时 1/1、`electron.design-schemes.spec.ts` 4/4 保留历史。历史数字 33/1 fail/1 skip 为全屏焦点前置失败，不当作当前失败；现有 fullscreen 事件 fallback 不代替原生切换与 Windows 真机几何证据
- [ ] 运行统一门禁并修复本包发现的可执行问题
  - 09-21 16:02：新增helper遗漏复合TS工程include导致check1实际失败；补三条include后typecheck退出0，当前1898项6fb42ed5…完整check2实际38/38（根3321P/77条件S）。标准容器host override下PC/移动Provider8P、独立New API镜像满额登录2P，均0F/0S/0flaky；原失败保留。定向链正常结束后先接续真实收费流程，完整582项/新包尚未启动；API原进程继续。详情见真实验收16:02节。
  - 09-21 15:50：原自然小时2P退出0（自然案例3605.440秒、保留12对象）。E2E移动Provider用例在隔离Agent服务ready前120秒超时，另实际确认健康PG的localhost映射拒绝连接而VM网关同端口可SQL。六个隔离子进程补标准host override白名单，正式6P/6F→12P；仅测试/Turbo8文件变化，当前1898项0b543412…，产品及API输入未改。原E2E330P/1F/1中断/8S/242未执行、130完整保留；新check/8项Provider/2项镜像浏览器/全量/包链已启动，旧API原进程继续，不复用旧整轮claim。详情见09-21真实验收15:50节。
  - 09-21 15:37：最新三镜像构建/Worker镜像2P/隔离部署回切18P全部退出0。原完整API终态1197P/2F/24S、退出1；24S含初始化120秒超时造成的22未执行，另2计划条件。原源码两个失败文件单独37P，隔离只增时刻诊断的生命周期六库重复90P，原因尚未确认，不冒称修复；新完整API单worker及只读环境时差采样启动，原E2E/自然小时继续。无产品改动/放宽断言；详见09-21真实验收15:37节。
  - 09-21 15:20：最新2cdf8e15…完整check38/38退出0、PC/移动确定性浏览器4P/0F/0S/0flaky（31.7秒）正式通过，四张相关截图已核对。完整582项继续原PID，API/自然小时未重启；当前源码三镜像构建与部署回切独立验证已启动，不重建E2E正在使用的宿主产物。当前包/三备份仍按全量通过后执行，父项不勾选。
  - 09-21 15:10：原notices E2E因已确认产品缺陷有序SIGINT结束（不是观察超时重启），361P/3F/1中断/9条件跳过/208未执行，pnpm报告130，完整JSON保留；自动包链未执行。3F为OAuth移动端与同一模型成图等待在PC/移动两端：夹具需要两次3秒轮询，原5秒断言不成立，改为先按既有生成用例15秒有界核对succeeded，再验实际图与几何，不改产品期限/轮询/夹具。当前1897项2cdf8e15…仅共享OAuth及3个测试文件变化，完整check、确定性4项浏览器及后续全量/包链已启动；API/Worker/PG/上游Go输入未变，原完整API和自然小时继续各自原进程，原输入证据不改名冒称新整轮。
  - 09-21 14:55：当前1897项8326109b…完整check5已38/38退出0；三份新镜像构建、Worker镜像2P、隔离部署回切18P。按精确文件/用例名，根77条件与Worker2条件全部独立补验，对应3386/351唯一用例；真实Go协议1P且Go退出0。宿主中断后保留仍存活的原E2E，不重跑；仅在原API进程消失且无终态报告后重启完整API。完整API/三形态/自然小时、新包/三旧备份及提交仍开放。下方证据守卫“待接入”是旧状态：当前`tests/repo/evidence-source-identity.ts`已正式包含提交祖先、工作区及暂存源码差异检查，并随本轮根测试通过。
  - 09-21最新：三修复输入1870项56671e47…完整check38/38已退出0，真实MinIO桶初始化补验通过，均早于OAuth。原完整E2E包容量启动超时未复现，追加固定阶段诊断和就地2P后同一原用例三次3P，保持120秒原时限，不把它改写为原完整轮全绿。OAuth增量1884项88104ad1…正执行新check，随后仍需新镜像/完整回归/实网/最新包与旧备份，详见09-21真实验收。
  - 09-21后续resolved_current（待统一最终产物回归）：Worker缺桶开关/分类/拒绝启动正式修复，实际入口红1P/10F→专项40P，全Worker源码349P/2镜像条件S；API可信代理配置和逐跳IP核对已修复，实际HTTP红5P/23F→单测/HTTP/PG47P，HMAC桶及真实429验证通过。新镜像、OAuth增量后的完整门禁和产物仍待，不沿用旧包证明新代码。详见09-21真实验收。
  - 09-21云API反向核对：`clientIp()`无条件采信X-Forwarded-For首项，当前createApp隔离诊断证明可由未信任头选择不同MCP限流key；需按显式可信代理和实际连接地址修复、补真实HTTP与配置负例。诊断未访问生产或付费上游，未将替身key观察冒称真实PG限流全验收。
  - 09-21继续反向核对确认Worker启动保护遗漏：旧版仅404缺桶时按`S3_AUTO_CREATE_BUCKET`显式开关创建，失败拒绝消费；新版任意HEAD失败尝试创建且失败仍进入队列。需恢复配置/分类及失败启动保护，新增就地与正式进程负例，不扩大成基础设施重构。当前限流/偏好/证据守卫版本check已38/38通过，但最终全量、该启动修复和产物仍待；见09-21真实验收记录。
  - 09-21证据登记复核：发现旧repo守卫仍断言manifest不能含任何pass，并要求证据提交精确等于HEAD且整个工作树clean，使后续仅登记报告的提交也无法保留有效证据。已在忽略的隔离候选中验证9项Git用例：完整提交、文档后继、脏/暂存/新增源码、已提交源码变化、非祖先及缺失提交；待当前冻结E2E/打包流水线终态后接入。保留完整SHA、真实祖先与全部执行输入一致、具体测试/报告/敏感信息约束；不得以删除校验换取登记。此项未正式接入，不计当前统一门禁通过。
  - 09-20当前依据：1850项bb580e98…下第6次完整check38/38通过；修正迁移故障注入、旧HTTP夹具和账号视觉基线，专项分别43/9/8项通过，失败证据保留。当前完整API、自然一小时方案包与第3次完整E2E仍运行，不将专项或条件跳过计作全量终态；生产代码相对已验新包/镜像无变化。
  - boundary: 只修复本包任务覆盖的真实失败，必要时同步 v2.5 evidence/docs；不删测试、不引入未请求抽象
  - verify: `pnpm run check`、`pnpm run test:e2e`、桌面 Electron E2E 和 `check_spec_package.py` 结果真实记录。2026-09-03 `pnpm run check` 为 182 个测试文件、1357 个测试、35 个 Turbo task 全绿（features 23 文件/297 测试；此前基线 1301）；本轮受影响 Design Scheme 套件 8 个文件、151 个测试通过，根目录 `pnpm run typecheck` 通过；早期完整 Electron project 为 33 passed、1 failed、1 skipped，唯一失败是 macOS 原生 fullscreen 前 runner 无法让 Electron shell 获得前台焦点，跳过项为真实 key 场景；Workbench Electron 9/9 通过并覆盖 Design Scheme 取消路径。早期完整 v25 E2E 为 98 passed、1 failed、5 skipped，同一 fullscreen shell focus 前置失败；此前一次完整复跑的 99 passed、5 skipped 与 34 passed、1 skipped 没有 durable report/artifact，只能作为历史记录；本段旧数字只作追溯，最新 B9 结果以本页 B9 条目及开发记录为准。Spec 校验仍应因未完成 parity/证据门禁失败
- [ ] 完成 parity 复核、验收清单和迁移知识沉淀
  - boundary: 只更新本包 `checklist.md`、相关 v2.5 证据文档和 `.spec/docs`，不改业务逻辑
  - verify: checklist 全部勾选且 `**验收结果**：通过`，每个任务有 boundary/verify 证据，变更边界和非目标可追溯。当前已回写实际验证与阻塞，但不能在 Design Scheme/全量 parity 未闭合前标记通过

---

**当前进度**：由脚本计算，无需手动维护



  - B11 最终证据：API 专项2文件73pass，API真实PG/鉴权集成7文件72pass；features专项37pass、client专项26pass；公开GitHub2GET均200且缓存HTTP0；完整E2E230pass/8skip/0failed/0flaky；check35/35（24cached），根228文件1899tests、features47/566；source1079文件0findings/errors/exceptions。源码/配置/资源1175项前后hash不变，完整报告见V25-MARKET-VALIDATION与B11开发记录。首次验证脚本/报告格式失败已保留并修正；本项只关闭公开发现切片，不关闭Agent/安装/包/费用/发布或整包验收。


- [x] 批次 B12 本机实现切片(2026-09-07–08):可信账号/凭据身份与 legacy 恢复，云端来源冻结读取器
  - boundary: 主线 SP-P1；稳定 issuer/owner 主体、凭据来源/语义版本与事务 CAS、legacy 自动验证与受限恢复、会话补偿/刷新竞争、非秘密 binding 查询及共享恢复入口。并行实现 G-CLOUD-02 的非付费 GitHub 固定 commit/受限归档读取器，PG/S3来源会话后续接续；reader 不代表 Agent 创建完成。不凭当前 mutable 映射回填旧 key、不向任意新 issuer 发旧secret、不把恢复会话当普通授权，不开放 Cloud MCP 花费或真实付费调用。
  - verify: contracts/adapter/宿主兼容；真实 New API HTTP fixture 按 owner 隔离；真实 PG 旧行迁移/replay/并发/供给失败/refresh/logout/恢复权限矩阵；GitHub metadata→SHA→同SHA字节及归档拒绝矩阵；必要完整 check/E2E、源码与秘密扫描。所有结果按本批实际记录，P2/P3执行回执及worker发送、桌面P4/P5仍另有待办。
  - 09-08 01:46 实现检查点：check35/35（30cached；先前同实现0cached也通过），根2013/features594；API真实PG123pass、worker47pass、CLI migrate两次到0009；全量E2E239pass/8skip/0failed/0flaky，原始233/8/4与237/8/2失败保留。source1114文件零命中，源码1210项摘要6bc9e7fc6925d13b10b26ce1a9f8a225d7fd046c80c4c4eb92abf92cbb61c442前后无漂移，报告tests/v25/.results/b12/validation-summary.json。原始L-T8的COMMIT/cookie/实际断连、两真实API PID刷新与可信备份恢复未完，B12不勾选；接续开发另验，不继承此清单结果。
  - 09-08 接续与最后增量：可信备份0010/实际CLI迁移replay、COMMIT/cookie/断连/双PID、到期清理、移动删除已合流；随后live/backup实际refresh保存前SIGKILL、新PID、自然30/120秒lease和明确恢复也通过。最终API12文件164pass/0failed/skipped/unhandled；check35/35、31cached，根2013/features598；source1127文件零命中。最终源码1223项摘要d7bd41e626af7317a6f014017549f1bc3ee90a33478be9bd2fbf951487adc7b7，API/check后无漂移，报告tests/v25/.results/b12-p1-final/validation-summary.json。
  - 证据边界：242pass/7skip/0failed/flaky的完整E2E和worker55pass来自前序c19604清单；最后差异仅3个API测试/fixture，生产/schema/宿主/E2E未变，未伪造新的E2E执行。原163/1挂起经诊断为fixture共享PG却BA secret不同造成JWKS解密500，统一配置并保留JWKS、加入有界barrier/清理后通过；所有失败及报告格式修复保留。本项仅关闭本机实现与合成验收切片；真实历史来源运维、P2/P3执行回执/worker发送、后续托管/云Agent/资产/发布、整包和管理员前置继续开放。

- [x] 批次 B13(2026-09-08):SP-P2/P3 云端持久执行回执与发送前付款身份校验
  - boundary: 复用 B12 可信主体。普通 create、显式 retry、方案 run 三入口将稳定 binding、真实 BA session 授权版本、逻辑输入与最终请求摘要和独立 receipt 同事务入队；先查 receipt 再解析可变输入。历史/资产/方案/会话删除不删除幂等证据；旧行不凭当前 key 回填授权。worker 取完参考图后在最后 claim 事务重查固定身份、版本和 epoch，再使用该事务返回的凭据快照。claimed 崩溃保持未知，不自动重发；明确未发送与未知费用分开。包含 PG 0011、api-client 只读查询与 retry 可选期待、API/worker 配置一致性；桌面托管接入、文本费用、Cloud Agent 和管理员不在本批。
  - verify: 契约与客户端无副作用恢复测试；真实 PG 迁移/replay、三入口同键/冲突/清理后查询；真实 HTTP 的换 key、撤销 session、issuer 不同、旧队列无授权零发送、延迟参考素材后的 claim；worker 竞争/取消/实际进程故障恢复与 receipt 状态一致性；完整 API/worker 回归、pnpm run check，涉及宿主变化时补相应 E2E。统一验证前绑定本批源码清单，未执行/跳过/失败独立记录，不继承 B12 结果。
  - 发布约束: 新 API 与 worker 联合启用前排空或隔离旧 worker；0011 不让旧 worker 自动理解授权，单独落表不算费用安全闭合。原有已硬删且未留 key 的历史无法被该迁移凭空重建。

  - 本机实现与合成验收：11:04 API 13文件188pass，worker正式bin增量后8文件83pass；最终0011 CLI两次exit0及真实旧行迁移5pass；11:11 check35/35、0cached。源码1243项摘要bec320e638a2b1dd413b22c40375fe35d8db7fbf29cf2bf576d24a6ff7285eeb，在API/check前后无漂移；source1147文件0findings/errors/accepted。报告tests/v25/.results/b13/validation-summary.json；原fixture/类型/格式失败及正式bin真实重复stop故障保留，已修复后复验。本批无新UI/E2E/安装包/容器部署，不关闭P4–6或整包。


- [x] 批次 B14(2026-09-08):SP-P4 同源资产下载支撑子片
  - boundary: P4-A..F 是整阶段，先实现 API GET /assets/:id/content 的所有者鉴权、受管 objectKey 有界读取与图片校验，保留既有302路由，解决默认容器内部S3地址无法供桌面下载的问题。仅 API generation/storage/image 与就地测试，不接新生图POST、不改变预算授权、不改DB/schema；桌面连接、稳定key/远端关联、旧备份预算防回退及执行port仍须后续联合接线。
  - verify: 真实PG+可控S3 HTTP：owner隔离、已purge/读取中purge、魔数/解码/长度/超限/超时/断流/abort、输出headers、零队列/费用副作用；API完整回归及全仓check、安全扫描，各次绑定B14源码清单，不覆盖B13。此子片通过只勾选下载准备，不关闭P4或G-SPEND-02。

  - 最终本机验收：完整API14文件211pass，HTTP边界37pass（content23+storage14），APIunit45pass，types0/Biome12files exit0且1warning；全仓check35/35、28cached、exit0。源码1247项摘要389ac3ff537775777eea4de7c72b3e4c75a292e94802d7f13fa235e58e5d2c72在API/check后无漂移，相对B13仅12个API文件；source1151文件零命中。报告tests/v25/.results/b14/validation-summary.json。真实断线通过临时Hono HTTP listener验证，非production bin/部署；未新跑E2E/DB独立迁移/worker集成/包。只关闭下载支撑，P4持久关联/防回退/桌面接线及整包继续开放。


- [x] 批次 B15(2026-09-08):SP-P4 防回退存储与事务协调基础
  - boundary: desktop-contracts防回退实体、desktop-db增量checkpoint迁移与内联bundle、core同步SQLite CAS和异步锚prepare/commit协调、受限文件密文读写。真实SQLite/文件/独立进程验证崩溃与恢复，旧库不自动启用或生成namespace。此基础将供后续远端关联/预算/宿主接线使用；未接入全部spend变更前不得宣称已有生产防回退保护。不触PG/worker/Cloud MCP/管理员。
  - verify: 旧0007库迁移保留业务、空库/replay与约束；锚prepare/DBcommit/锚commit三个故障点、CAS冲突/回滚/并发/锚缺失损坏/旧DB恢复与恢复受限；真实子进程SIGKILL/新PID验证只读恢复无自动POST，文件读写有字节上限且拒绝链接/非普通文件。全仓check、构建后Electron门禁及源码/秘密扫描；阶段证据不替代后续P4真实云提交与备份宿主联测。

  - 最终证据：6文件52passed，实际三SIGKILL/新PID与旧SQLite backup替换；check35/35、0cached、根2082passed/5gated skipped、features598；Electron81passed/2gated skipped/0failed/flaky。最后两新模块审查修正后check/定向复跑，21项桌面构建字节与E2E一致，未伪造新E2E执行。source1162文件零命中；源码1258项摘要be7e16cb31f1f54488efd403e1e96ae2d2ddc707e2c5ff48bc41da6cbd4a3edc，相对B14仅16文件。报告tests/v25/.results/b15/validation-summary.json。关闭基础切片，不关闭safeStorage/正式restoreBackup/托管预算/远端关联、P4整卡或迁移整包；无Windows/生产/实际付费验收。

- [x] 批次 B16：SP-P4-D2 主进程安全存储与正式恢复隔离
  - boundary: 主进程注入真实 safeStorage，不复用 E2E 明文 fallback；core DB 恢复访问栅栏与生命周期捕获；托管操作 abort/drain 接缝；正式 restoreBackup 先隔离/停同步、固定保留安全备份与锚 restore_pending，再关库替换。替换后本进程不能惰性重开新库，重启仍按锚与检查点核对。补共享备份卡的准确保留说明与隔离失败后的显式重启出口，普通坏备份仍可重试；保留既有 BYOK 和普通备份语义；尚未添加云执行连接/付费 POST/完整预算接线或管理员。
  - verify: 真实 SQLite/正式 restoreBackup、safeStorage 不可用和文件失败、旧回调及并发恢复拒绝、正常/失败恢复后新 PID 与密文锚受限、安全备份不被普通 prune 删除。补真实 Electron IPC 恢复及受限安全存储证据，完整 check/双端完整 E2E、source 扫描与清单。未接入业务的远端关联与预算仍明确待办，不用宿主基础冒充 P4 闭合。

  - 最终证据：恢复/OS/域专项42passed、共享设置53passed；check35/35、26cached、根2099passed/5gated skipped、features599；完整三形态E2E244passed/7skipped/0failed/flaky（PC81/2、移动80/3、Electron83/2）。source1167文件零命中，源码1263项摘要bd0343b02397c79f41cef13cb9f82ee65bc41f8b7d2ee0abd35dec580578ddb4在check/E2E后无漂移，相对B15共12文件。报告tests/v25/.results/b16/validation-summary.json；初期2个迁移fixture失败、CLI参数错误与runner日志迁移均保留。仅关闭B16宿主支撑，完整P4/其余迁移和管理员前置仍未完成。

- [x] 批次 B17：SP-P4-D3/E1 持久请求关联与预算回执核心
  - boundary: desktop-contracts 严格托管 G 请求、SQLite 增量内联迁移、core POST 前持久 key/binding/call 关联和预算/回执原子更新；已有请求只读恢复，不以 404 或重启重新发送。通用本地恢复不得终结托管调用，旧 BYOK 保持原语义。产品连接、宿主实际 HTTP 与完整 P4 联合验收继续按原卡推进，管理员依赖不提前关闭。
  - verify: 真实 SQLite 旧库迁移、并发/重复/乱序回执、身份和运行绑定拒绝、跨月 unknown、锚/事务失败及新进程原 key 恢复，回环 HTTP 观察发送计数；check、构建后 Electron、源码证据及失败修复记录。仅对实际完成并验证的边界作结论。

  - 最终核心验收：专项6文件82passed；check35/35、0cached、根2145passed/5gated skipped、features599；API完整集成14文件212passed；Electron83passed/2skipped/0failed/flaky。真实子进程四SIGKILL窗口及PG回包丢失/凭据轮换/purge后同key恢复，PG跨层场景1POST/2GET。source1178文件零命中，源码1274项摘要b8b9c7a2448a7cd243946502cb9aac8efe931f353ca47058f4b767c3d93742d7，各门禁后无漂移，相对B16为17文件。报告tests/v25/.results/b17/validation-summary.json；首次类型推导/fixture路径/生成JSON格式错误保留。本项关闭核心切片，完整P4-D3/E1和A/B/C/F产品接线、共用预算老入口与恢复核对仍待完成，不关闭父卡、整包或管理员前置。


- [x] 批次 B18：托管账号捕获与主进程受限执行适配
  - boundary: 接 B17 的主进程账号/数据库捕获、绑定准备、单次首发与原 key 查询；账号切换立即阻止旧发送/写入，超时/断连/旧401不能借新身份重试。修复启动补记路径不得接管托管调用。受限 HTTP 适配器只用捕获 issuer 和安全存储 bearer，不走 Provider API key，不隐含用户启用或修改既有 BYOK。
  - verify: 主进程就地测试覆盖真实回环 HTTP、固定body/key、单次发送、丢回包只查询、超时/上限/重定向、账号转换及旧401；SQLite/checkpoint与实际HTTP次数联测。完整check、构建后Electron与源码证据；尚未完成的产品连接/下载/共享预算/恢复入口明确保留。

  - 最终适配层验收：4文件36passed，归档计数fixture修复后4passed；check35/35、30cached、根2167passed/5gated skipped、features599；Electron83passed/2skipped/0failed/flaky。source1180文件零命中，1276项源码摘要ceeead243aeee426217ed4dad48a57d7f7e4351feaeade3f6a900e64a50d13a1，门禁后无漂移，相对B17共10文件。报告tests/v25/.results/b18/validation-summary.json；两次类型收窄失败和首次check归档超时保留，修正fixture不用压缩但保留真实条目上限断言。无UI/API生产/schema变化，无新PG集成/完整Web E2E/安装包/部署或付费调用。关闭适配层切片，正式连接/执行/取消/下载/全部预算保护/恢复核对与完整P4、迁移整包仍开放。

- [x] 批次 B19：共享预算写入与宿主异步结算
  - boundary: core 检查点事务统一授予受管预算写资格；保护预算策略/兼容用量及受托管预算影响的请求/调用，外部 BYOK 不冲销账号预算。主进程预算设置与兼容结算接锚协调和恢复排空，调用者等待落稳，旧库不自动启用。不开放用户托管发送或新增管理员入口。
  - verify: 真实 SQLite/锚下绕过拒绝、共享额度并发、unknown跨月、异常回滚与旧备份限制；设置/生成/方案/Skill结算等待和失败处理；全仓check、构建后Electron、源清单和分层证据。完整用户启用/生成链仍按P4后续联合验收。
  - 最终证据：check35/35（首次0cached，最终30cached），根2189passed/5gated skipped、features599；专项10文件177passed，最后新增thenable回滚由全仓check验证；真实PG回执25passed；最终Electron84passed/2skipped/0failed/flaky，含真实系统加密锚/预算IPC/新PID。源码1278项摘要3b9be5d51987b6d94ceaf3e8478935dd9a916ee8da44a558e1f6b666248fbe88，source1182文件零命中，相对B18共21路径。报告tests/v25/.results/b19/validation-summary.json；原类型、旧迁移fixture和路由参数失败保留。用户启用前旧在途核对及G完整产品链仍未闭合，只关闭本批写保护/结算切片。

- [x] 批次 B20：账号云执行启用的持久账本前置检查
  - boundary: core 在创建 namespace 前拒绝旧托管非终态、持久 held/unknown 和未结束托管 call；残留远端关联不得重新启用。异步锚落盘后在同一 SQLite commit 内再查；不自动核销、迁移身份或发送。不把数据库前置检查等同于宿主 legacy 内存预留排空、账号验证或可见产品闭环。
  - verify: 真实 SQLite/文件覆盖确认、在途、跨月 unknown、多 scope、终态掩盖旧 call、残留关联、已结束历史/BYOK，以及另一 SQLite 连接在 pending 落盘期间登记的竞争；全仓 check、构建后 Electron；回写实际报告与未验范围。
  - 最终证据：专项5文件66passed（新增10项）；check35/35、0cached、根2199passed/5gated skipped、features599；Electron84passed/2skipped/0failed/flaky；source1183文件零命中。源码1279项摘要90fea1684e1d72d7345190b3e29cc3bb10e895ced0aecb140ac8e969c840e4d4，相对B19共4路径，门禁后无漂移。报告tests/v25/.results/b20/validation-summary.json；只关闭数据库检查子项，宿主内存预留排空/用户启用和完整P4仍未完成。


- [x] 批次 B21：桌面账号云图像首条产品链
  - boundary: 显式云连接与主进程一次性review、legacy内存预算准入屏障，复用B17/B18持久G/回执；普通发送为交互授权，持久取消、受控资产下载与本地幂等投影、原任务恢复。当前不支持引用/参考图/微调并在发送前拒绝，不迁移BYOK、不启用同步或管理员。
  - verify: 真实SQLite/回环HTTP覆盖1/2/4、默认参数、身份变化、取消先后/丢回包/404/下载恢复/成本；实际Electron界面确认和工作台发送、正常关闭后新PID恢复总生图POST=1；check和完整三形态、源码与内容扫描，明确替身/平台/故障边界。
  - 最终证据：check35/35、30cached、根2229passed/5gated skipped、features606；完整三形态246passed/7skipped/0failed/flaky（PC81/2、移动80/3、Electron85/2）。source1194文件零命中，源码1290项摘要ac876c6132f8fa0f295e50fdf4e5d1bff363c2b50d594eabc9ffbeccd2c09b96，相对B20共38路径，无漂移且未更新视觉基线。报告tests/v25/.results/b21/validation-summary.json；保留初始导入/契约/fixture/参数失败。仅关闭本批首条产品链，P4-R1..R4、P5/P6和迁移整包/管理员前置继续开放。


- [x] 批次 B22：账号云任务恢复分页、结果可用性与旧托管诊断
  - boundary: 复用B21账号云域，增加当前owner的稳定分页、独立云状态/费用/本机结果投影、purge和缺素材的解释及安全原任务恢复；旧未映射托管记录只作本机诊断，不重绑定或自动核销；不新增付费调用或管理员。
  - verify: 严格契约、21+条/同时间/中途状态变更分页、跨owner/cursor拒绝、终态及purge/缺素材幂等恢复、旧托管阻塞诊断；真实SQLite/HTTP及可用的实际API-PG合流，features与真实Electron；check、完整三形态和源码证据。

- 最终证据：check35/35、29cached、根2241passed/5gated skipped、features614；专项恢复33passed、组件15passed、既有真实Hono/PG回执25passed。完整三形态247passed/7skipped/0failed/flaky（PC81/2、移动80/3、Electron86/2），实际新PID两场景purge/缺文件恢复各1POST，保留费用与资产记录。source1201文件零命中，源码1297项摘要3250169f8d434be5adc26d7449b1058904b288ea6691be9836f29a59a266c375，相对B21共26路径且无漂移，未更新视觉基线。报告tests/v25/.results/b22/validation-summary.json。初始类型/测试fixture/格式与全负载持久写超时修复均留证；当前关闭恢复交互切片，P4-R2正式主进程到真服务合流、R3/R4、P5/P6与整包继续开放，管理员未启动。

- [x] 批次 B23：正式桌面账号云客户端与真实服务联合验收
  - boundary: B21/B22 正式 main runtime、持久SQLite、Hono/PG、Graphile队列与worker联合，受控身份/Provider/S3，观察实际body/key/binding和素材/未知费用；fixture仅在测试目录和隔离子进程，不增产品测试后门；全P4/P5/P6及管理员前置不提前关闭。
  - verify: 1/2/4张、默认参数/负面词、并发、失败/取消/未发送零费用与发送后未知、换号/凭据轮换、丢回包/purge/缺文件恢复；先专项真服务，再真实Electron新PID，check/完整三形态与同源清单，记录实际覆盖及剩余矩阵。

- 最终证据：check35/35、30cached、根2242passed/17gated skipped、features614；12项真服务联合+6本机恢复全通过，API完整213passed；完整三形态248passed/7skipped/0failed/flaky（PC81/2、移动80/3、Electron87/2），实际Electron四图/newPID/缺图恢复API POST与Provider调用各1。source1205文件零命中，源码1301项摘要9c6233b1c379b06201620fa0503b8a685accec60814ec7d7e951be70a16b9c7a、门禁后无漂移。报告tests/v25/.results/b23/validation-summary.json，首次金额一致性缺陷/fixture/import/异步等待失败全留。仅关闭本批实际服务合流切片；认证/Provider/S3为合成服务，P4-R3/R4、正额账单/跨月P6、P5和其余迁移/发布及管理员前置保持开放。

- [x] 批次 B24：P4-R3 真实 Electron 强杀与恢复确认首批矩阵
  - boundary: 复用 B23 隔离服务与正式 Electron，测试进程内故障注入定位 claim/HTTP/素材落盘窗口后 SIGKILL；真实安全备份与显式恢复确认，保留原身份/key/费用。只改必要测试与发现的实际问题，不加产品后门，不触正式用户数据、收费上游或管理员。
  - verify: 保存命中窗口、SIGKILL/新旧 PID、SQLite/PG/锚与 API/Provider 次数；匹配/过旧备份及 review 失效拒绝。全仓 check、联合专项与完整三形态；按实际通过范围关闭子项，未验矩阵仍保留。

  - 最终证据：check35/35，根2243passed/17gated skipped、features614；联合3文件34passed，完整三形态257passed/7skipped/0failed/flaky；新增9项均显式执行。源码1304项摘要df35cfe5e4d5fa76b111e8fa18f1684c2f6e1512188154981e36b572814e4637、source1208文件0命中、统一报告tests/v25/.results/b24/validation-summary.json。本批8故障场景/4次投影后强杀和真实备份确认通过；R3缺损锚/确认内部竞争/claim中点继续按路线图§6.12，父级与整包不关闭，管理员未启动。

- [x] 批次 B25：P4-R3 确认提交、缺损锚与持久化中点
  - boundary: 复用B24实际服务和Electron；补claim双持久化中点、真实任务缺损锚、确认执行中换号/恢复/过期与文件写失败。根据复现修正恢复确认的持久提交与身份/DB有效性，不清锚解锁、不调用收费上游、不改冻结面或管理员。
  - verify: 核对每项故障前后checkpoint/锚/原key/费用/素材与实际请求次数；错误或未提交确认不解除限制；已提交确认有唯一线性化点且可重启核对。core真实SQLite/文件、正式主进程/实际Hono/PG/worker及Electron矩阵；check与完整三形态、源码/扫描和阶段记录，R3按完整条件验收。

  - 最终证据：check35/35，根2249passed/17gated skipped；完整三形态274passed/7skipped/0failed/flaky。源码1306项摘要7bd7b59729519d834aad5540ef7487aa6486a9674a9a555c98f8e0be8c1a2f6c；真服务联合、26项实际故障/备份证据、首次失败及边界见tests/v25/.results/b25/validation-summary.json与测试手册§5.18。P4-R3本机矩阵验收，原生Windows/断电不由此覆盖；P4-R4、P5/P6与其余迁移/发布/管理员前置保持开放。

- [x] 批次 B26：P4-R4 显式重试、持久意图与旧入口兼容
  - boundary: 复用当前contracts/core账本/正式账号云客户端/API retry与共享网关；保留caller幂等键，冻结父请求/远端重试操作并重查费用和当前身份；兼容未发送取消及BYOK/legacy/R/S边界，不复用旧授权、不清锚解锁、不调用真实付费上游。
  - verify: 先就地负例/持久回执与新授权，再实际HTTP/PG/worker和Electron；覆盖同意图并发、父子关系/原金额、未知禁止重发、取消/丢回包/新PID、换号/凭据轮换及旧入口启用竞争。按实际完成范围回填；最终check和完整三形态、源码与报告对齐，未验不关闭父卡。
  - 09-20原范围收口：§5.107已逐条核对R4-1..4；本轮补正式结算窗口的新意图独立确认，并修正旧暂停夹具响应流锁的假阳性风险。同账号正例先红后绿，最终完整三端内C3-B3P、retry-faults7P、retry-recovery10P、resume-faults16P、cloud-retry2P、Web兑换恢复4P；根规则/真实SQLite交错/serve升级/接管16P，完整API1138P与Worker322P及最终check38/38通过。原boundary明确不调用真实付费上游；真实账单归P6、Windows归延期平台、外部破坏双锁归独立纪元卡，不再以这些非本子项条件悬置B26。完整迁移父项保持开放；[本轮证据与边界](../../../docs/v2.5/V25-NONWINDOWS-ACCEPTANCE-2026-09-20.md)。下面旧“仍未勾选”为当时历史状态。


B26 阶段证据：显式重试主链验证通过，check35/35、联合171、API完整集成220、三形态276passed/7skipped/0failed/flaky。源码1307项摘要`5342cbb0df26f103ba89e49887fac42cb583ca1a854fd7e9faa791927d42c9dc`，统一报告`tests/v25/.results/b26/validation-summary.json`。B26 原任务仍未勾选，剩余R4-C1..C5见路线图§6.14：交互/剩余故障/legacy/BYOK/R/S完整矩阵不由同key专项代替；父级与整包仍部分完成，管理员未启动。


- [x] 批次 B27：R4-C1 共享重试交互、进行中防重与错误反馈
  - boundary: features 共用同账号同原任务的进行中交互，不改变底层持久幂等/费用授权；工作台/历史列表/详情统一资格和反馈，保留新显式意图与跨账号隔离。R4其它故障/旧入口矩阵继续开放。
  - verify: 同步双击/跨组件/自动网络重试/账户变化/失败解锁，就地组件与真实Web/Electron；全仓和三形态同源码，按实际结果回填。


B27 阶段证据：R4-C1 工作台/历史三个手动入口的共享交互通过本机验收，check 35/35，组件专项 75、正式服务 15，完整三形态 278passed/7skipped/0failed/flaky。源码1309项摘要`8d7de8a9c596d518a2b567bafb703482a826f7b340596581e29ec1919e4e4f0c`，统一报告`tests/v25/.results/b27/validation-summary.json`。只关闭B27；B26/R4/P4/整包保持开放，兑换后续发的独立错误/并发缺口已登记C4。下一步路线图§6.15 C2→C3/C4→C5；管理员未启动。


- [x] 批次 B28：R4-C2 重试故障与原意图恢复
  - boundary: 复用真实 Electron/main/SQLite/Hono/PG/worker，补未领取取消后新授权、retry claim/POST/取消中点、身份/恢复/父生命周期；根据实际失败修接缝，不造新授权系统，不清锚或改费用。
  - verify: 命中窗口与新旧 PID、原/新 key/父子/payer/月/费用、API/Provider 次数逐项留证；已领取不重发，旧结果不进新库。就地测试、真实服务和实际宿主，check/完整三形态及源码报告；未验不关闭整卡。


B28 阶段证据：R4-C2 本机17项重试故障/恢复验收通过；check 35/35，完整三形态 295passed/7skipped/0failed/flaky。源码1312项摘要`1bae587d59ba8c56efa81e492cd78f1e23cb0a4ee798a658f5cf252c4eaed192`，统一报告`tests/v25/.results/b28/validation-summary.json`。仅关闭B28本机切片，B26/R4/P4/整包保持开放；下一步路线图§6.16 C3实际旧入口→C4 BYOK/R/S/兑换续发→C5，再原P5/P6及云Agent/包/GC/迁移/发布；管理员未启动。

- [x] 批次 B29：兑换到账与生成恢复结果分离
  - boundary: 复用共享 features 的账号/生成 mutation 和重试准入，兑换成功立即确认；续发单独反馈提交中/已提交/失败，提供原任务入口，复用进行中重试与原 create key，屏蔽换号后的旧结果。补桌面历史官方额度错误映射且不混淆 BYOK 余额；不改变付款授权、费用账本或后端兑换语义。C3 旧入口仅按实际审计与测试范围留证，完整 C3/C4/R4 继续开放。
  - verify: 组件覆盖续发失败/已受理失败、两种并发顺序、原 key 网络重试、换号及新恢复意图竞争；PC/移动 Web 和真实 Electron 覆盖到账后失败提示与返回原任务；最终 check、完整三形态、扫描/源码清单和实际报告。不得将网络替身当作真实兑换计费或完整旧入口验收。


B29 阶段证据：兑换恢复反馈/并发/账号隔离和桌面官方额度引导的本机切片通过；check 35/35，组件62通过，旧入口基线24通过，界面专项5通过，完整三形态300passed/7skipped/0failed/flaky。源码1315项摘要`da51f777c45d0f34758d9999faad1caad34c1c6208f938e48950ea0e376aa8a2`，统一报告`tests/v25/.results/b29/validation-summary.json`。首次void回调、Web fixture错误码和桌面映射失败留证；只关闭B29，C3真实旧入口和C4 BYOK/默认连接/R/S、C5仍待，B26/R4/P4/整包保持开放；管理员未启动。

- [x] 批次 B30：正式旧入口与本地连接兼容
  - boundary: 核对正式 G/R/S/CLI/MCP/Automation 和 v25 本地方案的实际装配；以真实旧官方 openai-compatible 配置在隔离 Electron 重现未绑定发送路径，修公共服务边界并保留自备连接及正式云 transport。按实际可达性补启用前旧在途/结算与 BYOK 默认/重试兼容，不造托管豆包或移除持久包装，不调用收费上游。
  - verify: 先真实宿主负例留存失败与 Provider 次数，后 core/IPC 就地回归和正式入口矩阵；旧付款身份不能由旧 Key 或用户点确认凭空获得，自备连接不被阻断，持久未结事实继续限制启用；完整 check/三形态及同源码报告，按原 C3/C4 条件决定可关闭范围。
  - 09-20原范围收口：本轮完整Electron中旧托管生成拒绝1P、旧持久未结启用阻断3P、BYOK云前后兼容1P、实际CLI/MCP G/R/S1P、本地连接策略5P及修正后的结算竞争3P全部通过；原规则/SQLite/接管层和同源全量、当前包同时通过。保留持久包装与正式入口，未伪造托管豆包，未调用真实付费上游；历史缺模型的拒绝与用户新意图恢复已由B32及本轮retry-model用例覆盖。仅关闭原旧入口/连接兼容范围，不外推旧签名安装包、Windows、实际正额账单或整个P4/P6；[本轮证据](../../../docs/v2.5/V25-NONWINDOWS-ACCEPTANCE-2026-09-20.md)。下面旧“总任务不关闭”为当时历史状态。


B30 阶段证据：旧账号未绑定本地发送与默认模型快照缺陷已修；实际 G/R/S/BYOK 子矩阵和三类持久未结启用阻断已验。check 35/35，完整三形态305passed/7skipped/0failed/flaky；源码1321项摘要`1ab821e097e6d54ddf2ffb3245fa31774f9c607ea1b48270e3e7b9ac4c91ef19`，统一报告`tests/v25/.results/b30/validation-summary.json`。首次缺陷/fixture失败及一次既有进程超时均留证。B30总任务、C3/C4剩余条件、B26/R4/P4/整包不关闭，历史unknown模型分类仍待；接续路线图§6.18，管理员未启动。

- [x] 批次 B31：本地连接管理一致性与自备兼容
  - boundary: 用正式本地 challenge/HTTP 重现连接管理与 v25 IPC 的差异，在共用主进程接缝统一受保护类型、密钥写入、可信激活与删除接管。保留合法 BYOK 和冻结豆包，不将本机管理通道扩为云管理员。接续 C4 云前后生成/取消/重试/R/S 的剩余组合，原 C3/C4/R4 条件不缩水。
  - verify: 先真实 Electron 负例并留存首次结果；就地单元/事务/跨入口回归；BYOK 模型、请求和凭据来源、费用归属保持；最终同源码 check/完整三形态/扫描与文档。


B31 阶段证据：本地/IPC 共用连接规则、云前后自备兼容与实际 CLI/MCP 本地 G/R/S 已验。check 35/35，单元25项、专项7项，完整三形态311passed/7skipped/0failed/flaky；源码1325项摘要`40aba6dcc793e5f053194a9ee07f2c10107291b5a88dbd4d965814131915335e`，统一报告`tests/v25/.results/b31/validation-summary.json`。四个真实管理缺陷和首次CLI命令顺序fixture失败已留证。仅关闭B31，历史模型缺失/C3/C5、B30/B26/R4/P4/整包保持开放；接续路线图§6.19，管理员未启动。

- [x] 批次 B32：历史模型缺失的重试反馈
  - boundary: 本地历史缺少可证明模型时，在 core/IPC 发送前明确拒绝，不采用当前默认或调用者替代值，不改原记录/费用；保留独立可信云请求快照和已有模型冻结行为。通过原历史重试反馈及工作台新意图完成用户恢复，不造新授权系统。
  - verify: 核心原模型缺失/可知正反例、主进程两种 retry 入参拒绝与零调用；真实 Electron 从历史收到明确反馈后新建生成成功，原事实不变。最终 check、完整三形态、源码扫描和文档留证，原 C3/C5/R4/P4 仍按完整条件验收。


B32 阶段证据：旧本地模型缺失在 core/IPC 发送前明确拒绝，历史反馈与连接核对后工作台新意图已验，原记录/费用不变。check35/35，core/IPC44项、账号测试43项；完整三形态312passed/7skipped/0failed/flaky。源码1327项摘要`8ef7aa3d4db46ec9bd8134df1275e456b7db64c52108df589e55533f8ed89034`，报告`tests/v25/.results/b32/validation-summary.json`。首次真实缺陷及fixture/注册瞬态断言错误留证；仅关闭B32，C3/C5、B30/B26/R4/P4/整包开放，接续路线图§6.20，管理员未启动。

- [x] 批次 B33：headless 守护在途退出排空
  - boundary: 修复 B32 实际分发 serve 证实的在途生图未结束就关库/释放owner问题；关闭准入、取消并等待现有任务收敛后才关库交出目录，兼容已识别旧守护提前删锁但PID仍活时等待实际退出、超时拒绝；保留 BYOK/旧account拒绝，不开启headless云账号或方案/Skill能力。
  - verify: 就地实际SQLite/HTTP正反例、重复stop与owner释放顺序；实际CLI分发SIGTERM及桌面接管负例/成功路径；check与相关宿主回归，原完整C3/C5/R4/P4和发布范围不由此切片关闭。


B33 阶段证据：守护准入关闭、在途取消排空、关库/owner顺序及实际桌面接管已验；旧进程提前删锁后延迟退出/超时仍活以真实子进程fixture覆盖。就地6项、云回执独立复核16项；check35/35，完整三形态313passed/7skipped/0failed/flaky。源码1329项摘要`f4b05a835c6b2fe676530ac0f6d25c3bc7c699175995d2ac024fc7e1e6a708ad`，报告`tests/v25/.results/b33/validation-summary.json`。首次缺陷、诊断格式错误、既有回执等待超时留证；不证明历史安装包/Windows/真实账单，原C3/C5/B30/B26/R4/P4/整包继续开放，接续路线图§6.21。

- [x] 批次 B34：云 Agent 可信 GitHub 来源持久准备服务
  - boundary: 按G-CLOUD-02.1/02.3既有独立准备子目标，复用B12固定SHA reader，将来源字节/元数据持久到受管S3/PG，单来源owner/execution/request幂等、明确确认身份、取消/过期/清理与读取校验；不冒充Agent编译或改变尚未就绪的create响应合同。C3/C5与P4原验收继续开放。
  - verify: canonical合同→真实PG/回环GitHub/S3→重启/并发/跨owner/分支移动/拒绝/取消/过期/失败补偿与worker引用保护；隔离迁移回放及API/worker门禁，全仓check与证据文档。模型调用0，确认后不重新拉移动分支。


B34 阶段证据：单 GitHub 来源内部持久准备、明确确认、取消/过期/上传晚写补偿、owner 外键、完整字节读取与方案绑定保护已验。最后引用删除后不回收的两项真实失败已修复，重复维护为0。最终check35/35，API15文件234项，worker8文件84项，源码扫描1246文件无命中；来源14项含实际双Node PID，模型调用0。源码1342项摘要`e9bceed201403168857c414cee7c53c0e6439f4b292e09e9e63a0433a56a9cf9`；报告`tests/v25/.results/b34/validation-summary.json`，详细真实/替身/未验见测试手册§5.27。本批无UI/桌面实现改动，未复跑完整E2E；公开Agent、父卡、C3/C5/R4/P4与整包保持开放，接续路线图§6.22和来源验证§5。


- [x] 批次 B35：云端 Agent 持久会话与来源队列接线
  - boundary: 在 G-CLOUD-02 的既定异步合同目标内新增 canonical 会话/查询/事件/精确确认/取消 API，复用 B34 来源准备并由独立 Graphile 消费进程推进；启动/来源登记/队列原子提交，取消先于读取生效，多来源旧确认不推进下一项。未接模型时保持真实 blocker，不伪造完成草稿；原桌面/确定性创建与 Cloud MCP 保持兼容。
  - verify: 合同和真实鉴权 HTTP/PG/Graphile 集成，两个来源乱序/重放/取消/跨owner/过期/进程恢复；来源原测试与迁移/完整API、worker、check回归。原 C3/C5/P5/P6、完整编译/产品/发布仍按原条件验收。


B35 阶段证据：异步会话/逐源确认/事件/取消、PG+Graphile原子入队和独立API域消费角色已验；14会话集成含两个Node PID接续及正式bin SIGTERM。最终check35/35，API16文件248项，Worker8文件84项（后续仅API错误包装与其测试变化），源码扫描1259文件无命中。源码1355项摘要`1766638f936a1b4431b70cadb705aa3df7b986451e6c876f2931e8265ac1c79d`；报告`tests/v25/.results/b35/validation-summary.json`，首次夹具/临时配置/并行超时与复跑见测试手册§5.28。仅完成会话来源阶段，模型调用0、compiler blocker真实保留；原同步Agent/共享产品、C3/C5/P5/P6、完整迁移及发布仍待，管理员未开始。接续路线图§6.23。

- [x] 批次 B36：共享 Agent 角色契约、提示词与桌面兼容接线
  - boundary: 将 Analyst/Compiler 输出与纯角色输入归入 contracts，三角色提示词和 JSON 提取归入 domain；桌面角色及 text-adapter 实际消费共享实现，旧 desktop-contracts 保留兼容导出。网络、密钥、付费授权、重试编排和落库仍由宿主负责，不将桌面自动重试带入云端。
  - verify: 模型身份字段剥离、输出限制、来源截断/合并/历史/修订投影、三角色 signal 和校验修复；保存的旧实现与新接线逐字提示词对比；全仓 check、实际 Electron 回归及同源码报告。云端模型/发送账本/持久草稿仍按 G-CLOUD-02 原条件继续。

B36 阶段证据：共享输出/输入合同、三角色提示词和JSON提取已接回桌面；专项35通过，旧/新提示词10组逐字一致，真实Electron模型创建/修订及新PID重读1项通过。最终check35/35，含隔离数据库Electron147passed/2skipped/0failed/flaky，源码扫描1269文件0命中。源码1365项摘要`182f9ad4b2991bf4fe19eaa13517b7d3e2c209210277c8de86b2c889b99bff2a`，报告`tests/v25/.results/b36/validation-summary.json`；首败与完整边界见测试手册§5.29。仅关闭B36共享基础，云端文本身份/发送账本/草稿未实现，原父卡/整包和管理员前置不关闭，接续路线图§6.24。

- [x] 批次 B37：云端文本身份、持久模型调用与编译草稿
  - boundary: 复用账号身份锁顺序并保留图像绑定；显式配置文本模型，新请求冻结文本绑定/原会话/调用与输出上限/未知费用接受，旧来源会话不自动收费。复用共享角色与已确认字节，逐调用持久发送、结果和unknown，事务创建canonical草稿与来源引用。云端不继承桌面自动重试；共享UI及modify/update仍按原卡继续。
  - verify: 真实PG/鉴权/回环模型HTTP，模型资格、幂等、撤销/轮换/取消/到期、并发/发送和重启边界、非法输出/证据/变量、真实草稿重读与固定试运行准备；迁移回放、API/worker及全仓门禁，保留失败和未验范围。

B37 阶段证据：新异步文字/已确认GitHub create后端已验；独立文本绑定、原会话/调用上限、持久单次发送/结果/unknown、语义校验与PG草稿/event同事务。最终check35/35，API17文件268项、worker8文件84项，文本20项含正式bin/SIGKILL/新PID及实际图像prepare无生图。源码1381项摘要`e7a7bd43bf0265c8e9119255052ad599e1f03434dc719389b84dab6bebd5e5e3`，报告`tests/v25/.results/b37/validation-summary.json`；初败修复、JSON等价格式与测试增强后的门禁版本边界见测试手册§5.30。仅关闭B37后端切片，G-CLOUD-02父卡/修改/更新/素材/包/共享UI、原C3/C5/P5/P6及worker/GC/迁移/发布与整包开放，管理员未启动。下一条目标和验收见路线图§6.25。

- [x] 批次 B38：云端异步修改、基线竞争与正式版保护
  - boundary: 在既有异步协议上增加modify，冻结本人精确baseRevision/版本/文档，复用B37文本授权与一次持久调用、共享Reviser及事件；新修订与任务完成同事务，正式版指针和原来源/资产保持，过期base与并发修改拒绝覆盖。旧create/同步桌面保持；上游更新和共享UI另按原卡接续。
  - verify: 合同与纯修订语义；真实PG/鉴权/文本HTTP/模型次数，current/working-draft、同键重放/不同意图竞争、取消/撤权/删除/未知/进程恢复及事务失败；现有详情/试运行准备，新增迁移和API/worker/check。证据不外推完整Agent产品、原费用/GC/发布。

B38 阶段证据：新异步modify后端完成精确基线/版本、单次Reviser、正式current保护与原来源/资产继承；22专项含真实SIGKILL/新PID、生产bin和试运行准备。最终check35/35，API18文件290项、worker8文件84项，源码扫描1291文件0命中。源码1387项摘要`488605abce3916acbf4898f13030a50e310df8a5d9286a12f6f3055d63c613a9`，报告`tests/v25/.results/b38/validation-summary.json`；首败及实际/替身、默认skip和未验范围见测试手册§5.31。仅关闭B38后端切片；上游更新、原同步/共享UI/包、C3/C5/P5/P6和worker/GC/迁移/发布与整包继续开放，管理员未启动。下一目标路线图§6.26。

- [x] 批次 B39：云端上游更新、逐源确认及独立编译授权
  - boundary: 复用B34–B38，免费检查本人精确基线绑定的GitHub ref/commit，固定新来源与确认身份；无来源/无变化明确终态，变化逐源确认后单独授权文本调用。共享Analyst/Compiler和持久调用产生新修订，保留原正式版/旧来源/资产，版本竞争/unknown不覆盖不重发。旧同步/UI/包和全生命周期原条件继续。
  - verify: canonical合同/client/纯更新语义；真实PG/模型/GitHub/S3/鉴权，检查零模型调用、移动分支/旧确认/多来源/许可告知、精确版本/重复授权/身份失效、取消/强杀新PID/未知/原子落库、实际详情/试运行；迁移和完整API/worker/check，记录首败与未验。

B39阶段证据：新异步免费检查/逐源确认/独立授权更新后端完成，修复新文档与继承旧来源绑定不一致导致不能试运行。22专项含真实PG来源替换、PNG/实际prepare、SIGKILL/新PID/正式bin；最终API19文件312项、worker8文件84项、check35/35、源码扫描1298文件0命中。源码1394项摘要`b0d47bf519901bdb0df79525c90a97902de09626691a86d84bcf0702dec81b82`，报告`tests/v25/.results/b39/validation-summary.json`；首败/实际与替身/默认skip和未验见测试手册§5.32。仅关闭B39后端切片，素材/包/共享UI、C3/C5/P5/P6和worker/GC/迁移/发布及整包仍开放，管理员未开始；接续路线图§6.27。

- [x] 批次 B40：云端 Agent 上传素材冻结与草稿资产闭环
  - boundary: 先完成 D1 中已上传图片输入，服务端验证本人暂存图片及可选元数据，调用模型前复制为不可变任务素材并持久固定顺序/摘要；完成后原子转为方案资产，实际详情/试运行准备可读取。图片只作保留的参考素材，不声称文本模型做过视觉解析、不自动增加必需图片槽。历史作品/提示词与仓库图片采用仍单列后续，旧同步/UI/包及全生命周期条件继续。
  - verify: 契约/域测试、真实 PG/模型 HTTP/S3 的归属/篡改/重复/取消/过期/恢复/持久化/GC 与实际 RunService.prepare；隔离 db:migrate、完整 API/worker、根 check、源码扫描和文档校验，保留失败与未验范围。

B40阶段证据：上传素材新异步create后端完成固定副本/顺序/元数据、费用前校验、原子草稿资产及真实图片试运行准备。最终18专项包含于API20文件330P，worker8文件85P，check35/35（2缓存）、源码扫描1305文件0命中。最终源码1401项摘要`2fbde61db44bb1d6a4e3cfa318bf84079a4b024e7bd5b722156944174bb4eabd`；PG全集之后只有worker测试链式调用格式变化，前后快照与首败/默认skip/实际和替身边界见测试手册§5.33及`tests/v25/.results/b40/validation-summary.json`。仅关闭B40上传切片；历史/仓库图片、包/共享产品、费用/GC/旧库/平台发布及整包仍开放，管理员未开始；接续路线图§6.28 H1–H3。

- [x] 批次 B41：云端本人历史作品与提示词的可信输入及来源继承
  - boundary: 完成H1–H3，核对owner/run/asset/status/deletedAt和实际图片/提示词快照，固定副本与完整有界提示词及原身份；修复GitHub+历史混合提示词遗漏，保存历史来源及合法cloud-run/example资产，创建/修改/更新/详情/试运行引用保持一致。复用原授权/单次调用/GC，不冒充视觉解析。仓库图片自动采用/包/共享UI和原E条件保持开放。
  - verify: 合同和纯域、真实PG/HTTP/S3/PID、归属/错run/删除/篡改/提示词纳入/上限/混合来源/多角色引用、取消/unknown/恢复/事务、实际get与RunService.prepare、API/worker全集、根check；共享Compiler改动补Electron回归。记录失败、源码与跳过/替身边界。

B41阶段证据：历史25专项包含于API21文件355P，worker8文件85P；check35/35、0缓存、根2352P/20门控S；Electron默认101P/48S加DB补46P，按ID去重147P/2外部S，0失败/flaky；源码扫描1309文件0命中。最终1405源码摘要`b787f9870812ad4a86d9019be5d30877788c926038a861628fb4a6e46385ab66`，完整PG运行之后仅根既有prompt单测断言改动，产品及API/worker源码一致，最终check/Electron/扫描使用最终快照。首败、逐轮结果、真实历史/正式SQL样本、实际PID与未验边界见测试手册§5.34及`tests/v25/.results/b41/validation-summary.json`。仅关闭B41后端；R1仓库图片、D3/D4、原C3/C5/P5/P6和worker/GC/旧库/发布、整包仍开放，管理员未启动。

- [x] 批次 B42：已确认仓库图片采用、固定来源与更新资产事务
  - boundary: 完成路线图§6.29 R1.1–R1.4；在真实已确认快照与持久Analyst报告上固定图片路径/角色/采用与舍弃记录，复用注册表独立副本和费用单次调用；创建/修改/更新/get/content/prepare保持资产溯源，更新只替换变化来源对应图片并保护旧revision/正式current。未知许可不伪造，未送像素不称视觉分析；专用包/共享UI及原E保持开放。
  - verify: canonical合同与纯域、真实PG/S3/HTTP/新PID、跨快照/路径/篡改/重复/限制/混合输入、并发采用/取消/unknown/回滚/来源替换/实际图片prepare；必要API/worker全集与check，共享规则按影响补Electron，保存首败、源身份及未验范围。

B42阶段证据：已确认仓库图片固定采用/舍弃/角色/hash、副本注册与持久决定、创建/修改/更新资产事务及实际get/content/prepare完成。仓库22项包含于最终API22文件377P，worker8文件85P；check35/35（28缓存），Electron三个文件定向16P/0失败/跳过/flaky，源码扫描1314文件0命中。1410源码摘要`841cdd3ca5ca401d6c1f52e43847a5429f3439ab02e9deda81e37bd0a00675c8`，最终服务/check/Electron/扫描同源码。纯文本兼容首败已修复20P，原失败与缓存/真实PID/SQL样本/自然期限/未验见测试手册§5.35及`tests/v25/.results/b42/validation-summary.json`。仅关闭B42后端切片，D3/D4/原E与整包继续；接续路线图§6.30 F1–F5云端专用包，管理员尚未开始。

- [x] 批次 B43：双宿主共享方案包编解码与内容引用校验
  - boundary: 接续D3/F1，抽出Node归档包供桌面与API消费，canonical/legacy实体仍由contracts单源定义；双输入路径共用有界ZIP读取/写入和语义校验，补历史正文/图片与仓库溯源的一致性。修复桌面新素材导入重映射、受管JSON/IPC读取及再次导出字段丢失，桌面真实旧格式/导出导入保持，服务端不导入桌面；不将共享基础当云暂存/事务导入/产品闭环完成。
  - verify: 合同/真实ZIP/CRC/路径/重复/超限/来源资产图与内容篡改、现有桌面包回归、API消费同一codec、完整check与真实Electron；若发现旧数据兼容冲突，保持真实语义并明确记录。D3/F2–F5及原D4/E仍开放。

B43阶段证据：共享Node编解码、内容图/素材一致性、桌面新ID映射与真实SQLite/IPC/再次导出完成。7文件73P，API377P/worker85P，check全量重算36/36无缓存、最终36/36（33缓存）；Electron完整首轮146P/1F/2外部S，修复测试等待竞态后两场景各5轮共10P，合并147个通过场景/2外部S，非单轮全绿。源码扫描1326文件0命中。最终1422项摘要`a94805b7f9721f96ac65014d8b5a1b23abe1c5e62540912d675165799e0ed22f`，API/worker后仅两处测试文件改变。首败/替身/SQL正式样本/跳过及未验见测试手册§5.36与`tests/v25/.results/b43/validation-summary.json`。仅闭本切片，路线图§6.31的兼容补齐/F2–F5/D4/原E继续，整个迁移和管理员前置未完成。

- [x] 批次 B44：导入方案修订后的素材与来源引用兼容
  - boundary: 接续路线图§6.31 F1，修复导入混合方案经修改/上游更新后丢失素材声明和来源身份的问题；明确版本引用与资产原始归属，保证导出/运行只读本方案当前版本拥有或显式继承的素材，原正式版/旧快照/历史正文不改写，不继承旧试跑或封面资格。云端包F2–F5和D4/E仍开放。
  - verify: 先复现真实SQLite导入→修改/更新→IPC/运行准备/导出→再导入；覆盖旧无声明数据、混合历史/仓库、跨方案/未引用资产拒绝、正式版保护与事务回滚；根check、所需API/worker及完整Electron、源码扫描与文档证据按真实结果回写。

B44阶段证据：导入方案modify/update素材继承、来源替换和完整历史保留，正式版保护及SQLite回滚通过；修复Windows路径检查。最终定向128P、check36/36（31缓存，根2396P/20门控S、features633P），最终完整Electron148P/2外部S、0失败/flaky/自动重试；路径修复前完整148P/2S另存，不重复累计。源码扫描1331文件0命中。最终1427文件摘要`15077b90f428d41eef7a3818ce003c0727d757668fe024cfa1a7f4236efe94d9`，源码无漂移；真实Electron/合成trial封面/模型替身及首败详见测试手册§5.37和`tests/v25/.results/b44/validation-summary.json`。无新DDL或本批API/worker全集复跑。仅闭本切片，F1剩余/F2–F5/D4/原E与整个迁移继续，管理员前置未完成。

- [x] 批次 B45：共享方案包旧格式转换与版本来源兼容
  - boundary: 接续路线图§6.32 F1，统一可被云端消费的legacy方案文档与包转换规则；保留创建/父版本事实和来源种类，拒绝与固定快照冲突的显式来源信息，核对内容索引跨locale规则。保持桌面原导入权限、草稿与试跑边界；不将格式准备标记为云暂存/导入HTTP或产品完成。
  - verify: 真实旧v1和canonical v2归档在独立Node宿主转换/往返，字段与素材/来源逐项一致性、错误与旧样本兼容，跨locale证据；根check、相关API/worker与完整Electron按真实覆盖回写。F2–F5/D4/原E和管理员前置继续开放。

B45阶段证据：共享legacy文档桥/v1解码、真实创建与精确父版本、share-import种类及来源绑定、固定新摘要/旧locale精确读取完成。定向126P，进程改造后locale/ZIP13P；API377P、worker85P；最终check36/36、0缓存（根2416P/20门控S、features633P），完整Electron148P/2外部S、0失败/flaky/自动重试，扫描1340文件0命中。最终1436源码摘要`2225fecf2c57bd81e6dcc44b504141d8dc69c46094356d60cee48aac955e3a5a`，API/worker后仅新locale测试变化。真实/替身、首败和B44日志证据缺口见测试手册§5.38及`tests/v25/.results/b45/validation-summary.json`。只闭本切片，F2–F5/D4/原E及整个迁移、管理员前置仍开放。

- [x] 批次 B46：云端方案包持久上传与精确确认
  - boundary: 接续路线图§6.33 F2，新增无路径上传意图、真实字节有界接收/校验、持久owner/请求/解析版本/确认摘要及上传租约；复用既有对象登记与清理outbox，接入Hono鉴权和事务身份重查。F3/F4导入导出与共享产品、原E和管理员前置继续开放。
  - verify: 契约正反例、真实PG迁移和S3/HTTP上传、未知长度/截断/超限/错误hash、幂等/并发/取消/过期/身份变化与新PID恢复、GC保护和账号删除后清理；check及API/worker完整门禁，真实结果回写文档。

B46阶段证据：公开云包上传/确认/取消与api-client、PG0019/原对象登记outbox/worker租约保护已接。最终API396P、worker88P，check36/36、30缓存（根2426P/20门控S、features633P），扫描1362文件/1归档0命中/错误。定向25P、contracts7/client3，实际两个SIGKILL/新PID和PG事务回滚；首轮API395P/1F后优化既有进程测试启动方式，保留原断言/超时并完整复验。最终1455源码摘要`79032af137f1cd31e0bd919f88bba44763479f7342158788d8b430a40f9668e9`；worker后仅测试文件变化。完整记录与未验边界见§5.39和tests/v25/.results/b46/validation-summary.json。仅关闭本片；原子导入/导出、旧prepare及shared产品和原E、整包与管理员前置继续。

- [x] 批次 B47：云端方案包导入内容准备与固定身份映射
  - boundary: 在F3中实现私有、无IO的导入内容准备，实际v1/v2字节经共享解码后固定新scheme/revision/package/snapshot/asset身份，完整保留正文和素材；真实像素校验、旧预览仅example、来源匹配有歧义则拒绝。不得将包内scan/status视为账号/试跑/费用授权。持久请求/对象晋升/PG原子落库及HTTP接线仍由F3.1/F3.3后续实现，父卡不关闭。
  - verify: 实际ZIP、混合来源/完整正文/图片/编译证据、重复准备固定ID与新种子隔离、错误尺寸/损坏像素/悬空或歧义来源/旧元数据，独立新PID重建一致；完整check与API相关测试，真实结果和未验边界回填。

B47阶段证据：API私有内容准备/new ID/完整正文及像素/旧预览边界已验，20项通过，check36/36（30缓存）、源码扫描1367文件/1归档零命中/错误。首次旧包往返夹具MIME错误导致19P/1F及check失败，修复后完整通过；类型推导首败及真实/合成、未验边界见测试手册§5.40。最终1460源码摘要`80d153c9548f2e35ebefe3527df7932bd3478efa5f5c07125e9036dc78359b8e`，只新增5文件。无HTTP/持久依据/PG/S3晋升接线，F3整体与F4/F5/D4/原E、整包和管理员前置保持开放；接续路线图§6.35。

- [x] 批次 B48：云端方案包持久原子导入与幂等回执
  - boundary: 接续F3.1/F3.3，在本人精确confirmed原包上固定seed/时间/映射版本/授权与请求回执；各尝试独立对象命名空间、先登记outbox再PUT，租约/epoch保护原包与迟到进程；来源/资产/新草稿/回执同事务。接通原import-package HTTP；正式导出、共享产品和原E继续。
  - verify: 真实PG迁移/HTTP/S3，v1/v2导入及get/content/prepare、所有权/精确确认、重放/并发/取消/过期/身份撤销、真实SIGKILL新PID和回滚/对象GC；contracts/check/API/worker按影响全验。

B48阶段证据：实际import-package/PG0020固定身份与回执、先登记对象再PUT、来源/素材/新草稿原子提交、旧epoch保护与持久清理intent已接；导入28P、合同/schema41P、包清理5P，check36/36（0缓存，根2427P/20门控S、features633P），数据库API424P/worker90P，源码扫描1374文件/1归档0命中/错误。最终1467文件摘要`460aae4e44fd074279966420a92ea50ad5fa0f20912432b75db3174e01e443f0`，相对B47新增7/修改14/删除0。三个SIGKILL/新PID、真实S3协议和PG回滚已验，TTL注入/会话fixture/首次失败与限制见测试手册§5.41及tests/v25/.results/b48/validation-summary.json。只闭本后端切片，F3联合条件/F4/F5/D4/原E和整包、管理员前置继续，接续路线图§6.36。

- [x] 批次 B49：云端正式方案归档与受控下载后端
  - boundary: 接续F4，在本人精确当前正式版本、本版本试跑与封面资格上固定导出依据；复用shared writer、原对象登记/outbox、正常会话权限，持久请求/取消/TTL及受控字节下载。服务端ready不冒充宿主delivered；旧宿主export合流与F5/D4及原E继续。
  - verify: 真实PG迁移/HTTP/S3、正式化正负例/版本素材隔离/完整正文/归档读回、重复请求/撤权/取消/过期/重启/回滚与GC；contract/check/API/worker按影响全验，保留首败与替身边界。

B49阶段证据：新正式包归档/受控下载、PG0021、完整字节client、原清理租约已接；导出30P、合同/client/schema22P、包清理7P，check36/36（5缓存，根2442P/20门控S、features633P），数据库API454P/worker92P，源码扫描1386文件/1归档零命中/错误。最终1479源码摘要`ecc26a953d5fcce6bfb3650d9ef595d5f279ce1e83c3c988f815b7ac67cadee3`，对B48新增12/修改10/删除0。真实Hono/S3/PG/三个SIGKILL及新PID，SQL trial/fetch/源资料夹具、首次cover角色缺陷与夹具/格式修复见测试手册§5.42与tests/v25/.results/b49/validation-summary.json。只闭后端切片，F5/D4、F3/F4剩余联合/自然期限/独立包扫描、原E和整个迁移/管理员前置继续；接路线图§6.37。

- [x] 批次 B50：云端方案包导入共享页面
  - boundary: 通过可选 packageImport gateway 消费已有持久上传/确认/原子导入；共享文件选择、格式、预览、显式确认、错误恢复和导入定位，Desktop 原生入口沿用。全量E2E实际发现快速重开AlertDialog时同层兄弟portal的遮罩倒序阻挡，追加同组挂载及原动画/焦点/明确确认回归；不强制点击或放宽断言。导出交付、异步 Agent 产品和跨宿主真包联合仍继续，不关闭父卡。
  - verify: 重复点击/关闭迟到/换号/响应丢失/精确确认单测；PC/移动生产页面真实 File/SHA256/焦点/导航（HTTP 夹具），完整 check 与 test:e2e。接口替身与真实后端证据分别登记，不将阶段通过当作整包闭合。

B50证据：共享云导入页面与实际发现的AlertDialog快速重开遮挡修复。15P/4P/2P、Web专项14P；check36/36（26缓存）；数据库条件全量E2E325P/7S，0失败/不稳定；源码1486摘要159885cd176722b491010bc06d99b2d944c10be08d21bd558ede5c98219296a3。首败、两端红绿回归、来源/skip边界与未闭合项见测试手册§5.43和tests/v25/.results/b50/validation-summary.json。只关闭本批，F5/D4/F3/F4/原E与整包和管理员前置继续。

- [x] 批次 B51：云端正式方案包共享导出与宿主交付
  - boundary: 消费B49原归档/下载接口，shared features冻结选定正式版本和原请求，Web宿主承担保存选择器/完整bytes/hash/Blob交付；新增独立host回执区分delivered与download-started，原生exportPackage兼容不变。实际截图发现移动详情标题被动作压成20px竖排，补窄屏两行布局与浏览器几何回归。刷新恢复、三方向真包/Agent/原E不随本片关闭。
  - verify: 契约、宿主与features单测覆盖明确保存/取消/失败/重复点击/换号/清理；PC/移动真实下载文件读回hash、原请求重试、撤权及迟到下载；完整check、数据库条件test:e2e、源码扫描、截图复核与失败/中止记录。HTTP合成字节/FSA替身不能冒充真实ZIP/系统选择器/生产发布证据。

B51已接正式包共享导出与Web完整文件交付，并修复移动详情标题/待验证说明挤压。合同1P、host10P、features11P，PC/移动专项28P；check36/36（27缓存），数据库条件完整E2E335P/7S、0失败/不稳定。源码1492摘要11c92e956b1de9ccbe20501d1b8420033f88d4f22378f4cf1f5fd28cf21fc000，扫描1399文件/1归档0命中/错误。真实/替身、首败和中止见测试手册§5.44及tests/v25/.results/b51/validation-summary.json。只关闭本批，F5-R/F5-X/D4/F3/F4/原E、整包及管理员前置继续。

- [x] 批次 B52：服务器导入记录与共享刷新恢复
  - boundary: 复用既有PG stage/import，以当前账号只读分页/回执发现原请求；共享恢复、原文件精确重选、关闭保留与明确取消。完成回执与上传TTL区分，不重建删除草稿；无新DDL，不改Desktop原生流程。导出恢复、三方向真包、Agent/原E和整包不随本片关闭。
  - verify: 严格合同/client、真实PG/HTTP/S3并发/撤权/精确分页/回执负例，实际ZIP生产浏览器reload/双页面与HTTP夹具分别记录；完整check、数据库条件E2E、源码扫描、截图复核及首败修复。身份fixture不是Better Auth活体，默认门控与外部skip不算通过。

B52证据：check36/36（16缓存），完整数据库条件E2E345P / 7S，0F/0 flaky，包PG83P，源码1502项摘要f0b3dc3fbcfd1eda916fa7bb1bfd2dfcf7510b2f020d9fd6e1e7366a2938c93d，扫描1409文件/1归档零命中/错误。结果、命令/起止/失败/替身/skip见tests/v25/.results/b52/validation-summary.json和测试手册§5.46。下一步F5-R.E导出恢复→F5-X/D4/F3/F4及原E；父卡和管理员前置继续开放。

- [x] 批次 B53：原导出归档发现与共享刷新恢复
  - boundary: 复用PG exports与原资格/内容服务，strict合同/client/可选gateway和共享历史入口，原归档核对后明确下载；关闭/交付保留，明确取消单独确认。查询不续租或IO，不新增DDL、不改原生Desktop保存；真实身份/三方向/Agent与原E不随本片关闭。
  - verify: 正常/受限/过期/新会话、owner、版本/删除/TTL、PG精度分页、在途与零额外读写；PC/移动丢begin/reload/两页/明确保存、实际ZIP解析与hash、独立扫描；完整check与数据库条件E2E。保留首次失败、fixture trial/身份和旧日志缺失记录，不把本机通过冒充整包通过。

B53阶段证据：check36/36（31缓存）、完整E2E355P / 7S，0F/0 flaky、包PG94项；源码1509摘要525b0f9a5e057dee1eb63ebc4d8d3c1138b58e8446a1f5ef8565fe05dc5895c4，源码及对应实际ZIP扫描零命中/错误。证据tests/v25/.results/b53/validation-summary.json和测试手册§5.47。继续F5-X/D4/F3/F4/原E；整包与管理员前置未闭合。

- [x] 批次 B54：真实登录与三方向 v2 方案包交换证据
  - boundary: 使用正式Better Auth/account hooks/Hono装配，实际Desktop与Web产品入口交换v2文件；比较不同图片、完整正文/来源/编译内容与新草稿身份。仅改测试设施及既有测试helper抽取，New API/S3和成功trial资格明确为夹具。v1/负语料全集、自然TTL/最大包、真实系统picker、Web图片显示、Agent/worker联合及原E不随本切片关闭。
  - verify: 实际PG身份/Origin/登出/新会话权限与原API回归；PC/移动Web和Electron三方向文件读回/共享codec/hash及SQLite受管图片；完整check和数据库条件E2E，最终不同图片语料专项、每次生成的新ZIP独立扫描。区分全量与最终语料的源码摘要，保留首败/skip/替身，父级验收继续开放。

B54证据：完整回归358P / 7S，0F/0 flaky（1518项原语料源码），最终不同图片语料身份33P与三方向3P、完整check及源码/两组实际ZIP扫描通过。最终1519项摘要5aae120bee8ec4b03fc42f5dd4367fe8475674673f67c7f9aa8e562b74b07d7e；两组源码和首次失败见tests/v25/.results/b54/validation-summary.json与测试手册§5.48。只关闭本批测试设施/证据切片，Web图片、F5-X剩余、D4/F3/F4/原E与整包及管理员前置继续。

- [x] 批次 B55：Web方案图片接线与共享加载恢复
  - boundary: 薄Web宿主注入现有同源owner隔离图片接口；共享方案列表/Inspector/详情/相册/灯箱复用FadeImage并补加载/失败/明确重试，换图不继承旧状态；不新增资产实体或生成/费用/归档状态机。原生Desktop仍沿既有地址接缝，Agent及其余F5-X/原E继续。
  - verify: host地址与挂载、features换源/错误/重试/无嵌套按钮；真实BetterAuth/Hono/PG不同图片像素/尺寸/hash、列表/相册/灯箱及焦点、跨owner/登出/删除拒绝；完整check、数据库条件完整E2E与实际截图，保留首次失败与替身边界。

B55：完整check36/36（27缓存），数据库条件完整E2E 360P / 7S，0F/0 flaky，共367项；最终源码1524项摘要c291a6c8dc63ba62621d317770a60e6e40dd8f16781906f0d5af009e462dc6c7，相对B54新增5/修改6/删除0。源码1431文件/1归档及两轮各8份和中止轮6份实际ZIP扫描零命中/错误。首次焦点失败与修复、真实/替身/skip边界见测试手册§5.49和tests/v25/.results/b55/validation-summary.json。只关闭图片切片，父卡及整包保持开放。

- [x] 批次 B56：异步Agent共享接缝与本人原执行发现
  - boundary: 复用已有七个异步client/API入口，新增canonical可选Agent gateway、严格身份/入参/事件校验；本人历史为独立只读投影，新增稳定创建时间和索引，权限检查复用通用正常账号锁。保留旧同步Desktop接缝和原执行/费用状态机；共享恢复UI、创建/修改/更新和完整D4/F3/F4继续。
  - verify: 合同/client/gateway正负例；真实PG迁移/回填/微秒分页/并发更新、权限撤销/跨owner、原任务丢回包与查询零新增模型/队列/对象写入；按影响执行完整check、API/worker及必要回归。只关闭此基础切片，不把历史GET当作授权或已完成结果。

B56：合同19P、客户端51P、Agent真实PG20P；完整API集成482P、worker集成92P；完整check36/36（17缓存）。源码1532项摘要`6f6d0793a6cb8e113fb7ddd3ecbacd8b370ad436631dd130f9e587ac4f8b350d`，相对B55新增8/修改14/删除0，源码扫描1439文件/1归档零命中/错误。首败与范围见测试手册§5.50及tests/v25/.results/b56/validation-summary.json。仅关闭异步接缝/执行发现基础，共享恢复UI与D4-C/D/E、F3/F4、F5-X剩余及原E保持开放。

- [x] 批次 B57：共享云端方案创建授权与原任务恢复页面
  - boundary: 消费B56可选agent接缝，共享明确文本授权、进行中/来源确认/终态反馈和本人任务恢复；工作台只有completed才报草稿成功，关闭不取消，未知响应核对原execution。新增方案中心任务入口；Desktop旧同步接缝保持。修改/上游更新完整入口、F3/F4联合和原E继续。
  - verify: mapper/controller/账号变化/事件乱序/重试负例，PC/移动真实页面创建授权、关闭/reload/双页面恢复与确认；正式API/PG联合、完整check与数据库条件E2E，实际截图/扫描，保留首败及受控上游边界。未执行的产品或生产条件不登记通过。

B57 阶段回填：B57：新增mapper/controller18项、连既有方案组件专项52P；新增PC/移动协议流程4P；完整check36/36，数据库条件完整E2E 364P / 7S，0F/0 flaky。源码1540项摘要`648602ad13b33b8f2aea55d00517ff0a564d00b1d73c5b7e4e7bfa1d3b297465`，相对B56新增8/修改7/删除0；源码扫描1447文件/1归档及本轮10份真实方案ZIP独立扫描均零命中/错误。实际命令、首败和限制见测试手册§5.51及tests/v25/.results/b57/validation-summary.json。B57的实际API/PG产品联合未完成，任务保持进行中；父卡、整包和管理员前置不关闭。 下一步B57-T2实际创建产品合流；本行保持未勾，未缩减原verify。

- [x] 批次 B58：实际 Agent 创建与共享页面合流验收（接续 B57-T2）
  - boundary: 复用生产 Hono/Better Auth/账号凭据委托、Agent 服务与 Graphile 队列，扩展已有隔离 PG/对象存储测试设施接真实文本 HTTP 和固定 GitHub 来源读取；仅外部上游受控，页面不伪造产品返回。覆盖纯描述、来源、历史素材、丢受理响应/双页恢复/原请求重放、取消及跨 owner/撤权，不替代后续修改/更新/真实生图试跑或原 E。
  - verify: 新增实际装配负例与 PC/移动真实服务流程；核对原执行/授权上限/持久调用/唯一草稿和资产 hash，保存首次失败及修复；完整 check 与数据库条件 E2E，源码和本轮产物扫描。适用范围通过后才关闭本行及 B57 的相应验收，不将受控上游说成外部付费/生产验收。

B58最终验收回填：B58真实服务PC/移动专项14P、关联API集成71P；完整check36/36，数据库条件完整E2E 378P / 7S，0F/0 flaky（1208.238秒）。最终源码1545项摘要`4ad6c44b0517c78df78854e500f13c0d5ee3429e1414510389505e145a758e52`，相对B57新增5/修改3/删除0；源码扫描1452文件/1既有归档、本轮10份实际方案ZIP独立扫描均零命中/错误。 B57原verify中的真实API/PG创建合流由本批补齐，B57与B58均只关闭对应创建/恢复切片；上段B57未完成描述保留为历史记录。文本模型、GitHub、S3和上游账号为受控服务；历史图为预置材料，不代表新方案已经试跑。Agent消费者在测试进程内运行，不替代正式进程重启或实际收费上游、全平台包及生产验收。 命令与首败见测试手册§5.52及tests/v25/.results/b58/validation-summary.json；下一步D4-D→D4-E→D4-J，F5-X、原E和整个迁移/管理员前置保持开放。

- [x] 批次 B59：共享云端方案修改与冻结版本授权（D4-D1/D2）
  - boundary: 同次详情读取冻结revision/version；复用创建/恢复控制器支持modify，单独最多1次Reviser文本授权，completed才反馈待验证版本。原正式版与Desktop旧接缝保留；上游更新D4-E与真实出图D4-J继续，不缩减父卡。
  - verify: T1冻结选择/严格合同/重放/关闭/换号/版本冲突；T2实际PG及T3 PC/移动真实服务修改，核对单调用/原正式版与working draft；完整check、数据库条件E2E、截图复核及扫描，保留首败和替身边界。

B59最终验收回填：B59组件专项83P、实际API三文件28P、PC/移动真实服务专项12P；完整check36/36（31缓存），最终数据库条件完整E2E **390P / 7S，0F/0 flaky**（1296.018秒）。最终源码1546项摘要`6f9aa0a1cc8821f29f92c5392ab6ae698b8b719b3f2c1f5df8f66f6dbc8f164f`，相对B58新增1/修改16/删除0；源码1453文件/1既有归档，以及本轮22份实际ZIP扫描均零命中/错误。 本轮归档共24份，其中12份为修改用例的合成既有方案输入ZIP，另外10份是既有跨宿主导出/交换ZIP，其余2份为HTTP交付字节夹具；不能称为22份新版本正式导出。旧正式基底通过fixture历史trial及实际封面/正式化HTTP准备，新Agent版本未用SQL补试跑资格。实际收费上游、正式Agent进程重启、真实新版本出图全链、全部GC/迁移/文件环境/各平台包/生产与回滚仍待。 命令/首败/证据见测试手册§5.53及tests/v25/.results/b59/validation-summary.json；下一步D4-E→D4-J，父卡及管理员前置继续。

- [x] 批次 B60：共享上游更新检查与独立编译授权（D4-E）
  - boundary: 详情冻结同次读取的revision/version，复用原Agent控制器/历史恢复接免费check-update、逐变化来源采用、独立expectedSessionVersion文本授权；原正式版与Desktop旧路径保持。无新任务表/消费服务；真实图像试跑D4-J与原E继续。
  - verify: T1免费/授权/重放/冲突/关闭/换号负例，T2实际PG/Graphile来源更新与模型调用账本，T3 PC/移动真实服务免费状态、逐源确认、授权丢回包/双页恢复/版本竞争/取消/unknown；完整check与数据库条件E2E、截图及扫描，保留首次失败及替身边界。

B60最终验收回填：B60初期组件专项91P（最终check含恢复回归后features716P）、实际API三文件45P、PC/移动真实服务专项18P；完整check36/36，最终数据库条件完整E2E **408P / 7S，0F/0 flaky**（1625.283秒）。最终源码1547项摘要`33ae75cbe64bd849c7d7e378086afc23914f71dcbef95d42d91efa202b4e063b`，相对B59新增1/修改8/删除0；源码1454文件/1既有归档及本轮22份实际ZIP扫描均零命中/错误。 B60新用例的基底由真实Agent创建，未用SQL制造试跑/正式资格；账号上游、GitHub、文本模型与S3为本机受控服务。全量归档24份：12份B59修改用例的合成既有基底输入ZIP、10份既有跨宿主导出/交换ZIP、2份HTTP交付字节夹具；它们不证明新方案已经通过生图试跑并正式导出。真实收费上游、完整新版本出图链、全部生命周期/各平台包及生产回滚继续待验。 详见测试手册§5.54及tests/v25/.results/b60/validation-summary.json。只关闭D4-E共享更新，D4-J、F5-X、原E与全部父卡及管理员前置继续。

- [x] 批次 B61：真实生图试跑、版本升级与方案包联合（D4-J）
  - boundary: 复用实际账号/Agent/PG/S3和现有prepareRun/run，接真实generation worker入口与受控图像HTTP；三形态新草稿取得真实试跑资格、封面及正式化，修改/上游更新新版本独立试跑后promote，再用实际包交付复核。禁止用SQL补新方案试跑/正式资格；不新建业务执行服务。完整跨宿主与J5故障矩阵必须逐项记录，剩余F5-X/原E/发布和全部父卡不缩减。
  - verify: 实际bin进程启动/干净退出、独立文本/图像调用、素材/输出字节hash、原revision与双账本；真实API集成和PC/移动正向/版本竞争/取消/撤权/丢回包/unknown/重启恢复负例；相同新结果封面/正式化、修改与更新后新trial/promote、实际归档重读/导入。完整check、数据库条件E2E和本轮源码/实际归档扫描，保留首败/skip及受控上游限制。只按实际覆盖登记完成。

B61阶段回填：新增生命周期回归1P、历史导出/篡改回归3P、实际API联合与导出42P；最终正向浏览器6P/0S/0F/0 flaky（120.974秒），完整check36/36（24.623秒）。源码1554项摘要`d0b30e3906f758d9019c39444fc528da306333dc83d5b444b0c5c81d97b87bcc`，相对B60新增7/修改8/删除0；源码及截至专项的16份实际ZIP扫描零命中/错误。故障增量源码1556项`600e79e2a45394e468c056bdc1455ed66224d3f12204893b8d5f7623cc655b8d`，只新增2个测试文件；API3P（13.444秒）、浏览器8P（78.449秒）、最终check36/36（6.683秒）。全量实际28ZIP及2份纯文本UI下载替身正确分类扫描零命中/错误；最新源码复扫零命中/错误。 历史正向全量414P/7S对应1554项快照，之后故障专项对应1556项；最新跨宿主修复与测试对应1559项，结果与适用回归见测试手册§5.55最新增量。J4-b三形态内容往返正向已验，系统picker取消仍由F5-X.H补验；J5详情读取故障、撤权/版本竞争、实际异常进程与资产清理组合，F5-X其余及原E/平台包/生产回滚仍待。B61、迁移整包和管理员前置保持开放。 详见测试手册§5.55及tests/v25/.results/b61/validation-summary.json；原boundary/verify与B61未勾状态保持。

<!-- B61:J4 START -->
B61跨宿主增量：纯描述、GitHub、历史素材三类真实新Agent结果均通过 Web→Desktop→Mobile Web（3P，83.409秒）；桌面以实际BYOK试跑获得本版资格，选新封面正式化，经新PID重启再导出，由另一Web账号导入为无资格新草稿。修复桌面导出按扩展名覆盖已接纳文本MIME的问题，完整分享单测21P、check36/36；本轮留存13份真实ZIP（最终专项6份）及源码扫描零命中/错误。 同源码完整Electron及受影响网页回归：160P/2S/0F/0 flaky（1004.633秒）；这不是全部Web用例重跑。 J4-b三形态内容往返正向已验，系统picker取消仍由F5-X.H补验；J5详情读取故障、撤权/版本竞争、实际异常进程与资产清理组合，F5-X其余及原E/平台包/生产回滚仍待。B61、迁移整包和管理员前置保持开放。 详细源码和首次失败见测试手册§5.55；不改变原boundary/verify或勾选父任务。
<!-- B61:J4 END -->

<!-- B61:AUTHORITY-READ START -->
B61新增正式回归：授权失效/真实登出发送前后及版本冲突API6P（25.606秒）；PC/移动故障专项12P/0S/0F/0 flaky（127.780秒），含原取消/unknown/丢回包8项与新增事件/任务读取失败、详情错误态及显式重试4项。check36/36（33.404秒，30缓存），源码扫描零命中/错误。 当前仅测试及fixture变化，1561项源码摘要0cde8ba7…；J5实际浏览器撤权/跨owner/版本与promote组合、材料型交叉故障、实际bin异常重启/自然租约/stale epoch及对象/数据库清理仍待。F5-X、原E、平台/生产与管理员前置不随本片关闭。 详见测试手册§5.55及tests/v25/.results/b61/validation-summary.json；B61仍未勾，原boundary/verify保持。
<!-- B61:AUTHORITY-READ END -->

<!-- B61:PROCESS-NATURAL START -->
B61新增实际进程3项已验：领取前强杀后新PID一次成功；发送后强杀/暂停经生产10分钟租约自然到期与分钟巡检收敛unknown，图像请求仍各1次；旧暂停进程恢复后终态/回执不变、无新增资产。API完整集成496P、Worker完整集成92P，网页故障专项12P；最终check及源码扫描通过。 自然领取后未发送的epoch替换、取消交错、迟到上传/新引用保护、J5-e与F5-X/原E、平台包/生产回滚仍待；管理员前置保持开放。 B61仍未勾；完整证据见测试手册§5.55和tests/v25/.results/b61/validation-summary.json。
<!-- B61:PROCESS-NATURAL END -->

<!-- B61:ASSETS-EPOCH START -->
B61新增7项资产/进程联合已验：参考图篡改或删除时零图像发送；实际10分钟租约后未发送任务由新PID以epoch2成功，取消交错与迟到PUT隔离；写入后删除失败保留对象并跨新PID等待实际5分钟退避再清理。完整API503P、Worker92P，网页正向与故障18P；check36/36及源码、6份实际新方案ZIP扫描通过。 PG输出落库/丢提交回包、cleanup与新引用竞争、J5其余/F5-X/原E及全平台/生产回滚仍待；本片未证明S3连接断开，完整迁移与管理员前置保持开放。 B61仍未勾；证据见测试手册§5.55和统一报告assetEpochSlice。
<!-- B61:ASSETS-EPOCH END -->

<!-- B61:ASSETS-WIRE START -->
B61补齐2项真实S3回包断线测试：写成后首次断线由SDK同key重传成功；持续断线后原任务保留unknown费用，新PID维护删除孤立对象。两例各1次图像调用，成功资产跨重启/维护保留，失败不产生trial。最终完整API505P、Worker92P，check36/36及源码扫描通过。 继续PG输出落库冲突/提交回包丢失、cleanup与新引用争用、其余J5/F5-X/原E及全平台/生产回滚；B61和整包未关闭，管理员尚未开始。 详见测试手册§5.55及统一报告assetWireSlice；B61保持未勾。
<!-- B61:ASSETS-WIRE END -->

<!-- B61:ASSETS-DATABASE START -->
B61新增2项实际数据库故障已验：输出登记错误使generation/方案资产、trial和完成事件整体回滚；PG已提交而回包断线时，独立连接证实成功，新PID清理保留受引用图片。两例各1次图像调用、原版本/费用回执不被重启改写。完整API507P、Worker92P、网页18P，check36/36及源码/6份新方案ZIP扫描通过。 接续GC1真实新引用与清理竞争、其余J5数据库/权限/版本组合及F5-X/原E、全平台与生产回滚；B61和整包未关闭，管理员尚未开始。 DB1/DB2本机场景见测试手册§5.55及统一报告assetDatabaseSlice；B61保持未勾。
<!-- B61:ASSETS-DATABASE END -->

<!-- B61:CLEANUP START -->
B61新增真实新Agent引用/清理两种次序2项及Worker批次回收1项已验。修复已采用的过期参考图每次维护反复入队10轮的问题：候选排除方案引用，加锁后再次复查；保留最终对象保护。完整API509P、Worker93P、网页18P，check36/36及源码/6份新方案ZIP扫描通过。 继续J5浏览器撤权/跨owner/版本promote与素材交叉故障、在途预检后引用变化等剩余并发；F5-X自然TTL/格式/容量/系统文件交付、原E、全平台和生产回滚仍待。B61、迁移整包及管理员前置保持开放。 本机GC1证据见测试手册§5.55/统一报告cleanupSlice；B61保持未勾。
<!-- B61:CLEANUP END -->

<!-- B61:INFLIGHT-ISOLATION START -->
B61新增在途参考图读取与物理清理交错1项已验：旧GET返回有效字节，事务内重验仍404，零图像调用/新任务/回执/trial。双页面实际登出及独立账号隔离在PC/移动4场景通过，重新登录只恢复原结果。API定向9P，统一check36/36及源码扫描通过；本轮仅测试变化。 接续J5-c真实provider撤key、working-draft promote版本竞争与素材型交叉故障，再完成F5-X/原E/全平台/生产回滚。B61、整包及管理员前置仍开放。 当前1568项8fdc36f1…；API9P在9109d9e9…执行，其API测试/生产源码与当前逐文件一致，后续仅给网页测试追加独立账号检查。最近完整API509P/Worker93P/网页18P及6ZIP扫描属于上轮69d5898e…，本轮未重跑完整后端或全部E2E，不写成全量510P。 证据见测试手册§5.55/统一报告inflightIsolationSlice。
<!-- B61:INFLIGHT-ISOLATION END -->

<!-- B61:PROMOTE-CONFLICT START -->
B61新增双页面封面竞争后的working-draft转正验证：修改、上游更新各在PC/移动触发真实409，保留旧正式版、新试跑及资产；刷新后明确选回新版本封面并转正，零新增生图。专项2P，包含原三形态创建在内的该文件完整回归8P/0F/0S/0flaky；check与源码、10份当轮实际方案ZIP扫描通过。 继续J5-c上游凭据撤销、素材与其他故障组合及J5-f；F5-X、原E、四端/平台发布与生产回滚仍待。这里只关闭封面变化导致的promote CAS场景，不据此关闭所有并发交错或B61；管理员前置保持开放。 当前1569项源码13a5b41e…，仅3个浏览器测试文件变化；没有修改生产服务、UI、数据库或共享后端fixture。历史完整API509P/Worker93P属69d5898e清理批次，前轮API9P/登出4P属其已记快照；本轮未重跑完整后端或全部E2E。 证据见测试手册§5.55和统一报告promoteConflictSlice，原boundary/verify及未勾状态保持。
<!-- B61:PROMOTE-CONFLICT END -->

<!-- B61:PROVIDER-RECOVERY START -->
B61上游凭据撤销已接真实HTTP鉴权边界：纯文本/参考图、发送前/后共API4场景与PC/移动8场景通过；连同隔离单测和原授权/生图回归API12P。已接收调用可完成，后续撤销凭据请求401且费用未知；重新启用相同测试key只恢复读取，新试跑必须明确prepare/提交。 浏览器实测发现旧会话数据迟到会覆盖新方案正文并清掉已上传参考图；新增延迟会话查询测试先复现，再修复共享WorkbenchScreen：方案意图优先消费当前输入，后续主动切会话仍正常清空/加载。两种pending prompt条件与原回归共31P，check36/36、源码扫描通过。 完整E2E首轮112P/1F后中止（337项跳过或未执行）；焦点修正后的专项6P/2F进一步定位toast遮挡。补齐正常指针等待后，三形态试跑/版本竞争/导出重导入专项8P/0F/0S/0flaky。完整Web/移动/Electron复验尚未完成，不记整包通过。 继续J5-a/b素材与取消/unknown/丢回包/读取恢复组合及J5-f最终收口，再接F5-X、原E、四端/平台发布和生产回滚。上游采用本地受控HTTP，不是付费供应商实网；恢复是重新启用同一合成key，不声称验证key轮换或管理员代授权。B61、完整迁移与管理员前置仍开放。 当前1573项源码7b1778db…；API12P运行于fea659ab…，API代码逐文件与当前相同，后续只有工作台/就地单测/浏览器测试变化。凭据浏览器8P与就地31P属于493f8933…，当前另改试跑测试等待焦点与导出测试移开鼠标等待成功提示消失；历史完整API509P/Worker93P保留69d5898e归属，不改写成当前全量结果。 原boundary/verify及未勾状态保持；证据见测试手册§5.55/providerRecoverySlice。
<!-- B61:PROVIDER-RECOVERY END -->

<!-- B61:MATERIAL-FAULTS START -->
2026-09-12：B61已扩展纯文本/参考图输入×取消前后、unknown、受理回包丢失、事件/任务读取中断共六类故障的双视口测试；参考图经真实上传，核对正式run的冻结引用ID、实际图像端点和字节SHA256。 素材故障24项与修改/更新30项联合专项54P/0F/0S/0flaky（642.820秒）。 同源码API完整集成514P/0F/0S（673.167秒）；同源码Worker完整集成93P/0F/0S（53.911秒） 同源码完整E2E 455P/7S/0F/0flaky（2284.791秒），跳过项按实际项目/原因保留；当轮真实归档和明确UI替身分别扫描通过。 B61原boundary/verify的12项验收对照已通过，关闭D4-J联合试跑批次；接续F5-X旧格式/异常/容量/自然期限/原生交付、原E数据与同步、四端/平台发布及生产回滚。管理员仍在全部迁移闭合后开始。 当前1573项源码85917a2c…，本片仅修改三份浏览器测试；生产工作台修复仍为493f快照的实现。API12属于fea、凭据浏览器8/就地31属于493f、试跑交互8属于7b1778db，各自保持原证据范围；历史API509/Worker93不改写为当前全量结果。 不勾父卡或完整MVP验收。
<!-- B61:MATERIAL-FAULTS END -->

B61最终验收（2026-09-12）：原boundary/verify保持不变，12项对照通过。同源码1573项85917a2c…的check36/36、API514P、Worker93P、完整E2E455P/7S/0F/0flaky通过；最终新增36ZIP+2UI替身，七轮总92ZIP+4UI替身分类扫描零命中/错误。首败与7项条件skip完整保留；只关闭B61，剩余7项父/兼容任务及完整MVP保持开放，下一步F5-X.C。证据见tests/v25/.results/b61/b61-acceptance-review.json与测试手册§5.55。

- [x] 批次 B62：同语料跨端导入与旧包完整内容（F5-X.C）
  - boundary: 复用现有共享codec、legacy内容映射与Web/桌面产品导入；同一12份保存文件经两个reader、PC/移动Web实际BA/API/PG、Electron实际IPC/SQLite；合法v1/v2全正文/图片与新草稿身份、坏包零canonical写入及重启重读。修复实测桌面v1未重绑来源与未登记图片的问题，不另建导入器或授予试跑资格。F5-X.L/T/H、原E及全平台/生产继续。
  - verify: 永久reader回归、共享映射/桌面就地单测、实际API导入/导出/身份回归、完整跨端语料流程、桌面受影响E2E与适用check、源码与当轮合法归档扫描；逐项保留首败、相同文件hash、真实/替身和skip，坏包不冒充可交付安全ZIP。仅在原F5-X.C完整条件通过后关闭本卡。

B62最终记录（2026-09-13，运行UTC 2026-09-12）：12份永久reader语料与三形态36个实际导入场景通过；修复桌面v1来源/资产丢失。当前1579项源码5171ca41…的check36/36、受影响完整Electron及Web回归163P/2S/0F/0flaky通过；此前实际API80P的API/共享生产文件与当前一致，只有测试比较helper随后变化。四轮保存72个文件副本，30份有效ZIP扫描零命中/错误，42份故意无效输入另记拒绝；两项真实凭据skip保留。原F5-X.C四项验收见tests/v25/.results/b62/b62-acceptance-review.json，只关闭B62，父任务、F5-X.L/T/H、原E、全平台/生产及完整MVP保持开放。

- [x] 批次 B63：实际容量、宿主导入与失败清理（F5-X.L）
  - boundary: 按原合同分别覆盖manifest、条目数、64MiB条目、256MiB归档与展开总量、压缩比的真实边界；将已有实际字节准备纳入永久测试，两个reader、真实API、Web UI和Electron消费相同保存文件。合法输入完整保留内容和新草稿身份，超限在确认/落库前停止；补允许大包在写入中途失败/取消/断开后的清理及并发准入、内存/耗时和释放。复用既有codec、导入和受管存储，不缩小常量或扩大授权。
  - verify: 永久生成器与读取边界、真实HTTP/PG/S3和Web/Electron同文件导入、失败零canonical写入和实际清理、资源实测及适用check/宿主回归、源码及本轮实际合法归档扫描；保留首败和真实/替身范围。按原F5-X.L全部条件验收后关闭本卡；F5-X.T/H、原E、平台/生产及完整MVP继续保留。

  - B63 当前进展（2026-09-13）：永久容量六维×双边界的12项已验，包含三宿主36场景、实际256MiB包与24次独立reader；修复Next代理截断和原始大二进制上传崩溃。最大允许包64MiB来源写成后报错/取消/客户端断线3项，原两分钟租约自然到期、新PID生产worker物理清空残留已验；API既有导入34P，当前check36/36。关联宿主首轮7P/1超时/7未执行（页面分块加载失败，与Web构建重叠），固定构建后15P/0F/0S/0flaky复验通过，实际22份合法ZIP扫描通过，最终check36/36及源码扫描通过；默认证据目录已接CI产物路径。并发资源预算、桌面中途写失败及原L最终验收仍待，不勾选本卡；见测试手册§5.58。

  - B63 磁盘与资源增量（2026-09-13）：真实HFS+多文件部分写入后ENOSPC，残留清空/SQLite不变/新PID同文件显式恢复已验；实际最大包并发2项、自然故障3项与原API导入34项联合39P。正确数据库条件的原Electron包交换/语料2P；漏开条件的原2S保留。当前04059e51…修复磁盘不足提示，share26P、check36/36、源码扫描通过，完整Electron166P/2S/0F/0flaky及17份实际合法ZIP扫描通过。正式API/独立S3/客户端三进程两轮测量得到API峰值约2.97GiB；第二轮60秒自然空闲仍有1.5GiB ArrayBuffer计入，尚不关闭资源释放验收。继续大包复制/生命周期、桌面独立进程资源及原L最终验收；结果见测试手册§5.59–5.60。本卡保持未勾选。

  - B63 资源优化验收增量（2026-09-13）：桌面两次256MiB实际导入、60秒空闲和新PID读回已验，主进程峰值1496MiB、renderer约257MiB。API上传改为单份有界自有缓冲，导入hash去掉多余整包复制；当前b0698cad…的13项单元、check36/36、API39P、受影响三宿主14P及源码/12份合法ZIP扫描均通过。正式API四轮8草稿/56来源hash/零试跑，观测峰值约3.02→2.51GiB；共享异步解码快照和大小/hash约束保留。原04059完整Electron166P/2S与当前报告分开归属。接续不同包操作准入组合、下载回压的资源期限及原L验收；不新增立即GC保证，不关闭B63或父卡。详见测试手册§5.60–5.61。

  - B63 最终原验收通过（2026-09-13）：统一上传/确认/导入/导出资源名额、慢下载生命周期与HEAD释放；当前63102ada…的check36/36、API84P、宿主14P及源码/23合法ZIP扫描通过，无定向失败/skip/flaky。完整原boundary/verify七项证据逐条审核通过，见tests/v25/.results/b63/capacity-acceptance.json与测试手册§5.62。仅勾选B63；F5-X.T/H、原E、正式发布及管理员前置继续。历史阶段记录保留当时的未完成判定。


- [x] 批次 B64：方案包自然期限、回执与清理竞争（F5-X.T）
  - boundary: 复用既有一小时stage/export有效期、两分钟IO租约、持久导入回执和共享Worker清理。真实HTTP/auth/PG/S3创建数据，按原时钟自然经过期限；实际数据库锁延迟导入/下载至到期后，由新PID维护处理，保留成功与已删除方案的原回执和已采用资产。不得改expires_at/lease/Date或缩小TTL来冒充自然到期；不重开已验B63，不新增付费运行或扩大权限。
  - verify: 独立预检证明真实锁阻塞、释放后成功及原归档hash；长时实际期限用例证明到期不新写/下载、先清理后迟到请求拒绝、资产/来源hash保护、同回执无重复导入和已删除结果不复活；实际进程、原期限、对象删除与各阶段结果归档。适用check、源码与本轮实际ZIP扫描、原API/Worker回归；明确长时开关/CI时间限制，未跑场景和其他原F5-X.T条件不能据预检关闭。
  - B64 准备（2026-09-13）：新增两个测试文件，原生产源码未改。预检1P/1筛选跳过，当前c555b61d…的check36/36；实际一小时用例已启动，尚未到期或验收。初次时间断言误差2ms和测试Buffer类型错误均已修复并保留首败。具体进度与范围见测试手册§5.63。

  - B64 长时门禁增量（2026-09-13）：Main/Release独立85分钟job、实际两用例JSON验证和4份归档hash/扫描、失败报告上传已接。dd4d2436…的check36/36、门禁13P、真实1P/1S负对照被校验器拒绝、源码与新增2份实际ZIP扫描通过。自然一小时运行依旧为c555b61d…，6文件变化不涉及其依赖，尚未到期，不据此关闭T或远端CI。测试手册§5.63记录精确范围。

  - B64 自然租约竞争增量（2026-09-13）：新增独立原2分钟租约的旧epoch/新引用/清理先后两场景，真实SDK完成后测试屏障，实际新Worker PID，旧响应409与新对象自然清理期限后hash保护，2P/490.453秒。def62aeb…check36/36、源码及4份本轮实际输入ZIP扫描通过；既有API102P/Worker12P和4份归档扫描按dd4d生产源码不变承接。首次30秒SDK超时造成2F已修复并保留精确原文件与日志。原一小时测试仍运行，本卡未勾选。


- [x] 批次 B65：PG 中间版本升级、数据与事务回滚（D03.4）
  - boundary: 复用 packages/db/migrations 原SQL与生产 migrateDatabase；在独立Testcontainers PostgreSQL中依次构造每个journal前缀，再升级latest。覆盖持久数据、schema/journal/hash、幂等、原回填语义与事务失败后再升级。所有前缀和失败注入均在测试自有库，不读用户活动数据库、不改生产迁移SQL或缩减旧库/两设备父卡。
  - verify: 每个支持的中间前缀升级后数据与引用保持、结构等价fresh latest、journal顺序/hash对应原SQL，重复回放无变化；有效约束仍拒绝跨owner、非法version/document identity；实际迁移事务失败后schema/data/journal不半更新，移除故障后可重新升级。回填检查保留原时间/执行身份；适用check、源码扫描、真实PG矩阵结果留存。真实旧SQLite、双客户端同步及产物内联迁移仍按D03原范围单列，不据本卡关闭。

  - B65 最终验收（2026-09-13）：当前b88e2b03…的PG专项31P（23前缀、4回填、3故障恢复、1原fresh replay）、check36/36与源码扫描通过。无生产迁移SQL变化。逐条验收见tests/v25/.results/b65/acceptance.json；只关闭D03.4，不关闭真实旧库、两设备同步或产物/生产回滚。

B64 最终验收（2026-09-13）：原一小时有效期完整2P/0F/0S，3611.546秒，20:24:01UTC实际核验；已采用12对象hash、持久回执、旧请求拒绝和新Worker维护成立。原两分钟租约两种新引用竞争另2P，API102P/Worker12P及适用check/源码/18份不可变实际ZIP扫描按精确源码承接。B65独立测试不改B64运行依赖。tests/v25/.results/b64/lifetime-acceptance.json逐条核对通过，仅关闭F5-X.T；H、原E其余、全平台及生产/远程MCP继续。历史运行中记录保留原时点。

- [x] 批次 B66：两独立客户端真实同步与恢复（D03.5）
  - boundary: 两个独立Node进程、各自磁盘SQLite、生产core提示词repository/sync engine连接真实Better Auth/Hono/disposable PG。测试设施在core就地测试fixture与tests/repo，CI数据库job接入；若发现实际缺陷在原sync责任层修复。不替代D03.6 Electron跨账号、真实旧库或原生宿主验收。
  - verify: 离线outbox与三种冲突决议、提交后回包丢失和同库新PID重放、真实PG锁交错的mid-push设备撤销、生产retention后过期游标/bootstrap reset。验证设备/水位保留、重复请求无重复变更、本地未同步内容不丢、撤销后后续mutation被拒绝且另一设备继续可用；阶段真实结果、首败、适用check/扫描与CI必跑入口留证。全部原D03.5条件满足后才勾选。

  - B66阶段结果（2026-09-13）：原core修复完整Electron166P/2外部S/0F；实际ZIP17份扫描通过。空日志缺陷已经修复，新增空owner恢复和pull/trim实际PG锁交错用例后九项双设备通过，当前df6478b1…联合35P、check36/36与源码扫描通过。完整API556P/1专用小时S、worker93P/0S及本轮10份API归档扫描均已完成；acceptance.json逐条核验后仅关闭B66/D03.5，源版本和首败边界见测试手册§5.65。

  - B66空日志修复项：真实Hono/PG重现后，生产retention以最大已删seq提升水位，条件upsert保单调/无操作updatedAt；API bootstrap/pull/status保可用水位且pull一致快照。九项专项已包含空表与并发裁剪回归；原七项不足的证据被保留，未降低原D03.5验收。

- [x] 批次 B67：真实 Electron 跨账号同步与本机库隔离（D03.6）
  - boundary: 实际Electron/v25 preload/main/core连接生产API bin、Better Auth、独立PG与受控New API。复用现有身份进程设施，测试仅自有userData和合成旧库/方案库；真实UI完成复制/空库/同意与切号，必要竞态经真实IPC。若发现缺陷修原责任层并补就地测试。不替代真实脱敏旧库、原生文件交付或整个D03验收。
  - verify: A→B→A期间unset/paused无传输、新owner未明确建立workspace前不seed；复制只进入目标提示词库且不沿用源同意/outbox；A暂停队列不发给B，返回A保device/cursor/consent并可恢复；实际PG会话过期进入auth_blocked后原队列保留、重新登录恢复；已提交A回包延迟到B切换后不污染B；机器本地方案库内容/引用不随登录绑定或上传。真实Electron新PID验证持久性；check、适用实际API/同步单测、完整Electron与秘密扫描/证据归属通过，逐项记录首败/skip后才勾选。

  - B67最终验收（2026-09-13）：原D03.6三项真实场景、同源码check36/36、身份进程5P、同步单元50P、完整Electron169P/2外部S/0F/0flaky与本轮实际归档扫描通过；六份场景记录/PID/队列/回执及留存文件hash已核对。只关闭本卡，D03父级/原E/全迁移保持开放，详见测试手册§5.66与tests/v25/.results/b67/acceptance.json。


- [x] 批次 B68：旧 SQLite 数据等价与备份失败恢复（D03.2/3）
  - boundary: 复用 D03-A deterministic fixture、desktop-db takeover 和独立方案迁移，不读取活动 App 数据库，不改历史 SQL/接管职责。补保留字段逐列比对、方案独立库与重入、真实文件系统备份失败、备份后/事务中/最终校验故障和原库/副本重新升级。仅测试自有临时目录；如发现真实缺陷修原责任层。不把 synthetic 当真实历史副本，不由 SQLite 可打开声称旧 App 可启动。
  - verify: legacy20、非ASCII/长相对路径、FTS修复、三种consent、设备/游标/outbox/conflict/tombstone/历史资产/归档会话均保留合法语义；所有原有字段及引用精确比对，新增workspace时间单独按生成时间验证。失败后原schema/data/user_version/journal不半更新，已有VACUUM副本逻辑等价且可恢复再升级，移除故障后原库亦可升级；独立方案库不合并，重复迁移无变化。实际专项、check与适用门禁/扫描留证；D03.1真实语料与D03.7产物内联仍单列。

  - B68最终验收（2026-09-13）：同源码D03四文件31P及相关恢复/ZIP28P，check36/36、源码扫描和28阶段记录均通过；只改三份测试。备份前后/事务/校验故障保原库与副本可恢复，方案库原子步骤与重复迁移不变。只关闭本卡，真实旧库、产物内联及父级迁移继续；证据见测试手册§5.67与tests/v25/.results/b68/acceptance.json。


- [x] 批次 B69：原 E-W 状态矩阵与独立 Worker 联合验收（W01/W02）
  - boundary: 复用生产tasks/bin、原process-runtime/production-bin与自然租约实际证据；逐项映射原W01.1–6/W02.1–6，补未覆盖可达状态和防御分支，区分自然期限、隔离DB时间调整、真实PID与部署容器。不重写租约/队列/费用规则，不对缺少授权的旧任务自动重发。只操作自有PG、受控HTTP/S3和测试进程；真缺陷先留失败再修原责任层。
  - verify: queued年龄边界、有效/过期lease、running/cancelling、sent/claimed、旧新epoch、全部终态及重复投递矩阵有对应DB/回执/事件/HTTP/资产证据；旧heartbeat/claim/fail/cancel-finalize/success-finalize不能污染新owner。真实强杀/正常退出和新PID恢复、自然期限与实际部署启动条件按原范围核验，unknown不重发、取消不新建资产、清理不误删。就地完整worker integration、check、适用API/产物检查通过且源码与证据对应后再勾选，容器/平台未验不得缩小父验收。

  - B69最终验收（2026-09-13）：原W01.1–6/W02.1–6逐项核对，当前完整Worker99P/0S、check36/36、源码扫描通过；18进程+2正式Linux arm64容器记录、实际镜像身份和B66原自然期限证据均有源码归属。仅关闭运行可靠性，本机容器不替代远端CI/其他目标平台或实际生产，完整费用/GC及迁移父级继续。见测试手册§5.68与tests/v25/.results/b69/acceptance.json。


- [x] 批次 B70：提示词恢复与永久删除的并发一致性（原D01.2）
  - boundary: 从contracts、API PromptService、worker retention与既有PG测试核对提示词生命周期；用真实行锁证明恢复/单条purge/清空/定期purge的交错，先保留失败再修原事务选取及删除条件。保留30天常量、同步版本/墓碑和原费用账本，不擅自统一usage保留政策，不改UI或Folder/Tag的待验parity。只使用自有PG，完整D01/D02仍独立验收。
  - verify: 先提交的恢复不会被陈旧purge快照删除，保留正文/关联/usage；清空只删除本次锁定的回收站集合，计数及同步日志对应实际删除行，不生成已恢复行的假delete。purge先提交时恢复稳定拒绝且不制造upsert，重复清空0、跨owner不变。实际PG定向留首败、完整API/worker集成、check与源码扫描通过；相关生产镜像须按实际源码关联，不能沿用旧镜像声称当前验证。

  - B70最终验收（2026-09-13）：真实PG复现后修原API/worker事务，恢复先提交不被误删，purge先提交迟到restore404，清空仅锁定集合、准确条数/日志、跨owner保护。当前完整API562P/1专用小时S、Worker100P/0S、新正式镜像、check36/36及源码/20份实际ZIP扫描通过。首轮API两个默认5秒超时保留，原样专项22P及第二轮完整通过。仅关闭本片，D01/D02父级和完整迁移保持；见测试手册§5.69与tests/v25/.results/b70/acceptance.json。

- [x] 批次 B71：Desktop 提示词完整清空与事务失败恢复（原 D01.2）
  - boundary: 修正 v25 prompts.emptyTrash 误用 LIMIT 500 展示列表；复用 core purgeAllDeleted，核对其事务、FTS、链接与同步 outbox。只用自有 SQLite/userData，保留活跃行和其他 workspace；不把本片扩大为全部回收站分页、Folder/Tag、Session 或资产 GC 完成。
  - verify: 501 条已软删提示词一次清空准确返回 501、无尾部残留；活跃行及同 ID 的其他 workspace 数据/FTS/标签不变，远端已知行保留正确 delete outbox；重复清空 0。实际 SQLite 第二行删除失败时整个集合/FTS/关联/outbox 回滚，移除故障后可重试成功。真实 Electron IPC 501 条及新 PID 持久性、就地测试、check、先 build 后完整 Electron、源码和实际归档扫描通过后才关闭。
  - B71阶段结果（2026-09-13）：原 IPC 500/501 与部分提交两项真实失败已复现并修复；当前 SQLite/同步29P、check36/36、明确build、源码扫描通过。实际Electron501条/新PID及原提示词交互视觉联合14P/0S；完整Electron运行中，未勾选。来源与首次夹具/命令错误见测试手册§5.70。

  - B71最终验收（2026-09-13）：B71已完成Desktop提示词清空修复：501条一次清完、全部事务失败回滚、同步墓碑与其他workspace保护、真实Electron新PID持久性通过。当前check36/36、完整Electron170P/0F/2S/0flaky及源码/实际归档扫描通过。继续B72云端分页遗漏修复，再接Desktop查询与回收站筛选、完整数据清理/费用及正式交付；管理员未开始。 逐项证据tests/v25/.results/b71/acceptance.json；首次失败与跳过保留。


- [x] 批次 B72：API 提示词游标完整排序与数据库时间精度（原 D01.1/2）
  - boundary: 复用 PromptService 与原四种排序，修复置顶跨页遗漏、PG 微秒被 JS Date 截断及数据库标题规范化与游标不一致；游标校验在 SQL 前拒绝无效值，旧游标兼容或明确要求刷新，不猜测置顶状态。保留 owner/文件夹/标签/已删过滤与现有实体契约，不以改排序删除置顶优先来让测试通过。Desktop 查询、deletedOnly 贯通和共享回收站另接原 D01.1/2，完整父级不缩减。
  - verify: 真实 PG 混合置顶/非置顶、同毫秒不同微秒、同值 ID 排序与 Unicode 标题在四种 sort、多个页尺寸逐页遍历不漏不重；保留原排序结果，筛选和跨 owner 不泄露。游标锚点删除后仍可继续；无效日期/数字/字段/不同 sort/旧格式行为明确且无 INTERNAL_ERROR。保留修复前失败，修后定向与完整 API、check、源码/实际归档扫描通过并回填结果后关闭。

  - B72阶段结果（2026-09-13）：原新增验收31项12P/19F，修复后扩充新42项与原回归12项共54P；当前check36/36、源码扫描通过。完整API运行中，未勾选；原格式/兼容策略、TS审查草稿引发的首次lint失败及精确源码归属见测试手册§5.71。Desktop/deletedOnly和全部父级保持开放。

  - B72最终验收（2026-09-13）：B72已完成云端提示词置顶/微秒/Unicode分页修复与严格游标校验，当前完整API604P/1专用小时S、check36/36及源码/10份实际ZIP扫描通过。接B73桌面SQL分页、显式工作区回读与双宿主回收站查询；费用、完整生命周期和正式交付仍开放，管理员未开始。 原七项核对及证据hash在tests/v25/.results/b72/acceptance.json；原失败和skip保留。


- [x] 批次 B73：Desktop SQL 分页、工作区回读与双宿主回收站查询（原 D01.1/2）
  - boundary: contracts增加可选deletedOnly（true优先于includeDeleted），贯通API/客户端/桌面/共享提示词页面；Desktop将过滤及有界limit/offset放入现有core SQL，保留FTS5和既有排序，去除v25读取预先截断列表后再分页的路径。显式workspace写后读取沿用同一scope。纠正筛选空态、清空全部范围和列表失败重试；不改冻结域、Folder/Tag/Session删除政策或已有费用事实，原排序跨宿主完整parity及D01/D02父级继续独立核对。
  - verify: 合同布尔wire与双标志优先级、客户端透传及实际API/SQLite均覆盖。自有Desktop超过1000活跃/500搜索/500已删记录可分批读取到最后一条，无静态集合遗漏或重复、每页有界；搜索/文件夹/多标签/置顶同样过滤已删项，includeDeleted按统一查询排序，所有workspace隔离。显式非当前workspace create/update返回目标记录且活跃空间不变，FTS与同步不串空间。共享页面首个正常页全活跃而已删项在后时仍显示真实回收站；多页恢复/刷新、筛选清空及无匹配、错误重试保留已有内容、取消/确认清空全部范围分别验证。保留首败；就地/合同/客户端、真实API与SQLite、真实Electron及PC/移动产品路径、check、先build后完整E2E和源码/实际归档扫描全部通过后关闭，仅接受本范围。

B73阶段进展（2026-09-13）：当前1621项源码cb081ade…，Desktop分页与workspace回读/deletedOnly及共享页面已修，check36/36、明确build、真实API52P、三端专项3P/0F/0S/0flaky和源码扫描通过。完整E2E正在运行，原boundary/verify未全部满足，保持未勾选。实际失败、报告和余项见docs/v2.5/V25-MIGRATION-TESTING-CONTINUED.md §5.72。

B73最终验收（2026-09-13）：原七项边界已核对。当前cb081ade…的check36/36、API52P、明确build、完整E2E476P/0F/7S/0flaky、源码及45ZIP/2明确UI替身扫描通过，17故意坏输入另记。四项凭据条件及三项视口不适用skip保留；仅关闭B73，证据见tests/v25/.results/b73/acceptance.json。

- [x] 批次 B74：Desktop 分类事务、搜索索引与同步意图（原 D01.1/2 的本机实施及现有云端合流）
  - boundary: 将v25 Folder/Tag直写迁入现有core/workspace体系的共用事务仓库，薄IPC保留契约映射/错误信封/同步调度；Folder先detach直接关联再硬删，保留子孙及Prompt；Tag改名/删除维护FTS；分类CRUD接既有outbox，保留同意/暂停、原云版本、未发送create后delete压缩及既有Prompt删除意图。补同名、循环/非法parent稳定拒绝和真实双客户端/宿主合流；共享分类删除按UI-SPEC I3补AlertDialog确认/取消、失败后保留输入。涉及features后跑完整E2E。不改冻结面、费用、schema或目前云端soft-delete政策；原D01云端硬删除/持久墓碑/旧restore及Session、完整排序parity仍须后续完成，不能由本机验收代替。
  - verify: 正式core与IPC就地回归覆盖parent/child/grandchild、正常与已删Prompt、其他workspace同ID、标签其他词、事务中点与FTS后outbox失败全部回滚；unset无新outbox、paused持久但真实引擎零发送、enabled同步可达；原云版本墓碑、已有Prompt delete不改写、新建后删除无幽灵重放；重名/循环/跨空间parent/重复删除稳定且无部分写。真实API/PG加两个独立客户端实际创建/修改/删除分类，关联与FTS一致，新PID保留，UI确认/取消/失败/刷新可用。保留原实现失败与草稿证据，正式接入后check、明确build及完整Electron/受影响Web和源码/本轮实际归档扫描通过才关闭；不扩大为云硬删或D01完整通过。

B74阶段进展（2026-09-13）：core事务/FTS/outbox与薄IPC已正式接入，新增14项就地回归；当前88d31b65…本机专项56P/0F/0S、check36/36通过。共享分类删除确认框仍缺，继续实现；真实双客户端/宿主、新PID及完整适用门禁与扫描未完成，保持未勾选。

B74最新进展（2026-09-13）：共享确认/失败重试/防重复及焦点恢复已接；新增16项组件回归。实际双客户端复现分类删除先发引起三个关联Prompt自身版本冲突，现按云引用等待相关变更回执（含退避/失败、限制切片、跨账号相同ID及无关失败），新增5项依赖回归。最新3c395774…check36/36、明确build、真实Electron双客户端/新PID1P/0F/0S及源码扫描通过；未变共享组件的PC/移动各连续三次通过。完整三端E2E运行中，实际归档扫描与逐条原verify审核未完成，B74保持未勾选；详情及首败保留在docs/v2.5/V25-MIGRATION-TESTING-CONTINUED.md §5.73.1。

- [x] 批次 B75：云端分类永久删除、持久删除身份与离线消费者（原 D01.1/2）
  - boundary: 沿原PromptService/SyncService/contracts与PG迁移体系完成Folder/Tag主表硬删；以最小持久身份保护过期重放并参与兼容bootstrap，不无限保留完整分类内容。统一REST/sync版本、重复删除及旧restore裁决；引用建立与摘除/删除/change log共用事务协调。处理既有软删行和中间版本升级；Desktop core与共享冲突界面禁止复活已删分类，保留Prompt软删恢复及正常冲突。B74完整回归终态归档后接入，实施/验收分项见docs/v2.5/V25-DATA-LIFECYCLE.md §8.2。Session、完整retention/GC、费用、正式发布和管理员前置保持原范围。
  - verify: 新PG迁移fresh/prefix/旧软删回填/失败回滚；主表实体物理消失、长期删除身份不保留名称等内容；parent/child/grandchild、正常/已删Prompt和其他标签保留，跨owner隔离；陈旧版本/事务中点失败无部分写；引用先提交与删除先提交两种并发无悬挂引用并覆盖维护交互；90天日志/回执裁剪后分页bootstrap清理旧客户端分类，原/新mutationId不能复活，原回执/指纹语义保持；旧restore和Desktop采用本地不能绕过永久删除，采用云端及Prompt恢复正常；真实API/PG和双独立Electron客户端/新PID及PC/移动交互通过；当前migrate/check/build、相关真实API/worker集成、完整E2E、源码与本轮实际归档扫描和逐条审核通过才关闭。隔离诊断不替代正式就地回归和实际HTTP/宿主证据。

B75准备（2026-09-13）：同一冻结源码3c395774…的两个自有PG/SQLite诊断已复现朴素硬删造成离线残留/原创建重放复活，以及Prompt/子Folder在父级删除后提交悬挂引用。第一个诊断已用合法device UUID与当前sync合同重跑，保留首次输入局限；时钟推进、反例SQL和测试屏障范围明确。生产实现未修改，B75.1–6未验收，证据见tests/v25/.results/b75/diagnostic-evidence.json及测试续篇§5.74。

B74最终验收（2026-09-13）：原boundary/verify按11项核对通过。当前3c395774…check36/36、明确build、完整E2E479P/7S/0F/0flaky、源码与45实际ZIP/2明确UI替身扫描通过；17坏输入另列。两客户端新PID39848→39859、双边outbox/冲突为空，三形态确认截图已复核。只关闭B74，B75与父卡继续，证据见tests/v25/.results/b74/acceptance.json及测试续篇§5.73.2。

B75首轮实现（2026-09-13）：正式9项旧行为测试均红，接入最小删除身份/迁移0023与硬删除/引用锁/旧restore拒绝/bootstrap后，当前3bb13839…API27P/0F/0S、worker98P/2容器条件S、check36/36、根db:migrate首次/重复及源码扫描通过。旧软删回填、长期重放/分页/离线、Desktop冲突消费者、全部矩阵与完整宿主/产物尚待，保持未勾选。证据见tests/v25/.results/b75/implementation-checkpoint.json及测试续篇§5.74.1。


B75接续（2026-09-13）：Desktop core/IPC已拒绝永久删除分类的local恢复，共享界面禁用并解释正文保留；实际双客户端离线编辑、云删除、新PID及remote采用与原分类同步专项2P。旧软删分类分批回填/实际CLI已接，API/PG专项51P，包括历史前缀/回滚34、回填7、分类9、fresh replay1。不同源码与首败保留于测试续篇§5.74.2–3。继续90天裁剪/重放、多页bootstrap、完整owner/并发与实际宿主/全部门禁；原boundary/verify和未勾状态保持。

B75长期离线与事务矩阵（2026-09-13）：已补精确90天边界/91天维护时钟裁剪、HTTP原/新mutation防复活及205项混合分页；真实双客户端保留/过期日志与新PID4P。扩展事务41+HTTP3共44P，涵盖四中点回滚、owner隔离、引用写入及真实worker清理竞争，该轮check通过。当前三形态/完整后端联合门禁继续，B75原boundary/verify及未勾状态保持；源码与首败见测试续篇§5.74.4。

B75联合门禁（2026-09-13）：完整API661P/1独立一小时条件S、worker101P/0S。首轮全量E2E115P/1F后有意中止并留存373跳过/未执行；测试代理改为原浏览器请求转发，受控取消生命周期红→绿、双视口实际产品联合20P及源码/12ZIP扫描通过。完整E2E以05cd8f1f…重跑中，原boundary/verify与未勾状态保持；下一Session分页仅隔离诊断未实施。

B75最终验收（2026-09-13）：原boundary/verify六组均有逐项证据。05cd8f1f…当前check36/36、明确双宿主build、完整E2E488P/7S/0F/0flaky，源码与45实际ZIP/2明确UI替身扫描通过；17坏输入另列。API661P/1专用小时S、worker101P/0S保留02841618…归属，其全部相关输入与当前一致。7项E2E skip为4项真实外部凭据条件、3项视口专用且对应视口通过；本批六项实际分类宿主用例全部通过。只关闭B75，接Session S01–S05；完整生命周期/费用/正式发布及管理员前置保持。证据tests/v25/.results/b75/acceptance.json及测试续篇§5.74.6。

- [x] 批次 B76：会话查询、真实版本与原子写入、回收站和永久清理（原 D01.1/2 与会话 parity）
  - boundary: 按docs/v2.5/V25-DATA-LIFECYCLE.md §9的S01–S05接入完整会话生命周期。contracts统一deletedOnly/归档组合与严格游标；PG保留微秒和确定ID排序，Desktop会话专用keyset置于core，IPC薄接线。补SQLite真实版本/受管迁移和全部新旧写者CAS/事务；单条purge与清空只处理回收站，原子清草稿和摘除作品关联，保留作品/资产/请求/费用账本并协调迟到生成及ensure。共享设置/会话界面接查询、恢复、永久删除/清空和失败重试；不改冻结面或用会话清理自动重发生成。完整retention/GC、费用、真实旧库/平台发布与管理员继续原范围。
  - verify: S01真实PG/SQLite与HTTP/IPC覆盖微秒、同时间/Unicode、前页删除、新行、单/多页、无效/旧/变更筛选游标及查询组合；S02陈旧版本零变更、并发CAS、create/update故障全回滚、新旧写者及迁移字段等价/新PID持久；S03跨owner、已恢复行不被purge、生成引用/恢复与清理两种次序、迟到ensure不复活、重复和故障回滚、作品及费用不变；S04归档恢复位置、当前会话导航/草稿隔离、确认/取消/失败重试、键盘/窄屏/刷新和真实PC/mobile/Electron；S05当前migrate/check/build、实际API/worker和完整E2E、源码及本轮实际产物扫描，逐条记录源码/首败/skip和外部平台限制。任一准备切片通过不关闭整卡。


B76草稿冲突增量（2026-09-13）：后台refetch借新版本覆盖远端已复现并修复，新增固定核对/载入/失败停止续写；局部92P、实现check36/36，实际三宿主草稿3P。联合第二轮5P/1F，Electron回收站截图稳定等待超时；修正静态截图并补单owner真实同时IPC两种顺序与新PID验收中。完整首轮已主动SIGINT、125P/373跳过或未执行，原boundary/verify及未勾状态保持；精确证据见测试续篇§5.75.5。

B76本轮复验：07ff7e7c…三宿主草稿/回收站六项全部通过；追加同时IPC两种顺序在修正领域错误码测试预期后，a9f90e6f…两项及新PID全部通过。首次7P/1F及第二次1P/1F分别保留；原B76仍未验收，继续S03/S04原范围和S05完整后端/全E2E。

B76再次增量：重新载入后旧队列、迟到成功/失败回包问题已正式3项红测复现并修复；新增防抖前绑定编辑状态和实际工作台切换回归。完整后端697P/1S、worker101P/0S属于此前a9f90e6f…，新增PG清空集合竞争文件10P另记；当前check通过，9项实际宿主专项运行中，未关闭原B76或整包。详见测试续篇§5.75.6。

B76当前29dc9e82…真实宿主9P/0F/0S/0flaky，check36/36、根隔离PG迁移首次/重复和源码扫描通过；Electron作品/图片在清理和新PID后保留，一次回环图像调用，旧Session迟到生成不复活。完整三端session-full-e2e-second运行中；B76原boundary/verify及未勾状态保持。

B76原范围核对（2026-09-13）：S05新增迁移要求的安装包内升级尚缺，当前package smoke只有fresh/restart。已准备0010前/0011前两份真实SQLite合成夹具及包内升级/新PID防复活候选；夹具与语法通过不算产品通过。完整E2E26568仍实查运行，保留源码，终态归档后接候选及实际打包验收。详见测试续篇§5.75.7；原boundary/verify和未勾状态保持。

B76完整回归已终态（2026-09-13）：29dc9e82…497P/7S/0F/0flaky，45实际ZIP/2UI文本扫描通过，17坏输入另列；7项skip为4真实凭据条件和3对应视口已有通过。当前独立包测试c9b38d63…check36/36及源码扫描通过，实际macOS arm64打包运行中。原S05包内升级与最终验收保持，B76未勾；见测试续篇§5.75.8。

B76最终验收（2026-09-13）：原S01–S05共17项对照全部有证据。29dc9e82…完整E2E497P/7S/0F/0flaky，45实际ZIP/2UI文本扫描通过；当前仅独立包测试变化的c9b38d63…check36/36、实际macOS arm64构建/签名、严格包fresh与两前缀升级3P/0S、新PID及App/DMG/ZIP扫描通过。API697P/1专用小时S、worker101P/0S保留a9归属，新增PG10另记；全部相关生产输入一致。7项E2Eskip按外部凭据/对应视口保存。仅关闭B76，继续D01.3/4/6保留期和维护；全迁移、其余平台/真实旧库/生产与管理员前置继续。逐项证据tests/v25/.results/b76/acceptance.json。

- [x] 批次 B77：保留期、有界维护与 Automation/Skill 审计政策（原 D01.3/4/6）
  - boundary: 保留既有30/90天语义，沿worker retention/sync-retention/maintenance及现有审计、授权和引用体系处理积压。限定每类单次候选/锁/删除规模，补失败重跑、暂停/恢复和安全计数；分批sync须保持水位单调、bootstrap及客户端未同步编辑。盘点现存Automation/Skill数据的保留/删除授权与不可丢失费用/回执/来源引用，明确并执行有依据的政策；不机械按30天删审计，不增加Cloud MCP destructive工具或恢复冻结UI。完整GC对象发现/物理删除、费用其他父卡、真实旧库/平台/生产及管理员继续原范围。
  - verify: R01真实PG1001+行每类有限批次、再次继续/最终no-op及复合主键隔离；R02精确30/90天、未来时间/时区、恢复和并发维护、故障全回滚/锁等待边界；R03sync非时间顺序seq、并发裁剪/提交、水位不回退/无静默空洞、实际API410/bootstrap/客户端保留本地编辑；R04生产maintenance实际调用、暂停后零删除/恢复续跑、安全准确计数及新PID；R05Automation/Skill保留/授权/审计/有效引用逐表逐入口验证。当前check、实际API/worker与受影响宿主、必要迁移及源码/真实产物扫描通过，保留首次失败和准确源码归属；任何单片1000条测试通过不关闭B77或D01父卡。


B77阶段进展（2026-09-13）：每类1000条、事务锁等待2秒、失败回滚和双维护并发已接；正式Worker暂停/新PID恢复、限流分批、阶段安全计数与错误脱敏已接。当前2f27125f…相关41P/0F/0S、check36/36和源码扫描通过；完整API/Worker继续，正式镜像npm TLS两次失败留证。原R01–R05全范围和未勾状态保持，继续同步提交交错和Automation/Skill矩阵；见测试续篇§5.76。

B77-R03实际缺陷（同2f27125f…）：事务A先分配seq1后迟提交，B的seq2先提交；pull/bootstrap给出cursor2，A提交后pull2为空，真实PG/正式service已复现遗漏。原R03内修复提交顺序/快照/裁剪协调并补HTTP及客户端矩阵；不能以分批绿测关闭本卡。完整Worker112P/2容器S，23项真实进程已执行；API仍运行。见测试续篇§5.76.4。

B77最新进展（2026-09-13，§5.76.5–6）：R03迟提交修复已通过PG7项+原双客户端9项、真实HTTP3项；31e548d8…完整API699P/1S、Worker112P/2容器S、check36/36及源码/实际8ZIP扫描通过。R05另复现无效本地质询误删文件，正式红测6P/6F，可信签发路径与精确TTL修复后12P；完整本地入口矩阵与审计政策继续。原R01–R05、B77未勾选、85/93及剩余8大阶段不变。以上早期“API运行中/同步未修”只保留历史，不代表当前状态。

B77-R05增量：642d3e24…Automation/MCP99P，11个本地入口守卫全矩阵通过；768c5709…实际Electron本地管理5P、check36/36，完整Electron仍运行。端点审计原始路径输入另已复现，日志轮转/持久费用及原验收继续；不勾选B77，见测试续篇§5.76.7。

B77最新进展：完整Electron首轮109P/1F/72S（70项漏设数据库测试开关，2项真实凭据门控），报告保留；草稿通知遮挡点击按真实hover离开/等待/原点击补验。R05端点审计路径红测2P/10F后可信模板修复，Automation/MCP111P；当前三形态/实际磁盘审计运行中。日志轮转及原全范围仍待，B77未勾选。另登记原G-UI：Toaster错误手动关闭规范与当前组件配置存在差异，需原UI父范围处理，不以测试等待当作产品修复。见测试续篇§5.76.8。

B77-R05实际磁盘补验：三形态Session6项在bd90fa02…通过；磁盘测试目录改用LOGS_DIR_NAME后6d9bf7ca…Electron本地管理/NDJSON5P、check36/36及源码扫描通过。全部进程终态；完整Electron首轮失败和漏开数据库的70S仍待正确配置全量补跑，未关闭B77。下一接端点轮转、持久费用与Skill有效引用矩阵；见测试续篇§5.76.9。

B77-R05日志增量：已接端点NDJSON当前/上一份各2MiB、单条4096字节/队列200、完整尾行恢复、固定pending和故障/恢复告警；关闭HTTP后排空写入。真实文件14项包含stat/rename/append失败，联合146P；实际Electron新PID及原本地管理6P，日志由>3MiB收敛。当前最终门禁与RUN_DATABASE_TESTS=true完整Electron待续；SQLite费用/Skill及原R01–R05不缩减，不勾选B77。详见测试续篇§5.76.10。

B77-R05后续：a6f12749…完整Electron已181P/2真实凭据S/0F/0flaky，34份实际方案文件中17合法ZIP扫描通过；旧109P/1F/72S保留历史。新增真实进程3+SQLite费用清理17共20P；Skill授权摘要未过期检查/精确TTL红测4P3F后修复，e2d83acc…相关197P、check36/36（0缓存）、build/源码扫描通过，当前构建完整Electron运行中。原R01–R05全范围和85/93未勾状态保持；详见测试续篇§5.76.11–12。

B77进一步进展：全阶段暂停/新PID恢复和S3失败持久重试2项已通过；包/来源各1001条分批通过，子表锁超时红测2P2F后复用db共享2秒事务政策。8c2fb7f8…联合17P、worker本机118P/2正式容器S、check36/36及源码扫描通过，完整API运行中；e2d83acc…Skill完整Electron181P/2凭据S及17实际ZIP扫描已收取。原R01–R05、85/93与B77未勾状态保持，继续未来时间/时区、费用/引用故障与剩余矩阵；见测试续篇§5.76.13–14。


B77最新增量（2026-09-13，测试续篇§5.76.15–16）：时区/费用回执/来源锁回滚8P；上轮API已699P/1专用小时S及8ZIP扫描通过。来源子文件无总上限真实红测2F后增加共享1000文件预算，31P联合；146ba8f0…Worker全src217P/2正式容器S，测试类型修正后741cfa97…check36/36、新6P及源码扫描通过。新完整API已699P/1专用小时S，712.428秒退出0。另真实PG已复现generation资产与Prompt使用明细单父记录清理1001行；继续有界永久删除及restore/费用/引用协调，不以单片通过关闭原R01–R05、B77或D01。85/93、剩余8阶段和管理员前置不变。

B77本轮终态补记：当前API699P/1专用小时S，8份实际ZIP内容扫描0命中/0错误；所有工具已终态，源码零漂移。原R01生成/Prompt子行有界清理、R04正式镜像及R05原矩阵继续，未勾选B77。


B77关联行推进（2026-09-13，测试续篇§5.76.17–18）：5类子行超量红测5F后接共享持久分批purge/0024 expand迁移、API恢复与读取保护；真实HTTP4P，旧库迁移/DB保护9P，正式bin首批后SIGKILL/暂停/新PID合计29P，API回执/资产联合60P及新9P通过。当前8fca6f9d…check36/36、Worker全src227P/2容器S、源码扫描通过；完整API运行。保留原R01–R05/85/93/B77未勾状态，继续对象清理相关锁/引用及R05矩阵、当前正式镜像与最终门禁。

B77回归修复（2026-09-13，测试续篇§5.76.19–20）：原完整API701P/3F/1S终态，实际8ZIP扫描通过；补0024字段/最终trigger回滚探针，修retry源run锁与Session清理竞争，新两种retention/retry次序和原迁移/Session共47P。对象队列六条持锁路径红测6F后接两秒本事务超时与混合保护原子性，新六项通过。当前统一检查首轮测试类型错误及Worker联合20P/1时钟F均保留并修正，最终源码91d60327…继续完整门禁。原R01–R05、85/93与B77未勾状态不变。

B77本轮续记（2026-09-13，测试续篇§5.76.21–22）：完整API697P/9F/1S保留，三个失败文件单独84P且未改断言/超时。又真实复现同key重放在清理间隙返回1/1001资产，四项红测后以KEY SHARE保护结果读取，当前da8fea85…联合53P、check36/36及源码扫描通过；最新完整API单独运行60497。Worker233P/2正式容器S已终态；R05七表/11入口/缓存矩阵及证据限制已写生命周期§10.8，原R01–R05和未勾状态不变。

B77最新终态：da8fea85…完整API710P/1专用小时S、8实际ZIP扫描通过；新增真实Electron两条清理流程保留七张非空费用表与四张正式来源表，新PID重放G/R/S无重复外部调用。9f6ecc6d…联合10P/0F/0S/0flaky、check36/36和源码扫描通过；首两次Prompt夹具必填字段错误及格式首败完整保留。见测试续篇§5.76.23–24。B77仍未勾选、原R01–R05及8阶段不变，继续实际资产路径与可靠删除边界。

原D02增量（2026-09-13）：真实四负例复现Desktop外部原件/symlink/shared图片误删，已接共享local_asset_cleanup、0012内联迁移、原子入队与删除、文件身份/引用复查、100文件分批与启动退避重试。当前66项专项与354a2955…统一检查通过；新Electron首轮两夹具目录错误保留，正确受管目录重跑中。全部GC父卡和B77仍开放，详见测试续篇§5.76.25–26。

D02实际宿主补记：修正E2E受管目录后354a2955…4P/0F/0S/0flaky；权限故障产生持久失败，两个新PID启动续清，原件/共享图/七表费用保留通过。当前check36/36、源码扫描0命中/0错误，完整Electron25444于15:56:36 UTC运行，原B77/D02及8阶段保持开放。

B77正式镜像补验（2026-09-14）：当前354a2955…原Dockerfile构建164.078秒退出0，linux/arm64非root镜像f8fbb7a5…；原容器启动/新PID和已发送SIGKILL/unknown禁止重发2P/0F/0S。另真实PG/AWS SDK回环S3的1001过期参考图分批诊断通过，待固化长期回归。完整Electron25444仍运行，旧TLS条件已解除，原父范围继续。见测试续篇§5.76.27。

B77原范围最终验收（2026-09-14）：25条R01–R05对照及全部适用门禁已关联实际报告。当前e0c19cb5…check36/36、完整Worker236P/0F/0S（包含实际正式容器）、源码扫描通过；生产/Electron输入未变的354a2955…完整Electron185P/2外部凭据S/0F/0flaky及17份实际ZIP扫描通过，另17坏输入明确分列。当前同步实际PG7P和HTTP/双客户端12P；API710P/1专用小时S、PG0024实际CLI及升级、SQLite0012内联13项升级证据按各自输入归属保留。acceptance.json逐项核对并仅关闭B77，任务包86/93、剩余7大阶段；继续原G-DATA-02完整资产GC，费用、真实旧库/四端/发布部署和管理员前置不变。


原 G-DATA-02 继续推进（2026-09-14）：D02.2 发现最终清理查询遗漏未关联但仍在 TTL 内的 Composer/方案上传；真实 PG 首次 5P/2F，补保护后 7P。新增固定版本独立 MinIO 与 PG 的实际字节/期限、HTTP200-per-object Errors、12次abandoned及恢复后引用复查、真实停机重启、PUT已落盘但响应超时测试。原 D02.3 无DB意图对象 inventory、全类别/桌面 staging 和竞态仍开放，不新增重复父卡或改变86/93统计。修改边界：Worker清理查询及就地真实存储测试；verify：专项PG/MinIO、统一check、完整Worker与当前正式镜像容器测试及源码扫描；精确报告回填测试续篇。

D02 本轮终态：原包取消断言发现共享 registry TTL 不应延长 package 上传租约，修复后联合18P。最终4651236e…check36/36、正式最新Worker镜像3e4b68dd…及完整Worker242P/0F/0S、源码扫描零命中/错误；首次完整237P/1F/4S和未能保留堆栈的MinIO套件失败均原样留证，最终default+JSON完整运行已通过。本轮5个Worker文件，不改PG/API/Desktop生产输入，未重跑其完整门禁。保持原G-DATA-02未验收、86/93和7阶段，下一直接实现D02.3 inventory/游标/宽限/最终引用复查。证据：tests/v25/.results/d02/upload-storage-progress.json、测试续篇§5.77。


原D02.3发现推进（2026-09-14）：0025独立inventory游标/观察表、5已知前缀×100页上限、租约token/事务游标、scope与dry-run隔离、24小时观察/修改宽限及共享引用查询已接真实bin/Graphile每5分钟调度。真实MinIO/PG、原引用/包保护、CLI旧前缀升级及SIGKILL新PID恢复联合23P。修改边界：Worker/DB新增发现接缝、迁移与就地夹具；verify：实际db:migrate两次/逐字段保留、当前check、API与Worker完整集成、最新正式镜像/扫描。物理删除执行器及最终覆盖/发布竞争保护仍未实现，不把记录候选替代完整D02.3；原D02.1–7和7阶段、86/93保持开放。

D02.3当前输入95394369…：当前check36/36（旧本机1001文件超时后不改源码的隔离9P/完整check复核通过）、正式新镜像5acc0643…、完整Worker251P/0F/0S及源码扫描通过。完整API在同一输入运行中，不能宣称已通过；条件删除探针确认当前MinIO忽略错误ETag和mtime，候选执行器尚未实现，保留完整GC出口。详见测试续篇§5.78和inventory-progress.json。


D02.3回归修复（2026-09-14）：完整API首轮706P/5F/1S，八实际ZIP扫描通过。修S3测试服务缺失目录协议和0025最后索引故障注入，新协议先1F再与升级专项37P；当前f47c9466…check36/36与源码扫描通过，完整API复跑98620正在运行。原自然期限/队列断言不改。独立PG/MinIO确认最终引用检查后SQL发布可留下悬空资产；一次性DB屏障原型三种实际锁次序通过，但未安装生产，不据此关闭GC。继续全writer/租约屏障与候选安全删除，86/93和七阶段不变；证据见测试续篇§5.78.1。


D02.3继续修复：API第二轮707P/4F/1S；迁移回滚通过，四条自然租约仍因inventorycron任务失败无法清空。实查Graphile自动附加_cron，生产严格schema拒绝；新增红测2P/1F后显式兼容严格元数据。新真实bin测试等待原五分钟cron自然触发，避免以手动add_job冒充调度成功。16c915a7…check复验36/36、新镜像实际文件核对通过；真实cron专项与完整Worker运行中，之后再完整API。完整GC原范围不变，详见测试续篇§5.78.2。


D02.3定时调度已复验：16c915a7…原五分钟cron在两个独立实际bin的17:55UTC正常执行，专项5P、完整Worker253P/0F/0S、当前check/新镜像/源码扫描全部通过。最新完整API34468已启动，未预记通过；原四条自然租约及实际归档扫描待本次终态核对。完整资产GC删除执行器与所有原范围仍开放，86/93、七阶段和管理员前置不变。

原 D02.2–4 续进（2026-09-14）：0026 永久 key 退休/发布和命名空间租约保护已接旧 outbox 删除授权；真实 PG/MinIO 缺陷红测后 41P、锁/写入矩阵与 CLI 16P、升级 37P、check36/36、新镜像和源码扫描通过。当前完整 Worker262P/2F/4S，定向3P/4F，修复 owned fixture 隔离、MinIO 操作就绪及区分退休/legacy abandoned 恢复；完整 API46908仍在运行。boundary：Worker删除授权、DB expand迁移和就地测试；verify：当前完整API/Worker及实际存储、CLI/镜像/扫描，保留全部首败。原GC候选实际删除/全类别和七阶段、86/93不变，详见测试续篇§5.79。

D02.2关联竞争续修：0026版本API712P/1专用小时S、8实际ZIP扫描通过；三测试fixture修复后完整Worker269P/0F/0S、check36/36通过。另真实PG复现registry key在link等待间改变可绕过退休，永久红测1P/2F；0027追加行锁/已关联inactive保护后联合24P。boundary：DB两trigger函数、就地竞争测试及升级故障订阅；verify：当前升级/CLI、check、新正式镜像、完整API/Worker与扫描。首轮误选全API已取消并保留130退出和真实最新前缀测试失败，当前精确升级7125/check67962/image58231。原候选物理删除未完成，不改变86/93或七阶段。

0027验证续记：精确升级38P、check36/36、新正式镜像7aebe957…12相关文件包内摘要一致、源码扫描通过；当前ac4016a8…无漂移。API72124与Worker74971完整运行中，待真实终态及新归档扫描后接原D02.3候选实际删除，不预先勾选原父卡。

原D02.3–4/7实际删除推进（2026-09-14）：0028候选独立领取/最终授权/真实删除/退避与abandoned、scanner并发隔离和实际提交计数已实现；单批20/并发4，沿原inventory两个别名和暂停/dry-run，不转存旧outbox。实际MinIO字段精度首败10P/6F、权限fixture15P/1F、scanner计数/失败事实红测5P/2F均保留；修复后联合33P、实际bin强杀新PID删除1P（2名称过滤）、实际CLI两前缀各两次2P、完整升级39P、check36/36及新正式镜像通过。新增CLI测试后源码7a3af09f…当前check93040、完整Worker88572/API57375运行，未预记通过。boundary：DB expand schema/migration、Worker候选执行/扫描/共享退休及就地测试；verify：真实PG/MinIO/bin/CLI、当前check/完整API/Worker/包内摘要/扫描。原晚到PUT和全服务引用/租约、Desktop staging、原D02.1–7和86/93、七阶段不变。详见测试续篇§5.80及inventory-delete-progress.json。

D02.3–5续记：0028首轮完整Worker281P/2F因新fixture时间假设，保留原失败；仅修新Worker测试，按持久化eligible_at到期并拆分覆盖场景，增加未来修改时间保护，定向11P、当前fc12ecc5…完整Worker285P/0F/0S、check36/36及源码扫描通过，API57375生产输入未变仍运行。另在自有临时目录实际复现Desktop staging根符号链接使cleanupOwner越界删除原件；下一原D02.5修根/祖先身份检查和启动残留，并按Desktop要求build+Electron验收。该缺陷已回写且未修，不以云回归代替全资产GC；原晚到PUT/全引用租约和Desktop全范围继续，86/93、七阶段不变。

原D02.5继续（2026-09-14）：Desktop staging永久红测0P/7F后修受管目录身份/无递归删除、打开文件描述符复制、取消preparation不复活和消费文件延后清理；独占owner lock后接有界启动恢复与安全计数。专项35P；真实Electron首次3P/1F（第二测试窗口未加载桥）修fixture后4P/0F/0S/0flaky，包括实际SIGKILL、新PID、双窗口、链接原件与POSIX权限恢复。boundary：Desktop方案包staging/host、application装配、就地测试与真实Electron；verify：当前check/build、完整Electron及源码/实际归档扫描。源码387fc897…最终check正在运行；保留全部lint/TS/fixture/报告路径首败。全GC、独立进程路径竞争/慢复制/暂停/Windows原生及其他暂存类别继续，86/93、七阶段不变。见测试续篇§5.81。

D02.5跨进程剩余缺陷已实证：源码387fc897…在确定性调度点由独立Node子进程替换stage，生产unlink仍删掉自有外部测试原件。POSIX句柄相对unlink原型在Node25.8.1和Electron43.2.0均保留外部原件，但未安装进产品；不得关闭路径安全或GC。当前check36/36（15.268480秒）与源码扫描通过，完整Electron24728按191项继续收终态。下一正式接句柄原语、同类open/create边界及平台/打包测试，保留原全部范围。


D02.5 2026-09-14续进：原生目录句柄已接生产创建/读/枚举/删除，实际字节导入与12条子进程替换保护已验；153专项、check、5条真实Electron和第一版4条安装包冒烟通过。首次产物扫描发现原生调试符号带构建目录，正在完成去符号后的最终包验证。boundary：保留原G-DATA-02/D02.1–7、七阶段和管理员前置；verify：测试续篇§5.82与tests/v25/.results/d02/managed-fs-*，Windows/其他资产类别/持久重试/完整服务矩阵继续，未勾选父卡。


D02剩余边界审计（2026-09-14，resolved状态尚未满足）：在原生方案包完整回归保持输入不变期间，实际复现选择源普通文件→FIFO造成同步open阻塞；core生成资产最后inspect→unlink间替换父目录造成外部原件误删、deleted=1且意图被清空。正式修复仍待当前回归终态后接入，不能用已过专项掩盖；证据及验收见测试续篇§5.83，完整Desktop资产目录见生命周期§18。下一必须修两处并复验原引用/批量/失败恢复条件，继续所有资产类别，不新增或勾选较窄父任务。

D02正式接线续进（2026-09-14）：前版43777dbd…完整Electron189P/0F/2外部S/0flaky与20实际ZIP扫描通过，真实Node256MiB复制暂停64秒恢复通过。core清理接受管根/祖先句柄与native文件身份、主进程统一资源注入；选择源加非阻塞打开，正式专项67P。当前6b10e19e…仅修旧workbench测试native装配，check重新执行；boundary：原D02全部范围保留；verify：当前完整check/实际Electron/新包冒烟/源码与实际产物扫描，Windows、其他类别和完整引用租约继续。首轮check37/38和原误删/FIFO红证据保留，不改86/93与剩余七阶段。详见测试续篇§5.84。

D02本批终态续记：6b10e19e…check38/38、源码扫描通过，实际macOS arm64打包/4P包冒烟/安装产物与1实际ZIP扫描通过。当前完整Electron24942运行中，保持源码/测试/构建不变，收齐终态及当轮归档扫描再继续；原父卡和七阶段不变。

D02未入账生成资产核对（2026-09-14）：6b10e19e…源码冻结完整Electron24942期间，以真实generate/SQLite和受控Provider返回复现5类补偿缺陷：来源/原run引用误删、删除失败无意图且路径日志、父目录替换误删、落库失败无意图。隔离候选复用持久队列/引用/句柄5场景成立，未装生产；正式接线须补CLI能力、就地回归及完整门禁，保留全类别/硬崩溃发现/上传活跃保护。见测试§5.85；七阶段和86/93不变。

D02实际暂停增量：同6b10e19e…构建，独立macOS Electron PID16023在256MiB复制中实际SIGSTOP64004ms后恢复，生产维护保护、renderer/preload导入/读回与staging清空、原件摘要均通过（77.723159秒exit0）。前两次探测契约/主进程测试通道失败保留，永久回归待纳入；当前完整24942仍运行，未提交图片补偿候选待正式接入，其他平台/资产与原七阶段不变。见测试§5.85.2。

D02未入账补偿/CLI续进（2026-09-14）：前6b10e19e…完整Electron189P/2外部S及20实际ZIP扫描已终态；补偿正式接队列/引用/句柄，CLI启动/维护/退出接native，首批47P。实际编译CLI先复现createRequire重复声明，再复现Ctrl-C抢先exit130；分别修构建垫片别名与命令信号接管/退出等待，实际CLI重启及Ctrl-C清理1P，相关18P。新增永久Electron实际64秒暂停回归与安装包CLI冒烟待跑。boundary：原G-DATA-02全类别/引用/租约/崩溃发现不缩小，不勾选父卡；verify：当前check、真实Electron、新安装包及源码/产物/实际ZIP扫描，保留所有首败。check首轮lint8错含探测脚本格式和报告误落路径，保留原探测源码/报告后修正，当前d6748242…/1772完整check运行中。

D02交付与原范围续记：新实际macOS包5P、App/DMG/ZIP扫描及1实际方案ZIP扫描通过；永久CLI/实际Electron暂停2P，真实暂停64004ms后导入/读回/清理和输入保留通过。两轮全仓复验分别暴露原账号切换1s轮询、1001真实文件5s总截止；修为真实POST事件等待及该IO用例15s截止，所有原行为/数量断言保留，当前5fbef189…check15283运行中。另以实际本机HTTP/SQLite及第二输出目标目录冲突EISDIR复现Provider返回前第一张写盘后遗留、清理队列0；须接持久创建/提交协议和崩溃恢复，未修、未关闭原GC。boundary/verify沿原D02全部范围，详见测试§5.87/.1。

D02本批最终产物：5fbef189…完整check38/38与源码扫描通过，旧包/重建开发native身份不一致的2F保留后，重新实际打包47.682374秒、5P包冒烟24.963734秒及App/DMG/ZIP/1实际方案ZIP扫描全部通过。当前完整Electron86326已启动，源码1772零漂移；保留原Provider返回前部分写盘实际缺陷和全资产原范围，终态后先分类扫描新归档，再补持久创建/提交恢复。见测试§5.87.3，不改86/93或七阶段。

D02写入前持久意图候选（2026-09-14）：正式5fbef189…保持冻结、完整86326继续。隔离bundle验证预留先于native独占创建、fd身份先于内容写入、整次生成活跃保护与canonical提交接续；四场景通过，实际已写内容SIGKILL新PID删除通过，身份更新前SIGKILL保留空文件及blocked记录（不记回收成功）。候选未安装；下一正式类型/无环IO接缝、过期上下文与命名空间发布身份、实际host强杀恢复和完整门禁。boundary/verify沿原D02全范围，86/93七阶段不变，详见测试§5.88。

D02正式写入恢复续进（2026-09-14）：前5fbef189…完整Electron191P/2外部S及21合法ZIP扫描已终态。写盘前预留/独占创建/fd身份提交/作用域保护正式接入，11项真实IO协议与3项真实SIGKILL新PID恢复联合14P；NULL身份空文件保留blocked，不冒称已回收。首轮check37/38，Automation两组遗漏native运行时装配导致10F，接实际binding后原21项通过；最新f4a0de4e…/1777check与扫描复跑，接新包/全Electron。boundary/verify沿原D02全范围，不缩减上传/来源/云/Windows，86/93七阶段不变；详见测试§5.89。

D02真实CLI写盘强杀增量（2026-09-14）：冻结f4a0de4e…完整57145运行期间，独立探测实际开发版/包内CLI自动恢复三类正式写入记录，共6场景通过；首败为fixture根不匹配，修测试宿主路径而不放宽生产边界。另经实际CLI正常Automation API发起受控生成，32MiB内容分别写20381696/18546688字节时真实SIGSTOP+SIGKILL，新PID处理owner并自动清理，2项通过，无额外生图请求。独立探测待纳永久宿主回归，原完整57145仍运行；boundary/verify沿原D02全范围，86/93七阶段不变，详见测试§5.89.2。

D02上传真实磁盘满红测（2026-09-14）：冻结f4a0de4e…/1777且完整57145运行期间，独立128MiB HFS+卷制造真实ENOSPC，正式stageLocalImageBytes写20MiB留下2MiB无记录副本，实际维护不处理；同卷copyFile失败目标不存在，原件hash均保留。exit0是复现开放缺陷，不是验收通过；卷/目录已安全清理。下一持久创建意图、存活上传/原run引用保护与重启恢复，不能按年龄清空uploads或把所有上传套用生成结束清理。原boundary/verify不缩小，86/93七阶段不变，详见测试§5.90。

D02完整回归与永久CLI门禁（2026-09-14）：f4a0de4e…完整Electron191P/2外部S/0F/0flaky终态1485.130891秒；21ZIP原扫描1条随机Base64容量片段user-path命中，固定entrySHA256与匹配摘要精确复核后0未处理/0错误/1合成数据例外，原失败保留。永久CLI初次目录通知晚于写完32MiB导致红测，改独立观察进程在上游返回前就绪，未放宽半成品条件；开发版2P、包内1P，实际128KiB/192KiB强杀后新PID自动清理、请求1。最新3bffd9b3…/1778仅3份宿主测试delta，check38/38与源码扫描通过，生产文件和已验f4a0逐项相同。下一正式上传所有者/释放和持久写入，隔离候选不算完整GC；原boundary/verify、86/93七阶段不变，见测试§5.91。


D02正式字节上传所有者推进（2026-09-14）：持久写入接可信窗口/Automation/CLI/Skill所有者；95项专项通过，真实HFS+20MiB上传在2MiB后ENOSPC，正式补偿清空副本及记录，成功存活和末引用保护验证通过。两个新TS问题保留首败后修正；实际Electron首次1P/1F发现主窗口退出晚于SQLite关闭，已将全部窗口上传释放放到应用请求排空后、DB关闭前。最新3b3e852c…/1783check38/38、源码扫描及原两项实际Electron2P通过。boundary：原G-DATA-02全类别/引用/租约/崩溃恢复不缩小；verify：本批新安装包/冒烟/扫描/完整Electron待终态，见测试§5.92。方案copyFile/直接rm、UI移除迟到结果、Agent长期保留仍待，86/93七阶段和管理员前置不变。


D02方案参考图续进（2026-09-14）：冻结3b3e852c…完整196项Electron运行期间，独立实际适配器/SQLite复现仍被任务引用的副本被finally直接rm（1F）；实际源文件检查后增长复现sizeBytes12但复制20MiB+1成功。隔离候选改受管fd有界读取和owner引用保护，原保留任务/末引用删除场景1P；首次8P1F发现源目录替换未复核，补当前祖先身份后9P。候选实际HFS+字节/路径各20MiB均2MiB后ENOSPC且清理通过。boundary：原D02全范围保留，候选未装生产；verify：正式源零漂移、输入摘要/原始失败/候选结果见测试§5.93；完整Electron仍待终态与新归档扫描，之后正式接线/统一门禁，86/93七阶段不变。


D02正式方案复制接线（2026-09-14）：前3b3e852c…完整Electron194P/2外部S/0F/0flaky已终态1477.835980秒，21实际ZIP扫描0/0。候选补显式coreDb/方案DB后整组适配器24项、原生成11/上传9联合44P，另新增两项DB关闭/隔离测试通过；正式装入受管fd有界读取、owner释放、三类保留引用与真实旧夹具。当前3a14bacd…/1784正式专项60P，初次check仅6份独立探测配置格式失败，保留原文件摘要后格式化，继续check。boundary：原D02全范围；verify：当前完整check、正式HFS+、真实方案试跑/新PID参考图可读、包/扫描/完整Electron待验证，见测试§5.94；86/93七阶段不变。


D02正式复制本批门禁（2026-09-14）：3a14bacd…/1784 check38/38（root2881P48条件S）、源码扫描、正式HFS+字节/路径各20MiB到2MiB后ENOSPC清理均通过；三来源实际方案试跑/新PID参考图+两窗口生命周期合计5P，6实际ZIP扫描通过。新macOS arm64包46.619778秒、6P包冒烟28.619231秒、App/DMG/ZIP与1实际ZIP扫描通过。当前完整196项Electron已启动（owned-copy-electron-full），等待终态和本轮归档扫描再改冻结源码；boundary/verify保持原D02全范围，UI移除/迟到结果、Agent长期释放/其他资产与云矩阵/Windows继续，七阶段不变。详见测试§5.94.1–3。


D02工作台上传生命周期（2026-09-14）：上一3a14完整Electron194P/2外部S/0F/0flaky终态1497.828821秒，21实际ZIP扫描0/0。原组件6F/2P及实际PC/移动原构建2F复现离场/换号仍上传与旧错误；全量候选另发现React updater内预览释放漏执行及mutation异步受理2F。同步预览集合/待上传有效性/网关调用前复核已正式接入，增加10就地测试及1双视口场景。当前d9215df1…/1784check38/38、features780P、正式双视口4P与源码扫描通过；完整pnpm run test:e2e已启动。boundary：原D02全部类别与持久生命周期、费用/正式交付不缩小；verify：当前完整三端及归档扫描待终态，已上传宿主文件释放/在途与兑换恢复保护继续，86/93七阶段不变，见测试§5.95。


D02参考图释放后端候选（2026-09-14）：正式d9215df1…/1784源码0漂移，完整520项三端5926仍运行。独立合同/API到期及桌面owner释放候选：真实BA/PG6P含采用行锁阻塞、native/SQLite3P含跨窗口及末引用、实际MinIO3P含故障持久重试；保留原接口缺席5F/3F以及存储夹具列名首败2P1F。boundary：全部仅隔离候选，未接platform/client/Desktop gateway/UI，也未替代真实IPC/生产验收；verify：待原完整E2E终态及归档扫描，再正式接所有权移交/兑换恢复等原D02全范围，86/93七阶段不变，见测试§5.96。

D02参考图释放正式接入（2026-09-14）：前d921完整三端513P/7S/0F/0flaky与49实际ZIP+2明确UI文本扫描终态通过。新strict释放合同、双gateway/IPC/API、视图/在途普通生成与方案/兑换恢复独立保留责任已正式接入；原恢复9F和工作台10F复现，候选完整features803P，修复空204解析的客户端缺口。正式输入e6ea59a7…/1785（27文件变化）check38/38、root2892P48条件S、features803P、API原整文件29P、实际MinIO扩展整文件8P、真实Electron/双视口10P与源码扫描通过；首败格式及bridge fixture缺方法均保留。boundary：临时引用归还不等于整个GC，长期Agent/其他资产/云租约/Windows及原费用交付范围保持；verify：新原命令完整三端reference-release-full-e2e已启动，待终态/新归档扫描，86/93七阶段和管理员前置不变，见测试§5.97。


D02读取与退出候选（2026-09-14）：冻结e6ea59a7…/1785原完整三端仍实际运行；真实文件替换/增长红测6F及实际Provider错误发送1F，已完成单句柄有界读取候选。另实际EACCES复现控制面stop抛错却仍监听、CLI上传副本/SQLite/所有权锁未释放；候选继续关闭监听并执行原宿主清理。更正一次不存在的native-copy测试过滤名后，最终实际6文件42P/0F/0S，只读类型探测0诊断；原诊断OOM与配置首败保留。boundary：仅隔离候选，两生产文件和三就地测试尚未正式接入；外部选图能力保持，Windows/新PID/长期上传全期限不冒充已验。verify：等待当前完整E2E终态与新归档扫描，按候选摘要接入后执行完整check/实际宿主/扫描，再继续原D02.1–7全范围。86/93七阶段和管理员前置不变，详见测试续篇§5.98。


D02独立CLI退出证据（2026-09-14）：已用隔离原版/候选实际CLI和macOS不可删除发现文件复现旧进程SIGTERM后仍HTTP200、文件/锁残留；候选真实PID15624退出0且副本/锁释放，PID15637重启队列为空。14文件实际构建扫描0/0，共用正式开发/打包helper候选Playwright1P、只读新helper类型0诊断；初次循环类型与探测配置失败保留。boundary：候选仅替换server stop，正式源码和原完整回归仍e6ea59a7…/1785；verify：回归与归档终态后按8文件新映射接入，完整check、正式CLI/Electron、实际安装包/扫描仍须执行，不关闭D02或提前管理员，见测试§5.98.4。

- 2026-09-14 D02读取/退出正式批次：同8bdd4329…输入check38/38、42专项、真实宿主10P及6ZIP扫描、新macOS包/严格7P/6产物扫描与1实际包内导出扫描通过；先前9P1F及GitHub诊断/重复3P全部保留，根因未确认。原完整Electron199项已启动，源码与构建冻结。仅更新证据，不勾选完整GC或原七阶段；接长驻Agent释放/期限及持久引用，再接其余D02类别。见测试续篇§5.99.2。

- 2026-09-14 D02 Agent前置发现并隔离修复：实际ledger/native及Desktop适配器均复现owner释放误删仅由费用请求冻结引用的原图；候选补全引用。Agent独立referenceHash三种替换、实际超限读取和12秒FIFO阻塞已证实；候选加入非阻塞、有界读取和身份复查。联合64P、只读TS0诊断；新真实Electron用例仅收集未执行。正式8bdd4329源码保持冻结等待原完整199项终态。详见测试续篇§5.100；完整GC、Agent释放/期限与七阶段不勾选。

- 2026-09-14 D02 Agent批次正式合入：原bundle新真实Electron1F证实停用控制面误删冻结引用；安装core保护/Desktop有界哈希与永久宿主回归。当前558067cf…/1787 check38/38（root2922P/48S、features803P）和源码扫描通过；首轮仅新测试格式1error已修。实际11项宿主专项进行，新包/完整Electron仍待；前批8bdd完整197P/2外部S及21ZIP扫描已收。完整GC和七阶段继续，见测试续篇§5.101。
