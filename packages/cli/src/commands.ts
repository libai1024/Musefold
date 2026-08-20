// P1 命令组（V04-CLI-01）：status / prompt / history / generation。
// 生图与方案/Skill 运行在 P2/P3 追加；本文件保持每个命令一个纯函数、可注入测试。

import { readFileSync } from 'node:fs';
import { connect, connectDetailed, localCall, type CliContext } from './context';
import { EXIT, printJson, table, type CliIo } from './io';

type CommandRunner = (context: CliContext, rest: string[]) => Promise<number>;

export async function commandStatus(context: CliContext): Promise<number> {
  const client = await connect(context);
  const health = (await client.health()) as {
    owner?: string; appVersion?: string; apiVersion?: string;
    data?: { prompts?: number; formalSchemes?: number; providers?: number; activeProviderId?: string | null };
  };
  if (context.json) {
    printJson(context.io, { type: 'result', connected: true, ...health });
    return EXIT.OK;
  }
  const data = health.data ?? {};
  for (const line of table([
    ['Musefold', `已连接（${health.owner ?? '?'} · v${health.appVersion ?? '?'} · api ${health.apiVersion ?? '?'}）`],
    ['数据', `提示词 ${data.prompts ?? 0} · 正式方案 ${data.formalSchemes ?? 0}`],
    ['Provider', `${data.providers ?? 0} 个${data.activeProviderId ? `（激活 ${data.activeProviderId}）` : ''}`],
  ])) context.io.stdout(line);
  return EXIT.OK;
}

export async function commandAccount(context: CliContext, rest: string[]): Promise<number> {
  const [action] = rest;
  const client = await connect(context);
  if (action === 'status' || action === undefined) {
    const status = await client.setupStatus();
    if (context.json) printJson(context.io, { type: 'result', account: status.account });
    else {
      context.io.stdout(status.account.configured ? '账号已配置' : '账号未配置');
      context.io.stdout(`状态：${status.account.health} · 服务器：${status.account.serverKind === 'default' ? '默认' : '自定义'}`);
    }
    return EXIT.OK;
  }
  if (action === 'login' || action === 'register') {
    const result = await client.openAccountSetup(action);
    if (context.json) printJson(context.io, { type: 'result', ...result });
    else context.io.stdout(result.message);
    return EXIT.OK;
  }
  context.io.stderr('musefold: 用法 musefold account <status|login|register>');
  return EXIT.ARGS;
}

export async function commandPrompt(context: CliContext, rest: string[]): Promise<number> {
  const [action, ...tail] = rest;
  const client = await connect(context);

  if (action === 'list' || action === 'search') {
    const query = action === 'search' ? tail.join(' ').trim() : (typeof context.args.flags.query === 'string' ? context.args.flags.query : undefined);
    const limit = typeof context.args.flags.limit === 'string' ? Number(context.args.flags.limit) : undefined;
    const source = typeof context.args.flags.source === 'string' ? context.args.flags.source : undefined;
    const result = await client.prompts({ query, limit, source });
    if (context.json) {
      printJson(context.io, { type: 'result', prompts: result.prompts, total: result.total });
    } else {
      if (result.prompts.length === 0) context.io.stderr('（没有匹配的提示词）');
      for (const prompt of result.prompts) {
        context.io.stdout(`${String(prompt.id)}  ${String(prompt.title)}`);
      }
    }
    return EXIT.OK;
  }

  if (action === 'get') {
    const id = tail[0];
    if (!id) { context.io.stderr('musefold: 用法 musefold prompt get <id>'); return EXIT.ARGS; }
    const { prompt } = await client.prompt(id);
    if (context.json) printJson(context.io, { type: 'result', prompt });
    else context.io.stdout(String(prompt.content ?? ''));
    return EXIT.OK;
  }

  if (action === 'add') {
    const title = typeof context.args.flags.title === 'string' ? context.args.flags.title : '';
    let body = '';
    if (typeof context.args.flags['body-file'] === 'string') {
      body = readFileSync(String(context.args.flags['body-file']), 'utf8');
    } else if (context.args.flags.stdin === true) {
      body = readFileSync(0, 'utf8');
    } else if (typeof context.args.flags.body === 'string') {
      body = context.args.flags.body;
    }
    if (!title || !body.trim()) {
      context.io.stderr('musefold: 用法 musefold prompt add --title <标题> (--body <正文> | --body-file <路径> | --stdin)');
      return EXIT.ARGS;
    }
    const created = await client.savePrompt({
      title,
      body,
      note: typeof context.args.flags.note === 'string' ? context.args.flags.note : undefined,
    });
    if (context.json) printJson(context.io, { type: 'result', ...created });
    else context.io.stdout(created.id);
    return EXIT.OK;
  }

  if (action === 'rm') {
    const id = tail[0];
    if (!id) { context.io.stderr('musefold: 用法 musefold prompt rm <id> --force'); return EXIT.ARGS; }
    if (context.args.flags.force !== true) {
      context.io.stderr(`musefold: 预览——将把提示词 ${id} 移入回收站（可恢复）。追加 --force 执行。`);
      return EXIT.OK;
    }
    const connection = await connectDetailed(context);
    const result = await localCall<{ ok: boolean; trashed: string }>(connection, `/v1/local/prompts/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (context.json) printJson(context.io, { type: 'result', ...result });
    else context.io.stdout(`已移入回收站：${result.trashed}`);
    return EXIT.OK;
  }

  context.io.stderr('musefold: 用法 musefold prompt <list|search|get|add|rm>');
  return EXIT.ARGS;
}

async function readSecretKey(context: CliContext): Promise<string | null> {
  if (typeof context.args.flags['from-env'] === 'string') {
    return context.env[String(context.args.flags['from-env'])] ?? null;
  }
  if (context.args.flags.stdin === true) {
    return readFileSync(0, 'utf8').trim() || null;
  }
  // 拒绝 argv 明文（V04-SECURITY §4.2：ps 可见）；TTY 隐藏输入
  if (process.stdin.isTTY !== true) return null;
  process.stderr.write('API Key（输入不回显）: ');
  return new Promise((resolve) => {
    const stdin = process.stdin;
    stdin.setRawMode?.(true);
    stdin.resume();
    let value = '';
    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\n' || char === '\r' || char === '\u0004') {
          stdin.setRawMode?.(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stderr.write('\n');
          resolve(value.trim() || null);
          return;
        }
        if (char === '\u0003') { // Ctrl-C
          stdin.setRawMode?.(false);
          process.exit(EXIT.INTERRUPTED);
        }
        if (char === '\u007f') value = value.slice(0, -1);
        else value += char;
      }
    };
    stdin.on('data', onData);
  });
}

export async function commandProvider(context: CliContext, rest: string[]): Promise<number> {
  const [action, ...tail] = rest;
  const connection = await connectDetailed(context);
  const { client } = connection;

  if (action === 'list') {
    const { providers } = await client.providers();
    if (context.json) printJson(context.io, { type: 'result', providers });
    else {
      for (const provider of providers) {
        const marks = [provider.isActive ? '激活' : null, provider.hasKey ? `key ✓${provider.keySuffix ? ` (…${provider.keySuffix})` : ''}` : 'key ✗']
          .filter(Boolean).join(' · ');
        context.io.stdout(`${String(provider.id)}  ${String(provider.name)}  ${marks}`);
      }
    }
    return EXIT.OK;
  }

  if (action === 'models') {
    const id = tail[0];
    if (!id) { context.io.stderr('musefold: 用法 musefold provider models <id>'); return EXIT.ARGS; }
    const { models } = await client.providerModels(id);
    if (context.json) printJson(context.io, { type: 'result', models });
    else for (const model of models) context.io.stdout(model.id);
    return EXIT.OK;
  }

  if (action === 'setup') {
    const draft = {
      ...(typeof context.args.flags.name === 'string' ? { name: context.args.flags.name } : {}),
      ...(typeof context.args.flags.type === 'string' ? { type: context.args.flags.type as 'openai' | 'openai-compatible' | 'wukong-studio' } : {}),
      ...(typeof context.args.flags['base-url'] === 'string' ? { baseUrl: context.args.flags['base-url'] } : {}),
      ...(typeof context.args.flags.model === 'string' ? { model: context.args.flags.model } : {}),
    };
    const result = await client.openProviderSetup(draft);
    if (context.json) printJson(context.io, { type: 'result', ...result });
    else context.io.stdout(result.message);
    return EXIT.OK;
  }

  if (action === 'add') {
    const input = {
      name: String(context.args.flags.name ?? ''),
      type: String(context.args.flags.type ?? 'openai-compatible'),
      baseUrl: String(context.args.flags['base-url'] ?? ''),
      model: String(context.args.flags.model ?? ''),
      isActive: context.args.flags.use === true,
    };
    if (!input.name || !input.baseUrl || !input.model) {
      context.io.stderr('musefold: 用法 musefold provider add --name <名> --base-url <url> --model <id> [--type openai-compatible] [--use]');
      return EXIT.ARGS;
    }
    const created = await localCall<Record<string, unknown>>(connection, '/v1/local/providers', { body: input });
    if (context.json) printJson(context.io, { type: 'result', provider: created });
    else context.io.stdout(String(created.id));
    return EXIT.OK;
  }

  if (action === 'set-key') {
    const id = tail[0];
    if (!id) { context.io.stderr('musefold: 用法 musefold provider set-key <id> [--stdin | --from-env NAME]'); return EXIT.ARGS; }
    const key = await readSecretKey(context);
    if (!key) {
      context.io.stderr('musefold: 未获得密钥。安全方式：交互式隐藏输入 / --stdin 管道 / --from-env 环境变量（拒绝 argv 明文）');
      return EXIT.ARGS;
    }
    const result = await localCall<{ ok: boolean; keySuffix: string | null }>(connection, `/v1/local/providers/${encodeURIComponent(id)}/key`, { body: { key } });
    if (context.json) printJson(context.io, { type: 'result', ...result });
    else context.io.stdout(`已保存（…${result.keySuffix ?? '????'}）`);
    return EXIT.OK;
  }

  if (action === 'rm') {
    const id = tail[0];
    if (!id) { context.io.stderr('musefold: 用法 musefold provider rm <id> --force'); return EXIT.ARGS; }
    if (context.args.flags.force !== true) {
      context.io.stderr(`musefold: 预览——将删除 Provider ${id}（连同其密钥与单价配置）。追加 --force 执行。`);
      return EXIT.OK;
    }
    await localCall(connection, `/v1/local/providers/${encodeURIComponent(id)}`, { method: 'DELETE' });
    context.io.stdout(context.json ? JSON.stringify({ type: 'result', ok: true }) : '已删除');
    return EXIT.OK;
  }

  if (action === 'validate') {
    const id = tail[0];
    if (!id) { context.io.stderr('musefold: 用法 musefold provider validate <id>'); return EXIT.ARGS; }
    const result = await localCall<{ ok: boolean; message?: string }>(connection, `/v1/local/providers/${encodeURIComponent(id)}/validate`, {});
    if (context.json) printJson(context.io, { type: 'result', ...result });
    else context.io.stdout(result.ok ? '连接正常' : `连接失败：${result.message ?? '未知原因'}`);
    return result.ok ? EXIT.OK : EXIT.PROVIDER;
  }

  if (action === 'use') {
    const id = tail[0];
    if (!id) { context.io.stderr('musefold: 用法 musefold provider use <id>'); return EXIT.ARGS; }
    await localCall(connection, `/v1/local/providers/${encodeURIComponent(id)}/activate`, {});
    context.io.stdout(context.json ? JSON.stringify({ type: 'result', ok: true }) : `已激活 ${id}`);
    return EXIT.OK;
  }

  context.io.stderr('musefold: 用法 musefold provider <list|models|add|set-key|rm|validate|use>');
  return EXIT.ARGS;
}

export async function commandBackup(context: CliContext, rest: string[]): Promise<number> {
  const [action, ...tail] = rest;
  const connection = await connectDetailed(context);

  if (action === 'now') {
    const result = await localCall<{ path: string }>(connection, '/v1/local/backups', {});
    if (context.json) printJson(context.io, { type: 'result', ...result });
    else context.io.stdout(result.path);
    return EXIT.OK;
  }
  if (action === 'list') {
    const result = await localCall<{ backups: Array<Record<string, unknown>> }>(connection, '/v1/local/backups', { method: 'GET' });
    if (context.json) printJson(context.io, { type: 'result', ...result });
    else for (const backup of result.backups) context.io.stdout(`${String(backup.file ?? backup.path ?? '')}  ${String(backup.createdAt ?? '')}`);
    return EXIT.OK;
  }
  if (action === 'restore') {
    const file = tail[0];
    if (!file) { context.io.stderr('musefold: 用法 musefold backup restore <file>'); return EXIT.ARGS; }
    if (context.args.flags.force !== true) {
      context.io.stderr('musefold: 恢复会替换当前库（自动先做安全备份）。追加 --force 执行。');
      return EXIT.OK;
    }
    const result = await localCall<{ safetyBackupPath: string }>(connection, '/v1/local/backups/restore', { body: { file } });
    if (context.json) printJson(context.io, { type: 'result', ...result });
    else context.io.stdout(`已恢复；安全备份：${result.safetyBackupPath}`);
    return EXIT.OK;
  }
  context.io.stderr('musefold: 用法 musefold backup <now|list|restore>');
  return EXIT.ARGS;
}

export async function commandExport(context: CliContext): Promise<number> {
  const connection = await connectDetailed(context);
  const result = await localCall<Record<string, unknown>>(connection, '/v1/local/export', {
    body: {
      ...(typeof context.args.flags.out === 'string' ? { targetPath: context.args.flags.out } : {}),
      ...(typeof context.args.flags.mode === 'string' ? { mode: context.args.flags.mode } : {}),
      ...(context.args.flags['include-history'] === true ? { includeHistory: true } : {}),
    },
  });
  if (context.json) printJson(context.io, { type: 'result', ...result });
  else context.io.stdout(String(result.path ?? result.targetPath ?? '已导出'));
  return EXIT.OK;
}

export async function commandImport(context: CliContext, rest: string[]): Promise<number> {
  const sourcePath = rest[0];
  if (!sourcePath) { context.io.stderr('musefold: 用法 musefold import <path> [--strategy merge|replace] [--dry-run]'); return EXIT.ARGS; }
  const connection = await connectDetailed(context);
  const result = await localCall<Record<string, unknown>>(connection, '/v1/local/import', {
    body: {
      sourcePath,
      ...(typeof context.args.flags.strategy === 'string' ? { strategy: context.args.flags.strategy } : {}),
      ...(context.args.flags['dry-run'] === true ? { dryRun: true } : {}),
    },
  });
  if (context.json) printJson(context.io, { type: 'result', ...result });
  else context.io.stdout(JSON.stringify(result));
  return EXIT.OK;
}

export async function commandHistory(context: CliContext, rest: string[]): Promise<number> {
  const [action, ...tail] = rest;
  const client = await connect(context);

  if (action === 'list' || action === undefined) {
    const result = await client.history({
      limit: typeof context.args.flags.limit === 'string' ? Number(context.args.flags.limit) : undefined,
      status: typeof context.args.flags.status === 'string' ? context.args.flags.status : undefined,
      providerId: typeof context.args.flags.provider === 'string' ? context.args.flags.provider : undefined,
    });
    if (context.json) printJson(context.io, { type: 'result', history: result.history });
    else {
      for (const item of result.history) {
        const cost = item.cost != null ? `${item.cost}积分` : '-';
        context.io.stdout(`${String(item.id)}  ${String(item.status)}  ${cost}  ${String(item.promptText ?? '').slice(0, 40)}`);
      }
      if (result.history.length === 0) context.io.stderr('（没有历史记录）');
    }
    return EXIT.OK;
  }

  if (action === 'show') {
    const id = tail[0];
    if (!id) { context.io.stderr('musefold: 用法 musefold history show <id>'); return EXIT.ARGS; }
    const { history } = await client.historyDetail(id);
    if (context.json) printJson(context.io, { type: 'result', history });
    else {
      for (const line of table([
        ['ID', String(history.id)],
        ['状态', String(history.status)],
        ['Provider', String(history.providerId)],
        ['模型', String(history.model)],
        ['成本', history.cost != null ? `${history.cost} 积分` : '-'],
        ['产物', String(history.imagePath ?? '-')],
        ['提示词', String(history.promptText ?? '').slice(0, 120)],
      ])) context.io.stdout(line);
    }
    return EXIT.OK;
  }

  context.io.stderr('musefold: 用法 musefold history <list|show>');
  return EXIT.ARGS;
}

function parseKeyValues(raw: string | boolean | undefined, io: CliIo, flag: string): Record<string, string> | null {
  const record: Record<string, string> = {};
  const pairs = typeof raw === 'string' ? raw.split(',') : [];
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq <= 0) {
      io.stderr(`musefold: ${flag} 需要 k=v 形式：${pair}`);
      return null;
    }
    record[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return record;
}

async function pollExternalRun(
  context: CliContext,
  client: Awaited<ReturnType<typeof connect>>,
  pollPath: string,
  submitted: { jobId: string; status: string },
): Promise<number> {
  if (context.args.flags['no-wait'] === true) {
    if (context.json) printJson(context.io, { type: 'result', ...submitted });
    else context.io.stdout(submitted.jobId);
    return EXIT.OK;
  }
  type RunDetail = {
    jobId: string; status: string; assets?: Array<{ path: string }>;
    costPoints?: number | null; cost?: number | null; costUnit?: 'point';
    stepSummaries?: string[]; error?: { code: string; message: string } | null;
  };
  let seenSteps = 0;
  let detail = await client.request<RunDetail>(`${pollPath}/${submitted.jobId}`);
  while (detail.status === 'running') {
    const steps = detail.stepSummaries ?? [];
    for (; seenSteps < steps.length; seenSteps += 1) context.io.stderr(`musefold: ${steps[seenSteps]}`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    detail = await client.request<RunDetail>(`${pollPath}/${submitted.jobId}`);
  }
  if (context.json) {
    printJson(context.io, { type: 'result', ...detail });
  } else if (detail.status === 'success') {
    for (const asset of detail.assets ?? []) context.io.stdout(asset.path);
    if (detail.costPoints != null) context.io.stderr(`musefold: 成本 ${detail.costPoints} 积分`);
  } else {
    context.io.stderr(`musefold: 运行${detail.status === 'cancelled' ? '已取消' : '失败'}${detail.error ? `：${detail.error.message}` : ''}`);
  }
  return detail.status === 'success' ? EXIT.OK : detail.status === 'cancelled' ? EXIT.INTERRUPTED : EXIT.GENERAL;
}

/** 花钱运行的本机同意（T9）：非 TTY 且无 -y 一律拒绝。 */
function requireConsent(context: CliContext, what: string): boolean {
  if (context.yes) return true;
  if (process.stdin.isTTY !== true) {
    context.io.stderr(`musefold: ${what}会产生费用；非交互终端必须显式 --yes`);
    return false;
  }
  // TTY 且未 -y：为保持命令原子性，直接要求 -y（估算预览请用 generate 命令体验）
  context.io.stderr(`musefold: ${what}会产生费用，请追加 -y 确认执行`);
  return false;
}

export async function commandScheme(context: CliContext, rest: string[]): Promise<number> {
  const [action, ...tail] = rest;
  const client = await connect(context);

  if (action === 'list') {
    const { schemes } = await client.schemes();
    if (context.json) printJson(context.io, { type: 'result', schemes });
    else for (const scheme of schemes) context.io.stdout(`${String(scheme.id)}  ${String(scheme.name)}`);
    return EXIT.OK;
  }

  if (action === 'show') {
    const id = tail[0];
    if (!id) { context.io.stderr('musefold: 用法 musefold scheme show <id>'); return EXIT.ARGS; }
    const detail = await client.scheme(id);
    if (context.json) printJson(context.io, { type: 'result', ...detail });
    else {
      context.io.stdout(`${String(detail.summary.name)}（${String(detail.summary.id)}）`);
      const inputs = (detail.document as { inputs?: Array<{ id: string; label: string; kind: string; required?: boolean }> }).inputs ?? [];
      for (const slot of inputs) {
        context.io.stdout(`  --input ${slot.id}=…  ${slot.label}（${slot.kind}${slot.required ? '，必填' : ''}）`);
      }
    }
    return EXIT.OK;
  }

  if (action === 'compile') {
    const id = tail[0];
    if (!id) { context.io.stderr('musefold: 用法 musefold scheme compile <id> [--input k=v]'); return EXIT.ARGS; }
    const inputs = parseKeyValues(context.args.flags.input, context.io, '--input');
    if (!inputs) return EXIT.ARGS;
    const compiled = await client.compileScheme(id, {
      inputs,
      ...(typeof context.args.flags.priority === 'string' ? { priorityMode: context.args.flags.priority } : {}),
    });
    if (context.json) printJson(context.io, { type: 'result', ...compiled });
    else {
      context.io.stdout(compiled.prompt);
      for (const warning of compiled.warnings) context.io.stderr(`musefold: ${warning}`);
    }
    return EXIT.OK;
  }

  if (action === 'run') {
    const id = tail[0];
    if (!id) { context.io.stderr('musefold: 用法 musefold scheme run <id> [--input k=v] [-y]'); return EXIT.ARGS; }
    if (!requireConsent(context, '运行方案')) return EXIT.REFUSED;
    const inputs = parseKeyValues(context.args.flags.input, context.io, '--input');
    if (!inputs) return EXIT.ARGS;
    const submitted = await client.request<{ jobId: string; status: string }>(
      `/v1/schemes/${encodeURIComponent(id)}/runs`,
      {
        method: 'POST',
        body: JSON.stringify({
          inputs,
          consent: 'interactive',
          ...(typeof context.args.flags.brief === 'string' ? { brief: context.args.flags.brief } : {}),
          ...(typeof context.args.flags.ratio === 'string' ? { ratioId: context.args.flags.ratio } : {}),
          ...(typeof context.args.flags.n === 'string' ? { n: Number(context.args.flags.n) } : {}),
          ...(typeof context.args.flags.priority === 'string' ? { priorityMode: context.args.flags.priority } : {}),
        }),
      },
    );
    return pollExternalRun(context, client, '/v1/scheme-runs', submitted);
  }

  context.io.stderr('musefold: 用法 musefold scheme <list|show|compile|run>');
  return EXIT.ARGS;
}

export async function commandSkill(context: CliContext, rest: string[]): Promise<number> {
  const [action, url] = rest;
  if (action !== 'run' || !url) {
    context.io.stderr('musefold: 用法 musefold skill run <github-url> -p <提示词> [-y]');
    return EXIT.ARGS;
  }
  const prompt = typeof context.args.flags.prompt === 'string' ? context.args.flags.prompt : '';
  if (!prompt.trim()) { context.io.stderr('musefold: 需要 -p <提示词>'); return EXIT.ARGS; }
  if (!requireConsent(context, '运行 Skill')) return EXIT.REFUSED;
  const client = await connect(context);
  const submitted = await client.request<{ jobId: string; status: string }>(
    '/v1/skills/github/run',
    {
      method: 'POST',
      body: JSON.stringify({
        url,
        prompt,
        consent: 'interactive',
        ...(typeof context.args.flags.ratio === 'string' ? { ratioId: context.args.flags.ratio } : {}),
        ...(typeof context.args.flags.n === 'string' ? { n: Number(context.args.flags.n) } : {}),
      }),
    },
  );
  return pollExternalRun(context, client, '/v1/skill-runs', submitted);
}

export async function commandCancel(context: CliContext, rest: string[]): Promise<number> {
  const jobId = rest[0];
  if (!jobId) { context.io.stderr('musefold: 用法 musefold cancel <jobId>'); return EXIT.ARGS; }
  const client = await connect(context);
  const result = await client.cancelGeneration(jobId);
  if (context.json) printJson(context.io, { type: 'result', ...result });
  else context.io.stdout(`已请求取消 ${result.jobId}`);
  return EXIT.OK;
}

export const COMMANDS: Record<string, CommandRunner> = {
  status: (context) => commandStatus(context),
  account: commandAccount,
  prompt: commandPrompt,
  history: commandHistory,
  scheme: commandScheme,
  skill: commandSkill,
  provider: commandProvider,
  backup: commandBackup,
  export: (context) => commandExport(context),
  import: commandImport,
  cancel: commandCancel,
};
