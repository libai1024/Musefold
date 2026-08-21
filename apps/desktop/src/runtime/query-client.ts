import { createMusefoldQueryClient } from '@musefold/product-ui';

/**
 * 桌面渲染层 QueryClient 单例（V13-STATE-02）。
 * main.tsx 经 Provider 注入同一实例；非 React 调用方（store 写操作、workbench）
 * 通过它 invalidate / setQueryData，避免再镜像一份服务端列表。
 */
export const desktopQueryClient = createMusefoldQueryClient();
