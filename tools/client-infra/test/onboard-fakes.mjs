// In-memory stand-ins for onboard-live.mjs: the CLI's seed workspace, the database rows onboarding reads and writes, invite-member
// and provision.mjs. `writes` lists every write, `mails` every invite mail, so a test can say "nothing was written, no mail".
let n = 0;
// Postgres jsonb keeps object keys shorter-first, then by bytes; stored rows come back in that order, as on staging.
const jsonbOrder = (v) => (Array.isArray(v) ? v.map(jsonbOrder) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)).map((k) => [k, jsonbOrder(v[k])])) : v);
const id = () => `${String(++n).padStart(8, '0')}-0000-4000-8000-000000000000`;

export function newWorld() {
  return { workspaces: [], rows: [], members: [], writes: [], mails: [], provisioned: {}, inviteAnswer: { status: 200, emailSent: true }, provisionExit: 0 };
}

export function onboardFakeDeps(w, lines = []) {
  const write = (what) => w.writes.push(what);
  const cli = {
    async seedWorkspace(a, dryRun) {
      if (dryRun) return { ok: true, code: 'ok', pages: 3, places: 1 };
      let ws = w.workspaces.find((x) => x.slug === a.slug), changed = false;
      if (!ws) { ws = { id: id(), slug: a.slug, deploy_target: a.deployTarget }; w.workspaces.push(ws); changed = true; write('seed workspace'); }
      return { ok: true, code: 'ok', changed, contractVersion: 1, pagesStored: 3 };
    },
  };
  const db = {
    async getWorkspace(slug) { const x = w.workspaces.find((y) => y.slug === slug); return x ? { id: x.id, deploy_target: x.deploy_target } : null; },
    async rows(ws, coll) { return w.rows.filter((r) => r.ws === ws && r.coll === coll).map((r) => ({ id: r.id, data: JSON.parse(JSON.stringify(r.data)) })); },
    async seedRow(ws, coll, data) {
      if (coll === 'settings' && w.rows.some((r) => r.ws === ws && r.coll === 'settings')) throw new Error('S-SINGLETON');
      const r = { id: id(), ws, coll, data: jsonbOrder(data) }; w.rows.push(r); write(`seed ${coll}`); return r.id;
    },
    async memberByEmail(ws, email) { const m = w.members.find((x) => x.ws === ws && x.email === email); return m ? { role: m.role } : null; },
  };
  async function invite(body) {
    write('invite'); w.mails.push(body.email);
    w.members.push({ ws: body.workspace, email: body.email, role: body.role, teamRow: body.team_row });
    return { status: w.inviteAnswer.status, text: '', json: w.inviteAnswer.status === 200 ? { user: 'u', invited: true, email_sent: w.inviteAnswer.emailSent } : null };
  }
  async function provision({ site, dryRun }) {
    const first = !w.provisioned[site];
    if (!dryRun && first) { w.provisioned[site] = true; write('provision'); }
    const k = dryRun ? 'DRY RUN' : 'RESULT';
    return { status: w.provisionExit, stdout: `ok     site ${site}\n${k}: changed ${!dryRun && first ? 4 : 0}\n`, stderr: '' };
  }
  return { cli, db, invite, provision, log: (l) => lines.push(l) };
}
