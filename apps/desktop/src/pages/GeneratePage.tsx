// Generate 页面只负责挂载统一制作工作台。
// SPLIT-03：会话列表 Query 由侧栏/标题栏消费桌面 key `{ limit: 200 }`。
// GeneratePage 仍 `listEnabled: false`，避免把桌面 summary 列表塞进
// 共享 controller 的 contracts session 形状（Web 仍用 `{ limit: 20 }`）。
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
