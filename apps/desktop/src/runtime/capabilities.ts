import {
  createCapabilityManifest,
  getCapabilityManifest,
  getProductCapabilities,
  productCommandCapabilityMap,
  productSidebarCapabilityMap,
  type CapabilityRuntimeContext,
  type ProductCapabilities,
} from '@musefold/domain';

export function createDesktopCapabilityManifest(context: CapabilityRuntimeContext = {}) {
  return createCapabilityManifest({ surface: 'desktop', ...context });
}

export const capabilityManifest = getCapabilityManifest('desktop');

/** Legacy boolean projection retained while desktop entry gates migrate to the v2 manifest. */
export const capabilities = getProductCapabilities('desktop');

export type DesktopCapabilityFlag = keyof ProductCapabilities;

/** Sidebar navigation id to capability flag. Entries not listed here remain visible. */
export const SIDEBAR_NAV_CAPABILITY = productSidebarCapabilityMap('desktop') as Record<
  string,
  DesktopCapabilityFlag
>;

/** Settings sections use any-of semantics when multiple legacy flags are listed. */
export const SETTINGS_SECTION_CAPABILITY = {
  relay: ['byokProviders', 'agent'],
  open: ['automation', 'cloudMcpConnections'],
} as const satisfies Record<string, DesktopCapabilityFlag | readonly DesktopCapabilityFlag[]>;

export const COMMAND_ACTION_CAPABILITY = productCommandCapabilityMap('desktop') as Record<
  string,
  DesktopCapabilityFlag
>;

/** No mapped flag means visible; arrays are visible when at least one flag is available. */
export function isCapabilityEntryVisible(
  mapping: {
    readonly [id: string]: DesktopCapabilityFlag | readonly DesktopCapabilityFlag[];
  },
  id: string,
  source: Readonly<ProductCapabilities> = capabilities,
): boolean {
  const flag = mapping[id];
  if (flag === undefined) return true;
  if (typeof flag !== 'string') return flag.some((entry) => source[entry]);
  return source[flag];
}
