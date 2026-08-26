import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function workbenchUiSource(): string {
  const dir = 'apps/desktop/src/features/generation/workbench';
  const resultCard = 'packages/product-ui/src/workbench/WorkbenchGenerationResultCard.tsx';
  return [
    ...readdirSync(dir)
      .filter((name) => /\.(ts|tsx)$/.test(name))
      .map((name) => readFileSync(join(dir, name), 'utf8')),
    readFileSync(resultCard, 'utf8'),
  ].join('\n');
}

const workbench = workbenchUiSource();
const historyDetail = readFileSync(
  'apps/desktop/src/features/history/components/HistoryDetail.tsx',
  'utf8',
);

describe('generated image clipboard contract', () => {
  it('copies image pixels instead of the file path from result actions', () => {
    expect(workbench).toContain('await api.system.copyImage(result.imagePath)');
    expect(workbench).toContain('data-testid="result-copy-image"');
    expect(workbench).not.toContain('navigator.clipboard.writeText(result.imagePath)');
  });

  it('uses the same image clipboard behavior in history details', () => {
    expect(historyDetail).toContain('await api.system.copyImage(record.imagePath)');
    expect(historyDetail).toContain('data-testid="history-detail-copy-image"');
    expect(historyDetail).not.toContain('navigator.clipboard.writeText(record.imagePath)');
  });
});
