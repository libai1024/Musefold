import { z } from 'zod';
import { isoDateTimeSchema } from './common';

// ── 系统 / 本地数据管理(桌面专属可选域)────────────────────────────────
// 「设置 · 数据存储」与「设置 · 关于」两张卡的出入参契约。
//
// 路径纪律:除 `storageLocationSchema.displayPath` 外,本域一切形状 path-free ——
// 备份只用备份目录内的**文件名**寻址(主进程按白名单校验),错误 message 不含绝对路径。
// `displayPath` 是唯一例外:「告诉用户数据在哪」就是这张卡的功能本身,而它只在
// 桌面宿主渲染(capabilities.hasLocalDataManagement),绝不进云端 API、同步载荷或导出文件。

/**
 * 备份文件名(备份目录内的裸文件名)。
 * 拒绝目录分隔符与相对片段:恢复入参只能指向备份目录内的 `.db`,主进程再做一次同样校验。
 */
export const backupFileNameSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*\.db$/i, '备份文件名只能是备份目录内的 .db 文件名')
  .refine((value) => !value.includes('..'), '备份文件名不得包含相对路径片段');

/** 备份来源:用户点「立即备份」为 manual,导入/恢复/清空前的自动快照为 auto。 */
export const backupKindSchema = z.enum(['manual', 'auto']);

export const backupInfoSchema = z
  .object({
    /** 备份目录内的文件名;渲染层用它作为恢复入参与列表 key(绝不下发绝对路径)。 */
    file: backupFileNameSchema,
    /** 字节数(列表行展示「大小 · 时间」)。 */
    size: z.number().int().nonnegative(),
    /** 备份文件落盘时间(ISO 8601)。 */
    createdAt: isoDateTimeSchema,
    kind: backupKindSchema,
  })
  .strict();

export const backupListSchema = z.array(backupInfoSchema);

export const createBackupResultSchema = z.object({ backup: backupInfoSchema }).strict();

export const restoreBackupInputSchema = z.object({ file: backupFileNameSchema }).strict();

export const restoreBackupResultSchema = z
  .object({
    /** 恢复前自动保全的当前库快照(反悔路径);同样只给文件名。 */
    safetyBackupFile: backupFileNameSchema,
    /** 恢复只改磁盘文件,进程内连接已关闭:调用方必须随即重启应用。 */
    needsRestart: z.literal(true),
  })
  .strict();

/** 存储位置白名单 id;主进程只按 id 解析路径,不接受渲染层传任意路径。 */
export const storageLocationIdSchema = z.enum([
  'database',
  'images',
  'backups',
  'logs',
  'userData',
]);

export const storageLocationSchema = z
  .object({
    id: storageLocationIdSchema,
    label: z.string().min(1),
    /**
     * 给用户看的本机路径。本域是桌面专属功能面(「我的数据在哪」),
     * 展示路径即功能;不得转发到云端、同步载荷或导出文件。
     */
    displayPath: z.string().min(1),
  })
  .strict();

export const storageLocationListSchema = z.array(storageLocationSchema);

export const openStorageLocationInputSchema = z.object({ id: storageLocationIdSchema }).strict();

export const diagnosticLogSchema = z
  .object({
    /** 已脱敏的日志尾部(主进程 logger 保证不含 API Key);无日志为空串。 */
    text: z.string(),
    /** 日志超出返回上限,只给了尾部。 */
    truncated: z.boolean(),
  })
  .strict();

/** 清空全部数据的确认短语:与入口按钮同词,用户照抄按钮全文即可通过(v2.1 摩擦口径)。 */
export const CLEAR_ALL_DATA_CONFIRMATION = '清空全部数据';

export const clearAllDataInputSchema = z
  .object({ confirmation: z.literal(CLEAR_ALL_DATA_CONFIRMATION) })
  .strict();

export const clearAllDataResultSchema = z
  .object({
    /** 清空前自动创建的一致性快照(恢复路径);只给文件名。 */
    safetyBackupFile: backupFileNameSchema,
  })
  .strict();

export const appInfoSchema = z
  .object({
    /** 产品版本(桌面取 package.json version)。 */
    version: z.string().min(1),
    /** 宿主平台标识(darwin / win32 / linux …),报障粘贴用。 */
    platform: z.string().min(1),
    arch: z.string().min(1),
    /** 本地库结构版本(SQLite user_version);报障时区分迁移状态。 */
    schemaVersion: z.number().int().nonnegative(),
    /** 构建 commit(有构建期注入时才出现)。 */
    commit: z.string().min(1).optional(),
    /** 更新通道(stable / beta …);热更新控制面暂缓,这里只读展示。 */
    channel: z.string().min(1).optional(),
  })
  .strict();

/** 外链:只允许 https,主进程再按宿主白名单二次判定(拒绝即结构化 FORBIDDEN)。 */
export const openExternalInputSchema = z
  .object({
    url: z
      .string()
      .url()
      .refine((value) => {
        try {
          const url = new URL(value);
          return url.protocol === 'https:' && !url.username && !url.password;
        } catch {
          return false;
        }
      }, '外链只允许不含用户名口令的 https 地址'),
  })
  .strict();

/** 第三方许可声明条目(静态许可清单,双端同一份;许可合规要求可达)。 */
export const thirdPartyNoticeSchema = z
  .object({
    name: z.string().min(1),
    license: z.string().min(1),
  })
  .strict();

export const thirdPartyNoticeListSchema = z.array(thirdPartyNoticeSchema);

export type BackupKind = z.infer<typeof backupKindSchema>;
export type BackupInfo = z.infer<typeof backupInfoSchema>;
export type CreateBackupResult = z.infer<typeof createBackupResultSchema>;
export type RestoreBackupInput = z.infer<typeof restoreBackupInputSchema>;
export type RestoreBackupResult = z.infer<typeof restoreBackupResultSchema>;
export type StorageLocationId = z.infer<typeof storageLocationIdSchema>;
export type StorageLocation = z.infer<typeof storageLocationSchema>;
export type OpenStorageLocationInput = z.infer<typeof openStorageLocationInputSchema>;
export type DiagnosticLog = z.infer<typeof diagnosticLogSchema>;
export type ClearAllDataInput = z.infer<typeof clearAllDataInputSchema>;
export type ClearAllDataResult = z.infer<typeof clearAllDataResultSchema>;
export type AppInfo = z.infer<typeof appInfoSchema>;
export type OpenExternalInput = z.infer<typeof openExternalInputSchema>;
export type ThirdPartyNotice = z.infer<typeof thirdPartyNoticeSchema>;
