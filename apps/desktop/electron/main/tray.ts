import { app, Menu, nativeImage, Tray } from 'electron';
import { APP_NAME } from '@musefold/domain/constants';
import { resolveResourcePath } from './app-paths';

let appTray: Tray | null = null;

export function createAppTray(onOpenMainWindow: () => void): Tray {
  if (appTray && !appTray.isDestroyed()) return appTray;

  const iconPath = resolveResourcePath(['icon.png']);
  const iconSize = process.platform === 'darwin' ? 18 : 20;
  const icon = nativeImage.createFromPath(iconPath).resize({
    width: iconSize,
    height: iconSize,
    quality: 'best',
  });

  appTray = new Tray(icon);
  appTray.setToolTip(APP_NAME);
  appTray.setContextMenu(Menu.buildFromTemplate([
    {
      label: `打开 ${APP_NAME}`,
      click: onOpenMainWindow,
    },
    { type: 'separator' },
    {
      label: `退出 ${APP_NAME}`,
      click: () => app.quit(),
    },
  ]));
  appTray.on('click', onOpenMainWindow);

  return appTray;
}

export function destroyAppTray(): void {
  if (!appTray || appTray.isDestroyed()) return;
  appTray.destroy();
  appTray = null;
}
