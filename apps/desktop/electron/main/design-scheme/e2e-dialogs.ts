/**
 * 仅 MUSEFOLD_E2E=1 且显式路径 env 时绕过原生对话框。
 * 生产默认不读这些变量,避免误开文件。
 */

export function resolveE2eOpenPackageDialog(): { canceled: false; filePaths: string[] } | null {
  if (process.env['MUSEFOLD_E2E'] !== '1') return null;
  const importPath = process.env['MUSEFOLD_E2E_DESIGN_IMPORT_PATH']?.trim();
  return importPath ? { canceled: false, filePaths: [importPath] } : null;
}

export function resolveE2eSavePackageDialog():
  | { canceled: true; filePath?: undefined }
  | { canceled: false; filePath: string }
  | null {
  if (process.env['MUSEFOLD_E2E'] !== '1') return null;
  if (process.env['MUSEFOLD_E2E_DESIGN_EXPORT_CANCEL'] === '1') {
    return { canceled: true };
  }
  const exportPath = process.env['MUSEFOLD_E2E_DESIGN_EXPORT_PATH']?.trim();
  return exportPath ? { canceled: false, filePath: exportPath } : null;
}
