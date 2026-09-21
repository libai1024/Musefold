import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import {
  stableContentEntriesHash,
  writeDesignSchemePackageBytes,
  isSafePackagePath,
} from '../index.js';
import { mixedPackage } from './fixtures.js';

const locales = ['en_US.UTF-8', 'zh_CN.UTF-8', 'sv_SE.UTF-8', 'tr_TR.UTF-8'];
const script = `
import { createInterface } from 'node:readline';
import { readValidatedDesignSchemePackageBytes, writeDesignSchemePackageBytes, contentEntriesHash, stableContentEntriesHash } from '@musefold/scheme-package';
const lines=createInterface({input:process.stdin}); let round=0;
for await (const line of lines) {
  const input=JSON.parse(line);
  if (round++===0) {
    const parsed=await readValidatedDesignSchemePackageBytes(Buffer.from(input,'base64')); const manifest=parsed.manifest;
    const stable=stableContentEntriesHash(manifest.content.entries);
    manifest.content.contentHash=contentEntriesHash(manifest.content.entries); parsed.entries.delete('manifest.json');
    const bytes=await writeDesignSchemePackageBytes(manifest,parsed.entries);
    process.stdout.write(JSON.stringify({locale:Intl.DateTimeFormat().resolvedOptions().locale,stable,legacy:manifest.content.contentHash,bytes:bytes.toString('base64')})+'\\n');
  } else {
    const results=[]; for (const archive of input) results.push((await readValidatedDesignSchemePackageBytes(Buffer.from(archive,'base64'))).formatVersion);
    process.stdout.write(JSON.stringify(results)+'\\n'); break;
  }
}
lines.close(); process.stdin.destroy();`;
function child(locale: string) {
  const process = spawn(
    globalThis.process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', script],
    {
      cwd: resolve(import.meta.dirname, '../../../../apps/api'),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...globalThis.process.env, LANG: locale, LC_ALL: locale },
    },
  );
  let stderr = '';
  process.stderr.on('data', (bytes) => {
    stderr += bytes.toString();
  });
  const lines = createInterface({ input: process.stdout });
  const reader = lines[Symbol.asyncIterator]();
  const closed = new Promise<number | null>((resolveExit, reject) => {
    process.once('error', reject);
    process.once('close', resolveExit);
  });
  void closed.catch(() => {});
  return { process, lines, reader, closed, stderr: () => stderr };
}
async function exchange(state: ReturnType<typeof child>, value: unknown) {
  state.process.stdin.write(`${JSON.stringify(value)}\n`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const line = await Promise.race([
      state.reader.next(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Locale subprocess response timed out')), 10_000);
      }),
    ]);
    if (line.done) throw new Error(`Locale subprocess ended: ${state.stderr()}`);
    return JSON.parse(line.value);
  } finally {
    clearTimeout(timer);
  }
}
it('stable v2 bytes and legacy hashes work across fresh Node processes with four different default locales', async () => {
  const { manifest, content } = mixedPackage();
  const snapshot = manifest.sourceSnapshots[1];
  const file = snapshot.files.find((file) => file.kind === 'text');
  if (!file) throw new Error('Missing text');
  const oldPath = `sources/${snapshot.id}/${file.relativePath}`;
  const bytes = content.get(oldPath);
  const entry = manifest.content.entries.find((item) => item.relativePath === oldPath);
  if (!bytes || !entry) throw new Error('Missing bytes');
  file.relativePath = 'ä.txt';
  if (snapshot.historyItems?.[0]) snapshot.historyItems[0].promptPath = file.relativePath;
  entry.relativePath = `sources/${snapshot.id}/ä.txt`;
  content.delete(oldPath);
  content.set(entry.relativePath, bytes);
  snapshot.files.push({ ...file, relativePath: 'z.txt' });
  snapshot.totalBytes += bytes.length;
  const added = { ...entry, relativePath: `sources/${snapshot.id}/z.txt` };
  manifest.content.entries.push(added);
  manifest.content.sizeBytes += bytes.length;
  content.set(added.relativePath, bytes);
  manifest.content.contentHash = stableContentEntriesHash(manifest.content.entries);
  const portable = await writeDesignSchemePackageBytes(manifest, content);
  const children = locales.map(child);
  try {
    const produced = await Promise.all(
      children.map((state) => exchange(state, portable.toString('base64'))),
    );
    expect(new Set(produced.map((item) => item.locale)).size).toBe(4);
    expect(new Set(produced.map((item) => item.stable))).toEqual(
      new Set([manifest.content.contentHash]),
    );
    expect(new Set(produced.map((item) => item.legacy)).size).toBeGreaterThan(1);
    const archiveList = [portable.toString('base64'), ...produced.map((item) => item.bytes)];
    const results = await Promise.all(children.map((state) => exchange(state, archiveList)));
    for (const result of results) expect(result).toEqual([2, 2, 2, 2, 2]);
    for (const state of children) {
      state.process.stdin.end();
      expect(await state.closed).toBe(0);
      expect(state.stderr()).toBe('');
    }
  } finally {
    for (const state of children) {
      state.lines.close();
      state.process.kill('SIGKILL');
    }
    await Promise.allSettled(children.map((state) => state.closed));
  }
  const altered = structuredClone(manifest);
  altered.content.contentHash = 'f'.repeat(64);
  await expect(writeDesignSchemePackageBytes(altered, content)).rejects.toThrow('内容索引');
}, 30_000);
it('stable ordering handles non-BMP paths and rejects malformed Unicode package paths', () => {
  const entries = ['😀', '\uffff', 'a'].map((relativePath) => ({
    relativePath,
    contentHash: 'a'.repeat(64),
    sizeBytes: 1,
  }));
  expect(stableContentEntriesHash(entries)).toBe(stableContentEntriesHash([...entries].reverse()));
  expect(isSafePackagePath('sources/\ud800.txt')).toBe(false);
});
