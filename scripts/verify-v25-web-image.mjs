import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
// Actual container smoke: an isolated API, production Web, and only loopback-published ports.
// Usage: node scripts/verify-v25-web-image.mjs [image-tag]
const image = process.argv[2] || 'musefold/web:v2.5';
const suffix = randomUUID().slice(0, 8);
const network = `musefold-v25-test-${suffix}`;
const names = [`${network}-api`, `${network}-web`];
const docker = (...args) =>
  execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
try {
  docker('network', 'create', network);
  docker(
    'run',
    '--rm',
    '-d',
    '--name',
    names[0],
    '--network',
    network,
    '--network-alias',
    'api',
    'node:24-alpine',
    'node',
    '-e',
    "require('node:http').createServer((req,res)=>{res.setHeader('x-test-api','isolated');res.setHeader('content-type','application/json');res.end(JSON.stringify({method:req.method,path:req.url}));}).listen(8787,'0.0.0.0')",
  );
  docker(
    'run',
    '--rm',
    '-d',
    '--name',
    names[1],
    '--network',
    network,
    '-p',
    '127.0.0.1::3000',
    image,
  );
  const port = docker('port', names[1], '3000/tcp').split(':').at(-1);
  const origin = `http://127.0.0.1:${port}`;
  let response;
  for (let i = 0; i < 60; i++) {
    try {
      response = await fetch(`${origin}/settings`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  assert(response?.ok, 'standalone /settings failed');
  const html = await response.text();
  const scripts = [...html.matchAll(/(?:src|href)="([^" ]*\/_next\/static\/[^" ]+)"/g)].map(
    (m) => m[1],
  );
  assert(scripts.length > 0, 'page lacks production static assets');
  for (const path of new Set(scripts)) {
    const asset = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(5000) });
    assert(asset.ok, `static asset failed ${path}`);
    await asset.arrayBuffer();
  }
  for (const path of ['/api/v1/smoke', '/mcp', '/.well-known/oauth-protected-resource']) {
    const method = path === '/mcp' ? 'POST' : 'GET';
    const res = await fetch(`${origin}${path}`, { method, signal: AbortSignal.timeout(5000) });
    assert.equal(res.headers.get('x-test-api'), 'isolated');
    assert.deepEqual(await res.json(), { method, path });
  }
  assert.notEqual(docker('exec', names[1], 'id', '-u'), '0');
  console.log(
    JSON.stringify(
      {
        result: 'pass',
        image,
        staticAssets: new Set(scripts).size,
        checks: [
          'standalone settings',
          'production JS/CSS',
          'same-origin API',
          'MCP POST',
          'OAuth discovery',
          'non-root runtime',
        ],
      },
      null,
      2,
    ),
  );
} finally {
  for (const name of names.reverse()) {
    try {
      docker('rm', '-f', name);
    } catch {}
  }
  try {
    docker('network', 'rm', network);
  } catch {}
}
