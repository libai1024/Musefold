import { describe, expect, it } from 'vitest';
import {
  APP_DATA_NAMESPACE,
  BACKUPS_DIR_NAME,
  DB_NAME,
  LOCAL_STORAGE_PREFIX,
  PICTURES_DIR_NAME,
  PREVIEWS_DIR_NAME,
  LOGS_DIR_NAME,
  STORE_NAME,
  AI_CONNECTION_STORE_NAME,
} from '../constants';
import {
  EXPORT_FORMAT,
  EXPORT_IMAGES_DIR,
  EXPORT_JSON_NAME,
} from '../export-format';

describe('v0.3.0 runtime namespace', () => {
  it('keeps the runtime data domain isolated from older namespaces', () => {
    expect(APP_DATA_NAMESPACE).toBe('v0.3.0');
    expect(DB_NAME).toBe('musefold-data-v0.3.0.db');
    expect(STORE_NAME).toBe('musefold-providers-v0.3.0');
    expect(AI_CONNECTION_STORE_NAME).toBe('musefold-ai-connections-v0.3.0');
    expect(LOCAL_STORAGE_PREFIX).toBe('musefold:v0.3.0:');
    expect(PICTURES_DIR_NAME).toBe('Musefold/v0.3.0');
    expect(BACKUPS_DIR_NAME).toBe('musefold-backups-v0.3.0');
    expect(PREVIEWS_DIR_NAME).toBe('musefold-previews-v0.3.0');
    expect(LOGS_DIR_NAME).toBe('musefold-logs-v0.3.0');
  });

  it('keeps the export exchange format stable across runtime namespace changes', () => {
    expect(EXPORT_FORMAT).toBe('musefold-export');
    expect(EXPORT_JSON_NAME).toBe('musefold-export.json');
    expect(EXPORT_IMAGES_DIR).toBe('previews');
  });
});
