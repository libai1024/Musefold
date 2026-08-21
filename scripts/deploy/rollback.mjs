#!/usr/bin/env node
import { join } from 'node:path';
import { createExec, DEFAULTS, parseArgs, rollbackService } from './run.mjs';
import { readDeployState, writeDeployState } from './state.mjs';
import { rollbackRelease } from './web-release.mjs';

async function main(argv) {
  const args = parseArgs(argv);
  const layerArg = argv.includes('--layers') ? String(args.layers) : 'content,service';
  const wanted = {
    content: layerArg.includes('content') || layerArg === 'all',
    service: layerArg.includes('service') || layerArg === 'all',
  };
  const composeDir = args['compose-dir'] || DEFAULTS.composeDir;
  const siteRoot = args['site-root'] || DEFAULTS.siteRoot;
  const liveCompose = args['live-compose'] || DEFAULTS.liveCompose;
  const liveRemoteCompose = args['live-remote-compose'] || DEFAULTS.liveRemoteCompose;
  const statePath = args['state-path'] || join(composeDir, '.deploy-state.json');
  const image = args.image || DEFAULTS.image;
  const envFile = args['env-file'] || join(composeDir, '.env.v11');
  const exec = createExec();
  const state = readDeployState(statePath);
  const result = { web: null, service: null };

  if (wanted.service) {
    const target = state.service.previous;
    if (!target) throw new Error('no previous service image tag in deploy state');
    rollbackService({
      exec,
      composeDir,
      composeFile: liveCompose,
      remoteComposeFile: liveRemoteCompose,
      image,
      sha: target,
      envFile,
    });
    state.service = { current: target, previous: state.service.current };
    result.service = target;
  }

  if (wanted.content) {
    const rolled = rollbackRelease(siteRoot, state.web.previous);
    state.web = { current: rolled.current, previous: rolled.previous };
    result.web = rolled.current;
  }

  writeDeployState(statePath, state);
  process.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  });
}
