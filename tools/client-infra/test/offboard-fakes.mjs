// In-memory stand-ins for offboard-live.mjs: the workspace, privacy requests, leads, sites, keys, Pages projects, Storage and the
// export folder. `writes` lists every write anywhere (database, Cloudflare, disk), so a test can say "nothing was written".
// The state and ticket moves enforce the database's own legal moves (service.set_workspace_state, set_privacy_request_state).
export const WS = '11111111-1111-4111-8111-111111111111';
export const OTHER_WS = '22222222-2222-4222-8222-222222222222';
export const TICKET = '33333333-3333-4333-8333-333333333333';
export const SITE = '44444444-4444-4444-8444-444444444444';

export function newWorld() {
  return {
    ws: { id: WS, slug: 'test-wo37', state: 'active', state_changed_at: null },
    staff: true,
    tickets: [{ id: TICKET, workspace_id: WS, kind: 'delete', state: 'received', subject: 'Erase-Me@Example.com', lead_ids: ['lead-1'] }],
    leads: [
      { id: 'lead-1', ws: WS, name: 'Erase Me', email: 'erase-me@example.com', phone: '(555) 555-0137' },
      { id: 'lead-2', ws: WS, name: 'Keep Me', email: 'keep-me@example.com', phone: '(555) 555-0138' },
      { id: 'lead-x', ws: OTHER_WS, name: 'Other', email: 'erase-me@example.com', phone: null },
    ],
    residue: [],   // rows delete_lead does not remove: { table, text }
    sites: [{ id: SITE, deploy_target: 'test-site-wo37', domain: 'wo37-test.example.com' }],
    keys: [{ id: 'key-1', site: SITE, vault_ref: 'site-test-wo37-key-1', revoked: false }],
    projects: { 'test-site-wo37': { domains: ['wo37-test.example.com'] } },
    objects: [{ name: `${WS}/logo.png`, body: Buffer.from('a test image') }],
    files: new Map(),
    audit: [],
    writes: [],
    countLie: null,    // a table whose count(*) says one more than its rows
    sizeLie: false,    // Storage metadata says another size than the bytes
    keyStaysActive: false,
    scanBlind: false,  // the scan misses every table (the export's own check must still catch the person)
  };
}

const lc = (s) => String(s || '').trim().toLowerCase();
const digits = (s) => String(s || '').replace(/[^0-9]/g, '');

export function offboardFakeDeps(w, lines = []) {
  const write = (what) => w.writes.push(what);
  const matches = (l, subject) => lc(l.email) === lc(subject) || (digits(subject).length >= 7 && digits(l.phone).slice(-10) === digits(subject).slice(-10));
  const rowText = (key) => (t) => (key.email ? lc(t).includes(key.email) : new RegExp(key.digits.split('').join('[-. ()+]{0,3}')).test(t));
  const tables = () => ({
    leads: w.leads.filter((l) => l.ws === WS).map((l) => ({ ...l })),
    messages: w.residue.map((r) => ({ table: r.table, text: r.text })),
    sites: w.sites.map((s) => ({ ...s })),
    api_keys: w.keys.map((k) => ({ id: k.id, site_id: k.site, vault_ref: k.vault_ref, revoked: k.revoked })),
    audit_log: w.audit.map((a) => ({ ...a })),
    privacy_requests: w.tickets.filter((t) => t.workspace_id === WS).map((t) => ({ ...t })),
  });
  const db = {
    async workspace(slug) { return slug === w.ws.slug ? { ...w.ws } : null; },
    async staffOk() { return w.staff; },
    async setState(id, state, reason) {
      if (!(['active', 'suspended'].includes(w.ws.state) && state === 'offboarding')) throw new Error(`S-WORKSPACE-STATE: ${w.ws.state} -> ${state} is not allowed`);
      w.ws.state = state; w.ws.state_reason = reason; write(`state ${state}`);
    },
    async ticket(id) { const t = w.tickets.find((x) => x.id === id); return t ? JSON.parse(JSON.stringify(t)) : null; },
    async subjectLeads(ws, subject, ids) { return w.leads.filter((l) => l.ws === ws && (ids.includes(l.id) || matches(l, subject))).map((l) => l.id).sort(); },
    async deleteLead(id) { const i = w.leads.findIndex((l) => l.id === id); if (i < 0) throw new Error('S-NOT-FOUND'); w.leads.splice(i, 1); w.audit.push({ action: 'lead-delete', target: id }); write(`delete ${id}`); },
    async setTicket(id, state, notes) {
      const t = w.tickets.find((x) => x.id === id);
      const legal = [['received', 'verifying'], ['received', 'in-progress'], ['received', 'refused'], ['verifying', 'in-progress'], ['verifying', 'refused'], ['in-progress', 'done'], ['in-progress', 'refused']];
      if (!legal.some(([a, b]) => a === t.state && b === state)) throw new Error(`P-STATE: ${t.state} -> ${state} is not allowed`);
      t.state = state; if (notes) t.notes = notes; write(`ticket ${state}`);
    },
    async scan(ws, key) {
      if (w.scanBlind) return [];
      const hit = rowText(key);
      const out = [];
      const n = w.leads.filter((l) => l.ws === ws && hit(JSON.stringify(l))).length;
      if (n) out.push({ table: 'leads', n });
      for (const r of w.residue) if (hit(r.text)) out.push({ table: r.table, n: 1 });
      return out;
    },
    async exportPlan() { const t = tables(); return { rows: Object.values(t).reduce((a, r) => a + r.length, 0), tables: Object.keys(t).length, logins: 1, files: w.objects.length }; },
    async exportData() {
      const t = tables();
      const counts = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.length + (w.countLie === k ? 1 : 0)]));
      return { workspace: { ...w.ws }, tables: t, counts, logins: [{ user_id: 'u1', email: 'owner@test-wo37.example.com', role: 'owner' }] };
    },
    async sites() { return w.sites.map((s) => ({ ...s })); },
    async clearSiteDomain(id, domain) { const s = w.sites.find((x) => x.id === id && x.domain === domain); if (!s) throw new Error('0 rows changed, expected 1'); s.domain = null; w.audit.push({ action: 'site-domain-detach', target: id }); write(`clear domain ${domain}`); },
    async activeKeys(site) { return w.keys.filter((k) => k.site === site && !k.revoked).map((k) => ({ id: k.id, vault_ref: k.vault_ref })); },
    async revokeKey(site, id) { const k = w.keys.find((x) => x.id === id && x.site === site && !x.revoked); if (!k) throw new Error('0 rows changed, expected 1'); if (!w.keyStaysActive) k.revoked = true; w.audit.push({ action: 'key-revoke', target: id }); write(`revoke ${id}`); },
    async audit(ws, action, target) { w.audit.push({ action, target }); write(`audit ${action}`); },
  };
  const storage = {
    async list() { return w.objects.map((o) => ({ name: o.name, size: o.body.length + (w.sizeLie ? 5 : 0) })); },
    async get(name) { return Buffer.from(w.objects.find((o) => o.name === name).body); },
  };
  const cf = {
    async getProject(name) { return w.projects[name] ? { name } : null; },
    async listDomains(name) { return (w.projects[name] ? w.projects[name].domains : []).map((h) => ({ name: h })); },
    async detachDomain(name, host) { const p = w.projects[name]; if (!p || !p.domains.includes(host)) throw new Error('not attached'); p.domains = p.domains.filter((h) => h !== host); write(`detach ${host}`); },
    async deleteProject(name) { if (!w.projects[name]) throw new Error('no project'); delete w.projects[name]; write(`delete project ${name}`); },
  };
  const fs = {
    exists: (p) => w.files.has(p),
    read: (p) => Buffer.from(w.files.get(p)),
    write: (p, b) => { w.files.set(p, Buffer.from(b)); write(`file ${p}`); },
  };
  return { db, storage, cf, fs, log: (l) => lines.push(l) };
}
