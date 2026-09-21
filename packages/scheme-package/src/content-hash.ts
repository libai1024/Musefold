import { createHash } from 'node:crypto';
import type { CanonicalDesignSchemePackageManifest } from '@musefold/contracts';
type Content = CanonicalDesignSchemePackageManifest['content'];
type Entry = Pick<Content['entries'][number], 'relativePath' | 'contentHash' | 'sizeBytes'>;
const normalized = (hash: string) => hash.toLowerCase().replace(/^sha256:/, '');
function digest(entries: readonly Entry[], compare: (a: string, b: string) => number): string {
  const hash = createHash('sha256');
  for (const entry of [...entries].sort((a, b) => compare(a.relativePath, b.relativePath))) {
    hash.update(entry.relativePath);
    hash.update('\0');
    hash.update(normalized(entry.contentHash));
    hash.update('\0');
    hash.update(String(entry.sizeBytes));
    hash.update('\n');
  }
  return hash.digest('hex');
}
/** Kept for old format writers/fixtures; new exports explicitly use the portable order. */
export function contentEntriesHash(entries: readonly Entry[]): string {
  return digest(entries, (a, b) => a.localeCompare(b));
}
/** Fix the established v2 collation explicitly; retain its unchanged wire shape and digest algorithm. */
const exportCollator = new Intl.Collator('en-US');
export function stableContentEntriesHash(entries: readonly Entry[]): string {
  return digest(entries, exportCollator.compare);
}
let legacyComparators: Intl.Collator[] | undefined;
function collators(): Intl.Collator[] {
  if (legacyComparators) return legacyComparators;
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  const locales = [...alphabet].flatMap((a) => [...alphabet].map((b) => `${a}${b}`));
  locales.push('fil', 'kok', 'haw', 'gsw', 'yue', 'zh-Hant', 'zh-Hans', 'sr-Latn', 'sr-Cyrl');
  legacyComparators = Intl.Collator.supportedLocalesOf(locales).map(
    (locale) => new Intl.Collator(locale),
  );
  return legacyComparators;
}
export function matchesPackageContentHash(content: Content): boolean {
  const expected = normalized(content.contentHash);
  if (stableContentEntriesHash(content.entries) === expected) return true;
  // Earlier v2 manifests did not record their writer locale. Check exact digests for supported
  // legacy default collations, never waive the aggregate hash or trust caller-provided ordering.
  if (contentEntriesHash(content.entries) === expected) return true;
  return collators().some((collator) => digest(content.entries, collator.compare) === expected);
}
