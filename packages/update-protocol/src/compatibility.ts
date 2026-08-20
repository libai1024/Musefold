import { gt as semverGt, lt as semverLt, valid as semverValid } from 'semver';

function isExactSemver(value: string): boolean {
  return semverValid(value) === value;
}

/**
 * Shell compatibility uses inclusive bounds and SemVer prerelease ordering.
 * `0.5.0-dev` is less than `0.5.0`. `maxShellVersion === null` means no cap.
 */
export function isShellVersionCompatible(
  currentShellVersion: string,
  minShellVersion: string,
  maxShellVersion: string | null,
): boolean {
  if (!isExactSemver(currentShellVersion) || !isExactSemver(minShellVersion)) {
    return false;
  }
  if (maxShellVersion !== null && !isExactSemver(maxShellVersion)) {
    return false;
  }
  if (semverLt(currentShellVersion, minShellVersion)) return false;
  if (maxShellVersion !== null && semverLt(maxShellVersion, currentShellVersion)) return false;
  return true;
}

/**
 * Content-bundle versions must strictly increase. `appliedBundleVersion` of
 * `null` or `''` means no bundle has been applied yet.
 */
export function isStrictlyNewerBundleVersion(
  candidate: string,
  appliedBundleVersion: string | null,
): boolean {
  if (!isExactSemver(candidate)) return false;
  if (appliedBundleVersion === null || appliedBundleVersion === '') return true;
  if (!isExactSemver(appliedBundleVersion)) return false;
  return semverGt(candidate, appliedBundleVersion);
}
