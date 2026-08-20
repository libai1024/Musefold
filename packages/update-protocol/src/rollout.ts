import { createHash } from 'node:crypto';

/**
 * 客户端灰度分桶。同一 (installId, bundleVersion) 必须稳定，否则会出现反复升降级。
 * 服务端无状态，不需要上报安装列表。
 */
export function isInstallInRollout(
  installId: string,
  bundleVersion: string,
  percentage: number,
): boolean {
  if (!Number.isInteger(percentage) || percentage < 0 || percentage > 100) {
    throw new Error('rollout percentage must be an integer between 0 and 100');
  }
  // 0 和 100 是运营上最常用的两档，不该依赖哈希分布。
  if (percentage === 0) return false;
  if (percentage === 100) return true;

  // 用 '\n' 做分隔符，避免 ("ab","c") 与 ("a","bc") 落入同一哈希槽。
  const digest = createHash('sha256').update(`${installId}\n${bundleVersion}`).digest();
  const bucket = digest.readUInt32BE(0) % 100;
  return bucket < percentage;
}
