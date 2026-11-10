// Builds the two industry fragments of the CRM lead type and status lists from SEO's researched files (work order 29, re-read by 32):
//   node contracts/examples/crm-lists/build.mjs        writes real-estate.json and insurance-financial.json next to this file
// Nothing is typed by hand: `crm` is what a site contract carries (lead_types: key, label; statuses: key, label, stage, the three flags), `notes` keeps
// the source notes of every entry (what produces it, the quotes and where they were read) so the contract itself stays small.
// A site's entities.json names a fragment with `"crmFrom": "../crm-lists/<industry>.json"`; contracts/from-plan.mjs copies its `crm` block.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SEO = join(HERE, '..', '..', '..', 'work', '29-lead-types');
const read = f => JSON.parse(readFileSync(join(SEO, f), 'utf8'));
const statuses = read('statuses.json');
const byId = Object.fromEntries(statuses.statuses.map(s => [s.id, s]));

// The owner listed "voicemail left" and "answering machine" as two statuses (2026-11-09 20:48, through the head of operations); SEO merged them
// (statuses.json "merged"). The owner outranks the research (head's ruling D, 2026-11-10), so the split is made here with its own sources, never in SEO's files.
const OWNER = { url: 'owner:2026-11-09 20:48 through the head of operations', readAt: '2026-11-09' };
byId['answering-machine'] = { ...byId['answering-machine'], means: 'A call was answered by an answering machine and no message was left; the status records who called.',
  sources: [{ ...OWNER, says: 'answering machine' }, ...byId['answering-machine'].sources.filter(x => x.url.startsWith('https://help.brightpattern.com'))] };
byId['voicemail-left'] = { id: 'voicemail-left', name: 'Voicemail left', stage: 'working', means: 'A call reached voicemail and a message was left; the status records who called.',
  needsDate: false, needsWho: true, needsText: false,
  sources: [{ ...OWNER, says: 'voicemail left' }, ...statuses.statuses.find(s => s.id === 'answering-machine').sources.filter(x => x.url.startsWith('https://www.virtualpbx.com'))] };
if (byId['voicemail-left'].sources.length < 2 || byId['answering-machine'].sources.length < 2) throw new Error('the split lost a source: check the answering-machine sources in statuses.json');
const withSplit = order => order.flatMap(id => id === 'answering-machine' ? [id, 'voicemail-left'] : [id]);

for (const industry of ['real-estate', 'insurance-financial']) {
  const types = read(`${industry}.json`);
  const base = statuses.perIndustry[industry];
  if (!base) throw new Error(`statuses.json has no perIndustry list for ${industry}`);
  const order = withSplit(base);
  const frag = {
    industry,
    readAt: types.readAt,
    source: `work/29-lead-types/${industry}.json and statuses.json (perIndustry.${industry}); copied by this script, never edited by hand`,
    crm: {
      lead_types: types.types.map(t => ({ key: t.id, label: t.name })),
      statuses: order.map(id => {
        const s = byId[id];
        if (!s) throw new Error(`perIndustry.${industry} names "${id}", which statuses.json does not define`);
        return { key: s.id, label: s.name, stage: s.stage, needsDate: s.needsDate, needsWho: s.needsWho, needsText: s.needsText };
      }),
    },
    notes: {
      lead_types: Object.fromEntries(types.types.map(t => [t.id, { producedBy: t.producedBy, examples: t.examples, sources: t.sources }])),
      statuses: Object.fromEntries(order.map(id => [id, { means: byId[id].means, sources: byId[id].sources }])),
    },
  };
  writeFileSync(join(HERE, `${industry}.json`), JSON.stringify(frag, null, 1) + '\n');
  console.log(`${industry}.json: ${frag.crm.lead_types.length} lead types, ${frag.crm.statuses.length} statuses`);
}
