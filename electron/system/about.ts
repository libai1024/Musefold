import { app, shell } from 'electron';
import { join } from 'path';
import type { AboutResourceId } from '@shared/types/ipc';
import { resolveAppRoot } from '../main/app-paths';

const RESOURCE_FILES: Record<AboutResourceId, string> = {
  'product-docs': 'README.md',
};

export function resolveAboutResourcePath(
  resource: AboutResourceId,
  environment: { packaged: boolean; appPath: string; resourcesPath: string } = {
    packaged: app.isPackaged,
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
  },
): string {
  const file = RESOURCE_FILES[resource];
  if (!file) throw new Error('ABOUT_RESOURCE_FORBIDDEN: 不允许打开该资源');
  return environment.packaged
    ? join(environment.resourcesPath, 'product-docs', file)
    : join(
        resolveAppRoot({
          packaged: false,
          appPath: environment.appPath,
          cwd: process.cwd(),
        }),
        'docs',
        'product',
        file,
      );
}

export async function openAboutResource(resource: AboutResourceId): Promise<void> {
  const path = resolveAboutResourcePath(resource);
  const error = await shell.openPath(path);
  if (error) throw new Error(`ABOUT_RESOURCE_OPEN_FAILED: ${error}`);
}

