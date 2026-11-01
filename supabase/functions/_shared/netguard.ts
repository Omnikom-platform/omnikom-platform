// Where an Edge Function may send a request on a customer's behalf (slice 5.2: the CRM webhook test, and the host check when the address is saved).
// SQL checks the TEXT of an address (migration 12, private.crm_url_problem). It cannot see DNS: a public-looking name can point at 10.0.0.5,
// 127.0.0.1 or the cloud metadata address 169.254.169.254. So before a request goes out, the host is resolved here (A and AAAA) and the request is
// refused when ANY answer is private, loopback, link-local, unique-local, multicast, reserved or documentation space, or when the name does not
// resolve at all (fail closed). A host written as a number is checked as it is, without DNS.
// Known limit, said plainly: the check resolves, then fetch resolves again. A name that changes its answer between the two (DNS rebinding) is not
// stopped by this code; Deno's fetch cannot be pointed at a checked address. Redirects are never followed (the caller sets redirect: 'manual').
export type Resolve = (host: string, type: 'A' | 'AAAA') => Promise<string[]>;

/** The runtime's resolver. An unsupported or failing lookup throws; the caller treats a throw for BOTH types as "does not resolve". */
export const systemResolve: Resolve = (host, type) => Deno.resolveDns(host, type);

const v4 = /^(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})$/;

/** Four plain numbers to an array, or null when it is not an IPv4 address. */
export function parseV4(s: string): number[] | null {
  const m = v4.exec(s);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.every(n => n <= 255) ? o : null;
}

export function privateV4(o: number[]): boolean {
  const [a, b, c] = o;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113);
}

/** Eight 16-bit groups of an IPv6 address (a dotted IPv4 tail allowed), or null when it is not one. */
export function parseV6(s: string): number[] | null {
  let t = s.toLowerCase();
  const zone = t.indexOf('%');
  if (zone >= 0) t = t.slice(0, zone);
  if (!/^[0-9a-f:.]+$/.test(t) || !t.includes(':')) return null;
  const tail = t.slice(t.lastIndexOf(':') + 1);
  if (tail.includes('.')) {
    const o = parseV4(tail);
    if (!o) return null;
    t = t.slice(0, t.lastIndexOf(':') + 1) + ((o[0] << 8) | o[1]).toString(16) + ':' + ((o[2] << 8) | o[3]).toString(16);
  }
  const halves = t.split('::');
  if (halves.length > 2) return null;
  const side = (x: string) => x === '' ? [] : x.split(':');
  const head = side(halves[0]), rest = halves.length === 2 ? side(halves[1]) : [];
  const groups = halves.length === 2 ? [...head, ...Array(8 - head.length - rest.length).fill('0'), ...rest] : head;
  if (groups.length !== 8 || groups.some(g => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map(g => parseInt(g, 16));
}

export function privateV6(g: number[]): boolean {
  // :: (unspecified) and ::1 (loopback) are caught by the IPv4-compatible rule below: their last 32 bits are 0.0.0.0 and 0.0.0.1, inside 0/8
  const embedded = (hi: number, lo: number) => privateV4([hi >> 8, hi & 255, lo >> 8, lo & 255]);
  if (g.slice(0, 5).every(x => x === 0) && g[5] === 0xffff) return embedded(g[6], g[7]);   // ::ffff:a.b.c.d (IPv4-mapped)
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every(x => x === 0)) return embedded(g[6], g[7]);   // 64:ff9b::/96 (NAT64)
  if (g.slice(0, 6).every(x => x === 0)) return embedded(g[6], g[7]);               // ::a.b.c.d (IPv4-compatible, deprecated)
  if (g[0] === 0x2002) return embedded(g[1], g[2]);                                 // 2002::/16 (6to4 carries an IPv4 address)
  if ((g[0] & 0xfe00) === 0xfc00) return true;                                      // fc00::/7 unique-local
  if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return true;        // fe80::/10 link-local, fec0::/10 site-local
  if ((g[0] & 0xff00) === 0xff00) return true;                                      // ff00::/8 multicast
  if (g[0] === 0x2001 && (g[1] === 0x0db8 || g[1] === 0)) return true;              // 2001:db8::/32 documentation, 2001::/32 Teredo
  if (g[0] === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true;        // 100::/64 discard
  return false;
}

/** True when an address (either family) is one a customer's request must never reach. Text that is not an address counts as private (fail closed). */
export function isPrivateAddress(ip: string): boolean {
  const a = parseV4(ip);
  if (a) return privateV4(a);
  const b = parseV6(ip);
  return b ? privateV6(b) : true;
}

/** null = this host may be called; otherwise the plain reason it may not. Resolves with `resolve` (the runtime's by default). */
export async function hostProblem(hostname: string, resolve: Resolve = systemResolve): Promise<string | null> {
  const host = hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!host) return 'The address has no host name.';
  if (parseV4(host) || parseV6(host)) return isPrivateAddress(host) ? 'The address points inside a private network, so Omnikom will not call it.' : null;
  const found: string[] = [];
  for (const type of ['A', 'AAAA'] as const) {
    try { found.push(...await resolve(host, type)); } catch { /* no records of this type */ }
  }
  if (!found.length) return 'That host name could not be found.';
  if (found.some(isPrivateAddress)) return 'The address points inside a private network, so Omnikom will not call it.';
  return null;
}
