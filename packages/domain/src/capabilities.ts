export type MusefoldSurface = 'desktop' | 'web';

export interface ProductCapabilities {
  generation: boolean;
  workbench: boolean;
  generationHistory: boolean;
  cloudPrompts: boolean;
  promptSync: boolean;
  cloudMcpConnections: boolean;
  localPrompts: boolean;
  agent: boolean;
  designSchemes: boolean;
  automation: boolean;
  byokProviders: boolean;
  referenceImages: boolean;
}

const CAPABILITIES: Record<MusefoldSurface, Readonly<ProductCapabilities>> = {
  desktop: Object.freeze({
    generation: true,
    workbench: true,
    generationHistory: true,
    cloudPrompts: false,
    promptSync: true,
    cloudMcpConnections: false,
    localPrompts: true,
    agent: true,
    designSchemes: true,
    automation: true,
    byokProviders: true,
    referenceImages: true,
  }),
  web: Object.freeze({
    generation: true,
    workbench: true,
    generationHistory: true,
    cloudPrompts: true,
    promptSync: true,
    cloudMcpConnections: true,
    localPrompts: false,
    agent: false,
    designSchemes: false,
    automation: false,
    byokProviders: false,
    referenceImages: false,
  }),
};

export function getProductCapabilities(surface: MusefoldSurface): Readonly<ProductCapabilities> {
  return CAPABILITIES[surface];
}
