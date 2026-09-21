import { ApiHttp, createCloudDesignSchemePackageExportClient } from '@musefold/api-client';
import { designSchemePackageExportSchema } from '@musefold/contracts';
import type { DesignSchemePackageExportGateway } from '@musefold/platform';

// Browser file IO stays in the host. No paths or writable handles cross the shared gateway.
interface WritableFile {
  write(bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}
type SavePicker = (options: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<{ createWritable(): Promise<WritableFile> }>;

export function createWebSchemePackageExport(apiBaseUrl: string): DesignSchemePackageExportGateway {
  const transport = createCloudDesignSchemePackageExportClient(
    new ApiHttp({ baseUrl: apiBaseUrl }),
  );
  return {
    recovery: transport.recovery,
    begin: transport.begin,
    get: transport.get,
    cancel: transport.cancel,
    async save(raw, options) {
      const stage = designSchemePackageExportSchema.parse(raw);
      const check = () => {
        options.signal.throwIfAborted();
        options.assertCurrent();
      };
      const requireReady = () => {
        if (stage.status !== 'ready' || Date.parse(stage.expiresAt) <= Date.now())
          throw new Error('方案包尚未就绪或已过期，请关闭后重新导出');
      };
      check();
      requireReady();
      const filename = `Musefold-${stage.exportId}.musefold.design`;
      const picker = (window as Window & { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
      let writable: WritableFile | undefined;
      let closed = false;
      let handle: Awaited<ReturnType<SavePicker>> | undefined;
      if (picker) {
        // Invoke BEFORE awaiting the network, while the Save button's user activation is live.
        try {
          handle = await picker.call(window, {
            suggestedName: filename,
            types: [
              {
                description: 'Musefold 设计方案',
                accept: { 'application/octet-stream': ['.design'] },
              },
            ],
          });
        } catch (error) {
          check();
          if (error instanceof DOMException && error.name === 'AbortError')
            return { exportId: stage.exportId, status: 'cancelled' };
          throw error;
        }
      }
      try {
        check();
        const latest = await transport.get(stage.exportId);
        check();
        for (const key of [
          'exportId',
          'requestId',
          'schemeId',
          'revisionId',
          'formatVersion',
          'packageHash',
          'sizeBytes',
          'expiresAt',
          'status',
        ] as const) {
          if (latest[key] !== stage[key]) throw new Error('方案包已变化，请关闭后重新核对');
        }
        requireReady();
        const bytes = await transport.download(latest, options.signal);
        check();
        requireReady();
        if (handle) {
          writable = await handle.createWritable();
          check();
          await writable.write(new Uint8Array(bytes));
          check();
          await writable.close();
          closed = true;
          check();
          return { exportId: stage.exportId, status: 'delivered' };
        }
        // Only verified, bounded bytes become a Blob. A click is a handoff, never proof of save.
        const url = URL.createObjectURL(
          new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' }),
        );
        const anchor = document.createElement('a');
        try {
          anchor.href = url;
          anchor.download = filename;
          anchor.hidden = true;
          document.body.append(anchor);
          check();
          anchor.click();
        } finally {
          anchor.remove();
          // Keep the Blob alive while the browser consumes the click; unload also releases it.
          window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
        }
        return { exportId: stage.exportId, status: 'download-started' };
      } finally {
        if (writable && !closed) await writable.abort().catch(() => undefined);
      }
    },
  };
}
