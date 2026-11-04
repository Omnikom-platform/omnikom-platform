// Work order 02 Settled 9: the two shipped maps (tools/crm-map/templates, cli-and-testing's files, read here, never changed) are checked against
// the header lists in the vendors' own public import docs. A real client export is never copied into the repository (11-rules.md 26).
import { validateTemplate } from '../_shared/crm-map.ts';
import { assert, t } from './util.ts';

const read = async (name: string) => JSON.parse(await Deno.readTextFile(new URL(`../../../tools/crm-map/templates/${name}`, import.meta.url)));

// Read 2026-11-04 by work order 02's builder:
//   https://knowledge.hubspot.com/properties/hubspots-default-contact-properties (page "last updated September 21, 2026"): the default contact
//     property labels Email, First name, Last name, Phone number, Lead status, Lifecycle stage, Contact owner, Message.
//   https://knowledge.hubspot.com/import-and-export/set-up-your-import-file (page "last updated September 11, 2026"): Email is required for
//     contacts; First name and Last name are accepted; a phone as +[country code][number]; an enumeration value must match the internal value or
//     the English label. The pages give labels in sentence case; the map writes them in title case (finding, see work/02 Findings).
// Not on either page: the option labels of Lead status and Lifecycle stage, so the map's value_maps stay unverified.
const HUBSPOT = { read: '2026-11-04', urls: ['https://knowledge.hubspot.com/properties/hubspots-default-contact-properties', 'https://knowledge.hubspot.com/import-and-export/set-up-your-import-file'],
  labels: ['Email', 'First name', 'Last name', 'Phone number', 'Lead status', 'Lifecycle stage', 'Contact owner', 'Message'] };

t('templates: every header of the shipped HubSpot map is a HubSpot default contact property label (public docs read 2026-11-04)', async () => {
  const tpl = await read('hubspot.json');
  assert(validateTemplate(tpl).length === 0, 'the map is valid');
  const known = new Set(HUBSPOT.labels.map(l => l.toLowerCase()));
  const off = (tpl.columns as { header: string }[]).map(c => c.header).filter(h => !known.has(h.toLowerCase()));
  assert(off.length === 0, `headers not among HubSpot's labels (${HUBSPOT.urls.join(', ')}, read ${HUBSPOT.read}): ${off.join(', ')}`);
  assert((tpl.columns as { field: string }[]).some(c => c.field === 'email'), 'Email, which HubSpot requires, is mapped');
});

// Google: no first-party page lists the Google CSV headers (read 2026-11-04: support.google.com/contacts/answer/7199294 "Export, back up, or restore
// contacts" names the Google CSV format only; answer/1069522 has none). Checking them needs a real Google CSV export, which needs a login: BLOCKED.
Deno.test({ name: 'templates: Google Contacts headers against a first-party list: BLOCKED (Google publishes none; needs a real export)', ignore: true, fn() {} });
t('templates: the shipped Google Contacts map is at least a valid map', async () => {
  assert(validateTemplate(await read('google-contacts.json')).length === 0, 'the map is valid');
});
