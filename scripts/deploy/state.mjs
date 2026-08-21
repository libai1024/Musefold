import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const DEFAULT_STATE_PATH = '/opt/musefold/.deploy-state.json';

export function emptyState() {
  return {
    web: { current: null, previous: null },
    service: { current: null, previous: null },
  };
}

export function readDeployState(path) {
  if (!existsSync(path)) return emptyState();
  const text = readFileSync(path, 'utf8').trim();
  if (!text) return emptyState();
  const raw = JSON.parse(text);
  return {
    web: {
      current: raw?.web?.current ?? null,
      previous: raw?.web?.previous ?? null,
    },
    service: {
      current: raw?.service?.current ?? null,
      previous: raw?.service?.previous ?? null,
    },
  };
}

export function writeDeployState(path, state) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
}

export function recordLayer(state, layer, sha, previousHint = null) {
  const next = {
    web: { ...state.web },
    service: { ...state.service },
  };
  const slot = next[layer];
  if (!slot) throw new Error(`unknown deploy layer: ${layer}`);
  if (slot.current && slot.current !== sha) slot.previous = slot.current;
  else if (!slot.previous && previousHint && previousHint !== sha) slot.previous = previousHint;
  slot.current = sha;
  return next;
}
