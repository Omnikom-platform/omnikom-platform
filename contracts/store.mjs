// Reference model of how content rows behave (DECISIONS 6, TENANCY-AND-PUBLISHING 2-3), in memory.
// It is the specification the Supabase layer (step 3) must reproduce with tables + row-level security:
//   - every row belongs to one workspace, taken from the login, never from the form;
//   - every save is a new version (append-only); edits stay drafts until Publish; rollback = a new version copying an old one;
//   - locked fields: only Omnikom staff change them, and only with a recorded sign-off;
//   - members (e.g. an agent) edit only their own items where the collection says "own".
// Every refusal is { ok: false, code, msg }. Codes are listed in README.md.
import { mergeCore, validateItem, validateContract } from './validate.mjs';

const no = (code, msg) => ({ ok: false, code, msg });
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function createStore(contracts) {
  const sites = {};
  for (const [ws, contract] of Object.entries(contracts)) {
    const problems = validateContract(contract);
    if (problems.length) throw new Error(`contract for ${ws} is invalid: ${problems[0].code} ${problems[0].msg}`);
    sites[ws] = { contract, cols: mergeCore(contract), rows: new Map() };
  }
  let seq = 0;
  const now = () => new Date(Date.UTC(2026, 9, 28, 0, 0, seq++)).toISOString();

  function site(session) { return session && sites[session.workspace]; }
  function rowOf(s, collection, id) { const r = s.rows.get(id); return r && r.collection === collection ? r : null; }
  const latest = r => r.versions[r.versions.length - 1];

  function ownerOf(c, collection, id, data) {
    if (c.ownerField === 'self' && collection === 'team') return id;
    return data ? data[c.ownerField] : undefined;
  }

  function canTouch(session, s, collection, id, data) {
    const c = s.cols[collection];
    if (!c) return no('S-COLLECTION', `no collection "${collection}"`);
    if (session.role === 'staff' || session.role === 'owner') return { ok: true, c };
    if (session.role !== 'member') return no('S-ROLE', 'unknown role');
    if (c.access.member === 'none') return no('S-ROLE', `members cannot edit ${collection}`);
    if (c.access.member === 'own' && ownerOf(c, collection, id, data) !== session.teamId)
      return no('S-OWN-ONLY', `members edit only their own ${collection}`);
    return { ok: true, c };
  }

  // Checks locked fields at the top level and one level into groups/lists by comparing whole field values.
  function lockedChange(c, before, after) {
    if (!c) return null;
    for (const [name, f] of Object.entries(c.fields)) if (f.locked && !same(before && before[name], after[name])) return name;
    return null;
  }

  const api = {
    // payload: { collection, id?, data, workspace? (ignored only if it matches; any other value is refused) }
    save(session, payload) {
      const s = site(session);
      if (!s) return no('S-WORKSPACE', 'no workspace for this login');
      if (payload.workspace !== undefined && payload.workspace !== session.workspace)
        return no('S-WORKSPACE', 'workspace comes from the login, never from the form');
      const { collection } = payload;
      const existing = payload.id ? rowOf(s, collection, payload.id) : null;
      if (payload.id && !existing) return no('S-NOT-FOUND', 'not found'); // ids are assigned by the server; another workspace's id is "not found"
      const id = payload.id || `${session.workspace}:${collection}:${++seq}`;
      const before = existing ? latest(existing).data : null;
      let data = { ...payload.data };
      const c0 = s.cols[collection];
      if (c0 && session.role === 'member' && !existing && c0.access.member === 'own' && c0.ownerField !== 'self' && data[c0.ownerField] === undefined)
        data[c0.ownerField] = session.teamId;
      if (existing) { const gate = canTouch(session, s, collection, id, before); if (!gate.ok) return gate; }
      const gate = canTouch(session, s, collection, id, data);
      if (!gate.ok) return gate;
      const c = s.cols[collection];
      if (c && c.kind === 'singleton' && !existing && [...s.rows.values()].some(r => r.collection === collection))
        return no('S-SINGLETON', `${collection} has one row; edit it`);
      const changed = lockedChange(c, before, data);
      if (changed) {
        if (session.role !== 'staff') return no('S-LOCKED', `"${changed}" is locked; Omnikom changes it after sign-off`);
        if (!(payload.signOff && payload.signOff.by && payload.signOff.ref)) return no('S-SIGNOFF', `changing locked "${changed}" needs signOff { by, ref }`);
      }
      const problems = validateItem(s.contract, collection, data, { mode: 'draft', exists: (to, rid) => !!rowOf(s, to, rid) });
      if (problems.length) return { ...no('S-INVALID', problems.map(p => `${p.code} ${p.path}`).join('; ')), problems };
      const version = { n: existing ? latest(existing).n + 1 : 1, data, by: session.user, at: now(), signOff: changed ? payload.signOff : undefined };
      const row = existing || { id, workspace: session.workspace, collection, versions: [], publishedVersion: null };
      row.versions.push(version);
      s.rows.set(id, row);
      return { ok: true, id, version: version.n };
    },

    publish(session, collection, id) {
      const s = site(session);
      const row = s && rowOf(s, collection, id);
      if (!row) return no('S-NOT-FOUND', 'not found');
      const gate = canTouch(session, s, collection, id, latest(row).data);
      if (!gate.ok) return gate;
      if (s.cols[collection].kind === 'inbox') return no('S-KIND', `${collection} is an inbox, not published content`);
      const problems = validateItem(s.contract, collection, latest(row).data, { mode: 'publish', exists: (to, rid) => !!(rowOf(s, to, rid) && rowOf(s, to, rid).publishedVersion) });
      if (problems.length) return { ...no('S-PUBLISH-INVALID', problems.map(p => `${p.code} ${p.path}`).join('; ')), problems };
      row.publishedVersion = latest(row).n;
      return { ok: true, version: row.publishedVersion };
    },

    rollback(session, collection, id, toVersion, signOff) {
      const s = site(session);
      const row = s && rowOf(s, collection, id);
      if (!row) return no('S-NOT-FOUND', 'not found');
      const old = row.versions.find(v => v.n === toVersion);
      if (!old) return no('S-NOT-FOUND', `no version ${toVersion}`);
      return api.save(session, { collection, id, data: old.data, signOff });
    },

    remove(session, collection, id) {
      const s = site(session);
      const row = s && rowOf(s, collection, id);
      if (!row) return no('S-NOT-FOUND', 'not found');
      const gate = canTouch(session, s, collection, id, latest(row).data);
      if (!gate.ok) return gate;
      const c = s.cols[collection];
      let redirect = null;
      if (c.onDelete && row.publishedVersion) {
        const data = row.versions.find(v => v.n === row.publishedVersion).data;
        const target = rowOf(s, c.fields[c.onDelete.redirectToPageOf].to, data[c.onDelete.redirectToPageOf]);
        const page = target && s.contract.pages.find(p => p.type === c.onDelete.pageType && p.bind === latest(target).data.slug);
        const from = c.route.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, f) => data[f]);
        if (page) {
          const staff = { ...session, role: 'staff' };
          const r = api.save(staff, { collection: 'redirects', data: { from, to: page.path, code: '301' } });
          if (r.ok) { api.publish(staff, 'redirects', r.id); redirect = { from, to: page.path }; }
        }
      }
      s.rows.delete(id);
      return { ok: true, redirect };
    },

    get(session, collection, id) {
      const s = site(session);
      const row = s && rowOf(s, collection, id);
      return row ? { id, versions: row.versions.length, publishedVersion: row.publishedVersion, data: latest(row).data } : null;
    },

    history(session, collection, id) {
      const s = site(session);
      const row = s && rowOf(s, collection, id);
      return row ? row.versions.map(v => ({ n: v.n, by: v.by, at: v.at, published: v.n === row.publishedVersion })) : null;
    },

    // What a build of ONE site reads: only that workspace's published versions (TENANCY 3.2).
    published(workspace) {
      const s = sites[workspace];
      if (!s) return [];
      return [...s.rows.values()].filter(r => r.publishedVersion).map(r => ({
        id: r.id, collection: r.collection, data: r.versions.find(v => v.n === r.publishedVersion).data,
      }));
    },
  };
  return api;
}
