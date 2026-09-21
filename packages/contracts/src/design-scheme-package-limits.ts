/** Shared ZIP admission budgets; entry count includes manifest.json and directory entries. */
export const DESIGN_SCHEME_PACKAGE_LIMITS = {
  archiveBytes: 256 * 1024 * 1024,
  expandedBytes: 256 * 1024 * 1024,
  entryBytes: 64 * 1024 * 1024,
  entries: 1_024,
  manifestBytes: 4 * 1024 * 1024,
  compressionRatio: 200,
} as const;
