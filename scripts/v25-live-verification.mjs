// Strict opt-in for real-account verification. Errors contain variable names only.
// Paid generation requires a separate switch and an explicit endpoint/model.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function validateLiveVerification(env) {
  if (env.MUSEFOLD_LIVE_E2E !== '1') throw new Error('MUSEFOLD_LIVE_E2E=1 required');
  const required = ['MUSEFOLD_E2E_USERNAME', 'MUSEFOLD_E2E_PASSWORD'];
  const generation = env.MUSEFOLD_LIVE_GENERATION === '1';
  const accountGeneration = env.MUSEFOLD_LIVE_ACCOUNT_GENERATION === '1';
  if (accountGeneration) required.push('MUSEFOLD_E2E_ACCOUNT_IMAGE_MODEL');
  if (generation) {
    required.push(
      'MUSEFOLD_E2E_IMAGE_API_KEY',
      'MUSEFOLD_E2E_IMAGE_BASE_URL',
      'MUSEFOLD_E2E_IMAGE_MODEL',
    );
  }
  for (const name of required) {
    if (!env[name]?.trim()) throw new Error(`${name} required`);
  }
  if (generation) {
    let url;
    try {
      url = new URL(env.MUSEFOLD_E2E_IMAGE_BASE_URL);
    } catch {
      throw new Error('MUSEFOLD_E2E_IMAGE_BASE_URL must be an HTTPS URL');
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new Error('MUSEFOLD_E2E_IMAGE_BASE_URL must be HTTPS without credentials/query/hash');
    }
  }
  return { generation, accountGeneration };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = validateLiveVerification(process.env);
    console.log(JSON.stringify({ account: true, ...result, automaticRetries: 0 }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'LIVE_VERIFICATION_CONFIG_INVALID');
    process.exitCode = 1;
  }
}
