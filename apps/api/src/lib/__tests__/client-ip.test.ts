import { describe, expect, it } from 'vitest';
import { clientIpResolver, compileTrustedProxy } from '../client-ip.js';

describe('trusted proxy rules and address normalization', () => {
  it.each([
    ['loopback', '127.0.0.2', true],
    ['loopback', '::1', true],
    ['loopback', '::ffff:127.0.0.1', true],
    ['loopback', '192.0.2.1', false],
    ['linklocal', 'fe80::1', true],
    ['uniquelocal', 'fd12::1', true],
    ['2001:db8::/32', '2001:db8:1::1', true],
    ['2001:db8::/32', '2001:db9::1', false],
    ['192.0.2.10/32', '192.0.2.10', true],
    ['192.0.2.10/32', '192.0.2.11', false],
  ] as const)('%s matches %s only when explicitly covered', (rule, address, expected) => {
    expect(compileTrustedProxy(rule)(address)).toBe(expected);
  });
  it('does not trust the rest of a chain after the first untrusted IPv6 hop', () => {
    expect(
      clientIpResolver('loopback,2001:db8:1::/48')(
        '::1',
        '198.51.100.9,2001:db8:2::4,2001:db8:1::5',
      ),
    ).toBe('2001:db8:2::4');
  });
  it.each([undefined, 'hostname.test', 'bad', 'fe80::1%lo0'])(
    'missing or invalid socket evidence %s cannot be replaced by a header',
    (remote) => {
      expect(clientIpResolver('loopback')(remote, '198.51.100.1')).toBe('unknown');
    },
  );
  it('bounds forwarded header bytes independently of hop count', () => {
    expect(clientIpResolver('loopback')('127.0.0.1', `${' '.repeat(4096)}198.51.100.1`)).toBe(
      '127.0.0.1',
    );
  });
});
