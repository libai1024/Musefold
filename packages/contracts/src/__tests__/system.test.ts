import { describe, expect, it } from 'vitest';
import { V25_METHODS_BY_DOMAIN } from '../gateway-methods';
import {
  appInfoSchema,
  backupFileNameSchema,
  backupInfoSchema,
  CLEAR_ALL_DATA_CONFIRMATION,
  clearAllDataInputSchema,
  clearAllDataResultSchema,
  createBackupResultSchema,
  diagnosticLogSchema,
  openExternalInputSchema,
  openStorageLocationInputSchema,
  restoreBackupInputSchema,
  restoreBackupResultSchema,
  storageLocationSchema,
  thirdPartyNoticeSchema,
} from '../system';

const BACKUP = {
  file: 'backup-20260901-101500-123-manual.db',
  size: 4096,
  createdAt: '2026-09-01T10:15:00.123+00:00',
  kind: 'manual' as const,
};

describe('backup contracts(路径不可下发)', () => {
  it('accepts a bare backup file name and rejects anything path-shaped', () => {
    expect(backupFileNameSchema.parse(BACKUP.file)).toBe(BACKUP.file);
    for (const value of [
      '/Users/creator/Library/Application Support/Musefold/backups/backup.db',
      'C:\\Users\\creator\\AppData\\Musefold\\backups\\backup.db',
      '../backup.db',
      'nested/backup.db',
      'nested\\backup.db',
      '.hidden.db',
      'backup.sqlite',
      'backup.db.txt',
      '',
    ]) {
      expect(backupFileNameSchema.safeParse(value).success, value).toBe(false);
    }
  });

  it('keeps backupInfo strict and path-free', () => {
    expect(backupInfoSchema.parse(BACKUP)).toEqual(BACKUP);
    expect(backupInfoSchema.safeParse({ ...BACKUP, path: '/tmp/backup.db' }).success).toBe(false);
    expect(backupInfoSchema.safeParse({ ...BACKUP, createdAt: 1_756_720_500_000 }).success).toBe(
      false,
    );
    expect(backupInfoSchema.safeParse({ ...BACKUP, size: -1 }).success).toBe(false);
    expect(backupInfoSchema.safeParse({ ...BACKUP, kind: 'pre-reset' }).success).toBe(false);
    expect(createBackupResultSchema.parse({ backup: BACKUP })).toEqual({ backup: BACKUP });
  });

  it('restore addresses a backup by file name and always demands a restart', () => {
    expect(restoreBackupInputSchema.parse({ file: BACKUP.file })).toEqual({ file: BACKUP.file });
    expect(restoreBackupInputSchema.safeParse({ file: '/abs/backup.db' }).success).toBe(false);
    expect(restoreBackupInputSchema.safeParse({ file: BACKUP.file, force: true }).success).toBe(
      false,
    );

    const result = {
      safetyBackupFile: 'backup-20260901-101600-000-pre-restore.db',
      needsRestart: true,
    } as const;
    expect(restoreBackupResultSchema.parse(result)).toEqual(result);
    expect(restoreBackupResultSchema.safeParse({ ...result, needsRestart: false }).success).toBe(
      false,
    );
  });
});

describe('storage location contracts(白名单 id + 展示路径)', () => {
  it('only accepts the five whitelisted ids', () => {
    for (const id of ['database', 'images', 'backups', 'logs', 'userData'] as const) {
      expect(openStorageLocationInputSchema.parse({ id })).toEqual({ id });
    }
    expect(openStorageLocationInputSchema.safeParse({ id: 'secrets' }).success).toBe(false);
    // 任意路径不是合法入参:主进程只按 id 解析,渲染层无法指定目标。
    expect(openStorageLocationInputSchema.safeParse({ id: 'backups', path: '/etc' }).success).toBe(
      false,
    );
  });

  it('carries a display path for the desktop-only card', () => {
    const location = {
      id: 'backups' as const,
      label: '备份目录',
      displayPath: '/Users/creator/Library/Application Support/Musefold/backups',
    };
    expect(storageLocationSchema.parse(location)).toEqual(location);
    expect(storageLocationSchema.safeParse({ ...location, displayPath: '' }).success).toBe(false);
  });
});

describe('diagnostic log / danger zone / app info', () => {
  it('reports the log tail with an explicit truncation flag', () => {
    expect(diagnosticLogSchema.parse({ text: '', truncated: false })).toEqual({
      text: '',
      truncated: false,
    });
    expect(diagnosticLogSchema.safeParse({ text: 'x' }).success).toBe(false);
    expect(diagnosticLogSchema.safeParse({ text: 'x', truncated: false, path: 'x' }).success).toBe(
      false,
    );
  });

  it('gates clearAllData behind the exact confirmation phrase', () => {
    expect(CLEAR_ALL_DATA_CONFIRMATION).toBe('清空全部数据');
    expect(clearAllDataInputSchema.parse({ confirmation: CLEAR_ALL_DATA_CONFIRMATION })).toEqual({
      confirmation: CLEAR_ALL_DATA_CONFIRMATION,
    });
    for (const confirmation of ['RESET', '清空数据', '清空全部数据 ', '', '清空全部数据!']) {
      expect(clearAllDataInputSchema.safeParse({ confirmation }).success, confirmation).toBe(false);
    }
    expect(clearAllDataResultSchema.parse({ safetyBackupFile: BACKUP.file })).toEqual({
      safetyBackupFile: BACKUP.file,
    });
  });

  it('keeps app info strict with optional commit / channel', () => {
    const base = { version: '2.5.0', platform: 'darwin', arch: 'arm64', schemaVersion: 21 };
    expect(appInfoSchema.parse(base)).toEqual(base);
    expect(appInfoSchema.parse({ ...base, commit: 'abc1234', channel: 'stable' })).toMatchObject({
      commit: 'abc1234',
      channel: 'stable',
    });
    expect(appInfoSchema.safeParse({ ...base, userDataPath: '/tmp' }).success).toBe(false);
    expect(appInfoSchema.safeParse({ ...base, schemaVersion: '21' }).success).toBe(false);
  });
});

describe('external links / third-party notices', () => {
  it('allows only credential-free https urls', () => {
    expect(openExternalInputSchema.parse({ url: 'https://ai.tvt.wiki/login/' })).toEqual({
      url: 'https://ai.tvt.wiki/login/',
    });
    for (const url of [
      'http://ai.tvt.wiki/login/',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'https://user:pass@ai.tvt.wiki/',
      'not-a-url',
    ]) {
      expect(openExternalInputSchema.safeParse({ url }).success, url).toBe(false);
    }
  });

  it('describes a license entry with name and license only', () => {
    expect(thirdPartyNoticeSchema.parse({ name: 'zod', license: 'MIT' })).toEqual({
      name: 'zod',
      license: 'MIT',
    });
    expect(
      thirdPartyNoticeSchema.safeParse({ name: 'zod', license: 'MIT', url: 'https://x.dev' })
        .success,
    ).toBe(false);
  });
});

describe('system gateway method table', () => {
  it('registers the eleven system methods and no clipboard channel', () => {
    expect(V25_METHODS_BY_DOMAIN.system).toEqual([
      'system.getAppInfo',
      'system.listBackups',
      'system.createBackup',
      'system.restoreBackup',
      'system.listStorageLocations',
      'system.openStorageLocation',
      'system.readDiagnosticLog',
      'system.clearAllData',
      'system.openExternal',
      'system.openProductDocs',
      'system.relaunch',
    ]);
    // 剪贴板复制在渲染层用 navigator.clipboard 完成,不开 IPC 通道。
    expect(V25_METHODS_BY_DOMAIN.system).not.toContain('system.copyText');
  });
});
