import { describe, expect, it } from 'vitest';
import { cloudAutomationGenerationSchema } from '../automation-generation';
import {
  managedGenerationRecordSchema,
  registerManagedGenerationSchema,
} from '../managed-generation';

describe('cloud automation intent', () => {
  it('shares generation constraints without accepting credentials or payer assertions', () => {
    expect(
      cloudAutomationGenerationSchema.parse({
        prompt: 'test',
        n: 1,
        consent: 'interactive',
        declaredBudgetPoints: 20,
      }),
    ).toMatchObject({ n: 1 });
    for (const extra of [
      { token: 'secret' },
      { ownerId: 'owner' },
      { expectedBinding: {} },
      { n: 3 },
      { consent: true },
      { declaredBudgetPoints: -1 },
    ])
      expect(cloudAutomationGenerationSchema.safeParse({ prompt: 'test', ...extra }).success).toBe(
        false,
      );
  });
  it('keeps old managed records compatible and new caller intent hashes strict', () => {
    for (const schema of [managedGenerationRecordSchema, registerManagedGenerationSchema]) {
      expect(schema.shape.automationInputHash.parse(undefined)).toBeUndefined();
      expect(schema.shape.automationInputHash.parse('a'.repeat(64))).toHaveLength(64);
      expect(schema.shape.automationInputHash.safeParse('raw prompt or password').success).toBe(
        false,
      );
    }
  });
});
