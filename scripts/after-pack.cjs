const { execFileSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');
const { listPackage, statFile } = require('@electron/asar');
const { Arch } = require('builder-util');

const UNUSED_PERMISSION_KEYS = [
  'NSBluetoothAlwaysUsageDescription',
  'NSBluetoothPeripheralUsageDescription',
  'NSCameraUsageDescription',
  'NSMicrophoneUsageDescription',
];

function assertPackagedSqlite(resources, platform, arch) {
  const nativeArch = typeof arch === 'number' ? Arch[arch] : arch;
  const archive = path.join(resources, 'app.asar');
  const entries = [
    path.join('node_modules', 'better-sqlite3', 'package.json'),
    path.join('node_modules', 'better-sqlite3', 'lib', 'index.js'),
    path.join('node_modules', 'better-sqlite3', 'prebuilds', `${platform}-${nativeArch}.node`),
  ];
  for (const entry of entries) {
    let info;
    try {
      info = statFile(archive, entry);
    } catch {
      throw new Error(`PACKAGED_SQLITE_MISSING: ${entry}`);
    }
    if (!info.unpacked || !existsSync(path.join(resources, 'app.asar.unpacked', entry))) {
      throw new Error(`PACKAGED_SQLITE_NOT_UNPACKED: ${entry}`);
    }
  }
  if (
    listPackage(archive).some((entry) =>
      entry.replaceAll('\\', '/').includes('/node_modules/better-sqlite3/build/'),
    )
  ) {
    throw new Error('PACKAGED_SQLITE_BUILD_FILES');
  }
}

exports.assertPackagedSqlite = assertPackagedSqlite;

exports.default = async function afterPack(context) {
  const resources =
    context.electronPlatformName === 'darwin'
      ? path.join(
          context.appOutDir,
          `${context.packager.appInfo.productFilename}.app`,
          'Contents',
          'Resources',
        )
      : path.join(context.appOutDir, 'resources');
  assertPackagedSqlite(resources, context.electronPlatformName, context.arch);

  if (context.electronPlatformName !== 'darwin') return;

  const plist = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    'Contents',
    'Info.plist',
  );

  for (const key of UNUSED_PERMISSION_KEYS) {
    try {
      execFileSync('/usr/libexec/PlistBuddy', ['-c', `Delete :${key}`, plist], {
        stdio: 'ignore',
      });
    } catch {
      // Electron versions may stop shipping a key; absence is already the desired state.
    }
  }
};
