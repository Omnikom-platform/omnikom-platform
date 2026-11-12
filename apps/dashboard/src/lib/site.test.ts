// The pure parts of the Site screen. The contract here is a small one written for the tests; the app itself reads the workspace's own.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  canAdd, canDelete, changesBetween, checksLine, draftLink, clock, dropDraft, editorCards, failureLines, feedLine, getAt, humanize, keepDraft, leftOutLine, listCollections, loadDraft, overLimits, pathKey,
  progressLines, restoreSteps, rowTitle, sameData, setAt, siteUrl, slugify, staleLine, stateLine, stepWords, visibleTo, type Contract, type JobEvent,
} from './site';

const contract: Contract = {
  collections: {
    pages: { label: 'Pages', kind: 'collection', titleField: 'title', access: { member: 'none' }, fields: { path: { type: 'text', locked: { reason: 'routing' } }, title: { type: 'text', required: true, max: 10 }, seo: { type: 'seo' }, sections: { type: 'sections' } } },
    settings: { label: 'Business details', kind: 'singleton', access: { member: 'none' }, fields: { businessName: { type: 'text', max: 80 } } },
    listings: {
      label: 'listings', kind: 'collection', titleField: 'street', slugFrom: 'street', access: { member: 'own' }, ownerField: 'agent',
      fields: { street: { type: 'text', max: 20 }, slug: { type: 'slug' }, order: { type: 'number', internal: true }, features: { type: 'list', of: { name: { type: 'text', max: 5 } } }, photos: { type: 'gallery' }, seo: { type: 'seo' } },
    },
    team: { label: 'Team', kind: 'collection', titleField: 'name', access: { member: 'own' }, ownerField: 'self', fields: { name: { type: 'text' } } },
    areas: { label: 'Places', kind: 'collection', titleField: 'name', access: { member: 'none' }, fields: { name: { type: 'text' } } },
    media: { label: 'Photos', kind: 'collection', access: { member: 'own' }, fields: {} },
    leads: { label: 'Lead inbox', kind: 'inbox', access: { member: 'own' }, fields: {} },
  },
  pageTypes: {
    home: { sections: [
      { id: 'hero', kind: 'fields', fields: { heading: { type: 'text', max: 90 }, lead: { type: 'text' } } },
      { id: 'feed', kind: 'feed', accepts: 'listings' },
      { id: 'form', kind: 'form', form: 'contact' },
      { id: 'legal', kind: 'notice', notice: 'terms' },
    ] },
  },
  pages: [{ path: '/', type: 'home' }],
  placements: [{ collection: 'listings', to: { pageType: 'home', section: 'feed' }, sort: '-street' }],
};

describe('names', () => {
  it('opens a field name up for a person; an acronym stays an acronym', () => {
    expect(humanize('livingSqft')).toBe('Living sqft');
    expect(humanize('seo')).toBe('SEO');
    expect(humanize('postalCode')).toBe('Postal code');
    expect(humanize('coming-soon')).toBe('Coming soon');
  });
  it('makes a slug', () => {
    expect(slugify('12 Alpha Lane, Alpha!')).toBe('12-alpha-lane-alpha');
    expect(slugify('Café Noir')).toBe('cafe-noir');
  });
});

describe('values by path', () => {
  it('reads and writes a nested value without touching the original', () => {
    const a = { sections: { contact: { heading: 'Old' } } };
    const b = setAt(a, ['sections', 'contact', 'heading'], 'New');
    expect(getAt(b, ['sections', 'contact', 'heading'])).toBe('New');
    expect(a.sections.contact.heading).toBe('Old');
  });
  it('clearing the last value removes the key and the objects that held only it', () => {
    expect(setAt({ sections: { contact: { heading: 'x' } }, title: 'T' }, ['sections', 'contact', 'heading'], undefined)).toEqual({ title: 'T' });
    expect(setAt({ tags: ['a'] }, ['tags'], [])).toEqual({});
  });
  it('a row of a list stays a row when its fields are cleared, and a new row is made on demand', () => {
    expect(setAt({ features: [{ name: 'x' }, { name: 'y' }] }, ['features', 0, 'name'], undefined)).toEqual({ features: [{}, { name: 'y' }] });
    expect(setAt({}, ['features', 0, 'name'], 'x')).toEqual({ features: [{ name: 'x' }] });
  });
  it('writes the path the way the server names it', () => {
    expect(pathKey(['sections', 'contact', 'heading'])).toBe('sections.contact.heading');
    expect(pathKey(['features', 2, 'name'])).toBe('features[2].name');
  });
  it('compares data without caring about key order', () => {
    expect(sameData({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 })).toBe(true);
    expect(sameData({ a: 1 }, { a: 2 })).toBe(false);
  });
});

describe('the cards of the editor', () => {
  it('a page: one card per editable section, the fills-itself and locked sections as such, no card for a form, then the title and the search card', () => {
    const cards = editorCards(contract, 'pages', { type: 'home', title: 'Home' });
    expect(cards.map(c => `${c.id}:${c.kind}`)).toEqual(['hero:fields', 'feed:feed', 'legal:locked', 'title:fields', 'seo:fields']);
    const hero = cards[0];
    expect(hero?.kind === 'fields' && hero.fields.map(f => pathKey(f.path))).toEqual(['sections.hero.heading', 'sections.hero.lead']);
  });
  it('an item: the single fields together, the list, the photos and the search card each in their own; internal fields are not shown', () => {
    const cards = editorCards(contract, 'listings', {});
    expect(cards.map(c => c.id)).toEqual(['main', 'features', 'photos', 'seo']);
    const main = cards[0];
    expect(main?.kind === 'fields' && main.fields.map(f => f.name)).toEqual(['street', 'slug']);
  });
  it('the line of a section that fills itself names the collection and its order, with no words of ours', () => {
    expect(feedLine(contract, 'home', { id: 'feed', kind: 'feed', accepts: 'listings' })).toBe('listings, Street ↓');
  });
  it('a title from the collection, a singleton by its label, nothing for a row with no title', () => {
    expect(rowTitle(contract, 'listings', { street: '12 Alpha Lane' })).toBe('12 Alpha Lane');
    expect(rowTitle(contract, 'settings', {})).toBe('Business details');
    expect(rowTitle(contract, 'listings', {})).toBe('');
  });
  it('the list shows the client\'s own collections, not the pages, the inbox, uploads or the business details', () => {
    expect(listCollections(contract).map(([id]) => id)).toEqual(['listings', 'team', 'areas']);
  });
});

describe('who sees what', () => {
  it('Add is for owners and staff everywhere and for an agent only on a collection marked own', () => {
    expect(canAdd('owner', contract.collections.areas!)).toBe(true);
    expect(canAdd('staff', contract.collections.areas!)).toBe(true);
    expect(canAdd('member', contract.collections.areas!)).toBe(false);
    expect(canAdd('member', contract.collections.listings!)).toBe(true);
  });
  it('an agent sees no owner-only collection and only their own rows of an own one (the agent\'s own team row counts for the team)', () => {
    const mine = { id: 'r1', owner_team_row: 'me' }, theirs = { id: 'r2', owner_team_row: 'other' };
    expect(visibleTo('member', 'me', contract.collections.areas!, mine)).toBe(false);
    expect(visibleTo('member', 'me', contract.collections.listings!, mine)).toBe(true);
    expect(visibleTo('member', 'me', contract.collections.listings!, theirs)).toBe(false);
    expect(visibleTo('member', 'me', contract.collections.team!, { id: 'me', owner_team_row: null })).toBe(true);
    expect(visibleTo('owner', null, contract.collections.areas!, theirs)).toBe(true);
  });
  it('Delete is for owners and staff, on the client\'s own items only (B12)', () => {
    const c = contract.collections;
    expect(canDelete('owner', 'listings', c.listings!)).toBe(true);
    expect(canDelete('staff', 'areas', c.areas!)).toBe(true);
    expect(canDelete('member', 'listings', c.listings!)).toBe(false);
    expect(['pages', 'settings', 'team', 'media', 'leads'].map(id => canDelete('owner', id, c[id]!))).toEqual([false, false, false, false, false]);
  });
});

describe('limits', () => {
  it('finds every text over its limit, in a list row and in the search card too', () => {
    const cards = editorCards(contract, 'listings', {});
    const fields = cards.flatMap(c => (c.kind === 'fields' ? c.fields : []));
    const over = overLimits(fields, { street: 'x'.repeat(21), features: [{ name: 'ok' }, { name: 'toolong' }], seo: { title: 'x'.repeat(61), description: 'fine' } });
    expect(over.map(o => o.path)).toEqual(['street', 'features[1].name', 'seo.title']);
  });
  it('nothing is over when nothing is', () => {
    const fields = editorCards(contract, 'listings', {}).flatMap(c => (c.kind === 'fields' ? c.fields : []));
    expect(overLimits(fields, { street: 'x'.repeat(20), seo: { title: 'x'.repeat(60) } })).toEqual([]);
  });
});

describe('compare', () => {
  it('lists the fields whose value differs, with their labels', () => {
    expect(changesBetween({ sections: { contact: { heading: 'Old', lead: 'same' } }, tags: ['a'] }, { sections: { contact: { heading: 'New', lead: 'same' } }, tags: ['a', 'b'] })).toEqual([
      { path: 'sections.contact.heading', label: 'Sections / Contact / Heading', before: 'Old', after: 'New' },
      { path: 'tags[1]', label: 'Tags 1', before: '', after: 'b' },
    ]);
    expect(changesBetween({ a: 1 }, { a: 1 })).toEqual([]);
  });
});

describe('the state line and the sentences with a time', () => {
  const now = new Date('2026-11-01T12:00:00Z');
  it('preview, live with who and when, live without, paused', () => {
    expect(stateLine('preview', null, now)).toBe('Preview, not live yet');
    expect(stateLine('live', { at: '2026-11-01T10:00:00Z', by: 'Agent One' }, now)).toMatch(/^Live, last published today \d\d:\d\d by Agent One$/);
    expect(stateLine('live', { at: '2026-11-01T10:00:00Z', by: '' }, now)).toMatch(/^Live, last published today \d\d:\d\d$/);
    expect(stateLine('live', null, now)).toBe('Live');
    expect(stateLine('paused', null, now)).toBe('');
  });
  it('the stale sentence names who and when', () => {
    expect(staleLine('Agent One', '2026-11-01T14:02:00Z')).toBe(`Agent One saved a newer version at ${clock('2026-11-01T14:02:00Z')}.`);
    expect(staleLine('', '2026-11-01T14:02:00Z')).toMatch(/^saved a newer version at \d\d:\d\d\.$/);
  });
  it('the clock is two digits and an unreadable time is nothing', () => {
    expect(clock('2026-11-01T14:02:00Z', 'UTC')).toBe('14:02');
    expect(clock('not a time')).toBe('');
  });
  it('the open address is the domain once live, else the preview', () => {
    expect(siteUrl({ domain: 'a.com', preview_host: 'p.pages.dev', state: 'live' })).toBe('https://a.com');
    expect(siteUrl({ domain: 'a.com', preview_host: 'p.pages.dev', state: 'preview' })).toBe('https://p.pages.dev');
    expect(siteUrl({ domain: null, preview_host: 'p.pages.dev', state: 'live' })).toBe('https://p.pages.dev');
  });
});

describe('the publish progress', () => {
  const ev = (state: JobEvent['state'], at: string): JobEvent => ({ job_id: 'j', state, at });
  it('one line per step reached, in order; queued and failed are not steps', () => {
    const lines = progressLines([ev('queued', '2026-11-01T10:00:00Z'), ev('building', '2026-11-01T10:00:05Z'), ev('gating', '2026-11-01T10:01:00Z')]);
    expect(lines.map(l => l.text)).toEqual(['Building the site', 'Checking']);
    const done = progressLines([ev('done', '2026-11-01T10:03:00Z'), ev('queued', '2026-11-01T10:00:00Z'), ev('building', '2026-11-01T10:00:05Z'), ev('gating', '2026-11-01T10:01:00Z'), ev('deploying', '2026-11-01T10:02:00Z')]);
    expect(done.map(l => l.text.replace(/\d\d:\d\d/, 'HH:MM'))).toEqual(['Building the site', 'Checking', 'Putting it live', 'Live since HH:MM.']);
    expect(done.filter(l => l.live)).toHaveLength(1);
    expect(progressLines([ev('building', '2026-11-01T10:00:05Z'), ev('failed', '2026-11-01T10:00:09Z')]).map(l => l.text)).toEqual(['Building the site']);
  });
  it('the step of a running job, none while queued', () => {
    expect(stepWords('gating')).toBe('Checking');
    expect(stepWords('queued')).toBe('');
  });
  it('what a failed check said comes from the report itself', () => {
    expect(failureLines({ gate_report: { factory: 'pass', audit: { exit: 1, fails: ['FAIL MET-003 index.html:4 two h1'] } }, error: 'audit failed' })).toEqual(['FAIL MET-003 index.html:4 two h1']);
    expect(failureLines({ gate_report: { reason: 'build failed', factory: { exit: 1, lines: ['boom'] } }, error: null })).toEqual(['build failed', 'boom']);
    expect(failureLines({ gate_report: null, error: 'deploy failed' })).toEqual(['deploy failed']);
  });
});

describe('a draft kept in the browser', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (globalThis as unknown as { localStorage: Storage }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } } as Storage;
  });
  it('keeps, loads and drops a draft with its base version', () => {
    keepDraft('w', 'r', 3, { title: 'Mine' });
    expect(loadDraft('w', 'r')).toEqual({ base: 3, data: { title: 'Mine' } });
    expect(loadDraft('w', 'other')).toBeNull();
    dropDraft('w', 'r');
    expect(loadDraft('w', 'r')).toBeNull();
  });
  it('a browser without storage loses nothing but the draft', () => {
    (globalThis as unknown as { localStorage: unknown }).localStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
    expect(() => keepDraft('w', 'r', 1, {})).not.toThrow();
    expect(loadDraft('w', 'r')).toBeNull();
    expect(() => dropDraft('w', 'r')).not.toThrow();
  });
});

describe('past publishes and putting the site back (B11)', () => {
  it('the checks line reads the audit counts; a job from before the summary has none', () => {
    expect(checksLine({ gate_report: { audit: { counts: { PASS: 41, FAIL: 0, SKIP: 1 } } } })).toBe('41 checks passed, 0 failed');
    expect(checksLine({ gate_report: { reason: 'timeout' } })).toBe('');
    expect(checksLine({ gate_report: null })).toBe('');
  });
  it('an item comes back as a new version, or at its newest when that holds the content; nothing else is touched', () => {
    const v = (n: number, heading: string) => ({ n, data: { heading } });
    const rows = [
      { id: 'changed', collection: 'pages', published_version: 3, newest: v(3, 'new') },
      { id: 'draft-back', collection: 'pages', published_version: 2, newest: v(3, 'old') },
      { id: 'same', collection: 'pages', published_version: 2, newest: v(2, 'old') },
      { id: 'added', collection: 'listings', published_version: 1, newest: v(1, 'added') },
    ];
    expect(restoreSteps({ changed: 2, 'draft-back': 1, same: 2, deleted: 4 }, rows, { changed: { heading: 'old' }, 'draft-back': { heading: 'old' } })).toEqual([
      { row: 'changed', collection: 'pages', base: 3, data: { heading: 'old' } },
      { row: 'draft-back', collection: 'pages', base: 3, data: null },
    ]);
    expect(() => restoreSteps({ changed: 2 }, rows, {})).toThrow('version 2 of pages changed could not be read');
  });
});

describe('the preview site (B15)', () => {
  it('the signed link is the draft branch with the job\'s token; none without a project, a good token, or after its end', () => {
    const k = 'ab'.repeat(32), until = '2026-11-20T00:00:00.000Z', job = { gate_report: { link: { k, until } } }, now = new Date('2026-11-13T00:00:00Z');
    expect(draftLink({ deploy_target: 'test-site-demo-a' }, job, now)).toBe(`https://draft.test-site-demo-a.pages.dev/?k=${k}`);
    expect([draftLink({}, job, now), draftLink({ deploy_target: 'x' }, job, new Date('2026-11-21T00:00:00Z')), draftLink({ deploy_target: 'x' }, { gate_report: { link: { k: 'xyz', until } } }, now),
      draftLink({ deploy_target: 'x' }, { gate_report: null }, now)]).toEqual(['', '', '', '']);
  });
  it('a change left out is named in plain words: its title, else its collection, and the field it still needs', () => {
    expect(leftOutLine(contract, { collection: 'listings', newest: { data: { street: '1 Elm' } } }, 'photos')).toBe('1 Elm: Photos is not filled in yet.');
    expect(leftOutLine(contract, { collection: 'pages', newest: { data: { title: 'Home' } } }, 'sections.hero.heading')).toBe('Home: Heading is not filled in yet.');
    expect(leftOutLine(contract, { collection: 'team', newest: { data: {} } }, 'name')).toBe('Team: Name is not filled in yet.');
    expect(leftOutLine(contract, undefined, 'seo.title')).toBe('A saved change: Title is not filled in yet.');
  });
});
