// electron/main/ipc/system.ts
import {
  ipcMain,
  app,
  shell,
  dialog,
  BrowserWindow,
  clipboard,
  nativeImage,
} from "electron";
import { mkdir, stat } from "fs/promises";
import { join } from "path";
import { IPC } from "@shared/types/ipc";
import type { ExportRequest, ImportRequest } from "@shared/types/ipc";
import type { AboutResourceId } from "@shared/types/ipc";
import { getPaths } from "../../system/paths";
import { getDb } from "@musefold/core/db/index";
import { tailLog, logDir } from "../../system/logger";
import { runExport, defaultExportName } from "../../system/export";
import { runImport } from "../../system/import";
import { collectImageDiskUsage } from "../../system/disk-usage";
import { createBackup, listBackups, restoreBackup } from "../../system/backup";
import { resetBusinessData } from "../../system/reset";
import { hasActiveImageJobs } from "./images";
import { openAboutResource } from "../../system/about";
import { APP_VERSION } from "../../system/app-version";
import {
  inspectImageFile,
  saveImageFile,
  saveImageFiles,
} from "../../system/image-actions";
import { captureImportedCloudEntities } from "../../cloud-sync";

export function registerSystemHandlers(): void {
  ipcMain.handle(IPC.SYSTEM_GET_PATHS, () => {
    const p = getPaths();
    return {
      userData: p.userData,
      pictures: p.pictures,
      backups: p.backups,
      logs: p.logs,
    };
  });

  ipcMain.handle(IPC.SYSTEM_GET_VERSION, () => {
    const db = getDb();
    const dbVersion = db.pragma("user_version", { simple: true }) as number;
    return { app: APP_VERSION, db: dbVersion };
  });

  ipcMain.handle(
    IPC.SYSTEM_OPEN_ABOUT_RESOURCE,
    async (_e, resource: AboutResourceId) => {
      await openAboutResource(resource);
      return { ok: true as const };
    },
  );

  // 目录 → 直接打开；文件 → 打开所在目录并选中该文件。
  // 两个调用方语义不同（设置页传目录，结果卡「打开目录」传图片路径），
  // 用 stat 分流而不是加第二个 IPC 通道。
  ipcMain.handle(IPC.SYSTEM_OPEN_IN_FOLDER, async (_e, target: string) => {
    const info = await stat(target).catch(() => null);
    if (!info) {
      throw new Error("路径不存在或已被移动");
    }
    if (info?.isFile()) {
      shell.showItemInFolder(target);
      return { ok: true as const };
    }
    const error = await shell.openPath(target);
    if (error) throw new Error(error);
    return { ok: true as const };
  });

  ipcMain.handle(
    IPC.SYSTEM_SAVE_IMAGE,
    async (e, sourcePath: string, explicitTarget?: string) => {
      const source = await inspectImageFile(sourcePath);
      let targetPath = explicitTarget?.trim();

      if (!targetPath) {
        const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
        const result = await dialog.showSaveDialog(win as BrowserWindow, {
          title: "另存图片",
          defaultPath: join(app.getPath("downloads"), source.name),
          filters: [{ name: "图片", extensions: [source.extension.slice(1)] }],
        });
        if (result.canceled || !result.filePath)
          return { cancelled: true as const };
        targetPath = result.filePath;
      }

      return { path: await saveImageFile(source.path, targetPath) };
    },
  );

  ipcMain.handle(
    IPC.SYSTEM_SAVE_IMAGES,
    async (e, sourcePaths: string[], explicitDirectory?: string) => {
      let targetDirectory = explicitDirectory?.trim();
      if (!targetDirectory) {
        const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
        const result = await dialog.showOpenDialog(win as BrowserWindow, {
          title: "保存所选图片",
          defaultPath: app.getPath("downloads"),
          properties: ["openDirectory", "createDirectory"],
        });
        if (result.canceled || result.filePaths.length === 0)
          return { cancelled: true as const };
        targetDirectory = result.filePaths[0];
      }
      return { paths: await saveImageFiles(sourcePaths, targetDirectory) };
    },
  );

  ipcMain.handle(IPC.SYSTEM_COPY_IMAGE, async (_e, sourcePath: string) => {
    const source = await inspectImageFile(sourcePath);
    const image = nativeImage.createFromPath(source.path);
    if (image.isEmpty()) throw new Error("图片无法读取或文件已损坏");
    clipboard.writeImage(image);
    return { ok: true as const };
  });

  // 不授予 renderer 通用 clipboard-read 权限；只在用户点击明确的导入动作后
  // 通过这一条窄 IPC 读取纯文本，避免任意页面脚本静默读取剪贴板。
  ipcMain.handle(IPC.SYSTEM_READ_CLIPBOARD_TEXT, () => clipboard.readText());

  // 拾遗（朱点 Alt+双击）在无文字时取剪贴板图片：同样走窄 IPC，
  // 返回 PNG 字节交给渲染进程走既有的本地图片暂存校验。
  ipcMain.handle(IPC.SYSTEM_READ_CLIPBOARD_IMAGE, () => {
    const image = clipboard.readImage();
    if (image.isEmpty()) return null;
    return image.toPNG();
  });

  ipcMain.handle(IPC.SYSTEM_DISK_USAGE, async () => {
    const p = getPaths();
    return collectImageDiskUsage(p.pictures);
  });

  ipcMain.handle(IPC.SYSTEM_EXPORT, async (e, req: ExportRequest = {}) => {
    const mode = req.mode ?? "db-only";

    // 预览只算数不落盘，绝不能弹保存对话框 —— 否则对话框刚打开就被系统
    // 面板糊一层，用户还没决定导什么就先被问存哪儿。
    if (req.dryRun) return runExport(req, "");

    let targetPath = req.targetPath;

    if (!targetPath) {
      // 对话框必须挂在发起窗口上（macOS 才会是 sheet 而不是游离窗口）
      const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
      const zip = mode === "db-with-images";
      const res = await dialog.showSaveDialog(win as BrowserWindow, {
        title: "导出 Musefold 数据",
        defaultPath: join(app.getPath("downloads"), defaultExportName(mode)),
        filters: zip
          ? [{ name: "压缩包", extensions: ["zip"] }]
          : [{ name: "JSON", extensions: ["json"] }],
      });
      if (res.canceled || !res.filePath) return { cancelled: true as const };
      targetPath = res.filePath;
    }

    return runExport(req, targetPath);
  });

  ipcMain.handle(IPC.SYSTEM_IMPORT, async (e, req: ImportRequest = {}) => {
    let sourcePath = req.sourcePath;

    if (!sourcePath) {
      const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
      const res = await dialog.showOpenDialog(win as BrowserWindow, {
        title: "导入 Musefold 数据",
        properties: ["openFile"],
        filters: [{ name: "Musefold 导出文件", extensions: ["json", "zip"] }],
      });
      if (res.canceled || res.filePaths.length === 0)
        return { cancelled: true as const };
      sourcePath = res.filePaths[0];
    }

    const result = await runImport(req, sourcePath);
    if (!req.dryRun) captureImportedCloudEntities();
    return result;
  });

  ipcMain.handle(IPC.SYSTEM_LIST_BACKUPS, () => listBackups());

  ipcMain.handle(IPC.SYSTEM_BACKUP_NOW, async () => ({
    path: await createBackup("manual"),
  }));

  ipcMain.handle(
    IPC.SYSTEM_RESTORE_BACKUP,
    async (_e, req: { file?: string } = {}) => {
      const result = await restoreBackup(req.file ?? "");
      return { ok: true as const, needsRestart: true as const, ...result };
    },
  );

  ipcMain.handle(IPC.SYSTEM_RELAUNCH, () => {
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 120);
    return { ok: true as const };
  });

  ipcMain.handle(
    IPC.SYSTEM_RESET_DATA,
    async (_e, req: { confirm?: string } = {}) => {
      if (hasActiveImageJobs()) {
        throw new Error(
          "RESET_BUSY: 仍有图片生成任务，请等待完成或取消后再清空数据",
        );
      }
      const result = await resetBusinessData(req.confirm ?? "");
      return { ok: true as const, ...result };
    },
  );

  ipcMain.handle(IPC.LOG_TAIL, async (_e, maxLines?: number) => {
    return tailLog(maxLines ?? 400);
  });

  ipcMain.handle(IPC.LOG_OPEN_DIR, async () => {
    const dir = logDir();
    await mkdir(dir, { recursive: true }).catch(() => {});
    await shell.openPath(dir);
    return { ok: true as const };
  });
}
