import type { PlatformServices } from '@musefold/domain';
import { toast } from '../stores/toast';
import { desktopHost as api } from '@renderer/runtime/desktop-host-services';

function triggerBrowserDownload(url: string, filename?: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.rel = 'noopener';
  if (filename) link.download = filename;
  link.click();
}

export function createDesktopPlatformServices(): PlatformServices {
  return {
    toast: {
      success: (title, description) => {
        toast.success(title, description);
      },
      error: (title, description) => {
        toast.error(title, description);
      },
      info: (title, description) => {
        toast.info(title, description);
      },
    },
    writeClipboard: async (text) => {
      await navigator.clipboard.writeText(text);
    },
    download: async (url, filename) => {
      if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('blob:')) {
        triggerBrowserDownload(url, filename);
        return;
      }
      await api.system.saveImage(url);
    },
    openExternal: async (url) => {
      const opened = window.open(url, '_blank', 'noopener');
      if (!opened) throw new Error('无法打开外部链接');
    },
  };
}

export const desktopPlatformServices = createDesktopPlatformServices();
