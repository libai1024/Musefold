import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** @param {{repoRoot: string, platform: string, arch: string, required: boolean, explicitPath?: string}} options */
export function resolvePackageArtifact(options) {
  /** @type {Record<string, string>} */
  const targets = {
    'darwin-arm64': 'release/mac-arm64/Musefold.app/Contents/MacOS/Musefold',
    'darwin-x64': 'release/mac/Musefold.app/Contents/MacOS/Musefold',
    'win32-x64': 'release/win-unpacked/Musefold.exe',
    'win32-arm64': 'release/win-arm64-unpacked/Musefold.exe',
  };
  const target = targets[`${options.platform}-${options.arch}`];
  if (!target) {
    if (options.required)
      throw new Error(`Unsupported package target: ${options.platform}-${options.arch}`);
    return undefined;
  }
  const executable = resolve(options.repoRoot, options.explicitPath || target);
  if (existsSync(executable)) return executable;
  if (options.required || options.explicitPath) {
    throw new Error(`Required package artifact is missing: ${executable}`);
  }
  return undefined;
}
