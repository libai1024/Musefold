# V25-MIGRATION-CARDS — v2.1 → v2.5 全功能迁移任务卡

> **性质**:实施台账(非规范源)。本文只记录迁移范围、依赖、证据和进度,不定义产品语义。
>
> **裁决顺序**:当前源码/数据库迁移/自动化测试 → v2.5 四份规范文档 → `v2.5-baseline` 源码与 v2.1 历史文档。实践方式见 [V25-FEATURE-DEV-GUIDE](./V25-FEATURE-DEV-GUIDE.md)。
>
> **UI 基线**:信息架构、入口、动作、状态、快捷键和功能结果与 `v2.5-baseline` 基本一致。改进只允许提升可达性、错误恢复、响应式、性能、无障碍、token 化与安全;有意差异须登记到 [V25-UI-SPEC §9](./V25-UI-SPEC.md#9-与旧版差异登记表有意变化已批准)。
>
> **排除与保留**:桌宠完全冻结,不迁移不重构。豆包内部 renderer、主进程算法、登录同步和数据库迁移不迁移;v2.5 必须保留可达入口,入口只转接既有能力。

## 0. 卡片规则

<!-- B61:START -->
### 2026-09-10 B61 当前阶段（未闭合）

B61进行中：新增取消前后、上游unknown和丢受理回包联合回归，实际API3P及PC/移动8P。真实generation worker已接入；纯描述、GitHub和历史素材三形态在PC/移动Web完成新方案出图、封面、正式化和实际方案包往返，GitHub还完成修改与上游更新后的独立新试跑/新封面/promote。修复新版本加载时Agent进度窗口重建，以及原生云端历史素材导出缺失完整内容。

新增生命周期回归1P、历史导出/篡改回归3P、实际API联合与导出42P；最终正向浏览器6P/0S/0F/0 flaky（120.974秒），完整check36/36（24.623秒）。源码1554项摘要`d0b30e3906f758d9019c39444fc528da306333dc83d5b444b0c5c81d97b87bcc`，相对B60新增7/修改8/删除0；源码及截至专项的16份实际ZIP扫描零命中/错误。故障增量源码1556项`600e79e2a45394e468c056bdc1455ed66224d3f12204893b8d5f7623cc655b8d`，只新增2个测试文件；API3P（13.444秒）、浏览器8P（78.449秒）、最终check36/36（6.683秒）。全量实际28ZIP及2份纯文本UI下载替身正确分类扫描零命中/错误；最新源码复扫零命中/错误。

历史正向全量414P/7S对应1554项快照，之后故障专项对应1556项；最新跨宿主修复与测试对应1559项，结果与适用回归见测试手册§5.55最新增量。J4-b三形态内容往返正向已验，系统picker取消仍由F5-X.H补验；J5详情读取故障、撤权/版本竞争、实际异常进程与资产清理组合，F5-X其余及原E/平台包/生产回滚仍待。B61、迁移整包和管理员前置保持开放。 详见[测试手册§5.55](./V25-MIGRATION-TESTING.md)、[后续任务§5.7.6](./V25-MIGRATION-GOALS.md)与[阶段报告](../../tests/v25/.results/b61/validation-summary.json)。
<!-- B61:J4 START -->
**J4-b最新进展（2026-09-10）**：B61跨宿主增量：纯描述、GitHub、历史素材三类真实新Agent结果均通过 Web→Desktop→Mobile Web（3P，83.409秒）；桌面以实际BYOK试跑获得本版资格，选新封面正式化，经新PID重启再导出，由另一Web账号导入为无资格新草稿。修复桌面导出按扩展名覆盖已接纳文本MIME的问题，完整分享单测21P、check36/36；本轮留存13份真实ZIP（最终专项6份）及源码扫描零命中/错误。 同源码完整Electron及受影响网页回归：160P/2S/0F/0 flaky（1004.633秒）；这不是全部Web用例重跑。 J4-b三形态内容往返正向已验，系统picker取消仍由F5-X.H补验；J5详情读取故障、撤权/版本竞争、实际异常进程与资产清理组合，F5-X其余及原E/平台包/生产回滚仍待。B61、迁移整包和管理员前置保持开放。 详见[测试手册§5.55](./V25-MIGRATION-TESTING.md)。
<!-- B61:J4 END -->
<!-- B61:AUTHORITY-READ START -->
**授权与读取恢复最新增量（2026-09-10）**：B61新增正式回归：授权失效/真实登出发送前后及版本冲突API6P（25.606秒）；PC/移动故障专项12P/0S/0F/0 flaky（127.780秒），含原取消/unknown/丢回包8项与新增事件/任务读取失败、详情错误态及显式重试4项。check36/36（33.404秒，30缓存），源码扫描零命中/错误。 当前仅测试及fixture变化，1561项源码摘要0cde8ba7…；J5实际浏览器撤权/跨owner/版本与promote组合、材料型交叉故障、实际bin异常重启/自然租约/stale epoch及对象/数据库清理仍待。F5-X、原E、平台/生产与管理员前置不随本片关闭。 证据与首次失败见[测试手册§5.55](./V25-MIGRATION-TESTING.md)。
<!-- B61:AUTHORITY-READ END -->
<!-- B61:PROCESS-NATURAL START -->
**进程与自然租约增量（2026-09-10）**：B61新增实际进程3项已验：领取前强杀后新PID一次成功；发送后强杀/暂停经生产10分钟租约自然到期与分钟巡检收敛unknown，图像请求仍各1次；旧暂停进程恢复后终态/回执不变、无新增资产。API完整集成496P、Worker完整集成92P，网页故障专项12P；最终check及源码扫描通过。 自然领取后未发送的epoch替换、取消交错、迟到上传/新引用保护、J5-e与F5-X/原E、平台包/生产回滚仍待；管理员前置保持开放。 首次失败、复验和源码身份见[测试手册§5.55](./V25-MIGRATION-TESTING.md)。
<!-- B61:PROCESS-NATURAL END -->
<!-- B61:ASSETS-EPOCH START -->
**资产与自然租约增量（测试2026-09-10，证据回填2026-09-12）**：B61新增7项资产/进程联合已验：参考图篡改或删除时零图像发送；实际10分钟租约后未发送任务由新PID以epoch2成功，取消交错与迟到PUT隔离；写入后删除失败保留对象并跨新PID等待实际5分钟退避再清理。完整API503P、Worker92P，网页正向与故障18P；check36/36及源码、6份实际新方案ZIP扫描通过。 PG输出落库/丢提交回包、cleanup与新引用竞争、J5其余/F5-X/原E及全平台/生产回滚仍待；本片未证明S3连接断开，完整迁移与管理员前置保持开放。 详见[测试手册§5.55](./V25-MIGRATION-TESTING.md)。
<!-- B61:ASSETS-EPOCH END -->
<!-- B61:ASSETS-WIRE START -->
**S3连接中断增量（2026-09-12）**：B61补齐2项真实S3回包断线测试：写成后首次断线由SDK同key重传成功；持续断线后原任务保留unknown费用，新PID维护删除孤立对象。两例各1次图像调用，成功资产跨重启/维护保留，失败不产生trial。最终完整API505P、Worker92P，check36/36及源码扫描通过。 继续PG输出落库冲突/提交回包丢失、cleanup与新引用争用、其余J5/F5-X/原E及全平台/生产回滚；B61和整包未关闭，管理员尚未开始。 源码、首次失败与实际证据见[测试手册§5.55](./V25-MIGRATION-TESTING.md)。
<!-- B61:ASSETS-WIRE END -->
<!-- B61:ASSETS-DATABASE START -->
**数据库输出与提交回包增量（2026-09-12）**：B61新增2项实际数据库故障已验：输出登记错误使generation/方案资产、trial和完成事件整体回滚；PG已提交而回包断线时，独立连接证实成功，新PID清理保留受引用图片。两例各1次图像调用、原版本/费用回执不被重启改写。完整API507P、Worker92P、网页18P，check36/36及源码/6份新方案ZIP扫描通过。 接续GC1真实新引用与清理竞争、其余J5数据库/权限/版本组合及F5-X/原E、全平台与生产回滚；B61和整包未关闭，管理员尚未开始。 证据及注入边界见[测试手册§5.55](./V25-MIGRATION-TESTING.md)。
<!-- B61:ASSETS-DATABASE END -->
<!-- B61:CLEANUP START -->
**引用与清理竞争增量（2026-09-12）**：B61新增真实新Agent引用/清理两种次序2项及Worker批次回收1项已验。修复已采用的过期参考图每次维护反复入队10轮的问题：候选排除方案引用，加锁后再次复查；保留最终对象保护。完整API509P、Worker93P、网页18P，check36/36及源码/6份新方案ZIP扫描通过。 继续J5浏览器撤权/跨owner/版本promote与素材交叉故障、在途预检后引用变化等剩余并发；F5-X自然TTL/格式/容量/系统文件交付、原E、全平台和生产回滚仍待。B61、迁移整包及管理员前置保持开放。 边界与真实证据见[测试手册§5.55](./V25-MIGRATION-TESTING.md)。
<!-- B61:CLEANUP END -->
<!-- B61:INFLIGHT-ISOLATION START -->
**在途预检与浏览器身份增量（2026-09-12）**：B61新增在途参考图读取与物理清理交错1项已验：旧GET返回有效字节，事务内重验仍404，零图像调用/新任务/回执/trial。双页面实际登出及独立账号隔离在PC/移动4场景通过，重新登录只恢复原结果。API定向9P，统一check36/36及源码扫描通过；本轮仅测试变化。 接续J5-c真实provider撤key、working-draft promote版本竞争与素材型交叉故障，再完成F5-X/原E/全平台/生产回滚。B61、整包及管理员前置仍开放。 当前1568项8fdc36f1…；API9P在9109d9e9…执行，其API测试/生产源码与当前逐文件一致，后续仅给网页测试追加独立账号检查。最近完整API509P/Worker93P/网页18P及6ZIP扫描属于上轮69d5898e…，本轮未重跑完整后端或全部E2E，不写成全量510P。 详见[测试手册§5.55](./V25-MIGRATION-TESTING.md)。
<!-- B61:INFLIGHT-ISOLATION END -->
<!-- B61:PROMOTE-CONFLICT START -->
2026-09-12：双页面改封面导致的旧转正请求409及显式恢复已验，修改/上游更新两种路径均完成真实新试跑和包往返。导出仍要求本revision封面，恢复流程由用户明确选回；不自动覆盖另一页选择或重新生图。继续J5-c上游凭据撤销、素材与其他故障组合及J5-f；F5-X、原E、四端/平台发布与生产回滚仍待。这里只关闭封面变化导致的promote CAS场景，不据此关闭所有并发交错或B61；管理员前置保持开放。 详细流程、首败与同源码报告见[测试手册§5.55](./V25-MIGRATION-TESTING.md)。
<!-- B61:PROMOTE-CONFLICT END -->
<!-- B61:PROVIDER-RECOVERY START -->
2026-09-12：上游按实际合成凭据撤销的HTTP401与显式恢复已验，包含纯文本和参考图输入。实测还修复了工作台迟到会话加载覆盖新方案正文/图片的问题；主动切会话仍恢复目标内容。完整E2E首轮112P/1F后中止（337项跳过或未执行）；焦点修正后的专项6P/2F进一步定位toast遮挡。补齐正常指针等待后，三形态试跑/版本竞争/导出重导入专项8P/0F/0S/0flaky。完整Web/移动/Electron复验尚未完成，不记整包通过。 详细范围、首败和源码报告见[测试手册§5.55](./V25-MIGRATION-TESTING.md)。继续J5-a/b素材与取消/unknown/丢回包/读取恢复组合及J5-f最终收口，再接F5-X、原E、四端/平台发布和生产回滚。上游采用本地受控HTTP，不是付费供应商实网；恢复是重新启用同一合成key，不声称验证key轮换或管理员代授权。B61、完整迁移与管理员前置仍开放。
<!-- B61:PROVIDER-RECOVERY END -->
<!-- B61:MATERIAL-FAULTS START -->
2026-09-12：B61已扩展纯文本/参考图输入×取消前后、unknown、受理回包丢失、事件/任务读取中断共六类故障的双视口测试；参考图经真实上传，核对正式run的冻结引用ID、实际图像端点和字节SHA256。 素材故障24项与修改/更新30项联合专项54P/0F/0S/0flaky（642.820秒）。 同源码API完整集成514P/0F/0S（673.167秒）；同源码Worker完整集成93P/0F/0S（53.911秒） 同源码完整E2E 455P/7S/0F/0flaky（2284.791秒），跳过项按实际项目/原因保留；当轮真实归档和明确UI替身分别扫描通过。 B61原boundary/verify的12项验收对照已通过，关闭D4-J联合试跑批次；接续F5-X旧格式/异常/容量/自然期限/原生交付、原E数据与同步、四端/平台发布及生产回滚。管理员仍在全部迁移闭合后开始。
<!-- B61:MATERIAL-FAULTS END -->
<!-- B61:END -->

### 2026-09-10 B60 历史增量

B60已接共享上游更新：免费检查固定版本、逐变化来源采用、独立绑定会话版本的文本授权和原执行恢复；仅编译实际变化来源，未变化来源及图片保持。创建/修改/更新产品均已有实际后端合流证据，下一步是真正生图worker试跑、封面、正式化与方案包联合。

B60初期组件专项91P（最终check含恢复回归后features716P）、实际API三文件45P、PC/移动真实服务专项18P；完整check36/36，最终数据库条件完整E2E **408P / 7S，0F/0 flaky**（1625.283秒）。最终源码1547项摘要`33ae75cbe64bd849c7d7e378086afc23914f71dcbef95d42d91efa202b4e063b`，相对B59新增1/修改8/删除0；源码1454文件/1既有归档及本轮22份实际ZIP扫描均零命中/错误。 见[测试手册§5.54](./V25-MIGRATION-TESTING.md)及[任务卡§5.7.5](./V25-MIGRATION-GOALS.md)。只关闭共享更新D4-E切片，全部父卡及管理员前置继续。

### 2026-09-10 B59 历史增量

B59已接共享云端方案修改：同次读取冻结revision/version，独立最多1次文本授权，丢回包按原执行恢复，连续修改精确working draft；取消、冲突、撤权和unknown保留原正式版。下一步是免费上游检查/独立更新授权，以及真正生图worker试跑→封面→正式化→专用包联合。

B59组件专项83P、实际API三文件28P、PC/移动真实服务专项12P；完整check36/36（31缓存），最终数据库条件完整E2E **390P / 7S，0F/0 flaky**（1296.018秒）。最终源码1546项摘要`6f9aa0a1cc8821f29f92c5392ab6ae698b8b719b3f2c1f5df8f66f6dbc8f164f`，相对B58新增1/修改16/删除0；源码1453文件/1既有归档，以及本轮22份实际ZIP扫描均零命中/错误。 详见[测试手册§5.53](./V25-MIGRATION-TESTING.md)及[任务卡§5.7.4](./V25-MIGRATION-GOALS.md)。只关闭D4-D修改切片，整包、父卡与管理员前置继续；真实/替身边界见本批报告。

### 2026-09-09 B58 历史增量

B58已验证共享云端Agent创建与实际Better Auth/Hono/PG/Graphile合流，涵盖纯描述、两GitHub来源、历史素材、丢回包/双页恢复和原请求重放、取消/撤权及未知费用。云端修改/更新入口、真实生图试跑到正式化与包交付的联合流程仍待。

B58真实服务PC/移动专项14P、关联API集成71P；完整check36/36，数据库条件完整E2E 378P / 7S，0F/0 flaky（1208.238秒）。最终源码1545项摘要`4ad6c44b0517c78df78854e500f13c0d5ee3429e1414510389505e145a758e52`，相对B57新增5/修改3/删除0；源码扫描1452文件/1既有归档、本轮10份实际方案ZIP独立扫描均零命中/错误。 详见[测试手册§5.52](./V25-MIGRATION-TESTING.md)；接续[任务卡§5.7.3](./V25-MIGRATION-GOALS.md)。仅B57/B58创建与恢复切片闭合，全部父卡及管理员前置继续。

### 2026-09-09 B57 历史增量

B57已接共享云端创建的独立文本授权、逐源确认、本人任务分页与原执行恢复；工作台只在completed后报草稿成功。页面协议已验，实际Agent服务产品合流、修改/更新及完整试跑链仍待。 结果见[测试手册§5.51](./V25-MIGRATION-TESTING.md)，继续[任务卡§5.7.2](./V25-MIGRATION-GOALS.md)。B57实际产品联合、父卡与管理员前置保持开放。

### 2026-09-09 B56 历史增量

B56已复用七个异步Agent客户端入口并接入可选gateway，补严格入参/执行身份/事件校验；新增本人只读执行历史、不可变创建时间和稳定分页。共享恢复页面、创建授权及修改/更新尚待接入。 结果见[测试手册§5.50](./V25-MIGRATION-TESTING.md)，下一步见[路线图§6.44](./V25-MIGRATION-ROADMAP.md)和[任务卡§5.7.1](./V25-MIGRATION-GOALS.md)。仅基础切片通过，父卡和管理员前置仍开放。

### 2026-09-09 B55 历史增量

B55已接Web受保护方案图片，共享列表/Inspector/详情/相册/灯箱具备加载、可读失败与明确重试；实际不同图片解码、像素/hash、焦点恢复及身份拒绝已有本机证据。 见[测试手册§5.49](./V25-MIGRATION-TESTING.md)与[路线图§6.43](./V25-MIGRATION-ROADMAP.md)。继续F5-X剩余兼容/环境边界、D4异步Agent共享产品与F3/F4真实试跑联合，再按原E完成可靠性、数据、四端及发布。整包未闭合，管理员未启动。

### 2026-09-09 B54 历史增量

B54已验证实际Better Auth登录及v2方案包三个交换方向，完整正文/来源/图片映射和新草稿身份一致；不同颜色/尺寸/hash及Unicode语料复验通过。实际外部上游、worker试跑和系统picker仍为独立待验条件。 见[测试手册§5.48](./V25-MIGRATION-TESTING.md)、[专用包§16](./V25-PACKAGE-VALIDATION.md)与[路线图§6.42](./V25-MIGRATION-ROADMAP.md)。下一步Web方案图片接线→F5-X剩余兼容/边界→D4异步Agent与F3/F4真实试跑联合，再按原E完成数据、四端及发布验收。整包未闭合，管理员未启动。

### 2026-09-09 B52 历史增量

服务器导入记录与共享恢复已接：只读分页/原回执、刷新/新页核对、原文件重选、关闭保留与明确取消。恢复不自动确认/导入，完成回执不重建已删除草稿。见[测试手册§5.46](./V25-MIGRATION-TESTING.md)、[专用包§14](./V25-PACKAGE-VALIDATION.md)及[路线图§6.40](./V25-MIGRATION-ROADMAP.md)。F5-R导出恢复、F5-X三方向真包、D4/F3/F4与原E仍开放；本批不关闭P01或整包，管理员未启动。

### 2026-09-09 B51 历史增量

正式包共享准备/下载与Web文件交付已消费B49新接口；精确版本/原请求、完整bytes/hash、取消/换号/失败和尽力清理有测试。File System Access写入close与浏览器下载交接分别返回delivered/download-started。窄屏详情标题及待验证说明的动作挤压已修复。见[测试手册§5.44](./V25-MIGRATION-TESTING.md)、[专用包§13](./V25-PACKAGE-VALIDATION.md)及[路线图§6.39](./V25-MIGRATION-ROADMAP.md)。F5-R刷新恢复/F5-X三方向真包、D4/F3/F4与原E仍开放；本批不关闭P01或整包，管理员未启动。

### 2026-09-09 B50 历史增量

云端方案包导入页面已接共享packageImport gateway：文件/格式选择、上传后预览、精确确认、同一回执重试和草稿定位；账号切换或状态核对失败禁用并隐藏旧预览，关闭/迟到上传尽力清理。Desktop原生入口保持。见[测试手册§5.43](./V25-MIGRATION-TESTING.md)、[专用包§12](./V25-PACKAGE-VALIDATION.md)及[路线图§6.38](./V25-MIGRATION-ROADMAP.md)。F5的导出宿主交付/刷新恢复/三方向真包往返、D4与原E保持开放；B50不关闭P01或整包。

### 2026-09-09 B49 历史增量

本人精确正式版本归档、PG0021固定请求/资格摘要、取消/失效和受控下载新接口已接，api-client验证完整大小/hash；不把ready称为交付完成。来源图片兼封面保留原角色并生成归档副本，实际进程中断/PG回滚/对象清理有证据。最新结果/首败见[测试手册§5.42](./V25-MIGRATION-TESTING.md)，边界见[专用包§11](./V25-PACKAGE-VALIDATION.md)。按[路线图§6.37](./V25-MIGRATION-ROADMAP.md)接F5/D4、F3/F4剩余联合与原E；整包和管理员前置继续开放。

### 2026-09-09 B48 历史增量

实际import-package已接PG0020、原确认授权、固定身份/回执与完整来源/资产/新草稿事务；每次尝试独立对象key，先登记清理再PUT，旧epoch不能提交。真实结果/失败见[测试手册§5.41](./V25-MIGRATION-TESTING.md)，行为和限制见[包验证§10](./V25-PACKAGE-VALIDATION.md)。按[路线图§6.36](./V25-MIGRATION-ROADMAP.md)补F3联合条件、正式导出、shared产品及原E；原父卡、整包与管理员前置继续开放。

### 2026-09-09 B47 历史增量

API私有导入内容准备复用共享codec/文档桥，固定新实体ID、完整来源/历史正文/素材与编译证据，真实解码图片并归一摘要；旧预览只保留example，歧义来源拒绝。结果及首败见[测试手册§5.40](./V25-MIGRATION-TESTING.md)，边界见[包验证§9](./V25-PACKAGE-VALIDATION.md)。尚未接HTTP/PG/S3晋升，原子导入仍待[路线图§6.35](./V25-MIGRATION-ROADMAP.md)，再F4/F5/D4/原E；父卡、整包和管理员前置不关闭。

### 2026-09-09 B46 历史增量

云端方案包新增持久上传/状态/确认/取消和api-client传输，PG0019与原对象注册/outbox在PUT前提交；有界实际字节/hash、v1/v2共享解码、身份复核与精确确认、上传租约/取消/过期和新PID恢复已接。真实结果、首败和最终源码见[测试手册§5.39](./V25-MIGRATION-TESTING.md)，明确边界见[包验证§8](./V25-PACKAGE-VALIDATION.md)。按[路线图§6.34](./V25-MIGRATION-ROADMAP.md)完成原子导入/正式导出下载、shared产品及原E；旧prepare/import/export和整包、管理员前置仍开放。

### 2026-09-09 B45 历史增量

legacy文档契约及双向桥归入contracts，桌面旧入口兼容；共享Node包解码v1完整正文/来源索引，版本创建/父关系/约束与编译证据、share-import来源种类可往返。新导出固定en-US排序，旧包仍校验候选locale的精确摘要，最终v2结构与版本不变。实际结果、首败、四个Node locale/真实数据库/替身及工具证据缺口见[测试手册§5.38](./V25-MIGRATION-TESTING.md)。按[路线图§6.33](./V25-MIGRATION-ROADMAP.md)实施F2上传暂存与确认、F3/F4事务导入下载，再F5/D4/原E；父卡、整包及管理员前置继续开放。

### 2026-09-09 B44 历史增量

桌面导入方案经modify/update继续保留继承素材、正确来源和完整历史正文；core统一版本可用素材读取，export/prepare/run共用，原正式版和新版本试跑/封面门槛保持。更新新来源/图片事务提交，失败回滚并清理已知新目录；新增真实Electron新PID导出再导入。Windows路径分隔符审查修复以Node win32/posix语义专项验证，不能冒充Windows产物测试。结果、首败、源码与未验范围见[测试手册§5.37](./V25-MIGRATION-TESTING.md)。接续[路线图§6.32](./V25-MIGRATION-ROADMAP.md) F1剩余/F2–F5/D4/原E；P01/G-CLOUD父卡、整包和管理员前置仍开放。

### 2026-09-09 B43 历史增量

已抽取contracts单源v1/v2合同和Node共享ZIP编解码，桌面与API消费同一实现；有界解析、CRC/路径/别名/内容引用及真实hash核验，桌面新素材导入重映射、受管JSON/IPC重读、再次导出保持历史正文与仓库图片。当前结果、首败和源码身份见[测试手册§5.36](./V25-MIGRATION-TESTING.md)，格式见[包验证](./V25-PACKAGE-VALIDATION.md)。云端三个包接口仍501，导入后修订兼容与云暂存/确认/事务/下载接续[路线图§6.31](./V25-MIGRATION-ROADMAP.md)；P01/G-CLOUD父卡/全生命周期/产品/发布与整包仍开放，管理员未启动。

### 2026-09-09 B41 历史增量

新异步Agent支持本人历史图片与选定正向提示词：核对owner/run/asset、完整字节和提示词快照，固定独立副本和溯源；GitHub混合输入不丢历史文本，修改/更新保留来源与图片，实际详情和图片试运行准备可消费。没有视觉解析，也未接共享页面或方案包。阶段结果、首败、正式样本与真实PID的边界见[测试手册§5.34](./V25-MIGRATION-TESTING.md)。仅关闭本批后端切片；按[路线图§6.29](./V25-MIGRATION-ROADMAP.md)继续R1仓库图片、D3/D4和原治理/发布，管理员未开始。

### 2026-09-09 B40 历史增量

新异步Agent创建接通本人已上传图片：固定独立副本、顺序和真实元数据，模型前校验，草稿资产与完成事件原子保存。实际图片详情与含图片的试运行准备、取消/未知/强杀/新PID恢复均有专项证据；没有视觉解析或自动增加必需输入。最终门禁、首败和格式前后源码差异见[测试手册§5.33](./V25-MIGRATION-TESTING.md)，协议见[素材§12](./V25-CLOUD-SOURCE-VALIDATION.md)。仅关闭B40上传切片；历史/仓库图片、包/共享产品、P01/G-CLOUD父卡及原治理/发布和整包继续开放。下一目标[路线图§6.28](./V25-MIGRATION-ROADMAP.md)，管理员未开始。

### 2026-09-09 B39 历史增量

新异步上游更新后端完成免费检查、原跟踪ref/新SHA冻结、逐变化源确认、独立文本授权、共享编译与原子修订。修复了更新后新文档引用新来源、数据库却继承旧绑定导致不能试运行的问题；旧修订引用保留。实际结果、首败与边界见[测试手册 §5.32](./V25-MIGRATION-TESTING.md)，协议见[上游更新 §11](./V25-CLOUD-SOURCE-VALIDATION.md)。仅关闭B39后端切片；素材/包/共享产品及P01/G-CLOUD父卡/整包继续，下一步[路线图 §6.27](./V25-MIGRATION-ROADMAP.md)，管理员未启动。

### 2026-09-09 B38 历史增量

新异步modify后端完成精确owner/base/version冻结、独立单次Reviser、原子新修订/完成事件；正式current不变，新稿为working draft，原来源/资产保留。22项专项含实际SIGKILL/新PID、生产Graphile bin和试运行准备；最终门禁、首次失败、同源码与真实/替身边界统一见[测试手册 §5.31](./V25-MIGRATION-TESTING.md)。仅关闭B38切片，不关闭G-CLOUD-02/P01、共享产品或整包；下一条按[路线图 §6.26](./V25-MIGRATION-ROADMAP.md)执行上游更新，管理员未开始。

### 2026-09-09 B37 历史增量

新异步Agent create的独立文本资格、持久调用/unknown、固定来源报告与变量校验、事务草稿已验；详情与正式图像prepare可以消费，普通图像binding保持不变。原同步Agent/modify/checkUpdate、素材/包/共享界面仍未闭合。准确结果和范围见[测试手册 §5.30](./V25-MIGRATION-TESTING.md)、[文本执行 §9](./V25-CLOUD-SOURCE-VALIDATION.md)；可复制的下一目标见[路线图 §6.25](./V25-MIGRATION-ROADMAP.md)。仅关闭B37，不关闭P01/G-CLOUD-02父卡、整包或管理员前置。

### 2026-09-09 B36 历史增量

共享 Analyst/Compiler 契约、三角色提示词与 JSON 提取已归入 contracts/domain，桌面实际创建/修订继续消费同一份实现；云端文本授权、调用持久化和草稿尚待。具体边界见[来源验证 §8](./V25-CLOUD-SOURCE-VALIDATION.md)，最终结果见[测试手册 §5.29](./V25-MIGRATION-TESTING.md)，接续[路线图 §6.24](./V25-MIGRATION-ROADMAP.md)。原父卡及管理员依赖不变。

### 2026-09-09 B35 历史增量

G-CLOUD-02 会话/来源执行阶段新增真实鉴权 API、PG/Graphile 原子入队、持久事件、精确确认和先取消后启动；生产消费入口已实测普通任务及 SIGTERM，两个 Node PID 来源接续另有夹具证据。完整编译/模型/共享产品尚未完成，原同步 Agent 仍 501。最新结果见[测试手册 §5.28](./V25-MIGRATION-TESTING.md)，接续路线图 §6.23；下面 B34 及更早记录保留历史边界，不外推为整包完成。

### 2026-09-09 B34 历史增量

B34 已完成 G-CLOUD-02.1/02.3 的内部单来源持久准备、确认身份及 G-DATA-02 来源对象保护切片，未关闭对应父卡。最后方案引用释放后的回收缺陷已有先失败、修复及完整 API/worker/check 复跑证据，见[来源验证](./V25-CLOUD-SOURCE-VALIDATION.md)与[测试手册 §5.27](./V25-MIGRATION-TESTING.md)。公开 Agent 仍未实现；原 C3/C5、P5/P6、方案包、完整 GC/迁移/发布保持开放。下面带旧日期的记录保留历史口径，最新领取入口为路线图 §6.22。

### 2026-09-08 续作入口与当前口径

B8 后 **B9–B19 已列切片分别通过本机验收，working-tree-only，整包部分通过**；新增费用/云资产/Worker/生产验证的实际状态见 [开发执行记录](./V25-DEVELOPMENT-LOG.md)。进度与范围详见 [V25-MIGRATION-ROADMAP](./V25-MIGRATION-ROADMAP.md)，后续领取 [G 任务卡](./V25-MIGRATION-GOALS.md)，测试记录及局限集中见 [V25-MIGRATION-TESTING](./V25-MIGRATION-TESTING.md)。本文历史阶段数字不能直接当作当前运行；manifest 未绑定的结果仍未登记。

- Web 与 Desktop 的 `hasDesignSchemes` 当前均为 true；Web 确定性管理可用；B9 已补云端图片暂存和完整文档引用晋升；B10 固定 prepare/run/cancel 与 Web Composer 已通过本机验收，B11 市场发现/分页、API 真实鉴权/PG 集成、完整 E2E、check 和 source 扫描已过；云端 Agent/专用包仍明确 501。
- B7/B8 已补真 PG + Graphile runtime 和 30/90 天 retention；B9 增加独立进程恢复/epoch 与方案资产引用保护，仍缺全部竞争组合、全资产 GC 与全链验收，不能继续描述为完全没有 runtime/retention。
- 本地费用授权与休眠 Cloud MCP 审批已经分别核定；B10 持久账本、B12 可信身份恢复、B13 独立回执与固定凭据发送已有证据，B14 下载、B15防回退基础与B16正式恢复隔离已有分层验收，按SP-P4继续预算/远端关联、显式启用/核对和桌面托管接入。B13 正式 worker bin 的本机停机/恢复也已补验，容器与完整矩阵仍开放；不隐含管理员代批或 Cloud MCP 花费功能。
- P02/P03 中暂缓的 Skill 对话、通用导入分享、微调/命令面板不因出现在旧综合卡中自动进入本轮；管理员后台已获当前总 goal 的后续开发授权，必须剩余 v2.5 全部闭合后启动。
- 生产部署/回滚脚本仍有 v1.1 资源和路径，须按 G-RELEASE-04 改造并验证后使用。

状态只写已经有源码与测试证据的事实:

| 状态 | 含义 |
|---|---|
| `todo` | 尚未开始或只有历史实现 |
| `doing` | 当前批次正在修改,尚未通过全部卡内门禁 |
| `partial` | 主路径已迁,仍缺旧版功能或对称证据 |
| `verify` | 实现已齐,等待全量/真实环境验收 |
| `blocked` | 代码或合同已有明确证据,但被环境、外部依赖或尚未建立的必要门禁阻断;不得当作通过 |
| `done` | 六层走线与卡内门禁均有当前提交证据 |
| `frozen` | 明确不迁移,只跑防回归测试 |

涉及屏幕、宿主或跨端行为的卡片必须同时填写以下平台矩阵。`N/A` 只表示该平台没有该语义,不能用来掩盖未实现;桌面单元格必须在存在系统差异时注明 macOS/Windows/Linux。Desktop Agent 是兼容面,与 Desktop renderer 分列,不能用 Agent 测试替代产品 UI 证据。

| 字段 | 必填内容 |
|---|---|
| Mobile Web | 入口/路由、响应式差异、状态、Web mobile E2E 与视觉证据 |
| PC Web | 入口/路由、桌面视口差异、状态、Web desktop E2E 与视觉证据 |
| Desktop | Electron 入口、IPC/SQLite/core 触达、状态、macOS/Windows/Linux 差异与 Electron 证据 |
| Desktop Agent | Automation/CLI/local MCP 的兼容状态;无关时写 `N/A` |
| Capability | capability flag、fallback 和不可用时的入口行为 |
| State matrix | 对应 `V25-UI-SPEC` 或 `ui-parity` 状态矩阵章节 |
| Evidence | 单测、API/client/IPC mapping、E2E、视觉快照、真 PG/SQLite 证据 ID |
| Difference | 对应 `V25-UI-SPEC §9` 的有意差异编号;没有则写 `N/A` |

每张源码卡完成前必须逐项核对:

1. 契约:Zod 唯一形状源,类型从 schema 推导,兼容与安全边界有测试。
2. 接缝:gateway、query key、可选域与 capability flag 同步。
3. features:四端共用屏/hook,无 Electron/Next/Node 依赖,状态矩阵齐全。
4. Web:API 路由/service + api-client 映射 + Next 薄挂载。
5. Desktop:IPC 方法表/BridgeError/行映射 + desktop-gateway 精确 payload。
6. 证据:就地单测、必要的真 SQLite/PG、Web desktop/mobile、Electron 与视觉快照。
7. 平台矩阵:Mobile Web、PC Web、Desktop、Desktop Agent 均有状态或明确 `N/A`/`blocked` 理由。
8. 边界:不改桌面版本号;不触碰 pet 与豆包内部实现;准确判断 Agent/CLI/MCP/Automation 影响。

### 0.1 证据登记口径

为防止“源码存在”被误写成“功能完成”,每条 evidence 必须同时注明证据层级、执行范围和可复现位置:

| 证据层级 | 可以证明 | 不能证明 |
|---|---|---|
| `source` | 当前源码/迁移/manifest 存在,接口或边界已声明 | 消费方、成功路径、跨宿主 parity、真实数据正确性 |
| `unit` | 单函数、schema、mapper、状态决策或错误分支 | 真 API/PG/SQLite、真实 Electron 窗口、生产构建 |
| `mock-e2e` | 共享 features 在指定视口中的交互和视觉 | API service、PostgreSQL、worker、生产 Web runtime |
| `runtime-e2e` | disposable SQLite、真实 Electron 或 Testcontainer PG 的运行结果 | 未执行的平台、未覆盖状态和跨设备语义 |
| `artifact` | 指定 build/package 产物的加载、迁移和启动 | 另一个平台或另一个产物路径 |
| `external` | 真实账号、真实设备、远程 MCP 或发布环境结果 | 可由本地 fixture/mock 替代的事实 |
| `blocked` | 阻塞原因、保留的断言和可重跑条件 | 通过、完成或可跳过门禁 |

当前工作树中的未提交改动统一标记为 `working-tree-only`;它们可以驱动下一卡实现,但不能单独把卡升为 `done`。数字 evidence 必须绑定命令、测试范围、执行日期和 commit/report/artifact;无法复现的历史数字改写为“未登记”。`test.skip`、缺产物自动 skip、只上传失败 artifact、route mock 和人工目测均不能单独构成全量通过证据。

### 0.2 v2.1 / baseline 反向覆盖总表

下表把旧用户意图、当前实现和迁移卡分开记录。`当前证据` 只表示当前树可找到的实现或测试,不代表四端完成;旧路径来自 `v2.5-baseline`(`0e5be61`),当前路径必须再由本地源码和测试核对。

| 旧产品意图 | baseline 对位 | 当前 v2.5 证据 | 当前判定 | 归属卡 |
|---|---|---|---|---|
| 壳、导航、窗口控件、拖拽区 | `apps/desktop/src/components/layout/*`、`apps/web/src/layout/*` | `packages/features/src/shell/*`、Web/Electron shell specs | `partial`;Win/Linux 控件、内容顶/设置 drag-region、Tooltip 300ms、会话重启逃生门、AutomationConfirmCard 已于 2026-09-06 交付并验证;B3-T3 已预留 32×138 安全区(`data-window-controls-safe`),darwin Electron E2E 69 passed / 1 skipped / 0 failed(控件带 count=0 跳过几何);Windows 真机像素重叠仍未目测;macOS 全屏 E2E 在抢不到 key window 时走与 enter-full-screen 相同的 IPC | U01、U01-fullscreen-environment |
| 首次启动 onboarding | `v2.5-baseline` 的 desktop onboarding 与 Web BootScreens 历史实现 | `packages/features/src/onboarding` 四步流 + `onboardingCompletedAt` 哨兵,双宿主一行挂载 | `done`(2026-09-06);gate 矩阵与三轨见 UI-SPEC §2.6 | U01-onboarding |
| 账号、注册、退出、额度、兑换 | baseline account/settings surfaces | `packages/features/src/account/*`、Web account/Electron settings specs | `partial`;Agent connection UI 已于 2026-09-03 补齐;2026-09-06 B2-T3 账号 P2(登出预填上次用户名 + 登录/兑换错误码文案表)已收口;同日以本地 apps/api + 官方 New API 网关（zhaozhaoyue.top）验证真实登录闭环;2026-09-07 B7-T4 `web.live-account.spec.ts` env-gated 双视口活体登录 → 提示词 CRUD → 方案列表;B8-T5 `electron.live-account.spec.ts` 设置登录 → 提示词 CRUD(密码只走 `MUSEFOLD_E2E_PASSWORD`);生产 api.musefold.app 未部署仍为发布门禁（Q03） | U05、S01 |
| Desktop Provider/BYOK 与模型目录 | baseline Provider/AI connection surfaces | `providers-domain.ts`、`AiConnectionsPanel`、定向 tests | `partial`;safeStorage 主路径存在,Agent key 有了独立管理面（agentConnections 域,AiConnectionStore keychain）;S01 产品面已于 2026-09-06 B4-T3 闭合(连接测试失败引导 + 工作台/历史 `check_key` 深链连接分区 + `runRowToJob` AUTH/NO_KEY → `AUTH_CREDENTIALS_INVALID`);safeStorage/asar/产物扫描仍未闭合 | U05、S01 |
| Prompt/Folder/Tag CRUD、搜索、置顶、回收站、冲突 | baseline library/product-ui | features/prompts、API/IPC tests、Web/Electron prompt specs | `partial`;大库/封面/Inspector/双列/Taxonomy Sheet 已接线;真 PG/跨设备证据缺 | U02、D01-boundaries、D02-a |
| 新设计、会话、草稿、参数、提交/取消/重试 | baseline generation/workbench | features/workbench、Web/Electron workbench specs、API/IPC/core tests | `partial`;多图/Lightbox/张数/`defaultCount` 已于 2026-09-06 B2-T1 交付并验证;会话标题/任务摘要与移动键盘 inset 已于 2026-09-07 B5 闭合;额度引导/兑换重试/只读审批卡已于 2026-09-07 B6 闭合;完整审批后端仍未闭合 | U03、U03-spend |
| 参考图、比例、结果消费 | baseline image input/RatioPicker/result card | current contracts/domain/IPC 和 working-tree E2E | `partial`;多图网格/逐图与全部保存/Lightbox 翻页与复制图片已于 2026-09-06 交付并验证(重生 desktop-workbench-light.png);稳定产物回归与选择模式(P3)仍待 | U03、Q01 |
| 微调、父子谱系、错误建议 | baseline refinement/history lineage | 当前只保留部分 `parentRunId`/lineage 展示 | `todo/partial`;不得以线索展示冒充微调完成 | P02、U04 |
| 历史列表、筛选、详情、Lightbox、清理、统计 | baseline history components | features/history、Web/Electron history specs | `partial`;列表行已显示已有 `costPoints`, `null` 成本不伪造成 0；批量清理、磁盘用量、种子/谱系跳转及完整历史成本/统计闭环仍缺 | U04、D02-a/d |
| 设计方案全生命周期 | baseline `features/design-schemes/*` 与 main runtime | canonical contracts、SQLite/PG schema、Desktop/API/client adapter、shared features | `partial`;确定性 CRUD、working-draft 读取、Desktop `.musefold.design` 安全 staging/archive/domain 导入导出、owner-safe 历史来源、共享详情/deep-link/相册交互已接线；Desktop `hasDesignSchemes=true`，canonical run/cancel/event transport 与 checkpoint `607e7b5` 的 cancellation-wins 已存在，主进程权威 text-only `prepareRun` 及执行前快照复核已接线；Desktop Workbench Composer run/cancel 接缝已接通，并有回环 Provider 下真实 Electron 取消、双账本收敛、输入保留和零方案资产提交证据。Desktop Workbench `onCreate/onModify` 已接到主进程 Agent create/modify adapter（brief / 历史来源身份 → Compiler 落草稿；exact revision + 指令 → Reviser 产出待验证草稿；Agent 文本连接沿用 v2.1 `AiConnectionStore`，无连接时结构化 `DESIGN_SCHEME_AGENT_AI_UNAVAILABLE`），`checkUpdate` 以同一文本连接做上游重编译；GitHub Skill 来源已闭环（2026-09-03：`confirmInstall` 进部署方法表；brief 中的仓库地址 → 主进程解析 → `confirmation-required` → 共享 `SourceInstallConfirmDialog` → 用户「确认引入」/「取消创建」→ Analyst → Compiler 落 skill 草稿，域测试覆盖确认/拒绝/重入/跨窗口）；Agent 过程事件已在 Composer 上方以一行进度展示（state / 运行中 trace）；参考图运行已接通（Composer 上传暂存 id → `prepareRun` 按声明顺序分配图片槽位、必需/超量/无槽位 fail-closed → run 前解析为受管本地图，不登记为方案资产，桌面 `runInputSupport=text-and-images`）；成功出图 Electron E2E 已闭环（2026-09-03：回环 PNG Provider 真实出图，双账本 success/completed、评估落库、正式运行零方案资产、Composer 复位保留附件，workbench 10/10）；2026-09-03 生产 Web `hasDesignSchemes=true`：壳导航注册入口，确定性 CRUD/详情/rename 走云端 API，`web.design-schemes.spec.ts` 8 条双视口证据 + 视觉基线，市场/导出/运行以结构化 501 可读降级（禁用并解释,不伪造）；以上为早期阶段记录，B9 上传资产、B10 固定运行/取消已补本机验收；市场发现 B11 已验；云 Agent/专用包与生产部署仍未完成 | P01-1..P01-13 |
| Skill runtime、GitHub 固定版本读取 | baseline Skill conversation/skill-import/local MCP | 主进程 skill runtime/import 保留,新壳无入口 | `partial`;兼容面不等于 renderer parity | P02、P01-12 |
| 分享、导入、导出、`.musefold.design` | baseline share surfaces、scheme share runtime | Desktop 主进程 share/staging/archive 已接入 v25 domain 导入导出;无 shared screen,Web package 仍 fail-closed | `partial`;Desktop `.musefold.design` 导入导出 E2E 已于 2026-09-06 B4-T5 验收,B7-T3 补草稿重命名/删除(`electron.design-schemes.spec.ts` 4/4,`MUSEFOLD_E2E` 对话框旁路,toast 无绝对路径);Web 导入导出与确认未闭合,通用分享/导入仍暂缓(P03) | P01-9、P03 |
| Automation token、确认、预算、审计、取消 | baseline `AutomationConfirmCard` 和 automation runtime | automation-server/local routes;v25 `open` 分区 + `AutomationConfirmCard` 已于 2026-09-06 交付并验证(`electron.settings-open.spec.ts` 9/9);超时仍 120s | `partial`;确认闸已接线并验证,完整 spend 矩阵仍待 | U03-spend、P01-11、P03、U05 |
| Cloud MCP/Agent 上下文读取 | v2.1 精确 allowlist | `apps/api/src/modules/mcp/manifest.ts` 七工具 + manifest tests;`GET/DELETE /api/v1/mcp/authorizations` + `ConnectedAppsCard` 已于 2026-09-06 B3-T1 交付并验证(`web.cloud-mcp.spec.ts` 6/6,`electron.settings-open` 第 9 例) | `partial`;撤销 UI/401 再查 consent 已闭合;缺两独立远程客户端和发布环境 evidence | P01-12、Q01/Q03 |
| 云同步 consent、owner、outbox、冲突、恢复 | v2.1 sync docs/legacy runtime | current IPC/core/API sync + Electron sync spec | `partial`;本地 mock 单设备证据,跨 owner/两设备/真云端缺 | D01、D01-boundaries、Q01 |
| 删除、保留期、asset/staging GC | baseline trash/cleanup/migrations | soft-delete/restore/部分 purge;worker maintenance | `partial`;B7/B8 已有 generation_runs 30 天、提示词 30 天、sync 90 天裁剪;仍缺 D02-a 语义全集、D02-c 资产 GC、D02-d 三形态回收证据 | D02-a..d |
| Desktop takeover、scheme replay、PG replay | baseline migrations/DB | disposable migration tests、PG schema tests、env-gated Testcontainers | `partial`;B8-T4 空库 `migrateDatabase` 再 replay 幂等 + `desktop-db` bundle freshness 已进 CI;无匿名真实 v2.1 语料、备份恢复演练、upgrade/identity 拒绝全集 | D03、Q03-pg-replay |
| 密钥、路径、media、导出和产物扫描 | baseline keychain/media/share tests | contracts negative tests、临时 userData scan、safeStorage code | `partial`;无 source/asar/DMG/Windows artifact 全面扫描 | S01、Q03-security |
| 宠物、豆包、更新和发布产物 | baseline pet/doubao/updater | 冻结代码仍在;release/package-smoke workflow 存在 | `partial`;入口/冻结负向证据和按平台非 skip smoke 未闭 | X01、Q03-package-smoke |

## 1. 总览与依赖

```text
B00 当前树基线 ─→ B02 可追溯证据登记
 └─ B01 既有公共域跨宿主合同 ─┬─ D01 数据正确性 ─┬─ U01 壳
                              │                  ├─ U02 提示词库
                              │                  ├─ U03 工作台
                              │                  ├─ U04 历史/资产
                              │                  └─ U05 设置/账号/连接
                              └─ X01 冻结入口保护

U01..U05 + D01 ─→ P01 设计方案 ─→ P02 Skill/微调/素材
                 └→ P03 分享导入/Automation/Cloud MCP
D01 + U02..U05 ─→ D02 生命周期治理
B02 + 全部实现卡 ─→ Q01 反向审计 ─→ Q02 本地门禁 ─→ Q03 CI/CD
```

`P01-0..P01-4` 的合同、数据 scaffold 和 fail-closed seam 可在 U 卡尚为 `partial` 时先行,但 P01-6 共享 UI、P01-7 入口和 P01-13 最终 evidence 仍依赖相关 U/D 卡稳定。该并行只减少等待,不降低产品 parity 或全量门禁。

## 2. 基线与基础设施

### B00 当前工作树与视觉基线

- **状态**:`verify`
- **目标**:在独立迁移分支保护现有未提交 UI/Workbench 改动,取得当前树真实门禁结果。
- **当前证据边界**：当前分支仍为 `spec/2026-09-01_migrate-v21-to-v25`；HEAD `dcdf8d0` 加 B2–B8 未提交工作树。最新批次 B8 的历史验证范围见 [测试手册 §2](./V25-MIGRATION-TESTING.md#2-b1b8-历史结果)，不是本轮复跑。旧的完整 E2E 98/1 fail/5 skip 和 Electron 33/1 fail/1 skip 仅保留为历史；原生全屏与 IPC fallback 需分层验收。没有绑定当前代码版本的 durable report/artifact 时，B00 保持 `verify`，不升级 `done`。
- **动作**:
  - 审查现有 dirty diff,不回滚用户改动。
  - 用当前源码重建 Web/Electron;清理或拒绝复用 3399 的旧服务。
  - 由 B02 登记命令、commit、日期、report/artifact 和 skip;没有登记的历史数字不回填。
  - 缺失视觉快照要么纳入 `toHaveScreenshot` 稳定基线,要么由 CI 成功/失败都持久上传;人工目测只作辅助。
- **门禁**:`pnpm run check`;`pnpm run test:e2e`;Electron project;B02 evidence manifest。
- **回滚**:只回滚本卡新增 evidence/基线,不改用户原有工作树。

### B02 可追溯 evidence manifest 与基线刷新

- **状态**:`todo`
- **目标**:建立 claim → 当前源码/测试名 → 执行命令 → 证据层级 → commit/date → report/artifact → skip/blocked reason 的单一登记,替代易过期的 prose 数字。
- **范围**:新增机器可读 evidence manifest 和 repo 守卫;刷新 B00/B01/D01/U01..U05/P01/Q01..Q03 的数字与状态。manifest 不存凭据、Prompt 正文、本地路径、真实用户身份或生成结果资产。
- **验收**:每个 `done/verify/blocked` claim 都可解析到存在的测试/迁移/workflow 路径;历史运行无 report 时标“未登记”;repo test 拒绝缺文件、重复 id、`test.skip` 冒充 pass 和过期 commit;渲染后的 Markdown 主表列数正确。
- **平台矩阵**:Mobile Web/PC Web/Desktop/Desktop Agent 均由本卡登记证据,本卡自身不实现产品能力。
- **依赖**:B00。Q01/Q02/Q03 只能消费本 manifest,不得再手写一组不一致数字。

### B01 既有公共域跨宿主合同与方法映射

- **状态**:`verify`
- **旧版能力**:Desktop/Web adapter 对相同产品动作提供一致结果,宿主只适配 transport。
- **范围边界**:本卡只覆盖当前已接通的 settings/account/sync/providers/prompts/workbench/generation 公共域。设计方案的 canonical seam 归 P01-3/P01-4/P01-5,不得用 fail-closed `designSchemes.*` 方法扩大解释本卡。
- **当前发现**:
  - `buildMethods()` 已由 contracts 的 canonical source 派生方法集合,并在生产构建时对 settings/account/sync/aiProviders/designSchemes/prompts/workbench/generation 逐域做双向断言;当前定向 bridge 测试已覆盖原型链方法名和全域异常脱敏。因此 method-set 漂移不再是当前红门禁;剩余完整门禁和证据由 B02/Q02 登记。
  - Desktop design-scheme gateway 已有确定性 CRUD 成功路径，主进程 canonical run producer 已发送受控 execution events；Web api-client 已有 design-scheme adapter。两者按 P01 独立记账。
  - 现有 API-client/platform/desktop gateway 的历史数字已经与当前测试集合漂移,由 B02 刷新后再登记。
- **修复子卡 B01-R**:
  - 让主进程 method set、Desktop gateway wire names 与测试锁定使用同一 canonical source或明确的双向集合断言,避免手写清单静默漂移。
  - 为 preload 的 `onDesignSchemeEvent` 增 listener identity/unsubscribe 测试,并明确没有 main producer 时只能算 seam。
  - 保留 unknown method、strict input、BridgeError、unexpected redaction、malformed response、missing bridge 等负例。
- **验收**:既有公共域全部 gateway 方法有 transport mapping test;P01-4 的 15 个 fail-closed names 有独立 contract test;出参经 Zod;不存在 renderer 方法而 bridge 缺失或 bridge 方法而 adapter 无登记的漂移。
- **门禁**:gateway-bridge/preload/desktop-gateway/api-client/platform 定向 tests;相关 typecheck;Biome;`git diff --check`;B02 manifest。

## 3. 数据、状态机与同步

### D01 统一账本、生成状态机、账号与同步

- **状态**:`partial`
- **已迁证据边界**:`generation_runs/generated_assets` 单账本、API 幂等/原子取消、worker lease/epoch/reconcile、Desktop/core 终态守卫、sync consent 四态和冲突处理均有源码与定向测试。worker 证据以函数/fake dependency 为主;Electron sync 使用本地 mock server;真 Graphile Worker + PG、两设备和生产 sync transport 不能由这些证据替代。
- **剩余功能**:
  - Desktop Prompt/Folder/Tag 建立 workspace 所有权,旧本地数据固定留在 local-only workspace;新 owner 未显式 adopt 时 seed outbox 必须为 0。
  - usage/version/max 合并、purge/outbox/FTS/cloud entity state 一致;Provider 激活与 active 删除接管事务化。
  - 两设备 pull/apply 与 push 交错、server-side device mid-push 撤销、跨账号 relogin、cursor expired 和真实云端错误恢复。
  - real Graphile Worker + PG 执行、worker restart/reconcile、storage partial/orphan cleanup 与外部 Provider success/failure/cancel race。
- **working-tree-only**:当前 prompts-domain Folder/Tag workspace 作用域修复、generation prompt 比例约束/多参考图编号等变更在 dirty tree 中;在 B02 登记并通过对应回归前不得写成已提交完成。
- **视觉证据修正**:Electron sync 四态行为和临时截图生成代码存在,但截图写入 gitignored `.results` 且 CI 只在失败时上传;“已人工检查”不是可复现视觉 evidence,由 V01 处理。
- **触达**:contracts、db/desktop-db、api/worker、core、IPC、account/sync features。
- **验收**:并发/崩溃/重复执行/取消竞态;匿名 v2.1 SQLite 回放和备份恢复;真 PG/worker;断网/换号/两设备/冲突/撤销;所有非 enabled 状态 zero transport。
- **门禁**:worker unit + runtime integration;API `test:integration`;desktop takeover/replay;Electron sync/account E2E;B02 evidence manifest。

### D01-boundaries workspace、跨账号与两设备 fencing

- **状态**:`partial`
- **范围**:定义 local-only workspace 的显式 adopt/copy 语义;逐项决定 Folder/Tag/Prompt/FTS/usage/outbox/entity-state 的 copy/retain/seed;验证 design-scheme machine-local DB 与 account-scoped Prompt sync 在同一 userData 中互不串线。
- **本批已闭合**:登录和开启同步在缺少显式 account workspace 时不自动建 workspace、不构造 cloud transport;显式 `adoptLegacyWorkspace` 复制 Folder/Tag/Prompt/prompt_tags、usage 并重建 FTS,保留 local-only source;重复 exact copy 幂等, divergent 非空目标拒绝;cloud entity state、mutation outbox、usage outbox 不跨 owner 复制,由后续 seed/runtime 重新建立。
- **状态矩阵**:`unset`、`paused`、`enabled`、`auth_blocked`、`owner transition`、`device revoked`、`cursor expired`;任一 owner/token/device mismatch 都必须停 transport 且保留数据。
- **平台矩阵**:Mobile Web/PC Web 只验证服务端 owner/version 结果;Desktop 验证 SQLite/outbox/transport;Desktop Agent 验证本地调用不能绕过 active owner 或复用 Cloud OAuth。
- **剩余**:跨 owner seed、两客户端 duplicate/local/remote、device mid-push 撤销、cursor expired/bootstrap reset、真实 Electron account transition 和 design-scheme machine-local 隔离的 runtime evidence 仍未闭合。
- **验收**:未 adopt 的新 owner seed=0;A outbox 永不发给 B;两客户端 duplicate/local/remote 都可解释;device mid-push 撤销后后续 mutation 被 fence;设计方案本地库不因登录自动绑定或上传。

### D02 删除语义、回收站与保留期治理

- **状态**:`todo`
- **父卡范围**:统一 deletion/tombstone/purge/retention/GC,不把当前单项 soft-delete/restore 或 archived session 误报为治理完成。保留期数值必须进入可执行配置/服务常量和测试,不能只写在本文。
- **子卡**:
  - **D02-a 删除语义 parity**:`todo`。Folder/Tag detach 后硬删且同步 tombstone 不可 restore;Prompt/History/Session `deletedOnly`、restore/purge/清空回收站;永久删除会话保留 generation 并置空 session id;归档恢复是否清 `archivedAt` 明确。所有不可恢复动作走 AlertDialog。
  - **D02-b retention maintenance**:`partial`。2026-09-07 B7-T2 第一刀:共享 `SOFT_DELETE_RETENTION_DAYS=30`;worker 硬删过期软删**终态** `generation_runs` 并入 `object_cleanup_queue`。B8-T2 第二刀:共享 `SYNC_RETENTION_DAYS=90`;硬删过期软删 prompts(folder/tag 实体保留,tag 链接 cascade);裁剪 `sync_change_log` / `sync_mutation_results` 并抬 `minAvailableCursor`(不回退、不删 `sync_devices`);cleanup 顺序 rate-limit → generation purge → prompts → sync → object cleanup;连跑第二次 no-op。仍缺:automation/Skill retention、可暂停观察面。
  - **D02-c asset/staging GC**:`todo`。S3 reference/generated asset、Desktop reference staging、share package staging 和 orphan upload 清理;引用计数/ledger/provenance 仍存时禁止删;失败重跑不得破坏成功资产。
  - **D02-d 三形态回收与清理 evidence**:`todo`。Web desktop/mobile、Electron 对软删/恢复/永久删除/清空/归档区别进行行为与视觉验收;Desktop Agent destructive API 需预算/确认/审计,Cloud Agent 不提供删除工具。
- **触达**:contracts/platform/features、双端服务、两套数据库、worker maintenance、设置入口。
- **验收**:桌面/云端相同语义;maintenance 连跑两次第二次 no-op;仍被引用资产存活;同步水位可恢复;S3/磁盘失败产生可重试 orphan 记录而非静默成功。
- **门禁**:migration replay、真 PG、worker maintenance、Web/Electron E2E、artifact/userData path+secret scan。

### D03 匿名真实 v2.1 SQLite 语料与备份恢复演练

- **状态**:`partial`
- **目标**:补齐当前“由代码合成 legacy DB”之外的真实形态回放。只使用脱敏、可公开、无凭据/正文/绝对用户路径的匿名 fixture;任何用户/活动 App 数据库不得用于自动测试。
- **本批已闭合**:新增 D03-A synthetic disposable corpus builder/scanner 与 provenance manifest,覆盖 legacy `user_version=20`、FTS drift、非 ASCII/长相对路径元数据、enabled/paused/unset sync 状态、outbox/conflict/tombstone、历史资产、归档会话及独立 design-scheme v4 scaffold;scanner 实际校验 integrity/FK/表/version/hash/source 禁止项/敏感值/绝对路径/Prompt 脱敏。
- **语料**:至少包含 `user_version=20`、FTS drift、非 ASCII/长路径元数据、已启用/paused/unset sync 证据、outbox/conflict/tombstone、历史资产、归档会话;design-scheme 独立 v4 库另存 fixture。
- **演练**:legacy → desktop-db takeover;`VACUUM INTO` 备份可开;迁移失败后原库不变;从备份恢复后旧/新版本可启动;design-scheme v4→v5 replay;fresh PG 0000→latest 与已应用 0000→latest replay。
- **剩余**:D03-A 仍是代码生成的 synthetic corpus,不能冒充真实脱敏 v2.1 语料;当前 `packages/core/src/testing/fixtures/d03-a/__tests__/takeover-replay.test.ts` 已有 synthetic 真 SQLite 接管、备份恢复、失败回滚和方案 replay 测试源码，B8 已有空 PG replay 记录；真实脱敏语料、PG 中间版本升级及绑定当前版本的完整报告仍待 G-DATA-03。
- **验收**:数据计数、FTS 查询、owner/consent/outbox/version、asset 引用和 scheme revision/run provenance 前后等价;备份恢复是可执行测试,不是文档承诺。

## 4. 核心 UI parity

### U01 应用壳、导航与窗口

- **状态**:`partial`
- **平台矩阵**:
  - Mobile Web:`N/A`(无原生窗口交通灯/全屏 inset 语义);移动抽屉与底栏由 Web shell 另行回归。
  - PC Web:`N/A`(浏览器全屏 API 不属于本卡);桌面 Web 壳行为由既有 Web shell E2E 覆盖。
  - Desktop:`partial`;macOS 全屏 inset 子卡已完成代码接线、单测/构建与真实 Electron 复跑；Windows/Linux 保持 0 inset;B2-T6 自绘控件与 drag-region 已接线并验证;B3-T3 已预留 32×138 安全区(Electron E2E 69 passed / 1 skipped / 0 failed,darwin 控件带 count 可为 0)。Windows 真机像素重叠仍未目测。窗口 chrome 仍走 preload,不进 `musefold:invoke`。
  - Desktop Agent:`N/A`。
- **已迁**:共享侧栏/移动底栏、会话区、账号 footer、错误边界、动效闸门、基础 drag-region;U01 首批核心几何:默认 248px、220–360px/32vw 调宽,指针/键盘/Home/End/双击与旧 `musefold:sidebar-width` 持久化;普通屏四边 4px 浮岛(设置保持全出血);`<768px` 同源模态抽屉 + focus trap/Escape/inert/焦点归还/自动关闭;收起态占位展开轨。2026-08-29 的历史运行记录覆盖 features、Web shell desktop/mobile、Web/Electron build、renderer typecheck、Biome 与独立 review;原始计数未绑定 report/commit,由 B02 重新登记,不能作为当前通过数字。独立 review 找到并修复 761–767px 侧栏与抽屉同时缺席回归。**2026-09-06(B2)**:Win/Linux `WindowControls`(D5 窄带,不进 gateway);内容顶 12px + 设置 32px drag-region(设置让位仅 Win/Linux);TooltipProvider 300ms 壳级唯一;Web `buildInfo`(`PlatformProvider` + `useBuildInfo()`,宿主 `NEXT_PUBLIC_*`);AutomationConfirmCard(desktop-shell 与 `Toaster` 同级);会话重启逃生门(`WORKBENCH_SESSION_RESTART_REQUIRED` + `useRelaunchApp`)+ 重命名 `maxLength` 120 + `--density-nav-y`。窗口 chrome 仍走 preload,不进 `musefold:invoke`。B2 统一验证已过;Windows 控件带重叠本机未验。
- **待迁**:壳级缺口只剩暂缓域(⌘K 命令面板本体仍按 §0.2 暂缓,搜索聚焦已随 U02 / AppShell 收口;标记未读无独立落点,见 ui-parity 02)。会话标题与任务摘要已于 2026-09-07 B5-T4 落到工作台时间线头顶。macOS 全屏 inset 已由 U01-fullscreen-inset 接入,其真实 E2E 与单测证据见该子卡。
- **U01-fullscreen-inset 子卡**:`verify`。旧版基线为 macOS 非全屏保留 traffic-light 空间、原生全屏回退约 12px；当前 v2.5 已由 `resolveBrandInset(IS_MAC, isFullscreen)` 驱动，macOS 非全屏 78px、原生全屏 12px，非 macOS 0px。触达链为 `electron/main/window.ts → electron/preload/v25.ts → window.musefoldV25 → apps/desktop/src/v25/main.tsx → AppShell.brandInset`；窗口状态不进入 contracts、platform data gateway 或 `musefold:invoke` 方法表。代码/单元证据通过；2026-09-06 Electron E2E `electron.shell.spec.ts` 4/4,`78px → 12px → 78px` 在抢到 key window 时走原生 `setFullScreen`,Cursor/agent 占前台时改发与 `enter-full-screen` 相同的 `window:fullscreenChanged` IPC。Difference:`D16`；不触碰 pet/Doubao。
- **U01-onboarding 子卡**:`done`(2026-09-06,B1-T5)。`packages/features/src/onboarding`(状态机 store + `OnboardingFlow` Dialog + 四步组件),哨兵 `AppPreferences.onboardingCompletedAt`;gate 矩阵与形态见 UI-SPEC §2.6。三轨为官方账号、Desktop BYOK、豆包既有冻结入口(只复用 `account/hooks` 的豆包状态/登录 hooks,冻结面零改动);Web 仅展示官方账号轨。已具备通道的存量用户静默补哨兵不回放;first-image 只送 `pendingDraft`,不发起真实生图。证据:onboarding 单测 16、契约 26、双宿主挂载 27+4、`web.onboarding.spec.ts` 双视口 10、`electron.onboarding.spec.ts` 3(fresh userData 弹三轨 / BYOK 轨经回环网关走完 → `providers` 行 `has_key=1` 且 `generation_runs` 为 0 / 复用 userData 不重放)随 2026-09-06 Electron project 55 passed 通过。全仓 E2E 夹具 `tests/v25/onboarding-helpers.ts`(Electron `launchV25App` 默认预置哨兵,Web 各 spec `seedOnboardingCompleted`)。
- **U01-fullscreen-environment 子卡**：`partial`。早期原生全屏前置失败已被 B3/B8 的新执行记录替代；当前测试在无法取得原生全屏时可发送同义 IPC，因此仍须由 G-UI-02 分开验证原生切换和 IPC 消费，并记录平台/环境资格与持久报告。不能继续把旧失败写成当前完整 project 失败，也不能把 IPC 通过写成原生全屏通过。
- **UI 约束**:几何和交互以旧 `ProductSidebarLayout/TitleBar/WindowControls` 为基线;移动底栏作为不删功能的改进保留。新增 UI 必须使用 `packages/ui` 的 ShadCN 原语、Lucide 出口和语义 token;本卡不新增组件。
- **触达**:features/shell、两宿主挂载、桌面 window IPC/capability、ui tokens。
- **验收**:桌面/Web 大屏/760/680/390;键盘与焦点;Windows package smoke;视觉明暗;新用户四步完成后进入工作台,完成哨兵持久化,三轨道不产生死入口。U01 子卡另验收 macOS `78px → 12px → 78px` 与收起轨同步变化。

### U02 提示词库完整迁移

- **状态**:`partial`
- **已迁**:CRUD、搜索、排序、置顶、Folder/Tag、使用动作、回收站、永久删除、存为提示词入口;PromptEditorDialog 使用 ShadCN Dialog/AlertDialog 实现 dirty guard,拦截取消、Escape、外点与 X,支持继续编辑/放弃修改,保存失败保留表单值。**2026-09-07(B7-T4,D26)**:同一次打开只快照一次,Strict remount / `prompt` 引用变化不覆盖已输入;创建/保存失败 toast。**2026-09-06(B1-T1)**:封面缩略(契约 path-free `coverImageUrl`,PG 迁移 `0006_prompt_cover_image`,SQLite 复用 `preview_image_path` 槽位 + IPC 层 `media://` 映射,不新增列)、详情 Inspector(384px)/窄屏 Sheet(头部/正文/相关作品/元数据,「使用」主动作)、行点击开详情、清除筛选 + 新建 CTA、清空回收站(`prompts.emptyTrash` 六层齐)、编辑器 `⌘/Ctrl+S`、行更新时间、复制 Check、`prompt-highlight` 接收端、`⌘K` / `/` 聚焦搜索、滚动哨兵自动分页;宿主注入 `onOpenHistory`,历史屏消费 `history-select`。证据:features 395、契约/平台/api-client/db/桌面 IPC 423、api prompts 6、repo 门禁 44、`web.prompts.spec.ts` 双视口 24、Electron prompts 13(含详情/清空回收站/⌘K/⌘S 四条新用例),桌面/Web 提示词视觉基线已重收。**2026-09-06(B2-T4)**:「全部」/回收站 >150 行 `useVirtualizer`(置顶常驻,单列;md+ 屏内滚动,`<md` window 视口;哨兵兼容;`data-density` 变化 `measure()`)。已验证(根 Vitest 为 use-virtual-rows 补 jsdom)。
- **待迁**:分享/导入与创建方案入口在对应域就绪后恢复。双列自适应与 Taxonomy 移动端 Sheet 已于 2026-09-07 B5-T2/T3 闭合。相关作品 `promptId` 已于 2026-09-06 B4-T1 下推服务端(D22)。
- **平台矩阵**:
  - Mobile Web:`partial`;详情 Sheet、封面、清空回收站与清除筛选 CTA 已闭合并入 route-mock E2E;`promptId` 相关作品已下推;Taxonomy `<md` Sheet 已接线。
  - PC Web:`partial`;详情 Inspector、封面、相关作品、清空回收站 route-mock E2E 存在,不证明真 API/PG;虚拟化、`promptId` 过滤与 ≥760px 双列已接线并验证。
  - Desktop:`partial`;IPC/SQLite CRUD、封面 path-free mapper、详情/清空回收站/快捷键 Electron E2E 存在;虚拟化、`promptId` 过滤与双列已接线并验证。
  - Web 活体:2026-09-07 B7-T4 `web.live-account.spec.ts` 双视口 2/2(默认 skip,需 `MUSEFOLD_LIVE_E2E=1`)。
  - Desktop Agent:`partial`;local MCP/Automation 读取/写入兼容需单独回归,不能替代 renderer;Cloud MCP 仅 search/get 云 Prompt。
- **Evidence 边界**:Web Playwright route mock=`mock-e2e`;Electron disposable SQLite=`runtime-e2e`;真 PG/跨设备 sync 由 D01/Q03 提供。

### U03 工作台、生成与结果消费

- **状态**:`partial`
- **已迁**:会话/草稿、首句标题、Timeline/Composer、三路参考图、Provider、取消/重试/删除、保存图片/提示词、消息编辑/复制、回到最新、基础 Lightbox;比例目录与自定义 `W:H`(UI/草稿/契约同为 1:4–4:1,canonical wire);Prompt 引用六层闭环(最多 6 条整条/UTF-16 片段、host-owned owner/workspace 解析、不可变快照、纯引用生成、304px Dock/移动 82dvh Dialog)。**2026-09-06(B2-T1,D3 解锁)**:契约 `generationCountSchema` 1/2/4 + `capabilities.maxGenerationCount`(现双端均为 4);Composer 设置弹层「张数」(`composer-count-{1,2,4}`,`maxGenerationCount === 1` 不渲染);张数不进持久草稿,按「显式覆盖 → 偏好 `defaultCount`」复原并夹档;桌面 core `n` → provider 逐张落盘 → `generated_assets` position,云端 worker 透传 `n`;结果网格 1/2/4(`job-asset-grid`)+ 骨架同排布(`job-placeholder-grid`);逐图/全部保存;Lightbox 左右翻 + 方向键 + `lightbox-copy-asset`;用户消息 meta(`job-meta`:比例 · 质量 · 张数 · 「来自 #xx 微调」);生成参数卡「默认张数」。
- **P0 回归**:
  - Desktop openai-compatible 主链必须恢复比例约束合成;两张及以上参考图必须恢复图片序号提示。两者复用 `packages/domain/src/generation-prompt.ts`,不得只保留在 Skill/设计方案旁路。
  - Prompt 引用不是暂缓域:已恢复最多 6 条选择意图、owner-safe 解析、Composer 引用卡与不可变历史快照;client title/text/content 不得成为权威数据。2026-08-29 的历史证据覆盖 features、domain/core/Desktop bridge、真 PG、Web desktop/mobile 与 build 后 Electron/SQLite;原始测试计数未绑定 report/commit,由 B02 重新登记,不能作为当前通过数字。源编辑/删除后历史不漂移,split-surrogate/版本/越权/伪造均拒绝。
  - Web 当前会话必须回写并读取 `?session=<id>`;刷新、前进/回退保持选中会话,无效或无权 id 安全回落。
- **待迁**:发起微调(暂缓域);多选批量保存选择模式(P3);历史/方案/Skill 引用 chip;素材 Dock;方案/Skill 模式;审批完整后端矩阵。额度不足卡内兑换重试与只读审批卡已于 2026-09-07 B6 闭合。移动软键盘 inset 已于 2026-09-07 B5-T5 闭合(`visualViewport`,仅 `<md`);时间线底部留白叠 inset 已于 2026-09-07 B8-T3 闭合(D27)。
- **平台矩阵**:
  - Mobile Web:`partial`;主工作台、参考图/Prompt 引用移动 Dialog 和 route-mock E2E 存在;会话删除用例当前按项目 skip;软键盘 inset 已接线;额度引导/兑换重试已接线;多图已接线并验证。
  - PC Web:`partial`;会话/生成/结果消费 route-mock E2E 存在,不证明 production Next runtime、API/PG/worker;多图与时间线头顶标题、额度恢复产品面已接线并验证。
  - Desktop:`partial`;真实 Electron/IPC/SQLite 失败/重试与部分参考链证据存在;多图/clipboard 已接线并验证(张数 2 已过);2026-09-07 重生 `desktop-workbench-light.png`(时间线头顶标题 + 失败文案归一);真实成功 Provider 已有 xiaomiao 活体;approval 真后端仍缺。
  - Desktop Agent:`partial`;Automation/CLI/local MCP 可触发本地运行,其确认/spend/audit 归 U03-spend/P01-11/P03,不能替代 renderer。
- **U03-spend 子卡**:`partial`。2026-09-07 B6 已交付产品恢复面:`top_up`「去兑换」深链账号分区;`spend-recovery-store` + 兑换成功 `generation.retry`(新幂等键)/replay create;Web `canGenerate===false` 预检;终态刷 `account.status`;时间线 `job-approval-card`/`job-approval-rejected` 只读。不发明 approve/reject API。仍缺已有可达入口的费用/预算/确认/审计完整矩阵；新增云端 `pending_approval` 入队是否属于批准范围先由 G-SPEND-01 核定，不能从休眠 Cloud MCP 预留自动推导。Cloud Agent 无 spend tool;Desktop Agent 外部花费必须经过 U03-spend/P01-11 用户确认。
- **U03-worker-runtime 子卡**:`partial`。2026-09-07 B7-T1 第一刀 + B8-T1 第二刀:`runtime.integration.test.ts` 7/7(默认 skip)。第一刀:入队→succeeded、过期租约已发上游 → `GENERATION_UPSTREAM_UNKNOWN`、运行中取消 → cancelled、30 天 purge。第二刀:过期租约未发上游续跑 succeeded;飞行中丢租约的 late success 不覆盖终态;第二张上传失败不得 succeeded 且已上传键入 `object_cleanup_queue`。禁止打真实生图。仍缺:进程重启续跑、stale epoch 并发、更完整 reconcile。禁止把两刀写成完整矩阵。
- **验收**:成功/失败/取消/重试/断线/幂等/审批/多图;参考图安全边界;比例约束和多参考图编号真实进入上游 prompt;Prompt 引用快照;Web URL 刷新/回退;额度兑换原地恢复;移动键盘不遮 Composer;三形态 E2E/视觉;B02 登记 working-tree-only 修复。

### U04 历史、资产与统计字段

- **状态**:`partial`
- **已迁**:列表/筛选/详情/线程、回收站、恢复/永久删除、Lightbox、保存资产/提示词、查看会话。**2026-09-06(B1-T2,ui-parity/05 §7 九项销账)**:行/检视元信息(契约新增 `durationMs` / `seed`,成功行才给成本/用时,「·」真实 DOM 分隔;SQLite 已有 `duration_ms`、seed 取 `params_json`,PG 上游不回报 seed 故 null,**无迁移**)、时间筛选自定义区间(`from`/`to` 全链)、批量清理 `generation.cleanup({ scope })` 六层齐(桌面新 `history-domain.ts`,workbench-domain 已 1027 行故另开)、桌面磁盘用量 `getStorageUsage`、桌面文件操作 `revealAsset` / `copyAssetToClipboard`(`canRevealLocalFile` 门控,云网关不实现)、检视微调链「来自/派生」与孤儿标注、错误码建议动作目录(`history/error.ts`,并修掉成功行也渲染重试钮的缺陷,现按 `canRetryGeneration`)、lg+ 检视 8px 右移淡入、滚动哨兵自动分页。证据:history 单测 35、contracts 92、platform 20、api-client 35、api generation 4、桌面桥/网关 39、`web.history.spec.ts` 双视口 28、Electron history 新增五组随 55 passed 通过;`history-list.png` 双视口与 `desktop-history-light.png` 基线已重收(视觉容差 2% 不会重写基线,须删文件再生)。**2026-09-06(B2-T4)**:>150 虚拟化已落地并验证(虚拟项=线程组,深链 `scrollToIndex`,哨兵兼容,`data-density` 变化 `measure()`;history 新组已过,重生 `desktop-history-light.png`)。
- **待迁**:虚拟化与 `promptId` 服务端过滤已落地(2026-09-06 B4-T1,D22)。成本字段的完整跨端/统计闭环仍待 D02/Q03 证据。
- **平台矩阵**:
  - Mobile Web:`partial`;列表、筛选(含自定义区间)、Sheet/Lightbox、清理菜单 route-mock E2E 存在;虚拟化与 `promptId` 过滤已接线并验证。
  - PC Web:`partial`;宽屏 Inspector/列表/清理 route-mock E2E 存在,真 API/PG/object storage 未由它证明;虚拟化与 `promptId` 过滤已接线并验证。
  - Desktop:`partial`;Electron/SQLite 列表详情、保存、元信息、自定义区间、文件操作、磁盘用量、批量清理证据存在;虚拟化与 `promptId` 过滤已接线并验证。
  - Desktop Agent:`partial`;本地 history 读取/运行兼容另测,Cloud Agent 明确没有 history 扩读工具。
- **Evidence 边界**:Web action/visual=`mock-e2e`;Electron disposable SQLite=`runtime-e2e`;资产 GC/retention 由 D02,真 PG/对象存储由 Q03。

### U05 设置、账号、连接与归档

- **状态**:`partial`
- **已迁**:主题/动效、账号登录注册、额度兑换、云同步基础卡/开关/立即同步、本地 Provider CRUD/test、回收站入口;v2.5 连接区已有 image Provider 卡与 Agent 文本连接卡两套并列 CRUD/default/test(2026-09-03,`AgentConnectionsPanel` 复用 `ConnectionsPanel`,数据面 `agentConnections.*` → 主进程 AiConnectionStore)。**2026-09-06 批次 B1**:
  - 连接(B1-T3):模型拉取 combobox(`aiProviders.listModels` / `agentConnections.listModels`,草稿凭 `{ baseUrl, apiKey }` 亦可拉取,Key 只在 IPC 往返里由主进程拼 Authorization)、脏表单守卫、设为默认(`aiProviders.list` / `generation.listProviders` 活跃置首,Composer 预选联动)、行首状态点、新建流程内草稿测试(`*.test` 接受 `{ id }` 或 `{ baseUrl, apiKey, model? }`)、接入预设(`connection-presets.ts`)、无 Key 前置提示、`role=status`、删除清钥匙链;两卡同享 `ConnectionsPanel`。证据:contracts connections + presets/status/discard 等 52、features account 49、ui combobox 12、Electron settings 用例随 55 passed 通过。
  - 偏好(B1-T4):`AppPreferences` 新增 `defaultAspectRatio` / `defaultQuality` / `density`(全带 default,旧存档无损);`appearance` 分区加 `GenerationDefaultsCard`,新会话/空草稿继承、用户显式改过的字段不覆盖(`session-store.draftParamOverrides`);7 个 `--density-*` token + `DensitySync`(`data-density`)+ 两档 chips;主题/动效/密度统一带图标 `ToggleGroup`(<sm 铺满行宽收一档);system 档 hint 挂载后读 `matchMedia`;偏好失败态「重试」。证据:contracts 24、features settings/workbench 96、`web.preferences.spec.ts` 双视口 4。**密度消费接入点**(2026-09-06 B2-T4 已接,`SessionListPanel` 由 B2-T3 接):设置页/导航/设置行/提示词行/历史行已消费 `--density-*`;`ui/card` 舒适态保持 shadcn `px-6`/`py-6`(1.5rem,token 舒适值 0.75rem 对不上),紧凑走 `--density-card-padding`;虚拟列表 `virtualizer.measure()` 已随密度切换联动。紧凑态用数值断言,不另加视觉基线。
  - 数据存储 + 关于(B1-T6):新 `system` 桌面域(11 方法,契约 `packages/contracts/src/system.ts` 与 `V25_METHODS_BY_DOMAIN.system` 双向断言)→ `hasLocalDataManagement` 门控的备份(立即备份/列表/恢复 → `relaunch`)、存储位置(白名单 id,`displayPath` 唯一路径出参)、诊断日志(200KB 截断)、危险区(确认短语「清空全部数据」+ 清空前 `pre-reset` 快照);关于卡双端同一份(Web 显示「Web 版」,快捷键表消费 `PRODUCT_SHORTCUTS`,第三方声明 `settings/third-party-notices.ts` 经 `thirdPartyNoticeSchema` 约束;更新体系仍暂缓)。顺手修复 `resetBusinessData` 漏清 `workbench_sessions` / `workbench_drafts`(D19)。证据:features 396、桌面 v25/contracts/platform 383、`web.settings.spec.ts` 关于分区与 Web 无本机数据面双视口、`electron.settings-data.spec.ts` 6 条随 55 passed 通过。
  - 契约修复(主代理):`appPreferencesPatchSchema` 改为剥 default 后 partial(zod 4 `.partial()` 会回填 default,桌面 bridge 先 parse 再 spread 会把置顶/密度/生成默认/引导哨兵一并重置),契约回归测试 27。`useClearAllData` 成功后只失效本机业务域且不 await(await 全量 refetch 会被离线账号查询挂住,让「清空已完成」无限期不可见)。
  - **2026-09-06 批次 B2**(已验证,darwin,未 commit;`pnpm run check` turbo 35/35,根 vitest 200 文件 / 1548 例,features 38 文件 / 495 例;Web E2E 136 passed / 4 skipped / 0 failed;Electron E2E 67 passed / 1 skipped / 0 failed):账号 P2(B2-T3)登出预填上次用户名 + 登录/兑换错误码文案表,不进 `AppPreferences`;`open`(B2-T2,`hasLocalAutomation`)本地控制面 / 最近调用 / 接入向导 + 壳级 AutomationConfirmCard,`tests/v25/electron.settings-open.spec.ts` 8/8;`usage`(B2-T5)四指标 + 7/30/90 天 + 刷新 + 渠道明细,`tests/v25/web.usage.spec.ts` 与 `tests/v25/electron.settings-usage.spec.ts` 已过。Windows 控件带重叠本机未验。
  - **2026-09-06 批次 B3**(已验证,darwin,未 commit;`pnpm run check` turbo 35/35,根 vitest 202 文件 / 1566 例,features 39 文件 / 507 例;Web E2E 142 passed / 4 skipped / 0 failed,未重生快照;Electron E2E 69 passed / 1 skipped / 0 failed):Cloud MCP 已连接应用卡(B3-T1,`hasCloudMcpControls` 双端 true,`open.isAvailable` = localAutomation \|\| cloudMcp;撤销=删 consent + token.revoked,handler 再查 consent → 401),`web.cloud-mcp.spec.ts` 6/6,`electron.settings-open.spec.ts` 9/9;usage 图表(B3-T2,`byDay`/`byModel` + `UsageCharts` SVG,无新图表依赖,无图表视觉快照),`web.usage.spec.ts` 与 `electron.settings-usage.spec.ts` 图表存在性已过;Win/Linux 控件带避让(B3-T3)布局已预留,darwin band count=0,Windows 真机未目测。
- **待迁**:
  - 账号:注册确认密码已收口(ShadCN Input/Label,失配红字与 aria-invalid,按钮/Enter 均拦截,确认值不进 gateway payload)。P2(登出预填上次用户名 + 登录/兑换错误码文案表)已于 2026-09-06 B2-T3 收口,不进 `AppPreferences`。
  - 连接:S01 产品面已于 2026-09-06 B4-T3 闭合(连接测试失败引导 + 工作台/时间线/历史 `check_key` 深链连接分区 + `runRowToJob` AUTH/NO_KEY → `AUTH_CREDENTIALS_INVALID`)。safeStorage/asar/产物扫描仍属 S01 全卡。会话列表重启逃生门已由 B2-T3 接 `useRelaunchApp()`。
  - 偏好:密度消费见上表(B2-T4);背景/方案优先级仍暂缓;默认张数已随 D3 解锁。
  - 分区:`open` 已交付并验证(本地三卡 + Cloud MCP 已连接应用),`tests/v25/electron.settings-open.spec.ts` 9/9、`tests/v25/web.cloud-mcp.spec.ts` 6/6;`usage` 四指标 + 图表已交付并验证,`tests/v25/web.usage.spec.ts` 与 `tests/v25/electron.settings-usage.spec.ts` 已过。归档聊天游标分页已于 2026-09-06 B4-T2 交付。余:Skill 管理条目(暂缓域)。
  - 归档闭环:契约/API/IPC 增 `archivedOnly`(不能用 `includeArchived` 后客户端过滤);设置内四态列表、刷新、恢复与软删,生成记录保留。归档列表的「删除」沿当前会话软删语义,与旧版永久删差异登记 §9;真正 purge 留 D02。
  - 数据/关于接缝:新增可选 system/backup/automation/about gateway 与 `system-domain`;路径/日志/openExternal 必须主进程白名单;第三方许可数据源需重建。
  - 设置壳:已于 2026-09-03 交付——分区注册表(`sections.tsx` 单一目录:分组/标题/描述/图标/关键词/capability 门/深链意图)+ 左分组导航(220px,搜索框)+ 右分区面板,移动一级列表 → 二级面板(返回行);深链意图落分区并点亮,分区记忆跨屏保持,记忆分区不可用时兜底;面板只渲染当前分区。新增设置项走 UI-SPEC §6.4 / DEV-GUIDE §8-C 规范流程。
- **触达**:多个 contracts/gateway 可选域、features/settings/account、API/IPC/system/automation、双宿主挂载。
- **验收**:旧版每个设置动作可达;桌面专属项在 Web 有明确隐藏/fallback;密钥/令牌不泄漏;归档闭环不再是单向阀。
- **U05-archive-closure 子卡**:`partial`。共享设置内 archived 面板已落地 loading/error/empty/ready、刷新、restore/remove pending、AlertDialog 和 generation retention 路径;B4-T2 已消费 `nextCursor` +「加载更多」。不能标 `done` 的原因:没有真 PG archive runtime/两设备 refetch;恢复后不精确返回原会话。Difference:`D17`;purge 留 D02。
- **U05-archive-pagination 子卡**:`verify`(2026-09-06 B4-T2)。`useArchivedSessions` 改 `useInfiniteQuery`;`ArchivedSessionsPanel` flatten pages + `archived-load-more` + `useAutoLoadMore`;跨页恢复/删除仍走既有 hooks;软删语义未改。真 PG/两设备 refetch 与恢复后回原会话仍属 closure 余项。
- **平台矩阵**:Mobile Web:`partial`(同源卡片与归档窄布局;Desktop-only section 隐藏;`usage` 四指标+图表与 Cloud MCP 已连接应用已交付并经 Web E2E 验证;Web evidence 多为 route mock);PC Web:`partial`(账号/设置同源,`open`/`usage`/`about` 已交付并验证);Desktop:`partial`(账号/sync/image+Agent Provider、开放能力含已连接应用、使用统计图表、备份/关于已交付并验证,`electron.settings-open.spec.ts` 9/9、`electron.settings-usage.spec.ts` 已过;缺 Skill 管理);Desktop Agent:`partial`(local runtime 存在,v25 `open` 控制面已接线并验证,不替代 renderer)。
- **触达与依赖**:复用 `workbench.listSessions({ archivedOnly: true, limit: 100 })`、versioned `updateSession({ archived: false, expectedVersion })` 与现有 remove 语义;共享实现位于 `packages/features/src/settings/ArchivedSessionsPanel.tsx`、`SettingsScreen.tsx`、`packages/features/src/workbench/hooks.ts`;不修改 U01 fullscreen 文件,不得触碰 pet/Doubao。
- **当前证据**:contracts/API/client/IPC 的 `archivedOnly`、owner/filter/version mapping 与 features/Web/Electron 定向测试存在;精确运行数量由 B02 当前 report 刷新,不再在 prose 固定。Web 证据是 route mock,Electron 使用 disposable SQLite。
- **当前差异/范围备注**:baseline 删除为永久删除,当前按 D17 采用软删;没有 purge;恢复后停留设置页;侧栏归档失败 toast/局部回滚待补。B4-T2 已消费 `nextCursor` +「加载更多」,不再一次性截断 100 条。

## 5. 安全与扩展产品域

### S01 凭据、token 与导出生命周期

- **状态**:`partial`
- **范围**:统一核对账号 bearer、image Provider key、Agent key、Automation loopback token、Cloud OAuth grant 和内容签名 key 的独立生命周期;不把任何 key 放入 renderer、SQLite 明文、日志、fixture、截图、导出、备份或发布产物。
- **产品面**(2026-09-06 B4-T3):连接测试失败给出替换密钥动作(`*-test-result-key-invalid-hint`);工作台提交失败/时间线失败/历史检视 `check_key`/`setup_provider` 深链连接分区,`sign_in` 深链账号分区;桌面 `runRowToJob` 把 AUTH/`ACCOUNT/AUTH`/AUTH_FAILED/UNAUTHORIZED/NO_KEY 映射 `AUTH_CREDENTIALS_INVALID`(NO_KEY 不是 job.error.code)。不做 safeStorage/asar 扫描。
- **子项**:safeStorage 不可用/解密失败 fallback;Automation token 创建/掩码/复制/轮换/旧 token 即时 401;Agent key 与 image key 永不互写;backup/export/import secret scan;account logout/change 的内存清理与新 owner fencing。Provider key 失效后的可解释 UI 已由产品面闭合。
- **平台矩阵**:Web 只处理 HttpOnly cookie/Cloud OAuth grant;Desktop 处理 safeStorage/loopback token;Desktop Agent 仅接受 local token;Cloud Agent 仅接受 canonical resource OAuth,二者不可互换。
- **验收**:mock safeStorage failure、keychain orphan cleanup、token rotation E2E、old token revoke、源代码/userData/backup/export/asar/DMG/Windows unpacked 扫描;测试值不得使用真实凭据。


### P01 设计方案

- **状态**:`doing`
- **平台矩阵**:域已从规划转入实施——Mobile Web:`doing`(共享 features 响应式形态、`hasDesignSchemes=true`，B9 上传与 B10 固定运行/取消已接通；Agent/市场/云包仍欠)；PC Web:`doing`(同一 features、Inspector/deep-link、`hasDesignSchemes=true`，B10 固定云端运行切片已验收，完整组合仍欠)；Desktop:`doing`(v25 IPC/SQLite、导入导出、导航/详情和 canonical run/cancel/event 已接线，`hasDesignSchemes=true`；真实 Electron 成功/取消双账本及云来源兼容已有证据，剩余完整 parity 另验)；Desktop Agent:`partial`(现有 Automation/CLI/local MCP 保留，不替代 Desktop renderer 证据)。
- **UI 参考与组件约束**:设计参考固定为 `https://ui.shadcn.com/create?preset=b27GcrRo`;该 preset 只作为外部视觉/组件参考。新组件必须先适配到 `packages/ui` 的本地 ShadCN/Radix 原语、Lucide 图标出口、Graphite/Ember 语义 token 和现有动效/无障碍约束,不得整体替换 `new-york`、主题或 RSC 配置。
- **旧版功能**:我的/发现、正式/草稿、来源与保真度、GitHub/历史/Prompt/分享包创建、试运行、转正、revision、输入槽位、上游更新、替换正式、详情/相册、跨屏 intent。
- **现有资产**:`electron/main/design-scheme/` 与 Automation/CLI/local MCP 主进程语义保留；P01-1 shared contracts、P01-2 SQLite/PG persistence、P01-3 platform seam、P01-4 Desktop v25 transport、P01-5 Web API/client、P01-6 shared features 和 P01-7 双宿主代码挂载均已有源码与定向测试。Desktop `hasDesignSchemes=true`，Web `hasDesignSchemes=false`；后者即使有 route 源码也不注册入口。`ui-parity/06-design-schemes.md` 是旧版存档与迁移蓝图，不构成完整成功运行路径 evidence。
- **走线**:contracts、platform seam、Desktop adapter/SQLite/runtime、Web cloud CRUD client 和 shared features 已建立。Desktop canonical run/cancel/event transport 已接通，text-only `prepareRun` 由主进程生成权威固定计划，Desktop Workbench Composer 已经 `onRun/onCancelRun` 接到 prepareRun → run → cancel；Desktop Workbench `onCreate/onModify` 亦已接到主进程 Agent Compiler / Reviser（text-only，历史来源按 runId/assetId 身份解析）；GitHub 来源经 `confirmInstall` 安装确认闭环；Agent 过程事件在 Composer 以一行进度展示；参考图运行经上传暂存 id 接通；剩余为 Web run/assets/package 与三形态 E2E。
- **状态矩阵**:以 `ui-parity/06-design-schemes.md §5.1` 为旧版验收基准,已同步登记为 `V25-UI-SPEC §8A` 正式章节(迁移中基准)。每个子卡必须记录 loading/error/empty/ready、capability、E2E/视觉证据与 `V25-UI-SPEC §9` 差异编号。
- **子卡**:按 `P01-0` 至 `P01-13` 执行,依赖和端侧证据见下表。
- **验收**:旧版交互全量闭环;方案资产进入受管资产库;automation 与 UI 产生同一结果;Mobile Web、PC Web、Desktop 三形态均有入口/返回/刷新/错误/空态和视觉证据;Cloud MCP 继续精确七个只读工具;无死入口。

### P01-0 宿主模型与数据归属

- **状态**:`verify`。
- **决策日期**:`2026-08-29`。
- **卡片性质**:本卡是设计方案域的架构裁决与实施边界卡,不是 renderer、contracts、gateway、API、IPC、数据库或同步实现卡。完成本卡只输出可追溯的宿主模型、数据归属/provenance 表、旧资产盘点、依赖 DAG、验收门禁和剩余风险;不得因本卡完成而打开设计方案入口。
- **目标**:继承 v2.1 的正式设计方案 Web/Desktop parity 目标,采用“最终 parity、分阶段接入”的宿主模型。当前保留 Desktop local runtime 与 Desktop Agent 兼容面;后续以 path-free shared contracts 和 `MusefoldGateway` 分别接入 Desktop 本地 adapter 与 Web cloud adapter,不把 Desktop-only 过渡状态固化成永久产品例外,也不引入未经定义的双写。
- **非目标**:本卡不创建 `packages/features/src/schemes`、`packages/platform` gateway/capability/query key、`apps/api`/`packages/db` Web 方案服务、`apps/desktop` v25 IPC/preload/gateway、SQLite/PG migration、同步、分享包或任何新导航/死入口;不修改桌宠、豆包内部实现及现有 Automation/CLI/local MCP 语义。
- **旧版/存量事实**:
  - v2.1 parity 将“正式设计方案”列为 Web/Desktop 的 P 能力,要求共同合同、创建/编辑/使用语义、共享 surface 与双端 controller/E2E/视觉证据;该目标不能被当前暂缓状态改写为永久 Desktop-only。
  - 旧设计方案领域 schema 真实入口为 `packages/desktop-contracts/src/design-scheme/schema.ts`;它定义 `draft/formal`、fidelity、source binding、inputs、parameters、constraints、prompt program、revision 和 compilation trace。旧本地持久化为 `packages/core/src/db/design-scheme/*`,包含 source/snapshot/file、scheme/revision/binding、asset、run/step、evaluation、market candidate、share package 表;主进程编排位于 `apps/desktop/electron/main/design-scheme/*`。
  - 当前 v2.5 已有 shared contracts、PG/SQLite scaffold、platform seam、Desktop adapter/runtime、Web API/client 与 `packages/features` 共享屏；双宿主代码挂载已接线，Desktop capability 已随本地真实 adapter 开启，Web capability 因 cloud runtime 未闭合保持关闭。旧 renderer/legacy runtime 不能证明新壳成功运行路径。Desktop Agent 仅因 Automation/CLI/local MCP 存量兼容面记为 `partial`。
- **宿主模型裁决**:
  - 共享 features 未来只依赖 `packages/contracts` 的 path-free schema 与 `MusefoldGateway`;禁止直接依赖 Electron、Node、SQLite 句柄、userData 绝对路径或 `desktop-contracts` 本地 DTO。
  - Desktop adapter 继续调用保留的本地 design-scheme runtime/repository;Web adapter 后续调用 cloud-safe API、PG 和私有对象存储。两端共享实体、动作、状态与错误语义,transport 和持久化可以不同。
  - capability 必须按宿主真实状态表达：Desktop `hasDesignSchemes=true`，Web `hasDesignSchemes=false`。Desktop 入口可展示已接通的列表/详情/确定性动作，Workbench 试运行/按方案生成经 `onRun` 接通，创建/修改提交经 `onCreate/onModify` 接到主进程 Agent（无 Agent 文本连接或 GitHub 地址时禁用/拒绝并解释）；Web 不显示入口。不得用 `isElectron`、UA、路径字符串或空实现冒充能力。
  - Desktop Agent 是独立兼容面:Automation、CLI、local MCP 继续复用主进程真实 runtime;Agent 回归测试不能证明 Desktop renderer parity。Cloud Agent/MCP 与本地 Agent 不共享信任边界。
  - Cloud MCP/Cloud Agent 继续严格保持七个只读工具:`musefold_status`、`get_account_status`、`list_models`、`search_prompts`、`get_prompt`、`list_skills`、`get_skill`;不得读取本地方案、Provider、密钥、文件、路径,不得执行方案或任意 GitHub Skill,不得写 Prompt、创建/取消生成或调整预算/scope。
- **数据归属与 provenance 裁决**:

| 对象 | 当前/目标权威 | Desktop | Web | 同步/导出边界 |
|---|---|---|---|---|
| DesignScheme、Revision | 当前为独立 design-scheme SQLite;目标为共享 path-free 合同下分别由 local/cloud adapter 承载 | 本地离线可用 | 后续 cloud 副本,owner/version 由 P01-2/P01-5 定义 | 当前不自动跨账号/跨设备同步 |
| Source package/snapshot/file | Desktop 受管数据库与 userData 受管文件;Web 后续只保存 cloud-safe metadata/object key | 固定 ref/commit/hash,路径仅在本地边界 | API/对象存储引用 | 绝对路径、`file://` 不出本地边界 |
| Run/step/evaluation | Desktop 本地 design-scheme ledger；Web B10 固定云端 run ledger | `trial`/`formal` 状态和审计保留 | B10 固定路径由云服务执行/记录；更多流程另验 | 不把本地运行伪装为云端已提交 |
| Asset/cover | Desktop 受管 store key/文件;Web 后续私有对象存储/signature URL | `media://` 只能由主进程受管根目录解析 | 仅返回签名 URL 或 path-free DTO | 不传绝对路径、API key、bearer token |
| Share package | 用户显式导出的私有文件,不是同步实体 | 仅 formal 可导出,导入生成新 draft/revision | Web 导入/导出由 P01-9 的 cloud-safe 方案另行定义 | 包内不得含 key/token/绝对路径 |
| market candidate | 本地短期候选缓存,不是方案事实源 | Explorer 只写候选缓存,确认后才创建方案 | 后续 cloud search cache 另定义 | 未确认不写入方案 |

  当前独立 design-scheme 库没有 `userId`/`workspaceId` 归属;登录、授权和同步开启是三个独立决定。本卡阶段不把已有本地方案自动绑定当前账号,不进入 `packages/db`,不进入 sync payload,不因登录触发 bootstrap/push。
- **领域状态与不变量**:方案用户状态只有 `draft`/`formal`,`trial`/`formal` 是 run mode;revision 不可变。formal 的 current revision 在 working draft 成功试运行并经用户显式 promote/formalize 前继续可用;来源 snapshot 固定 ref/commit/hash;删除采用软删并保留 run/evaluation/source 追溯;`unsupported` 来源不得运行;Agent 不能直接 formalize;`.musefold.design` 导入必须生成新 scheme/revision 且从 draft 开始。
- **四端矩阵**:
  - **Mobile Web**:`todo`。cloud contract 与 API/client adapter 已有(P01-5),`/design-schemes` route 已挂载，云端执行仍未闭合;目标为同一 `packages/features` 屏幕的移动列表/详情/创建/运行形态,完成条件包含 cloud-safe API/PG、loading/error/empty/ready 与 approval/blocked 等状态、web-mobile 行为 E2E 和视觉快照。
  - **PC Web**:`todo`。contract、Web 持久化(PG)与 API/client adapter 已有,方案 route 已挂载，云端执行仍未闭合;目标为同一 features 的桌面列表与 Inspector,完成条件包含 Web API/client/PG owner 隔离、web-desktop 行为 E2E 和视觉快照。
  - **Desktop renderer**:`todo`。旧版 renderer/IPC 仅作历史基线;目标为 v25 导航/薄宿主、typed IPC、本地 adapter/SQLite 和受管 `media://` 资产,完成条件包含真实 Electron IPC/SQLite E2E、macOS/Windows/Linux 实际差异记录和 Desktop 视觉快照。
  - **Desktop Agent**:`partial`。现有 Automation/CLI/local MCP 仍可访问部分本地方案能力,兼容回归继续复用主进程 runtime;目标是保留接口和安全边界,不与 Desktop renderer 合并,也不能替代三形态 UI 证据。Cloud Agent 对本地方案明确不可达。
- **六层触达与依赖**:
  - 六层目标走线为 `packages/contracts` 形状源 → `packages/platform` gateway/query/capability → `packages/features` 共享屏与状态 → Web `apps/api`/`packages/api-client`/`packages/db` → Desktop `ipc-v25`/preload/本地 runtime/SQLite → Web/Desktop 薄宿主与三端证据。本卡只定义边界,不消费这些实现层。
  - 子卡顺序为 `P01-0 → P01-1 → P01-2 → P01-3 → (P01-4/P01-5 并行) → P01-6 → P01-7 → P01-8/9/10/11/12 → P01-13`。其中 P01-4 与 P01-5 只能在 P01-1/2/3 契约、归属和 capability 稳定后并行;P01-13 是最终汇总门禁。
  - 本卡交付物为宿主/数据归属裁决、provenance 表、旧资产与现状清单、依赖 DAG、验收门禁、回滚边界和风险登记;P01-1 后续单独执行 shared contracts,不在本卡范围内打开其它实现层。
- **Capability、fallback 与状态矩阵**:
  - `hasDesignSchemes` 已由 P01-3 加入 `packages/platform`。当前下游事实为 Desktop `true`、Web `true`：两端均有入口；Desktop 有本地执行，Web 确定性管理可用而 cloud runtime 仍降级。不得用 `isElectron`、UA 或路径字符串探测宿主；Desktop Agent 继续走现有本地兼容面。
  - 旧 `packages/domain/src/capabilities.ts` 仅作为 v2.1 存量 capability 目录的对照输入,不作为 v2.5 实现依赖,也不在本卡修改;P01-3 的新 flag 只允许进入 `packages/platform/src/capabilities.ts`,命名固定为 `hasDesignSchemes`,不与旧 `designSchemes` 并用。
  - 继承 `ui-parity/06-design-schemes.md §5.1` 状态矩阵:我的方案、发现/市场、Inspector、详情、试运行相册分别覆盖 loading/error/empty/ready;生命周期另覆盖 approval/pending、blocked、cancelled、failed、conflict/version mismatch。每个后续 UI 子卡必须补真实 testid、错误恢复和视觉状态证据。
  - Host Exception 按 v2.1 字段记录 `id/surface/capability/host/reason/fallback/dataBoundary/evidence/reviewTrigger`;“暂未实现”只进入交付状态,不能冒充永久例外理由。当前暂缓属于交付计划状态,不是 `HX-*` 平台例外。
- **安全边界**:
  - shared contract、renderer、sync、Cloud MCP、日志和导出包不得携带 API key、bearer/OAuth token、safeStorage 数据、本地绝对路径或 `file://` 资产链接。
  - 旧 local DTO 中的 `filePath`、`path`、`imagePath`、`coverImagePath`、`storeKey` 等字段不能原样提升为共享云合同;共享模型只能使用 path-free 标识/metadata,本地资源由主进程解析为受管 `media://`。
  - Provider key 和账号 bearer 只经 Desktop 主进程 `safeStorage` 或服务端;本地 Agent 的 loopback token 与 Cloud OAuth 不互通。GitHub reader 只读固定 ref/commit/tree/blob,不执行仓库脚本或安装命令。
  - 方案运行的本地 spend gate、用户确认、预算、取消和审计继续保留;Cloud Agent 输出不是授权,花费动作必须回到用户可见的 GenerationGateway。
- **P01-0 验收门禁与证据计划**:
  - 引用完整性:本卡所有源码、schema、旧版规范和测试路径可由当前仓库追溯;实际旧 schema 路径固定为 `packages/desktop-contracts/src/design-scheme/schema.ts`。
  - 裁决完整性:范围/非目标、宿主模型、数据归属/provenance、四端矩阵、六层触达、依赖、capability/fallback、状态矩阵、Owner/Reviewer、Difference、回滚和剩余风险齐全;P01 总卡仍为 `todo`。
  - 安全与冻结:本卡原规划阶段无 renderer 入口；当前两宿主入口已挂载，执行依宿主分流。Cloud MCP 工具数量/名称/顺序/只读范围不变;宠物、豆包内部实现和旧 Agent runtime 无本卡实现 diff;不暴露凭据或本地路径。
  - 文档门禁:`git diff --check`、P01 stale-text/path scan、`V25-UI-SPEC §9` 差异引用检查;这些命令及结果必须由 B02 登记,不能以历史 prose 代替。
  - 只读回归:existing repository/orchestrator/Automation/CLI/local MCP tests 只证明兼容面,不生成图、不发送花费请求;任何 skip 记录原因和未覆盖范围。
- **回滚与剩余风险**:回滚仅限本卡文档与状态,不得删除或回滚 `electron/main/design-scheme`、Automation/CLI/MCP 或现有数据库。旧独立 design-scheme SQLite 是否最终并入 `desktop-db` 留给 P01-2/ADR;旧 local DTO 的路径字段不能复用;Web cloud copy 的 owner/version/sync/provenance 尚未实现;Automation 当前确认等待超时(当前约 120s)、local/Cloud 信任边界和 share/import 实现仍需后续卡验证。若后续审查发现归属冲突,先回退本卡裁决再继续 P01-2。
- **Owner/Reviewer**:GPT 负责宿主/数据裁决与证据整理;GLM 独立审查,本轮审查结论为无 P0/P1;Kimi 仅在后续 P01-6/7 负责共享 UI/renderer。P01-0 已完成架构裁决;P01-1 作为后续独立子卡执行,不因本卡完成而打开其它实现层。
- **Difference**:`N/A`(本卡仅做宿主/数据归属裁决,不改变 UI 或产品动作)。

### P01-1 共享 contracts

- **状态**:`verify`。
- **决策日期**:`2026-08-29`。
- **范围**:仅在 `packages/contracts` 建立 path-free design-scheme Zod schema、根 barrel export 和就地契约测试;不触达 `packages/platform`、API/PG、IPC/preload、features、宿主入口、SQLite/同步或旧 `packages/desktop-contracts`。
- **契约边界**:共享模型覆盖 scheme summary/detail、不可变 revision document、source binding/package/snapshot/file metadata、inputs/parameters/constraints/prompt program、compilation trace、asset/market、creation/run/evaluation/repair 生命周期、action input/result、分页/事件/结构化错误;所有公共对象 strict,本地路径/store key/绝对路径、凭据、owner/workspace 字段均拒绝。
- **状态与版本**:方案状态为 `draft/formal`,运行模式为 `trial/formal`,`unsupported` 保留但不可运行;document/format version 固定为 `1`;formal current revision 与 working draft、导入新 draft、运行计划 revision/policy/budget alias 一致性由 schema 表达,formal-only export 仍由 P01-9 host/service 权限执行。
- **来源与资产**:来源 URI 仅 HTTPS 且拒绝 credentials、签名/access key/token query/fragment;resolved ref/commit/hash 和仓库相对 evidence path 有界;asset origin 统一为 `repository | local-run`,不携带 `file://`、`media://` 或 Desktop `storeKey`。
- **证据边界**:`packages/contracts/src/__tests__/design-scheme.test.ts` 当前包含 path-free round-trip、strict unknown/owner/workspace、路径/URI/敏感字段、状态/版本/unsupported、run plan 与 import draft 等测试。它只证明 schema boundary,不证明 host authorization、PG runtime、Desktop 完整 adapter(run/Agent 编译/事件)或 renderer parity。精确计数和命令由 B02 当前 report 登记。
- **独立审查**:上一轮 Git SHA、深度/签名/compiledPrompt 与 revision alias 问题已有对应 working-tree 修复记录;formal-only export、owner/version 持久化和 host authorization 归 P01-2/P01-5/P01-9。
- **全局门禁**:根 `pnpm run check` 已在当前工作树复现通过;本卡独立 report/artifact、真实 PG/renderer consumer 和完整跨宿主证据仍未登记,不得把 check 通过扩大解释为 P01-1 或全仓 parity 完成。
- **平台矩阵**:Mobile Web:`todo`;PC Web:`todo`;Desktop renderer:`todo`;Desktop Agent:`partial`(仅保留旧 Automation/CLI/local MCP 兼容面,不能替代 shared contracts 或 renderer 证据)。
- **Difference**:`N/A`(本卡建立安全共享契约,不打开任何新入口或改变当前产品 UI)。
### P01-2 SQLite/PG 数据策略

- **状态**:`verify`。
- **决策日期**:`2026-08-29`。
- **卡片性质**:本卡只收口设计方案域的本地 SQLite 迁移纪律、云端 PG 归属/表形状和数据保留不变量;不打开 gateway、IPC、API route、features、renderer 入口或同步传输。
- **审计结论**:
  - 当前 Desktop 方案 runtime 的事实源继续是独立 `packages/core/src/db/design-scheme/*` SQLite。它不是 `packages/desktop-db` legacy 接管库的一部分,不做未经定义的合并、复制或登录触发迁移。
  - `packages/desktop-db` 继续只承载 v2.5 桌面公共账本;本卡不把 design-scheme 表塞入该库。未来若要合并,必须另开 ADR,完成 adapter、备份、replay、回退和真实旧库等价证据后再做。
  - `packages/db` 新增的是未来 Web/cloud adapter 使用的 cloud-safe 设计方案副本,不是本地库镜像。所有云表由服务端认证上下文派生 `user_id`,不接受 renderer/client 的 `ownerId`/`workspaceId`。
- **本地 SQLite 策略**:
  - 继续使用独立 namespace、`user_version` 顺序迁移、每版事务和 `foreign_keys = ON`/WAL/busy timeout;迁移只作用于 disposable 测试库或应用启动时打开的方案库,不触碰 `desktop-db` takeover 链。
  - 新增本地 scheme `version` 作为乐观锁;带 expected version 的写入必须使用条件 UPDATE 并在 0 行时返回版本冲突,revision 仍不可变。既有调用暂时可省略 expected version,由后续 gateway/IPC 接入强制传入。
  - scheme 软删只写 `deleted_at`;revision、source snapshot/file metadata、run、step、evaluation、asset 和本地分享索引继续保留 provenance。中断中的 planning/executing/evaluating run 在下次启动收敛为 failed,不得自动重跑或产生花费。
  - `source_files.path`、`source_files.store_key`、asset `store_key`、share package `path` 仅限 Desktop local adapter;不进入 shared contracts、Web DTO、PG JSON、sync payload 或 Cloud Agent 结果。
- **PG cloud-safe 映射**:
  - 新增 `design_schemes`、`design_scheme_revisions`、`design_scheme_source_packages`、`design_scheme_source_snapshots`、`design_scheme_source_files`、`design_scheme_source_bindings`、`design_scheme_assets`、`design_scheme_runs`、`design_scheme_run_steps`、`design_scheme_evaluations`。
  - scheme 带 `user_id`,`version`,软删和 current/working revision 指针;revision 追加不可变并保存 path-free document JSON;source 只保存 HTTPS/ref/commit/hash/相对 metadata;asset 只保存 cloud object reference 与媒体元数据;run/step/evaluation 带 owner、policy/provider/result provenance。
  - PG 表之间的写入必须由后续 API service 在同一 owner scope 内完成,写入 JSON 前重新经过 `packages/contracts` schema;数据库 schema 通过 `(entity_id, user_id)` 复合唯一键与复合 FK 强制子表 owner 与父表一致,不能只依赖 service 过滤。数据库 schema 不把本地 path/store key 当作云字段。current revision、working draft、formal/cover/trial 前提由 service transaction 校验并由 targeted tests 守护。
  - 本地 GitHub source package ID (`pkg_${sha256(repositoryUrl).slice(0,24)}`) 只在独立 SQLite namespace 内稳定;cloud adapter 必须生成新的 owner-scoped package ID,不得把本地确定性 ID 当作 PG 全局 ID 或用跨用户 `ON CONFLICT` 复用。
  - market candidate 仍是短期搜索缓存,不建 PG 事实表;share package 仍是用户显式导出的私有文件索引,不做同步实体。未来 Web 导入/导出另由 P01-9 定义 cloud-safe 对象存储与授权。
- **同步/保留边界**:P01-2 不启用本地方案自动同步,不因登录 bootstrap/push,不建立 local-to-cloud 双写。未来 cloud copy 必须有独立创建/导入动作、服务端 owner、revision provenance 和明确冲突策略;本地删除不会伪造云端删除。
- **四端矩阵**:
  - **Mobile Web**:`todo`;本卡只提供未来 cloud-safe PG 表形状,不提供 route、query 或网络请求。
  - **PC Web**:`todo`;同上,不得把 PG schema 误报为 Web 功能已接入。
  - **Desktop renderer**:`todo`;本地 schema/repository 继续可被旧 Agent runtime 使用,但 v25 renderer/IPC 不在本卡打开。
  - **Desktop Agent**:`partial`;现有 Automation/CLI/local MCP 继续复用本地 repository,兼容语义保持;不以 Agent 证据替代三形态 renderer 证据。
- **验收与证据计划**:
  - SQLite disposable migration replay:空库全链、v4→最新增量、重复执行 noop、失败事务回滚、namespace/schema version/foreign key 校验。
  - SQLite data semantics:expected version 条件更新与冲突、formal current revision/working draft 不变量、软删后 run/evaluation/source/asset/share retention、中断 run 恢复为 failed、market cache/share index 非同步边界。
  - PG schema/migration replay:所有新表均有 user FK、owner-scoped index、版本/软删字段、path-free JSON 约束说明;迁移目录与 Drizzle schema 同步。若运行真 PG integration,只使用 Testcontainers disposable PostgreSQL,不使用用户或线上数据库。
  - 定向门禁:design-scheme/core tests、`@musefold/db` schema tests/typecheck、受影响文件 Biome、`git diff --check`、`pnpm run check:boundaries`;根级 check 若仍被既有全仓 lint 阻断必须原样记录。
- **非目标与回滚**:不改 `packages/desktop-db` takeover baseline、不迁移真实用户数据库、不新增同步/API/IPC/导航、不删除旧表或旧 Agent runtime。回滚仅限本卡新增 PG schema/migration、本地 scheme migration/repository 版本保护、定向测试和文档;已有方案库通过迁移前备份恢复。
- **Owner/Reviewer**:GPT 负责 schema/迁移/repository/test;GLM 独立审查 owner 隔离、并发、保留、路径边界和迁移回退;Kimi 不参与本卡 renderer 实现。
- **Difference**:`N/A`(本卡不改变当前 UI;只建立后续 parity 所需的数据接缝和安全边界)。

### P01-3 platform gateway/query/capability

- **状态**:`verify`。
- **决策日期**:`2026-08-31`。
- **卡片性质**:本卡只建立共享 `MusefoldGateway` 的 design-scheme 可选域、查询 key 和 capability/fallback 合同;不实现 Desktop IPC、本地 adapter、Web API/PG consumer、features、导航、路由或任何新入口。
- **目标**:让后续 P01-4/P01-5/P01-6 使用同一组 path-free contract 类型、方法名和缓存分区,宿主是否已接入由 `PlatformCapabilities.hasDesignSchemes` 唯一表达。
- **网关方法**:覆盖当前 `packages/contracts` 已定义的 list/detail（detail 携带 revision/assets/sources）、create/update/modify/prepareRun/run/cancel、cover/formalize/promoteWorkingDraft/rename/remove、upstream check、market search、share import/export 与事件订阅；`confirmInstall`、`prepareImportPackage` 只作为 canonical optional lifecycle seams，不冒充宿主已部署能力。方法参数/结果全部复用 contracts 的 `z.input`/`z.output` 推导类型,不复制旧 `AppResult`、绝对路径 DTO 或凭据字段。
- **Capability/fallback**:`hasDesignSchemes` 是唯一开关；P01-3 建缝时两端均为 `false`，该历史检查点下游为Desktop `true`、Web `false`；P01-7之后实际两端均为`true`，逐项接线仍需独立验收。`designSchemes` gateway 保持 optional；需要访问时必须经过 typed capability guard，缺失时抛稳定 `CAPABILITY_UNAVAILABLE`，不得用 UA、`isElectron`、URL 路径或空对象冒充可用。
- **Query keys**:使用 `design-schemes` 根前缀,分区 `list/detail/market-search`;list/search query 对象原样作为 key segment,不同 query 不得互相覆盖,所有 scheme invalidation 以根 key 为前缀。
- **平台矩阵**:
  - **Mobile Web**:`todo`;只登记 capability=false/fallback,不新增 route 或网络请求。
  - **PC Web**:`todo`;同 Mobile Web。
  - **Desktop renderer**:`todo`;只保留未来 IPC adapter 接缝,不触达 `ipc-v25`/preload。
  - **Desktop Agent**:`partial`;继续走旧 Automation/CLI/local MCP,不消费本接口,不以 Agent 证据替代 renderer。
- **验收与证据**:platform tests 覆盖 capability 常量、optional gateway、guard 成功/缺失、稳定错误码、query key 分区/前缀。当前下游 capability 为 Desktop `true`、Web `false`；前者只证明本地共享域入口可用，后者继续守住未完成 cloud runtime。精确测试数、typecheck/Biome/boundary 输出由 B02 当前 report 登记。
- **依赖/交接**:P01-4/P01-5 只能在本卡完成后分别实现 Desktop/Web adapter,并将 `hasDesignSchemes` 改为真实可用状态;P01-6 才能消费 `useGateway().designSchemes` 并实现 loading/error/empty/ready UI。
- **Difference**:`N/A`(只新增未启用的数据接缝,不改变当前 UI)。

### P01-4 Desktop v25 IPC

- **状态**:`doing`。
- **决策日期**:`2026-08-31`。
- **卡片性质**:本卡把 design-scheme 的 Desktop transport 接入 v25 单通道,并建立主进程到 renderer 的 path-free adapter 边界;不实现 Web API/PG consumer、共享 features、导航/入口或把旧 Automation/CLI/MCP 面迁入 v25。
- **审计结论**:现有桥固定为 `musefold:invoke` → `ipc-v25/gateway-bridge.ts` 方法表 → `preload/v25.ts` 纯转发 → `src/v25/desktop-gateway.ts` typed response parse。design-scheme 旧 runtime 继续位于 `electron/main/design-scheme/*` 与独立 `getDesignSchemeDb()` SQLite;不能复活旧 `window.api.designScheme` 多通道,不能把 `resolveActiveWorkspace(getDb())` 误用于该独立数据库。
- **Owner policy**:本卡明确采用 machine-local policy:独立 design-scheme SQLite 不声明账号/工作区隔离,不接受 renderer 的 `ownerId`/`workspaceId`,不因登录/切换账号自动绑定或同步;任何需要账号归属的 cloud/跨账号语义留给 P01-5/P01-10 的明确 owner migration。若宿主尚未能证明该策略,方法必须返回结构化 `CAPABILITY_UNAVAILABLE`/`DESIGN_SCHEME_UNAVAILABLE`,不得静默暴露数据。
- **方法表**:部署 `designSchemes.*` 18 个方法:`list/get/searchMarket/create/update/modify/cancel/confirmInstall/selectCover/formalize/promoteWorkingDraft/rename/remove/checkUpdate/importPackage/exportPackage/prepareRun/run`；每项在主进程用对应 contracts input schema 校验，再进入 domain facade。`confirmInstall` 于 2026-09-03 进入部署方法表（主进程按 senderId 经执行登记表 confirm → 创建会话继续/整体取消；Web 端 501 fail-closed）；`prepareImportPackage` 仍是 canonical optional lifecycle seam，不进入数据通道方法表；legacy local requestTemplate 不得用平行 DTO 偷渡。
- **错误与安全**:业务失败统一 `BridgeError(code,message)` 信封;legacy `AppResult`/异常先映射到稳定错误码,unexpected error 不得把绝对路径、store key、provider/key 细节或堆栈返回 renderer。主进程可在受管根目录内使用本地路径,返回值、事件和错误只允许 canonical path-free schema;renderer 输入的 owner/workspace/path/store-key/credential 字段必须在 bridge 层拒绝。
- **Preload/event**:preload 继续只转发 `invoke`;新增受控 design-scheme event listener 时仅面向 v25 主窗口,保持 listener identity/unsubscribe,不触达宠物 preload/window。事件 payload 由 renderer gateway 用 `designSchemeEventSchema` parse 后才交给订阅者;畸形事件安全丢弃或映射结构化错误,不穿透。
- **Desktop gateway**:`createDesktopGateway()` 的 `designSchemes` adapter 覆盖 17 个 deployed 方法并逐一固定 IPC 名称和 response schema；缺少 v25 bridge 时继续 `BRIDGE_MISSING`，结构化失败映射 `DesktopGatewayError`，成功数据再次通过 contracts schema parse。`prepareRun` 为 optional platform seam，Web adapter 不实现；Desktop capability 已随真实 adapter 开启，不能据此声称 Workbench 运行闭环完成。
- **当前实现状态**:`partial success adapter, Desktop capability open`。18 项 deployed 方法已有严格方法集和 transport 映射；确定性 CRUD、working draft、导入导出、owner-safe 历史来源、canonical run/cancel/event 均有主进程实现。checkpoint `607e7b5` 已固化 cancellation-wins、active job fan-out 与 terminal event 重入仲裁。本轮新增主进程权威 text-only `prepareRun`：renderer 仅提交选择、文本值与执行设置，主进程读取 exact revision、status/fidelity、source bindings 和 Provider metadata/capabilities，生成 `desktop-fixed-v1` 四步计划；canonical schema 与 `validateDesktopFixedRunPlan()` 双检，run 前再次核对完整槽位顺序、来源/Provider/方案快照。reference assets、图片槽位、缺失/多余输入、revision/scheme mismatch 和未知 Provider 稳定 fail-closed；legacy revision 未声明 `sourceSnapshotIds` 时从绑定 ID 稳定归一化。**Workbench run/cancel 接缝已接通**（2026-09-01）：`apps/desktop/src/v25/design-scheme-actions.ts` 的 `useDesignSchemeComposerHandlers()` 向 `WorkbenchScreen.designSchemes` 注入 `onRun`（renderer 严格入参 → `prepareRun` → 计划原样交 `run`，await 终态 `RunResult`；无 Provider / 带参考图 / modify 附件在进入 prepareRun 前显式拒绝）、`onCancelRun`（`cancel({ executionId })`，取消先于主进程登记时以 `DESIGN_SCHEME_EXECUTION_NOT_FOUND` 标记并在 prepareRun 返回后不再启动 run）与 `runInputSupport: 'text-only'`；按 executionId 订阅主进程事件驱动会话账本刷新，终态后退订。真实 Electron 回环用例证明请求进入 generation runtime 后可由停止钮取消，Workbench generation ledger 与 Design Scheme run ledger 同时收敛为 `cancelled`，Composer 输入保留且没有新方案资产提交。**Workbench Agent 缝已接通**（2026-09-03）：同一 `useDesignSchemeComposerHandlers()` 注入 `onCreate`（brief 与历史来源 runId/assetId/includePrompt 身份 → 主进程 `create`，无 document、无预解析来源；brief 含 GitHub 地址在 renderer 即拒绝）与 `onModify`（挂载附件的 exact revision + 指令 → 主进程 `modify`）；Agent 缝只依赖已部署的 `create/modify`，旧桥缺 `prepareRun` 时不受影响。主进程 `design-scheme-agent-adapter.ts` 驾驭保留的创建/修改会话：登记 execution registry（create/modify 可 cancel）、旧事件逐条映射 canonical creation event（不合法条目降级或丢弃）、`draft-ready` 与返回值同一次映射、AppError → BridgeError；文本连接沿用 v2.1 `AiConnectionStore`（与 Skill runtime 同源，可在「设置 → Agent 连接」配置（2026-09-03 补齐 `AgentConnectionsPanel`）），无连接时 `DESIGN_SCHEME_AGENT_AI_UNAVAILABLE` + canonical `failed(configure-ai)`；`checkUpdate` 改以真实文本连接做上游重编译，并修正 `requestedRevisionId` 未透传的缺陷；修复 v2.1 历史来源 `history:<id>` 伪 URI 导致 `get` 映射失败的 parity 缺陷（读路径降级、写路径改用 packageId/snapshotId）。**GitHub 来源安装确认已闭环**（2026-09-03）：`confirmInstall` 进入部署方法表（18 项），主进程 handler 按 senderId 经执行登记表 `confirm` 送回创建会话（install 继续 → 固化快照 → Analyst → Compiler；cancel 整体取消并 tombstone），未知/他窗口执行 `DESIGN_SCHEME_EXECUTION_NOT_FOUND`，非等待确认的执行（如 modify）`DESIGN_SCHEME_EXECUTION_NOT_CONFIRMABLE`；create 接受 `sourceUris`，renderer 从 brief 提取并归一化 GitHub 仓库地址（`tree/blob/.git` 归一、拒绝凭据/查询参数/非仓库路径），gateway 缺 `confirmInstall` 时在 renderer 拒绝。Agent 创建/修改期间 `state` 与运行中 `trace` 事件映射为 Composer 上方一行进度（`scheme-agent-progress`），终态即消失。**参考图运行已接通**（2026-09-03）：`prepareRun` 不再 text-only——`executionSettings.referenceAssetIds` 接受当前方案版本资产 id 或 Composer 上传暂存 id（主进程 `resolveUploadedReferenceById` 只在受管 uploads 目录按已知扩展名探测），按声明顺序分配到图片槽位（`image` 最多 1 张、`image-set` 最多 maxItems；必需槽位至少 minItems，可选槽位有多少收多少），必需不足 / 超出全部槽位 / 方案无图片槽位分别 `DESIGN_SCHEME_INPUT_REQUIRED` / `DESIGN_SCHEME_INPUT_MISMATCH`，未知 id `DESIGN_SCHEME_REFERENCE_MISSING`；run 阶段同一解析规则落地为受管本地图交生图，运行后清理暂存副本，上传原件与方案库都不改。仍未完成：Web runtime/assets/package 与成功出图 Electron E2E；Desktop `hasDesignSchemes=true`、Web `false`。
- **当前 evidence**(2026-09-01 增补):Composer 接缝定向测试——`apps/desktop/src/v25/__tests__/desktop-shell.test.tsx` 17 个用例覆盖 prepareRun 严格入参（无 plan/schemeStatus 夹带、可选键不夹带 undefined）、prepared 原样交 run、fail-closed 拒绝、prepareRun 结构化拒绝上抛、cancel/already-terminal、取消先于登记、取消真实失败不误标、陈旧 executionId 取消 no-op、事件订阅/退订与旧桥缺 prepareRun 整组缺省；`packages/features` 共 23 个文件、297 个测试通过（`workbench-schemes` 14、`integration-store` 15），根 typecheck 与 Biome 通过。`tests/v25/electron.workbench.spec.ts` 9/9，新增 formal text-only 方案经真实 renderer、`musefold:invoke`、main prepare/run、回环 Provider 与停止取消的 runtime E2E；两套 SQLite ledger 均为 `cancelled`，输入保留且新增方案资产为 0。
- **当前 evidence**(2026-09-01):本轮受影响组合命令覆盖 contracts fixed plan、主进程 builder/domain/run adapter、gateway bridge、Desktop gateway 与 Web api-client，共 8 个测试文件、151 个测试全绿；根 `pnpm run typecheck` 通过。新增回归覆盖 strict prepare 输入、固定四步计划、formal/fidelity/source/Provider blocker、legacy source snapshot 归一化、完整槽位/来源/Provider 执行前复核、canonical authority mismatch cleanup 与 prepare→run 原样往返；既有受管图片 reference run 和 cancellation-wins 回归保持通过。最终根 `pnpm run check` 为 182 个测试文件、1357 个测试、35 个 Turbo task 全绿。最新完整 v25 E2E 为 98 passed、1 failed、5 skipped，唯一失败是 macOS 原生 fullscreen 前 Electron shell 无法取得前台焦点；完整 Electron project 为 33 passed、1 failed、1 skipped，同一 shell focus 前置失败，skip 为真实 key 场景。此前一次完整复跑曾得到 99 passed、5 skipped 与 34 passed、1 skipped，但没有 durable report/artifact，只能作为历史记录。无 durable report/artifact，P01 继续 `doing/unregistered`。
- **平台矩阵**:
  - **Mobile Web**:`N/A`;本卡仅 Desktop IPC。
  - **PC Web**:`N/A`;由 P01-5 实现 HTTP/client。
  - **Desktop renderer**:`doing`;导航/详情、18 项 v25 transport、文本 + 图片输入的权威 prepareRun、canonical run/cancel/event 与 Workbench Composer `onRun/onCancelRun` 已接线，且有真实 Electron 取消路径证据；`onCreate/onModify` 亦已接线，GitHub 来源经 confirmation-required → `SourceInstallConfirmDialog` → `confirmInstall` 闭环，Agent 过程进度在 Composer 展示，参考图运行经上传暂存 id 接通；成功出图 Electron E2E 仍待。
  - **Desktop Agent**:`partial`;继续走旧 Automation/CLI/local MCP,不消费 v25 gateway,不以 Agent 证据替代 renderer。
- **验收与证据**:先证明 fixed wire contract 与 fail-closed 行为:exact method set/no legacy names/strict validation/redacted envelope;preload event listener identity/unsubscribe;desktop gateway exact payload/response/malformed response/missing bridge。成功 legacy mapping 要求另加 repository/domain adapter tests,不能由 unavailable handler 测试替代。真实 Electron E2E 需 build 后运行,不使用真实 relay generation/花费额度。
- **依赖/交接**:本卡完成后 P01-5 可复用 canonical method names independently实现 Web adapter;P01-6/P01-7 只能在 Desktop adapter 的 capability/错误/事件边界和真实 Electron evidence 稳定后消费 `designSchemes`;P01-9/P01-10 负责把 explicit unsupported seams 替换为完整 lifecycle,不得绕过本卡直接暴露旧 DTO。
- **风险登记**:独立 SQLite 无 owner 隔离、canonical contracts 缺 install-confirmation/run requestTemplate/package staging 表达、旧错误和结果含本地路径、event shape 与 canonical union 可能漂移、长任务需 shutdown/account-change cleanup。所有风险在后续卡关闭前不得标记为已迁移。
- **Difference**:Workbench 方案运行由 v2.1 的「提交即清空、后台跑」改为 **await 终态再复位**：运行中提交钮转停止钮（Esc 同义），成功后正文/槽位/引用清空而附件保留多轮；`blocked/failed` 在 Composer 上方就地显示 `scheme-submit-error` 并保留全部输入供修正；取消为中性提示不报错。运行回合仍落在活动会话账本（草稿态首次运行才建会话），时间线在宿主运行期间短轮询。

| 子卡 | Owner | Reviewer | 依赖 | Mobile Web | PC Web | Desktop | Desktop Agent | 当前状态 / evidence |
|---|---|---|---|---|---|---|---|---|
| P01-0 宿主模型与数据归属 | GPT | GLM | — | todo | todo | todo | partial | `verify`;架构裁决、provenance 表、旧资产盘点和 fail-closed 边界已记录;只读回归只能证明 legacy/Agent 兼容面,不打开入口 |
| P01-1 共享 contracts | GPT | GLM | P01-0 | todo | todo | todo | partial | `verify` slice;`packages/contracts/src/design-scheme.ts` 与就地 schema tests 证明 path-free/strict 状态合同;不证明授权、PG、IPC 成功或 renderer parity |
| P01-2 SQLite/PG 数据策略 | GPT | GLM | P01-0,P01-1 | todo | todo | todo | partial | `verify` scaffold;SQLite v1→v5 migration/repository/recovery tests 与 PG cloud schema 存在;API/client consumer 已由 P01-5 接入,真 PG runtime、真实 v2.1 语料/备份演练仍缺 |
| P01-3 platform gateway/query/capability | GPT | GLM | P01-1,P01-2 | todo | todo | doing | partial | `verify` seam；optional gateway、query partitions 与 `CAPABILITY_UNAVAILABLE` 有定向测试；下游当前 Desktop/Web `hasDesignSchemes=true`，不代表双宿主完成 |
| P01-4 Desktop v25 IPC | GPT | GLM | P01-1,P01-3 | N/A | N/A | doing | partial | 18 项 deployed transport（2026-09-03 `confirmInstall` 部署）、确定性 SQLite CRUD、`.musefold.design`、历史来源与 canonical run/cancel/event 已接线；`607e7b5` 固化 cancellation-wins。本轮新增主进程权威 text-only `prepareRun`、四步计划及执行前完整快照复核；受影响组合 8 文件/151 tests，根 check 182 文件/1357 tests 全绿。2026-09-01 Workbench Composer `onRun/onCancelRun` 已接到 prepareRun → run → cancel（desktop-shell 17 tests），Electron Workbench 9/9 并证明回环 Provider 下双账本取消收敛；2026-09-03 Workbench `onCreate/onModify` 接到主进程 Agent adapter（desktop-shell 22 tests、domain 61 tests、agent-adapter 4 tests）；成功出图 E2E 已闭环（2026-09-03：回环 PNG Provider，Electron Workbench 10/10，双账本 success/completed、评估落库、Composer 复位；同日 GitHub 安装确认、Agent 过程进度与参考图运行闭环；plan builder 35、run adapter 20、domain 65 tests）；Desktop capability true |
| P01-5 Web API/client/PG | GPT | GLM | P01-1,P01-2,P01-3 | doing | doing | N/A | N/A | owner-scoped PG schema、17 条 API routes 与 api-client adapter 已接入；确定性 CRUD/working-draft selector、B9 上传资产、B10 固定 prepare/run/cancel 与持久事件可用；B11 market 已接公开搜索/分页/缓存/PG 限流，并通过本机统一验收；Agent create/modify/package 仍结构化 501，完整来源/云流程继续验收 |
| P01-6 共享 schemes features | Kimi | GLM | P01-3,P01-4,P01-5 | doing | doing | doing | N/A | `packages/features/src/design-schemes` 已含列表/详情/来源/相册/版本/跨屏 integration；formal=current、trial/modify=exact working draft 已有回归测试；新增可选详情生命周期回调，覆盖从列表打开、详情返回和详情删除成功通知宿主；正式方案详情已补齐常驻 `runtime-scheme-modify`「在 Composer 中修改」按钮，缺少宿主接缝时禁用并解释且保留下拉菜单补充动作；SchemeAlbum 已补齐左右方向键环绕、横向触控滑动与短滑/纵向滑动忽略，滑动后不会误开 Lightbox；`WorkbenchScreen.designSchemes` 的宿主提交处理拆为 `onRun/onCancelRun/onCreate/onModify` + `runInputSupport` 独立接缝：await 终态再复位、运行中停止钮、按 executionId 取消、blocked/failed 就地 `scheme-submit-error` 且保留输入、text-only 宿主下图片槽位/参考图禁用并解释（`schemeSubmitDisabledReason`）、运行落活动会话并短轮询时间线；历史 features 定向测试 23 个文件、297 个测试通过；Desktop 成功与取消已有 Electron runtime 记录，云端完整运行与最终跨端证据仍待 |
| P01-7 三端薄宿主入口 | Kimi | GLM | P01-6 | done | done | doing | N/A | Web `/design-schemes` route 与 Desktop v25 view/nav 已挂载并消费 `?scheme=<id>`；Desktop `hasDesignSchemes=true`。2026-09-03 生产 `WEB_CAPABILITIES.hasDesignSchemes=true`：壳导航注册「设计方案」（桌面侧栏/移动底部栏），`web.design-schemes.spec.ts` 以生产 capability 出 8 条双视口证据（云列表分组、`?scheme=` 深链详情、rename 云端回写、市场/导出 501 可读降级、附件挂 Composer 后提交禁用并解释）+ 双视口视觉基线；上述为 2026-09-03 历史证据，B9 上传资产与 B10 固定 run/cancel 已补验收，B11市场发现已补验；B37–B42异步Agent后端和B46–B51包后端/共享导入导出已有分批证据。旧同步兼容接口仍有501，异步Agent产品、刷新恢复与真包联合未闭合 |
| P01-8 跨屏 ScreenIntent | GPT+Kimi | GLM | P01-6,P01-7 | partial | partial | partial | partial | Prompt/History/Schemes→Workbench 的 zustand 一次性 intent 与附件语义已接入；Desktop 宿主已传 `onRun/onCancelRun`，并有从 Workbench 选择正式方案后进入运行与取消的 Electron trace；`onCreate/onModify` 亦已传入（方案中心「在 Composer 中修改」、提示词库「创建方案」、历史来源创建可真实执行），scheme-surface deep link 和成功出图端到端 trace 仍缺 |
| P01-9 来源与分享包管线 | GPT | GLM | P01-1,P01-2,P01-5,P01-6 | partial | partial | verify | partial | GitHub/历史来源与 legacy share runtime 保留；Desktop `.musefold.design` secure staging/archive 已接入 domain `importPackage/exportPackage`;2026-09-07 B7-T3 `electron.design-schemes.spec.ts` 4/4(B4 往返 + 导入草稿重命名/删除,`MUSEFOLD_E2E` 对话框旁路);B46–B49云上传/确认/原子导入/正式归档已有真实后端证据，B50/B51共享页面和Web下载已接；刷新恢复、三方向真包与独立生成包扫描未闭合。通用分享/导入仍归P03 |
| P01-10 完整生命周期编排 | GPT | GLM | P01-4,P01-5,P01-6,P01-9 | todo | todo | doing | partial | deterministic lifecycle、working-draft promotion、canonical run/cancel/event、`607e7b5` cancellation-wins、主进程权威 text-only `prepareRun`、Desktop Workbench run/cancel 接缝与 Agent create/modify/recompile（Workbench `onCreate/onModify` → 主进程 Compiler/Reviser；`checkUpdate` 上游重编译）已完成；取消路径已有 Electron runtime E2E。GitHub 来源安装确认（`confirmInstall`）已闭环；Agent 过程进度已在 Composer 展示，参考图运行经上传暂存 id 接通；Web runtime 和跨宿主成功出图证据尚未完成 |
| P01-11 Automation confirmation/spend | GPT | GLM | P01-4,P01-7,P01-10 | N/A | N/A | todo | partial | v25 `AutomationConfirmCard` 已于 2026-09-06 交付并验证(U05/U01,`electron.settings-open.spec.ts` 9/9);完整 spend/审批矩阵仍待;超时仍 120s |
| P01-12 Agent 兼容回归与 Cloud MCP 边界 | GPT | GLM | P01-10,P01-11 | N/A | N/A | N/A | partial | local Automation/CLI/MCP 兼容面与 Cloud 七工具 manifest 分开验收;已连接应用撤销 UI/401 再查 consent 已于 B3-T1 闭合;缺两独立远程客户端与禁止能力负例汇总 |
| P01-13 三形态与安全证据 | 主代理 | GLM | P01-7..P01-12 | todo | todo | todo | partial | Web desktop/mobile、Electron、Agent/MCP、视觉、source/asar/package secret/path scan 全量收口卡 |
| B01-R bridge 方法表修复 | GPT | GLM | B01,P01-4 | N/A | N/A | doing | N/A | 修复手写 `ALL_METHODS` 与 `buildMethods()` 漂移,建立 method-name 单源/双向断言；当前 18 项 deployed 方法由 contracts 方法表统一驱动 gateway/preload/domain 校验（2026-09-03 `confirmInstall` 入表，bridge/gateway/domain/api-client/API 五处同步） |
| U03-spend 费用与审批 | GPT+Kimi | GLM | U03,D01 | partial | partial | partial | partial | B6 产品恢复、B10 本地持久账本、B12 可信身份/恢复与 B13 云端三入口回执/固定凭据发送已有分批验收；B16已接正式恢复与安全存储支撑，SP-P4托管业务接线、P5 扩展/P6 完整恢复仍待。普通用户主动提交不新增管理员审批，Cloud MCP 无 spend tool；最新证据见测试手册 §5.6 |
| U01-onboarding 首启引导 | Kimi | GLM | U01,U05 | done | done | done | N/A | 2026-09-06 交付:四步流/三轨/哨兵/不重放,web.onboarding 双视口 10 + electron.onboarding 3 通过;Desktop Agent 无引导语义 |



### P02 Skill runtime、历史来源、素材与微调

- **状态**:`todo`
- **范围**:固定 commit/hash 的本地 GitHub Skill、Skill 运行对话、历史来源、通用素材 Dock、微调目标/父子谱系、Composer 工作模式与 `/` 指令。Prompt 引用已在 U03 收口,本卡不得重复实现或退回客户端权威文本。
- **安全**:不执行 Skill 脚本;本地 Skill 不进入 Cloud OAuth;Cloud 只读官方 registry;费用动作仍经可见 GenerationGateway。
- **验收**:版本/hash/输入/最终 prompt 快照进入 ledger;恶意 Skill 无文件/网络/密钥/提权能力;运行和历史可解释。

### P03 分享/导入、Automation 与 Cloud MCP 控制面

- **状态**:`todo`
- **范围**:
  - 导出/导入包:范围、校验、预览、内容指纹去重、跳过策略、全局 Query invalidation;不含密钥。
  - 本地 Automation:开关、令牌掩码/复制/轮换、预算、确认卡、审计、接入向导、Skill 安装状态。`AutomationConfirmCard` 与 preload `onAutomationEvent` 已于 2026-09-06 B2-T2 接线并验证(桌面 `open` 分区 + 壳级浮层,超时仍 120s);`electron.settings-open.spec.ts` 9/9。余 Skill 管理条目与完整 spend 矩阵。
  - Cloud MCP:已连接应用 + 撤销已于 2026-09-06 B3-T1 交付并验证(`GET/DELETE /api/v1/mcp/authorizations`,`web.cloud-mcp.spec.ts` 6/6);七工具只读白名单不扩大。JWT 无法吊销是已知限制,撤销靠 consent 再查,不改成「只标 revoked」。
  - 命令面板:只注册真实可执行命令。
- **触达**:contracts/platform 可选域、features/settings/shell、system/import/export、automation、api OAuth/MCP、双宿主文件能力。
- **验收**:旧 token 轮换后即时失效;撤销 grant 后 401;导出扫描无 key/token/path;Agent 无生成/花费工具。

## 6. 冻结面与入口

### X01 豆包入口保留、宠物冻结

- **状态**:`partial`
- **宠物**:`frozen`。禁止修改 `apps/desktop/src/pet*`、pet preload、`electron/main/pet/` 及其语义;只跑既有测试。
- **豆包**:内部实现 `frozen`;v2.5 保留一个可见入口,点击交给既有豆包窗口/登录控制面。Web 不伪造豆包本地能力,提供明确不可用说明或不展示。
- **允许触达**:v25 capability/adapter/入口及其测试;不触达 doubao-web 算法、登录同步和迁移。
- **验收**:入口可达;冻结实现 diff 为 0;Provider/账号/密钥不泄漏;pet 专用 preload 暴露面不变。

## 7. 反向审计与交付

### Q01 旧测试反向映射与遗漏扫描

- **状态**:`todo`
- **动作**:枚举 `v2.5-baseline` 和当前树的测试/fixture/E2E,把每个旧用户意图映射到 B02 evidence id;标记直接覆盖、间接覆盖、route mock、runtime-e2e、存在但 CI skip、环境 blocked、frozen 或不适用。
- **重点**:bridge/preload/account domain;API-client 全方法;capability 全字段;keychain;sync/owner;purge/Lightbox/saveAsset/reference/retry/cancel;设置分区;迁移 replay;Cloud MCP/Skill 禁止能力。
- **同步专项**:保留 `unset/enabled/paused/conflict`、zero transport、首次顺序、paused mutation+usage、逐条 conflict resolution(含 duplicate)、logout/relogin preservation 和 secret scan 的行为证据。四态截图若仍在 `.results`，只能登记为“临时附件/不可复现”,不得写“已人工检查”。
- **验收**:不存在“有入口但无逆操作/错误/空态/刷新测试”;不存在被删除测试或 snapshot 替换造成的假绿;每个 `test.skip` 都有产品边界或环境原因。

### Q02 本地全量门禁与真实产物

- **状态**:`todo`
- **门禁**:
  - `pnpm run check`
  - `pnpm --filter @musefold/api run test:integration`(显式 `RUN_DATABASE_TESTS=true`)
  - PG/SQLite migration replay、`pnpm --filter @musefold/desktop-db run db:bundle` 与 bundle freshness diff
  - `pnpm run test:e2e`、Electron project
  - 对应平台真实 package-smoke,缺产物/错误平台产物不得 skip
- **视觉**:固定时间、mask 动态值、保留成功 run artifact;人工检查仅作辅助,不能替代 `toHaveScreenshot`/持久 baseline。
- **同步证据边界**:现有 Electron sync spec 使用本地 mock server 和临时 userData;行为可作为定向 evidence,不等于生产云端、跨设备或持久视觉通过。

### Q03 CI/CD 等价门禁

- **状态**:`todo`
- **现状缺口**:PR 使用 `turbo ... --affected`。2026-09-07 B7-T5 PR/Main 已加并行 `database-integration` job(`@musefold/api` + `@musefold/worker` `test:integration`)。B8-T4 同 job 末尾加 `desktop-db db:bundle` + `git diff --exit-code -- packages/desktop-db/src/migrations.generated.ts`;API integration 含空库 migrate replay 幂等。Web E2E 仍用 Next dev server;package-smoke 缺产物时 `test.skip`;没有独立 source/path/secret/asar/release artifact scan。活体 Web/Electron UI 不进 CI(需 New API 与本地 8787)。
- **子卡**:
  - **Q03-pg-replay**:`partial`。B8-T4:`apps/api/src/__tests__/integration/migrate-replay.integration.test.ts` 空库 `migrateDatabase` 两次,`drizzle.__drizzle_migrations` 行数相同且 > 0;随 `database-integration` 跑。仍缺 upgrade 路径、owner/version/document identity 拒绝和 journal 全集校验。
  - **Q03-db-bundle**:`partial`。B8-T4:`tests/repo/desktop-db-bundle-freshness.test.ts` 纯读对齐 journal/`migrations/*.sql`/`migrations.generated.ts`;CI `db:bundle` + `git diff --exit-code`。仍缺打包 smoke 确认 asar 吃内联迁移。
  - **Q03-package-smoke**:`todo`。由 workflow 将目标 artifact 路径/平台传给 spec;macOS、Windows x64/arm64 分别启动自身产物;缺产物、错误平台或 skip 直接失败,禁止 macOS artifact 掩盖 Windows。
  - **Q03-e2e-runtime**:`todo`。确认 Release verify 与 package jobs 都跑新 build 后的 Web/Electron E2E;Web production/standalone runtime 与 dev-server evidence 分开登记;`reuseExistingServer` 在 CI 禁止复用旧 3399。
  - **Q03-security**:`todo`。加入 source/userData/backup/export/asar/DMG/Windows unpacked 的 secret/path scan,并扫描日志、MCP response、HTTP body;不记录凭据、Prompt 正文或绝对路径。
  - **Q03-full-gate**:`todo`。明确 PR affected 与 Main/Release full gate 的差异,并把 PG、worker runtime、migration、bundle、package-smoke、安全扫描的必跑关系写入 workflow。
- **发布边界**:工作流和 CI 验证可以落地;tag、站点发布、更新 feed 和生产部署须另行明确授权。

### V01 视觉 evidence 持久化与环境政策

- **状态**:`todo`
- **范围**:把同步四态、明暗主题和各端快照纳入可复现 baseline 或成功/失败都上传的 evidence artifact;统一 fixed clock、mask、viewport、OS、字体和 snapshot ownership。
- **现状**:同步截图通过 `testInfo.outputPath()` 写入 gitignored `.results`,当前 workflow 失败才上传;`toHaveScreenshot` 没有为四态建立 committed baseline。Playwright `reuseExistingServer: true` 可能复用陈旧 3399。
- **验收**:四态行为与截图可在指定 commit/命令重现;CI 不能静默 skip;视觉差异、环境 blocked 和失败附件都可追溯;不把人工目测或临时附件写成完成证据。

## 8. 当前批次

端侧列是实现状态汇总,不是规范替代。`N/A` 必须有语义理由;Desktop Agent 兼容证据单独记录,不能替代 Desktop renderer。

| 卡 | Owner | Reviewer | Mobile Web | PC Web | Desktop | Desktop Agent | 总状态 | 当前证据 |
|---|---|---|---|---|---|---|---|---|
| B00 | 主代理 | — | verify | verify | verify | N/A | verify | B8 最新历史批次结果见测试手册；HEAD 加未提交工作树，manifest 尚未完成当前 report/commit 绑定。旧完整 E2E 失败不能覆盖 B8，也不把 B8 文字升级为机器 pass |
| B01 | GPT | GLM | partial | partial | verify | partial | verify | 既有公共域 gateway/IPC mapping 与 canonical method set 有当前定向测试；B01-R 当前 18 项 Design Scheme deployed 方法、全域异常脱敏、malformed envelope 和 preload event lifecycle 已通过定向验证；Web/真实 Electron/全量门禁仍由 B02/Q02 登记 |
| D01-generation | GPT | GLM | N/A | partial | partial | partial | partial | generation ledger、API 幂等/取消和 worker lease/epoch 有定向证据;worker 主要为 fake dependency,真 PG/Graphile Worker、外部 Provider、重启/reconcile 与跨端成功路径仍待 |
| D01-sync | GPT | GLM | partial | partial | partial | partial | partial | consent 四态、显式 workspace/adopt、zero transport、首轮顺序、paused mutation/usage、逐条 local/remote/duplicate、logout/relogin preservation、secret scan 已有定向证据;Prompt/Folder/Tag 目录 CRUD 已修复 workspace 作用域;跨 owner seed、usage/version/max merge、两设备/revoke/cursor expiry 与真云端仍待 |
| U01-fullscreen-inset | GPT+Kimi | GLM | N/A | N/A | verify | N/A | verify | 代码与 IPC 消费已接线，B3/B8 有执行记录；原生 macOS fullscreen 与 IPC fallback 分开验收，Windows 自身窗口几何待 G-UI-02/Release 补证 |
| U03-session/prompt | GPT+Kimi | GLM | partial | partial | partial | N/A | partial | 会话、比例与 Prompt 引用主路径已有定向证据;Web 主要为 route mock,Electron 为 disposable SQLite/失败路径,多图保存、费用审批、移动键盘与稳定全端视觉 evidence 仍缺 |
| U02-prompt-dirty-guard | Kimi | GLM | verify | verify | verify | N/A | verify | ShadCN Dialog/AlertDialog 关闭防护及 Escape/X/外点拦截已有定向行为证据;历史计数未绑定当前 report,完整提示词库 parity、真 API/PG 和视觉基线仍由 U02/B02 收口 |
| U05-account-confirm-password | Kimi | GLM | verify | verify | verify | N/A | verify | ShadCN Input/Label 确认密码与失配 Enter 零请求、匹配 payload 边界已有定向证据;历史计数未绑定当前 report,完整账号/连接/设置 parity 仍属 U05/S01 |
| P01-0..P01-13 设计方案 | GPT/Kimi | GLM | doing | doing | doing | partial | doing | contracts、SQLite/PG、Desktop/API/client adapters、shared features、working draft、Desktop 导入导出及导航/详情已有证据；Desktop capability true，canonical run/cancel/event、text-only `prepareRun` 与 Workbench Composer `onRun/onCancelRun` 已接线（受影响组合 151 tests、desktop-shell 17 tests、features 297 tests 通过）；Electron Workbench 9/9 并证明回环 Provider 下取消、双账本收敛、输入保留和零方案资产提交。主进程 Agent create/modify adapter 已实现并经 Workbench `onCreate/onModify` 接通（desktop-shell 22、domain 61、agent-adapter 4 tests）；GitHub 来源安装确认（`confirmInstall`，2026-09-03）已闭环；Agent 过程进度已在 Composer 展示，参考图运行已接通（text-and-images）；成功出图 E2E 已闭环（2026-09-03，Electron Workbench 10/10）；生产 Web capability 已开启（2026-09-03，`web.design-schemes.spec.ts` 双视口 8 条 + 基线，云端不可用面结构化 501 诚实降级）；B9/B10 上传资产与固定运行/取消已补本机验收，B11 市场发现已接线，Agent/专用包仍 fail-closed |
| 其余 | 待领取 | GPT/GLM/Kimi | todo/partial | todo/partial | todo/partial | todo/partial | todo/partial | 按平台矩阵补齐,不把单端证据扩大解释成全功能完成 |


### B17 增量状态（2026-09-08）

SP-P4-D3/E1 的持久关联/预算回执核心已完成本机验收，详见[测试手册 §5.10](./V25-MIGRATION-TESTING.md)。对应父卡仍部分完成：正式托管连接/执行/下载、共享预算老入口、恢复核对与完整跨端矩阵待接线。管理员阶段继续依赖整包迁移闭合；不使用此切片的通过数代替功能完成比例。

### B18 增量状态（2026-09-08）

主进程固定账号/issuer的受限HTTP、单次首发/原key查询与core无key transport已完成本机验收；启动本地补记不会误接管托管任务。证据见[测试手册 §5.11](./V25-MIGRATION-TESTING.md)。父卡仍部分完成：共享预算全入口、显式连接/准备确认、真实生成/取消/下载、恢复核对和完整P4–6尚待接续；管理员不提前启动。

### B19 增量状态（2026-09-08）

共享预算直接写保护、主进程设置/兼容结算异步协调及恢复中止已验，真实Electron证明预算与系统密文锚同进、新PID同值不重复推进。详见[测试手册 §5.12](./V25-MIGRATION-TESTING.md)。用户启用前旧在途核对、G连接/确认/执行/取消/下载/恢复及完整P4–6仍开放；管理员继续依赖整包闭合。

### B20 增量状态（2026-09-08）

SP-P4启用的数据库前置检查已验：旧托管在途/未知费用、残留关联及落盘期间并发登记均不能被新namespace接管；已结束历史和BYOK兼容。详见[测试手册 §5.13](./V25-MIGRATION-TESTING.md)。宿主内存预留排空、启用/核对UI和G完整产品链未闭合，父卡与管理员前置保持开放。


### B21 增量状态（2026-09-08）

SP-P4首条桌面产品链已接通：legacy准入、显式账号云连接、普通G文字生成1/2/4张、持久停止、同源下载/本地幂等投影及原任务恢复。真实Electron正常关闭后新PID只查询原任务、不再生成已验证；服务器为受控fixture。全仓与完整三形态结果见[测试手册 §5.14](./V25-MIGRATION-TESTING.md)。P4-R1..R4恢复交互/实际API-PG/正式宿主强杀矩阵与重试兼容继续，参考图和R/S按P5；不关闭父卡、整包或管理员前置。

## 2026-09-08 B22 补充检查点

原账号云任务恢复已有稳定分页、云状态/费用/本机素材分离、purge 与缺文件原素材恢复、旧未映射托管只读诊断。check与完整三形态通过，实际Electron新PID两场景各只提交1次；真PG25项为既有回执/core回归。详细报告见[测试手册 §5.15](./V25-MIGRATION-TESTING.md)。本批不改变P4父卡部分完成、正式API/PG产品合流与故障/重试待验、P5/P6、云Agent/包/完整GC/发布开放的状态；管理员仍在迁移全部闭合之后。

## 2026-09-08 B23 补充检查点

B21/B22正式桌面账号云链路已接实际Hono/PG/Graphile/worker联合，12场景+6恢复、API213、三形态248passed/7skipped，真实Electron四图丢回包后新PID各1次API/Provider调用。未发送取消回执补0并兼容旧not_sent null；已发送未知和legacy未知保留。详见[测试手册 §5.16](./V25-MIGRATION-TESTING.md)。P4-R3/R4、P5/P6及云Agent/包/完整GC/迁移/发布仍开放，管理员前置不提前关闭。

## 2026-09-08 B24 补充检查点

首批正式Electron强杀/真实任务安全备份确认有证据，修复未领取取消的本地费用投影；同源码check、联合与完整三形态通过，详见[测试手册 §5.17](./V25-MIGRATION-TESTING.md)。P4-R3确认内部竞争/缺损锚/claim持久化中点仍开放，接[路线图 §6.12](./V25-MIGRATION-ROADMAP.md)，随后R4、P5/P6及其余云Agent/包/GC/迁移/发布。整包和管理员前置未闭合。

## 2026-09-08 B25 补充检查点

P4-R3-C1..C4本机macOS实际宿主矩阵已验收，恢复确认改为持久准备与唯一SQLite授权提交，缺损锚/执行中身份和恢复竞争/文件故障不再误启用。具体结果见[测试手册 §5.18](./V25-MIGRATION-TESTING.md)。下一条按[路线图 §6.13](./V25-MIGRATION-ROADMAP.md)接P4-R4；P5/P6、云Agent/包、完整GC/迁移、Windows与各平台产物/生产发布仍开放。整包与管理员前置不关闭。

## 2026-09-08 B26 补充检查点

显式重试持久意图/本地云端父关联/原payer与已知费用准入已接通；正式API retry、真服务并发/轮换/回包损坏及Electron新PID已有证据。结果、首次失败、同源码与skip边界见[测试手册 §5.19](./V25-MIGRATION-TESTING.md)。R4/P4/U03-spend及整包维持部分完成；R4-C1..C5继续补交互、剩余故障、legacy/BYOK/R/S和最终合流，不重复从B25起点重接HTTP。管理员未启动，整包闭合后再接G-OPS。

## 2026-09-08 B27 补充检查点

R4-C1 工作台/历史列表/详情重试交互已通过本机验收：同步防重、跨入口 pending、错误反馈、账号隔离、统一失败/取消及费用资格；成功/过期移除无效重试。结果和证据边界见[测试手册 §5.20](./V25-MIGRATION-TESTING.md)。旧兑换续发仍单独待 C4 补验；R4-C2 故障、C3/C4 旧入口/BYOK/R/S、C5 合流与后续 P5/P6/云 Agent/包/GC/迁移/发布仍开放。下一 goal 见[路线图 §6.15](./V25-MIGRATION-ROADMAP.md)，管理员仍等待整包闭合。

## 2026-09-08 B28 补充检查点

R4-C2 本机重试故障矩阵17项及完整三形态通过，见[测试手册 §5.21](./V25-MIGRATION-TESTING.md)。本批仅测试，未改生产授权/费用/schema/UI；覆盖精确retry强杀、新PID、换号/实际备份恢复、父清理/再次轮换与取消坏回包。下一条[路线图 §6.16](./V25-MIGRATION-ROADMAP.md)先验C3正式旧入口可达性/异步结算，再C4 BYOK/R/S/兑换续发和C5。仅关闭B28本机切片，B26/R4/P4/整包及平台/账单/发布待验项不因此关闭，管理员未启动。

## 2026-09-08 B29 补充检查点

兑换恢复反馈、并发/换号、原 key 与任务导航切片通过本机验证，桌面官方额度错误映射同时修复且不混同 BYOK 余额。实际组件/IPC/界面、首次失败和最终全仓/三形态结果见[测试手册 §5.22](./V25-MIGRATION-TESTING.md)。当前只关闭 B29，C3 正式旧入口与 C4 BYOK/默认连接/R/S、C5 合流仍待，B26/R4/P4/整包不勾选。下一条目标见[路线图 §6.17](./V25-MIGRATION-ROADMAP.md)，管理员在整个迁移验收后启动。

## 2026-09-08 B30 补充检查点

旧账号本地发送准入及自备默认模型快照缺陷已修，正式 G/R/S、部分云前后 BYOK 兼容与三类旧费用启用阻断已有本机验证。实际首次失败、复跑、完整同源码 check/E2E/扫描见[测试手册 §5.23](./V25-MIGRATION-TESTING.md)。B30/C3/C4 尚有原验收项，B26/R4/P4/整包不勾选；后续拆解、验收与可复制目标见[路线图 §6.18](./V25-MIGRATION-ROADMAP.md)。管理员未启动。

## 2026-09-08 B31 补充检查点

连接管理的保留类型、云 Key、可信激活和删除接管四处真实缺陷已修；云前后自备兼容及实际 CLI/MCP 本地 G/R/S 已验。首次失败、合成边界与完整同源码结果见[测试手册 §5.24](./V25-MIGRATION-TESTING.md)。仅 B31 本机任务关闭，B30/B26/R4/P4 与整包继续开放；下一条目标、任务拆解、阶段流程与验收见[路线图 §6.19](./V25-MIGRATION-ROADMAP.md)。管理员未启动。

## 2026-09-08 B32 补充检查点

历史本地模型缺失的拒绝与用户恢复已验：core/IPC 发送前停止，原记录/费用不变，实际历史反馈→连接设置核对→工作台新意图成功。仅关闭 B32，B30/B26/R4/P4 与整包继续开放；[测试手册 §5.25](./V25-MIGRATION-TESTING.md)保留首次失败及最终结果，[路线图 §6.20](./V25-MIGRATION-ROADMAP.md)提供 C3/C5 接续细拆、验收与 goal。管理员未启动。

## 2026-09-09 B33 补充检查点

真实分发 serve 在途退出与桌面接管已验：取消并等当前生成结束后关库、交出目录；桌面等待已识别原守护的 PID 退出，超时不接管。自备生成、旧账号拒绝与接管后新意图保留。仅关闭 B33 子项，[测试手册 §5.26](./V25-MIGRATION-TESTING.md)登记实际门禁/失败/替身边界，[路线图 §6.21](./V25-MIGRATION-ROADMAP.md)提供原 C3/C5、R4 映射和后续 goal。B30/B26/R4/P4、云/数据/发布与整包仍开放；管理员未启动。

<!-- B62:CORPUS START -->
2026-09-13（运行UTC 2026-09-12）：B62已修复桌面导入旧版方案包后来源/图片在共享详情中丢失：两宿主共用既有旧格式内容映射，桌面重绑来源与资产ID、保存完整正文/图片、隔离旧scan，导入仍为无试跑资格的新草稿。 12份永久语料的file/bytes reader一致；真实PC Web、Mobile Web、Electron共36个导入场景通过（6次合法新草稿、30次坏包拒绝），并验证刷新/新PID重启后的内容、原数据不变与图片hash。当前check36/36通过；API导入/导出/身份专项80P在此前6cc49667…执行，其API及共享生产源码与当前逐文件一致，之后仅测试比较helper变化。当前1579项源码5171ca41…的源码与三轮留存6份合法ZIP扫描零命中/错误；30份故意无效语料另记拒绝，不计为安全交付ZIP。 最终受影响回归163P/2S/0F/0flaky（1180.304秒）：完整Electron153P/2S，PC/移动Web各5P；两项skip分别缺真实登录凭据和生图key，保留为发布条件。四次实际宿主运行累计保存72个文件副本，其中30份有效ZIP扫描零命中/错误、42份故意无效输入另记拒绝；包含复制的picker输入，不把副本数写成独立测试数。最终回归自身新增22份有效ZIP和11份坏包输入。 B62/F5-X.C四项原定验收已通过，仅关闭本卡。继续F5-X.L容量及资源/失败清理，再接T自然期限、H系统文件交付与原E、平台包、生产回滚和远程MCP；完整迁移及管理员前置保持开放。
<!-- B62:CORPUS END -->
