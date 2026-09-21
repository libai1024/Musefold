import { createServer, type ServerResponse, type IncomingMessage } from 'node:http';
export const textModelOutput = () => ({
  name: '云海报',
  summary: '黑白海报草稿',
  fidelity: 'adapted',
  inputs: [{ label: '主题', kind: 'text', required: true, variable: 'topic' }],
  constraints: [{ domain: 'color', statement: '黑白', mode: 'required', userOverridable: false }],
  promptProgram: [
    { kind: 'input-template', template: '{{topic}}', variables: ['topic'] },
    { kind: 'style-rule', template: '黑白海报', variables: [] },
  ],
  creationSummary: '提供主题，先试运行',
  schemeId: 'untrusted-id',
});
export const textAnalystOutput = () => ({
  repoKind: 'agent-skill',
  capabilitySummary: '海报风格',
  rules: [{ domain: 'color', statement: '黑白', mode: 'required', evidencePaths: ['README.md'] }],
  variables: [],
  unsupported: [],
});
export async function textModelFixture(
  acceptsAuthorization: (
    value: string | undefined,
    request: Pick<IncomingMessage, 'method' | 'url'>,
  ) => boolean = (value) => value === 'Bearer synthetic-text-key',
  extension?: (request: IncomingMessage, response: ServerResponse) => Promise<boolean>,
) {
  const posts: Array<{
    model: string;
    max_tokens: number;
    stream: boolean;
    messages: Array<{ role: string; content: string }>;
  }> = [];
  const gets: string[] = [];
  const state = { mode: 'normal', compiler: textModelOutput(), analyst: textAnalystOutput() };
  const held: Array<() => void> = [];
  const send = (res: ServerResponse, analyst: boolean) =>
    res.end(
      JSON.stringify({
        choices: [
          { message: { content: JSON.stringify(analyst ? state.analyst : state.compiler) } },
        ],
        usage: { prompt_tokens: 30, completion_tokens: 60 },
      }),
    );
  const server = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (!acceptsAuthorization(req.headers.authorization, req)) {
      res.writeHead(401).end('{}');
      return;
    }
    if (await extension?.(req, res)) return;
    if (req.url === '/v1/models' && req.method === 'GET') {
      gets.push(req.url);
      res.end(JSON.stringify({ data: state.mode === 'no-model' ? [] : [{ id: 'fixture-text' }] }));
      return;
    }
    if (req.url !== '/v1/chat/completions' || req.method !== 'POST') {
      res.writeHead(404).end('{}');
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    posts.push(body);
    const analyst = body.messages[0].content.includes('Repository Analyst');
    if (state.mode === 'drop') {
      req.socket.destroy();
      return;
    }
    if (state.mode === 'redirect') {
      res.writeHead(307, { location: '/paid-again' }).end('{}');
      return;
    }
    if (state.mode === '503') {
      res.writeHead(503).end(JSON.stringify({ secret: 'synthetic-text-key' }));
      return;
    }
    if (state.mode === 'oversize') {
      res.end(' '.repeat(600 * 1024));
      return;
    }
    if (state.mode === 'hold' || (state.mode === 'hold-compiler' && !analyst)) {
      held.push(() => send(res, analyst));
      return;
    }
    send(res, analyst);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No fixture port');
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    posts,
    gets,
    state,
    release() {
      for (const sendHeld of held.splice(0)) sendHeld();
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
