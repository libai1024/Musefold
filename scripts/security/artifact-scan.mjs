import {
  createReadStream,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readlinkSync,
  readSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, extname, isAbsolute, join, relative, resolve, sep, posix } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import yauzl from 'yauzl';
import { createContentScanner, digest, RULESET_VERSION } from './content-scan.mjs';

// Resolve the Node-only package directly: the desktop build's @electron alias refers to
// app source and must not intercept this separately scoped npm package in repository tests.
const { createPackage, extractFile, listPackage, statFile, uncache } = createRequire(
  import.meta.url,
)('@electron/asar');

export { createPackage }; // Used by the scanner's synthetic archive regression fixture.
const DEFAULT_LIMITS = {
  entryBytes: 768 * 1024 * 1024,
  totalBytes: 8 * 1024 * 1024 * 1024,
  entries: 150000,
  depth: 6,
  headerBytes: 16 * 1024 * 1024,
};
const unsupportedArchives = new Set([
  '.dmg',
  '.7z',
  '.gz',
  '.tgz',
  '.tar',
  '.bz2',
  '.tbz',
  '.tbz2',
  '.xz',
  '.txz',
  '.zst',
  '.rar',
  '.lz4',
  '.lz',
  '.z',
  '.cab',
]);
const extension = (path) => extname(path).toLowerCase();
const unsupportedMagic = [
  '1f8b08', // gzip
  '377abcaf271c', // 7z
  'fd377a585a00', // xz
  '28b52ffd', // zstd frame
  '04224d18', // LZ4 frame
  '526172211a0700',
  '526172211a070100', // RAR 4/5
  '4c5a495001', // lzip v1
  '4d53434600000000', // cabinet
].map((hex) => Buffer.from(hex, 'hex'));

/** Bounded signature probes, not a promise to discover arbitrary binary polyglots. */
function containerKind(name, size, read, limits) {
  if (size > limits.entryBytes) throw new Error('ENTRY_LIMIT');
  const head = read(0, Math.min(size, 512));
  if (
    head.length >= 4 &&
    ['504b0304', '504b0506', '504b0708'].includes(head.subarray(0, 4).toString('hex'))
  )
    return 'zip';
  if (
    unsupportedMagic.some((magic) => head.subarray(0, magic.length).equals(magic)) ||
    (head.length >= 4 &&
      head.toString('ascii', 0, 3) === 'BZh' &&
      head[3] >= 49 &&
      head[3] <= 57) ||
    (head.length >= 3 && head[0] === 0x1f && head[1] === 0x9d && (head[2] & 0x60) === 0) ||
    (head.length >= 4 && (head.readUInt32LE(0) & 0xfffffff0) >>> 0 === 0x184d2a50) ||
    head.subarray(257, 263).equals(Buffer.from('ustar\0')) ||
    head.subarray(257, 265).equals(Buffer.from('ustar  \0')) ||
    (size >= 512 && read(size - 512, 4).equals(Buffer.from('koly')))
  )
    return 'unsupported';

  // ASAR has no unique magic. Require both Pickle envelopes, aligned string length and
  // a parsed root file table; a binary starting with uint32(4) is insufficient evidence.
  if (head.length >= 16 && head.readUInt32LE(0) === 4) {
    const headerSize = head.readUInt32LE(4);
    const jsonSize = head.readUInt32LE(12);
    if (
      headerSize >= 8 &&
      headerSize % 4 === 0 &&
      head.readUInt32LE(8) === headerSize - 4 &&
      jsonSize > 0 &&
      8 + Math.ceil(jsonSize / 4) * 4 === headerSize &&
      size >= headerSize + 8
    ) {
      if (headerSize > limits.headerBytes) throw new Error('ENTRY_LIMIT');
      const json = read(16, jsonSize).toString('utf8');
      let header;
      try {
        header = JSON.parse(json);
      } catch {
        /* Plain binary. */
      }
      if (
        header &&
        typeof header === 'object' &&
        !Array.isArray(header) &&
        header.files &&
        typeof header.files === 'object' &&
        !Array.isArray(header.files)
      )
        return 'asar';
    }
  }
  // Extensions remain conservative fallbacks, including malformed advertised archives.
  if (extension(name) === '.asar') throw new Error('SCAN_READ_FAILED');
  if (['.zip', '.design'].includes(extension(name))) return 'zip';
  return unsupportedArchives.has(extension(name)) ? 'unsupported' : null;
}

function fileContainerKind(path, size, limits) {
  const descriptor = openSync(path, 'r');
  try {
    return containerKind(
      path,
      size,
      (position, length) => {
        const data = Buffer.alloc(length);
        if (readSync(descriptor, data, 0, length, position) !== length)
          throw new Error('ARCHIVE_SIZE_MISMATCH');
        return data;
      },
      limits,
    );
  } finally {
    closeSync(descriptor);
  }
}
function within(root, path) {
  const r = relative(root, path);
  return !isAbsolute(r) && r !== '..' && !r.startsWith(`..${sep}`);
}
function archiveName(raw) {
  const name = raw.replaceAll('\\', '/');
  if (
    !name ||
    name.startsWith('/') ||
    /^[A-Za-z]:/.test(name) ||
    name.split('/').some((p) => p === '..' || p === '.') ||
    [...name].some((char) => char.charCodeAt(0) < 32)
  )
    throw new Error('INVALID_ARCHIVE_PATH');
  return name;
}

/** Read only caller-specified artifacts. Errors never expose parser messages or raw matches. */
export async function scanArtifacts({
  targets,
  canaries = [],
  exceptions = [],
  limits: overrides = {},
  onProgress,
}) {
  if (!Array.isArray(targets) || targets.length === 0) throw new Error('NO_SCAN_TARGETS');
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  for (const n of Object.values(limits))
    if (!Number.isSafeInteger(n) || n <= 0) throw new Error('INVALID_SCAN_LIMIT');
  const ids = new Set();
  const report = {
    ruleset: RULESET_VERSION,
    startedAt: new Date().toISOString(),
    targets: [],
    findings: [],
    errors: [],
    accepted: [],
    ok: false,
  };
  const temp = mkdtempSync(join(tmpdir(), 'musefold-scan-'));
  let entries = 0;
  let bytes = 0;
  let archiveSerial = 0;
  const usedExceptions = new Set();
  try {
    for (const [index, target] of targets.entries()) {
      if (
        !/^[a-z][a-z0-9-]{0,63}$/.test(target.id) ||
        ids.has(target.id) ||
        !['file', 'tree', 'asar', 'zip'].includes(target.kind)
      )
        throw new Error('INVALID_SCAN_TARGET');
      ids.add(target.id);
      const scanner = createContentScanner({
        canaries,
        detectUserPaths: target.detectUserPaths === true,
      });
      const summary = {
        id: target.id,
        kind: target.kind,
        files: 0,
        bytes: 0,
        archives: 0,
        symlinks: 0,
        digest: null,
      };
      report.targets.push(summary);
      const inventory = createHash('sha256');
      const expectedFiles = new Map(
        (target.expectedFiles ?? []).map((entry) => {
          if (typeof entry.entry !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256))
            throw new Error('INVALID_EXPECTED_FILE');
          return [entry.entry, entry.sha256];
        }),
      );
      const checkedFiles = new Set();
      const completeFile = (label, hash) => {
        inventory.update(`${label}\0${hash}\n`);
        if (!expectedFiles.has(label)) return;
        checkedFiles.add(label);
        if (expectedFiles.get(label) !== hash)
          report.errors.push({
            target: target.id,
            code: 'ARTIFACT_IDENTITY_MISMATCH',
            entry: scanner.safeLabel(label),
          });
      };
      const seen = new Set();
      const found = new Set();
      const add = (label, matches) => {
        for (const match of matches) {
          const key = `${label}:${match.rule}:${match.matchHash}`;
          if (found.has(key)) continue;
          found.add(key);
          const finding = {
            target: target.id,
            entry: scanner.safeLabel(label),
            entryHash: digest(label),
            ...match,
          };
          const e = exceptions.findIndex(
            (item) =>
              item.target === target.id &&
              item.entryHash === finding.entryHash &&
              item.rule === finding.rule &&
              item.matchHash === finding.matchHash &&
              typeof item.reason === 'string' &&
              item.reason.trim().length >= 12,
          );
          if (e >= 0) {
            usedExceptions.add(e);
            report.accepted.push({ ...finding, exception: e });
          } else report.findings.push(finding);
        }
      };
      const charge = (n) => {
        bytes += n;
        summary.bytes += n;
        if (bytes > limits.totalBytes) throw new Error('TOTAL_BYTE_LIMIT');
      };
      const startFile = (label, size) => {
        onProgress?.({ target: target.id, entry: scanner.safeLabel(label), stage: 'file' });
        if (++entries > limits.entries || size > limits.entryBytes) throw new Error('ENTRY_LIMIT');
        summary.files++;
        add(label, scanner.scan(Buffer.from(label)));
      };
      const buffer = (data, label) => {
        startFile(label, data.length);
        charge(data.length);
        add(label, scanner.scan(data));
        completeFile(label, digest(data));
      };
      const file = async (path, label) => {
        startFile(label, lstatSync(path).size);
        const hash = createHash('sha256');
        let tail = Buffer.alloc(0);
        let size = 0;
        for await (const chunk of createReadStream(path, { highWaterMark: 1024 * 1024 })) {
          size += chunk.length;
          if (size > limits.entryBytes) throw new Error('ENTRY_LIMIT');
          charge(chunk.length);
          hash.update(chunk);
          const combined = Buffer.concat([tail, chunk]);
          add(label, scanner.scan(combined));
          tail = combined.subarray(Math.max(0, combined.length - scanner.overlapBytes));
        }
        completeFile(label, hash.digest('hex'));
      };
      const asar = async (path, label, depth) => {
        if (depth > limits.depth) throw new Error('ARCHIVE_DEPTH_LIMIT');
        summary.archives++;
        await file(path, label);
        try {
          for (const raw of listPackage(path).sort()) {
            // listPackage uses the host's path separators. Keep that spelling for
            // the ASAR API; only normalize the report label and filesystem path.
            const internalPath = raw.replace(/^[/\\]/, '');
            const name = archiveName(internalPath);
            const stat = statFile(path, internalPath, false);
            if ('files' in stat) continue;
            if ('link' in stat) {
              archiveName(stat.link);
              statFile(path, stat.link, true);
              buffer(Buffer.from(stat.link), `${label}!/${name}`);
              summary.symlinks++;
              continue;
            }
            const unpacked = `${path}.unpacked`;
            if (
              stat.unpacked &&
              (!within(dirname(realpathSync(path)), realpathSync(unpacked)) ||
                !within(realpathSync(unpacked), realpathSync(join(unpacked, name))))
            )
              throw new Error('EXTERNAL_SYMLINK');
            const entry = `${label}!/${name}`;
            if (stat.unpacked) {
              // Use complete on-disk bytes, including data appended by codesigning. Keep
              // nested containers beside their own .unpacked directories and stream plain files.
              const actual = realpathSync(join(unpacked, name));
              if (!lstatSync(actual).isFile()) throw new Error('UNSUPPORTED_FILE_TYPE');
              await visit(actual, entry, depth + 1, realpathSync(unpacked));
              continue;
            }
            const expectedSize = stat.size;
            if (!Number.isSafeInteger(expectedSize) || expectedSize < 0)
              throw new Error('ARCHIVE_SIZE_MISMATCH');
            if (expectedSize > limits.entryBytes) throw new Error('ENTRY_LIMIT');
            if (bytes + expectedSize > limits.totalBytes) throw new Error('TOTAL_BYTE_LIMIT');
            const data = extractFile(path, internalPath, false);
            if (data.length !== expectedSize) throw new Error('ARCHIVE_SIZE_MISMATCH');
            const kind = containerKind(
              name,
              data.length,
              (offset, length) => data.subarray(offset, offset + length),
              limits,
            );
            if (kind === 'unsupported') throw new Error('EXTRACTION_REQUIRED');
            if (kind) {
              const nested = join(temp, `${index}-${archiveSerial++}`, name);
              mkdirSync(dirname(nested), { recursive: true });
              writeFileSync(nested, data);
              await visit(nested, entry, depth + 1, dirname(nested));
            } else buffer(data, entry);
          }
        } finally {
          uncache(path);
        }
      };
      const zip = async (path, label, depth) => {
        if (depth > limits.depth) throw new Error('ARCHIVE_DEPTH_LIMIT');
        summary.archives++;
        await file(path, label);
        const directory = join(temp, `${index}-${archiveSerial++}`);
        mkdirSync(directory);
        const zipfile = await new Promise((yes, no) =>
          yauzl.open(
            path,
            { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
            (e, z) => (e ? no(e) : yes(z)),
          ),
        );
        const names = new Set();
        const links = new Map();
        let unpackBytes = 0;
        try {
          await new Promise((done, fail) => {
            zipfile.once('error', fail);
            zipfile.once('end', done);
            zipfile.on('entry', (entry) => {
              (async () => {
                const name = archiveName(entry.fileName);
                onProgress?.({
                  target: target.id,
                  entry: scanner.safeLabel(`${label}!/${name}`),
                  stage: 'zip-entry',
                });
                if (names.has(name) || names.size >= limits.entries)
                  throw new Error('INVALID_ARCHIVE_PATH');
                names.add(name);
                if (name.endsWith('/')) {
                  if (entry.uncompressedSize !== 0) throw new Error('INVALID_ARCHIVE_PATH');
                  mkdirSync(join(directory, name), { recursive: true });
                  return;
                }
                if ((entry.generalPurposeBitFlag & 1) !== 0) throw new Error('ENCRYPTED_ARCHIVE');
                if (entry.uncompressedSize > limits.entryBytes) throw new Error('ENTRY_LIMIT');
                const stream = await new Promise((yes, no) =>
                  zipfile.openReadStream(entry, (e, s) => (e ? no(e) : yes(s))),
                );
                // yauzl stored entries use fd-slicer streams. Consume their documented
                // data/end events; native async iteration can wait for a close event those
                // legacy streams never emit, leaving an unresolved Promise and an exit 0.
                const chunks = [];
                let length = 0;
                await new Promise((resolveRead, rejectRead) => {
                  let settled = false;
                  const timer = setTimeout(() => finish(new Error('SCAN_TIMEOUT')), 30000);
                  function finish(error) {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    if (error) {
                      stream.destroy();
                      rejectRead(error);
                    } else resolveRead();
                  }
                  stream.once('error', finish);
                  stream.once('end', () => finish());
                  stream.once('close', () => finish(new Error('ARCHIVE_SIZE_MISMATCH')));
                  stream.on('data', (part) => {
                    if (settled) return;
                    length += part.length;
                    unpackBytes += part.length;
                    if (length > limits.entryBytes || unpackBytes + bytes > limits.totalBytes)
                      return finish(new Error('TOTAL_BYTE_LIMIT'));
                    chunks.push(part);
                  });
                });
                if (length !== entry.uncompressedSize) throw new Error('ARCHIVE_SIZE_MISMATCH');
                const data = Buffer.concat(chunks);
                if (((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000) {
                  // A symlink contributes only its path text; its bytes are represented by a
                  // regular entry elsewhere in a valid installer archive. Never follow it.
                  const link = data.toString('utf8');
                  if (
                    data.length > 1024 ||
                    !within(directory, resolve(dirname(join(directory, name)), link)) ||
                    isAbsolute(link)
                  )
                    throw new Error('EXTERNAL_SYMLINK');
                  summary.symlinks++;
                  buffer(data, `${label}!/${name}`);
                  links.set(name, link);
                  return;
                }
                const dest = join(directory, name);
                mkdirSync(dirname(dest), { recursive: true });
                writeFileSync(dest, data, { flag: 'wx' });
              })().then(() => zipfile.readEntry(), fail);
            });
            zipfile.readEntry();
          });
          // Resolve the archive's virtual link graph without creating filesystem symlinks.
          // Every internal alias must end at regular content that is actually scanned below.
          for (const name of links.keys()) {
            let current = name;
            const visited = new Set();
            for (;;) {
              if (visited.has(current)) throw new Error('INVALID_ARCHIVE_PATH');
              visited.add(current);
              const parts = current.split('/');
              const prefix = parts
                .map((_, i) => parts.slice(0, i + 1).join('/'))
                .find((p) => links.has(p));
              if (!prefix) {
                if (!existsSync(join(directory, current))) throw new Error('INVALID_ARCHIVE_PATH');
                break;
              }
              current = posix.normalize(
                posix.join(posix.dirname(prefix), links.get(prefix), current.slice(prefix.length)),
              );
              archiveName(current);
            }
          }
          await visit(directory, `${label}!`, depth + 1, directory);
        } finally {
          zipfile.close();
        }
      };
      const visit = async (path, label, depth, root) => {
        const stat = lstatSync(path);
        if (stat.isSymbolicLink()) {
          summary.symlinks++;
          buffer(Buffer.from(readlinkSync(path)), label);
          const real = realpathSync(path);
          if (!within(root, real)) throw new Error('EXTERNAL_SYMLINK');
          // Real targets are traversed independently; resolving a link cannot escape this input.
          return;
        }
        if (stat.isDirectory()) {
          for (const child of readdirSync(path).sort())
            await visit(
              join(path, child),
              label === '.' ? child : `${label}/${child}`,
              depth,
              root,
            );
        } else if (stat.isFile()) {
          const real = realpathSync(path);
          if (seen.has(real)) {
            // An unpacked ASAR entry is also present in the surrounding tree.
            // Verify a caller's physical expectedFiles path even if the same
            // bytes were already scanned through the archive's virtual path.
            if (expectedFiles.has(label) && !checkedFiles.has(label)) await file(path, label);
            return;
          }
          seen.add(real);
          const kind = fileContainerKind(path, stat.size, limits);
          if (kind === 'asar') await asar(path, label, depth);
          else if (kind === 'zip') await zip(path, label, depth);
          else if (kind === 'unsupported' || (extension(path) === '.exe' && target.kind !== 'tree'))
            throw new Error('EXTRACTION_REQUIRED');
          else await file(path, label);
        } else throw new Error('UNSUPPORTED_FILE_TYPE');
      };
      try {
        const path = resolve(target.path);
        if (!existsSync(path)) throw new Error('MISSING_TARGET');
        const stat = lstatSync(path);
        if (target.kind === 'tree' ? !stat.isDirectory() : !stat.isFile())
          throw new Error('WRONG_TARGET_KIND');
        if (
          ['asar', 'zip'].includes(target.kind) &&
          fileContainerKind(path, stat.size, limits) !== target.kind
        )
          throw new Error('WRONG_TARGET_KIND');
        await visit(
          path,
          '.',
          0,
          stat.isDirectory() ? realpathSync(path) : dirname(realpathSync(path)),
        );
        if (summary.files === 0 && target.allowEmpty !== true) throw new Error('EMPTY_TARGET');
        if (summary.files === 0) summary.declaredEmpty = true;
        for (const label of expectedFiles.keys())
          if (!checkedFiles.has(label))
            report.errors.push({
              target: target.id,
              code: 'MISSING_EXPECTED_FILE',
              entry: scanner.safeLabel(label),
            });
        summary.verifiedFiles = checkedFiles.size;
        summary.digest = inventory.digest('hex');
      } catch (error) {
        const allowed =
          /^(?:MISSING_TARGET|WRONG_TARGET_KIND|INVALID_ARCHIVE_PATH|EXTERNAL_SYMLINK|TOTAL_BYTE_LIMIT|ENTRY_LIMIT|ARCHIVE_DEPTH_LIMIT|ARCHIVE_SIZE_MISMATCH|ENCRYPTED_ARCHIVE|EXTRACTION_REQUIRED|UNSUPPORTED_FILE_TYPE|EMPTY_TARGET|SCAN_TIMEOUT)$/;
        report.errors.push({
          target: target.id,
          code: allowed.test(error.message) ? error.message : 'SCAN_READ_FAILED',
        });
      }
    }
    for (let i = 0; i < exceptions.length; i++)
      if (!usedExceptions.has(i)) report.errors.push({ code: 'UNUSED_EXCEPTION', exception: i });
    report.ok = report.findings.length === 0 && report.errors.length === 0;
    return report;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
