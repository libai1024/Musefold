import { createHash } from 'node:crypto';

export const RULESET_VERSION = 'v25-content-1';
const patterns = [
  ['private-key', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,255}|github_pat_[A-Za-z0-9_]{30,255})\b/g],
  ['provider-token', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,255}\b/g],
  ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{24,255}\b/g],
];
const userPath =
  /(?:\/Users\/|\/home\/|[A-Z]:[\\/]+Users[\\/]+)[A-Za-z0-9_.@-]{1,100}(?:[\\/][^\s"'<>`\p{Cc}]{0,200})?/giu;
export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Pattern rules are bounded detection, not a proof that arbitrary unknown secrets are absent. */
export function createContentScanner({ canaries = [], detectUserPaths = false } = {}) {
  for (const c of canaries) {
    if (
      !/^[a-z][a-z0-9-]{0,63}$/.test(c.id) ||
      typeof c.value !== 'string' ||
      c.value.length < 12 ||
      c.value.length > 2048
    ) {
      throw new Error('INVALID_CANARY');
    }
  }
  const representationsByCanary = canaries.map(({ id, value }) => {
    const representations = new Set([
      value,
      JSON.stringify(value).slice(1, -1),
      encodeURIComponent(value),
      Buffer.from(value).toString('base64'),
    ]);
    return { id, representations: [...representations] };
  });
  const needles = representationsByCanary.flatMap(({ id, representations }) => {
    return representations.flatMap((text) =>
      ['utf8', 'utf16le'].map((encoding) => ({ id, bytes: Buffer.from(text, encoding) })),
    );
  });
  const overlapBytes = Math.max(16384, ...needles.map((needle) => needle.bytes.length));
  function scan(bytes) {
    const findings = new Map();
    const add = (rule, matched) =>
      findings.set(`${rule}:${digest(matched)}`, { rule, matchHash: digest(matched) });
    for (const needle of needles)
      if (bytes.includes(needle.bytes)) add(`canary:${needle.id}`, needle.bytes);
    // UTF-8 and UTF-16LE are both used by executables, SQLite and Windows output.
    for (const text of [
      bytes.toString('utf8'),
      bytes.toString('utf16le'),
      bytes.subarray(1).toString('utf16le'),
    ]) {
      for (const [rule, pattern] of [
        ...patterns,
        ...(detectUserPaths ? [['user-path', userPath]] : []),
      ]) {
        for (const match of text.matchAll(pattern)) add(rule, match[0]);
      }
    }
    return [...findings.values()];
  }
  function safeLabel(label) {
    let result = label;
    for (const c of representationsByCanary)
      for (const value of c.representations) result = result.split(value).join('[redacted]');
    for (const [, pattern] of patterns) result = result.replace(pattern, '[redacted]');
    result = result.replace(userPath, '[user-path]');
    return [...result]
      .map((char) => (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? '?' : char))
      .join('')
      .slice(0, 400);
  }
  return { scan, safeLabel, overlapBytes };
}
