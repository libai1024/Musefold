import { runDeploymentMigrations } from './deployment/migrate.js';

try {
  console.log(JSON.stringify(await runDeploymentMigrations(process.env)));
} catch {
  // Never serialize upstream errors, SQL, credentials or a connection URI to deployment logs.
  console.error('[migration] failed; no application rollout was authorized');
  process.exitCode = 1;
}
