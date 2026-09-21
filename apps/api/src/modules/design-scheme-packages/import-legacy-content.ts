import {
  prepareLegacyDesignSchemeImportContent,
  type ValidatedDesignSchemePackage,
} from '@musefold/scheme-package';
import { inspectImportImage } from './import-content-common.js';

/** Host image decoder; package identity/content mapping is shared with Desktop. */
export function prepareLegacyImportContent(
  parsed: Extract<ValidatedDesignSchemePackage, { formatVersion: 1 }>,
  id: (kind: string, original: string) => string,
) {
  return prepareLegacyDesignSchemeImportContent(parsed, id, inspectImportImage);
}
