# 02 · 系统架构

## 进程与边界

```text
React Renderer
  ↓ typed window.api
Electron Preload
  ↓ allowlisted IPC
Electron Main
  ├─ account / keychain / OS integration
  ├─ Skill Runtime / Design Scheme orchestration
  ├─ Automation host
  └─ Musefold Core
       ├─ library / history / providers / generation / workbench
       ├─ main SQLite
       └─ design-scheme SQLite
```

Renderer 不能直接访问文件系统、SQLite、密钥或网络 Provider。Preload 只暴露 `shared/types/ipc.ts` 声明的窄 API。

## 启动顺序

1. Electron 建立路径、单实例锁和日志。
2. 配置 Core runtime：路径、密钥读取、估价和桌面 Provider 端口。
3. 打开主库并迁移到 v15。
4. 从旧专用库迁入通用工作台数据，然后删除旧库。
5. 打开设计方案库，恢复中断任务。
6. 注册 IPC、media protocol、Automation、窗口、tray 和更新器。

## 生图单通道

UI、CLI、MCP、Skill Runtime 和设计方案最终都调用 Core generation。该服务负责：

- Provider 选择与密钥加载。
- 参考图路径校验与发送。
- 生成历史、工作台 run 和 asset 账本。
- 进度、取消、错误归一化与成本事实。

不得在 Renderer、CLI 或设计方案内实现第二套 Provider 生图链路。

## 扩展原则

- 新平台能力通过 Core port 或 Electron host adapter 注入。
- 跨进程数据先定义共享契约，再实现 IPC/API。
- 结构化视觉方法统一落在 `design-scheme`，不再新建并行模型。
