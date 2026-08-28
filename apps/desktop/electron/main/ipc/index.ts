// electron/main/ipc/index.ts
// v2.5 起数据域全部走单通道桥(ipc-v25/gateway-bridge),这里只装配两块遗留多通道面:
// - updater:热更控制通道 + pet 窗口的 content-ready 信标(v25 设置「关于」卡后续接入)
// - pet:桌宠窗口专用域(冻结,不迁移;见 docs/v2.5/V25-UI-SPEC.md §0.2)
// doubao 登录态同步不是 IPC,但与生图链路同属主进程装配,一并在此拉起。

import { registerPetHandlers } from '../pet';
import { startDoubaoLoginSync } from '../doubao-login-sync';
import { registerUpdaterHandlers } from './updater';

export function registerAllHandlers(): void {
  registerUpdaterHandlers();
  registerPetHandlers();
  startDoubaoLoginSync();
}
