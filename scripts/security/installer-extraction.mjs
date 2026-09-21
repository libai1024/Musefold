import { spawnSync } from 'node:child_process';
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const DEFAULT_LIMITS = {
  entries: 150000,
  entryBytes: 768 * 1024 * 1024,
  totalBytes: 8 * 1024 * 1024 * 1024,
  listingBytes: 32 * 1024 * 1024,
};
function limitsWith(overrides) {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  if (Object.values(limits).some((n) => !Number.isSafeInteger(n) || n <= 0))
    throw new Error('INVALID_EXTRACTION_LIMIT');
  return limits;
}
function windowsPath(raw) {
  const path = raw.replaceAll('\\', '/');
  if (
    !path ||
    path.length > 32760 ||
    /[<>:"|?*]/.test(path) ||
    [...path].some(
      (char) => char.charCodeAt(0) < 32 || (char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159),
    )
  )
    throw new Error('INVALID_INSTALLER_PATH');
  const parts = path.split('/');
  if (parts.length > 64) throw new Error('INVALID_INSTALLER_PATH');
  for (const part of parts) {
    if (
      !part ||
      part === '.' ||
      part === '..' ||
      part.length > 255 ||
      /[ .]$/.test(part) ||
      /^(?:CON|PRN|AUX|NUL|CLOCK\$|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])(?:\..*)?$/i.test(part)
    )
      throw new Error('INVALID_INSTALLER_PATH');
  }
  return path.normalize('NFC');
}

/** Parses only the machine listing produced by `7z l -slt -ba -sccUTF-8`. */
export function validateInstallerListing(listing, overrides = {}) {
  const limits = limitsWith(overrides);
  if (typeof listing !== 'string' || Buffer.byteLength(listing) > limits.listingBytes)
    throw new Error('INSTALLER_LIST_LIMIT');
  const text = listing.replaceAll('\r\n', '\n');
  if (!text.trim() || text.includes('\0') || text.includes('\r'))
    throw new Error('INVALID_INSTALLER_LIST');
  const entries = [];
  const nodes = new Map();
  let totalBytes = 0;
  for (const block of text.trimEnd().split(/\n\n+/)) {
    const fields = new Map();
    for (const line of block.split('\n')) {
      const match = /^([A-Za-z][A-Za-z0-9 ()/-]{0,63}) = (.*)$/.exec(line);
      if (!match || fields.has(match[1])) throw new Error('INVALID_INSTALLER_LIST');
      fields.set(match[1], match[2]);
    }
    if (!fields.has('Path') || !/^(?:0|[1-9][0-9]*)$/.test(fields.get('Size') ?? ''))
      throw new Error('INVALID_INSTALLER_LIST');
    if (entries.length >= limits.entries) throw new Error('INSTALLER_ENTRY_LIMIT');
    for (const [key, value] of fields) {
      if (/(?:link|reparse|alternate stream)/i.test(key) && value && value !== '-')
        throw new Error('INSTALLER_LINK_REJECTED');
    }
    if (fields.has('Encrypted') && fields.get('Encrypted') !== '-')
      throw new Error('ENCRYPTED_INSTALLER');
    const attributes = fields.get('Attributes') ?? '';
    const mode = /(?:^|\s)([bcdlps-])[rwxstST-]{9}(?:\s|$)/.exec(attributes)?.[1];
    if ((mode && !['-', 'd'].includes(mode)) || /^[A-Z_]*L[A-Z_]*(?:\s|$)/.test(attributes))
      throw new Error('INSTALLER_LINK_REJECTED');
    const folder = fields.get('Folder');
    if (folder !== undefined && !['+', '-'].includes(folder))
      throw new Error('INVALID_INSTALLER_LIST');
    const attributeDirectory = /^[A-Z_]*D[A-Z_]*(?:\s|$)/.test(attributes) || mode === 'd';
    if (folder === '-' && attributeDirectory) throw new Error('INVALID_INSTALLER_LIST');
    const directory = folder === '+' || attributeDirectory;
    const size = Number(fields.get('Size'));
    if (!Number.isSafeInteger(size) || size > limits.entryBytes)
      throw new Error('INSTALLER_ENTRY_LIMIT');
    if (directory && size !== 0) throw new Error('INVALID_INSTALLER_LIST');
    totalBytes += size;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.totalBytes)
      throw new Error('INSTALLER_TOTAL_LIMIT');
    const path = windowsPath(fields.get('Path'));
    const parts = path.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const name = parts.slice(0, i).join('/');
      const key = name.toUpperCase();
      const explicit = i === parts.length;
      const isDirectory = !explicit || directory;
      const previous = nodes.get(key);
      if (!previous && nodes.size >= limits.entries) throw new Error('INSTALLER_ENTRY_LIMIT');
      if (
        previous &&
        (previous.path !== name ||
          !previous.directory ||
          !isDirectory ||
          (explicit && previous.explicit))
      )
        throw new Error('INVALID_INSTALLER_PATH');
      nodes.set(key, {
        path: name,
        directory: isDirectory,
        explicit: explicit || previous?.explicit === true,
        size: explicit ? size : 0,
      });
    }
    entries.push({ path, directory, size });
  }
  return { entries, nodes, totalBytes };
}

function run(binary, args, maxBuffer) {
  const result = spawnSync(binary, args, {
    stdio: 'pipe',
    input: '',
    timeout: 60000,
    maxBuffer,
    windowsHide: true,
  });
  if (result.error || result.status !== 0 || result.signal || result.stderr?.length)
    throw new Error('INSTALLER_COMMAND_FAILED');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(result.stdout);
  } catch {
    throw new Error('INVALID_INSTALLER_LIST');
  }
}

/** Private snapshot + validated listing precede `x`; extracted content must match the listing. */
export function extractVerifiedInstaller(
  archive,
  destination,
  { binary = '7z', limits: overrides = {}, budget = { entries: 0, bytes: 0 } } = {},
) {
  const limits = limitsWith(overrides);
  const source = lstatSync(archive);
  if (!source.isFile() || source.isSymbolicLink()) throw new Error('INVALID_INSTALLER_SOURCE');
  if (source.size > limits.entryBytes) throw new Error('INSTALLER_ENTRY_LIMIT');
  try {
    lstatSync(destination);
    throw new Error('INSTALLER_DESTINATION_EXISTS');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const temporary = mkdtempSync(join(dirname(resolve(destination)), '.installer-snapshot-'));
  const snapshot = join(temporary, 'archive');
  let created = false;
  try {
    copyFileSync(archive, snapshot);
    if (lstatSync(snapshot).size !== source.size) throw new Error('INSTALLER_CONTENT_CHANGED');
    const listing = run(
      binary,
      ['l', '-slt', '-ba', '-sccUTF-8', '-p-', '--', snapshot],
      limits.listingBytes,
    );
    const plan = validateInstallerListing(listing, limits);
    if (budget.entries + plan.nodes.size > limits.entries) throw new Error('INSTALLER_ENTRY_LIMIT');
    if (budget.bytes + plan.totalBytes > limits.totalBytes)
      throw new Error('INSTALLER_TOTAL_LIMIT');
    budget.entries += plan.nodes.size;
    budget.bytes += plan.totalBytes;
    mkdirSync(destination);
    created = true;
    run(
      binary,
      ['x', '-y', '-bd', '-bb0', '-sccUTF-8', '-p-', `-o${resolve(destination)}`, '--', snapshot],
      limits.listingBytes,
    );
    const found = new Set();
    function verify(directory, prefix = '') {
      for (const name of readdirSync(directory)) {
        const path = windowsPath(prefix ? `${prefix}/${name}` : name);
        const stat = lstatSync(join(directory, name));
        if (stat.isSymbolicLink() || (!stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1)))
          throw new Error('INSTALLER_LINK_REJECTED');
        const expected = plan.nodes.get(path.toUpperCase());
        if (
          !expected ||
          expected.path !== path ||
          expected.directory !== stat.isDirectory() ||
          (stat.isFile() && expected.size !== stat.size)
        )
          throw new Error('INSTALLER_CONTENT_CHANGED');
        found.add(path.toUpperCase());
        if (stat.isDirectory()) verify(join(directory, name), path);
      }
    }
    verify(destination);
    if ([...plan.nodes.keys()].some((key) => !found.has(key)))
      throw new Error('INSTALLER_CONTENT_CHANGED');
    return { entries: plan.nodes.size, bytes: plan.totalBytes };
  } catch (error) {
    if (created) rmSync(destination, { recursive: true, force: true });
    throw error;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
