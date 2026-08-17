# 07 · IPC 与 Renderer

## Preload API

`electron/preload/index.ts` 按 `shared/types/ipc.ts` 暴露白名单 API：

| 命名空间 | 用途 |
| --- | --- |
| `prompt/folder/tag/smartSet/searchHistory` | 提示词库 |
| `image/history/workbenchSession` | 生图、历史和会话 |
| `skillRuntime` | GitHub Skill 准备、执行、取消和事件 |
| `designScheme` | 设计方案完整生命周期 |
| `provider/aiConnection/account` | 图像 Provider、Agent 模型和账号 |
| `automation/settings/system/updater/log/window/pet/share` | 平台与运维能力 |

Renderer 不得得到通用 `invoke(channel)` 或 Electron 原始对象。

## 工作台状态

`src/features/generation/store.ts` 管理草稿、参数、参考图、会话、turn/result、生成状态和微调上下文。

一次普通提交：

1. 校验 Provider、prompt、比例、数量和参考图。
2. 建立或复用 `workbench_session`。
3. 为每张图建立 `generation_run`。
4. 通过 `image.generate` 调用 Core。
5. 同步 history、run、asset 和 UI result。

Skill 和设计方案使用独立 source/state 提供编译后 prompt，但生图仍进入相同链路。

## 导航与页面

`src/stores/app.ts` 只允许 `generate | library | design-schemes | history | settings`。任何深链、命令面板或测试钩子都必须使用这一组 ViewKey。

## 错误处理

- IPC 返回可预期业务错误或 `AppResult`，不把密钥、完整服务器响应和本机敏感路径抛给 Renderer。
- 用户可恢复错误用行内提示/toast 呈现；未捕获异常进入 diagnostics。
- 取消是明确终态，不得伪装成普通失败或自动重试。
