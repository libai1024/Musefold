import { writeFile } from 'node:fs/promises';
import { test, expect, type Locator } from '@playwright/test';
import { designSchemeDetailSchema, type DesignSchemeAsset } from '@musefold/contracts';
import { PackageExchangeProcess } from './package-exchange-process';
import {
  browserJson,
  connectExchangeBrowser,
  loginExchangeBrowser,
  importExchangeBrowser,
  qualifyExchangeBrowser,
} from './package-exchange-browser';

async function decodedImage(image: Locator, asset: DesignSchemeAsset) {
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth))
    .toBe(asset.width);
  const pixels = await image.evaluate((node: HTMLImageElement) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');
    ctx.drawImage(node, 0, 0, 1, 1);
    return { height: node.naturalHeight, pixel: [...ctx.getImageData(0, 0, 1, 1).data] };
  });
  expect(pixels.height).toBe(asset.height);
  const colors = new Map([
    [2, [36, 99, 235, 255]],
    [3, [234, 179, 8, 255]],
    [4, [219, 39, 119, 255]],
  ]);
  expect(pixels.pixel).toEqual(colors.get(asset.width));
  await expect(image).toHaveAttribute('data-loaded', 'true');
}

test('real authenticated scheme images decode in list, inspector, album and lightbox; retry and lost access are bounded', async ({
  page,
  context,
  browser,
}, info) => {
  test.skip(
    process.env.RUN_DATABASE_TESTS !== 'true',
    'Requires disposable PG/S3 protocol and actual Better Auth',
  );
  test.setTimeout(180000);
  const service = new PackageExchangeProcess();
  const otherContext = await browser.newContext({ baseURL: 'http://127.0.0.1:3399' });
  try {
    const backend = await service.ready;
    await connectExchangeBrowser(context, backend.baseUrl);
    await connectExchangeBrowser(otherContext, backend.baseUrl);
    const email = 'scheme-images-owner@example.test';
    await loginExchangeBrowser(page, email);
    const file = info.outputPath('input.musefold.design');
    await writeFile(file, Buffer.from(backend.bytes, 'base64'));
    const imported = await importExchangeBrowser(page, file);
    expect(new Set(imported.assets.map((asset) => asset.contentHash)).size).toBe(3);
    const album = page.getByTestId('runtime-scheme-album');
    const activeImage = album.getByRole('img', { name: '方案示例', exact: true });
    const seen = new Set<string>();
    for (let i = 0; i < imported.assets.length; i++) {
      await expect(activeImage).toHaveAttribute(
        'src',
        /\/api\/v1\/design-schemes\/assets\/.+\/content$/,
      );
      const path = await activeImage.getAttribute('src');
      const asset = imported.assets.find(
        (item) => path === `/api/v1/design-schemes/assets/${item.id}/content`,
      );
      if (!asset || !path) throw new Error('Unknown displayed asset');
      seen.add(asset.id);
      await decodedImage(activeImage, asset);
      const result = await page.evaluate(async (url) => {
        const response = await fetch(url);
        const bytes = await response.arrayBuffer();
        const hash = await crypto.subtle.digest('SHA-256', bytes);
        return {
          status: response.status,
          cache: response.headers.get('cache-control'),
          mime: response.headers.get('content-type'),
          hash: Array.from(new Uint8Array(hash), (v) => v.toString(16).padStart(2, '0')).join(''),
        };
      }, path);
      expect(result).toEqual({
        status: 200,
        cache: 'private, no-store',
        mime: asset.mimeType,
        hash: asset.contentHash,
      });
      await album.getByRole('button', { name: '下一张', exact: true }).click();
    }
    expect(seen.size).toBe(3);
    await page.getByRole('button', { name: '全屏查看当前示例' }).click();
    const lightbox = page.getByTestId('scheme-asset-lightbox');
    const shown = await lightbox.getByRole('img', { name: '方案示例' }).getAttribute('src');
    const selected = imported.assets.find((asset) => shown?.includes(`/${asset.id}/content`));
    if (!selected) throw new Error('Unknown lightbox image');
    await decodedImage(lightbox.getByRole('img', { name: '方案示例' }), selected);
    await lightbox.screenshot({ path: info.outputPath('scheme-image-lightbox.png') });
    await page.keyboard.press('Escape');
    await expect(lightbox).not.toBeVisible();
    await expect(page.getByRole('button', { name: '全屏查看当前示例' })).toBeFocused();

    // Cover qualification remains a fixture; image delivery itself uses actual services.
    await qualifyExchangeBrowser(page, service, imported.summary.id);
    const formal = designSchemeDetailSchema.parse(
      await browserJson(page, `/api/v1/design-schemes/${imported.summary.id}`),
    );
    const cover = formal.assets.find((asset) => asset.id === formal.summary.coverAssetId);
    if (!cover) throw new Error('Missing cover');
    await page.getByTestId('runtime-scheme-detail-back').click();
    const row = page.getByTestId(`runtime-scheme-row-${formal.summary.id}`);
    await decodedImage(row.locator('img'), cover);
    await page.getByTestId(`runtime-scheme-open-${formal.summary.id}`).click();
    await decodedImage(page.getByTestId('scheme-inspector').locator('img'), cover);
    await page.getByTestId('scheme-inspector-open-detail').click();
    await decodedImage(activeImage, cover);
    // URL-keyed routing can replace the album after local navigation; capture the viewport,
    // then verify the current image again instead of retaining an element during remount.
    await page.screenshot({ path: info.outputPath('scheme-images-ready.png') });
    await decodedImage(activeImage, cover);

    let unavailable = true;
    await page.route('**/api/v1/design-schemes/assets/*/content', (route) =>
      unavailable ? route.abort('failed') : route.fallback(),
    );
    await page.reload();
    await expect(album.getByRole('button', { name: '重新加载图片' })).toBeVisible();
    // The foreground error surface must cover the decorative cards' failure icons.
    const errorSurfaceAlpha = await album
      .getByRole('button', { name: '重新加载图片' })
      .evaluate((button) => {
        const surface = button.parentElement;
        if (!surface) throw new Error('Missing error surface');
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas unavailable');
        ctx.fillStyle = 'transparent';
        ctx.fillStyle = getComputedStyle(surface).backgroundColor;
        ctx.fillRect(0, 0, 1, 1);
        return ctx.getImageData(0, 0, 1, 1).data[3];
      });
    expect(errorSurfaceAlpha).toBe(255);
    await expect(page.getByRole('button', { name: '全屏查看当前示例' })).toHaveCount(0);
    const beforeRetry = await service.snapshot();
    await album.screenshot({ path: info.outputPath('scheme-images-error.png') });
    unavailable = false;
    await album.getByRole('button', { name: '重新加载图片' }).click();
    await decodedImage(activeImage, cover);
    expect((await service.snapshot()).writes).toBe(beforeRetry.writes);

    const other = await otherContext.newPage();
    await loginExchangeBrowser(other, 'scheme-images-other@example.test');
    const contentPath = `/api/v1/design-schemes/assets/${cover.id}/content`;
    expect(await other.evaluate(async (path) => (await fetch(path)).status, contentPath)).toBe(404);
    await browserJson(page, '/api/auth/sign-out', {});
    expect(await page.evaluate(async (path) => (await fetch(path)).status, contentPath)).toBe(401);
    await page.reload();
    await expect(page.getByTestId('runtime-scheme-detail-error')).toBeVisible();
    await expect(page.getByRole('img', { name: '方案示例', exact: true })).toHaveCount(0);
    await browserJson(page, '/api/auth/sign-in/new-api', { email, password: 'correct-password' });
    await page.reload();
    await decodedImage(activeImage, cover);
    await browserJson(page, '/api/v1/design-schemes/remove', {
      schemeId: formal.summary.id,
      expectedVersion: formal.summary.version,
    });
    expect(await page.evaluate(async (path) => (await fetch(path)).status, contentPath)).toBe(404);
    await page.reload();
    await expect(page.getByTestId('runtime-scheme-detail-error')).toBeVisible();
    await expect(page.getByRole('img', { name: '方案示例', exact: true })).toHaveCount(0);
    await info.attach('scheme-image-evidence', {
      contentType: 'application/json',
      body: JSON.stringify({
        schemeId: formal.summary.id,
        hashes: formal.assets.map((asset) => asset.contentHash),
        decodedAssets: [...seen],
        denied: { other: 404, signedOut: 401, removed: 404 },
        real: 'Better Auth/Hono/PG/AWS SDK and production UI image decode/canvas/hash',
        controlled: 'New API/S3 protocol, trial qualification only; network failure injected once',
      }),
    });
  } finally {
    await otherContext.close();
    await service.dispose();
  }
});
