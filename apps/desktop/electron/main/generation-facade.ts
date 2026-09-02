// Electron 侧生图统一门面(原 ipc/images.ts,M5c 提取):core generate + 桌宠追踪。
// core 的 generate 有多条入口(v25 工作台桥、Skill 运行时、设计方案批跑),
// 桌宠追踪加在门面而非各调用点,避免逐个包装必然出现的遗漏。
// 追踪不进 core —— 桌宠是 Electron 表现层设施,core 不该知道它存在。
// 旧版此处还有账号余额节流刷新;v2.5 账号域无本地余额缓存,该逻辑随旧账号服务退役。

import { generate as coreGenerate } from '@musefold/core/services/generation';
import { trackPetGeneration } from './pet';

export { hasActiveImageJobs, cancelGeneration } from '@musefold/core/services/generation';

export function generate(
  ...args: Parameters<typeof coreGenerate>
): ReturnType<typeof coreGenerate> {
  return trackPetGeneration(() => coreGenerate(...args));
}
