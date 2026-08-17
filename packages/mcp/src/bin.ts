// musefold-mcp 入口：stdio 传输；日志一律 stderr（stdout 归 JSON-RPC 所有）。
// 参数：--readonly / --toolsets a,b,c / --no-wait / --endpoint / --token

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMusefoldMcpServer } from './server';

function flagValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index >= 0 && argv[index + 1]) return argv[index + 1];
  const inline = argv.find((arg) => arg.startsWith(`${name}=`));
  return inline ? inline.slice(name.length + 1) : undefined;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const { server } = await createMusefoldMcpServer({
    readonly: argv.includes('--readonly'),
    toolsets: flagValue(argv, '--toolsets')?.split(',').map((item) => item.trim()).filter(Boolean),
    noWait: argv.includes('--no-wait'),
    endpoint: flagValue(argv, '--endpoint') ?? process.env.MUSEFOLD_ENDPOINT,
    token: flagValue(argv, '--token') ?? process.env.MUSEFOLD_TOKEN,
  });
  await server.connect(new StdioServerTransport());
  process.stderr.write('[musefold-mcp] stdio server ready\n');
}

main().catch((error) => {
  process.stderr.write(`[musefold-mcp] fatal: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
