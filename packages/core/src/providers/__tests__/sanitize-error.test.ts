import { describe, expect, it } from 'vitest';
import { MAX_PROVIDER_ERROR_MESSAGE_LENGTH, sanitizeProviderErrorMessage } from '../sanitize-error';

describe('sanitizeProviderErrorMessage', () => {
  it('keeps ordinary provider messages untouched (idempotent passthrough)', () => {
    for (const message of [
      '余额不足，请充值后重试',
      'fetch failed',
      'Incorrect API key provided',
      '已取消',
      '图片读取失败，请重新选择',
    ]) {
      expect(sanitizeProviderErrorMessage(message)).toBe(message);
    }
  });

  it('redacts bearer tokens and authorization headers', () => {
    const sanitized = sanitizeProviderErrorMessage(
      '401 unauthorized, request sent with Authorization: Bearer sk-abcdEFGH12345678 header',
    );
    expect(sanitized).not.toContain('sk-abcdEFGH12345678');
    expect(sanitized).toContain('Authorization: [密钥已隐藏]');
  });

  it('redacts api-key-like assignments and sk- literals', () => {
    const sanitized = sanitizeProviderErrorMessage(
      'upstream rejected: api_key=sk-tvtmiddleware987654321, api-key: "abcdef123456", sk-proj-AAAABBBBCCCC1111 expired',
    );
    expect(sanitized).not.toContain('sk-tvtmiddleware987654321');
    expect(sanitized).not.toContain('abcdef123456');
    expect(sanitized).not.toContain('sk-proj-AAAABBBBCCCC1111');
    expect(sanitized).toContain('api_key=[密钥已隐藏]');
  });

  it('redacts signed urls entirely while keeping plain urls', () => {
    const sanitized = sanitizeProviderErrorMessage(
      '下载失败 https://cdn.example.com/a.png?X-Amz-Signature=deadbeefdeadbeefdeadbeefdeadbeefdeadbeef&Expires=1750000000 以及 https://img.test/b.png?token=abcdefghij1234567890abcd 与 https://api.example.com/v1/images/generations',
    );
    expect(sanitized).not.toContain('X-Amz-Signature');
    expect(sanitized).not.toContain('token=abcdefghij');
    expect(sanitized).not.toContain('cdn.example.com');
    expect(sanitized).toContain('https://api.example.com/v1/images/generations');
  });

  it('redacts absolute local paths (posix and windows) but keeps url paths', () => {
    const sanitized = sanitizeProviderErrorMessage(
      '无法读取 /Users/wangwei/Project/secret.png，C:\\Users\\wangwei\\AppData\\key.txt 也失败，详见 https://api.test/v1/images/edits',
    );
    expect(sanitized).not.toContain('/Users/wangwei');
    expect(sanitized).not.toContain('AppData');
    expect(sanitized).toContain('[本地路径]');
    expect(sanitized).toContain('https://api.test/v1/images/edits');
  });

  it('strips stack frames but keeps the leading message', () => {
    const sanitized = sanitizeProviderErrorMessage(
      'Error: connect ECONNREFUSED\n    at TCPConnectWrap.afterConnect (node:net:1607:16)\n    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)',
    );
    expect(sanitized).toBe('Error: connect ECONNREFUSED');
  });

  it('does not strip prose that merely contains "at ... without frames"', () => {
    const sanitized = sanitizeProviderErrorMessage('生成至少需要一张参考图，at least one image');
    expect(sanitized).toContain('at least one image');
  });

  it('extracts readable message from raw json bodies and redacts the rest', () => {
    const sanitized = sanitizeProviderErrorMessage(
      '400 {"error":{"message":"Invalid value for size","type":"invalid_request_error","param":"size"}}',
    );
    expect(sanitized).toContain('Invalid value for size');
    expect(sanitized).not.toContain('"type"');
    expect(sanitized).not.toContain('{');
  });

  it('sanitizes secrets found inside extracted json messages', () => {
    const sanitized = sanitizeProviderErrorMessage(
      '{"error":{"message":"Incorrect API key provided: sk-AAAABBBBCCCC9999","code":"invalid_api_key"}}',
    );
    expect(sanitized).not.toContain('sk-AAAABBBBCCCC9999');
    expect(sanitized).toContain('Incorrect API key provided');
  });

  it('hides json bodies without a readable message', () => {
    const sanitized = sanitizeProviderErrorMessage('502 {"code":-32000,"data":null}');
    expect(sanitized).not.toContain('-32000');
    expect(sanitized).toContain('[原始响应已隐藏]');
  });

  it('redacts jwt-like dotted blobs and long opaque blobs', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4';
    const hex = 'a'.repeat(64);
    const sanitized = sanitizeProviderErrorMessage(`会话校验失败 ${jwt} 与签名 ${hex}`);
    expect(sanitized).not.toContain(jwt);
    expect(sanitized).not.toContain(hex);
  });

  it('bounds message length and stays idempotent after truncation', () => {
    const long = `${'错'.repeat(2000)}`;
    const sanitized = sanitizeProviderErrorMessage(long);
    expect(sanitized.length).toBe(MAX_PROVIDER_ERROR_MESSAGE_LENGTH);
    expect(sanitizeProviderErrorMessage(sanitized)).toBe(sanitized);
  });

  it('falls back for empty input and non-string input', () => {
    expect(sanitizeProviderErrorMessage('')).toBe('生成失败');
    expect(sanitizeProviderErrorMessage(undefined)).toBe('生成失败');
    expect(sanitizeProviderErrorMessage(null, '连接失败')).toBe('连接失败');
  });

  it('is idempotent across every redaction category', () => {
    const samples = [
      'Authorization: Bearer sk-AAAABBBBCCCC1234 被拒绝',
      'api_key = "zzz-secret-999888" 无效',
      '下载 https://cdn.test/x.png?Signature=abcdef0123456789abcdef0123456789 失败',
      '读取 /Users/wangwei/Pictures/a.png 失败',
      'Error: boom\n    at fn (/Users/wangwei/app/main.ts:12:3)',
      '上游返回 {"error":{"message":"quota exhausted for key sk-AAAABBBBCCCC5678"}}',
      `超长消息 ${'x'.repeat(800)}`,
    ];
    for (const sample of samples) {
      const once = sanitizeProviderErrorMessage(sample);
      expect(sanitizeProviderErrorMessage(once)).toBe(once);
      expect(once.length).toBeLessThanOrEqual(MAX_PROVIDER_ERROR_MESSAGE_LENGTH);
    }
  });
});
