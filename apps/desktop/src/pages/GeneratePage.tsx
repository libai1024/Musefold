// Generate 页面只负责挂载统一制作工作台。
// 探索、制作、当前会话时间线和底部 Composer 的事实状态都在 Workbench store 中。
// ORCH-03：顶层挂载共享 generate controller，会话镜像消费留给 SPLIT-03。
import { useGeneratePageController } from '@musefold/product-ui';
import { GenerationWorkbench } from '../features/generation/workbench/GenerationWorkbench';
import { desktopGateway } from '../runtime';
import { desktopPlatformServices } from '../runtime/platform-services';

export function GeneratePage() {
  useGeneratePageController({
    workbench: desktopGateway,
    platform: desktopPlatformServices,
    listEnabled: false,
  });
  return <GenerationWorkbench />;
}
