// system 域桥行为守护:出参 path-free、入参白名单、错误码稳定且 message 不含绝对路径。
// 服务函数(backup/reset/logger/about)全 mock;paths 走真实 electron/system/paths,
// 但 app.getPath 指向临时目录,绝不触碰真实 userData。

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const USER_DATA = mkdtempSync(join(tmpdir(), 'musefold-system-domain-'));

const mocks = vi.hoisted(() => ({
  app: {
    getPath: vi.fn((name: string) => name),
    relaunch: vi.fn(),
    exit: vi.fn(),
  },
  shell: {
    openPath: vi.fn(async () => ''),
    openExternal: vi.fn(async () => undefined),
    showItemInFolder: vi.fn(),
  },
  createBackup: vi.fn(async (_label?: string) => ''),
  listBackups: vi.fn(async () => [] as unknown[]),
  restoreBackup: vi.fn(async (_file: string) => ({ safetyBackupPath: '' })),
  resetBusinessData: vi.fn(async (_confirm: string) => ({ backupPath: '' })),
  tailLog: vi.fn(async (_lines?: number) => ''),
  openAboutResource: vi.fn(async (_resource: string) => undefined),
  hasActiveImageJobs: vi.fn(() => false),
  pragma: vi.fn(() => 21),
  getUpdateChannel: vi.fn(() => 'stable'),
}));

vi.mock('electron', () => ({ app: mocks.app, shell: mocks.shell }));
vi.mock('../../../system/backup', () => ({
  createBackup: mocks.createBackup,
  listBackups: mocks.listBackups,
  restoreBackup: mocks.restoreBackup,
}));
vi.mock('../../../system/reset', () => ({ resetBusinessData: mocks.resetBusinessData }));
vi.mock('../../../system/logger', () => ({
  tailLog: mocks.tailLog,
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('../../../system/about', () => ({ openAboutResource: mocks.openAboutResource }));
vi.mock('../../../system/app-version', () => ({ APP_VERSION: '2.5.0-test' }));
vi.mock('../../../settings/update-channel', () => ({ getUpdateChannel: mocks.getUpdateChannel }));
vi.mock('@musefold/core/db', () => ({ getDb: () => ({ pragma: mocks.pragma }) }));
vi.mock('@musefold/core/services/generation', () => ({
  hasActiveImageJobs: mocks.hasActiveImageJobs,
}));

import { V25_METHODS_BY_DOMAIN } from '@musefold/contracts';
import { BACKUPS_DIR_NAME, DB_NAME, LOGS_DIR_NAME } from '@musefold/core/constants';
import { BridgeError, type MethodDef } from '../envelope';
import { buildSystemDomainMethods } from '../system-domain';

const BACKUP_ROW = {
  file: 'backup-20260901-101500-123-manual.db',
  path: join(USER_DATA, 'backups', 'backup-20260901-101500-123-manual.db'),
  size: 8192,
  createdAt: Date.UTC(2026, 8, 1, 10, 15, 0, 123),
  kind: 'manual' as const,
};

let methods: Record<string, MethodDef>;

function call(method: string, payload?: unknown): Promise<unknown> {
  const def = methods[method];
  if (!def) throw new Error(`missing method: ${method}`);
  const parsed = def.input.safeParse(payload);
  if (!parsed.success) throw new Error(`VALIDATION_FAILED: ${method}`);
  return def.handle(parsed.data);
}

function accepts(method: string, payload: unknown): boolean {
  const def = methods[method];
  if (!def) throw new Error(`missing method: ${method}`);
  return def.input.safeParse(payload).success;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.app.getPath.mockImplementation((name: string) =>
    name === 'pictures' ? join(USER_DATA, 'system-pictures') : USER_DATA,
  );
  mocks.shell.openPath.mockResolvedValue('');
  mocks.listBackups.mockResolvedValue([BACKUP_ROW]);
  mocks.pragma.mockReturnValue(21);
  mocks.getUpdateChannel.mockReturnValue('stable');
  mocks.hasActiveImageJobs.mockReturnValue(false);
  methods = buildSystemDomainMethods();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('system domain method table', () => {
  it('exposes exactly the contract method set', () => {
    expect(Object.keys(methods).sort()).toEqual([...V25_METHODS_BY_DOMAIN.system].sort());
  });

  it('rejects unexpected keys on the no-input methods', () => {
    for (const method of [
      'system.getAppInfo',
      'system.listBackups',
      'system.createBackup',
      'system.listStorageLocations',
      'system.readDiagnosticLog',
      'system.openProductDocs',
      'system.relaunch',
    ]) {
      expect(accepts(method, undefined), method).toBe(true);
      expect(accepts(method, {}), method).toBe(true);
      expect(accepts(method, { file: 'x.db' }), method).toBe(false);
    }
  });
});

describe('backups', () => {
  it('lists backups without the absolute path and with an ISO timestamp', async () => {
    const result = await call('system.listBackups');
    expect(result).toEqual([
      {
        file: BACKUP_ROW.file,
        size: 8192,
        createdAt: '2026-09-01T10:15:00.123+00:00',
        kind: 'manual',
      },
    ]);
    expect(JSON.stringify(result)).not.toContain(USER_DATA);
  });

  it('drops files whose name is not a contract-shaped backup name', async () => {
    mocks.listBackups.mockResolvedValue([
      BACKUP_ROW,
      { ...BACKUP_ROW, file: '../escape.db' },
      { ...BACKUP_ROW, file: 'my notes.db' },
    ]);
    expect(await call('system.listBackups')).toHaveLength(1);
  });

  it('creates a manual backup and returns the fresh entry', async () => {
    mocks.createBackup.mockResolvedValue(BACKUP_ROW.path);
    expect(await call('system.createBackup')).toEqual({
      backup: {
        file: BACKUP_ROW.file,
        size: 8192,
        createdAt: '2026-09-01T10:15:00.123+00:00',
        kind: 'manual',
      },
    });
    expect(mocks.createBackup).toHaveBeenCalledWith('manual');
  });

  it('maps a failing backup creation to BACKUP_FAILED without leaking the path', async () => {
    mocks.createBackup.mockRejectedValue(
      new Error(`ENOSPC: no space left, open '${BACKUP_ROW.path}'`),
    );
    await expect(call('system.createBackup')).rejects.toMatchObject({
      code: 'BACKUP_FAILED',
      message: '创建备份失败,请检查磁盘空间后重试',
    });
  });

  it('only accepts a bare .db file name for restore', () => {
    expect(accepts('system.restoreBackup', { file: BACKUP_ROW.file })).toBe(true);
    for (const file of [BACKUP_ROW.path, '../escape.db', 'nested/backup.db', 'backup.sqlite']) {
      expect(accepts('system.restoreBackup', { file }), file).toBe(false);
    }
  });

  it('restores a backup and reports the safety snapshot plus the restart requirement', async () => {
    mocks.restoreBackup.mockResolvedValue({
      safetyBackupPath: join(USER_DATA, 'backups', 'backup-20260901-101600-000-pre-restore.db'),
    });
    const result = await call('system.restoreBackup', { file: BACKUP_ROW.file });
    expect(result).toEqual({
      safetyBackupFile: 'backup-20260901-101600-000-pre-restore.db',
      needsRestart: true,
    });
    expect(mocks.restoreBackup).toHaveBeenCalledWith(BACKUP_ROW.file);
    expect(JSON.stringify(result)).not.toContain(USER_DATA);
  });

  it('translates each restore failure code and keeps every message path-free', async () => {
    const cases = [
      ['FORBIDDEN', 'FORBIDDEN: 只能恢复备份目录中的数据库文件', '只能恢复备份目录中的数据库文件'],
      [
        'BACKUP_NOT_FOUND',
        'BACKUP_NOT_FOUND: 备份不存在、已移动或不是普通文件',
        '备份不存在、已移动或不是普通文件',
      ],
      [
        'INVALID_BACKUP',
        'INVALID_BACKUP: 所选文件不是 Musefold 数据库备份',
        '所选文件不是 Musefold 数据库备份',
      ],
      [
        'INCOMPATIBLE_BACKUP',
        'INCOMPATIBLE_BACKUP: 备份来自更高版本的 Musefold,请先升级应用',
        '备份来自更高版本的 Musefold,请先升级应用',
      ],
      [
        'RESTORE_FAILED',
        `RESTORE_FAILED: ENOENT: no such file, rename '${BACKUP_ROW.path}'`,
        '恢复未完成,请重启应用并核对备份',
      ],
    ] as const;

    for (const [code, raw, message] of cases) {
      const error = new Error(raw) as Error & { code: string };
      error.code = code;
      mocks.restoreBackup.mockRejectedValueOnce(error);
      const rejection = await call('system.restoreBackup', { file: BACKUP_ROW.file }).catch(
        (thrown: unknown) => thrown,
      );
      expect(rejection, code).toBeInstanceOf(BridgeError);
      expect(rejection).toMatchObject({ code, message });
      expect((rejection as BridgeError).message).not.toContain(USER_DATA);
    }
  });

  it('falls back to RESTORE_FAILED for an uncoded failure', async () => {
    mocks.restoreBackup.mockRejectedValue(new Error(`EACCES: ${BACKUP_ROW.path}`));
    const rejection = await call('system.restoreBackup', { file: BACKUP_ROW.file }).catch(
      (thrown: unknown) => thrown,
    );
    expect(rejection).toMatchObject({
      code: 'RESTORE_FAILED',
      message: '恢复未完成,请重启应用并核对备份',
    });
  });
});

describe('storage locations', () => {
  it('reports the five whitelisted locations with display paths', async () => {
    const locations = (await call('system.listStorageLocations')) as Array<{
      id: string;
      label: string;
      displayPath: string;
    }>;
    expect(locations.map((location) => location.id)).toEqual([
      'database',
      'images',
      'backups',
      'logs',
      'userData',
    ]);
    // displayPath 是本卡的功能本身(桌面专属),必须是真实本机路径。
    expect(locations.every((location) => location.displayPath.startsWith(USER_DATA))).toBe(true);
    expect(locations.every((location) => location.label.length > 0)).toBe(true);
  });

  it('opens only whitelisted ids and never a renderer-supplied path', async () => {
    expect(accepts('system.openStorageLocation', { id: 'backups' })).toBe(true);
    expect(accepts('system.openStorageLocation', { id: 'secrets' })).toBe(false);
    expect(accepts('system.openStorageLocation', { id: 'backups', path: '/etc/passwd' })).toBe(
      false,
    );
    expect(accepts('system.openStorageLocation', { path: '/etc/passwd' })).toBe(false);

    await call('system.openStorageLocation', { id: 'backups' });
    expect(mocks.shell.openPath).toHaveBeenCalledWith(join(USER_DATA, BACKUPS_DIR_NAME));

    // 数据库是文件:在文件管理器里定位而不是用系统默认程序打开。
    await call('system.openStorageLocation', { id: 'database' });
    expect(mocks.shell.showItemInFolder).toHaveBeenCalledWith(join(USER_DATA, DB_NAME));
  });

  it('maps a failing open to OPEN_FAILED without echoing the shell error string', async () => {
    mocks.shell.openPath.mockResolvedValue(`Failed to open path ${join(USER_DATA, LOGS_DIR_NAME)}`);
    const rejection = await call('system.openStorageLocation', { id: 'logs' }).catch(
      (thrown: unknown) => thrown,
    );
    expect(rejection).toMatchObject({
      code: 'OPEN_FAILED',
      message: '打开该位置失败,请检查目录是否仍存在',
    });
    expect((rejection as BridgeError).message).not.toContain(USER_DATA);
  });
});

describe('diagnostic log', () => {
  it('returns the redacted tail and flags truncation', async () => {
    mocks.tailLog.mockResolvedValue('line-1\nline-2');
    expect(await call('system.readDiagnosticLog')).toEqual({
      text: 'line-1\nline-2',
      truncated: false,
    });
    expect(mocks.tailLog).toHaveBeenCalledWith(300);

    mocks.tailLog.mockResolvedValue('x'.repeat(200 * 1024 + 10));
    const long = (await call('system.readDiagnosticLog')) as { text: string; truncated: boolean };
    expect(long.truncated).toBe(true);
    expect(long.text).toHaveLength(200 * 1024);
  });

  it('reports an empty log as an empty string, not an error', async () => {
    mocks.tailLog.mockResolvedValue('');
    expect(await call('system.readDiagnosticLog')).toEqual({ text: '', truncated: false });
  });
});

describe('danger zone', () => {
  it('requires the exact confirmation phrase', () => {
    expect(accepts('system.clearAllData', { confirmation: '清空全部数据' })).toBe(true);
    for (const confirmation of ['RESET', '清空数据', '', undefined]) {
      expect(accepts('system.clearAllData', { confirmation }), String(confirmation)).toBe(false);
    }
    expect(accepts('system.clearAllData', undefined)).toBe(false);
  });

  it('takes a pre-reset snapshot and reports it by file name only', async () => {
    mocks.resetBusinessData.mockResolvedValue({
      backupPath: join(USER_DATA, 'backups', 'backup-20260901-101700-000-pre-reset.db'),
    });
    const result = await call('system.clearAllData', { confirmation: '清空全部数据' });
    expect(result).toEqual({ safetyBackupFile: 'backup-20260901-101700-000-pre-reset.db' });
    expect(mocks.resetBusinessData).toHaveBeenCalledWith('RESET');
    expect(JSON.stringify(result)).not.toContain(USER_DATA);
  });

  it('refuses to clear while image jobs are still running', async () => {
    mocks.hasActiveImageJobs.mockReturnValue(true);
    await expect(
      call('system.clearAllData', { confirmation: '清空全部数据' }),
    ).rejects.toMatchObject({ code: 'CLEAR_BUSY' });
    expect(mocks.resetBusinessData).not.toHaveBeenCalled();
  });

  it('maps a reset failure to CLEAR_FAILED without leaking the path', async () => {
    mocks.resetBusinessData.mockRejectedValue(new Error(`SQLITE_BUSY: ${BACKUP_ROW.path}`));
    await expect(
      call('system.clearAllData', { confirmation: '清空全部数据' }),
    ).rejects.toMatchObject({ code: 'CLEAR_FAILED', message: '清空数据失败,数据未被改动' });
  });
});

describe('app info / external links / relaunch', () => {
  it('reports version, platform, arch, schema version and channel', async () => {
    expect(await call('system.getAppInfo')).toEqual({
      version: '2.5.0-test',
      platform: process.platform,
      arch: process.arch,
      schemaVersion: 21,
      channel: 'stable',
    });
  });

  it('falls back to schema version 0 when the database cannot be read', async () => {
    mocks.pragma.mockImplementation(() => {
      throw new Error('database is locked');
    });
    expect(await call('system.getAppInfo')).toMatchObject({ schemaVersion: 0 });
  });

  it('opens only whitelisted https links', async () => {
    expect(accepts('system.openExternal', { url: 'http://ai.tvt.wiki/' })).toBe(false);
    expect(accepts('system.openExternal', { url: 'file:///etc/passwd' })).toBe(false);

    await call('system.openExternal', { url: 'https://ai.tvt.wiki/login/' });
    expect(mocks.shell.openExternal).toHaveBeenCalledWith('https://ai.tvt.wiki/login/');

    await expect(
      call('system.openExternal', { url: 'https://evil.example/phish' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: '不允许打开该链接' });
    expect(mocks.shell.openExternal).toHaveBeenCalledTimes(1);
  });

  it('opens the bundled product docs through the whitelisted resource id', async () => {
    await call('system.openProductDocs');
    expect(mocks.openAboutResource).toHaveBeenCalledWith('product-docs');

    mocks.openAboutResource.mockRejectedValue(
      new Error(`ABOUT_RESOURCE_OPEN_FAILED: ${BACKUP_ROW.path}`),
    );
    const rejection = await call('system.openProductDocs').catch((thrown: unknown) => thrown);
    expect(rejection).toMatchObject({
      code: 'DOCS_OPEN_FAILED',
      message: '文档打开失败,请检查安装文件是否完整',
    });
    expect((rejection as BridgeError).message).not.toContain(USER_DATA);
  });

  it('relaunches after the envelope has a chance to reach the renderer', async () => {
    vi.useFakeTimers();
    expect(await call('system.relaunch')).toBeNull();
    expect(mocks.app.relaunch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(mocks.app.relaunch).toHaveBeenCalledOnce();
    expect(mocks.app.exit).toHaveBeenCalledWith(0);
  });
});
