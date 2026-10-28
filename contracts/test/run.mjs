// Contract tests. Plain script: prints one line per case, exits 1 if any case fails.
// Fixture is synthetic ("Demo Homes", towns Alpha and Beta), never client content.
// CONTRACTS_DIR points the tests at another copy of the modules (test/mutate.mjs uses it to run broken copies).
import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = process.env.CONTRACTS_DIR || resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = m => import(pathToFileURL(resolve(DIR, m)).href);
const { validateContract, validateItem, mergeCore, applyWaivers } = await load('validate.mjs');
const { generate, seedGaps } = await load('from-plan.mjs');
const { createStore } = await load('store.mjs');
const { place, publicData } = await load('place.mjs');

const clone = o => JSON.parse(JSON.stringify(o));
let failed = 0, passed = 0;
function check(name, ok, detail = '') {
  if (ok) passed++; else failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : '  ' + detail}`);
}
const codes = list => list.map(p => p.code);

// ---------- fixture: a plan + entity declaration, generated into a contract ----------
const sitemap = { generatedAt: '2026-01-01', pages: [
  { path: '/', kind: 'home', schema: ['RealEstateAgent'] },
  { path: '/homes-in-alpha/', kind: 'money', cluster: 'c-buy-alpha', location: 'Alpha, ST', schema: ['WebPage'] },
  { path: '/homes-in-beta/', kind: 'money', cluster: 'c-buy-beta', location: 'Beta, ST', schema: ['WebPage'] },
  { path: '/guide/', kind: 'guide', schema: ['Article'] },
] };
const existing = { pages: [{ path: '/team/pat-1' }, { path: '/contact' }] };
const entities = {
  workspace: 'demo', locations: { collection: 'areas' },
  clientWording: [{ where: 'forms.contact.fields.message', status: '[client to confirm]', note: 'fixture' }, { where: 'notices:form-consent', status: '[client to confirm]' }], families: { 'c-buy': 'buyer-guide' },
  pageTypeOf: { '/': 'home', '/contact': 'contact' },
  collections: {
    areas: { type: 'Place', label: 'Towns' },
    listings: { type: 'RealEstateListing', route: '/listings/{slug}/', access: { member: 'own' }, ownerField: 'agent',
      fields: { area: { type: 'reference', to: 'areas', required: true }, agent: { type: 'reference', to: 'team', required: true } },
      onDelete: { redirectToPageOf: 'area', pageType: 'buyer-guide' } },
  },
  extend: { team: { route: '/team/{slug}', areas: { type: 'reference', to: 'areas', multiple: true } } },
  pageTypes: {
    home: { sections: [
      { id: 'hero', kind: 'fields', fields: { heading: { type: 'text', required: true, max: 70 } } },
      { id: 'our-listings', kind: 'feed', accepts: 'listings' },
      { id: 'sold', kind: 'feed', accepts: 'listings' },
      { id: 'contact', kind: 'form', form: 'contact' } ] },
    'buyer-guide': { sections: [
      { id: 'intro', kind: 'fields', fields: { heading: { type: 'text', required: true, max: 90 } } },
      { id: 'area-listings', kind: 'feed', accepts: 'listings' },
      { id: 'area-agents', kind: 'feed', accepts: 'team' },
      { id: 'questions', kind: 'feed', accepts: 'faqs' } ] },
    contact: { sections: [{ id: 'form', kind: 'form', form: 'contact' }] },
  },
  placements: [
    { id: 'active>home', collection: 'listings', when: { status: ['coming-soon', 'active', 'pending'] }, to: { page: '/', section: 'our-listings' }, sort: '-price', limit: 6 },
    { id: 'sold>home', collection: 'listings', when: { status: ['sold'] }, to: { page: '/', section: 'sold' }, limit: 1 },
    { id: 'active>guide', collection: 'listings', when: { status: ['coming-soon', 'active', 'pending'] }, to: { pageType: 'buyer-guide', section: 'area-listings', match: 'area' } },
  ],
};
const GOOD = generate({ sitemap, business: { industry: 'real-estate-agent' }, existing, entities, planDir: 'fixture' });

// ---------- generator ----------
check('generator: good fixture is valid', validateContract(GOOD).length === 0, JSON.stringify(validateContract(GOOD)));
check('generator: plan pages bound to their town', GOOD.pages.find(p => p.path === '/homes-in-alpha/').bind === 'alpha' && GOOD.pageTypes['buyer-guide'].bind === 'areas');
check('generator: page covered by a collection route is not a page', !GOOD.pages.some(p => p.path === '/team/pat-1') && GOOD.pages.some(p => p.path === '/contact'));
check('generator: unbound page type gets default sections', GOOD.pageTypes.guide.sections.map(s => s.id).join() === 'intro,body,questions,contact');
check('generator: item that references the page\'s place is derived onto it', JSON.stringify(GOOD.placements.find(p => p.id === 'derived:team>buyer-guide')?.to) === '{"pageType":"buyer-guide","section":"area-agents","match":"areas"}');
check('generator: FAQ feeds derived', GOOD.placements.some(p => p.id === 'derived:faqs>buyer-guide'));
check('generator: sitemap + schema derived for routed collections', ['listings', 'team', 'posts'].every(c => GOOD.placements.some(p => p.collection === c && p.to.sitemap)) && GOOD.placements.some(p => p.collection === 'listings' && p.to.schema === 'RealEstateListing'));
check('generator: seeds the places the plan names', JSON.stringify(GOOD.seeds.areas) === '["alpha","beta"]');

// ---------- contract: each broken fixture must report its code ----------
const L = c => c.collections.listings;
const contractCases = [
  ['C-SHAPE', c => { delete c.placements; }],
  ['C-CORE', c => { c.collections.team = { fields: { name: { type: 'text' } } }; }],
  ['C-CORE', c => { c.collections.team.fields.name = { type: 'text' }; }],
  ['C-KIND', c => { L(c).kind = 'blog'; }],
  ['C-FIELDS', c => { L(c).fields.openHouses.of = {}; }],
  ['C-FIELD-TYPE', c => { L(c).fields.price.type = 'currency'; }],
  ['C-ENUM', c => { L(c).fields.propertyType.options = []; }],
  ['C-REF', c => { L(c).fields.area.to = 'cities'; }],
  ['C-LOCK', c => { L(c).fields.mlsNumber.locked = {}; }],
  ['C-RANGE', c => { L(c).fields.beds.min = 9; L(c).fields.beds.max = 1; }],
  ['C-MEDIA', c => { L(c).fields.description.media = { minWidth: 10 }; }],
  ['C-TITLE', c => { L(c).titleField = 'nope'; }],
  ['C-ROUTE', c => { L(c).route = '/listings/{price}/'; }],
  ['C-STATUS', c => { L(c).statusField = 'street'; }],
  ['C-ACCESS', c => { L(c).access = { member: 'everyone' }; }],
  ['C-OWNER', c => { L(c).ownerField = 'street'; }],
  ['C-ONDELETE', c => { L(c).onDelete.pageType = 'home'; }],
  ['C-BIND', c => { c.pageTypes['buyer-guide'].bind = 'nope'; }],
  ['C-SECTION', c => { c.pageTypes.home.sections.push({ id: 'hero', kind: 'fields', fields: { a: { type: 'text' } } }); }],
  ['C-FEED', c => { c.pageTypes.home.sections[1].accepts = 'nope'; }],
  ['C-FORM-REF', c => { c.pageTypes.home.sections[3].form = 'nope'; }],
  ['C-NOTICE', c => { c.pageTypes.contact.sections.push({ id: 'legal', kind: 'notice' }); }],
  ['C-PAGE-TYPE', c => { c.pages[0].type = 'nope'; }],
  ['C-PATH', c => { c.pages.push({ ...c.pages[3] }); }],
  ['C-PATH', c => { c.pages.push({ path: '/listings/a-house/', type: 'contact' }); }],
  ['C-PAGE-BIND', c => { delete c.pages.find(p => p.type === 'buyer-guide').bind; }],
  ['C-CONSENT', c => { delete c.forms.contact.consent; }],
  ['C-CRM', c => { c.forms.contact.crm = { nope: 'Target Area' }; }],
  ['C-PLACE-COLL', c => { c.placements[0].collection = 'nope'; }],
  ['C-PLACE-WHEN', c => { c.placements[0].when.status = ['rented']; }],
  ['C-PLACE-TARGET', c => { c.placements[0].to = { page: '/nope/', section: 'x' }; }],
  ['C-PLACE-SECTION', c => { c.placements[0].to.section = 'hero'; }],
  ['C-PLACE-MATCH', c => { c.placements[2].to.match = 'agent'; }],
  ['C-PLACE-ROUTE', c => { c.placements.push({ collection: 'areas', to: { sitemap: true } }); }],
  ['C-FEED-ORPHAN', c => { c.placements.splice(1, 1); }],
  ['C-VISIBLE', c => { L(c).fields.soldPrice.visibleWhen = { nope: [true] }; }],
  ['C-VISIBLE', c => { L(c).fields.soldPrice.visibleWhen = { status: ['rented'] }; }],
  ['C-WORDING', c => { c.clientWording.push({ where: 'forms.contact.fields.nope', status: '[client to confirm]' }); }],
  ['C-WORDING', c => { c.clientWording[0].status = ''; }],
  ['C-SITEMAP', c => { c.placements = c.placements.filter(p => !(p.collection === 'listings' && p.to.sitemap)); }],
  ['C-SAMPLE', c => { L(c).sampleField = 'street'; }],
  ['C-WAIVER', c => { c.gateWaivers = [{ rule: 'RE-DISC-001', path: '/not-a-page', expects: ['/privacy/'], reason: 'kept URL', approvedBy: 'lead' }]; }],
  ['C-WAIVER', c => { c.gateWaivers = [{ rule: 'RE-DISC-001', path: '/contact', expects: ['/privacy/'], reason: '', approvedBy: 'lead' }]; }],
];
for (const [code, mutate] of contractCases) {
  const c = clone(GOOD); mutate(c);
  const got = codes(validateContract(c));
  check(`contract ${code} ${mutate.toString().slice(6, 60)}`, got.includes(code), `got [${got.join(', ')}]`);
}

// ---------- items ----------
const img = (o = {}) => ({ asset: 'a/1.jpg', alt: 'Front of the house', width: 1600, height: 1000, rightsConfirmed: true, exifStripped: true, ...o });
const listing = (o = {}) => ({ street: '1 Demo Road', slug: '1-demo-road-alpha', address: { street: '1 Demo Road', city: 'Alpha' }, status: 'active',
  price: { amount: 500000, currency: 'USD' }, beds: 3, description: 'A demo house.', photos: [img()], area: 'AREA', agent: 'AGENT', ...o });
check('item: good listing publishes clean', validateItem(GOOD, 'listings', listing(), { mode: 'publish' }).length === 0, JSON.stringify(validateItem(GOOD, 'listings', listing(), { mode: 'publish' })));
check('item: draft may be incomplete (no I-REQUIRED in draft)', !codes(validateItem(GOOD, 'listings', listing({ price: undefined }), { mode: 'draft' })).includes('I-REQUIRED'));
const itemCases = [
  ['I-REQUIRED', 'listings', listing({ price: undefined })],
  ['I-TYPE', 'listings', listing({ beds: 'three' })],
  ['I-ENUM', 'listings', listing({ status: 'rented' })],
  ['I-MAX', 'listings', listing({ street: 'x'.repeat(200) })],
  ['I-MIN', 'listings', listing({ beds: -1 })],
  ['I-SLUG', 'listings', listing({ slug: 'Main St' })],
  ['I-ALT', 'listings', listing({ photos: [img({ alt: '' })] })],
  ['I-MEDIA-SIZE', 'listings', listing({ photos: [img({ width: 300 })] })],
  ['I-RIGHTS', 'listings', listing({ photos: [img({ rightsConfirmed: false })] })],
  ['I-EXIF', 'listings', listing({ photos: [img({ exifStripped: undefined })] })],
  ['I-PLACEHOLDER', 'listings', listing({ description: 'Price [client to confirm]' })],
  ['I-UNKNOWN', 'listings', listing({ zestimate: 1 })],
  ['I-SOURCE', 'areas', { name: 'Alpha', slug: 'alpha', localFacts: [{ label: 'Population', value: '12,000' }] }],
  ['I-REQUIRED', 'pages', { path: '/', type: 'home', title: 'Home', seo: { title: 'Home', description: 'Demo' }, sections: {} }],
  ['I-UNKNOWN', 'pages', { path: '/', type: 'home', title: 'Home', seo: { title: 'Home', description: 'Demo' }, sections: { 'our-listings': {} } }],
  ['I-COLLECTION', 'nope', {}],
];
for (const [code, coll, data] of itemCases) {
  const got = codes(validateItem(GOOD, coll, data, { mode: 'publish' }));
  check(`item ${code} (${coll})`, got.includes(code), `got [${got.join(', ')}]`);
}
// photo facts come from the platform's media record, never from the row's own JSON (dry run 3.3)
const forged = listing({ photos: [img({ width: 5000, exifStripped: true, rightsConfirmed: true })] });
const fromRecord = codes(validateItem(GOOD, 'listings', forged, { mode: 'publish', media: () => ({ width: 300, exifStripped: false, rightsConfirmed: false }) }));
check('item: media record overrides forged photo facts', ['I-MEDIA-SIZE', 'I-EXIF', 'I-RIGHTS'].every(c => fromRecord.includes(c)), `got [${fromRecord.join(', ')}]`);
// sample/placeholder listings: smaller photos allowed on previews, never on a live site (ELEV8 preview, lead 2026-10-28)
const small = [img({ width: 600 })];
check('item: sample listing may use photos below the minimum width', !codes(validateItem(GOOD, 'listings', listing({ sample: true, photos: small }), { mode: 'publish' })).includes('I-MEDIA-SIZE'));
check('item: a real listing still needs the minimum width', codes(validateItem(GOOD, 'listings', listing({ photos: small }), { mode: 'publish' })).includes('I-MEDIA-SIZE'));
check('item I-SAMPLE-LIVE: a sample cannot go to a live site', codes(validateItem(GOOD, 'listings', listing({ sample: true, photos: small }), { mode: 'publish', live: true })).includes('I-SAMPLE-LIVE'));
// gate waivers: a kept live URL stands in for a path the rule expects
const WAIVED = { ...GOOD, gateWaivers: [{ rule: 'RE-DISC-001', path: '/contact', expects: ['/privacy/', '/privacy-policy/'], reason: 'live URL kept', approvedBy: 'lead' }] };
check('contract: a complete waiver is valid', validateContract(WAIVED).length === 0, JSON.stringify(validateContract(WAIVED)));
check('waiver widens only the matching rule group', JSON.stringify(applyWaivers(WAIVED, 'RE-DISC-001', [['/privacy/', '/privacy-policy/'], ['/accessibility/']])) === '[["/privacy/","/privacy-policy/","/contact"],["/accessibility/"]]'
  && JSON.stringify(applyWaivers(WAIVED, 'GT-001', [['/privacy/']])) === '[["/privacy/"]]', JSON.stringify(applyWaivers(WAIVED, 'RE-DISC-001', [['/privacy/', '/privacy-policy/'], ['/accessibility/']])));
// ELEV8 team categories (lead, 2026-10-28): group, sourced specialties, photo credit, licences (DRE/NMLS) on the real contract
const { readFileSync } = await import('node:fs');
const ELEV8 = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'elev8', 'contract.json'), 'utf8'));   // the real file, also under mutation runs
const src = (value) => ({ value, source: 'https://example.test/profile', date: '2026-10-28' });
const member = (o = {}) => ({ name: 'Demo Agent', slug: 'demo-agent', role: 'Agent', group: 'agents', specialties: [{ name: src('buyers') }], photoCredit: 'Studio X',
  licences: [{ type: 'DRE', number: '00000000', status: 'active', source: 'https://example.test/dre', readOn: '2026-10-28' }], ...o });
const tcodes = (d, mode = 'publish') => codes(validateItem(ELEV8, 'team', d, { mode }));
check('ELEV8 team: a categorized member validates', tcodes(member()).length === 0, JSON.stringify(validateItem(ELEV8, 'team', member(), { mode: 'publish' })));
check('ELEV8 team: group is required', tcodes(member({ group: undefined })).includes('I-REQUIRED'));
check('ELEV8 team: group must be leadership/financing/agents', tcodes(member({ group: 'brokers' })).includes('I-ENUM'));
check('ELEV8 team: a specialty needs a source and date', tcodes(member({ specialties: [{ name: 'buyers' }] })).includes('I-SOURCE'));
check('ELEV8 team: specialty must be a known one', tcodes(member({ specialties: [{ name: src('luxury') }] })).includes('I-ENUM'));
check('ELEV8 team: a licence needs its source URL and read date', tcodes(member({ licences: [{ type: 'NMLS', number: '1', status: 'active' }] })).includes('I-REQUIRED'));
check('ELEV8 team: licence type is DRE or NMLS', tcodes(member({ licences: [{ type: 'CPA', number: '1', status: 'active', source: 'https://example.test/x', readOn: '2026-10-28' }] })).includes('I-ENUM'));
// N3: every page the seed creates must arrive with a title + SEO text within the limits, or the first publish fails (422)
check('seed: a page with no title/SEO is reported', seedGaps(GOOD).some(g => g.path === '/contact'), JSON.stringify(seedGaps(GOOD)).slice(0, 200));
check('seed: an over-long SEO title is reported', seedGaps({ ...GOOD, pageSeeds: { ...(GOOD.pageSeeds || {}), '/contact': { title: 'Contact', seo: { title: 'x'.repeat(61), description: 'ok' } } } }).some(g => g.path === '/contact' && /60/.test(g.why)));
check('seed: ELEV8 seeds every one of its pages completely', seedGaps(ELEV8).length === 0, JSON.stringify(seedGaps(ELEV8)).slice(0, 400));
check('ELEV8 team: licences are locked (staff sign-off)', !!mergeCore(ELEV8).team.fields.licences?.locked);
check('item: a photo the processor has not finished blocks publish (N12)', codes(validateItem(GOOD, 'listings', forged, { mode: 'publish', media: () => ({ width: 2400, exifStripped: true, rightsConfirmed: true, processed: false }) })).includes('I-EXIF'));
check('item I-MEDIA-UNKNOWN: photo with no uploaded file', codes(validateItem(GOOD, 'listings', forged, { mode: 'publish', media: () => null })).includes('I-MEDIA-UNKNOWN'));
// a resolved contract (core merged, as stored for SQL) validates the same rows as the generated one (dry run 2.5 / 4.1)
const RESOLVED = { ...GOOD, collections: mergeCore(GOOD) };
const teamRow = { name: 'Pat', slug: 'pat', role: 'Agent', areas: ['AREA'] };
check('resolved contract keeps site extensions of core collections', validateItem(RESOLVED, 'team', teamRow).length === 0 && validateItem(GOOD, 'team', teamRow).length === 0, JSON.stringify(validateItem(RESOLVED, 'team', teamRow)));
check('mergeCore is idempotent', JSON.stringify(Object.keys(mergeCore(RESOLVED).team.fields)) === JSON.stringify(Object.keys(mergeCore(GOOD).team.fields)) && validateContract(RESOLVED).length === 0, JSON.stringify(validateContract(RESOLVED)).slice(0, 300));
check('item I-REF: reference to a missing row', codes(validateItem(GOOD, 'listings', listing(), { exists: () => false })).includes('I-REF'));
check('item: sourced fact accepted with source + date', validateItem(GOOD, 'areas', { name: 'Alpha', slug: 'alpha', localFacts: [{ label: 'Population', value: { value: '12,000', source: 'https://example.gov/x', date: '2026-01-01' } }] }, { mode: 'publish' }).length === 0);

// ---------- store: versions, publish, locks, the workspace wall ----------
const store = createStore({ demo: GOOD, other: GOOD });
const owner = { workspace: 'demo', role: 'owner', user: 'owner@demo' };
const staff = { workspace: 'demo', role: 'staff', user: 'staff@omnikom' };
const ownerB = { workspace: 'other', role: 'owner', user: 'owner@other' };
const ok = (name, r) => { check(name, r && r.ok, JSON.stringify(r)); return r; };
const refused = (name, r, code) => check(name, r && r.ok === false && r.code === code, JSON.stringify(r));

const alpha = ok('store: owner creates a town', store.save(owner, { collection: 'areas', data: { name: 'Alpha', slug: 'alpha' } }));
ok('store: publish town', store.publish(owner, 'areas', alpha.id));
const beta = store.save(owner, { collection: 'areas', data: { name: 'Beta', slug: 'beta' } }); store.publish(owner, 'areas', beta.id);
const pat = ok('store: owner adds agent', store.save(owner, { collection: 'team', data: { name: 'Pat Demo', slug: 'pat-demo', role: 'Agent' } }));
store.publish(owner, 'team', pat.id);
const sam = store.save(owner, { collection: 'team', data: { name: 'Sam Demo', slug: 'sam-demo', role: 'Agent' } }); store.publish(owner, 'team', sam.id);
const patS = { workspace: 'demo', role: 'member', teamId: pat.id, user: 'pat@demo' };
const samS = { workspace: 'demo', role: 'member', teamId: sam.id, user: 'sam@demo' };

const l1 = ok('store: member creates own listing (owner field set from login)', store.save(patS, { collection: 'listings', data: listing({ area: alpha.id, agent: undefined }) }));
check('store: owner field taken from the login', store.get(owner, 'listings', l1.id).data.agent === pat.id);
ok('store: member publishes own listing', store.publish(patS, 'listings', l1.id));
refused('store: other member cannot edit it', store.save(samS, { collection: 'listings', id: l1.id, data: listing({ area: alpha.id, agent: pat.id, price: { amount: 1, currency: 'USD' } }) }), 'S-OWN-ONLY');
refused('store: member cannot create a listing for someone else', store.save(samS, { collection: 'listings', data: listing({ area: alpha.id, agent: pat.id }) }), 'S-OWN-ONLY');
refused('store: member cannot edit business details', store.save(patS, { collection: 'settings', data: { businessName: 'X' } }), 'S-ROLE');
ok('store: draft edit saved', store.save(patS, { collection: 'listings', id: l1.id, data: listing({ area: alpha.id, agent: pat.id, price: { amount: 450000, currency: 'USD' } }) }));
check('store: published copy unchanged by a draft edit', store.published('demo').find(r => r.id === l1.id).data.price.amount === 500000);
ok('store: rollback to version 1', store.rollback(patS, 'listings', l1.id, 1));
check('store: rollback is a new version with the old data', store.history(owner, 'listings', l1.id).length === 3 && store.get(owner, 'listings', l1.id).data.price.amount === 500000);

const settings = ok('store: owner creates business details', store.save(owner, { collection: 'settings', data: { businessName: 'Demo Homes', phone: '+1 555 0100', email: 'hi@demo.test' } }));
refused('store: second business-details row', store.save(owner, { collection: 'settings', data: { businessName: 'Again' } }), 'S-SINGLETON');
const lic = [{ authority: 'State board', number: '000000' }];
refused('store: client cannot set a locked field', store.save(owner, { collection: 'settings', id: settings.id, data: { businessName: 'Demo Homes', licences: lic } }), 'S-LOCKED');
refused('store: staff needs a sign-off for a locked field', store.save(staff, { collection: 'settings', id: settings.id, data: { businessName: 'Demo Homes', licences: lic } }), 'S-SIGNOFF');
ok('store: staff with sign-off changes the locked field', store.save(staff, { collection: 'settings', id: settings.id, data: { businessName: 'Demo Homes', licences: lic }, signOff: { by: 'abdo', ref: 'sign-off 2026-01-01' } }));
refused('store: client edit that changes the locked value is refused', store.save(owner, { collection: 'settings', id: settings.id, data: { businessName: 'Demo Homes', licences: [{ authority: 'X', number: '1' }] } }), 'S-LOCKED');
ok('store: client edit that leaves the locked value alone is fine', store.save(owner, { collection: 'settings', id: settings.id, data: { businessName: 'Demo Homes Group', licences: lic } }));

refused('store: workspace comes from the login, not the form', store.save(owner, { collection: 'areas', workspace: 'other', data: { name: 'Gamma', slug: 'gamma' } }), 'S-WORKSPACE');
refused('store: another workspace\'s row is not found (edit)', store.save(ownerB, { collection: 'listings', id: l1.id, data: listing() }), 'S-NOT-FOUND');
check('store: another workspace\'s row is not found (read)', store.get(ownerB, 'listings', l1.id) === null);
refused('store: another workspace\'s row cannot be published', store.publish(ownerB, 'listings', l1.id), 'S-NOT-FOUND');
refused('store: invalid draft refused', store.save(owner, { collection: 'areas', data: { name: 'Bad', slug: 'Bad Slug' } }), 'S-INVALID');
const half = store.save(owner, { collection: 'areas', data: { name: 'Half' } });
refused('store: incomplete row cannot be published', store.publish(owner, 'areas', half.id), 'S-PUBLISH-INVALID');
const lead = ok('store: lead saved to inbox', store.save(owner, { collection: 'leads', data: { form: 'contact', pagePath: '/', email: 'a@b.test', consentText: 'I agree.', status: 'new' } }));
refused('store: leads are never published', store.publish(owner, 'leads', lead.id), 'S-KIND');
refused('store: unknown collection', store.save(owner, { collection: 'nope', data: {} }), 'S-COLLECTION');
refused('store: unknown role', store.save({ workspace: 'demo', role: 'guest', user: 'x' }, { collection: 'areas', data: { name: 'G', slug: 'g' } }), 'S-ROLE');
refused('store: unknown workspace', store.save({ workspace: 'nope', role: 'owner', user: 'x' }, { collection: 'areas', data: {} }), 'S-WORKSPACE');

// ---------- placement: where published items go ----------
const sold = store.save(patS, { collection: 'listings', data: listing({ street: '2 Demo Road', slug: '2-demo-road-beta', area: beta.id, agent: undefined, status: 'sold' }) });
check('place fixture: sold listing saved', !!sold.ok, JSON.stringify(sold));
store.publish(patS, 'listings', sold.id);
const draftOnly = store.save(patS, { collection: 'listings', data: listing({ street: '3 Demo Road', slug: '3-demo-road-alpha', area: alpha.id, agent: undefined }) });
check('place fixture: draft listing saved', !!draftOnly.ok, JSON.stringify(draftOnly));
const bListing = (() => { const a = store.save(ownerB, { collection: 'areas', data: { name: 'Zeta', slug: 'zeta' } }); store.publish(ownerB, 'areas', a.id); return a; })();
const out = place(GOOD, store.published('demo'));
const sec = (path, s) => (out.pages[path].sections[s] || []);
check('place: active listing on home "Our listings"', sec('/', 'our-listings').includes(l1.id) && !sec('/', 'our-listings').includes(sold.id));
check('place: sold listing on home "sold", not "Our listings"', sec('/', 'sold').includes(sold.id) && !sec('/', 'sold').includes(l1.id));
const sold2 = store.save(patS, { collection: 'listings', data: listing({ street: '4 Demo Road', slug: '4-demo-road-beta', area: beta.id, agent: undefined, status: 'sold' }) });
store.publish(patS, 'listings', sold2.id);
check('place: limit keeps a feed to its size', sec('/', 'sold').length === 1 && place(GOOD, store.published('demo')).pages['/'].sections.sold.length === 1, JSON.stringify(place(GOOD, store.published('demo')).pages['/'].sections.sold));
check('place: listing on its own town page only', sec('/homes-in-alpha/', 'area-listings').includes(l1.id) && !sec('/homes-in-beta/', 'area-listings').includes(l1.id));
check('place: sold listing not on its town "active" feed', !sec('/homes-in-beta/', 'area-listings').includes(sold.id));
check('place: listing page in sitemap', out.sitemap.includes('/listings/1-demo-road-alpha/') && out.sitemap.includes('/homes-in-alpha/'));
check('place: listing carries RealEstateListing schema', out.schema.some(s => s.id === l1.id && s.type === 'RealEstateListing'));
check('place: drafts are never placed', !JSON.stringify(out).includes(draftOnly.id) && !out.sitemap.includes('/listings/3-demo-road-alpha/'));
check('place: build of one site holds nothing of another', !JSON.stringify(out).includes(bListing.id) && !JSON.stringify(place(GOOD, store.published('other'))).includes(l1.id));

const removed = ok('store: owner deletes a published listing', store.remove(owner, 'listings', l1.id));
check('store: delete redirects the page to its town guide', removed.redirect && removed.redirect.from === '/listings/1-demo-road-alpha/' && removed.redirect.to === '/homes-in-alpha/', JSON.stringify(removed));

const hidden = publicData(GOOD, 'listings', listing({ status: 'sold', soldPrice: { amount: 1, currency: 'USD' }, showSoldPrice: false }));
const shown = publicData(GOOD, 'listings', listing({ status: 'sold', soldPrice: { amount: 1, currency: 'USD' }, showSoldPrice: true }));
check('public data: sold price hidden unless ticked', !('soldPrice' in hidden) && 'soldPrice' in shown && 'street' in hidden);
check('public data: internal fields never reach the site', !('order' in publicData(GOOD, 'team', { name: 'A', slug: 'a', role: 'Agent', order: 1 })));
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
