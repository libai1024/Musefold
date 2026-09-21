import { createHash } from 'node:crypto';

/** Minimal list protocol for existing owned HTTP doubles when bin's inventory cron runs. */
export function ownedInventoryPage(url: URL, keys: Iterable<string>): string {
  const escapeXml = (value: string) =>
    value.replace(
      /[&<>"']/g,
      (char) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char] ?? char,
    );
  const prefix = url.searchParams.get('prefix') ?? '';
  const marker = url.searchParams.get('continuation-token') ?? '';
  const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get('max-keys')) || 1000));
  const all = [...keys].filter((key) => key.startsWith(prefix) && key > marker).sort();
  const page = all.slice(0, limit);
  const more = all.length > limit;
  return `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><IsTruncated>${more}</IsTruncated><KeyCount>${page.length}</KeyCount>${more ? `<NextContinuationToken>${escapeXml(page.at(-1) ?? '')}</NextContinuationToken>` : ''}${page.map((key) => `<Contents><Key>${escapeXml(key)}</Key><LastModified>2000-01-01T00:00:00.000Z</LastModified><ETag>"${createHash('sha256').update(key).digest('hex')}"</ETag><Size>0</Size></Contents>`).join('')}</ListBucketResult>`;
}
