/**
 * 平台能力端口（toast / 下载 / 剪贴板 / 外链）。
 * 与六数据端口分离：不挂在 WebGateway / DesktopGateway 上，由宿主注入 page controller。
 * 方法面只覆盖编排层真正需要的反馈与系统动作，不发明业务 API。
 */
export interface PlatformToast {
  success(title: string, description?: string): void;
  error(title: string, description?: string): void;
  info(title: string, description?: string): void;
}

export interface PlatformServices {
  toast: PlatformToast;
  writeClipboard(text: string): Promise<void>;
  download(url: string, filename?: string): Promise<void>;
  openExternal(url: string): Promise<void>;
}
