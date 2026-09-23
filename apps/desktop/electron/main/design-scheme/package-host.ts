import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
  type WebContents,
} from 'electron';
import {
  prepareDesignSchemeImportPackageInputSchema,
  prepareDesignSchemeImportPackageResultSchema,
  type ImportDesignSchemeInput,
  type PrepareDesignSchemeImportPackageResult,
} from '@musefold/contracts';
import { join } from 'node:path';
import { getManagedFilesystem } from '../managed-filesystem';
import type { BridgeEnvelope } from '../ipc-v25/envelope';
import { DesignSchemePackageStaging } from './package-staging';
import { isApplicationAdmissionOpen, trackApplicationRequest } from '../lifecycle-admission';
import { resolveE2eOpenPackageDialog } from './e2e-dialogs';

export const DESIGN_SCHEME_PREPARE_IMPORT_CHANNEL = 'designSchemes:prepareImportPackage' as const;

let staging: DesignSchemePackageStaging | null = null;
const watchedSenders = new Set<number>();
let cleanupTimer: ReturnType<typeof setTimeout> | undefined;

function getStaging(): DesignSchemePackageStaging {
  staging ??= new DesignSchemePackageStaging({
    rootDir: join(app.getPath('userData'), 'staging', 'design-scheme-packages'),
    filesystem: getManagedFilesystem(),
    trustedParentDir: app.getPath('userData'),
    onCleanupFailure: (error) => console.warn('[package-staging] managed cleanup deferred', error),
  });
  return staging;
}

/** Application calls this after acquiring exclusive userData ownership, before windows. */
export function startDesignSchemePackageStagingMaintenance(): void {
  if (cleanupTimer) return;
  const collect = () => {
    const result = getStaging().collectOrphans();
    if (result.scanned || result.failed || result.pending) {
      console.info('[package-staging-gc]', JSON.stringify(result));
    }
    cleanupTimer = setTimeout(collect, result.scanned === 20 ? 1_000 : 60_000);
    cleanupTimer.unref();
  };
  collect();
}

function watchSender(sender: WebContents): void {
  const ownerId = sender.id;
  if (watchedSenders.has(ownerId)) return;
  watchedSenders.add(ownerId);
  sender.once('destroyed', () => {
    staging?.cleanupOwner(ownerId);
    watchedSenders.delete(ownerId);
  });
}

async function showOpenPackageDialog(event: IpcMainInvokeEvent) {
  const e2e = resolveE2eOpenPackageDialog();
  if (e2e) return e2e;
  const options: OpenDialogOptions = {
    title: '导入设计方案',
    properties: ['openFile'],
    filters: [{ name: 'Musefold 设计方案', extensions: ['musefold.design', 'design'] }],
  };
  const parent = BrowserWindow.fromWebContents(event.sender);
  return parent && !parent.isDestroyed()
    ? dialog.showOpenDialog(parent, options)
    : dialog.showOpenDialog(options);
}

async function prepareImport(
  event: IpcMainInvokeEvent,
  payload: unknown,
): Promise<BridgeEnvelope<PrepareDesignSchemeImportPackageResult>> {
  if (!isApplicationAdmissionOpen()) {
    return { ok: false, code: 'APP_SHUTTING_DOWN', message: 'Musefold 正在退出，请稍后重试' };
  }
  return trackApplicationRequest(async () => {
    const parsed = prepareDesignSchemeImportPackageInputSchema.safeParse(payload);
    if (!parsed.success) {
      return { ok: false, code: 'VALIDATION_FAILED', message: '导入分享包选项无效' };
    }
    watchSender(event.sender);
    getStaging().cleanupOwner(event.sender.id);
    try {
      const picked = await showOpenPackageDialog(event);
      if (event.sender.isDestroyed() || picked.canceled || !picked.filePaths[0]) {
        staging?.cleanupOwner(event.sender.id);
        return {
          ok: true,
          data: prepareDesignSchemeImportPackageResultSchema.parse({ status: 'cancelled' }),
        };
      }
      const result = await getStaging().stagePickedPackage(
        event.sender.id,
        picked.filePaths[0],
        parsed.data,
      );
      if (event.sender.isDestroyed()) {
        staging?.cleanupOwner(event.sender.id);
        return {
          ok: true,
          data: prepareDesignSchemeImportPackageResultSchema.parse({ status: 'cancelled' }),
        };
      }
      return { ok: true, data: prepareDesignSchemeImportPackageResultSchema.parse(result) };
    } catch {
      staging?.cleanupOwner(event.sender.id);
      return {
        ok: false,
        code: 'DESIGN_SCHEME_PACKAGE_INVALID',
        message: '所选文件不是可安全导入的 Musefold 设计方案包',
      };
    }
  });
}

export function registerDesignSchemePackageHostActions(): void {
  ipcMain.handle(DESIGN_SCHEME_PREPARE_IMPORT_CHANNEL, prepareImport);
}

export async function consumeStagedDesignSchemePackage<T>(
  ownerId: number,
  input: ImportDesignSchemeInput,
  consume: (packagePath: string, bytes: Buffer) => Promise<T>,
): Promise<T> {
  return getStaging().consume(ownerId, input, consume);
}

export function cleanupDesignSchemePackageStaging(): void {
  clearTimeout(cleanupTimer);
  cleanupTimer = undefined;
  staging?.cleanupAll();
  staging = null;
  watchedSenders.clear();
}

export function setDesignSchemePackageStagingForTests(
  replacement: DesignSchemePackageStaging | null,
): void {
  staging = replacement;
  watchedSenders.clear();
}
