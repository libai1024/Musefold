# v2.5 专用设计方案包：共享编解码与云端接续

> 刷新至B50，2026-09-09。B48云端原子导入/B49正式归档与受控下载之后，B50接入共享导入页面，行为见§12，结果见[测试手册§5.43](./V25-MIGRATION-TESTING.md)。正式包宿主交付、刷新恢复与全链验收按[路线图§6.38](./V25-MIGRATION-ROADMAP.md)继续。通用分享仍暂缓。

## 1. 所有权与依赖

`packages/contracts`是canonical v2 manifest、legacy v1 envelope、图片/历史/来源及包限制的唯一实体事实源。新增`packages/scheme-package`为Node宿主提供同一套ZIP读取、内容校验与写入；仅依赖contracts、归档库和Node，不读取账号/数据库，不请求网络，不决定权限/费用/正式化。API/worker和Electron主进程可消费，渲染层、features、domain均禁止导入；两个新增depcruise规则强制执行，没有边界豁免。

桌面`package-archive.ts`保留原导入路径并重导出共享实现；`share.ts`真实使用共享writer。文件打开/受管目录/数据库/原子替换及取消仍由主进程编排。云端已注册workspace依赖和TS引用，独立API工作目录Node进程已验证共享包可加载并对真实ZIP读写；这是B43的共享基础证据；B46/B47之后，B48已接原import-package的真实原子导入，B49另接正式归档/受控下载新接口。旧prepare/export宿主接缝仍501，须由F5/D4合流。

## 2. 固定格式与资源预算

- 包版本仍为canonical 2、legacy 1；没有修改应用版本。v1 envelope schema移入contracts，legacy scheme.json必须是有效UTF-8 JSON对象；B45把legacy文档schema及双向转换移入contracts，旧来源文件解码位于共享Node包；宿主的来源/资产身份映射、实际解码与事务导入仍各自负责，详见§7。
- archive与累计解压内容各256MiB、单条64MiB、manifest 4MiB、全部ZIP条目1024（包括manifest和目录）、超过1MiB条目的压缩比最多200。canonical内容条目最多1023，留出manifest；此前读器本就计入manifest，合同现与实际一致。
- 文件入口检查普通文件并按实际读取字节限额；云端字节入口在首次await前复制输入，调用者随后修改原Buffer不会改变解码。共享codec在预算内缓冲；B46上传端已按请求流计数接收，仍需汇集后解析，并非全链路流式ZIP解压。最大体积内存/并发压力尚待验证。
- 所有解压文件验证声明大小与CRC32；manifest与revision JSON严格UTF-8，来源文本也要求合法UTF-8。路径禁止穿越、反斜杠、绝对路径、Windows盘符/设备名/ADS/通配符/尾点空格；大小写与Unicode规范化别名、文件和目录前缀冲突均拒绝。目录同样计数，符号链接、特殊文件和加密条目拒绝。
- writer先校验schema、条目/总量及内容图，再输出有界ZIP；使用STORE和固定条目时间，避免自己生成的高压缩率正文被reader拒绝。同一输入顺序在本次环境可重复得到相同字节；STORE会增大体积，不宣称等同旧压缩包字节或达到最大负载。

## 3. 内容图与素材事实

canonical manifest必须完整声明全部实际文件，且恰有一个revision-document；文档与manifest一致，sourceSnapshotIds/assetIds与实际集合对应，来源packageId/snapshotId及source-file/asset条目不能串用。来源文件实际hash/大小/MIME必须和snapshot清单一致，snapshot.totalBytes与文件总量一致；资产实际hash/大小/MIME必须和资产元数据一致，不能只重算外层索引hash就蒙混通过。

B41历史：`historyItems[].prompt`是用户选定的完整正文，必须与对应包内UTF-8文件逐字节相同。它来自原生成的`promptSnapshot.finalPrompt`，但包内字段名是`prompt`。history imageAssetId需指向实际cloud-run/example资产，与对应来源图片的hash/大小/MIME一致；原runId/assetId只作为历史来源标识，不能据此授予导入者访问原账号记录的权限。

B42仓库图片：repositoryImages中的snapshotId/assetId/path及来源/文件hash必须和manifest对应，asset保持repository/reference，imageRole保留原建议角色。格式校验只证明包内一致性，不证明外部仓库许可、原作者身份、生成成功或用户授权。魔数检查不是完整像素解码；云端进入资产管线时仍须使用现有真实解码/尺寸验证，不能把任意ftyp视频判为AVIF。

## 4. 桌面实际往返与兼容修复

旧share转换会丢弃sourceSnapshotIds/assetIds、来源绑定身份及新增repositoryImages。现在两向转换和IPC读写保留这些字段；导入重映射scheme/revision/snapshot/package/asset身份，并同步改写repositoryImages与historyItems.imageAssetId。原history selection的来源身份与完整正文保留，不冒认成本地生成记录。

导入snapshot的受校验canonical元数据存入既有`scan_json.importedSnapshot`，没有新增SQLite列。core读取时重新过canonical schema并核对本行snapshot/package ID，IPC只返回受校验的historyItems。导出从受管文件/正文重建文件清单，保留有效原snapshot.contentHash及历史上下文，使用精确来源ID优先绑定，避免按role猜测覆盖已知身份。

实际测试通过真实SQLite导入→IPC get→再次导出→共享读器检查→第二次导入，历史正文与图片字节不丢、新身份再次产生；每次导入仍为draft，无成功试跑，不继承formal或cover资格。测试中的导出formal状态使用明确SQL样本，不能当成真实生图/试跑/正式化完成。已有正式方案、v1导入、导出取消、原文件回退与资产角色等回归保留。

## 5. 尚需完成的联合条件

1. 云端F2–F4：B46已接上传/暂存/精确确认/取消，B47/B48已接内容重映射、PG原子导入和幂等回执（§8–10）；B49已接本人正式版本归档/受控下载新接口（§11），继续共享交付及TTL、补偿与引用保护的联合验收。禁止拿客户端manifest.status或owner线索当授权。
2. 专用包使用场景合流：B44已修复桌面modify/update并通过真实SQLite/IPC/运行准备/再次导出，新增真实Electron修改后新PID往返；细节见§6。云端对应HTTP、跨宿主往返、共享产品和全部旧消费者仍待验证。
3. 完整兼容：B45已补共享v1内容解码、文档桥和share-import映射；v1云端业务身份/预览映射、旧/新消费者、真实Windows/macOS/不同ICU的内容索引与文件名仍需验收。B45新导出固定en-US排序，旧包按受支持默认collation逐个核对精确摘要，四个真实Node默认locale往返通过；跨ICU版本和实际Windows/发布产物的兼容仍须补验，详见§7。
4. 大包/并发内存与超时、完整图片解码、自然暂存TTL、账号删除/GC，以及最终平台产物扫描/升级/回滚仍走原验收。没有新增Cloud MCP写工具或管理员入口。

## 6. B44：导入后修改、更新与资产继承

`packages/core/src/db/design-scheme/revision-assets.ts`统一读取版本可用素材：`asset.revision_id`保持素材最初创建版本，当前document.assetIds声明继承关系，并兼容旧文档未声明时属于该版本的资产。声明必须在同一方案中真实存在，不允许重复、缺失或跨方案身份；未被当前基线引用的旧资产不能重新冒充继承。没有新增引用表或DDL。applyAgentRevision在同一事务校验继承和新素材、写入revision/asset/来源并切换指针；原正式current及新版本试跑/封面资格保持原规则。

modify保留assetIds、repositoryImages和来源；export、实际IPC prepareRun、固定计划及真实run adapter使用同一引用解析器。被继承资产仍从原受管文件读取，临时发送文件按原流程清理，不改写旧asset归属。新版本不能靠继承旧local-run封面取得正式化资格。

canonical导入在来源绑定缺少repository/ref/commit/hash时从精确snapshot补齐。更新把完整historyItems.prompt传给Compiler，并在事务中固定变化来源的真实文件/hash、新图片元数据及repositoryImages；保留未变化来源和历史，只替换变化仓库的旧图片。Analyst未采用新图片时移除该变化来源的旧图片；原修订和来源文件不改写。该路径校验字节/hash/魔数/尺寸，不等同完整像素解码，文本模型也没有视觉理解。受管路径以宿主语义检查包含关系，再规范化存储分隔符；Node win32/posix专项覆盖Windows正常路径、跨盘/目录外/父级路径拒绝，这不是实际Windows安装包验收。

失败回滚数据库并清理本次已经返回snapshot ID的新增受管目录；测试覆盖资产写入触发器失败。persist中途尚未返回ID、SIGKILL或文件删除失败的孤儿清理仍需G-DATA统一治理，不宣称全生命周期无孤儿。未来GC删除原始revision/asset前必须核对其他版本的document引用。

验收与真实/替身范围见[测试手册§5.37](./V25-MIGRATION-TESTING.md)。B44结束时createdBy/parent等legacy桥接、显式来源metadata冲突、旧消费者、v1云转换、share-import kind及跨locale内容索引仍是剩余条件；B45对这些字段和共享格式的实际进展见§7。完整未变化来源规则及legacy历史参与Compiler仍需D4/F1合流验证。

## 7. B45：共享旧格式解码与来源、版本事实

**依赖与转换**：legacy文档实体从desktop-contracts移至contracts的design-scheme-legacy，原桌面入口只重导出，维持旧调用路径。design-scheme-document-bridge集中双向转换，桌面IPC和分享使用同一实现。createdBy/createdAt/parentRevisionId、constraint.evidencePath、compilerVersion以及trace.kind/output/status保留；旧无可选字段文档仍可读取。编译时间字符串转数字时间戳，语义保留；legacy本机history伪URI和无法进入共享契约的本机定位信息沿原规则不外泄。

**版本身份**：仓储新建按实际user/agent/import写入创建来源和时间；新根版本parent=null，结构化编辑和Agent修订的parent均是精确基线。旧JSON缺少创建信息时，从已有created_by/created_at列只读补全，不推测旧parent、不回写旧JSON。包导入重建身份并记为import/root，原包声称的父版本、创建来源或formal不产生本机权限。

**来源事实**：canonical包中绑定的非空repository/ref/commit/hash必须与其固定snapshot一致，hash前缀/大小写以及.git/尾斜杠等已明确等价形式可归一；缺省冗余字段允许存在，不能伪造其他来源。share-import仍以存量user-brief行存储，但经校验且身份一致的importedSnapshot保留真实kind，core读取/IPC/再次导出使用该事实，不靠平行列或DDL。

**v1内容入口**：decodeLegacyDesignSchemePackage在Node包中解析已校验ZIP的legacy文档、正文和来源图片索引，检查revision身份、来源目录唯一性、同来源文件冲突、UTF-8及可归属内容；正文返回全文，excerpt只用于展示。桌面旧导入器实际接入，API工作目录的独立Node进程也可消费并执行共享文档转换。v1的previews由共享decoder返回索引，字节仍在调用者的归档entries；现有桌面旧导入不将其持久为方案资产。它没有可移交的asset/成功试跑/封面依据，不能自动晋升。scan属于包内不可信历史数据，不能当成服务端已确认Analyst或付款依据。这个解码入口不是云端PG导入服务；云端还须完成F2/F3的确认、固定ID映射、真实图片解码、预览/来源保留策略和原子写入。

**摘要兼容规则**：最终v2形状和版本号不变，没有新增hashOrder字段。保留原逐项path/NUL/hash/NUL/size/LF SHA-256算法；新桌面导出及无原值的来源摘要固定Intl.Collator('en-US')。旧包未记录locale，reader先核对固定排序及当前locale，必要时再对本运行时支持的两字母locale和列举的fil/kok/haw/gsw/yue/zh-Hant/zh-Hans/sr变体默认collation计算精确摘要；不能跳过总摘要或信任调用者提供的排序。四个真实默认locale进程（en-US、zh-CN、sv-SE、tr-TR）对5份包互读通过，原legacy摘要确实不恒等，而新导出摘要一致。无效总摘要仍拒绝。ICU版本变化或列表未涵盖的旧排序并未被证明支持，Node/Electron升级及平台发布仍需真实旧包矩阵；不声称数学上独立于所有ICU版本。非法Unicode路径拒绝，避免UTF-8替换产生文件名歧义。

本批无新DDL/云接口/产品UI/应用版本变化。完整测试、首次失败与资源并发造成超时的适用边界见[测试手册§5.38](./V25-MIGRATION-TESTING.md)。旧二进制混跑、最大包并发、全部legacy字段组合和跨平台产物仍随F5/原E验收。


## 8. B46：云端持久上传与精确确认

新公开路径位于既有 `/api/v1` 鉴权路由，复用正常 Better Auth 会话与账号身份。它们补齐上传暂存后端；旧 `prepare-import-package` 的宿主选文件接缝、`import-package` 与 `export-package` 尚未接通，不能把新接口或确认状态称为完成了方案导入。

| HTTP 方法 / 路径 | 行为和验收边界 |
|---|---|
| POST `/design-schemes/packages` | contracts严格校验requestId/包SHA256/实际预期大小/格式1或2；owner来自会话；同owner/request同输入幂等，变更输入/授权拒绝。无客户端路径、objectKey或owner字段 |
| PUT `/design-schemes/packages/:id/content` | 原始application/octet-stream；按流的实际字节有界接收，不依赖Content-Length或multipart。校验精确长度/hash、共享v1/v2归档和内容索引，再PUT并事务标记ready |
| GET `/design-schemes/packages/:id` | 持久、无路径的状态/摘要/预览，可由新进程读取；已失效租约显示expired，不自动重传 |
| POST `/design-schemes/packages/:id/decision` | 绑定包hash、格式、parserVersion=1、服务端confirmationHash；确认前重读受管对象核对实际字节，事务内重查账号/会话/授权版本。confirm/reject幂等但不互相覆盖 |
| DELETE `/design-schemes/packages/:id` | 本人明确取消；上传仍在执行时保留租约，后来完成的PUT不能把取消状态改回ready |

`createCloudDesignSchemePackageClient`使用既有ApiHttp，新增互斥binaryBody和AbortSignal，保留cookie凭据和响应schema验证；不在features传路径，不扩本地IPC方法表。共享页面的文件选择、进度/取消、精确内容确认和旧prepare接口合流仍在F5/D4实施。

暂存有效期1小时，上传租约2分钟；请求流最长60秒，S3现有PUT/read为30秒，PUT前更新租约并要求暂存仍有至少35秒。包实际接收上限256MiB，解压等预算沿共享codec；JSON元数据请求独立8KiB限制，范围仅为两个包POST入口。每owner最多3个活跃暂存，每API服务实例最多2个上传/确认读取；这只是有界资源策略，不是最大负载已验收。包S3读取显式用256MiB预算，图片存储默认20MiB不变。

登记事务在任何对象PUT之前写入 `design_scheme_package_stages`、既有 `generation_reference_uploads` 和已有 `object_cleanup_queue`。清理intent不依赖user外键，账号删除后仍存在；失败/取消/拒绝将登记转入cleanup_pending，保留尚未到期的上传租约。worker到期回收分批处理100条，原清理器检查包租约和有效暂存保护，实际对象删除/失败重试/ack仍由原流程完成。未完成上传跨新PID只能观察，租约失效后退休，同一请求不覆盖字节。

预览只给出名称/摘要/来源数/图片数/条目数及legacy预览数，不接受包内formal/scan/历史身份为授权。v1预览字节仍在原包中，不转为成功试跑或封面；v2图片索引验证不能替代F3真实像素解码。确认不创建方案、资产或模型任务，也不授权用户花费。F3还须由私有服务接缝验证同一确认和原始字节、映射新身份、持久来源与图片并原子建立新草稿。

阶段实际测试、首次失败与未验范围见[测试手册§5.39](./V25-MIGRATION-TESTING.md)。后续目标见[路线图§6.34](./V25-MIGRATION-ROADMAP.md)。生产升级应先应用0019并升级理解包租约的worker/API，再开放新客户端；尚未执行生产迁移、旧二进制混跑或发布回滚验证。


## 9. B47：私有导入内容准备、身份和像素事实

`apps/api/src/modules/design-scheme-packages/import-content.ts`只负责实际原包到内存内容计划。输入是字节及调用方给定的固定随机seed/创建时间；首次await前固定身份输入，字节由共享reader复制。ID使用固定域`package-import-v1`、seed、实体种类和原身份确定性推导，并检查内部碰撞和原实体复用；同一seed/原包/时间的新进程输出一致，新seed得到隔离身份。**seed形状校验不是授权**，这不是公开DTO，也不是HTTP或DB服务。后续持久导入必须先保存seed、时间和映射版本/原包hash，再调用该函数；不能在重试时生成新seed、信任浏览器传seed或绕过B46确认。

| 内容 | 已实现规则 | 限制及后续责任 |
|---|---|---|
| v2身份与引用 | 新scheme/revision/package/snapshot/asset ID；source bindings、repositoryImages、historyItems.imageAssetId同步映射；同一原package的多个snapshot共用一个新package，矛盾种类/仓库拒绝 | document内source/rule ID保留局部含义；原历史selection.runId/assetId只作出处，禁止在导入账号中解析成可访问记录 |
| 正文/来源 | 全部source-file返回完整Buffer，historyItems.prompt保留全文，excerpt仍只作摘要；编译记录、来源种类/角色/许可保留；SHA256前缀/大小写归一，云端文件/图片事实可直接比较 | v2无独立presentation/label字段，按来源kind推导展示类别，不能声称精确恢复原自定义label；单来源许可保留在document.sources，不推导包级许可 |
| 图片 | 复用现有sharp完整像素解码，校验静态PNG/JPG/WebP及现有像素/尺寸限制，输入预算使用方案包单条64MiB；v2声明尺寸/格式/hash/字节数须等于真实结果，来源图片同样解码 | 没有新图片加载器、没有视觉模型；单条上限不代表最大包/多实例性能已测 |
| 草稿语义 | 新根document.createdBy=import、parent=null、固定新时间；cover/output转example，仓库reference、历史cloud-run/example事实保留，原创建信息仅记provenance | 计划未创建scheme/status/trial/账本；数据库draft指针和本版本试跑/封面资格仍须F3事务与原服务验证 |
| v1来源 | 共享legacy桥；目录精确身份优先，否则按kind/仓库/ref/commit/相对文件位置唯一匹配，歧义或悬空声明拒绝；manifest-only快照补显式source并保留role | 不按数组顺序猜测；不满足唯一匹配的旧包需重新导出，不能承诺全部legacy字段组合兼容 |
| v1正文/图片/预览 | 正文完整Buffer；来源图片从实际像素构建新资产；预览为uploaded/example、无license推测；已有repositoryImages按实际来源文件重映射并归一hash | 普通旧history图片保留为内容，不从scan伪造canonical historyItems、外部账号身份或成功试跑 |
| v1旧metadata | 非canonical或超过PG可用commit格式的旧commit仅保存在私有provenance，canonical commit=null；scan和原来源/版本声明原样留作不可信出处 | provenance不能直接回给公开DTO、写成可信Analyst scan或自动导出；后续DB保留和导出投影须按此边界验证 |

新增测试验证实际v1/v2内容准备和完整像素、一个真实新Node PID重建、codec再次写出/读回后完整正文与图片相同。再次编码使用**合成formal envelope**，只证明内容图能往返，不证明真实正式化/导出资格，更不是桌面↔Web产品验收。首败是测试编码器把`.md`标成JSON；修复为读取真实来源MIME，产品校验未放宽。

本批没有DDL、对象PUT、PG草稿/回执、导入HTTP或共享UI接线。F3.1/F3.3须串起原会话/确认/原包与租约、registry/outbox在前、原子来源/资产/草稿与幂等结果，覆盖真实取消/重启/回滚/GC以及get/content/prepare；F4/F5/D4及原E保持原条件。实际命令、源码、失败和未验见[测试手册§5.40](./V25-MIGRATION-TESTING.md)。

## 10. B48：云端原子导入、重放与对象清理

实际 `POST /api/v1/design-schemes/import-package` 已接持久导入服务，复用现有输入及草稿结果合同；不是返回固定成功的占位接口。原 `prepare-import-package` 和 `export-package` 仍501，文件选择/共享产品尚未接通。服务未注入导入器的旧单测配置仍有501后备，生产app已注入；不能据此把生产导入写成仍501。

| 环节 | 实际行为 | 验收边界 |
|---|---|---|
| 本人授权和确认 | 按账号/身份/会话/授权→stage→import记录顺序加锁，核对正常会话、原确认摘要、包hash、格式、parser及TTL；重新读取实际原包字节/hash | 新写入仍绑定原确认会话和授权版本；确认不是花费授权 |
| 持久身份 | PG0020记录固定seed/创建时间、request/authority/confirmation hash、parser/mappingVersion、planHash和结果；重试不改变逻辑scheme/revision/来源/资产ID | 每stage最多16次尝试，每API实例最多2个导入；不是全局并发上限或最大负载验收 |
| 并发和租约 | running租约内重复请求409，过期或retryable可显式重试，epoch递增且attemptId更换；2分钟租约不超过stage的1小时TTL，每次IO前要求至少35秒，现有S3单次30秒 | 原包读取/对象PUT期间续租；到期注入和三个实际SIGKILL点已测，不等同所有自然期限/任意长暂停场景 |
| 对象写入 | 每次尝试使用独立scheme-imports命名空间，物理文件名由内部摘要生成；完整源文件和图片在PUT前提交既有registry及独立cleanup outbox | 旧进程不能覆盖新尝试已提交字节；失败保留清理事实，不直接删除可能已提交的对象 |
| 原子业务提交 | 同一PG事务写新draft、immutable root revision、source packages/snapshots/完整文件keys/bindings、assets、私有provenance和完成回执；stage置imported | 不伪造Agent材料授权、不继承旧trial/封面资格；真实get/content、结构化修改与run prepare通过，付费运行和上游更新全链仍须合流 |
| 完成后重放 | 当前同owner正常会话可取原始不可变回执，即使原会话/暂存已过期、方案后来已修改或删除；输入必须仍等价 | 不重新导入、不将旧回执伪装成当前方案状态；新副本必须新上传意图。完成后的stage不能取消来撤销已导入方案 |
| 清理 | 原包完成后进入原清理队列；当前attempt有效租约、实际source-file/asset引用保护内容。import对象被引用时outbox延后24小时保留，账号删除级联后仍可回收 | 新worker用例实际执行S3 DeleteObjects协议；保留期/全来源孤儿/元数据治理仍归原E，不能以账号删除样本代替全部GC |

导入计划只使用B47验证过的canonical来源与像素，不把旧scan写作可信Analyst结果。私有provenance记录原始版本/来源声明，不进入公开DTO。输入同hash允许大小写及sha256前缀等明确等价形式；planHash跨重试不一致时拒绝。回包丢失、S3实际PUT后返回错误、事务触发器失败及账号撤权/删除均有定向集成证据。

修复导入大图的读取不一致：方案包单条允许64MiB，既有图片默认20MiB。仅服务端保留的scheme-imports对象在内容读取与运行参考图预检采用64MiB预算，并继续真实像素和归属校验；普通上传/图片读取默认不变。实际大于20MiB PNG导入后逐字节读取已验；不是64MiB/256MiB最大包或多副本内存测试。

实际命令、首次失败和替身边界见[测试手册§5.41](./V25-MIGRATION-TESTING.md)。F3剩余联合条件、F4/F5/D4及原E、旧消费者与生产发布继续，管理员尚未启动。

## 11. B49：本人正式版本归档与受控字节下载

新 `POST /api/v1/design-schemes/package-exports` 接通云端正式归档，GET同路径/{id}观察，GET/{id}/content下载实际字节，DELETE/{id}取消并登记清理。**ready仅表示服务端已有验证过的文件**；旧gateway `export-package` 仍501，文件选择/保存与宿主delivered/cancelled必须在F5/D4通过新接缝合流，不能用metadata返回值冒充交付成功。

| 接缝 | 实现与验收含义 |
|---|---|
| 选择与资格 | 新合同要求requestId、schemeId、精确revisionId、expectedVersion及formatVersion=2，禁止客户端owner/objectKey/路径。事务重查正常会话和授权摘要、未删除方案、当前正式revision、版本及支持的fidelity；存在本revision未删除completed trial且所选封面归属本revision。不能导出working draft、旧trial或其他版本封面 |
| 冻结来源与素材 | 复用既有revision/source读取；只取本revision资产或document显式继承的同方案资产，排除不相关working draft素材。比对PG文件行与完整snapshot清单、实际源文件/图片size/hash/MIME及像素；来源正文不以excerpt替换，旧inline正文只在实际完整字节与固定size/hash一致时可用 |
| 封面与溯源 | 仓库reference或历史example被选作封面时，原资产角色和来源关联必须保持。归档额外生成稳定新ID的cover内容副本，复用已验证字节；该副本只在manifest和归档存在，不新增PG资产、不赋予新试跑资格。普通非来源图片直接作为归档cover；全部资产仍受128项限制 |
| 持久请求 | PG0021记录request/authority/basis摘要、精确版本、独立对象key、preparing/ready/failed/cancelled/expired及实际hash/大小、租约/TTL。每owner最多3个活跃导出、每API实例导出/读取共用2个名额。相同请求返回原状态，不再次写对象；改变输入或原授权拒绝 |
| 进程中断 | 每个对象只有原进程的一次构建尝试，原请求在失效租约后显示expired。新PID可以观察或取已ready文件，不重写中断对象；重做须显式新request/new key。每次源文件IO和最终写入/提交重验身份/版本/basis及租约；不是自动续建或后台队列 |
| 租约和清理 | 1小时访问TTL、2分钟租约、IO前至少35秒、S3单次30秒；对象registry/outbox在任何PUT前提交。取消保持原在途租约；worker保护有效租约及ready TTL，之后复用原清理器。账号级联不删除独立outbox。延期批次可能晚于TTL删除，TTL不保证到点立即物理删除 |
| 受控下载 | 固定API路径，经正常会话及原授权摘要，读前读后核对版本/basis、实际大小/hash与取消状态。私有no-store、nosniff、attachment头，无S3 URL或objectKey；不支持任意URL/重定向。权限变化发生在读期间时拒绝响应文件，已完成交付的字节无法撤回 |
| api-client | 使用ApiHttp，cookie凭据不变；download禁止重定向，按预期大小有界消费完整流并校验SHA256，截断/超量/错误MIME/hash/取消均不返回成功字节。它不触发保存或报告delivered；宿主成功交付或取消后应释放暂存，避免占用活跃名额 |

所有归档继续使用shared writer，canonical版本仍2；正文/来源许可/历史图片与编译依据保留，内部对象定位和私有provenance不进入公开manifest。内容大小/条目/manifest预算在元数据与编码层双重校验；尚未做最大包或多实例压力。

[测试手册§5.42](./V25-MIGRATION-TESTING.md)记录实际PG根迁移、Hono/S3/ZIP往返、不同PID/强杀、事务失败、撤权与清理。正例通过真实selectCover/formalize服务，trial完成状态为SQL夹具；它验证现有资格判断，**不证明真实付费模型试跑和完整三端交付**。F3的Agent/上游更新联合、F4剩余真实试跑/自然期限、F5/D4和原E继续开放。


## 12. B50：共享导入页面、精确确认与结果核对

`DesignSchemesGateway.packageImport` 是可选持久传输接缝，Web api-client 注入现有begin/get/upload/decide/cancel；shared features不导入Node归档器、API实现或宿主包。HTML文件输入及Web Crypto走浏览器/Electron支持的标准能力，沿既有参考图选择方式；Desktop未注入该云端接缝，仍使用原生prepare/import。

1. 每次明确打开对话框建立一个本地意图。文件非空、扩展名和256MiB上限在读取前检查；完整bytes/hash/大小与固定requestId提交。默认格式2，旧格式1显式选择。开始后不能无声换文件或格式，需关闭重开。
2. begin、上传、查询响应必须匹配原request/hash/大小/格式/stageId；预览展示名称、摘要、来源数/图片数/条目数和旧预览说明。上传完成不自动确认，不因包内封面或旧预览获得成功试跑资格。
3. 明确确认时再次读取原stage，比较原confirmationHash，按parserVersion/包hash/格式绑定decision；只对confirmed/imported执行原importPackage输入。响应丢失保留原输入，重试核对原回执，不自动创建第二份。详情导航会再查当前实体，已删除实体不会从历史回执重建。
4. 同步busy引用拦双击，网络异常保留预览和错误；提交期间禁止关闭/重复确认。读取/上传展示阶段不定进度，可关闭，中止浏览器上传并尽力取消原暂存。关闭后才返回的begin也清理；换号时不向新账号发旧取消，交由服务端TTL收尾。清理失败不假报物理删除。
5. 所有异步续步/完成导航核对本地account epoch；账号查询失败或受限时隐藏预览、禁确认。服务端仍独立核对原会话/本人/TTL/撤权，这些UI守卫不是权限来源。
6. ≥768px Dialog、窄屏底部Sheet，同一表单；Esc与关闭恢复“新建”触发器焦点，上传/导入状态aria-busy，错误就地、完整预览可滚动。两张新增预览快照已人工查看，旧截图未在本批更新。

测试逐项与首败保留见§5.43。组件fake gateway/摘要替身和实际浏览器File/SHA256/HTTP夹具是本批证据；不是完整真实登录/API/PG/S3/三方向真包交换。刷新丢失本地意图的恢复、真实会话过期/多页面并发/大文件和服务器自然TTL继续F5。旧prepare-import-package/export-package兼容接口仍501；浏览器导入使用新持久接缝，不继续调用旧prepare。B50当时正式导出按钮与异步Agent产品尚未合流；B51正式导出接线见§13，异步Agent与G-CLOUD-05/06父卡仍未闭合。


## 13. B51：正式包共享导出页面与Web文件交付

采用可选 `DesignSchemesGateway.packageExport`，其begin/get/cancel复用B49客户端；save由Web宿主实现。`DesignSchemePackageDelivery`是独立的宿主回执，只有exportId与delivered/download-started/cancelled；不改旧导出结果联合或HTTP stage，不编造旧结果所需createdAt。Desktop未注入此接缝，仍用原生exportPackage；旧服务端export-package仍501，但Web产品按钮已不调用它。旧接口兼容与直接调用方不能据此宣称全部完成。

1. 每次明确打开固定scheme/currentRevisionId/expectedVersion/新requestId与account epoch，即使详情refetch或有working draft也不无声替换。先点准备，再点下载；准备响应丢失重用原requestId，已知exportId只查原状态，过期/失败需关闭后新意图，不自动重建。
2. save在点击栈内调用宿主。支持File System Access时先打开保存选择器，保留浏览器user activation，再查询原export并逐项核对身份/状态/hash/大小/期限，下载现有受控content接口。完整流有界读取并通过SHA256后才创建writable；写入并close成功后返回delivered。选择器取消不下载也不释放可重试的ready包；权限/磁盘错误不自动另走下载。
3. 无保存选择器时仅从验证后的bytes创建Blob，以安全固定文件名触发浏览器下载并移除临时anchor；object URL最多保留60秒供浏览器消费，页面卸载也由浏览器释放。返回download-started并提示下载列表核对，不声称文件已落盘。UI不展示内部revisionId、文件路径或对象key。
4. 每个异步续步与文件副作用前检查中止信号和账号epoch，账号查询失败也阻断继续。未成功close的writable尽力abort；关闭对话框中止本地下载、清理同账号已知暂存，迟到begin亦清理；换号后不向新owner发旧取消，依赖服务端TTL。文件已交给浏览器或已经写入后无法撤回，不把后续清理失败改报保存失败或自动重下。
5. 同步busy保护重复点击，完成后无重复保存按钮；保存取消保留ready，其他错误就地显示并允许明确重试原包。页面关闭后迟到回执不显示成功；清理是尽力释放访问/名额，物理删除仍由原GC/outbox处理。

B51包含真实生产浏览器的download事件、下载文件readback与实际SHA256断言；HTTP响应和文件内容为合成非ZIP夹具。File System Access的选择器/磁盘失败分支是宿主单测替身，不能替代真实原生选择器、Safari/WebKit或移动系统文件管理器验证。真实后端归档/PG/进程证据沿用B49，三方向真包、刷新恢复、多页面、大文件/自然TTL、Agent/试跑/独立生成包扫描仍按路线图§6.39继续。结果和首败见测试手册§5.44。

## 14. B52：持久导入记录与共享刷新恢复

B52接入F5-R的导入侧。正常账号通过`GET /design-schemes/packages`分页发现原上传，以及`GET /design-schemes/packages/{id}/recovery`核对原执行与回执。复用现有PG stage/import记录，不增加DDL，不在浏览器保存归档、路径、密钥或另一份授权状态。platform可选`packageImport.recovery`和api-client承接只读接口；共享features负责记录列表、预览、原文件重选及明确继续，原生Desktop包流程不改。

1. **服务器事实**：每次恢复读取都验证当前normal账号/会话/身份，列表及游标限于本人。stage和import通过同一SQL快照读取，避免提交过程中拼出“已导入但无回执”。按createdAt/id作PG精度的keyset分页，默认20、最多50；结果不包含objectKey、authorityHash、attempt/seed或私有provenance。响应为`private, no-store`。
2. **内容确认与执行分离**：`confirmed`不代表尚未提交；读取另给not_started/running/retryable/completed、不可继续原因及完成回执。继续资格对原会话授权、版本、确认摘要、租约/剩余有效期和重试上限作只读提示；实际写入口仍重查所有原条件。上传、导入与恢复共用确认摘要和导入政策，不新增另一套费用授权。
3. **完成回执独立于上传TTL**：当前正常owner可以读取过期上传对应的已完成回执；原会话发生变化不自动授予未完成任务的继续资格。已导入草稿被编辑或删除时，回执仍是原记录；查看结果后读取当前详情，不重建草稿，也不再次上传资产。
4. **产品入口**：新建→导入分享包→查看此前的导入记录→核对此记录。恢复读取不会自动确认、导入或下载；未完成上传必须重新选择原文件，完整hash/大小/格式一致才上传。已完成记录的动作是“查看原导入结果”，只读回执；运行中、撤权、过期、重试上限等有明确提示和刷新入口。
5. **关闭不等于取消**：本节更新B50§12第4项。页面卸载/Esc/关闭只中止本地等待，不发DELETE；服务器保留原记录供刷新、新页面核对。明确“取消此上传”经确认，先拒绝正在导入/已完成记录，再调用原取消服务。关闭第二个页面不再误取消第一个页面的请求。未完成对象仍由现有TTL/outbox处理；界面不承诺立即物理删除。
6. **账号与精确预览**：当前账号查询失败隐藏记录与预览；异步读取、继续和结果导航检查epoch。再次确认仍比较原预览确认摘要，不把刷新返回的新预览直接当作用户已经看过。重选文件的错误不会产生新begin请求。

阶段证据包括真实PG/HTTP/S3导入/导出回归、真实ZIP经共享Web页面导入后丢回包、reload和第二页面关闭；后者账号解析是显式测试fixture，HTTP代理只转发实际包请求和注入响应丢失，没有伪造包服务结果。它不证明Better Auth真实登录、三方向原生包交换、付费Agent/worker试跑或自然TTL完整矩阵。B52完整check与数据库条件全量E2E已通过，精确结果、skip及首次失败见测试手册§5.46；通过范围仅为报告中实际执行的场景。

**继续条件**：F5-R导出侧的原归档发现/刷新恢复及不自动重复下载仍待；继续F5-X真实身份与三方向包交换、D4异步Agent产品、F3/F4自然期限/试跑/正式化/新包独立扫描和原E。G-CLOUD-05/06与整包不随本节关闭。

## 15. B53：原导出归档发现与显式恢复

复用现有PG exports记录，新增本人`GET /design-schemes/package-exports`分页发现与`GET /design-schemes/package-exports/{id}/recovery`资格核对。列表只返回原归档公开元数据、选定版本、创建时间及当前方案名称；默认20/最多50，PG createdAt/id精度分页，游标限于本人。它不宣称ready已经满足当前下载资格，也没有服务器“已保存”字段。核对接口重新验证正常账号会话、原授权、归档状态/剩余有效期、正式版本/试跑/封面/来源素材basis；既有content接口仍在对象读取前后复核权限和依据。

列表和核对均不重新打包、不读写对象、不更新租约；响应`private, no-store`，不暴露objectKey、authorityHash、basisHash或私有来源。原会话变化可以看到本人记录但不能继续其旧授权下载；非normal/过期会话不能读恢复记录。没有新增DDL或归档状态机。

共享方案中心新增“导出记录”入口，在方案被删除或版本发生变化后仍可查询原记录；正式方案导出框也可明确打开记录列表。选择记录后锁定原export/request和版本，先显示可继续或不可继续原因，再由用户明确保存。读取失败只重查原记录，不自动begin。账号查询失败隐藏历史、元数据和错误上下文，迟到的旧账号响应不能驱动保存。

**本节更新§13第4–5项生命周期**：关闭/Esc/卸载只中止本地等待和文件IO，迟到begin不再自动取消；一次宿主交付后也不自动取消原归档，避免另一页面失去同一文件。服务端TTL/outbox继续限定可用期限及物理回收；用户可通过独立AlertDialog明确取消，并说明对其他页面的影响、无法撤回已交付文件。取消由现有服务重验owner/状态并登记清理，不直接删对象。刷新不自动下载，也不能靠服务器ready推断此前已保存。

保存仍同步进入现有Web宿主save以保留浏览器用户手势；完整bytes/hash验证、FSA write/close后的delivered与浏览器download-started区分继续成立。Desktop原生保存接缝不变。实际Browser/PG/S3/ZIP恢复测试使用显式合成身份及SQL成功trial资格，覆盖真正的导入/封面/正式化/归档服务；不代替真实Better Auth或Agent/worker试跑联合条件。完整check、数据库条件E2E和对应实际ZIP独立扫描已通过，精确结果/首败/跳过及视觉复核见测试手册§5.47。继续F5-X三方向真包、D4/F3/F4真实产品联合和原E；不关闭父卡或整包。

## 16. B54：真实登录与三方向 v2 方案包往返

**实现边界**：本批补齐联合验收设施和产品路径证据。复用`createAuth`、`AccountService`登录提交/授权检查及正式`createApp`装配，不向业务路由注入owner/session。既有API集成测试的受控New API实现抽成共用fixture；S3采用回环HTTP协议服务，实际AWS SDK、PG迁移与包服务均运行。无新增生产API、PG迁移、保存状态机或第二份ZIP解析器。

1. **身份与隔离**：实际注册/登录生成Better Auth cookie；API原会话中间件逐请求核对。新增PG专项覆盖其他owner的读取/上传拒绝、无cookie/伪造cookie或owner头拒绝、恶意Origin写入拒绝、真实登出后的旧cookie拒绝、新登录可发现原请求但不能继承原写授权。Web交换还直接验证他人export状态/恢复/内容/取消均404，拒绝不改归档或对象写入数。
2. **Web→Web**：两个独立浏览器context分别真实登录。发送方在生产页面上传实际v2 ZIP、预览、确认导入，正式包经实际服务生成并由浏览器下载落盘，接收方用文件选择入口导入。核对新scheme/revision/asset身份、draft与无成功trial，原owner方案/导出历史隔离；PC与移动Chromium分别执行。
3. **Desktop→Web**：实际桌面新建导入入口→preload/IPC/SQLite；为导出准备显式trial资格fixture，正式化后重启新PID，从更多菜单实际导出文件；Web真实登录后从页面导入。来源、材料、图片、完整正文、提示词模块与编译内容逐字段比较，允许新身份/时间和封面降为示例的既定导入语义。
4. **Web→Desktop**：上一链真实Web文件交付后，经原生导入入口再导入同一本地工作区；新草稿身份与来源/素材一致，原正式方案仍在。真实读取新SQLite资产行及对应受管图片文件，逐份SHA256匹配。共享codec再次校验导出文件内部条目/字节与manifest关系。
5. **证据边界**：New API是受控上游而非官方活体账号；S3是协议替身而非生产桶。trial资格用SQL/本地repository夹具提供，封面/正式化走实际服务，不能记为真实worker试跑；桌面选择器采用既有E2E路径注入，证明实际文件IO，不证明系统对话框交互。三方向本批使用v2归档，v1/畸形语料两端一致、自然TTL/最大文件/中断全部组合、Safari/移动文件管理器仍按F5-X与父卡补验。

最终语料使用3张不同颜色/尺寸/hash的PNG和Unicode名称，两端入口先断言不同内容，再比较往返完整语义，避免相同图片掩盖映射错误。全量与最终语料专项的源码身份分列，精确命令/结果和首败见[测试手册§5.48](./V25-MIGRATION-TESTING.md)。

**产品未闭合项**：Web宿主尚未注入方案图片地址解析，文件内容正确不证明列表/详情相册像素已显示。接线与实际解码/翻图/灯箱、身份撤销/删除/错误态按任务卡§5.2继续。v1/负语料全方向、最大包/自然TTL、原生picker/Safari和实际Agent/worker联合仍待；本批只完成v2身份/文件交换切片。

## 17. B55：文件证据到图片显示

B55已接Web受保护方案图片，共享列表/Inspector/详情/相册/灯箱具备加载、可读失败与明确重试；实际不同图片解码、像素/hash、焦点恢复及身份拒绝已有本机证据。

B54末尾记录的Web图片缺口已由本批处理，原文保留当时边界。不同图片真实解码、列表/详情/相册/灯箱、错误重试与身份拒绝见[测试手册§5.49](./V25-MIGRATION-TESTING.md)。本次完整回归同时运行三方向v2包交换，8份实际ZIP独立扫描。SQL成功trial依然只是fixture，实际Agent/worker联合以及v1/最大包/自然TTL/系统文件选择与Safari待验；不是整个F5-X完成。

<!-- B61:START -->
## B61 阶段补充：原生历史素材与真实试跑归档

原生云端history snapshot冻结完整prompt及imageAssetId，来源文件行没有第二个对象/正文excerpt。导出现在从同一冻结snapshot读取完整prompt、从已验证受管asset读取图片；仍核对文件大小/hash和图片MIME/尺寸，不向原历史查询或放宽所有权。新增完整归档读回与图片/提示词篡改3P。

新版本导出仍要求本revision成功trial与本revision封面，继承旧封面不会自动获得导出资格；正向流程明确选新输出。归档包含当前document引用、选定封面及本revision资产，排除无关旧版本资产；重新导入是新草稿，不继承成功试跑。

新增生命周期回归1P、历史导出/篡改回归3P、实际API联合与导出42P；最终正向浏览器6P/0S/0F/0 flaky（120.974秒），完整check36/36（24.623秒）。源码1554项摘要`d0b30e3906f758d9019c39444fc528da306333dc83d5b444b0c5c81d97b87bcc`，相对B60新增7/修改8/删除0；源码及截至专项的16份实际ZIP扫描零命中/错误。故障增量源码1556项`600e79e2a45394e468c056bdc1455ed66224d3f12204893b8d5f7623cc655b8d`，只新增2个测试文件；API3P（13.444秒）、浏览器8P（78.449秒）、最终check36/36（6.683秒）。全量实际28ZIP及2份纯文本UI下载替身正确分类扫描零命中/错误；最新源码复扫零命中/错误。 历史正向全量414P/7S对应1554项快照，之后故障专项对应1556项；最新跨宿主修复与测试对应1559项，结果与适用回归见测试手册§5.55最新增量。J4-b三形态内容往返正向已验，系统picker取消仍由F5-X.H补验；J5详情读取故障、撤权/版本竞争、实际异常进程与资产清理组合，F5-X其余及原E/平台包/生产回滚仍待。B61、迁移整包和管理员前置保持开放。 详见[测试手册§5.55](./V25-MIGRATION-TESTING.md)、[后续任务§5.7.6](./V25-MIGRATION-GOALS.md)与[阶段报告](../../tests/v25/.results/b61/validation-summary.json)。
<!-- B61:J4 START -->
**J4-b最新进展（2026-09-10）**：B61跨宿主增量：纯描述、GitHub、历史素材三类真实新Agent结果均通过 Web→Desktop→Mobile Web（3P，83.409秒）；桌面以实际BYOK试跑获得本版资格，选新封面正式化，经新PID重启再导出，由另一Web账号导入为无资格新草稿。修复桌面导出按扩展名覆盖已接纳文本MIME的问题，完整分享单测21P、check36/36；本轮留存13份真实ZIP（最终专项6份）及源码扫描零命中/错误。 同源码完整Electron及受影响网页回归：160P/2S/0F/0 flaky（1004.633秒）；这不是全部Web用例重跑。 J4-b三形态内容往返正向已验，系统picker取消仍由F5-X.H补验；J5详情读取故障、撤权/版本竞争、实际异常进程与资产清理组合，F5-X其余及原E/平台包/生产回滚仍待。B61、迁移整包和管理员前置保持开放。 详见[测试手册§5.55](./V25-MIGRATION-TESTING.md)。
<!-- B61:J4 END -->
<!-- B61:PROMOTE-CONFLICT START -->
2026-09-12：双页面改封面导致的旧转正请求409及显式恢复已验，修改/上游更新两种路径均完成真实新试跑和包往返。导出仍要求本revision封面，恢复流程由用户明确选回；不自动覆盖另一页选择或重新生图。继续J5-c上游凭据撤销、素材与其他故障组合及J5-f；F5-X、原E、四端/平台发布与生产回滚仍待。这里只关闭封面变化导致的promote CAS场景，不据此关闭所有并发交错或B61；管理员前置保持开放。 详细流程、首败与同源码报告见[测试手册§5.55](./V25-MIGRATION-TESTING.md)。
<!-- B61:PROMOTE-CONFLICT END -->
<!-- B61:END -->

<!-- B62:CORPUS START -->
2026-09-13（运行UTC 2026-09-12）：B62已修复桌面导入旧版方案包后来源/图片在共享详情中丢失：两宿主共用既有旧格式内容映射，桌面重绑来源与资产ID、保存完整正文/图片、隔离旧scan，导入仍为无试跑资格的新草稿。 12份永久语料的file/bytes reader一致；真实PC Web、Mobile Web、Electron共36个导入场景通过（6次合法新草稿、30次坏包拒绝），并验证刷新/新PID重启后的内容、原数据不变与图片hash。当前check36/36通过；API导入/导出/身份专项80P在此前6cc49667…执行，其API及共享生产源码与当前逐文件一致，之后仅测试比较helper变化。当前1579项源码5171ca41…的源码与三轮留存6份合法ZIP扫描零命中/错误；30份故意无效语料另记拒绝，不计为安全交付ZIP。 最终受影响回归163P/2S/0F/0flaky（1180.304秒）：完整Electron153P/2S，PC/移动Web各5P；两项skip分别缺真实登录凭据和生图key，保留为发布条件。四次实际宿主运行累计保存72个文件副本，其中30份有效ZIP扫描零命中/错误、42份故意无效输入另记拒绝；包含复制的picker输入，不把副本数写成独立测试数。最终回归自身新增22份有效ZIP和11份坏包输入。 B62/F5-X.C四项原定验收已通过，仅关闭本卡。继续F5-X.L容量及资源/失败清理，再接T自然期限、H系统文件交付与原E、平台包、生产回滚和远程MCP；完整迁移及管理员前置保持开放。
<!-- B62:CORPUS END -->

<!-- F5-X:L-API-PREPARATION START -->
2026-09-13：F5-X.L容量准备已推进到真实API：12份保存样本完成24次file/bytes reader判定和12条实际HTTP导入/拒绝流程（6允许、6拒绝），覆盖原始合同的manifest、条目数、64MiB条目、256MiB归档/展开量与压缩比。6份当前允许ZIP扫描零命中/错误。尚未完成永久回归集成、Web UI/Electron入口、并发资源与中途写入失败清理，F5-X.L继续开放。 实际最大reader峰值约1.34GiB，API测试进程包含内存S3与客户端，均不代表生产并发内存已验。首次大样本图片解码问题已改用既有可完整解码夹具重生成，旧失败/输入保留，生产代码未改。详见[测试手册§5.57](./V25-MIGRATION-TESTING.md)和[逐样本记录](../../tests/v25/.results/b63/capacity-host-v1-results.json)。
<!-- F5-X:L-API-PREPARATION END -->
