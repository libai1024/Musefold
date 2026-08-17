# Musefold 在线更新（V05）

## 当前实现

- 更新库：`electron-updater`，由主进程统一控制。
- 稳定更新源：`https://zhaozhaoyue.top/Musefold/updates/stable/`。
- 更新源只使用域名，不回退到中转站 IP；更新包必须由发布服务器提供 HTTPS 和正确的 `latest.yml` / `latest-mac.yml` 元数据。
- Windows 使用 NSIS 安装包和 `.blockmap`；macOS 使用 `.zip` 做静默更新，同时保留 `.dmg` 给首次安装。
- 开发环境和 Linux 构建不会连接更新服务器。下载完成后不会自动重启，用户在“设置 → 关于”中点击“重启更新”才安装。

## 正式发布前置条件

1. 每次发布先升级 `package.json` 版本号，再执行对应的 `npm run package:mac` 或 `npm run package:win`。
2. macOS 包必须使用 Developer ID 签名并完成公证；Windows 包必须使用正式代码签名证书。未签名包不能作为在线更新包发布。
3. 将生成的安装包、`.blockmap`（Windows）和 `latest*.yml` 上传到对应的 `updates/stable/` 目录，并保持文件名与 yml 中的 URL、SHA-512 一致。
4. 上传后先用浏览器或 `curl -I` 验证 HTTPS、`Content-Type`、`Content-Length` 和下载响应，再用已安装的旧版本执行“检查更新 → 下载 → 重启更新”。

## 运行时安全边界

更新状态通过窄 IPC 传给渲染进程，只暴露当前版本、目标版本、下载进度和脱敏错误文本；不会把 `electron-updater` 对象、签名信息或本地路径暴露给页面。自动检查只负责发现更新，不会在后台强制退出应用。
