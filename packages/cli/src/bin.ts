// bin 壳：runCli 桥接到进程退出码；Ctrl-C 按 130 退出（生图取消在 P2 接入）。
// shebang 由 scripts/build-cli.mjs 的 banner 注入，源文件不重复携带。

import { runCli } from './index';

process.on('SIGINT', () => {
  process.exit(130);
});

const io = {
  stdout: (line: string) => process.stdout.write(`${line}\n`),
  stderr: (line: string) => process.stderr.write(`${line}\n`),
};

runCli(process.argv.slice(2), io)
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(`musefold: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
