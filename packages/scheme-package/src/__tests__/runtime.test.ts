import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { writeDesignSchemePackageBytes } from '../index.js';
import { mixedPackage } from './fixtures.js';

it('loads the exported codec in a fresh API Node process with no desktop dependency', async () => {
  const { manifest, content } = mixedPackage();
  const bytes = await writeDesignSchemePackageBytes(manifest, content);
  const script = `
    import { readValidatedDesignSchemePackageBytes, writeDesignSchemePackageBytes, sha256 } from '@musefold/scheme-package';
    const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk);
    const bytes = Buffer.concat(chunks); const parsed = await readValidatedDesignSchemePackageBytes(bytes, [2]);
    const entries = new Map(parsed.entries); entries.delete('manifest.json');
    const output = await writeDesignSchemePackageBytes(parsed.manifest, entries);
    process.stdout.write(JSON.stringify({ pid: process.pid, manifest: parsed.manifest, hash: sha256(output), inputHash: sha256(bytes) }));
  `;
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
    cwd: resolve(import.meta.dirname, '../../../../apps/api'),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const result = await new Promise<{ code: number | null; text: string; error: string }>(
    (resolveResult, reject) => {
      let output = '';
      let error = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('API codec subprocess timed out'));
      }, 10_000);
      child.stdout.on('data', (data) => {
        output += data.toString();
      });
      child.stderr.on('data', (data) => {
        error += data.toString();
      });
      child.on('error', (failure) => {
        clearTimeout(timer);
        reject(failure);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolveResult({ code, text: output, error });
      });
      child.stdin.end(bytes);
    },
  );
  expect(result.error).toBe('');
  expect(result.code).toBe(0);
  const parsed = JSON.parse(result.text);
  expect(parsed.pid).not.toBe(process.pid);
  expect(parsed.manifest).toEqual(manifest);
  expect(parsed.hash).toBe(parsed.inputHash);
});
