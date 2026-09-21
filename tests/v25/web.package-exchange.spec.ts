import { writeFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { PackageExchangeProcess } from './package-exchange-process';
import {
  connectExchangeBrowser,
  loginExchangeBrowser,
  importExchangeBrowser,
  qualifyExchangeBrowser,
  exportExchangeBrowser,
  browserJson,
} from './package-exchange-browser';
import { packageMeaning } from './package-exchange-meaning';

test('actual Better Auth Web→Web package exchange creates an isolated new draft with complete content', async ({
  page,
  context,
  browser,
}, info) => {
  test.skip(
    process.env.RUN_DATABASE_TESTS !== 'true',
    'Requires disposable PG and controlled upstream/S3; actual Better Auth login',
  );
  test.setTimeout(180000);
  const service = new PackageExchangeProcess();
  const recipientContext = await browser.newContext({
    baseURL: 'http://127.0.0.1:3399',
    viewport: page.viewportSize(),
    isMobile: info.project.use.isMobile,
    hasTouch: info.project.use.hasTouch,
    deviceScaleFactor: info.project.use.deviceScaleFactor,
    userAgent: info.project.use.userAgent,
  });
  try {
    const backend = await service.ready;
    await connectExchangeBrowser(context, backend.baseUrl);
    await connectExchangeBrowser(recipientContext, backend.baseUrl);
    const recipient = await recipientContext.newPage();
    const senderAccount = await loginExchangeBrowser(page, 'web-sender@example.test');
    const recipientAccount = await loginExchangeBrowser(recipient, 'web-recipient@example.test');
    expect(senderAccount.id).not.toBe(recipientAccount.id);
    const input = info.outputPath('original.musefold.design');
    const output = info.outputPath('web-export.musefold.design');
    await writeFile(input, Buffer.from(backend.bytes, 'base64'));
    const imported = await importExchangeBrowser(page, input);
    expect(new Set(imported.assets.map((asset) => asset.contentHash)).size).toBe(3);
    expect(imported.document.name).toBe('跨端 Café 山水 ✨');
    await qualifyExchangeBrowser(page, service, imported.summary.id);
    const exported = await exportExchangeBrowser(page, output);
    const received = await importExchangeBrowser(recipient, output);
    expect(packageMeaning(received)).toEqual(packageMeaning(exported.archive.manifest));
    expect(received.summary.id).not.toBe(imported.summary.id);
    expect(received.document.revisionId).not.toBe(imported.document.revisionId);
    expect(received.document.assetIds.some((id) => imported.document.assetIds.includes(id))).toBe(
      false,
    );
    const denied = await recipient.evaluate(
      async (id) => (await fetch(`/api/v1/design-schemes/${id}`)).status,
      imported.summary.id,
    );
    expect(denied).toBe(404);
    const history = await browserJson(recipient, '/api/v1/design-schemes/package-exports');
    expect(history.items).toEqual([]);
    const senderHistory = await browserJson(page, '/api/v1/design-schemes/package-exports');
    expect(senderHistory.items).toHaveLength(1);
    const exportId = senderHistory.items[0].export.exportId;
    const beforeDenied = await service.snapshot();
    const exportDenials = await recipient.evaluate(async (id) => {
      const root = `/api/v1/design-schemes/package-exports/${id}`;
      const results = [];
      for (const suffix of ['', '/recovery', '/content'])
        results.push((await fetch(root + suffix)).status);
      results.push((await fetch(root, { method: 'DELETE' })).status);
      return results;
    }, exportId);
    expect(exportDenials).toEqual([404, 404, 404, 404]);
    const afterDenied = await service.snapshot();
    expect(afterDenied.exports).toEqual(beforeDenied.exports);
    expect(afterDenied.writes).toBe(beforeDenied.writes);
    await recipient
      .getByTestId('runtime-scheme-detail')
      .screenshot({ path: info.outputPath('received-draft.png') });
    await info.attach('package-exchange-evidence', {
      contentType: 'application/json',
      body: JSON.stringify({
        direction: 'Web→Web',
        sender: senderAccount.id,
        recipient: recipientAccount.id,
        originalScheme: imported.summary.id,
        newScheme: received.summary.id,
        file: { bytes: exported.bytes, hash: exported.hash },
        meaning: packageMeaning(received),
        state: await service.snapshot(),
        real: 'actual Better Auth cookies/account hooks/production app/Hono/PG/AWS SDK/UI/file download and import',
        controlled:
          'New API/S3 upstream; SQL successful trial only, actual authenticated cover/formalize',
      }),
    });
  } finally {
    await recipientContext.close();
    await service.dispose();
  }
});
