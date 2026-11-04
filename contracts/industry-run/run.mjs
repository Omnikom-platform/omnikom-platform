// Industry run (DECISIONS 14): the same procedure for every industry Omnikom sells to.
//   node industry-run/run.mjs [--niches <OmniSuite niches dir>]
// For each industry: a paper plan (the page families and entities a typical plan for that business would declare; no
// real client) -> generated contract -> validated -> dashboard screens -> one synthetic row per collection that must
// pass the PUBLISH checks (proves every generated collection can hold valid content) -> the lead form's CRM map checked
// against that niche's OmniSuite custom fields (read from the niche pack files). Writes contracts/, screens/, RESULTS.md.
// Exit 0 = every industry valid and every row publishable; 1 = at least one failed.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
// Write only when the content differs, so running the gates leaves an unchanged tree untouched (dry run 2).
const writeIfChanged = (p, s) => { if (!existsSync(p) || readFileSync(p, 'utf8') !== s) writeFileSync(p, s); };
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from '../from-plan.mjs';
import { validateContract, validateItem, mergeCore } from '../validate.mjs';
import { screens } from '../screens.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ni = process.argv.indexOf('--niches');
const NICHES = ni > 0 ? process.argv[ni + 1] : 'E:/Omnisuite final stage the CTO Packets/omnisuite-platform/spec/30-product/niches';

const T = (type, max) => ({ type, ...(max ? { max } : {}) });
const req = f => ({ ...f, required: true });
const en = (...options) => ({ type: 'enum', options });
const lead = (fields, crm) => ({ label: 'Lead form', fields: { name: req(T('text', 120)), email: req(T('email')), phone: T('phone'), ...fields }, consent: { notice: 'form-consent' }, crm });

// Paper plans. families: page families the plan makes per area ("<service> in <area>"); collections from types.json.
const INDUSTRIES = [
  { id: 'real-estate', niche: 'real-estate', families: ['c-agent', 'c-buy', 'c-sell'],
    collections: { areas: { type: 'Place' }, listings: { type: 'RealEstateListing', route: '/listings/{slug}/', access: { member: 'own' }, ownerField: 'agent',
      fields: { area: req({ type: 'reference', to: 'areas' }), agent: req({ type: 'reference', to: 'team' }) } } },
    extend: { team: { areas: { type: 'reference', to: 'areas', multiple: true } } },
    form: lead({ side: en('buyer', 'seller', 'both'), area: { type: 'reference', to: 'areas' }, price: en('under-500k', '500k-1m', 'over-1m'), timing: en('now', '3-months', '6-months-plus'), financing: en('pre-approved', 'cash', 'not-yet') },
      { side: 'Buyer or Seller', area: 'Target Area', price: 'Price Range', timing: 'Move Timeframe', financing: 'Financing Status' }) },
  { id: 'insurance', niche: null, note: 'not an OmniSuite niche; compliance rules: skill rules/industries/insurance-agency', families: ['c-product'],
    collections: { areas: { type: 'Place', label: 'Licensed states' }, products: { type: 'FinancialProduct', route: '/insurance/{slug}/', fields: { availableIn: { type: 'text', max: 200, locked: { reason: 'licensed and appointed states, legal sign-off' } } } } },
    extend: { notices: { category: req(en('product-disclosure', 'consent', 'privacy', 'terms', 'general-disclosure')) } },
    form: lead({ interest: { type: 'reference', to: 'products' }, state: { type: 'reference', to: 'areas' } }, {}) },
  { id: 'cash-home-buyer', niche: null, note: 'not an OmniSuite niche; compliance rules: skill rules/industries/cash-home-buyer', families: ['c-sell-fast'],
    collections: { areas: { type: 'Place' }, situations: { type: 'Service', label: 'Situations we buy in', route: '/sell-my-house/{slug}/' }, purchases: { type: 'CaseStudy', label: 'Houses we bought', route: '/houses-we-bought/{slug}/', fields: { area: { type: 'reference', to: 'areas' } } } },
    form: lead({ address: req(T('text', 200)), condition: en('move-in-ready', 'needs-work', 'major-repairs'), timeline: en('asap', '30-days', '90-days', 'flexible') }, {}) },
  { id: 'agency', niche: 'agency', families: [],
    collections: { services: { type: 'Service', route: '/services/{slug}/' }, work: { type: 'CaseStudy', label: 'Case studies', route: '/work/{slug}/', fields: { services: { type: 'reference', to: 'services', multiple: true } } } },
    form: lead({ serviceLine: { type: 'reference', to: 'services' }, budget: en('under-5k', '5k-15k', 'over-15k') }, { serviceLine: 'Service Line Interest', budget: 'Retainer Tier' }) },
  { id: 'b2b', niche: 'b2b', families: [],
    collections: { solutions: { type: 'Service', label: 'Solutions', route: '/solutions/{slug}/' }, sectors: { type: 'Service', label: 'Industries served', route: '/industries/{slug}/' }, work: { type: 'CaseStudy', label: 'Case studies', route: '/customers/{slug}/', fields: { sector: { type: 'reference', to: 'sectors' } } } },
    form: lead({ company: req(T('text', 120)), companySize: en('1-10', '11-50', '51-200', '201-1000', '1000-plus'), role: en('decision-maker', 'influencer', 'researcher'), budget: en('yes', 'no', 'not-sure') }, { companySize: 'Company Size', role: 'Buying Role', budget: 'Budget Confirmed' }) },
  { id: 'chiropractic', niche: 'chiropractic', families: ['c-chiro'],
    collections: { areas: { type: 'Place' }, conditions: { type: 'Service', label: 'Conditions treated', route: '/conditions/{slug}/' }, plans: { type: 'Offer', label: 'Care plans' } },
    extend: { team: { credentials: { type: 'text', max: 120, locked: { reason: 'licence and credentials, fact sign-off' } } } },
    form: lead({ reason: { type: 'reference', to: 'conditions' }, insurer: T('text', 80), preferredTime: en('morning', 'afternoon', 'evening') }, { reason: 'Reason for Visit', insurer: 'Insurance Provider', preferredTime: 'Preferred Appointment Time' }) },
  { id: 'cleaning', niche: 'cleaning', families: ['c-clean'],
    collections: { areas: { type: 'Place' }, services: { type: 'Service', route: '/services/{slug}/' }, plans: { type: 'Offer', label: 'Plans and frequency' } },
    form: lead({ frequency: en('one-time', 'weekly', 'every-2-weeks', 'monthly'), propertyType: en('house', 'apartment', 'office'), size: T('text', 40), day: en('mon', 'tue', 'wed', 'thu', 'fri', 'sat') }, { frequency: 'Service Frequency', propertyType: 'Property Type', size: 'Property Size', day: 'Preferred Service Day' }) },
  { id: 'coaching', niche: 'coaching', families: [],
    collections: { programs: { type: 'Course', route: '/programs/{slug}/' } },
    form: lead({ program: { type: 'reference', to: 'programs' }, goal: req(T('text', 400)) }, { program: 'Program Interest', goal: 'Goal or Outcome Sought' }) },
  { id: 'default', niche: 'default', families: ['c-svc'],
    collections: { areas: { type: 'Place' }, services: { type: 'Service', route: '/services/{slug}/' } },
    form: lead({ message: T('text', 2000) }, {}) },
  { id: 'dental', niche: 'dental', families: ['c-dentist'],
    collections: { areas: { type: 'Place' }, treatments: { type: 'Service', label: 'Treatments', route: '/treatments/{slug}/' }, plans: { type: 'Offer', label: 'Membership plans' } },
    extend: { settings: { insuranceAccepted: { type: 'list', of: { name: req(T('text', 80)) } } }, team: { credentials: { type: 'text', max: 120, locked: { reason: 'licence and credentials, fact sign-off' } } } },
    form: lead({ patient: en('new', 'returning'), reason: { type: 'reference', to: 'treatments' }, insurer: T('text', 80), preferredTime: en('morning', 'afternoon', 'evening') }, { patient: 'New or Returning Patient', reason: 'Reason for Visit', insurer: 'Insurance Provider', preferredTime: 'Preferred Appointment Time' }) },
  { id: 'fitness', niche: 'fitness', families: ['c-gym'],
    collections: { areas: { type: 'Place' }, programs: { type: 'Course', label: 'Programs', route: '/programs/{slug}/' }, classes: { type: 'Event', label: 'Class schedule' }, memberships: { type: 'Offer', label: 'Memberships' } },
    form: lead({ membership: en('trial', 'monthly', 'annual', 'class-pack'), interest: { type: 'reference', to: 'programs' } }, { membership: 'Membership Type', interest: 'Class or Program Interest' }) },
  { id: 'home-services', niche: 'home-services', families: ['c-svc'],
    collections: { areas: { type: 'Place' }, services: { type: 'Service', route: '/services/{slug}/' }, projects: { type: 'CaseStudy', label: 'Recent jobs', route: '/projects/{slug}/', fields: { area: { type: 'reference', to: 'areas' } } } },
    extend: { settings: { emergencyLine: { type: 'phone' } } },
    form: lead({ service: { type: 'reference', to: 'services' }, propertyType: en('house', 'apartment', 'business'), urgency: req(en('emergency', 'this-week', 'planning')) }, { service: 'Service Type', propertyType: 'Property Type', urgency: 'Urgency' }) },
  { id: 'legal', niche: 'legal', families: ['c-lawyer'],
    collections: { areas: { type: 'Place' }, practice: { type: 'Service', label: 'Practice areas', route: '/practice-areas/{slug}/' },
      results: { type: 'CaseStudy', label: 'Case results', route: '/results/{slug}/', fields: { disclaimer: req({ type: 'reference', to: 'notices' }) } } },
    extend: { team: { barAdmissions: { type: 'text', max: 200, locked: { reason: 'bar admissions, fact sign-off' } } } },
    form: lead({ caseType: { type: 'reference', to: 'practice' }, referral: T('text', 80), summary: T('text', 2000) }, { caseType: 'Case Type', referral: 'Referral Source' }) },
  { id: 'med-spa', niche: 'med-spa', families: ['c-treatment'],
    collections: { areas: { type: 'Place' }, treatments: { type: 'Service', label: 'Treatments', route: '/treatments/{slug}/' },
      results: { type: 'BeforeAfter', label: 'Before and after', fields: { treatment: { type: 'reference', to: 'treatments' } } }, offers: { type: 'Offer', label: 'Packages' } },
    extend: { team: { credentials: { type: 'text', max: 120, locked: { reason: 'medical licence and credentials, fact sign-off' } } } },
    form: lead({ treatment: { type: 'reference', to: 'treatments' }, contactTime: en('morning', 'afternoon', 'evening') }, { treatment: 'Treatment Interest', contactTime: 'Preferred Contact Time' }) },
  { id: 'solar', niche: 'solar', families: ['c-solar'],
    collections: { areas: { type: 'Place' }, systems: { type: 'Product', label: 'Systems and batteries', route: '/systems/{slug}/' },
      incentives: { type: 'Service', label: 'Incentives and financing', route: '/incentives/{slug}/', fields: { amount: { type: 'text', max: 60, sourced: true } } },
      projects: { type: 'CaseStudy', label: 'Installs', route: '/projects/{slug}/', fields: { area: { type: 'reference', to: 'areas' } } } },
    form: lead({ homeowner: req(en('owner', 'renter')), bill: en('under-100', '100-200', '200-300', 'over-300'), roof: en('shingle', 'tile', 'metal', 'flat', 'not-sure'), financing: en('cash', 'loan', 'lease', 'not-sure') },
      { homeowner: 'Homeowner Status', bill: 'Average Monthly Bill', roof: 'Roof Type', financing: 'Financing Interest' }) },
];

// Paper plan -> sitemap + entities
function paper(ind) {
  const areaNames = ind.collections.areas ? ['Northtown, ST', 'Southville, ST'] : [];
  const pages = [{ path: '/', kind: 'home', schema: ['LocalBusiness'] }, { path: '/about/', kind: 'about', schema: ['AboutPage'] }, { path: '/contact/', kind: 'contact', schema: ['ContactPage'] }];
  for (const fam of ind.families) for (const a of areaNames) {
    const slug = a.split(',')[0].toLowerCase();
    pages.push({ path: `/${fam.slice(2)}-${slug}/`, kind: 'money', cluster: `${fam}-${slug}`, location: a, schema: ['Service'] });
  }
  const main = Object.entries(ind.collections).filter(([id]) => id !== 'areas');
  const homeSections = [{ id: 'hero', kind: 'fields', fields: { heading: req(T('text', 70)), lead: T('text', 240), image: req({ type: 'image', media: { minWidth: 1600, rightsConfirm: true } }) } },
    ...main.map(([id]) => ({ id: `feed-${id}`, kind: 'feed', accepts: id })), { id: 'reviews', kind: 'feed', accepts: 'testimonials' }, { id: 'contact', kind: 'form', form: 'lead' }];
  const placements = [...main.map(([id]) => ({ id: `${id}>home`, collection: id, to: { page: '/', section: `feed-${id}` }, limit: 6 })),
    { id: 'reviews>home', collection: 'testimonials', to: { page: '/', section: 'reviews' }, limit: 6 }];
  const areaFeedFor = main.filter(([, c]) => Object.values(c.fields || {}).some(f => f.type === 'reference' && f.to === 'areas')).map(([id]) => id);
  const pageTypes = { home: { sections: homeSections } };
  for (const fam of ind.families) pageTypes[`${fam.slice(2)}-in-area`] = { sections: [
    { id: 'intro', kind: 'fields', fields: { heading: req(T('text', 90)), lead: T('text', 300) } },
    { id: 'body', kind: 'fields', fields: { body: req(T('richtext')) } },
    ...areaFeedFor.map(id => ({ id: `near-${id}`, kind: 'feed', accepts: id })),
    { id: 'questions', kind: 'feed', accepts: 'faqs' }, { id: 'contact', kind: 'form', form: 'lead' }] };
  return {
    sitemap: { generatedAt: 'paper plan', pages },
    entities: { workspace: `paper-${ind.id}`, source: 'industry-run/run.mjs paper plan', locations: ind.collections.areas ? { collection: 'areas' } : undefined,
      families: Object.fromEntries(ind.families.map(f => [f, `${f.slice(2)}-in-area`])), pageTypeOf: {}, collections: ind.collections, extend: ind.extend,
      defaultForm: 'lead', forms: { lead: ind.form }, pageTypes, placements },
  };
}

// One synthetic row per collection that must pass PUBLISH: proves the generated collection can hold valid content.
const synthImg = { asset: 'x.jpg', alt: 'Synthetic photo', width: 2400, height: 1600, rightsConfirmed: true, exifStripped: true };
function synth(f, refs, key) {
  const t = f.type;
  let v;
  if (t === 'text' || t === 'richtext') v = 'Synthetic text';
  else if (t === 'slug') v = `synthetic-${key}`;
  else if (t === 'number') v = Math.max(f.min ?? 1, Math.min(f.max ?? 1, 1));
  else if (t === 'money') v = { amount: 100, currency: 'USD' };
  else if (t === 'boolean') v = true;
  else if (t === 'date') v = '2026-01-01';
  else if (t === 'datetime') v = '2026-01-01T10:00:00Z';
  else if (t === 'enum') v = f.options[0];
  else if (t === 'email') v = 'test@example.test';
  else if (t === 'phone') v = '+1 555 0100';
  else if (t === 'url') v = 'https://example.test/';
  else if (t === 'image') v = synthImg;
  else if (t === 'file') v = { asset: 'x.pdf' };
  else if (t === 'gallery') v = Array.from({ length: Math.max(f.min || 1, 1) }, () => synthImg);
  else if (t === 'reference') v = f.multiple ? [refs(f.to)] : refs(f.to);
  else if (t === 'address') v = { street: '1 Test Rd', city: 'Northtown', region: 'ST' };
  else if (t === 'geo') v = { lat: 1, lng: 1 };
  else if (t === 'list') v = Array.from({ length: Math.max(f.min || 1, 1) }, () => synthObj(f.of, refs, key));
  else if (t === 'group') v = f.open ? {} : synthObj(f.of, refs, key);
  else if (t === 'seo') v = { title: 'Synthetic title', description: 'Synthetic description' };
  if (f.sourced) v = { value: v, source: 'https://example.test/source', date: '2026-01-01' };
  return v;
}
const synthObj = (fields, refs, key) => Object.fromEntries(Object.entries(fields).map(([n, f]) => [n, synth(f, refs, key)]).filter(([, v]) => v !== undefined));

function nicheFields(niche) {
  if (!niche) return null;
  const p = join(NICHES, `${niche}.md`);
  if (!existsSync(p)) return { missing: p };
  const sec = (readFileSync(p, 'utf8').split(/^## 4\./m)[1] || '').split(/^## 5\./m)[0];
  return { fields: [...sec.matchAll(/^- `([^`]+)`/gm)].map(m => m[1]) };
}
// Fields the CRM keeps itself (status, signals): never asked on a website form.
const CRM_ONLY = new Set(['Last Intent Signal', 'Retainer Tier', 'Account Manager', 'Contract Renewal Date', 'Deal Stage Notes', 'Care Plan Stage',
  'Application Status', 'Onboarding Stage', 'Attendance Streak Weeks', 'Cancellation Requested', 'Quote Amount', 'Case Value Estimate', 'Conflict Check Status']);

mkdirSync(join(HERE, 'contracts'), { recursive: true });
mkdirSync(join(HERE, 'screens'), { recursive: true });
const rows = [];
let bad = 0;
for (const ind of INDUSTRIES) {
  const { sitemap, entities } = paper(ind);
  const contract = generate({ sitemap, business: { industry: ind.id }, existing: null, entities, planDir: 'paper plan' });
  writeIfChanged(join(HERE, 'contracts', `${ind.id}.json`), JSON.stringify(contract, null, 1) + '\n');
  const problems = validateContract(contract);
  const md = screens(contract);
  writeIfChanged(join(HERE, 'screens', `${ind.id}.md`), md);
  const cols = mergeCore(contract);
  const refs = to => `ref:${to}`;
  const publishFails = [];
  for (const [id, c] of Object.entries(cols)) {
    if (c.kind === 'inbox' || id === 'pages') continue;
    const errs = validateItem(contract, id, synthObj(c.fields, refs, id), { mode: 'publish' });
    if (errs.length) publishFails.push(`${id}: ${errs.map(e => e.code + ' ' + e.path).join(', ')}`);
  }
  for (const pg of contract.pages) {
    const t = contract.pageTypes[pg.type];
    const sections = Object.fromEntries(t.sections.filter(s => s.kind === 'fields').map(s => [s.id, synthObj(s.fields, refs, pg.type)]));
    const errs = validateItem(contract, 'pages', { path: pg.path, type: pg.type, title: 'T', seo: { title: 'T', description: 'D' }, sections }, { mode: 'publish' });
    if (errs.length) publishFails.push(`page ${pg.path}: ${errs.map(e => e.code + ' ' + e.path).join(', ')}`);
  }
  const lockedFields = Object.entries(cols).flatMap(([id, c]) => Object.entries(c.fields).filter(([, f]) => f.locked).map(([n]) => `${id}.${n}`));
  const nf = nicheFields(ind.niche);
  let crm = 'n/a (no OmniSuite niche)';
  let crmGap = [];
  if (nf && nf.missing) crm = `niche file missing: ${nf.missing}`;
  else if (nf) {
    const askable = nf.fields.filter(f => !CRM_ONLY.has(f));
    const mapped = new Set(Object.values(ind.form.crm || {}));
    crmGap = askable.filter(f => !mapped.has(f));
    const wrong = [...mapped].filter(f => !nf.fields.includes(f));
    crm = `${askable.length - crmGap.length}/${askable.length} askable niche fields fed by the form${crmGap.length ? `; NOT fed: ${crmGap.join(', ')}` : ''}${wrong.length ? `; UNKNOWN to niche: ${wrong.join(', ')}` : ''}`;
    if (wrong.length) publishFails.push(`crm map names fields the niche does not have: ${wrong.join(', ')}`);
  }
  const ok = !problems.length && !publishFails.length;
  if (!ok) bad++;
  const site = Object.entries(contract.collections).filter(([, c]) => !c.extend).map(([id, c]) => `${id} (${c.type})`);
  rows.push({ ind, ok, problems, publishFails, site, contract, lockedFields, crm, screensLines: md.split('\n').length,
    derived: contract.placements.filter(p => p.id.startsWith('derived')).length });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${ind.id.padEnd(16)} ${site.join(', ')} | ${contract.pages.length} pages, ${Object.keys(contract.pageTypes).length} page types, ${contract.placements.length} placements | CRM ${crm}`);
  for (const p of problems) console.log(`     ${p.code} ${p.path} ${p.msg}`);
  for (const p of publishFails) console.log(`     publish: ${p}`);
}

const out = ['# Industry run: one contract procedure, 15 industries', '',
  `Run: \`node contracts/industry-run/run.mjs\` (${new Date().toISOString().slice(0, 10)}). Generated, not hand-written: each row below is the output of the same`,
  'generator, validator and screen builder used for Example A, Example C and Example D. The plans are **paper plans** (what a typical plan for that',
  'business declares; no real client), so this proves the contract can express each industry, not that a real plan for it was run.', '',
  'Per industry: contract valid · one synthetic row per collection and per page passes the **publish** checks · the lead form feeds the',
  'OmniSuite niche custom fields a website can ask for (fields the CRM keeps itself, like Last Intent Signal or Conflict Check Status, are excluded).', '',
  '| Industry | Result | Site collections (type) | Pages / types | Placements (derived) | Locked fields | Lead form -> OmniSuite | Screens |',
  '|---|---|---|---|---|---|---|---|'];
for (const r of rows) out.push(`| ${r.ind.id}${r.ind.note ? ` (${r.ind.note})` : ''} | ${r.ok ? 'PASS' : 'FAIL'} | ${r.site.join(', ')} | ${r.contract.pages.length} / ${Object.keys(r.contract.pageTypes).length} | ${r.contract.placements.length} (${r.derived}) | ${r.lockedFields.length} | ${r.crm} | [screens/${r.ind.id}.md](screens/${r.ind.id}.md) |`);
out.push('', `Result: ${rows.length - bad}/${rows.length} industries PASS.`, '',
  'Locked fields present in every industry (core): settings.legalName, settings.licences, settings.footerNotice, pages.path, pages.type, team.licence, notices.text, notices.approvedBy, notices.approvedOn. Industry extras: ' +
  rows.map(r => `${r.ind.id}: ${r.lockedFields.filter(f => !/^(settings\.(legalName|licences|footerNotice)|pages\.(path|type)|team\.licence|notices\.(text|approvedBy|approvedOn))$/.test(f)).join(', ') || 'none'}`).join('; ') + '.', '');
writeIfChanged(join(HERE, 'RESULTS.md'), out.join('\n'));
console.log(`\n${rows.length - bad}/${rows.length} PASS; wrote industry-run/RESULTS.md, contracts/, screens/`);
process.exit(bad ? 1 : 0);
