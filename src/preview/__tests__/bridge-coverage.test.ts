import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

describe('preview IPC bridge coverage', () => {
  it('does not expose the removed recipe or legacy Skill-import domains', () => {
    const installBridge = readFileSync('src/preview/install-bridge.ts', 'utf8');
    expect(installBridge).not.toContain("domain === 'recipe");
    expect(installBridge).not.toContain("domain === 'skillImport'");
    expect(installBridge).not.toContain('commitCandidateToRecipeDraft');
  });

  it('keeps synchronous subscription APIs out of the async domain proxy', () => {
    const installBridge = readFileSync('src/preview/install-bridge.ts', 'utf8');
    expect(installBridge).toContain('onIncoming: () => () => {}');
    expect(installBridge).toContain('onMaximizeChange: () => () => {}');
  });
});
