import { describe, expect, it } from 'vitest';
import { extractJsonCandidate } from '../model-json';

describe('shared model JSON framing', () => {
  it('extracts nested objects without treating braces or escaped quotes in a string as structure', () => {
    const value = { template: 'Draw {topic} with "quotes" and \\ paths', nested: { text: '}' } };
    const json = JSON.stringify(value);
    expect(JSON.parse(extractJsonCandidate(`说明\n${json}\n完成`))).toEqual(value);
  });

  it('accepts a fenced object and leaves incomplete or non-JSON content for caller rejection', () => {
    expect(extractJsonCandidate('  ```JSON\n{"name":"海报"}\n```  ')).toBe('{"name":"海报"}');
    for (const text of ['not json', '{"name":"unfinished', '{"nested":{']) {
      expect(() => JSON.parse(extractJsonCandidate(text))).toThrow();
    }
  });

  it('does not evaluate code or merge a later second object into the first result', () => {
    expect(extractJsonCandidate('prefix {"name":"first"} {"owner":"second"}')).toBe(
      '{"name":"first"}',
    );
    expect(() => JSON.parse(extractJsonCandidate('{"name": process.exit()}'))).toThrow();
  });
});
