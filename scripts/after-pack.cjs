const { execFileSync } = require('node:child_process');
const path = require('node:path');

const UNUSED_PERMISSION_KEYS = [
  'NSBluetoothAlwaysUsageDescription',
  'NSBluetoothPeripheralUsageDescription',
  'NSCameraUsageDescription',
  'NSMicrophoneUsageDescription',
];

exports.default = async function afterPack(context) {
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

