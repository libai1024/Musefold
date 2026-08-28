import { describe, expect, it } from 'vitest';
import {
  availableProductFeatures,
  createCapabilityManifest,
  getCapabilityManifest,
  getProductCapabilities,
  isHostFeatureAvailable,
  isProductFeatureAvailable,
  legacyCapabilitiesFromManifest,
} from '../capabilities';

const currentWebFeatures = [
  'generation',
  'workbench',
  'generationHistory',
  'promptLibrary',
  'mcpConnections',
];

const pendingWebFeatures = [
  'agent',
  'officialSkills',
  'designSchemes',
  'modelSelection',
  'referenceImages',
];

describe('capability v2 manifest', () => {
  it('keeps product intent shared and desktop-only powers in host features', () => {
    const desktop = getCapabilityManifest('desktop');
    const web = getCapabilityManifest('web');

    expect(web.productFeatures).toBe(desktop.productFeatures);
    expect(Object.values(web.productFeatures).every(Boolean)).toBe(true);
    expect(desktop.hostFeatures).toMatchObject({
      host: 'desktop',
      cloudSyncControl: true,
      byokProviders: true,
      localAutomation: true,
      localMcp: true,
      nativeBackup: true,
      appUpdates: true,
      windowControls: true,
      githubSkills: true,
      browserShare: false,
    });
    expect(web.hostFeatures).toMatchObject({
      host: 'web',
      cloudSyncControl: false,
      byokProviders: false,
      localAutomation: false,
      localMcp: false,
      nativeBackup: false,
      appUpdates: false,
      windowControls: false,
      githubSkills: false,
      browserShare: true,
    });
    expect(isHostFeatureAvailable(web, 'byokProviders')).toBe(false);
    expect(web.availability.byokProviders.status).toBe('unsupported');
  });

  it('reports current Web rollout honestly without shrinking the target product', () => {
    const web = getCapabilityManifest('web');

    expect(availableProductFeatures(web)).toEqual(currentWebFeatures);
    for (const feature of currentWebFeatures) {
      expect(web.availability[feature as keyof typeof web.productFeatures]).toEqual({
        available: true,
        status: 'available',
        reason: null,
        fallbackAction: null,
      });
    }
    for (const feature of pendingWebFeatures) {
      expect(web.productFeatures[feature as keyof typeof web.productFeatures]).toBe(true);
      expect(web.availability[feature as keyof typeof web.productFeatures]).toMatchObject({
        available: false,
        status: 'rollout',
        fallbackAction: 'use_other_host',
      });
    }
  });

  it('keeps desktop local features available while gating cloud entry points', () => {
    const signedOutWeb = createCapabilityManifest({ surface: 'web', signedIn: false });
    expect(signedOutWeb.availability.generation).toMatchObject({
      available: false,
      status: 'signed_out',
      fallbackAction: 'sign_in',
    });
    expect(signedOutWeb.availability.promptLibrary.status).toBe('signed_out');
    expect(signedOutWeb.availability.agent.status).toBe('rollout');

    const offlineWeb = createCapabilityManifest({ surface: 'web', signedIn: true, online: false });
    expect(offlineWeb.availability.workbench).toMatchObject({
      available: false,
      status: 'offline',
      fallbackAction: 'retry',
    });

    const signedOutDesktop = createCapabilityManifest({ surface: 'desktop', signedIn: false });
    expect(signedOutDesktop.availability.cloudSyncControl.status).toBe('signed_out');
    expect(signedOutDesktop.availability.mcpConnections.status).toBe('signed_out');
    expect(signedOutDesktop.availability.promptLibrary.status).toBe('available');
    expect(signedOutDesktop.availability.designSchemes.status).toBe('available');
    expect(signedOutDesktop.availability.byokProviders.status).toBe('available');
  });

  it('supports rollout, unsupported and disabled overrides with deterministic priority', () => {
    const manifest = createCapabilityManifest({
      surface: 'web',
      signedIn: false,
      rollout: { agent: true, designSchemes: true, referenceImages: true },
      unsupportedFeatures: ['agent'],
      disabledFeatures: ['designSchemes'],
    });

    expect(manifest.availability.agent.status).toBe('unsupported');
    expect(manifest.availability.designSchemes.status).toBe('disabled');
    expect(manifest.availability.referenceImages.status).toBe('signed_out');
    expect(isProductFeatureAvailable(manifest, 'agent')).toBe(false);
  });
});

describe('legacy capability compatibility', () => {
  it('keeps existing static callers and host-specific flags stable', () => {
    expect(legacyCapabilitiesFromManifest(getCapabilityManifest('desktop'))).toEqual(
      getProductCapabilities('desktop'),
    );
    expect(legacyCapabilitiesFromManifest(getCapabilityManifest('web'))).toEqual(
      getProductCapabilities('web'),
    );
    expect(getProductCapabilities('desktop')).toMatchObject({
      localPrompts: true,
      cloudPrompts: false,
      promptSync: true,
      automation: true,
      byokProviders: true,
      agent: true,
    });
    expect(getProductCapabilities('web')).toMatchObject({
      localPrompts: false,
      cloudPrompts: true,
      promptSync: false,
      automation: false,
      byokProviders: false,
      agent: false,
    });
  });

  it('projects runtime unavailability into the old boolean filters', () => {
    const signedOut = legacyCapabilitiesFromManifest(
      createCapabilityManifest({ surface: 'web', signedIn: false }),
    );
    expect(signedOut.generation).toBe(false);
    expect(signedOut.cloudPrompts).toBe(false);
    expect(signedOut.cloudMcpConnections).toBe(false);

    const signedOutDesktop = legacyCapabilitiesFromManifest(
      createCapabilityManifest({ surface: 'desktop', signedIn: false }),
    );
    expect(signedOutDesktop.promptSync).toBe(false);
    expect(signedOutDesktop.localPrompts).toBe(true);
    expect(signedOutDesktop.byokProviders).toBe(true);
  });
});
