import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workbench = readFileSync(
  'src/features/generation/workbench/GenerationWorkbench.tsx',
  'utf8',
);
const historyDetail = readFileSync(
  'src/features/history/components/HistoryDetail.tsx',
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
    expect(historyDetail).toContain('testId="history-detail-copy-image"');
    expect(historyDetail).not.toContain('navigator.clipboard.writeText(record.imagePath)');
  });
});
