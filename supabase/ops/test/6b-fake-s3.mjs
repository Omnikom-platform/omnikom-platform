// A small S3-compatible server for the 6B tests. It is the "other side" of backup.mjs, written separately from it: it does NOT
// import the signer. It rebuilds the canonical request from the bytes it actually received (the raw request path, the received headers,
// the hash of the received body) and accepts a request only when the Signature in the Authorization header equals its own result.
// So a signer that signs one thing and sends another is refused here with 403, as a real bucket would.
// Modes (set on the returned object): failFirst (answer 500 to the first PUT), truncate (store one byte less: the size check must catch it),
// denyAll (403). Objects land in `objects` (Map of "bucket/key" -> Buffer).
import { createServer } from 'node:http';
import { createHash, createHmac } from 'node:crypto';

export async function startFakeS3({ accessKey = 'TESTACCESSKEYID', secretKey = 'test-secret-key-not-a-real-one', region = 'auto' } = {}) {
  const objects = new Map();
  const state = { failFirst: false, truncate: false, denyAll: false, puts: 0, heads: 0, refused: 0 };
  const hex = b => createHash('sha256').update(b).digest('hex');
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const reply = (code, headers = {}) => { res.writeHead(code, headers); res.end(); };
      const auth = req.headers.authorization || '';
      const m = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, SignedHeaders=([a-z0-9;-]+), Signature=([0-9a-f]{64})$/.exec(auth);
      let ok = !!m && !state.denyAll && m[1] === accessKey && m[3] === region;
      if (ok) {
        const [, , day, , signedList, sig] = m;
        const names = signedList.split(';');
        const hdr = n => String(req.headers[n] ?? '').trim();
        const claimedHash = hdr('x-amz-content-sha256');
        const canonical = [req.method, req.url.split('?')[0], req.url.includes('?') ? req.url.split('?')[1] : '',
          names.map(n => `${n}:${hdr(n)}\n`).join(''), signedList, claimedHash].join('\n');
        const date = hdr('x-amz-date');
        const toSign = ['AWS4-HMAC-SHA256', date, `${day}/${region}/s3/aws4_request`, hex(canonical)].join('\n');
        let k = createHmac('sha256', `AWS4${secretKey}`).update(day).digest();
        for (const part of [region, 's3', 'aws4_request']) k = createHmac('sha256', k).update(part).digest();
        const want = createHmac('sha256', k).update(toSign).digest('hex');
        ok = want === sig && date.startsWith(day) && claimedHash === hex(body) && names.includes('host') && names.includes('x-amz-date') && names.includes('x-amz-content-sha256');
      }
      if (!ok) { state.refused++; return reply(403); }
      const id = decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '');
      if (req.method === 'PUT') {
        state.puts++;
        if (state.failFirst && state.puts === 1) return reply(500);
        objects.set(id, state.truncate ? body.subarray(0, body.length - 1) : body);
        return reply(200, { etag: '"x"' });
      }
      if (req.method === 'HEAD') {
        state.heads++;
        const o = objects.get(id);
        return o ? reply(200, { 'content-length': String(o.length) }) : reply(404);
      }
      reply(405);
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  return { endpoint, accessKey, secretKey, region, objects, state, close: () => new Promise(r => { server.closeAllConnections?.(); server.close(r); }) };
}
