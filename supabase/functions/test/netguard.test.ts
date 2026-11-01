// netguard (slice 5.2): which addresses a customer's request must never reach, and the host check that resolves a name first.
import { hostProblem, isPrivateAddress, parseV6 } from '../_shared/netguard.ts';
import { assert, eq, t } from './util.ts';
import { answers, nowhere } from './screens-util.ts';

const PRIVATE = [
  '0.0.0.0', '0.1.2.3', '10.0.0.1', '10.255.255.255', '100.64.0.1', '100.127.255.255', '127.0.0.1', '127.255.255.254', '169.254.169.254', '172.16.0.1', '172.31.255.255',
  '192.0.0.1', '192.0.2.7', '192.168.0.1', '192.168.255.255', '198.18.0.1', '198.19.255.255', '198.51.100.9', '203.0.113.9', '224.0.0.1', '239.255.255.255', '240.0.0.1', '255.255.255.255',
  '::', '::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '64:ff9b::7f00:1', '64:ff9b::a00:1', '::127.0.0.1', '2002:7f00:1::', '2002:a00:1::1',
  'fc00::1', 'fd12:3456::1', 'fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'fe80::1', 'febf::1', 'fec0::1', 'ff02::1', 'ff00::', '2001:db8::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2', '100::1', 'fe80::1%eth0',
  'not an address', '', '1.2.3', '256.1.1.1', '1.2.3.256', '8.8.8.300', '1.256.1.1', '01.2.3.4', '1.2.3.4.5', '::g', '1:2:3:4:5:6:7:8:9', ':::',
];
const PUBLIC = ['1.1.1.1', '8.8.8.8', '93.184.216.34', '11.0.0.1', '100.63.255.255', '100.128.0.1', '126.255.255.255', '128.0.0.1', '169.253.0.1', '169.255.0.1', '172.15.255.255', '172.32.0.1',
  '191.255.255.255', '192.0.1.1', '192.167.255.255', '192.169.0.1', '198.17.255.255', '198.20.0.1', '223.255.255.255',
  '2606:4700:4700::1111', '2606:2800:220:1:248:1893:25c8:1946', '2001:4860:4860::8888', '::ffff:8.8.8.8', '64:ff9b::808:808', '2002:808:808::1', '2a00:1450:4001::1'];

t('netguard: every private, loopback, link-local, unique-local, multicast, reserved, documentation and malformed address is refused', () => {
  for (const ip of PRIVATE) assert(isPrivateAddress(ip), `${JSON.stringify(ip)} must be refused`);
});

t('netguard: public addresses of both families are allowed, at the edge of each private range too', () => {
  for (const ip of PUBLIC) assert(!isPrivateAddress(ip), `${ip} must be allowed`);
});

t('netguard: IPv6 text is parsed into eight groups, with :: and a dotted tail', () => {
  eq(parseV6('::1')?.join(), '0,0,0,0,0,0,0,1', '::1'); eq(parseV6('2001:db8::')?.join(), '8193,3512,0,0,0,0,0,0', 'trailing ::');
  eq(parseV6('::ffff:1.2.3.4')?.join(), '0,0,0,0,0,65535,258,772', 'dotted tail'); eq(parseV6('1:2:3:4:5:6:7:8')?.length, 8, 'eight groups');
  eq(parseV6('1:2:3'), null, 'too short'); eq(parseV6('1::2::3'), null, 'two ::'); eq(parseV6('hello'), null, 'text');
});

t('netguard: hostProblem resolves A and AAAA and refuses when any answer is private or nothing answers; a number is checked without a lookup', async () => {
  eq(await hostProblem('hooks.example.com', answers(['93.184.216.34'], ['2606:4700::1'])), null, 'public');
  eq(await hostProblem('HOOKS.example.com.', answers(['93.184.216.34'])), null, 'a trailing dot and case');
  assert(await hostProblem('x.example.com', answers(['93.184.216.34', '127.0.0.1'])), 'one private IPv4 among public ones');
  assert(await hostProblem('x.example.com', answers(['93.184.216.34'], ['::1'])), 'a private IPv6 beside a public IPv4');
  assert(await hostProblem('x.example.com', answers([], ['fd00::1'])), 'a private IPv6 alone');
  assert(await hostProblem('x.example.com', nowhere), 'a name that does not resolve is refused (fail closed)');
  assert(await hostProblem('x.example.com', answers([], [])), 'an empty answer is refused too');
  assert(await hostProblem('x.example.com', answers(['not-an-address'])), 'an answer that is not an address is refused');
  let asked = 0;
  const spy = (h: string, ty: 'A' | 'AAAA') => { asked++; return answers(['93.184.216.34'])(h, ty); };
  assert(await hostProblem('169.254.169.254', spy), 'a private number'); assert(await hostProblem('[::1]', spy), 'a bracketed IPv6 loopback');
  eq(await hostProblem('93.184.216.34', spy), null, 'a public number'); eq(asked, 0, 'no lookup for a number');
  assert(await hostProblem('', spy), 'no host');
  const seen: string[] = [];
  await hostProblem('NAME.Example.com.', (h, ty) => { seen.push(`${h}/${ty}`); return Promise.resolve(['93.184.216.34']); });
  eq(seen.join(), 'name.example.com/A,name.example.com/AAAA', 'both record types are asked, for the name in lower case without its final dot');
});

t('netguard: the runtime resolver can be called (a lookup that fails is a refusal, not a crash)', async () => {
  const why = await hostProblem('no-such-host.invalid');
  assert(typeof why === 'string' && why.length > 0, 'a name that cannot exist is refused: ' + why);
  const local = await hostProblem('localhost');
  assert(typeof local === 'string', 'localhost is refused whether it resolves to loopback or not at all: ' + local);
});
