import { afterEach, describe, expect, it } from 'vitest';
import { resolveE2eOpenPackageDialog, resolveE2eSavePackageDialog } from '../e2e-dialogs';

afterEach(() => {
  delete process.env['MUSEFOLD_E2E'];
  delete process.env['MUSEFOLD_E2E_DESIGN_IMPORT_PATH'];
  delete process.env['MUSEFOLD_E2E_DESIGN_EXPORT_PATH'];
  delete process.env['MUSEFOLD_E2E_DESIGN_EXPORT_CANCEL'];
});

describe('design-scheme E2E dialog bypass', () => {
  it('非 E2E 不读路径 env', () => {
    process.env['MUSEFOLD_E2E_DESIGN_IMPORT_PATH'] = '/tmp/import.musefold.design';
    process.env['MUSEFOLD_E2E_DESIGN_EXPORT_PATH'] = '/tmp/export.musefold.design';
    expect(resolveE2eOpenPackageDialog()).toBeNull();
    expect(resolveE2eSavePackageDialog()).toBeNull();
  });

  it('E2E + 导入路径跳过打开对话框', () => {
    process.env['MUSEFOLD_E2E'] = '1';
    process.env['MUSEFOLD_E2E_DESIGN_IMPORT_PATH'] = '/tmp/import.musefold.design';
    expect(resolveE2eOpenPackageDialog()).toEqual({
      canceled: false,
      filePaths: ['/tmp/import.musefold.design'],
    });
  });

  it('E2E + 导出路径 / 取消分别返回旁路结果', () => {
    process.env['MUSEFOLD_E2E'] = '1';
    process.env['MUSEFOLD_E2E_DESIGN_EXPORT_PATH'] = '/tmp/export.musefold.design';
    expect(resolveE2eSavePackageDialog()).toEqual({
      canceled: false,
      filePath: '/tmp/export.musefold.design',
    });
    process.env['MUSEFOLD_E2E_DESIGN_EXPORT_CANCEL'] = '1';
    expect(resolveE2eSavePackageDialog()).toEqual({ canceled: true });
  });
});
