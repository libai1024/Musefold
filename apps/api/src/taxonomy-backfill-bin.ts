import { createDatabase } from '@musefold/db';
import { backfillLegacyTaxonomy } from './modules/prompts/taxonomy-backfill.js';

// Deliberately require an explicit database URL; no production/local fallback.
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const limitArgument = args.find((arg) => arg.startsWith('--limit='));
if (args.some((arg) => arg !== '--apply' && arg !== limitArgument)) {
  console.error('Usage: taxonomy:backfill [--apply] [--limit=1..100]');
  process.exitCode = 1;
} else if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exitCode = 1;
} else {
  const { db, pool } = createDatabase(process.env.DATABASE_URL, { max: 2 });
  try {
    console.log(
      JSON.stringify(
        await backfillLegacyTaxonomy(db, {
          apply,
          limit: limitArgument === undefined ? 50 : Number(limitArgument.slice('--limit='.length)),
        }),
      ),
    );
  } catch {
    // Database failures can include connection strings, SQL and user content.
    console.error(
      'Taxonomy backfill failed; the current entity was rolled back. Inspect the migration preconditions before retrying.',
    );
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
