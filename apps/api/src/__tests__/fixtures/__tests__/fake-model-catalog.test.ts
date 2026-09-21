import { expect, it } from 'vitest';
import { createFakeNewApi } from '../fake-new-api';

it('provides authenticated, differently priced image models for actual browser services', async () => {
  const upstream = createFakeNewApi({ imageModels: ['musefold-image-pro', 'gpt-image-2'] });
  const session = await upstream.login({ username: 'tester', password: 'correct-password' });
  expect(await upstream.listUserModels(session.jwt)).toEqual(['musefold-image-pro', 'gpt-image-2']);
  const pricing = await upstream.getPricing(session.jwt);
  expect(pricing.groupRatio).toEqual({ default: 3 });
  expect(pricing.models.map((row) => row.modelPrice)).toEqual([0.04, 0.08]);
  await expect(upstream.getPricing('another-account-token')).rejects.toThrow('Session expired');
  await expect(upstream.listUserModels('another-account-token')).rejects.toThrow('Session expired');
});
