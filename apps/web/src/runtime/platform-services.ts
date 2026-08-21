import type { PlatformServices } from '@musefold/domain';

function liveRegion(): HTMLElement {
  const existing = document.getElementById('musefold-platform-live');
  if (existing) return existing;
  const region = document.createElement('div');
  region.id = 'musefold-platform-live';
  region.dataset.testid = 'platform-live-region';
  region.setAttribute('role', 'status');
  region.setAttribute('aria-live', 'polite');
  region.style.position = 'absolute';
  region.style.width = '1px';
  region.style.height = '1px';
  region.style.overflow = 'hidden';
  region.style.clipPath = 'inset(50%)';
  document.body.append(region);
  return region;
}

function announce(title: string, description?: string): void {
  liveRegion().textContent = description ? `${title}。${description}` : title;
}

function triggerBrowserDownload(url: string, filename?: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.rel = 'noopener';
  if (filename) link.download = filename;
  link.click();
}

export function createWebPlatformServices(): PlatformServices {
  return {
    toast: {
      success: announce,
      error: announce,
      info: announce,
    },
    writeClipboard: async (text) => {
      await navigator.clipboard.writeText(text);
    },
    download: async (url, filename) => {
      triggerBrowserDownload(url, filename);
    },
    openExternal: async (url) => {
      const opened = window.open(url, '_blank', 'noopener');
      if (!opened) throw new Error('无法打开外部链接');
    },
  };
}

export const webPlatformServices = createWebPlatformServices();
