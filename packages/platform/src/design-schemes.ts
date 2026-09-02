import type { PlatformCapabilities } from './capabilities';
import type { DesignSchemesGateway } from './gateway';

export const DESIGN_SCHEMES_CAPABILITY_UNAVAILABLE = 'CAPABILITY_UNAVAILABLE' as const;

export class PlatformCapabilityError extends Error {
  readonly code = DESIGN_SCHEMES_CAPABILITY_UNAVAILABLE;
  readonly capability: keyof PlatformCapabilities;

  constructor(capability: keyof PlatformCapabilities) {
    super(`当前宿主不提供能力: ${capability}`);
    this.name = 'PlatformCapabilityError';
    this.capability = capability;
  }
}

/**
 * Resolve an optional domain only when its capability and adapter agree.
 * This keeps unavailable domains from becoming silent no-op UI entry points.
 */
export function requireDesignSchemes(
  capabilities: PlatformCapabilities,
  gateway: { designSchemes?: DesignSchemesGateway },
): DesignSchemesGateway {
  if (!capabilities.hasDesignSchemes || !gateway.designSchemes) {
    throw new PlatformCapabilityError('hasDesignSchemes');
  }
  return gateway.designSchemes;
}
