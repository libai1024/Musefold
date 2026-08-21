#!/usr/bin/env node
/**
 * Expand/contract gate (V121-SVC-03): a migration `up()` must not both
 * write rows and DROP COLUMN. That combination cannot be rolled forward
 * safely against an old API still serving traffic.
 *
 * Only `exports.up` is inspected; `down()` rollbacks are allowed to drop.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const WRITE_RE = /\b(?:INSERT|UPDATE|DELETE)\b/i;
const DROP_COLUMN_RE = /\bDROP\s+COLUMN\b/i;

export function extractUpSource(source) {
  const up = source.search(/exports\.up\s*=/);
  if (up < 0) return source;
  const down = source.search(/exports\.down\s*=/);
  return source.slice(up, down < 0 ? undefined : down);
}

export function lintMigrationSource(source, file = 'migration') {
  const up = extractUpSource(source);
  const writes = WRITE_RE.test(up);
  const drops = DROP_COLUMN_RE.test(up);
  if (writes && drops) {
    return {
      ok: false,
      file,
      reason: `${file}: up() both writes rows and DROP COLUMN (expand/contract violation)`,
    };
  }
  return { ok: true, file };
}

export function lintMigrationFiles(files) {
  const failures = [];
  for (const file of files) {
    const result = lintMigrationSource(readFileSync(file, 'utf8'), file);
    if (!result.ok) failures.push(result);
  }
  return failures;
}

export function listMigrationFiles(dir) {
  return readdirSync(dir)
    .filter((name) => /^\d+.*\.(cjs|js|sql)$/.test(name))
    .map((name) => join(dir, name))
    .sort();
}

function main(argv) {
  const all = argv.includes('--all');
  const args = argv.filter((arg) => arg !== '--all');
  const dir = args[0];
  if (!dir) {
    process.stderr.write('usage: node scripts/deploy/expand-contract.mjs <migrations-dir> [--all | files...]\n');
    process.exit(2);
  }
  const files = args.length > 1 ? args.slice(1) : all ? listMigrationFiles(dir) : [];
  if (files.length === 0) {
    process.stdout.write('expand-contract: no migration files in this change\n');
    return;
  }
  const failures = lintMigrationFiles(files);
  if (failures.length > 0) {
    for (const failure of failures) process.stderr.write(`${failure.reason}\n`);
    process.exit(1);
  }
  process.stdout.write(`expand-contract: ${files.length} file(s) ok\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2));
}
