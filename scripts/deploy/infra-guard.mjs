#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export const REPO_CADDY = 'infra/v1.1/Caddyfile';
export const REPO_COMPOSE = 'infra/v1.1/remote-compose.yaml';

export function normalizeNewlines(text) {
  return text.replace(/\r\n/g, '\n');
}

export function filesMatch(leftPath, rightPath) {
  if (!existsSync(leftPath) || !existsSync(rightPath)) return false;
  return normalizeNewlines(readFileSync(leftPath, 'utf8')) === normalizeNewlines(readFileSync(rightPath, 'utf8'));
}

export function publishInfraFile(repoFile, liveFile, archiveDir) {
  mkdirSync(archiveDir, { recursive: true });
  if (existsSync(liveFile) && !filesMatch(repoFile, liveFile)) {
    const stamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '');
    copyFileSync(liveFile, join(archiveDir, `${basename(liveFile)}.${stamp}`));
  }
  copyFileSync(repoFile, liveFile);
}

export function parseDotEnv(text) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1);
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function loadDotEnv(path) {
  if (!existsSync(path)) return {};
  return parseDotEnv(readFileSync(path, 'utf8'));
}

export function migrationDatabaseUrl(env) {
  return env.MIGRATION_DATABASE_URL || env.DATABASE_URL || '';
}

export function writeMarker(path, contents) {
  writeFileSync(path, contents);
}
