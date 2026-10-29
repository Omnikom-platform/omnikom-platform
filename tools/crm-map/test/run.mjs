// crm-map tests. No framework: plain `assert`, one line per check, prints "N passed, M failed", exits 1 on any failure.
//   node tools/crm-map/test/run.mjs
// CRM_MAP_DIR points the tests at another copy of map.mjs + dictionary.mjs (test/mutate.mjs runs broken copies this way).
// The fixture is synthetic ("Jordan Reyes"), never a client's data.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const DIR = process.env.CRM_MAP_DIR || ROOT;
// a fresh query string on the URL so no earlier copy of the module is ever reused
const m = await import(`${pathToFileURL(resolve(DIR, 'map.mjs')).href}?run=${Date.now()}-${Math.random().toString(36).slice(2)}`);
const { normaliseHeader, score, proposeMap, exportRows, importRows, toCsv, parseCsv, validateTemplate, LEAD_FIELDS } = m;
const hubspot = JSON.parse(readFileSync(join(ROOT, 'templates', 'hubspot.json'), 'utf8'));
const google = JSON.parse(readFileSync(join(ROOT, 'templates', 'google-contacts.json'), 'utf8'));

const eq = assert.deepStrictEqual;
const BOM = String.fromCharCode(0xFEFF);
const DASHES = [String.fromCharCode(0x2014), String.fromCharCode(0x2013)]; // em dash, en dash: written as codes so this file has none
let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`ok   ${name}`); }
  catch (e) { failed++; console.log(`FAIL ${name}  ${String(e && e.message).split('\n')[0].slice(0, 160)}`); }
}
const cols = (...c) => ({ columns: c.map(([header, field, transform]) => (transform ? { header, field, transform } : { header, field })), value_maps: {} });
const one = (field, transform, leadValue, opts) => exportRows(cols(['X', field, transform]), [leadValue], opts)[0].X;
const back = (field, transform, cell, opts) => importRows(cols(['X', field, transform]), [{ X: cell }], opts);
const lead = (over = {}) => ({
  name: 'Jordan Reyes', email: 'jordan@example.com', phone: '+15105550142', form: 'home-value', page_path: '/sell/oakland/',
  flow: 'home-value', cta: 'Get my value', status: 'new', created_at: '2026-10-29T14:03:00Z',
  answers: { address: '123 Main St, Oakland, CA 94612', budget: '900000', beds: '3', timing: '3 months', message: 'Call me, please.\nThanks "soon"' },
  ...over,
});

// ================================================================= normalise
check('normalise: email spellings', () => { for (const h of ['E-mail', 'mail', 'emailaddress', 'Email Address', 'EMAIL', 'e_mail']) eq(normaliseHeader(h), 'email'); });
check('normalise: phone abbreviations', () => { for (const h of ['ph', 'tel', 'mob', 'mobile', 'cell', 'Phone Number', 'Cell Phone', 'Mobile Phone']) eq(normaliseHeader(h), 'phone'); });
check('normalise: first name abbreviations', () => { for (const h of ['fname', 'first', 'firstname', 'givenname', 'Given Name', 'First Name']) eq(normaliseHeader(h), 'first name'); });
check('normalise: last name abbreviations', () => { for (const h of ['lname', 'last', 'lastname', 'surname', 'familyname', 'Family Name']) eq(normaliseHeader(h), 'last name'); });
check('normalise: postal code abbreviations', () => { for (const h of ['zip', 'zipcode', 'postcode', 'postal', 'Zip Code', 'Postal Code']) eq(normaliseHeader(h), 'postal code'); });
check('normalise: street abbreviations', () => { for (const h of ['st', 'street', 'address1', 'addr', 'Address 1']) eq(normaliseHeader(h), 'street'); });
check('normalise: created at abbreviations', () => { for (const h of ['dt', 'date', 'created', 'createdat', 'dateadded', 'Created_At']) eq(normaliseHeader(h), 'created at'); });
check('normalise: inquiry date spellings are a created at', () => {
  for (const h of ['Inquiry Date', 'InquiryDate', 'inquiry_date', 'Lead Date', 'LeadDate', 'Date of Inquiry', 'dateofinquiry']) eq(normaliseHeader(h), 'created at', h);
  eq(normaliseHeader('Inquiry'), 'inquiry');
});
check('normalise: flow abbreviations', () => { for (const h of ['src', 'source', 'leadsource', 'Lead Source']) eq(normaliseHeader(h), 'flow'); });
check('normalise: status abbreviations', () => { for (const h of ['stage', 'leadstatus', 'Lead Status']) eq(normaliseHeader(h), 'status'); });
check('normalise: message abbreviations', () => { for (const h of ['notes', 'comments', 'message', 'Notes']) eq(normaliseHeader(h), 'message'); });
check('normalise: case, punctuation, spaces, BOM, empties', () => {
  eq(normaliseHeader('  Phone   Number '), 'phone');
  eq(normaliseHeader('FIRST-NAME'), 'first name');
  eq(normaliseHeader(BOM + 'Name'), 'name');
  eq(normaliseHeader('E-mail 1 - Value'), 'email 1 value');
  eq(normaliseHeader('State/Region'), 'state region');
  eq(normaliseHeader(null), ''); eq(normaliseHeader(undefined), ''); eq(normaliseHeader('  --  '), '');
});
check('normalise: a word repeated by expansion appears once', () => { eq(normaliseHeader('Tel Phone'), 'phone'); eq(normaliseHeader('Phone Mobile Cell'), 'phone'); });
check('normalise: ambiguous words expand only as the whole header', () => {
  eq(normaliseHeader('Close Date'), 'close date');
  eq(normaliseHeader('Mailing Addr'), 'mailing addr');
  eq(normaliseHeader('Last Contacted'), 'last contacted');
});
check('normalise: object property names are plain words', () => { eq(normaliseHeader('constructor'), 'constructor'); eq(normaliseHeader('toString'), 'tostring'); });

// ================================================================= score
check('score: exact synonym is 1.0 (spellings, vendor headers, glued)', () => {
  eq(score('email', 'E-mail Address'), 1); eq(score('phone', 'Phone Number'), 1); eq(score('email', 'E-mail 1 - Value'), 1);
  eq(score('phone', 'Phone 1 - Value'), 1); eq(score('answers.address', 'PropertyAddress'), 1); eq(score('status', 'Lifecycle Stage'), 1);
});
check('score: token overlap is Jaccard', () => { eq(score('phone', 'Home Phone'), 0.5); eq(score('phone', 'Mobile Phone Verified Flag'), 0.333); });
check('score: exact beats partial beats unrelated', () => {
  const exact = score('phone', 'Phone'), partial = score('phone', 'Home Phone'), none = score('phone', 'Favourite colour');
  assert.ok(exact > partial && partial > none, `${exact} ${partial} ${none}`);
  eq(none, 0);
});
check('score: edit distance rescues a typo in a short header', () => { eq(score('email', 'Emial'), 0.8); eq(score('email', 'Emal'), 0.8); });
check('score: edit distance is capped under 1.0', () => { assert.ok(score('answers.address', 'Adress') < 1 && score('answers.address', 'Adress') >= 0.8); });
check('score: edit distance is not tried on long headers', () => { eq(score('answers.timing', 'purchasetimelines'), 0); });
check('score: edit distance below the gate counts as nothing', () => { eq(score('phone', 'Zone'), 0); eq(score('form', 'Fro'), 0); });
check('score: part words keep First Name off the whole name', () => {
  eq(score('name', 'First Name'), 0); eq(score('name.first', 'First Name'), 1); eq(score('name.last', 'First Name'), 0); eq(score('answers.address', 'City'), 0);
});
check('score: a company or owner column is not the lead\'s own', () => { eq(score('name', 'Company Name'), 0); eq(score('email', 'Owner Email'), 0); });
check('score: phone-looking values cannot map to email', () => {
  assert.ok(score('email', 'Email', ['510-555-0142', '(415) 555-0199', '+1 650 555 0123']) < 0.5);
  eq(score('email', 'Email', ['a@x.com', 'b@y.org']), 1);
});
check('score: date-looking values cannot map to name', () => {
  assert.ok(score('name', 'Name', ['2026-10-29', '10/30/2026']) < 0.5);
  eq(score('name', 'Name', ['Jordan Reyes', 'Sam Lee']), 1);
});
check('score: email-looking values cannot map to phone, numbers cannot map to name', () => {
  assert.ok(score('phone', 'Phone', ['a@x.com', 'b@y.org']) < 0.5);
  assert.ok(score('name', 'Name', ['94612', '90210']) < 0.5);
});
check('score: the penalty is exactly 0.6 and needs most values to agree', () => {
  eq(score('email', 'Email', ['5105550142', '4155550199']), 0.4);
  eq(score('email', 'Email', ['5105550142', 'plain', 'text', 'more', 'words']), 1);
});
check('score: with no value type reaching 60% there is no penalty', () => {
  eq(score('email', 'Email', ['5105550142', '4155550199', 'a@x.com', 'b@x.com', 'text']), 1);
});
check('score: a fuzzy match is capped at 0.9 even when one letter is off in a long word', () => { eq(score('answers.budget', 'Budgetrangs'), 0.9); });
check('score: no penalty without samples, with blank samples, or for a free-text field', () => {
  eq(score('email', 'Email'), 1); eq(score('email', 'Email', []), 1); eq(score('email', 'Email', ['', null, undefined]), 1);
  eq(score('answers.message', 'Message', ['5105550142', 'a@x.com']), 1);
});
check('score: a penalty never goes below 0 and a zero stays zero', () => { eq(score('email', 'Zebra', ['5105550142']), 0); assert.ok(score('phone', 'Phone Home Stuff', ['a@x.com']) >= 0); });
check('score: always between 0 and 1', () => {
  for (const f of LEAD_FIELDS) for (const h of ['Email', 'Phone', 'Home Phone', 'x', '', 'Created At', 'Zip', 'Emial', 'State/Province', 'A | B']) { const s = score(f, h, ['1', 'a@b.co']); assert.ok(s >= 0 && s <= 1, `${f} ${h} ${s}`); }
});
check('score: a field the dictionary does not know scores by its own name', () => { eq(score('answers.price_range', 'Price Range'), 1); eq(score('answers.price_range', 'Zebra'), 0); });
check('score: a compound header is tried part by part, split on / and |', () => {
  eq(score('answers.address.state', 'State/Province'), 1); eq(score('answers.address.state', 'Province/State'), 1);
  eq(score('answers.address.state', 'Province | State'), 1); eq(score('phone', 'Fax | Phone'), 1); eq(score('email', 'Email/Phone'), 1);
  eq(score('answers.address.city', 'State/Province'), 0);
  eq(score('answers.address.state', 'State/'), 1); eq(score('answers.address.state', '/|'), 0);
});
check('score: Inquiry Date is a created_at, a bare Inquiry stays the message', () => {
  eq(score('created_at', 'Inquiry Date'), 1); eq(score('created_at', 'DateOfInquiry'), 1); eq(score('created_at', 'Lead Date'), 1);
  eq(score('answers.message', 'Inquiry Date'), 0); eq(score('answers.message', 'Inquiry'), 1); eq(score('created_at', 'Inquiry'), 0);
});

// ================================================================= proposeMap
check('proposeMap: typical headers map, name splits', () => {
  const r = proposeMap(LEAD_FIELDS, ['First Name', 'Last Name', 'Email', 'Phone Number', 'Lead Status', 'Message']);
  eq(r.columns, [
    { header: 'First Name', field: 'name', transform: 'first', score: 1 }, { header: 'Last Name', field: 'name', transform: 'last', score: 1 },
    { header: 'Email', field: 'email', score: 1 }, { header: 'Phone Number', field: 'phone', score: 1 },
    { header: 'Lead Status', field: 'status', score: 1 }, { header: 'Message', field: 'answers.message', score: 1 },
  ]);
  eq(r.unmapped.headers, []);
  eq(r.splits, [{ field: 'name', into: [{ header: 'First Name', transform: 'first', score: 1 }, { header: 'Last Name', transform: 'last', score: 1 }] }]);
  eq(r.warnings, []);
});
check('proposeMap: one column per field and one field per column', () => {
  const r = proposeMap(LEAD_FIELDS, ['Email', 'E-mail', 'Email Address', 'Phone', 'Mobile', 'Name']);
  eq(r.columns.map(c => [c.header, c.field]), [['Email', 'email'], ['Phone', 'phone'], ['Name', 'name']]);
  eq(r.unmapped.headers.map(h => h.header), ['E-mail', 'Email Address', 'Mobile']);
  const headers = r.columns.map(c => c.header);
  eq(new Set(headers).size, headers.length);
});
check('proposeMap: a tie goes to the earlier column', () => {
  const r = proposeMap(['phone'], ['Telephone', 'Mobile']);
  eq(r.columns, [{ header: 'Telephone', field: 'phone', score: 1 }]);
});
check('proposeMap: a tie goes to the synonym listed first in the dictionary, whatever the column order', () => {
  for (const order of [['Lifecycle Stage', 'Lead Status'], ['Lead Status', 'Lifecycle Stage']]) {
    const r = proposeMap(['status'], order);
    eq(r.columns, [{ header: 'Lead Status', field: 'status', score: 1 }]);
    eq(r.unmapped.headers, [{ header: 'Lifecycle Stage', best: { field: 'status', score: 1 } }]);
    eq(r.unmapped.fields, []);
  }
});
check('proposeMap: the dictionary rank settles the tie among all fields, in both orders, with other columns around', () => {
  const a = proposeMap(LEAD_FIELDS, ['Lifecycle Stage', 'Email', 'Lead Status', 'Phone Number']);
  const b = proposeMap(LEAD_FIELDS, ['Phone Number', 'Lead Status', 'Email', 'Lifecycle Stage']);
  const pairs = r => r.columns.map(c => `${c.header}>${c.field}`).sort();
  eq(pairs(a), ['Email>email', 'Lead Status>status', 'Phone Number>phone']); eq(pairs(b), pairs(a));
  eq(a.unmapped.headers.map(h => h.header), ['Lifecycle Stage']); eq(b.unmapped.headers.map(h => h.header), ['Lifecycle Stage']);
  eq(proposeMap(['status'], ['Lifecycle Stage', 'Stage']).columns[0].header, 'Stage');
  eq(proposeMap(['status'], ['Stage', 'Lifecycle Stage']).columns[0].header, 'Stage');
});
check('proposeMap: equal rank and equal score still goes to the lower column, so the answer never varies', () => {
  eq(proposeMap(['status'], ['Status', 'Lead Status']).columns[0].header, 'Status');
  eq(proposeMap(['status'], ['Lead Status', 'Status']).columns[0].header, 'Lead Status');
});
check('proposeMap: best score first, whatever the column order', () => {
  eq(proposeMap(['phone'], ['Home Phone', 'Phone']).columns, [{ header: 'Phone', field: 'phone', score: 1 }]);
  eq(proposeMap(['phone'], ['Phone', 'Home Phone']).columns, [{ header: 'Phone', field: 'phone', score: 1 }]);
});
check('proposeMap: a pair under 0.5 is refused, with its best candidate kept', () => {
  const r = proposeMap(['phone'], ['Mobile Phone Verified Flag']);
  eq(r.columns, []);
  eq(r.unmapped.headers, [{ header: 'Mobile Phone Verified Flag', best: { field: 'phone', score: 0.333 } }]);
  eq(r.unmapped.fields, [{ field: 'phone', best: { header: 'Mobile Phone Verified Flag', score: 0.333 } }]);
});
check('proposeMap: exactly 0.5 is accepted', () => { eq(proposeMap(['phone'], ['Home Phone']).columns, [{ header: 'Home Phone', field: 'phone', score: 0.5 }]); });
check('proposeMap: nothing close leaves best as null', () => {
  const r = proposeMap(['cta'], ['Zebra']);
  eq(r.unmapped, { headers: [{ header: 'Zebra', best: null }], fields: [{ field: 'cta', best: null }] });
});
check('proposeMap: one header never serves two fields', () => {
  const r = proposeMap(['phone', 'answers.message'], ['Phone Notes']);
  eq(r.columns.length, 1); eq(r.unmapped.fields.length, 1);
});
check('proposeMap: the best candidate of an unmapped field is the highest, not the last', () => {
  const r = proposeMap(['phone'], ['Phone Verified Flag', 'Phone Flag Extra Note']);
  eq(r.columns, []); eq(r.unmapped.fields, [{ field: 'phone', best: { header: 'Phone Verified Flag', score: 0.333 } }]);
});
check('proposeMap: our field with no column is listed, not forced', () => {
  const r = proposeMap(['email', 'answers.message'], ['Email']);
  eq(r.columns.length, 1); eq(r.unmapped.fields, [{ field: 'answers.message', best: null }]);
});
check('proposeMap: address splits into street, city, state, postal code', () => {
  const r = proposeMap(LEAD_FIELDS, ['Street Address', 'City', 'State/Region', 'Postal Code', 'Email']);
  eq(r.splits, [{ field: 'answers.address', into: [
    { header: 'Street Address', transform: 'street', score: 1 }, { header: 'City', transform: 'city', score: 1 },
    { header: 'State/Region', transform: 'state', score: 1 }, { header: 'Postal Code', transform: 'postal_code', score: 1 }] }]);
  eq(r.columns.filter(c => c.field === 'answers.address').length, 4);
});
check('proposeMap: State/Province maps to the state part of the address', () => {
  const r = proposeMap(LEAD_FIELDS, ['Street', 'City', 'State/Province', 'Zip']);
  eq(r.columns.map(c => [c.header, c.field, c.transform]), [['Street', 'answers.address', 'street'], ['City', 'answers.address', 'city'], ['State/Province', 'answers.address', 'state'], ['Zip', 'answers.address', 'postal_code']]);
  eq(proposeMap(['answers.address'], ['Street', 'City', 'Province | State', 'Zip']).splits[0].into.map(p => p.transform), ['street', 'city', 'state', 'postal_code']);
});
check('proposeMap: a bare "Address" next to City and Zip is the street', () => {
  const r = proposeMap(['answers.address'], ['Address', 'City', 'Zip']);
  eq(r.columns.map(c => [c.header, c.transform]), [['Address', 'street'], ['City', 'city'], ['Zip', 'postal_code']]);
});
check('proposeMap: a lone street column maps to the whole address', () => {
  const r = proposeMap(LEAD_FIELDS, ['Street Address', 'Email']);
  eq(r.splits, []); eq(r.columns[0], { header: 'Street Address', field: 'answers.address', score: 1 });
});
check('proposeMap: Name next to Given Name and Family Name keeps all three', () => {
  const r = proposeMap(['name', 'email'], ['Name', 'Given Name', 'Family Name', 'E-mail 1 - Value']);
  eq(r.columns.map(c => [c.header, c.field, c.transform]), [['Name', 'name', undefined], ['Given Name', 'name', 'first'], ['Family Name', 'name', 'last'], ['E-mail 1 - Value', 'email', undefined]]);
  eq(r.splits.length, 1);
});
check('proposeMap: a lone First Name is not a split; the wizard is told', () => {
  const r = proposeMap(['name'], ['First Name']);
  eq(r.columns, []); eq(r.splits, []);
  eq(r.unmapped.fields, [{ field: 'name', best: { header: 'First Name', score: 1 } }]);
});
check('proposeMap: Inquiry Date is the created_at and Inquiry stays the message', () => {
  const r = proposeMap(LEAD_FIELDS, ['Inquiry Date', 'Inquiry']);
  eq(r.columns, [{ header: 'Inquiry Date', field: 'created_at', score: 1 }, { header: 'Inquiry', field: 'answers.message', score: 1 }]);
});
check('proposeMap: sample rows (objects) veto a column of the wrong type', () => {
  eq(proposeMap(['email', 'phone'], ['Email', 'Phone'], [{ Email: '510-555-0142', Phone: 'a@x.com' }]).columns, []);
  eq(proposeMap(['email', 'phone'], ['Email', 'Phone'], [{ Email: 'a@x.com', Phone: '510-555-0142' }]).columns.length, 2);
});
check('proposeMap: sample rows (arrays) line up with the headers', () => {
  eq(proposeMap(['email'], ['Name', 'Email'], [['Sam', '510-555-0142'], ['Lee', '415-555-0199']]).columns, []);
  eq(proposeMap(['email'], ['Name', 'Email'], [['Sam', 'a@x.com']]).columns.length, 1);
});
check('proposeMap: columns come back in the sheet\'s order', () => {
  const r = proposeMap(['phone', 'email', 'name'], ['Name', 'Email', 'Phone']);
  eq(r.columns.map(c => c.header), ['Name', 'Email', 'Phone']);
});
check('proposeMap: blank headers and no fields are fine', () => { eq(proposeMap(['email'], ['', null]).columns, []); eq(proposeMap([], ['Email']).columns, []); eq(proposeMap(['email'], ['', null]).warnings, []); });
check('proposeMap: its columns are a usable template', () => {
  const r = proposeMap(LEAD_FIELDS, ['First Name', 'Last Name', 'Email', 'Phone Number']);
  const t = { columns: r.columns.map(({ header, field, transform }) => (transform ? { header, field, transform } : { header, field })), value_maps: {} };
  eq(validateTemplate(t), []);
  eq(exportRows(t, [lead()])[0], { 'First Name': 'Jordan', 'Last Name': 'Reyes', Email: 'jordan@example.com', 'Phone Number': '+15105550142' });
});
check('proposeMap warnings: a sheet that looks non-English says which headers mapped nothing', () => {
  const heads = ['Nombre', 'Correo', 'Telefono', 'Mensaje'];
  const r = proposeMap(LEAD_FIELDS, heads);
  eq(r.columns, []); eq(r.warnings.length, 1);
  assert.match(r.warnings[0], /non-English/);
  for (const h of heads) assert.ok(r.warnings[0].includes(h), h);
  const mixed = proposeMap(LEAD_FIELDS, ['Email', 'Nombre', 'Apellido', 'Telefono']);
  eq(mixed.columns.map(c => c.header), ['Email']); eq(mixed.warnings.length, 1);
  for (const h of ['Nombre', 'Apellido', 'Telefono']) assert.ok(mixed.warnings[0].includes(h), h);
  assert.ok(!mixed.warnings[0].includes('"Email"'));
});
check('proposeMap warnings: exactly half known words is not non-English; an English sheet with odd headers is quiet', () => {
  eq(proposeMap(LEAD_FIELDS, ['Email', 'Nombre']).warnings, []);
  eq(proposeMap(LEAD_FIELDS, ['Email', 'Phone', 'Favourite colour']).warnings, []);
  eq(proposeMap(LEAD_FIELDS, ['Email', 'Nombre', 'Apellido']).warnings.length, 1);
  eq(proposeMap(LEAD_FIELDS, ['Email', 'Phone', 'Nombre', 'Apellido']).warnings, []);
});
check('proposeMap warnings: a number in a header is not a word the dictionary knows', () => {
  eq(proposeMap(LEAD_FIELDS, ['Email', 'Nombre 1', 'Apellido 1']).warnings.length, 1);
});
check('proposeMap warnings: a sheet where everything mapped (typos) is not warned about', () => {
  eq(proposeMap(['email'], ['Emial']).warnings, []);
});
check('proposeMap warnings: one header holding ; says the file may use semicolons', () => {
  const r = proposeMap(LEAD_FIELDS, ['Name;Email;Phone']);
  eq(r.warnings.length, 1); assert.match(r.warnings[0], /semicolon/); assert.ok(r.warnings[0].includes('delimiter'));
  eq(proposeMap(LEAD_FIELDS, ['Email']).warnings, []);
  eq(proposeMap(LEAD_FIELDS, ['Name;Email', 'Phone']).warnings.filter(w => /semicolon/.test(w)), []);
});
check('proposeMap warnings: a semicolon file parsed with the guess then proposed has no semicolon warning of its own', () => {
  const parsed = parseCsv('Name;Email;Phone\nA;a@x.com;510-555-0142\n');
  const r = proposeMap(LEAD_FIELDS, parsed.headers, parsed.rows);
  eq(r.columns.map(c => c.field), ['name', 'email', 'phone']); eq(r.warnings, []);
});

// ================================================================= names, addresses
check('name: splits on the last space', () => {
  eq(one('name', 'first', { name: 'Mary Ann Smith' }), 'Mary Ann'); eq(one('name', 'last', { name: 'Mary Ann Smith' }), 'Smith');
  eq(one('name', 'first', { name: ' Jordan   Reyes ' }), 'Jordan');
});
check('name: one word is a first name only', () => { eq(one('name', 'first', { name: 'Cher' }), 'Cher'); eq(one('name', 'last', { name: 'Cher' }), ''); });
check('name: split then join gives the name back', () => {
  const t = cols(['F', 'name', 'first'], ['L', 'name', 'last']);
  for (const n of ['Jordan Reyes', 'Mary Ann Smith', 'Cher']) {
    const row = exportRows(t, [{ name: n }]);
    eq(importRows(t, row).leads, [{ name: n }]);
  }
});
const NAME_CASES = [
  ['Maria van der Berg', 'Maria', 'van der Berg'], ['Juan de la Cruz', 'Juan', 'de la Cruz'], ['Mary Ann van den Heuvel', 'Mary Ann', 'van den Heuvel'],
  ['Ludwig von Beethoven', 'Ludwig', 'von Beethoven'], ['Ana dos Santos', 'Ana', 'dos Santos'], ['Pierre du Pont', 'Pierre', 'du Pont'],
  ['Lucia della Rocca', 'Lucia', 'della Rocca'], ['Marco di Stefano', 'Marco', 'di Stefano'], ['Rosa da Silva', 'Rosa', 'da Silva'],
  ['Carlos del Toro', 'Carlos', 'del Toro'], ['Ali bin Hassan', 'Ali', 'bin Hassan'], ['Omar el Sayed', 'Omar', 'el Sayed'],
  ['Yusuf al Rashid', 'Yusuf', 'al Rashid'], ['Mary St. John', 'Mary', 'St. John'], ['Mary St John', 'Mary', 'St John'], ['Tom le Roux', 'Tom', 'le Roux'],
  ['Jan VAN DER Berg', 'Jan', 'VAN DER Berg'], ['Al Pacino', 'Al', 'Pacino'], ['De Niro', 'De', 'Niro'],
  ['John Smith Jr.', 'John', 'Smith Jr.'], ['John Smith Jr', 'John', 'Smith Jr'], ['John Smith Sr.', 'John', 'Smith Sr.'], ['John Smith II', 'John', 'Smith II'],
  ['John Smith III', 'John', 'Smith III'], ['John Smith IV', 'John', 'Smith IV'], ['John Smith iii', 'John', 'Smith iii'], ['John van Berg Jr.', 'John', 'van Berg Jr.'],
  ['Mary Ann Smith Jr.', 'Mary Ann', 'Smith Jr.'], ['John Jr.', 'John', 'Jr.'],
];
check('name: particles stay with the last name, suffixes stay with the last name', () => {
  for (const [full, first, last] of NAME_CASES) { eq(one('name', 'first', { name: full }), first, full); eq(one('name', 'last', { name: full }), last, full); }
});
check('name: "Smith, John" is John / Smith, with a suffix or particle in the right place', () => {
  const split = n => [one('name', 'first', { name: n }), one('name', 'last', { name: n })];
  eq(split('Smith, John'), ['John', 'Smith']); eq(split('Smith,John'), ['John', 'Smith']);
  eq(split('van der Berg, Maria'), ['Maria', 'van der Berg']); eq(split('Reyes, Mary Ann'), ['Mary Ann', 'Reyes']);
  eq(split('John Smith, Jr.'), ['John', 'Smith Jr.']); eq(split('Smith, John Jr.'), ['John', 'Smith Jr.']); eq(split('Smith, John, Jr.'), ['John', 'Smith Jr.']);
  eq(split('Smith,'), ['Smith', '']); eq(split(', John'), ['John', '']);
  eq(split('Smith, John, Mary'), ['Smith John', 'Mary']);
});
check('name: the parts join back to the same name, and a second split gives the same parts', () => {
  const t = cols(['F', 'name', 'first'], ['L', 'name', 'last']);
  for (const [full, first, last] of NAME_CASES) {
    const row = exportRows(t, [{ name: full }]);
    eq(row, [{ F: first, L: last }]);
    const back1 = importRows(t, row).leads;
    eq(back1, [{ name: full.replace(/\s+/g, ' ') }], full);
    eq(exportRows(t, back1), row);
  }
  const row = exportRows(t, [{ name: 'Smith, John' }]);
  eq(importRows(t, row).leads, [{ name: 'John Smith' }]); eq(exportRows(t, importRows(t, row).leads), row);
});
check('name: a full-name column beats first and last on import', () => {
  eq(importRows(cols(['F', 'name', 'first'], ['L', 'name', 'last'], ['N', 'name']), [{ F: 'A', L: 'B', N: 'Alexandra Brown' }]).leads, [{ name: 'Alexandra Brown' }]);
  eq(importRows(cols(['F', 'name', 'first'], ['L', 'name', 'last']), [{ F: 'Only', L: '' }]).leads, [{ name: 'Only' }]);
});
const addrT = cols(['S', 'answers.address', 'street'], ['C', 'answers.address', 'city'], ['ST', 'answers.address', 'state'], ['Z', 'answers.address', 'zip']);
const addr = text => exportRows(addrT, [{ answers: { address: text } }])[0];
check('address: split into street, city, state, postal code', () => {
  eq(addr('123 Main St, Oakland, CA 94612'), { S: '123 Main St', C: 'Oakland', ST: 'CA', Z: '94612' });
  eq(addr('123 Main St, Oakland, CA 94612-1234'), { S: '123 Main St', C: 'Oakland', ST: 'CA', Z: '94612-1234' });
});
check('address: odd shapes keep what they can', () => {
  eq(addr('123 Main St'), { S: '123 Main St', C: '', ST: '', Z: '' });
  eq(addr('123 Main St, Oakland'), { S: '123 Main St', C: 'Oakland', ST: '', Z: '' });
  eq(addr('Unit 4, 12 Oak Rd, Reno, NV 89501'), { S: 'Unit 4, 12 Oak Rd', C: 'Reno', ST: 'NV', Z: '89501' });
  eq(addr('123 Main St, Oakland, CA, 94612'), { S: '123 Main St', C: 'Oakland', ST: 'CA', Z: '94612' });
});
check('address: the parts join back, and the round trip is stable', () => {
  const row = addr('123 Main St, Oakland, CA 94612');
  eq(importRows(addrT, [row]).leads, [{ answers: { address: '123 Main St, Oakland, CA 94612' } }]);
  eq(importRows(addrT, [{ S: '9 Elm St', C: '', ST: 'CA', Z: '' }]).leads, [{ answers: { address: '9 Elm St, CA' } }]);
  eq(importRows(addrT, [{ S: '', C: 'Reno', ST: '', Z: '89501' }]).leads, [{ answers: { address: 'Reno, 89501' } }]);
});

// ================================================================= phone
check('phone: e164 and (xxx) xxx-xxxx from any usual spelling', () => {
  for (const p of ['+15105550142', '(510) 555-0142', '510-555-0142', '510.555.0142', '1-510-555-0142', '+1 (510) 555-0142', '5105550142']) {
    eq(one('phone', 'e164', { phone: p }), '+15105550142', p); eq(one('phone', 'us', { phone: p }), '(510) 555-0142', p);
  }
});
check('phone: a number that does not parse is left as it is (export)', () => {
  for (const p of ['555-0142', '(510) 555-0142 ext 12', 'call me', '110-555-0142', '+12 345 67', '+1 234 567 890 123 456', '+44 20 79x']) {
    eq(one('phone', 'e164', { phone: p }), p, p); eq(one('phone', 'us', { phone: p }), p, p);
  }
  eq(one('phone', 'us', { phone: '+44 20 7946 0958' }), '+44 20 7946 0958'); eq(one('phone', 'us', { phone: '+5105550142' }), '+5105550142');
});
check('phone: e164 keeps a number that already has a + and 8 to 15 digits, as +digits', () => {
  eq(one('phone', 'e164', { phone: '+44 20 7946 0958' }), '+442079460958');
  eq(one('phone', 'e164', { phone: '+44 (0)20-7946.0958' }), '+4402079460958');
  eq(one('phone', 'e164', { phone: '+5105550142' }), '+5105550142');
  eq(one('phone', 'e164', { phone: '+12 345 678' }), '+12345678'); eq(one('phone', 'e164', { phone: '+ 123 456 789 012 345' }), '+123456789012345');
  eq(one('phone', undefined, { phone: '+49 30 901820' }), '+4930901820');
  eq(one('phone', undefined, { phone: '+49 30 901820' }, { phone: 'us' }), '+49 30 901820');
});
check('phone: a bare 10-digit number is US only when defaultCountry is US (the default)', () => {
  eq(one('phone', 'e164', { phone: '510-555-0142' }), '+15105550142'); eq(one('phone', 'e164', { phone: '510-555-0142' }, { defaultCountry: 'US' }), '+15105550142');
  eq(one('phone', 'e164', { phone: '510-555-0142' }, { defaultCountry: 'us' }), '+15105550142');
  for (const dc of ['GB', 'BR', 'DE']) {
    eq(one('phone', 'e164', { phone: '510-555-0142' }, { defaultCountry: dc }), '510-555-0142', dc);
    eq(one('phone', 'us', { phone: '510-555-0142' }, { defaultCountry: dc }), '510-555-0142', dc);
    eq(one('phone', 'e164', { phone: '1-510-555-0142' }, { defaultCountry: dc }), '1-510-555-0142', dc);
    eq(one('phone', 'e164', { phone: '+1 510 555 0142' }, { defaultCountry: dc }), '+15105550142', dc);
    eq(one('phone', 'e164', { phone: '+44 20 7946 0958' }, { defaultCountry: dc }), '+442079460958', dc);
  }
});
check('phone: the export records one warning per row whose number could not be formatted', () => {
  const rows = exportRows(cols(['P', 'phone'], ['E', 'email']), [{ phone: '510-555-0142' }, { phone: 'call me' }, { phone: '' }, { phone: '555-0142', email: 'a@x.com' }, {}]);
  eq(rows, [{ P: '+15105550142', E: '' }, { P: 'call me', E: '' }, { P: '', E: '' }, { P: '555-0142', E: 'a@x.com' }, { P: '', E: '' }]);
  eq(rows.warnings.map(w => [w.row, w.header]), [[1, 'P'], [3, 'P']]);
  assert.ok(rows.warnings.every(w => typeof w.message === 'string' && w.message.includes('phone')));
  assert.ok(!rows.warnings[0].message.includes('call me'));
  eq(Object.getOwnPropertyDescriptor(rows, 'warnings').enumerable, false);
  eq(exportRows(cols(['P', 'phone']), [{ phone: '510-555-0142' }]).warnings, []);
  eq(exportRows(cols(['P', 'phone']), [{ phone: '510-555-0142' }], { defaultCountry: 'GB' }).warnings.length, 1);
  eq(exportRows(cols(['P', 'phone', 'us']), [{ phone: '+44 20 7946 0958' }]).warnings.length, 1);
  eq(exportRows(cols(['P', 'phone']), [{ phone: '+44 20 7946 0958' }]).warnings, []);
  eq(exportRows(cols(['A', 'email']), [{ email: 'a@x.com' }]).warnings, []);
});
check('phone: a + number with 7 or 16 digits is not formatted and is warned about; 8 and 15 are fine', () => {
  const w = p => exportRows(cols(['P', 'phone']), [{ phone: p }]).warnings.length;
  eq(w('+12 345 67'), 1); eq(w('+1 234 567 890 123 456'), 1); eq(w('+12 345 678'), 0); eq(w('+123 456 789 012 345'), 0);
});
check('phone: import turns a 10-digit US number into E.164', () => {
  for (const p of ['(510) 555-0142', '510-555-0142', '510.555.0142', '1-510-555-0142', '+1 510 555 0142', ' 5105550142 ']) eq(back('phone', undefined, p).leads, [{ phone: '+15105550142' }], p);
});
check('phone: import leaves what does not parse, and says so', () => {
  const r = back('phone', 'us', '+44 20 7946 0958');
  eq(r.leads, [{ phone: '+44 20 7946 0958' }]); eq(r.warnings.length, 1); eq(r.warnings[0].header, 'X');
  eq(back('phone', 'e164', '555-0142').leads, [{ phone: '555-0142' }]);
  eq(back('phone', 'e164', '555-0142').warnings.length, 1);
  eq(back('phone', 'e164', '+15105550142').warnings, []);
});
check('phone: import keeps a +country number as +digits in an e164 column, and honours defaultCountry', () => {
  const r = back('phone', 'e164', '+44 20 7946 0958'); eq(r.leads, [{ phone: '+442079460958' }]); eq(r.warnings, []);
  eq(back('phone', undefined, '+44 20 7946 0958').leads, [{ phone: '+442079460958' }]);
  const g = back('phone', undefined, '510-555-0142', { defaultCountry: 'GB' }); eq(g.leads, [{ phone: '510-555-0142' }]); eq(g.warnings.length, 1);
  eq(back('phone', undefined, '+1 510 555 0142', { defaultCountry: 'GB' }).leads, [{ phone: '+15105550142' }]);
});
check('phone: a column with no transform follows options.phone (default e164)', () => {
  eq(one('phone', undefined, { phone: '510-555-0142' }), '+15105550142');
  eq(one('phone', undefined, { phone: '510-555-0142' }, { phone: 'us' }), '(510) 555-0142');
  eq(one('phone', 'e164', { phone: '510-555-0142' }, { phone: 'us' }), '+15105550142');
});

// ================================================================= dates
check('date: iso, us and eu on export', () => {
  const l = { created_at: '2026-10-29T14:03:00Z' };
  eq(one('created_at', 'iso', l), '2026-10-29T14:03:00Z'); eq(one('created_at', 'us', l), '10/29/2026'); eq(one('created_at', 'eu', l), '29/10/2026');
  eq(one('created_at', 'iso', { created_at: '2026-10-29' }), '2026-10-29'); eq(one('created_at', 'eu', { created_at: '2026-03-04' }), '04/03/2026');
});
check('date: a timestamp with an offset is read in UTC', () => {
  eq(one('created_at', 'iso', { created_at: '2026-10-29T23:30:00-07:00' }), '2026-10-30T06:30:00Z');
  eq(one('created_at', 'us', { created_at: '2026-10-29T23:30:00-07:00' }), '10/30/2026');
  eq(one('created_at', 'iso', { created_at: '2026-10-29T14:03:00.123456+00:00' }), '2026-10-29T14:03:00Z');
  eq(one('created_at', 'iso', { created_at: '2026-10-29 14:03:00+00' }), '2026-10-29T14:03:00Z');
  eq(one('created_at', 'iso', { created_at: '2026-10-29T14:03:00' }), '2026-10-29T14:03:00Z');
});
check('date: options.timezone sets the day on export (2026-11-03T23:30:00-08:00 is 11/03/2026 in Los Angeles)', () => {
  const l = { created_at: '2026-11-03T23:30:00-08:00' };
  const LA = { timezone: 'America/Los_Angeles' };
  eq(one('created_at', 'us', l), '11/04/2026'); eq(one('created_at', 'us', l, { timezone: 'UTC' }), '11/04/2026');
  eq(one('created_at', 'us', l, LA), '11/03/2026'); eq(one('created_at', 'eu', l, LA), '03/11/2026');
  eq(one('created_at', undefined, l, { ...LA, date: 'us' }), '11/03/2026');
  eq(one('created_at', 'us', { created_at: '2026-11-03T23:30:00Z' }, { timezone: 'Asia/Tokyo' }), '11/04/2026');
  eq(one('created_at', 'us', { created_at: '2026-11-03T23:30:00Z' }), '11/03/2026');
  eq(one('created_at', 'us', { created_at: '2026-07-01T06:30:00Z' }, LA), '06/30/2026'); eq(one('created_at', 'us', { created_at: '2026-12-01T06:30:00Z' }, LA), '11/30/2026');
  eq(one('created_at', 'us', { created_at: new Date('2026-11-04T07:30:00Z') }, LA), '11/03/2026');
});
check('date: a zone changes the day only; the iso timestamp is the same instant, and a date with no time stays put', () => {
  const l = { created_at: '2026-11-03T23:30:00-08:00' };
  eq(one('created_at', 'iso', l, { timezone: 'America/Los_Angeles' }), '2026-11-04T07:30:00Z');
  eq(one('created_at', 'us', { created_at: '2026-10-29' }, { timezone: 'Asia/Tokyo' }), '10/29/2026');
  eq(one('created_at', 'iso', { created_at: '2026-10-29' }, { timezone: 'Asia/Tokyo' }), '2026-10-29');
  eq(one('created_at', 'us', { created_at: '2026-10-29T14:03:00' }, { timezone: 'Asia/Tokyo' }), '10/29/2026');
});
check('date: an unknown time zone is refused on export and import, even with no date column', () => {
  assert.throws(() => exportRows(cols(['D', 'created_at', 'us']), [{ created_at: '2026-10-29' }], { timezone: 'Mars/Olympus' }), /T-TIMEZONE/);
  assert.throws(() => importRows(cols(['D', 'created_at', 'us']), [{ D: '10/29/2026' }], { timezone: 'Mars/Olympus' }), /T-TIMEZONE/);
  assert.throws(() => exportRows(cols(['E', 'email']), [{ email: 'a@x.com' }], { timezone: 'Mars/Olympus' }), /T-TIMEZONE/);
  assert.throws(() => importRows(cols(['E', 'email']), [{ E: 'a@x.com' }], { timezone: 'Mars/Olympus' }), /T-TIMEZONE/);
  eq(one('created_at', 'us', { created_at: '2026-10-29' }, { timezone: '' }), '10/29/2026');
});
check('date: a Date object and an invalid date', () => {
  eq(one('created_at', 'us', { created_at: new Date('2026-10-29T14:03:00Z') }), '10/29/2026');
  eq(one('created_at', 'us', { created_at: '2026-02-30' }), '2026-02-30'); eq(one('created_at', 'us', { created_at: 'yesterday' }), 'yesterday');
});
check('date: import to ISO from us, eu and iso', () => {
  eq(back('created_at', 'us', '10/29/2026').leads, [{ created_at: '2026-10-29' }]);
  eq(back('created_at', 'eu', '29/10/2026').leads, [{ created_at: '2026-10-29' }]);
  eq(back('created_at', 'iso', '2026-10-29T14:03:00Z').leads, [{ created_at: '2026-10-29T14:03:00Z' }]);
  eq(back('created_at', 'eu', '9.3.2026').leads, [{ created_at: '2026-03-09' }]);
});
check('date: options.timezone reads a timestamp with no offset as that zone on import; an offset or Z always wins', () => {
  const LA = { timezone: 'America/Los_Angeles' }, TK = { timezone: 'Asia/Tokyo' };
  const at = (cell, opts) => back('created_at', 'iso', cell, opts).leads[0].created_at;
  eq(at('2026-11-03T23:30:00'), '2026-11-03T23:30:00Z'); eq(at('2026-11-03T23:30:00', { timezone: 'UTC' }), '2026-11-03T23:30:00Z');
  eq(at('2026-11-03T23:30:00', LA), '2026-11-04T07:30:00Z'); eq(at('2026-11-03 23:30', LA), '2026-11-04T07:30:00Z');
  eq(at('2026-07-01T12:00:00', LA), '2026-07-01T19:00:00Z'); eq(at('2026-11-04T08:30:00', TK), '2026-11-03T23:30:00Z');
  eq(at('2026-11-03T23:30:00-08:00', TK), '2026-11-04T07:30:00Z'); eq(at('2026-11-03T23:30:00Z', LA), '2026-11-03T23:30:00Z');
  eq(at('2026-11-03', LA), '2026-11-03'); eq(back('created_at', 'us', '10/29/2026', TK).leads, [{ created_at: '2026-10-29' }]);
});
check('date: a wall clock just after a daylight-saving change is read with the new offset', () => {
  const LA = { timezone: 'America/Los_Angeles' };
  const at = cell => back('created_at', 'iso', cell, LA).leads[0].created_at;
  eq(at('2026-03-08T12:00:00'), '2026-03-08T19:00:00Z'); eq(at('2026-03-08T03:30:00'), '2026-03-08T10:30:00Z'); eq(at('2026-03-08T01:30:00'), '2026-03-08T09:30:00Z');
  eq(at('2026-11-01T12:00:00'), '2026-11-01T20:00:00Z');
});
check('date: a day exported in a zone and read back in the same zone keeps its instant', () => {
  const LA = { timezone: 'America/Los_Angeles' };
  const iso = '2026-11-04T07:30:00Z';
  eq(one('created_at', 'us', { created_at: iso }, LA), '11/03/2026');
  eq(back('created_at', 'iso', '2026-11-03T23:30:00', LA).leads[0].created_at, iso);
});
check('date: 03/04/2026 follows the column\'s format; an impossible month tells which it is', () => {
  eq(back('created_at', 'us', '03/04/2026').leads, [{ created_at: '2026-03-04' }]); eq(back('created_at', 'eu', '03/04/2026').leads, [{ created_at: '2026-04-03' }]);
  eq(back('created_at', 'us', '25/12/2026').leads, [{ created_at: '2026-12-25' }]); eq(back('created_at', 'eu', '12/25/2026').leads, [{ created_at: '2026-12-25' }]);
});
check('date: no transform on a date column uses options.date for a tie (default us)', () => {
  eq(back('created_at', 'iso', '03/04/2026').leads, [{ created_at: '2026-03-04' }]);
  eq(back('created_at', 'iso', '03/04/2026', { date: 'eu' }).leads, [{ created_at: '2026-04-03' }]);
  eq(back('created_at', undefined, '03/04/2026').leads, [{ created_at: '2026-03-04' }]);
  eq(back('created_at', undefined, '03/04/2026', { date: 'eu' }).leads, [{ created_at: '2026-04-03' }]);
  eq(one('created_at', undefined, { created_at: '2026-10-29' }, { date: 'eu' }), '29/10/2026');
  eq(one('created_at', undefined, { created_at: '2026-10-29' }), '2026-10-29');
});
check('date: leap days and impossible dates', () => {
  eq(back('created_at', 'us', '02/29/2028').leads, [{ created_at: '2028-02-29' }]);
  const bad = back('created_at', 'us', '02/29/2027'); eq(bad.leads, [{ created_at: '02/29/2027' }]); eq(bad.warnings.length, 1);
  eq(back('created_at', 'us', '13/13/2026').leads, [{ created_at: '13/13/2026' }]); eq(back('created_at', 'us', 'soon').warnings.length, 1);
});

// ================================================================= value maps, paths
const statusT = { columns: [{ header: 'Stage', field: 'status' }], value_maps: { status: { new: 'New Lead', contacted: 'Contacted', spam: 'Junk' } } };
check('value map: ours to theirs on export, anything else passes through', () => {
  eq(exportRows(statusT, [{ status: 'new' }, { status: 'spam' }, { status: 'qualified' }, { status: 'NEW' }]).map(r => r.Stage), ['New Lead', 'Junk', 'qualified', 'New Lead']);
});
check('value map: theirs to ours on import (case-insensitive), unknown passes through', () => {
  eq(importRows(statusT, [{ Stage: 'New Lead' }, { Stage: 'junk' }, { Stage: 'Mystery' }]).leads, [{ status: 'new' }, { status: 'spam' }, { status: 'Mystery' }]);
});
check('value map: two ours with one theirs reverse to the first', () => {
  const t = { columns: [{ header: 'S', field: 'status' }], value_maps: { status: { new: 'Lead', contacted: 'Lead' } } };
  eq(importRows(t, [{ S: 'Lead' }]).leads, [{ status: 'new' }]);
});
check('value map: "field@Header" wins for its own column only', () => {
  const t = { columns: [{ header: 'A', field: 'status' }, { header: 'B', field: 'status' }], value_maps: { status: { new: 'New' }, 'status@B': { new: 'Lead' } } };
  eq(exportRows(t, [{ status: 'new' }]), [{ A: 'New', B: 'Lead' }]);
  eq(importRows(t, [{ A: '', B: 'Lead' }]).leads, [{ status: 'new' }]);
  eq(importRows(t, [{ A: 'New', B: 'Lead' }]).leads, [{ status: 'new' }]);
});
check('value map: two columns on one field, the first filled one wins', () => {
  const t = { columns: [{ header: 'A', field: 'status' }, { header: 'B', field: 'status' }], value_maps: { status: { new: 'N' } } };
  eq(importRows(t, [{ A: '', B: 'x' }, { A: 'N', B: 'x' }]).leads, [{ status: 'x' }, { status: 'new' }]);
});
check('dotted paths: answers.* read on export and written on import', () => {
  const t = cols(['Budget', 'answers.budget'], ['Beds', 'answers.beds'], ['When', 'answers.timing']);
  eq(exportRows(t, [lead()]), [{ Budget: '900000', Beds: '3', When: '3 months' }]);
  eq(importRows(t, [{ Budget: '900000', Beds: '3', When: '3 months' }]).leads, [{ answers: { budget: '900000', beds: '3', timing: '3 months' } }]);
});
check('dotted paths: numbers, lists and a flat "answers.x" key', () => {
  const t = cols(['Beds', 'answers.beds'], ['Tags', 'answers.tags']);
  eq(exportRows(t, [{ answers: { beds: 3, tags: ['a', 'b'] } }]), [{ Beds: '3', Tags: 'a, b' }]);
  eq(exportRows(cols(['B', 'answers.beds']), [{ 'answers.beds': 4 }]), [{ B: '4' }]);
});
check('export: a missing value is an empty cell, row keys follow the template', () => {
  const r = exportRows(cols(['Z', 'answers.nothing'], ['A', 'email'], ['M', 'answers.address', 'city']), [{ email: 'a@x.com' }]);
  eq(r, [{ Z: '', A: 'a@x.com', M: '' }]); eq(Object.keys(r[0]), ['Z', 'A', 'M']);
});
check('import: empty cells set nothing and empty rows are skipped', () => {
  const t = cols(['E', 'email'], ['N', 'answers.message']);
  const r = importRows(t, [{ E: 'a@x.com', N: '' }, { E: '', N: '  ' }, { E: 'b@x.com' }]);
  eq(r.leads, [{ email: 'a@x.com' }, { email: 'b@x.com' }]); eq(r.sourceRows, [0, 2]);
});
check('export and import leave their inputs alone', () => {
  const ls = [lead()], before = structuredClone(ls); exportRows(hubspot, ls); eq(ls, before);
  const rows = [{ 'First Name': 'A', 'Last Name': 'B', Email: 'a@x.com' }], rb = structuredClone(rows); importRows(hubspot, rows); eq(rows, rb);
});

// ================================================================= duplicates
const dupT = cols(['Email', 'email'], ['Phone', 'phone']);
check('duplicates: by email, ignoring case and spaces', () => {
  const r = importRows(dupT, [{ Email: 'A@x.com' }, { Email: ' a@x.com ' }, { Email: 'b@x.com' }]);
  eq(r.duplicates, [{ by: 'email', value: 'a@x.com', indexes: [0, 1] }]);
});
check('duplicates: by phone, whatever the spelling', () => {
  const r = importRows(dupT, [{ Phone: '(510) 555-0142' }, { Phone: '510-555-0142' }, { Phone: '+1 510 555 0142' }, { Phone: '415-555-0199' }]);
  eq(r.duplicates, [{ by: 'phone', value: '5105550142', indexes: [0, 1, 2] }]);
});
check('duplicates: a local number that does not parse still matches itself', () => {
  eq(importRows(dupT, [{ Phone: '555-0100' }, { Phone: '555 0100' }]).duplicates, [{ by: 'phone', value: '5550100', indexes: [0, 1] }]);
});
check('duplicates: distinct rows and blank cells are not duplicates', () => {
  eq(importRows(dupT, [{ Email: 'a@x.com', Phone: '510-555-0142' }, { Email: 'b@x.com', Phone: '415-555-0199' }, { Email: 'c@x.com' }, { Email: 'd@x.com' }]).duplicates, []);
  eq(importRows(cols(['E', 'email'], ['N', 'name']), [{ N: 'A' }, { N: 'B' }]).duplicates, []);
  eq(importRows(dupT, [{ Phone: '12' }, { Phone: '12' }]).duplicates, []);
});
check('duplicates: one email and one phone shared by the same two rows are reported both ways', () => {
  const r = importRows(dupT, [{ Email: 'a@x.com', Phone: '510-555-0142' }, { Email: 'a@x.com', Phone: '510-555-0142' }]);
  eq(r.duplicates.map(d => d.by).sort(), ['email', 'phone']);
});
check('duplicates: indexes are positions in leads, even after a blank row', () => {
  const r = importRows(dupT, [{ Email: 'a@x.com' }, {}, { Email: 'a@x.com' }]);
  eq(r.duplicates, [{ by: 'email', value: 'a@x.com', indexes: [0, 1] }]); eq(r.sourceRows, [0, 2]);
});

// ================================================================= templates
check('template: a good template has no problems', () => { eq(validateTemplate(hubspot), []); eq(validateTemplate(google), []); eq(validateTemplate(cols(['A', 'email'])), []); });
check('template: bad shapes are named', () => {
  assert.ok(validateTemplate(null).length); assert.ok(validateTemplate({}).length); assert.ok(validateTemplate({ columns: [] }).length);
  assert.ok(validateTemplate({ columns: new Array(201).fill(0).map((_, i) => ({ header: `h${i}`, field: 'email' })) }).length);
  assert.ok(validateTemplate({ columns: [{ header: 'A' }] }).length); assert.ok(validateTemplate({ columns: [{ field: 'email' }] }).length);
  assert.ok(validateTemplate({ columns: [{ header: 'A', field: 'email' }, { header: 'A', field: 'phone' }] })[0].includes('same header'));
  assert.ok(validateTemplate({ columns: [{ header: 'A', field: '__proto__.x' }] })[0].includes('bad field'));
  assert.ok(validateTemplate({ columns: [{ header: 'A', field: 'email', transform: 3 }] }).length);
  assert.ok(validateTemplate({ columns: [{ header: 'A', field: 'email' }], value_maps: [] }).length);
});
check('template: export and import refuse a bad template and an unknown transform', () => {
  assert.throws(() => exportRows({ columns: [{ header: 'A', field: 'email' }, { header: 'A', field: 'phone' }] }, [{}]), /same header/);
  assert.throws(() => importRows({ columns: [] }, [{}]), /T-COLUMNS/);
  assert.throws(() => exportRows(cols(['A', 'email', 'shout']), [{ email: 'a@x.com' }]), /unknown transform/);
  assert.throws(() => exportRows(cols(['A', 'email', 'us']), [{ email: 'a@x.com' }]), /unknown transform/);
  assert.throws(() => importRows(cols(['A', 'email', 'shout']), [{ A: 'x' }]), /unknown transform/);
});
check('template: a field path cannot reach the prototype', () => {
  assert.throws(() => exportRows(cols(['A', '__proto__.polluted']), [{}]), /bad field/);
  assert.throws(() => importRows(cols(['A', 'answers.constructor']), [{ A: 'x' }]), /bad field/);
  eq({}.polluted, undefined);
});
const PROTO_KEYS = [...new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype'])];
const SCRATCH = ['first', 'last', 'street', 'city', 'state', 'postal_code'];
// a build that is still wrong would leave properties on the built-in functions; clear them so one red test cannot redden the rest
const scrub = () => { for (const k of PROTO_KEYS) { const f = Object.prototype[k]; if (typeof f === 'function') for (const p of SCRATCH) delete f[p]; } };
check('template: a split on a field called toString, hasOwnProperty or valueOf never writes into the built-in function', () => {
  try {
    for (const k of ['toString', 'hasOwnProperty', 'valueOf']) {
      try { importRows(cols(['F', k, 'first'], ['L', k, 'last']), [{ F: 'A', L: 'B' }]); } catch { /* refusing the template is the right answer */ }
      try { importRows(cols(['S', k, 'street'], ['C', k, 'city']), [{ S: '1 Main St', C: 'Reno' }]); } catch { /* same */ }
      for (const p of SCRATCH) eq(Object.prototype[k][p], undefined, `${k}.${p}`);
    }
  } finally { scrub(); }
});
check('template: every Object.prototype name, and "prototype", is refused as a field, whole or inside a path', () => {
  try {
    assert.ok(PROTO_KEYS.length >= 12 && PROTO_KEYS.includes('toString') && PROTO_KEYS.includes('hasOwnProperty') && PROTO_KEYS.includes('valueOf') && PROTO_KEYS.includes('prototype'));
    for (const k of PROTO_KEYS) {
      for (const f of [k, `answers.${k}`, `${k}.x`]) {
        assert.ok(validateTemplate(cols(['A', f])).some(p => p.includes('bad field')), `validate ${f}`);
        assert.throws(() => importRows(cols(['A', f]), [{ A: 'x' }]), /bad field/, `import ${f}`);
        assert.throws(() => exportRows(cols(['A', f]), [{}]), /bad field/, `export ${f}`);
      }
    }
    eq(validateTemplate(cols(['A', 'answers.tostring'], ['B', 'valueof'])), []);
  } finally { scrub(); }
});
check('template: the shipped files carry source, a readOn verification note and the crm_templates shape', () => {
  for (const [t, crm] of [[hubspot, 'hubspot'], [google, 'google-contacts']]) {
    // readOn is either UNVERIFIED or a dated note that says what was checked and names what is still UNVERIFIED
    assert.match(t.source, /^https:\/\//); assert.match(t.readOn, /^(UNVERIFIED|\d{4}-\d{2}-\d{2}.*UNVERIFIED)/); eq(t.crm, crm); eq(t.direction, 'both');
    assert.match(t.crm, /^[a-z0-9]+(-[a-z0-9]+)*$/); assert.ok(t.name.length <= 120); assert.ok(typeof t.value_maps === 'object');
    for (const c of t.columns) assert.ok(typeof c.header === 'string' && typeof c.field === 'string');
  }
  eq(hubspot.columns.map(c => c.header).sort(), ['Email', 'First Name', 'Last Name', 'Lead Status', 'Lifecycle Stage', 'Message', 'Phone Number']);
  eq(google.columns.map(c => c.header), ['Name', 'Given Name', 'Family Name', 'E-mail 1 - Value', 'Phone 1 - Value', 'Notes']);
});

// ================================================================= duplicate headers
check('duplicate headers: a template with two columns of one header is refused on export and import', () => {
  const t = { columns: [{ header: 'Phone', field: 'phone' }, { header: 'Phone', field: 'answers.message' }] };
  assert.throws(() => exportRows(t, [{ phone: '510-555-0142' }]), /same header/);
  assert.throws(() => importRows(t, [{ Phone: '510-555-0142' }]), /same header/);
  eq(validateTemplate(t).length, 1);
});
check('duplicate headers: import warns when the file holds a renamed duplicate such as "Phone (2)"', () => {
  const t = cols(['Name', 'name'], ['Phone', 'phone']);
  const parsed = parseCsv('Name,Phone,Phone\nA,510-555-0142,415-555-0199\n');
  eq(parsed.headers, ['Name', 'Phone', 'Phone (2)']);
  const r = importRows(t, parsed.rows);
  eq(r.leads, [{ name: 'A', phone: '+15105550142' }]);
  eq(r.warnings.length, 1); eq(r.warnings[0].header, 'Phone (2)'); eq(r.warnings[0].row, null);
  assert.match(r.warnings[0].message, /Phone/); assert.match(r.warnings[0].message, /duplicate/);
  const three = importRows(cols(['Phone', 'answers.message']), parseCsv('Phone,Phone,Phone\nx,y,z\n').rows);
  eq(three.leads, [{ answers: { message: 'x' } }]); eq(three.warnings.map(w => w.header), ['Phone (2)', 'Phone (3)']);
});
check('duplicate headers: no warning for a header that merely looks renamed, or for a file with none', () => {
  eq(importRows(cols(['Name', 'name']), [{ Name: 'A', 'Notes (2)': 'x' }]).warnings, []);
  eq(importRows(cols(['Name', 'name']), [{ Name: 'A', 'Name (1)': 'x' }]).warnings, []);
  eq(importRows(cols(['Name', 'name']), parseCsv('Name,Email\nA,a@x.com\n').rows).warnings, []);
  eq(importRows(cols(['Name', 'name']), []).warnings, []);
});

// ================================================================= csv
check('csv: plain output ends each record with CRLF', () => { eq(toCsv([{ a: '1', b: '2' }, { a: '3', b: '4' }], ['a', 'b']), 'a,b\r\n1,2\r\n3,4\r\n'); });
check('csv: commas, quotes and newlines are quoted', () => {
  eq(toCsv([{ a: 'x,y', b: 'say "q"', c: 'l1\nl2', d: 'plain' }], ['a', 'b', 'c', 'd']), 'a,b,c,d\r\n"x,y","say ""q""","l1\nl2",plain\r\n');
  eq(toCsv([{ a: 'l1\r\nl2' }], ['a']), 'a\r\n"l1\r\nl2"\r\n');
});
check('csv: quoting round trip with commas, quotes, newlines, unicode, edge spaces', () => {
  const rows = [{ a: 'x,y', b: 'say "q"', c: 'l1\nl2', d: ' pad ' }, { a: '"', b: ',', c: 'x\r\n', d: 'Zoë 山' }, { a: '', b: '""', c: 'a\rb', d: '"a,b"' }];
  const back2 = parseCsv(toCsv(rows, ['a', 'b', 'c', 'd']));
  eq(back2.headers, ['a', 'b', 'c', 'd']); eq(back2.rows, rows); eq(back2.warnings, []);
});
check('csv: a single column with an empty value survives', () => { eq(toCsv([{ a: '' }, { a: 'x' }], ['a']), 'a\r\n""\r\nx\r\n'); eq(parseCsv(toCsv([{ a: '' }, { a: 'x' }], ['a'])).rows, [{ a: '' }, { a: 'x' }]); });
check('csv parse: byte order mark is dropped from the first header', () => { const r = parseCsv(BOM + 'Name,Email\r\nA,b@x.com\r\n'); eq(r.headers, ['Name', 'Email']); eq(r.rows, [{ Name: 'A', Email: 'b@x.com' }]); });
check('csv parse: CRLF, LF and a lone CR all end a record', () => {
  const want = [{ a: '1', b: '2' }, { a: '3', b: '4' }];
  eq(parseCsv('a,b\r\n1,2\r\n3,4\r\n').rows, want); eq(parseCsv('a,b\n1,2\n3,4\n').rows, want); eq(parseCsv('a,b\r1,2\r3,4').rows, want);
});
check('csv parse: no phantom row after the last line break, none missing without one', () => {
  eq(parseCsv('a\n1\n').rows.length, 1); eq(parseCsv('a\n1').rows.length, 1); eq(parseCsv('a\n1\n\n\n').rows.length, 1);
});
check('csv parse: a line break and a doubled quote inside quotes', () => {
  eq(parseCsv('a,b\r\n"x\r\ny","he said ""hi"""\r\n').rows, [{ a: 'x\r\ny', b: 'he said "hi"' }]);
  eq(parseCsv('a,b\n"",x\n').rows, [{ a: '', b: 'x' }]);
});
check('csv parse: a quote in the middle of a bare field is a quote', () => { eq(parseCsv('a,b\n5" pipe,x\n').rows, [{ a: '5" pipe', b: 'x' }]); });
check('csv parse: short and long rows are padded or flagged', () => {
  const r = parseCsv('a,b,c\n1,2\n1,2,3,4\n');
  eq(r.rows, [{ a: '1', b: '2', c: '' }, { a: '1', b: '2', c: '3' }]); eq(r.warnings.length, 2);
  assert.ok(r.warnings[0].includes('row 2') && r.warnings[1].includes('row 3'));
});
check('csv parse: a repeated header gets a number', () => { const r = parseCsv('Phone,Phone,Phone\n1,2,3\n'); eq(r.headers, ['Phone', 'Phone (2)', 'Phone (3)']); eq(r.rows[0]['Phone (2)'], '2'); });
check('csv parse: empty text, header only, unterminated quote', () => {
  eq(parseCsv(''), { headers: [], rows: [], warnings: [] }); eq(parseCsv(null).headers, []);
  eq(parseCsv('a,b\n').rows, []);
  assert.ok(parseCsv('a,b\n"x,y').warnings.some(w => w.includes('never closed')));
});
check('csv parse: another delimiter on request', () => { eq(parseCsv('a;b\n1;"2;3"\n', { delimiter: ';' }).rows, [{ a: '1', b: '2;3' }]); });
check('csv parse: a header line with more semicolons than commas is read with ; and says so', () => {
  const r = parseCsv('Name;Email;Phone\nA;a@x.com;510-555-0142\nB;"b;1@x.com";\n');
  eq(r.headers, ['Name', 'Email', 'Phone']); eq(r.rows, [{ Name: 'A', Email: 'a@x.com', Phone: '510-555-0142' }, { Name: 'B', Email: 'b;1@x.com', Phone: '' }]);
  eq(r.warnings.length, 1); assert.match(r.warnings[0], /semicolon/);
  eq(parseCsv('a;b').headers, ['a', 'b']);
  eq(parseCsv(BOM + 'a;b\n1;2\n').rows, [{ a: '1', b: '2' }]);
});
check('csv parse: commas win a tie or a majority; quoted semicolons and later lines do not count', () => {
  eq(parseCsv('a;b,c\n1,2\n').headers, ['a;b', 'c']); eq(parseCsv('a,b;c,d\n1,2,3\n').headers, ['a', 'b;c', 'd']);
  eq(parseCsv('"a;b;c",d\n1,2\n').headers, ['a;b;c', 'd']); eq(parseCsv('"a;b;c",d\n1,2\n').warnings, []);
  eq(parseCsv('a,b\n1;2;3;4;5,6\n').warnings, []); eq(parseCsv('a,b\n1;2;3;4;5,6\n').headers, ['a', 'b']);
  eq(parseCsv('a\n1;2\n').headers, ['a']);
});
check('csv parse: an explicit delimiter is never second-guessed', () => {
  const r = parseCsv('a;b\n1;2\n', { delimiter: ',' }); eq(r.headers, ['a;b']); eq(r.rows, [{ 'a;b': '1;2' }]); eq(r.warnings, []);
  eq(parseCsv('a;b\n1;2\n', { delimiter: ';' }).warnings, []);
});
check('csv parse: a header called __proto__ is just a header', () => {
  const r = parseCsv('__proto__,x\npolluted,1\n');
  eq(Object.keys(r.rows[0]), ['__proto__', 'x']); eq({}.polluted, undefined); eq(Object.getPrototypeOf(r.rows[0]), Object.prototype);
});
check('csv: a cell that could run as a formula is defused; numbers and phones are not', () => {
  eq(toCsv([{ a: '=SUM(A1)', b: '+15105550142', c: '-5', d: '@home', e: '+1 (510) 555-0142' }], ['a', 'b', 'c', 'd', 'e']), "a,b,c,d,e\r\n'=SUM(A1),+15105550142,-5,'@home,+1 (510) 555-0142\r\n");
  eq(toCsv([{ a: '-1+1' }], ['a']), "a\r\n'-1+1\r\n");
  eq(toCsv([{ a: '=1+1' }], ['a'], { formulaGuard: false }), 'a\r\n=1+1\r\n');
});
check('csv: default headers are every key in first-seen order; a missing key is empty; bom is optional', () => {
  eq(toCsv([{ a: '1' }, { b: '2', a: '3' }]), 'a,b\r\n1,\r\n3,2\r\n');
  eq(toCsv([{ a: '1' }], ['a'], { bom: true }), BOM + 'a\r\n1\r\n'); eq(toCsv([{ a: null, b: undefined, c: 5 }], ['a', 'b', 'c']), 'a,b,c\r\n,,5\r\n');
});

// ================================================================= end to end
check('hubspot: export row, values and statuses', () => {
  eq(exportRows(hubspot, [lead()])[0], {
    'First Name': 'Jordan', 'Last Name': 'Reyes', Email: 'jordan@example.com', 'Phone Number': '+15105550142',
    'Lead Status': 'New', 'Lifecycle Stage': 'Lead', Message: 'Call me, please.\nThanks "soon"',
  });
  eq(exportRows(hubspot, ['new', 'contacted', 'qualified', 'closed', 'spam'].map(status => lead({ status }))).map(r => r['Lead Status']), ['New', 'Attempted to Contact', 'Connected', 'Open Deal', 'Unqualified']);
});
check('hubspot: export, CSV, parse, import gives the same lead fields back', () => {
  const statuses = ['new', 'contacted', 'qualified', 'closed', 'spam'];
  const leads = statuses.map((status, i) => lead({ status, name: i === 1 ? 'Mary Ann Smith' : i === 2 ? 'Cher' : 'Jordan Reyes', email: `p${i}@example.com`, phone: i === 3 ? '' : '+15105550142' }));
  const rows = exportRows(hubspot, leads);
  const text = toCsv(rows, hubspot.columns.map(c => c.header));
  const parsed = parseCsv(text);
  eq(parsed.warnings, []);
  const r = importRows(hubspot, parsed.rows);
  const pick = l => { const o = { name: l.name, email: l.email, status: l.status, answers: { message: l.answers.message } }; if (l.phone) o.phone = l.phone; return o; };
  eq(r.leads, leads.map(pick)); eq(r.warnings, []);
  eq(r.duplicates.filter(d => d.by === 'email'), []);
});
check('google contacts: export and import back, with Name and the two parts', () => {
  const rows = exportRows(google, [lead(), lead({ name: 'Cher', phone: '510-555-0142' })]);
  eq(rows[0], { Name: 'Jordan Reyes', 'Given Name': 'Jordan', 'Family Name': 'Reyes', 'E-mail 1 - Value': 'jordan@example.com', 'Phone 1 - Value': '+15105550142', Notes: 'Call me, please.\nThanks "soon"' });
  eq(rows[1].Name, 'Cher'); eq(rows[1]['Family Name'], ''); eq(rows[1]['Phone 1 - Value'], '+15105550142');
  const r = importRows(google, parseCsv(toCsv(rows, google.columns.map(c => c.header))).rows);
  eq(r.leads.map(l => [l.name, l.email, l.phone]), [['Jordan Reyes', 'jordan@example.com', '+15105550142'], ['Cher', 'jordan@example.com', '+15105550142']]);
  eq(r.duplicates.map(d => d.by).sort(), ['email', 'phone']);
});
check('a client sheet with every kind of column round-trips (date keeps the day, not the time)', () => {
  const t = {
    columns: [
      { header: 'Name', field: 'name' }, { header: 'Phone', field: 'phone', transform: 'us' }, { header: 'Received', field: 'created_at', transform: 'eu' },
      { header: 'Street', field: 'answers.address', transform: 'street' }, { header: 'City', field: 'answers.address', transform: 'city' },
      { header: 'State', field: 'answers.address', transform: 'state' }, { header: 'Zip', field: 'answers.address', transform: 'zip' },
      { header: 'Stage', field: 'status' }, { header: 'Beds', field: 'answers.beds' },
    ],
    value_maps: { status: { new: 'New Lead', contacted: 'Working' } },
  };
  const row = exportRows(t, [lead()])[0];
  eq(row, { Name: 'Jordan Reyes', Phone: '(510) 555-0142', Received: '29/10/2026', Street: '123 Main St', City: 'Oakland', State: 'CA', Zip: '94612', Stage: 'New Lead', Beds: '3' });
  const l = importRows(t, parseCsv(toCsv([row], Object.keys(row))).rows).leads[0];
  eq(l, { name: 'Jordan Reyes', phone: '+15105550142', created_at: '2026-10-29', answers: { address: '123 Main St, Oakland, CA 94612', beds: '3' }, status: 'new' });
});

// ================================================================= hygiene
const files = dir => readdirSync(dir).flatMap(f => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
check('map.mjs: only imports ./dictionary.mjs, and touches no Node or browser-only API', () => {
  const src = readFileSync(resolve(DIR, 'map.mjs'), 'utf8');
  const imports = [...src.matchAll(/^\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/gm)].map(x => x[1]);
  eq(imports, ['./dictionary.mjs']);
  assert.doesNotMatch(src, /\bimport\s*\(/); assert.doesNotMatch(src, /\brequire\s*\(/);
  for (const bad of ['process', 'fetch', 'Buffer', 'window', 'document', 'localStorage', 'node:', '__dirname', 'XMLHttpRequest', 'setTimeout']) assert.ok(!new RegExp(`(?<![\\w.])${bad.replace(':', '\\:')}(?![\\w])`).test(src.replace(/\/\/.*$/gm, '')), bad);
  const dict = readFileSync(resolve(DIR, 'dictionary.mjs'), 'utf8');
  assert.doesNotMatch(dict, /^\s*import\s/m);
});
check('README: a Known limits section names what is still not handled', () => {
  const md = readFileSync(join(ROOT, 'README.md'), 'utf8');
  assert.match(md, /^## Known limits$/m);
  const section = md.split(/^## Known limits$/m)[1].split(/^## /m)[0].toLowerCase();
  for (const word of ['non-english', 'xlsx', 'phone', 'time zone', 'without a time']) assert.ok(section.includes(word), word);
});
check('every file in tools/crm-map: no em dash, no BOM, no CR, ends with a newline', () => {
  const bad = [];
  for (const f of files(ROOT)) {
    const t = readFileSync(f, 'utf8');
    if (t.includes(DASHES[0]) || t.includes(DASHES[1])) bad.push(`${f} dash`);
    if (t.charCodeAt(0) === 0xFEFF) bad.push(`${f} BOM`);
    if (t.includes('\r')) bad.push(`${f} CR`);
    if (!t.endsWith('\n')) bad.push(`${f} no final newline`);
  }
  eq(bad, []);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
