// Generate 页面只负责挂载统一制作工作台。
// 探索、制作、当前会话时间线和底部 Composer 的事实状态都在 Workbench store 中。
import { GenerationWorkbench } from '../features/generation/workbench/GenerationWorkbench';

export function GeneratePage() {
  return <GenerationWorkbench />;
}
