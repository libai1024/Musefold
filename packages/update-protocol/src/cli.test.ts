import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { runBundleManifestCli, type CliIo } from './cli.ts';
import { generateBundleSigningKeyPair, signManifest } from './sign.ts';

const cliTempDirs: string[] = [];

afterEach(() => {
  for (const dir of cliTempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const shaA = 'ab'.repeat(32);

function validBody(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    channel: 'dev',
    bundleVersion: '1.2.1-dev.412',
    gitSha: '0ce9aac',
    createdAt: '2026-08-20T00:00:00Z',
    minShellVersion: '1.2.1',
    maxShellVersion: null,
    surfaces: {
      'electron-renderer': {
        url: 'https://cdn.example.test/renderer.tar.zst',
        sha256: shaA,
        bytes: 10,
      },
    },
    rollout: { percentage: 100 },
  };
}

function captureIo(env: NodeJS.Dict<string | undefined> = {}, files: Record<string, string> = {}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io: CliIo = {
    stdout: (text) => {
      stdout.push(text);
    },
    stderr: (text) => {
      stderr.push(text);
    },
    env,
    readFile: (path) => {
      const contents = files[path];
      if (contents === undefined) throw new Error('missing fixture');
      return contents;
    },
  };
  return { io, stdout, stderr };
}

describe('bundle-manifest CLI', () => {
  it('keygen prints a public key and a delimited private-key block', () => {
    const { io, stdout, stderr } = captureIo();
    expect(runBundleManifestCli(['keygen'], io)).toBe(0);
    const text = stdout.join('');
    expect(text).toContain('Paste into electron/update/bundle-trust.ts');
    expect(text).toContain('----- BEGIN MUSEFOLD_BUNDLE_SIGNING_KEY (PKCS8 DER, base64) -----');
    expect(text).toContain('Immediately store this value in the GitHub secret');
    expect(text).toContain('Do not write it to disk');
    expect(stderr.join('')).toBe('');
  });

  it('self-test passes without a signing secret', () => {
    const { io, stdout } = captureIo();
    expect(runBundleManifestCli(['--self-test'], io)).toBe(0);
    expect(stdout.join('')).toBe('self-test: passed\n');
  });

  it('sign then verify, and does not leak the private key on errors', () => {
    const { publicKey, privateKey } = generateBundleSigningKeyPair();
    const secret = privateKey;
    const files = { 'manifest.json': JSON.stringify(validBody()) };

    const sign = captureIo({ MUSEFOLD_BUNDLE_SIGNING_KEY: secret }, files);
    expect(runBundleManifestCli(['sign', 'manifest.json'], sign.io)).toBe(0);
    const signedText = sign.stdout.join('');
    expect(JSON.parse(signedText).signature).toEqual(expect.any(String));

    const verifyOk = captureIo({}, { 'signed.json': signedText });
    expect(
      runBundleManifestCli(['verify', 'signed.json', '--public-key', publicKey], verifyOk.io),
    ).toBe(0);
    expect(verifyOk.stdout.join('')).toBe('valid\n');

    const tampered = JSON.parse(signedText) as Record<string, unknown>;
    tampered.bundleVersion = '9.9.9';
    const verifyBad = captureIo({}, { 'signed.json': JSON.stringify(tampered) });
    expect(
      runBundleManifestCli(['verify', 'signed.json', '--public-key', publicKey], verifyBad.io),
    ).toBe(1);
    expect(verifyBad.stdout.join('')).toBe('invalid\n');

    const missing = captureIo({ MUSEFOLD_BUNDLE_SIGNING_KEY: secret }, {});
    expect(runBundleManifestCli(['sign', 'manifest.json'], missing.io)).toBe(1);
    const err = missing.stderr.join('');
    expect(err).toContain('failed to read manifest file');
    expect(err).not.toContain(secret);
    expect(err).not.toContain(String(secret.length));
    expect(err).not.toContain(secret.slice(0, 8));
  });

  it('refuses an invalid signing key without echoing it', () => {
    const bogus = 'not-a-real-private-key-prefix-AAAA';
    const { io, stderr } = captureIo(
      { MUSEFOLD_BUNDLE_SIGNING_KEY: bogus },
      { 'manifest.json': JSON.stringify(validBody()) },
    );
    expect(runBundleManifestCli(['sign', 'manifest.json'], io)).toBe(1);
    const err = stderr.join('');
    expect(err).toContain('signing key is invalid');
    expect(err).not.toContain(bogus);
    expect(err).not.toContain(String(bogus.length));
    expect(err).not.toContain('not-a-real');
  });

  it('pack writes an archive and prints bytes plus sha256', () => {
    const root = mkdtempSync(join(tmpdir(), 'musefold-bundle-cli-pack-'));
    cliTempDirs.push(root);
    const dir = join(root, 'bundle');
    mkdirSync(dir);
    writeFileSync(join(dir, 'index.html'), '<html>pack</html>');
    const out = join(root, 'bundle.tar.gz');

    const { io, stdout, stderr } = captureIo();
    expect(runBundleManifestCli(['pack', '--dir', dir, '--out', out], io)).toBe(0);
    expect(stderr.join('')).toBe('');
    const parsed = JSON.parse(stdout.join('')) as { bytes: number; sha256: string };
    const file = readFileSync(out);
    expect(parsed.bytes).toBe(file.length);
    expect(parsed.sha256).toBe(createHash('sha256').update(file).digest('hex'));
    expect(parsed.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('pack reports an error for a missing directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'musefold-bundle-cli-pack-missing-'));
    cliTempDirs.push(root);
    const { io, stderr } = captureIo();
    expect(
      runBundleManifestCli(
        ['pack', '--dir', join(root, 'no-such-bundle'), '--out', join(root, 'out.tar.gz')],
        io,
      ),
    ).toBe(1);
    expect(stderr.join('')).toContain('failed to read bundle directory');
  });

  it('does not accept a private key via argv', () => {
    const { privateKey } = generateBundleSigningKeyPair();
    const signed = signManifest(validBody(), privateKey);
    const { io, stderr } = captureIo({}, { 'signed.json': JSON.stringify(signed) });
    expect(runBundleManifestCli(['verify', 'signed.json', '--private-key', privateKey], io)).toBe(
      1,
    );
    expect(stderr.join('')).not.toContain(privateKey);
  });
});
