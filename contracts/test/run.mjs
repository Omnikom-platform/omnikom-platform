// Contract tests. Plain script: prints one line per case, exits 1 if any case fails.
// Fixture is synthetic ("Demo Homes", towns Alpha and Beta), never client content.
// CONTRACTS_DIR points the tests at another copy of the modules (test/mutate.mjs uses it to run broken copies).
import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = process.env.CONTRACTS_DIR || resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = m => import(pathToFileURL(resolve(DIR, m)).href);
const { validateContract, validateItem, mergeCore, applyWaivers, leadColumns } = await load('validate.mjs');
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
  crm: {
    lead_types: [{ key: 'enquiry', label: 'Enquiry' }, { key: 'buy', label: 'Buy a home' }, { key: 'sell', label: 'Sell a home' }],
    statuses: [
      { key: 'not-contacted', label: 'Not contacted yet', stage: 'new', needsDate: false, needsWho: false, needsText: false },
      { key: 'contacted', label: 'Contacted', stage: 'working', needsDate: false, needsWho: true, needsText: false },
      { key: 'call-back', label: 'Call back', stage: 'working', needsDate: true, needsWho: false, needsText: false },
      { key: 'closed', label: 'Closed', stage: 'outcome' },
    ],
  },
  forms: {
    buyer: { label: 'Buyer', fields: { name: { type: 'text' }, email: { type: 'email' }, topic: { type: 'enum', options: ['buy', 'sell', 'other'] } }, consent: { notice: 'form-consent' },
      leadTypeFrom: { field: 'topic', map: { buy: 'buy', sell: 'sell' } } },
    seller: { label: 'Seller', fields: { name: { type: 'text' }, email: { type: 'email' } }, consent: { notice: 'form-consent' }, leadType: 'sell' },
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
check('generator: the entities\' crm lists ride into the contract whole', JSON.stringify(GOOD.crm) === JSON.stringify(entities.crm) && GOOD.forms.buyer.leadTypeFrom.field === 'topic');
check('generator: seeds the places the plan names', JSON.stringify(GOOD.seeds.areas) === '["alpha","beta"]');
// every section below builds on GOOD and the store refuses an invalid contract, so a generator that writes an invalid one ends
// the run here with its summary (the red check above names it) instead of dying in a later section
if (validateContract(GOOD).length) {
  console.log('\nstopped: the generated fixture is invalid (see "generator: good fixture is valid"); the sections below need a valid one');
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(1);
}

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
  ['C-FIELD-TYPE', c => { c.forms.contact.fields.budget = { type: 'currency' }; }],
  ['C-FORM-TYPE', c => { c.forms.contact.fields.photo = { type: 'image' }; }],
  ['C-FORM-KEY', c => { c.forms.contact.fields.status = { type: 'text' }; }],
  ['C-FORM-KEY', c => { c.forms.contact.fields['two words'] = { type: 'text' }; }],
  ['C-FORM-CORE', c => { c.forms.contact.fields.phone = { type: 'text' }; }],
  ['C-ENUM', c => { c.forms.contact.fields.side = { type: 'choice', options: ['Buying', 'Buying'] }; }],
  ['C-ENUM', c => { c.forms.contact.fields.timing = { type: 'enum' }; }],
  ['C-REF', c => { c.forms.contact.fields.area = { type: 'reference', to: 'cities' }; }],
  ['C-RANGE', c => { c.forms.contact.fields.beds = { type: 'number', min: 'none' }; }],
  ['C-RANGE', c => { c.forms.contact.fields.beds = { type: 'number', min: 10, max: 0 }; }],
  ['C-FORM-FLAG', c => { c.forms.contact.fields.message.column = 'yes'; }],
  ['C-FORM-FLAG', c => { c.forms.contact.fields.message.editable = 0; }],
  ['C-FORM-FLAG', c => { c.forms.contact.fields.message.multi = true; }],
  ['C-FORM-LABEL', c => { c.forms.contact.fields.message.label = ''; }],
  ['C-FORM-SAME-KEY', c => { c.forms.other = { label: 'Other', fields: { message: { type: 'number' } } }; }],
  ['C-FORM-SAME-KEY', c => { c.forms.other = { label: 'Other', fields: { message: { type: 'text', column: false } } }; }],
  ['C-CRM-LIST', c => { c.crm = 'statuses'; }],
  ['C-CRM-LIST', c => { c.crm.statuses = []; }],
  ['C-CRM-LIST', c => { c.crm.lead_types.push('buy'); }],
  ['C-CRM-LIST', c => { delete c.crm.lead_types; }],
  ['C-CRM-KEY', c => { c.crm.statuses[1].key = 'Contacted Today'; }],
  ['C-CRM-KEY', c => { c.crm.lead_types[2].key = 'buy'; }],
  ['C-CRM-LABEL', c => { c.crm.statuses[1].label = ''; }],
  ['C-CRM-LABEL', c => { c.crm.lead_types[1].label = 'x'.repeat(61); }],
  ['C-CRM-STAGE', c => { c.crm.statuses[1].stage = 'later'; }],
  ['C-CRM-STAGE', c => { c.crm.lead_types[1].stage = 'new'; }],
  ['C-CRM-FLAG', c => { c.crm.statuses[1].needsWho = 'yes'; }],
  ['C-CRM-FLAG', c => { c.crm.lead_types[1].needsDate = true; }],
  ['C-CRM-REQUIRED', c => { c.crm.lead_types = c.crm.lead_types.filter(e => e.key !== 'enquiry'); }],
  ['C-CRM-REQUIRED', c => { c.crm.statuses = c.crm.statuses.filter(e => e.key !== 'not-contacted'); }],
  ['C-FORM-LEADTYPE', c => { c.forms.seller.leadType = 'rent'; }],
  ['C-FORM-LEADTYPE', c => { c.forms.seller.leadTypeFrom = c.forms.buyer.leadTypeFrom; }],
  ['C-FORM-LEADTYPE', c => { c.forms.buyer.leadTypeFrom.map.buy = 'rent'; }],
  ['C-FORM-LEADTYPE', c => { c.forms.buyer.leadTypeFrom.map.maybe = 'buy'; }],
  ['C-FORM-LEADTYPE', c => { c.forms.buyer.leadTypeFrom.field = 'name'; }],
  ['C-FORM-LEADTYPE', c => { c.forms.buyer.leadTypeFrom = { field: 'topic', map: {} }; }],
  ['C-FORM-LEADTYPE', c => { delete c.crm; }],
  ['C-FORM-KEY', c => { c.forms.contact.fields.lead_type = { type: 'text' }; }],
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

// ---------- lead form fields: a typed industry form is valid, and its columns are what the CRM shows ----------
{
  const c = clone(GOOD);
  Object.assign(c.forms.contact.fields, {
    budget: { type: 'number', min: 0, max: 5000000, label: 'Budget' },
    timing: { type: 'enum', options: ['0-3 months', 'just looking'] },
    side: { type: 'choice', options: ['Buying', 'Selling'] },
    wants: { type: 'choice', options: ['Pool', 'Garden'], multi: true, column: false },
    moveBy: { type: 'date', editable: false },
    preApproved: { type: 'boolean' },
    area: { type: 'reference', to: 'areas' },
  });
  c.forms.other = { label: 'Other', fields: { timing: { type: 'enum', options: ['6-12 months'] } } };
  const p = validateContract(c);
  check('form fields: number, enum, choice (single and multi), date, boolean and reference with flags validate', p.length === 0, JSON.stringify(p));
  const cols = leadColumns(c), by = Object.fromEntries(cols.map(x => [x.key, x]));
  check('form fields: leadColumns lists industry keys only (not name/email/phone), in form order',
    cols.map(x => x.key).join() === 'topic,message,budget,timing,side,wants,moveBy,preApproved,area', cols.map(x => x.key).join());
  check('form fields: column and editable default to true; false stays false', by.budget.column && by.budget.editable && !by.wants.column && !by.moveBy.editable && by.wants.editable);
  check('form fields: a key in two forms is one column with both forms\' options', JSON.stringify(by.timing.options) === '["0-3 months","just looking","6-12 months"]', JSON.stringify(by.timing.options));
  check('form fields: number keeps min/max and label; reference keeps its collection; multi is carried', by.budget.min === 0 && by.budget.max === 5000000 && by.budget.label === 'Budget' && by.area.to === 'areas' && by.wants.multi === true && by.side.multi === false);
}

// ---------- the real examples carry their industry's lists (work order 20) ----------
{
  const { readFileSync } = await import('node:fs');
  const ex = n => JSON.parse(readFileSync(resolve(DIR, 'examples', n, 'contract.json'), 'utf8'));
  const elev8 = ex('elev8'), rm = ex('rainmaker');
  check('examples: ELEV8 and Rainmaker validate with their crm lists', validateContract(elev8).length === 0 && validateContract(rm).length === 0, JSON.stringify([...validateContract(elev8), ...validateContract(rm)]));
  const lt = c => c.crm.lead_types.map(e => e.key);
  check('examples: ELEV8 has the 15 real-estate types and 19 statuses; Rainmaker the 15 insurance types and 18 (the owner\'s answering machine and voicemail left are two)', lt(elev8).length === 15 && elev8.crm.statuses.length === 19 && lt(rm).length === 15 && rm.crm.statuses.length === 18 && [elev8, rm].every(c => ['answering-machine', 'voicemail-left'].every(k => c.crm.statuses.some(x => x.key === k))));
  check("examples: ELEV8's contact form allows listing-question and maps Ask about this home to it, not to buy", elev8.forms.contact.fields.leadType.options.includes('listing-question')
    && elev8.forms.contact.leadTypeFrom.field === 'leadType' && elev8.forms.contact.leadTypeFrom.map['listing-question'] === 'listing-question' && elev8.forms.contact.leadTypeFrom.map.buyer === 'buy' && elev8.forms.contact.leadTypeFrom.map.seller === 'sell');
  check('examples: every ELEV8 form says how it sets the lead type', Object.values(elev8.forms).every(f => f.leadType || f.leadTypeFrom));
  check('examples: Rainmaker maps its three products and sends the careers form to agent-recruiting', rm.forms.inquiry.leadTypeFrom.map.annuities === 'annuity' && rm.forms['careers-interest'].leadType === 'agent-recruiting');
  check('examples: the statuses that need a date are the ones the owner named (call-back, follow-up, appointment-set)', elev8.crm.statuses.filter(s => s.needsDate).map(s => s.key).join() === 'call-back,follow-up,appointment-set');
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
// the consent wording lint (step 3, 24-GAP-HUNT D): the notices row the contact form names as its consent notice must name the
// channels (the form asks for email and phone), the TCPA "not a condition of purchase" element, STOP and data rates when texting
const notice = (text, slug = 'form-consent') => ({ title: 'Form consent', slug, text, appliesTo: 'contact form' });
const FULL = 'By submitting this form you agree that Demo Homes may contact you by email, phone call or text message about your request. Consent is not a condition of purchase. Message and data rates may apply; message frequency varies. Reply STOP to opt out, HELP for help.';
const ncodes = (text, slug) => codes(validateItem(GOOD, 'notices', notice(text, slug), { mode: 'publish' }));
check('consent wording: the full wording publishes clean', ncodes(FULL).length === 0, `got [${ncodes(FULL).join(', ')}]`);
check('item I-CONSENT-CHANNEL: no channel named for a phone field', ncodes('By submitting you agree that Demo Homes may email you. Consent is not a condition of purchase.').includes('I-CONSENT-CHANNEL'));
check('item I-CONSENT-CHANNEL: email not named for an email field', ncodes('You agree to receive calls and texts. Not a condition of purchase. Message and data rates may apply. Reply STOP to opt out.').includes('I-CONSENT-CHANNEL'));
check('item I-CONSENT-TCPA: calls named without the purchase element', ncodes('You agree that we may email or call you about your request.').includes('I-CONSENT-TCPA'));
check('item I-CONSENT-STOP: texts named without a way to stop', ncodes('You agree to email, calls and text messages. Consent is not a condition of purchase. Message and data rates may apply.').includes('I-CONSENT-STOP'));
check('item I-CONSENT-RATES: texts named without the data-rates line', ncodes('You agree to email, calls and text messages. Consent is not a condition of purchase. Reply STOP to opt out.').includes('I-CONSENT-RATES'));
check('consent wording: a notices row no form names is not linted', !ncodes('Our privacy policy.', 'privacy-policy').some(c => c.startsWith('I-CONSENT')));
check('consent wording: a draft is not linted (publish is the gate)', !codes(validateItem(GOOD, 'notices', notice('draft words'), { mode: 'draft' })).some(c => c.startsWith('I-CONSENT')));
check('consent wording: tags in the richtext do not hide the words', ncodes(`<p>${FULL.replace('text message', '<strong>text</strong> message')}</p>`).length === 0);
// the search card's limits (PUB-1): the minimum (title 20, description 50, counted as the audit counts: code points, trimmed) is a publish rule;
// the maximum (60, 160) holds in both modes. The numbers are written out here on purpose: a test that read seo-limits.json would share the code's answer.
const seoProblems = (title, desc, mode) => validateItem(GOOD, 'pages', { path: '/', type: 'home', title: 'Home', seo: { title, description: desc }, sections: {} }, { mode })
  .filter(p => p.path.startsWith('seo')).map(p => ({ code: p.code, path: p.path }));
const seoHas = (list, code, path) => list.some(p => p.code === code && p.path === path);
const T20 = 't'.repeat(20), D50 = 'd'.repeat(50);
check('seo minimum: a 19 letter title is I-MIN at seo.title in publish, 20 is not', seoHas(seoProblems('t'.repeat(19), D50, 'publish'), 'I-MIN', 'seo.title') && !seoProblems(T20, D50, 'publish').some(p => p.code === 'I-MIN'), JSON.stringify([seoProblems('t'.repeat(19), D50, 'publish'), seoProblems(T20, D50, 'publish')]));
check('seo minimum: a 49 letter description is I-MIN at seo.description in publish, 50 is not', seoHas(seoProblems(T20, 'd'.repeat(49), 'publish'), 'I-MIN', 'seo.description') && !seoProblems(T20, D50, 'publish').some(p => p.code === 'I-MIN'), JSON.stringify([seoProblems(T20, 'd'.repeat(49), 'publish'), seoProblems(T20, D50, 'publish')]));
check('seo minimum: a short title with a good description is I-MIN at seo.title only', JSON.stringify(seoProblems('t'.repeat(19), D50, 'publish')) === '[{"code":"I-MIN","path":"seo.title"}]', JSON.stringify(seoProblems('t'.repeat(19), D50, 'publish')));
check('seo minimum: a draft that short is not refused (the minimum is a publish rule)', !seoProblems('t'.repeat(19), 'd'.repeat(49), 'draft').some(p => p.code === 'I-MIN'), JSON.stringify(seoProblems('t'.repeat(19), 'd'.repeat(49), 'draft')));
check('seo minimum: a blank title is I-REQUIRED in publish and not also I-MIN', seoHas(seoProblems('', D50, 'publish'), 'I-REQUIRED', 'seo.title') && !seoProblems('', D50, 'publish').some(p => p.code === 'I-MIN'), JSON.stringify(seoProblems('', D50, 'publish')));
check('seo minimum: the count trims, so 19 letters and a trailing space is I-MIN', seoHas(seoProblems(`${'t'.repeat(19)} `, D50, 'publish'), 'I-MIN', 'seo.title'), JSON.stringify(seoProblems(`${'t'.repeat(19)} `, D50, 'publish')));
check('seo minimum: it counts code points, so ten emoji (20 UTF-16 units) is I-MIN and twenty is not', seoHas(seoProblems('\u{1F600}'.repeat(10), D50, 'publish'), 'I-MIN', 'seo.title') && !seoProblems('\u{1F600}'.repeat(20), D50, 'publish').some(p => p.code === 'I-MIN'), JSON.stringify([seoProblems('\u{1F600}'.repeat(10), D50, 'publish'), seoProblems('\u{1F600}'.repeat(20), D50, 'publish')]));
for (const mode of ['publish', 'draft']) {
  check(`seo maximum (${mode}): a title of 60 is fine and 61 is I-MAX at seo.title`, !seoProblems('t'.repeat(60), D50, mode).some(p => p.code === 'I-MAX') && seoHas(seoProblems('t'.repeat(61), D50, mode), 'I-MAX', 'seo.title'), JSON.stringify([seoProblems('t'.repeat(60), D50, mode), seoProblems('t'.repeat(61), D50, mode)]));
  check(`seo maximum (${mode}): a description of 160 is fine and 161 is I-MAX at seo.description`, !seoProblems(T20, 'd'.repeat(160), mode).some(p => p.code === 'I-MAX') && seoHas(seoProblems(T20, 'd'.repeat(161), mode), 'I-MAX', 'seo.description'), JSON.stringify([seoProblems(T20, 'd'.repeat(160), mode), seoProblems(T20, 'd'.repeat(161), mode)]));
}
{
  const { readFileSync } = await import('node:fs');
  let got = null, why = '';
  try { got = JSON.parse(readFileSync(resolve(DIR, 'seo-limits.json'), 'utf8')); } catch (e) { why = String(e && e.message || e).split('\n')[0]; }
  check('seo limits: seo-limits.json holds title 20 (10 for zh, ja, ko) to 60 and description 50 (25) to 160, the numbers the audit (SE-202) judges by', JSON.stringify(got) === JSON.stringify({ title: { min: 20, minCjk: 10, max: 60 }, description: { min: 50, minCjk: 25, max: 160 } }), why || JSON.stringify(got));
}
// rich text (E18, audit H2-13): the allow-list of contracts/richtext.mjs; anything else is refused whole, in draft and publish
const rt = answer => codes(validateItem(GOOD, 'faqs', { question: 'Q?', answer }, { mode: 'draft' }));
const RICH_OK = '<h2>A</h2><p>Plain &amp; <strong>bold</strong>, <em>stress</em>, 3 > 2: <a href="https://example.com/a?b=1&amp;c=2">web</a> <a href="http://example.com/">old</a> <a href="mailto:x@example.com">mail</a> <a href="tel:+1 (555) 010-0000">call</a> <a href="/contact/">here</a> <a class="ul" href="../one-two/">up</a> <a class="ul" href="../../one/two-three/">up two</a>. <span class="ph">blank to fill</span> <span class="prov">from the old site</span></p><h3>B</h3><ul><li>one</li></ul><ol><li>two</li></ol>';
check('rich text: every allowed tag, class and link form passes, and so does plain text', rt(RICH_OK).length === 0 && rt('Fish & Chips').length === 0, `got [${rt(RICH_OK).join(', ')}]`);
for (const [what, s] of [['a script', '<script>alert(1)</script>'], ['an event attribute', '<p onclick="alert(1)">x</p>'], ['an event attribute written with an entity', '<p &#111;nclick="alert(1)">x</p>'],
  ['a javascript: link', '<a href="javascript:alert(1)">x</a>'], ['a javascript: link written with an entity', '<a href="&#106;avascript:alert(1)">x</a>'], ['a javascript: link with an encoded colon', '<a href="javascript&#58;alert(1)">x</a>'],
  ['a style with url(', '<p style="background:url(https://x.test/a.png)">x</p>'], ['a style with url( written with entities', '<p style="background:url&#40;https://x.test/a.png&#41;">x</p>'],
  ['an unclosed tag that would take the page\'s next ">"', '<img src="x" onerror="alert(1)"'], ['an allowed tag never closed', '<strong>x'], ['a closing tag that closes nothing', 'x</strong>'],
  ['a link to another host by //', '<a href="//evil.test/">x</a>'], ['a link to another host by /\\', '<a href="/\\evil.test/">x</a>'], ['a < that starts no allowed tag', 'price < 5'],
  ['a link class other than ul', '<a class="x" href="../a/">x</a>'], ['a span class other than ph or prov', '<span class="x">x</span>'], ['the class on another tag', '<p class="ul">x</p>'],
  ['.. inside a path', '<a href="../a/../b/">x</a>'], ['a control character in a link', '<a href="https://x.test/a\u0001b">x</a>'],
  ['a javascript: link that ends in an http address', '<a href="javascript:alert(1)//https://x.test/">x</a>'], ['an attribute after the link', '<a href="../a/" onclick="alert(1)">x</a>'],
  ['a second href', '<a href="../a/" href="javascript:alert(1)">x</a>'], ['an unquoted link with an event', '<a href=x onclick=alert(1)>x'], ['a single-quoted link', "<a href='javascript:alert(1)'>x"],
  ['a tag in capitals', '<SCRIPT>alert(1)'], ['a javascript: link in mixed case', '<a href="JavaScript:alert(1)">x</a>'], ['a tab and a newline inside a tag', '<img\tsrc=x\nonerror=alert(1)>'],
  ['a newline inside the scheme', '<a href="java\nscript:alert(1)">x</a>'], ['a tab the browser drops to make //', '<a href="/\t/evil.test/">x</a>'], ['a null byte inside a tag', '<scr\u0000ipt>alert(1)'],
  ['a comment', 'a<!-- x -->b'], ['CDATA', '<![CDATA[x]]>'], ['a processing instruction', '<?xml version="1.0"?>'], ['an svg', '<svg onload=alert(1)>'], ['a math block', '<math><mtext><img src=x onerror=alert(1)>'],
  ['tags closed out of order', '<strong><em>x</strong></em>'], ['.. written percent-encoded', '<a href="../%2e%2e/a/">x</a>']])
  check(`item I-RICHTEXT: ${what} is refused`, rt(s).includes('I-RICHTEXT'), `got [${rt(s).join(', ')}]`);
check('rich text: a long input is refused with one problem, not one per <', rt('<'.repeat(200000)).length === 1);
const ENCODED = ['&lt;script&gt;alert(1)&lt;/script&gt;', '&#60;script&#62;alert(1)&#60;/script&#62;', '&lt;p onclick=&quot;alert(1)&quot;&gt;x&lt;/p&gt;',
  '&lt;a href=&quot;javascript:alert(1)&quot;&gt;x&lt;/a&gt;', '&lt;p style=&quot;background:url(x)&quot;&gt;x&lt;/p&gt;', '&lt;img src=&quot;x&quot; onerror=&quot;alert(1)&quot;', '\uFF1Cscript\uFF1Ealert(1)\uFF1C/script\uFF1E'];
check('rich text: the entity-encoded form of each, and a look-alike of <, is text and passes (the page prints it as text: factory test)', ENCODED.every(s => rt(s).length === 0));
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
