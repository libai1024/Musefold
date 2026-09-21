import { BlockList, isIP, SocketAddress } from 'node:net';

const NAMED_RANGES: Record<string, readonly string[]> = {
  loopback: ['127.0.0.0/8', '::1/128'],
  linklocal: ['169.254.0.0/16', 'fe80::/10'],
  uniquelocal: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', 'fc00::/7'],
};

function normalizedIp(value: string | undefined): string | null {
  if (!value || value.includes('%')) return null;
  const family = isIP(value);
  if (!family) return null;
  const address = new SocketAddress({ address: value, family: family === 6 ? 'ipv6' : 'ipv4' })
    .address;
  // IPv4-mapped IPv6 must not allocate a second bucket for the same source.
  return address.startsWith('::ffff:') && isIP(address.slice(7)) === 4 ? address.slice(7) : address;
}

/** Explicit addresses/CIDRs only; no hop count, hostnames or trust-all shortcuts. */
export function compileTrustedProxy(configuration: string): (address: string) => boolean {
  if (configuration === 'false') return () => false;
  if (!configuration || configuration.length > 2048) throw new Error('Invalid trusted proxy rules');
  const list = new BlockList();
  const rules = configuration.split(',').map((rule) => rule.trim());
  for (const rule of rules.flatMap((item) => NAMED_RANGES[item] ?? [item])) {
    const [address, prefixText, extra] = rule.split('/');
    const family = isIP(address);
    if (!family || address.includes('%') || extra !== undefined)
      throw new Error('Invalid trusted proxy rule');
    const type = family === 6 ? 'ipv6' : 'ipv4';
    if (prefixText === undefined) list.addAddress(address, type);
    else {
      const prefix = Number(prefixText);
      if (!/^[1-9]\d*$/.test(prefixText) || prefix > (family === 6 ? 128 : 32))
        throw new Error('Invalid trusted proxy subnet');
      list.addSubnet(address, prefix, type);
    }
  }
  return (address) => list.check(address, isIP(address) === 6 ? 'ipv6' : 'ipv4');
}

export function validTrustedProxy(configuration: string): boolean {
  try {
    compileTrustedProxy(configuration);
    return true;
  } catch {
    return false;
  }
}

/** Resolve from the real socket inward, stopping at the first untrusted hop. */
export function clientIpResolver(configuration: string) {
  const trusted = compileTrustedProxy(configuration);
  return (remoteAddress: string | undefined, forwarded: string | undefined): string => {
    const peer = normalizedIp(remoteAddress);
    if (!peer) return 'unknown';
    if (!trusted(peer) || !forwarded) return peer;
    if (forwarded.length > 4096) return peer;
    const chain = forwarded.split(',');
    if (chain.length > 32) return peer;
    const addresses = chain.map((value) => normalizedIp(value.trim()));
    if (addresses.some((address) => address === null)) return peer;
    let current = peer;
    for (let i = addresses.length - 1; i >= 0 && trusted(current); i--) {
      const next = addresses[i];
      if (!next) return peer;
      current = next;
    }
    return current;
  };
}
