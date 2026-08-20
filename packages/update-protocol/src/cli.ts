#!/usr/bin/env node
/**
 * Content-bundle manifest CLI. Run with Node type stripping:
 *   node packages/update-protocol/src/cli.ts <command>
 *
 * The private key is read only from MUSEFOLD_BUNDLE_SIGNING_KEY (base64 PKCS8 DER).
 * Command-line flags and file paths for the private key are not supported.
 * Error output never includes key material, length, or prefix.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BundleArchiveError, packBundleArchiveToFile, runArchiveSelfTest } from './archive.ts';
import {
  BundleSigningError,
  generateBundleSigningKeyPair,
  loadPrivateKeyFromEnv,
  runSignatureSelfTest,
  signManifest,
  verifyManifestSignature,
} from './sign.ts';

export type CliIo = {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: NodeJS.Dict<string | undefined>;
  readFile: (path: string) => string;
};

const defaultIo: CliIo = {
  stdout: (text) => {
    process.stdout.write(text);
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
  env: process.env,
  readFile: (path) => readFileSync(path, 'utf8'),
};

export function runBundleManifestCli(argv: string[], io: CliIo = defaultIo): number {
  if (argv.includes('--self-test')) {
    return runSelfTestCommand(io);
  }

  const command = argv[0];
  if (command === undefined || command === '-h' || command === '--help' || command === 'help') {
    io.stdout(`${usage()}\n`);
    return command === undefined ? 1 : 0;
  }

  try {
    if (command === 'keygen') return runKeygen(io);
    if (command === 'sign') return runSign(argv.slice(1), io);
    if (command === 'verify') return runVerify(argv.slice(1), io);
    if (command === 'pack') return runPack(argv.slice(1), io);
  } catch (error) {
    if (error instanceof BundleSigningError || error instanceof BundleArchiveError) {
      io.stderr(`${error.message}\n`);
      return 1;
    }
    io.stderr('bundle-manifest: unexpected error\n');
    return 1;
  }

  io.stderr(`unknown command\n${usage()}\n`);
  return 1;
}

function runSelfTestCommand(io: CliIo): number {
  try {
    if (runSignatureSelfTest() && runArchiveSelfTest()) {
      io.stdout('self-test: passed\n');
      return 0;
    }
  } catch {
    // 自检失败只报告结果，不把内部异常细节写到 stdout/stderr。
  }
  io.stderr('self-test: failed\n');
  return 1;
}

function runKeygen(io: CliIo): number {
  const { publicKey, privateKey } = generateBundleSigningKeyPair();
  io.stdout(`# Musefold content-bundle Ed25519 public key (SPKI DER, base64)\n`);
  io.stdout(`# Paste into electron/update/bundle-trust.ts (primary or backup slot).\n`);
  io.stdout(`${publicKey}\n`);
  io.stdout('\n');
  io.stdout('----- BEGIN MUSEFOLD_BUNDLE_SIGNING_KEY (PKCS8 DER, base64) -----\n');
  io.stdout('Immediately store this value in the GitHub secret MUSEFOLD_BUNDLE_SIGNING_KEY.\n');
  io.stdout('Do not write it to disk. This block is the only time the private key is printed.\n');
  io.stdout(`${privateKey}\n`);
  io.stdout('----- END MUSEFOLD_BUNDLE_SIGNING_KEY -----\n');
  return 0;
}

function runSign(args: string[], io: CliIo): number {
  const file = args[0];
  if (!file || file.startsWith('-')) {
    io.stderr('usage: bundle-manifest sign <manifest.json>\n');
    return 1;
  }
  const privateKey = loadPrivateKeyFromEnv(io.env);
  const raw = readManifestText(file, io);
  const parsed: unknown = parseManifestJson(raw, io);
  if (parsed === undefined) return 1;
  const signed = signManifest(parsed, privateKey);
  io.stdout(`${JSON.stringify(signed, null, 2)}\n`);
  return 0;
}

function runVerify(args: string[], io: CliIo): number {
  const { file, publicKeys } = parseVerifyArgs(args);
  if (!file) {
    io.stderr('usage: bundle-manifest verify <manifest.json> --public-key <base64>\n');
    return 1;
  }
  if (publicKeys.length === 0) {
    io.stderr('verify requires --public-key <base64>\n');
    return 1;
  }
  const raw = readManifestText(file, io);
  const parsed: unknown = parseManifestJson(raw, io);
  if (parsed === undefined) return 1;
  const ok = verifyManifestSignature(parsed, publicKeys);
  if (ok) {
    io.stdout('valid\n');
    return 0;
  }
  io.stdout('invalid\n');
  return 1;
}

function runPack(args: string[], io: CliIo): number {
  const parsed = parsePackArgs(args);
  if (!parsed) {
    io.stderr('usage: bundle-manifest pack --dir <directory> --out <archive>\n');
    return 1;
  }
  const packed = packBundleArchiveToFile(parsed.dir, parsed.out);
  io.stdout(`${JSON.stringify({ bytes: packed.bytes, sha256: packed.sha256 })}\n`);
  return 0;
}

function parsePackArgs(args: string[]): { dir: string; out: string } | undefined {
  let dir: string | undefined;
  let out: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--dir' || arg === '--out') {
      const value = args[index + 1];
      if (!value || value.startsWith('-')) return undefined;
      if (arg === '--dir') dir = value;
      else out = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--dir=')) {
      dir = arg.slice('--dir='.length);
      continue;
    }
    if (arg.startsWith('--out=')) {
      out = arg.slice('--out='.length);
      continue;
    }
    return undefined;
  }
  if (!dir || !out) return undefined;
  return { dir, out };
}

function parseVerifyArgs(args: string[]): { file: string | undefined; publicKeys: string[] } {
  const publicKeys: string[] = [];
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--public-key') {
      const value = args[index + 1];
      if (!value || value.startsWith('-')) {
        return { file: undefined, publicKeys: [] };
      }
      publicKeys.push(value);
      index += 1;
      continue;
    }
    if (arg.startsWith('--public-key=')) {
      publicKeys.push(arg.slice('--public-key='.length));
      continue;
    }
    positionals.push(arg);
  }
  return { file: positionals[0], publicKeys };
}

function readManifestText(file: string, io: CliIo): string {
  try {
    return io.readFile(file);
  } catch {
    throw new BundleSigningError('failed to read manifest file');
  }
}

function parseManifestJson(raw: string, io: CliIo): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    io.stderr('manifest is not valid JSON\n');
    return undefined;
  }
}

function usage(): string {
  return [
    'Usage:',
    '  bundle-manifest keygen',
    '  bundle-manifest sign <manifest.json>',
    '  bundle-manifest verify <manifest.json> --public-key <base64>',
    '  bundle-manifest pack --dir <directory> --out <archive>',
    '  bundle-manifest --self-test',
  ].join('\n');
}

const invokedAsScript = resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  try {
    process.exitCode = runBundleManifestCli(process.argv.slice(2));
  } catch {
    process.stderr.write('bundle-manifest: unexpected error\n');
    process.exitCode = 1;
  }
}
