// 全局 gateway 单例，供渲染层 store 导入
import { desktopGateway } from './desktop-gateway';

export const gateway = {
  desktop: desktopGateway,
};
