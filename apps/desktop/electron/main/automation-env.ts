/** True in pytest E2E and GitHub Actions. Never set for end-user installs. */
export function isAutomatedElectron(): boolean {
  return process.env['MUSEFOLD_E2E'] === '1' || process.env['CI'] === '1';
}
