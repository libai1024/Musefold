import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workbench = readFileSync(
  'src/features/generation/workbench/GenerationWorkbench.tsx',
  'utf8',
);
const avatar = readFileSync(
  'src/components/brand/MusefoldAssistantAvatar.tsx',
  'utf8',
);
const assetGenerator = readFileSync('scripts/generate-app-icons.swift', 'utf8');

describe('assistant avatar UI contract', () => {
  it('uses the circular Musefold logo for AI replies', () => {
    expect(assetGenerator).toContain('logo-circle.png');
    expect(avatar).toContain("./musefold-assistant-avatar.png");
    expect(avatar).toContain('rounded-full');
    expect(avatar).toContain('h-14 w-14');
    expect(workbench).toContain(
      '<MusefoldAssistantAvatar data-testid="generation-assistant-avatar" />',
    );
    expect(workbench).toContain('data-testid="doubao-generation-avatar"');
    expect(workbench).toContain('<ModelBrandIcon model="doubao"');
    expect(workbench).toContain('data-testid="doubao-generation-response"');
    expect(workbench).toContain('data-testid="doubao-generation-message"');
    expect(workbench).not.toContain('<Sparkles className="h-3.5 w-3.5" />');
  });
});
