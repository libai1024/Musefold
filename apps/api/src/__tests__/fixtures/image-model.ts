import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import sharp from 'sharp';

/** Controlled image-provider HTTP boundary; never writes product jobs, assets or trial state. */
export async function imageModelFixture() {
  const output = await sharp({
    create: { width: 24, height: 16, channels: 3, background: '#287c92' },
  })
    .png()
    .toBuffer();
  const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
  const calls: Array<{
    endpoint: string;
    model: string;
    count: number;
    promptHash: string;
    references: Array<{ hash: string; bytes: number; mimeType: string }>;
  }> = [];
  const pending = new Set<ServerResponse>();
  const state = { mode: 'normal' as 'normal' | 'hold' | 'drop' | 'reject' };
  function send(response: ServerResponse, count: number) {
    if (response.destroyed) return;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        data: Array.from({ length: count }, () => ({ b64_json: output.toString('base64') })),
      }),
    );
  }
  const releases = new Map<ServerResponse, () => void>();
  return {
    calls,
    state,
    output: { hash: hash(output), bytes: output.length, width: 24, height: 16 },
    async handle(request: IncomingMessage, response: ServerResponse) {
      const endpoint = request.url ?? '';
      if (
        request.method !== 'POST' ||
        !['/v1/images/generations', '/v1/images/edits'].includes(endpoint)
      )
        return false;
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const bytes = Buffer.concat(chunks);
      let model: string;
      let count: number;
      let prompt: string;
      const references: Array<{ hash: string; bytes: number; mimeType: string }> = [];
      if (request.url === '/v1/images/edits') {
        const form = await new Request('http://fixture.invalid', {
          method: 'POST',
          headers: { 'content-type': request.headers['content-type'] ?? '' },
          body: new Uint8Array(bytes),
        }).formData();
        model = String(form.get('model'));
        count = Number(form.get('n'));
        prompt = String(form.get('prompt'));
        for (const file of form.getAll('image[]')) {
          if (typeof file === 'string') throw new Error('Image fixture requires multipart files');
          const content = new Uint8Array(await file.arrayBuffer());
          references.push({ hash: hash(content), bytes: content.length, mimeType: file.type });
        }
      } else {
        const input = JSON.parse(bytes.toString());
        model = input.model;
        count = input.n;
        prompt = input.prompt;
      }
      if (typeof model !== 'string' || typeof prompt !== 'string' || ![1, 2, 4].includes(count)) {
        response.writeHead(400).end('{}');
        return true;
      }
      calls.push({
        endpoint,
        model,
        count,
        promptHash: hash(Buffer.from(prompt)),
        references,
      });
      if (state.mode === 'drop') request.socket.destroy();
      else if (state.mode === 'reject')
        response.writeHead(402).end(JSON.stringify({ error: { code: 'quota' } }));
      else if (state.mode === 'hold') {
        pending.add(response);
        releases.set(response, () => send(response, count));
        response.once('close', () => {
          pending.delete(response);
          releases.delete(response);
        });
      } else send(response, count);
      return true;
    },
    release() {
      state.mode = 'normal';
      for (const response of pending) releases.get(response)?.();
      pending.clear();
      releases.clear();
    },
  };
}
