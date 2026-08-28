import { describe, expect, it } from 'vitest';
import {
  createWebCapabilityManifest,
  signedOutWebCapabilityManifest,
  webCapabilitiesFromManifest,
} from '../capabilities';

describe('web capability runtime adapter', () => {
  it('keeps the current signed-in rollout available and future Web features gated', () => {
    const manifest = createWebCapabilityManifest({ signedIn: true, online: true });
    expect(manifest.hostFeatures.host).toBe('web');
    expect(manifest.availability.generation.status).toBe('available');
    expect(manifest.availability.promptLibrary.status).toBe('available');
    expect(manifest.availability.mcpConnections.status).toBe('available');
    expect(manifest.availability.agent.status).toBe('rollout');
    expect(manifest.availability.designSchemes.status).toBe('rollout');
    expect(manifest.availability.referenceImages.status).toBe('rollout');
  });

  it('reports signed-out and offline states through the legacy projection', () => {
    expect(signedOutWebCapabilityManifest.availability.generation.status).toBe('signed_out');
    expect(signedOutWebCapabilityManifest.availability.agent.status).toBe('rollout');
    expect(webCapabilitiesFromManifest(signedOutWebCapabilityManifest)).toMatchObject({
      generation: false,
      workbench: false,
      cloudPrompts: false,
      cloudMcpConnections: false,
      agent: false,
    });

    const offline = createWebCapabilityManifest({ signedIn: true, online: false });
    expect(offline.availability.generation.status).toBe('offline');
    expect(offline.availability.promptLibrary.status).toBe('offline');
    expect(webCapabilitiesFromManifest(offline).generationHistory).toBe(false);
  });

  it('can opt a migrated feature into rollout without claiming it works by default', () => {
    const current = createWebCapabilityManifest({ signedIn: true, online: true });
    const migrated = createWebCapabilityManifest({
      signedIn: true,
      online: true,
      rollout: { referenceImages: true },
    });
    expect(current.availability.referenceImages.status).toBe('rollout');
    expect(migrated.availability.referenceImages.status).toBe('available');
    expect(webCapabilitiesFromManifest(migrated).referenceImages).toBe(true);
  });
});
