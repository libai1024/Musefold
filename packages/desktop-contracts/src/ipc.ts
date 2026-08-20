// packages/desktop-contracts/src/ipc.ts
// IPC 通道契约 —— 历史入口（barrel）。V13-GOV-04 起实现拆分在 ./ipc/ 目录：
// channels.ts（通道名常量）、<domain>.ts（请求/响应类型 + Api namespace）、
// api.ts（Api 聚合）、index.ts（组合出口 + window.api 全局类型）。
// 本文件保留是因为包 exports 的 `./*` 通配与大量 `@musefold/desktop-contracts/ipc`
// 子路径消费方（渲染层、preload、主进程、core、automation-server）依赖该路径。
// 详见 docs/07-ipc-contracts.md

export * from "./ipc/index";
