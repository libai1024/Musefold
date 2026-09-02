import type { PlatformCapabilities } from './capabilities';
import { PlatformCapabilityError } from './design-schemes';
import type { DoubaoGateway } from './gateway';

/**
 * Resolve the optional doubao domain only when capability and adapter agree.
 * Web 宿主 hasDoubaoWebLogin=false 且不安装 adapter,豆包登录 UI 不出现。
 */
export function requireDoubao(
  capabilities: PlatformCapabilities,
  gateway: { doubao?: DoubaoGateway },
): DoubaoGateway {
  if (!capabilities.hasDoubaoWebLogin || !gateway.doubao) {
    throw new PlatformCapabilityError('hasDoubaoWebLogin');
  }
  return gateway.doubao;
}
