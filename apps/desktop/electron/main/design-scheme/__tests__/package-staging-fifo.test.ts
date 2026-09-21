import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

// Compile the real staging module with Vite's own compiler dependency. The child owns
// the fault injection so a regression cannot block the test runner on FIFO open.
it.skipIf(process.platform === 'win32')(
  'rejects a picked file replaced by a real FIFO before open',
  () => {
    const root = mkdtempSync(join(tmpdir(), 'musefold-staging-fifo-'));
    try {
      const source = join(root, 'child.js');
      const bundle = join(root, 'child.cjs');
      writeFileSync(
        source,
        `
      import fs from 'node:fs';
      import { spawnSync } from 'node:child_process';
      import { join } from 'node:path';
      import { DesignSchemePackageStaging } from ${JSON.stringify(resolve('apps/desktop/electron/main/design-scheme/package-staging.ts'))};
      import { loadManagedFilesystem } from ${JSON.stringify(resolve('packages/managed-fs/src/index.ts'))};
      const root = process.argv[2];
      const selected = join(root, 'selected.musefold.design');
      fs.writeFileSync(selected, 'owned source');
      const actualOpen = fs.openSync;
      let substituted = false;
      fs.openSync = (path, flags, ...rest) => {
        if (String(path) === selected && !substituted) {
          const child = spawnSync(process.execPath, ['-e',
            "const fs=require('node:fs'),cp=require('node:child_process');fs.renameSync(process.argv[1],process.argv[1]+'.original');cp.execFileSync('mkfifo',[process.argv[1]]);",
            selected], { encoding: 'utf8', timeout: 3000 });
          if (child.status !== 0) throw new Error('Owned FIFO substitution failed');
          substituted = true;
          fs.writeSync(1, 'SUBSTITUTED\\n');
        }
        return actualOpen(path, flags, ...rest);
      };
      const staging = new DesignSchemePackageStaging({
        rootDir: join(root, 'staging'),
        filesystem: loadManagedFilesystem(process.argv[3]),
        inspectPackage: async () => ({ formatVersion: 2 }),
      });
      staging.stagePickedPackage(11, selected, { acceptedFormatVersions: [2] })
        .then(() => { process.exitCode = 1; }, () => { fs.writeSync(1, 'REJECTED_WITHOUT_BLOCKING\\n'); })
        .finally(() => { staging.cleanupAll(); fs.openSync = actualOpen; });
    `,
      );
      const require = createRequire(import.meta.url);
      const compiler = createRequire(require.resolve('vite/package.json')).resolve('esbuild');
      const compiled = spawnSync(
        process.execPath,
        [
          '-e',
          "require(process.argv[1]).buildSync({entryPoints:[process.argv[2]],outfile:process.argv[3],bundle:true,platform:'node',format:'cjs',logLevel:'silent'})",
          compiler,
          source,
          bundle,
        ],
        { encoding: 'utf8', timeout: 10_000 },
      );
      expect(compiled.status, compiled.stderr).toBe(0);
      const child = spawnSync(
        process.execPath,
        [bundle, root, resolve('packages/managed-fs/build/Release/managed_fs.node')],
        {
          encoding: 'utf8',
          timeout: 5_000,
          killSignal: 'SIGKILL',
        },
      );
      expect(child.error).toBeUndefined();
      expect(child.status, child.stderr).toBe(0);
      expect(child.stdout).toBe('SUBSTITUTED\nREJECTED_WITHOUT_BLOCKING\n');
      expect(readFileSync(join(root, 'selected.musefold.design.original'), 'utf8')).toBe(
        'owned source',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  20_000,
);
