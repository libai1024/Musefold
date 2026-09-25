# Windows 安装版缺少 better-sqlite3：事故分析（2026-09-26）

## 结论与影响

2026-09-25 22:32（上海时间）发布的 Windows 2.5.2 安装包，在其他电脑安装后会因主进程找不到 `better-sqlite3` 而无法正常启动。已发布安装器的 `resources/app.asar` 有 5,919 个条目，其中 `better-sqlite3`、`electron-store`、`electron-updater` 均为零；这不是用户电脑缺少运行库，也不是 SQLite 数据损坏。`resources/integration/node_modules/better-sqlite3` 虽然包含 Windows x64 原生文件，但仅供随包 CLI/MCP 使用，主进程的 ESM 导入不会从该目录解析。

影响范围是通过官网下载 2.5.2 Windows 安装包的用户。现有证据不能确定受影响人数，也没有发现数据库文件损坏或服务端数据异常。macOS 下载和 Web 服务不受这次 Windows 包漏收影响。

## 时间线

| 时间（上海） | 事件 |
| --- | --- |
| 2026-09-25 22:32 | Windows 2.5.2 被放到官网 `latest` 下载入口。 |
| 2026-09-25 深夜 | 用户反馈异机安装后提示找不到 `better-sqlite3`。 |
| 2026-09-25 23:54 | Windows 实机完成首个 2.5.3 NSIS 安装器；脱离仓库的打包 App 冒烟 4 通过、3 项按平台跳过。 |
| 2026-09-26 00:14 | 官网 Windows `latest` 切到 2.5.3；保留 macOS 入口及两端 stable 更新 feed。 |

## 直接原因与为何漏检

1. electron-builder 26 对当前 pnpm 工作区的依赖自动收集没有把 `better-sqlite3` 放进主应用 `app.asar/node_modules`。2.5.2 构建日志出现依赖路径查找警告，但打包命令仍以成功结束。`asarUnpack` 只能解包已经收集的文件，不能补齐遗漏依赖。
2. 主进程以 ESM 静态导入 `better-sqlite3`；此前增加的运行时 resolver 是副作用导入，执行前静态导入已经开始解析，因此无法救回缺包。
3. 旧打包冒烟在仓库目录下启动 `release/win-unpacked/Musefold.exe`。Node/Electron 可沿父目录找到仓库根部的 `node_modules`，于是四项测试通过；它没有模拟其他电脑的安装目录。此前报告中“包内 SQLite 通过”的结论被这个环境污染所误导。

旧版 Windows 构建曾在 `app.asar` 内包含 `better-sqlite3`。这次能确认的是 2.5.2 安装包内容和依赖收集警告；引入漏收的最早提交尚未由逐提交复现确定，不能直接归咎于某一次 pnpm 升级。

## 修复与验证

- 2.5.3 显式把 `better-sqlite3` 的 `package.json`、`lib` 与 `prebuilds` 放入主应用的 `node_modules`，并解包原生 `.node` 文件；保留 CLI/MCP 的独立资源目录。
- `afterPack` 现在检查目标平台原生文件及主进程模块入口是否实际在 `app.asar` 和 `app.asar.unpacked`；缺失即阻断打包。
- 打包冒烟先将整套 App 复制到仓库之外，再验证 `better-sqlite3` 从随包路径解析，执行 `SELECT 1`，并覆盖受管迁移与重启持久化。首个 2.5.3 Windows 包在该隔离环境中 4 项通过、3 项按原有平台规则跳过。macOS 打包冒烟 7/7 通过；源码完整检查此前在修复工作树中 38/38 通过，Electron 项目 137 通过、83 条件跳过。
- 实际 2.5.2 NSIS 内层解出的 `app.asar` 与构建目录逐字节一致，确认发布物本身漏包，而非下载损坏。

## 上线与已知限制

官网手动下载：[Musefold 2.5.3 Windows x64 安装包](https://zhaozhaoyue.top/Musefold/downloads/2.5.3/Musefold-2.5.3-x64-Setup.exe)。已发布文件大小 182,511,889 字节，SHA-256 `0c9aea6506e80e0a4801a19877d9d33e26f2c50f742684d894aab9f77c1c6d09`。公网 Windows `latest` 已返回指向此文件的 302，安装器直链 HEAD 返回 200；完整公网下载的 SHA-256 与服务器文件一致。发布前备份位于服务器 `/opt/musefold/backups/windows-release-20260925T161418Z/`。

本次 Windows 安装器仍未签名，项目当前自动更新要求发布者签名，因此没有修改 stable 更新 feed；已安装用户需要手动下载安装。正式安装器 UI、真实账号生图，以及用户在其他 Windows 电脑上的结果，仍待实测。

发布后继续扫描发现：2.5.3 已上线文件还包含 `better-sqlite3/build` 的 Visual Studio 工程中间文件，其中有构建机用户路径。它不影响这次缺包修复，但不应进入安装器。源码已加入排除规则、`afterPack` 拒绝规则和回归测试；这项清理尚未包含在官网当前 2.5.3 文件内。后续应以新版本发布通过完整扫描的干净包，避免原地址文件内容和哈希发生静默变化。

## 防复发

1. 发布门禁直接检查 NSIS 内层 App 与 `win-unpacked` 的关键文件摘要一致，并在仓库之外启动安装器提取的 App。
2. 将 `better-sqlite3` 主进程入口、目标平台 `.node` 和不含 `build` 中间文件设为打包硬约束。
3. 依赖收集警告需要人工解释；构建成功不再等同于原生依赖已经随包。
4. Windows 安装器的实际签名与自动更新验签应在证书到位后单独验收。
