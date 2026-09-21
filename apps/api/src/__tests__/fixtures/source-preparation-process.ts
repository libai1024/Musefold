import { createDatabase } from '@musefold/db';
import { loadEnv } from '../../env.js';
import { S3DesignSchemeAssetStorage } from '../../modules/design-scheme-assets/storage.js';
import { GithubDesignSchemeSourceReader } from '../../modules/design-schemes/github-source-reader.js';
import { DesignSchemeSourcePreparationService } from '../../modules/design-schemes/source-preparation.js';

const database = createDatabase(process.env.DATABASE_URL ?? '');
try {
  const request = JSON.parse(process.argv[2]);
  const reader = new GithubDesignSchemeSourceReader({
    fetchImpl: (input, init) => {
      const url = new URL(String(input));
      const mapped = new URL(process.env.SOURCE_GITHUB_FIXTURE_URL ?? '');
      if (
        mapped.hostname !== '127.0.0.1' ||
        !['api.github.com', 'codeload.github.com'].includes(url.hostname)
      )
        throw new Error('Unexpected fixture endpoint');
      mapped.pathname = `/${url.hostname === 'codeload.github.com' ? 'archive' : 'api'}${url.pathname}`;
      return fetch(mapped, init);
    },
  });
  const service = new DesignSchemeSourcePreparationService(
    database.db,
    new S3DesignSchemeAssetStorage(loadEnv(process.env)),
    reader,
  );
  const prepared = await service.prepare('source-owner', request);
  const result =
    prepared.status === 'confirmed'
      ? await service.readConfirmed('source-owner', request.executionId)
      : null;
  process.stdout.write(
    JSON.stringify({
      pid: process.pid,
      prepared,
      files:
        result?.files.map((f) => ({
          path: f.metadata.relativePath,
          hash: f.metadata.contentHash,
          size: f.bytes.length,
        })) ?? [],
    }),
  );
} finally {
  await database.pool.end();
}
