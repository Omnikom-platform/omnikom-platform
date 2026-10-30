// Sends one plain test email through Resend to prove the verified domain and the key (25-BUILD-SEQUENCE 1.4 "done when").
//   node tools/with-env.mjs "<env file>" -- node tools/resend-test-email.mjs --to <address>
// Reads RESEND_API_KEY and LEAD_ALERT_FROM by name; prints only the HTTP status and the message id.
const argv = process.argv.slice(2);
const to = argv[argv.indexOf('--to') + 1];
const key = process.env.RESEND_API_KEY, from = process.env.LEAD_ALERT_FROM;
if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) { console.error('usage: --to <address>'); process.exit(2); }
if (!key || !from) { console.error('set RESEND_API_KEY and LEAD_ALERT_FROM (by name)'); process.exit(2); }
const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
const r = await fetch('https://api.resend.com/emails', {
  method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(30000),
  body: JSON.stringify({ from: `Omnikom Platform <${from}>`, to: [to], subject: `Omnikom platform: Resend test ${stamp} UTC`, text: `This is the test email for step 1.4 of the build sequence (sent ${stamp} UTC from ${from}). Nothing to do.` }),
});
const body = await r.text();
console.log(`Resend send: HTTP ${r.status} ${r.ok ? 'id=' + (JSON.parse(body).id || '?') : body.split(key).join('<key>').slice(0, 200)}`);
process.exit(r.ok ? 0 : 1);
