import { assetOriginSchema } from '@musefold/contracts';
import { expect, it } from 'vitest';
import { ASSET_ORIGIN_LABEL } from '../scheme-labels';

it('labels every canonical asset origin without presenting cloud output as local generation', () => {
  expect(Object.keys(ASSET_ORIGIN_LABEL).sort()).toEqual([...assetOriginSchema.options].sort());
  expect(ASSET_ORIGIN_LABEL['cloud-run']).toBe('云端生成');
  expect(ASSET_ORIGIN_LABEL['local-run']).toBe('本机生成');
  expect(ASSET_ORIGIN_LABEL.uploaded).toBe('上传素材');
});
