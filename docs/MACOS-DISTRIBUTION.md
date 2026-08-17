# macOS 分发与安装说明

## 支持范围

- 当前 macOS 产物是 Apple Silicon ARM64 包，适用于 M1/M2/M3/M4 Mac。
- Intel Mac 需要单独构建 x64 或 universal 包，当前 ARM64 DMG 不能原生安装到 Intel Mac。

## 两类构建

### 正式客户包

正式分发必须满足：

1. Apple Developer Program 中的 `Developer ID Application` 证书。
2. Hardened Runtime 签名。
3. 提交 Apple Notary Service 并通过。
4. 将公证票据 staple 到 DMG。
5. `codesign --verify --deep --strict`、`spctl --assess` 和 `xcrun stapler validate` 全部通过。

正式构建入口仍为：

```bash
npm run package:mac
```

本机当前没有 Developer ID identity 和公证凭据，因此不能生成无警告双击安装的正式客户包。

### 无证书内测包

内测构建入口：

```bash
npm run package:mac:adhoc
```

该命令会：

- 从当前源码构建 ARM64 App。
- 对 Electron Framework、四个 Helper 和主 App 做 ad-hoc 签名。
- 为主 App 和 Helper 写入内测所需的 JIT/library-validation entitlements。
- 执行严格深度签名校验。
- 生成 DMG 和 ZIP。

ad-hoc 包不会再因签名结构损坏而启动即崩溃，但没有 Apple 信任链，Gatekeeper 仍会要求用户手动批准。

## 内测安装步骤

1. 打开 DMG，将 PromptForge 拖到 Applications。
2. 在 Applications 中右键 PromptForge，选择“打开”。
3. 如果仍被阻止，进入“系统设置 → 隐私与安全性”，在安全提示旁选择“仍要打开”。
4. 只有在确认安装包来源和 SHA-256 后，才使用终端移除该 App 的隔离标记：

```bash
xattr -dr com.apple.quarantine /Applications/PromptForge.app
open /Applications/PromptForge.app
```

不要要求客户关闭 Gatekeeper，也不要使用 `spctl --master-disable`。

## 当前验收

- `codesign --verify --deep --strict`：通过。
- `hdiutil verify`：通过。
- `tests/package/macos_package_smoke.py`：`1 passed`，App `0.1.0` / DB v10。
- `spctl --assess`：拒绝，符合无 Developer ID 的预期；只有正式签名并公证后才能通过。

