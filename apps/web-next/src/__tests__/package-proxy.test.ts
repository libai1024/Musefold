import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { describe, it, expect } from 'vitest';
import { getCloneableBody } from 'next/dist/server/body-streams';
import config from '../../next.config';

describe('binary package requests through the Next proxy', () => {
  it('retains a request larger than the default clone budget', async () => {
    const bytes = Buffer.alloc(16 * 1024 * 1024, 0x7a);
    const original = new IncomingMessage(new Socket());
    original.push(bytes.subarray(0, 8 * 1024 * 1024));
    original.push(bytes.subarray(8 * 1024 * 1024));
    original.push(null);
    const clone = getCloneableBody(
      original,
      config.experimental?.proxyClientMaxBodySize as number,
    ).cloneBodyStream();
    const parts: Buffer[] = [];
    for await (const part of clone) parts.push(part);
    // Native byte comparison avoids creating millions of matcher object properties.
    expect(Buffer.concat(parts).equals(bytes)).toBe(true);
  });
});
